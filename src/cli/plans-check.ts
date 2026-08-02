/**
 * Local contract checker behind `plans check`. Default mode preserves legacy
 * effort arithmetic; strict mode additionally validates current-plan structure,
 * local dependencies, and lifecycle snapshots. Plan-level 70/20/10 mix drift
 * stays advisory. User-invoked only - never part of audit or quality gates.
 */
import { CLIError } from "./cli-error.js";
import { writeOutput } from "./cli-output.js";
import type { ParsedCLI } from "./cli-types.js";
import {
  isNumericActual,
  type PlanEffortNumericActual,
  type PlanEffortSplit,
} from "./plans-effort.js";
import {
  handlePlansExportCommand,
  isPlansExportInputError,
  loadPlanExportRecords,
  redactPlanExportRecord,
  type PlanExportRecord,
} from "./plans-export.js";
import {
  handlePlansTimeCommand,
  type PlanTimingSummary,
} from "./plans-time.js";

/** Plan-level effort-mix target percentages from goat-plan's estimation guidance. */
const MIX_TARGET: PlanEffortSplit = { product: 70, proof: 20, other: 10 };

// Advisory threshold: 15 percentage points of drift keeps one small proof-heavy
// milestone from flagging a healthy plan while still catching sustained imbalance;
// retune this limit once real Actual data accumulates.
const MIX_TOLERANCE_POINTS = 15;

/** Category iteration order for split arithmetic and rendering. */
const CATEGORIES = ["product", "proof", "other"] as const;

/** Canonical lifecycle vocabulary accepted by strict current-plan validation. */
const VALID_STATUSES = new Set([
  "not-started",
  "in-progress",
  "testing-gate",
  "human-verification-pending",
  "blocked",
  "abandoned",
  "complete",
]);

/** States that represent one currently active execution or review boundary. */
const ACTIVE_STATUSES = new Set([
  "in-progress",
  "testing-gate",
  "human-verification-pending",
]);

/** Missing canonical fields that strict mode can determine without semantic guesses. */
const STRICT_STRUCTURAL_WARNINGS = new Set([
  "missing status",
  "missing scope",
  "missing tasks",
  "missing proof",
  "missing exit criteria",
  "missing stop/rescope",
]);

/**
 * Render `(18 product / 5 proof / 2 other)`-style split text for report lines.
 * Use wherever the report echoes a split back in the same notation the plan
 * author wrote, so the fix is a copy-edit away.
 *
 * @param split - minutes per category; zeros render literally so gaps stay visible
 * @returns the parenthesised split text
 */
function renderSplit(split: PlanEffortSplit): string {
  return `(${split.product} product / ${split.proof} proof / ${split.other} other)`;
}

/**
 * Decide which parser warnings are fatal under the selected compatibility mode.
 *
 * @param warning - one parser warning from the milestone record
 * @param strict - whether strict current-plan validation is selected
 * @param receiptIsClaimed - whether an Actual derives its authority from the receipt
 * @returns true when the warning should become a check error
 */
function isValidationWarning(
  warning: string,
  strict: boolean,
  receiptIsClaimed: boolean,
): boolean {
  if (warning.includes("estimate not parseable")) return true;

  // Drifted range notation is as fatal as a drifted estimate: both hide real numbers.
  if (warning === "forecast range not parseable") return true;
  if (!strict) return false;
  return (
    warning.includes("actual effort not parseable") ||
    (receiptIsClaimed && warning.startsWith("timing receipt")) ||
    /^multiple .+ values supplied$/u.test(warning) ||
    STRICT_STRUCTURAL_WARNINGS.has(warning) ||
    /^conflicting .+ representations$/u.test(warning)
  );
}

/**
 * Convert fatal parser warnings into source-labelled check errors.
 *
 * A receipt is evidence for a claim, so its shape is only fatal when an Actual
 * claims authority from it. Hand-written receipts predating `plans time` sit
 * beside retrospective Actuals that never cite them; failing the plan on their
 * shape would invalidate finished work over decoration nothing depends on.
 * `measured` Actuals still fail twice over - here and in the reconciliation
 * check that compares their minutes against the receipt allocation.
 *
 * @param record - one parsed milestone
 * @param strict - whether strict current-plan validation is selected
 * @returns error lines naming the milestone; empty means no warning was fatal
 */
function collectWarningErrors(
  record: PlanExportRecord,
  strict: boolean,
): string[] {
  const receiptIsClaimed = record.effort?.actual?.state === "measured";
  return record.warnings
    .filter((warning) => isValidationWarning(warning, strict, receiptIsClaimed))
    .map((warning) => `${record.sourceFile}: ${warning}`);
}

/** Read one category total without spreading optional-record checks through arithmetic. */
function categoryMinutes(
  split: PlanEffortSplit | undefined,
  category: keyof PlanEffortSplit,
): number {
  if (!split) return 0;
  return split[category];
}

/** Compare declared split categories with either strict counted work or legacy task sums. */
function collectCategoryErrors(
  record: PlanExportRecord,
  split: PlanEffortSplit,
  strict: boolean,
): string[] {
  const errors: string[] = [];
  for (const category of CATEGORIES) {
    const taskMinutes = categoryMinutes(record.taskEstimateTotals, category);
    const countedMinutes = categoryMinutes(record.workEstimateTotals, category);
    if (strict) {
      if (countedMinutes !== split[category]) {
        errors.push(
          `${record.sourceFile}: ${category} counted work (${countedMinutes} min) does not equal the split component (${split[category]} min)`,
        );
      }
      continue;
    }
    if (taskMinutes > split[category]) {
      errors.push(
        `${record.sourceFile}: ${category} task estimates (${taskMinutes} min) exceed the split component (${split[category]} min)`,
      );
    }
  }
  return errors;
}

/** Check a declared headline split against its total and counted work. */
function collectSplitErrors(
  record: PlanExportRecord,
  strict: boolean,
): string[] {
  const errors: string[] = [];
  const effort = record.effort;
  if (!effort) return errors;
  const split = effort.split;
  if (!split) {
    if (strict) {
      errors.push(
        `${record.sourceFile}: strict mode requires a product/proof/other split`,
      );
    }
    return errors;
  }

  const splitSum = split.product + split.proof + split.other;
  if (splitSum !== effort.totalMinutes) {
    errors.push(
      `${record.sourceFile}: split ${renderSplit(split)} sums to ${splitSum} min but the headline says ${effort.totalMinutes} min`,
    );
  }
  errors.push(...collectCategoryErrors(record, split, strict));
  return errors;
}

/**
 * Check an optional forecast band against its own ordering and the headline.
 *
 * Validation exists only when the band does: a milestone that forecasts one
 * point stays valid, so this returns nothing rather than demanding notation
 * legacy and in-flight plans were never written with.
 */
function collectForecastRangeErrors(record: PlanExportRecord): string[] {
  const effort = record.effort;
  const range = effort?.forecastRange;
  if (!effort || !range) return [];

  const errors: string[] = [];
  if (
    range.lowMinutes > range.likelyMinutes ||
    range.likelyMinutes > range.highMinutes
  ) {
    errors.push(
      `${record.sourceFile}: forecast range must satisfy low <= likely <= high (${range.lowMinutes}-${range.likelyMinutes}-${range.highMinutes} min)`,
    );
  }

  // One milestone cannot forecast two different centres, whatever the band's width.
  if (range.likelyMinutes !== effort.totalMinutes) {
    errors.push(
      `${record.sourceFile}: forecast range likely (${range.likelyMinutes} min) must equal the Effort estimate total (${effort.totalMinutes} min)`,
    );
  }
  return errors;
}

/** Require estimates on every work item that participates in the selected mode. */
function collectCoverageErrors(
  record: PlanExportRecord,
  strict: boolean,
): string[] {
  const errors: string[] = [];
  const unestimatedTasks = record.tasks.filter(
    (task) => task.estimateMinutes === undefined,
  ).length;
  if (unestimatedTasks > 0) {
    errors.push(
      `${record.sourceFile}: ${unestimatedTasks} task(s) missing an (est: ...) entry under a declared effort line`,
    );
  }
  if (!strict) return errors;

  const unestimatedTestingItems = record.testingGateItems.filter(
    (item) => item.estimateMinutes === undefined,
  ).length;
  if (unestimatedTestingItems > 0) {
    errors.push(
      `${record.sourceFile}: ${unestimatedTestingItems} testing gate item(s) missing an (est: ...) entry`,
    );
  }

  const unestimatedMidProofItems = record.midProofItems.filter(
    (item) => item.estimateMinutes === undefined,
  ).length;
  if (unestimatedMidProofItems > 0) {
    errors.push(
      `${record.sourceFile}: ${unestimatedMidProofItems} mid-proof item(s) missing an (est: ...) entry`,
    );
  }
  return errors;
}

/** Check machine-readable Actual requirements for strict, current-format plans. */
function collectActualErrors(record: PlanExportRecord): string[] {
  const errors: string[] = [];
  const actual = record.effort?.actual;
  const status = record.status.trim().toLowerCase();
  if (!actual) {
    if (status === "complete" || status === "human-verification-pending") {
      errors.push(
        `${record.sourceFile}: ${status} milestone requires a structured Actual with total and product/proof/other split`,
      );
    }
    return errors;
  }
  if (status === "not-started") {
    errors.push(
      `${record.sourceFile}: not-started milestone must not include Actual before work begins`,
    );
  }
  if (!isNumericActual(actual)) {
    return errors;
  }
  errors.push(...collectNumericActualErrors(record, actual));
  return errors;
}

/** Validate the split shared by measured and retrospective numeric Actuals. */
function collectNumericActualErrors(
  record: PlanExportRecord,
  actual: PlanEffortNumericActual,
): string[] {
  if (!actual.split) {
    return [
      `${record.sourceFile}: structured Actual requires a product/proof/other split`,
    ];
  }
  const errors: string[] = [];
  const actualSplitSum =
    actual.split.product + actual.split.proof + actual.split.other;
  if (actualSplitSum !== actual.totalMinutes) {
    errors.push(
      `${record.sourceFile}: Actual split ${renderSplit(actual.split)} sums to ${actualSplitSum} min but Actual says ${actual.totalMinutes} min`,
    );
  }
  if (actual.state === "measured") {
    errors.push(...collectMeasuredActualErrors(record, actual, actual.split));
  }
  return errors;
}

/** Require measured minutes and receipt prose to match one finalized summary. */
function collectMeasuredActualErrors(
  record: PlanExportRecord,
  actual: PlanEffortNumericActual,
  split: PlanEffortSplit,
): string[] {
  const receipt = record.timingReceipt;
  if (receipt?.state !== "finalized" || receipt.summary === undefined) {
    return [
      `${record.sourceFile}: measured Actual requires a finalized embedded Timing Receipt`,
    ];
  }
  const errors = collectClaimedSecondsErrors(
    record.sourceFile,
    actual.reason,
    receipt.summary.totalSeconds,
  );
  if (!actualMatchesTimingSummary(actual, split, receipt.summary)) {
    errors.push(
      `${record.sourceFile}: measured Actual total and split must match the Timing Receipt minute allocation`,
    );
  }
  return errors;
}

/** Validate the fixed measured-reason grammar and its raw-second claim. */
function collectClaimedSecondsErrors(
  sourceFile: string,
  reason: string,
  receiptSeconds: number,
): string[] {
  const captured = reason.match(
    /^receipt\s+(\d+)\s+recorded-unpaused seconds$/u,
  )?.[1];
  if (captured === undefined) {
    return [
      `${sourceFile}: measured Actual reason must name receipt <seconds> recorded-unpaused seconds`,
    ];
  }
  const claimedSeconds = Number(captured);
  if (!Number.isSafeInteger(claimedSeconds)) {
    return [
      `${sourceFile}: measured Actual reason must name receipt <seconds> recorded-unpaused seconds`,
    ];
  }
  return claimedSeconds === receiptSeconds
    ? []
    : [
        `${sourceFile}: measured Actual receipt says ${claimedSeconds} seconds but Timing Receipt says ${receiptSeconds}`,
      ];
}

/** Compare numeric Actual fields with the deterministic receipt allocation. */
function actualMatchesTimingSummary(
  actual: PlanEffortNumericActual,
  split: PlanEffortSplit,
  summary: PlanTimingSummary,
): boolean {
  return (
    actual.totalMinutes === summary.totalMinutes &&
    split.product === summary.minutes.product &&
    split.proof === summary.minutes.proof &&
    split.other === summary.minutes.other
  );
}

/** Count open checklist items without treating their text as approval evidence. */
function countOpenItems(
  items: PlanExportRecord["tasks"],
  predicate: (item: PlanExportRecord["tasks"][number]) => boolean = () => true,
): number {
  return items.filter((item) => !item.isChecked && predicate(item)).length;
}

/** Human ownership is explicit metadata, never inferred from prose or checkbox state. */
function isHumanOwnedItem(
  item: PlanExportRecord["testingGateItems"][number],
): boolean {
  return /\[human\]/iu.test(item.text);
}

/** Validate the executor-owned snapshot before a human receives the milestone. */
function collectHumanPendingErrors(
  record: PlanExportRecord,
  openTasks: number,
): string[] {
  const errors: string[] = [];
  if (openTasks > 0) {
    errors.push(
      `${record.sourceFile}: human-verification-pending milestone has open implementation tasks`,
    );
  }
  const openExecutorProof = countOpenItems(
    record.testingGateItems,
    (item) => !isHumanOwnedItem(item),
  );
  if (openExecutorProof > 0) {
    errors.push(
      `${record.sourceFile}: executor proof item remains open at human-verification-pending`,
    );
  }
  if (countOpenItems(record.midProofItems) > 0) {
    errors.push(
      `${record.sourceFile}: executor mid-proof item remains open at human-verification-pending`,
    );
  }
  if (countOpenItems(record.exitCriteriaItems) > 0) {
    errors.push(
      `${record.sourceFile}: human-verification-pending milestone has open exit criteria`,
    );
  }
  return errors;
}

/** Validate the fully closed snapshot for a completed milestone. */
function collectCompleteSnapshotErrors(
  record: PlanExportRecord,
  openTasks: number,
): string[] {
  const errors: string[] = [];
  if (openTasks > 0) {
    errors.push(
      `${record.sourceFile}: complete milestone has open implementation tasks`,
    );
  }
  if (countOpenItems(record.testingGateItems) > 0) {
    errors.push(
      `${record.sourceFile}: complete milestone has open proof items`,
    );
  }
  if (countOpenItems(record.midProofItems) > 0) {
    errors.push(
      `${record.sourceFile}: complete milestone has open mid-proof items`,
    );
  }
  if (countOpenItems(record.exitCriteriaItems) > 0) {
    errors.push(
      `${record.sourceFile}: complete milestone has open exit criteria`,
    );
  }
  // A completed milestone cannot still show the user a running plan clock.
  if (record.timingReceipt?.state === "active") {
    errors.push(
      `${record.sourceFile}: complete milestone must not have an active Timing Receipt`,
    );
  }
  return errors;
}

/** Reject every completed-looking checkbox in a not-started snapshot. */
function collectNotStartedSnapshotErrors(
  record: PlanExportRecord,
  checkedTasks: number,
): string[] {
  const errors: string[] = [];
  if (checkedTasks > 0) {
    errors.push(
      `${record.sourceFile}: not-started milestone has checked implementation tasks`,
    );
  }
  if (record.testingGateItems.some((item) => item.isChecked)) {
    errors.push(
      `${record.sourceFile}: not-started milestone has checked proof items`,
    );
  }
  if (record.midProofItems.some((item) => item.isChecked)) {
    errors.push(
      `${record.sourceFile}: not-started milestone has checked mid-proof items`,
    );
  }
  if (record.exitCriteriaItems.some((item) => item.isChecked)) {
    errors.push(
      `${record.sourceFile}: not-started milestone has checked exit criteria`,
    );
  }

  // Any receipt means timing already began; paused work contradicts not-started just as active work does.
  if (record.timingReceipt !== undefined) {
    errors.push(
      `${record.sourceFile}: not-started milestone must not include a Timing Receipt`,
    );
  }
  return errors;
}

/** Validate one milestone's current lifecycle snapshot without reconstructing history. */
function collectLifecycleErrors(record: PlanExportRecord): string[] {
  const status = record.status.trim().toLowerCase();
  const errors: string[] = [];

  // Missing status already has a dedicated structural diagnostic.
  if (status === "unknown" || status.length === 0) return errors;
  if (!VALID_STATUSES.has(status)) {
    return [`${record.sourceFile}: unsupported status \`${status}\``];
  }

  const openTasks = countOpenItems(record.tasks);
  const checkedTasks = record.tasks.length - openTasks;
  if (status === "not-started") {
    errors.push(...collectNotStartedSnapshotErrors(record, checkedTasks));
  }
  if (status === "testing-gate" && openTasks > 0) {
    errors.push(
      `${record.sourceFile}: testing-gate milestone has open implementation tasks`,
    );
  }
  if (status === "human-verification-pending") {
    errors.push(...collectHumanPendingErrors(record, openTasks));
  }
  if (status === "complete") {
    errors.push(...collectCompleteSnapshotErrors(record, openTasks));
  }
  return errors;
}

/**
 * Collect deterministic structure, lifecycle, and arithmetic errors for one milestone.
 * Branches gate on what the author declared because each declaration creates
 * its own obligation: notation errors always apply, split-sum errors need a
 * declared split, task-coverage errors need declared tasks - which is why a
 * legacy milestone falls through every check untouched.
 *
 * @param record - parsed milestone
 * @param strict - whether current-format authoring obligations are mandatory
 * @returns error lines naming the milestone; empty means its arithmetic holds up
 */
function collectMilestoneErrors(
  record: PlanExportRecord,
  strict: boolean,
): string[] {
  const errors = collectWarningErrors(record, strict);
  if (strict) {
    errors.push(...collectLifecycleErrors(record));
  }

  // Default mode preserves legacy plans; strict authoring requires the current notation.
  if (!record.effort) {
    if (strict) {
      errors.push(
        `${record.sourceFile}: strict mode requires an Effort estimate with a product/proof/other split`,
      );
    }
    return errors;
  }

  errors.push(...collectSplitErrors(record, strict));
  errors.push(...collectCoverageErrors(record, strict));
  errors.push(...collectForecastRangeErrors(record));
  if (strict) {
    errors.push(...collectActualErrors(record));
  }
  return errors;
}

/** Parsed filename identity used for local dependency validation. */
interface MilestoneIdentity {
  id: string;
  numericId: string;
  record: PlanExportRecord;
  dependencies: string[];
}

/** Extract the exact local milestone ID and its zero-insensitive duplicate key. */
function readMilestoneIdentity(
  record: PlanExportRecord,
): MilestoneIdentity | null {
  const match = record.sourceFile.match(/^m(\d+).*\.md$/iu);
  if (!match?.[1]) return null;
  const id = `M${match[1]}`;
  return {
    id,
    numericId: match[1].replace(/^0+(?=\d)/u, ""),
    record,
    dependencies: [],
  };
}

/** Parse strict dependency metadata while keeping narrative sequencing out of the graph. */
function readDependencies(
  identity: MilestoneIdentity,
  requiresField: boolean,
  errors: string[],
): string[] {
  const rawDependencies = identity.record.dependencies.trim();
  if (rawDependencies.length === 0) {
    if (requiresField) {
      errors.push(
        `${identity.record.sourceFile}: missing dependencies for a multi-milestone plan`,
      );
    }
    return [];
  }
  if (rawDependencies === "none") return [];
  if (!/^M\d+(?:\s*,\s*M\d+)*$/u.test(rawDependencies)) {
    errors.push(
      `${identity.record.sourceFile}: dependencies must be \`none\` or comma-separated local milestone IDs`,
    );
    return [];
  }
  return rawDependencies.split(",").map((dependency) => dependency.trim());
}

/** Find one cycle in a fully local dependency graph. */
function findDependencyCycle(
  identitiesById: ReadonlyMap<string, MilestoneIdentity>,
): string[] | null {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const path: string[] = [];

  /** Walk one dependency chain and return its first cycle, if one is reachable. */
  function visit(id: string): string[] | null {
    if (visiting.has(id)) {
      const cycleStart = path.indexOf(id);
      return [...path.slice(cycleStart), id];
    }
    if (visited.has(id)) return null;
    visiting.add(id);
    path.push(id);
    const identity = identitiesById.get(id);
    for (const dependency of identity?.dependencies ?? []) {
      if (!identitiesById.has(dependency)) continue;
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    path.pop();
    visiting.delete(id);
    visited.add(id);
    return null;
  }

  for (const id of identitiesById.keys()) {
    const cycle = visit(id);
    if (cycle) return cycle;
  }
  return null;
}

/** Canonical lookup tables used to reconcile milestone IDs and numeric aliases. */
interface MilestoneIndexes {
  byId: Map<string, MilestoneIdentity>;
  byNumber: Map<string, MilestoneIdentity>;
}

/** Read either supported title prefix into the canonical local ID shape. */
function readTitleMilestoneId(title: string): string | undefined {
  const compactTitleNumber = title.match(/^M(\d+)\b/iu)?.[1];
  if (compactTitleNumber !== undefined) return `M${compactTitleNumber}`;
  const longTitleNumber = title.match(/^Milestone\s+(\d+)\b/iu)?.[1];
  return longTitleNumber === undefined ? undefined : `M${longTitleNumber}`;
}

/** Report filename and title drift for one local milestone identity. */
function collectMilestoneIdentityErrors(
  identity: MilestoneIdentity,
  requiresTitleId: boolean,
  errors: string[],
): void {
  if (!/^M\d.*\.md$/u.test(identity.record.sourceFile)) {
    errors.push(
      `${identity.record.sourceFile}: milestone filename must begin with an uppercase M and digits`,
    );
  }
  const titleId = readTitleMilestoneId(identity.record.title);
  if (!titleId && requiresTitleId) {
    errors.push(
      `${identity.record.sourceFile}: multi-milestone title must begin with its milestone ID`,
    );
  }
  if (titleId && titleId !== identity.id) {
    errors.push(
      `${identity.record.sourceFile}: title ID ${titleId} does not match filename ID ${identity.id}`,
    );
  }
}

/** Insert one numeric identity while reporting zero-padding aliases. */
function indexMilestoneNumber(
  identity: MilestoneIdentity,
  identitiesByNumber: Map<string, MilestoneIdentity>,
  errors: string[],
): void {
  const duplicate = identitiesByNumber.get(identity.numericId);
  if (duplicate) {
    errors.push(
      `${identity.record.sourceFile}: duplicate milestone ID ${identity.id} conflicts with ${duplicate.id}`,
    );
    return;
  }
  identitiesByNumber.set(identity.numericId, identity);
}

/** Index local IDs while reporting duplicate numeric identities and title drift. */
function indexMilestones(
  identities: MilestoneIdentity[],
  requiresTitleId: boolean,
  errors: string[],
): MilestoneIndexes {
  const identitiesById = new Map<string, MilestoneIdentity>();
  const identitiesByNumber = new Map<string, MilestoneIdentity>();

  for (const identity of identities) {
    collectMilestoneIdentityErrors(identity, requiresTitleId, errors);
    indexMilestoneNumber(identity, identitiesByNumber, errors);
    identitiesById.set(identity.id, identity);
  }
  return { byId: identitiesById, byNumber: identitiesByNumber };
}

/** Parse dependency fields and report unresolved or self-referential edges. */
function collectDependencyReferenceErrors(
  identities: MilestoneIdentity[],
  identitiesById: ReadonlyMap<string, MilestoneIdentity>,
  requiresDependencies: boolean,
  errors: string[],
): void {
  for (const identity of identities) {
    identity.dependencies = readDependencies(
      identity,
      requiresDependencies,
      errors,
    );
    for (const dependency of identity.dependencies) {
      if (dependency === identity.id) {
        errors.push(
          `${identity.record.sourceFile}: milestone cannot depend on itself`,
        );
      } else if (!identitiesById.has(dependency)) {
        errors.push(
          `${identity.record.sourceFile}: dependency ${dependency} does not resolve in this plan`,
        );
      }
    }
  }
}

/** Report active or complete milestones whose declared prerequisites remain open. */
function collectDependencyStateErrors(
  identities: MilestoneIdentity[],
  identitiesById: ReadonlyMap<string, MilestoneIdentity>,
): string[] {
  const errors: string[] = [];
  for (const identity of identities) {
    const status = identity.record.status.trim().toLowerCase();
    if (!ACTIVE_STATUSES.has(status) && status !== "complete") continue;
    for (const dependency of identity.dependencies) {
      const dependencyRecord = identitiesById.get(dependency)?.record;
      if (
        dependencyRecord &&
        dependencyRecord.status.trim().toLowerCase() !== "complete"
      ) {
        errors.push(
          `${identity.record.sourceFile}: active or complete milestone requires dependency ${dependency} to be complete`,
        );
      }
    }
  }
  return errors;
}

/** Enforce one active execution or verification boundary per plan. */
function collectActiveStateErrors(identities: MilestoneIdentity[]): string[] {
  const activeMilestones = identities.filter((identity) =>
    ACTIVE_STATUSES.has(identity.record.status.trim().toLowerCase()),
  );
  if (activeMilestones.length > 1) {
    return [
      `plan: multiple active milestones: ${activeMilestones.map((identity) => identity.id).join(", ")}`,
    ];
  }
  return [];
}

/** Validate exact local identities, dependencies, prerequisite state, and active-state uniqueness. */
function collectPlanStructureErrors(records: PlanExportRecord[]): string[] {
  const errors: string[] = [];
  const identities = records
    .map(readMilestoneIdentity)
    .filter((identity): identity is MilestoneIdentity => identity !== null);
  const indexes = indexMilestones(identities, records.length > 1, errors);
  collectDependencyReferenceErrors(
    identities,
    indexes.byId,
    records.length > 1,
    errors,
  );
  const cycle = findDependencyCycle(indexes.byId);
  if (cycle) {
    errors.push(`plan: dependency cycle detected: ${cycle.join(" -> ")}`);
  }
  errors.push(...collectDependencyStateErrors(identities, indexes.byId));
  errors.push(...collectActiveStateErrors(identities));
  return errors;
}

/**
 * Build one stdout report line for a milestone that declared effort data.
 * Gives the plan author a per-milestone estimate/actual overview at a glance.
 *
 * @param record - parsed milestone
 * @returns the line, or null when the milestone has no effort fields to show
 */
function renderMilestoneLine(record: PlanExportRecord): string | null {
  // Legacy milestones stay off the report entirely rather than showing empty columns.
  if (!record.effort) return null;

  // Echo the split only when the author declared one.
  const splitText = record.effort.split
    ? ` ${renderSplit(record.effort.split)}`
    : "";
  const actual = record.effort.actual;
  let actualText = "";
  if (actual && !isNumericActual(actual)) {
    actualText = ` | actual: ${actual.state} - ${actual.reason}`;
  } else if (actual && isNumericActual(actual)) {
    const actualSplitText = actual.split ? ` ${renderSplit(actual.split)}` : "";
    const actualReasonText = actual.reason ? ` - ${actual.reason}` : "";
    actualText = ` | actual: ${actual.state} ~${actual.totalMinutes} min${actualSplitText}${actualReasonText}`;
  }
  return `${record.sourceFile}: ~${record.effort.totalMinutes} min${splitText}${actualText}`;
}

/**
 * Sum every milestone's split into plan-level per-category totals.
 * Feeds the plan summary the author uses to judge the overall mix.
 *
 * @param records - parsed milestones
 * @returns minute totals; all zeros means no milestone declared a split yet
 */
function sumPlanSplits(records: PlanExportRecord[]): PlanEffortSplit {
  const totals: PlanEffortSplit = { product: 0, proof: 0, other: 0 };

  // Fold each estimate-carrying milestone into the plan-wide picture.
  for (const record of records) {
    // Milestones without a split (legacy or headline-only) cannot shape the mix.
    if (!record.effort?.split) continue;
    for (const category of CATEGORIES) {
      totals[category] += record.effort.split[category];
    }
  }
  return totals;
}

/**
 * Render the plan summary plus the drift advisory when the mix leaves tolerance.
 * The advisory never fails the check: the 70/20/10 target is a prior to reason
 * against, and a spike-heavy plan may be right to drift with a stated reason.
 *
 * @param records - parsed milestones
 * @returns summary lines; empty means no milestone declared a split to summarise
 */
function renderPlanSummary(records: PlanExportRecord[]): string[] {
  const totals = sumPlanSplits(records);
  const totalMinutes = totals.product + totals.proof + totals.other;

  // Without any splits there is no mix to summarise, so the summary stays out of the report.
  if (totalMinutes === 0) return [];

  // Convert minutes to the percentage mix the author compares against 70/20/10.
  const percentages = CATEGORIES.map((category) =>
    Math.round((totals[category] / totalMinutes) * 100),
  );
  const [productShare = 0, proofShare = 0, otherShare = 0] = percentages;
  const lines = [
    `plan: ${totalMinutes} min estimated - mix ${productShare}% product / ${proofShare}% proof / ${otherShare}% other (rough guide ~70/20/10)`,
  ];

  // Outside tolerance the author gets a review prompt, never forced ratio compliance.
  const hasDrifted = CATEGORIES.some(
    (category, index) =>
      Math.abs((percentages[index] ?? 0) - MIX_TARGET[category]) >
      MIX_TOLERANCE_POINTS,
  );
  if (hasDrifted) {
    lines.push(
      "advisory: plan mix drifts more than 15 percentage points from the rough ~70/20/10 guide - check for duplicated proof or missing verification; keep and explain the mix when task risk warrants it",
    );
  }
  return lines;
}

/** Below this many eligible samples a correction factor would be a guess, not calibration. */
const MINIMUM_CALIBRATION_SAMPLES = 3;

/** One milestone's measured-versus-estimated outcome, expressed as a raw-seconds ratio. */
interface CalibrationSample {
  sourceFile: string;
  ratio: number;
  measuredSeconds: number;
  estimatedMinutes: number;
}

/**
 * Turn one milestone into a calibration sample, or nothing when it is ineligible.
 *
 * Eligibility is deliberately narrow. `complete` is the existing human
 * ratification signal, so `human-verification-pending` never qualifies however
 * good its receipt is; `measured` is the only Actual state backed by
 * system-stamped spans, so retrospective guesses, unavailable, and incomplete
 * states stay out rather than dragging a median toward invented numbers.
 *
 * @param record - one parsed milestone
 * @returns the sample; undefined means this milestone cannot calibrate anything
 */
function readCalibrationSample(
  record: PlanExportRecord,
): CalibrationSample | undefined {
  const effort = record.effort;

  // Raw seconds are the authority; the rounded Actual minutes would compound rounding.
  const summary = record.timingReceipt?.summary;
  if (!effort || !summary) return undefined;
  if (record.status.trim().toLowerCase() !== "complete") return undefined;
  if (effort.actual?.state !== "measured") return undefined;

  // A zero-minute estimate has no ratio to report, so it contributes nothing.
  if (effort.totalMinutes <= 0) return undefined;
  return {
    sourceFile: record.sourceFile,
    ratio: summary.totalSeconds / (effort.totalMinutes * 60),
    measuredSeconds: summary.totalSeconds,
    estimatedMinutes: effort.totalMinutes,
  };
}

/**
 * Select the milestones whose Actual may legitimately calibrate a forecast.
 *
 * @param records - every parsed milestone in the plan directory
 * @returns one sample per eligible milestone, in source order
 */
function collectCalibrationSamples(
  records: PlanExportRecord[],
): CalibrationSample[] {
  return records
    .map(readCalibrationSample)
    .filter((sample): sample is CalibrationSample => sample !== undefined);
}

/** Middle value of a sorted ratio list, averaging the pair when the count is even. */
function medianRatio(sortedRatios: number[]): number {
  const middle = Math.floor(sortedRatios.length / 2);
  if (sortedRatios.length % 2 === 1) return sortedRatios[middle] ?? 0;
  return ((sortedRatios[middle - 1] ?? 0) + (sortedRatios[middle] ?? 0)) / 2;
}

/** Format a ratio the way the report shows it, so comparisons stay eyeball-able. */
function renderRatio(ratio: number): string {
  return `${ratio.toFixed(2)}x`;
}

/**
 * Render the informational calibration block.
 *
 * Contract: this block is advisory-only. It must never contribute errors and
 * must never change a forecast: it reports how
 * past measured milestones landed against their estimates and leaves the
 * judgement to the author. Below three eligible samples it says `uncalibrated`
 * rather than offering a multiplier one or two data points cannot support.
 *
 * @param records - every parsed milestone in the plan directory
 * @returns report lines; always at least the count line once the plan has milestones
 */
function renderCalibrationSummary(records: PlanExportRecord[]): string[] {
  const samples = collectCalibrationSamples(records);
  if (samples.length < MINIMUM_CALIBRATION_SAMPLES) {
    return [
      `calibration: uncalibrated - ${samples.length} of ${MINIMUM_CALIBRATION_SAMPLES} eligible measured samples`,
    ];
  }

  const sortedRatios = samples
    .map((sample) => sample.ratio)
    .sort((a, b) => a - b);
  const lowest = sortedRatios[0] ?? 0;
  const highest = sortedRatios[sortedRatios.length - 1] ?? 0;
  return [
    `calibration: ${samples.length} eligible measured samples - median ${renderRatio(medianRatio(sortedRatios))}, observed ${renderRatio(lowest)}-${renderRatio(highest)}`,
    ...samples.map(
      (sample) =>
        `calibration sample: ${sample.sourceFile} ${renderRatio(sample.ratio)} (${sample.measuredSeconds}s measured / ${sample.estimatedMinutes} min estimated)`,
    ),
  ];
}

/**
 * Reject flags that have no meaning for the read-only check report.
 * `--format` is deliberately ignored rather than rejected: its default value is
 * TTY-dependent, so rejecting it would break piped invocations that never
 * passed the flag.
 *
 * @param options - parsed CLI options
 * @throws CLIError when a write-oriented flag reaches the check
 */
function assertCheckUsage(options: ParsedCLI): void {
  // e.g. the user copied a `plans export ... --force` line and swapped in `check`.
  if (options.shouldForce) {
    throw new CLIError(
      "--force is only valid for install, setup --apply, or plans export.",
      2,
    );
  }

  // The report is a terminal read, not an artifact - redirecting it would imply a write contract.
  if (options.output) {
    throw new CLIError(
      "plans check does not support --output; the report prints to stdout.",
      2,
    );
  }
}

/**
 * Check one plan directory and report to stdout.
 * Exit code 1 signals deterministic contract or arithmetic errors; mix drift
 * and default-mode legacy absence never fail. Records are redacted before use.
 *
 * @param options - parsed plan path plus global flags
 * @returns nothing; the report goes to stdout and the exit code carries the verdict
 * @throws CLIError for usage errors or unreadable plans
 */
function handlePlansCheckCommand(options: ParsedCLI): void {
  // e.g. the user finished writing milestones and ran `goat-flow plans check .goat-flow/plans/<active>`.
  assertCheckUsage(options);

  let records: PlanExportRecord[];
  try {
    records = loadPlanExportRecords(options.projectPath).map(
      redactPlanExportRecord,
    );
  } catch (error) {
    // Example: the user pointed at an archived plan folder that no longer holds M*.md files.
    if (isPlansExportInputError(error)) {
      throw new CLIError(error.message, 2);
    }
    throw error;
  }

  const errors = records.flatMap((record) =>
    collectMilestoneErrors(record, options.plansStrict),
  );
  if (options.plansStrict) {
    errors.push(...collectPlanStructureErrors(records));
  }

  // Milestones with estimates become report rows; legacy ones contribute nothing.
  const milestoneLines = records
    .map(renderMilestoneLine)
    .filter((line): line is string => line !== null);
  const planSummary = renderPlanSummary(records);
  const reportLines = [...milestoneLines, ...planSummary];

  // Calibration only means something next to a mix summary, so it follows the same gate.
  if (planSummary.length > 0) {
    reportLines.push(...renderCalibrationSummary(records));
  }

  // Nothing estimated and nothing wrong: tell the user the plan predates the notation.
  if (reportLines.length === 0 && errors.length === 0) {
    reportLines.push(
      "no effort estimates found - this plan predates the estimation notation (informational)",
    );
  }

  // Deterministic errors end the report and flip the exit code so scripts can gate on it.
  if (errors.length > 0) {
    reportLines.push(...errors.map((line) => `error: ${line}`));
    process.exitCode = 1;
  }
  writeOutput({ ...options, output: null }, reportLines.join("\n"));
}

/**
 * Route local plan subcommands between the export bundler and the effort check.
 * The single `plans` dispatch entry - every `goat-flow plans ...` invocation
 * lands here first.
 *
 * @param options - parsed CLI options carrying the chosen subcommand
 * @returns nothing; the chosen subcommand owns all output and exit codes
 */
export function handlePlansCommand(options: ParsedCLI): void {
  if (options.plansSubcommand === "time") {
    handlePlansTimeCommand(options);
    return;
  }
  // The user asked for the effort report rather than an export bundle.
  if (options.plansSubcommand === "check") {
    handlePlansCheckCommand(options);
    return;
  }
  handlePlansExportCommand(options);
}
