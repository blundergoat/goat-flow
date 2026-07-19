/**
 * Builds the advisory target-readiness report shown before an agent starts project work.
 * Use this diagnostic to compare static project evidence across goat-flow's five concerns,
 * identify the first repair blockers, and display inferred commands without executing them.
 */
import type { AgentId, StackInfo } from "../types.js";
import { getAgentProfile } from "../agents/registry.js";
import { createFS } from "../facts/fs.js";
import { detectStack } from "../detect/project-stack.js";
import { runAudit } from "../audit/audit.js";
import { HARNESS_CHECKS } from "../audit/harness/index.js";
import type {
  AuditConcern,
  AuditConcernKey,
  AuditReport,
  CheckResult,
} from "../audit/types.js";
import { THREAT_MODEL_DIAGNOSTIC_COMMAND } from "./threat-model.js";

/** Canonical concern order used by JSON, terminal output, and blocker ranking. */
const READINESS_CONCERNS: readonly AuditConcernKey[] = [
  "context",
  "constraints",
  "verification",
  "recovery",
  "feedback_loop",
];

/** User-facing names keep machine keys stable while terminal output stays readable. */
const READINESS_CONCERN_LABELS: Record<AuditConcernKey, string> = {
  context: "Context",
  constraints: "Constraints",
  verification: "Verification",
  recovery: "Recovery",
  feedback_loop: "Feedback loop",
};

/** Static preparedness labels ordered by how much work remains before agent use. */
type ReadinessLabel = "ready" | "needs-attention" | "not-ready" | "unknown";

/** Evidence states keep missing proof separate from evidence the static audit cannot observe. */
type ReadinessEvidenceState = "verified" | "inferred" | "missing" | "unknown";

/** One concern row a terminal user or dashboard can display without recalculating audit checks. */
interface ReadinessConcern {
  label: ReadinessLabel;
  evidenceState: ReadinessEvidenceState;
  checks: {
    passed: number;
    failed: number;
    skipped: number;
  };
  limits: string[];
}

/** One actionable failed check, capped to the first three blockers in canonical concern order. */
interface ReadinessBlocker {
  id: string;
  concern: AuditConcernKey;
  summary: string;
  evidenceState: "missing" | "unknown";
  evidencePath: string | null;
  guidance: string;
}

/** One statically detected project command that the report displays but never executes. */
interface ReadinessNextCommand {
  purpose: "test" | "lint" | "build" | "format";
  command: string;
  evidenceState: "inferred";
  execution: "disabled";
}

/** Stable dashboard-ready result for one selected target project. */
export interface ReadinessReport {
  schema: "goat-flow.readiness-report.v1";
  projectPath: string;
  advisory: true;
  execution: {
    evidenceSource: "static-local-files";
    targetCodeExecuted: false;
    projectCommandsExecuted: false;
  };
  summary: {
    overallLabel: ReadinessLabel;
    readyConcerns: number;
    needsAttentionConcerns: number;
    notReadyConcerns: number;
    unknownConcerns: number;
    blockerCount: number;
  };
  concerns: Record<AuditConcernKey, ReadinessConcern>;
  blockers: ReadinessBlocker[];
  relatedDiagnostics: {
    threatModel: typeof THREAT_MODEL_DIAGNOSTIC_COMMAND;
  };
  nextCommands: ReadinessNextCommand[];
}

/** Inputs already collected by the static stack detector and harness audit. */
export interface BuildReadinessReportInput {
  projectPath: string;
  audit: AuditReport;
  stack: StackInfo;
}

const CONCERN_FOR_HARNESS_CHECK = new Map(
  HARNESS_CHECKS.map((check) => [check.id, check.concern] as const),
);

/**
 * Select harness checks belonging to one user-facing concern.
 * A missing harness scope means the concern has no observable checks and remains unknown.
 *
 * @param audit - deterministic audit result; a null harness scope means readiness cannot classify checks
 * @param concern - canonical concern requested by the dashboard or text renderer
 * @returns matching checks in audit order; empty means no applicable evidence was observed
 */
function checksForConcern(
  audit: AuditReport,
  concern: AuditConcernKey,
): CheckResult[] {
  // A build-only audit has no concern checks, so the readiness row must stay unknown.
  const harnessChecks = audit.scopes.harness?.checks ?? [];
  return harnessChecks.filter(
    (check) => CONCERN_FOR_HARNESS_CHECK.get(check.id) === concern,
  );
}

/**
 * Convert deterministic check outcomes into one ordinal preparedness label.
 * Skipped-only concerns remain unknown instead of becoming false failures.
 *
 * @param checks - checks assigned to one concern; empty means the audit observed nothing applicable
 * @returns advisory concern label; `not-ready` means every applicable check failed
 */
function concernReadinessLabel(checks: CheckResult[]): ReadinessLabel {
  const applicableChecks = checks.filter((check) => check.status !== "skipped");

  // No applicable check means the user needs more evidence, not a fabricated pass or failure.
  if (applicableChecks.length === 0) return "unknown";
  const passedChecks = applicableChecks.filter(
    (check) => check.status === "pass",
  ).length;
  const failedChecks = applicableChecks.filter(
    (check) => check.status === "fail",
  ).length;

  // No failures means the static requirements observed for this concern are ready.
  if (failedChecks === 0) return "ready";
  // No passing check means this concern has no usable configured evidence yet.
  if (passedChecks === 0) return "not-ready";
  return "needs-attention";
}

/**
 * Describe the strongest honest evidence state behind one concern label.
 * Recorded limits lower confidence without changing a passing readiness label.
 *
 * @param checks - deterministic concern checks; skipped-only input means evidence is unknown
 * @param limits - audit caveats; empty means the audit recorded no non-gating boundary
 * @returns `missing`, `unknown`, `inferred`, or `verified` for direct UI display
 */
function concernEvidenceState(
  checks: CheckResult[],
  limits: string[],
): ReadinessEvidenceState {
  const applicableChecks = checks.filter((check) => check.status !== "skipped");

  // No applicable check leaves the user without evidence for this concern.
  if (applicableChecks.length === 0) return "unknown";
  // A failed requirement is direct evidence that required setup is missing.
  if (applicableChecks.some((check) => check.status === "fail")) {
    return "missing";
  }
  const hasLimitedCheck = applicableChecks.some(
    (check) => check.assurance === "limited",
  );
  // A caveat or limited check proves only part of the concern's intended behavior.
  if (limits.length > 0 || hasLimitedCheck) return "inferred";
  return "verified";
}

/**
 * Count pass, fail, and skipped outcomes for one concern row.
 * Empty input produces three zeroes so dashboards can render an honest empty state.
 *
 * @param checks - checks assigned to the concern; empty means no observable evidence
 * @returns stable outcome counters whose sum equals the number of supplied checks
 */
function countConcernChecks(checks: CheckResult[]): ReadinessConcern["checks"] {
  return {
    passed: checks.filter((check) => check.status === "pass").length,
    failed: checks.filter((check) => check.status === "fail").length,
    skipped: checks.filter((check) => check.status === "skipped").length,
  };
}

/**
 * Build one concern row from the audit result and optional aggregate caveats.
 * A missing aggregate concern retains an empty limit list and unknown evidence.
 *
 * @param audit - harness audit supplying individual check outcomes
 * @param concernKey - canonical concern selected for the readiness report
 * @param auditConcern - aggregate concern details; null means no harness aggregate was available
 * @returns one dashboard-ready concern row with no invented score
 */
function buildReadinessConcern(
  audit: AuditReport,
  concernKey: AuditConcernKey,
  auditConcern: AuditConcern | null,
): ReadinessConcern {
  const checks = checksForConcern(audit, concernKey);
  // A build-only or legacy audit has no limits, so readiness preserves compatibility with an empty list.
  const limits = auditConcern?.limits ?? [];
  return {
    label: concernReadinessLabel(checks),
    evidenceState: concernEvidenceState(checks, limits),
    checks: countConcernChecks(checks),
    limits: [...limits],
  };
}

/**
 * Read the selected agent from check-specific audit detail when failure prose omits its file.
 * Empty or unrelated detail returns null so the blocker does not guess an agent surface.
 *
 * @param check - failed audit check whose structured detail may identify one selected agent
 * @returns manifest-backed agent id, or null when this check has no agent-specific detail
 */
function selectedBlockerAgent(check: CheckResult): AgentId | null {
  const details = check.details;
  // No structured detail means the report must rely on explicit failure text or target provenance.
  if (details === undefined) return null;
  const agentDetailRows = [
    details.lineCounts,
    details.executionLoop,
    details.sections,
    details.boundary,
  ].find((detailRows) => detailRows !== undefined);
  return agentDetailRows?.[0]?.agent ?? null;
}

/**
 * Find a target evidence path explicitly named in the failed check's repair copy.
 * This preserves the selected target because framework provenance may list unrelated rule sources.
 *
 * @param check - failed check whose message and guidance may name its repair file
 * @returns named target path, or null when the failure copy names no known target evidence
 */
function failureNamedEvidencePath(check: CheckResult): string | null {
  const failureText = `${check.failure?.message ?? ""} ${check.failure?.howToFix ?? ""}`;
  const knownTargetPaths = [
    ...(check.provenance.target_evidence_paths ?? []),
    ...(check.provenance.evidence_paths ?? []),
  ];
  return (
    knownTargetPaths.find((evidencePath) =>
      failureText.includes(evidencePath),
    ) ?? null
  );
}

/**
 * Return the sole target evidence path when provenance leaves no choice to make.
 * Multiple or empty paths return null so users never receive a guessed repair location.
 *
 * @param check - failed check with zero or more target evidence paths
 * @returns the only target path, or null when provenance is empty or ambiguous
 */
function soleTargetEvidencePath(check: CheckResult): string | null {
  const targetEvidencePaths = check.provenance.target_evidence_paths ?? [];
  // Exactly one target path is safe to present as the repair surface.
  if (targetEvidencePaths.length === 1) return targetEvidencePaths[0] ?? null;
  return null;
}

/**
 * Find the target file the failed check actually asks the user to repair.
 * Normative provenance is used only when failure text names it or exactly one target path exists.
 *
 * @param check - failed audit check whose provenance may cite multiple agents or framework sources
 * @returns selected target path; null means no honest repair location can be derived
 */
function blockerEvidencePath(check: CheckResult): string | null {
  const namedEvidencePath = failureNamedEvidencePath(check);
  // A path named by the failure is the exact surface the user was told to repair.
  if (namedEvidencePath !== null) return namedEvidencePath;
  const selectedAgent = selectedBlockerAgent(check);
  // Agent-specific detail resolves ambiguous multi-agent provenance through the canonical manifest.
  if (selectedAgent !== null) {
    return getAgentProfile(selectedAgent).instructionFile;
  }
  return soleTargetEvidencePath(check);
}

/**
 * Convert one failed harness check into concise user-facing repair evidence.
 * Use this only after the audit has established the check failed.
 *
 * @param check - failed deterministic check; absent failure prose falls back to its display name
 * @param concern - concern owning the check, used for stable blocker grouping
 * @returns blocker with file evidence when available and practical repair guidance
 */
function readinessBlocker(
  check: CheckResult,
  concern: AuditConcernKey,
): ReadinessBlocker {
  const evidencePath = blockerEvidencePath(check);
  // Missing failure details must not produce an empty blocker in terminal or JSON output.
  const summary = check.failure?.message ?? check.name;
  const guidance =
    check.failure?.howToFix ?? `Review the ${check.name} requirement.`;
  // A file citation gives direct missing evidence; without one the location remains unknown.
  const evidenceState = evidencePath === null ? "unknown" : "missing";
  return {
    id: check.id,
    concern,
    summary,
    evidenceState,
    evidencePath,
    guidance,
  };
}

/**
 * Select the first three failed checks in canonical concern and audit order.
 * Empty failure sets produce no blockers instead of generic recommendations.
 *
 * @param audit - harness audit supplying ordered deterministic check results
 * @returns at most three actionable blockers with their owning concern
 */
function collectTopBlockers(audit: AuditReport): ReadinessBlocker[] {
  const blockers: ReadinessBlocker[] = [];

  // Concern order matches the five-part model users see throughout goat-flow.
  for (const concern of READINESS_CONCERNS) {
    // Audit order keeps the first repair stable when multiple checks fail together.
    for (const check of checksForConcern(audit, concern)) {
      // Passing and skipped checks are evidence rows, not blockers the user must repair.
      if (check.status !== "fail") continue;
      blockers.push(readinessBlocker(check, concern));
      // Three blockers keep the initial action list useful instead of recreating full audit output.
      if (blockers.length === 3) return blockers;
    }
  }
  return blockers;
}

/**
 * Convert detected project commands into disabled suggestions for a readiness user.
 * Empty or duplicate commands are omitted; none are executed by this report.
 *
 * @param stack - static project-stack facts; null command slots mean no suggestion is available
 * @returns inferred commands in test, lint, build, format order; empty means nothing was detected
 */
function collectNextCommands(stack: StackInfo): ReadinessNextCommand[] {
  const detectedCommands: Array<{
    purpose: ReadinessNextCommand["purpose"];
    command: string | null;
  }> = [
    { purpose: "test", command: stack.testCommand },
    { purpose: "lint", command: stack.lintCommand },
    { purpose: "build", command: stack.buildCommand },
    { purpose: "format", command: stack.formatCommand },
  ];
  const seenCommands = new Set<string>();
  const nextCommands: ReadinessNextCommand[] = [];

  // Each detected command stays inert while still telling the user what verification exists.
  for (const detectedCommand of detectedCommands) {
    // An absent or blank command gives the user no safe action to inspect.
    if (
      detectedCommand.command === null ||
      detectedCommand.command.trim().length === 0
    ) {
      continue;
    }
    // Duplicate script values add no new next action when one command serves two purposes.
    if (seenCommands.has(detectedCommand.command)) continue;
    seenCommands.add(detectedCommand.command);
    nextCommands.push({
      purpose: detectedCommand.purpose,
      command: detectedCommand.command,
      evidenceState: "inferred",
      execution: "disabled",
    });
  }
  return nextCommands;
}

/**
 * Summarize concern labels without averaging or weighting unrelated evidence.
 * A mixed project needs attention; only an entirely unprepared project is not ready.
 *
 * @param concerns - five concern rows whose labels were derived from check outcomes
 * @returns overall advisory label; unknown means no observed concern needs repair yet
 */
function overallReadinessLabel(
  concerns: Record<AuditConcernKey, ReadinessConcern>,
): ReadinessLabel {
  const concernRows = Object.values(concerns);
  const notReadyCount = concernRows.filter(
    (concern) => concern.label === "not-ready",
  ).length;
  const needsAttentionCount = concernRows.filter(
    (concern) => concern.label === "needs-attention",
  ).length;
  const readyCount = concernRows.filter(
    (concern) => concern.label === "ready",
  ).length;

  // Every concern lacking usable evidence means the target is not ready for governed agent work.
  if (notReadyCount === READINESS_CONCERNS.length) return "not-ready";
  // Mixed ready and missing evidence gives the user a repair queue, not a release gate.
  if (notReadyCount > 0 || needsAttentionCount > 0) return "needs-attention";
  // With no repair failures but incomplete observation, the overall state remains unknown.
  if (readyCount < READINESS_CONCERNS.length) return "unknown";
  return "ready";
}

/**
 * Read one aggregate concern while keeping legacy audits honest about missing data.
 * A null aggregate returns null so the concern row becomes unknown, not ready.
 *
 * @param audit - deterministic audit whose aggregate concern block may be absent
 * @param concernKey - concern the readiness user is currently viewing
 * @returns aggregate concern evidence, or null when this audit cannot supply it
 */
function aggregateAuditConcern(
  audit: AuditReport,
  concernKey: AuditConcernKey,
): AuditConcern | null {
  // A build-only or legacy payload has no aggregate concern evidence for the user.
  if (audit.concerns === null) return null;
  return audit.concerns[concernKey];
}

/**
 * Build all five concern rows in the stable order exposed to users and dashboards.
 * Keeping this mapping together prevents one output format from silently omitting a concern.
 *
 * @param audit - harness audit supplying checks and optional aggregate concern evidence
 * @returns complete concern record; unavailable aggregate evidence produces unknown rows
 */
function buildReadinessConcerns(
  audit: AuditReport,
): Record<AuditConcernKey, ReadinessConcern> {
  return {
    context: buildReadinessConcern(
      audit,
      "context",
      aggregateAuditConcern(audit, "context"),
    ),
    constraints: buildReadinessConcern(
      audit,
      "constraints",
      aggregateAuditConcern(audit, "constraints"),
    ),
    verification: buildReadinessConcern(
      audit,
      "verification",
      aggregateAuditConcern(audit, "verification"),
    ),
    recovery: buildReadinessConcern(
      audit,
      "recovery",
      aggregateAuditConcern(audit, "recovery"),
    ),
    feedback_loop: buildReadinessConcern(
      audit,
      "feedback_loop",
      aggregateAuditConcern(audit, "feedback_loop"),
    ),
  };
}

/**
 * Count concern labels and attach the blocker total shown at the top of the report.
 * Counts remain separate because each concern is evidence, not a weighted numeric score.
 *
 * @param concerns - complete five-concern record already classified for readiness
 * @param blockerCount - capped actionable blocker total; zero means no failed check was selected
 * @returns stable summary counters and the overall advisory label
 */
function summarizeReadiness(
  concerns: Record<AuditConcernKey, ReadinessConcern>,
  blockerCount: number,
): ReadinessReport["summary"] {
  const concernRows = Object.values(concerns);
  return {
    overallLabel: overallReadinessLabel(concerns),
    readyConcerns: concernRows.filter((concern) => concern.label === "ready")
      .length,
    needsAttentionConcerns: concernRows.filter(
      (concern) => concern.label === "needs-attention",
    ).length,
    notReadyConcerns: concernRows.filter(
      (concern) => concern.label === "not-ready",
    ).length,
    unknownConcerns: concernRows.filter(
      (concern) => concern.label === "unknown",
    ).length,
    blockerCount,
  };
}

/**
 * Build the timestamp-free readiness contract consumed by text, JSON, and future dashboards.
 * Use after static stack detection and a present-only harness audit complete.
 *
 * @param input - selected target, deterministic audit, and inferred stack commands
 * @returns five concern labels, top blockers, and disabled command suggestions
 */
export function buildReadinessReport(
  input: BuildReadinessReportInput,
): ReadinessReport {
  const concerns = buildReadinessConcerns(input.audit);
  const blockers = collectTopBlockers(input.audit);
  return {
    schema: "goat-flow.readiness-report.v1",
    projectPath: input.projectPath,
    advisory: true,
    execution: {
      evidenceSource: "static-local-files",
      targetCodeExecuted: false,
      projectCommandsExecuted: false,
    },
    summary: summarizeReadiness(concerns, blockers.length),
    concerns,
    blockers,
    relatedDiagnostics: { threatModel: THREAT_MODEL_DIAGNOSTIC_COMMAND },
    nextCommands: collectNextCommands(input.stack),
  };
}

/**
 * Collect readiness from local files without running target hooks, tests, or scripts.
 * Use when a user names a project path and wants preparedness evidence before agent work.
 *
 * @param projectPath - selected target root; an empty path is resolved by the CLI before this call
 * @param agent - selected agent mirror; null means inspect every manifest-backed agent statically
 * @returns advisory readiness report; empty targets produce missing evidence instead of throwing
 */
export function collectReadinessReport(
  projectPath: string,
  agent: AgentId | null,
): ReadinessReport {
  const projectFiles = createFS(projectPath);
  const audit = runAudit(projectFiles, projectPath, {
    agentFilter: agent,
    harness: true,
    checkDrift: false,
    checkContent: false,
    denyMechanismEvidenceLevel: "present-only",
    shouldRunAutoDrift: false,
  });
  const stack = detectStack(projectFiles);
  return buildReadinessReport({ projectPath, audit, stack });
}

/**
 * Render stable JSON for dashboards, support tools, and CI inspection.
 * Empty arrays remain explicit so consumers never infer missing fields.
 *
 * @param report - complete readiness result; empty blockers and commands remain visible arrays
 * @returns one parseable JSON object with no progress text or runtime claims
 */
export function renderReadinessReportJson(report: ReadinessReport): string {
  return JSON.stringify(report, null, 2);
}

/** Format one concern row for the concise terminal report users scan before agent work. */
function renderConcernRow(
  concernKey: AuditConcernKey,
  concern: ReadinessConcern,
): string {
  const checks = concern.checks;
  return `  - ${READINESS_CONCERN_LABELS[concernKey]}: ${concern.label} [${concern.evidenceState}] (${checks.passed} pass, ${checks.failed} fail, ${checks.skipped} skipped)`;
}

/** Format one blocker with its best available file citation and repair guidance. */
function renderBlockerRow(blocker: ReadinessBlocker, position: number): string {
  // No file citation means the user sees an explicit unknown location instead of a blank suffix.
  const evidenceLocation = blocker.evidencePath ?? "evidence path unknown";
  return `  ${position}. [${READINESS_CONCERN_LABELS[blocker.concern]}] ${blocker.summary} (${evidenceLocation}) - ${blocker.guidance}`;
}

/**
 * Render the five concern labels, top blockers, and disabled commands for terminal users.
 * Use before agent work when the operator needs the first repair action, not full audit detail.
 *
 * @param report - complete readiness result; empty sections receive explicit `None` messages
 * @returns concise plain-English output that states its advisory and no-execution boundary
 */
export function renderReadinessReportText(report: ReadinessReport): string {
  const lines = [
    "Target readiness report",
    `Path: ${report.projectPath}`,
    `Overall: ${report.summary.overallLabel}`,
    "Advisory only; no target code or project commands were executed.",
    "",
    "Concerns:",
  ];

  // Every report presents all five concerns in the same order for fast comparison.
  for (const concernKey of READINESS_CONCERNS) {
    lines.push(renderConcernRow(concernKey, report.concerns[concernKey]));
  }
  lines.push("", "Top blockers:");
  // A ready target still receives an explicit blocker-free state.
  if (report.blockers.length === 0) {
    lines.push("  - None.");
  } else {
    // Numbered blockers tell the user which repair to attempt first.
    for (const [index, blocker] of report.blockers.entries()) {
      lines.push(renderBlockerRow(blocker, index + 1));
    }
  }
  lines.push("", "Next commands (inferred, disabled):");
  // No detected commands means the report must not invent executable guidance.
  if (report.nextCommands.length === 0) {
    lines.push("  - None detected.");
  } else {
    // Each suggestion repeats the disabled state so copied output cannot imply execution.
    for (const command of report.nextCommands) {
      lines.push(
        `  - ${command.purpose}: ${command.command} [${command.evidenceState}, ${command.execution}]`,
      );
    }
  }
  lines.push("", `Threat posture: ${report.relatedDiagnostics.threatModel}`);
  return lines.join("\n");
}
