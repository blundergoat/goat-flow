/**
 * Deterministic skill-quality scoring engine.
 *
 * Scores one artifact (skill or reference) across structural metrics
 * without executing agent prompts. Produces a recommendation:
 * keep-skill, consider-revision, consider-reclassifying,
 * reference-playbook, retire, or needs-human-review.
 *
 * All hardcoded values (walk roots, gate vocabulary, subtype profiles, etc.)
 * are sourced from `QualityConfig` (see `quality-config.ts`). Goat-flow's
 * calibrated defaults are applied automatically when no project override
 * exists in `.goat-flow/config.yaml`.
 */
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

import {
  compilePatternList,
  loadQualityConfig,
  profileMaxForSubtype,
  type ArtifactKind,
  type ArtifactSource,
  type ArtifactSubtype,
  type MetricName,
  type QualityConfig,
  type SubtypeDetection,
} from "./quality-config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Recommendation =
  | "keep-skill"
  | "consider-revision"
  | "consider-reclassifying"
  | "reference-playbook"
  | "retire"
  | "needs-human-review";
type MetricSeverity = "ok" | "warn" | "fail" | "n/a";

interface ClassificationAlternative {
  subtype: ArtifactSubtype;
  score: number;
}

interface ClassificationResult {
  detectedSubtype: ArtifactSubtype;
  /** 0-1 — how strongly the top subtype dominates alternatives. */
  confidence: number;
  alternatives: ClassificationAlternative[];
  reasoning: string[];
}

interface ArtifactEntry {
  id: string;
  name: string;
  path: string;
  kind: ArtifactKind;
  source: ArtifactSource;
  mirrorPaths?: string[];
  missingMirrors?: string[];
}

interface MetricSignals {
  promote?: boolean;
  demote?: boolean;
  meta?: boolean;
}

interface MetricResult {
  metric: MetricName;
  label: string;
  score: number;
  maxScore: number;
  severity: MetricSeverity;
  detail: string;
  signals?: MetricSignals;
}

export interface SkillQualityReport {
  artifact: ArtifactEntry;
  totalScore: number;
  maxTotalScore: number;
  profileMax: number;
  subtype: ArtifactSubtype;
  classification: ClassificationResult;
  recommendation: Recommendation;
  metrics: MetricResult[];
  composedFrom: string[];
  fitNotes: string[];
}

interface MetricInput {
  rawContent: string;
  composedContent: string;
  artifact: ArtifactEntry;
  subtype: ArtifactSubtype;
  profileMax: number;
  projectRoot: string;
  config: QualityConfig;
}

interface ReadContentResult {
  content: string;
  notes: string[];
}

interface ComposeResult {
  raw: string;
  composed: string;
  sources: string[];
  notes: string[];
}

type MetricScorer = (input: MetricInput) => MetricResult;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const METRIC_LABELS: Record<MetricName, string> = {
  "trigger-clarity": "Trigger Clarity",
  "workflow-completeness": "Workflow Completeness",
  "gate-quality": "Gate Quality",
  "evidence-testability": "Evidence & Testability",
  "cold-start": "Cold-Start Executability",
  "token-cost": "Token / Load Cost",
  "tool-deps": "Tool Dependency Handling",
  "write-risk": "Write Risk",
  "skill-reference-fit": "Skill vs Reference Fit",
};

// ---------------------------------------------------------------------------
// Artifact Inventory
// ---------------------------------------------------------------------------

/** Return true when a directory entry is safe to inspect as a normal file tree. */
function isSafeEntry(path: string): boolean {
  try {
    return !lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

interface ReferenceCandidate {
  name: string;
  path: string;
}

function referenceIdSegment(value: string): string {
  return (
    value
      .replace(/^\.+\/?/u, "")
      .replace(/[^a-z0-9_-]+/giu, "-")
      .replace(/^-+|-+$/gu, "")
      .toLowerCase() || "reference-root"
  );
}

function referenceArtifactId(
  candidate: ReferenceCandidate,
  nameCounts: ReadonlyMap<string, number>,
  usedIds: Set<string>,
): string {
  const duplicateName = (nameCounts.get(candidate.name) ?? 0) > 1;
  const baseId = duplicateName
    ? `reference:${referenceIdSegment(dirname(candidate.path))}:${candidate.name}`
    : `reference:${candidate.name}`;
  let id = baseId;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${baseId}:${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  return id;
}

function uploadedSharedReferencePath(name: string): string {
  return `.goat-flow/skill-playbooks/${name}.md`;
}

function registerSkillArtifact(
  projectRoot: string,
  artifactsById: Map<string, ArtifactEntry>,
  name: string,
  skillFile: string,
  source: ArtifactSource,
): void {
  const id = `skill:${name}`;
  const path = relative(projectRoot, skillFile);
  const existing = artifactsById.get(id);
  if (existing) {
    existing.mirrorPaths = [...(existing.mirrorPaths ?? []), path];
    return;
  }
  artifactsById.set(id, {
    id,
    name,
    path,
    kind: "skill",
    source,
    mirrorPaths: [],
    missingMirrors: [],
  });
}

function addMissingMirrorMetadata(
  projectRoot: string,
  artifact: ArtifactEntry,
  config: QualityConfig,
): ArtifactEntry {
  if (artifact.kind !== "skill") return artifact;
  const expected = config.walkRoots.skills.map(({ dir }) =>
    relative(projectRoot, join(projectRoot, dir, artifact.name, "SKILL.md")),
  );
  const present = new Set([artifact.path, ...(artifact.mirrorPaths ?? [])]);
  return {
    ...artifact,
    mirrorPaths: artifact.mirrorPaths ?? [],
    missingMirrors: expected.filter((path) => !present.has(path)),
  };
}

// eslint-disable-next-line complexity -- inventory walks multiple artifact roots and dedupes mirrored skills into one canonical artifact
export function discoverArtifacts(
  projectRoot: string,
  config: QualityConfig = loadQualityConfig(projectRoot),
): ArtifactEntry[] {
  const artifactsById = new Map<string, ArtifactEntry>();

  for (const { dir, source } of config.walkRoots.skills) {
    const skillsDir = join(projectRoot, dir);
    if (!existsSync(skillsDir)) continue;
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      const entryPath = join(skillsDir, entry.name);
      if (!entry.isDirectory() || !isSafeEntry(entryPath)) continue;
      const skillFile = join(entryPath, "SKILL.md");
      if (!existsSync(skillFile) || !isSafeEntry(skillFile)) continue;
      registerSkillArtifact(
        projectRoot,
        artifactsById,
        entry.name,
        skillFile,
        source,
      );
    }
  }

  const artifacts = Array.from(artifactsById.values()).map((artifact) =>
    addMissingMirrorMetadata(projectRoot, artifact, config),
  );

  const referenceCandidates: ReferenceCandidate[] = [];
  for (const { dir } of config.walkRoots.references) {
    const refDir = join(projectRoot, dir);
    if (!existsSync(refDir)) continue;
    for (const entry of readdirSync(refDir, { withFileTypes: true })) {
      const filePath = join(refDir, entry.name);
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      if (entry.name === "README.md" || !isSafeEntry(filePath)) continue;
      const name = entry.name.replace(/\.md$/, "");
      referenceCandidates.push({
        name,
        path: relative(projectRoot, filePath),
      });
    }
  }

  const referenceNameCounts = new Map<string, number>();
  for (const candidate of referenceCandidates) {
    referenceNameCounts.set(
      candidate.name,
      (referenceNameCounts.get(candidate.name) ?? 0) + 1,
    );
  }
  const usedReferenceIds = new Set(artifacts.map((artifact) => artifact.id));
  for (const candidate of referenceCandidates) {
    artifacts.push({
      id: referenceArtifactId(candidate, referenceNameCounts, usedReferenceIds),
      name: candidate.name,
      path: candidate.path,
      kind: "shared-reference",
      source: "shared-reference",
    });
  }

  return artifacts;
}

export function findArtifact(
  projectRoot: string,
  artifactId: string,
  config: QualityConfig = loadQualityConfig(projectRoot),
): ArtifactEntry | null {
  return (
    discoverArtifacts(projectRoot, config).find((a) => a.id === artifactId) ??
    null
  );
}

// ---------------------------------------------------------------------------
// Content helpers
// ---------------------------------------------------------------------------

function isPathWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  if (rel === "") return true;
  if (isAbsolute(rel)) return false;
  const [firstSegment] = rel.split(/[\\/]/);
  return firstSegment !== "..";
}

function readTextCapped(
  path: string,
  config: QualityConfig,
): { content: string; truncated: boolean } | null {
  if (!existsSync(path) || !isSafeEntry(path)) return null;
  const stats = statSync(path);
  if (!stats.isFile()) return null;
  const maxBytes = Math.max(0, Math.floor(config.maxArtifactBytes));
  const bytesToRead = Math.min(stats.size, maxBytes);
  const buffer = Buffer.alloc(bytesToRead);
  const fd = openSync(path, "r");
  try {
    const bytesRead = readSync(fd, buffer, 0, bytesToRead, 0);
    return {
      content: buffer.subarray(0, bytesRead).toString("utf-8"),
      truncated: stats.size > config.maxArtifactBytes,
    };
  } finally {
    closeSync(fd);
  }
}

function resolveSkillReferencePath(
  skillDir: string,
  relativeRef: string,
): string | null {
  if (relativeRef.includes("\0")) return null;
  const referenceRoot = resolve(skillDir, "references");
  const refPath = resolve(referenceRoot, relativeRef);
  if (!isPathWithin(referenceRoot, refPath)) return null;
  if (existsSync(referenceRoot) && !isSafeEntry(referenceRoot)) return null;
  if (!existsSync(refPath)) return refPath;
  try {
    const realReferenceRoot = realpathSync(referenceRoot);
    const realRefPath = realpathSync(refPath);
    if (!isPathWithin(realReferenceRoot, realRefPath)) return null;
  } catch {
    return null;
  }
  return refPath;
}

function readArtifactContent(
  projectRoot: string,
  artifact: ArtifactEntry,
  config: QualityConfig,
): ReadContentResult {
  const fullPath = join(projectRoot, artifact.path);
  const text = readTextCapped(fullPath, config);
  if (text === null) return { content: "", notes: [] };
  return {
    content: text.content,
    notes: text.truncated
      ? [`artifact truncated at ${config.maxArtifactBytes} bytes`]
      : [],
  };
}

function readOptionalText(path: string, config: QualityConfig): string | null {
  return readTextCapped(path, config)?.content ?? null;
}

function utf8ByteLength(content: string): number {
  return Buffer.byteLength(content, "utf-8");
}

function truncateUtf8Bytes(content: string, maxBytes: number): string {
  const cap = Math.max(0, Math.floor(maxBytes));
  let used = 0;
  let output = "";
  for (const char of content) {
    const next = utf8ByteLength(char);
    if (used + next > cap) break;
    output += char;
    used += next;
  }
  return output;
}

// eslint-disable-next-line complexity -- composition assembles preamble, conventions, and skill-local references in a fixed pipeline; each branch is a distinct artifact-class case
function composeArtifactContent(
  projectRoot: string,
  artifact: ArtifactEntry,
  rawContent: string,
  config: QualityConfig,
): ComposeResult {
  if (artifact.kind === "shared-reference") {
    return {
      raw: rawContent,
      composed: rawContent,
      sources: [basename(artifact.path)],
      notes: [],
    };
  }

  const chunks: string[] = [];
  const sources: string[] = [];
  const notes: string[] = [];
  if (config.composition.skillPreamblePath) {
    const preamble = readOptionalText(
      join(projectRoot, config.composition.skillPreamblePath),
      config,
    );
    if (preamble !== null) {
      chunks.push(preamble);
      sources.push(basename(config.composition.skillPreamblePath));
    }
  }
  if (
    config.composition.skillConventionsPath &&
    /skill-conventions/i.test(rawContent)
  ) {
    const conventions = readOptionalText(
      join(projectRoot, config.composition.skillConventionsPath),
      config,
    );
    if (conventions !== null) {
      chunks.push(conventions);
      sources.push(basename(config.composition.skillConventionsPath));
    }
  }

  chunks.push(rawContent);
  sources.push("SKILL.md");

  const skillDir = dirname(join(projectRoot, artifact.path));
  const seenReferences = new Set<string>();
  const refRegex = new RegExp(config.composition.skillReferencePattern, "g");
  for (const match of rawContent.matchAll(refRegex)) {
    const relativeRef = match[1];
    if (!relativeRef) continue;
    if (seenReferences.has(relativeRef)) continue;
    seenReferences.add(relativeRef);
    const refPath = resolveSkillReferencePath(skillDir, relativeRef);
    if (refPath === null) continue;
    const refContent = readOptionalText(refPath, config);
    if (refContent === null) continue;
    chunks.push(refContent);
    sources.push(`references/${relativeRef}`);
  }

  // Sibling .md files alongside SKILL.md that the goat composition recipe
  // didn't already pick up (skipping SKILL.md itself, README.md, and any
  // file under references/). This catches non-goat-shaped bundles where the
  // skill is split across multiple top-level markdown files (e.g. a
  // `workflow.md` + `template.md` + `steps/*.md` BMAD-style layout). The
  // max-bytes cap still applies, so a wildly oversized bundle gets truncated
  // rather than blowing the composition budget.
  try {
    for (const entry of readdirSync(skillDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".md")) continue;
      if (entry.name === "SKILL.md" || entry.name === "README.md") continue;
      const filePath = join(skillDir, entry.name);
      if (!isSafeEntry(filePath)) continue;
      const content = readOptionalText(filePath, config);
      if (content === null) continue;
      chunks.push(content);
      sources.push(entry.name);
    }
  } catch {
    // Directory unreadable: ignore — composition continues with what we have.
  }

  const composed = chunks.join("\n\n---\n\n");
  if (utf8ByteLength(composed) <= config.composition.maxComposedBytes) {
    return { raw: rawContent, composed, sources, notes };
  }
  notes.push(
    `composition truncated at ${Math.round(config.composition.maxComposedBytes / 1024)}KB`,
  );
  return {
    raw: rawContent,
    composed: truncateUtf8Bytes(composed, config.composition.maxComposedBytes),
    sources,
    notes,
  };
}

function countHeadings(content: string, level: number): number {
  const prefix = "#".repeat(level) + " ";
  return content.split("\n").filter((l) => l.startsWith(prefix)).length;
}

function hasSection(content: string, pattern: RegExp): boolean {
  return pattern.test(content);
}

function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

function countSubReferences(
  projectRoot: string,
  artifact: ArtifactEntry,
): number {
  if (artifact.kind !== "skill") return 0;
  const referencesDir = join(projectRoot, dirname(artifact.path), "references");
  if (!existsSync(referencesDir) || !statSync(referencesDir).isDirectory()) {
    return 0;
  }
  return readdirSync(referencesDir)
    .filter((file) => file.endsWith(".md"))
    .filter((file) => isSafeEntry(join(referencesDir, file))).length;
}

function metricSeverity(score: number, maxScore: number): MetricSeverity {
  if (maxScore === 0) return "n/a";
  const pct = score / maxScore;
  if (pct >= 0.75) return "ok";
  if (pct >= 0.4) return "warn";
  return "fail";
}

function finalizeMetric(
  input: MetricInput,
  metric: MetricName,
  score: number,
  detail: string,
  signals?: MetricSignals,
): MetricResult {
  const maxScore = input.config.subtypes[input.subtype].profile[metric];
  if (maxScore === 0) {
    return {
      metric,
      label: METRIC_LABELS[metric],
      score: 0,
      maxScore,
      severity: "n/a",
      detail: `n/a for subtype=${input.subtype}`,
      signals,
    };
  }
  const cappedScore = Math.max(0, Math.min(score, maxScore));
  return {
    metric,
    label: METRIC_LABELS[metric],
    score: cappedScore,
    maxScore,
    severity: metricSeverity(cappedScore, maxScore),
    detail,
    signals,
  };
}

// ---------------------------------------------------------------------------
// Subtype detection & classification
// ---------------------------------------------------------------------------

const SUBTYPE_NAME_MATCH_SCORE = 5;
const SUBTYPE_HEADING_MATCH_SCORE = 2;
const SUBTYPE_FALLBACK_SCORE = 1;

interface SubtypeMatchScore {
  subtype: ArtifactSubtype;
  score: number;
  reasoning: string[];
}

/**
 * Score a single subtype's detection against an artifact. Returns 0 when the
 * subtype is incompatible (wrong kind or vetoed by a `mustNotHave` heading).
 *
 * Scoring rules:
 *  - Name match: +SUBTYPE_NAME_MATCH_SCORE (unconditional — preserves the M07
 *    OR semantics where `goat-security` is a report regardless of Step 0).
 *  - Heading match: +SUBTYPE_HEADING_MATCH_SCORE per match, vetoed by
 *    `mustNotHave`. Heading-only matches that trigger `mustNotHave` return 0.
 *  - Empty rules (fallback subtype): SUBTYPE_FALLBACK_SCORE so the fallback
 *    always matches with low confidence.
 */
// eslint-disable-next-line complexity -- subtype match scoring exhausts kind compatibility, fallback rules, name-vs-heading scoring, and mustNotHave veto in one place to keep priority semantics local
function scoreSubtypeMatch(
  artifact: ArtifactEntry,
  content: string,
  detection: SubtypeDetection,
  subtype: ArtifactSubtype,
): SubtypeMatchScore {
  const reasoning: string[] = [];
  if (detection.kinds.length > 0 && !detection.kinds.includes(artifact.kind)) {
    return { subtype, score: 0, reasoning };
  }

  if (
    detection.namePatterns.length === 0 &&
    detection.headingPatterns.length === 0
  ) {
    reasoning.push(`fallback for kind=${artifact.kind}`);
    return { subtype, score: SUBTYPE_FALLBACK_SCORE, reasoning };
  }

  let score = 0;
  if (detection.namePatterns.includes(artifact.name)) {
    score += SUBTYPE_NAME_MATCH_SCORE;
    reasoning.push(`name "${artifact.name}" in name-patterns`);
  }

  let headingMatched = false;
  for (const pattern of detection.headingPatterns) {
    if (new RegExp(pattern, "i").test(content)) {
      score += SUBTYPE_HEADING_MATCH_SCORE;
      headingMatched = true;
      reasoning.push(`heading "${pattern}" present`);
    }
  }

  if (score === 0) return { subtype, score: 0, reasoning };

  // Heading-only matches are vetoed by mustNotHave; name matches override.
  const nameMatched = detection.namePatterns.includes(artifact.name);
  if (!nameMatched && headingMatched) {
    for (const veto of detection.mustNotHave) {
      if (new RegExp(veto, "i").test(content)) {
        reasoning.push(`vetoed by must-not-have "${veto}"`);
        return { subtype, score: 0, reasoning };
      }
    }
  }

  return { subtype, score, reasoning };
}

const REFERENCE_DETECTION_ORDER: ArtifactSubtype[] = [
  "meta",
  "index",
  "playbook",
];
const SKILL_DETECTION_ORDER: ArtifactSubtype[] = [
  "dispatcher",
  "report",
  "workflow",
];

/**
 * Classify an artifact across all candidate subtypes. The detected subtype
 * is the highest-scoring match; confidence is `top / (top + second)` to
 * communicate how dominant the leading subtype is.
 */
function classifyArtifact(
  artifact: ArtifactEntry,
  content: string,
  config: QualityConfig,
): ClassificationResult {
  const order =
    artifact.kind === "shared-reference"
      ? REFERENCE_DETECTION_ORDER
      : SKILL_DETECTION_ORDER;

  const matches = order
    .map((subtype) =>
      scoreSubtypeMatch(
        artifact,
        content,
        config.subtypes[subtype].detection,
        subtype,
      ),
    )
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score);

  if (matches.length === 0) {
    const fallback =
      artifact.kind === "shared-reference" ? "playbook" : "workflow";
    return {
      detectedSubtype: fallback,
      confidence: 0,
      alternatives: [],
      reasoning: [
        `no subtype matched ${artifact.id}; using ${fallback} as fallback`,
      ],
    };
  }

  const top = matches[0];
  if (!top) {
    const fallback =
      artifact.kind === "shared-reference" ? "playbook" : "workflow";
    return {
      detectedSubtype: fallback,
      confidence: 0,
      alternatives: [],
      reasoning: ["unreachable: empty match list after pre-filter"],
    };
  }
  const rest = matches.slice(1);
  const second = rest[0];
  const confidence =
    second === undefined ? 1 : top.score / (top.score + second.score);
  const reasoning = [
    `detected ${top.subtype} (score ${top.score}): ${top.reasoning.join("; ")}`,
    ...rest.map(
      (m) =>
        `also matched ${m.subtype} (score ${m.score}): ${m.reasoning.join("; ")}`,
    ),
  ];
  return {
    detectedSubtype: top.subtype,
    confidence,
    alternatives: rest.map(({ subtype, score }) => ({ subtype, score })),
    reasoning,
  };
}

// ---------------------------------------------------------------------------
// Metric scorers
// ---------------------------------------------------------------------------

/** Workflow-summary detection for skill descriptions. Sourced from the prime
 *  writing-skills corpus (search: `Testing revealed that when a description
 *  summarizes`): when a description names *what the skill does internally*
 *  (procedural verbs, "X then Y" connectives) rather than *when to trigger*,
 *  agents tend to follow the description and skip the skill body. Detected as
 *  a yellow signal only — emits a tip via the trigger-clarity detail string;
 *  never deducts score. Verb list narrowed to keep <10% false-positive rate
 *  on the in-tree `.claude/skills` corpus. */
const WORKFLOW_VERB_RE =
  /\b(dispatches?|implements?(?:ing|ed)?|executes?(?:ing|ed)?|generates?|runs?|produces?|creates?|builds?|refactors?|writes?)\b/i;
const WORKFLOW_CONNECTIVE_RE = /\b(then|between)\b/i;

function descriptionSummarizesWorkflow(content: string): boolean {
  const match = /^---[\s\S]*?description:\s*"([^"]+)"[\s\S]*?---/m.exec(
    content,
  );
  if (!match) return false;
  const description = match[1];
  if (!description) return false;
  // Skip the trigger preamble — `Use when X, Y` — and inspect the rest of the
  // description. If the trailing portion contains procedural verbs or process
  // connectives, the description is summarising workflow rather than naming
  // triggering conditions.
  const stripped = description.replace(/^Use when [^,.;-]*[,.;-]?\s*/i, "");
  return (
    WORKFLOW_VERB_RE.test(stripped) || WORKFLOW_CONNECTIVE_RE.test(stripped)
  );
}

// eslint-disable-next-line complexity -- exhaustive structural signal scoring; each branch maps to one trigger-clarity rule
const triggerClarity: MetricScorer = (input) => {
  const { artifact, rawContent: content, subtype } = input;
  let score = 0;
  const notes: string[] = [];

  if (artifact.kind === "skill") {
    const hasFrontmatterDesc =
      /^---[\s\S]*?description:\s*".+"[\s\S]*?---/m.test(content);
    const hasWhenToUse =
      hasSection(content, /##\s+When to Use/i) || /\bUse when\b/i.test(content);
    const hasExclusion =
      /NOT this skill/i.test(content) ||
      /If the user names a skill explicitly/i.test(content);

    if (hasFrontmatterDesc) score += 5;
    else notes.push("missing frontmatter description");
    if (hasWhenToUse) score += 5;
    else notes.push('missing "When to Use" signal');
    if (hasExclusion && subtype !== "dispatcher") score += 5;
    else if (subtype === "dispatcher") notes.push("dispatcher route-map scope");
    else notes.push('missing "NOT this skill" exclusion list');

    if (hasFrontmatterDesc && descriptionSummarizesWorkflow(content)) {
      notes.push(
        "description summarizes workflow rather than triggering conditions",
      );
    }
  } else {
    const hasPurpose =
      hasSection(content, /##\s+Purpose/i) ||
      hasSection(content, /##\s+When to (load|use)/i) ||
      /^---[\s\S]*?goat-flow-reference-version/m.test(content);
    if (hasPurpose) score += 10;
    else notes.push("missing purpose or version header");

    const hasAvailCheck = hasSection(content, /Availability Check/i);
    if (hasAvailCheck) score += 5;
    else if (subtype === "meta" || subtype === "index") score += 5;
    else notes.push("missing Availability Check");
  }

  return finalizeMetric(
    input,
    "trigger-clarity",
    score,
    notes.length > 0 ? notes.join("; ") : "clear trigger definition",
  );
};

// eslint-disable-next-line complexity -- exhaustive structural signal scoring; each branch maps to one workflow-completeness rule
const workflowCompleteness: MetricScorer = (input) => {
  const { artifact, rawContent: content, subtype } = input;
  let score = 0;
  const notes: string[] = [];

  if (artifact.kind === "skill") {
    const hasStep0 = hasSection(content, /##\s+Step 0/i);
    const phaseCount = countHeadings(content, 2) + countHeadings(content, 3);
    const hasCheckpoint = /CHECKPOINT/i.test(content);
    const hasRouteMap = hasSection(content, /##\s+Route Map/i);
    const hasQuickScan = hasSection(content, /##\s+Quick Scan Path/i);

    if (subtype === "dispatcher") {
      if (hasRouteMap) score += 5;
      else notes.push("missing dispatcher Route Map");
    } else {
      if (hasStep0 || hasQuickScan) score += 5;
      else notes.push("missing Step 0 intake");
      if (phaseCount >= 4) score += 5;
      else notes.push(`only ${phaseCount} sections (expected 4+)`);
      if (hasCheckpoint || subtype === "report") score += 5;
      else notes.push("no CHECKPOINT stops");
    }
  } else {
    const hasWorkflow =
      hasSection(content, /##\s+.*Workflow/i) ||
      hasSection(content, /##\s+Steps/i) ||
      hasSection(content, /###\s+Step\s+\d/i);
    const hasTroubleshooting =
      hasSection(content, /Troubleshoot/i) || hasSection(content, /Fallback/i);
    const sectionCount = countHeadings(content, 2);

    if (hasWorkflow || subtype === "index" || subtype === "meta") score += 5;
    else notes.push("no workflow/steps section");
    if (hasTroubleshooting || subtype === "meta") score += 5;
    else notes.push("no troubleshooting/fallback");
    if (sectionCount >= 3) score += 5;
    else notes.push(`only ${sectionCount} top-level sections`);
  }

  return finalizeMetric(
    input,
    "workflow-completeness",
    score,
    notes.length > 0 ? notes.join("; ") : "complete workflow",
  );
};

const gateQuality: MetricScorer = (input) => {
  const { composedContent: content, config } = input;
  let score = 0;
  const notes: string[] = [];

  const verificationGate = compilePatternList(
    config.gateVocabulary.verificationGate,
  );
  const explicitPass = compilePatternList(config.gateVocabulary.explicitPass);
  const humanStop = compilePatternList(config.gateVocabulary.humanStop);

  if (verificationGate.test(content)) score += 5;
  else notes.push("no verification gates or checklists");
  if (explicitPass.test(content)) score += 3;
  else notes.push("no explicit pass/fail criteria");
  if (humanStop.test(content)) score += 2;
  else notes.push("no explicit human stop or checkpoint");

  return finalizeMetric(
    input,
    "gate-quality",
    score,
    notes.length > 0 ? notes.join("; ") : "strong gates",
  );
};

const evidenceTestability: MetricScorer = (input) => {
  const content = input.composedContent;
  let score = 0;
  const notes: string[] = [];

  const hasEvidenceTag =
    /OBSERVED|INFERRED/i.test(content) || /evidence[_-]quality/i.test(content);
  const hasProofGate =
    /Proof Gate/i.test(content) || /evidence.*required/i.test(content);
  const hasSemanticAnchors =
    /\(search:\s*"[^"]+"\)/i.test(content) || /search:.*`[^`]+`/i.test(content);

  if (hasEvidenceTag) score += 4;
  else notes.push("no evidence quality tags");
  if (hasProofGate) score += 3;
  else notes.push("no proof gate");
  if (hasSemanticAnchors) score += 3;
  else notes.push("no semantic anchors");

  return finalizeMetric(
    input,
    "evidence-testability",
    score,
    notes.length > 0 ? notes.join("; ") : "strong evidence contract",
  );
};

// eslint-disable-next-line complexity -- exhaustive structural signal scoring; each branch maps to one cold-start rule
const coldStartExecutability: MetricScorer = (input) => {
  const { artifact, rawContent: content } = input;
  let score = 0;
  const notes: string[] = [];

  if (artifact.kind === "skill") {
    const loadsPreamble =
      /skill-preamble/i.test(content) || /Shared Conventions/i.test(content);
    const hasReadFirst =
      /Read First/i.test(content) || /read.*before/i.test(content);
    const hasContextSetup =
      /context.*setup/i.test(content) || /load.*before/i.test(content);

    if (loadsPreamble) score += 5;
    else notes.push("no preamble/conventions loading");
    if (hasReadFirst || hasContextSetup) score += 5;
    else notes.push("no Read First or context setup");
  } else {
    const hasPurpose =
      hasSection(content, /##\s+Purpose/i) ||
      /^This (reference|playbook|document)/im.test(content);
    const hasPrereqs =
      /prerequisite/i.test(content) ||
      /requires?:/i.test(content) ||
      /Availability Check/i.test(content);

    if (hasPurpose) score += 5;
    else notes.push("no clear purpose statement");
    if (hasPrereqs) score += 5;
    else notes.push("no prerequisites or availability check");
  }

  return finalizeMetric(
    input,
    "cold-start",
    score,
    notes.length > 0 ? notes.join("; ") : "good cold-start",
  );
};

const tokenCost: MetricScorer = (input) => {
  const tokens = estimateTokens(input.rawContent);
  const subRefs = countSubReferences(input.projectRoot, input.artifact);
  const notes: string[] = [];

  let score: number;
  if (tokens > 20000) {
    score = 0;
    notes.push(`~${tokens} tokens - very large`);
  } else if (tokens > 10000) {
    score = 3;
    notes.push(`~${tokens} tokens - large`);
  } else if (tokens > 5000) {
    score = 7;
    notes.push(`~${tokens} tokens`);
  } else {
    score = 10;
  }

  if (subRefs > 5) {
    score = Math.max(0, score - 3);
    notes.push(`${subRefs} sub-references loaded`);
  } else if (subRefs > 0) {
    notes.push(`${subRefs} sub-reference(s)`);
  }

  return finalizeMetric(
    input,
    "token-cost",
    score,
    notes.length > 0 ? notes.join("; ") : `~${tokens} tokens`,
  );
};

const toolDependencyHandling: MetricScorer = (input) => {
  const { composedContent: content, config } = input;
  let score = 5;
  const notes: string[] = [];

  const hasAvailCheck = /Availability Check/i.test(content);
  const hasFallback =
    /fallback/i.test(content) || /if.*unavailable/i.test(content);
  const toolKeywords = new RegExp(config.toolKeywordsRegex, "i");
  const hasToolRef = toolKeywords.test(content);

  if (hasToolRef) {
    if (hasAvailCheck) score += 3;
    else notes.push("references tools without availability check");
    if (hasFallback) score += 2;
    else notes.push("no fallback for tool dependencies");
  } else {
    score = 10;
  }

  return finalizeMetric(
    input,
    "tool-deps",
    score,
    notes.length > 0
      ? notes.join("; ")
      : hasToolRef
        ? "tools handled"
        : "no external tool dependencies",
  );
};

const writeRisk: MetricScorer = (input) => {
  const { artifact, composedContent: content } = input;
  let score = 10;
  const notes: string[] = [];

  if (artifact.kind === "skill") {
    const hasModeSystem =
      /Read-Only|File-Write|Plan|Implement/i.test(content) &&
      /mode/i.test(content);
    const hasEscalation =
      /approval/i.test(content) || /ask.*before/i.test(content);

    if (!hasModeSystem) {
      score -= 4;
      notes.push("no read-only vs write mode system");
    }
    if (!hasEscalation) {
      score -= 3;
      notes.push("no escalation gate for writes");
    }
  } else {
    const writesFiles =
      /write|create|modify|edit.*file/i.test(content) &&
      !/read-only/i.test(content);
    if (writesFiles) {
      score -= 2;
      notes.push("reference mentions file writes");
    }
  }

  return finalizeMetric(
    input,
    "write-risk",
    score,
    notes.length > 0 ? notes.join("; ") : "controlled write risk",
  );
};

// eslint-disable-next-line complexity -- exhaustive structural signal scoring; each branch maps to one skill-vs-reference fit rule
const skillReferenceFit: MetricScorer = (input) => {
  const { artifact, rawContent: content, subtype } = input;
  const signals = {
    hasFrontmatterName: /^---[\s\S]*?name:\s*.+[\s\S]*?---/m.test(content),
    hasIntake: hasSection(content, /##\s+Step 0/i),
    hasCheckpoint: /CHECKPOINT/i.test(content),
    hasModes: /Read-Only|File-Write|Plan.*mode|Implement.*mode/i.test(content),
    hasAvailCheck: /Availability Check/i.test(content),
    isToolProtocol:
      /tool.*protocol|observation.*workflow|capture.*workflow/i.test(content),
    hasRefVersion: /goat-flow-reference-version/i.test(content),
    hasSkillVersion: /goat-flow-skill-version/i.test(content),
    hasRouteMap: hasSection(content, /##\s+Route Map/i),
    hasQuickScan: hasSection(content, /##\s+Quick Scan Path/i),
  };

  const skillSignals = [
    signals.hasFrontmatterName,
    signals.hasIntake,
    signals.hasCheckpoint,
    signals.hasModes,
    signals.hasSkillVersion,
  ].filter(Boolean).length;
  const refSignals = [
    signals.hasAvailCheck,
    signals.isToolProtocol,
    signals.hasRefVersion,
    !signals.hasFrontmatterName,
    !signals.hasIntake,
  ].filter(Boolean).length;
  const resultSignals: MetricSignals = {};
  const notes: string[] = [];
  let score: number;

  if (subtype === "meta" || subtype === "index") {
    resultSignals.meta = true;
    score = 10;
    notes.push(
      subtype === "index"
        ? "index reference; routes to sibling files"
        : "shared meta-reference; not user-invocable",
    );
  } else if (artifact.kind === "skill") {
    if (
      (subtype === "dispatcher" && signals.hasRouteMap) ||
      (subtype === "report" && signals.hasQuickScan)
    ) {
      score = 10;
    } else if (skillSignals >= 3) {
      score = 10;
    } else if (skillSignals >= 2) {
      score = 7;
      notes.push("weak skill identity - missing some structural signals");
    } else {
      score = 3;
      resultSignals.demote = true;
      notes.push(
        "artifact lacks skill structure - may belong in skill-reference/",
      );
    }
    if (refSignals >= 3 && subtype === "workflow") {
      score = Math.max(0, score - 3);
      resultSignals.demote = true;
      notes.push("strong reference signals - consider demoting to reference");
    }
  } else {
    if (refSignals >= 3) {
      score = 10;
    } else if (refSignals >= 2) {
      score = 7;
      notes.push("adequate reference identity");
    } else {
      score = 5;
      notes.push("reference lacks typical structural signals");
    }
    if (skillSignals >= 3) {
      score = Math.max(0, score - 3);
      resultSignals.promote = true;
      notes.push("strong skill signals - consider promoting to skill");
    }
  }

  return finalizeMetric(
    input,
    "skill-reference-fit",
    score,
    notes.length > 0 ? notes.join("; ") : "good fit for current classification",
    resultSignals,
  );
};

const ALL_METRICS: MetricScorer[] = [
  triggerClarity,
  workflowCompleteness,
  gateQuality,
  evidenceTestability,
  coldStartExecutability,
  tokenCost,
  toolDependencyHandling,
  writeRisk,
  skillReferenceFit,
];

// ---------------------------------------------------------------------------
// Recommendation engine
// ---------------------------------------------------------------------------

const CONFIDENCE_THRESHOLD = 0.7;

function reclassifyNote(classification: ClassificationResult): string {
  const top = classification.alternatives[0];
  const altText = top
    ? `Could also be ${top.subtype} (match score ${top.score}).`
    : "No clear alternative subtype.";
  return `Strong structure but classification confidence is ${Math.round(
    classification.confidence * 100,
  )}% in ${classification.detectedSubtype}. ${altText}`;
}

// eslint-disable-next-line complexity -- recommendation tree dispatches over kind × score-band × confidence × structured fit signals
function deriveRecommendation(
  artifact: ArtifactEntry,
  metrics: MetricResult[],
  totalScore: number,
  maxTotalScore: number,
  classification: ClassificationResult,
): { recommendation: Recommendation; fitNotes: string[] } {
  const fitNotes: string[] = [];
  const pct = maxTotalScore > 0 ? totalScore / maxTotalScore : 0;
  const fitMetric = metrics.find((m) => m.metric === "skill-reference-fit");
  const failCount = metrics.filter((m) => m.severity === "fail").length;
  const zeroMetric = metrics.find((m) => m.maxScore > 0 && m.score === 0);
  const confident = classification.confidence >= CONFIDENCE_THRESHOLD;

  if (fitMetric?.signals?.meta) {
    fitNotes.push(fitMetric.detail);
    return { recommendation: "reference-playbook", fitNotes };
  }

  if (pct < 0.3) {
    fitNotes.push(
      artifact.kind === "skill"
        ? "Very low quality score. Verify the artifact is still maintained and useful."
        : "Very low quality score for a reference.",
    );
    return { recommendation: "retire", fitNotes };
  }

  if (zeroMetric) {
    fitNotes.push(
      `${zeroMetric.label} scored 0/${zeroMetric.maxScore}. Manual review required before keeping this recommendation.`,
    );
    if (artifact.kind === "shared-reference") {
      fitNotes.push(
        "Still classified as reference/playbook; quality needs review.",
      );
    }
    return { recommendation: "needs-human-review", fitNotes };
  }

  if (artifact.kind === "skill") {
    if (fitMetric?.signals?.demote) {
      fitNotes.push(
        "Artifact lacks skill structure. Consider demoting to .goat-flow/skill-reference/.",
      );
      return { recommendation: "reference-playbook", fitNotes };
    }
    if (failCount >= 4) {
      fitNotes.push(
        `${failCount} metrics scored "fail". Manual review recommended.`,
      );
      return { recommendation: "needs-human-review", fitNotes };
    }
    if (pct >= 0.7) {
      if (!confident) {
        fitNotes.push(reclassifyNote(classification));
        return { recommendation: "consider-reclassifying", fitNotes };
      }
      fitNotes.push("Strong skill identity with adequate structural quality.");
      return { recommendation: "keep-skill", fitNotes };
    }
    fitNotes.push(
      "Moderate quality. Review metric details for improvement opportunities.",
    );
    return { recommendation: "consider-revision", fitNotes };
  }

  if (fitMetric?.signals?.promote) {
    fitNotes.push(
      "Strong skill signals detected. Consider promoting to a first-class goat-* skill.",
    );
    return { recommendation: "needs-human-review", fitNotes };
  }
  if (pct >= 0.7 && !confident) {
    fitNotes.push(reclassifyNote(classification));
    return { recommendation: "consider-reclassifying", fitNotes };
  }
  fitNotes.push("Fits reference/playbook classification.");
  return { recommendation: "reference-playbook", fitNotes };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Score raw content against the rubric without reading any file from disk.
 * Used by both `scoreArtifact` (which reads first) and `evaluateContent`
 * (which gets content from an upload or paste).
 */
function scoreContent(
  projectRoot: string,
  artifact: ArtifactEntry,
  rawContent: string,
  config: QualityConfig,
  preReadNotes: string[] = [],
): SkillQualityReport {
  const classification = classifyArtifact(artifact, rawContent, config);
  const subtype = classification.detectedSubtype;
  const profileMax = profileMaxForSubtype(config, subtype);
  const composed = composeArtifactContent(
    projectRoot,
    artifact,
    rawContent,
    config,
  );
  const metricInput: MetricInput = {
    rawContent: composed.raw,
    composedContent: composed.composed,
    artifact,
    subtype,
    profileMax,
    projectRoot,
    config,
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
  );

  return {
    artifact,
    totalScore,
    maxTotalScore,
    profileMax,
    subtype,
    classification,
    recommendation,
    metrics,
    composedFrom: composed.sources,
    fitNotes: [...preReadNotes, ...composed.notes, ...fitNotes],
  };
}

export function scoreArtifact(
  projectRoot: string,
  artifact: ArtifactEntry,
  config: QualityConfig = loadQualityConfig(projectRoot),
): SkillQualityReport {
  const raw = readArtifactContent(projectRoot, artifact, config);
  return scoreContent(projectRoot, artifact, raw.content, config, raw.notes);
}

export function scoreAllArtifacts(
  projectRoot: string,
  config: QualityConfig = loadQualityConfig(projectRoot),
): SkillQualityReport[] {
  return discoverArtifacts(projectRoot, config).map((a) =>
    scoreArtifact(projectRoot, a, config),
  );
}

// ---------------------------------------------------------------------------
// Uploaded-content evaluation (draft scoring; user-supplied markdown)
// ---------------------------------------------------------------------------

interface EvaluateInput {
  /** Raw markdown content (uploaded file or pasted text). */
  content: string;
  /** Optional name; falls back to a generic placeholder. */
  suggestedName?: string;
  /** Optional explicit kind; otherwise inferred from frontmatter. */
  kind?: ArtifactKind;
}

interface ImprovementTip {
  metric: MetricName;
  severity: MetricSeverity;
  message: string;
}

interface EvaluateResult extends SkillQualityReport {
  tips: ImprovementTip[];
}

function inferArtifactKind(content: string): ArtifactKind {
  if (/goat-flow-skill-version:/i.test(content)) return "skill";
  if (/goat-flow-reference-version:/i.test(content)) return "shared-reference";
  if (/^##\s+Step 0/im.test(content) || /^##\s+Route Map/im.test(content)) {
    return "skill";
  }
  return "shared-reference";
}

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
      'Trim the description to triggering conditions only ("Use when …"). Workflow summaries (e.g. "dispatches subagent then runs review between tasks") cause agents to follow the description and skip the skill body — see `.goat-flow/skill-playbooks/skill-quality-testing/tdd-iteration.md` for the trap and verbatim source.',
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
    match: /no CHECKPOINT stops/,
    message:
      "Add `CHECKPOINT:` markers between phases to gate human review before continuing.",
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
      "Reference the `Proof Gate` from `skill-preamble.md` or add a `BLOCKING GATE: human approves before...` line.",
  },
  {
    metric: "evidence-testability",
    match: /no evidence quality tags/,
    message:
      "Tag findings as `OBSERVED` (cited from a re-read source) or `INFERRED` (derived) so reviewers see what's verified.",
  },
  {
    metric: "evidence-testability",
    match: /no proof gate/,
    message:
      "Apply the Proof Gate from `skill-preamble.md` — every claim must cite a fresh re-read of the source.",
  },
  {
    metric: "evidence-testability",
    match: /no semantic anchors/,
    message:
      'Cite evidence with file + semantic anchor (e.g. `path/file.ts (search: "function-name")`) rather than line numbers, which go stale.',
  },
  {
    metric: "cold-start",
    match: /no preamble\/conventions loading/,
    message:
      "Reference `.goat-flow/skill-reference/skill-preamble.md` early so the skill inherits the Proof Gate and evidence discipline.",
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
      "Sub-reference count is high — review whether some can be merged or moved into a shared playbook.",
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
      "Strengthen the skill identity — add the frontmatter `name`, `## Step 0`, and `CHECKPOINT` markers so it reads as a skill rather than a doc.",
  },
  {
    metric: "skill-reference-fit",
    match: /lacks skill structure - may belong/,
    message:
      "Consider moving this content under `.goat-flow/skill-playbooks/` as a playbook; it lacks the structural signals of a skill.",
  },
  {
    metric: "skill-reference-fit",
    match: /strong reference signals - consider demoting/,
    message:
      "Strong reference-shape signals — if this is supposed to be a skill, drop the playbook framing and add Step 0 / phases / gates.",
  },
  {
    metric: "skill-reference-fit",
    match: /strong skill signals - consider promoting/,
    message:
      "This reference reads like a skill. If it has a workflow with gates, scaffold it under `.claude/skills/<name>/SKILL.md` instead.",
  },
];

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
  for (const metric of report.metrics) {
    tips.push(...tipsForMetric(metric));
  }
  return tips;
}

/**
 * Score uploaded markdown content (no file IO) and synthesise actionable
 * improvement tips from the metric breakdown. Used by the dashboard
 * "Evaluate skill" modal.
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
  const report = scoreContent(projectRoot, artifact, input.content, config);
  return { ...report, tips: synthesiseImprovementTips(report) };
}

interface EvaluateBundleFile {
  name: string;
  content: string;
}

interface EvaluateBundleInput {
  files: EvaluateBundleFile[];
  suggestedName?: string;
  kind?: ArtifactKind;
}

/**
 * Score a multi-file uploaded skill bundle (no file IO). Picks a primary file
 * — `SKILL.md` if any of the dropped files is named that, otherwise `files[0]`
 * — and treats the remaining files as sibling `.md` files appended to the
 * composed surface. The same composition recipe applies as for on-disk skills:
 * preamble + conventions are still pulled in if available, and the bundle
 * surface contributes to gate/evidence/tool-deps scoring. `composedFrom` lists
 * every input file in drop order, plus preamble/conventions when composed in.
 */
// eslint-disable-next-line complexity -- multi-file scoring fans out across primary-file selection, single-file fast path, and the manual compose+score pipeline; each branch represents one distinct case
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

  const kind = input.kind ?? inferArtifactKind(primary.content);
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

  const baseReport = scoreContent(
    projectRoot,
    artifact,
    primary.content,
    config,
  );
  if (siblings.length === 0) {
    // Replace the synthetic "SKILL.md"/"<name>.md" entry with the uploaded
    // filename, but keep the meta order from the engine (preamble/conventions
    // first, primary last) so it matches the on-disk artifact view.
    const remappedComposedFrom = baseReport.composedFrom.map((s) =>
      s === "SKILL.md" || s === `${name}.md` ? primary.name : s,
    );
    return {
      ...baseReport,
      composedFrom: remappedComposedFrom,
      tips: synthesiseImprovementTips(baseReport),
    };
  }

  // Re-score with the composed surface explicitly extended by sibling files.
  // We construct the composed content ourselves (rather than relying on the
  // on-disk composer) and replay the metric pipeline so tool/evidence/gate
  // signals from sibling files count.
  const baseCompose = composeArtifactContent(
    projectRoot,
    artifact,
    primary.content,
    config,
  );
  const siblingChunks = siblings.map((f) => f.content);
  const siblingNames = siblings.map((f) => f.name);
  const composedFull = [baseCompose.composed, ...siblingChunks].join(
    "\n\n---\n\n",
  );
  const composed =
    utf8ByteLength(composedFull) <= config.composition.maxComposedBytes
      ? composedFull
      : truncateUtf8Bytes(composedFull, config.composition.maxComposedBytes);
  const truncated =
    utf8ByteLength(composedFull) > config.composition.maxComposedBytes;

  const classification = classifyArtifact(artifact, primary.content, config);
  const subtype = classification.detectedSubtype;
  const profileMax = profileMaxForSubtype(config, subtype);
  const metricInput: MetricInput = {
    rawContent: primary.content,
    composedContent: composed,
    artifact,
    subtype,
    profileMax,
    projectRoot,
    config,
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
  );

  // Build composedFrom: meta sources first (preamble/conventions) for visual
  // grouping, then every uploaded file in drop order.
  const metaSources = baseCompose.sources.filter(
    (s) => s !== "SKILL.md" && s !== `${name}.md`,
  );
  const composedFrom = [...metaSources, primary.name, ...siblingNames];
  const notes = truncated
    ? [
        `composition truncated at ${Math.round(config.composition.maxComposedBytes / 1024)}KB`,
      ]
    : [];

  const report: SkillQualityReport = {
    artifact,
    totalScore,
    maxTotalScore,
    profileMax,
    subtype,
    classification,
    recommendation,
    metrics,
    composedFrom,
    fitNotes: [...notes, ...fitNotes],
  };
  return { ...report, tips: synthesiseImprovementTips(report) };
}
