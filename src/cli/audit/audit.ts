/**
 * Audit orchestrator for `goat-flow audit`.
 * Loads config, extracts facts, runs build checks (pass/fail) and optional
 * harness completeness checks (--harness, deterministic pass/fail per concern).
 * Returns an AuditReport consumed by renderers and the dashboard.
 */
import type { AgentId, ReadonlyFS } from "../types.js";
import { loadConfig } from "../config/index.js";
import { extractProjectFacts } from "../facts/orchestrator.js";
import { getProjectStructure } from "../paths.js";
import { SETUP_CHECKS } from "./check-goat-flow.js";
import { AGENT_CHECKS } from "./check-agent-setup.js";
import { HARNESS_CHECKS } from "./harness/index.js";
import type {
  AuditContext,
  AuditConcern,
  AuditConcernKey,
  AuditReport,
  AuditScope,
  AuditScopeName,
  CheckResult,
  ProjectStructure,
} from "./types.js";

interface AuditOptions {
  agentFilter: AgentId | null;
  harness: boolean;
}

/** Parse the raw manifest.json into the typed subset audit needs. */
function parseProjectStructure(raw: Record<string, unknown>): ProjectStructure {
  return {
    required_files: (raw.required_files as string[] | undefined) ?? [],
    required_dirs: (raw.required_dirs as string[] | undefined) ?? [],
    skills: {
      canonical:
        ((raw.skills as Record<string, unknown> | undefined)
          ?.canonical as string[]) ?? [],
      stale_names:
        ((raw.skills as Record<string, unknown> | undefined)
          ?.stale_names as string[]) ?? [],
    },
    agents: (raw.agents as ProjectStructure["agents"] | undefined) ?? {},
  };
}

/** Build a scope result from check results */
function buildScope(
  checks: CheckResult[],
  summary: Record<string, string>,
): AuditScope {
  const failures = checks.filter((c) => c.failure).map((c) => c.failure!);
  return {
    status: failures.length === 0 ? "pass" : "fail",
    checks,
    failures,
    summary,
  };
}

/** Build summary details for the setup scope (worst-case across all agents). */
function setupSummary(ctx: AuditContext): Record<string, string> {
  const totalSkills = ctx.structure.skills.canonical.length;
  let minSkills = totalSkills;
  let maxLines = 0;
  for (const af of ctx.agents) {
    minSkills = Math.min(minSkills, af.skills.found.length);
    maxLines = Math.max(maxLines, af.instruction.lineCount);
  }
  const configValid = ctx.config.exists && ctx.config.valid;
  const configVersion = ctx.config.config.version;

  return {
    skills: `${minSkills}/${totalSkills} installed`,
    config: configValid
      ? `valid, version ${configVersion}`
      : "invalid or missing",
    instructionFile: `${maxLines} lines (max across agents)`,
  };
}

/** Build summary details for the agent scope */
function agentSummary(ctx: AuditContext): Record<string, string> {
  const tc = ctx.config.config.toolchain;
  const parts: string[] = [];
  if (tc.test.length > 0) parts.push("test");
  if (tc.lint.length > 0) parts.push("lint");
  if (tc.build.length > 0) parts.push("build");

  const hookInfo: string[] = [];
  for (const af of ctx.agents) {
    if (af.hooks.denyExists || af.hooks.denyIsConfigBased) {
      hookInfo.push(`${af.agent.id}:deny installed`);
    }
  }

  return {
    toolchain:
      parts.length > 0
        ? parts.join(" + ") + " configured"
        : "not configured (optional)",
    hooks: hookInfo.length > 0 ? hookInfo.join(", ") : "none installed",
  };
}

/** Run harness completeness checks and return scope + concerns. */
function computeHarness(ctx: AuditContext): {
  scope: AuditScope;
  concerns: Record<AuditConcernKey, AuditConcern>;
} {
  const checks: CheckResult[] = [];
  const concerns: Record<AuditConcernKey, AuditConcern> = {
    context: {
      status: "pass",
      score: 0,
      findings: [],
      recommendations: [],
      howToFix: [],
    },
    constraints: {
      status: "pass",
      score: 0,
      findings: [],
      recommendations: [],
      howToFix: [],
    },
    verification: {
      status: "pass",
      score: 0,
      findings: [],
      recommendations: [],
      howToFix: [],
    },
    recovery: {
      status: "pass",
      score: 0,
      findings: [],
      recommendations: [],
      howToFix: [],
    },
    feedback_loop: {
      status: "pass",
      score: 0,
      findings: [],
      recommendations: [],
      howToFix: [],
    },
  };

  const counts: Record<AuditConcernKey, { total: number; passing: number }> = {
    context: { total: 0, passing: 0 },
    constraints: { total: 0, passing: 0 },
    verification: { total: 0, passing: 0 },
    recovery: { total: 0, passing: 0 },
    feedback_loop: { total: 0, passing: 0 },
  };

  for (const check of HARNESS_CHECKS) {
    const result = check.run(ctx);
    checks.push({
      id: check.id,
      name: check.name,
      status: result.status,
      failure:
        result.status === "fail"
          ? {
              check: check.name,
              message:
                result.recommendations[0] ??
                result.findings[0] ??
                "Check failed",
              howToFix: result.howToFix?.[0],
            }
          : undefined,
    });
    const concern = concerns[check.concern];
    concern.findings.push(...result.findings);
    concern.recommendations.push(...result.recommendations);
    if (result.howToFix) concern.howToFix.push(...result.howToFix);
    if (result.status === "fail") concern.status = "fail";
    counts[check.concern].total++;
    if (result.status === "pass") counts[check.concern].passing++;
  }

  for (const key of Object.keys(concerns) as AuditConcernKey[]) {
    const { total, passing } = counts[key];
    concerns[key].score = total > 0 ? Math.round((passing / total) * 100) : 0;
  }

  return { scope: buildScope(checks, {}), concerns };
}

/** Run build checks and return per-scope results. */
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
    const failure = check.run(ctx);
    scopeChecks[check.scope].push({
      id: check.id,
      name: check.name,
      status: failure ? "fail" : "pass",
      failure: failure ?? undefined,
    });
  }
  return {
    setup: buildScope(scopeChecks.setup, setupSummary(ctx)),
    agent: buildScope(scopeChecks.agent, agentSummary(ctx)),
  };
}

/** Run the audit against a project and return the full report. */
export function runAudit(
  fs: ReadonlyFS,
  projectPath: string,
  options: AuditOptions,
): AuditReport {
  const configState = loadConfig(projectPath, fs);
  const facts = extractProjectFacts(fs, {
    agentFilter: options.agentFilter,
    projectPath,
    configState,
  });
  const structure = parseProjectStructure(getProjectStructure());

  const ctx: AuditContext = {
    projectPath,
    facts,
    config: configState,
    fs,
    structure,
    agents: facts.agents,
    agentFilter: options.agentFilter,
  };

  const { setup: setupScope, agent: agentScope } = runBuildChecks(ctx);
  const harness = options.harness ? computeHarness(ctx) : null;

  const buildPassed =
    setupScope.status === "pass" && agentScope.status === "pass";
  const harnessPassed = !harness || harness.scope.status === "pass";
  const status = buildPassed && harnessPassed ? "pass" : "fail";

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
    overall: { status },
  };
}
