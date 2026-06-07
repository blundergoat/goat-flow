/**
 * Shared test fixtures for audit/quality tests.
 * Exports stubFS, stubConfig, stubAgentFacts, and pre-built project fixtures.
 */
import type {
  ReadonlyFS,
  ProjectFacts,
  AgentFacts,
  AgentProfile,
} from "../../../src/cli/types.js";
import type {
  LoadedConfig,
  GoatFlowConfig,
} from "../../../src/cli/config/types.js";
import type {
  AuditContext,
  ProjectStructure,
} from "../../../src/cli/audit/types.js";
import { AUDIT_VERSION, SKILL_NAMES } from "../../../src/cli/constants.js";

const HEALTHY_GOAT_FLOW_GITIGNORE = [
  "*",
  "!.gitignore",
  "!config.yaml",
  "!learning-loop/",
  "!learning-loop/**",
  "!skill-docs/",
  "!skill-docs/**",
  "!hooks/",
  "!hooks/**",
  "!plans/",
  "!plans/**",
  "",
].join("\n");

// Test helper: a ReadonlyFS whose defaults describe a healthy project (a valid
// .goat-flow/.gitignore, everything else empty/present). Pass overrides to
// simulate the specific filesystem condition a check is meant to detect.
export function stubFS(overrides: Partial<ReadonlyFS> = {}): ReadonlyFS {
  const defaultReadFile = (path: string): string | null => {
    if (path === ".goat-flow/.gitignore") return HEALTHY_GOAT_FLOW_GITIGNORE;
    return null;
  };
  const fs = {
    exists: () => true,
    readFile: defaultReadFile,
    lineCount: () => 0,
    readJson: () => null,
    listDir: () => [],
    isExecutable: () => false,
    glob: () => [],
    ...overrides,
  };
  return {
    ...fs,
    existsGlob:
      overrides.existsGlob ??
      ((pattern: string) => fs.glob(pattern).length > 0),
  };
}

export function stubConfig(
  overrides: Partial<GoatFlowConfig> = {},
): LoadedConfig {
  return {
    exists: true,
    valid: true,
    config: {
      version: AUDIT_VERSION,
      footguns: { path: ".goat-flow/learning-loop/footguns/" },
      lessons: { path: ".goat-flow/learning-loop/lessons/" },
      decisions: { path: ".goat-flow/learning-loop/decisions/" },
      plans: { path: ".goat-flow/plans/" },
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
      learningLoop: { autoCapture: { enabled: false, targets: [] } },
      knownGaps: [],
      skillOverrides: {},
      ...overrides,
    },
    warnings: [],
    errors: [],
    parseError: null,
  };
}

export const STUB_AGENT_PROFILE: AgentProfile = {
  id: "claude",
  name: "Claude Code",
  instructionFile: "CLAUDE.md",
  settingsFile: ".claude/settings.json",
  hookConfigFile: ".claude/settings.json",
  skillsDir: ".claude/skills",
  hooksDir: ".claude/hooks",
  denyMechanism: { type: "settings-deny", path: ".claude/settings.json" },
  denyHookFile: ".goat-flow/hooks/deny-dangerous.sh",
  localPattern: "*/CLAUDE.md",
  hookEvents: { preTool: "PreToolUse", postTurn: "Stop" },
};

export function stubAgentFacts(
  overrides: Partial<AgentFacts> = {},
): AgentFacts {
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
      found: [...SKILL_NAMES],
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
      denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.sh",
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

export const STUB_STRUCTURE: ProjectStructure = {
  required_files: [
    ".goat-flow/.gitignore",
    ".goat-flow/config.yaml",
    ".goat-flow/plans/.gitignore",
    ".goat-flow/learning-loop/lessons/README.md",
    ".goat-flow/learning-loop/footguns/README.md",
    ".goat-flow/skill-docs/skill-preamble.md",
    ".goat-flow/skill-docs/skill-conventions.md",
    ".goat-flow/architecture.md",
    ".goat-flow/code-map.md",
    ".goat-flow/glossary.md",
    ".goat-flow/learning-loop/patterns/README.md",
  ],
  required_dirs: [
    ".goat-flow/learning-loop/decisions/",
    ".goat-flow/learning-loop/footguns/",
    ".goat-flow/learning-loop/lessons/",
    ".goat-flow/learning-loop/patterns/",
    ".goat-flow/logs/sessions/",
    ".goat-flow/scratchpad/",
    ".goat-flow/plans/",
  ],
  skills: {
    canonical: [...SKILL_NAMES],
    stale_names: ["goat-audit", "goat-investigate"],
  },
  agents: {},
};

// Test helper: baseline learning-loop "shared" facts — buckets present but
// empty (no evidence, zero entries) — so audit contexts start from a known
// neutral state that individual tests then nudge.
export function makeSharedFacts(): ProjectFacts["shared"] {
  return {
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
      path: ".goat-flow/learning-loop/footguns/",
      buckets: [],
    },
    lessons: {
      exists: true,
      hasEntries: false,
      entryCount: 0,
      staleRefs: [],
      invalidLineRefs: [],
      duplicateSurfacePaths: [],
      formatDiagnostic: null,
      path: ".goat-flow/learning-loop/lessons/",
      buckets: [],
    },
    decisions: {
      dirExists: true,
      fileCount: 0,
      path: ".goat-flow/learning-loop/decisions/",
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
      requiredPath: "docs/coding-standards/git-commit.md",
      misplacedPaths: [],
    },
    localInstructionsLineCount: 0,
    learningLoopEntries: [],
  };
}

// Test helper. The deeply nested shape is intentional: audit checks read
// AuditContext fields directly without presence guards, so every nested fact
// must exist or a check throws instead of failing cleanly. This populates them
// all for a healthy project; `overrides` shallow-merges last so a test can swap
// just the slice it exercises, because rebuilding the whole tree per test is noise.
export function makeCtx(overrides: Partial<AuditContext> = {}): AuditContext {
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
      shared: makeSharedFacts(),
    } as ProjectFacts,
    config: stubConfig(),
    fs: stubFS(),
    structure: STUB_STRUCTURE,
    agents: [stubAgentFacts()],
    agentFilter: null,
    ...overrides,
  };
}
