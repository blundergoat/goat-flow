/**
 * Selects past project incidents for setup, quality, and maintenance prompts.
 * Use when a CLI or dashboard user requests a prompt that should carry relevant prior learning.
 *
 * - Active footguns with a working anchor come first, then lessons, patterns, and decisions.
 * - Each kind has its own byte and entry cap, so one noisy bucket cannot crowd out the rest.
 * - Entries are dropped from the end until the rendered block fits the surface budget.
 *
 * Selection stays read-only; `goat-flow stats --check` owns freshness and stale-reference validation.
 */
import type {
  LearningLoopEntryFact,
  LearningLoopEntryKind,
  SharedFacts,
} from "../types.js";

type LearningLoopContextSurface =
  | "quality-agent-setup"
  | "quality-harness"
  | "quality-process"
  | "setup"
  | "maintenance";

/** Per-kind caps keep one noisy learning-loop bucket from consuming the prompt. */
interface KindBudget {
  maxBytes: number;
  maxEntries: number;
}

/** Caller-tunable selection policy for a prompt surface. */
export interface LearningLoopContextOptions {
  surface?: LearningLoopContextSurface;
  maxBytes?: number;
  perEntryMaxBytes?: number;
  includeStale?: boolean;
  includeDecisions?: boolean;
  includeOversized?: boolean;
  /** Concrete audit checks, affected paths, tools, or failure classes used only for this selection. */
  taskSignals?: readonly string[];
  perKind?: Partial<Record<LearningLoopEntryKind, Partial<KindBudget>>>;
}

/** Entry excerpt selected for the compact prompt block. */
interface SelectedLearningLoopEntry {
  sourcePath: string;
  kind: LearningLoopEntryKind;
  title: string;
  reasonSelected: string;
  excerpt: string;
  staleRefs: string[];
  invalidLineRefs: string[];
  matchedTaskTerms?: string[];
}

/**
 * Prompt-ready learning entries and the accounting shown to CLI or dashboard users.
 * The rendering contract keeps this invariant after finalization: `selectedCount` equals `entries.length`, and `budgetUsed` describes the same block
 * without exceeding `budgetMax`.
 */
export interface LearningLoopContextSelection {
  entries: SelectedLearningLoopEntry[];
  budgetUsed: number;
  budgetMax: number;
  selectedCount: number;
  omittedCount: number;
  /** True when the project supplied no eligible learning entry, so the generated prompt omits the learning-loop block. */
  zeroHit: boolean;
  /** Selected entries with at least one direct lexical task match; absent when targeting was not requested. */
  taskMatchedCount?: number;
  /** True when normalized task terms matched no eligible entry and baseline ranking supplied the fallback. */
  isTaskZeroHit?: boolean;
}

/** Options after surface defaults and per-kind overrides have been applied. */
interface ResolvedLearningLoopOptions {
  includeStale: boolean;
  includeDecisions: boolean;
  includeOversized: boolean;
  budgetMax: number;
  perEntryMaxBytes: number;
  kindBudgets: Record<LearningLoopEntryKind, KindBudget>;
  taskTerms: string[];
}

/** One entry's deterministic lexical overlap with the ephemeral task terms. */
interface TaskMatch {
  score: number;
  terms: string[];
}

const DEFAULT_KIND_BUDGETS: Record<LearningLoopEntryKind, KindBudget> = {
  footgun: { maxBytes: 1_100, maxEntries: 3 },
  lesson: { maxBytes: 700, maxEntries: 2 },
  pattern: { maxBytes: 420, maxEntries: 1 },
  decision: { maxBytes: 420, maxEntries: 1 },
};

const KIND_RANK: Record<LearningLoopEntryKind, number> = {
  footgun: 0,
  lesson: 1,
  pattern: 2,
  decision: 3,
};

/** Generic prompt-routing vocabulary is not concrete enough to make one memory relevant. */
const TASK_TERM_STOPWORDS = new Set([
  "agent",
  "agents",
  "and",
  "are",
  "but",
  "did",
  "does",
  "for",
  "flow",
  "from",
  "goat",
  "has",
  "have",
  "harness",
  "into",
  "its",
  "mode",
  "must",
  "not",
  "only",
  "path",
  "project",
  "quality",
  "rerun",
  "setup",
  "the",
  "this",
  "was",
  "were",
  "with",
]);

const OVERSIZED_BUCKET_BYTES = 40_000;

/**
 * Measure budget in UTF-8 bytes so the cap matches what the agent actually receives rather than a character count.
 *
 * @param content - rendered prompt text or excerpt; an empty string measures zero
 * @returns byte length of the encoded text
 */
function utf8ByteLength(content: string): number {
  return Buffer.byteLength(content, "utf8");
}

/**
 * Trim an excerpt to fit its cap without cutting a multibyte character in half and leaving mojibake in the prompt.
 *
 * @param content - excerpt text to shorten
 * @param maxBytes - cap including the trailing ellipsis
 * @returns the original text when it already fits, otherwise a shortened copy ending in an ellipsis
 */
function truncateToUtf8ByteLimit(content: string, maxBytes: number): string {
  // Already inside the cap, so the reader gets the full excerpt with no ellipsis.
  if (utf8ByteLength(content) <= maxBytes) return content;
  let truncatedText = "";
  // Add one visible character at a time so a user never receives broken Unicode in a generated prompt.
  for (const char of content) {
    const textWithNextCharacter = truncatedText + char;
    // Stop at the last character that still leaves room for the ellipsis, so the cap is never exceeded mid-character.
    if (utf8ByteLength(textWithNextCharacter + "...") > maxBytes) break;
    truncatedText = textWithNextCharacter;
  }
  return `${truncatedText.trimEnd()}...`;
}

/**
 * Read the date that decides recency, preferring the revision date so a freshly re-verified incident outranks an old original write-up.
 *
 * @param entry - learning-loop entry from extracted facts
 * @returns an ISO date string, or empty when the entry carries neither date and therefore sorts last
 */
function learningEntryDate(entry: LearningLoopEntryFact): string {
  // An undated entry returns an empty sort key, which places it behind dated evidence in the user's prompt.
  return entry.updated ?? entry.created ?? "";
}

/**
 * Whether an entry points at files or lines that no longer resolve, which makes it maintenance evidence rather than trustworthy guidance.
 *
 * @param entry - learning-loop entry from extracted facts
 * @returns true when any reference is stale or invalid, which keeps the entry out of every surface except maintenance
 */
function isStaleOrInvalid(entry: LearningLoopEntryFact): boolean {
  // Any broken reference makes the entry maintenance-only rather than evidence a reviewer can safely follow.
  return entry.staleRefs.length > 0 || entry.invalidLineRefs.length > 0;
}

/**
 * Fold a caller's per-kind overrides onto the shipped caps, so a surface can widen one bucket without restating the others.
 *
 * @param overrides - partial caps supplied by the caller; `undefined` keeps every shipped default
 * @returns a complete cap for all four entry kinds
 */
function mergeKindBudgets(
  overrides: LearningLoopContextOptions["perKind"],
): Record<LearningLoopEntryKind, KindBudget> {
  // Missing bucket overrides keep the shipped limits, so callers only specify the prompt space they want to change.
  return {
    footgun: { ...DEFAULT_KIND_BUDGETS.footgun, ...overrides?.footgun },
    lesson: { ...DEFAULT_KIND_BUDGETS.lesson, ...overrides?.lesson },
    pattern: { ...DEFAULT_KIND_BUDGETS.pattern, ...overrides?.pattern },
    decision: { ...DEFAULT_KIND_BUDGETS.decision, ...overrides?.decision },
  };
}

/**
 * Size the whole context block for the prompt the user asked for, since a maintenance pass needs more evidence than a setup walkthrough.
 *
 * @param surface - prompt this block is being built for
 * @returns the byte ceiling for the rendered block
 */
function defaultPromptBudgetBytes(surface: LearningLoopContextSurface): number {
  // Maintenance work is where stale entries get repaired, so that prompt carries the most evidence.
  if (surface === "maintenance") return 3_200;
  // Process assessments reason about the loop itself and need more than a setup prompt does.
  if (surface === "quality-process") return 2_600;
  return 2_200;
}

/**
 * Include accepted decisions by default so setup and quality users receive the policy behind current behavior.
 *
 * @returns true; callers can still opt out for an incident-only prompt
 */
function shouldIncludeDecisionEntriesByDefault(): boolean {
  return true;
}

/**
 * Whether entries from an over-large bucket may be quoted, which only helps on the prompts that are judging bucket health in the first place.
 *
 * @param surface - prompt this block is being built for
 * @returns true for quality and maintenance prompts, false where an oversized bucket would just be noise
 */
function shouldIncludeOversizedBuckets(
  surface: LearningLoopContextSurface,
): boolean {
  return surface.startsWith("quality-") || surface === "maintenance";
}

/**
 * Settle every caller option against the surface defaults once, so the selection pass reads plain values instead of re-deriving fallbacks.
 *
 * @param options - caller overrides; an empty object resolves to the quality-agent-setup defaults
 * @returns fully resolved caps and inclusion flags
 */
function resolveLearningLoopOptions(
  options: LearningLoopContextOptions,
): ResolvedLearningLoopOptions {
  // A caller that omits the surface receives the agent-setup limits used by the default Quality launch.
  const surface = options.surface ?? "quality-agent-setup";
  // Unspecified values inherit the selected surface policy, giving a UI launch the same limits as the matching CLI command.
  return {
    includeStale: options.includeStale ?? surface === "maintenance",
    includeDecisions:
      options.includeDecisions ?? shouldIncludeDecisionEntriesByDefault(),
    includeOversized:
      options.includeOversized ?? shouldIncludeOversizedBuckets(surface),
    budgetMax: options.maxBytes ?? defaultPromptBudgetBytes(surface),
    perEntryMaxBytes: options.perEntryMaxBytes ?? 360,
    kindBudgets: mergeKindBudgets(options.perKind),
    taskTerms: normalizeTaskTerms(options.taskSignals),
  };
}

/**
 * Reduce caller-owned task signals to stable lexical terms without retaining the source prose.
 *
 * Generic mode labels are dropped because they describe the prompt, not the work. The remaining terms preserve first-seen order so reasons are
 * deterministic and readable.
 *
 * @param signals - ephemeral check IDs, paths, tools, or failure-class phrases
 * @returns unique lowercase terms; empty means the selector must use its original ranking and output
 */
function normalizeTaskTerms(signals: readonly string[] | undefined): string[] {
  const normalizedTerms = new Set<string>();
  // A launch with no audit-owned signals keeps the original ranking and contributes no stored task text.
  for (const signal of signals ?? []) {
    // Split each check, path, or failure message into stable words that can be compared with recorded incidents.
    for (const token of signal
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []) {
      // Short and generic words do not identify the user's failed check, file, tool, or symptom.
      if (token.length < 3 || TASK_TERM_STOPWORDS.has(token)) continue;
      normalizedTerms.add(token);
    }
  }
  return [...normalizedTerms];
}

/**
 * Find the exact task words shared by one incident and the user's current audit evidence.
 * Use during prompt selection to explain why a prior incident was shown.
 *
 * @param entry - eligible learning-loop incident being considered for the user's prompt
 * @param taskTerms - normalized audit terms; empty means this entry receives a zero match score
 * @returns the matched terms and their count; terms is empty when this incident does not overlap the audit
 */
function findTaskTermMatch(
  entry: LearningLoopEntryFact,
  taskTerms: readonly string[],
): TaskMatch {
  const entryTerms = new Set(
    normalizeTaskTerms([
      entry.title,
      entry.heading,
      entry.sourcePath,
      entry.excerpt,
    ]),
  );
  const matchedTerms = taskTerms.filter((term) => entryTerms.has(term));
  return { score: matchedTerms.length, terms: matchedTerms };
}

/**
 * Say in one phrase why this entry earned prompt space, so the reading agent can weigh it instead of treating every bullet the same.
 *
 * @param entry - learning-loop entry chosen for the block
 * @returns the short reason rendered after the entry title; never empty
 */
function describeSelectionReason(entry: LearningLoopEntryFact): string {
  // Only maintenance surfaces admit broken entries, so saying so warns the reader not to trust the anchor.
  if (isStaleOrInvalid(entry)) {
    return "surfaced for learning-loop maintenance despite stale or invalid refs";
  }
  // A footgun whose anchor still resolves is the strongest evidence available, and the reason line says so.
  if (entry.kind === "footgun" && entry.hasValidAnchor) {
    return "active footgun with valid semantic anchor";
  }
  // An unanchored active footgun still warns the reviewer, but without claiming a verified source location.
  if (entry.kind === "footgun") return "active footgun";
  // A lesson gives the reviewer recent project experience after higher-risk footguns have been considered.
  if (entry.kind === "lesson") return "recent lesson";
  // A pattern offers reusable guidance only after the incident-focused prompt space has been protected.
  if (entry.kind === "pattern") return "reusable pattern within cap";
  // The remaining decision entry gives setup and policy reviewers the accepted rule behind the current design.
  return "decision included for setup or policy context";
}

/**
 * Score an entry so scarce prompt space goes to durable warnings first and broken entries last.
 *
 * @param entry - learning-loop entry being ordered
 * @returns a sort key where lower wins; stale entries take a fixed penalty that pushes them behind every healthy one
 */
function learningEntryPriority(entry: LearningLoopEntryFact): number {
  // Stale evidence sorts behind every healthy entry, so ordinary users see guidance they can still follow.
  const staleOffset = isStaleOrInvalid(entry) ? 10 : 0;
  // A verified footgun anchor removes the secondary penalty because it gives the reviewer a direct place to inspect.
  const anchorBoost = entry.kind === "footgun" && entry.hasValidAnchor ? 0 : 1;
  return staleOffset + KIND_RANK[entry.kind] * 2 + anchorBoost;
}

/**
 * Compare direct task overlap and recurrence inside one already-safe kind and health tier.
 *
 * @param left - first entry in the comparison
 * @param right - second entry in the comparison
 * @param taskMatches - optional task overlap by entry; absent preserves the baseline order
 * @returns the task or recurrence difference, or zero when the existing fallbacks must decide
 */
function compareTaskEvidence(
  left: LearningLoopEntryFact,
  right: LearningLoopEntryFact,
  taskMatches?: ReadonlyMap<LearningLoopEntryFact, TaskMatch>,
): number {
  // A launch without task evidence keeps the original recency and path ordering byte-for-byte.
  if (!taskMatches) return 0;
  // An entry missing from the optional score map behaves as unmatched rather than disappearing.
  const taskMatchDifference =
    (taskMatches.get(right)?.score ?? 0) - (taskMatches.get(left)?.score ?? 0);
  // Direct overlap wins inside the existing kind and health tier.
  if (taskMatchDifference !== 0) return taskMatchDifference;
  // Missing incident counts mean zero recurrences, so older entries stay eligible without overstatement.
  return (right.incidentCount ?? 0) - (left.incidentCount ?? 0);
}

/**
 * Order candidates by usefulness, then recency, then path, so the same project facts always produce the same prompt block.
 *
 * @param left - first entry in the comparison
 * @param right - second entry in the comparison
 * @param taskMatches - optional task overlap by entry; absent preserves the original non-targeted order
 * @returns a negative, zero, or positive sort result; the path and order tiebreaks keep the contract deterministic
 */
function compareEntries(
  left: LearningLoopEntryFact,
  right: LearningLoopEntryFact,
  taskMatches?: ReadonlyMap<LearningLoopEntryFact, TaskMatch>,
): number {
  const priorityDifference =
    learningEntryPriority(left) - learningEntryPriority(right);
  // Kind and health decide first: a footgun outranks a pattern regardless of when either was written.
  if (priorityDifference !== 0) return priorityDifference;
  const taskEvidenceDifference = compareTaskEvidence(left, right, taskMatches);
  // Direct task overlap and then recurrence decide before the existing recency and path fallbacks.
  if (taskEvidenceDifference !== 0) return taskEvidenceDifference;
  const dateDifference = learningEntryDate(right).localeCompare(
    learningEntryDate(left),
  );
  // Same rank, so the more recently revised incident goes first.
  if (dateDifference !== 0) return dateDifference;
  const pathDifference = left.sourcePath.localeCompare(right.sourcePath);
  // Path then declaration order break the remaining ties, so two runs over unchanged facts render identical prompts.
  if (pathDifference !== 0) return pathDifference;
  return left.order - right.order;
}

/**
 * Decide whether one entry may appear on this surface at all, before any budget arithmetic runs.
 *
 * @param entry - learning-loop entry from extracted facts
 * @param options - resolved inclusion flags for the surface being rendered
 * @returns true when the entry is eligible; false silently drops it from the candidate list
 */
function isLearningEntryAllowed(
  entry: LearningLoopEntryFact,
  options: Required<
    Pick<
      LearningLoopContextOptions,
      "includeStale" | "includeDecisions" | "includeOversized"
    >
  >,
): boolean {
  // Bucket READMEs explain the folder rather than record an incident, so they never count as evidence.
  if (entry.sourcePath.endsWith("/README.md")) return false;
  // Decisions are policy context, and a surface can turn them off when the reader only needs incidents.
  if (entry.kind === "decision" && !options.includeDecisions) return false;
  // A resolved footgun describes behaviour the project already fixed, so quoting it would mislead the reader.
  if (entry.kind === "footgun" && entry.status !== "active") return false;
  // Broken references only help someone repairing the loop; every other surface leaves them out.
  if (!options.includeStale && isStaleOrInvalid(entry)) return false;
  // An over-large bucket is itself the problem to report, so ordinary prompts skip its entries.
  if (
    !options.includeOversized &&
    entry.bucketSizeBytes > OVERSIZED_BUCKET_BYTES
  ) {
    return false;
  }
  return true;
}

/**
 * Report how many references are broken without pasting every path, keeping a maintenance bullet short enough to scan.
 *
 * @param entry - excerpt already selected for the block
 * @returns a leading-space flag fragment, or an empty string when every reference resolves
 */
function renderBrokenReferenceFlags(entry: SelectedLearningLoopEntry): string {
  // Empty reference lists add no warning; maintenance users only see counts for broken paths that need attention.
  const brokenReferenceFlags = [
    entry.staleRefs.length > 0 ? `stale refs: ${entry.staleRefs.length}` : "",
    entry.invalidLineRefs.length > 0
      ? `invalid refs: ${entry.invalidLineRefs.length}`
      : "",
  ].filter(Boolean);
  return brokenReferenceFlags.length === 0
    ? ""
    : ` Flags: ${brokenReferenceFlags.join(", ")}.`;
}

/**
 * Render one excerpt as a single bullet: kind, title, source path, why it was picked, any flags, then the excerpt itself.
 *
 * @param entry - excerpt already selected for the block
 * @returns one prompt line; never empty
 */
function renderEntry(entry: SelectedLearningLoopEntry): string {
  return `- [${entry.kind}] ${entry.title} (\`${entry.sourcePath}\`) - ${entry.reasonSelected}.${renderBrokenReferenceFlags(entry)} ${entry.excerpt}`;
}

/**
 * Copy an eligible entry into the compact shape the block renders, trimming its excerpt to the per-entry cap.
 *
 * @param entry - eligible learning-loop entry
 * @param maxExcerptBytes - per-entry excerpt cap for this surface
 * @param taskMatch - optional lexical overlap; absent means the prompt shows no task-match reason
 * @returns the prompt-ready excerpt; reference lists are copied so later edits cannot reach back into the facts
 */
function buildSelectedLearningEntry(
  entry: LearningLoopEntryFact,
  maxExcerptBytes: number,
  taskMatch?: TaskMatch,
): SelectedLearningLoopEntry {
  // An untargeted or unmatched entry carries no task terms, preserving the original prompt wording.
  const matchedTaskTerms = taskMatch?.terms ?? [];
  // A direct match is named in the prompt so the reviewing agent can understand why the user was shown this incident.
  const taskMatchReasonSuffix =
    matchedTaskTerms.length > 0
      ? `; task match: ${matchedTaskTerms.join(", ")}`
      : "";
  return {
    sourcePath: entry.sourcePath,
    kind: entry.kind,
    title: entry.title,
    reasonSelected: `${describeSelectionReason(entry)}${taskMatchReasonSuffix}`,
    excerpt: truncateToUtf8ByteLimit(entry.excerpt, maxExcerptBytes),
    staleRefs: [...entry.staleRefs],
    invalidLineRefs: [...entry.invalidLineRefs],
    ...(matchedTaskTerms.length > 0 ? { matchedTaskTerms } : {}),
  };
}

/**
 * Settle the reported byte count and drop trailing entries until the rendered block fits, so the stated budget matches what ships.
 *
 * @param entries - excerpts chosen so far, in render order
 * @param budgetMax - byte ceiling for the whole rendered block
 * @param omittedCount - entries already left out, carried forward into the block header
 * @param isRetrievalMiss - true when nothing matched at all, which the header reports as an explicit retrieval miss
 * @param isTaskZeroHit - optional targeted-retrieval result; absent means the user did not launch a targeted selection
 * @returns the final selection whose header numbers describe the block it appears in
 */
function finalizeSelection(
  entries: SelectedLearningLoopEntry[],
  budgetMax: number,
  omittedCount: number,
  isRetrievalMiss: boolean,
  isTaskZeroHit?: boolean,
): LearningLoopContextSelection {
  let selection: LearningLoopContextSelection = {
    entries,
    budgetUsed: 0,
    budgetMax,
    selectedCount: entries.length,
    omittedCount,
    zeroHit: isRetrievalMiss,
    ...(isTaskZeroHit === undefined
      ? {}
      : {
          // A selected entry without matched terms still counts toward the bounded fallback, not the targeted-match total.
          taskMatchedCount: entries.filter(
            (entry) => (entry.matchedTaskTerms?.length ?? 0) > 0,
          ).length,
          isTaskZeroHit,
        }),
  };
  // The header prints the used-byte count, so writing that number changes the block length; three passes settle it.
  for (let budgetSettlePass = 0; budgetSettlePass < 3; budgetSettlePass++) {
    selection = {
      ...selection,
      budgetUsed: utf8ByteLength(renderLearningLoopContext(selection)),
    };
  }
  // Still over the ceiling, so the lowest-ranked entry is dropped and the count re-settled until the block fits.
  while (
    selection.entries.length > 0 &&
    utf8ByteLength(renderLearningLoopContext(selection)) > budgetMax
  ) {
    selection = finalizeSelection(
      selection.entries.slice(0, -1),
      budgetMax,
      omittedCount + 1,
      isRetrievalMiss,
      isTaskZeroHit,
    );
  }
  return selection;
}

/**
 * Select deterministic, size-bounded learning-loop context from shared facts.
 *
 * @param sharedFacts - extracted project facts; a project with no learning loop yields an empty selection flagged as a retrieval miss
 * @param options - surface caps and inclusion overrides; an empty object uses the quality-agent-setup defaults
 * @returns the chosen excerpts plus the counts the rendered header reports
 */
export function selectLearningLoopContext(
  sharedFacts: Pick<SharedFacts, "learningLoopEntries">,
  options: LearningLoopContextOptions = {},
): LearningLoopContextSelection {
  const selectionOptions = resolveLearningLoopOptions(options);
  const sourceEntries = sharedFacts.learningLoopEntries;
  const eligibleEntries = sourceEntries.filter((entry) =>
    isLearningEntryAllowed(entry, {
      includeStale: selectionOptions.includeStale,
      includeDecisions: selectionOptions.includeDecisions,
      includeOversized: selectionOptions.includeOversized,
    }),
  );
  const taskMatchByEntry = new Map(
    eligibleEntries.map((entry) => [
      entry,
      findTaskTermMatch(entry, selectionOptions.taskTerms),
    ]),
  );
  const hasAnyTaskMatch = [...taskMatchByEntry.values()].some(
    (match) => match.score > 0,
  );
  // A complete miss uses the original comparator, so targeting cannot perturb the fallback.
  eligibleEntries.sort((left, right) =>
    compareEntries(left, right, hasAnyTaskMatch ? taskMatchByEntry : undefined),
  );
  const selectedBytesByKind: Record<LearningLoopEntryKind, number> = {
    footgun: 0,
    lesson: 0,
    pattern: 0,
    decision: 0,
  };
  const selectedCountByKind: Record<LearningLoopEntryKind, number> = {
    footgun: 0,
    lesson: 0,
    pattern: 0,
    decision: 0,
  };
  const selectedEntries: SelectedLearningLoopEntry[] = [];

  // Walk the ranked candidates once, taking each until its kind runs out of entries or bytes.
  for (const candidate of eligibleEntries) {
    const kindBudget = selectionOptions.kindBudgets[candidate.kind];
    // This kind has already filled its slots, so the entry is skipped and a lower-ranked kind keeps its share.
    if (selectedCountByKind[candidate.kind] >= kindBudget.maxEntries) continue;
    const selectedEntry = buildSelectedLearningEntry(
      candidate,
      selectionOptions.perEntryMaxBytes,
      hasAnyTaskMatch ? taskMatchByEntry.get(candidate) : undefined,
    );
    const selectedEntryBytes = utf8ByteLength(renderEntry(selectedEntry));
    // A long excerpt that would blow the kind's byte cap is skipped rather than truncated further.
    if (
      selectedBytesByKind[candidate.kind] + selectedEntryBytes >
      kindBudget.maxBytes
    ) {
      continue;
    }
    selectedEntries.push(selectedEntry);
    selectedCountByKind[candidate.kind]++;
    selectedBytesByKind[candidate.kind] += selectedEntryBytes;
  }

  // Targeted accounting is absent for an ordinary launch and explicitly marks a zero-hit when audit terms found nothing.
  const isTaskZeroHit =
    selectionOptions.taskTerms.length > 0 ? !hasAnyTaskMatch : undefined;
  // When no project entry is eligible, the caller receives an explicit retrieval miss and renders no empty learning section.
  const isRetrievalMiss = eligibleEntries.length === 0;
  return finalizeSelection(
    selectedEntries,
    selectionOptions.budgetMax,
    sourceEntries.length - selectedEntries.length,
    isRetrievalMiss,
    isTaskZeroHit,
  );
}

/**
 * Render the selected entries as a compact prompt block.
 *
 * @param selection - selection returned by `selectLearningLoopContext`
 * @returns the tagged block, or an empty string when nothing was selected so the caller adds no heading at all
 */
export function renderLearningLoopContext(
  selection: LearningLoopContextSelection,
): string {
  // Nothing survived selection, so the prompt gets no learning-loop section rather than an empty one.
  if (selection.entries.length === 0) return "";
  // Untargeted prompts keep the original wrapper; targeted prompts show both useful matches and an honest zero-hit.
  const taskAccounting =
    selection.isTaskZeroHit === undefined
      ? ""
      : ` task_matches="${selection.taskMatchedCount ?? 0}" task_zero_hit="${selection.isTaskZeroHit}"`;
  return [
    `<goat-learning-loop budget="${selection.budgetMax} bytes" used="${selection.budgetUsed} bytes" selected="${selection.selectedCount}" omitted="${selection.omittedCount}"${taskAccounting}>`,
    "Curated learning-loop context only. Full freshness/stale-ref enforcement remains owned by `goat-flow stats --check`.",
    ...selection.entries.map(renderEntry),
    "</goat-learning-loop>",
  ].join("\n");
}
