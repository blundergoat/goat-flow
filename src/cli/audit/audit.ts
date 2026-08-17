/**
 * Audit orchestrator for `goat-flow audit`.
 *
 * Loads config, extracts facts, runs build checks (pass/fail) and optional harness completeness checks (--harness, deterministic pass/fail per
 * concern).
 * Returns an AuditReport consumed by renderers and the dashboard.
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

/** Build one offline hook-coverage section without running target hooks or provider agents. */
function buildHookCoverageReport(
  projectPath: string,
  selectedAgent: AgentId | null,
): AuditHookCoverageReport {
  const hooks = readAllHookStates(projectPath);
  const selectedHookSurfaces = hooks.flatMap((hook) =>
    Object.entries(hook.agents)
      .filter(
        ([agentId]) => selectedAgent === null || agentId === selectedAgent,
      )
      .map(([, agentState]) => ({ hook, agentState })),
  );
  const requiredHookSurfaces = selectedHookSurfaces.filter(
    ({ hook, agentState }) => hook.enabled && agentState.supported,
  );
  const requiredIneffective = requiredHookSurfaces.filter(
    ({ agentState }) => agentState.effectiveState.status !== "effective",
  ).length;
  const selectedAgents = (
    selectedAgent === null
      ? Object.keys(hooks[0]?.agents ?? {})
      : [selectedAgent]
  ) as AgentId[];
  return {
    status: requiredIneffective === 0 ? "pass" : "fail",
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

/** Runtime switches that choose audit scope, fact depth, and optional diagnostics. */
type AuditHarnessOption = Record<"harness", boolean>;

/**
 * Caller-supplied switches for a single `runAudit` invocation.
 *
 * Every field beyond `agentFilter` and the inherited `harness` flag is optional and off by default, so the common audit path stays the deterministic
 * build checks; the optional fields turn on the more expensive diagnostics (drift, content lint, explicit full deny-hook runtime validation) or trade
 * fact depth for dashboard speed.
 */
interface AuditOptions extends AuditHarnessOption {
  agentFilter: AgentId | null;
  /** Optional drift check. Defaults to false when omitted. */
  checkDrift?: boolean;
  /** Optional cold-path content lint. Defaults to false when omitted. */
  checkContent?: boolean;
  /** Deny-hook evidence depth. Omission is static; full explicitly executes target hook code. */
  denyMechanismEvidenceLevel?: "full" | "static" | "present-only";
  /** Optional fact profile. Dashboard summary omits stack facts by contract. */
  factProfile?: AuditFactProfile;
  /** Optional development/test profiler for audit-path timing. */
  profile?: AuditProfiler;
  /** Internal label used to separate aggregate, per-agent, and single audit spans. */
  profileScope?: "aggregate" | "per-agent" | "single";
  /** Internal batch option: project-level auto drift should run on aggregate only. */
  shouldRunAutoDrift?: boolean;
}

/** Synchronous profiler seam used by dashboard development benchmarks. */
interface AuditProfiler {
  span<T>(name: string, fn: () => T): T;
}

/** Run a block inside an optional profiler span. */
function span<T>(
  profile: AuditProfiler | undefined,
  name: string,
  fn: () => T,
): T {
  return profile ? profile.span(name, fn) : fn();
}

/** Resolve the fact profile once so dashboard-summary callers get consistent fact slicing. */
function factProfile(options: AuditOptions): AuditFactProfile {
  return options.factProfile ?? "full";
}

/** Decide whether stack detection should run for the requested fact profile. */
function factsIncludeStack(options: AuditOptions): boolean {
  return factProfile(options) !== "dashboard-summary";
}

/** Resolve omission to the non-executing evidence level at the public audit boundary. */
function denyMechanismEvidenceLevel(
  options: AuditOptions,
): NonNullable<AuditOptions["denyMechanismEvidenceLevel"]> {
  return options.denyMechanismEvidenceLevel ?? "static";
}

/**
 * Reject a stack-dependent check before a dashboard-summary context can misreport it.
 * @throws Error when a check requires stack facts excluded from the current context.
 */
function assertCheckCanRunWithoutStack(
  ctx: AuditContext,
  check: Pick<BuildCheck | HarnessCheck, "id" | "name" | "requiresStack">,
): void {
  if (ctx.factProfile === "dashboard-summary" && check.requiresStack === true) {
    throw new Error(
      `${check.id} (${check.name}) requires stack facts and cannot run in dashboard-summary audit profile`,
    );
  }
}

/** Build an audit scope from its checks, excluding score-only failures. */
function buildScope(
  checks: CheckResult[],
  summary: Record<string, string>,
): AuditScope {
  const failures = checks.flatMap((c) =>
    c.failure && c.impact === "scope-fail" ? [c.failure] : [],
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
 * @param ctx - required target facts and read-only filesystem; absent context means the audit cannot run
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
  for (const key of Object.keys(concerns) as AuditConcernKey[]) {
    const { total, passing } = counts[key];
    concerns[key].score = total > 0 ? Math.round((passing / total) * 100) : 0;
  }

  addStructuralAssuranceLimits(concerns);

  return { scope: buildScope(checks, {}), concerns };
}

/** Summarize agent-specific checks skipped by aggregate audit mode for non-gating evidence limits. */
function describeAggregateAgentSkips(agentScope: AuditScope): string | null {
  const skippedAgentChecks = agentScope.checks
    .filter((check) => check.status === "skipped")
    .map((check) => check.id);
  if (skippedAgentChecks.length === 0) return null;
  return `${skippedAgentChecks.length} agent-specific check(s) skipped in aggregate mode (${skippedAgentChecks.join(", ")}); rerun with --agent <id> for selected-agent runtime evidence.`;
}

function enforcementLimitSummary(
  matrix: AgentEnforcementCapability[],
): string | null {
  let limited = 0;
  let unknown = 0;
  for (const agent of matrix) {
    for (const capability of agent.capabilities) {
      if (capability.status === "limited") limited++;
      if (capability.status === "unknown") unknown++;
    }
  }
  if (limited === 0 && unknown === 0) return null;
  const parts = [
    unknown > 0 ? `${unknown} unknown` : "",
    limited > 0 ? `${limited} limited` : "",
  ].filter(Boolean);
  const totalLimitedEvidence = unknown + limited;
  const capabilityLabel =
    totalLimitedEvidence === 1 ? "capability" : "capabilities";
  return `Constraint score covers verified deny patterns only, not broad filesystem enforcement; enforcement matrix still reports ${parts.join(" and ")} ${capabilityLabel}.`;
}

/** Add aggregate-only caveats without changing the audit status or concern scores users see. */
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

/** Run build checks and return per-scope results. */
function isAggregateAgentSkip(
  ctx: AuditContext,
  check: BuildCheck,
  failure: ReturnType<BuildCheck["run"]>,
): boolean {
  return (
    failure === null &&
    check.scope === "agent" &&
    !ctx.agentFilter &&
    !check.supportsAggregate
  );
}

function runSingleBuildCheck(
  ctx: AuditContext,
  check: BuildCheck,
): CheckResult {
  assertCheckCanRunWithoutStack(ctx, check);
  const explicitlySkipped = check.skip?.(ctx) ?? false;
  const failure = explicitlySkipped ? null : check.run(ctx);
  const provenance = check.provenanceFor?.(ctx, failure) ?? check.provenance;
  const skipped =
    explicitlySkipped || isAggregateAgentSkip(ctx, check, failure);
  const status = skipped ? "skipped" : failure ? "fail" : "pass";
  const impact = classifyCheckImpact(status, undefined);
  return {
    id: check.id,
    name: check.name,
    status,
    ...impact,
    provenance: labelEvidencePathBases(provenance),
    failure: failure ?? undefined,
    evidenceKind: check.evidenceKind,
  };
}

/** Run setup and agent build checks into their separately rendered audit scopes. */
function runBuildChecks(ctx: AuditContext): {
  setup: AuditScope;
  agent: AuditScope;
} {
  const scopeChecks: Record<AuditScopeName, CheckResult[]> = {
    setup: [],
    agent: [],
  };
  const BUILD_CHECKS = [...SETUP_CHECKS, ...AGENT_CHECKS];
  for (const check of BUILD_CHECKS) {
    scopeChecks[check.scope].push(runSingleBuildCheck(ctx, check));
  }
  return {
    setup: buildScope(scopeChecks.setup, setupSummary(ctx)),
    agent: buildScope(scopeChecks.agent, agentSummary(ctx)),
  };
}

/** Build the AuditContext from config, facts, and manifest structure. */
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

/** Combine build + optional harness + optional drift + optional content statuses into an overall pass/fail. */
function overallStatus(
  setup: AuditScope,
  agent: AuditScope,
  harness: ReturnType<typeof computeHarness> | null,
  drift: { status: "pass" | "fail" } | null,
  content: ContentReport | null,
): "pass" | "fail" {
  const buildPassed = setup.status === "pass" && agent.status === "pass";
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
 * @returns full audit report with setup, agent, optional harness, drift, and content sections
 */
export function runAudit(
  fs: ReadonlyFS,
  projectPath: string,
  options: AuditOptions,
): AuditReport {
  const ctx = buildAuditContext(fs, projectPath, options);
  return runAuditFromContext(ctx, fs, projectPath, options);
}

/** Run every selected audit layer against one already-extracted, evidence-level-normalized context. */
function runAuditFromContext(
  ctx: AuditContext,
  fs: ReadonlyFS,
  projectPath: string,
  options: AuditOptions,
): AuditReport {
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
      harness: harness?.scope ?? null,
    },
    concerns: harness?.concerns ?? null,
    enforcement,
    hookCoverage,
    drift,
    content,
    overall: { status },
  };
}

function validateProvenanceWithProfile(
  ctx: AuditContext,
  options: AuditOptions,
  profileScope: string,
): void {
  span(options.profile, `${profileScope} provenance validation`, () => {
    validateRegisteredCheckProvenance(ctx.fs);
  });
}

function computeHarnessWithProfile(
  ctx: AuditContext,
  options: AuditOptions,
  profileScope: string,
): ReturnType<typeof computeHarness> | null {
  if (!options.harness) return null;
  return span(options.profile, `${profileScope} harness checks`, () =>
    computeHarness(ctx),
  );
}

function shouldRunDriftCheck(
  ctx: AuditContext,
  options: AuditOptions,
): boolean {
  // A stale CLI cannot produce a trustworthy template comparison; the
  // config-version check already reports the skew as the actionable failure.
  if (targetUsesNewerGoatFlow(ctx)) return false;
  if (options.checkDrift === true) return true;
  return options.shouldRunAutoDrift !== false && shouldAutoRunDrift(ctx);
}

/**
 * Run drift for the selected audit scope while preserving profiler attribution.
 * Use after structural checks so users see stale content for only the agent they requested.
 *
 * @param ctx - target audit context; a null agent filter means inspect every installed runtime
 * @param fs - read-only selected-target filesystem; empty projects yield setup findings elsewhere
 * @param projectPath - selected target shown in audit output; empty paths are rejected before this layer
 * @param options - audit switches; omitted drift keeps this result null unless auto-drift applies
 * @param profileScope - profiler label for aggregate, per-agent, or single-user audit work
 * @returns drift report for the chosen scope, or null when the user did not request drift
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

function computeContentWithProfile(
  ctx: AuditContext,
  options: AuditOptions,
  profileScope: string,
): ContentReport | null {
  if (!options.checkContent) return null;
  // Same stale-CLI reasoning as drift: newer cold-path content would be linted
  // against rules this release does not carry yet.
  if (targetUsesNewerGoatFlow(ctx)) return null;
  return span(options.profile, `${profileScope} content checks`, () =>
    computeContent(ctx),
  );
}

/**
 * Run aggregate + per-agent audits sharing a single config/structure/provenance pass.
 * Eliminates the N+1 pattern where each per-agent audit re-parses config and facts.
 *
 * @param fs - filesystem adapter scoped to the target project
 * @param projectPath - target project root reused by aggregate and per-agent runs
 * @param options - aggregate audit switches reused by the per-agent runs
 * @param agentIds - supported agent ids to audit individually after the aggregate run
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
  for (const agentId of effectiveAgentIds) {
    try {
      const agentFacts = perAgentFacts.get(agentId);
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
      /* skip agents that fail to audit */
    }
  }

  return { aggregate, perAgent };
}
