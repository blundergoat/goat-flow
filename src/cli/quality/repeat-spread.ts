/** Descriptive rerun statistics from stored reports, without a noise verdict. */
import type { QualityHistoryEntry } from "./history.js";
import { qualityReportRubricId } from "./rubric.js";
import type {
  QualityAssessmentContext,
  QualityAssessmentIdentity,
} from "./schema-types.js";

/** A group of unchanged assessed inputs; legacy identity is explicitly observational. */
export interface QualityRepeatSpread {
  kind: "controlled" | "observational";
  sampleSize: number;
  setup: { median: number; min: number; max: number; range: number };
  system: { median: number; min: number; max: number; range: number };
}

/** Changed captures override clean-tree claims; unavailable captures may use a clean full revision. */
function assessedBytesKey(context: QualityAssessmentContext): string | null {
  const snapshot = context.workspace_snapshot;
  if (snapshot?.start && snapshot.end) {
    return snapshot.start === snapshot.end
      ? `snapshot:${snapshot.start}`
      : null;
  }
  if (
    context.working_tree_state !== "clean" ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(context.project_revision ?? "")
  )
    return null;
  return `revision:${context.project_revision}`;
}

/** Complete launch identity still needs the separately recorded fixed-input protocol. */
function isControlledIdentity(identity: QualityAssessmentIdentity): boolean {
  return (
    identity.capture === "launch-observed" &&
    Boolean(
      identity.model &&
      identity.tool_version &&
      identity.prompt_sha256 &&
      identity.settings_sha256 &&
      identity.fixed_input_protocol,
    )
  );
}

/** Avoid mixing unknown new identity with observational legacy reports or another study's inputs. */
function repeatKey(entry: QualityHistoryEntry): string | null {
  const context = entry.report.assessment_context;
  if (!context) return null;
  const bytes = assessedBytesKey(context);
  if (bytes === null) return null;
  const identity = context.assessment_identity;
  if (identity !== undefined && !isControlledIdentity(identity)) return null;
  return JSON.stringify([
    entry.agent,
    entry.report.quality_mode ?? "agent-setup",
    qualityReportRubricId(entry.report),
    bytes,
    identity
      ? [
          identity.model,
          identity.tool_version,
          identity.prompt_sha256,
          identity.settings_sha256,
          identity.fixed_input_protocol,
        ]
      : "legacy-observational",
  ]);
}

/** Keep score medians and extrema descriptive; this does not classify score changes. */
function summarize(values: number[]): QualityRepeatSpread["setup"] {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[middle] ?? 0);
  const min = sorted[0] ?? 0;
  const max = sorted.at(-1) ?? 0;
  return { median, min, max, range: max - min };
}

/**
 * Derive descriptive spread before callers limit display rows; singletons have no map entry.
 *
 * @param entries - full saved history for the selected project; empty input returns an empty map
 * @returns report-id keyed statistics for comparable groups containing at least two reports
 */
export function buildQualityRepeatSpreads(
  entries: QualityHistoryEntry[],
): Map<string, QualityRepeatSpread> {
  const groups = new Map<string, QualityHistoryEntry[]>();
  for (const entry of entries) {
    const key = repeatKey(entry);
    if (key === null) continue;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  const spreads = new Map<string, QualityRepeatSpread>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const spread: QualityRepeatSpread = {
      kind: group[0]?.report.assessment_context?.assessment_identity
        ? "controlled"
        : "observational",
      sampleSize: group.length,
      setup: summarize(group.map((entry) => entry.report.scores.setup.total)),
      system: summarize(group.map((entry) => entry.report.scores.system.total)),
    };
    for (const entry of group) spreads.set(entry.id, spread);
  }
  return spreads;
}
