/**
 * Supply reusable project, agent, and filesystem inputs for audit and quality tests.
 *
 * Tests override the facts relevant to the user-visible finding they want to check.
 * The defaults are controlled fixture data; each case still supplies the evidence required by its own assertions.
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
import {
  AUDIT_VERSION,
  getSkillNames,
  REQUIRED_GOAT_FLOW_GITIGNORE_PATTERNS,
} from "../../src.js";

const HEALTHY_GOAT_FLOW_GITIGNORE = [
  ...REQUIRED_GOAT_FLOW_GITIGNORE_PATTERNS,
  "",
].join("\n");

const HEALTHY_STANDALONE_PLAYBOOK_FILENAMES = [
  "browser-use.md",
  "changelog.md",
  "code-comments.md",
  "gruff-code-quality.md",
  "hook-policy-testing.md",
  "naming-and-placement.md",
  "observability.md",
  "page-capture.md",
  "release-notes.md",
  "skill-playbook-authoring-sync.md",
  "test-selection.md",
  "writing-agent-facing-instructions.md",
  "writing-sentence-diagnostics.md",
  "writing-structure-diagnostics.md",
  "writing-human-facing-prose.md",
] as const;

// Render the default playbook index a healthy-project audit fixture exposes to users.
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

// Render one versioned playbook with the first section users expect to load.
function healthyPlaybook(filename: string): string {
  return `---
goat-flow-reference-version: "${AUDIT_VERSION}"
---
# ${filename}

## Availability Check

Fixture capability is available.
`;
}

/**
 * Simulate project files for an audit check without touching a real user's project.
 * Supply overrides for the missing, malformed, or installed content the test is exercising.
 *
 * @param overrides - filesystem operations to replace; omitted operations keep the shared fixture defaults
 * @returns file access with selected built-in content; unlisted file reads return null and directory listings start empty
 */
export function stubFS(overrides: Partial<ReadonlyFS> = {}): ReadonlyFS {
  // Stands in for the committed goat-flow files an audit user would really have on disk.
  const defaultReadFile = (path: string): string | null => {
    // The default project keeps committed goat-flow files visible to audit users.
    if (path === ".goat-flow/.gitignore") return HEALTHY_GOAT_FLOW_GITIGNORE;
    // A present optional policy remains discoverable from the healthy project code map.
    if (path === ".goat-flow/code-map.md") {
      return "Read `.goat-flow/security-policy.md` when present.\n";
    }
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
    // Unlisted files have no fixture content; a test requiring their bytes must provide an override.
    return null;
  };
  const fs = {
    // Treat paths as present until a missing-file scenario overrides this operation.
    exists: () => true,
    // Return only the built-in fixture content or the null that asks the test to supply its own file bytes.
    readFile: defaultReadFile,
    // Leave size checks at zero until a test supplies the line count relevant to its finding.
    lineCount: () => 0,
    // Supply no parsed JSON by default; tests of JSON settings provide the values their assertions need.
    readJson: () => null,
    // Treat directories as readable unless the scenario models missing paths or denied access.
    isReadableDirectory: () => true,
    // Leave discovery empty so a test supplies only the directory entries relevant to its finding.
    listDir: () => [],
    // Require a test to opt into executable hooks instead of implying that every existing file can run.
    isExecutable: () => false,
    // Leave wildcard discovery empty until the scenario provides matching files.
    glob: () => [],
    ...overrides,
  };
  return {
    ...fs,
    // A supplied existence check wins; otherwise the test's glob results determine whether matching files exist.
    existsGlob:
      overrides.existsGlob ??
      ((pattern: string) => fs.glob(pattern).length > 0),
  };
}

/**
 * Build a valid loaded configuration so a test can change one setting without also triggering missing-config errors.
 *
 * @param overrides - settings replaced by the test; an empty object keeps the shared fixture defaults
 * @returns an existing, valid configuration with empty warning and error lists
 */
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

/**
 * Build the shared agent-facts fixture so tests can vary one setup condition without reconstructing the whole object.
 *
 * @param overrides - fact groups replaced by the test; an empty object keeps the shared agent fixture
 * @returns agent facts for an audit context; each test must supply the evidence its asserted checks need
 */
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

/**
 * Start shared project facts with present but empty learning-loop buckets, ready for a focused audit assertion.
 * Empty entries and null diagnostics mean this fixture supplies neither incident evidence nor parser errors.
 *
 * @returns shared facts with no entries, evidence references, or parser diagnostics
 */
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
      requiredPath: "docs/coding-standards/git-commit-message.md",
      misplacedPaths: [],
    },
    localInstructionsLineCount: 0,
    learningLoopEntries: [],
  };
}

/**
 * Build the nested context audit checks read directly so a fixture omission does not masquerade as the user's setup failure.
 * Overrides replace whole top-level slices; callers must provide complete nested facts for any slice they replace.
 *
 * @param overrides - context slices replaced by the test; an empty object keeps the common project and agent fixtures
 * @returns a context without an agent filter by default; overrides can select an agent or replace project facts
 */
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
          hasLlmIntegration: false,
          staticAnalysis: [],
          hasComplianceSignals: false,
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
