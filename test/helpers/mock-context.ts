/**
 * Factory function for building mock FactContext objects for rubric check unit tests.
 * Provides sensible defaults matching a passing-minimal project, with overrides for testing specific failures.
 */
import type { FactContext, AgentFacts, SharedFacts } from '../../src/cli/types.js';

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/** Deep merge two objects, with overrides taking precedence. */
function deepMerge<T extends Record<string, unknown>>(
  base: T,
  overrides: DeepPartial<T>,
): T {
  const result = { ...base };
  for (const key of Object.keys(overrides) as Array<keyof T>) {
    const val = overrides[key];
    if (
      val !== null &&
      typeof val === 'object' &&
      !Array.isArray(val) &&
      !(val instanceof Map) &&
      typeof base[key] === 'object' &&
      base[key] !== null &&
      !Array.isArray(base[key]) &&
      !(base[key] instanceof Map)
    ) {
      result[key] = deepMerge(
        base[key] as Record<string, unknown>,
        val as DeepPartial<Record<string, unknown>>,
      ) as T[keyof T];
    } else {
      result[key] = val as T[keyof T];
    }
  }
  return result;
}

/** Create default SharedFacts matching a passing-minimal project. */
function defaultSharedFacts(): SharedFacts {
  return {
    footguns: {
      exists: true,
      committedExists: true,
      localExists: false,
      hasEvidence: true,
      entryCount: 1,
      committedCount: 1,
      localCount: 0,
      labelCount: 1,
      hasEvidenceLabels: true,
      dirMentions: new Map(),
      staleRefs: [],
      invalidLineRefs: [],
      duplicateSurfacePaths: [],
      totalRefs: 1,
      validRefs: 1,
      formatDiagnostic: null,
      paths: { committed: 'ai-docs/footguns/', local: '.goat-flow/footguns/' },
    },
    lessons: {
      exists: true,
      committedExists: true,
      localExists: false,
      hasEntries: true,
      entryCount: 1,
      committedCount: 1,
      localCount: 0,
      staleRefs: [],
      duplicateSurfacePaths: [],
      formatDiagnostic: null,
      paths: { committed: 'ai-docs/lessons/', local: '.goat-flow/lessons/' },
    },
    decisions: {
      dirExists: true,
      fileCount: 1,
      path: 'ai-docs/decisions/',
      hasRealContent: true,
    },
    config: {
      exists: true,
      valid: true,
      warningCount: 0,
      errorCount: 0,
      parseError: null,
      lineLimits: { target: 120, limit: 150 },
      configLocalExists: true,
    },
    architecture: { exists: true, lineCount: 30 },
    evals: {
      dirExists: true,
      count: 5,
      hasReadme: true,
      hasOriginLabels: true,
      hasAgentsLabels: true,
      hasReplayPrompts: true,
      hasRealContent: true,
      hasFrontmatter: true,
      evalSkillCount: 3,
      missingSkills: [],
      path: 'ai-docs/evals/',
    },
    ci: {
      workflowExists: true,
      checksLineCount: true,
      checksRouter: true,
      checksSkills: true,
      ciTriggersOnPRs: true,
    },
    handoffTemplate: {
      exists: true,
      sectionCount: 9,
      hasRequiredSections: true,
    },
    ignoreFiles: {
      copilotignore: false,
      cursorignore: false,
      geminiignore: false,
    },
    gitignore: { exists: true, hasRequiredEntries: true },
    guidelinesOwnership: { exists: false },
    domainReference: { exists: false },
    preflightScript: { exists: true },
    localInstructions: {
      dirExists: true,
      location: 'ai' as const,
      path: 'ai-docs/coding-standards/',
      hasValidRouter: true,
      hasConventions: true,
      hasConventionsContent: true,
    },
    gitCommitInstructions: { exists: true },
    sessionLogs: { dirExists: true },
  } as SharedFacts;
}

/** Create default AgentFacts matching a passing-minimal Claude setup. */
function defaultAgentFacts(): AgentFacts {
  return {
    agent: {
      id: 'claude' as const,
      name: 'Claude Code',
      instructionFile: 'CLAUDE.md',
      settingsFile: '.claude/settings.json',
      skillsDir: '.claude/skills',
      hooksDir: '.claude/hooks',
      denyMechanism: {
        type: 'deny-script' as const,
        path: '.claude/hooks/deny-dangerous.sh',
        settingsPath: '.claude/settings.json',
      },
    },
    instruction: {
      exists: true,
      content: '# CLAUDE.md\n\n## Execution Loop\n\nREAD CLASSIFY SCOPE ACT VERIFY LOG\n',
      lineCount: 100,
      sections: new Map([
        ['execution loop', 'READ CLASSIFY SCOPE ACT VERIFY LOG'],
        ['autonomy tiers', 'Always Ask First Never'],
        ['definition of done', 'shellcheck cross-references'],
        ['router table', '| Skills | `.claude/skills/` |'],
      ]),
    },
    settings: {
      exists: true,
      valid: true,
      parsed: {
        permissions: { deny: ['Bash(rm -rf *)'] },
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: '.claude/hooks/stop-lint.sh' }] }],
          PostToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: '.claude/hooks/format-file.sh' }] }],
        },
      },
      hasDenyPatterns: true,
    },
    skills: {
      installedDirs: ['goat', 'goat-debug', 'goat-plan', 'goat-review', 'goat-security', 'goat-test'],
      found: ['goat', 'goat-debug', 'goat-plan', 'goat-review', 'goat-security', 'goat-test'],
      missing: [],
      allPresent: true,
      versions: {
        goat: '1.0.0',
        'goat-debug': '1.0.0',
        'goat-plan': '1.0.0',
        'goat-review': '1.0.0',
        'goat-security': '1.0.0',
        'goat-test': '1.0.0',
      },
      outdatedCount: 0,
      hasDispatcher: true,
      danglingRefs: [],
      quality: {
        withStep0: 5,
        withHumanGate: 5,
        withConstraints: 5,
        withPhases: 5,
        withConversational: 5,
        withChaining: 5,
        withChoices: 5,
        withOutputFormat: 5,
        withSharedConventions: 5,
        malformedFenceCount: 0,
        unadaptedCount: 0,
        adaptCommentCount: 0,
        total: 5,
      },
    },
    hooks: {
      denyExists: true,
      denyHasBlocks: true,
      denyIsConfigBased: false,
      denyUsesJq: true,
      denyHandlesChaining: true,
      denyBlocksRmRf: true,
      denyBlocksForcePush: true,
      denyBlocksChmod: true,
      denyBlocksPipeToShell: true,
      denyBlocksCloudDestructive: false,
      postTurnExists: true,
      postTurnRegistered: true,
      postTurnRegisteredPath: '.claude/hooks/stop-lint.sh',
      postTurnExitsZero: true,
      postTurnHasValidation: true,
      postTurnSwallowsFailures: false,
      postToolRegistered: true,
      postToolRegisteredPath: '.claude/hooks/format-file.sh',
      postToolExists: true,
      postToolUsesExpectedPathField: true,
      postToolSkipsAgentConfigPaths: true,
      compactionHookExists: false,
      absolutePathHooks: [],
      readDenyCoversSecrets: true,
    },
    deny: {
      gitCommitBlocked: true,
      gitPushBlocked: true,
    },
    router: {
      hasRouterTable: true,
      skillPathsValid: true,
      hasHandoffRef: true,
      hasConfigRef: true,
      hasSessionLogRef: true,
    },
  } as AgentFacts;
}

/**
 * Build a mock FactContext with sensible defaults. Override specific fields as needed.
 *
 * Usage:
 * ```ts
 * const ctx = createMockContext({
 *   agentFacts: { hooks: { postTurnSwallowsFailures: true } },
 * });
 * ```
 */
export function createMockContext(overrides?: {
  shared?: DeepPartial<SharedFacts>;
  agentFacts?: DeepPartial<AgentFacts>;
}): FactContext {
  const shared = overrides?.shared
    ? deepMerge(defaultSharedFacts(), overrides.shared)
    : defaultSharedFacts();

  const agentFacts = overrides?.agentFacts
    ? deepMerge(defaultAgentFacts(), overrides.agentFacts)
    : defaultAgentFacts();

  return {
    facts: {
      root: '/tmp/mock-project',
      stack: {
        languages: ['typescript'],
        buildCommand: 'npx tsc',
        testCommand: 'npm test',
        lintCommand: 'npx eslint .',
        formatCommand: 'npx prettier --write .',
        signals: {
          codeGenTools: [],
          deployPlatforms: [],
          llmIntegration: false,
          staticAnalysis: [],
          complianceSignals: false,
          formatterGaps: [],
        },
      },
      agents: [agentFacts],
      shared,
    },
    agentFacts,
  };
}
