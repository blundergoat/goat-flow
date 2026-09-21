/**
 * Read the forecast records a plan author reviews through `plans check` and `plans export`.
 *
 * Preserve issued inputs and remaining-work revisions without reconstructing them from today's checklist.
 * Legacy plans stay unchanged; saved timestamps and hashes need an external frozen record to establish when they existed.
 */
import {
  countAgentWorkUnits,
  sumTaskEstimates,
  validateForecastBasis,
  type PlanEffortForecastBasis,
  type PlanEffortForecastRange,
  type PlanEffortSplit,
} from "./plans-effort.js";
import type { PlanExportRecord } from "./plans-export.js";
import {
  maskNonRenderedMarkdown,
  readRenderedMarkdownFieldValues,
} from "./rendered-markdown.js";

/** Explicit numerical method; omission in a milestone keeps legacy behavior. */
type PlanForecastMethod = "legacy" | "contextual-v1";

/**
 * One independently countable item; minutes are allocation, never model input.
 * Description matches checklist text without its trailing estimate, with whitespace collapsed.
 * Description/category pairs must identify one saved ID across revisions; admin uses "Plan/admin overhead".
 */
interface PlanForecastItem {
  id: string;
  description: string;
  category: keyof PlanEffortSplit;
  units: 1;
  estimateMinutes: number;
}

/** Frozen whole-work or remaining-work prediction and the inputs that produced it. */
export interface PlanForecastRecord {
  id: string;
  predecessorId: string | null;
  reason: string;
  issuedAt: string;
  methodVersion: PlanForecastMethod;
  workState:
    "fresh-implementation" | "reconciliation" | "verification-only" | "unknown";
  scopeKind: "whole" | "remaining";
  unitRubric: string;
  items: PlanForecastItem[];
  basis: PlanEffortForecastBasis;
  range: PlanEffortForecastRange;
  quantiles: [number, number];
  selection: "context-matched" | "selected-plan" | "cold-prior";
  selectionReason: string;
  sourceVersion: string;
  sampleCount: number;
  history: { id: string; sha256: string; completedAt: string }[];
  scopeDelta: { added: string[]; removed: string[] };
  receiptCutoff: { segmentId: string; recordedSeconds: number } | null;
}

/**
 * Versioned JSON contract for the author's forecast history.
 *
 * Records start with one whole-work original and append linked revisions in issue order.
 * An empty history or unsupported schema version is invalid and remains available as raw export text.
 */
interface PlanForecastDocument {
  schemaVersion: 1;
  records: PlanForecastRecord[];
}

/**
 * Keep the forecast method and its authored evidence together for export and validation.
 *
 * A null method means invalid supplied metadata; absent metadata omits this entire context from legacy exports.
 * Raw declarations remain available when malformed records cannot produce a parsed document.
 */
export interface PlanForecastContext {
  declaredMethods: string[];
  method: PlanForecastMethod | null;
  recordSections: string[];
  document?: PlanForecastDocument;
}

/**
 * Reject invalid forecast input with a field-specific error the plan author can repair.
 *
 * @param isValid - whether the supplied field satisfies its forecast contract
 * @param message - fixed diagnostic; never include pasted input that could contain credentials
 * @throws Error when a required forecast field is missing or invalid
 */
function requireForecastInput(
  isValid: boolean,
  message: string,
): asserts isValid {
  // A missing or invalid field stops this forecast from looking usable to the plan author.
  if (!isValid) throw new Error(message);
}

/**
 * Recognize a forecast JSON object before reading its fields; null and arrays cannot represent a record.
 */
function isForecastObject(
  forecastInput: unknown,
): forecastInput is Record<string, unknown> {
  return (
    typeof forecastInput === "object" &&
    forecastInput !== null &&
    !Array.isArray(forecastInput)
  );
}

/**
 * Read an object from the author's JSON; missing, null or array input throws a field-specific validation error.
 */
function readForecastObject(
  forecastInput: unknown,
  field: string,
): Record<string, unknown> {
  requireForecastInput(
    isForecastObject(forecastInput),
    `${field} must be an object`,
  );
  return forecastInput;
}

/**
 * Read required forecast text without inventing a legacy default; blank or missing input throws a validation error.
 */
function readForecastText(forecastInput: unknown, field: string): string {
  requireForecastInput(
    typeof forecastInput === "string" && forecastInput.trim().length > 0,
    `${field} must be nonblank text`,
  );
  return forecastInput;
}

/**
 * Read a finite forecast quantity; reject missing, negative or disallowed fractional values before they enter a displayed estimate.
 */
function readForecastNumber(
  forecastInput: unknown,
  field: string,
  minimum = 0,
  requiresInteger = false,
): number {
  requireForecastInput(
    typeof forecastInput === "number" && Number.isFinite(forecastInput),
    `${field} must be finite`,
  );
  requireForecastInput(
    forecastInput >= minimum &&
      (!requiresInteger || Number.isSafeInteger(forecastInput)),
    `${field} has an invalid numeric value`,
  );
  return forecastInput;
}

/**
 * Read an explicit list from the forecast record; an omitted value throws instead of becoming an empty evidence list.
 */
function readForecastArray(forecastInput: unknown, field: string): unknown[] {
  requireForecastInput(
    Array.isArray(forecastInput),
    `${field} must be an array`,
  );
  return forecastInput;
}

/**
 * Read the author's selected forecast option; an unknown or missing value throws instead of activating another method.
 */
function readForecastChoice<T extends string>(
  forecastInput: unknown,
  values: readonly T[],
  field: string,
): T {
  const result = values.find((candidate) => candidate === forecastInput);
  requireForecastInput(
    result !== undefined,
    `${field} has an unsupported value`,
  );
  return result;
}

/**
 * Read a real UTC issue or completion time so forecast evidence can be ordered; impossible dates throw a validation error.
 */
function readForecastTimestamp(forecastInput: unknown, field: string): string {
  const result = readForecastText(forecastInput, field);
  const normalized = result.replace(/\.000Z$/u, "Z");
  const epoch = Date.parse(result);
  requireForecastInput(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(result) &&
      Number.isFinite(epoch),
    `${field} must be a UTC timestamp`,
  );
  requireForecastInput(
    new Date(epoch).toISOString().replace(/\.000Z$/u, "Z") === normalized,
    `${field} must be a real UTC timestamp`,
  );
  return result;
}

/**
 * Read the work or evidence IDs named by a revision; an empty list means no changes, while duplicate IDs throw.
 */
function readForecastIdentities(
  forecastInput: unknown,
  field: string,
): string[] {
  const result = readForecastArray(forecastInput, field).map((entry) =>
    readForecastText(entry, field),
  );
  requireForecastInput(
    new Set(result).size === result.length,
    `${field} contains duplicate identities`,
  );
  return result;
}

/**
 * Read one saved work item so the author can inspect what the estimate includes; allocated minutes never determine its work-unit count.
 */
function readForecastItem(forecastInput: unknown): PlanForecastItem {
  const workItem = readForecastObject(forecastInput, "item");
  requireForecastInput(
    workItem.units === 1,
    "item units must be 1; weighted units are unsupported",
  );
  return {
    id: readForecastText(workItem.id, "item id"),
    description: readForecastText(workItem.description, "item description"),
    category: readForecastChoice(
      workItem.category,
      ["product", "proof", "other"],
      "item category",
    ),
    units: 1,
    estimateMinutes: readForecastNumber(
      workItem.estimateMinutes,
      "item estimateMinutes",
      1,
      true,
    ),
  };
}

/**
 * Read the saved count and rates behind the author's estimate without fitting replacement rates to displayed minutes.
 */
function readForecastBasis(forecastInput: unknown): PlanEffortForecastBasis {
  const basis = readForecastObject(forecastInput, "basis");
  return {
    agentWorkUnits: readForecastNumber(
      basis.agentWorkUnits,
      "basis agentWorkUnits",
      1,
      true,
    ),
    lowMinutesPerUnit: readForecastNumber(
      basis.lowMinutesPerUnit,
      "basis lowMinutesPerUnit",
    ),
    likelyMinutesPerUnit: readForecastNumber(
      basis.likelyMinutesPerUnit,
      "basis likelyMinutesPerUnit",
    ),
    highMinutesPerUnit: readForecastNumber(
      basis.highMinutesPerUnit,
      "basis highMinutesPerUnit",
    ),
    source: readForecastText(basis.source, "basis source"),
  };
}

/**
 * Read the saved low, likely and high minutes shown in the forecast; an absent rationale means no extra explanation was supplied.
 */
function readForecastRange(forecastInput: unknown): PlanEffortForecastRange {
  const range = readForecastObject(forecastInput, "range");
  return {
    lowMinutes: readForecastNumber(
      range.lowMinutes,
      "range lowMinutes",
      1,
      true,
    ),
    likelyMinutes: readForecastNumber(
      range.likelyMinutes,
      "range likelyMinutes",
      1,
      true,
    ),
    highMinutes: readForecastNumber(
      range.highMinutes,
      "range highMinutes",
      1,
      true,
    ),
    ...(range.rationale === undefined
      ? {}
      : { rationale: readForecastText(range.rationale, "range rationale") }),
  };
}

/**
 * Read the saved percentile pair so a reviewer can reproduce the forecast policy; malformed pairs throw before advice is available.
 */
function readForecastQuantiles(forecastInput: unknown): [number, number] {
  const pair = readForecastArray(forecastInput, "quantiles");
  requireForecastInput(
    pair.length === 2,
    "quantiles must contain two percentiles",
  );
  const low = readForecastNumber(pair[0], "low quantile");
  const high = readForecastNumber(pair[1], "high quantile");
  requireForecastInput(
    low > 0 && low < 50 && high > 50 && high < 100,
    "quantiles must straddle 50 within 0 and 100",
  );
  return [low, high];
}

/**
 * Read the project-relative identity, hash and completion time of selected history so a reviewer can identify the forecast's evidence.
 */
function readForecastHistory(
  forecastInput: unknown,
): PlanForecastRecord["history"][number] {
  const entry = readForecastObject(forecastInput, "history entry");
  const id = readForecastText(entry.id, "history id");
  requireForecastInput(
    !/^(?:\/|[A-Za-z]:)/u.test(id) &&
      !id.includes("\\") &&
      !id
        .split("/")
        .some((part) => part === ".." || part === "." || part === ""),
    "history id must be project-relative without traversal",
  );
  const sha256 = readForecastText(entry.sha256, "history sha256");
  requireForecastInput(
    /^[a-f0-9]{64}$/u.test(sha256),
    "history sha256 must be a lowercase SHA-256 digest",
  );
  return {
    id,
    sha256,
    completedAt: readForecastTimestamp(
      entry.completedAt,
      "history completedAt",
    ),
  };
}

/**
 * Read where remaining-work timing begins; null belongs to a whole-work forecast and missing input is invalid.
 */
function readReceiptCutoff(
  forecastInput: unknown,
): PlanForecastRecord["receiptCutoff"] {
  // A whole-work prediction starts before any recorded work, so it has no remaining-work cutoff.
  if (forecastInput === null) return null;
  const cutoff = readForecastObject(forecastInput, "receiptCutoff");
  return {
    segmentId: readForecastText(cutoff.segmentId, "cutoff segmentId"),
    recordedSeconds: readForecastNumber(
      cutoff.recordedSeconds,
      "cutoff recordedSeconds",
      0,
      true,
    ),
  };
}

/**
 * Read one issued prediction and its inputs so exports can preserve the original and each later revision separately.
 */
function readForecastRecord(forecastInput: unknown): PlanForecastRecord {
  const record = readForecastObject(forecastInput, "forecast record");
  const delta = readForecastObject(record.scopeDelta, "scopeDelta");
  return {
    id: readForecastText(record.id, "record id"),
    predecessorId:
      record.predecessorId === null
        ? null
        : readForecastText(record.predecessorId, "predecessorId"),
    reason: readForecastText(record.reason, "record reason"),
    issuedAt: readForecastTimestamp(record.issuedAt, "issuedAt"),
    methodVersion: readForecastChoice(
      record.methodVersion,
      ["legacy", "contextual-v1"],
      "methodVersion",
    ),
    workState: readForecastChoice(
      record.workState,
      [
        "fresh-implementation",
        "reconciliation",
        "verification-only",
        "unknown",
      ],
      "workState",
    ),
    scopeKind: readForecastChoice(
      record.scopeKind,
      ["whole", "remaining"],
      "scopeKind",
    ),
    unitRubric: readForecastText(record.unitRubric, "unitRubric"),
    items: readForecastArray(record.items, "items").map(readForecastItem),
    basis: readForecastBasis(record.basis),
    range: readForecastRange(record.range),
    quantiles: readForecastQuantiles(record.quantiles),
    selection: readForecastChoice(
      record.selection,
      ["context-matched", "selected-plan", "cold-prior"],
      "selection",
    ),
    selectionReason: readForecastText(
      record.selectionReason,
      "selectionReason",
    ),
    sourceVersion: readForecastText(record.sourceVersion, "sourceVersion"),
    sampleCount: readForecastNumber(record.sampleCount, "sampleCount", 0, true),
    history: readForecastArray(record.history, "history").map(
      readForecastHistory,
    ),
    scopeDelta: {
      added: readForecastIdentities(delta.added, "scopeDelta added"),
      removed: readForecastIdentities(delta.removed, "scopeDelta removed"),
    },
    receiptCutoff: readReceiptCutoff(record.receiptCutoff),
  };
}

/**
 * Read the Forecast records JSON contract: exactly one fence, schema version 1 and a nonempty ordered record list.
 *
 * @param section - authored section body; blank or malformed JSON cannot establish a forecast history
 * @returns parsed records; link and accounting checks follow before the method can activate
 * @throws Error for unreadable JSON, unsupported versions or invalid record fields
 */
function readForecastDocument(section: string): PlanForecastDocument {
  const fenced = section.match(
    /^(`{3,}|~{3,})json[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*$/u,
  );
  requireForecastInput(
    fenced !== null,
    "Forecast records requires exactly one JSON fence",
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(fenced[2] ?? "");
  } catch {
    // A pasted JSON record with a missing comma gets a fixed warning without echoing its potentially sensitive contents.
    throw new Error("Forecast records JSON is not parseable");
  }
  const document = readForecastObject(parsed, "forecast document");
  requireForecastInput(
    document.schemaVersion === 1,
    "unsupported Forecast records schemaVersion",
  );
  const records = readForecastArray(document.records, "records").map(
    readForecastRecord,
  );
  requireForecastInput(
    records.length > 0,
    "Forecast records must contain an original",
  );
  return { schemaVersion: 1, records };
}

/**
 * Read optional forecast metadata for CLI previews and checks; catches parsing errors, adds warnings and disables invalid methods.
 *
 * @param content - source Markdown; absent declarations preserve the legacy export shape
 * @param recordSections - visible Forecast records bodies; empty means no record section was supplied
 * @param warnings - diagnostics to append for the author; existing warnings remain in place
 * @returns metadata including raw declarations, or undefined when the author supplied neither method nor records
 */
export function readPlanForecastContext(
  content: string,
  recordSections: string[],
  warnings: string[],
): PlanForecastContext | undefined {
  const declaredMethods = readRenderedMarkdownFieldValues(
    content,
    "Forecast method",
  );
  // Older milestones have no context fields, so their existing export shape stays intact.
  if (declaredMethods.length === 0 && recordSections.length === 0)
    return undefined;
  const context: PlanForecastContext = {
    declaredMethods,
    method: null,
    recordSections,
  };
  try {
    requireForecastInput(
      declaredMethods.length <= 1,
      "multiple Forecast method values supplied",
    );
    context.method =
      declaredMethods.length === 0
        ? "legacy"
        : readForecastChoice<PlanForecastMethod>(
            declaredMethods[0],
            ["legacy", "contextual-v1"],
            "Forecast method",
          );
    requireForecastInput(
      recordSections.length <= 1,
      "multiple Forecast records sections supplied",
    );
    // An explicit section gives the author a reproducible history to export, even when the method remains legacy.
    if (recordSections.length === 1)
      context.document = readForecastDocument(recordSections[0] ?? "");
    requireForecastInput(
      context.method !== "contextual-v1" || context.document !== undefined,
      "contextual-v1 requires Forecast records",
    );
  } catch (error) {
    // Unsupported method text or malformed pasted records remain exportable, with a warning instead of silently enabled advice.
    context.method = null;
    warnings.push(
      `forecast context: ${error instanceof Error ? error.message : "invalid metadata"}`,
    );
  }
  return context;
}

/**
 * Remove visible method lines from section prose so Markdown export emits each authored selector only in the header.
 *
 * @param content - original milestone Markdown; hidden examples remain untouched
 * @returns a section-parser view without method declarations; attached comments keep their delimiters and contents
 */
export function maskForecastMethodLines(content: string): string {
  const declarations = Array.from(
    maskNonRenderedMarkdown(content).matchAll(
      /^(?:\*\*Forecast method:\*\*|Forecast method:)[^\n]*$/gimu,
    ),
  );
  let sectionContent = content;
  // A method pasted after Stop belongs in the exported header, so its old position must not duplicate the selector as section prose.
  for (const declaration of declarations.reverse()) {
    const sourceLine = content.slice(
      declaration.index,
      declaration.index + declaration[0].length,
    );
    // Keep a real comment's opener together with its later lines. Leave it at column zero
    // so removing the field cannot turn the opener into indented code.
    const commentStart = Array.from(sourceLine.matchAll(/<!--/gu)).find(
      (comment) =>
        declaration[0].slice(comment.index, comment.index + 4) === "    ",
    )?.index;
    sectionContent =
      sectionContent.slice(0, declaration.index) +
      (commentStart === undefined ? "" : sourceLine.slice(commentStart)) +
      sectionContent.slice(declaration.index + declaration[0].length);
  }
  return sectionContent;
}

/**
 * Total saved item minutes by category so the checker can validate the issued headline independently of later checklist edits.
 *
 * @param snapshot - issued work items; an empty list contributes zero in each category and is rejected by record validation
 * @returns product, proof and other allocations; these totals never select history or size work units
 */
export function forecastAllocation(
  snapshot: PlanForecastRecord,
): PlanEffortSplit {
  const totals: PlanEffortSplit = { product: 0, proof: 0, other: 0 };
  // Each saved task or proof item contributes to the split the author originally approved.
  for (const workItem of snapshot.items)
    totals[workItem.category] += workItem.estimateMinutes;
  return totals;
}

/**
 * Find the last whole-work prediction that owns the milestone headline; a remaining-work revision cannot replace it.
 *
 * @param record - parsed milestone; absent or unreadable forecast records have no saved headline to inspect
 * @returns the issued whole-work record, or undefined when none is available
 */
export function issuedPlanForecast(
  record: PlanExportRecord,
): PlanForecastRecord | undefined {
  return record.forecastContext?.document?.records.findLast(
    (snapshot) => snapshot.scopeKind === "whole",
  );
}

/** Compare identity sets without making their storage order part of scope meaning. */
function sameIdentities(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}

/** Check a snapshot's count, allocation, provenance and compatible context. */
function collectSnapshotProblems(snapshot: PlanForecastRecord): string[] {
  const problems = validateForecastBasis(
    snapshot.basis,
    snapshot.range,
    snapshot.items.length,
  );
  const ids = snapshot.items.map((workItem) => workItem.id);
  // Reusing an item ID would make later scope additions and removals ambiguous.
  if (new Set(ids).size !== ids.length)
    problems.push("duplicate item identities");
  const minutes = snapshot.items.reduce(
    (sum, workItem) => sum + workItem.estimateMinutes,
    0,
  );
  // The displayed likely time must include every saved item allocation exactly once.
  if (minutes !== snapshot.range.likelyMinutes)
    problems.push("item allocations must equal snapshot likely minutes");
  // Unknown sizing rules cannot be compared safely, so the author must retain the issued values and resolve the rubric.
  if (
    !["legacy-checkbox-v1", "observable-change-v1"].includes(
      snapshot.unitRubric,
    )
  )
    problems.push("unsupported unitRubric; retain the issued values");
  // The sample count shown with advice must describe the evidence actually selected.
  if (snapshot.sampleCount !== snapshot.history.length)
    problems.push("sampleCount must equal selected history length");
  const historyIds = snapshot.history.map((entry) => entry.id);
  // Listing the same milestone twice would overstate how much history supports the forecast.
  if (new Set(historyIds).size !== historyIds.length)
    problems.push("duplicate history identities");
  // Work completed at or after issue time was unavailable when this prediction was made.
  if (
    snapshot.history.some(
      (entry) => Date.parse(entry.completedAt) >= Date.parse(snapshot.issuedAt),
    )
  )
    problems.push("history must complete strictly before issuedAt");
  // Matching needs known work context and three available samples; this threshold does not establish predictive accuracy.
  if (
    snapshot.selection === "context-matched" &&
    (snapshot.workState === "unknown" || snapshot.sampleCount < 3)
  )
    problems.push(
      "context-matched selection requires known context and at least three samples",
    );
  return problems;
}

/** Validate append-only revision links and explicit scope changes. */
function collectRevisionProblems(
  current: PlanForecastRecord,
  previous: PlanForecastRecord | undefined,
): string[] {
  // The first record must establish the whole-work prediction before any revision can refer to it.
  if (!previous) {
    return collectOriginalProblems(current);
  }
  const problems: string[] = [];
  // Each appended prediction must identify the immediately preceding record at a later issue time.
  if (
    current.predecessorId !== previous.id ||
    Date.parse(current.issuedAt) <= Date.parse(previous.issuedAt)
  )
    problems.push(
      "revisions must link to the previous record at a later issue time",
    );
  // A remaining-work update cannot later be presented as a replacement original.
  if (current.scopeKind === "whole" && previous.scopeKind === "remaining")
    problems.push(
      "a whole-work revision cannot replace a remaining-work record",
    );
  const before = previous.items.map((workItem) => workItem.id);
  const after = current.items.map((workItem) => workItem.id);
  // The revision must explain exactly which saved item IDs entered or left its forecast scope.
  if (
    !sameIdentities(
      current.scopeDelta.added,
      after.filter((id) => !before.includes(id)),
    ) ||
    !sameIdentities(
      current.scopeDelta.removed,
      before.filter((id) => !after.includes(id)),
    )
  ) {
    problems.push(
      "scopeDelta must match the added and removed item identities",
    );
  }
  return problems;
}

/** Require the author's first record to describe all work before any revision or receipt cutoff exists. */
function collectOriginalProblems(original: PlanForecastRecord): string[] {
  return original.predecessorId === null &&
    original.scopeKind === "whole" &&
    original.scopeDelta.added.length === 0 &&
    original.scopeDelta.removed.length === 0
    ? []
    : ["the original must be whole-work with no predecessor or scope delta"];
}

/** Validate the boundary between consumed receipt time and a remaining forecast. */
function collectCutoffProblems(
  snapshot: PlanForecastRecord,
  record: PlanExportRecord,
): string[] {
  // Whole-work forecasts cover the full receipt; only remaining-work advice can subtract earlier recorded time.
  if (snapshot.scopeKind === "whole")
    return snapshot.receiptCutoff === null
      ? []
      : ["whole-work records cannot have a receipt cutoff"];
  return collectRemainingCutoffProblems(snapshot, record);
}

/** Reject a remaining-work starting point that omits already recorded work or depends on an unfinished receipt row. */
function collectRemainingCutoffProblems(
  snapshot: PlanForecastRecord,
  record: PlanExportRecord,
): string[] {
  const cutoff = snapshot.receiptCutoff;
  // Without a closed cutoff, the author cannot separate time already spent from time still being forecast.
  if (!cutoff)
    return ["remaining-work records require a closed receipt cutoff"];
  // A copied receipt with duplicate rows or conflicting totals cannot establish when this remaining forecast starts.
  if (record.warnings.some((warning) => warning.startsWith("timing receipt")))
    return ["receipt cutoff requires a valid timing receipt"];
  // An absent receipt has no recorded boundary, and discarded rows cannot supply usable elapsed time.
  const segments =
    record.timingReceipt?.segments.filter(
      (segment) => segment.state !== "discarded",
    ) ?? [];
  const index = segments.findIndex(
    (segment) => segment.id === cutoff.segmentId,
  );
  // A cutoff copied from another milestone cannot identify where this milestone's remaining work begins.
  if (index < 0)
    return ["receipt cutoff must identify a closed segment in this milestone"];
  const prefix = segments.slice(0, index + 1);
  const issued = Date.parse(snapshot.issuedAt) / 1000;
  // An open, damaged or later-ending receipt row cannot be counted as work completed before this forecast was issued.
  if (
    prefix.some(
      (segment) =>
        segment.state !== "closed" ||
        segment.endEpochSeconds === null ||
        segment.endEpochSeconds > issued ||
        segment.seconds !== segment.endEpochSeconds - segment.startEpochSeconds,
    )
  ) {
    return [
      "receipt cutoff requires intact closed segments ending by issuedAt",
    ];
  }
  // The saved cutoff must equal the actual closed-row total, not an estimated or rounded Actual value.
  if (
    prefix.reduce((sum, segment) => sum + (segment.seconds ?? 0), 0) !==
    cutoff.recordedSeconds
  )
    return ["receipt cutoff seconds must equal the closed segment prefix"];
  // Excluding work that had already started would make the remaining forecast appear faster than the recorded timeline.
  if (
    segments
      .slice(index + 1)
      .some((segment) => segment.startEpochSeconds < issued)
  )
    return ["receipt cutoff omits work already started before issuedAt"];
  return [];
}

/** Compare whole-work accounting exactly; remaining budgets bound work still unchecked as the author records progress. */
function collectCurrentWorkProblems(
  snapshot: PlanForecastRecord,
  record: PlanExportRecord,
): string[] {
  const liveItems = [
    ...record.tasks,
    ...record.testingGateItems,
    ...record.midProofItems,
  ];
  const items = liveItems.filter(
    (workItem) => snapshot.scopeKind === "whole" || !workItem.isChecked,
  );
  // Omitted administrative work adds no estimate or unit to the author's current checklist.
  const work = [...items, record.planAdminEstimate ?? {}];
  const problems = collectLiveItemProblems(snapshot, record, liveItems);
  // Newly added unchecked work needs a revision; checking off work after issue can reduce the remaining count.
  if (
    hasCurrentForecastMismatch(
      countAgentWorkUnits(work),
      snapshot.basis.agentWorkUnits,
      snapshot.scopeKind,
    )
  )
    problems.push(
      "live work-unit count must fit the current forecast snapshot; append a revision for changed scope",
    );
  const totals = sumTaskEstimates(work);
  const allocation = forecastAllocation(snapshot);
  // Check each category so a changed verification budget cannot hide inside a matching total.
  for (const category of ["product", "proof", "other"] as const) {
    // Missing estimates contribute zero; supplied allocations must still fit the applicable whole or remaining budget.
    if (
      hasCurrentForecastMismatch(
        totals?.[category] ?? 0,
        allocation[category],
        snapshot.scopeKind,
      )
    )
      problems.push(
        `live ${category} allocation must fit the current forecast snapshot; append a revision for changed scope`,
      );
  }
  return problems;
}

/** Resolve counted checklist work to saved IDs; totals alone cannot detect a same-size replacement. */
function collectLiveItemProblems(
  snapshot: PlanForecastRecord,
  record: PlanExportRecord,
  items: PlanExportRecord["tasks"],
): string[] {
  const work = [
    ...items,
    {
      ...record.planAdminEstimate,
      text: "Plan/admin overhead",
      isChecked: false,
    },
  ].filter((workItem) => countAgentWorkUnits([workItem]) > 0);
  const history = record.forecastContext?.document?.records ?? [];
  const usedIds = new Set<string>();
  for (const workItem of work) {
    const description = workItem.text
      // Supporting lists follow the parent's estimate in flattened checklist text.
      .replace(
        /\(est:\s*\d+\s*min(?:ute)?s?\s+[a-z]+\)(?=\s+(?:[-*+]|\d+[.)])\s|$)/iu,
        "",
      )
      .replace(/\s+/gu, " ")
      .trim();
    // Match authored scope, excluding allocation minutes so later completion cannot change identity.
    const matchesItem = (saved: PlanForecastItem): boolean =>
      saved.description.replace(/\s+/gu, " ").trim() === description &&
      saved.category === workItem.estimateCategory;
    const identities = new Set(
      history.flatMap((issued) =>
        issued.items.filter(matchesItem).map((saved) => saved.id),
      ),
    );
    const id = identities.values().next().value;
    // Ambiguous descriptions cannot identify which original item was reopened. Require
    // distinct descriptions and a revision instead of borrowing another item's budget.
    if (
      identities.size !== 1 ||
      id === undefined ||
      usedIds.has(id) ||
      !coversLiveForecastItem(snapshot, matchesItem, workItem.isChecked)
    ) {
      return [
        "live work items must uniquely match the current forecast snapshot by description and category; append a revision for changed scope (admin description: Plan/admin overhead)",
      ];
    }
    usedIds.add(id);
  }
  if (snapshot.items.some((saved) => !usedIds.has(saved.id))) {
    return [
      "current forecast items must remain in the live checklist; append a revision before removing scope",
    ];
  }
  return [];
}

/** A residual forecast may omit completed historical work, while every other live item needs current coverage. */
function coversLiveForecastItem(
  snapshot: PlanForecastRecord,
  matchesItem: (saved: PlanForecastItem) => boolean,
  isChecked: boolean,
): boolean {
  return (
    snapshot.items.some(matchesItem) ||
    (snapshot.scopeKind === "remaining" && isChecked)
  );
}

/** Checking off work reduces a remaining budget without rewriting the prediction issued at its receipt cutoff. */
function hasCurrentForecastMismatch(
  current: number,
  forecast: number,
  scope: PlanForecastRecord["scopeKind"],
): boolean {
  return scope === "whole" ? current !== forecast : current > forecast;
}

/** Keep the visible whole-work headline tied to its issued inputs even after a smaller remaining forecast is appended. */
function collectIssuedHeaderProblems(record: PlanExportRecord): string[] {
  const issued = issuedPlanForecast(record);
  // Legacy or unreadable records have no saved headline to compare; their parser diagnostics remain authoritative.
  if (!issued) return [];
  const problems: string[] = [];
  // A smaller remaining estimate must not overwrite the whole-work point the author originally received.
  if (record.effort?.totalMinutes !== issued.range.likelyMinutes)
    problems.push(
      "issued headline must retain the whole-work snapshot's likely minutes",
    );
  const range = record.effort?.forecastRange;
  // The original range remains visible even when later advice covers only unfinished work.
  if (
    !range ||
    ["lowMinutes", "likelyMinutes", "highMinutes"].some(
      (key) => Reflect.get(range, key) !== Reflect.get(issued.range, key),
    )
  )
    problems.push("issued Forecast range must retain the whole-work snapshot");
  const basis = record.effort?.forecastBasis;
  // Changing the displayed rates or unit count would hide how the original forecast was derived.
  if (
    !basis ||
    [
      "agentWorkUnits",
      "lowMinutesPerUnit",
      "likelyMinutesPerUnit",
      "highMinutesPerUnit",
    ].some((key) => Reflect.get(basis, key) !== Reflect.get(issued.basis, key))
  )
    problems.push("issued Forecast basis must retain the whole-work snapshot");
  return problems;
}

/**
 * Check saved forecast inputs, revision links and current work before the author relies on contextual advice.
 *
 * @param record - parsed milestone; legacy absence adds no requirements
 * @returns actionable diagnostics, empty when no context is present or every supplied record is valid
 */
export function collectPlanForecastProblems(
  record: PlanExportRecord,
): string[] {
  const snapshots = record.forecastContext?.document?.records;
  // Missing context is normal for existing plans and adds no new validation obligations.
  if (!snapshots) return [];
  const problems: string[] = [];
  const ids = snapshots.map((snapshot) => snapshot.id);
  // Each issue needs a distinct identity so revisions and frozen registrations can refer to it unambiguously.
  if (new Set(ids).size !== ids.length)
    problems.push("duplicate forecast record identities");
  // Report each record's problems together so the author can repair a specific original or revision.
  for (const [index, snapshot] of snapshots.entries()) {
    const local = [
      ...collectSnapshotProblems(snapshot),
      ...collectRevisionProblems(snapshot, snapshots[index - 1]),
      ...collectCutoffProblems(snapshot, record),
      ...collectIssueTimeProblems(snapshot, record),
    ];
    problems.push(...local.map((problem) => `record ${index + 1}: ${problem}`));
  }
  problems.push(...collectIssuedHeaderProblems(record));
  const current = snapshots.at(-1);
  // The newest prediction bounds current work; earlier snapshots retain the inputs they were issued with.
  if (current) problems.push(...collectCurrentWorkProblems(current, record));
  return problems;
}

/** Stop a forecast written after the clock started from claiming to be the original whole-work prediction. */
function collectIssueTimeProblems(
  snapshot: PlanForecastRecord,
  record: PlanExportRecord,
): string[] {
  const firstStart = record.timingReceipt?.segments.at(0)?.startEpochSeconds;
  return snapshot.scopeKind === "whole" &&
    firstStart !== undefined &&
    Date.parse(snapshot.issuedAt) / 1000 >= firstStart
    ? ["whole-work forecasts must be issued before work starts"]
    : [];
}
