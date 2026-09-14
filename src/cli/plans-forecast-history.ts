/**
 * Discover forecast history inside the project that owns the selected plan.
 *
 * Sibling files supply read-only evidence; their lifecycle and parse failures never become selected-plan errors.
 * Discovery visits direct plans and one explicit _done layer, without following directory or milestone symlinks.
 */
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  parseMilestoneMarkdown,
  type PlanExportRecord,
} from "./plans-export.js";
import {
  countAgentWorkUnits,
  validateForecastBasis,
  type PlanEffortNumericActual,
} from "./plans-effort.js";
import {
  collectPlanForecastProblems,
  type PlanForecastRecord,
} from "./plans-forecast-context.js";

import type { PlanTimingSummary } from "./plans-time-receipt.js";

/** One source file with its project-relative identity and hash of the bytes actually parsed. */
interface ForecastHistorySource {
  id: string;
  sha256: string;
  record: PlanExportRecord;
  registration: unknown;
}

/** A provided frozen snapshot; hashes establish consistency, not independent timestamp authenticity. */
interface ForecastRegistration {
  milestone: string;
  forecastId: string;
  registeredAt: string;
  sha256: string;
  forecast: unknown;
  receiptId?: string;
}

/** One deduplicated outcome normalized by its registered scope for downstream numerical forecasting. */
interface ForecastHistorySample {
  id: string;
  sha256: string;
  forecastId: string;
  registeredAt: string;
  completedAt: string;
  agentWorkUnits: number;
  measuredSeconds: number;
  minutesPerUnit: number;
}

/** Integrity-admitted source; contextual admission is separate so incompatible copies cannot evade deduplication. */
interface HistoryMeasurement {
  source: ForecastHistorySource;
  signature: string;
  keys: string[];
  registrationReason: string | null;
  registrations: ForecastRegistration[];
  totalSeconds: number;
  completedAtEpoch: number;
  forecasts: PlanForecastRecord[];
}

/** Read-only discovery outcome; exclusions describe history limits without changing selected-plan validity. */
export interface PlanForecastHistory {
  root: string | null;
  sources: ForecastHistorySource[];
  exclusions: { id: string; reason: string }[];
}

/** Require physical containment so another project cannot influence this plan's history. */
function isContained(root: string, path: string): boolean {
  const local = relative(root, path);
  return local !== ".." && !local.startsWith(`..${sep}`) && !isAbsolute(local);
}

/** Return a real contained path of the required kind; symlinks and unreadable paths are never evidence. */
function isHistoryPath(
  root: string,
  path: string,
  kind: "file" | "directory",
): boolean {
  try {
    const entry = lstatSync(path);
    return (
      !entry.isSymbolicLink() &&
      (kind === "file" ? entry.isFile() : entry.isDirectory()) &&
      isContained(root, realpathSync(path))
    );
  } catch {
    // A removed or inaccessible history entry is excluded; the selected plan's own loader owns its errors.
    return false;
  }
}

/** Stable portable identities make duplicate/exclusion reports independent of the invoking working directory. */
function historyId(root: string, path: string): string {
  return [".goat-flow/plans", relative(root, path).split(sep).join("/")].join(
    "/",
  );
}

/** Canonical compact JSON sorts object keys recursively and preserves array order. Input comes only from JSON or parsed records. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  if (value === undefined) return "null";
  return JSON.stringify(value);
}

/** Registration failures stay local to a history source; never follow a linked evaluation folder or file. */
function readRegistration(root: string, directory: string): unknown {
  const evaluation = join(directory, "evaluation");
  const path = join(evaluation, "prospective-registration.json");
  if (
    !isHistoryPath(root, evaluation, "directory") ||
    !isHistoryPath(root, path, "file")
  )
    return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Read directory names without promoting an inaccessible sibling into a current-plan failure. */
function historyEntries(
  history: PlanForecastHistory,
  root: string,
  directory: string,
): string[] {
  try {
    return readdirSync(directory).sort();
  } catch {
    history.exclusions.push({
      id: historyId(root, directory),
      reason: "history directory is unreadable",
    });
    return [];
  }
}

/** Read only real milestone files in one admitted directory; parsing does not validate another plan's lifecycle. */
function readHistoryPlan(
  history: PlanForecastHistory,
  root: string,
  directory: string,
): void {
  const registration = readRegistration(root, directory);
  for (const name of historyEntries(history, root, directory)) {
    if (!/^M\d+.*\.md$/u.test(name)) continue;
    const path = join(directory, name);
    const id = historyId(root, path);
    if (!isHistoryPath(root, path, "file")) {
      history.exclusions.push({
        id,
        reason: "milestone is not a real contained file",
      });
      continue;
    }
    try {
      const bytes = readFileSync(path);
      const body = bytes.toString("utf8");
      history.sources.push({
        id,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        record: parseMilestoneMarkdown(body, name),
        registration,
      });
    } catch {
      // A concurrently removed file or malformed title excludes only that source; never echo raw file contents.
      history.exclusions.push({
        id,
        reason: "history milestone is unreadable or malformed",
      });
    }
  }
}

/** Admit visible plan names and the sole archive container; ordinary scratch and archive roots stay outside history. */
function isHistoryPlanName(name: string): boolean {
  return (
    !name.startsWith(".") &&
    (!name.startsWith("_") || name === "_done") &&
    name !== "scratchpad" &&
    name !== "archive"
  );
}

/** Visit direct plan directories; _done is the only container whose children are also searched. */
function readHistoryLayer(
  history: PlanForecastHistory,
  root: string,
  directory: string,
  allowDone: boolean,
): void {
  for (const name of historyEntries(history, root, directory)) {
    if (!isHistoryPlanName(name)) continue;
    const path = join(directory, name);
    if (!isHistoryPath(root, path, "directory")) {
      if (name === "_done" || !name.includes("."))
        history.exclusions.push({
          id: historyId(root, path),
          reason: "plan is not a real contained directory",
        });
      continue;
    }
    if (name === "_done") {
      if (allowDone) readHistoryLayer(history, root, path, false);
    } else readHistoryPlan(history, root, path);
  }
}

/**
 * Discover source milestones using the same canonical project owner as selected-plan policy.
 *
 * @param projectRoot - trusted selected-project root, or null for an external/escaped operand
 * @param selectedPlan - selected directory, checked again before siblings are read
 * @returns bounded sources and factual exclusions; a null root keeps selected-plan-only behavior
 */
export function discoverPlanForecastHistory(
  projectRoot: string | null,
  selectedPlan: string,
): PlanForecastHistory {
  const history: PlanForecastHistory = {
    root: null,
    sources: [],
    exclusions: [],
  };
  if (projectRoot === null) return history;
  try {
    const realProject = realpathSync(projectRoot);
    const plans = join(realProject, ".goat-flow", "plans");
    if (
      !isHistoryPath(realProject, plans, "directory") ||
      !isHistoryPath(plans, resolve(selectedPlan), "directory")
    )
      return history;
    history.root = plans;
    readHistoryLayer(history, plans, plans, true);
    history.sources.sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    );
  } catch {
    // A disappearing project root cannot grant access to a different history owner.
    return { root: null, sources: [], exclusions: [] };
  }
  return history;
}

/** Reuse parser receipt validation and basis arithmetic; a rounded-zero Actual never discards positive raw seconds. */
function measurementExclusion(record: PlanExportRecord): string | null {
  if (record.status.trim().toLowerCase() !== "complete")
    return "status is not complete";
  const actual = record.effort?.actual;
  const receipt = record.timingReceipt;
  if (actual?.state !== "measured") return "Actual is not measured";
  if (receipt?.state !== "finalized" || !receipt.summary)
    return "measurement requires a finalized receipt summary";
  const integrity = receiptIntegrityExclusion(record, receipt.summary);
  if (integrity) return integrity;
  if (!actualMatchesMeasurement(actual, receipt.summary))
    return "measured Actual does not match the finalized receipt";
  return basisExclusion(record);
}

/** Preserve the receipt parser's integrity verdict and reject only zero raw outcomes, never rounded-zero displays. */
function receiptIntegrityExclusion(
  record: PlanExportRecord,
  summary: PlanTimingSummary,
): string | null {
  if (
    record.warnings.some((warning) =>
      /timing receipt|Actual|actual effort|forecast basis|forecast range/iu.test(
        warning,
      ),
    )
  )
    return "receipt or forecast fields are malformed";
  if (summary.totalSeconds <= 0) return "raw receipt seconds are not positive";
  return null;
}

/** Missing context supplies no snapshots; callers still require explicit opt-in before matching. */
function savedForecasts(record: PlanExportRecord): PlanForecastRecord[] {
  return record.forecastContext?.document?.records ?? [];
}

/** Compare the measured claim with the parser-validated receipt's raw seconds and deterministic allocation. */
function actualMatchesMeasurement(
  actual: PlanEffortNumericActual,
  summary: PlanTimingSummary,
): boolean {
  const split = actual.split;
  if (!split) return false;
  const claimedSeconds = Number(
    actual.reason.match(/^receipt\s+(\d+)\s+recorded-unpaused seconds$/u)?.[1],
  );
  return (
    actual.totalMinutes === summary.totalMinutes &&
    claimedSeconds === summary.totalSeconds &&
    ["product", "proof", "other"].every(
      (category) =>
        Reflect.get(split, category) === Reflect.get(summary.minutes, category),
    )
  );
}

/** Check whole-work basis against saved scope when available, otherwise the existing checklist counting grammar. */
function basisExclusion(record: PlanExportRecord): string | null {
  const basis = record.effort?.forecastBasis;
  if (!basis) return "missing countable forecast basis";
  const issued = record.forecastContext?.document?.records.findLast(
    (snapshot) => snapshot.scopeKind === "whole",
  );
  const units =
    issued?.items.length ??
    countAgentWorkUnits([
      ...record.tasks,
      ...record.testingGateItems,
      ...record.midProofItems,
      record.planAdminEstimate ?? {},
    ]);
  if (
    validateForecastBasis(basis, record.effort?.forecastRange, units).length > 0
  )
    return "forecast basis does not match counted scope and range";
  return null;
}

/** Treat only objects as registration entries; malformed or unsupported envelopes provide no frozen evidence. */
function registrationEntries(value: unknown): ForecastRegistration[] | null {
  if (
    !value ||
    typeof value !== "object" ||
    Reflect.get(value, "schemaVersion") !== 1
  )
    return null;
  const entries: unknown = Reflect.get(value, "forecasts");
  if (
    !Array.isArray(entries) ||
    entries.some(
      (entry) => !entry || typeof entry !== "object" || Array.isArray(entry),
    )
  )
    return null;
  return entries as ForecastRegistration[]; // -- rationale: field types and exact identities are checked before each entry is used.
}

/** Require a real UTC second in the registration; invalid dates cannot establish pre-work ordering. */
function registrationEpoch(stamp: unknown): number | null {
  if (
    typeof stamp !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/u.test(stamp)
  )
    return null;
  const epoch = Date.parse(stamp);
  return Number.isFinite(epoch) &&
    new Date(epoch).toISOString().replace(".000Z", "Z") === stamp
    ? epoch
    : null;
}

/** Find the first closed span covered by this scope; remaining predictions begin after their validated cutoff. */
function firstPredictedWorkStart(
  snapshot: PlanForecastRecord,
  record: PlanExportRecord,
): number | undefined {
  const segments =
    record.timingReceipt?.segments.filter(
      (segment) => segment.state === "closed",
    ) ?? [];
  const cutoff = snapshot.receiptCutoff;
  const index = cutoff
    ? segments.findIndex((segment) => segment.id === cutoff.segmentId)
    : -1;
  return segments[index + 1]?.startEpochSeconds;
}

/** Validate one frozen entry against its saved prediction and the first receipt span it predicts. */
function registrationMatches(
  entry: ForecastRegistration,
  snapshot: PlanForecastRecord,
  record: PlanExportRecord,
): boolean {
  const registered = registrationEpoch(entry.registeredAt);
  if (registered === null) return false;
  const firstWork = firstPredictedWorkStart(snapshot, record);
  if (
    firstWork === undefined ||
    registered < Date.parse(snapshot.issuedAt) ||
    registered > firstWork * 1000
  )
    return false;
  if (
    entry.receiptId !== undefined &&
    (typeof entry.receiptId !== "string" || entry.receiptId.trim() === "")
  )
    return false;
  const frozen = canonicalJson(entry.forecast);
  return (
    frozen === canonicalJson(snapshot) &&
    entry.sha256 === createHash("sha256").update(frozen).digest("hex")
  );
}

/** Require every original and revision to agree with its provided registration; a late registration cannot repair earlier provenance. */
function registeredSnapshots(source: ForecastHistorySource): {
  reason: string | null;
  entries: ForecastRegistration[];
} {
  const snapshots = source.record.forecastContext?.document?.records;
  if (source.record.forecastContext?.method !== "contextual-v1" || !snapshots)
    return { reason: "missing explicit contextual history", entries: [] };
  if (collectPlanForecastProblems(source.record).length > 0)
    return { reason: "invalid forecast context or scope", entries: [] };
  const entries = registrationEntries(source.registration);
  if (!entries)
    return {
      reason: "missing or malformed prospective registration",
      entries: [],
    };
  return matchRegistrations(entries, snapshots, source.record);
}

/** Match each original and revision exactly once; a duplicate identity makes its provenance ambiguous. */
function matchRegistrations(
  entries: ForecastRegistration[],
  snapshots: PlanForecastRecord[],
  record: PlanExportRecord,
): { reason: string | null; entries: ForecastRegistration[] } {
  const matched: ForecastRegistration[] = [];
  for (const snapshot of snapshots) {
    const matches = entries.filter(
      (entry) =>
        entry.milestone === record.sourceFile &&
        entry.forecastId === snapshot.id,
    );
    const [entry] = matches;
    if (
      matches.length !== 1 ||
      !entry ||
      !registrationMatches(entry, snapshot, record)
    )
      return {
        reason:
          "registration is missing, conflicting, late or does not match the frozen snapshot",
        entries: [],
      };
    matched.push(entry);
  }
  return { reason: null, entries: matched };
}

/** Group sources sharing exact closed segments or a registered receipt identity, including transitive copies. Equal durations create no key. */
function groupMeasurements(
  measurements: HistoryMeasurement[],
): HistoryMeasurement[][] {
  const groups = new Set<Set<HistoryMeasurement>>();
  const byKey = new Map<string, Set<HistoryMeasurement>>();
  for (const measurement of measurements) {
    const joined = new Set([measurement]);
    for (const key of measurement.keys) {
      const prior = byKey.get(key);
      if (!prior) continue;
      for (const member of prior) joined.add(member);
      groups.delete(prior);
    }
    groups.add(joined);
    for (const member of joined)
      for (const key of member.keys) byKey.set(key, joined);
  }
  return [...groups].map((group) =>
    [...group].sort((left, right) =>
      left.source.id < right.source.id ? -1 : 1,
    ),
  );
}

/** Separate receipt integrity from registration and comparability, retaining enough provenance to detect conflicting copies. */
function historyMeasurements(
  history: PlanForecastHistory,
  exclusions: PlanForecastHistory["exclusions"],
): HistoryMeasurement[] {
  const measurements: HistoryMeasurement[] = [];
  for (const source of history.sources) {
    const reason = measurementExclusion(source.record);
    const receipt = source.record.timingReceipt;
    if (reason || !receipt?.summary) {
      exclusions.push({
        id: source.id,
        reason: reason ?? "missing receipt summary",
      });
      continue;
    }
    const segments = receipt.segments.filter(
      (segment) => segment.state === "closed",
    );
    const registered = registeredSnapshots(source);
    measurements.push({
      source,
      signature: canonicalJson({
        // Explicit shared provenance can identify a copy whose local segment labels changed.
        segments: segments.map(({ id: _id, ...span }) => span),
        basis: source.record.effort?.forecastBasis,
        forecasts: source.record.forecastContext?.document,
      }),
      keys: [
        ...segments.map((segment) => `segment:${canonicalJson(segment)}`),
        ...registered.entries.flatMap((entry) =>
          entry.receiptId ? [`receipt:${entry.receiptId}`] : [],
        ),
      ],
      registrationReason: registered.reason,
      registrations: registered.entries,
      totalSeconds: receipt.summary.totalSeconds,
      completedAtEpoch: Math.max(
        ...segments.map((segment) => segment.endEpochSeconds ?? 0),
      ),
      forecasts: savedForecasts(source.record),
    });
  }
  return measurements;
}

/** Match declared inputs only; outcomes decide temporal availability, never work class or rubric. */
function compatibilityExclusion(
  snapshot: PlanForecastRecord | undefined,
  target: PlanForecastRecord,
  record: PlanExportRecord,
): string | null {
  if (!snapshot) return "no registered forecast for the requested scope";
  if (
    snapshot.workState === "unknown" ||
    target.workState === "unknown" ||
    snapshot.workState !== target.workState
  )
    return "work state is unknown or incompatible";
  if (snapshot.unitRubric !== target.unitRubric)
    return "unit rubric is incompatible";
  if (
    snapshot.scopeKind === "whole" &&
    record.forecastContext?.document?.records.some(
      (revision) =>
        revision.scopeKind === "remaining" &&
        revision.scopeDelta.added.length > 0,
    )
  )
    return "whole-work scope changed after issue";
  return null;
}

/** Keep one consistent representative per shared receipt group; conflicts exclude the whole group before context matching. */
function deduplicateMeasurements(
  measurements: HistoryMeasurement[],
  exclusions: PlanForecastHistory["exclusions"],
): HistoryMeasurement[] {
  const unique: HistoryMeasurement[] = [];
  for (const group of groupMeasurements(measurements)) {
    if (new Set(group.map((entry) => entry.signature)).size > 1) {
      exclusions.push(
        ...group.map((entry) => ({
          id: entry.source.id,
          reason: "conflicting metadata for shared receipt provenance",
        })),
      );
      continue;
    }
    // Prefer the registered copy only when receipt and forecast metadata are identical.
    const measurement =
      group.find((entry) => entry.registrationReason === null) ?? group[0];
    if (!measurement) continue;
    for (const duplicate of group)
      if (duplicate !== measurement)
        exclusions.push({
          id: duplicate.source.id,
          reason: `duplicate receipt of ${measurement.source.id}`,
        });
    unique.push(measurement);
  }
  return unique;
}

/** Normalize one registered scope against its matching outcome, excluding observations unavailable when the target was issued. */
function matchHistoryMeasurement(
  measurement: HistoryMeasurement,
  current: PlanForecastRecord,
):
  | { sample: ForecastHistorySample; reason?: never }
  | { sample?: never; reason: string } {
  const { source } = measurement;
  if (measurement.registrationReason)
    return { reason: measurement.registrationReason };
  const snapshot = measurement.forecasts.findLast(
    (entry) => entry.scopeKind === current.scopeKind,
  );
  const incompatible = compatibilityExclusion(snapshot, current, source.record);
  if (incompatible || !snapshot)
    return {
      reason: incompatible ?? "no registered forecast for the requested scope",
    };
  const completion = measurement.completedAtEpoch;
  if (completion * 1000 >= Date.parse(current.issuedAt))
    return {
      reason: "measurement did not complete strictly before target issue",
    };
  const measuredSeconds =
    measurement.totalSeconds - (snapshot.receiptCutoff?.recordedSeconds ?? 0);
  if (measuredSeconds <= 0)
    return { reason: "matching scope has no positive recorded seconds" };
  const registration = measurement.registrations.find(
    (entry) => entry.forecastId === snapshot.id,
  );
  if (!registration) return { reason: "missing matching scope registration" };
  return {
    sample: {
      id: source.id,
      sha256: source.sha256,
      forecastId: snapshot.id,
      registeredAt: registration.registeredAt,
      completedAt: new Date(completion * 1000)
        .toISOString()
        .replace(".000Z", "Z"),
      agentWorkUnits: snapshot.basis.agentWorkUnits,
      measuredSeconds,
      minutesPerUnit: measuredSeconds / 60 / snapshot.basis.agentWorkUnits,
    },
  };
}

/** A malformed or absent opt-in cannot activate project matching. */
function validTargetForecast(
  target: PlanExportRecord,
): PlanForecastRecord | undefined {
  if (
    target.forecastContext?.method !== "contextual-v1" ||
    collectPlanForecastProblems(target).length > 0
  )
    return undefined;
  return target.forecastContext.document?.records.at(-1);
}

/**
 * Select registered, strictly earlier measurements for one opted-in target; keep sparse or unknown context on the existing numerical fallback.
 * This returns evidence only. It never mutates history, validates sibling lifecycle, or computes replacement estimates.
 *
 * @param history - discovery from the target's canonical project; a null root retains selected-plan fallback
 * @param target - selected milestone whose latest valid contextual snapshot supplies the issue time and matching scope
 * @returns selected pool and normalized observations, with every excluded source and the reason matching is unavailable
 */
export function selectPlanForecastHistory(
  history: PlanForecastHistory,
  target: PlanExportRecord,
): {
  selection: "context-matched" | "selected-plan";
  reason: string;
  intactCount: number;
  samples: ForecastHistorySample[];
  exclusions: PlanForecastHistory["exclusions"];
} {
  const result = {
    selection: "selected-plan" as "context-matched" | "selected-plan",
    reason: "selected plan has no canonical project history",
    intactCount: 0,
    samples: [] as ForecastHistorySample[],
    exclusions: [...history.exclusions],
  };
  if (history.root === null) return result;
  const current = validTargetForecast(target);
  if (!current) {
    result.reason = "target has no valid contextual opt-in";
    return result;
  }
  const measurements = historyMeasurements(history, result.exclusions);
  result.intactCount = measurements.length;
  for (const measurement of deduplicateMeasurements(
    measurements,
    result.exclusions,
  )) {
    const matched = matchHistoryMeasurement(measurement, current);
    if (matched.sample) result.samples.push(matched.sample);
    else
      result.exclusions.push({
        id: measurement.source.id,
        reason: matched.reason,
      });
  }
  result.samples.sort((left, right) => (left.id < right.id ? -1 : 1));
  result.exclusions.sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  if (result.samples.length >= 3) {
    result.selection = "context-matched";
    result.reason =
      "at least three compatible registered earlier measurements; experimental small-sample evidence";
  } else
    result.reason =
      current.workState === "unknown"
        ? "target work state is unknown; existing selected-plan numerical fallback retained"
        : `only ${result.samples.length} compatible registered earlier measurements; at least three required; existing selected-plan numerical fallback retained`;
  return result;
}
