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
  "!skill-reference/",
  "!skill-reference/**",
  "!skill-playbooks/",
  "!skill-playbooks/**",
  "",
].join("\n");

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
  denyHookFile: ".claude/hooks/guard-repository-writes.sh",
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
      denyRegisteredPath: ".claude/hooks/guard-repository-writes.sh",
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
    ".goat-flow/tasks/.gitignore",
    ".goat-flow/lessons/README.md",
    ".goat-flow/footguns/README.md",
    ".goat-flow/skill-reference/skill-preamble.md",
    ".goat-flow/skill-reference/skill-conventions.md",
    ".goat-flow/architecture.md",
    ".goat-flow/code-map.md",
    ".goat-flow/glossary.md",
    ".goat-flow/patterns/README.md",
  ],
  required_dirs: [
    ".goat-flow/decisions/",
    ".goat-flow/footguns/",
    ".goat-flow/lessons/",
    ".goat-flow/patterns/",
    ".goat-flow/logs/sessions/",
    ".goat-flow/scratchpad/",
    ".goat-flow/tasks/",
  ],
  skills: {
    canonical: [...SKILL_NAMES],
    stale_names: ["goat-audit", "goat-investigate"],
  },
  agents: {},
};

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
      path: ".goat-flow/footguns/",
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
      path: ".goat-flow/lessons/",
      buckets: [],
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
    learningLoopEntries: [],
  };
}

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
