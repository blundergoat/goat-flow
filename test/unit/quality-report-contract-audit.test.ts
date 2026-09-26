/**
 * Audit evidence inside generated quality prompts: the effective-hook chain and the project root a mode grounds its commands in.
 *
 * Split from `quality-report-contract.test.ts`, which sits exactly on the repository's 1000-substantive-line file budget and cannot take another
 * case. This file owns the audit-evidence slice so both files stay inside that budget.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { composeQuality } from "../../src/cli/prompt/compose-quality.js";
import type { QualityInput } from "../../src/cli/prompt/compose-quality-common.js";

const HOOK_REPAIR_COMMAND = "npx @blundergoat/goat-flow install .";
const HOOK_REPAIR_SUMMARY =
  "Hook script is installed but no agent registration invokes it.";

/**
 * Build one quality request for a mode under test.
 *
 * @param qualityMode - mode whose prompt is composed
 * @returns request carrying a fixed project path and run date so prompt text stays comparable between runs
 */
function makeInput(qualityMode: QualityInput["qualityMode"]): QualityInput {
  return {
    agent: "claude",
    projectPath: "/tmp/example-project",
    auditReport: null,
    auditUnavailableReason: "audit-failed",
    priorReport: null,
    qualityMode,
    runDate: "2026-07-03",
  };
}

/**
 * Build one agent's hook link.
 *
 * @param state - effective, advisory-only, or dangerous link state rendered in the prompt
 * @returns per-agent hook state carrying the effective label, repair summary, and repair command
 */
function makeHookAgentState(state: "effective" | "warning" | "danger") {
  const isEffective = state === "effective";
  const isDanger = state === "danger";
  return {
    supported: true,
    installed: isEffective || isDanger,
    isRegistered: isEffective || isDanger,
    isCurrentVersionInstalled: isEffective || isDanger,
    isTrusted: isEffective,
    registrationIssue: null,
    installationIssue: null,
    effectiveState: isEffective
      ? { status: "effective" as const, severity: "success" as const }
      : isDanger
        ? { status: "runtime-untrusted" as const, severity: "danger" as const }
        : { status: "not-registered" as const, severity: "warning" as const },
    effectiveStateLabel: isEffective
      ? "effective"
      : isDanger
        ? "runtime untrusted"
        : "not registered",
    evidenceIdentity: null,
    repairCommand: isEffective || isDanger ? null : HOOK_REPAIR_COMMAND,
    repairSummary: isEffective
      ? "Hook is registered and current."
      : isDanger
        ? "Managed hook runtime is untrusted."
        : HOOK_REPAIR_SUMMARY,
    scriptPath: ".goat-flow/hooks/deny-dangerous.sh",
    configPath: ".claude/settings.json",
  };
}

/**
 * Build a coverage chain whose one required surface is warning-only or dangerous for the selected agent.
 *
 * @param severity - row severity whose aggregate label and prompt rendering are under test
 * @returns non-green coverage naming a single required ineffective surface for claude while other agents stay healthy
 */
function makeIneffectiveHookCoverage(
  severity: "warning" | "danger" = "warning",
): NonNullable<QualityInput["auditReport"]>["hookCoverage"] {
  return {
    status: severity === "warning" ? "warning" : "fail",
    selectedAgents: ["claude"],
    summary: {
      selectedSurfaces: 1,
      requiredSurfaces: 1,
      requiredIneffective: 1,
      effective: 0,
      warning: severity === "warning" ? 1 : 0,
      danger: severity === "danger" ? 1 : 0,
      disabled: 0,
    },
    hooks: [
      {
        id: "deny-dangerous",
        name: "Deny dangerous commands",
        description: "Blocks destructive shell commands before they run.",
        defaultEnabled: true,
        requiresConfirmDialog: false,
        togglable: false,
        enabled: true,
        scanRoots: null,
        agents: {
          claude: makeHookAgentState(severity),
          codex: makeHookAgentState("effective"),
          antigravity: makeHookAgentState("effective"),
          copilot: makeHookAgentState("effective"),
        },
      },
    ],
  };
}

/**
 * Build an audit whose every scope passes, so hook severity cannot be mistaken for an ordinary scope failure.
 *
 * @param severity - required hook row severity attached to the otherwise passing audit
 * @returns passing audit report with a non-green hook chain attached
 */
function makePassingAuditWithHookGap(
  severity: "warning" | "danger" = "warning",
): NonNullable<QualityInput["auditReport"]> {
  const passingScope = {
    status: "pass" as const,
    checks: [],
    failures: [],
    summary: {},
  };
  return {
    command: "audit",
    status: "pass",
    target: "/tmp/example-project",
    harness: true,
    scopes: { setup: passingScope, agent: passingScope, harness: passingScope },
    concerns: null,
    enforcement: [],
    hookCoverage: makeIneffectiveHookCoverage(severity),
    drift: null,
    content: null,
    overall: { status: "pass" },
  };
}

/**
 * Assert one mode discloses the non-green chain without rewriting the audit's own verdict.
 *
 * @param qualityMode - mode whose composed prompt is inspected
 * @param auditReport - passing audit carrying an ineffective hook chain
 * @param aggregateLabel - aggregate coverage label the prompt must render
 * @param rowLabel - strongest required row label the prompt must retain
 */
function assertDisclosesIneffectiveHook(
  qualityMode: "agent-setup" | "harness",
  auditReport: NonNullable<QualityInput["auditReport"]>,
  aggregateLabel: "WARNING" | "FAIL",
  rowLabel: "WARNING" | "DANGER",
): void {
  const prompt = composeQuality({
    ...makeInput(qualityMode),
    auditReport,
  }).prompt;
  for (const expected of [
    "Effective Hook Coverage",
    `**: ${aggregateLabel}`,
    "1 required surface(s) ineffective",
    "deny-dangerous/claude",
    rowLabel,
  ]) {
    assert.ok(
      prompt.includes(expected),
      `${qualityMode}: prompt omits ${expected}`,
    );
  }
  if (aggregateLabel === "WARNING") {
    assert.ok(prompt.includes(HOOK_REPAIR_SUMMARY));
    assert.ok(prompt.includes(HOOK_REPAIR_COMMAND));
  }
  // Hook coverage is advisory to the audit verdict, so disclosing it must not rewrite the top-level status.
  assert.ok(
    prompt.includes("**Overall: PASS**") || prompt.includes("**Audit: PASS**"),
    `${qualityMode}: disclosing hook coverage changed the top-level audit status`,
  );
}

/**
 * Assert one focused mode grounds its commands in the project it owns rather than the runner's working directory.
 *
 * @param qualityMode - focused mode whose grounding commands are inspected
 * @param owningPath - project this request owns; callers resolve mode ownership before composing
 * @param selectedPath - separately selected target, which never displaces the owning root
 */
function assertGroundsInOwningProject(
  qualityMode: "process" | "harness",
  owningPath: string,
  selectedPath: string,
): void {
  const prompt = composeQuality({
    ...makeInput(qualityMode),
    projectPath: owningPath,
    selectedProjectPath: selectedPath,
  }).prompt;
  assert.ok(
    prompt.includes(`audit ${owningPath}`),
    `${qualityMode}: grounding audit does not name the owning project`,
  );
  assert.ok(
    prompt.includes(`stats ${owningPath} --check`),
    `${qualityMode}: grounding stats does not name the owning project`,
  );
  // A bare dot leaves the audited root to whatever directory the runner happens to start in.
  assert.equal(
    prompt.includes("cli.ts audit . "),
    false,
    `${qualityMode}: grounding audit still uses an ambiguous '.' root`,
  );
  assert.equal(
    prompt.includes("cli.ts stats . --check"),
    false,
    `${qualityMode}: grounding stats still uses an ambiguous '.' root`,
  );
}

const PROJECT_VALIDATION_LIMIT =
  "This audit inspected verification guidance and hook configuration; it did not execute project build, test, lint, typecheck, or format commands.";
const RECOVERY_RESUMABILITY_LIMIT =
  "Recovery storage is available, but this audit did not validate the current objective, completed work, last verification, next action, or end-to-end resumability.";
const RED_FLAGS_METRIC_LIMIT =
  "Instruction-file evidence-before-claims red-flags coverage is metric-only; gaps lower the Verification score but do not fail audit status.";
const FAST_CACHE_AUDIT_PLACEHOLDER =
  'The pre-filled `audit_status: "unavailable"` is a placeholder superseded by any live audit completed during this assessment.';
const QUALITY_MODES = ["agent-setup", "process", "harness", "skills"] as const;
const FOCUSED_QUALITY_MODES = ["process", "harness", "skills"] as const;

const DRIFT_EVIDENCE = [
  ".agents/skills/goat/SKILL.md",
  "installed dispatcher differs",
  "README.md:8 [removed-command-scan]",
  "documentation teaches a removed command",
] as const;

/**
 * Assert a focused prompt and its summary preserve every observed audit failure.
 * Use when a user launches from failed drift or content evidence so neither visible representation hides the problem.
 */
function assertCarriesAuditEvidence(
  surface: string,
  payload: ReturnType<typeof composeQuality>,
): void {
  // Every observed failure must reach both the readable prompt and the compact audit summary the UI can display.
  for (const evidence of DRIFT_EVIDENCE) {
    assert.ok(
      payload.prompt.includes(evidence),
      `${surface}: prompt omitted ${evidence}`,
    );
    assert.ok(
      payload.auditSummary.includes(evidence),
      `${surface}: auditSummary omitted ${evidence}`,
    );
  }
}

/**
 * Build one passing audit concern so tests can vary only the evidence limits users need to see.
 *
 * @param limits - evidence limits disclosed for this concern; empty means the run hid no unverified behaviour
 * @returns a passing concern carrying the supplied limits
 */
function makePassingAuditConcern(limits: string[] = []) {
  return {
    status: "pass" as const,
    score: 100,
    findings: [],
    limits,
    recommendations: [],
    howToFix: [],
    integrityPass: 1,
    integrityFail: 0,
    advisoryPass: 0,
    advisoryFail: 0,
    advisoryAcknowledged: 0,
    metrics: 0,
  };
}

/**
 * Build the passing audit a user sees when structural scores still carry explicit evidence limits.
 *
 * @returns a passing report whose concerns disclose the verification, red-flags, and recovery limits
 */
function makeLimitedAuditReport(): NonNullable<QualityInput["auditReport"]> {
  const emptyScope = {
    status: "pass" as const,
    checks: [],
    failures: [],
    summary: {},
  };
  return {
    command: "audit",
    status: "pass",
    target: "/tmp/example-project",
    harness: true,
    scopes: { setup: emptyScope, agent: emptyScope, harness: emptyScope },
    concerns: {
      context: makePassingAuditConcern(),
      constraints: makePassingAuditConcern(),
      verification: makePassingAuditConcern([
        PROJECT_VALIDATION_LIMIT,
        RED_FLAGS_METRIC_LIMIT,
      ]),
      recovery: makePassingAuditConcern([RECOVERY_RESUMABILITY_LIMIT]),
      feedback_loop: makePassingAuditConcern(),
    },
    enforcement: [],
    hookCoverage: {
      status: "pass",
      selectedAgents: [],
      summary: {
        selectedSurfaces: 0,
        requiredSurfaces: 0,
        requiredIneffective: 0,
        effective: 0,
        warning: 0,
        danger: 0,
        disabled: 0,
      },
      hooks: [],
    },
    drift: null,
    content: null,
    overall: { status: "pass" },
  };
}

describe("quality report contract: audit evidence", () => {
  it("surfaces a warning-only effective-hook chain under a passing audit", () => {
    const auditReport = makePassingAuditWithHookGap("warning");
    assertDisclosesIneffectiveHook(
      "agent-setup",
      auditReport,
      "WARNING",
      "WARNING",
    );
    assertDisclosesIneffectiveHook(
      "harness",
      auditReport,
      "WARNING",
      "WARNING",
    );
  });

  it("surfaces a dangerous effective-hook chain under a passing audit", () => {
    const auditReport = makePassingAuditWithHookGap("danger");
    assertDisclosesIneffectiveHook(
      "agent-setup",
      auditReport,
      "FAIL",
      "DANGER",
    );
    assertDisclosesIneffectiveHook("harness", auditReport, "FAIL", "DANGER");
  });

  it("names the agents a coverage result covers", () => {
    // A one-agent audit and an all-agent audit render the same sentence, so the row must say which scope produced it.
    const narrowed = makePassingAuditWithHookGap();
    const narrowedPrompt = composeQuality({
      ...makeInput("process"),
      auditReport: narrowed,
    }).prompt;
    assert.ok(
      narrowedPrompt.includes("agents covered: claude"),
      "a claude-scoped coverage row does not name the agent it covers",
    );

    // A passing chain is the dangerous case: it reads as clean coverage for every shipped agent unless the scope is stated.
    const wideOpen = makePassingAuditWithHookGap();
    wideOpen.hookCoverage = {
      status: "pass",
      selectedAgents: ["claude", "codex", "antigravity", "copilot"],
      summary: {
        selectedSurfaces: 4,
        requiredSurfaces: 4,
        requiredIneffective: 0,
        effective: 4,
        warning: 0,
        danger: 0,
        disabled: 0,
      },
      hooks: [],
    };
    const widePrompt = composeQuality({
      ...makeInput("process"),
      auditReport: wideOpen,
    }).prompt;
    assert.ok(
      widePrompt.includes(
        "agents covered: claude, codex, antigravity, copilot",
      ),
      "an unscoped coverage row does not name the agents it covers",
    );

    // Selecting no agent surface is a real audit shape and must not read as covered.
    const none = makePassingAuditWithHookGap();
    none.hookCoverage = {
      status: "pass",
      selectedAgents: [],
      summary: {
        selectedSurfaces: 0,
        requiredSurfaces: 0,
        requiredIneffective: 0,
        effective: 0,
        warning: 0,
        danger: 0,
        disabled: 0,
      },
      hooks: [],
    };
    const nonePrompt = composeQuality({
      ...makeInput("process"),
      auditReport: none,
    }).prompt;
    assert.ok(
      nonePrompt.includes("no agent surface selected"),
      "a coverage row covering nothing does not say so",
    );
  });

  it("grounds focused modes in their owning project path", () => {
    const controllerPath = "/tmp/goat-flow-controller";
    const targetPath = "/tmp/goat-flow-selected-target";
    // Callers resolve mode ownership before the request, so `projectPath` is already the project whose evidence this mode owns.
    assertGroundsInOwningProject("process", controllerPath, targetPath);
    assertGroundsInOwningProject("harness", targetPath, targetPath);

    // Skills reviews read shared workflow definitions, so the selected target is never their command root.
    const skillsPrompt = composeQuality({
      ...makeInput("skills"),
      projectPath: controllerPath,
      selectedProjectPath: targetPath,
    }).prompt;
    assert.equal(
      skillsPrompt.includes(`audit ${targetPath}`),
      false,
      "skills: selected target became an audit root",
    );
    assert.equal(
      skillsPrompt.includes(`stats ${targetPath}`),
      false,
      "skills: selected target became a stats root",
    );
  });
  // A user choosing any Quality mode must receive the same deterministic evidence boundaries.
  for (const qualityMode of QUALITY_MODES) {
    it(`embeds live Verification and Recovery limits in ${qualityMode} prompt and summary`, () => {
      const auditReport = makeLimitedAuditReport();
      const payload = composeQuality({
        ...makeInput(qualityMode),
        auditReport,
      });
      assert.ok(
        payload.prompt.includes(PROJECT_VALIDATION_LIMIT),
        `${qualityMode}: prompt omitted Verification limit`,
      );
      assert.ok(
        payload.prompt.includes(RECOVERY_RESUMABILITY_LIMIT),
        `${qualityMode}: prompt omitted Recovery limit`,
      );
      assert.ok(
        payload.prompt.includes(RED_FLAGS_METRIC_LIMIT),
        `${qualityMode}: prompt omitted red-flags metric limit`,
      );
      assert.ok(
        payload.auditSummary.includes(PROJECT_VALIDATION_LIMIT),
        `${qualityMode}: auditSummary omitted Verification limit`,
      );
      assert.ok(
        payload.auditSummary.includes(RECOVERY_RESUMABILITY_LIMIT),
        `${qualityMode}: auditSummary omitted Recovery limit`,
      );
      assert.ok(
        payload.auditSummary.includes(RED_FLAGS_METRIC_LIMIT),
        `${qualityMode}: auditSummary omitted red-flags metric limit`,
      );
    });
  }

  // A fast dashboard launch without cached evidence must disclose the gap instead of inventing limits.
  for (const qualityMode of FOCUSED_QUALITY_MODES) {
    it(`keeps the ${qualityMode} cache-miss contract when no audit report is available`, () => {
      const payload = composeQuality({
        ...makeInput(qualityMode),
        auditUnavailableReason: "fast-cache-only",
      });
      assert.match(
        payload.prompt,
        /Audit: NOT LOADED \(FAST CACHE-ONLY MODE\)/,
      );
      assert.match(payload.auditSummary, /fast cache-only mode/);
      assert.match(
        payload.prompt,
        /Audit data not loaded \(fast cache-only mode/u,
      );
      assert.ok(
        payload.prompt.includes(FAST_CACHE_AUDIT_PLACEHOLDER),
        `${qualityMode}: missing fast-cache audit placeholder precedence`,
      );
      assert.equal(payload.prompt.includes(PROJECT_VALIDATION_LIMIT), false);
      assert.equal(payload.prompt.includes(RECOVERY_RESUMABILITY_LIMIT), false);
    });
  }

  // Every focused mode must preserve drift and content failures in both prompt and summary views.
  for (const qualityMode of FOCUSED_QUALITY_MODES) {
    it(`embeds drift and content failures in ${qualityMode} prompts and summaries`, () => {
      const auditReport = makeLimitedAuditReport();
      auditReport.status = "fail";
      auditReport.overall.status = "fail";
      auditReport.drift = {
        status: "fail",
        checked: 12,
        findings: [
          {
            kind: "content",
            path: ".agents/skills/goat/SKILL.md",
            message: "installed dispatcher differs from its workflow source",
          },
        ],
      };
      auditReport.content = {
        status: "fail",
        warnings: 1,
        infos: 0,
        filesScanned: 4,
        findings: [
          {
            severity: "warning",
            rule: "removed-command-scan",
            path: "README.md",
            line: 8,
            message: "documentation teaches a removed command",
          },
        ],
      };
      const payload = composeQuality({
        ...makeInput(qualityMode),
        auditReport,
      });
      assertCarriesAuditEvidence(qualityMode, payload);
    });
  }
});
