/**
 * Turns individual harness check results into the five concern scores a user reads.
 *
 * This is the scoring model behind an audit report: it decides whether a failed check blocks the concern or merely lowers its score, folds in repair
 * steps, and records the caveats that stop a green concern from being mistaken for a stronger guarantee than it is.
 *
 * The distinction that matters to the reader is check type.
 * Integrity checks are required setup and a failure means something is genuinely missing; advisory checks can be knowingly acknowledged and stay
 * visible without failing; metric checks only move the number.
 *
 * Keeping that split here means the report can never quietly promote a score-only gap into a failure.
 */
import { labelEvidencePathBases } from "./audit-provenance.js";
import type {
  AuditConcern,
  AuditConcernKey,
  AuditFailure,
  CheckResult,
  HarnessCheck,
  HarnessCheckResult,
} from "./types.js";

/**
 * Decide how one check result should look on screen and whether it blocks the audit.
 * Use for every row the dashboard and CLI render, so the colour a user sees matches the consequence: a red row is something that failed their audit,
 * an amber one is not.
 *
 * @param status - what the check reported for this project
 * @param type - the check's kind; metric checks only move the score, never the verdict
 * @param acknowledged - whether the user opted out of this advisory in their config;
 *   defaults to false, meaning an unacknowledged failure still blocks
 * @param failureImpact - explicit score-only override for a non-blocking advisory
 * @returns the display status and impact used to render and score the row
 */
export function classifyCheckImpact(
  status: CheckResult["status"],
  type: CheckResult["type"],
  acknowledged = false,
  failureImpact?: HarnessCheck["failureImpact"],
): Pick<CheckResult, "displayStatus" | "impact"> {
  if (status === "skipped") return { displayStatus: "skipped", impact: "none" };
  if (status === "pass") {
    return {
      displayStatus: type === "metric" ? "info" : "pass",
      impact: "none",
    };
  }
  if (type === "metric" || acknowledged || failureImpact === "score-only") {
    return { displayStatus: "warn", impact: "score-only" };
  }
  return { displayStatus: "fail", impact: "scope-fail" };
}

/** Attach evidence text that explains whether a failing harness check gates status. */
function explainHarnessFailure(
  check: HarnessCheck,
  failure: AuditFailure | undefined,
  acknowledged: boolean,
): AuditFailure | undefined {
  if (!failure) return undefined;
  if (check.type === "metric") {
    return {
      ...failure,
      evidence:
        "Metric (score-only; lowers the concern score but does not fail audit status).",
    };
  }
  if (check.type !== "advisory") return failure;
  if (check.failureImpact === "score-only") {
    return {
      ...failure,
      evidence: acknowledged
        ? `Advisory (acknowledged via harness.acknowledge: [${check.id}]; score-only and does not fail audit status).`
        : "Advisory (score-only; lowers the concern score but does not fail audit status).",
    };
  }
  return {
    ...failure,
    evidence: acknowledged
      ? `Advisory (acknowledged via harness.acknowledge: [${check.id}]). Best practice, not install drift.`
      : `Advisory (best practice, not install drift). Silence with harness.acknowledge: [${check.id}] in .goat-flow/config.yaml, or fix to reach pass.`,
  };
}

/**
 * Convert a harness check and its result into the row a user sees in the report.
 * Use when building scope output, so each check carries its own display status and, when it failed, wording that says whether the failure actually
 * blocks them.
 *
 * @param check - the registered check being reported
 * @param result - what that check found on this project
 * @param acknowledged - whether the user opted out of this advisory in their config; true
 *   keeps the gap visible without failing their audit
 * @returns one report row; its `failure` is undefined when nothing needs the user's attention
 */
export function toCheckResult(
  check: HarnessCheck,
  result: HarnessCheckResult,
  acknowledged: boolean,
): CheckResult {
  const baseFailure =
    result.status === "fail"
      ? {
          check: check.name,
          message:
            result.recommendations[0] ?? result.findings[0] ?? "Check failed",
          howToFix: result.howToFix?.[0],
        }
      : undefined;

  const failure = explainHarnessFailure(check, baseFailure, acknowledged);
  const impact = classifyCheckImpact(
    result.status,
    check.type,
    acknowledged,
    check.failureImpact,
  );

  return {
    id: check.id,
    name: check.name,
    status: result.status,
    ...impact,
    ...(result.displayStatus ? { displayStatus: result.displayStatus } : {}),
    provenance: labelEvidencePathBases(check.provenance),
    failure,
    type: check.type,
    acknowledged: acknowledged || undefined,
    evidenceKind: check.evidenceKind,
    assurance: result.assurance,
    details: result.details,
  };
}

/**
 * Start one concern at zero before any check has reported into it.
 * Use once per concern at the top of a run, so a project with no applicable checks scores zero rather than inheriting a passing look it never earned.
 *
 * @returns a fresh concern with empty finding, limit, and remediation lists; empty lists mean
 *   nothing has been observed yet, not that the concern was proven clean
 */
export function emptyConcern(): AuditConcern {
  return {
    status: "pass",
    score: 0,
    findings: [],
    limits: [],
    recommendations: [],
    howToFix: [],
    integrityPass: 0,
    integrityFail: 0,
    advisoryPass: 0,
    advisoryFail: 0,
    advisoryAcknowledged: 0,
    metrics: 0,
  };
}

const PROJECT_VALIDATION_EXECUTION_LIMIT =
  "This audit inspected verification guidance and hook configuration; it did not execute project build, test, lint, typecheck, or format commands.";
const RED_FLAGS_METRIC_LIMIT =
  "Instruction-file evidence-before-claims red-flags coverage is metric-only; gaps lower the Verification score but do not fail audit status.";
const RECOVERY_RESUMABILITY_LIMIT =
  "Recovery storage is available, but this audit did not validate the current objective, completed work, last verification, next action, or end-to-end resumability.";

/**
 * Add a caveat once so users do not see repeated limits from overlapping checks.
 *
 * @param concern - the concern whose caveat list the reader will see
 * @param limit - the caveat text; a duplicate is dropped silently so the report stays readable
 */
export function addUniqueConcernLimit(
  concern: AuditConcern,
  limit: string,
): void {
  // A repeated caveat adds noise without giving the user stronger evidence.
  if (concern.limits.includes(limit)) return;
  concern.limits.push(limit);
}

/**
 * Explain what perfect structural scores still did not prove for the audit reader.
 * Use at the end of a run, so a user seeing five green concerns is told plainly that the audit inspected configuration rather than running their
 * build, tests, or recovery flow.
 *
 * @param concerns - the five concerns about to be shown; each gains the caveats that apply
 *   to it, and a concern that already failed keeps its findings as the louder signal
 */
export function addStructuralAssuranceLimits(
  concerns: Record<AuditConcernKey, AuditConcern>,
): void {
  addUniqueConcernLimit(
    concerns.verification,
    PROJECT_VALIDATION_EXECUTION_LIMIT,
  );
  addUniqueConcernLimit(concerns.verification, RED_FLAGS_METRIC_LIMIT);

  // Passing recovery checks prove storage exists, not that a user can resume the latest work.
  if (concerns.recovery.status === "pass") {
    addUniqueConcernLimit(concerns.recovery, RECOVERY_RESUMABILITY_LIMIT);
  }
}

/** Copy user actions from a failed check into the concern summary shown after the audit. */
function addRemediation(
  concern: AuditConcern,
  result: HarnessCheckResult,
): void {
  concern.recommendations.push(...result.recommendations);
  // Checks without a concrete repair leave the user with guidance instead of an invented command.
  if (result.howToFix) concern.howToFix.push(...result.howToFix);
}

/** Apply one score-only signal without turning a structurally valid concern into a failure. */
function applyMetricCheck(
  concern: AuditConcern,
  result: HarnessCheckResult,
): void {
  concern.metrics++;
  // A passing metric needs no score caveat or remediation in the user-facing result.
  if (result.status !== "fail") return;
  addUniqueConcernLimit(
    concern,
    `Score-only metric failed: ${result.findings.join("; ")}`,
  );
  addRemediation(concern, result);
}

/** Count whether one required setup check passed for the concern the user is viewing. */
function applyIntegrityCheck(
  concern: AuditConcern,
  result: HarnessCheckResult,
): void {
  // A required pass raises completeness; a failure keeps the missing setup visible.
  if (result.status === "pass") concern.integrityPass++;
  else concern.integrityFail++;
}

/** Count an optional recommendation while respecting an explicit user acknowledgement. */
function applyAdvisoryCheck(
  concern: AuditConcern,
  result: HarnessCheckResult,
  acknowledged: boolean,
): void {
  // Passing advice is complete; acknowledged gaps remain visible without failing the audit.
  if (result.status === "pass") concern.advisoryPass++;
  else if (acknowledged) concern.advisoryAcknowledged++;
  else concern.advisoryFail++;
}

/**
 * Fold one check result into the concern score the user reads.
 * This is where a finding either blocks the concern or only moves its number, so it decides whether the user is told "this is missing" or "this could
 * be better". It reports a blocking failure by marking the concern failed, never by throwing.
 *
 * @param concern - the concern accumulating this check's outcome
 * @param check - the check being applied; its type decides whether a failure can block
 * @param result - what the check found on this project
 * @param acknowledged - whether the user opted out of this advisory in their config; true
 *   records the gap without failing their audit
 */
export function applyCheckToConcern(
  concern: AuditConcern,
  check: HarnessCheck,
  result: HarnessCheckResult,
  acknowledged: boolean,
): void {
  concern.findings.push(...result.findings);
  // Check-specific caveats stay visible once, even when checks report the same limitation.
  if (result.limits) {
    // Each distinct caveat gives the audit reader one additional evidence boundary.
    for (const limit of result.limits) addUniqueConcernLimit(concern, limit);
  }
  // Metrics affect the displayed score without turning the concern into a hard failure.
  if (check.type === "metric") {
    applyMetricCheck(concern, result);
    return;
  }
  // Integrity checks represent required setup; advisories can be acknowledged explicitly.
  if (check.type === "integrity") {
    applyIntegrityCheck(concern, result);
  } else {
    applyAdvisoryCheck(concern, result, acknowledged);
  }
  // Unacknowledged failures keep their remediation visible even when they are score-only.
  if (result.status === "fail" && !acknowledged) {
    addRemediation(concern, result);
    if (check.failureImpact !== "score-only") concern.status = "fail";
  }
}

/**
 * Render a check that did not apply to this project rather than hiding it.
 * Use when scope rules exclude a check, so the user sees it was considered and skipped instead of wondering why their report is shorter than someone
 * else's.
 *
 * @param check - the check being reported as not applicable here
 * @returns a skipped row with no impact on the concern's pass or fail state
 */
export function skippedHarnessCheck(check: HarnessCheck): CheckResult {
  const impact = classifyCheckImpact("skipped", check.type);
  return {
    id: check.id,
    name: check.name,
    status: "skipped",
    ...impact,
    provenance: labelEvidencePathBases(check.provenance),
    type: check.type,
    evidenceKind: check.evidenceKind,
  };
}
