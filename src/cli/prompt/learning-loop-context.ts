/**
 * Picks the handful of past incidents worth pasting into a generated prompt, so the next agent starts with the traps this project already hit.
 *
 * The user asked for a setup, quality, or maintenance prompt; this module decides which learning-loop entries ride along inside it:
 *
 * - Active footguns with a working anchor come first, then lessons, patterns, and decisions.
 * - Each kind has its own byte and entry cap, so one noisy bucket cannot crowd out the rest.
 * - Entries are dropped from the end until the rendered block fits the surface budget.
 *
 * Full freshness and stale-reference enforcement stays with `goat-flow stats --check`; nothing here validates the loop.
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
}

/** Final selection plus accounting metadata embedded in the prompt wrapper. */
export interface LearningLoopContextSelection {
  entries: SelectedLearningLoopEntry[];
  budgetUsed: number;
  budgetMax: number;
  selectedCount: number;
  omittedCount: number;
  zeroHit: boolean;
}

/** Options after surface defaults and per-kind overrides have been applied. */
interface ResolvedLearningLoopOptions {
  includeStale: boolean;
  includeDecisions: boolean;
  includeOversized: boolean;
  budgetMax: number;
  perEntryMaxBytes: number;
  kindBudgets: Record<LearningLoopEntryKind, KindBudget>;
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

const OVERSIZED_BUCKET_BYTES = 40_000;

/**
 * Measure budget in UTF-8 bytes so the cap matches what the agent actually receives rather than a character count.
 *
 * @param content - rendered prompt text or excerpt; an empty string measures zero
 * @returns byte length of the encoded text
 */
function byteLength(content: string): number {
  return Buffer.byteLength(content, "utf8");
}

/**
 * Trim an excerpt to fit its cap without cutting a multibyte character in half and leaving mojibake in the prompt.
 *
 * @param content - excerpt text to shorten
 * @param maxBytes - cap including the trailing ellipsis
 * @returns the original text when it already fits, otherwise a shortened copy ending in an ellipsis
 */
function truncateBytes(content: string, maxBytes: number): string {
  // Already inside the cap, so the reader gets the full excerpt with no ellipsis.
  if (byteLength(content) <= maxBytes) return content;
  let out = "";
  for (const char of content) {
    const next = out + char;
    // Stop at the last character that still leaves room for the ellipsis, so the cap is never exceeded mid-character.
    if (byteLength(next + "...") > maxBytes) break;
    out = next;
  }
  return `${out.trimEnd()}...`;
}

/**
 * Read the date that decides recency, preferring the revision date so a freshly re-verified incident outranks an old original write-up.
 *
 * @param entry - learning-loop entry from extracted facts
 * @returns an ISO date string, or empty when the entry carries neither date and therefore sorts last
 */
function entryDate(entry: LearningLoopEntryFact): string {
  return entry.updated ?? entry.created ?? "";
}

/**
 * Whether an entry points at files or lines that no longer resolve, which makes it maintenance evidence rather than trustworthy guidance.
 *
 * @param entry - learning-loop entry from extracted facts
 * @returns true when any reference is stale or invalid, which keeps the entry out of every surface except maintenance
 */
function isStaleOrInvalid(entry: LearningLoopEntryFact): boolean {
  return entry.staleRefs.length > 0 || entry.invalidLineRefs.length > 0;
}

/**
 * Fold a caller's per-kind overrides onto the shipped caps, so a surface can widen one bucket without restating the others.
 *
 * @param overrides - partial caps supplied by the caller; `undefined` keeps every shipped default
 * @returns a complete cap for all four entry kinds
 */
function mergedKindBudgets(
  overrides: LearningLoopContextOptions["perKind"],
): Record<LearningLoopEntryKind, KindBudget> {
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
function defaultMaxBytes(surface: LearningLoopContextSurface): number {
  // Maintenance work is where stale entries get repaired, so that prompt carries the most evidence.
  if (surface === "maintenance") return 3_200;
  // Process assessments reason about the loop itself and need more than a setup prompt does.
  if (surface === "quality-process") return 2_600;
  return 2_200;
}

/** Include ADRs by default because setup and quality prompts both need policy context. */
function includeDecisionEntries(): boolean {
  return true;
}

/**
 * Whether entries from an over-large bucket may be quoted, which only helps on the prompts that are judging bucket health in the first place.
 *
 * @param surface - prompt this block is being built for
 * @returns true for quality and maintenance prompts, false where an oversized bucket would just be noise
 */
function allowOversizedBuckets(surface: LearningLoopContextSurface): boolean {
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
  const surface = options.surface ?? "quality-agent-setup";
  return {
    includeStale: options.includeStale ?? surface === "maintenance",
    includeDecisions: options.includeDecisions ?? includeDecisionEntries(),
    includeOversized:
      options.includeOversized ?? allowOversizedBuckets(surface),
    budgetMax: options.maxBytes ?? defaultMaxBytes(surface),
    perEntryMaxBytes: options.perEntryMaxBytes ?? 360,
    kindBudgets: mergedKindBudgets(options.perKind),
  };
}

/**
 * Say in one phrase why this entry earned prompt space, so the reading agent can weigh it instead of treating every bullet the same.
 *
 * @param entry - learning-loop entry chosen for the block
 * @returns the short reason rendered after the entry title; never empty
 */
function reasonFor(entry: LearningLoopEntryFact): string {
  // Only maintenance surfaces admit broken entries, so saying so warns the reader not to trust the anchor.
  if (isStaleOrInvalid(entry)) {
    return "surfaced for learning-loop maintenance despite stale or invalid refs";
  }
  // A footgun whose anchor still resolves is the strongest evidence available, and the reason line says so.
  if (entry.kind === "footgun" && entry.hasValidAnchor) {
    return "active footgun with valid semantic anchor";
  }
  // Remaining kinds rank down from durable warnings to softer context.
  if (entry.kind === "footgun") return "active footgun";
  if (entry.kind === "lesson") return "recent lesson";
  if (entry.kind === "pattern") return "reusable pattern within cap";
  return "decision included for setup or policy context";
}

/**
 * Score an entry so scarce prompt space goes to durable warnings first and broken entries last.
 *
 * @param entry - learning-loop entry being ordered
 * @returns a sort key where lower wins; stale entries take a fixed penalty that pushes them behind every healthy one
 */
function entryRank(entry: LearningLoopEntryFact): number {
  const staleOffset = isStaleOrInvalid(entry) ? 10 : 0;
  const anchorBoost = entry.kind === "footgun" && entry.hasValidAnchor ? 0 : 1;
  return staleOffset + KIND_RANK[entry.kind] * 2 + anchorBoost;
}

/**
 * Order candidates by usefulness, then recency, then path, so the same project facts always produce the same prompt block.
 *
 * @param left - first entry in the comparison
 * @param right - second entry in the comparison
 * @returns a negative, zero, or positive sort result; the path and order tiebreaks keep the contract deterministic
 */
function compareEntries(
  left: LearningLoopEntryFact,
  right: LearningLoopEntryFact,
): number {
  const rankDiff = entryRank(left) - entryRank(right);
  // Kind and health decide first: a footgun outranks a pattern regardless of when either was written.
  if (rankDiff !== 0) return rankDiff;
  const dateDiff = entryDate(right).localeCompare(entryDate(left));
  // Same rank, so the more recently revised incident goes first.
  if (dateDiff !== 0) return dateDiff;
  const pathDiff = left.sourcePath.localeCompare(right.sourcePath);
  // Path then declaration order break the remaining ties, so two runs over unchanged facts render identical prompts.
  if (pathDiff !== 0) return pathDiff;
  return left.order - right.order;
}

/**
 * Decide whether one entry may appear on this surface at all, before any budget arithmetic runs.
 *
 * @param entry - learning-loop entry from extracted facts
 * @param options - resolved inclusion flags for the surface being rendered
 * @returns true when the entry is eligible; false silently drops it from the candidate list
 */
function allowedEntry(
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
function flagText(entry: SelectedLearningLoopEntry): string {
  const flags = [
    entry.staleRefs.length > 0 ? `stale refs: ${entry.staleRefs.length}` : "",
    entry.invalidLineRefs.length > 0
      ? `invalid refs: ${entry.invalidLineRefs.length}`
      : "",
  ].filter(Boolean);
  return flags.length === 0 ? "" : ` Flags: ${flags.join(", ")}.`;
}

/**
 * Render one excerpt as a single bullet: kind, title, source path, why it was picked, any flags, then the excerpt itself.
 *
 * @param entry - excerpt already selected for the block
 * @returns one prompt line; never empty
 */
function renderEntry(entry: SelectedLearningLoopEntry): string {
  return `- [${entry.kind}] ${entry.title} (\`${entry.sourcePath}\`) - ${entry.reasonSelected}.${flagText(entry)} ${entry.excerpt}`;
}

/**
 * Copy an eligible entry into the compact shape the block renders, trimming its excerpt to the per-entry cap.
 *
 * @param entry - eligible learning-loop entry
 * @param maxExcerptBytes - per-entry excerpt cap for this surface
 * @returns the prompt-ready excerpt; reference lists are copied so later edits cannot reach back into the facts
 */
function selectedFromEntry(
  entry: LearningLoopEntryFact,
  maxExcerptBytes: number,
): SelectedLearningLoopEntry {
  return {
    sourcePath: entry.sourcePath,
    kind: entry.kind,
    title: entry.title,
    reasonSelected: reasonFor(entry),
    excerpt: truncateBytes(entry.excerpt, maxExcerptBytes),
    staleRefs: [...entry.staleRefs],
    invalidLineRefs: [...entry.invalidLineRefs],
  };
}

/**
 * Settle the reported byte count and drop trailing entries until the rendered block fits, so the stated budget matches what ships.
 *
 * @param entries - excerpts chosen so far, in render order
 * @param budgetMax - byte ceiling for the whole rendered block
 * @param omittedCount - entries already left out, carried forward into the block header
 * @param zeroHit - true when nothing matched at all, which the header reports as an explicit retrieval miss
 * @returns the final selection whose header numbers describe the block it appears in
 */
function finalizeSelection(
  entries: SelectedLearningLoopEntry[],
  budgetMax: number,
  omittedCount: number,
  zeroHit: boolean,
): LearningLoopContextSelection {
  let selection: LearningLoopContextSelection = {
    entries,
    budgetUsed: 0,
    budgetMax,
    selectedCount: entries.length,
    omittedCount,
    zeroHit,
  };
  // The header prints the used-byte count, so writing that number changes the block length; three passes settle it.
  for (let pass = 0; pass < 3; pass++) {
    selection = {
      ...selection,
      budgetUsed: byteLength(renderLearningLoopContext(selection)),
    };
  }
  // Still over the ceiling, so the lowest-ranked entry is dropped and the count re-settled until the block fits.
  while (
    selection.entries.length > 0 &&
    byteLength(renderLearningLoopContext(selection)) > budgetMax
  ) {
    selection = finalizeSelection(
      selection.entries.slice(0, -1),
      budgetMax,
      omittedCount + 1,
      zeroHit,
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
  const resolved = resolveLearningLoopOptions(options);
  const sourceEntries = sharedFacts.learningLoopEntries;
  const candidates = sourceEntries
    .filter((entry) =>
      allowedEntry(entry, {
        includeStale: resolved.includeStale,
        includeDecisions: resolved.includeDecisions,
        includeOversized: resolved.includeOversized,
      }),
    )
    .sort(compareEntries);
  const kindBytes: Record<LearningLoopEntryKind, number> = {
    footgun: 0,
    lesson: 0,
    pattern: 0,
    decision: 0,
  };
  const kindCounts: Record<LearningLoopEntryKind, number> = {
    footgun: 0,
    lesson: 0,
    pattern: 0,
    decision: 0,
  };
  const selected: SelectedLearningLoopEntry[] = [];

  // Walk the ranked candidates once, taking each until its kind runs out of entries or bytes.
  for (const candidate of candidates) {
    const budget = resolved.kindBudgets[candidate.kind];
    // This kind has already filled its slots, so the entry is skipped and a lower-ranked kind keeps its share.
    if (kindCounts[candidate.kind] >= budget.maxEntries) continue;
    const next = selectedFromEntry(candidate, resolved.perEntryMaxBytes);
    const nextBytes = byteLength(renderEntry(next));
    // A long excerpt that would blow the kind's byte cap is skipped rather than truncated further.
    if (kindBytes[candidate.kind] + nextBytes > budget.maxBytes) continue;
    selected.push(next);
    kindCounts[candidate.kind]++;
    kindBytes[candidate.kind] += nextBytes;
  }

  return finalizeSelection(
    selected,
    resolved.budgetMax,
    sourceEntries.length - selected.length,
    candidates.length === 0,
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
  return [
    `<goat-learning-loop budget="${selection.budgetMax} bytes" used="${selection.budgetUsed} bytes" selected="${selection.selectedCount}" omitted="${selection.omittedCount}">`,
    "Curated learning-loop context only. Full freshness/stale-ref enforcement remains owned by `goat-flow stats --check`.",
    ...selection.entries.map(renderEntry),
    "</goat-learning-loop>",
  ].join("\n");
}
