/**
 * Audit orchestrator for `goat-flow audit`.
 * Loads config, extracts facts, runs build checks (pass/fail) and optional
 * harness completeness checks (--harness, deterministic pass/fail per concern).
 * Returns an AuditReport consumed by renderers and the dashboard.
 */
import { existsSync } from "node:fs";
import type { AgentId, ReadonlyFS } from "../types.js";
import { loadConfig } from "../config/index.js";
import { extractProjectFacts } from "../facts/orchestrator.js";
import { getTemplatePath, isPackagedInstall } from "../paths.js";
import { loadManifest } from "../manifest/manifest.js";
import { SETUP_CHECKS } from "./check-goat-flow.js";
import { AGENT_CHECKS } from "./check-agent-setup.js";
import { HARNESS_CHECKS } from "./harness/index.js";
import { checkDrift } from "./check-drift.js";
import { runContentQualityChecks } from "./check-content-quality.js";
import { runFactualClaimChecks } from "./check-factual-claims.js";
import { runSnapshotClaimChecks } from "./check-snapshot-claims.js";
import { validateProvenance } from "./provenance-types.js";
import type {
  AuditContext,
  AuditConcern,
  AuditConcernKey,
  AuditReport,
  AuditScope,
  AuditScopeName,
  CheckResult,
  ContentReport,
  HarnessCheck,
  HarnessCheckResult,
  ProjectStructure,
} from "./types.js";

interface AuditOptions {
  agentFilter: AgentId | null;
  harness: boolean;
  /** Optional drift check (M04). Defaults to false when omitted. */
  checkDrift?: boolean;
  /** Optional cold-path content lint (M05). Defaults to false when omitted. */
  checkContent?: boolean;
}

/** Combine content-quality + factual-claim + snapshot-claim findings into a ContentReport. */
function computeContent(ctx: AuditContext): ContentReport {
  const quality = runContentQualityChecks(ctx);
  const factual = runFactualClaimChecks(ctx);
  const snapshot = runSnapshotClaimChecks(ctx);
  const findings = [
    ...quality.findings,
    ...factual.findings,
    ...snapshot.findings,
  ];
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const infos = findings.filter((f) => f.severity === "info").length;
  return {
    status: warnings === 0 ? "pass" : "fail",
    findings,
    warnings,
    infos,
    filesScanned:
      quality.filesScanned + factual.filesScanned + snapshot.filesScanned,
  };
}

/** Build the audit-facing `ProjectStructure` from the validated manifest.
 *  Replaces the previous pass-through from raw JSON (`getProjectStructure()`),
 *  which allowed malformed shapes to leak into audit logic. */
function buildProjectStructure(): ProjectStructure {
  const manifest = loadManifest();
  return {
    required_files: manifest.required_files,
    required_dirs: manifest.required_dirs,
    skills: {
      canonical: [...manifest.facts.skills.names],
      stale_names: [...manifest.facts.skills.stale_names],
      references: manifest.skills.references ?? {},
    },
    agents: Object.fromEntries(
      Object.entries(manifest.agents).map(([id, agent]) => [
        id,
        {
          instruction_file: agent.instruction_file,
          skills_dir: agent.skills_dir,
          ...(agent.hooks_dir !== undefined
            ? { hooks_dir: agent.hooks_dir }
            : {}),
          ...(agent.settings !== undefined ? { settings: agent.settings } : {}),
          ...(agent.hooks !== undefined ? { hooks: agent.hooks } : {}),
        },
      ]),
    ),
  };
}

/** Build an audit scope from its checks, excluding acknowledged advisory failures. */
function buildScope(
  checks: CheckResult[],
  summary: Record<string, string>,
): AuditScope {
  const failures = checks.flatMap((c) =>
    c.failure && !c.acknowledged ? [c.failure] : [],
  );
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

  const failure =
    baseFailure && check.type === "advisory"
      ? {
          ...baseFailure,
          evidence: acknowledged
            ? `Advisory (acknowledged via harness.acknowledge: [${check.id}]). Best practice, not install drift.`
            : `Advisory (best practice, not install drift). Silence with harness.acknowledge: [${check.id}] in .goat-flow/config.yaml, or fix to reach pass.`,
        }
      : baseFailure;

  return {
    id: check.id,
    name: check.name,
    status: result.status,
    provenance: check.provenance,
    failure,
    type: check.type,
    acknowledged: acknowledged || undefined,
  };
}

/** Validate provenance on every registered check against the target project or package root.
 *
 *  In packaged installs, `evidence_paths` pointing at framework-repo docs
 *  (`.goat-flow/footguns/*`, `.goat-flow/lessons/*`, `docs/*`) can't be
 *  resolved because those files aren't in `package.json` `files`. Skip the
 *  existence check there - the paths are human-readable pointers for future
 *  maintainers, not runtime contracts. In dev mode we keep the check so
 *  stale provenance surfaces in preflight. */
function validateRegisteredCheckProvenance(fs: ReadonlyFS): void {
  const checks = [...SETUP_CHECKS, ...AGENT_CHECKS, ...HARNESS_CHECKS];
  const errors: string[] = [];
  const pathExists = isPackagedInstall()
    ? undefined
    : (p: string) => fs.exists(p) || existsSync(getTemplatePath(p));
  for (const check of checks) {
    for (const error of validateProvenance(check.provenance, pathExists)) {
      errors.push(`${check.id}: ${error}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(
      `Invalid audit check provenance:\n- ${errors.join("\n- ")}`,
    );
  }
}

/** Create an empty AuditConcern with zeroed counters. */
function emptyConcern(): AuditConcern {
  return {
    status: "pass",
    score: 0,
    findings: [],
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

/** Apply a single check result to its concern per the typed scoring model. */
function applyCheckToConcern(
  concern: AuditConcern,
  check: HarnessCheck,
  result: HarnessCheckResult,
  acknowledged: boolean,
): void {
  concern.findings.push(...result.findings);
  if (check.type === "metric") {
    concern.metrics++;
    return;
  }
  const pass = result.status === "pass";
  if (check.type === "integrity") {
    if (pass) concern.integrityPass++;
    else concern.integrityFail++;
  } else {
    if (pass) concern.advisoryPass++;
    else if (acknowledged) concern.advisoryAcknowledged++;
    else concern.advisoryFail++;
  }
  if (!pass && !acknowledged) {
    concern.status = "fail";
    concern.recommendations.push(...result.recommendations);
    if (result.howToFix) concern.howToFix.push(...result.howToFix);
  }
}

/** Run harness checks and return the scope results plus per-concern scores. */
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
      provenance: check.provenance,
      failure: failure ?? undefined,
    });
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
  const configState = loadConfig(projectPath, fs);
  const facts = extractProjectFacts(fs, {
    agentFilter: options.agentFilter,
    projectPath,
    configState,
  });
  const structure = buildProjectStructure();
  return {
    projectPath,
    facts,
    config: configState,
    fs,
    structure,
    agents: facts.agents,
    agentFilter: options.agentFilter,
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
 * Decide whether drift should auto-run without --check-drift (M19-4).
 *
 * Multi-agent projects leave satellite skill dirs (`.agents/skills/`,
 * `.gemini/skills/`, etc.) stale after a single-agent migration completes.
 * The existing drift machinery detects `manifest.stale_names` orphans but
 * is off by default, so `audit --agent claude` on a project that also ships
 * AGENTS.md / GEMINI.md exits "pass" while the Codex / Gemini skill dirs
 * still hold pre-v1.2 names. When more than one agent instruction file is
 * present on disk we run drift automatically. Evidence: n=4 migrations
 * reviewed 2026-04-20 all had stale satellite dirs surviving a "pass"
 * audit - see `.goat-flow/tasks/1.2.0/M19-setup-signal-hardening.md`
 * slice M19-4.
 *
 * The signal is computed from the manifest-backed instruction paths rather
 * than `ctx.agents`, which has already been narrowed by `--agent` upstream.
 * Using the filtered list would hide the multi-agent signal exactly when it
 * matters - the single-agent-filter case is the one stale satellites exploit.
 *
 * Single-agent projects preserve the prior opt-in behaviour.
 */
function shouldAutoRunDrift(ctx: AuditContext): boolean {
  const manifest = loadManifest();
  let instructionFilesPresent = 0;
  for (const agent of Object.values(manifest.agents)) {
    if (ctx.fs.exists(agent.instruction_file)) instructionFilesPresent++;
  }
  return instructionFilesPresent > 1;
}

/** Run the audit against a project and return the full report. */
export function runAudit(
  fs: ReadonlyFS,
  projectPath: string,
  options: AuditOptions,
): AuditReport {
  const ctx = buildAuditContext(fs, projectPath, options);
  validateRegisteredCheckProvenance(ctx.fs);
  const { setup: setupScope, agent: agentScope } = runBuildChecks(ctx);
  const harness = options.harness ? computeHarness(ctx) : null;
  const driftEnabled = options.checkDrift === true || shouldAutoRunDrift(ctx);
  const drift = driftEnabled ? checkDrift({ fs, projectPath }) : null;
  const content = options.checkContent ? computeContent(ctx) : null;
  const status = overallStatus(setupScope, agentScope, harness, drift, content);

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
    drift,
    content,
    overall: { status },
  };
}
