/**
 * Parse, validate, summarize, and render milestone Timing Receipts.
 *
 * The embedded receipt is the durable authority for a measured Actual. This
 * module owns that portable format without reading project files or event logs.
 */
import { CLIError } from "./cli-error.js";
import type { PlanEffortSplit } from "./plans-effort.js";

/** Category attached to every closed or open timing span. */
export type PlanTimeCategory = keyof PlanEffortSplit;

/** Receipt-wide lifecycle; an incomplete receipt can still contain a later open span. */
export type PlanTimingReceiptState =
  "active" | "paused" | "finalized" | "incomplete";

/** One system-stamped span. Discarded spans retain their start but never gain a made-up end. */
export interface PlanTimingSegment {
  id: string;
  category: PlanTimeCategory;
  startIso: string;
  startEpochSeconds: number;
  endIso: string | null;
  endEpochSeconds: number | null;
  seconds: number | null;
  state: "open" | "closed" | "discarded";
  discardedAtIso: string | null;
  discardedAtEpochSeconds: number | null;
}

/** Final raw-second totals and their one-time rounded minute allocation. */
export interface PlanTimingSummary {
  totalSeconds: number;
  seconds: PlanEffortSplit;
  totalMinutes: number;
  minutes: PlanEffortSplit;
}

/** Structured representation exported alongside the readable Markdown receipt. */
export interface PlanTimingReceipt {
  state: PlanTimingReceiptState;
  segments: PlanTimingSegment[];
  summary?: PlanTimingSummary;
}

/** UTC and epoch forms parsed from the same receipt table cell. */
interface TimingStamp {
  iso: string;
  epochSeconds: number;
}

/** Shared fields parsed before the row is narrowed to open, closed, or discarded. */
interface ParsedSegmentColumns {
  id: string;
  category: PlanTimeCategory;
  start: TimingStamp;
  endText: string;
  secondsText: string;
  stateText: string;
}

const TIMING_CATEGORIES: readonly PlanTimeCategory[] = [
  "product",
  "proof",
  "other",
];
const RECEIPT_STATE_PATTERN =
  /^(?:\*\*Receipt state:\*\*|Receipt state:)\s*(\S+)\s*$/imu;
const RECORDED_SECONDS_PATTERN =
  /^(?:\*\*Recorded seconds:\*\*|Recorded seconds:)\s*(\d+)\s+total\s*\((\d+)\s+product\s*\/\s*(\d+)\s+proof\s*\/\s*(\d+)\s+other\)\s*$/imu;
const ALLOCATED_MINUTES_PATTERN =
  /^(?:\*\*Allocated minutes:\*\*|Allocated minutes:)\s*(\d+)\s+total\s*\((\d+)\s+product\s*\/\s*(\d+)\s+proof\s*\/\s*(\d+)\s+other\)\s*$/imu;

/**
 * Read one receipt authority field without silently choosing between merge duplicates.
 * Missing fields stay absent for legacy inference; duplicates add a fixed user-facing warning.
 *
 * @param markdown - rendered receipt body selected from the user's milestone
 * @param pattern - anchored field grammar whose first capture carries the field value
 * @param fieldLabel - plain-English field name used in a validation warning
 * @param warnings - caller-owned warning list that receives no milestone-controlled values
 * @returns the sole match, or undefined when the field is absent or duplicated
 */
function readUniqueReceiptField(
  markdown: string,
  pattern: RegExp,
  fieldLabel: string,
  warnings: string[],
): RegExpMatchArray | undefined {
  const globalPattern = new RegExp(
    pattern.source,
    `${pattern.flags.replace("g", "")}g`,
  );
  const fieldMatches = Array.from(markdown.matchAll(globalPattern));

  // Two rendered values leave users with no trustworthy receipt authority after a merge.
  if (fieldMatches.length > 1) {
    warnings.push(`multiple ${fieldLabel} values supplied`);
    return undefined;
  }
  return fieldMatches[0];
}

/** Return whether a category string belongs to the timing contract. */
function isTimingCategory(value: string): value is PlanTimeCategory {
  return TIMING_CATEGORIES.some((category) => category === value);
}

/** Parse a bounded non-negative integer without precision loss. */
function readSafeInteger(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/** Parse and cross-check one `UTC / epoch` table cell. */
function parseStamp(value: string): TimingStamp | null {
  const match = value.match(/^(.+?)\s*\/\s*(\d+)$/u);
  const iso = match?.[1]?.trim();
  const epochSeconds = match?.[2] ? readSafeInteger(match[2]) : null;
  if (!iso || epochSeconds === null) return null;
  const instant = new Date(epochSeconds * 1000);
  if (Number.isNaN(instant.getTime())) return null;
  const canonicalIso = instant.toISOString().replace(/\.\d{3}Z$/u, "Z");
  if (iso !== canonicalIso) return null;
  return { iso, epochSeconds };
}

/** Read a receipt segment table row; malformed rows add a fixed warning. */
function parseSegmentRow(
  columns: string[],
  rowIndex: number,
  warnings: string[],
): PlanTimingSegment | null {
  const parsedColumns = parseSegmentColumns(columns);
  if (parsedColumns === null) {
    warnings.push(`timing receipt segment ${rowIndex} is not parseable`);
    return null;
  }
  const segment = parseKnownSegment(
    parsedColumns.id,
    parsedColumns.category,
    parsedColumns.start,
    parsedColumns.endText,
    parsedColumns.secondsText,
    parsedColumns.stateText,
  );
  if (segment) return segment;
  warnings.push(`timing receipt segment ${rowIndex} is inconsistent`);
  return null;
}

/** Validate the identifier, category, and start shared by every segment state. */
function parseSegmentColumns(columns: string[]): ParsedSegmentColumns | null {
  const [
    id = "",
    categoryText = "",
    startText = "",
    endText = "",
    secondsText = "",
    stateText = "",
  ] = columns;
  if (!id) return null;
  const category = categoryText.toLowerCase();
  if (!isTimingCategory(category)) return null;
  const start = parseStamp(startText);
  if (start === null) return null;
  return { id, category, start, endText, secondsText, stateText };
}

/** Try the three mutually exclusive segment-state parsers in stable order. */
function parseKnownSegment(
  id: string,
  category: PlanTimeCategory,
  start: TimingStamp,
  endText: string,
  secondsText: string,
  stateText: string,
): PlanTimingSegment | null {
  return (
    parseOpenSegment(id, category, start, endText, secondsText, stateText) ??
    parseDiscardedSegment(
      id,
      category,
      start,
      endText,
      secondsText,
      stateText,
    ) ??
    parseClosedSegment(id, category, start, endText, secondsText, stateText)
  );
}

/** Parse the deliberately empty end fields of one active span. */
function parseOpenSegment(
  id: string,
  category: PlanTimeCategory,
  start: TimingStamp,
  endText: string,
  secondsText: string,
  stateText: string,
): PlanTimingSegment | null {
  if (stateText !== "open") return null;
  if (endText !== "_" || secondsText !== "_") return null;
  return {
    id,
    category,
    startIso: start.iso,
    startEpochSeconds: start.epochSeconds,
    endIso: null,
    endEpochSeconds: null,
    seconds: null,
    state: "open",
    discardedAtIso: null,
    discardedAtEpochSeconds: null,
  };
}

/** Parse interruption recovery while keeping the unknowable end fields empty. */
function parseDiscardedSegment(
  id: string,
  category: PlanTimeCategory,
  start: TimingStamp,
  endText: string,
  secondsText: string,
  stateText: string,
): PlanTimingSegment | null {
  if (endText !== "_" || secondsText !== "_") return null;
  const discardedText = stateText.match(/^discarded\s+(.+)$/u)?.[1];
  if (!discardedText) return null;
  const discardedAt = parseStamp(discardedText);
  if (discardedAt === null) return null;
  return {
    id,
    category,
    startIso: start.iso,
    startEpochSeconds: start.epochSeconds,
    endIso: null,
    endEpochSeconds: null,
    seconds: null,
    state: "discarded",
    discardedAtIso: discardedAt.iso,
    discardedAtEpochSeconds: discardedAt.epochSeconds,
  };
}

/** Return the latest system-clock instant carried by one receipt row. */
function latestSegmentEpoch(segment: PlanTimingSegment): number {
  return Math.max(
    segment.startEpochSeconds,
    segment.endEpochSeconds ?? segment.startEpochSeconds,
    segment.discardedAtEpochSeconds ?? segment.startEpochSeconds,
  );
}

/**
 * Find the latest recorded instant users can see anywhere in their timing history.
 * Use before Start so a recovered or corrected system clock cannot create overlapping work.
 *
 * @param segments - existing receipt rows; empty means the user has not started timing
 * @returns the latest epoch second, or null when no timing row exists
 */
export function latestRecordedTimingEpoch(
  segments: readonly PlanTimingSegment[],
): number | null {
  // With no prior row, the user's first Start has no historical clock boundary.
  return segments.reduce<number | null>((latestEpoch, segment) => {
    const segmentEpoch = latestSegmentEpoch(segment);
    return latestEpoch === null
      ? segmentEpoch
      : Math.max(latestEpoch, segmentEpoch);
  }, null);
}

/** Parse a closed span only when timestamps and stored duration reconcile. */
function parseClosedSegment(
  id: string,
  category: PlanTimeCategory,
  start: TimingStamp,
  endText: string,
  secondsText: string,
  stateText: string,
): PlanTimingSegment | null {
  if (stateText !== "closed") return null;
  const end = parseStamp(endText);
  if (end === null) return null;
  const seconds = readSafeInteger(secondsText);
  if (seconds === null) return null;
  if (end.epochSeconds < start.epochSeconds) return null;
  if (seconds !== end.epochSeconds - start.epochSeconds) return null;
  return {
    id,
    category,
    startIso: start.iso,
    startEpochSeconds: start.epochSeconds,
    endIso: end.iso,
    endEpochSeconds: end.epochSeconds,
    seconds,
    state: "closed",
    discardedAtIso: null,
    discardedAtEpochSeconds: null,
  };
}

/** Parse optional summary fields only when both are complete. */
function parseTimingSummary(
  markdown: string,
  warnings: string[],
): PlanTimingSummary | undefined {
  const secondsMatch = readUniqueReceiptField(
    markdown,
    RECORDED_SECONDS_PATTERN,
    "Recorded seconds",
    warnings,
  );
  const minutesMatch = readUniqueReceiptField(
    markdown,
    ALLOCATED_MINUTES_PATTERN,
    "Allocated minutes",
    warnings,
  );
  // A receipt without either summary line is an ordinary active or paused receipt.
  if (!secondsMatch && !minutesMatch) return undefined;
  // Finalized summary evidence is usable only when both authoritative lines are present once.
  if (!secondsMatch || !minutesMatch) {
    warnings.push("timing receipt summary is incomplete");
    return undefined;
  }
  const seconds = parseSummaryValues(secondsMatch);
  const minutes = parseSummaryValues(minutesMatch);
  if (seconds === null || minutes === null) {
    warnings.push("timing receipt summary is not parseable");
    return undefined;
  }
  return {
    totalSeconds: seconds.total,
    seconds: seconds.split,
    totalMinutes: minutes.total,
    minutes: minutes.split,
  };
}

/** Parse the four numeric captures shared by receipt summary lines. */
function parseSummaryValues(match: RegExpMatchArray): {
  total: number;
  split: PlanEffortSplit;
} | null {
  const values = match
    .slice(1, 5)
    .map((value) => readSafeInteger(value))
    .filter((value): value is number => value !== null);
  if (values.length !== 4) return null;
  const [total = 0, product = 0, proof = 0, other = 0] = values;
  return { total, split: { product, proof, other } };
}

/** Infer the legacy/manual receipt state when no explicit state field exists. */
function inferReceiptState(
  segments: readonly PlanTimingSegment[],
): PlanTimingReceiptState {
  if (segments.some((segment) => segment.state === "discarded")) {
    return "incomplete";
  }
  if (segments.some((segment) => segment.state === "open")) return "active";
  return "paused";
}

/**
 * Validate state, uniqueness, and any embedded summary against raw spans.
 *
 * @param receipt - embedded milestone receipt; an empty segment list reports only applicable errors
 * @returns fixed validation messages; an empty list means the receipt is internally consistent
 */
function validateTimingReceipt(receipt: PlanTimingReceipt): string[] {
  return [
    ...new Set([
      ...collectSegmentIdentityErrors(receipt.segments),
      ...collectSegmentTimelineErrors(receipt.segments),
      ...collectReceiptStateErrors(receipt),
      ...collectReceiptSummaryErrors(receipt),
    ]),
  ];
}

/** Reject reordered, overlapping, or post-open rows that cannot describe one user timeline. */
function collectSegmentTimelineErrors(
  segments: readonly PlanTimingSegment[],
): string[] {
  let priorLatestEpoch: number | null = null;
  let isPriorSegmentOpen = false;

  // Each row must begin after every recorded instant in the rows the user sees above it.
  for (const segment of segments) {
    // A later row cannot follow an unfinished span or begin before the prior row finished.
    if (
      isPriorSegmentOpen ||
      (priorLatestEpoch !== null &&
        segment.startEpochSeconds < priorLatestEpoch)
    ) {
      return [
        "timing receipt segments must be chronological and non-overlapping",
      ];
    }
    priorLatestEpoch = latestSegmentEpoch(segment);
    isPriorSegmentOpen = segment.state === "open";
  }
  return [];
}

/** Find duplicate segment identifiers without copying target-controlled ids into errors. */
function collectSegmentIdentityErrors(
  segments: readonly PlanTimingSegment[],
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const segment of segments) {
    if (ids.has(segment.id)) {
      errors.push("timing receipt segment ids must be unique");
    }
    ids.add(segment.id);
  }
  return errors;
}

/** Check receipt-wide state against open/discarded segment counts. */
function collectReceiptStateErrors(receipt: PlanTimingReceipt): string[] {
  const errors: string[] = [];
  const openCount = receipt.segments.filter(
    (segment) => segment.state === "open",
  ).length;
  const discardedCount = receipt.segments.filter(
    (segment) => segment.state === "discarded",
  ).length;
  errors.push(...collectOpenStateErrors(receipt.state, openCount));
  errors.push(...collectDiscardStateErrors(receipt.state, discardedCount));
  if (receipt.state === "finalized" && receipt.summary === undefined) {
    errors.push("finalized timing receipt requires a summary");
  }
  if (receipt.state !== "finalized" && receipt.summary !== undefined) {
    errors.push("timing receipt summary requires finalized state");
  }
  return errors;
}

/** Validate how many active spans each receipt-wide state permits. */
function collectOpenStateErrors(
  state: PlanTimingReceiptState,
  openCount: number,
): string[] {
  const errors: string[] = [];
  if (openCount > 1)
    errors.push("timing receipt permits only one open segment");
  switch (state) {
    case "active":
      if (openCount !== 1) {
        errors.push("active timing receipt requires one open segment");
      }
      break;
    case "paused":
    case "finalized":
      if (openCount > 0) {
        errors.push(`${state} timing receipt must not contain an open segment`);
      }
      break;
    case "incomplete":
      break;
  }
  return errors;
}

/** Require the receipt-wide incomplete state when any span was discarded. */
function collectDiscardStateErrors(
  state: PlanTimingReceiptState,
  discardedCount: number,
): string[] {
  if (state === "incomplete") return [];
  return discardedCount > 0
    ? ["discarded span requires an incomplete timing receipt"]
    : [];
}

/** Reconcile an optional summary with closed raw spans and deterministic allocation. */
function collectReceiptSummaryErrors(receipt: PlanTimingReceipt): string[] {
  const summary = receipt.summary;
  if (!summary) return [];
  const errors: string[] = [];
  const derivedSeconds = sumClosedSeconds(receipt.segments);
  const derivedAllocation = allocateTimingMinutes(derivedSeconds);
  if (!secondsSummaryMatches(summary, derivedSeconds)) {
    errors.push(
      "timing receipt raw-second summary does not match closed spans",
    );
  }
  if (!minuteSummaryMatches(summary, derivedAllocation)) {
    errors.push("timing receipt minute allocation does not match raw seconds");
  }
  return errors;
}

/** Compare raw totals, category sum, and closed-span derivation. */
function secondsSummaryMatches(
  summary: PlanTimingSummary,
  derivedSeconds: PlanEffortSplit,
): boolean {
  const secondsTotal =
    summary.seconds.product + summary.seconds.proof + summary.seconds.other;
  const derivedTotal =
    derivedSeconds.product + derivedSeconds.proof + derivedSeconds.other;
  return (
    summary.totalSeconds === secondsTotal &&
    summary.totalSeconds === derivedTotal &&
    splitsEqual(summary.seconds, derivedSeconds)
  );
}

/** Compare rounded total, category sum, and largest-remainder allocation. */
function minuteSummaryMatches(
  summary: PlanTimingSummary,
  derived: { totalMinutes: number; split: PlanEffortSplit },
): boolean {
  const minutesTotal =
    summary.minutes.product + summary.minutes.proof + summary.minutes.other;
  return (
    summary.totalMinutes === minutesTotal &&
    summary.totalMinutes === derived.totalMinutes &&
    splitsEqual(summary.minutes, derived.split)
  );
}

/**
 * Parse the readable section into a typed receipt and append fixed warnings.
 *
 * @param markdown - receipt section body; empty text means the milestone has no usable receipt
 * @param warnings - caller-owned warning list; receives no source-controlled receipt values
 * @returns the parsed receipt, or `undefined` when the section body is empty
 */
export function parseTimingReceiptMarkdown(
  markdown: string,
  warnings: string[],
): PlanTimingReceipt | undefined {
  if (markdown.trim().length === 0) return undefined;
  const segments = parseTimingSegments(markdown, warnings);
  if (segments.length === 0) {
    warnings.push("timing receipt has no parseable segments");
  }
  const state = parseReceiptState(markdown, segments, warnings);
  const receipt: PlanTimingReceipt = { state, segments };
  const summary = parseTimingSummary(markdown, warnings);
  if (summary) receipt.summary = summary;
  warnings.push(...validateTimingReceipt(receipt));
  return receipt;
}

/** Parse only data rows from the readable receipt table. */
function parseTimingSegments(
  markdown: string,
  warnings: string[],
): PlanTimingSegment[] {
  const segments: PlanTimingSegment[] = [];
  let rowIndex = 0;
  for (const line of markdown.split("\n")) {
    const columns = readTimingDataColumns(line, warnings);
    if (!columns) continue;
    rowIndex += 1;
    const segment = parseSegmentRow(columns, rowIndex, warnings);
    if (segment) segments.push(segment);
  }
  return segments;
}

/** Return six data cells while warning on malformed timing-table rows. */
function readTimingDataColumns(
  line: string,
  warnings: string[],
): string[] | null {
  if (!/^\s*\|.*\|\s*$/u.test(line)) return null;
  const columns = line
    .trim()
    .slice(1, -1)
    .split("|")
    .map((value) => value.trim());
  if (columns.length !== 6) {
    warnings.push("timing receipt table row must contain exactly 6 cells");
    return null;
  }
  if (columns[0]?.toLowerCase() === "segment") return null;
  if (columns.every((value) => /^:?-+:?$/u.test(value))) return null;
  return columns;
}

/** Read an explicit receipt state or infer the compatible manual-receipt state. */
function parseReceiptState(
  markdown: string,
  segments: readonly PlanTimingSegment[],
  warnings: string[],
): PlanTimingReceiptState {
  const stateText = readUniqueReceiptField(
    markdown,
    RECEIPT_STATE_PATTERN,
    "Receipt state",
    warnings,
  )?.[1]?.toLowerCase();
  const inferredState = inferReceiptState(segments);
  // Missing or duplicated state text falls back only for parsing; its duplicate warning still rejects writes.
  if (stateText === undefined) return inferredState;
  // A recognized state can be checked against the table rows below.
  if (isReceiptState(stateText)) return stateText;
  warnings.push("timing receipt state is not parseable");
  return inferredState;
}

/** Narrow a parsed field to the receipt-state vocabulary. */
function isReceiptState(value: string): value is PlanTimingReceiptState {
  return (
    value === "active" ||
    value === "paused" ||
    value === "finalized" ||
    value === "incomplete"
  );
}

/** Compare two effort splits without relying on object identity. */
function splitsEqual(left: PlanEffortSplit, right: PlanEffortSplit): boolean {
  return (
    left.product === right.product &&
    left.proof === right.proof &&
    left.other === right.other
  );
}

/** Add raw seconds from closed spans only; open/discarded time is unknowable. */
function sumClosedSeconds(
  segments: readonly PlanTimingSegment[],
): PlanEffortSplit {
  const totals: PlanEffortSplit = { product: 0, proof: 0, other: 0 };
  for (const segment of segments) {
    if (segment.state === "closed" && segment.seconds !== null) {
      totals[segment.category] += segment.seconds;
    }
  }
  return totals;
}

/**
 * Round the combined raw total once, then assign whole minutes by largest
 * remainder with stable product/proof/other tie-breaking.
 *
 * @param seconds - non-negative raw category totals; every category must be a safe integer
 * @returns rounded total minutes and a deterministic category allocation that reconciles to it
 * @throws CLIError - when any category or their combined total exceeds the supported integer range
 */
export function allocateTimingMinutes(seconds: PlanEffortSplit): {
  totalMinutes: number;
  split: PlanEffortSplit;
} {
  for (const category of TIMING_CATEGORIES) {
    if (!Number.isSafeInteger(seconds[category]) || seconds[category] < 0) {
      throw new CLIError("Timing seconds must be non-negative integers.", 2);
    }
  }
  const totalSeconds = seconds.product + seconds.proof + seconds.other;
  if (!Number.isSafeInteger(totalSeconds)) {
    throw new CLIError("Timing seconds exceed the supported integer range.", 2);
  }
  const totalMinutes = Math.round(totalSeconds / 60);
  const split: PlanEffortSplit = {
    product: Math.floor(seconds.product / 60),
    proof: Math.floor(seconds.proof / 60),
    other: Math.floor(seconds.other / 60),
  };
  let remaining = totalMinutes - split.product - split.proof - split.other;
  const ranked = [...TIMING_CATEGORIES].sort((left, right) => {
    const remainderDifference = (seconds[right] % 60) - (seconds[left] % 60);
    return remainderDifference !== 0
      ? remainderDifference
      : TIMING_CATEGORIES.indexOf(left) - TIMING_CATEGORIES.indexOf(right);
  });
  for (const category of ranked) {
    if (remaining <= 0) break;
    split[category] += 1;
    remaining -= 1;
  }
  return { totalMinutes, split };
}

/**
 * Build the derived summary used by final receipts and measured Actuals.
 *
 * @param segments - receipt spans; open and discarded time is excluded because its duration is unknown
 * @returns raw closed-span seconds and the corresponding deterministic minute allocation
 */
export function summarizeTimingReceipt(
  segments: readonly PlanTimingSegment[],
): PlanTimingSummary {
  const seconds = sumClosedSeconds(segments);
  const totalSeconds = seconds.product + seconds.proof + seconds.other;
  const allocation = allocateTimingMinutes(seconds);
  return {
    totalSeconds,
    seconds,
    totalMinutes: allocation.totalMinutes,
    minutes: allocation.split,
  };
}

/** Render one segment row without adding work descriptions or source text. */
function renderTimingSegment(segment: PlanTimingSegment): string {
  const start = `${segment.startIso} / ${segment.startEpochSeconds}`;
  const end =
    segment.endIso !== null && segment.endEpochSeconds !== null
      ? `${segment.endIso} / ${segment.endEpochSeconds}`
      : "_";
  const seconds = segment.seconds === null ? "_" : String(segment.seconds);
  const state =
    segment.state === "discarded" &&
    segment.discardedAtIso !== null &&
    segment.discardedAtEpochSeconds !== null
      ? `discarded ${segment.discardedAtIso} / ${segment.discardedAtEpochSeconds}`
      : segment.state;
  return `| ${segment.id} | ${segment.category} | ${start} | ${end} | ${seconds} | ${state} |`;
}

/**
 * Render the canonical Markdown body embedded under `## Timing Receipt`.
 *
 * @param receipt - validated receipt; an empty segment list renders a header-only table
 * @returns portable Markdown containing bounded timestamps, durations, states, and optional summary
 */
export function renderTimingReceiptMarkdown(
  receipt: PlanTimingReceipt,
): string {
  const lines = [`**Receipt state:** ${receipt.state}`];
  if (receipt.summary) {
    lines.push(
      `**Recorded seconds:** ${receipt.summary.totalSeconds} total (${receipt.summary.seconds.product} product / ${receipt.summary.seconds.proof} proof / ${receipt.summary.seconds.other} other)`,
      `**Allocated minutes:** ${receipt.summary.totalMinutes} total (${receipt.summary.minutes.product} product / ${receipt.summary.minutes.proof} proof / ${receipt.summary.minutes.other} other)`,
    );
  }
  lines.push(
    "",
    "| Segment | Category | Start UTC / epoch | End UTC / epoch | Seconds | State |",
    "|---|---|---|---|---:|---|",
    ...receipt.segments.map(renderTimingSegment),
  );
  return lines.join("\n");
}
