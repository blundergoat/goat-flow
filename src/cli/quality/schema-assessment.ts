/**
 * Validate the evidence context and next steps that maintainers revisit in saved quality reports.
 *
 * Recommendations retain their category, action, and evidence; workspace captures make comparison limits visible.
 * Older reports may omit these additions, and parsing never recalculates an assessor's rubric scores.
 */
import {
  QUALITY_GROUNDING_STATUSES,
  QUALITY_SCORE_CONFIDENCES,
  QUALITY_WORKTREE_STATES,
  QUALITY_IMPROVEMENT_CATEGORIES,
  QUALITY_MAX_IMPROVEMENTS,
  type QualityAssessmentContext,
  type QualityImprovement,
} from "./schema-types.js";
import {
  expectEnumValue,
  expectNonEmptyString,
  expectNullableString,
  isRecord,
  rejectUnknownKeys,
} from "./schema-expectations.js";

type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Read the before/after snapshot identifiers retained with an assessment.
 * Use during save or history loading; valid identifiers describe recorded evidence without proving the capture ran.
 *
 * @param raw - snapshot object; omission preserves legacy absence, while a null endpoint means capture was unavailable
 * @param path - report field named in the error that tells the author what to repair
 * @returns validated endpoints, legacy absence, or a field-specific error that blocks this report
 */
function parseWorkspaceSnapshot(
  raw: unknown,
  path: string,
): FieldResult<QualityAssessmentContext["workspace_snapshot"]> {
  // A report written before snapshot support stays readable without a fabricated capture.
  if (raw === undefined) return { ok: true, value: undefined };
  // A supplied snapshot needs both named endpoints so later comparisons can explain their evidence.
  if (!isRecord(raw)) return { ok: false, error: `${path} must be an object` };
  const unknownKeyError = rejectUnknownKeys(raw, ["start", "end"], path);
  // Reject extra capture fields rather than silently omitting evidence the author expected to retain.
  if (unknownKeyError) return { ok: false, error: unknownKeyError };
  const start = parseSnapshotFingerprint(raw.start, `${path}.start`);
  // Missing start evidence cannot become an invented baseline for the user's report.
  if (!start.ok) return start;
  const end = parseSnapshotFingerprint(raw.end, `${path}.end`);
  // An invalid final fingerprint cannot establish whether evidence drifted during assessment.
  if (!end.ok) return end;
  return { ok: true, value: { start: start.value, end: end.value } };
}

/**
 * Read one copied review fingerprint so users can compare retained assessment states.
 * Use for either capture boundary; null records an unavailable capture and never means an unchanged workspace.
 *
 * @param raw - copied fingerprint or null; missing values are errors when a snapshot object is present
 * @param path - field label used to tell the report author which value needs correction
 * @returns a valid identifier or null, otherwise an actionable validation error
 */
function parseSnapshotFingerprint(
  raw: unknown,
  path: string,
): FieldResult<string | null> {
  const fingerprint = expectNullableString(raw, path);
  // A malformed field would make the report claim snapshot evidence it cannot identify.
  if (!fingerprint.ok) return fingerprint;
  // Null is an explicit coverage limit; a non-null identifier must come from the documented snapshot schema.
  if (
    fingerprint.value !== null &&
    !/^review-v1:sha256:[a-f0-9]{64}$/u.test(fingerprint.value)
  ) {
    return {
      ok: false,
      error: `${path} must be a review snapshot fingerprint or null`,
    };
  }
  return fingerprint;
}

/**
 * Keep recommendation text short enough to read in quality history and diff output.
 * Use for each authored sentence before the saver accepts a recommendation.
 *
 * @param raw - authored text; missing or empty text leaves the proposed work unexplained and is rejected
 * @param path - recommendation field shown in the repair message
 * @param limit - contract ceiling for this field; longer text must be shortened before saving
 * @returns non-empty single-line text, or the error the report author needs to correct
 */
function parseImprovementText(
  raw: unknown,
  path: string,
  limit: number,
): FieldResult<string> {
  const text = expectNonEmptyString(raw, path);
  // Missing or blank text leaves the recommendation unexplained when the maintainer revisits it.
  if (!text.ok) return text;
  // Overlong or multi-line text would make the saved recommendation difficult to scan.
  if (text.value.length > limit || /[\r\n]/u.test(text.value)) {
    return {
      ok: false,
      error: `${path} must be a single line of ${limit} characters or fewer`,
    };
  }
  return text;
}

/**
 * Read one proposed improvement so maintainers can see what to change and why it is worthwhile.
 * Use before saving; an invalid recommendation blocks the report instead of silently dropping its next steps.
 *
 * @param raw - authored recommendation; missing fields cannot explain actionable work to a later reader
 * @param path - indexed recommendation location used by quality save's repair message
 * @returns the validated recommendation, including a null file for project-wide work, or the first field error
 */
function parseImprovement(
  raw: unknown,
  path: string,
): FieldResult<QualityImprovement> {
  // A recommendation needs named action and evidence fields before history can show it.
  if (!isRecord(raw)) return { ok: false, error: `${path} must be an object` };
  const unknownKeyError = rejectUnknownKeys(
    raw,
    ["category", "summary", "action", "evidence", "file"],
    path,
  );
  // Unknown recommendation fields would disappear from the reader's saved view.
  if (unknownKeyError) return { ok: false, error: unknownKeyError };
  const category = expectEnumValue(
    raw.category,
    `${path}.category`,
    QUALITY_IMPROVEMENT_CATEGORIES,
  );
  // An unsupported category could misrepresent optional maintenance as a confirmed defect.
  if (!category.ok) return category;
  const summary = parseImprovementText(raw.summary, `${path}.summary`, 240);
  // The summary must identify the proposed work before its detail can be accepted.
  if (!summary.ok) return summary;
  const action = parseImprovementText(raw.action, `${path}.action`, 1000);
  // Without a valid action, the maintainer has no concrete next step.
  if (!action.ok) return action;
  const evidence = parseImprovementText(raw.evidence, `${path}.evidence`, 1000);
  // Without valid evidence, a later reader cannot judge why this improvement was proposed.
  if (!evidence.ok) return evidence;
  const file = expectNullableString(raw.file, `${path}.file`);
  // A file must name the affected surface, or be null for work that applies across the project.
  if (!file.ok) return file;
  return {
    ok: true,
    value: {
      category: category.value,
      summary: summary.value,
      action: action.value,
      evidence: evidence.value,
      file: file.value,
    },
  };
}

/**
 * Preserve the assessment's Top 5 Improvements for later history and diff readers.
 * Use during report ingestion; legacy omission stays distinct from an explicitly empty recommendation list.
 *
 * @param raw - authored list; undefined means not recorded, and an empty array means none were proposed
 * @returns validated recommendations in the author's order, legacy absence, or an error that blocks saving
 */
export function parseQualityImprovements(
  raw: unknown,
): FieldResult<QualityImprovement[] | undefined> {
  // Legacy omission means recommendations were not recorded, not that the assessor proposed none.
  if (raw === undefined) return { ok: true, value: undefined };
  // The saved list follows the prompt's Top 5 limit so later readers receive a prioritized set.
  if (!Array.isArray(raw) || raw.length > QUALITY_MAX_IMPROVEMENTS) {
    return {
      ok: false,
      error: `report.improvements must be an array of at most ${QUALITY_MAX_IMPROVEMENTS} items`,
    };
  }
  const rows: QualityImprovement[] = [];
  // Preserve the assessor's ordering and identify the exact recommendation that needs repair.
  for (const [index, item] of raw.entries()) {
    const row = parseImprovement(item, `report.improvements[${index}]`);
    // One malformed recommendation blocks save instead of silently losing part of the proposed work.
    if (!row.ok) return row;
    rows.push(row.value);
  }
  return { ok: true, value: rows };
}

/**
 * Retain skipped checks so a maintainer can judge the limits behind an assessment's scores.
 * Use for the grounding ledger before accepting its complete, partial, or blocked label.
 *
 * @param raw - authored probe list; an empty array states that no required evidence remains unverified
 * @param path - report field used to identify an invalid or unexplained probe entry
 * @returns non-empty probe descriptions in emitted order, or the first error that prevents a trustworthy ledger
 */
function parseUnverifiedProbes(
  raw: unknown,
  path: string,
): FieldResult<string[]> {
  // Coverage gaps must be a list so history can show each check the assessor could not finish.
  if (!Array.isArray(raw)) {
    return { ok: false, error: `${path} must be an array` };
  }
  const probes: string[] = [];
  // Keep every named gap in report order so maintainers can follow up on the missing checks.
  for (const [index, probe] of raw.entries()) {
    const parsedProbe = expectNonEmptyString(probe, `${path}[${index}]`);
    // A blank gap cannot explain what remains unverified and must be corrected before save.
    if (!parsedProbe.ok) return parsedProbe;
    probes.push(parsedProbe.value);
  }
  return { ok: true, value: probes };
}

/**
 * Keep the visible grounding label consistent with the assessor's list of missing checks.
 * Use before save so a reader never sees complete coverage beside an acknowledged evidence gap.
 *
 * @param groundingStatus - claimed coverage; partial and blocked runs must explain their missing checks
 * @param unverifiedProbes - named evidence gaps; empty is valid only for complete grounding
 * @param path - context field used to direct the report author to the contradictory label
 * @returns success, or a repair message for inconsistent grounding and probe fields
 */
function validateAssessmentGrounding(
  groundingStatus: QualityAssessmentContext["grounding_status"],
  unverifiedProbes: string[],
  path: string,
): FieldResult<true> {
  // Acknowledged missing checks prevent the report from claiming complete evidence coverage.
  if (groundingStatus === "complete" && unverifiedProbes.length > 0) {
    return {
      ok: false,
      error: `${path}.unverified_probes must be empty when grounding_status is complete`,
    };
  }
  // An incomplete assessment must tell the reader which required checks are missing.
  if (groundingStatus !== "complete" && unverifiedProbes.length === 0) {
    return {
      ok: false,
      error: `${path}.unverified_probes must name at least one probe when grounding_status is partial or blocked`,
    };
  }
  return { ok: true, value: true };
}

/**
 * Check that complete grounding refers to a captured workspace that stayed unchanged during assessment.
 * Use after endpoint parsing; historical omission remains readable without inventing snapshot evidence.
 *
 * @param snapshot - copied endpoints; absent means legacy metadata, while null means capture was unavailable
 * @param groundingStatus - assessor's coverage label; partial runs may retain missing or differing captures
 * @param path - context location named when the author must repair a complete-grounding claim
 * @returns success, or an error explaining why the recorded capture cannot support complete grounding
 */
function validateSnapshotGrounding(
  snapshot: QualityAssessmentContext["workspace_snapshot"],
  groundingStatus: QualityAssessmentContext["grounding_status"],
  path: string,
): FieldResult<true> {
  // Partial runs disclose their limits, while historical omission must remain readable.
  if (groundingStatus !== "complete" || snapshot === undefined)
    return { ok: true, value: true };
  // Complete grounding cannot rely on a missing capture or evidence gathered across changing files.
  if (
    snapshot.start === null ||
    snapshot.end === null ||
    snapshot.start !== snapshot.end
  ) {
    return {
      ok: false,
      error: `${path}.grounding_status requires matching captured workspace snapshots when complete`,
    };
  }
  return { ok: true, value: true };
}

/**
 * Prepare the snapshot fields retained beside an assessment's scores.
 * Use before save; complete grounding must agree with the captured workspace, while older reports may omit captures.
 *
 * @param raw - snapshot object; omission keeps legacy reports readable, while null endpoints record unavailable captures
 * @param groundingStatus - reported evidence coverage, checked against snapshot availability and drift
 * @param path - context field used to identify the evidence the author must repair
 * @returns optional snapshot fields ready to retain, or the first validation error
 */
function parseAssessmentWorkspace(
  raw: unknown,
  groundingStatus: QualityAssessmentContext["grounding_status"],
  path: string,
): FieldResult<Pick<QualityAssessmentContext, "workspace_snapshot">> {
  const workspace = parseWorkspaceSnapshot(raw, `${path}.workspace_snapshot`);
  // Malformed capture identifiers cannot establish whether the assessed files stayed the same.
  if (!workspace.ok) return workspace;
  const grounding = validateSnapshotGrounding(
    workspace.value,
    groundingStatus,
    path,
  );
  // Missing or changing captures cannot support a claim of complete grounding.
  if (!grounding.ok) return grounding;
  return {
    ok: true,
    // Omission preserves old reports without inventing a recorded capture.
    value:
      workspace.value === undefined
        ? {}
        : { workspace_snapshot: workspace.value },
  };
}

/**
 * Validate the workspace and evidence context shown beside a saved assessment's scores.
 * Use at report ingestion so maintainers can distinguish missing checks from changes in the assessed project.
 *
 * @param raw - authored context; missing or non-object values cannot explain this run's evidence coverage
 * @param path - context field shown in quality save's repair message
 * @returns validated context with optional legacy snapshot absence, or the first field the author must correct
 */
export function parseAssessmentContext(
  raw: unknown,
  path: string,
): FieldResult<QualityAssessmentContext> {
  // Assessment context must name the workspace and coverage behind the displayed scores.
  if (!isRecord(raw)) return { ok: false, error: `${path} must be an object` };
  const unknownKeyError = rejectUnknownKeys(
    raw,
    [
      "project_revision",
      "working_tree_state",
      "grounding_status",
      "unverified_probes",
      "score_confidence",
      "workspace_snapshot",
    ],
    path,
  );
  // Unknown context fields could hide a limitation the author expected future readers to see.
  if (unknownKeyError) return { ok: false, error: unknownKeyError };

  const projectRevision = expectNullableString(
    raw.project_revision,
    `${path}.project_revision`,
  );
  // Revision evidence must identify the assessed commit, or explicitly admit it was unavailable.
  if (!projectRevision.ok) return projectRevision;
  const workingTreeState = expectEnumValue(
    raw.working_tree_state,
    `${path}.working_tree_state`,
    QUALITY_WORKTREE_STATES,
  );
  // The worktree label must distinguish recorded changes from unavailable Git evidence.
  if (!workingTreeState.ok) return workingTreeState;
  const groundingStatus = expectEnumValue(
    raw.grounding_status,
    `${path}.grounding_status`,
    QUALITY_GROUNDING_STATUSES,
  );
  // Unsupported grounding labels cannot tell the reader how much evidence was checked.
  if (!groundingStatus.ok) return groundingStatus;
  const unverifiedProbes = parseUnverifiedProbes(
    raw.unverified_probes,
    `${path}.unverified_probes`,
  );
  // An invalid probe list cannot explain the limits behind this assessment.
  if (!unverifiedProbes.ok) return unverifiedProbes;
  const grounding = validateAssessmentGrounding(
    groundingStatus.value,
    unverifiedProbes.value,
    path,
  );
  // Contradictory coverage fields would make the assessment look more complete than its evidence.
  if (!grounding.ok) return grounding;
  const scoreConfidence = expectEnumValue(
    raw.score_confidence,
    `${path}.score_confidence`,
    QUALITY_SCORE_CONFIDENCES,
  );
  // The confidence label must use a value that history readers can interpret consistently.
  if (!scoreConfidence.ok) return scoreConfidence;

  const workspace = parseAssessmentWorkspace(
    raw.workspace_snapshot,
    groundingStatus.value,
    path,
  );
  // The capture must be valid and consistent with the coverage the author claimed.
  if (!workspace.ok) return workspace;

  return {
    ok: true,
    value: {
      ...workspace.value,
      project_revision: projectRevision.value,
      working_tree_state: workingTreeState.value,
      grounding_status: groundingStatus.value,
      unverified_probes: unverifiedProbes.value,
      score_confidence: scoreConfidence.value,
    },
  };
}
