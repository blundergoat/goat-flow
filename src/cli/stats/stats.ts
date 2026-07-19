/**
 * Learning-loop health report (`goat-flow stats`).
 *
 * Consumes the live `SharedFacts` pipeline - no second on-disk read path and no
 * persisted derived counts. `--check` mode reuses the same report data to decide
 * pass/fail, so CI and the human-readable report never disagree.
 */
import { DECISION_META_FILES } from "../facts/shared/decision-files.js";
import type {
  SharedFacts,
  BucketFreshness,
  LearningLoopEntryFact,
  ReadonlyFS,
} from "../types.js";
import type { IndexFreshness } from "./index-freshness.js";

/**
 * Aggregated per-surface view over one learning-loop directory.
 * Use when `goat-flow stats` shows users whether memory records are fresh enough to trust.
 * Invariant: totals and bucket rows come from the same `SharedFacts` read so CLI and checks agree.
 */
export interface BucketSection {
  path: string;
  exists: boolean;
  totalEntries: number;
  totalStaleRefs: number;
  totalInvalidLineRefs: number;
  /** Active entries with `**Recurrence update` markers across all buckets.
   *  Feedback-loop graduation candidates: report-only, never a `--check` failure. */
  totalGraduationCandidates: number;
  bands: { fresh: number; aging: number; stale: number; unknown: number };
  buckets: BucketFreshness[];
  formatDiagnostic: string | null;
}

/**
 * Full `goat-flow stats` report payload shown to CLI and dashboard users.
 * Use this stable shape when a consumer needs summaries plus per-entry memory health.
 */
export interface StatsReport {
  footguns: BucketSection;
  lessons: BucketSection;
  /** Stable entry facts; empty means this caller did not collect durable memories. */
  learningLoopEntries: LearningLoopEntryFact[];
  decisions?: DecisionsSection;
  /** Generated-index freshness per bucket (`index-fresh` check); absent when not collected. */
  indexes?: IndexFreshness[];
}

/**
 * ADR file snapshot used by stats checks.
 *
 * `content` is nullable because unreadable files still need filename/routing validation.
 */
interface DecisionFileSummary {
  path: string;
  filename: string;
  content: string | null;
}

/**
 * Advisory stats issue that should be shown but must not fail `stats --check`.
 *
 * Warnings are intentionally separate from findings so noisy metadata nudges do not block CI.
 */
interface StatsWarning {
  file: string;
  rule:
    | "decision-metadata"
    | "empty-learning-loop"
    | "index-missing"
    | "memory-quality";
  message: string;
}

/**
 * Decision-record stats section.
 *
 * ADR warnings live here rather than in `StatsCheckReport` so renderers can display the same
 * decision metadata in normal stats output and in `--check` output.
 */
export interface DecisionsSection {
  path: string;
  exists: boolean;
  files: DecisionFileSummary[];
  warnings: StatsWarning[];
}

/**
 * One blocking memory-health problem shown to an operator.
 * Use this row when the project must be repaired before `stats --check` can pass.
 */
interface StatsFinding {
  file: string;
  rule:
    | "missing-last-reviewed"
    | "invalid-last-reviewed"
    | "stale-last-reviewed"
    | "stale-ref"
    | "invalid-line-ref"
    | "evidence-label"
    | "format"
    | "bucket-size"
    | "decision-filename"
    | "decision-structure"
    | "index-stale";
  message: string;
}

/**
 * Pass/fail verdict shown after an operator runs `goat-flow stats --check`.
 * Use findings for blockers and warnings for optional cleanup that can wait.
 */
export interface StatsCheckReport {
  status: "pass" | "fail";
  findings: StatsFinding[];
  warnings: StatsWarning[];
}

/**
 * Facts accepted by the stats checker, including legacy reports without per-entry memory health.
 * Use at the verifier boundary while rendered `StatsReport` output keeps its stable required array.
 */
type StatsCheckInput = Omit<StatsReport, "learningLoopEntries"> & {
  learningLoopEntries?: LearningLoopEntryFact[];
};

/**
 * Summarize one memory directory for the stats screen and command output.
 * Use when users need counts, freshness, references, and recurrence health together.
 */
function buildSection(
  memoryDirectoryFacts: SharedFacts["footguns"] | SharedFacts["lessons"],
  totalInvalidLineRefs: number,
): BucketSection {
  const freshnessBandCounts = { fresh: 0, aging: 0, stale: 0, unknown: 0 };
  // Each bucket contributes to the freshness summary users scan before opening a source file.
  for (const bucket of memoryDirectoryFacts.buckets) {
    freshnessBandCounts[bucket.freshnessBand] += 1;
  }
  return {
    path: memoryDirectoryFacts.path,
    exists: memoryDirectoryFacts.exists,
    totalEntries: memoryDirectoryFacts.entryCount,
    totalStaleRefs: memoryDirectoryFacts.staleRefs.length,
    totalInvalidLineRefs,
    // Recurrence candidates are combined so users see one actionable directory total.
    totalGraduationCandidates: memoryDirectoryFacts.buckets.reduce(
      (graduationCandidateTotal, bucket) =>
        graduationCandidateTotal + bucket.graduationCandidates.length,
      0,
    ),
    bands: freshnessBandCounts,
    buckets: memoryDirectoryFacts.buckets,
    formatDiagnostic: memoryDirectoryFacts.formatDiagnostic,
  };
}

/**
 * Build the full stats report from the learning-loop slice of shared facts.
 *
 * @param shared - selected-project memory facts; omitted optional arrays mean those views show no rows.
 * @returns report for text, JSON, Markdown, and checks; empty entries mean no memory facts were collected.
 */
export function buildStatsReport(shared: {
  footguns: SharedFacts["footguns"];
  lessons: SharedFacts["lessons"];
  learningLoopEntries?: LearningLoopEntryFact[];
  decisions?: DecisionsSection;
  indexes?: IndexFreshness[];
}): StatsReport {
  return {
    footguns: buildSection(
      shared.footguns,
      shared.footguns.invalidLineRefs.length,
    ),
    lessons: buildSection(
      shared.lessons,
      shared.lessons.invalidLineRefs.length,
    ),
    // Older internal callers may omit entry facts; users then receive a stable empty collection.
    learningLoopEntries: shared.learningLoopEntries ?? [],
    // Missing decision facts keep the decision section out of views that did not request it.
    ...(shared.decisions ? { decisions: shared.decisions } : {}),
    // Missing index facts keep index health absent instead of presenting a false empty state.
    ...(shared.indexes ? { indexes: shared.indexes } : {}),
  };
}

/**
 * Read the selected decision directory into the stats report.
 * Use when users request ADR structure checks; an absent directory becomes an empty section.
 *
 * @param projectFiles - selected-project reader; unreadable files remain rows with empty content.
 * @param configuredDecisionPath - configured ADR path; an empty path yields an absent section.
 * @returns decision section for stats checks; empty files mean no ADRs were available to inspect.
 */
export function buildDecisionsSection(
  projectFiles: ReadonlyFS,
  configuredDecisionPath: string,
): DecisionsSection {
  const decisionDirectoryPath = configuredDecisionPath.replace(/\/$/, "");
  const decisionDirectoryExists = projectFiles.exists(decisionDirectoryPath);
  // A missing decisions directory shows no ADR rows while its section records the absent state.
  const decisionFilenames = decisionDirectoryExists
    ? projectFiles.listDir(decisionDirectoryPath).sort()
    : [];
  // Every filename becomes a row so unreadable ADRs still reach the user's structure check.
  const decisionFiles = decisionFilenames.map((decisionFilename) => ({
    filename: decisionFilename,
    path: `${decisionDirectoryPath}/${decisionFilename}`,
    content: projectFiles.readFile(
      `${decisionDirectoryPath}/${decisionFilename}`,
    ),
  }));
  return {
    path: decisionDirectoryPath,
    exists: decisionDirectoryExists,
    files: decisionFiles,
    warnings: [],
  };
}

/**
 * Check whether one bucket's review date can still be trusted by users.
 * Use before deeper checks so missing or stale review dates get a direct repair message.
 */
function checkBucketLastReviewed(
  bucket: BucketSection["buckets"][number],
): StatsFinding | null {
  // Without a valid review date, users cannot tell when the bucket was last verified.
  if (bucket.lastReviewed === null) {
    return {
      file: bucket.path,
      rule: "missing-last-reviewed",
      message: `${bucket.path}: missing or invalid frontmatter last_reviewed (expected YYYY-MM-DD)`,
    };
  }
  // Newer entry dates invalidate the older bucket review date shown to users.
  if (
    bucket.maxEntryDate !== null &&
    bucket.maxEntryDate > bucket.lastReviewed
  ) {
    return {
      file: bucket.path,
      rule: "stale-last-reviewed",
      message: `${bucket.path}: last_reviewed (${bucket.lastReviewed}) is older than the newest entry date (${bucket.maxEntryDate}); bump frontmatter last_reviewed.`,
    };
  }
  return null;
}

/** Shared byte threshold where one learning-loop bucket becomes costly to retrieve. */
export const BUCKET_SIZE_WARN_BYTES = 40_000;

/**
 * Collect every blocking problem for one learning-loop bucket.
 * Use when an operator needs a complete repair list for that source file.
 */
function collectBucketFindings(
  bucket: BucketSection["buckets"][number],
): StatsFinding[] {
  const findings: StatsFinding[] = [];
  const reviewFinding = checkBucketLastReviewed(bucket);
  // A review-date problem is shown alongside the bucket's other actionable defects.
  if (reviewFinding !== null) findings.push(reviewFinding);
  // Oversized buckets make retrieval noisy, so users are asked to split the category.
  if (bucket.sizeBytes > BUCKET_SIZE_WARN_BYTES) {
    const bucketSizeKilobytes = Math.round(bucket.sizeBytes / 1024);
    findings.push({
      file: bucket.path,
      rule: "bucket-size",
      message: `${bucket.path}: ${bucketSizeKilobytes}KB exceeds ${Math.round(BUCKET_SIZE_WARN_BYTES / 1024)}KB threshold; consider splitting into narrower category buckets`,
    });
  }
  // Every stale semantic reference gets its own repair row for the operator.
  for (const staleReference of bucket.staleRefs) {
    findings.push({
      file: bucket.path,
      rule: "stale-ref",
      message: `${bucket.path}: stale file ref ${staleReference}`,
    });
  }
  // Every invalid line reference tells users which brittle evidence must gain a semantic anchor.
  for (const invalidLineReference of bucket.invalidLineRefs) {
    findings.push({
      file: bucket.path,
      rule: "invalid-line-ref",
      message: `${bucket.path}: invalid line ref ${invalidLineReference}`,
    });
  }
  return findings;
}

/**
 * Collect blockers while valid empty buckets stay advisory; reports malformed input as findings, never throws.
 * This split exists because extraction combines diagnostics while users and CI need stable repair rule ids.
 */
function collectFindings(section: BucketSection): StatsFinding[] {
  const findings: StatsFinding[] = [];
  // A missing directory blocks the feedback loop because users have nowhere durable to record memory.
  if (!section.exists) {
    findings.push({
      file: section.path,
      rule: "format",
      message: `${section.path}: directory missing`,
    });
    return findings;
  }
  // Each source bucket contributes its own direct repair findings.
  for (const bucket of section.buckets) {
    findings.push(...collectBucketFindings(bucket));
  }
  // Combined extractor diagnostics are unpacked so users receive stable rule identifiers.
  if (section.formatDiagnostic !== null) {
    const alreadyReported = findings.some(
      (finding) => finding.rule === "missing-last-reviewed",
    );
    // Each diagnostic becomes one repair row unless an equivalent finding already exists.
    for (const diagnosticMessage of section.formatDiagnostic.split("; ")) {
      // Empty fresh directories are valid user states and remain warnings instead of blockers.
      if (isEmptyLearningLoopDiagnostic(diagnosticMessage)) continue;
      // The direct bucket check already explains missing review dates, so duplicate prose is hidden.
      if (
        alreadyReported &&
        /missing frontmatter last_reviewed/.test(diagnosticMessage)
      ) {
        continue;
      }
      // Invalid date syntax gets a dedicated rule so users can find the exact formatting repair.
      if (/invalid last_reviewed format/.test(diagnosticMessage)) {
        findings.push({
          file: section.path,
          rule: "invalid-last-reviewed",
          message: diagnosticMessage,
        });
        continue;
      }
      if (/invalid evidence-label count/.test(diagnosticMessage)) {
        findings.push({
          file: section.path,
          rule: "evidence-label",
          message: diagnosticMessage,
        });
        continue;
      }
      findings.push({
        file: section.path,
        rule: "format",
        message: diagnosticMessage,
      });
    }
  }
  return findings;
}

/**
 * Recognize a valid empty-memory state that should not block a fresh project.
 * Use while splitting extractor diagnostics into user-facing warnings and failures.
 */
function isEmptyLearningLoopDiagnostic(message: string): boolean {
  return (
    message === "Footgun directory exists but contains 0 entries" ||
    message === "Lesson directory exists but contains 0 entries"
  );
}

/**
 * Collect advisory learning-loop warnings for valid empty directories.
 * Use when users need orientation without turning a fresh learning loop into a failure.
 */
function collectWarnings(section: BucketSection): StatsWarning[] {
  // A clean bucket has no format diagnostic, so there is no advisory message to show users.
  if (section.formatDiagnostic === null) return [];
  // Only valid empty-state diagnostics become warnings; other diagnostics remain blocking findings.
  return (
    section.formatDiagnostic
      .split("; ")
      .filter(isEmptyLearningLoopDiagnostic)
      // Each empty directory gets one explicit warning row in text and JSON output.
      .map((message) => ({
        file: section.path,
        rule: "empty-learning-loop",
        message,
      }))
  );
}

const VALID_TRIGGER_PHASES = new Set(["READ", "SCOPE", "ACT", "VERIFY"]);
const MAX_MEMORY_QUALITY_EXAMPLES = 3;

/**
 * Describe malformed supplied metadata for one durable memory.
 * Missing optional fields stay available in JSON instead of producing corpus-wide warnings.
 */
function describeMemoryQualityIssues(entry: LearningLoopEntryFact): string[] {
  const issues: string[] = [];
  // A supplied phase outside the execution loop cannot trigger retrieval at a predictable moment.
  if (
    entry.triggerPhase !== null &&
    !VALID_TRIGGER_PHASES.has(entry.triggerPhase)
  ) {
    issues.push(`invalid Trigger phase "${entry.triggerPhase}"`);
  }
  // A recurrence before creation makes the user's incident chronology internally impossible.
  if (
    entry.latestOccurrence !== null &&
    entry.created !== null &&
    entry.latestOccurrence < entry.created
  ) {
    issues.push(
      `Latest occurrence ${entry.latestOccurrence} predates Created ${entry.created}`,
    );
  }
  return issues;
}

/**
 * Group malformed supplied memory metadata by source bucket with bounded examples.
 * Optional-field migration stays in JSON; warnings identify values users actually supplied incorrectly.
 */
function collectMemoryQualityWarnings(
  learningLoopEntries: LearningLoopEntryFact[],
): StatsWarning[] {
  const candidatesBySource = new Map<
    string,
    Array<{ entry: LearningLoopEntryFact; issues: string[] }>
  >();
  // Only footguns and lessons use the forward-looking incident metadata in this milestone.
  for (const entry of learningLoopEntries) {
    // Patterns and decisions have different authoring contracts, so they are not metadata candidates.
    if (entry.kind !== "footgun" && entry.kind !== "lesson") {
      continue;
    }
    const issues = describeMemoryQualityIssues(entry);
    // Complete entries add no user work and stay out of the advisory warning list.
    if (issues.length === 0) {
      continue;
    }
    // The first issue in a bucket starts its bounded candidate collection.
    const sourceCandidates = candidatesBySource.get(entry.sourcePath) ?? [];
    sourceCandidates.push({ entry, issues });
    candidatesBySource.set(entry.sourcePath, sourceCandidates);
  }

  // Stable path ordering keeps CLI and dashboard warning rows reproducible for users.
  return Array.from(candidatesBySource.entries())
    .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
    .map(([sourcePath, candidates]) => {
      const boundedCandidates = candidates.slice(
        0,
        MAX_MEMORY_QUALITY_EXAMPLES,
      );
      // Each example names the memory and all metadata work visible for that entry.
      const candidateExamples = boundedCandidates.map(
        ({ entry, issues }) => `${entry.title} (${issues.join("; ")})`,
      );
      const omittedCandidateCount =
        candidates.length - boundedCandidates.length;
      // Extra candidates remain available in JSON without making the warning unreadably long.
      const omittedSuffix =
        omittedCandidateCount > 0
          ? `; +${omittedCandidateCount} more in learningLoopEntries`
          : "";
      // Singular wording keeps one-entry buckets natural in the user-facing CLI output.
      const issueLabel = candidates.length === 1 ? "issue" : "issues";
      return {
        file: sourcePath,
        rule: "memory-quality" as const,
        message: `${sourcePath}: ${candidates.length} metadata ${issueLabel}: ${candidateExamples.join("; ")}${omittedSuffix}`,
      };
    });
}

const ADR_FILENAME = /^ADR-\d{3}-[a-z0-9-]+\.md$/;
const ROUTING_HINT =
  "Wrong home -> right home: implementation TODOs and scoped work plans belong in .goat-flow/plans/; recurring hazards with evidence belong in .goat-flow/learning-loop/footguns/; reusable takeaways belong in .goat-flow/learning-loop/lessons/; temporary notes belong in .goat-flow/scratchpad/; backlog requests belong in Linear/GitHub issues.";

/**
 * Detect one required ADR section without matching prose mentions.
 * Use when operators validate decision structure after adding or editing an ADR.
 */
function hasHeading(content: string, heading: string): boolean {
  return new RegExp(`^##\\s+${heading}\\b`, "m").test(content);
}

/**
 * Explain how an incorrectly named decision file should be routed or renamed.
 * Use when an operator placed durable work in the decisions directory under the wrong shape.
 */
function decisionFilenameFinding(
  decisionFile: DecisionFileSummary,
): StatsFinding {
  return {
    file: decisionFile.path,
    rule: "decision-filename",
    message: `${decisionFile.path}: decision records must be named ADR-NNN-kebab-case-title.md. ${ROUTING_HINT}`,
  };
}

/**
 * Accept the supported trade-off section variants used by existing ADRs.
 * Use during validation so operators avoid churn-only rewrites of valid decisions.
 */
function hasDecisionTradeoffSection(content: string): boolean {
  return (
    hasHeading(content, "Consequences") ||
    hasHeading(content, "Failure Mode Comparison") ||
    hasHeading(content, "Reversibility")
  );
}

/**
 * List required ADR sections absent from one decision record.
 * Use to give operators one complete structural repair message instead of repeated failures.
 */
function missingDecisionStructure(content: string): string[] {
  const missingSections: string[] = [];
  // Without status, users cannot tell whether the decision is proposed, accepted, or retired.
  if (!/^\*\*Status:\*\*/m.test(content)) missingSections.push("**Status:**");
  // Without a date, users cannot place the decision in the project's chronology.
  if (!/^\*\*Date:\*\*/m.test(content)) missingSections.push("**Date:**");
  // Context tells future users what forces made the decision necessary.
  if (!hasHeading(content, "Context")) missingSections.push("## Context");
  // The decision section tells users which option the project actually chose.
  if (!hasHeading(content, "Decision")) missingSections.push("## Decision");
  // At least one trade-off section explains the consequences users inherit.
  if (!hasDecisionTradeoffSection(content)) {
    missingSections.push(
      "## Consequences or ## Failure Mode Comparison or ## Reversibility",
    );
  }
  return missingSections;
}

/**
 * Build one actionable finding from an ADR's missing sections.
 * Use when users need the malformed file and all required repairs in one message.
 */
function decisionStructureFinding(
  decisionFile: DecisionFileSummary,
  missingSections: string[],
): StatsFinding {
  return {
    file: decisionFile.path,
    rule: "decision-structure",
    message: `${decisionFile.path}: malformed ADR is missing ${missingSections.join(", ")}. ${ROUTING_HINT}`,
  };
}

/**
 * Validate one decision-directory file and return its first blocking problem.
 * Use when users run stats checks; valid ADRs and known meta files return no finding.
 */
function collectDecisionFileFinding(
  decisionFile: DecisionFileSummary,
): StatsFinding | null {
  // README and INDEX files are support surfaces, so users should not rename them as ADRs.
  if (DECISION_META_FILES.has(decisionFile.filename)) return null;
  // A non-canonical filename gets routing help before deeper structure checks run.
  if (!ADR_FILENAME.test(decisionFile.filename)) {
    return decisionFilenameFinding(decisionFile);
  }

  // An unreadable decision has no usable structure, so validation treats its content as empty.
  const decisionContent = decisionFile.content ?? "";
  const missingSections = missingDecisionStructure(decisionContent);
  // Complete ADRs produce no row; malformed ADRs show one combined repair finding.
  return missingSections.length > 0
    ? decisionStructureFinding(decisionFile, missingSections)
    : null;
}

/**
 * Collect structural ADR findings while ignoring support files.
 * Use when users request decision health; an absent directory is handled by setup checks.
 */
function collectDecisionFindings(section: DecisionsSection): StatsFinding[] {
  // A caller that did not provide a decision directory has no ADR rows to validate here.
  if (!section.exists) return [];
  // Valid files add no row, while each malformed file contributes one actionable finding.
  return section.files.flatMap((decisionFile) => {
    const decisionFinding = collectDecisionFileFinding(decisionFile);
    // A valid ADR contributes no repair row to the user's result list.
    return decisionFinding === null ? [] : [decisionFinding];
  });
}

/**
 * Map stale generated indexes to blocking repair findings.
 * Use when users need to know which INDEX file must be regenerated before checks pass.
 */
function collectIndexFindings(indexes: IndexFreshness[]): StatsFinding[] {
  // Only stale indexes block users; fresh and not-yet-generated states take different paths.
  return (
    indexes
      .filter((indexStatus) => indexStatus.state === "stale")
      // Each stale index receives its own copyable regeneration instruction.
      .map((indexStatus) => ({
        file: indexStatus.indexPath,
        rule: "index-stale" as const,
        message: `${indexStatus.indexPath}: generated index is stale; re-run \`goat-flow index\``,
      }))
  );
}

/**
 * Map absent generated indexes to advisory setup warnings.
 * Use so fresh installs guide users toward generation without reporting a false failure.
 */
function collectIndexWarnings(indexes: IndexFreshness[]): StatsWarning[] {
  // Missing indexes are valid on fresh installs and remain advisory for users.
  return (
    indexes
      .filter((indexStatus) => indexStatus.state === "missing")
      // Each absent index receives one copyable generation instruction.
      .map((indexStatus) => ({
        file: indexStatus.indexPath,
        rule: "index-missing" as const,
        message: `${indexStatus.indexPath}: INDEX.md not generated yet; run \`goat-flow index\``,
      }))
  );
}

/**
 * Run the `--check` verdict against an already-built stats report.
 *
 * @param report - rendered memory facts; an absent legacy entry collection preserves earlier checks.
 * @returns verdict with blockers and warnings; empty findings means the operator may proceed.
 */
export function checkStats(report: StatsCheckInput): StatsCheckReport {
  // Omitted decision facts mean this caller did not request ADR validation.
  const decisionFindings = report.decisions
    ? collectDecisionFindings(report.decisions)
    : [];
  // Omitted index facts mean this caller did not request index freshness validation.
  const indexFindings = report.indexes
    ? collectIndexFindings(report.indexes)
    : [];
  // Hard integrity defects combine into the blocking list that controls the user's exit status.
  const findings = [
    ...collectFindings(report.footguns),
    ...collectFindings(report.lessons),
    ...decisionFindings,
    ...indexFindings,
  ];
  // A report without decision warnings keeps the advisory list focused on collected surfaces.
  const decisionWarnings = report.decisions?.warnings ?? [];
  // Omitted index facts contribute no warnings instead of implying indexes are healthy.
  const indexWarnings = report.indexes
    ? collectIndexWarnings(report.indexes)
    : [];
  // Older direct callers may omit entry facts, so users still get legacy checks instead of a crash.
  const learningLoopEntries = report.learningLoopEntries ?? [];
  // Advisory states combine separately so cleanup guidance never changes a passing exit status.
  const warnings = [
    ...collectWarnings(report.footguns),
    ...collectWarnings(report.lessons),
    ...collectMemoryQualityWarnings(learningLoopEntries),
    ...decisionWarnings,
    ...indexWarnings,
  ];
  // No blocking findings means the user receives a passing verdict even when warnings remain.
  const status = findings.length === 0 ? "pass" : "fail";
  return {
    status,
    findings,
    warnings,
  };
}
