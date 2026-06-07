/**
 * Scoring path for content uploaded or pasted through the dashboard "Evaluate skill" flow, where
 * the artifact has no trusted on-disk location. Scores the supplied markdown with disk scanning
 * disabled, then turns the metric breakdown into actionable improvement tips for the modal.
 *
 * The no-disk rule is a safety boundary, not an optimisation: a user-supplied name must never cause
 * sibling files of an installed skill to be composed into the score, so host composition is stripped
 * and `scanDisk: false` is passed throughout. Artifact kind is inferred from content when the caller
 * does not specify it, and the upload name is sanitised before use as an id.
 */
import {
  cloneQualityConfig,
  loadQualityConfig,
  profileMaxForSubtype,
  type ArtifactKind,
  type MetricName,
  type QualityConfig,
} from "./quality-config.js";
import {
  composeArtifactContent,
  truncateUtf8Bytes,
  uploadedSharedReferencePath,
  utf8ByteLength,
} from "./skill-quality-content.js";
import {
  classifyArtifact,
  detectArtifactShape,
} from "./skill-quality-classification.js";
import { ALL_METRICS } from "./skill-quality-metrics.js";
import { deriveRecommendation } from "./skill-quality-recommendation.js";
import { scoreContent } from "./skill-quality-score.js";
import type {
  ArtifactEntry,
  MetricInput,
  MetricResult,
  MetricSeverity,
  SkillQualityReport,
} from "./skill-quality-types.js";

/**
 * Uploaded single-file artifact payload; scoring must not read sibling files from disk.
 */
interface EvaluateInput {
  /** Raw markdown content (uploaded file or pasted text). */
  content: string;
  /** Optional name; falls back to a generic placeholder. */
  suggestedName?: string | undefined;
  /** Optional explicit kind; otherwise inferred from frontmatter. */
  kind?: ArtifactKind | undefined;
}

/**
 * Dashboard-facing remediation generated from one metric detail string.
 */
interface ImprovementTip {
  metric: MetricName;
  severity: MetricSeverity;
  message: string;
}

/**
 * Skill-quality report plus actionable dashboard tips for uploaded content.
 */
interface EvaluateResult extends SkillQualityReport {
  tips: ImprovementTip[];
}

/**
 * Infer whether uploaded markdown is a skill or reference from explicit headers first.
 */
function inferArtifactKind(content: string): ArtifactKind {
  if (/goat-flow-skill-version:/i.test(content)) return "skill";
  if (/goat-flow-reference-version:/i.test(content)) return "shared-reference";
  if (/^##\s+Step 0/im.test(content) || /^##\s+Route Map/im.test(content)) {
    return "skill";
  }
  return "shared-reference";
}

/**
 * Convert an uploaded filename into the synthetic artifact id segment.
 */
function sanitiseUploadName(raw: string | undefined): string {
  if (!raw) return "uploaded-skill";
  const slug = raw
    .toLowerCase()
    .replace(/\.(md|markdown)$/i, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug.length > 0 ? slug : "uploaded-skill";
}

const TIP_RULES: Array<{
  metric: MetricName;
  match: RegExp;
  message: string;
  /** When true, the tip fires even on `ok` severity. Used for advisory-only
   *  signals (e.g. workflow-summary descriptions) where we want to surface a
   *  recommendation without altering the structural score. */
  alwaysFire?: boolean;
}> = [
  {
    metric: "trigger-clarity",
    match: /missing frontmatter description/,
    message:
      'Add a `description: "..."` field in the frontmatter explaining what this skill does in one line.',
  },
  {
    metric: "trigger-clarity",
    match: /missing "When to Use"/,
    message:
      "Add a `## When to Use` section describing the trigger conditions for this skill.",
  },
  {
    metric: "trigger-clarity",
    match: /missing "NOT this skill"/,
    message:
      "Add a `**NOT this skill:**` exclusion list naming intents that route to other skills, so the dispatcher can disambiguate.",
  },
  {
    metric: "trigger-clarity",
    match: /description summarizes workflow rather than triggering conditions/,
    message:
      'Trim the description to triggering conditions only ("Use when …"). Workflow summaries (e.g. "dispatches subagent then runs review between tasks") cause agents to follow the description and skip the skill body - see `.goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md` for the trap and verbatim source.',
    alwaysFire: true,
  },
  {
    metric: "trigger-clarity",
    match: /missing purpose or version header/,
    message:
      "Add a `## Purpose` section or a `goat-flow-reference-version` frontmatter field to anchor the reference.",
  },
  {
    metric: "trigger-clarity",
    match: /missing Availability Check/,
    message:
      "Add an `## Availability Check` section showing how to verify the underlying tool is installed (e.g. `command -v <tool>`).",
  },
  {
    metric: "workflow-completeness",
    match: /missing Step 0 intake/,
    message:
      "Add a `## Step 0 - Intake` section that lists the files, modes, and assumptions the skill loads before acting.",
  },
  {
    metric: "workflow-completeness",
    match: /only \d+ sections/,
    message:
      "Break the work into at least four `##` sections (Step 0 + Phase 1/2/3 + Verification) so the workflow is reviewable phase-by-phase.",
  },
  {
    metric: "workflow-completeness",
    match: /no checkpoint or blocking gate stops/,
    message:
      "Add a phase-stop marker between phases - `CHECKPOINT:` or `BLOCKING GATE:` - to gate human review before continuing.",
  },
  {
    metric: "workflow-completeness",
    match: /missing dispatcher Route Map/,
    message:
      "Dispatcher skills need an explicit `## Route Map` table mapping user intents to sibling skills.",
  },
  {
    metric: "workflow-completeness",
    match: /no workflow\/steps section/,
    message:
      "Add a `## Workflow` or `### Step N` section so the reference is procedurally usable.",
  },
  {
    metric: "workflow-completeness",
    match: /no troubleshooting\/fallback/,
    message:
      "Add a `## Fallback / Troubleshooting` section listing what to do when the documented path fails.",
  },
  {
    metric: "gate-quality",
    match: /no verification gates or checklists/,
    message:
      "Add a `## Verification` section with `- [ ]` checkboxes or a `BLOCKING GATE:` marker for human approval.",
  },
  {
    metric: "gate-quality",
    match: /no explicit pass\/fail criteria/,
    message:
      'State pass/fail criteria explicitly (e.g. "evidence required", "must pass", "exit on green").',
  },
  {
    metric: "gate-quality",
    match: /no explicit human stop or checkpoint/,
    message:
      "Add an explicit human stop such as `CHECKPOINT:` or `BLOCKING GATE: human approves before...`.",
  },
  {
    metric: "evidence-testability",
    match: /no evidence quality tags/,
    message:
      "Tag findings as `OBSERVED` (cited from a re-read source) or `INFERRED` (derived) so reviewers see what's verified.",
  },
  {
    metric: "evidence-testability",
    match: /no evidence gate/,
    message:
      "Add an evidence gate requiring every claim to cite a fresh re-read source or current command output.",
  },
  {
    metric: "evidence-testability",
    match: /no semantic anchors/,
    message:
      'Cite evidence with file + semantic anchor (e.g. `path/file.ts (search: "function-name")`) rather than line numbers, which go stale.',
  },
  {
    metric: "cold-start",
    match: /no prerequisites or operating context/,
    message:
      "State prerequisites, assumptions, inputs, or operating modes so the skill can run without project-specific inherited context.",
  },
  {
    metric: "cold-start",
    match: /no Read First or context setup/,
    message:
      "Add a `## Read First` section listing files the skill must load before acting.",
  },
  {
    metric: "cold-start",
    match: /no clear purpose statement/,
    message:
      "Open with `## Purpose` or `This reference covers …` so an agent knows when to load it.",
  },
  {
    metric: "cold-start",
    match: /no prerequisites or availability check/,
    message:
      "Document prerequisites or an Availability Check so callers know the preconditions.",
  },
  {
    metric: "token-cost",
    match: /tokens - very large|tokens - large/,
    message:
      "Split content into `references/*.md` so SKILL.md stays under 5k tokens; the skill loads them on-demand.",
  },
  {
    metric: "token-cost",
    match: /sub-references loaded/,
    message:
      "Sub-reference count is high - review whether some can be merged or moved into a shared playbook.",
  },
  {
    metric: "tool-deps",
    match: /references tools without availability check/,
    message:
      "Add an Availability Check (e.g. `command -v <tool>`) before invoking external tools, so the skill fails closed.",
  },
  {
    metric: "tool-deps",
    match: /no fallback for tool dependencies/,
    message:
      "Add a fallback path (manual evidence, alternative tool, or skip) when the external tool is unavailable.",
  },
  {
    metric: "write-risk",
    match: /no read-only vs write mode system/,
    message:
      "Define explicit `Read-Only` and `File-Write` modes; default to read-only and require approval to escalate.",
  },
  {
    metric: "write-risk",
    match: /no escalation gate for writes/,
    message:
      "Require explicit user approval before any file write (e.g. `ask before` or `approval` keyword in the mode-escalation prose).",
  },
  {
    metric: "write-risk",
    match: /reference mentions file writes/,
    message:
      "Either mark the reference as read-only or move write-side procedures into a skill that owns the gates.",
  },
  {
    metric: "skill-reference-fit",
    match: /weak skill identity/,
    message:
      "Strengthen the skill identity - add the frontmatter `name`, `## Step 0`, and `CHECKPOINT` markers so it reads as a skill rather than a doc.",
  },
  {
    metric: "skill-reference-fit",
    match: /lacks skill structure - may belong/,
    message:
      "Consider moving this content under `.goat-flow/skill-docs/playbooks/` as a playbook; it lacks the structural signals of a skill.",
  },
  {
    metric: "skill-reference-fit",
    match: /strong reference signals - consider demoting/,
    message:
      "Strong reference-shape signals - if this is supposed to be a skill, drop the playbook framing and add Step 0 / phases / gates.",
  },
  {
    metric: "skill-reference-fit",
    match: /strong skill signals - consider promoting/,
    message:
      "This reference reads like a skill. If it has a workflow with gates, scaffold it under `.claude/skills/<name>/SKILL.md` instead.",
  },
];

/**
 * Translate metric details into stable remediation tips because dashboard advice
 * must stay tied to the exact scoring detail that triggered it.
 */
function tipsForMetric(metric: MetricResult): ImprovementTip[] {
  if (metric.severity === "n/a") return [];
  const matched: ImprovementTip[] = [];
  const isOk = metric.severity === "ok";
  for (const rule of TIP_RULES) {
    if (rule.metric !== metric.metric) continue;
    if (isOk && !rule.alwaysFire) continue;
    if (rule.match.test(metric.detail)) {
      matched.push({
        metric: metric.metric,
        severity: metric.severity,
        message: rule.message,
      });
    }
  }
  if (!isOk && matched.length === 0) {
    matched.push({
      metric: metric.metric,
      severity: metric.severity,
      message: `${metric.label}: ${metric.detail}`,
    });
  }
  return matched;
}

function synthesiseImprovementTips(
  report: SkillQualityReport,
): ImprovementTip[] {
  const tips: ImprovementTip[] = [];
  if (
    report.shapeMismatch &&
    report.artifact.kind === "skill" &&
    report.detectedShape === "playbook"
  ) {
    tips.push({
      metric: "skill-reference-fit",
      severity: "warn",
      message:
        "This is packaged as a skill but reads like a playbook. Split it into a thin workflow skill plus a reference playbook, or add Step 0 modes, checkpoints, and verification gates if it must remain a skill.",
    });
  }
  for (const metric of report.metrics) {
    tips.push(...tipsForMetric(metric));
  }
  return tips;
}

/**
 * Strip the host project's shared skill-preamble/conventions from composition
 * so uploaded markdown is scored as a standalone artifact. The dashboard
 * "Evaluate skill" modal evaluates content that may live outside goat-flow
 * entirely; gluing goat-flow's preamble onto it inflates gate/evidence/tool
 * signals the uploaded skill doesn't actually own.
 */
function configForUpload(config: QualityConfig): QualityConfig {
  const isolated = cloneQualityConfig(config);
  isolated.composition.skillPreamblePath = null;
  isolated.composition.skillConventionsPath = null;
  return isolated;
}

/**
 * Score uploaded markdown content (no file IO) and synthesise actionable
 * improvement tips from the metric breakdown. Used by the dashboard
 * "Evaluate skill" modal.
 *
 * @param projectRoot - Project whose quality config supplies rubric settings.
 * @param input - Uploaded markdown and optional naming/classification hints.
 * @param config - Optional scoring config; host composition is stripped before scoring.
 */
export function evaluateContent(
  projectRoot: string,
  input: EvaluateInput,
  config: QualityConfig = loadQualityConfig(projectRoot),
): EvaluateResult {
  const kind = input.kind ?? inferArtifactKind(input.content);
  const name = sanitiseUploadName(input.suggestedName);
  const artifact: ArtifactEntry = {
    id: `${kind === "skill" ? "skill" : "reference"}:${name}`,
    name,
    path:
      kind === "skill"
        ? `.claude/skills/${name}/SKILL.md`
        : uploadedSharedReferencePath(name),
    kind,
    source: kind === "skill" ? "installed" : "shared-reference",
    mirrorPaths: [],
    missingMirrors: [],
  };
  const report = scoreContent(
    projectRoot,
    artifact,
    input.content,
    configForUpload(config),
    [],
    { scanDisk: false },
  );
  return { ...report, tips: synthesiseImprovementTips(report) };
}

/**
 * One uploaded bundle file after dashboard request decoding has validated size and name.
 */
interface EvaluateBundleFile {
  name: string;
  content: string;
}

/**
 * Multi-file upload payload where only user-provided files contribute to composition.
 */
interface EvaluateBundleInput {
  files: EvaluateBundleFile[];
  suggestedName?: string | undefined;
  kind?: ArtifactKind | undefined;
}

/**
 * Score a multi-file uploaded skill bundle (no file IO). Picks a primary file
 * - `SKILL.md` if any of the dropped files is named that, otherwise `files[0]`
 * - and treats the remaining files as sibling `.md` files appended to the
 * composed surface. The same composition recipe applies as for on-disk skills:
 * preamble + conventions are still pulled in if available, and the bundle
 * surface contributes to gate/evidence/tool-deps scoring. `composedFrom` lists
 * every input file in drop order, plus preamble/conventions when composed in.
 */
// eslint-disable-next-line complexity -- intentional because multi-file scoring fans out across primary-file selection, single-file fast path, and the manual compose+score pipeline; each branch represents one distinct case
export function evaluateUploadedBundle(
  projectRoot: string,
  input: EvaluateBundleInput,
  config: QualityConfig = loadQualityConfig(projectRoot),
): EvaluateResult {
  const files = input.files;
  const primaryIndex = Math.max(
    0,
    files.findIndex((f) => f.name === "SKILL.md"),
  );
  const primary = files[primaryIndex] ?? files[0];
  if (!primary) {
    throw new Error("evaluateUploadedBundle: files array must be non-empty");
  }
  const siblings = files.filter((_, i) => i !== primaryIndex);
  const uploadedSurface = [primary.content, ...siblings.map((f) => f.content)]
    .filter((content) => content.length > 0)
    .join("\n\n---\n\n");

  const kind = input.kind ?? inferArtifactKind(uploadedSurface);
  const name = sanitiseUploadName(
    input.suggestedName ?? primary.name.replace(/\.(md|markdown)$/i, ""),
  );
  const artifact: ArtifactEntry = {
    id: `${kind === "skill" ? "skill" : "reference"}:${name}`,
    name,
    path:
      kind === "skill"
        ? `.claude/skills/${name}/SKILL.md`
        : uploadedSharedReferencePath(name),
    kind,
    source: kind === "skill" ? "installed" : "shared-reference",
    mirrorPaths: [],
    missingMirrors: [],
  };

  const uploadConfig = configForUpload(config);
  const baseReport = scoreContent(
    projectRoot,
    artifact,
    primary.content,
    uploadConfig,
    [],
    { scanDisk: false },
  );
  if (siblings.length === 0) {
    const remappedComposedFrom = baseReport.composedFrom.map((s) =>
      s === "SKILL.md" || s === `${name}.md` ? primary.name : s,
    );
    return {
      ...baseReport,
      composedFrom: remappedComposedFrom,
      tips: synthesiseImprovementTips(baseReport),
    };
  }

  const baseCompose = composeArtifactContent(
    projectRoot,
    artifact,
    primary.content,
    uploadConfig,
    { scanDisk: false },
  );
  const siblingChunks = siblings.map((f) => f.content);
  const siblingNames = siblings.map((f) => f.name);
  const composedFull = [baseCompose.composed, ...siblingChunks].join(
    "\n\n---\n\n",
  );
  const composed =
    utf8ByteLength(composedFull) <= uploadConfig.composition.maxComposedBytes
      ? composedFull
      : truncateUtf8Bytes(
          composedFull,
          uploadConfig.composition.maxComposedBytes,
        );
  const truncated =
    utf8ByteLength(composedFull) > uploadConfig.composition.maxComposedBytes;

  const classification = classifyArtifact(artifact, composed, uploadConfig);
  const subtype = classification.detectedSubtype;
  const shape = detectArtifactShape(artifact, composed);
  const profileMax = profileMaxForSubtype(uploadConfig, subtype);
  const metricInput: MetricInput = {
    rawContent: composed,
    composedContent: composed,
    artifact,
    subtype,
    profileMax,
    projectRoot,
    config: uploadConfig,
  };
  const metrics = ALL_METRICS.map((scorer) => scorer(metricInput));
  const totalScore = metrics.reduce((sum, m) => sum + m.score, 0);
  const maxTotalScore = metrics.reduce((sum, m) => sum + m.maxScore, 0);
  const { recommendation, fitNotes } = deriveRecommendation(
    artifact,
    metrics,
    totalScore,
    maxTotalScore,
    classification,
    shape,
  );

  const composedFrom = [primary.name, ...siblingNames];
  const notes = truncated
    ? [
        `composition truncated at ${Math.round(uploadConfig.composition.maxComposedBytes / 1024)}KB`,
      ]
    : [];

  const report: SkillQualityReport = {
    artifact,
    totalScore,
    maxTotalScore,
    profileMax,
    subtype,
    detectedShape: shape.detectedShape,
    shapeConfidence: shape.confidence,
    shapeMismatch: shape.detectedShape !== subtype,
    classification,
    recommendation,
    metrics,
    composedFrom,
    fitNotes: [...notes, ...fitNotes],
  };
  return { ...report, tips: synthesiseImprovementTips(report) };
}
