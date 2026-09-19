/**
 * Run the selected project's audit and assemble the report shown by the CLI and dashboard.
 *
 * Setup and agent checks establish installation status; optional harness, drift, and content checks add their own results.
 * Single and batch entry points share the same report rules while keeping each agent's extracted facts separate.
 */
import type { AgentId, ProjectFacts, ReadonlyFS } from "../types.js";
import { loadConfig } from "../config/index.js";
import { extractProjectFacts } from "../facts/orchestrator.js";
import { SETUP_CHECKS } from "./check-goat-flow.js";
import { AGENT_CHECKS } from "./check-agent-setup.js";
import { HARNESS_CHECKS } from "./harness/index.js";
import { checkDrift } from "./check-drift.js";
import {
  buildEnforcementMatrix,
  type AgentEnforcementCapability,
} from "./enforcement.js";
import { computeContent } from "./audit-content.js";
import { shouldAutoRunDrift } from "./audit-drift-policy.js";
import { createAuditFactsView } from "./audit-facts-view.js";
import { readAllHookStates } from "../server/hook-registrar.js";
import {
  labelEvidencePathBases,
  validateRegisteredCheckProvenance,
} from "./audit-provenance.js";
import { buildProjectStructure } from "./audit-structure.js";
import { agentSummary, setupSummary } from "./audit-summaries.js";
import { targetUsesNewerGoatFlow } from "./check-agent-common.js";
import {
  addStructuralAssuranceLimits,
  addUniqueConcernLimit,
  applyCheckToConcern,
  classifyCheckImpact,
  emptyConcern,
  skippedHarnessCheck,
  toCheckResult,
} from "./harness-scoring.js";
import type {
  AuditContext,
  AuditConcern,
  AuditConcernKey,
  AuditFactProfile,
  AuditHookCoverageReport,
  AuditReport,
  AuditScope,
  AuditScopeName,
  BuildCheck,
  CheckResult,
  ContentReport,
  HarnessCheck,
} from "./types.js";

/**
 * Summarize installed hook protection for the selected agent or all agents without running their hooks.
 *
 * @param projectPath - target project whose settings and installed hook files supply the coverage snapshot
 * @param selectedAgent - selected agent ID; null includes every agent represented by the hook registry
 * @returns - coverage summary and hook details; no required hooks leaves the coverage status passing
 */
function buildHookCoverageReport(
  projectPath: string,
  selectedAgent: AgentId | null,
): AuditHookCoverageReport {
  const hooks = readAllHookStates(projectPath);
  // A null selection means the user requested aggregate coverage across the agents represented by the registry.
  const selectedHookSurfaces = hooks.flatMap((hook) =>
    Object.entries(hook.agents)
      .filter(
        ([agentId]) => selectedAgent === null || agentId === selectedAgent,
      )
      .map(([, agentState]) => ({ hook, agentState })),
  );
  // Disabled or unsupported hooks remain visible but do not fail required protection for the selected agents.
  const requiredHookSurfaces = selectedHookSurfaces.filter(
    ({ hook, agentState }) => hook.enabled && agentState.supported,
  );
  const requiredIneffective = requiredHookSurfaces.filter(
    ({ agentState }) => agentState.effectiveState.status !== "effective",
  ).length;
  const hasRequiredDanger = requiredHookSurfaces.some(
    ({ agentState }) => agentState.effectiveState.severity === "danger",
  );
  const hasRequiredWarning = requiredHookSurfaces.some(
    ({ agentState }) => agentState.effectiveState.severity === "warning",
  );
  // With no explicit selection, report the registry's agent names; an empty hook registry yields an empty agent list.
  const selectedAgents = (
    selectedAgent === null
      ? Object.keys(hooks[0]?.agents ?? {})
      : [selectedAgent]
  ) as AgentId[];
  return {
    // The most severe required hook determines the headline; optional hook state remains in the detail counts.
    status: hasRequiredDanger
      ? "fail"
      : hasRequiredWarning
        ? "warning"
        : "pass",
    selectedAgents,
    summary: {
      selectedSurfaces: selectedHookSurfaces.length,
      requiredSurfaces: requiredHookSurfaces.length,
      requiredIneffective,
      effective: selectedHookSurfaces.filter(
        ({ agentState }) => agentState.effectiveState.severity === "success",
      ).length,
      warning: selectedHookSurfaces.filter(
        ({ agentState }) => agentState.effectiveState.severity === "warning",
      ).length,
      danger: selectedHookSurfaces.filter(
        ({ agentState }) => agentState.effectiveState.severity === "danger",
      ).length,
      disabled: selectedHookSurfaces.filter(
        ({ agentState }) => agentState.effectiveState.severity === "neutral",
      ).length,
    },
    hooks,
  };
}

export { createAuditFactsView } from "./audit-facts-view.js";

// Runtime switches that choose audit scope, fact depth, and optional diagnostics.
type AuditHarnessOption = Record<"harness", boolean>;

/**
 * Define the caller's contract for choosing checks and evidence in one project audit report.
 *
 * A null agent filter audits all agents; harness and content checks follow the caller's switches.
 * Drift can run automatically for multi-agent projects, while omitted deny evidence stays static and fact depth stays full.
 */
interface AuditOptions extends AuditHarnessOption {
  // Null selects the aggregate report; an agent ID narrows findings to that agent.
  agentFilter: AgentId | null;
  // Explicitly request drift; omission still permits automatic drift for a multi-agent project.
  checkDrift?: boolean;
  // Optional cold-path content lint. Defaults to false when omitted.
  checkContent?: boolean;
  // Deny-hook evidence depth. Omission is static; full explicitly executes target hook code.
  denyMechanismEvidenceLevel?: "full" | "static" | "present-only";
  // Optional fact profile. Dashboard summary omits stack facts by contract.
  factProfile?: AuditFactProfile;
  // Optional development/test profiler for audit-path timing.
  profile?: AuditProfiler;
  // Internal label used to separate aggregate, per-agent, and single audit spans.
  profileScope?: "aggregate" | "per-agent" | "single";
  // Internal batch option: project-level auto drift should run on aggregate only.
  shouldRunAutoDrift?: boolean;
}

/**
 * Measure audit work when a dashboard benchmark or development caller requests timing.
 *
 * Each named span wraps one synchronous step and returns its result unchanged.
 * Reports do not require a profiler; production callers can omit it without skipping any selected checks.
 */
interface AuditProfiler {
  // Time one labelled audit step; implementations return whatever the wrapped block returned.
  span<T>(name: string, block: () => T): T;
}

// Run the requested audit step with timing when a profiler is supplied; omission runs the same step directly.
function span<T>(
  profile: AuditProfiler | undefined,
  name: string,
  block: () => T,
): T {
  return profile ? profile.span(name, block) : block();
}

// Use full project facts by default; dashboard-summary callers explicitly omit stack detection for their faster report.
function factProfile(options: AuditOptions): AuditFactProfile {
  return options.factProfile ?? "full";
}

// Include stack detection for full audits and omit it for dashboard summaries whose checks must not depend on those facts.
function factsIncludeStack(options: AuditOptions): boolean {
  return factProfile(options) !== "dashboard-summary";
}

// Default to static deny evidence so an ordinary audit does not execute the target project's hook code.
function denyMechanismEvidenceLevel(
  options: AuditOptions,
): NonNullable<AuditOptions["denyMechanismEvidenceLevel"]> {
  return options.denyMechanismEvidenceLevel ?? "static";
}

/**
 * Reject a stack-dependent check before a dashboard-summary context can misreport it.
 *
 * @throws - Error when a check requires stack facts excluded from the current context.
 */
function assertCheckCanRunWithoutStack(
  ctx: AuditContext,
  check: Pick<BuildCheck | HarnessCheck, "id" | "name" | "requiresStack">,
): void {
  // A summary report cannot claim a result for a check whose required stack facts were deliberately omitted.
  if (ctx.factProfile === "dashboard-summary" && check.requiresStack === true) {
    throw new Error(
      `${check.id} (${check.name}) requires stack facts and cannot run in dashboard-summary audit profile`,
    );
  }
}

// Build an audit scope from its checks, excluding score-only failures.
function buildScope(
  checks: CheckResult[],
  summary: Record<string, string>,
): AuditScope {
  // Score-only findings stay visible in check rows but must not turn this scope's headline into a failure.
  const failures = checks.flatMap((checkResult) =>
    checkResult.failure && checkResult.impact === "scope-fail"
      ? [checkResult.failure]
      : [],
  );
  return {
    status: failures.length === 0 ? "pass" : "fail",
    checks,
    failures,
    summary,
  };
}

/**
 * Run harness checks and return the scope results plus per-concern scores.
 *
 * @param ctx - target facts, read-only filesystem, and configured acknowledgements for this harness report
 * @returns scope and five concerns; an empty applicable-check set receives score zero, not false assurance
 */
export function computeHarness(ctx: AuditContext): {
  scope: AuditScope;
  concerns: Record<AuditConcernKey, AuditConcern>;
} {
  const acknowledgeList = new Set(ctx.config.config.harness.acknowledge);
  const checks: CheckResult[] = [];
  const concerns: Record<AuditConcernKey, AuditConcern> = {
    context: emptyConcern(),
    constraints: emptyConcern(),
    verification: emptyConcern(),
    recovery: emptyConcern(),
    feedback_loop: emptyConcern(),
  };
  const counts: Record<AuditConcernKey, { total: number; passing: number }> = {
    context: { total: 0, passing: 0 },
    constraints: { total: 0, passing: 0 },
    verification: { total: 0, passing: 0 },
    recovery: { total: 0, passing: 0 },
    feedback_loop: { total: 0, passing: 0 },
  };

  // Run each deterministic check so the user receives one complete harness result.
  for (const check of HARNESS_CHECKS) {
    assertCheckCanRunWithoutStack(ctx, check);
    // Unsupported capabilities are shown as skipped instead of lowering the project score.
    if (check.skip?.(ctx)) {
      checks.push(skippedHarnessCheck(check));
      continue;
    }
    const result = check.run(ctx);
    // A configured acknowledgement applies only to a failed advisory; integrity and metric checks keep their normal treatment.
    const acknowledged =
      check.type === "advisory" &&
      result.status === "fail" &&
      acknowledgeList.has(check.id);
    checks.push(toCheckResult(check, result, acknowledged));
    applyCheckToConcern(concerns[check.concern], check, result, acknowledged);
    counts[check.concern].total++;
    // Passing checks contribute to the percentage the user sees for this concern.
    if (result.status === "pass") counts[check.concern].passing++;
  }

  // Calculate each concern independently so one weak area cannot hide behind another.
  for (const concernKey of Object.keys(concerns) as AuditConcernKey[]) {
    const { total, passing } = counts[concernKey];
    // No applicable checks means no measured assurance, so the displayed concern score stays zero.
    concerns[concernKey].score =
      total > 0 ? Math.round((passing / total) * 100) : 0;
  }

  addStructuralAssuranceLimits(concerns);

  return { scope: buildScope(checks, {}), concerns };
}

// Explain skipped agent checks so aggregate-report readers know when to rerun with --agent; null means no caveat is needed.
function describeAggregateAgentSkips(agentScope: AuditScope): string | null {
  const skippedAgentChecks = agentScope.checks
    .filter((check) => check.status === "skipped")
    .map((check) => check.id);
  // Every agent check ran, so there is no omitted-evidence caveat to add to the report.
  if (skippedAgentChecks.length === 0) return null;
  return `${skippedAgentChecks.length} agent-specific check(s) skipped in aggregate mode (${skippedAgentChecks.join(", ")}); rerun with --agent <id> for selected-agent runtime evidence.`;
}

/**
 * Describe how much of the enforcement matrix stayed unproven, so a passing constraint score is not read as full filesystem enforcement.
 *
 * @param matrix - per-agent enforcement capabilities collected for this audit
 * @returns - caveat text, or null when no capability is limited or unknown, including an empty matrix
 */
function enforcementLimitSummary(
  matrix: AgentEnforcementCapability[],
): string | null {
  let limitedCapabilityCount = 0;
  let unknownCapabilityCount = 0;
  // Count gaps across the selected agents so the headline does not imply more protection than the evidence supports.
  for (const agent of matrix) {
    // Each capability describes a distinct enforcement surface the user may rely on.
    for (const capability of agent.capabilities) {
      // Limited evidence proves only part of this capability and must remain explicit in the report.
      if (capability.status === "limited") limitedCapabilityCount++;
      // Unknown evidence leaves this capability unproven even when other constraints pass.
      if (capability.status === "unknown") unknownCapabilityCount++;
    }
  }
  // With neither kind of evidence gap, there is no limitation sentence to attach.
  if (limitedCapabilityCount === 0 && unknownCapabilityCount === 0) return null;
  // Omit zero-count categories so the caveat names only the evidence gaps that remain.
  const capabilityCounts = [
    unknownCapabilityCount > 0 ? `${unknownCapabilityCount} unknown` : "",
    limitedCapabilityCount > 0 ? `${limitedCapabilityCount} limited` : "",
  ].filter(Boolean);
  const totalLimitedEvidence = unknownCapabilityCount + limitedCapabilityCount;
  const capabilityLabel =
    totalLimitedEvidence === 1 ? "capability" : "capabilities";
  return `Constraint score covers verified deny patterns only, not broad filesystem enforcement; enforcement matrix still reports ${capabilityCounts.join(" and ")} ${capabilityLabel}.`;
}

// Add aggregate-only caveats without changing the audit status or concern scores users see.
function addNonGatingEvidenceLimits(
  agentScope: AuditScope,
  concerns: Record<AuditConcernKey, AuditConcern> | null,
  enforcement: AgentEnforcementCapability[],
): void {
  const agentSkipSummary = describeAggregateAgentSkips(agentScope);
  // Aggregate mode tells users when selected-agent runtime evidence was intentionally omitted.
  if (agentSkipSummary) {
    agentScope.summary.agentSpecificEvidence = agentSkipSummary;
  }
  // Build-only audits have no harness concerns to annotate.
  if (!concerns) return;
  const constraintsLimit = enforcementLimitSummary(enforcement);
  // Partial enforcement remains explicit without converting a supported agent into a failure.
  if (constraintsLimit) {
    addUniqueConcernLimit(concerns.constraints, constraintsLimit);
  }
}

// Recognize a check omitted from aggregate mode so the report does not mistake missing per-agent evidence for a pass.
function isAggregateAgentSkip(
  ctx: AuditContext,
  check: BuildCheck,
  failure: ReturnType<BuildCheck["run"]>,
): boolean {
  // A null failure is a skip only when this agent check cannot answer for the user's aggregate selection.
  return (
    failure === null &&
    check.scope === "agent" &&
    !ctx.agentFilter &&
    !check.supportsAggregate
  );
}

/**
 * Run one build check and shape its outcome into the row the renderers and dashboard display.
 * An agent-scoped check that cannot answer for every agent is skipped in aggregate mode rather than reported as a failure the user cannot act on.
 *
 * @param ctx - audit context supplying facts, config, and the selected agent filter
 * @param check - registered build check to execute
 * @returns the pass, fail, or skipped result carrying provenance and any failure detail
 */
function runSingleBuildCheck(
  ctx: AuditContext,
  check: BuildCheck,
): CheckResult {
  assertCheckCanRunWithoutStack(ctx, check);
  // A check without a skip rule runs normally; an explicit skip prevents it from inspecting an unsupported setup.
  const explicitlySkipped = check.skip?.(ctx) ?? false;
  const failure = explicitlySkipped ? null : check.run(ctx);
  // Checks may supply result-specific evidence; otherwise the report keeps their registered evidence record.
  const provenance = check.provenanceFor?.(ctx, failure) ?? check.provenance;
  const skipped =
    explicitlySkipped || isAggregateAgentSkip(ctx, check, failure);
  // A skipped check makes no pass claim; a completed check with no failure is the passing case.
  const status = skipped ? "skipped" : failure ? "fail" : "pass";
  const impact = classifyCheckImpact(status, undefined);
  return {
    id: check.id,
    name: check.name,
    status,
    ...impact,
    provenance: labelEvidencePathBases(provenance),
    // Passing and skipped rows omit failure details so renderers have no repair message to show.
    failure: failure ?? undefined,
    evidenceKind: check.evidenceKind,
  };
}

// Run setup and agent build checks into their separately rendered audit scopes.
function runBuildChecks(ctx: AuditContext): {
  setup: AuditScope;
  agent: AuditScope;
} {
  const scopeChecks: Record<AuditScopeName, CheckResult[]> = {
    setup: [],
    agent: [],
  };
  const BUILD_CHECKS = [...SETUP_CHECKS, ...AGENT_CHECKS];
  // Keep setup and agent findings in their own report sections while running the full selected registry.
  for (const check of BUILD_CHECKS) {
    scopeChecks[check.scope].push(runSingleBuildCheck(ctx, check));
  }
  return {
    setup: buildScope(scopeChecks.setup, setupSummary(ctx)),
    agent: buildScope(scopeChecks.agent, agentSummary(ctx)),
  };
}

// Load the selected project's facts and configuration so every check in this report uses the same installation snapshot.
function buildAuditContext(
  fs: ReadonlyFS,
  projectPath: string,
  options: AuditOptions,
): AuditContext {
  const configState = span(options.profile, "single config load", () =>
    loadConfig(projectPath, fs),
  );
  const facts = span(options.profile, "single facts", () =>
    extractProjectFacts(fs, {
      agentFilter: options.agentFilter,
      projectPath,
      configState,
      includeStack: factsIncludeStack(options),
      profile: options.profile,
    }),
  );
  const structure = span(options.profile, "single project structure", () =>
    buildProjectStructure(),
  );
  return {
    projectPath,
    facts,
    config: configState,
    fs,
    structure,
    agents: facts.agents,
    agentFilter: options.agentFilter,
    factProfile: factProfile(options),
    denyMechanismEvidenceLevel: denyMechanismEvidenceLevel(options),
  };
}

// Combine the selected sections into the audit headline; null optional sections were not run and do not fail the report.
function overallStatus(
  setup: AuditScope,
  agent: AuditScope,
  harness: ReturnType<typeof computeHarness> | null,
  drift: { status: "pass" | "fail" } | null,
  content: ContentReport | null,
): "pass" | "fail" {
  const buildPassed = setup.status === "pass" && agent.status === "pass";
  // Unrequested sections have no result to fail; each selected section must pass for the overall audit to pass.
  const harnessPassed = !harness || harness.scope.status === "pass";
  const driftPassed = !drift || drift.status === "pass";
  const contentPassed = !content || content.status === "pass";
  return buildPassed && harnessPassed && driftPassed && contentPassed
    ? "pass"
    : "fail";
}

/**
 * Run the audit against a project and return the full report.
 *
 * @param fs - filesystem adapter scoped to the target project
 * @param projectPath - absolute or relative target project root passed to fact extraction and checks
 * @param options - audit switches controlling agent filtering, harness, drift, content, and fact profile
 * @returns - report with setup and agent sections; harness, drift, and content are null when their checks do not run
 */
export function runAudit(
  fs: ReadonlyFS,
  projectPath: string,
  options: AuditOptions,
): AuditReport {
  const ctx = buildAuditContext(fs, projectPath, options);
  return runAuditFromContext(ctx, fs, projectPath, options);
}

// Assemble the user's report from a prepared context, preserving selected checks and evidence limits across single and batch audits.
function runAuditFromContext(
  ctx: AuditContext,
  fs: ReadonlyFS,
  projectPath: string,
  options: AuditOptions,
): AuditReport {
  // Calls outside a batch use the single-run timing label; this does not change which checks the user receives.
  const profileScope = options.profileScope ?? "single";
  validateProvenanceWithProfile(ctx, options, profileScope);
  const { setup: setupScope, agent: agentScope } = span(
    options.profile,
    `${profileScope} build checks`,
    () => runBuildChecks(ctx),
  );
  const harness = computeHarnessWithProfile(ctx, options, profileScope);
  const drift = computeDriftWithProfile(
    ctx,
    fs,
    projectPath,
    options,
    profileScope,
  );
  const content = computeContentWithProfile(ctx, options, profileScope);
  const status = overallStatus(setupScope, agentScope, harness, drift, content);
  const enforcement = buildEnforcementMatrix(ctx.agents, {
    agentScope: agentScope,
    denyMechanismEvidenceLevel: denyMechanismEvidenceLevel(options),
  });
  // A build-only report has no harness concerns, but its agent scope still needs any omitted-evidence caveat.
  addNonGatingEvidenceLimits(
    agentScope,
    harness?.concerns ?? null,
    enforcement,
  );
  const hookCoverage = buildHookCoverageReport(
    projectPath,
    options.agentFilter,
  );

  return {
    command: "audit",
    harness: options.harness,
    status,
    target: projectPath,
    scopes: {
      setup: setupScope,
      agent: agentScope,
      // A null harness section means the caller did not request harness checks.
      harness: harness?.scope ?? null,
    },
    // Concern scores exist only when harness checks ran; null must not be rendered as a zero score.
    concerns: harness?.concerns ?? null,
    enforcement,
    hookCoverage,
    drift,
    content,
    overall: { status },
  };
}

/**
 * Validate registered check provenance inside a labelled profiler span.
 *
 * @param ctx - audit context supplying the target filesystem
 * @param options - audit switches carrying the optional profiler
 * @param profileScope - profiler label distinguishing aggregate, per-agent, and single runs
 */
function validateProvenanceWithProfile(
  ctx: AuditContext,
  options: AuditOptions,
  profileScope: string,
): void {
  span(options.profile, `${profileScope} provenance validation`, () => {
    validateRegisteredCheckProvenance(ctx.fs);
  });
}

/**
 * Score the harness concerns inside a labelled profiler span, but only when the user asked for them.
 *
 * @param ctx - audit context supplying facts and config
 * @param options - audit switches; without `--harness` this stays null
 * @param profileScope - profiler label distinguishing aggregate, per-agent, and single runs
 * @returns the harness result, or null when the user did not request harness scoring
 */
function computeHarnessWithProfile(
  ctx: AuditContext,
  options: AuditOptions,
  profileScope: string,
): ReturnType<typeof computeHarness> | null {
  // The user did not ask for harness scores, so the report simply has no harness section.
  if (!options.harness) return null;
  return span(options.profile, `${profileScope} harness checks`, () =>
    computeHarness(ctx),
  );
}

/**
 * Decide whether this run compares installed files against the shipped templates.
 *
 * @param ctx - audit context supplying the target version skew
 * @param options - drift switches; explicit requests still respect the newer-target version guard
 * @returns true to run drift, false when the target is newer than this CLI or auto-drift does not apply
 */
function shouldRunDriftCheck(
  ctx: AuditContext,
  options: AuditOptions,
): boolean {
  // A stale CLI cannot compare newer templates reliably; the config-version check already reports the actionable mismatch.
  if (targetUsesNewerGoatFlow(ctx)) return false;
  // The user's explicit request enables comparison after the CLI version guard has accepted this target.
  if (options.checkDrift === true) return true;
  // Batch callers can reserve automatic drift for the aggregate report; other runs use the multi-agent policy.
  return options.shouldRunAutoDrift !== false && shouldAutoRunDrift(ctx);
}

/**
 * Run drift for the selected audit scope while preserving profiler attribution.
 * Use after structural checks so users see stale content for only the agent they requested.
 *
 * @param ctx - target audit context; a null agent filter means inspect every installed runtime
 * @param fs - read-only selected-target filesystem; empty projects yield setup findings elsewhere
 * @param projectPath - target root passed to drift comparisons and used to resolve installed files
 * @param options - audit switches; omitted drift keeps this result null unless auto-drift applies
 * @param profileScope - profiler label for aggregate, per-agent, or single-user audit work
 * @returns - drift report for the chosen scope, or null when the version guard or drift policy skips comparison
 */
function computeDriftWithProfile(
  ctx: AuditContext,
  fs: ReadonlyFS,
  projectPath: string,
  options: AuditOptions,
  profileScope: string,
): ReturnType<typeof checkDrift> | null {
  // Without an explicit or automatic drift request, the user receives no stale-copy section.
  if (!shouldRunDriftCheck(ctx, options)) return null;
  return span(options.profile, `${profileScope} drift`, () =>
    checkDrift({ fs, projectPath, agentFilter: ctx.agentFilter }),
  );
}

/**
 * Run the cold-path content checks inside a labelled profiler span, but only when the user asked for them.
 *
 * @param ctx - audit context supplying facts and the target version skew
 * @param options - audit switches; without `--check-content` this stays null
 * @param profileScope - profiler label distinguishing aggregate, per-agent, and single runs
 * @returns the content report, or null when content checks were skipped
 */
function computeContentWithProfile(
  ctx: AuditContext,
  options: AuditOptions,
  profileScope: string,
): ContentReport | null {
  // The user did not ask for content checks, so the report has no content section.
  if (!options.checkContent) return null;
  // A newer target may use content rules this CLI does not know; skip the scan and let the version check report the mismatch.
  if (targetUsesNewerGoatFlow(ctx)) return null;
  return span(options.profile, `${profileScope} content checks`, () =>
    computeContent(ctx),
  );
}

/**
 * Build aggregate and per-agent reports from one configuration and fact extraction pass.
 *
 * It swallows per-agent audit failures so one failing agent does not discard the completed aggregate report.
 * Each agent gets isolated facts; callers receive only the per-agent reports that completed.
 *
 * @param fs - filesystem adapter scoped to the target project
 * @param projectPath - target root reused by aggregate and per-agent reports
 * @param options - shared audit switches; an agent filter also narrows the requested per-agent list
 * @param agentIds - supported agents to audit individually; an empty list requests only the aggregate report
 * @returns - aggregate report and successful per-agent reports; failed agent runs are omitted from the list
 */
export function runAuditBatch(
  fs: ReadonlyFS,
  projectPath: string,
  options: AuditOptions,
  agentIds: AgentId[],
): {
  aggregate: AuditReport;
  perAgent: { id: string; audit: AuditReport }[];
} {
  const currentFactProfile = factProfile(options);
  const configState = span(options.profile, "config load", () =>
    loadConfig(projectPath, fs),
  );
  const structure = span(options.profile, "project structure", () =>
    buildProjectStructure(),
  );
  span(options.profile, "provenance validation", () => {
    validateRegisteredCheckProvenance(fs);
  });

  // A selected --agent limits both fact extraction and the individual reports included in this batch.
  const effectiveAgentIds = options.agentFilter
    ? agentIds.filter((id) => id === options.agentFilter)
    : agentIds;
  const batchFacts = span(options.profile, "aggregate facts", () =>
    extractProjectFacts(fs, {
      agentFilter: options.agentFilter,
      projectPath,
      configState,
      managedAgentIds: effectiveAgentIds,
      includeStack: currentFactProfile !== "dashboard-summary",
      profile: options.profile,
    }),
  );
  const aggregateFacts = createAuditFactsView(batchFacts, {
    factProfile: currentFactProfile,
  });
  const perAgentFacts = new Map<AgentId, ProjectFacts>();
  // Prepare separate fact objects before running checks so one agent's report cannot alter another's evidence.
  for (const agentId of effectiveAgentIds) {
    perAgentFacts.set(
      agentId,
      createAuditFactsView(batchFacts, {
        agentId,
        factProfile: currentFactProfile,
      }),
    );
  }
  const aggregateCtx: AuditContext = {
    projectPath,
    facts: aggregateFacts,
    config: configState,
    fs,
    structure,
    agents: aggregateFacts.agents,
    agentFilter: options.agentFilter,
    factProfile: currentFactProfile,
    denyMechanismEvidenceLevel: denyMechanismEvidenceLevel(options),
  };
  const aggregate = runAuditFromContext(aggregateCtx, fs, projectPath, {
    ...options,
    profileScope: "aggregate",
  });

  const perAgent: { id: string; audit: AuditReport }[] = [];
  // Complete each selected agent independently while retaining the aggregate report already built above.
  for (const agentId of effectiveAgentIds) {
    try {
      const agentFacts = perAgentFacts.get(agentId);
      // Without a prepared fact view, this agent has no evidence snapshot from which to build a report.
      if (!agentFacts) continue;
      const agentCtx: AuditContext = {
        projectPath,
        facts: agentFacts,
        config: configState,
        fs,
        structure,
        agents: agentFacts.agents,
        agentFilter: agentId,
        factProfile: currentFactProfile,
        denyMechanismEvidenceLevel: denyMechanismEvidenceLevel(options),
      };
      perAgent.push({
        id: agentId,
        audit: runAuditFromContext(agentCtx, fs, projectPath, {
          ...options,
          agentFilter: agentId,
          profileScope: "per-agent",
          shouldRunAutoDrift: false,
        }),
      });
    } catch {
      // Skip agents that fail to audit so the user can still read the completed aggregate and other agents' results.
    }
  }

  return { aggregate, perAgent };
}
