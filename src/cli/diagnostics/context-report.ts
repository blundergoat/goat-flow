/**
 * Builds and renders the local static context-pressure report.
 * Use this after `goat-flow diagnostics context` when a maintainer wants to see
 * which instructions, skills, references, or memory buckets approach their budgets.
 * Measurements stay local and deterministic; no provider telemetry is consulted.
 */
import type {
  AgentFacts,
  BucketFreshness,
  ProjectFacts,
  ReadonlyFS,
} from "../types.js";
import { getSkillFiles, loadManifest } from "../manifest/manifest.js";
import { BUCKET_SIZE_WARN_BYTES } from "../stats/stats.js";

const ESTIMATED_BYTES_PER_TOKEN = 4;
/** ADR-023 keeps the dispatcher small because users load it only to choose another workflow. */
const DISPATCHER_WORD_LIMIT = 555;
/** ADR-023 gives functional workflows room for gates without turning them into handbooks. */
const FUNCTIONAL_SKILL_WORD_LIMIT = 2_500;
/** ADR-023 caps shared invocation guidance because every goat-flow request pays this cost. */
const ALWAYS_LOADED_REFERENCE_WORD_LIMIT = 1_500;
/** ADR-023 allows larger topical references because users load them only when needed. */
const PROGRESSIVE_REFERENCE_WORD_LIMIT = 3_000;

/** Context surfaces grouped by how a user or agent loads them. */
type ContextSurfaceKind =
  | "instruction"
  | "dispatcher-skill"
  | "functional-skill"
  | "installed-skill"
  | "always-loaded-reference"
  | "progressive-reference"
  | "learning-loop-bucket";

/** Budget measurement used to explain why one surface receives a pressure state. */
interface ContextBudget {
  tier: string;
  metric: "lines" | "words" | "bytes" | null;
  warningAt: number | null;
  limit: number | null;
  comparison: "at-most" | "less-than" | "informational";
}

/** One measured file-like surface shown to terminal, Markdown, and JSON users. */
interface ContextSurface {
  path: string;
  kind: ContextSurfaceKind;
  agent: string | null;
  bytes: number;
  lines: number;
  words: number | null;
  estimatedTokens: number;
  budget: ContextBudget;
  pressure: "informational" | "within-budget" | "warning" | "over-budget";
  pressureRatio: number | null;
}

/** Actionable budget evidence for one surface that crossed its target or limit. */
interface ContextWarning {
  code: string;
  path: string;
  message: string;
}

/** Stable, timestamp-free JSON contract emitted by the static context command. */
export interface ContextReport {
  schema: "goat-flow.context-report.v1";
  projectPath: string;
  measurement: {
    source: "static-local-files";
    estimatedTokens: "ceil(utf8_bytes / 4)";
    telemetryRequired: false;
  };
  summary: {
    totalSurfaces: number;
    totalBytes: number;
    estimatedTokens: number;
    warningSurfaces: number;
    overBudgetSurfaces: number;
  };
  surfaces: {
    hotPathInstructions: ContextSurface[];
    skills: ContextSurface[];
    references: ContextSurface[];
    learningLoopBuckets: ContextSurface[];
  };
  topPressure: ContextSurface[];
  warnings: ContextWarning[];
}

/** Inputs already gathered by the shared fact pipeline and read-only project adapter. */
export interface BuildContextReportInput {
  projectFiles: ReadonlyFS;
  facts: ProjectFacts;
}

/** Count user-facing body words after excluding machine-readable YAML frontmatter. */
function countBudgetWords(content: string): number {
  const userFacingBody = content.replace(/^---\n[\s\S]*?\n---\n?/u, "");
  const trimmedContent = userFacingBody.trim();

  // An empty file contributes no words or user-facing context pressure.
  if (trimmedContent.length === 0) return 0;
  return trimmedContent.split(/\s+/u).length;
}

/** Count lines with the same trailing-newline semantics as the shared filesystem adapter. */
function countLines(content: string): number {
  // A truly empty file contains no user-visible instruction lines.
  if (content.length === 0) return 0;
  return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}

/** Select the metric value that determines one surface's budget pressure. */
function measuredBudgetValue(
  surface: Pick<ContextSurface, "bytes" | "lines" | "words" | "budget">,
): number | null {
  // Informational surfaces intentionally have no normative threshold.
  if (surface.budget.metric === null) return null;
  // Instruction budgets are expressed in lines users must scan every turn.
  if (surface.budget.metric === "lines") return surface.lines;
  // Learning-loop bucket limits use bytes because entries may mix prose and tables.
  if (surface.budget.metric === "bytes") return surface.bytes;
  return surface.words;
}

/** Convert a measured value and budget rule into the state shown to users. */
function calculatePressure(
  surface: Pick<ContextSurface, "bytes" | "lines" | "words" | "budget">,
): Pick<ContextSurface, "pressure" | "pressureRatio"> {
  const measuredValue = measuredBudgetValue(surface);
  const { budget } = surface;

  // Missing limits describe useful size information without claiming a policy violation.
  if (measuredValue === null || budget.limit === null) {
    return { pressure: "informational", pressureRatio: null };
  }

  const exceedsLimit =
    budget.comparison === "less-than"
      ? measuredValue >= budget.limit
      : measuredValue > budget.limit;
  // A hard limit means the surface is already outside its documented contract.
  if (exceedsLimit) {
    return {
      pressure: "over-budget",
      pressureRatio: measuredValue / budget.limit,
    };
  }

  // Instruction targets warn before the hard limit so maintainers can trim deliberately.
  if (budget.warningAt !== null && measuredValue > budget.warningAt) {
    return {
      pressure: "warning",
      pressureRatio: measuredValue / budget.limit,
    };
  }
  return {
    pressure: "within-budget",
    pressureRatio: measuredValue / budget.limit,
  };
}

/** Measure one readable Markdown surface and attach its documented budget. */
function measureContentSurface(
  path: string,
  kind: ContextSurfaceKind,
  content: string,
  budget: ContextBudget,
  agent: string | null,
  knownLineCount?: number,
): ContextSurface {
  const bytes = Buffer.byteLength(content, "utf8");
  const partialSurface = {
    path,
    kind,
    agent,
    bytes,
    lines: knownLineCount ?? countLines(content),
    words: countBudgetWords(content),
    estimatedTokens: Math.ceil(bytes / ESTIMATED_BYTES_PER_TOKEN),
    budget,
  };
  return { ...partialSurface, ...calculatePressure(partialSurface) };
}

/** Build the project-configured root-instruction budget for every selected agent. */
function instructionBudget(facts: ProjectFacts): ContextBudget {
  return {
    tier: "project instruction",
    metric: "lines",
    warningAt: facts.shared.config.lineLimits.target,
    limit: facts.shared.config.lineLimits.limit,
    comparison: "at-most",
  };
}

/** Collect root instruction files already read by the shared agent fact pipeline. */
function collectInstructionSurfaces(facts: ProjectFacts): ContextSurface[] {
  const surfaces: ContextSurface[] = [];

  // Each installed agent gets its own hot-path instruction measurement.
  for (const agentFacts of facts.agents) {
    const { instruction } = agentFacts;
    // Missing or unreadable instructions cannot contribute measured content.
    if (!instruction.exists || instruction.content === null) continue;
    surfaces.push(
      measureContentSurface(
        agentFacts.agent.instructionFile,
        "instruction",
        instruction.content,
        instructionBudget(facts),
        agentFacts.agent.id,
        instruction.lineCount,
      ),
    );
  }
  return surfaces;
}

/** Return the ADR-023 budget for a canonical or additional installed skill. */
function skillBudget(skillName: string): {
  kind: ContextSurfaceKind;
  budget: ContextBudget;
} {
  // The dispatcher carries a smaller routing-only allowance than functional workflows.
  if (skillName === "goat") {
    return {
      kind: "dispatcher-skill",
      budget: {
        tier: "ADR-023 dispatcher skill",
        metric: "words",
        warningAt: null,
        limit: DISPATCHER_WORD_LIMIT,
        comparison: "at-most",
      },
    };
  }

  const isCanonicalSkill = loadManifest().skills.canonical.includes(skillName);
  // Canonical goat-flow workflows keep their budget even when another pack file is missing.
  if (isCanonicalSkill) {
    return {
      kind: "functional-skill",
      budget: {
        tier: "ADR-023 functional skill",
        metric: "words",
        warningAt: null,
        limit: FUNCTIONAL_SKILL_WORD_LIMIT,
        comparison: "less-than",
      },
    };
  }
  return {
    kind: "installed-skill",
    budget: {
      tier: "informational installed skill",
      metric: null,
      warningAt: null,
      limit: null,
      comparison: "informational",
    },
  };
}

/** Collect installed skill bodies and manifest-declared per-skill references. */
function collectAgentSkillSurfaces(
  projectFiles: ReadonlyFS,
  agentFacts: AgentFacts,
): { skills: ContextSurface[]; references: ContextSurface[] } {
  const skills: ContextSurface[] = [];
  const references: ContextSurface[] = [];

  // Installed directories include canonical and user-added skills visible to this agent.
  for (const skillName of agentFacts.skills.installedDirs) {
    const skillPath = `${agentFacts.agent.skillsDir}/${skillName}/SKILL.md`;
    const skillContent = projectFiles.readFile(skillPath);
    // An unreadable body cannot be estimated and stays absent from the report.
    if (skillContent === null) continue;
    const skillClassification = skillBudget(skillName);
    skills.push(
      measureContentSurface(
        skillPath,
        skillClassification.kind,
        skillContent,
        skillClassification.budget,
        agentFacts.agent.id,
      ),
    );

    const referenceFiles = getSkillFiles(skillName).filter(
      (relativePath) => relativePath !== "SKILL.md",
    );
    // Manifest-owned references are measured without recursively discovering arbitrary files.
    for (const relativePath of referenceFiles) {
      const referencePath = `${agentFacts.agent.skillsDir}/${skillName}/${relativePath}`;
      const referenceContent = projectFiles.readFile(referencePath);
      // A missing optional reference has no local context cost to report.
      if (referenceContent === null) continue;
      references.push(
        measureContentSurface(
          referencePath,
          "progressive-reference",
          referenceContent,
          {
            tier: "ADR-023 progressive reference",
            metric: "words",
            warningAt: null,
            limit: PROGRESSIVE_REFERENCE_WORD_LIMIT,
            comparison: "less-than",
          },
          agentFacts.agent.id,
        ),
      );
    }
  }
  return { skills, references };
}

/** Collect all agent skill surfaces while keeping mirror paths and agent IDs explicit. */
function collectSkillSurfaces(
  projectFiles: ReadonlyFS,
  facts: ProjectFacts,
): { skills: ContextSurface[]; references: ContextSurface[] } {
  const skills: ContextSurface[] = [];
  const references: ContextSurface[] = [];

  // Multiple installed agents remain separate because each runtime loads its own mirror.
  for (const agentFacts of facts.agents) {
    const agentSurfaces = collectAgentSkillSurfaces(projectFiles, agentFacts);
    skills.push(...agentSurfaces.skills);
    references.push(...agentSurfaces.references);
  }
  return { skills, references };
}

/** Classify shared meta references by the load pattern ADR-023 assigns them. */
function sharedReferenceClassification(path: string): {
  kind: ContextSurfaceKind;
  budget: ContextBudget;
} {
  const isAlwaysLoaded = [
    ".goat-flow/skill-docs/skill-preamble.md",
    ".goat-flow/skill-docs/skill-conventions.md",
  ].includes(path);

  // The authoring index is intentionally short so it routes users before topical guidance loads.
  if (path === ".goat-flow/skill-docs/skill-quality-testing/README.md") {
    return {
      kind: "progressive-reference",
      budget: {
        tier: "ADR-023 skill-authoring index",
        metric: "words",
        warningAt: null,
        limit: 400,
        comparison: "less-than",
      },
    };
  }

  // Preamble and conventions affect every invocation and therefore use the tighter cap.
  if (isAlwaysLoaded) {
    return {
      kind: "always-loaded-reference",
      budget: {
        tier: "ADR-023 always-loaded shared content",
        metric: "words",
        warningAt: null,
        limit: ALWAYS_LOADED_REFERENCE_WORD_LIMIT,
        comparison: "less-than",
      },
    };
  }
  return {
    kind: "progressive-reference",
    budget: {
      tier: "ADR-023 progressive reference",
      metric: "words",
      warningAt: null,
      limit: PROGRESSIVE_REFERENCE_WORD_LIMIT,
      comparison: "less-than",
    },
  };
}

/** Collect manifest-owned shared references without scanning unrelated target files. */
function collectSharedReferenceSurfaces(
  projectFiles: ReadonlyFS,
): ContextSurface[] {
  const sharedReferencePaths = loadManifest().required_files.filter(
    (path) => path.startsWith(".goat-flow/skill-docs/") && path.endsWith(".md"),
  );
  const surfaces: ContextSurface[] = [];

  // Required-file order keeps the report stable across identical installations.
  for (const path of sharedReferencePaths) {
    const content = projectFiles.readFile(path);
    // Missing references are setup concerns, not context bytes, so audit reports them elsewhere.
    if (content === null) continue;
    const classification = sharedReferenceClassification(path);
    surfaces.push(
      measureContentSurface(
        path,
        classification.kind,
        content,
        classification.budget,
        null,
      ),
    );
  }
  return surfaces;
}

/** Merge one learning-loop bucket into the unique path inventory used by the report. */
function rememberLearningLoopBucket(
  bucketsByPath: Map<
    string,
    Pick<BucketFreshness, "path" | "sizeBytes" | "lineCount">
  >,
  bucket: Pick<BucketFreshness, "path" | "sizeBytes" | "lineCount">,
): void {
  // The first complete fact wins because footgun/lesson facts include authoritative line counts.
  if (bucketsByPath.has(bucket.path)) return;
  bucketsByPath.set(bucket.path, bucket);
}

/** Collect bucket measurements from shared facts without walking learning-loop directories again. */
function collectLearningLoopSurfaces(
  projectFiles: ReadonlyFS,
  facts: ProjectFacts,
): ContextSurface[] {
  const bucketsByPath = new Map<
    string,
    Pick<BucketFreshness, "path" | "sizeBytes" | "lineCount">
  >();
  const extractedBuckets = [
    ...facts.shared.footguns.buckets,
    ...facts.shared.lessons.buckets,
  ];

  // Existing footgun and lesson facts already contain complete per-file measurements.
  for (const bucket of extractedBuckets) {
    rememberLearningLoopBucket(bucketsByPath, bucket);
  }

  // Entry facts extend coverage to pattern and decision files without a second directory walk.
  for (const entry of facts.shared.learningLoopEntries) {
    rememberLearningLoopBucket(bucketsByPath, {
      path: entry.sourcePath,
      sizeBytes: entry.bucketSizeBytes,
      lineCount: projectFiles.lineCount(entry.sourcePath),
    });
  }

  return [...bucketsByPath.values()]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((bucket) => {
      const partialSurface = {
        path: bucket.path,
        kind: "learning-loop-bucket" as const,
        agent: null,
        bytes: bucket.sizeBytes,
        lines: bucket.lineCount,
        words: null,
        estimatedTokens: Math.ceil(
          bucket.sizeBytes / ESTIMATED_BYTES_PER_TOKEN,
        ),
        budget: {
          tier: "stats learning-loop bucket",
          metric: "bytes" as const,
          warningAt: null,
          limit: BUCKET_SIZE_WARN_BYTES,
          comparison: "at-most" as const,
        },
      };
      return { ...partialSurface, ...calculatePressure(partialSurface) };
    });
}

/** Sort budgeted surfaces from greatest relative pressure to least, then by path. */
function comparePressure(left: ContextSurface, right: ContextSurface): number {
  const ratioDifference =
    (right.pressureRatio ?? Number.NEGATIVE_INFINITY) -
    (left.pressureRatio ?? Number.NEGATIVE_INFINITY);
  // Equal ratios use the path so machine and terminal output remain deterministic.
  if (ratioDifference === 0) return left.path.localeCompare(right.path);
  return ratioDifference;
}

/** Describe the exact measured value and policy limit behind one warning. */
function warningForSurface(surface: ContextSurface): ContextWarning | null {
  // Within-budget and informational rows need no operator action.
  if (
    surface.pressure === "within-budget" ||
    surface.pressure === "informational"
  ) {
    return null;
  }
  const measuredValue = measuredBudgetValue(surface);
  const unit = surface.budget.metric ?? "value";
  const limit = surface.budget.limit;
  const code =
    surface.kind === "instruction"
      ? surface.pressure === "warning"
        ? "instruction-over-target"
        : "instruction-over-limit"
      : `${surface.kind}-over-budget`;
  return {
    code,
    path: surface.path,
    message: `${surface.path}: ${String(measuredValue)} ${unit} is ${surface.pressure}; ${surface.budget.tier} limit is ${String(limit)}.`,
  };
}

/**
 * Build the timestamp-free report consumed by all diagnostics context renderers.
 *
 * @param input - shared project facts and read-only files; empty surfaces produce an empty report
 * @returns stable grouped measurements, top pressure, and actionable budget warnings
 */
export function buildContextReport(
  input: BuildContextReportInput,
): ContextReport {
  const hotPathInstructions = collectInstructionSurfaces(input.facts);
  const agentSkillSurfaces = collectSkillSurfaces(
    input.projectFiles,
    input.facts,
  );
  const references = [
    ...agentSkillSurfaces.references,
    ...collectSharedReferenceSurfaces(input.projectFiles),
  ];
  const learningLoopBuckets = collectLearningLoopSurfaces(
    input.projectFiles,
    input.facts,
  );
  const allSurfaces = [
    ...hotPathInstructions,
    ...agentSkillSurfaces.skills,
    ...references,
    ...learningLoopBuckets,
  ];
  const budgetedSurfaces = allSurfaces
    .filter((surface) => surface.pressureRatio !== null)
    .sort(comparePressure);
  const warnings = budgetedSurfaces
    .map(warningForSurface)
    .filter((warning): warning is ContextWarning => warning !== null);

  // Totals show the static upper-bound footprint across every reported local surface.
  const totalBytes = allSurfaces.reduce(
    (runningBytes, surface) => runningBytes + surface.bytes,
    0,
  );
  return {
    schema: "goat-flow.context-report.v1",
    projectPath: input.facts.root,
    measurement: {
      source: "static-local-files",
      estimatedTokens: "ceil(utf8_bytes / 4)",
      telemetryRequired: false,
    },
    summary: {
      totalSurfaces: allSurfaces.length,
      totalBytes,
      estimatedTokens: Math.ceil(totalBytes / ESTIMATED_BYTES_PER_TOKEN),
      warningSurfaces: allSurfaces.filter(
        (surface) => surface.pressure === "warning",
      ).length,
      overBudgetSurfaces: allSurfaces.filter(
        (surface) => surface.pressure === "over-budget",
      ).length,
    },
    surfaces: {
      hotPathInstructions,
      skills: agentSkillSurfaces.skills,
      references,
      learningLoopBuckets,
    },
    topPressure: budgetedSurfaces.slice(0, 5),
    warnings,
  };
}

/**
 * Render stable JSON for dashboard, CI, and shell consumers.
 *
 * @param report - complete static report; empty arrays remain explicit for machine consumers
 * @returns one parseable JSON object with no progress text or trailing commentary
 */
export function renderContextReportJson(report: ContextReport): string {
  return JSON.stringify(report, null, 2);
}

/** Format one pressure row for concise terminal output. */
function renderTextSurface(surface: ContextSurface): string {
  const ratio =
    surface.pressureRatio === null
      ? "n/a"
      : `${Math.round(surface.pressureRatio * 100)}%`;
  return `  - ${surface.path} [${surface.pressure}] ${ratio} of ${surface.budget.tier}; ~${surface.estimatedTokens} tokens`;
}

/**
 * Render a concise terminal report with the highest-pressure paths first.
 *
 * @param report - complete static report; no warnings renders an explicit `None` state
 * @returns plain English terminal text explaining estimates, pressure, and warnings
 */
export function renderContextReportText(report: ContextReport): string {
  const lines = [
    "Static context report",
    `Path: ${report.projectPath}`,
    "Estimate: ceil(UTF-8 bytes / 4); local files only, no runner telemetry.",
    `Surfaces: ${report.summary.totalSurfaces} | Bytes: ${report.summary.totalBytes} | Estimated tokens: ${report.summary.estimatedTokens}`,
    `Pressure: ${report.summary.overBudgetSurfaces} over budget | ${report.summary.warningSurfaces} warning`,
    "",
    "Top pressure:",
  ];

  // An empty installation still receives an explicit, non-error report.
  if (report.topPressure.length === 0) {
    lines.push("  - No budgeted context surfaces found.");
  } else {
    lines.push(...report.topPressure.map(renderTextSurface));
  }
  lines.push("", "Warnings:");
  // No warnings means the operator can focus on the measured top-pressure list.
  if (report.warnings.length === 0) {
    lines.push("  - None.");
  } else {
    lines.push(
      ...report.warnings.map(
        (warning) => `  - [${warning.code}] ${warning.message}`,
      ),
    );
  }
  return lines.join("\n");
}

/**
 * Render a paste-ready Markdown report with the same evidence as text and JSON.
 *
 * @param report - complete static report; empty sections retain user-readable fallback text
 * @returns Markdown summary suitable for a plan, issue, or release investigation
 */
export function renderContextReportMarkdown(report: ContextReport): string {
  const lines = [
    "# Static Context Report",
    "",
    `- **Path:** ${report.projectPath}`,
    "- **Estimate:** `ceil(UTF-8 bytes / 4)`; local files only, no runner telemetry.",
    `- **Surfaces:** ${report.summary.totalSurfaces}`,
    `- **Bytes:** ${report.summary.totalBytes}`,
    `- **Estimated tokens:** ${report.summary.estimatedTokens}`,
    `- **Over budget:** ${report.summary.overBudgetSurfaces}`,
    `- **Warnings:** ${report.summary.warningSurfaces}`,
    "",
    "## Top Pressure",
    "",
  ];

  // Markdown keeps an explicit empty state for minimal or uninstalled targets.
  if (report.topPressure.length === 0) {
    lines.push("No budgeted context surfaces found.");
  } else {
    lines.push(
      ...report.topPressure.map((surface) => {
        const ratio = Math.round((surface.pressureRatio ?? 0) * 100);
        return `- \`${surface.path}\` - ${surface.pressure}, ${ratio}% of ${surface.budget.tier}, ~${surface.estimatedTokens} tokens`;
      }),
    );
  }
  lines.push("", "## Warnings", "");
  // Warning-free reports still state that result instead of leaving a blank section.
  if (report.warnings.length === 0) {
    lines.push("None.");
  } else {
    lines.push(
      ...report.warnings.map(
        (warning) => `- **${warning.code}:** ${warning.message}`,
      ),
    );
  }
  return lines.join("\n");
}
