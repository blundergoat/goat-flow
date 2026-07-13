/**
 * Protects the advisory enforcement matrix from showing runners as equivalent without equivalent proof.
 * Use these tests when capability status, evidence sources, or user-facing assurance labels change.
 * Fixtures prove the output contract only; they do not execute an external coding agent.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAgentEnforcementCapability,
  validateEnforcementCapabilityEvidence,
} from "../../src/cli/audit/enforcement.js";
import { PROFILES } from "../../src/cli/detect/agents.js";
import {
  getRepoAudit,
  renderAuditJson,
  renderAuditText,
} from "./audit-command/helpers.js";
import type { AuditReport, AuditScope } from "../../src/cli/audit/types.js";
import type { AgentFacts, AgentProfile } from "../../src/cli/types.js";

/** Build a minimal agent scope because enforcement capability logic only needs status-shaped checks. */
function agentScope(status: "pass" | "fail" | "skipped"): AuditScope {
  return {
    status: status === "fail" ? "fail" : "pass",
    checks: [
      {
        id: "agent-guardrails",
        name: "Agent deny mechanism",
        status,
        displayStatus: status === "skipped" ? "skipped" : status,
        impact: status === "fail" ? "scope-fail" : "none",
        provenance: {
          source_type: "spec",
          source_urls: [],
          verified_on: "2026-05-17",
          normative_level: "MUST",
        },
        ...(status === "fail"
          ? {
              failure: {
                check: "Agent deny mechanism",
                message: "deny-dangerous.sh --self-test=smoke failed",
              },
            }
          : {}),
      },
    ],
    failures: [],
    summary: {},
  };
}

/** Build healthy local facts so each runner can be compared from the same user-visible audit baseline. */
function facts(
  agent: AgentProfile,
  overrides: Partial<AgentFacts["hooks"]> = {},
): AgentFacts {
  return {
    agent,
    instruction: {
      exists: true,
      content: "# agent",
      lineCount: 20,
      sections: new Map(),
    },
    settings: {
      exists: agent.settingsFile !== null,
      valid: true,
      parsed: {},
      hasDenyPatterns: agent.denyMechanism.type !== "deny-script",
    },
    skills: {
      installedDirs: [],
      found: [],
      missing: [],
      allPresent: true,
      versions: {},
      outdatedCount: 0,
      hasDispatcher: true,
      quality: {
        withStep0: 0,
        withHumanGate: 0,
        withConstraints: 0,
        withPhases: 0,
        withConversational: 0,
        withChoices: 0,
        withOutputFormat: 0,
        withSharedConventions: 0,
        malformedFenceCount: 0,
        unadaptedCount: 0,
        adaptCommentCount: 0,
        total: 0,
      },
    },
    hooks: {
      denyExists: true,
      denyHasBlocks: true,
      denyIsConfigBased: false,
      denyUsesJq: true,
      denyHandlesChaining: true,
      denyBlocksRmRf: true,
      denyBlocksGitPush: true,
      denyBlocksChmod: true,
      denyBlocksPipeToShell: true,
      denyBlocksCloudDestructive: true,
      denyIsRegistered: true,
      denyRegisteredPath: agent.denyHookFile,
      postTurnExists: false,
      postTurnRegistered: false,
      postTurnRegisteredPath: null,
      postTurnExecutable: false,
      postTurnExitsZero: false,
      postTurnHasValidation: false,
      postTurnSwallowsFailures: false,
      absolutePathHooks: [],
      readDenyCoversSecrets: agent.denyMechanism.type !== "deny-script",
      bashDenyCoversSecrets: true,
      ...overrides,
    },
    deny: { gitCommitBlocked: true, gitPushBlocked: true },
    router: { exists: true, paths: [], resolved: 0, unresolved: [] },
    localContext: { files: [], warranted: [], missing: [] },
  };
}

/** Return one named capability so assertions explain which protection the audit user is comparing. */
function byId(
  report: ReturnType<typeof buildAgentEnforcementCapability>,
  id: string,
) {
  const item = report.capabilities.find((entry) => entry.id === id);
  assert.ok(item, `expected ${id}`);
  return item;
}

/**
 * Assert fact-backed hard enforcement statuses for supported hook agents.
 *
 * @param agents - agent profiles whose facts should yield hard enforcement
 */
function assertFactBackedStatusesForAgents(
  agents: ReadonlyArray<(typeof PROFILES)[keyof typeof PROFILES]>,
): void {
  // Each supported runner must expose the same status, source, and assurance fields to the audit user.
  agents.forEach((agent) => {
    const matrix = buildAgentEnforcementCapability(facts(agent), {
      agentScope: agentScope("pass"),
      denyMechanismEvidenceLevel: "full",
    });
    assert.equal(byId(matrix, "shell-dangerous").status, "hard");
    assert.equal(byId(matrix, "secret-shell-read").status, "hard");
    assert.equal(byId(matrix, "hook-registration").status, "hard");
    assert.equal(byId(matrix, "hook-self-test").status, "hard");
    assert.equal(byId(matrix, "hook-self-test").assurance, "runtime-local");
    assert.deepEqual(byId(matrix, "hook-self-test").sources, [
      "runtime-self-test",
    ]);
    assert.match(
      byId(matrix, "hook-self-test").summary,
      /runtime-shaped payload smoke passed/,
    );
    assert.equal(byId(matrix, "provider-native-enforcement").status, "limited");
  });
}

/** Assert one runner's file-tool protection without hiding runner-specific evidence in a test loop. */
function assertSecretFileStatusForAgent(
  agent: (typeof PROFILES)[keyof typeof PROFILES],
  expectedStatus: "hard" | "limited",
): void {
  const matrix = buildAgentEnforcementCapability(facts(agent), {
    agentScope: agentScope("pass"),
    denyMechanismEvidenceLevel: "full",
  });
  assert.equal(byId(matrix, "secret-file-read").status, expectedStatus);
  assert.equal(byId(matrix, "provider-native-enforcement").status, "limited");
}

describe("agent enforcement capability matrix", () => {
  it("derives fact-backed statuses for all supported agents", () => {
    assertFactBackedStatusesForAgents([
      PROFILES.claude,
      PROFILES.codex,
      PROFILES.antigravity,
      PROFILES.copilot,
    ]);

    // Script-only runners must not inherit the stronger file-tool protection available to settings-backed runners.
    assertSecretFileStatusForAgent(PROFILES.claude, "hard");
    assertSecretFileStatusForAgent(PROFILES.codex, "hard");
    assertSecretFileStatusForAgent(PROFILES.antigravity, "limited");
    assertSecretFileStatusForAgent(PROFILES.copilot, "limited");
  });

  it("rejects hard enforcement backed only by unobserved evidence", () => {
    assert.throws(
      () => validateEnforcementCapabilityEvidence("hard", ["not-observed"]),
      /hard enforcement requires local static or runtime evidence/i,
    );
  });

  it("renders enforcement strength with its assurance and evidence source", () => {
    const report = getRepoAudit({ agentFilter: "codex", harness: true });
    const terminalOutput = renderAuditText(report);
    const jsonOutput = JSON.parse(renderAuditJson(report)) as AuditReport;
    const terminalCapability = report.enforcement?.[0]?.capabilities[0];
    const jsonCapability = jsonOutput.enforcement?.[0]?.capabilities[0];

    assert.ok(terminalCapability);
    assert.ok(jsonCapability);
    assert.match(
      terminalOutput,
      /\[assurance: static-local; source: local-hook\]/,
    );
    assert.match(terminalOutput, /not provider support/i);
    assert.equal(jsonCapability.assurance, terminalCapability.assurance);
    assert.deepEqual(jsonCapability.sources, terminalCapability.sources);
  });

  it("does not infer broad file read or write enforcement from secret-path coverage", () => {
    const matrix = buildAgentEnforcementCapability(facts(PROFILES.claude), {
      agentScope: agentScope("pass"),
      denyMechanismEvidenceLevel: "full",
    });

    assert.equal(byId(matrix, "file-read-restrictions").status, "unknown");
    assert.equal(byId(matrix, "file-write-restrictions").status, "unknown");
    assert.equal(
      byId(matrix, "file-read-restrictions").assurance,
      "not-observed",
    );
    assert.deepEqual(byId(matrix, "file-write-restrictions").sources, [
      "not-observed",
    ]);
    assert.match(
      byId(matrix, "file-read-restrictions").summary,
      /Not inferred from secret-path coverage/,
    );
  });

  it("marks missing and malformed deny setups without creating new gates", () => {
    const missing = buildAgentEnforcementCapability(
      facts(PROFILES.codex, {
        denyExists: false,
        denyHasBlocks: false,
        denyBlocksRmRf: false,
        denyBlocksGitPush: false,
        denyBlocksChmod: false,
        denyBlocksPipeToShell: false,
        denyIsRegistered: false,
        readDenyCoversSecrets: false,
        bashDenyCoversSecrets: false,
      }),
      { agentScope: agentScope("skipped"), denyMechanismEvidenceLevel: "full" },
    );

    assert.equal(byId(missing, "shell-dangerous").status, "missing");
    assert.equal(byId(missing, "hook-registration").status, "missing");
    assert.equal(byId(missing, "hook-self-test").status, "missing");

    const malformed = buildAgentEnforcementCapability(facts(PROFILES.claude), {
      agentScope: agentScope("fail"),
      denyMechanismEvidenceLevel: "full",
    });
    assert.equal(byId(malformed, "hook-self-test").status, "missing");
    assert.match(byId(malformed, "hook-self-test").summary, /self-test/);
  });

  it("downgrades self-test proof when dashboard summary evidence skips runtime checks", () => {
    const matrix = buildAgentEnforcementCapability(facts(PROFILES.claude), {
      agentScope: agentScope("pass"),
      denyMechanismEvidenceLevel: "present-only",
    });

    assert.equal(byId(matrix, "hook-self-test").status, "limited");
    assert.equal(byId(matrix, "hook-self-test").assurance, "static-local");
    assert.match(
      byId(matrix, "hook-self-test").summary,
      /runtime self-test was skipped/,
    );
  });
});
