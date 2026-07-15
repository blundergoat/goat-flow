/**
 * Shared test fixtures for audit/quality tests.
 * Use these defaults to model a healthy selected project before one focused
 * setup or harness condition is overridden for a user-visible assertion.
 */
import type {
  AgentFacts,
  AgentProfile,
  AuditContext,
  GoatFlowConfig,
  LoadedConfig,
  ProjectFacts,
  ProjectStructure,
  ReadonlyFS,
} from "../../src.js";
import { AUDIT_VERSION, getSkillNames } from "../../src.js";

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
  "!logs/",
  "!logs/sessions/",
  "!logs/sessions/.gitkeep",
  "!logs/sessions/README.md",
  "!logs/quality/",
  "!logs/quality/README.md",
  "!logs/events/",
  "!logs/events/README.md",
  "!logs/critiques/",
  "!logs/critiques/README.md",
  "!logs/review/",
  "!logs/review/README.md",
  "!logs/security/",
  "!logs/security/README.md",
  "",
].join("\n");

const HEALTHY_STANDALONE_PLAYBOOK_FILENAMES = [
  "browser-use.md",
  "changelog.md",
  "code-comments.md",
  "gruff-code-quality.md",
  "hook-policy-testing.md",
  "observability.md",
  "page-capture.md",
  "release-notes.md",
  "skill-playbook-authoring-sync.md",
] as const;

/** Render the default playbook index a healthy-project audit fixture exposes to users. */
function healthyPlaybookReadme(): string {
  const rows = HEALTHY_STANDALONE_PLAYBOOK_FILENAMES.map(
    (filename) => `| [\`${filename}\`](./${filename}) | Fixture | n/a |`,
  );
  return `---
goat-flow-reference-version: "${AUDIT_VERSION}"
---
# Skill Playbooks

## Available playbooks

${rows.join("\n")}
`;
}

/** Render one versioned playbook with the first section users expect to load. */
function healthyPlaybook(filename: string): string {
  return `---
goat-flow-reference-version: "${AUDIT_VERSION}"
---
# ${filename}

## Availability Check

Fixture capability is available.
`;
}

// Test helper: a ReadonlyFS whose defaults describe a healthy project (a valid
// .goat-flow/.gitignore, everything else empty/present). Pass overrides to
// simulate the specific filesystem condition a check is meant to detect.
export function stubFS(overrides: Partial<ReadonlyFS> = {}): ReadonlyFS {
  const defaultReadFile = (path: string): string | null => {
    // The default project keeps committed goat-flow files visible to audit users.
    if (path === ".goat-flow/.gitignore") return HEALTHY_GOAT_FLOW_GITIGNORE;
    // The playbook README lets agents discover every registered built-in reference.
    if (path === ".goat-flow/skill-docs/playbooks/README.md") {
      return healthyPlaybookReadme();
    }
    const playbookFilename = path.split("/").at(-1);
    // Registered playbooks default to the contract shape unless a test overrides them.
    if (
      path.startsWith(".goat-flow/skill-docs/playbooks/") &&
      playbookFilename !== undefined &&
      HEALTHY_STANDALONE_PLAYBOOK_FILENAMES.includes(
        playbookFilename as (typeof HEALTHY_STANDALONE_PLAYBOOK_FILENAMES)[number],
      )
    ) {
      return healthyPlaybook(playbookFilename);
    }
    // Required hook fixtures carry the current version users receive from setup.
    if (
      [
        ".goat-flow/hooks/deny-dangerous.sh",
        ".goat-flow/hooks/post-turn-safety.sh",
      ].includes(path)
    ) {
      return `#!/usr/bin/env bash\n# goat-flow-hook-version: ${AUDIT_VERSION}\n`;
    }
    return null;
  };
  const fs = {
    exists: () => true,
    readFile: defaultReadFile,
    lineCount: () => 0,
    readJson: () => null,
    isReadableDirectory: () => true,
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
      terminal: { idleTimeoutMinutes: 480 },
      harness: { acknowledge: [] },
      hooks: {},
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
      found: [...getSkillNames()],
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
    canonical: [...getSkillNames()],
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
