/**
 * Audit command tests - build checks, quality concerns, JSON contract.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { runAudit, computeHarness } from "../../src/cli/audit/audit.js";
import { SETUP_CHECKS } from "../../src/cli/audit/check-goat-flow.js";
import { AGENT_CHECKS } from "../../src/cli/audit/check-agent-setup.js";
import { HARNESS_CHECKS } from "../../src/cli/audit/harness/index.js";

const BUILD_CHECKS = [...SETUP_CHECKS, ...AGENT_CHECKS];
import { createFS } from "../../src/cli/facts/fs.js";
import type {
  AuditContext,
  ProjectStructure,
} from "../../src/cli/audit/types.js";
import type {
  ReadonlyFS,
  ProjectFacts,
  AgentFacts,
  AgentProfile,
} from "../../src/cli/types.js";
import type {
  LoadedConfig,
  GoatFlowConfig,
} from "../../src/cli/config/types.js";

// ---------------------------------------------------------------------------
// Helpers: minimal mock context for targeted build-check tests
// ---------------------------------------------------------------------------

function stubFS(overrides: Partial<ReadonlyFS> = {}): ReadonlyFS {
  return {
    exists: () => true,
    readFile: () => null,
    lineCount: () => 0,
    readJson: () => null,
    listDir: () => [],
    isExecutable: () => false,
    glob: () => [],
    ...overrides,
  };
}

function stubConfig(overrides: Partial<GoatFlowConfig> = {}): LoadedConfig {
  return {
    exists: true,
    valid: true,
    config: {
      version: "1.1.0",
      footguns: { path: ".goat-flow/footguns/" },
      lessons: { path: ".goat-flow/lessons/" },
      decisions: { path: ".goat-flow/decisions/" },
      tasks: { path: ".goat-flow/tasks/" },
      logs: { path: ".goat-flow/logs/" },
      agents: null,
      skills: { install: "all" },
      lineLimits: { target: 120, limit: 150 },
      toolchain: {
        test: ["npm test"],
        lint: ["eslint ."],
        build: ["tsc"],
        package: [],
        format: [],
      },
      userRole: "developer",
      telemetry: false,
      knownGaps: [],
      skillOverrides: {},
      harness: { acknowledge: [] },
      ...overrides,
    },
    warnings: [],
    errors: [],
    parseError: null,
  };
}

const STUB_AGENT_PROFILE: AgentProfile = {
  id: "claude",
  name: "Claude Code",
  instructionFile: "CLAUDE.md",
  settingsFile: ".claude/settings.json",
  skillsDir: ".claude/skills",
  hooksDir: ".claude/hooks",
  denyMechanism: { type: "settings-deny", path: ".claude/settings.json" },
  localPattern: "*/CLAUDE.md",
  hookEvents: { preTool: "PreToolUse", postTurn: "Stop" },
};

function stubAgentFacts(overrides: Partial<AgentFacts> = {}): AgentFacts {
  return {
    agent: STUB_AGENT_PROFILE,
    instruction: {
      exists: true,
      content: "# Test",
      lineCount: 50,
      sections: new Map(),
    },
    settings: { exists: true, valid: true, parsed: {}, hasDenyPatterns: true },
    skills: {
      installedDirs: [],
      found: [
        "goat",
        "goat-debug",
        "goat-plan",
        "goat-review",
        "goat-sbao",
        "goat-security",
        "goat-test",
      ],
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
      denyUsesJq: false,
      denyHandlesChaining: false,
      denyBlocksRmRf: true,
      denyBlocksForcePush: true,
      denyBlocksChmod: true,
      denyBlocksPipeToShell: false,
      denyBlocksCloudDestructive: false,
      postTurnExists: false,
      postTurnRegistered: false,
      postTurnRegisteredPath: null,
      postTurnExecutable: false,
      postTurnExitsZero: false,
      postTurnHasValidation: false,
      postTurnSwallowsFailures: false,
      compactionHookExists: false,
      absolutePathHooks: [],
      readDenyCoversSecrets: false,
    },
    deny: { gitCommitBlocked: false, gitPushBlocked: false },
    router: { exists: true, paths: [], resolved: 0, unresolved: [] },
    localContext: { files: [], warranted: [], missing: [] },
    ...overrides,
  };
}

const STUB_STRUCTURE: ProjectStructure = {
  required_files: [".goat-flow/config.yaml", ".goat-flow/architecture.md"],
  required_dirs: [".goat-flow/footguns/", ".goat-flow/lessons/"],
  skills: {
    canonical: [
      "goat",
      "goat-debug",
      "goat-plan",
      "goat-review",
      "goat-sbao",
      "goat-security",
      "goat-test",
    ],
    stale_names: ["goat-audit", "goat-investigate"],
  },
  agents: {},
};

function makeCtx(overrides: Partial<AuditContext> = {}): AuditContext {
  return {
    projectPath: "/tmp/test-project",
    facts: {
      root: "/tmp/test-project",
      stack: {
        languages: [],
        buildCommand: null,
        testCommand: null,
        lintCommand: null,
        formatCommand: null,
        sourceFileCount: 0,
        signals: {
          codeGenTools: [],
          deployPlatforms: [],
          llmIntegration: false,
          staticAnalysis: [],
          complianceSignals: false,
          formatterGaps: [],
        },
      },
      agents: [],
      shared: {
        footguns: {
          exists: true,
          hasEvidence: false,
          entryCount: 0,
          labelCount: 0,
          hasEvidenceLabels: false,
          dirMentions: new Map(),
          staleRefs: [],
          invalidLineRefs: [],
          duplicateSurfacePaths: [],
          totalRefs: 0,
          validRefs: 0,
          formatDiagnostic: null,
          path: ".goat-flow/footguns/",
        },
        lessons: {
          exists: true,
          hasEntries: false,
          entryCount: 0,
          staleRefs: [],
          duplicateSurfacePaths: [],
          formatDiagnostic: null,
          path: ".goat-flow/lessons/",
        },
        decisions: {
          dirExists: true,
          fileCount: 0,
          path: ".goat-flow/decisions/",
          hasRealContent: false,
        },
        config: {
          exists: true,
          valid: true,
          warningCount: 0,
          errorCount: 0,
          parseError: null,
          lineLimits: { target: 120, limit: 150 },
          userRole: "developer",
        },
        architecture: { exists: true, lineCount: 50 },
        ignoreFiles: {
          copilotignore: false,
          cursorignore: false,
          geminiignore: false,
        },
        gitignore: { exists: true, hasRequiredEntries: true },
        preflightScript: { exists: false },
        contextValidation: { exists: false },
        skillConventions: { exists: true },
        localInstructions: {
          dirExists: false,
          location: null,
          aiDirExists: false,
          githubDirExists: false,
          duplicateSurfacePaths: [],
          fileCount: 0,
          hasRouter: false,
          hasValidRouter: false,
          routerNeedsFix: null,
          hasConventions: false,
          conventionsHasContent: false,
          hasFrontend: false,
          hasBackend: false,
          hasCodeReview: false,
          hasGitCommit: false,
          conventionsContent: null,
          localFileSizes: [],
          path: "",
        },
        gitCommitInstructions: { exists: false },
        localInstructionsLineCount: 0,
      },
    } as ProjectFacts,
    config: stubConfig(),
    fs: stubFS(),
    structure: STUB_STRUCTURE,
    agents: [stubAgentFacts()],
    agentFilter: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test 1: audit passes on a well-configured project (this repo)
// ---------------------------------------------------------------------------
describe("audit on well-configured project", () => {
  it("passes on this repo", () => {
    const projectPath = resolve(import.meta.dirname, "..", "..");
    const fs = createFS(projectPath);
    const report = runAudit(fs, projectPath, {
      agentFilter: "claude",
      harness: false,
    });
    assert.equal(report.command, "audit");
    assert.equal(
      report.status,
      "pass",
      `Expected pass but got failures: ${JSON.stringify(report.scopes)}`,
    );
    assert.equal(
      report.scopes.setup.status,
      "pass",
      `Setup failures: ${JSON.stringify(report.scopes.setup.failures)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Test 2: audit fails when a named structure check is missing
// ---------------------------------------------------------------------------
describe("audit fails on missing footguns directory", () => {
  it("fails footguns check when directory is missing", () => {
    const check = BUILD_CHECKS.find((c) => c.id === "footguns")!;
    const ctx = makeCtx({
      fs: stubFS({
        exists: (path: string) =>
          path !== ".goat-flow/footguns" &&
          path !== ".goat-flow/footguns/README.md",
      }),
    });
    const result = check.run(ctx);
    assert.notEqual(result, null, "Should fail when footguns dir is missing");
    assert.ok(
      result!.message.includes("footguns"),
      `Failure should mention missing dir: ${result!.message}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Test 3: config.agents filters which agents are checked
// ---------------------------------------------------------------------------
describe("config.agents filtering", () => {
  it("agent-skills check validates skills for filtered agent", () => {
    const check = BUILD_CHECKS.find((c) => c.id === "agent-skills")!;
    const codexProfile: AgentProfile = {
      id: "codex",
      name: "Codex",
      instructionFile: "AGENTS.md",
      settingsFile: ".codex/config.toml",
      skillsDir: ".agents/skills",
      hooksDir: ".codex/hooks",
      denyMechanism: {
        type: "deny-script",
        path: ".codex/hooks/deny-dangerous.sh",
      },
      localPattern: ".github/instructions/*.md",
      hookEvents: { preTool: "", postTurn: "stop" },
    };
    const codexFacts = stubAgentFacts({ agent: codexProfile });

    // FS where claude skills exist but codex skills don't
    const fsWithMissingCodexSkills = stubFS({
      exists: (path: string) => !path.startsWith(".agents/skills/"),
    });

    // With codex in ctx.agents, check fails (codex skill files missing from disk)
    const ctxWithCodex = makeCtx({
      agentFilter: "codex",
      agents: [stubAgentFacts(), codexFacts],
      fs: fsWithMissingCodexSkills,
    });
    const resultWithCodex = check.run(ctxWithCodex);
    assert.notEqual(
      resultWithCodex,
      null,
      "Should fail when codex skill files missing",
    );
    assert.ok(
      resultWithCodex!.message.includes("codex:"),
      "Failure should mention codex",
    );

    // With only claude in ctx.agents (config filter applied upstream), check passes
    const ctxClaudeOnly = makeCtx({
      agentFilter: "claude",
      agents: [stubAgentFacts()],
      fs: fsWithMissingCodexSkills,
    });
    const resultClaudeOnly = check.run(ctxClaudeOnly);
    assert.equal(
      resultClaudeOnly,
      null,
      "Should pass when only configured agent (claude) is checked",
    );
  });
});

// ---------------------------------------------------------------------------
// Test 4: audit fails when a stale skill directory exists
// ---------------------------------------------------------------------------
describe("audit fails on stale skill directory", () => {
  it("agent-skills check fails when deprecated skill dir is present", () => {
    const check = BUILD_CHECKS.find((c) => c.id === "agent-skills")!;
    const ctx = makeCtx({
      agentFilter: "claude",
      agents: [
        stubAgentFacts({
          skills: {
            ...stubAgentFacts().skills,
            installedDirs: [".claude/skills/goat", ".claude/skills/goat-audit"],
          },
        }),
      ],
    });
    const result = check.run(ctx);
    assert.notEqual(result, null, "Should fail when stale skill dir exists");
    assert.ok(
      result!.message.includes("goat-audit"),
      `Failure should mention stale dir: ${result!.message}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Test 5: audit --harness produces concerns without affecting exit code
// ---------------------------------------------------------------------------
describe("audit --harness", () => {
  it("produces concerns with pass/fail status", () => {
    const projectPath = resolve(import.meta.dirname, "..", "..");
    const fs = createFS(projectPath);
    const report = runAudit(fs, projectPath, {
      agentFilter: "claude",
      harness: true,
    });

    // Build scopes should still pass
    assert.equal(
      report.scopes.setup.status,
      "pass",
      `Setup should pass: ${JSON.stringify(report.scopes.setup.failures)}`,
    );
    assert.equal(
      report.scopes.agent.status,
      "pass",
      `Agent should pass: ${JSON.stringify(report.scopes.agent.failures)}`,
    );

    // Harness scope should be populated
    assert.notEqual(
      report.scopes.harness,
      null,
      "harness scope should be populated with --harness",
    );

    // Concerns should be populated with pass/fail statuses
    assert.notEqual(
      report.concerns,
      null,
      "concerns should be populated with --harness",
    );
    for (const key of [
      "context",
      "constraints",
      "verification",
      "recovery",
      "feedback_loop",
    ] as const) {
      assert.ok(
        report.concerns![key] !== undefined,
        `${key} concern should exist`,
      );
      assert.ok(
        report.concerns![key].status === "pass" ||
          report.concerns![key].status === "fail",
        `${key} concern should have pass/fail status`,
      );
    }

    // No grade or qualityScore in new contract
    assert.ok(!("grade" in report.overall), "overall should not have grade");
    assert.ok(
      !("qualityScore" in report.overall),
      "overall should not have qualityScore",
    );
  });
});

// ---------------------------------------------------------------------------
// Test 6: JSON output contract: scopes and concerns keys with correct shape
// ---------------------------------------------------------------------------
describe("audit JSON contract", () => {
  it("has correct shape for build-only mode", () => {
    const projectPath = resolve(import.meta.dirname, "..", "..");
    const fs = createFS(projectPath);
    const report = runAudit(fs, projectPath, {
      agentFilter: "claude",
      harness: false,
    });

    // Top-level keys
    assert.equal(report.command, "audit");
    assert.equal(report.harness, false);
    assert.ok(["pass", "fail"].includes(report.status));

    // Scopes structure
    for (const scope of ["setup", "agent"] as const) {
      const s = report.scopes[scope];
      assert.ok(
        ["pass", "fail"].includes(s.status),
        `${scope}.status should be pass or fail`,
      );
      assert.ok(
        Array.isArray(s.failures),
        `${scope}.failures should be an array`,
      );
    }

    // Harness scope null in build-only mode
    assert.equal(
      report.scopes.harness,
      null,
      "harness scope should be null without --harness",
    );

    // Concerns null in build-only mode
    assert.equal(
      report.concerns,
      null,
      "concerns should be null without --harness",
    );

    // Overall
    assert.ok(["pass", "fail"].includes(report.overall.status));
  });

  it("has correct shape for harness mode", () => {
    const projectPath = resolve(import.meta.dirname, "..", "..");
    const fs = createFS(projectPath);
    const report = runAudit(fs, projectPath, {
      agentFilter: "claude",
      harness: true,
    });

    assert.equal(report.harness, true);
    assert.notEqual(report.scopes.harness, null);
    assert.notEqual(report.concerns, null);

    for (const key of [
      "context",
      "constraints",
      "verification",
      "recovery",
      "feedback_loop",
    ] as const) {
      const c = report.concerns![key];
      assert.ok(
        c.status === "pass" || c.status === "fail",
        `${key}.status should be pass or fail`,
      );
      assert.ok(
        Array.isArray(c.findings),
        `${key}.findings should be an array`,
      );
      assert.ok(
        Array.isArray(c.recommendations),
        `${key}.recommendations should be an array`,
      );
      assert.ok(
        Array.isArray(c.howToFix),
        `${key}.howToFix should be an array`,
      );
    }

    assert.ok(["pass", "fail"].includes(report.overall.status));
  });
});

// ---------------------------------------------------------------------------
// Test 7: build failure howToFix - footguns check includes actionable fix
// ---------------------------------------------------------------------------
describe("build failure howToFix", () => {
  it("footguns failure includes howToFix with mkdir instruction", () => {
    const check = BUILD_CHECKS.find((c) => c.id === "footguns")!;
    const ctx = makeCtx({
      fs: stubFS({
        exists: (path: string) =>
          path !== ".goat-flow/footguns" &&
          path !== ".goat-flow/footguns/README.md",
      }),
    });
    const result = check.run(ctx);
    assert.notEqual(result, null, "Should fail when footguns dir is missing");
    assert.ok(result!.howToFix, "Failure should include howToFix");
    assert.ok(
      result!.howToFix!.includes("mkdir"),
      `howToFix should reference mkdir: ${result!.howToFix}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Test 8: scratchpad is enforced by its dedicated named setup check
// ---------------------------------------------------------------------------
describe("scratchpad setup gate", () => {
  it("fails on missing scratchpad because it is part of the setup contract", () => {
    const check = BUILD_CHECKS.find((c) => c.id === "scratchpad")!;
    const ctx = makeCtx({
      fs: stubFS({
        exists: (path: string) => path !== ".goat-flow/scratchpad",
      }),
    });
    const result = check.run(ctx);
    assert.notEqual(
      result,
      null,
      "scratchpad should be enforced by its named setup check",
    );
  });

  it("fails on missing scratchpad README because the dir is local-by-design", () => {
    const check = BUILD_CHECKS.find((c) => c.id === "scratchpad")!;
    const ctx = makeCtx({
      fs: stubFS({
        exists: (path: string) => path !== ".goat-flow/scratchpad/README.md",
      }),
    });
    const result = check.run(ctx);
    assert.notEqual(
      result,
      null,
      "missing scratchpad/README.md should be flagged — it signals local-by-design intent",
    );
  });
});

// ---------------------------------------------------------------------------
// Test 9: optional config calibration fields do not lower harness scores
// ---------------------------------------------------------------------------
describe("optional config calibration", () => {
  it("does not penalize missing toolchain.test entries", () => {
    const check = HARNESS_CHECKS.find(
      (c) => c.id === "test-runner-configured",
    )!;
    const result = check.run(
      makeCtx({
        config: stubConfig({
          toolchain: {
            test: [],
            lint: [],
            build: [],
            package: [],
            format: [],
          },
        }),
      }),
    );
    assert.equal(result.status, "pass");
    assert.ok(
      result.findings.some((f) => f.includes("toolchain.test")),
      `Findings should explain optional toolchain semantics: ${result.findings.join(", ")}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Test 10: quality recommendation howToFix includes actionable path
// ---------------------------------------------------------------------------
describe("harness check howToFix", () => {
  it("doc-paths-resolve findings mention architecture.md when missing", () => {
    const check = HARNESS_CHECKS.find((c) => c.id === "doc-paths-resolve")!;
    const ctx = makeCtx({
      facts: {
        ...makeCtx().facts,
        shared: {
          ...makeCtx().facts.shared,
          architecture: { exists: false, lineCount: 0 },
        },
      },
    });
    const result = check.run(ctx);
    assert.ok(
      result.findings.some((f) => f.includes("architecture.md")),
      `Findings should mention architecture.md: ${result.findings.join(", ")}`,
    );
  });
});

// ---------------------------------------------------------------------------
// M01: Harness check type tagging + acknowledge-based scoring
// ---------------------------------------------------------------------------
describe("M01 harness check type tagging", () => {
  it("every harness check declares a valid type", () => {
    const valid = new Set(["integrity", "advisory", "metric"]);
    for (const check of HARNESS_CHECKS) {
      assert.ok(
        valid.has(check.type),
        `${check.id} has invalid or missing type: ${check.type}`,
      );
    }
  });

  it("matches the locked M01 distribution (9 integrity, 5 advisory, 2 metric)", () => {
    const byType = { integrity: 0, advisory: 0, metric: 0 } as Record<
      string,
      number
    >;
    for (const check of HARNESS_CHECKS) byType[check.type]!++;
    assert.deepStrictEqual(byType, { integrity: 9, advisory: 5, metric: 2 });
  });

  it("known-integrity ids are tagged integrity", () => {
    const integrityIds = new Set([
      "doc-paths-resolve",
      "deny-covers-secrets",
      "deny-blocks-dangerous",
      "deny-hook-registered",
      "hooks-registered",
      "milestone-tracking",
      "session-logs",
      "feedback-loop-active",
      "decisions-tracked",
    ]);
    for (const check of HARNESS_CHECKS) {
      if (integrityIds.has(check.id)) {
        assert.equal(
          check.type,
          "integrity",
          `${check.id} should be integrity`,
        );
      }
    }
  });

  it("known-metric ids are tagged metric", () => {
    const metricIds = new Set([
      "test-runner-configured",
      "post-turn-hook-integrity",
    ]);
    for (const check of HARNESS_CHECKS) {
      if (metricIds.has(check.id)) {
        assert.equal(check.type, "metric", `${check.id} should be metric`);
      }
    }
  });
});

describe("M01 scoring model", () => {
  // Stub context where every integrity check passes; compaction-hook (advisory)
  // fails because stubAgentFacts defaults compactionHookExists to false.
  function wellSetupButMissingCompaction(overrides: {
    acknowledge?: string[];
  }) {
    return makeCtx({
      config: stubConfig({
        harness: { acknowledge: overrides.acknowledge ?? [] },
      }),
    });
  }

  it("unacknowledged advisory fail flips concern.status to fail", () => {
    const ctx = wellSetupButMissingCompaction({});
    const { concerns } = computeHarness(ctx);
    // compaction-hook is advisory + recovery concern; failure should flip status.
    assert.equal(concerns.recovery.status, "fail");
    assert.equal(concerns.recovery.advisoryFail, 1);
    assert.equal(concerns.recovery.advisoryAcknowledged, 0);
  });

  it("acknowledged advisory fail does NOT flip the owning concern's status", () => {
    // Recovery concern contains compaction-hook (advisory) + milestone-tracking
    // (integrity) + session-logs (integrity). With the default stubFS the two
    // integrity checks pass, so acknowledging compaction-hook should make
    // recovery.status = pass.
    const ctx = wellSetupButMissingCompaction({
      acknowledge: ["compaction-hook"],
    });
    const { concerns } = computeHarness(ctx);
    assert.equal(concerns.recovery.status, "pass");
    assert.equal(concerns.recovery.advisoryFail, 0);
    assert.equal(concerns.recovery.advisoryAcknowledged, 1);
    assert.equal(concerns.recovery.integrityPass, 2);
  });

  it("acknowledged advisory does not add to scope.failures", () => {
    const ctx = wellSetupButMissingCompaction({
      acknowledge: ["compaction-hook"],
    });
    const { scope } = computeHarness(ctx);
    assert.ok(
      !scope.failures.some((f) => f.check.toLowerCase().includes("compaction")),
      `Acknowledged compaction-hook should not appear in scope.failures: ${JSON.stringify(scope.failures)}`,
    );
  });

  it("acknowledge silences exactly the listed id, not other advisories", () => {
    // Craft a scenario where two advisory checks fail: compaction-hook and
    // deny-blocks-pipe-to-shell. Acknowledge only compaction-hook.
    const hooks = {
      ...stubAgentFacts().hooks,
      compactionHookExists: false,
      denyBlocksPipeToShell: false,
    } as AgentFacts["hooks"];
    const ctx = makeCtx({
      config: stubConfig({
        harness: { acknowledge: ["compaction-hook"] },
      }),
      agents: [stubAgentFacts({ hooks })],
    });
    const { concerns } = computeHarness(ctx);
    // Recovery fail is acknowledged → pass; constraints fail is NOT acknowledged → fail.
    assert.equal(concerns.recovery.status, "pass");
    assert.equal(concerns.recovery.advisoryAcknowledged, 1);
    assert.equal(concerns.constraints.status, "fail");
    assert.equal(concerns.constraints.advisoryFail, 1);
  });

  it("metric checks never flip concern.status (always pass) and are counted", () => {
    const ctx = makeCtx();
    const { concerns } = computeHarness(ctx);
    // verification concern contains both metric checks (test-runner-configured,
    // post-turn-hook-integrity). They never fail in the current implementation.
    assert.equal(concerns.verification.metrics, 2);
  });

  it("CheckResult carries type and acknowledged fields", () => {
    const ctx = wellSetupButMissingCompaction({
      acknowledge: ["compaction-hook"],
    });
    const { scope } = computeHarness(ctx);
    const compaction = scope.checks.find((c) => c.id === "compaction-hook")!;
    assert.equal(compaction.type, "advisory");
    assert.equal(compaction.acknowledged, true);
    const docs = scope.checks.find((c) => c.id === "doc-paths-resolve")!;
    assert.equal(docs.type, "integrity");
    assert.equal(docs.acknowledged, undefined);
  });

  it("advisory failure emits WHY-not-integrity evidence with the check id", () => {
    const ctx = wellSetupButMissingCompaction({});
    const { scope } = computeHarness(ctx);
    const compaction = scope.checks.find((c) => c.id === "compaction-hook")!;
    assert.ok(compaction.failure, "advisory failure should have a failure obj");
    assert.ok(
      compaction.failure!.evidence?.includes("Advisory"),
      `evidence should explain advisory framing: ${compaction.failure!.evidence}`,
    );
    assert.ok(
      compaction.failure!.evidence?.includes("compaction-hook"),
      `evidence should reference the check id: ${compaction.failure!.evidence}`,
    );
  });
});
