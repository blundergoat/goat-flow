/**
 * Audit orchestrator for `goat-flow audit`.
 * Loads config, extracts facts, runs build checks (pass/fail) and optional
 * harness completeness checks (--harness, deterministic pass/fail per concern).
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
import {
  labelEvidencePathBases,
  validateRegisteredCheckProvenance,
} from "./audit-provenance.js";
import { buildProjectStructure } from "./audit-structure.js";
import { agentSummary, setupSummary } from "./audit-summaries.js";
import type {
  AuditContext,
  AuditConcern,
  AuditConcernKey,
  AuditFactProfile,
  AuditFailure,
  AuditReport,
  AuditScope,
  AuditScopeName,
  BuildCheck,
  CheckResult,
  ContentReport,
  HarnessCheck,
  HarnessCheckResult,
} from "./types.js";

export { createAuditFactsView } from "./audit-facts-view.js";

/** Runtime switches that choose audit scope, fact depth, and optional diagnostics. */
type AuditHarnessOption = Record<"harness", boolean>;

/**
 * Caller-supplied switches for a single `runAudit` invocation. Every field beyond `agentFilter` and
 * the inherited `harness` flag is optional and off by default, so the common audit path stays the
 * deterministic build checks; the optional fields turn on the more expensive diagnostics (drift,
 * content lint, full deny-hook runtime validation) or trade fact depth for dashboard speed.
 */
interface AuditOptions extends AuditHarnessOption {
  agentFilter: AgentId | null;
  /** Optional drift check. Defaults to false when omitted. */
  checkDrift?: boolean;
  /** Optional cold-path content lint. Defaults to false when omitted. */
  checkContent?: boolean;
  /** Optional summary-mode downgrade for expensive deny-hook runtime validation. */
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

/** Return the dashboard display status and audit impact for one check result. */
function classifyCheckImpact(
  status: CheckResult["status"],
  type: CheckResult["type"],
  acknowledged = false,
): Pick<CheckResult, "displayStatus" | "impact"> {
  if (status === "skipped") return { displayStatus: "skipped", impact: "none" };
  if (status === "pass") {
    return {
      displayStatus: type === "metric" ? "info" : "pass",
      impact: "none",
    };
  }
  if (type === "metric" || acknowledged) {
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
  return {
    ...failure,
    evidence: acknowledged
      ? `Advisory (acknowledged via harness.acknowledge: [${check.id}]). Best practice, not install drift.`
      : `Advisory (best practice, not install drift). Silence with harness.acknowledge: [${check.id}] in .goat-flow/config.yaml, or fix to reach pass.`,
  };
}

/** Convert a harness check + its result into a CheckResult for the scope. */
function toCheckResult(
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
  const impact = classifyCheckImpact(result.status, check.type, acknowledged);

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

/** Create an empty AuditConcern with zeroed counters. */
function emptyConcern(): AuditConcern {
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

function addRemediation(
  concern: AuditConcern,
  result: HarnessCheckResult,
): void {
  concern.recommendations.push(...result.recommendations);
  if (result.howToFix) concern.howToFix.push(...result.howToFix);
}

function applyMetricCheck(
  concern: AuditConcern,
  result: HarnessCheckResult,
): void {
  concern.metrics++;
  if (result.status !== "fail") return;
  concern.limits.push(
    `Score-only metric failed: ${result.findings.join("; ")}`,
  );
  addRemediation(concern, result);
}

function applyIntegrityCheck(
  concern: AuditConcern,
  result: HarnessCheckResult,
): void {
  if (result.status === "pass") concern.integrityPass++;
  else concern.integrityFail++;
}

function applyAdvisoryCheck(
  concern: AuditConcern,
  result: HarnessCheckResult,
  acknowledged: boolean,
): void {
  if (result.status === "pass") concern.advisoryPass++;
  else if (acknowledged) concern.advisoryAcknowledged++;
  else concern.advisoryFail++;
}

/** Apply a single check result to its concern per the typed scoring model. */
function applyCheckToConcern(
  concern: AuditConcern,
  check: HarnessCheck,
  result: HarnessCheckResult,
  acknowledged: boolean,
): void {
  concern.findings.push(...result.findings);
  if (result.limits) concern.limits.push(...result.limits);
  if (check.type === "metric") {
    applyMetricCheck(concern, result);
    return;
  }
  if (check.type === "integrity") {
    applyIntegrityCheck(concern, result);
  } else {
    applyAdvisoryCheck(concern, result, acknowledged);
  }
  if (result.status === "fail" && !acknowledged) {
    concern.status = "fail";
    addRemediation(concern, result);
  }
}

/** Render a harness check that is intentionally not applicable to this context. */
function skippedHarnessCheck(check: HarnessCheck): CheckResult {
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

/**
 * Run harness checks and return the scope results plus per-concern scores.
 *
 * @param ctx - audit context containing facts, config, checks, and target filesystem access
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

  for (const check of HARNESS_CHECKS) {
    assertCheckCanRunWithoutStack(ctx, check);
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
    if (result.status === "pass") counts[check.concern].passing++;
  }

  for (const key of Object.keys(concerns) as AuditConcernKey[]) {
    const { total, passing } = counts[key];
    concerns[key].score = total > 0 ? Math.round((passing / total) * 100) : 0;
  }

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

function addNonGatingEvidenceLimits(
  agentScope: AuditScope,
  concerns: Record<AuditConcernKey, AuditConcern> | null,
  enforcement: AgentEnforcementCapability[],
): void {
  const agentSkipSummary = describeAggregateAgentSkips(agentScope);
  if (agentSkipSummary) {
    agentScope.summary.agentSpecificEvidence = agentSkipSummary;
  }
  if (!concerns) return;
  const constraintsLimit = enforcementLimitSummary(enforcement);
  if (constraintsLimit) concerns.constraints.limits.push(constraintsLimit);
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
    denyMechanismEvidenceLevel: options.denyMechanismEvidenceLevel,
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
    denyMechanismEvidenceLevel: options.denyMechanismEvidenceLevel,
  });
  addNonGatingEvidenceLimits(
    agentScope,
    harness?.concerns ?? null,
    enforcement,
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
  if (options.checkDrift === true) return true;
  return options.shouldRunAutoDrift !== false && shouldAutoRunDrift(ctx);
}

function computeDriftWithProfile(
  ctx: AuditContext,
  fs: ReadonlyFS,
  projectPath: string,
  options: AuditOptions,
  profileScope: string,
): ReturnType<typeof checkDrift> | null {
  if (!shouldRunDriftCheck(ctx, options)) return null;
  return span(options.profile, `${profileScope} drift`, () =>
    checkDrift({ fs, projectPath }),
  );
}

function computeContentWithProfile(
  ctx: AuditContext,
  options: AuditOptions,
  profileScope: string,
): ContentReport | null {
  if (!options.checkContent) return null;
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
    denyMechanismEvidenceLevel: options.denyMechanismEvidenceLevel,
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
        denyMechanismEvidenceLevel: options.denyMechanismEvidenceLevel,
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
