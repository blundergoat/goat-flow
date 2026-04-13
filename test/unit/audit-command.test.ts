/**
 * Audit command tests - build checks, quality concerns, JSON contract.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { runAudit } from "../../src/cli/audit/audit.js";
import { BUILD_CHECKS } from "../../src/cli/audit/agent-setup-checks.js";
import { QUALITY_CHECKS } from "../../src/cli/audit/harness-checks.js";
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
      askFirst: [],
      userRole: "developer",
      telemetry: false,
      knownGaps: [],
      skillOverrides: {},
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
    askFirst: { exists: false, paths: [], resolved: 0, unresolved: [] },
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
    stale_generic: ["audit", "review"],
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
      quality: false,
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
// Test 2: audit fails when a required .goat-flow/ directory is missing
// ---------------------------------------------------------------------------
describe("audit fails on missing required directory", () => {
  it("fails required-dirs check when a directory is missing", () => {
    const check = BUILD_CHECKS.find((c) => c.id === "required-dirs")!;
    const ctx = makeCtx({
      fs: stubFS({
        exists: (path: string) => path !== ".goat-flow/footguns",
        listDir: (path: string) => (path.includes("footguns") ? [] : ["file"]),
      }),
    });
    const result = check.run(ctx);
    assert.notEqual(result, null, "Should fail when required dir is missing");
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
  it("canonical-skills skips agents not listed in config.agents", () => {
    const check = BUILD_CHECKS.find((c) => c.id === "canonical-skills")!;
    const codexProfile: AgentProfile = {
      id: "codex",
      name: "Codex",
      instructionFile: "AGENTS.md",
      settingsFile: ".codex/config.toml",
      skillsDir: ".agents/skills",
      hooksDir: ".codex/hooks",
      denyMechanism: {
        type: "deny-script",
        path: ".codex/rules/deny-dangerous.star",
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
      agents: [stubAgentFacts(), codexFacts],
      fs: fsWithMissingCodexSkills,
    });
    const resultWithCodex = check.run(ctxWithCodex);
    assert.notEqual(resultWithCodex, null, "Should fail when codex skill files missing");
    assert.ok(resultWithCodex!.message.includes("codex:"), "Failure should mention codex");

    // With only claude in ctx.agents (config filter applied upstream), check passes
    const ctxClaudeOnly = makeCtx({
      agents: [stubAgentFacts()],
      fs: fsWithMissingCodexSkills,
    });
    const resultClaudeOnly = check.run(ctxClaudeOnly);
    assert.equal(resultClaudeOnly, null, "Should pass when only configured agent (claude) is checked");
  });
});

// ---------------------------------------------------------------------------
// Test 4: audit fails when a stale skill directory exists
// ---------------------------------------------------------------------------
describe("audit fails on stale skill directory", () => {
  it("fails stale-skill-dirs check when stale dir is present", () => {
    const check = BUILD_CHECKS.find((c) => c.id === "stale-skill-dirs")!;
    const ctx = makeCtx({
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
// Test 4: audit fails when installed skill contains workflow/ paths
// ---------------------------------------------------------------------------
describe("audit fails on workflow path leak", () => {
  it("fails workflow-path-leaks check when skill has workflow/ path", () => {
    const check = BUILD_CHECKS.find((c) => c.id === "workflow-path-leaks")!;
    const ctx = makeCtx({
      fs: stubFS({
        exists: () => true,
        readFile: (path: string) =>
          path.includes("SKILL.md")
            ? "Read workflow/setup/reference/template.md first"
            : null,
      }),
      agents: [
        stubAgentFacts({
          skills: {
            ...stubAgentFacts().skills,
            found: ["goat"],
          },
        }),
      ],
    });
    const result = check.run(ctx);
    assert.notEqual(result, null, "Should fail when skill has workflow/ path");
    assert.ok(
      result!.message.includes("workflow/"),
      `Failure should mention workflow: ${result!.message}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Test 5: audit --harness produces concerns without affecting exit code
// ---------------------------------------------------------------------------
describe("audit --harness", () => {
  it("produces concerns output without affecting exit code", () => {
    const projectPath = resolve(import.meta.dirname, "..", "..");
    const fs = createFS(projectPath);
    const report = runAudit(fs, projectPath, {
      agentFilter: "claude",
      quality: true,
    });

    // Build result should still pass (same checks, quality doesn't affect it)
    assert.equal(
      report.status,
      "pass",
      `Build should pass: ${JSON.stringify(report.scopes)}`,
    );

    // Quality concerns should be populated
    assert.notEqual(
      report.concerns,
      null,
      "concerns should be populated with --harness",
    );
    assert.ok(
      report.concerns!.context !== undefined,
      "context concern should exist",
    );
    assert.ok(
      report.concerns!.constraints !== undefined,
      "constraints concern should exist",
    );
    assert.ok(
      report.concerns!.verification !== undefined,
      "verification concern should exist",
    );
    assert.ok(
      report.concerns!.recovery !== undefined,
      "recovery concern should exist",
    );
    assert.ok(
      report.concerns!.feedback_loop !== undefined,
      "feedback_loop concern should exist",
    );

    // Grade and score should be present
    assert.ok(report.overall.grade !== null, "grade should be present");
    assert.ok(
      report.overall.qualityScore !== null,
      "qualityScore should be present",
    );
    assert.ok(
      typeof report.overall.qualityScore === "number" &&
        report.overall.qualityScore >= 0 &&
        report.overall.qualityScore <= 100,
      "qualityScore should be 0-100",
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
      quality: false,
    });

    // Top-level keys
    assert.equal(report.command, "audit");
    assert.equal(report.quality, false);
    assert.ok(["pass", "fail"].includes(report.status));

    // Scopes structure
    for (const scope of ["setup", "harness"] as const) {
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

    // Concerns null in build-only mode
    assert.equal(
      report.concerns,
      null,
      "concerns should be null without --harness",
    );

    // Overall
    assert.ok(["pass", "fail"].includes(report.overall.status));
    assert.equal(
      report.overall.grade,
      null,
      "grade should be null without --harness",
    );
    assert.equal(
      report.overall.qualityScore,
      null,
      "qualityScore should be null without --harness",
    );
  });

  it("has correct shape for quality mode", () => {
    const projectPath = resolve(import.meta.dirname, "..", "..");
    const fs = createFS(projectPath);
    const report = runAudit(fs, projectPath, {
      agentFilter: "claude",
      quality: true,
    });

    assert.equal(report.quality, true);
    assert.notEqual(report.concerns, null);

    for (const key of [
      "context",
      "constraints",
      "verification",
      "recovery",
      "feedback_loop",
    ] as const) {
      const c = report.concerns![key];
      assert.ok(typeof c.score === "number", `${key}.score should be a number`);
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

    assert.ok(report.overall.grade !== null);
    assert.ok(typeof report.overall.qualityScore === "number");
  });
});

// ---------------------------------------------------------------------------
// Test 7: build failure howToFix - required-dirs check includes actionable fix
// ---------------------------------------------------------------------------
describe("build failure howToFix", () => {
  it("required-dirs failure includes howToFix with mkdir instruction", () => {
    const check = BUILD_CHECKS.find((c) => c.id === "required-dirs")!;
    const ctx = makeCtx({
      fs: stubFS({
        exists: (path: string) => path !== ".goat-flow/footguns",
        listDir: (path: string) => (path.includes("footguns") ? [] : ["file"]),
      }),
    });
    const result = check.run(ctx);
    assert.notEqual(result, null, "Should fail when required dir is missing");
    assert.ok(result!.howToFix, "Failure should include howToFix");
    assert.ok(
      result!.howToFix!.includes("mkdir"),
      `howToFix should reference mkdir: ${result!.howToFix}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Test 8: quality recommendation howToFix - architecture-exists includes path
// ---------------------------------------------------------------------------
describe("quality recommendation howToFix", () => {
  it("architecture-exists failure includes howToFix with .goat-flow/ path", () => {
    const check = QUALITY_CHECKS.find((c) => c.id === "architecture-exists")!;
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
    assert.ok(result.howToFix, "Quality result should include howToFix");
    assert.ok(result.howToFix!.length > 0, "howToFix should have entries");
    assert.ok(
      result.howToFix![0].includes(".goat-flow/"),
      `howToFix should reference .goat-flow/ path: ${result.howToFix![0]}`,
    );
  });
});
