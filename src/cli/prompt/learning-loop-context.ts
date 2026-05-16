import type {
  LearningLoopEntryFact,
  LearningLoopEntryKind,
  SharedFacts,
} from "../types.js";

export type LearningLoopContextSurface =
  | "quality-agent-setup"
  | "quality-harness"
  | "quality-process"
  | "setup"
  | "maintenance";

interface KindBudget {
  maxBytes: number;
  maxEntries: number;
}

export interface LearningLoopContextOptions {
  surface?: LearningLoopContextSurface;
  maxBytes?: number;
  perEntryMaxBytes?: number;
  includeStale?: boolean;
  includeDecisions?: boolean;
  includeOversized?: boolean;
  perKind?: Partial<Record<LearningLoopEntryKind, Partial<KindBudget>>>;
}

export interface SelectedLearningLoopEntry {
  sourcePath: string;
  kind: LearningLoopEntryKind;
  title: string;
  reasonSelected: string;
  excerpt: string;
  staleRefs: string[];
  invalidLineRefs: string[];
}

export interface LearningLoopContextSelection {
  entries: SelectedLearningLoopEntry[];
  budgetUsed: number;
  budgetMax: number;
  selectedCount: number;
  omittedCount: number;
  zeroHit: boolean;
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

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function truncateBytes(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) return value;
  let out = "";
  for (const char of value) {
    const next = out + char;
    if (byteLength(next + "...") > maxBytes) break;
    out = next;
  }
  return `${out.trimEnd()}...`;
}

function entryDate(entry: LearningLoopEntryFact): string {
  return entry.updated ?? entry.created ?? "";
}

function isStaleOrInvalid(entry: LearningLoopEntryFact): boolean {
  return entry.staleRefs.length > 0 || entry.invalidLineRefs.length > 0;
}

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

function defaultMaxBytes(surface: LearningLoopContextSurface): number {
  if (surface === "maintenance") return 3_200;
  if (surface === "quality-process") return 2_600;
  return 2_200;
}

function includeDecisionEntries(surface: LearningLoopContextSurface): boolean {
  return (
    surface === "quality-agent-setup" ||
    surface === "quality-harness" ||
    surface === "quality-process" ||
    surface === "setup" ||
    surface === "maintenance"
  );
}

function allowOversizedBuckets(surface: LearningLoopContextSurface): boolean {
  return surface.startsWith("quality-") || surface === "maintenance";
}

function reasonFor(entry: LearningLoopEntryFact): string {
  if (isStaleOrInvalid(entry)) {
    return "surfaced for learning-loop maintenance despite stale or invalid refs";
  }
  if (entry.kind === "footgun" && entry.hasValidAnchor) {
    return "active footgun with valid semantic anchor";
  }
  if (entry.kind === "footgun") return "active footgun";
  if (entry.kind === "lesson") return "recent lesson";
  if (entry.kind === "pattern") return "reusable pattern within cap";
  return "decision included for setup or policy context";
}

function entryRank(entry: LearningLoopEntryFact): number {
  const staleOffset = isStaleOrInvalid(entry) ? 10 : 0;
  const anchorBoost = entry.kind === "footgun" && entry.hasValidAnchor ? 0 : 1;
  return staleOffset + KIND_RANK[entry.kind] * 2 + anchorBoost;
}

function compareEntries(
  left: LearningLoopEntryFact,
  right: LearningLoopEntryFact,
): number {
  const rankDiff = entryRank(left) - entryRank(right);
  if (rankDiff !== 0) return rankDiff;
  const dateDiff = entryDate(right).localeCompare(entryDate(left));
  if (dateDiff !== 0) return dateDiff;
  const pathDiff = left.sourcePath.localeCompare(right.sourcePath);
  if (pathDiff !== 0) return pathDiff;
  return left.order - right.order;
}

function allowedEntry(
  entry: LearningLoopEntryFact,
  options: Required<
    Pick<
      LearningLoopContextOptions,
      "includeStale" | "includeDecisions" | "includeOversized"
    >
  >,
): boolean {
  if (entry.sourcePath.endsWith("/README.md")) return false;
  if (entry.kind === "decision" && !options.includeDecisions) return false;
  if (entry.kind === "footgun" && entry.status !== "active") return false;
  if (!options.includeStale && isStaleOrInvalid(entry)) return false;
  if (
    !options.includeOversized &&
    entry.bucketSizeBytes > OVERSIZED_BUCKET_BYTES
  )
    return false;
  return true;
}

function flagText(entry: SelectedLearningLoopEntry): string {
  const flags = [
    entry.staleRefs.length > 0 ? `stale refs: ${entry.staleRefs.length}` : "",
    entry.invalidLineRefs.length > 0
      ? `invalid refs: ${entry.invalidLineRefs.length}`
      : "",
  ].filter(Boolean);
  return flags.length === 0 ? "" : ` Flags: ${flags.join(", ")}.`;
}

function renderEntry(entry: SelectedLearningLoopEntry): string {
  return `- [${entry.kind}] ${entry.title} (\`${entry.sourcePath}\`) - ${entry.reasonSelected}.${flagText(entry)} ${entry.excerpt}`;
}

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
  for (let i = 0; i < 3; i++) {
    selection = {
      ...selection,
      budgetUsed: byteLength(renderLearningLoopContext(selection)),
    };
  }
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

/** Select deterministic, size-bounded learning-loop context from shared facts. */
export function selectLearningLoopContext(
  sharedFacts: Pick<SharedFacts, "learningLoopEntries">,
  options: LearningLoopContextOptions = {},
): LearningLoopContextSelection {
  const surface = options.surface ?? "quality-agent-setup";
  const includeStale = options.includeStale ?? surface === "maintenance";
  const includeDecisions =
    options.includeDecisions ?? includeDecisionEntries(surface);
  const includeOversized =
    options.includeOversized ?? allowOversizedBuckets(surface);
  const budgetMax = options.maxBytes ?? defaultMaxBytes(surface);
  const perEntryMaxBytes = options.perEntryMaxBytes ?? 360;
  const kindBudgets = mergedKindBudgets(options.perKind);
  const sourceEntries = sharedFacts.learningLoopEntries ?? [];
  const candidates = sourceEntries
    .filter((entry) =>
      allowedEntry(entry, { includeStale, includeDecisions, includeOversized }),
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

  for (const candidate of candidates) {
    const budget = kindBudgets[candidate.kind];
    if (kindCounts[candidate.kind] >= budget.maxEntries) continue;
    const next = selectedFromEntry(candidate, perEntryMaxBytes);
    const nextBytes = byteLength(renderEntry(next));
    if (kindBytes[candidate.kind] + nextBytes > budget.maxBytes) continue;
    selected.push(next);
    kindCounts[candidate.kind]++;
    kindBytes[candidate.kind] += nextBytes;
  }

  return finalizeSelection(
    selected,
    budgetMax,
    sourceEntries.length - selected.length,
    candidates.length === 0,
  );
}

/** Render the selected entries as a compact prompt block. */
export function renderLearningLoopContext(
  selection: LearningLoopContextSelection,
): string {
  if (selection.entries.length === 0) return "";
  return [
    `<goat-learning-loop budget="${selection.budgetMax} bytes" used="${selection.budgetUsed} bytes" selected="${selection.selectedCount}" omitted="${selection.omittedCount}">`,
    "Curated learning-loop context only. Full freshness/stale-ref enforcement remains owned by `goat-flow stats --check`.",
    ...selection.entries.map(renderEntry),
    "</goat-learning-loop>",
  ].join("\n");
}
