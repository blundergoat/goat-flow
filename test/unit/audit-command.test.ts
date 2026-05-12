/**
 * Audit command tests - build checks, quality concerns, JSON contract.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  runAudit,
  computeHarness,
  runAuditBatch,
  createAuditFactsView,
} from "../../src/cli/audit/audit.js";
import { SETUP_CHECKS } from "../../src/cli/audit/check-goat-flow.js";
import { AGENT_CHECKS } from "../../src/cli/audit/check-agent-setup.js";
import { HARNESS_CHECKS } from "../../src/cli/audit/harness/index.js";
import { extractBacktickPaths } from "../../src/cli/audit/harness/helpers.js";
import { AUDIT_VERSION, SKILL_NAMES } from "../../src/cli/constants.js";
import { PROFILES } from "../../src/cli/detect/agents.js";
import { composeSetup } from "../../src/cli/prompt/compose-setup.js";
import { extractProjectFacts } from "../../src/cli/facts/orchestrator.js";
import { extractHookFacts } from "../../src/cli/facts/agent/hooks.js";
import { extractSettingsFacts } from "../../src/cli/facts/agent/settings.js";

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

/**
 * Production code calls FS helpers with `path.join` results, which on Windows
 * use backslashes. Test handlers compare against POSIX-shape literals. Wrap
 * every incoming path with a forward-slash normaliser so handlers can match
 * on the documented separator-agnostic shape regardless of host.
 */
function posixifyPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function wrapPathArg<T>(fn: ((path: string) => T) | undefined, fallback: T) {
  return (path: string): T => (fn ? fn(posixifyPath(path)) : fallback);
}

function stubFS(overrides: Partial<ReadonlyFS> = {}): ReadonlyFS {
  const fs: ReadonlyFS = {
    exists: wrapPathArg(overrides.exists, true),
    readFile: wrapPathArg(overrides.readFile, null),
    lineCount: wrapPathArg(overrides.lineCount, 0),
    readJson: wrapPathArg(overrides.readJson, null),
    listDir: wrapPathArg(overrides.listDir, [] as string[]),
    isExecutable: wrapPathArg(overrides.isExecutable, false),
    glob: overrides.glob ?? ((): string[] => []),
    existsGlob:
      overrides.existsGlob ??
      ((pattern: string) =>
        (overrides.glob ?? ((): string[] => []))(pattern).length > 0),
  };
  return fs;
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
      lineLimits: { target: 125, limit: 150 },
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
          buckets: [],
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
          invalidLineRefs: [],
          duplicateSurfacePaths: [],
          buckets: [],
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
          lineLimits: { target: 125, limit: 150 },
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

async function writeAuditSetupFixture(
  root: string,
  options: {
    skillReferenceDir: boolean;
    skillReferenceReadme?: boolean;
    instructionPointer: boolean;
  },
): Promise<void> {
  const manifest = JSON.parse(
    readFileSync(join(PROJECT_ROOT, "workflow/manifest.json"), "utf-8"),
  ) as { required_files: string[]; required_dirs: string[] };

  for (const dir of manifest.required_dirs) {
    if (
      !options.skillReferenceDir &&
      (dir.startsWith(".goat-flow/skill-reference/") ||
        dir.startsWith(".goat-flow/skill-playbooks/") ||
        dir === ".goat-flow/skill-reference/" ||
        dir === ".goat-flow/skill-playbooks/")
    ) {
      continue;
    }
    await mkdir(join(root, dir), { recursive: true });
  }

  for (const file of manifest.required_files) {
    if (
      !options.skillReferenceDir &&
      (file.startsWith(".goat-flow/skill-reference/") ||
        file.startsWith(".goat-flow/skill-playbooks/"))
    ) {
      continue;
    }
    if (
      options.skillReferenceReadme === false &&
      file === ".goat-flow/skill-reference/README.md"
    ) {
      continue;
    }
    const content =
      file === ".goat-flow/config.yaml"
        ? `version: "${AUDIT_VERSION}"\n\nagents:\n  - claude\nskills:\n  install: all\n`
        : file === ".goat-flow/.gitignore"
          ? "*\n!.gitignore\n!skill-reference/\n!skill-reference/**\n!skill-playbooks/\n!skill-playbooks/**\n"
          : "# Stub\n";
    await writeProjectFile(root, file, content);
  }

  const instructionContent = options.instructionPointer
    ? `# CLAUDE.md

## Execution Loop: READ -> SCOPE -> ACT -> VERIFY

### READ
Before declaring any tool or capability unavailable, read the matching playbook in .goat-flow/skill-playbooks/ and run that doc's "Availability Check" section verbatim.

### SCOPE

### ACT

### VERIFY

## Router Table

| Resource | Path |
|----------|------|
| Skill playbooks | .goat-flow/skill-playbooks/ |
`
    : "# CLAUDE.md\n";

  await writeProjectFile(root, "CLAUDE.md", instructionContent);
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
  harnessChecks: AuditReport["scopes"]["setup"]["checks"] = [],
): AuditReport {
  return {
    command: "audit",
    harness: harnessChecks.length > 0,
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
      harness:
        harnessChecks.length > 0
          ? makeAuditScope(
              harnessChecks.some((check) => check.status === "fail")
                ? "fail"
                : "pass",
              harnessChecks,
            )
          : null,
    },
    concerns: null,
    drift: null,
    content: null,
    overall: { status },
  };
}

function createSpanRecorder(): {
  profile: { span<T>(name: string, fn: () => T): T };
  names: string[];
} {
  const names: string[] = [];
  return {
    names,
    profile: {
      span<T>(name: string, fn: () => T): T {
        names.push(name);
        return fn();
      },
    },
  };
}

function countSpan(names: string[], name: string): number {
  return names.filter((entry) => entry === name).length;
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

describe("audit skill-reference pointer rule", () => {
  it("fails when skill-reference exists but CLAUDE.md lacks the required routing", async () => {
    const project = await makeTempProject((root) =>
      writeAuditSetupFixture(root, {
        skillReferenceDir: true,
        instructionPointer: false,
      }),
    );
    try {
      const report = runAudit(createFS(project.root), project.root, {
        agentFilter: null,
        harness: false,
      });
      const check = report.scopes.setup.checks.find(
        (entry) => entry.id === "instruction-file-skill-reference-pointer",
      );

      assert.equal(report.status, "fail");
      assert.equal(check?.status, "fail");
      assert.match(check?.failure?.message ?? "", /CLAUDE\.md/);
      assert.match(check?.failure?.message ?? "", /READ rule/);
      assert.match(check?.failure?.message ?? "", /Router Table pointer/);
      assert.match(check?.failure?.howToFix ?? "", /Before declaring any tool/);
    } finally {
      await project.cleanup();
    }
  });

  it("keeps setup snippets aligned with the audit remediation contract", () => {
    const executionLoop = readFileSync(
      join(PROJECT_ROOT, "workflow/setup/reference/execution-loop.md"),
      "utf-8",
    );
    const instructionStep = readFileSync(
      join(PROJECT_ROOT, "workflow/setup/02-instruction-file.md"),
      "utf-8",
    );

    for (const content of [executionLoop, instructionStep]) {
      assert.match(
        content,
        /Before declaring any tool or capability unavailable/,
      );
      assert.match(content, /\.goat-flow\/skill-playbooks\//);
      assert.match(content, /Availability Check/);
    }
    assert.match(
      instructionStep,
      /Tool playbooks \(CLI\/MCP availability checks: browser-use, page-capture, skill-quality-testing\)/,
    );
    assert.match(
      instructionStep,
      /\.goat-flow\/skill-playbooks\/` - read BEFORE declaring a tool unavailable/,
    );
  });

  it("passes when skill-reference exists and CLAUDE.md contains the READ rule and Router Table pointer", async () => {
    const project = await makeTempProject((root) =>
      writeAuditSetupFixture(root, {
        skillReferenceDir: true,
        instructionPointer: true,
      }),
    );
    try {
      const report = runAudit(createFS(project.root), project.root, {
        agentFilter: null,
        harness: false,
      });
      const check = report.scopes.setup.checks.find(
        (entry) => entry.id === "instruction-file-skill-reference-pointer",
      );

      assert.equal(
        report.status,
        "pass",
        `Expected pass but got: ${JSON.stringify(report.scopes)}`,
      );
      assert.equal(check?.status, "pass");
    } finally {
      await project.cleanup();
    }
  });

  it("skips when the project has no skill-reference directory", async () => {
    const project = await makeTempProject((root) =>
      writeAuditSetupFixture(root, {
        skillReferenceDir: false,
        instructionPointer: false,
      }),
    );
    try {
      const report = runAudit(createFS(project.root), project.root, {
        agentFilter: null,
        harness: false,
      });
      const check = report.scopes.setup.checks.find(
        (entry) => entry.id === "instruction-file-skill-reference-pointer",
      );

      assert.equal(
        report.status,
        "pass",
        `Expected pass but got: ${JSON.stringify(report.scopes)}`,
      );
      assert.equal(check?.status, "skipped");
    } finally {
      await project.cleanup();
    }
  });

  it("fails when the skill-reference directory exists without README.md", async () => {
    const project = await makeTempProject((root) =>
      writeAuditSetupFixture(root, {
        skillReferenceDir: true,
        skillReferenceReadme: false,
        instructionPointer: true,
      }),
    );
    try {
      const report = runAudit(createFS(project.root), project.root, {
        agentFilter: null,
        harness: false,
      });
      const check = report.scopes.setup.checks.find(
        (entry) => entry.id === "instruction-file-skill-reference-pointer",
      );

      assert.equal(report.status, "fail");
      assert.equal(check?.status, "fail");
      assert.match(
        check?.failure?.message ?? "",
        /Shared reference\/playbook pack/,
      );
      assert.match(check?.failure?.message ?? "", /README\.md/);
      assert.equal(
        check?.failure?.evidence,
        ".goat-flow/skill-reference/README.md",
      );
    } finally {
      await project.cleanup();
    }
  });
});

describe("M03 batch fact reuse", () => {
  it("creates isolated aggregate and per-agent fact views from one source bundle", () => {
    const sourceFacts = makeProjectFacts(PROJECT_ROOT, [
      stubAgentFacts(),
      stubAgentFacts({ agent: PROFILES.codex }),
    ]);
    sourceFacts.shared.footguns.dirMentions.set("stable", 1);

    const aggregateView = createAuditFactsView(sourceFacts);
    const claudeView = createAuditFactsView(sourceFacts, { agentId: "claude" });
    const codexView = createAuditFactsView(sourceFacts, { agentId: "codex" });

    assert.deepEqual(
      claudeView.agents.map((agentFacts) => agentFacts.agent.id),
      ["claude"],
      "Claude view should contain only Claude facts",
    );
    assert.deepEqual(
      codexView.agents.map((agentFacts) => agentFacts.agent.id),
      ["codex"],
      "Codex view should contain only Codex facts",
    );

    claudeView.shared.footguns.dirMentions.set("mutated", 99);
    claudeView.shared.footguns.staleRefs.push("mutated-ref.md");
    claudeView.stack.languages.push("MutatedLang");
    claudeView.agents[0]?.skills.found.push("mutated-skill");

    assert.equal(
      sourceFacts.shared.footguns.dirMentions.has("mutated"),
      false,
      "Per-agent mutation should not affect source facts",
    );
    assert.equal(
      aggregateView.shared.footguns.dirMentions.has("mutated"),
      false,
      "Per-agent mutation should not affect aggregate facts",
    );
    assert.equal(
      codexView.shared.footguns.dirMentions.has("mutated"),
      false,
      "Per-agent mutation should not affect sibling facts",
    );
    assert.equal(
      aggregateView.shared.footguns.staleRefs.includes("mutated-ref.md"),
      false,
    );
    assert.equal(aggregateView.stack.languages.includes("MutatedLang"), false);
    assert.equal(
      codexView.agents[0]?.skills.found.includes("mutated-skill"),
      false,
    );
  });

  it("runs full-profile batch fact extraction once for aggregate plus per-agent audits", () => {
    const { profile, names } = createSpanRecorder();
    const batch = runAuditBatch(
      createFS(PROJECT_ROOT),
      PROJECT_ROOT,
      {
        agentFilter: null,
        harness: true,
        denyMechanismEvidenceLevel: "present-only",
        profile,
      },
      ["claude", "codex", "copilot"],
    );

    assert.equal(countSpan(names, "aggregate facts"), 1);
    assert.equal(countSpan(names, "detectStack"), 1);
    assert.equal(countSpan(names, "per-agent facts"), 0);
    assert.deepEqual(
      batch.perAgent.map((entry) => entry.id),
      ["claude", "codex", "copilot"],
    );
    for (const entry of batch.perAgent) {
      assert.equal(entry.audit.scopes.agent.checks.length > 0, true);
      assert.equal(entry.audit.target, PROJECT_ROOT);
    }
  });

  it("deduplicates configured agents before extracting facts", () => {
    const facts = extractProjectFacts(createFS(PROJECT_ROOT), {
      agentFilter: null,
      projectPath: PROJECT_ROOT,
      configState: stubConfig({
        agents: ["claude", "claude", "codex", "codex"],
      }),
    });

    assert.deepEqual(
      facts.agents.map((agentFacts) => agentFacts.agent.id),
      ["claude", "codex"],
    );
  });

  it("runs dashboard-summary batch audits without stack detection or stack access", () => {
    const { profile, names } = createSpanRecorder();
    const batch = runAuditBatch(
      createFS(PROJECT_ROOT),
      PROJECT_ROOT,
      {
        agentFilter: null,
        harness: true,
        denyMechanismEvidenceLevel: "present-only",
        factProfile: "dashboard-summary",
        profile,
      },
      ["claude", "codex", "copilot"],
    );

    assert.equal(countSpan(names, "aggregate facts"), 1);
    assert.equal(countSpan(names, "detectStack"), 0);
    assert.equal(batch.aggregate.target, PROJECT_ROOT);
    assert.deepEqual(
      batch.perAgent.map((entry) => entry.id),
      ["claude", "codex", "copilot"],
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
        result.provenance.framework_evidence_paths?.includes(
          "workflow/manifest.json",
        ),
      );
      assert.ok(
        result.provenance.target_evidence_paths?.includes(instructionFile),
      );
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
              skills_dir: ".github/skills",
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
// Test 2b: Phantom agent detection (M09 Bug 4)
// ---------------------------------------------------------------------------
describe("orphaned artifact detection refinement", () => {
  it("does not flag bare .claude/ dir as orphaned when no goat-flow skills are installed", () => {
    // To reach checkOrphanedArtifacts, earlier checks must pass:
    // - checkAnyAgentConfigured needs agents.length > 0
    // - checkConfiguredInstructionFilesPresent needs all agents to have instruction files
    // So we provide a codex agent with instruction present, and put claude only
    // in structure.agents with CLAUDE.md missing and bare .claude/ artifacts.
    const check = BUILD_CHECKS.find((c) => c.id === "agent-instruction")!;
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
    const result = check.run(
      makeCtx({
        agentFilter: null,
        agents: [stubAgentFacts({ agent: codexProfile })],
        config: stubConfig(),
        structure: {
          ...STUB_STRUCTURE,
          agents: {
            codex: {
              instruction_file: "AGENTS.md",
              skills_dir: ".agents/skills",
              hooks_dir: ".codex/hooks",
              settings: ".codex/config.toml",
            },
            claude: {
              instruction_file: "CLAUDE.md",
              skills_dir: ".claude/skills",
              hooks_dir: ".claude/hooks",
              settings: ".claude/settings.json",
            },
          },
        },
        fs: stubFS({
          exists: (path: string) => {
            if (path === "AGENTS.md") return true;
            if (path === "CLAUDE.md") return false;
            if (path === ".claude/settings.json") return true;
            if (path === ".claude/hooks") return true;
            if (path === ".claude/hooks/deny-dangerous.sh") return false;
            return true;
          },
          listDir: () => [],
        }),
      }),
    );

    // checkOrphanedArtifacts should reach agentArtifactsExist for claude,
    // find no goat-flow skills or deny hook, and return null for claude.
    // The overall result should be null (no orphaned artifacts).
    assert.equal(
      result,
      null,
      "bare .claude/ with settings.json but no goat-flow skills should not be flagged as orphaned",
    );
  });

  it("flags genuine orphan when goat-flow deny hook exists but instruction file is missing", () => {
    const check = BUILD_CHECKS.find((c) => c.id === "agent-instruction")!;
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
    const result = check.run(
      makeCtx({
        agentFilter: null,
        agents: [stubAgentFacts({ agent: codexProfile })],
        config: stubConfig(),
        structure: {
          ...STUB_STRUCTURE,
          agents: {
            codex: {
              instruction_file: "AGENTS.md",
              skills_dir: ".agents/skills",
              hooks_dir: ".codex/hooks",
              settings: ".codex/config.toml",
            },
            claude: {
              instruction_file: "CLAUDE.md",
              skills_dir: ".claude/skills",
              hooks_dir: ".claude/hooks",
              settings: ".claude/settings.json",
            },
          },
        },
        fs: stubFS({
          exists: (path: string) => {
            if (path === "AGENTS.md") return true;
            if (path === "CLAUDE.md") return false;
            if (path === ".claude/hooks/deny-dangerous.sh") return true;
            return true;
          },
          listDir: () => [],
        }),
      }),
    );

    assert.notEqual(result, null, "should report orphaned artifacts");
    assert.match(result!.message, /artifacts exist/i);
    assert.match(result!.message, /claude/i);
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

describe("codex settings feature flags", () => {
  function codexAgentFacts(
    parsed: Record<string, unknown>,
    hooks = stubAgentFacts().hooks,
  ): AgentFacts {
    return stubAgentFacts({
      agent: PROFILES.codex,
      settings: {
        exists: true,
        valid: true,
        parsed,
        hasDenyPatterns: false,
      },
      hooks: {
        ...hooks,
        denyExists: true,
        denyIsRegistered: true,
        denyRegisteredPath: ".codex/hooks/deny-dangerous.sh",
      },
    });
  }

  it("parses Codex current and deprecated feature flags from TOML", () => {
    const facts = extractSettingsFacts(
      stubFS({
        exists: (path) => path === ".codex/config.toml",
        readFile: (path) =>
          path === ".codex/config.toml"
            ? 'model = "gpt-5"\nfeatures.codex_hooks = true\n[features]\nhooks = true\n'
            : null,
      }),
      PROFILES.codex,
    );

    assert.deepEqual(facts.parsed, {
      model: "gpt-5",
      "features.hooks": true,
      "features.codex_hooks": true,
    });
  });

  it("detects Codex TOML permission profiles that deny secret file families", () => {
    const facts = extractSettingsFacts(
      stubFS({
        exists: (path) => path === ".codex/config.toml",
        readFile: (path) =>
          path === ".codex/config.toml"
            ? [
                'default_permissions = "goat-flow"',
                "[permissions.goat-flow.filesystem]",
                "glob_scan_max_depth = 3",
                '[permissions.goat-flow.filesystem.":project_roots"]',
                '"." = "write"',
                '".env.example" = "read"',
                '".env" = "none"',
                '"**/.env" = "none"',
                '".env.*" = "none"',
                '"**/.env.*" = "none"',
                '".ssh/**" = "none"',
                '"**/.ssh/**" = "none"',
                '".aws/**" = "none"',
                '"**/.aws/**" = "none"',
                '"*.pem" = "none"',
                '"**/*.pem" = "none"',
                '"*.key" = "none"',
                '"**/*.key" = "none"',
                '"*.pfx" = "none"',
                '"**/*.pfx" = "none"',
                '"credentials*" = "none"',
                '"**/credentials*" = "none"',
              ].join("\n")
            : null,
      }),
      PROFILES.codex,
    );

    assert.equal(facts.readDenyCoversSecrets, true);
  });

  it("does not count incomplete Codex key material denies as secret coverage", () => {
    const facts = extractSettingsFacts(
      stubFS({
        exists: (path) => path === ".codex/config.toml",
        readFile: (path) =>
          path === ".codex/config.toml"
            ? [
                "[permissions.goat-flow.filesystem]",
                '[permissions.goat-flow.filesystem.":project_roots"]',
                '".env" = "none"',
                '"**/.env" = "none"',
                '".env.*" = "none"',
                '"**/.env.*" = "none"',
                '".ssh/**" = "none"',
                '"**/.ssh/**" = "none"',
                '".aws/**" = "none"',
                '"**/.aws/**" = "none"',
                '"*.pem" = "none"',
                '"**/*.pem" = "none"',
              ].join("\n")
            : null,
      }),
      PROFILES.codex,
    );

    assert.equal(facts.readDenyCoversSecrets, false);
  });

  it("does not count an inactive Codex permission profile as secret coverage", () => {
    const facts = extractSettingsFacts(
      stubFS({
        exists: (path) => path === ".codex/config.toml",
        readFile: (path) =>
          path === ".codex/config.toml"
            ? [
                'default_permissions = "default"',
                "[permissions.goat-flow.filesystem]",
                '[permissions.goat-flow.filesystem.":project_roots"]',
                '".env" = "none"',
                '"**/.env" = "none"',
                '".env.*" = "none"',
                '"**/.env.*" = "none"',
                '".ssh/**" = "none"',
                '"**/.ssh/**" = "none"',
                '".aws/**" = "none"',
                '"**/.aws/**" = "none"',
                '"*.pem" = "none"',
                '"**/*.pem" = "none"',
                '"*.key" = "none"',
                '"**/*.key" = "none"',
                '"*.pfx" = "none"',
                '"**/*.pfx" = "none"',
                '"credentials*" = "none"',
                '"**/credentials*" = "none"',
              ].join("\n")
            : null,
      }),
      PROFILES.codex,
    );

    assert.equal(facts.readDenyCoversSecrets, false);
  });

  it("fails agent-settings when Codex config still uses codex_hooks", () => {
    const check = BUILD_CHECKS.find((c) => c.id === "agent-settings")!;
    const result = check.run(
      makeCtx({
        agentFilter: "codex",
        agents: [
          codexAgentFacts({
            "features.hooks": true,
            "features.codex_hooks": true,
          }),
        ],
      }),
    );

    assert.notEqual(result, null);
    assert.match(result!.message, /Deprecated Codex feature flag/);
    assert.match(result!.howToFix ?? "", /goat-flow install \. --agent codex/);
  });

  it("fails agent-settings when Codex hooks are installed but hooks are not enabled", () => {
    const check = BUILD_CHECKS.find((c) => c.id === "agent-settings")!;
    const result = check.run(
      makeCtx({
        agentFilter: "codex",
        agents: [codexAgentFacts({ model: "gpt-5" })],
      }),
    );

    assert.notEqual(result, null);
    assert.match(result!.message, /\[features\]\.hooks = true/);
    assert.match(result!.howToFix ?? "", /hooks = true/);
  });

  it("passes agent-settings when Codex hooks are installed and features.hooks is true", () => {
    const check = BUILD_CHECKS.find((c) => c.id === "agent-settings")!;
    const result = check.run(
      makeCtx({
        agentFilter: "codex",
        agents: [codexAgentFacts({ "features.hooks": true })],
      }),
    );

    assert.equal(result, null);
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
// Test 9: project-specific validation commands belong to quality, not audit
// ---------------------------------------------------------------------------
describe("project-specific validation command policy", () => {
  it("does not include test-command proof as a deterministic harness check", () => {
    assert.equal(
      HARNESS_CHECKS.some((c) => c.id === "test-runner-configured"),
      false,
    );
  });
});

describe("recovery harness milestone tracking", () => {
  function taskCtx(
    files: Record<string, string>,
    tasksExists = true,
  ): AuditContext {
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
        exists: (path) =>
          (tasksExists && path === ".goat-flow/tasks") || path in files,
        listDir: (path) => [...(dirs.get(path) ?? new Set<string>())],
        readFile: (path) => files[path] ?? null,
      }),
    });
  }

  const check = HARNESS_CHECKS.find((c) => c.id === "milestone-tracking")!;

  it("fails when the tasks directory is missing", () => {
    const result = check.run(taskCtx({}, false));
    assert.equal(result.status, "fail");
    assert.ok(result.findings.some((f) => f.includes("No tasks directory")));
  });

  it("passes with an empty tasks directory", () => {
    const result = check.run(taskCtx({}));
    assert.equal(result.status, "pass");
    assert.ok(result.findings.some((f) => f.includes("tracking is optional")));
  });

  it("reports optional task files without scoring completion", () => {
    const result = check.run(
      taskCtx({
        ".goat-flow/tasks/1.3.0/M01-demo.md":
          "**Status:** in-progress\n\n## Tasks\n- [x] One\n- [ ] Two\n",
      }),
    );
    assert.equal(result.status, "pass");
    assert.ok(result.findings.some((f) => f.includes("1 markdown file")));
    assert.ok(result.findings.some((f) => f.includes("2 checkbox marker")));
    assert.ok(result.findings.some((f) => f.includes("not audited")));
  });

  it("does not fail active, testing-gate, or roadmap checkbox gaps", () => {
    const result = check.run(
      taskCtx({
        ".goat-flow/tasks/1.3.0/M01-active.md":
          "**Status:** in-progress\n\n## Tasks\n- [ ] One\n- [ ] Two\n",
        ".goat-flow/tasks/1.3.0/M02-testing.md":
          "**Status:** testing-gate\n\n## Testing Gate\n- [ ] npm test passes\n",
        ".goat-flow/tasks/1.8.0/M09-runtime-verification.md":
          "**Status:** planned\n\n## Long-term ideas\n- [ ] Explore runtime probes\n",
      }),
    );
    assert.equal(result.status, "pass");
    assert.doesNotMatch(result.findings.join("\n"), /Recovery degraded|0%/);
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
    const selfTestTemplate = readFileSync(
      resolve(PROJECT_ROOT, "workflow/hooks/deny-dangerous.self-test.sh"),
      "utf-8",
    );
    const ctx = makeCtx({
      agentFilter: "claude",
      projectPath: PROJECT_ROOT,
      fs: stubFS({
        readFile: (path) => {
          if (path === ".claude/hooks/deny-dangerous.sh") return template;
          if (path === ".claude/hooks/deny-dangerous.self-test.sh") {
            return selfTestTemplate;
          }
          return null;
        },
      }),
    });
    assert.equal(denyCheck.run(ctx), null);
  });

  it("fails when the split deny hook self-test sibling is missing", () => {
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
    const result = denyCheck.run(ctx);
    assert.ok(result, "expected missing self-test sibling failure");
    assert.match(result.message, /deny-dangerous\.self-test\.sh is missing/);
    assert.equal(result.evidence, ".claude/hooks/deny-dangerous.self-test.sh");
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

  it("matches the locked distribution (9 integrity, 6 advisory, 1 metric)", () => {
    const byType = { integrity: 0, advisory: 0, metric: 0 } as Record<
      string,
      number
    >;
    for (const check of HARNESS_CHECKS) byType[check.type]!++;
    assert.deepStrictEqual(byType, { integrity: 9, advisory: 6, metric: 1 });
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
    const metricIds = new Set(["post-turn-hook-integrity"]);
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

describe("workspace boundary guidance harness", () => {
  const completeInstruction = `
## Truth Order
Use explicit user instructions first.

## Autonomy Tiers
Use the configured autonomy tier.

## Hard Rules
Preserve workspace boundaries.

## Key Resources
Read the learning loop and tool playbooks.

## Essential Commands
Run project commands.

## Execution Loop
READ SCOPE ACT VERIFY

## Artifact Routing
Route artifacts intentionally.

## Definition of Done
Verify changed behavior.

## Router Table
Use local router paths.
`;

  const boundaryInstruction = `${completeInstruction}
## Workspace Boundary
The controlling goat-flow workspace may differ from the selected target project. Commands that inspect framework code run from the controlling workspace; project-specific harness checks run against the selected target.
`;

  function agentWithInstruction(
    agent: AgentProfile,
    content: string,
  ): AgentFacts {
    return stubAgentFacts({
      agent,
      instruction: {
        ...stubAgentFacts().instruction,
        exists: true,
        content,
        lineCount: content.trim().split(/\r?\n/).length,
      },
    });
  }

  function boundaryCheck(ctx: AuditContext) {
    const { scope, concerns } = computeHarness(ctx);
    const check = scope.checks.find(
      (entry) => entry.id === "boundary-guidance-present",
    );
    assert.ok(check, "boundary-guidance-present should be registered");
    return { check, concerns };
  }

  it("aggregate fails when any audited agent lacks boundary guidance", () => {
    const { check, concerns } = boundaryCheck(
      makeCtx({
        agents: [
          agentWithInstruction(STUB_AGENT_PROFILE, boundaryInstruction),
          agentWithInstruction(PROFILES.codex, completeInstruction),
          agentWithInstruction(PROFILES.copilot, completeInstruction),
        ],
      }),
    );

    assert.equal(check.status, "fail");
    assert.equal(concerns.context.status, "fail");
    assert.ok(
      concerns.context.score < 100,
      `context score should drop below 100: ${concerns.context.score}`,
    );
    assert.ok(
      concerns.context.findings.some((finding) =>
        finding.includes(
          "codex: instruction file has no workspace boundary guidance",
        ),
      ),
    );
    assert.ok(
      concerns.context.findings.some((finding) =>
        finding.includes(
          "copilot: instruction file has no workspace boundary guidance",
        ),
      ),
    );
    assert.ok(
      concerns.context.recommendations.some(
        (recommendation) =>
          recommendation.includes("codex (AGENTS.md)") &&
          recommendation.includes("copilot (.github/copilot-instructions.md)"),
      ),
    );
  });

  it("aggregate passes boundary guidance when every audited agent has guidance", () => {
    const { check, concerns } = boundaryCheck(
      makeCtx({
        agents: [
          agentWithInstruction(STUB_AGENT_PROFILE, boundaryInstruction),
          agentWithInstruction(PROFILES.codex, boundaryInstruction),
          agentWithInstruction(PROFILES.copilot, boundaryInstruction),
        ],
      }),
    );

    assert.equal(check.status, "pass");
    assert.equal(concerns.context.status, "pass");
  });

  it("agent-scoped codex still fails when codex lacks guidance", () => {
    const { check, concerns } = boundaryCheck(
      makeCtx({
        agentFilter: "codex",
        agents: [agentWithInstruction(PROFILES.codex, completeInstruction)],
      }),
    );

    assert.equal(check.status, "fail");
    assert.equal(concerns.context.status, "fail");
    assert.ok(
      concerns.context.findings.some((finding) =>
        finding.includes(
          "codex: instruction file has no workspace boundary guidance",
        ),
      ),
    );
    assert.ok(
      !concerns.context.findings.some((finding) =>
        finding.startsWith("claude:"),
      ),
    );
  });

  it("agent-scoped claude still passes when claude has guidance", () => {
    const { check, concerns } = boundaryCheck(
      makeCtx({
        agentFilter: "claude",
        agents: [agentWithInstruction(STUB_AGENT_PROFILE, boundaryInstruction)],
      }),
    );

    assert.equal(check.status, "pass");
    assert.equal(concerns.context.status, "pass");
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

  it("deny-covers-secrets fails when settings Read deny is present but Bash hook lacks direct literal secret-path blocking", () => {
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
      "deny-covers-secrets must fail when Bash hook has no direct literal secret-path blocking",
    );
  });

  it("deny-covers-secrets passes when both settings Read deny and Bash hook block direct literal secret paths", () => {
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

  it("script-only secret coverage passes with limited assurance", () => {
    const baseHooks = stubAgentFacts().hooks;
    const hooks = {
      ...baseHooks,
      readDenyCoversSecrets: false,
      bashDenyCoversSecrets: true,
      denyBlocksPipeToShell: true,
      denyRegisteredPath: PROFILES.copilot.denyHookFile,
    } satisfies AgentFacts["hooks"];
    const ctx = makeCtx({
      agents: [stubAgentFacts({ agent: PROFILES.copilot, hooks })],
    });
    const { scope, concerns } = computeHarness(ctx);
    const secrets = scope.checks.find((c) => c.id === "deny-covers-secrets");

    assert.equal(secrets?.status, "pass");
    assert.equal(secrets?.displayStatus, "info");
    assert.equal(secrets?.impact, "none");
    assert.equal(secrets?.assurance, "limited");
    assert.equal(concerns.constraints.status, "pass");
    assert.equal(concerns.constraints.score, 100);
    assert.ok(
      concerns.constraints.findings.some((finding) =>
        finding.includes("file-read deny is unavailable"),
      ),
    );
  });

  it("no post-turn hook metric lowers verification score without failing the concern", () => {
    const baseFacts = makeCtx().facts;
    const ctx = makeCtx({
      facts: {
        ...baseFacts,
        shared: {
          ...baseFacts.shared,
          gitCommitInstructions: {
            exists: true,
            path: ".github/git-commit-instructions.md",
            requiredPath: ".github/git-commit-instructions.md",
            misplacedPaths: [],
          },
        },
      },
    });
    const { scope, concerns } = computeHarness(ctx);
    const metric = scope.checks.find(
      (c) => c.id === "post-turn-hook-integrity",
    )!;
    assert.equal(metric.status, "fail");
    assert.equal(metric.displayStatus, "warn");
    assert.equal(metric.impact, "score-only");
    assert.match(metric.failure?.evidence ?? "", /Metric/);
    assert.equal(concerns.verification.metrics, 1);
    assert.equal(concerns.verification.advisoryFail, 0);
    assert.equal(concerns.verification.status, "pass");
    assert.equal(concerns.verification.score, 67);
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
    assert.equal(advisory.displayStatus, "warn");
    assert.equal(advisory.impact, "score-only");
    assert.equal(advisory.provenance.normative_level, "SHOULD");
    const docs = scope.checks.find((c) => c.id === "doc-paths-resolve")!;
    assert.equal(docs.type, "integrity");
    assert.equal(docs.acknowledged, undefined);
    assert.equal(docs.displayStatus, "pass");
    assert.equal(docs.impact, "none");
    assert.equal(docs.evidenceKind, "structural");
    assert.equal(docs.provenance.normative_level, "MUST");
    assert.ok(
      docs.provenance.framework_evidence_paths?.includes(
        "docs/harness-audit.md",
      ),
      "framework evidence paths should be labelled separately from target paths",
    );
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
      assert.match(output, /Run `goat-flow audit .+ --harness --agent codex`/);
      assert.ok(
        !output.includes("scanner"),
        `audit-pass output should not regress to scanner wording: ${output}`,
      );
    } finally {
      await project.cleanup();
    }
  });

  it("does not claim a full audit pass for static dashboard setup evidence", async () => {
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
        makeAuditReport(
          project.root,
          "pass",
          [],
          [],
          [
            {
              id: "decisions-tracked",
              name: "Decisions directory exists",
              status: "pass",
            },
          ],
        ),
        facts,
        "codex",
        { denyMechanismEvidenceLevel: "static" },
      );

      assert.ok(output, "composeSetup should return setup text");
      assert.match(output, /Dashboard setup checks pass\./);
      assert.doesNotMatch(output, /All audit checks pass\./);
      assert.match(output, /runtime deny-hook self-test not run/);
      assert.match(output, /Run `goat-flow audit .+ --harness --agent codex`/);
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

  it("excludes informational harness metrics from full-scope failure prompts", async () => {
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
              },
            },
          ],
          [],
          [
            {
              id: "post-turn-hook-integrity",
              name: "Post-turn hook integrity",
              status: "fail",
              type: "metric",
              failure: {
                check: "Post-turn hook integrity",
                message: "No post-turn hooks installed",
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
      assert.match(output, /1 audit check failed:/);
      assert.match(output, /Config version/);
      assert.doesNotMatch(output, /Post-turn hook integrity/);
      assert.match(
        output,
        /Re-run: `node .* audit .+ --harness --agent codex`/,
      );
    } finally {
      await project.cleanup();
    }
  });

  it("routes current-but-incomplete installs to the full setup workflow", async () => {
    const project = await makeTempProject(async (root) => {
      await writeProjectFile(
        root,
        ".goat-flow/config.yaml",
        `version: "${AUDIT_VERSION}"\nagents:\n  - codex\nskills:\n  install: all\n`,
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
      for (const skill of SKILL_NAMES) {
        await writeProjectFile(root, `.agents/skills/${skill}/SKILL.md`, "#\n");
      }
    });

    try {
      const output = composeSetup(
        makeAuditReport(
          project.root,
          "fail",
          [],
          [
            {
              id: "agent-instruction",
              name: "Agent instruction file",
              status: "fail",
              failure: {
                check: "Agent instruction file",
                message: "Missing: codex (AGENTS.md)",
              },
            },
          ],
        ),
        makeProjectFacts(project.root, []),
        "codex",
      );

      assert.ok(output, "composeSetup should return setup guidance");
      assert.match(output, /Create project-specific content/);
      assert.match(output, /workflow\/setup\//);
      assert.doesNotMatch(output, /audit checks failed/);
    } finally {
      await project.cleanup();
    }
  });

  it("can render dashboard setup prompts from harness-card scope", async () => {
    const project = await makeTempProject(async (root) => {
      await writeProjectFile(
        root,
        ".goat-flow/config.yaml",
        `version: "${AUDIT_VERSION}"\nagents:\n  - codex\nskills:\n  install: all\n`,
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
              },
            },
          ],
          [],
          [
            {
              id: "decisions-tracked",
              name: "Decisions directory exists",
              status: "pass",
            },
          ],
        ),
        makeProjectFacts(project.root, [
          stubAgentFacts({ agent: PROFILES.codex }),
        ]),
        "codex",
        { promptScope: "harness-card" },
      );

      assert.ok(output, "composeSetup should return harness-card setup text");
      assert.match(output, /All audit checks pass\./);
      assert.doesNotMatch(output, /Config version mismatch/);
      assert.match(output, /audit .+ --harness --agent codex/);
    } finally {
      await project.cleanup();
    }
  });

  it("keeps harness scope in dashboard setup failure remediation", async () => {
    const project = await makeTempProject(async (root) => {
      await writeProjectFile(
        root,
        ".goat-flow/config.yaml",
        `version: "${AUDIT_VERSION}"\nagents:\n  - codex\nskills:\n  install: all\n`,
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
      const output = composeSetup(
        makeAuditReport(
          project.root,
          "fail",
          [],
          [],
          [
            {
              id: "decisions-tracked",
              name: "Decisions directory exists",
              status: "fail",
              failure: {
                check: "Decisions directory exists",
                message: "No decisions directory",
              },
            },
          ],
        ),
        makeProjectFacts(project.root, [
          stubAgentFacts({ agent: PROFILES.codex }),
        ]),
        "codex",
        { promptScope: "harness-card" },
      );

      assert.ok(output, "composeSetup should return harness-card failure text");
      assert.match(output, /Decisions directory exists/);
      assert.match(
        output,
        /Re-run: `node .* audit .+ --harness --agent codex`/,
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
      assert.match(
        output,
        /npx @blundergoat\/goat-flow@latest install .* --agent codex/,
      );
      assert.match(output, /does not require an agent/);
      assert.match(output, /## Step 2 - Create project-specific content/);
      assert.match(output, /## Step 3 - Verify/);
      assert.match(output, /Run both required setup gates/);
      assert.match(output, /audit .+ --agent codex`/);
      assert.match(output, /audit .+ --agent codex --harness`/);
      assert.match(output, /re-run both audit gates/);
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
                message: `Config version 1.1.0 does not match current ${AUDIT_VERSION}`,
                evidence: ".goat-flow/config.yaml",
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
                message: `Skill goat is at v1.1.0; expected v${AUDIT_VERSION}`,
                evidence: ".agents/skills/goat/SKILL.md",
              },
            },
          ],
        ),
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
      assert.match(output, /## Detected install issues/);
      assert.match(
        output,
        new RegExp(
          `Config version 1\\.1\\.0 does not match current ${AUDIT_VERSION.replaceAll(".", "\\.")}`,
        ),
      );
      assert.match(output, /Skill goat is at v1\.1\.0; expected v/);
      assert.match(
        output,
        /npx @blundergoat\/goat-flow@latest install .* --agent codex/,
      );
      assert.match(output, /workflow\/setup\/02-instruction-file\.md/);
      assert.match(output, /Run both required setup gates/);
      assert.match(output, /audit .+ --agent codex`/);
      assert.match(output, /audit .+ --agent codex --harness`/);
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
      assert.match(
        output,
        /npx @blundergoat\/goat-flow@latest install .* --agent codex/,
      );
      assert.match(output, /Remove legacy surfaces/);
      assert.match(output, /workflow\/setup\/02-instruction-file\.md/);
      assert.match(output, /Run both required setup gates/);
      assert.match(output, /audit .+ --agent codex`/);
      assert.match(output, /audit .+ --agent codex --harness`/);
      assert.ok(!output.includes(retiredMigrationScript), output);
      assert.ok(!output.includes(retiredLegacyGuide), output);
    } finally {
      await project.cleanup();
    }
  });
});

describe("setup check dependency status", () => {
  it("skips config-version when config.yaml is missing", async () => {
    const project = await makeTempProject(async () => {});
    try {
      const report = runAudit(createFS(project.root), project.root, {
        agentFilter: null,
        harness: false,
      });
      const check = report.scopes.setup.checks.find(
        (entry) => entry.id === "config-version",
      );

      assert.equal(check?.status, "skipped");
    } finally {
      await project.cleanup();
    }
  });

  it("fails dependent per-agent checks when the primary instruction file is missing", async () => {
    const project = await makeTempProject(async (root) => {
      await writeProjectFile(
        root,
        ".goat-flow/config.yaml",
        `version: "${AUDIT_VERSION}"\nagents:\n  - gemini\n`,
      );
    });
    try {
      const report = runAudit(createFS(project.root), project.root, {
        agentFilter: "gemini",
        harness: false,
      });
      const statuses = Object.fromEntries(
        report.scopes.agent.checks.map((entry) => [entry.id, entry.status]),
      );

      assert.equal(statuses["agent-instruction"], "fail");
      assert.equal(statuses["agent-skills"], "fail");
      assert.equal(statuses["agent-settings"], "fail");
      assert.equal(statuses["agent-deny-dangerous"], "fail");
    } finally {
      await project.cleanup();
    }
  });

  it("aggregate audit fails when config declares an agent with no instruction file", async () => {
    const project = await makeTempProject(async (root) => {
      await writeProjectFile(
        root,
        ".goat-flow/config.yaml",
        `version: "${AUDIT_VERSION}"\nagents:\n  - claude\n  - codex\nskills:\n  install: all\n`,
      );
      await writeProjectFile(root, "CLAUDE.md", "# CLAUDE.md\n");
    });
    try {
      const report = runAudit(createFS(project.root), project.root, {
        agentFilter: null,
        harness: false,
      });
      const instruction = report.scopes.agent.checks.find(
        (entry) => entry.id === "agent-instruction",
      );

      assert.equal(report.scopes.agent.status, "fail");
      assert.equal(instruction?.status, "fail");
      assert.match(
        instruction?.failure?.message ?? "",
        /Configured agent instruction files missing: codex \(AGENTS\.md\)/,
      );
    } finally {
      await project.cleanup();
    }
  });

  it("aggregate audit names every missing configured agent in a declared-four partial install", async () => {
    const project = await makeTempProject(async (root) => {
      await writeProjectFile(
        root,
        ".goat-flow/config.yaml",
        `version: "${AUDIT_VERSION}"\nagents:\n  - claude\n  - codex\n  - gemini\n  - copilot\nskills:\n  install: all\n`,
      );
      await writeProjectFile(root, "CLAUDE.md", "# CLAUDE.md\n");
    });
    try {
      const report = runAudit(createFS(project.root), project.root, {
        agentFilter: null,
        harness: false,
      });
      const instruction = report.scopes.agent.checks.find(
        (entry) => entry.id === "agent-instruction",
      );
      const message = instruction?.failure?.message ?? "";

      assert.equal(instruction?.status, "fail");
      assert.match(message, /codex \(AGENTS\.md\)/);
      assert.match(message, /gemini \(GEMINI\.md\)/);
      assert.match(message, /copilot \(\.github\/copilot-instructions\.md\)/);
    } finally {
      await project.cleanup();
    }
  });

  it("bare aggregate audit does not pass agent scope or claim skills are installed", async () => {
    const project = await makeTempProject(async () => {});
    try {
      const report = runAudit(createFS(project.root), project.root, {
        agentFilter: null,
        harness: false,
      });
      const instruction = report.scopes.agent.checks.find(
        (entry) => entry.id === "agent-instruction",
      );

      assert.equal(report.status, "fail");
      assert.equal(report.scopes.agent.status, "fail");
      assert.equal(instruction?.status, "fail");
      assert.match(
        instruction?.failure?.message ?? "",
        /No configured agents or agent instruction files found/,
      );
      assert.equal(
        report.scopes.setup.summary.skills,
        `0/${SKILL_NAMES.length} installed (no configured agents)`,
      );
    } finally {
      await project.cleanup();
    }
  });
});

describe("harness signal honesty", () => {
  it("doc path extraction ignores npm scopes and home paths but keeps repo paths", () => {
    assert.deepEqual(
      extractBacktickPaths(
        "`@halaxy/theme` `@vendia/serverless-express` `~/.local/bin` `HL7/FHIR` `.goat-flow/code-map.md` `docs/missing.md` `README.md:1`",
      ),
      [".goat-flow/code-map.md", "docs/missing.md", "README.md:1"],
    );
  });

  it("doc-paths-resolve scans glossary paths without failing on external glossary tokens", () => {
    const check = HARNESS_CHECKS.find((c) => c.id === "doc-paths-resolve")!;
    const result = check.run(
      makeCtx({
        fs: stubFS({
          readFile: (path) => {
            if (path === ".goat-flow/architecture.md")
              return "# Architecture\n";
            if (path === ".goat-flow/glossary.md") {
              return [
                "# Glossary",
                "",
                "| Term | Canonical File |",
                "|------|----------------|",
                "| Theme package | `@halaxy/theme` |",
                "| FHIR shorthand | `HL7/FHIR` |",
                "| OAuth matcher | `src/Security/OAuthRequestMatcher.php` |",
                "| Missing owner | `missing/path.md` |",
              ].join("\n");
            }
            return null;
          },
          exists: (path) => path !== "missing/path.md",
        }),
      }),
    );

    assert.equal(result.status, "fail");
    assert.deepEqual(result.findings, [
      "All 0 architecture.md path references resolve",
      ".goat-flow/glossary.md: unresolved `missing/path.md`",
    ]);
  });

  it("doc-paths-resolve rejects path-line references even when the base file exists", () => {
    const check = HARNESS_CHECKS.find((c) => c.id === "doc-paths-resolve")!;
    const result = check.run(
      makeCtx({
        fs: stubFS({
          readFile: (path) => {
            if (path === ".goat-flow/architecture.md")
              return "# Architecture\n";
            if (path === ".goat-flow/glossary.md") {
              return [
                "# Glossary",
                "",
                "| Term | Canonical File |",
                "|------|----------------|",
                "| Audit | `src/cli/audit/types.ts:6` |",
              ].join("\n");
            }
            return null;
          },
          exists: (path) => path === "src/cli/audit/types.ts",
        }),
      }),
    );

    assert.equal(result.status, "fail");
    assert.deepEqual(result.findings, [
      "All 0 architecture.md path references resolve",
      ".goat-flow/glossary.md: line-number path `src/cli/audit/types.ts:6` is brittle; use `src/cli/audit/types.ts` plus a semantic anchor",
    ]);
  });

  it("doc-paths-resolve rejects root-level path-line references", () => {
    const check = HARNESS_CHECKS.find((c) => c.id === "doc-paths-resolve")!;
    const result = check.run(
      makeCtx({
        fs: stubFS({
          readFile: (path) => {
            if (path === ".goat-flow/architecture.md") {
              return "# Architecture\n\nSee `README.md:1`.\n";
            }
            if (path === ".goat-flow/glossary.md") return "# Glossary\n";
            if (path === "README.md") return "# Project\n";
            return null;
          },
          exists: (path) => path === "README.md",
        }),
      }),
    );

    assert.equal(result.status, "fail");
    assert.deepEqual(result.findings, [
      ".goat-flow/architecture.md: line-number path `README.md:1` is brittle; use `README.md` plus a semantic anchor",
    ]);
  });

  it("execution loop smoke check only accepts step words inside the section", () => {
    const instruction = [
      "# Agent",
      "",
      "READ SCOPE ACT VERIFY",
      "",
      "## Execution Loop",
      "",
      "This section exists but does not define the loop steps.",
    ].join("\n");
    const agent = stubAgentFacts();
    const ctx = makeCtx({
      agents: [
        {
          ...agent,
          instruction: {
            ...agent.instruction,
            content: instruction,
            lineCount: instruction.split(/\r?\n/u).length,
          },
        },
      ],
    });
    const { scope } = computeHarness(ctx);
    const check = scope.checks.find(
      (entry) => entry.id === "execution-loop-present",
    );

    assert.equal(check?.status, "fail");
    assert.match(
      check?.failure?.message ?? "",
      /under the "Execution Loop" heading/,
    );
  });

  it("feedback-loop harness fails on invalid line refs", () => {
    const facts = makeCtx().facts;
    const ctx = makeCtx({
      facts: {
        ...facts,
        shared: {
          ...facts.shared,
          footguns: {
            ...facts.shared.footguns,
            invalidLineRefs: ["src/auth.ts:999 (missing semantic anchor)"],
            buckets: [],
          },
        },
      },
    });
    const { concerns, scope } = computeHarness(ctx);
    const check = scope.checks.find(
      (entry) => entry.id === "feedback-loop-active",
    );

    assert.equal(check?.status, "fail");
    assert.equal(concerns.feedback_loop.status, "fail");
    assert.match(check?.failure?.message ?? "", /invalid learning-loop/);
  });
});
