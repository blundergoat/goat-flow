/**
 * Audit command tests - build checks, quality concerns, JSON contract.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { runAudit, computeHarness } from "../../src/cli/audit/audit.js";
import { SETUP_CHECKS } from "../../src/cli/audit/check-goat-flow.js";
import { AGENT_CHECKS } from "../../src/cli/audit/check-agent-setup.js";
import { HARNESS_CHECKS } from "../../src/cli/audit/harness/index.js";
import { AUDIT_VERSION, SKILL_NAMES } from "../../src/cli/constants.js";
import { PROFILES } from "../../src/cli/detect/agents.js";
import { composeSetup } from "../../src/cli/prompt/compose-setup.js";
import { extractHookFacts } from "../../src/cli/facts/agent/hooks.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const BUILD_CHECKS = [...SETUP_CHECKS, ...AGENT_CHECKS];
import { createFS } from "../../src/cli/facts/fs.js";
import type {
  AuditContext,
  AuditReport,
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
      version: AUDIT_VERSION,
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
  hookConfigFile: ".claude/settings.json",
  skillsDir: ".claude/skills",
  hooksDir: ".claude/hooks",
  denyMechanism: { type: "settings-deny", path: ".claude/settings.json" },
  denyHookFile: ".claude/hooks/deny-dangerous.sh",
  localPattern: "*/CLAUDE.md",
  hookEvents: { preTool: "PreToolUse", postTurn: "Stop" },
};

function extractHookFactsForDenyContent(denyContent: string) {
  const fs = stubFS({
    exists: (path) => path === STUB_AGENT_PROFILE.denyHookFile,
    readFile: (path) =>
      path === STUB_AGENT_PROFILE.denyHookFile ? denyContent : null,
  });
  return extractHookFacts(fs, STUB_AGENT_PROFILE, {}, true, true);
}

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
        "goat-critique",
        "goat-security",
        "goat-qa",
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
      denyBlocksGitPush: true,
      denyBlocksChmod: true,
      denyBlocksPipeToShell: false,
      denyBlocksCloudDestructive: false,
      denyIsRegistered: true,
      denyRegisteredPath: ".claude/hooks/deny-dangerous.sh",
      postTurnExists: false,
      postTurnRegistered: false,
      postTurnRegisteredPath: null,
      postTurnExecutable: false,
      postTurnExitsZero: false,
      postTurnHasValidation: false,
      postTurnSwallowsFailures: false,
      absolutePathHooks: [],
      readDenyCoversSecrets: true,
      bashDenyCoversSecrets: true,
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
      "goat-critique",
      "goat-security",
      "goat-qa",
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
        gitCommitInstructions: {
          exists: false,
          path: null,
          requiredPath: ".github/git-commit-instructions.md",
          misplacedPaths: [],
        },
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

function makeProjectFacts(
  root: string,
  agents: AgentFacts[] = [],
): ProjectFacts {
  const baseFacts = makeCtx().facts;
  return {
    ...baseFacts,
    root,
    agents,
  };
}

async function writeProjectFile(
  root: string,
  relativePath: string,
  content = "",
): Promise<void> {
  const fullPath = join(root, relativePath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content);
}

async function makeTempProject(
  init: (root: string) => Promise<void>,
): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "goat-flow-setup-tests-"));
  try {
    await init(root);
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }

  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

function makeAuditScope(
  status: "pass" | "fail",
  checks: AuditReport["scopes"]["setup"]["checks"],
): AuditReport["scopes"]["setup"] {
  return {
    status,
    checks,
    failures: checks
      .filter((check) => check.status === "fail" && check.failure)
      .map((check) => check.failure!),
    summary: {},
  };
}

function makeAuditReport(
  root: string,
  status: "pass" | "fail",
  setupChecks: AuditReport["scopes"]["setup"]["checks"] = [],
  agentChecks: AuditReport["scopes"]["agent"]["checks"] = [],
): AuditReport {
  return {
    command: "audit",
    harness: false,
    status,
    target: root,
    scopes: {
      setup: makeAuditScope(
        setupChecks.some((check) => check.status === "fail") ? "fail" : "pass",
        setupChecks,
      ),
      agent: makeAuditScope(
        agentChecks.some((check) => check.status === "fail") ? "fail" : "pass",
        agentChecks,
      ),
      harness: null,
    },
    concerns: null,
    drift: null,
    content: null,
    overall: { status },
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

  it("audits an external project root without throwing on package-root provenance paths", async () => {
    const project = await makeTempProject(async () => {});
    try {
      const fs = createFS(project.root);
      const report = runAudit(fs, project.root, {
        agentFilter: null,
        harness: false,
      });
      assert.equal(report.command, "audit");
      assert.equal(report.target, project.root);
      assert.ok(["pass", "fail"].includes(report.status));
    } finally {
      await project.cleanup();
    }
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

describe("copilot install requires GitHub commit instructions", () => {
  it("agent-instruction provenance follows the selected agent", () => {
    for (const [agent, instructionFile] of [
      ["claude", "CLAUDE.md"],
      ["gemini", "GEMINI.md"],
    ] as const) {
      const report = runAudit(createFS(PROJECT_ROOT), PROJECT_ROOT, {
        agentFilter: agent,
        harness: false,
        checkDrift: false,
      });
      const result = report.scopes.agent.checks.find(
        (check) => check.id === "agent-instruction",
      )!;
      assert.ok(result.provenance.evidence_paths?.includes(instructionFile));
      assert.ok(
        !result.provenance.evidence_paths?.includes(
          "workflow/setup/agents/copilot.md",
        ),
      );
      assert.ok(
        !result.provenance.evidence_paths?.includes(
          ".github/git-commit-instructions.md",
        ),
      );
    }
  });

  it("agent-instruction provenance keeps Copilot bridge evidence for Copilot", () => {
    const report = runAudit(createFS(PROJECT_ROOT), PROJECT_ROOT, {
      agentFilter: "copilot",
      harness: false,
      checkDrift: false,
    });
    const result = report.scopes.agent.checks.find(
      (check) => check.id === "agent-instruction",
    )!;
    assert.ok(
      result.provenance.evidence_paths?.includes(
        "workflow/setup/agents/copilot.md",
      ),
    );
    assert.ok(
      result.provenance.evidence_paths?.includes(
        ".github/copilot-instructions.md",
      ),
    );
    assert.ok(
      result.provenance.evidence_paths?.includes(
        ".github/git-commit-instructions.md",
      ),
    );
  });

  it("agent-instruction fails when .github exists without .github/git-commit-instructions.md", () => {
    const check = BUILD_CHECKS.find((c) => c.id === "agent-instruction")!;
    const result = check.run(
      makeCtx({
        agentFilter: "copilot",
        agents: [stubAgentFacts({ agent: PROFILES.copilot })],
        fs: stubFS({
          exists: (path: string) =>
            path !== ".github/git-commit-instructions.md",
        }),
      }),
    );

    assert.notEqual(result, null);
    assert.equal(result!.check, "Agent instruction file");
    assert.equal(result!.evidence, ".github/git-commit-instructions.md");
    assert.match(result!.message, /required when \.github\/ exists/);
  });

  it("agent-instruction does not require the bridge when .github is absent", () => {
    const check = BUILD_CHECKS.find((c) => c.id === "agent-instruction")!;
    const result = check.run(
      makeCtx({
        agentFilter: "copilot",
        agents: [stubAgentFacts({ agent: PROFILES.copilot })],
        fs: stubFS({
          exists: (path: string) =>
            path !== ".github" && path !== ".github/git-commit-instructions.md",
        }),
      }),
    );

    assert.equal(result, null);
  });

  it("aggregate agent-instruction fails for an incomplete Copilot install", () => {
    const check = BUILD_CHECKS.find((c) => c.id === "agent-instruction")!;
    const result = check.run(
      makeCtx({
        agentFilter: null,
        agents: [stubAgentFacts({ agent: PROFILES.copilot })],
        structure: {
          ...STUB_STRUCTURE,
          agents: {
            copilot: {
              instruction_file: ".github/copilot-instructions.md",
            },
          },
        },
        fs: stubFS({
          exists: (path: string) =>
            path !== ".github/git-commit-instructions.md",
        }),
      }),
    );

    assert.notEqual(result, null);
    assert.equal(result!.evidence, ".github/git-commit-instructions.md");
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
      hookConfigFile: ".codex/hooks.json",
      skillsDir: ".agents/skills",
      hooksDir: ".codex/hooks",
      denyMechanism: {
        type: "deny-script",
        path: ".codex/hooks/deny-dangerous.sh",
      },
      denyHookFile: ".codex/hooks/deny-dangerous.sh",
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

describe("config validation failures", () => {
  it("fails config-parses when config.yaml has schema validation errors", () => {
    const check = BUILD_CHECKS.find((c) => c.id === "config-parses")!;
    const ctx = makeCtx({
      config: {
        ...stubConfig({ agents: ["cursor"] }),
        valid: false,
        errors: [
          {
            level: "error",
            path: "agents[0]",
            message:
              'unknown agent "cursor" - known agents: claude, codex, gemini',
          },
        ],
      },
    });
    const result = check.run(ctx);
    assert.notEqual(
      result,
      null,
      "config-parses should fail on invalid config",
    );
    assert.match(result!.message, /Validation error: agents\[0\]/);
    assert.equal(result!.evidence, ".goat-flow/config.yaml");
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
      "missing scratchpad/README.md should be flagged - it signals local-by-design intent",
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

describe("recovery harness milestone tracking", () => {
  function taskCtx(files: Record<string, string>): AuditContext {
    const dirs = new Map<string, Set<string>>();
    dirs.set(".goat-flow/tasks", new Set());
    for (const file of Object.keys(files)) {
      const parts = file.split("/");
      for (let i = 1; i < parts.length; i++) {
        const parent = parts.slice(0, i).join("/");
        const child = parts[i];
        if (child === undefined) continue;
        if (!dirs.has(parent)) dirs.set(parent, new Set());
        dirs.get(parent)!.add(child);
      }
    }
    return makeCtx({
      fs: stubFS({
        exists: (path) => path === ".goat-flow/tasks" || path in files,
        listDir: (path) => [...(dirs.get(path) ?? new Set<string>())],
        readFile: (path) => files[path] ?? null,
      }),
    });
  }

  const check = HARNESS_CHECKS.find((c) => c.id === "milestone-tracking")!;

  it("passes with an empty tasks directory", () => {
    const result = check.run(taskCtx({}));
    assert.equal(result.status, "pass");
    assert.ok(result.findings.some((f) => f.includes("empty")));
  });

  it("reports archived complete milestone progress as healthy", () => {
    const result = check.run(
      taskCtx({
        ".goat-flow/tasks/_archived/M01-done.md":
          "**Status:** complete\n\n## Tasks\n- [x] One\n- [x] Two\n",
      }),
    );
    assert.equal(result.status, "pass");
    assert.ok(result.findings.some((f) => f.includes("2/2 checkboxes")));
  });

  it("reports active zero-percent milestones as informational local state", () => {
    const result = check.run(
      taskCtx({
        ".goat-flow/tasks/1.3.0/M00-active.md":
          "**Status:** in-progress\n\n## Tasks\n- [ ] One\n- [ ] Two\n",
      }),
    );
    assert.equal(result.status, "pass");
    assert.ok(result.findings.some((f) => f.includes("0/2 checkboxes")));
    assert.ok(result.findings.some((f) => f.includes("at 0%")));
    assert.ok(result.findings.some((f) => f.includes("informational only")));
  });

  it("reports active partial milestone progress", () => {
    const result = check.run(
      taskCtx({
        ".goat-flow/tasks/1.3.0/M01-partial.md":
          "**Status:** in-progress\n\n## Tasks\n- [x] One\n- [ ] Two\n",
      }),
    );
    assert.equal(result.status, "pass");
    assert.ok(result.findings.some((f) => f.includes("1/2 checkboxes")));
  });

  it("keeps planned-but-not-started milestones intentional", () => {
    const result = check.run(
      taskCtx({
        ".goat-flow/tasks/1.3.0/M02-planned.md":
          "**Status:** planned\n\n## Tasks\n- [ ] One\n- [ ] Two\n",
      }),
    );
    assert.equal(result.status, "pass");
    assert.ok(result.findings.some((f) => f.includes("at 0%")));
    assert.ok(result.findings.some((f) => f.includes("informational only")));
  });

  it("does not fail complete milestones with skipped local checkboxes", () => {
    const result = check.run(
      taskCtx({
        ".goat-flow/tasks/1.3.0/M03-complete.md":
          "**Status:** complete\n\n## Tasks\n- [x] One\n- [ ] Two\n",
      }),
    );
    assert.equal(result.status, "pass");
    assert.ok(result.findings.some((f) => f.includes("1/2 checkboxes")));
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

  it("feedback-loop-active remediation uses the public stats command", () => {
    const check = HARNESS_CHECKS.find((c) => c.id === "feedback-loop-active")!;
    const baseFacts = makeCtx().facts;
    const ctx = makeCtx({
      facts: {
        ...baseFacts,
        shared: {
          ...baseFacts.shared,
          footguns: {
            ...baseFacts.shared.footguns,
            staleRefs: [".goat-flow/footguns/hooks.md (search: `missing`)"],
          },
        },
      },
    });
    const result = check.run(ctx);
    assert.equal(result.status, "fail");
    assert.ok(
      result.howToFix?.some((fix) =>
        fix.includes("npx goat-flow stats . --check"),
      ),
      `howToFix should use public CLI: ${result.howToFix?.join(", ") ?? ""}`,
    );
    assert.ok(
      !result.howToFix?.some((fix) =>
        fix.includes("node --import tsx src/cli/cli.ts stats"),
      ),
      `howToFix should not use source-mode CLI: ${result.howToFix?.join(", ") ?? ""}`,
    );
  });
});

describe("agent deny hook template comparison", () => {
  const denyCheck = AGENT_CHECKS.find(
    (check) => check.id === "agent-deny-dangerous",
  );

  it("fails when an installed deny hook differs from the canonical template", () => {
    assert.ok(denyCheck, "agent deny check should exist");
    const template = readFileSync(
      resolve(PROJECT_ROOT, "workflow/hooks/deny-dangerous.sh"),
      "utf-8",
    );
    const ctx = makeCtx({
      agentFilter: "claude",
      projectPath: PROJECT_ROOT,
      fs: stubFS({
        readFile: (path) =>
          path === ".claude/hooks/deny-dangerous.sh"
            ? `${template}\n# local drift\n`
            : null,
      }),
    });
    const result = denyCheck.run(ctx);
    assert.ok(result, "expected hook version drift failure");
    assert.match(result.message, /differs from the current goat-flow template/);
    assert.equal(result.evidence, ".claude/hooks/deny-dangerous.sh");
  });

  it("passes when the installed deny hook matches the canonical template", () => {
    assert.ok(denyCheck, "agent deny check should exist");
    const template = readFileSync(
      resolve(PROJECT_ROOT, "workflow/hooks/deny-dangerous.sh"),
      "utf-8",
    );
    const ctx = makeCtx({
      agentFilter: "claude",
      projectPath: PROJECT_ROOT,
      fs: stubFS({
        readFile: (path) =>
          path === ".claude/hooks/deny-dangerous.sh" ? template : null,
      }),
    });
    assert.equal(denyCheck.run(ctx), null);
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

describe("hook fact extraction", () => {
  it("detects current deny hook secret coverage from generalized path matcher", () => {
    const template = readFileSync(
      resolve(PROJECT_ROOT, "workflow/hooks/deny-dangerous.sh"),
      "utf8",
    );
    const facts = extractHookFactsForDenyContent(template);
    assert.equal(facts.bashDenyCoversSecrets, true);
  });

  it("does not count self-test-only secret probes as Bash secret coverage", () => {
    const facts = extractHookFactsForDenyContent(`
run_self_test() {
  run_case "cat .env" "cat .env" 2
  run_case "cat ./.env" "cat ./.env" 2
  run_case "cat ../.env" "cat ../.env" 2
  run_case "cat .env.example" "cat .env.example" 0
  run_case "cat ssh key" "cat ~/.ssh/id_rsa" 2
  run_case "cat relative ssh key" "cat .ssh/id_rsa" 2
  run_case "cat aws credentials" "cat ~/.aws/credentials" 2
  run_case "cat relative aws credentials" "cat .aws/credentials" 2
  run_case "cat secrets token" "cat secrets/token.txt" 2
  run_case "cat credentials.json" "cat credentials.json" 2
  run_case "xxd pem" "xxd server.pem" 2
}
`);
    assert.equal(facts.bashDenyCoversSecrets, false);
  });
});

describe("M01 scoring model", () => {
  it("unacknowledged advisory fail flips concern.status to fail", () => {
    const hooks = {
      ...stubAgentFacts().hooks,
      denyBlocksPipeToShell: false,
    } satisfies AgentFacts["hooks"];
    const ctx = makeCtx({ agents: [stubAgentFacts({ hooks })] });
    const { concerns } = computeHarness(ctx);
    // deny-blocks-pipe-to-shell is advisory + constraints concern.
    assert.equal(concerns.constraints.status, "fail");
    assert.equal(concerns.constraints.advisoryFail, 1);
    assert.equal(concerns.constraints.advisoryAcknowledged, 0);
  });

  it("acknowledged advisory fail does NOT flip the owning concern's status", () => {
    const hooks = {
      ...stubAgentFacts().hooks,
      denyBlocksPipeToShell: false,
    } satisfies AgentFacts["hooks"];
    const ctx = makeCtx({
      config: stubConfig({
        harness: { acknowledge: ["deny-blocks-pipe-to-shell"] },
      }),
      agents: [stubAgentFacts({ hooks })],
    });
    const { concerns } = computeHarness(ctx);
    assert.equal(concerns.constraints.status, "pass");
    assert.equal(concerns.constraints.advisoryFail, 0);
    assert.equal(concerns.constraints.advisoryAcknowledged, 1);
  });

  it("acknowledged advisory does not add to scope.failures", () => {
    const hooks = {
      ...stubAgentFacts().hooks,
      denyBlocksPipeToShell: false,
    } satisfies AgentFacts["hooks"];
    const ctx = makeCtx({
      config: stubConfig({
        harness: { acknowledge: ["deny-blocks-pipe-to-shell"] },
      }),
      agents: [stubAgentFacts({ hooks })],
    });
    const { scope } = computeHarness(ctx);
    assert.ok(
      !scope.failures.some((f) =>
        f.check.toLowerCase().includes("pipe-to-shell"),
      ),
      `Acknowledged advisory should not appear in scope.failures: ${JSON.stringify(scope.failures)}`,
    );
  });

  it("acknowledge silences exactly the listed id, not other advisories", () => {
    // Craft a scenario where two advisory checks fail and acknowledge only one.
    const hooks = {
      ...stubAgentFacts().hooks,
      denyBlocksPipeToShell: false,
    } satisfies AgentFacts["hooks"];
    const ctx = makeCtx({
      config: stubConfig({
        harness: { acknowledge: ["deny-blocks-pipe-to-shell"] },
        instruction_file_line_target: 40,
        instruction_file_line_limit: 45,
      }),
      agents: [stubAgentFacts({ hooks })],
    });
    const { concerns } = computeHarness(ctx);
    // constraints fail is acknowledged → pass. instruction-line-count (advisory
    // under context) will also fail because the stub instruction file is 50
    // lines vs a 45-line limit - NOT acknowledged → context.status fail.
    assert.equal(concerns.constraints.status, "pass");
    assert.equal(concerns.constraints.advisoryAcknowledged, 1);
    assert.equal(concerns.context.status, "fail");
    assert.ok(concerns.context.advisoryFail >= 1);
  });

  it("deny-covers-secrets fails when settings Read deny is present but Bash hook lacks secret-path coverage", () => {
    // Models the M17-1 gap: settings.json has Read(**/.env*) etc., but the Bash
    // deny hook still allows `cat .env` / `source .env`. The harness must fail
    // on this even though the old check classified the agent as "covered".
    const hooks = {
      ...stubAgentFacts().hooks,
      readDenyCoversSecrets: true,
      bashDenyCoversSecrets: false,
    } satisfies AgentFacts["hooks"];
    const ctx = makeCtx({ agents: [stubAgentFacts({ hooks })] });
    const { scope } = computeHarness(ctx);
    const secrets = scope.checks.find((c) => c.id === "deny-covers-secrets");
    assert.ok(secrets, "deny-covers-secrets check should be present");
    assert.equal(
      secrets.status,
      "fail",
      "deny-covers-secrets must fail when Bash hook has no secret-path coverage",
    );
  });

  it("deny-covers-secrets passes when both settings Read deny and Bash hook cover secrets", () => {
    const hooks = {
      ...stubAgentFacts().hooks,
      readDenyCoversSecrets: true,
      bashDenyCoversSecrets: true,
    } satisfies AgentFacts["hooks"];
    const ctx = makeCtx({ agents: [stubAgentFacts({ hooks })] });
    const { scope } = computeHarness(ctx);
    const secrets = scope.checks.find((c) => c.id === "deny-covers-secrets");
    assert.equal(secrets?.status, "pass");
  });

  it("metric checks never flip concern.status (always pass) and are counted", () => {
    const ctx = makeCtx();
    const { concerns } = computeHarness(ctx);
    // verification concern contains both metric checks (test-runner-configured,
    // post-turn-hook-integrity). They never fail in the current implementation.
    assert.equal(concerns.verification.metrics, 2);
  });

  it("CheckResult carries type, acknowledged, and provenance fields", () => {
    const hooks = {
      ...stubAgentFacts().hooks,
      denyBlocksPipeToShell: false,
    } satisfies AgentFacts["hooks"];
    const ctx = makeCtx({
      config: stubConfig({
        harness: { acknowledge: ["deny-blocks-pipe-to-shell"] },
      }),
      agents: [stubAgentFacts({ hooks })],
    });
    const { scope } = computeHarness(ctx);
    const advisory = scope.checks.find(
      (c) => c.id === "deny-blocks-pipe-to-shell",
    )!;
    assert.equal(advisory.type, "advisory");
    assert.equal(advisory.acknowledged, true);
    assert.equal(advisory.provenance.normative_level, "SHOULD");
    const docs = scope.checks.find((c) => c.id === "doc-paths-resolve")!;
    assert.equal(docs.type, "integrity");
    assert.equal(docs.acknowledged, undefined);
    assert.equal(docs.provenance.normative_level, "MUST");
  });

  it("advisory failure emits WHY-not-integrity evidence with the check id", () => {
    const hooks = {
      ...stubAgentFacts().hooks,
      denyBlocksPipeToShell: false,
    } satisfies AgentFacts["hooks"];
    const ctx = makeCtx({ agents: [stubAgentFacts({ hooks })] });
    const { scope } = computeHarness(ctx);
    const advisory = scope.checks.find(
      (c) => c.id === "deny-blocks-pipe-to-shell",
    )!;
    assert.ok(advisory.failure, "advisory failure should have a failure obj");
    assert.ok(
      advisory.failure!.evidence?.includes("Advisory"),
      `evidence should explain advisory framing: ${advisory.failure!.evidence}`,
    );
    assert.ok(
      advisory.failure!.evidence?.includes("deny-blocks-pipe-to-shell"),
      `evidence should reference the check id: ${advisory.failure!.evidence}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Setup prompt routing - verify composeSetup follows project state + audit
// ---------------------------------------------------------------------------
describe("composeSetup routing", () => {
  it("renders audit-pass maintenance guidance for a healthy current codex project", async () => {
    const project = await makeTempProject(async (root) => {
      await writeProjectFile(
        root,
        ".goat-flow/config.yaml",
        `version: "${AUDIT_VERSION}"\n`,
      );
      await writeProjectFile(
        root,
        ".goat-flow/skill-reference/skill-preamble.md",
        "# Preamble\n",
      );
      await writeProjectFile(
        root,
        ".goat-flow/skill-reference/skill-conventions.md",
        "# Conventions\n",
      );
      await writeProjectFile(root, "AGENTS.md", "# Codex\n");
      for (const skill of SKILL_NAMES) {
        await writeProjectFile(root, `.agents/skills/${skill}/SKILL.md`, "#\n");
      }
    });

    try {
      const facts = makeProjectFacts(project.root, [
        stubAgentFacts({
          agent: PROFILES.codex,
          skills: {
            ...stubAgentFacts().skills,
            found: [...SKILL_NAMES],
          },
          hooks: {
            ...stubAgentFacts().hooks,
            denyExists: true,
            postTurnExists: true,
          },
        }),
      ]);

      const output = composeSetup(
        makeAuditReport(project.root, "pass"),
        facts,
        "codex",
      );

      assert.ok(output, "composeSetup should return setup text");
      assert.match(output, /# GOAT Flow Setup - Codex/);
      assert.match(output, /All audit checks pass\./);
      assert.match(output, /7\/7 skills installed \(in \.agents\/skills\/\)/);
      assert.match(
        output,
        /2 hook scripts \(deny, post-turn\) in \.codex\/hooks\//,
      );
      assert.match(output, /Run `goat-flow audit .+ --harness`/);
      assert.ok(
        !output.includes("scanner"),
        `audit-pass output should not regress to scanner wording: ${output}`,
      );
    } finally {
      await project.cleanup();
    }
  });

  it("renders failed checks with howToFix text and setup-step references", async () => {
    const project = await makeTempProject(async (root) => {
      await writeProjectFile(
        root,
        ".goat-flow/config.yaml",
        `version: "${AUDIT_VERSION}"\n`,
      );
      await writeProjectFile(
        root,
        ".goat-flow/skill-reference/skill-preamble.md",
        "# Preamble\n",
      );
      await writeProjectFile(
        root,
        ".goat-flow/skill-reference/skill-conventions.md",
        "# Conventions\n",
      );
      await writeProjectFile(root, "AGENTS.md", "# Codex\n");
      for (const skill of SKILL_NAMES) {
        await writeProjectFile(root, `.agents/skills/${skill}/SKILL.md`, "#\n");
      }
    });

    try {
      const output = composeSetup(
        makeAuditReport(
          project.root,
          "fail",
          [
            {
              id: "config-version",
              name: "Config version",
              status: "fail",
              failure: {
                check: "Config version",
                message: "Config version mismatch",
                evidence: '.goat-flow/config.yaml says "1.0.0"',
                howToFix: `Set version to "${AUDIT_VERSION}"`,
              },
            },
          ],
          [
            {
              id: "agent-skills",
              name: "Agent skills",
              status: "fail",
              failure: {
                check: "Agent skills",
                message: "Missing goat-review",
              },
            },
          ],
        ),
        makeProjectFacts(project.root, [
          stubAgentFacts({ agent: PROFILES.codex }),
        ]),
        "codex",
      );

      assert.ok(output, "composeSetup should return failure guidance");
      assert.match(output, /2 audit checks failed:/);
      assert.ok(
        output.includes(
          `Fix: Set version to "${AUDIT_VERSION}" (see Step 05 (config version field))`,
        ),
        output,
      );
      assert.match(
        output,
        /Evidence: \.goat-flow\/config\.yaml says "1\.0\.0"/,
      );
      assert.match(output, /See Step 03 \(install skills\)/);
      assert.match(
        output,
        /Re-run: `node .*dist\/cli\/cli\.js audit .+ --agent codex`/,
      );
    } finally {
      await project.cleanup();
    }
  });

  it("falls back to the full setup guide for partial installs", async () => {
    const project = await makeTempProject(async (root) => {
      await writeProjectFile(root, "AGENTS.md", "# Codex\n");
    });

    try {
      const output = composeSetup(
        makeAuditReport(project.root, "fail"),
        makeProjectFacts(project.root, [
          stubAgentFacts({ agent: PROFILES.codex }),
        ]),
        "codex",
      );

      assert.ok(output, "composeSetup should return setup guidance");
      assert.match(
        output,
        /This project has setup issues - it needs a full setup pass\./,
      );
      assert.match(
        output,
        /Do NOT copy customization templates \(architecture, footguns, code-map\) verbatim\./,
      );
      assert.match(output, /## Step 1 - Install files/);
      assert.match(output, /## Step 2 - Create project-specific content/);
      assert.match(output, /## Step 3 - Verify/);
      assert.match(output, /workflow\/setup\/agents\/codex\.md/);
    } finally {
      await project.cleanup();
    }
  });

  it("uses the current numbered setup flow for outdated installs", async () => {
    const project = await makeTempProject(async (root) => {
      await writeProjectFile(
        root,
        ".goat-flow/config.yaml",
        'version: "1.1.0"\n',
      );
      await writeProjectFile(root, "AGENTS.md", "# Codex\n");
      await writeProjectFile(
        root,
        ".goat-flow/skill-reference/skill-preamble.md",
        "# Preamble\n",
      );
      await writeProjectFile(
        root,
        ".goat-flow/skill-reference/skill-conventions.md",
        "# Conventions\n",
      );
      for (const skill of SKILL_NAMES) {
        await writeProjectFile(root, `.agents/skills/${skill}/SKILL.md`, "#\n");
      }
    });

    try {
      const retiredOutdatedGuide = "upgrade-from-1" + ".0.x.md";
      const output = composeSetup(
        makeAuditReport(project.root, "fail"),
        makeProjectFacts(project.root, [
          stubAgentFacts({
            agent: PROFILES.codex,
            skills: { ...stubAgentFacts().skills, found: [...SKILL_NAMES] },
          }),
        ]),
        "codex",
      );

      assert.ok(output, "composeSetup should return upgrade guidance");
      assert.match(output, /# GOAT Flow Upgrade - Codex/);
      assert.match(output, /workflow\/install-goat-flow\.sh/);
      assert.match(output, /workflow\/setup\/02-instruction-file\.md/);
      assert.ok(!output.includes(retiredOutdatedGuide), output);
    } finally {
      await project.cleanup();
    }
  });

  it("uses manual cleanup guidance for v0.9 installs", async () => {
    const project = await makeTempProject(async (root) => {
      await writeProjectFile(root, "AGENTS.md", "# Codex\n");
      await writeProjectFile(root, ".agents/skills/goat-audit/SKILL.md", "#\n");
    });

    try {
      const retiredMigrationScript = "install-migrate-to-1" + ".1.sh";
      const retiredLegacyGuide = "upgrade-from-0" + ".9.x.md";
      const output = composeSetup(
        makeAuditReport(project.root, "fail"),
        makeProjectFacts(project.root, [
          stubAgentFacts({ agent: PROFILES.codex }),
        ]),
        "codex",
      );

      assert.ok(output, "composeSetup should return migration guidance");
      assert.match(output, /# GOAT Flow Migration - Codex/);
      assert.match(output, /workflow\/install-goat-flow\.sh/);
      assert.match(output, /Remove legacy surfaces manually/);
      assert.match(output, /workflow\/setup\/02-instruction-file\.md/);
      assert.ok(!output.includes(retiredMigrationScript), output);
      assert.ok(!output.includes(retiredLegacyGuide), output);
    } finally {
      await project.cleanup();
    }
  });
});
