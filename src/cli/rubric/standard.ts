/**
 * Standard-tier rubric checks covering skills, hooks, local context, and router quality.
 * This tier is where most day-to-day workflow correctness is enforced.
 */
import type { CheckDef, FactContext, CheckResult } from '../types.js';
import { SKILL_NAMES } from '../constants.js';

// Confidence criteria:
//   high   = deterministic (file exists, line count, JSON valid, exact match)
//   medium = heuristic (regex pattern, ratio threshold, keyword detection)
//   low    = semantic inference (content quality judgment)

// Minimum ratio of skills passing a quality signal to award the point (80%)
const SKILL_QUALITY_THRESHOLD = 0.8;

/** Build a standard-tier hook check result with shared Hooks category metadata. */
function buildHooksCheckResult(
  id: string,
  name: string,
  status: CheckResult['status'],
  points: number,
  maxPoints: number,
  confidence: CheckResult['confidence'],
  message: string,
): CheckResult {
  return {
    id,
    name,
    tier: 'standard',
    category: 'Hooks',
    status,
    points,
    maxPoints,
    confidence,
    message,
  };
}

/** Extract the Router Table section from an instruction file without falling back to unrelated content. */
function extractRouterSection(content: string | null): string | null {
  if (content === null) return null;
  const lines = content.split('\n');
  const section: string[] = [];
  let inRouterSection = false;

  for (const line of lines) {
    if (/^##\s+router(?:\s+table)?\s*$/i.test(line)) {
      inRouterSection = true;
      section.push(line);
      continue;
    }

    if (inRouterSection && /^##\s+/.test(line)) break;
    if (inRouterSection) section.push(line);
  }

  return section.length > 0 ? section.join('\n') : null;
}

/** Normalize a router path reference into a comparable local path, or drop non-path refs. */
function normalizeRouterReference(path: string): string | null {
  const trimmed = path.trim();
  if (trimmed.length === 0 || trimmed.startsWith('http')) return null;
  return trimmed.replace(/\/+$/, '');
}

/** Extract every local path reference from the Router Table section. */
function extractRouterReferences(content: string | null): string[] {
  const section = extractRouterSection(content);
  if (section === null) return [];

  const refs: string[] = [];
  for (const match of section.matchAll(/`([^`]+)`/g)) {
    const candidate = match[1];
    if (candidate === undefined) continue;
    const normalized = normalizeRouterReference(candidate);
    if (normalized !== null && refs.includes(normalized) === false) {
      refs.push(normalized);
    }
  }

  for (const match of section.matchAll(/\]\(([^)]+)\)/g)) {
    const candidate = match[1];
    if (candidate === undefined) continue;
    const normalized = normalizeRouterReference(candidate);
    if (normalized !== null && refs.includes(normalized) === false) {
      refs.push(normalized);
    }
  }

  return refs;
}

/** Extract every skills-path reference from the Router Table section. */
function extractRouterSkillsReferences(content: string | null): string[] {
  return extractRouterReferences(content).filter((path) =>
    /\/skills(?:\/|$)/.test(path),
  );
}

/** Return whether the Router Table explicitly references one required repo path. */
function routerReferencesPath(content: string | null, expectedPath: string): boolean {
  const normalizedExpected = normalizeRouterReference(expectedPath);
  if (normalizedExpected === null) return false;
  return extractRouterReferences(content).includes(normalizedExpected);
}

/** Build a router completeness check result for one required literal path. */
function getRequiredRouterPathCheckResult(
  id: string,
  name: string,
  expectedPath: string,
  missingWhy: string,
  ctx: FactContext,
): CheckResult {
  const hasReference = routerReferencesPath(
    ctx.agentFacts.instruction.content,
    expectedPath,
  );
  return {
    id,
    name,
    tier: 'standard',
    category: 'Router Table',
    status: hasReference ? 'pass' : 'fail',
    points: hasReference ? 1 : 0,
    maxPoints: 1,
    confidence: 'high',
    message: hasReference
      ? `Router references ${expectedPath}`
      : `Router does not reference ${expectedPath}. ${missingWhy}`,
  };
}

/** Score whether the Router Table points at the full skills directory instead of the buggy `goat-*` glob. */
function getRouterSkillsCheckResult(ctx: FactContext): CheckResult {
  const expectedDir = ctx.agentFacts.agent.skillsDir.replace(/\/+$/, '');
  const actualRefs = extractRouterSkillsReferences(
    ctx.agentFacts.instruction.content,
  );
  const legacyGlob = `${expectedDir}/goat-*`;

  if (actualRefs.includes(expectedDir)) {
    return {
      id: '2.4.3',
      name: 'Skills referenced in router',
      tier: 'standard',
      category: 'Router Table',
      status: 'pass',
      points: 1,
      maxPoints: 1,
      confidence: 'high',
      message: `Router points at ${expectedDir}/, covering both the \`goat/\` dispatcher and the 5 \`goat-*\` skills.`,
    };
  }

  if (actualRefs.includes(legacyGlob)) {
    return {
      id: '2.4.3',
      name: 'Skills referenced in router',
      tier: 'standard',
      category: 'Router Table',
      status: 'fail',
      points: 0,
      maxPoints: 1,
      confidence: 'high',
      message: `Router points at ${legacyGlob}/, which misses the \`goat/\` dispatcher. Route the skills root ${expectedDir}/ instead so the router matches the real layout.`,
      evidence: legacyGlob,
    };
  }

  if (actualRefs.length === 0) {
    return {
      id: '2.4.3',
      name: 'Skills referenced in router',
      tier: 'standard',
      category: 'Router Table',
      status: 'fail',
      points: 0,
      maxPoints: 1,
      confidence: 'high',
      message: `No skills directory path found in the Router Table. Add ${expectedDir}/ so agents can find the dispatcher and the 5 goat-* skills.`,
    };
  }

  return {
    id: '2.4.3',
    name: 'Skills referenced in router',
    tier: 'standard',
    category: 'Router Table',
    status: 'fail',
    points: 0,
    maxPoints: 1,
    confidence: 'high',
    message: `Router references skill paths ${actualRefs.join(', ')}, but the canonical entry for this agent is ${expectedDir}/.`,
    evidence: actualRefs.join(', '),
  };
}

/** Return the configured settings-based deny patterns when they exist. */
function getDenyPatterns(ctx: FactContext): string[] | null {
  if (
    !ctx.agentFacts.settings.hasDenyPatterns ||
    !ctx.agentFacts.settings.parsed
  )
    return null;

  const permissions = (
    ctx.agentFacts.settings.parsed as Record<string, unknown>
  ).permissions as Record<string, unknown> | undefined;
  return Array.isArray(permissions?.deny)
    ? (permissions.deny as string[])
    : null;
}

/** Detect which `.env` operations are covered by the deny pattern set. */
function getEnvDenyCoverage(denyPatterns: string[]): {
  hasReadEnv: boolean;
  hasEditEnv: boolean;
  hasWriteEnv: boolean;
} {
  const denyText = denyPatterns.join(' ');
  return {
    hasReadEnv: /Read\(.*\.env/.test(denyText),
    hasEditEnv: /Edit\(.*\.env/.test(denyText),
    hasWriteEnv: /Write\(.*\.env/.test(denyText),
  };
}

/** Format the missing `.env` deny actions for the failure message. */
function formatMissingEnvDenyActions(
  hasEditEnv: boolean,
  hasWriteEnv: boolean,
): string {
  const missing: string[] = [];
  if (!hasEditEnv) missing.push('Edit(.env)');
  if (!hasWriteEnv) missing.push('Write(.env)');
  return missing.join(' and ');
}

/** Return the settings path that should contain hook registrations for this agent. */
function getHookSettingsPath(ctx: FactContext): string {
  return ctx.agentFacts.agent.settingsFile ?? 'agent hook config';
}

/** Build the failure message for a missing hook registration. */
function formatMissingHookRegistrationMessage(
  ctx: FactContext,
  hookKind: 'post-turn' | 'post-tool',
  eventName: string,
  expectedPath: string,
): string {
  const settingsPath = getHookSettingsPath(ctx);
  const formatterDetail =
    hookKind === 'post-tool' && ctx.facts.stack.formatCommand
      ? ` Formatter detected: ${ctx.facts.stack.formatCommand}.`
      : '';
  return `Expected ${hookKind} hook registration in ${settingsPath}: event "${eventName}" should point at ${expectedPath}, but no matching hook entry was found.${formatterDetail} Add the hook in settings so the script is actually invoked.`;
}

/** Gather the facts needed to score the post-tool hook check. */
function getPostToolHookStatus(ctx: FactContext): {
  noFormatter: boolean;
  registered: boolean;
  exists: boolean;
  schemaOk: boolean;
  registeredPath: string | null;
  passes: boolean;
} {
  const noFormatter = ctx.facts.stack.formatCommand === null;
  const registered = ctx.agentFacts.hooks.postToolRegistered;
  const exists = ctx.agentFacts.hooks.postToolExists;
  const schemaOk = ctx.agentFacts.hooks.postToolUsesExpectedPathField;
  return {
    noFormatter,
    registered,
    exists,
    schemaOk,
    registeredPath: ctx.agentFacts.hooks.postToolRegisteredPath,
    passes: noFormatter || (exists && schemaOk),
  };
}

/** Build the user-facing status message for the post-tool hook check. */
function getPostToolHookMessage(
  ctx: FactContext,
  status: ReturnType<typeof getPostToolHookStatus>,
): string {
  if (status.noFormatter) {
    return 'No formatter - skip is correct';
  }

  if (status.registered && status.exists === false) {
    return `Post-tool hook is registered at ${status.registeredPath} but the script file does not exist`;
  }

  if (
    ctx.agentFacts.agent.id === 'claude' &&
    status.exists &&
    status.schemaOk === false
  ) {
    return `Post-tool hook exists at ${status.registeredPath} but reads the wrong PostToolUse payload field. Expected top-level .file_path`;
  }

  if (status.exists && status.schemaOk) {
    return `Post-tool hook registered: ${status.registeredPath}`;
  }

  return formatMissingHookRegistrationMessage(
    ctx,
    'post-tool',
    ctx.agentFacts.agent.hookEvents.postTool,
    `${ctx.agentFacts.agent.hooksDir ?? '.'}/format-file.sh`,
  );
}

/** Build the final check result for the post-tool hook-or-skip rule. */
function buildPostToolHookCheckResult(ctx: FactContext): CheckResult {
  const status = getPostToolHookStatus(ctx);
  return {
    id: '2.2.4',
    name: 'Post-tool hook or documented skip',
    tier: 'standard',
    category: 'Hooks',
    status: status.passes ? 'pass' : 'fail',
    points: status.passes ? 1 : 0,
    maxPoints: 1,
    confidence: 'high',
    message: getPostToolHookMessage(ctx, status),
  };
}

/** Gather the facts needed to score the post-turn hook registration and enforcement check. */
function getPostTurnHookStatus(ctx: FactContext): {
  registered: boolean;
  exists: boolean;
  hasValidation: boolean;
  registeredPath: string | null;
  passes: boolean;
} {
  const registered = ctx.agentFacts.hooks.postTurnRegistered;
  const exists = ctx.agentFacts.hooks.postTurnExists;
  const hasValidation = ctx.agentFacts.hooks.postTurnHasValidation;
  return {
    registered,
    exists,
    hasValidation,
    registeredPath: ctx.agentFacts.hooks.postTurnRegisteredPath,
    passes: registered && exists && hasValidation,
  };
}

/** Build the user-facing status message for the post-turn hook registration and enforcement check. */
function getPostTurnHookMessage(
  ctx: FactContext,
  status: ReturnType<typeof getPostTurnHookStatus>,
): string {
  if (status.registered === false) {
    return formatMissingHookRegistrationMessage(
      ctx,
      'post-turn',
      ctx.agentFacts.agent.hookEvents.postTurn,
      `${ctx.agentFacts.agent.hooksDir ?? '.'}/stop-lint.sh`,
    );
  }

  if (status.exists === false) {
    return `Post-turn hook is registered at ${status.registeredPath} but the script file does not exist. Registered hooks only count when the referenced stop-lint script resolves on disk.`;
  }

  if (status.hasValidation === false) {
    return `Post-turn hook is registered at ${status.registeredPath} but no lint, typecheck, or format-check commands were detected. Expected real enforcement such as shellcheck, eslint, tsc, phpstan, or prettier --check instead of a wrapper that only echoes and exits 0.`;
  }

  return `Post-turn hook registered and runs validation: ${status.registeredPath}`;
}

/** Return the list of registered hook paths whose backing script files are missing. */
function getMissingRegisteredHookPaths(ctx: FactContext): string[] {
  const missing: string[] = [];

  if (
    ctx.agentFacts.hooks.postTurnRegistered &&
    ctx.agentFacts.hooks.postTurnExists === false &&
    ctx.agentFacts.hooks.postTurnRegisteredPath
  ) {
    missing.push(`Stop: ${ctx.agentFacts.hooks.postTurnRegisteredPath}`);
  }

  if (
    ctx.agentFacts.hooks.postToolRegistered &&
    ctx.agentFacts.hooks.postToolExists === false &&
    ctx.agentFacts.hooks.postToolRegisteredPath
  ) {
    missing.push(`PostToolUse: ${ctx.agentFacts.hooks.postToolRegisteredPath}`);
  }

  return missing;
}

/** Count the registered hook paths that already resolve on disk. */
function countExistingRegisteredHookPaths(ctx: FactContext): number {
  let count = 0;
  if (
    ctx.agentFacts.hooks.postTurnRegistered &&
    ctx.agentFacts.hooks.postTurnExists
  ) {
    count++;
  }
  if (
    ctx.agentFacts.hooks.postToolRegistered &&
    ctx.agentFacts.hooks.postToolExists
  ) {
    count++;
  }
  return count;
}

/**
 * Tier 2 - Standard (58 pts on a fully configured project; varies with N/A checks)
 * Skills, hooks, learning loop, router, architecture, local context.
 * These checks represent the operational layer that makes GOAT Flow effective.
 */
export const standardChecks: CheckDef[] = [
  // === 2.1 Skills (23 pts: 6 existence@2 + 1 completeness@1 + 8 quality@1 + 1 dispatcher@1 + 1 shared-conventions@1) ===
  ...SKILL_NAMES.map((skill, i) => ({
    id: `2.1.${i + 1}`,
    name: `${skill} skill`,
    tier: 'standard' as const,
    category: 'Skills',
    pts: 2,
    confidence: 'high' as const,
    detect: {
      type: 'file_exists' as const,
      path: `{skills_dir}/${skill}/SKILL.md`,
    },
    recommendation: `Create ${skill} skill`,
    recommendationKey: `create-skill-${skill.replace('goat-', '')}`,
  })),
  {
    id: '2.1.11',
    name: 'All 6 skills present',
    tier: 'standard',
    category: 'Skills',
    pts: 1,
    confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => ({
        id: '2.1.11',
        name: 'All 6 skills present',
        tier: 'standard',
        category: 'Skills',
        status: ctx.agentFacts.skills.allPresent ? 'pass' : 'fail',
        points: ctx.agentFacts.skills.allPresent ? 1 : 0,
        maxPoints: 1,
        confidence: 'high',
        message: ctx.agentFacts.skills.allPresent
          ? 'All 6 skills present'
          : `Missing: ${ctx.agentFacts.skills.missing.join(', ')}`,
      }),
    },
    recommendation:
      'Create all 6 goat-flow skills (5 specialized + goat dispatcher)',
    recommendationKey: 'create-all-skills',
  },

  // === 2.1.12-2.1.18 Skill Content Quality (7 pts) ===
  {
    id: '2.1.12',
    name: 'Skills gather context (Step 0)',
    tier: 'standard',
    category: 'Skills',
    pts: 1,
    confidence: 'medium',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { quality } = ctx.agentFacts.skills;
        if (quality.total === 0) {
          return {
            id: '2.1.12',
            name: 'Skills gather context (Step 0)',
            tier: 'standard',
            category: 'Skills',
            status: 'fail',
            points: 0,
            maxPoints: 1,
            confidence: 'medium',
            message: 'No skills found',
          };
        }
        const ratio = quality.withStep0 / quality.total;
        if (ratio >= SKILL_QUALITY_THRESHOLD) {
          return {
            id: '2.1.12',
            name: 'Skills gather context (Step 0)',
            tier: 'standard',
            category: 'Skills',
            status: 'pass',
            points: 1,
            maxPoints: 1,
            confidence: 'medium',
            message: `${quality.withStep0}/${quality.total} skills ask questions before acting`,
          };
        }
        return {
          id: '2.1.12',
          name: 'Skills gather context (Step 0)',
          tier: 'standard',
          category: 'Skills',
          status: 'fail',
          points: 0,
          maxPoints: 1,
          confidence: 'medium',
          message: `Only ${quality.withStep0}/${quality.total} skills gather context - most should ask before acting`,
        };
      },
    },
    recommendation:
      'Skills should ask clarifying questions before acting (Step 0 pattern)',
    recommendationKey: 'add-skill-step0',
  },
  {
    id: '2.1.13',
    name: 'Skills have human gates',
    tier: 'standard',
    category: 'Skills',
    pts: 1,
    confidence: 'medium',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { quality } = ctx.agentFacts.skills;
        if (quality.total === 0) {
          return {
            id: '2.1.13',
            name: 'Skills have human gates',
            tier: 'standard',
            category: 'Skills',
            status: 'fail',
            points: 0,
            maxPoints: 1,
            confidence: 'medium',
            message: 'No skills found',
          };
        }
        const ratio = quality.withHumanGate / quality.total;
        if (ratio >= SKILL_QUALITY_THRESHOLD) {
          return {
            id: '2.1.13',
            name: 'Skills have human gates',
            tier: 'standard',
            category: 'Skills',
            status: 'pass',
            points: 1,
            maxPoints: 1,
            confidence: 'medium',
            message: `${quality.withHumanGate}/${quality.total} skills include human gates`,
          };
        }
        return {
          id: '2.1.13',
          name: 'Skills have human gates',
          tier: 'standard',
          category: 'Skills',
          status: 'fail',
          points: 0,
          maxPoints: 1,
          confidence: 'medium',
          message: `Only ${quality.withHumanGate}/${quality.total} skills have human gates - agents should pause for review`,
        };
      },
    },
    recommendation:
      'Skills should include HUMAN GATE checkpoints where the agent pauses for human review',
    recommendationKey: 'add-skill-human-gates',
  },
  {
    id: '2.1.14',
    name: 'Skills have MUST/MUST NOT constraints',
    tier: 'standard',
    category: 'Skills',
    pts: 1,
    confidence: 'medium',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { quality } = ctx.agentFacts.skills;
        if (quality.total === 0) {
          return {
            id: '2.1.14',
            name: 'Skills have MUST/MUST NOT constraints',
            tier: 'standard',
            category: 'Skills',
            status: 'fail',
            points: 0,
            maxPoints: 1,
            confidence: 'medium',
            message: 'No skills found',
          };
        }
        const ratio = quality.withConstraints / quality.total;
        if (ratio >= SKILL_QUALITY_THRESHOLD) {
          return {
            id: '2.1.14',
            name: 'Skills have MUST/MUST NOT constraints',
            tier: 'standard',
            category: 'Skills',
            status: 'pass',
            points: 1,
            maxPoints: 1,
            confidence: 'medium',
            message: `${quality.withConstraints}/${quality.total} skills have RFC 2119 constraints`,
          };
        }
        return {
          id: '2.1.14',
          name: 'Skills have MUST/MUST NOT constraints',
          tier: 'standard',
          category: 'Skills',
          status: 'fail',
          points: 0,
          maxPoints: 1,
          confidence: 'medium',
          message: `Only ${quality.withConstraints}/${quality.total} skills have MUST/MUST NOT constraints`,
        };
      },
    },
    recommendation:
      'Skills should use MUST/MUST NOT constraints to enforce boundaries',
    recommendationKey: 'add-skill-constraints',
  },
  {
    id: '2.1.15',
    name: 'Skills have phased process',
    tier: 'standard',
    category: 'Skills',
    pts: 1,
    confidence: 'medium',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { quality } = ctx.agentFacts.skills;
        if (quality.total === 0) {
          return {
            id: '2.1.15',
            name: 'Skills have phased process',
            tier: 'standard',
            category: 'Skills',
            status: 'fail',
            points: 0,
            maxPoints: 1,
            confidence: 'medium',
            message: 'No skills found',
          };
        }
        const ratio = quality.withPhases / quality.total;
        if (ratio >= SKILL_QUALITY_THRESHOLD) {
          return {
            id: '2.1.15',
            name: 'Skills have phased process',
            tier: 'standard',
            category: 'Skills',
            status: 'pass',
            points: 1,
            maxPoints: 1,
            confidence: 'medium',
            message: `${quality.withPhases}/${quality.total} skills have phased execution`,
          };
        }
        return {
          id: '2.1.15',
          name: 'Skills have phased process',
          tier: 'standard',
          category: 'Skills',
          status: 'fail',
          points: 0,
          maxPoints: 1,
          confidence: 'medium',
          message: `Only ${quality.withPhases}/${quality.total} skills have phased execution - structure prevents skipping steps`,
        };
      },
    },
    recommendation:
      'Skills should have a phased process (Phase 1, Phase 2, etc.) to prevent step-skipping',
    recommendationKey: 'add-skill-phases',
  },
  {
    id: '2.1.16',
    name: 'Skills are conversational',
    tier: 'standard',
    category: 'Skills',
    pts: 1,
    confidence: 'medium',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { quality } = ctx.agentFacts.skills;
        if (quality.total === 0) {
          return {
            id: '2.1.16',
            name: 'Skills are conversational',
            tier: 'standard',
            category: 'Skills',
            status: 'fail',
            points: 0,
            maxPoints: 1,
            confidence: 'medium',
            message: 'No skills found',
          };
        }
        if (quality.withConversational === quality.total) {
          return {
            id: '2.1.16',
            name: 'Skills are conversational',
            tier: 'standard',
            category: 'Skills',
            status: 'pass',
            points: 1,
            maxPoints: 1,
            confidence: 'medium',
            message: `${quality.withConversational}/${quality.total} skills encourage conversational interaction`,
          };
        }
        return {
          id: '2.1.16',
          name: 'Skills are conversational',
          tier: 'standard',
          category: 'Skills',
          status: 'fail',
          points: 0,
          maxPoints: 1,
          confidence: 'medium',
          message: `Only ${quality.withConversational}/${quality.total} skills are conversational - all skills must present findings then let humans drill in`,
        };
      },
    },
    recommendation:
      'Skills should be conversational - present findings, then let the human drill in with follow-up questions. One-shot dumps miss architectural problems.',
    recommendationKey: 'add-skill-conversational',
  },
  {
    id: '2.1.17',
    name: 'Skills have chaining',
    tier: 'standard',
    category: 'Skills',
    pts: 1,
    confidence: 'medium',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { quality } = ctx.agentFacts.skills;
        if (quality.total === 0) {
          return {
            id: '2.1.17',
            name: 'Skills have chaining',
            tier: 'standard',
            category: 'Skills',
            status: 'fail',
            points: 0,
            maxPoints: 1,
            confidence: 'medium',
            message: 'No skills found',
          };
        }
        const ratio = quality.withChaining / quality.total;
        if (ratio >= SKILL_QUALITY_THRESHOLD) {
          return {
            id: '2.1.17',
            name: 'Skills have chaining',
            tier: 'standard',
            category: 'Skills',
            status: 'pass',
            points: 1,
            maxPoints: 1,
            confidence: 'medium',
            message: `${quality.withChaining}/${quality.total} skills link to related skills`,
          };
        }
        return {
          id: '2.1.17',
          name: 'Skills have chaining',
          tier: 'standard',
          category: 'Skills',
          status: 'fail',
          points: 0,
          maxPoints: 1,
          confidence: 'medium',
          message: `Only ${quality.withChaining}/${quality.total} skills have chaining - skills should link to related skills`,
        };
      },
    },
    recommendation:
      'Skills should include a "Chains with" footer linking to related skills',
    recommendationKey: 'add-skill-chaining',
  },
  {
    id: '2.1.18',
    name: 'Skills have structured choices',
    tier: 'standard',
    category: 'Skills',
    pts: 1,
    confidence: 'medium',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { quality } = ctx.agentFacts.skills;
        if (quality.total === 0) {
          return {
            id: '2.1.18',
            name: 'Skills have structured choices',
            tier: 'standard',
            category: 'Skills',
            status: 'fail',
            points: 0,
            maxPoints: 1,
            confidence: 'medium',
            message: 'No skills found',
          };
        }
        const ratio = quality.withChoices / quality.total;
        if (ratio >= SKILL_QUALITY_THRESHOLD) {
          return {
            id: '2.1.18',
            name: 'Skills have structured choices',
            tier: 'standard',
            category: 'Skills',
            status: 'pass',
            points: 1,
            maxPoints: 1,
            confidence: 'medium',
            message: `${quality.withChoices}/${quality.total} skills offer choices at phase transitions`,
          };
        }
        return {
          id: '2.1.18',
          name: 'Skills have structured choices',
          tier: 'standard',
          category: 'Skills',
          status: 'fail',
          points: 0,
          maxPoints: 1,
          confidence: 'medium',
          message: `Only ${quality.withChoices}/${quality.total} skills have structured choices - use (a)/(b)/(c) options, not yes/no gates`,
        };
      },
    },
    recommendation:
      'Skills should offer choices at phase transitions, not just yes/no gates',
    recommendationKey: 'add-skill-choices',
  },

  {
    id: '2.1.19',
    name: 'Skills have output format',
    tier: 'standard',
    category: 'Skills',
    pts: 1,
    confidence: 'medium',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { quality } = ctx.agentFacts.skills;
        if (quality.total === 0) {
          return {
            id: '2.1.19',
            name: 'Skills have output format',
            tier: 'standard',
            category: 'Skills',
            status: 'fail',
            points: 0,
            maxPoints: 1,
            confidence: 'medium',
            message: 'No skills found',
          };
        }
        const ratio = quality.withOutputFormat / quality.total;
        if (ratio >= SKILL_QUALITY_THRESHOLD) {
          return {
            id: '2.1.19',
            name: 'Skills have output format',
            tier: 'standard',
            category: 'Skills',
            status: 'pass',
            points: 1,
            maxPoints: 1,
            confidence: 'medium',
            message: `${quality.withOutputFormat}/${quality.total} skills define an output format`,
          };
        }
        return {
          id: '2.1.19',
          name: 'Skills have output format',
          tier: 'standard',
          category: 'Skills',
          status: 'fail',
          points: 0,
          maxPoints: 1,
          confidence: 'medium',
          message: `Only ${quality.withOutputFormat}/${quality.total} skills define an output format - skills should specify what the agent produces`,
        };
      },
    },
    recommendation:
      'Skills should include an ## Output or ## Output Format section that defines the expected deliverable format',
    recommendationKey: 'add-skill-output-format',
  },
  {
    id: '2.1.20',
    name: 'Dispatcher skill (goat) installed',
    tier: 'standard',
    category: 'Skills',
    pts: 1,
    confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => ({
        id: '2.1.20',
        name: 'Dispatcher skill (goat) installed',
        tier: 'standard',
        category: 'Skills',
        status: ctx.agentFacts.skills.hasDispatcher ? 'pass' : 'fail',
        points: ctx.agentFacts.skills.hasDispatcher ? 1 : 0,
        maxPoints: 1,
        confidence: 'high',
        message: ctx.agentFacts.skills.hasDispatcher
          ? `${ctx.agentFacts.agent.skillsDir}/goat/SKILL.md exists`
          : `${ctx.agentFacts.agent.skillsDir}/goat/SKILL.md not found`,
      }),
    },
    recommendation:
      'Install the goat dispatcher skill - the 6th canonical skill that routes /goat commands to the right skill',
    recommendationKey: 'create-skill-goat',
  },
  {
    id: '2.1.21',
    name: 'Skills have Shared Conventions block',
    tier: 'standard',
    category: 'Skills',
    pts: 1,
    confidence: 'medium',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { found, quality } = ctx.agentFacts.skills;
        if (found.length === 0) {
          return {
            id: '2.1.21',
            name: 'Skills have Shared Conventions block',
            tier: 'standard',
            category: 'Skills',
            status: 'fail',
            points: 0,
            maxPoints: 1,
            confidence: 'medium',
            message: 'No skills found',
          };
        }
        const ratio = quality.withSharedConventions / found.length;
        if (ratio >= SKILL_QUALITY_THRESHOLD) {
          return {
            id: '2.1.21',
            name: 'Skills have Shared Conventions block',
            tier: 'standard',
            category: 'Skills',
            status: 'pass',
            points: 1,
            maxPoints: 1,
            confidence: 'medium',
            message: `${quality.withSharedConventions}/${found.length} skills have Shared Conventions block`,
          };
        }
        return {
          id: '2.1.21',
          name: 'Skills have Shared Conventions block',
          tier: 'standard',
          category: 'Skills',
          status: 'fail',
          points: 0,
          maxPoints: 1,
          confidence: 'medium',
          message: `Only ${quality.withSharedConventions}/${found.length} skills have Shared Conventions block - add severity, evidence standard, gates, learning loop`,
        };
      },
    },
    recommendation:
      'Add ## Shared Conventions block to each skill (severity scale, evidence standard, gates, adaptive Step 0, learning loop)',
    recommendationKey: 'add-skill-shared-conventions',
  },

  // === 2.2 Hooks / Verification Scripts (20 pts) ===
  {
    id: '2.2.1',
    name: 'Settings/config valid',
    tier: 'standard',
    category: 'Hooks',
    pts: 1,
    confidence: 'high',
    na: (ctx) => ctx.agentFacts.agent.settingsFile === null,
    detect: { type: 'json_valid', path: '{settings_file}' },
    recommendation: 'Fix settings.json - invalid JSON',
    recommendationKey: 'fix-settings-json',
  },
  {
    id: '2.2.2',
    name: 'Post-turn hook registered and enforces validation',
    tier: 'standard',
    category: 'Hooks',
    pts: 2,
    confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const status = getPostTurnHookStatus(ctx);
        return buildHooksCheckResult(
          '2.2.2',
          'Post-turn hook registered and enforces validation',
          status.passes ? 'pass' : 'fail',
          status.passes ? 2 : 0,
          2,
          'high',
          getPostTurnHookMessage(ctx, status),
        );
      },
    },
    recommendation:
      'Register a real stop-lint hook and make sure it runs lint, typecheck, or format-check commands instead of a no-op wrapper',
    recommendationKey: 'create-stop-lint',
  },
  {
    id: '2.2.2a',
    name: 'Registered hook paths exist',
    tier: 'standard',
    category: 'Hooks',
    pts: 1,
    confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const hasRegisteredHooks =
          ctx.agentFacts.hooks.postTurnRegistered ||
          ctx.agentFacts.hooks.postToolRegistered;
        if (!hasRegisteredHooks) {
          return buildHooksCheckResult(
            '2.2.2a',
            'Registered hook paths exist',
            'na',
            0,
            0,
            'high',
            'No registered hook paths to validate',
          );
        }

        const missing = getMissingRegisteredHookPaths(ctx);
        if (missing.length === 0) {
          const existingCount = countExistingRegisteredHookPaths(ctx);
          return buildHooksCheckResult(
            '2.2.2a',
            'Registered hook paths exist',
            'pass',
            1,
            1,
            'high',
            `All ${existingCount} registered hook paths resolve on disk`,
          );
        }

        return buildHooksCheckResult(
          '2.2.2a',
          'Registered hook paths exist',
          'fail',
          0,
          1,
          'high',
          `Hook registration points at missing script files: ${missing.join(', ')}. Fix the registered path or create the missing hook script.`,
        );
      },
    },
    recommendation:
      'If settings register a hook command, the referenced hook script must exist at that exact path',
    recommendationKey: 'create-stop-lint',
  },
  {
    id: '2.2.3',
    name: 'Post-turn hook does not swallow failures',
    tier: 'standard',
    category: 'Hooks',
    pts: 1,
    confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        if (ctx.agentFacts.hooks.postTurnExists === false) {
          return {
            id: '2.2.3',
            name: 'Post-turn hook does not swallow failures',
            tier: 'standard',
            category: 'Hooks',
            status: 'na',
            points: 0,
            maxPoints: 0,
            confidence: 'high',
            message: 'No post-turn hook to check',
          };
        }
        return {
          id: '2.2.3',
          name: 'Post-turn hook does not swallow failures',
          tier: 'standard',
          category: 'Hooks',
          status: ctx.agentFacts.hooks.postTurnSwallowsFailures
            ? 'fail'
            : 'pass',
          points: ctx.agentFacts.hooks.postTurnSwallowsFailures ? 0 : 1,
          maxPoints: 1,
          confidence: 'high',
          message: ctx.agentFacts.hooks.postTurnSwallowsFailures
            ? 'Post-turn hook swallows validation failures with `|| true`. Expected lint/typecheck/format checks to fail the hook honestly; current setup will hide broken validation runs.'
            : 'Post-turn hook preserves validation failures (no || true on validation commands)',
        };
      },
    },
    recommendation:
      'Remove `|| true` after lint/typecheck/format commands in stop-lint.sh so validation failures are surfaced honestly',
    recommendationKey: 'fix-hook-exit',
  },
  {
    id: '2.2.4',
    name: 'Post-tool hook or documented skip',
    tier: 'standard',
    category: 'Hooks',
    pts: 1,
    confidence: 'high',
    detect: {
      type: 'custom',
      fn: buildPostToolHookCheckResult,
    },
    recommendation:
      'Create format-file hook or document why it was skipped (no formatter). Claude PostToolUse hooks must read top-level `.file_path` from stdin JSON.',
    recommendationKey: 'create-format-hook',
  },
  {
    id: '2.2.4d',
    name: 'Post-tool hook reads expected JSON key',
    tier: 'standard',
    category: 'Hooks',
    pts: 1,
    confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        if (ctx.facts.stack.formatCommand === null) {
          return buildHooksCheckResult(
            '2.2.4d',
            'Post-tool hook reads expected JSON key',
            'na',
            0,
            0,
            'high',
            'No formatter detected - post-tool schema check not applicable',
          );
        }
        if (ctx.agentFacts.hooks.postToolRegistered === false) {
          return buildHooksCheckResult(
            '2.2.4d',
            'Post-tool hook reads expected JSON key',
            'na',
            0,
            0,
            'high',
            'No post-tool hook registered',
          );
        }
        if (ctx.agentFacts.hooks.postToolExists === false) {
          return buildHooksCheckResult(
            '2.2.4d',
            'Post-tool hook reads expected JSON key',
            'na',
            0,
            0,
            'high',
            'Registered post-tool hook file is missing',
          );
        }

        return buildHooksCheckResult(
          '2.2.4d',
          'Post-tool hook reads expected JSON key',
          ctx.agentFacts.hooks.postToolUsesExpectedPathField ? 'pass' : 'fail',
          ctx.agentFacts.hooks.postToolUsesExpectedPathField ? 1 : 0,
          1,
          'high',
          ctx.agentFacts.hooks.postToolUsesExpectedPathField
            ? 'Post-tool hook reads the expected top-level path field from the event payload'
            : `Post-tool hook at ${ctx.agentFacts.hooks.postToolRegisteredPath} reads the wrong JSON key. Expected top-level \`.file_path\` for the current agent event schema.`,
        );
      },
    },
    recommendation:
      'Update the post-tool hook to read the event schema the agent actually emits. Claude PostToolUse hooks should read top-level `.file_path`.',
    recommendationKey: 'create-format-hook',
  },
  {
    id: '2.2.4e',
    name: 'Post-tool hook skips agent config dirs',
    tier: 'standard',
    category: 'Hooks',
    pts: 1,
    confidence: 'medium',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        if (ctx.facts.stack.formatCommand === null) {
          return buildHooksCheckResult(
            '2.2.4e',
            'Post-tool hook skips agent config dirs',
            'na',
            0,
            0,
            'medium',
            'No formatter detected - config-dir skip check not applicable',
          );
        }
        if (ctx.agentFacts.hooks.postToolRegistered === false) {
          return buildHooksCheckResult(
            '2.2.4e',
            'Post-tool hook skips agent config dirs',
            'na',
            0,
            0,
            'medium',
            'No post-tool hook registered',
          );
        }
        if (ctx.agentFacts.hooks.postToolExists === false) {
          return buildHooksCheckResult(
            '2.2.4e',
            'Post-tool hook skips agent config dirs',
            'na',
            0,
            0,
            'medium',
            'Registered post-tool hook file is missing',
          );
        }

        return buildHooksCheckResult(
          '2.2.4e',
          'Post-tool hook skips agent config dirs',
          ctx.agentFacts.hooks.postToolSkipsAgentConfigPaths ? 'pass' : 'fail',
          ctx.agentFacts.hooks.postToolSkipsAgentConfigPaths ? 1 : 0,
          1,
          'medium',
          ctx.agentFacts.hooks.postToolSkipsAgentConfigPaths
            ? 'Post-tool hook skips agent config directories before formatting'
            : `Post-tool hook at ${ctx.agentFacts.hooks.postToolRegisteredPath} does not clearly skip agent config directories. Add guards for paths under \`.claude/\`, \`.agents/\`, and \`.gemini/\`.`,
        );
      },
    },
    recommendation:
      'Format hooks should skip agent-owned config directories (`.claude/`, `.agents/`, `.gemini/`) instead of rewriting runtime files.',
    recommendationKey: 'create-format-hook',
  },
  {
    id: '2.2.4a',
    name: 'Deny hook has blocking logic',
    tier: 'standard',
    category: 'Hooks',
    pts: 1,
    confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        if (ctx.agentFacts.hooks.denyExists === false) {
          return {
            id: '2.2.4a',
            name: 'Deny hook has blocking logic',
            tier: 'standard',
            category: 'Hooks',
            status: 'na',
            points: 0,
            maxPoints: 0,
            confidence: 'high',
            message: 'No deny hook',
          };
        }
        return {
          id: '2.2.4a',
          name: 'Deny hook has blocking logic',
          tier: 'standard',
          category: 'Hooks',
          status: ctx.agentFacts.hooks.denyHasBlocks ? 'pass' : 'fail',
          points: ctx.agentFacts.hooks.denyHasBlocks ? 1 : 0,
          maxPoints: 1,
          confidence: 'high',
          message: ctx.agentFacts.hooks.denyHasBlocks
            ? 'Deny hook has real blocking logic'
            : 'Deny hook exists but has no blocking logic (just exit 0)',
        };
      },
    },
    recommendation:
      'Deny hook should contain actual blocking patterns (exit 2 for dangerous commands), not just exit 0',
    recommendationKey: 'add-deny-blocks',
  },
  {
    id: '2.2.4b',
    name: 'Post-turn hook has validation logic',
    tier: 'standard',
    category: 'Hooks',
    pts: 1,
    confidence: 'medium',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        if (ctx.agentFacts.hooks.postTurnExists === false) {
          return {
            id: '2.2.4b',
            name: 'Post-turn hook has validation logic',
            tier: 'standard',
            category: 'Hooks',
            status: 'na',
            points: 0,
            maxPoints: 0,
            confidence: 'medium',
            message: 'No post-turn hook',
          };
        }
        return {
          id: '2.2.4b',
          name: 'Post-turn hook has validation logic',
          tier: 'standard',
          category: 'Hooks',
          status: ctx.agentFacts.hooks.postTurnHasValidation ? 'pass' : 'fail',
          points: ctx.agentFacts.hooks.postTurnHasValidation ? 1 : 0,
          maxPoints: 1,
          confidence: 'medium',
          message: ctx.agentFacts.hooks.postTurnHasValidation
            ? 'Post-turn hook runs lint/typecheck/format checks'
            : 'Post-turn hook exists but no lint/typecheck/format commands were detected. Expected shellcheck, eslint, tsc, prettier --check, `npm run lint`, or `bash scripts/preflight-checks.sh` instead of a bare `exit 0` wrapper.',
        };
      },
    },
    recommendation:
      'Post-turn hook should run actual validation (shellcheck, typecheck, lint, format check), not just exit 0',
    recommendationKey: 'add-stop-lint-validation',
  },
  {
    id: '2.2.4c',
    name: 'Compaction hook registered',
    tier: 'standard',
    category: 'Hooks',
    pts: 1,
    confidence: 'medium',
    na: (ctx) => ctx.agentFacts.agent.settingsFile === null,
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => ({
        id: '2.2.4c',
        name: 'Compaction hook registered',
        tier: 'standard',
        category: 'Hooks',
        status: ctx.agentFacts.hooks.compactionHookExists ? 'pass' : 'fail',
        points: ctx.agentFacts.hooks.compactionHookExists ? 1 : 0,
        maxPoints: 1,
        confidence: 'medium',
        message: ctx.agentFacts.hooks.compactionHookExists
          ? 'Notification hook for compaction found - context preserved across long sessions'
          : 'No compaction hook - context may be lost during long sessions. Add a Notification hook with compact matcher.',
      }),
    },
    recommendation:
      'Register a Notification hook for compaction that re-injects current task, modified files, and constraints after context compaction',
    recommendationKey: 'add-compaction-hook',
  },
  {
    id: '2.2.5a',
    name: 'Deny hook uses safe JSON parsing',
    tier: 'standard',
    category: 'Hooks',
    pts: 1,
    confidence: 'medium',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        if (ctx.agentFacts.hooks.denyExists === false) {
          return {
            id: '2.2.5a',
            name: 'Deny hook uses safe JSON parsing',
            tier: 'standard',
            category: 'Hooks',
            status: 'na',
            points: 0,
            maxPoints: 0,
            confidence: 'medium',
            message: 'No deny hook',
          };
        }
        if (ctx.agentFacts.hooks.denyIsConfigBased) {
          return {
            id: '2.2.5a',
            name: 'Deny hook uses safe JSON parsing',
            tier: 'standard',
            category: 'Hooks',
            status: 'na',
            points: 0,
            maxPoints: 0,
            confidence: 'medium',
            message:
              'Deny is config-based (settings.json or execpolicy) — JSON parsing check not applicable',
          };
        }
        return {
          id: '2.2.5a',
          name: 'Deny hook uses safe JSON parsing',
          tier: 'standard',
          category: 'Hooks',
          status: ctx.agentFacts.hooks.denyUsesJq ? 'pass' : 'fail',
          points: ctx.agentFacts.hooks.denyUsesJq ? 1 : 0,
          maxPoints: 1,
          confidence: 'medium',
          message: ctx.agentFacts.hooks.denyUsesJq
            ? 'Deny hook uses jq for JSON parsing (portable)'
            : 'Deny hook uses grep -P or regex for JSON parsing - use jq instead (grep -P is not portable to macOS)',
        };
      },
    },
    recommendation:
      'Deny hook should use jq for JSON input parsing, not grep -P (which is unavailable on macOS). Fall back to sed if jq is not installed.',
    recommendationKey: 'fix-deny-json-parsing',
  },
  {
    id: '2.2.5b',
    name: 'Deny hook handles command chaining',
    tier: 'standard',
    category: 'Hooks',
    pts: 1,
    confidence: 'medium',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        if (ctx.agentFacts.hooks.denyExists === false) {
          return {
            id: '2.2.5b',
            name: 'Deny hook handles command chaining',
            tier: 'standard',
            category: 'Hooks',
            status: 'na',
            points: 0,
            maxPoints: 0,
            confidence: 'medium',
            message: 'No deny hook',
          };
        }
        if (ctx.agentFacts.hooks.denyIsConfigBased) {
          return {
            id: '2.2.5b',
            name: 'Deny hook handles command chaining',
            tier: 'standard',
            category: 'Hooks',
            status: 'na',
            points: 0,
            maxPoints: 0,
            confidence: 'medium',
            message:
              'Deny is config-based (settings.json or execpolicy) — chaining check not applicable',
          };
        }
        return {
          id: '2.2.5b',
          name: 'Deny hook handles command chaining',
          tier: 'standard',
          category: 'Hooks',
          status: ctx.agentFacts.hooks.denyHandlesChaining ? 'pass' : 'fail',
          points: ctx.agentFacts.hooks.denyHandlesChaining ? 1 : 0,
          maxPoints: 1,
          confidence: 'medium',
          message: ctx.agentFacts.hooks.denyHandlesChaining
            ? 'Deny hook splits on && || ; before checking patterns'
            : 'Deny hook does not handle command chaining - "echo hello && rm -rf /" would bypass detection',
        };
      },
    },
    recommendation:
      'Deny hook should split commands on &&, ||, and ; then check each segment independently. Without this, chained dangerous commands bypass detection.',
    recommendationKey: 'fix-deny-chaining',
  },
  {
    id: '2.2.5c',
    name: 'Deny hook blocks rm -rf',
    tier: 'standard',
    category: 'Hooks',
    pts: 1,
    confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        if (ctx.agentFacts.hooks.denyExists === false) {
          return {
            id: '2.2.5c',
            name: 'Deny hook blocks rm -rf',
            tier: 'standard',
            category: 'Hooks',
            status: 'na',
            points: 0,
            maxPoints: 0,
            confidence: 'high',
            message: 'No deny hook',
          };
        }
        return {
          id: '2.2.5c',
          name: 'Deny hook blocks rm -rf',
          tier: 'standard',
          category: 'Hooks',
          status: ctx.agentFacts.hooks.denyBlocksRmRf ? 'pass' : 'fail',
          points: ctx.agentFacts.hooks.denyBlocksRmRf ? 1 : 0,
          maxPoints: 1,
          confidence: 'high',
          message: ctx.agentFacts.hooks.denyBlocksRmRf
            ? 'Deny hook blocks rm -rf'
            : 'Deny hook does not block rm -rf - the most dangerous destructive command must be blocked',
        };
      },
    },
    recommendation:
      'Deny hook MUST block rm -rf (and rm -fr). This is the single most dangerous command an agent can run.',
    recommendationKey: 'fix-deny-rm-rf',
  },
  {
    id: '2.2.5d',
    name: 'Read-deny covers sensitive paths',
    tier: 'standard',
    category: 'Hooks',
    pts: 1,
    confidence: 'medium',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        // Codex has no Read-deny mechanism - execpolicy only blocks shell commands, not file reads
        if (ctx.agentFacts.agent.id === 'codex') {
          return {
            id: '2.2.5d',
            name: 'Read-deny covers sensitive paths',
            tier: 'standard',
            category: 'Hooks',
            status: 'na',
            points: 0,
            maxPoints: 0,
            confidence: 'medium',
            message:
              'Codex has no Read-deny mechanism (execpolicy covers shell commands only)',
          };
        }
        if (ctx.agentFacts.settings.exists === false) {
          return {
            id: '2.2.5d',
            name: 'Read-deny covers sensitive paths',
            tier: 'standard',
            category: 'Hooks',
            status: 'na',
            points: 0,
            maxPoints: 0,
            confidence: 'medium',
            message: 'No settings file',
          };
        }
        return {
          id: '2.2.5d',
          name: 'Read-deny covers sensitive paths',
          tier: 'standard',
          category: 'Hooks',
          status: ctx.agentFacts.hooks.readDenyCoversSecrets ? 'pass' : 'fail',
          points: ctx.agentFacts.hooks.readDenyCoversSecrets ? 1 : 0,
          maxPoints: 1,
          confidence: 'medium',
          message: ctx.agentFacts.hooks.readDenyCoversSecrets
            ? 'Read-deny patterns cover .env, .ssh, .aws, and key/credential files'
            : 'Read-deny patterns are missing coverage for common sensitive paths (.env, .ssh, .aws, .pem/.key/credentials)',
        };
      },
    },
    recommendation:
      'Settings permissions.deny should include Read patterns for: .env*, .ssh/**, .aws/**, *.pem, *.key, credentials*. These prevent agents from reading secrets.',
    recommendationKey: 'fix-read-deny-secrets',
  },
  {
    id: '2.2.5g',
    name: 'Edit/Write deny mirrors Read deny for .env',
    tier: 'standard',
    category: 'Hooks',
    pts: 1,
    confidence: 'medium',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        if (ctx.agentFacts.agent.id === 'codex') {
          return buildHooksCheckResult(
            '2.2.5g',
            'Edit/Write deny mirrors Read deny for .env',
            'na',
            0,
            0,
            'medium',
            'Codex uses execpolicy, not settings deny',
          );
        }
        const denyPatterns = getDenyPatterns(ctx);
        if (denyPatterns === null) {
          return buildHooksCheckResult(
            '2.2.5g',
            'Edit/Write deny mirrors Read deny for .env',
            'na',
            0,
            0,
            'medium',
            'No deny patterns configured',
          );
        }
        const { hasReadEnv, hasEditEnv, hasWriteEnv } =
          getEnvDenyCoverage(denyPatterns);
        if (!hasReadEnv) {
          return buildHooksCheckResult(
            '2.2.5g',
            'Edit/Write deny mirrors Read deny for .env',
            'na',
            0,
            0,
            'medium',
            'No Read deny for .env — check 2.2.5d covers this',
          );
        }
        const pass = hasEditEnv && hasWriteEnv;
        return {
          id: '2.2.5g',
          name: 'Edit/Write deny mirrors Read deny for .env',
          tier: 'standard',
          category: 'Hooks',
          status: pass ? 'pass' : 'fail',
          points: pass ? 1 : 0,
          maxPoints: 1,
          confidence: 'medium',
          message: pass
            ? 'Edit and Write deny patterns exist for .env alongside Read deny'
            : `Read(.env) is denied but ${formatMissingEnvDenyActions(hasEditEnv, hasWriteEnv)} is not — agents can still modify secrets`,
        };
      },
    },
    recommendation:
      'If Read(**/.env*) is denied, also add Edit(**/.env*) and Write(**/.env*) to permissions.deny. Without these, agents can still modify secret files even though they cannot read them.',
    recommendationKey: 'fix-edit-write-deny-env',
  },
  {
    id: '2.2.5e',
    name: 'Deny hook blocks force push',
    tier: 'standard',
    category: 'Hooks',
    pts: 1,
    confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        if (ctx.agentFacts.hooks.denyExists === false) {
          return {
            id: '2.2.5e',
            name: 'Deny hook blocks force push',
            tier: 'standard',
            category: 'Hooks',
            status: 'na',
            points: 0,
            maxPoints: 0,
            confidence: 'high',
            message: 'No deny hook',
          };
        }
        return {
          id: '2.2.5e',
          name: 'Deny hook blocks force push',
          tier: 'standard',
          category: 'Hooks',
          status: ctx.agentFacts.hooks.denyBlocksForcePush ? 'pass' : 'fail',
          points: ctx.agentFacts.hooks.denyBlocksForcePush ? 1 : 0,
          maxPoints: 1,
          confidence: 'high',
          message: ctx.agentFacts.hooks.denyBlocksForcePush
            ? 'Deny hook blocks force push'
            : 'Deny hook does not block force push - agents must never force push',
        };
      },
    },
    recommendation:
      'Deny hook MUST block force push (--force flag on git push). Force push can destroy shared branch history.',
    recommendationKey: 'fix-deny-force-push',
  },
  {
    id: '2.2.5f',
    name: 'Deny hook blocks chmod 777',
    tier: 'standard',
    category: 'Hooks',
    pts: 1,
    confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        if (ctx.agentFacts.hooks.denyExists === false) {
          return {
            id: '2.2.5f',
            name: 'Deny hook blocks chmod 777',
            tier: 'standard',
            category: 'Hooks',
            status: 'na',
            points: 0,
            maxPoints: 0,
            confidence: 'high',
            message: 'No deny hook',
          };
        }
        return {
          id: '2.2.5f',
          name: 'Deny hook blocks chmod 777',
          tier: 'standard',
          category: 'Hooks',
          status: ctx.agentFacts.hooks.denyBlocksChmod ? 'pass' : 'fail',
          points: ctx.agentFacts.hooks.denyBlocksChmod ? 1 : 0,
          maxPoints: 1,
          confidence: 'high',
          message: ctx.agentFacts.hooks.denyBlocksChmod
            ? 'Deny hook blocks chmod 777'
            : 'Deny hook does not block chmod 777 - world-writable permissions are a security risk',
        };
      },
    },
    recommendation:
      'Deny hook MUST block chmod 777. World-writable permissions are a security vulnerability.',
    recommendationKey: 'fix-deny-chmod',
  },
  {
    id: '2.2.5i',
    name: 'Deny hook blocks pipe-to-shell',
    tier: 'standard',
    category: 'Hooks',
    pts: 1,
    confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        if (ctx.agentFacts.hooks.denyExists === false) {
          return {
            id: '2.2.5i',
            name: 'Deny hook blocks pipe-to-shell',
            tier: 'standard',
            category: 'Hooks',
            status: 'na',
            points: 0,
            maxPoints: 0,
            confidence: 'high',
            message: 'No deny hook',
          };
        }
        return {
          id: '2.2.5i',
          name: 'Deny hook blocks pipe-to-shell',
          tier: 'standard',
          category: 'Hooks',
          status: ctx.agentFacts.hooks.denyBlocksPipeToShell
            ? 'pass'
            : 'fail',
          points: ctx.agentFacts.hooks.denyBlocksPipeToShell ? 1 : 0,
          maxPoints: 1,
          confidence: 'high',
          message: ctx.agentFacts.hooks.denyBlocksPipeToShell
            ? 'Deny hook blocks pipe-to-shell commands'
            : 'Deny hook does not block pipe-to-shell commands like `curl | bash` or `wget | sh`, which let agents execute remote code without inspection',
        };
      },
    },
    recommendation:
      'Deny hook MUST block pipe-to-shell patterns such as `curl | bash` and `wget | sh`. Agents should download scripts for inspection instead of piping them straight into a shell.',
    recommendationKey: 'fix-deny-pipe-to-shell',
  },
  {
    id: '2.2.5',
    name: 'Preflight script',
    tier: 'standard',
    category: 'Hooks',
    pts: 1,
    confidence: 'high',
    detect: { type: 'file_exists', path: 'scripts/preflight-checks.sh' },
    recommendation: 'Create scripts/preflight-checks.sh',
    recommendationKey: 'create-preflight-script',
  },
  {
    id: '2.2.6',
    name: 'Context validation',
    tier: 'standard',
    category: 'Hooks',
    pts: 1,
    confidence: 'high',
    detect: {
      type: 'composite',
      mode: 'any',
      checks: [
        { type: 'file_exists', path: 'scripts/context-validate.sh' },
        {
          type: 'file_exists',
          path: '.github/workflows/context-validation.yml',
        },
      ],
    },
    recommendation: 'Create context validation script or CI workflow',
    recommendationKey: 'create-context-validation',
  },
  // 2.2.7 (Ask First mechanical enforcement) removed - see ADR-006.
  // The hook blocks normal development on framework projects. Ask First
  // boundaries remain as policy in the instruction file.

  // === 2.3 Learning Loop (6 pts) ===
  {
    id: '2.3.1',
    name: 'Lessons directory exists',
    tier: 'standard',
    category: 'Learning Loop',
    pts: 1,
    confidence: 'high',
    detect: { type: 'dir_exists', path: '{lessons_committed_dir}' },
    recommendation: 'Create the committed lessons directory',
    recommendationKey: 'create-lessons',
  },
  // 2.3.2 removed - duplicate of 2.3.2a (hasEntries === entryCount >= 1)
  {
    id: '2.3.3',
    name: 'Footguns directory exists',
    tier: 'standard',
    category: 'Learning Loop',
    pts: 2,
    confidence: 'high',
    detect: { type: 'dir_exists', path: '{footguns_committed_dir}' },
    recommendation: 'Create the committed footguns directory',
    recommendationKey: 'create-footguns',
  },
  {
    id: '2.3.4',
    name: 'Footguns have file:line evidence',
    tier: 'standard',
    category: 'Learning Loop',
    pts: 2,
    confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { hasEvidence, staleRefs, invalidLineRefs, formatDiagnostic } =
          ctx.facts.shared.footguns;

        if (hasEvidence === false) {
          return {
            id: '2.3.4',
            name: 'Footguns have file:line evidence',
            tier: 'standard',
            category: 'Learning Loop',
            status: 'fail',
            points: 0,
            maxPoints: 2,
            confidence: 'high',
            message:
              formatDiagnostic ??
              'Footguns are missing file:line evidence. Expected backtick-wrapped refs like `src/auth.ts:42` or `src/auth.ts:42-50`; bare paths, URLs, and prose-only incidents do not count.',
          };
        }

        if (staleRefs.length > 0) {
          return {
            id: '2.3.4',
            name: 'Footguns have file:line evidence',
            tier: 'standard',
            category: 'Learning Loop',
            status: 'fail',
            points: 0,
            maxPoints: 2,
            confidence: 'high',
            message: `Footgun evidence cites missing files: ${staleRefs.slice(0, 3).join(', ')}. Update the cited paths or remove the stale incident.`,
          };
        }

        if (invalidLineRefs.length > 0) {
          return {
            id: '2.3.4',
            name: 'Footguns have file:line evidence',
            tier: 'standard',
            category: 'Learning Loop',
            status: 'fail',
            points: 0,
            maxPoints: 2,
            confidence: 'high',
            message: `Footgun evidence cites out-of-range lines: ${invalidLineRefs.slice(0, 3).join(', ')}. Update the line numbers so they point at real lines in the cited file.`,
          };
        }

        return {
          id: '2.3.4',
          name: 'Footguns have file:line evidence',
          tier: 'standard',
          category: 'Learning Loop',
          status: 'pass',
          points: 2,
          maxPoints: 2,
          confidence: 'high',
          message: 'Footguns have file:line evidence',
        };
      },
    },
    recommendation: 'Add file:line evidence to footgun entries',
    recommendationKey: 'add-footgun-evidence',
  },
  {
    id: '2.3.2a',
    name: 'lessons.md has at least 1 entry',
    tier: 'standard',
    category: 'Learning Loop',
    pts: 1,
    partialPts: 0,
    confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { exists, entryCount } = ctx.facts.shared.lessons;
        if (!exists)
          return {
            id: '2.3.2a',
            name: 'lessons.md has at least 1 entry',
            tier: 'standard',
            category: 'Learning Loop',
            status: 'na',
            points: 0,
            maxPoints: 0,
            confidence: 'high',
            message: 'No lesson directories',
          };
        if (entryCount >= 1) {
          const { committedCount, localCount } = ctx.facts.shared.lessons;
          return {
            id: '2.3.2a',
            name: 'lessons.md has at least 1 entry',
            tier: 'standard',
            category: 'Learning Loop',
            status: 'pass',
            points: 1,
            maxPoints: 1,
            confidence: 'high',
            message: `${entryCount} lesson entries (${committedCount} committed, ${localCount} local)`,
          };
        }
        const diagnostic = ctx.facts.shared.lessons.formatDiagnostic;
        return {
          id: '2.3.2a',
          name: 'lessons.md has at least 1 entry',
          tier: 'standard',
          category: 'Learning Loop',
          status: 'fail',
          points: 0,
          maxPoints: 1,
          confidence: 'high',
          message:
            diagnostic ??
            'No lesson entries found across `ai/lessons/` and `.goat-flow/lessons/`. Add at least one real incident from git history, or a placeholder explaining why none apply yet.',
        };
      },
    },
    recommendation:
      'Seed the lessons directories with at least 1 real incident from git history (3-5 is ideal)',
    recommendationKey: 'seed-lessons-minimum',
  },
  // 2.3.5 removed - duplicate of AP12 (stale footgun refs)
  {
    id: '2.3.5a',
    name: 'Footguns have evidence labels',
    tier: 'standard',
    category: 'Learning Loop',
    pts: 1,
    confidence: 'high',
    na: (ctx) =>
      ctx.facts.shared.footguns.exists === false ||
      ctx.facts.shared.footguns.hasEvidence === false,
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { entryCount, labelCount, hasEvidenceLabels } =
          ctx.facts.shared.footguns;
        return {
          id: '2.3.5a',
          name: 'Footguns have evidence labels',
          tier: 'standard',
          category: 'Learning Loop',
          status: hasEvidenceLabels ? 'pass' : 'fail',
          points: hasEvidenceLabels ? 1 : 0,
          maxPoints: 1,
          confidence: 'high',
          message: hasEvidenceLabels
            ? `${labelCount}/${entryCount} footgun entries have evidence labels`
            : (ctx.facts.shared.footguns.formatDiagnostic ??
              `Only ${labelCount}/${entryCount} footgun entries have evidence labels`),
        };
      },
    },
    recommendation:
      'Add evidence type labels to footgun entries. Expected format: `**Evidence type:** ACTUAL_MEASURED` (or DESIGN_TARGET, HYPOTHETICAL_EXAMPLE)',
    recommendationKey: 'add-footgun-labels',
  },
  {
    id: '2.3.5b',
    name: 'Learning-loop surfaces are canonical',
    tier: 'standard',
    category: 'Learning Loop',
    pts: 1,
    confidence: 'high',
    na: (ctx) =>
      ctx.facts.shared.footguns.exists === false &&
      ctx.facts.shared.lessons.exists === false,
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const duplicates = [
          ...ctx.facts.shared.footguns.duplicateSurfacePaths,
          ...ctx.facts.shared.lessons.duplicateSurfacePaths,
        ].sort((a, b) => a.localeCompare(b));

        return {
          id: '2.3.5b',
          name: 'Learning-loop surfaces are canonical',
          tier: 'standard',
          category: 'Learning Loop',
          status: duplicates.length === 0 ? 'pass' : 'fail',
          points: duplicates.length === 0 ? 1 : 0,
          maxPoints: 1,
          confidence: 'high',
          message:
            duplicates.length === 0
              ? 'Only the configured committed/local learning-loop bucket paths are present'
              : `Competing learning-loop surfaces found: ${duplicates.join(', ')}. Keep only the configured bucket paths from .goat-flow/config.yaml.`,
        };
      },
    },
    recommendation:
      'Remove or migrate duplicate lessons/footguns surfaces so only the configured bucket paths remain',
    recommendationKey: 'ap-fix-duplicate-learning-loop-surfaces',
  },

  {
    id: '2.3.6',
    name: 'Lessons file references resolve',
    tier: 'standard',
    category: 'Learning Loop',
    pts: 1,
    confidence: 'medium',
    na: (ctx) =>
      !ctx.facts.shared.lessons.exists ||
      ctx.facts.shared.lessons.staleRefs.length === 0,
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { staleRefs } = ctx.facts.shared.lessons;
        if (staleRefs.length === 0) {
          return {
            id: '2.3.6',
            name: 'Lessons file references resolve',
            tier: 'standard',
            category: 'Learning Loop',
            status: 'pass',
            points: 1,
            maxPoints: 1,
            confidence: 'medium',
            message: 'All lesson file references resolve',
          };
        }
        return {
          id: '2.3.6',
          name: 'Lessons file references resolve',
          tier: 'standard',
          category: 'Learning Loop',
          status: 'fail',
          points: 0,
          maxPoints: 1,
          confidence: 'medium',
          message: `${staleRefs.length} stale refs in lesson entries: ${staleRefs.slice(0, 3).join(', ')}`,
        };
      },
    },
    recommendation:
      'Update or remove stale file path references in lesson entries',
    recommendationKey: 'fix-lesson-stale-refs',
  },

  {
    id: '2.3.7',
    name: 'Session logs referenced',
    tier: 'standard',
    category: 'Learning Loop',
    pts: 1,
    confidence: 'high',
    detect: {
      type: 'grep',
      path: '{instruction_file}',
      pattern: 'logs/sessions|session.log|session.*summary',
    },
    recommendation:
      'Add session log path to the LOG step and router table: `.goat-flow/logs/sessions/YYYY-MM-DD-slug.md`',
    recommendationKey: 'add-session-logs',
  },

  // === 2.4 Router Table (10 pts) ===
  {
    id: '2.4.1',
    name: 'Router section exists',
    tier: 'standard',
    category: 'Router Table',
    pts: 1,
    confidence: 'high',
    detect: {
      type: 'grep',
      path: '{instruction_file}',
      pattern: 'router|## Router',
    },
    recommendation: 'Add a Router Table section to the instruction file',
    recommendationKey: 'add-router',
  },
  {
    id: '2.4.2',
    name: 'Router references resolve',
    tier: 'standard',
    category: 'Router Table',
    pts: 3,
    partialPts: 1,
    confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { paths, resolved, unresolved } = ctx.agentFacts.router;
        if (paths.length === 0) {
          return {
            id: '2.4.2',
            name: 'Router references resolve',
            tier: 'standard',
            category: 'Router Table',
            status: 'fail',
            points: 0,
            maxPoints: 3,
            confidence: 'high',
            message:
              'No router paths found. Expected the router table to include backtick-wrapped repo paths or directories that agents can navigate to.',
          };
        }
        if (unresolved.length === 0) {
          return {
            id: '2.4.2',
            name: 'Router references resolve',
            tier: 'standard',
            category: 'Router Table',
            status: 'pass',
            points: 3,
            maxPoints: 3,
            confidence: 'high',
            message: `All ${resolved} router paths resolve`,
          };
        }
        if (resolved > 0) {
          return {
            id: '2.4.2',
            name: 'Router references resolve',
            tier: 'standard',
            category: 'Router Table',
            status: 'partial',
            points: 1,
            maxPoints: 3,
            confidence: 'high',
            message: `${resolved}/${paths.length} router paths resolve. Missing paths: ${unresolved.join(', ')}. Fix or remove the broken entries so the router is trustworthy.`,
            evidence: unresolved.join(', '),
          };
        }
        return {
          id: '2.4.2',
          name: 'Router references resolve',
          tier: 'standard',
          category: 'Router Table',
          status: 'fail',
          points: 0,
          maxPoints: 3,
          confidence: 'high',
          message: `None of the ${paths.length} router paths resolve. Replace the router entries with real repo paths before relying on it.`,
        };
      },
    },
    recommendation: 'Fix broken router table references',
    recommendationKey: 'fix-router-refs',
  },
  {
    id: '2.4.3',
    name: 'Skills referenced in router',
    tier: 'standard',
    category: 'Router Table',
    pts: 1,
    confidence: 'high',
    detect: {
      type: 'custom',
      fn: getRouterSkillsCheckResult,
    },
    recommendation: 'Add skill directories to the router table',
    recommendationKey: 'route-skills',
  },

  // === 2.4.4-2.4.8 Router completeness (5 pts) ===
  {
    id: '2.4.4',
    name: 'Learning loop in router',
    tier: 'standard',
    category: 'Router Table',
    pts: 1,
    confidence: 'high',
    na: (ctx) =>
      !ctx.agentFacts.instruction.content?.toLowerCase().includes('router'),
    detect: {
      type: 'grep',
      path: '{instruction_file}',
      section: 'router',
      pattern: 'lessons|footguns|learning',
    },
    recommendation: 'Add lessons and footguns directories to the router table',
    recommendationKey: 'route-learning-loop',
  },
  {
    id: '2.4.5',
    name: 'Architecture in router',
    tier: 'standard',
    category: 'Router Table',
    pts: 1,
    confidence: 'high',
    na: (ctx) =>
      !ctx.agentFacts.instruction.content?.toLowerCase().includes('router'),
    detect: {
      type: 'grep',
      path: '{instruction_file}',
      section: 'router',
      pattern: 'architecture|arch',
    },
    recommendation: 'Add docs/architecture.md to the router table',
    recommendationKey: 'route-architecture',
  },
  {
    id: '2.4.6',
    name: 'Evals in router',
    tier: 'standard',
    category: 'Router Table',
    pts: 1,
    confidence: 'high',
    na: (ctx) =>
      !ctx.agentFacts.instruction.content?.toLowerCase().includes('router') ||
      !ctx.facts.shared.evals.dirExists,
    detect: {
      type: 'grep',
      path: '{instruction_file}',
      section: 'router',
      pattern: 'eval|agent-eval',
    },
    recommendation: 'Add ai/evals/ to the router table',
    recommendationKey: 'route-evals',
  },
  {
    id: '2.4.7',
    name: 'Handoff template in router',
    tier: 'standard',
    category: 'Router Table',
    pts: 1,
    confidence: 'high',
    na: (ctx) =>
      !ctx.agentFacts.instruction.content?.toLowerCase().includes('router'),
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult =>
        getRequiredRouterPathCheckResult(
          '2.4.7',
          'Handoff template in router',
          '.goat-flow/tasks/handoff-template.md',
          'Add the shared handoff template path so agents can jump straight to the canonical incomplete-work artifact.',
          ctx,
        ),
    },
    recommendation:
      'Add .goat-flow/tasks/handoff-template.md to the router table',
    recommendationKey: 'route-handoff',
  },
  {
    id: '2.4.8',
    name: 'Config in router',
    tier: 'standard',
    category: 'Router Table',
    pts: 1,
    confidence: 'high',
    na: (ctx) =>
      !ctx.agentFacts.instruction.content?.toLowerCase().includes('router'),
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult =>
        getRequiredRouterPathCheckResult(
          '2.4.8',
          'Config in router',
          '.goat-flow/config.yaml',
          'Add the config path so agents can find project settings without guessing.',
          ctx,
        ),
    },
    recommendation: 'Add .goat-flow/config.yaml to the router table',
    recommendationKey: 'route-config',
  },

  // === 2.5 Architecture Docs (3 pts) ===
  {
    id: '2.5.1',
    name: 'architecture.md exists',
    tier: 'standard',
    category: 'Architecture',
    pts: 1,
    confidence: 'high',
    detect: { type: 'file_exists', path: 'docs/architecture.md' },
    recommendation: 'Create docs/architecture.md',
    recommendationKey: 'create-architecture',
  },
  {
    id: '2.5.2',
    name: 'architecture.md under 100 lines',
    tier: 'standard',
    category: 'Architecture',
    pts: 1,
    confidence: 'high',
    na: (ctx) => ctx.facts.shared.architecture.exists === false,
    detect: {
      type: 'line_count',
      path: 'docs/architecture.md',
      pass: 100,
      fail: 150,
    },
    recommendation: 'Compress docs/architecture.md below 100 lines',
    recommendationKey: 'compress-architecture',
  },
  {
    id: '2.5.3',
    name: 'decisions dir has real ADR content',
    tier: 'standard',
    category: 'Architecture',
    pts: 1,
    confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { dirExists, fileCount, hasRealContent } =
          ctx.facts.shared.decisions;
        if (!dirExists || fileCount === 0) {
          return {
            id: '2.5.3',
            name: 'decisions dir has real ADR content',
            tier: 'standard',
            category: 'Architecture',
            status: 'fail',
            points: 0,
            maxPoints: 1,
            confidence: 'high',
            message: dirExists
              ? 'Directory exists but no ADR files'
              : 'No decisions directory',
          };
        }
        return {
          id: '2.5.3',
          name: 'decisions dir has real ADR content',
          tier: 'standard',
          category: 'Architecture',
          status: hasRealContent ? 'pass' : 'fail',
          points: hasRealContent ? 1 : 0,
          maxPoints: 1,
          confidence: 'high',
          message: hasRealContent
            ? `${fileCount} ADR files, real content found`
            : `${fileCount} ADR files but none have real Context + Decision sections (≥50 chars, not TODO/TBD)`,
        };
      },
    },
    recommendation:
      'Create ai/decisions/ with at least 1 ADR containing real Context and Decision sections',
    recommendationKey: 'create-decisions-dir',
  },
  // === 2.6 Local Instructions (cold path) (6 pts) ===
  {
    id: '2.6.1',
    name: 'Instructions directory exists',
    tier: 'standard',
    category: 'Local Instructions',
    pts: 1,
    confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { dirExists, location } = ctx.facts.shared.localInstructions;
        return {
          id: '2.6.1',
          name: 'Instructions directory exists',
          tier: 'standard',
          category: 'Local Instructions',
          status: dirExists ? 'pass' : 'fail',
          points: dirExists ? 1 : 0,
          maxPoints: 1,
          confidence: 'high',
          message: dirExists
            ? `Found at ${location === 'ai' ? 'ai/coding-standards/' : '.github/instructions/'}`
            : 'No ai/coding-standards/ or .github/instructions/ directory',
        };
      },
    },
    recommendation:
      'Create ai/coding-standards/ with project coding guidelines',
    recommendationKey: 'create-instructions-dir',
  },
  {
    id: '2.6.1a',
    name: 'Instruction surfaces are canonical',
    tier: 'standard',
    category: 'Local Instructions',
    pts: 1,
    confidence: 'high',
    na: (ctx) => ctx.facts.shared.localInstructions.dirExists === false,
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { duplicateSurfacePaths } = ctx.facts.shared.localInstructions;
        const hasDuplicateSurfaces = duplicateSurfacePaths.length > 0;
        return {
          id: '2.6.1a',
          name: 'Instruction surfaces are canonical',
          tier: 'standard',
          category: 'Local Instructions',
          status: hasDuplicateSurfaces ? 'fail' : 'pass',
          points: hasDuplicateSurfaces ? 0 : 1,
          maxPoints: 1,
          confidence: 'high',
          message: hasDuplicateSurfaces
            ? `Duplicate instruction surfaces found: ${duplicateSurfacePaths.join(', ')}. Keep one canonical local-instructions surface instead of maintaining both.`
            : 'Exactly one local-instructions surface is in use',
          evidence: hasDuplicateSurfaces
            ? duplicateSurfacePaths.join(', ')
            : undefined,
        };
      },
    },
    recommendation:
      'Keep one canonical local-instructions surface and remove the duplicate copy',
    recommendationKey: 'fix-duplicate-instruction-surfaces',
  },
  {
    id: '2.6.2',
    name: 'Router exists',
    tier: 'standard',
    category: 'Local Instructions',
    pts: 1,
    confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { hasRouter, hasValidRouter, routerNeedsFix, dirExists } =
          ctx.facts.shared.localInstructions;
        if (dirExists === false) {
          return {
            id: '2.6.2',
            name: 'Router exists',
            tier: 'standard',
            category: 'Local Instructions',
            status: 'fail',
            points: 0,
            maxPoints: 1,
            confidence: 'high',
            message:
              'No local instructions directory found. Expected `ai/` with an `ai/README.md` router when project instruction files exist.',
          };
        }
        if (!hasValidRouter && routerNeedsFix !== null) {
          return {
            id: '2.6.2',
            name: 'Router exists',
            tier: 'standard',
            category: 'Local Instructions',
            status: 'fail',
            points: 0,
            maxPoints: 1,
            confidence: 'high',
            message: routerNeedsFix,
          };
        }
        return {
          id: '2.6.2',
          name: 'Router exists',
          tier: 'standard',
          category: 'Local Instructions',
          status: hasRouter ? 'pass' : 'fail',
          points: hasRouter ? 1 : 0,
          maxPoints: 1,
          confidence: 'high',
          message: hasRouter
            ? 'ai/README.md exists and router links are valid'
            : 'ai/README.md not found. Create a router file so agents can discover instruction files under `ai/`.',
        };
      },
    },
    recommendation: 'Create ai/README.md as routing map for instruction files',
    recommendationKey: 'create-instructions-router',
  },
  {
    id: '2.6.3',
    name: 'conventions.md exists',
    tier: 'standard',
    category: 'Local Instructions',
    pts: 1,
    confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { hasConventions, dirExists } =
          ctx.facts.shared.localInstructions;
        if (dirExists === false) {
          return {
            id: '2.6.3',
            name: 'conventions.md exists',
            tier: 'standard',
            category: 'Local Instructions',
            status: 'fail',
            points: 0,
            maxPoints: 1,
            confidence: 'high',
            message: 'No instructions directory',
          };
        }
        return {
          id: '2.6.3',
          name: 'conventions.md exists',
          tier: 'standard',
          category: 'Local Instructions',
          status: hasConventions ? 'pass' : 'fail',
          points: hasConventions ? 1 : 0,
          maxPoints: 1,
          confidence: 'high',
          message: hasConventions
            ? 'conventions.md found'
            : 'conventions.md not found - project needs a universal coding contract',
        };
      },
    },
    recommendation:
      'Create ai/coding-standards/conventions.md with project-wide conventions',
    recommendationKey: 'create-conventions-instructions',
  },
  {
    id: '2.6.3a',
    name: 'conventions.md has real content',
    tier: 'standard',
    category: 'Local Instructions',
    pts: 1,
    confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        if (ctx.facts.shared.localInstructions.hasConventions === false) {
          return {
            id: '2.6.3a',
            name: 'conventions.md has real content',
            tier: 'standard',
            category: 'Local Instructions',
            status: 'na',
            points: 0,
            maxPoints: 0,
            confidence: 'high',
            message: 'No conventions.md',
          };
        }
        return {
          id: '2.6.3a',
          name: 'conventions.md has real content',
          tier: 'standard',
          category: 'Local Instructions',
          status: ctx.facts.shared.localInstructions.conventionsHasContent
            ? 'pass'
            : 'fail',
          points: ctx.facts.shared.localInstructions.conventionsHasContent
            ? 1
            : 0,
          maxPoints: 1,
          confidence: 'high',
          message: ctx.facts.shared.localInstructions.conventionsHasContent
            ? 'conventions.md has commands and conventions'
            : 'conventions.md exists but lacks commands or conventions - a stub is not useful',
        };
      },
    },
    recommendation:
      "conventions.md should include: build/test/lint commands, coding conventions (DO/DON'T), and dangerous operations",
    recommendationKey: 'improve-conventions-instructions',
  },
  {
    id: '2.6.4',
    name: 'code-review.md exists',
    tier: 'standard',
    category: 'Local Instructions',
    pts: 1,
    confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { hasCodeReview, dirExists } = ctx.facts.shared.localInstructions;
        if (dirExists === false) {
          return {
            id: '2.6.4',
            name: 'code-review.md exists',
            tier: 'standard',
            category: 'Local Instructions',
            status: 'fail',
            points: 0,
            maxPoints: 1,
            confidence: 'high',
            message: 'No instructions directory',
          };
        }
        return {
          id: '2.6.4',
          name: 'code-review.md exists',
          tier: 'standard',
          category: 'Local Instructions',
          status: hasCodeReview ? 'pass' : 'fail',
          points: hasCodeReview ? 1 : 0,
          maxPoints: 1,
          confidence: 'high',
          message: hasCodeReview
            ? 'code-review.md found'
            : 'code-review.md not found - project needs review standards',
        };
      },
    },
    recommendation:
      'Create ai/coding-standards/code-review.md with review standards',
    recommendationKey: 'create-code-review-instructions',
  },
  {
    id: '2.6.5',
    name: 'git-commit.md exists',
    tier: 'standard',
    category: 'Local Instructions',
    pts: 1,
    confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { hasGitCommit, dirExists } = ctx.facts.shared.localInstructions;
        if (dirExists === false) {
          return {
            id: '2.6.5',
            name: 'git-commit.md exists',
            tier: 'standard',
            category: 'Local Instructions',
            status: 'fail',
            points: 0,
            maxPoints: 1,
            confidence: 'high',
            message: 'No instructions directory',
          };
        }
        return {
          id: '2.6.5',
          name: 'git-commit.md exists',
          tier: 'standard',
          category: 'Local Instructions',
          status: hasGitCommit ? 'pass' : 'fail',
          points: hasGitCommit ? 1 : 0,
          maxPoints: 1,
          confidence: 'high',
          message: hasGitCommit
            ? 'git-commit.md found'
            : 'git-commit.md not found - project needs commit conventions',
        };
      },
    },
    recommendation:
      'Create ai/coding-standards/git-commit.md with commit format and PR workflow',
    recommendationKey: 'create-git-commit-instructions',
  },
  {
    id: '2.6.6',
    name: 'git-commit-instructions.md in .github/',
    tier: 'standard',
    category: 'Local Instructions',
    pts: 1,
    confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => ({
        id: '2.6.6',
        name: 'git-commit-instructions.md in .github/',
        tier: 'standard',
        category: 'Local Instructions',
        status: ctx.facts.shared.gitCommitInstructions.exists ? 'pass' : 'fail',
        points: ctx.facts.shared.gitCommitInstructions.exists ? 1 : 0,
        maxPoints: 1,
        confidence: 'high',
        message: ctx.facts.shared.gitCommitInstructions.exists
          ? '.github/git-commit-instructions.md found'
          : '.github/git-commit-instructions.md not found',
      }),
    },
    recommendation:
      'Create .github/git-commit-instructions.md for universal commit guidance',
    recommendationKey: 'create-github-git-commit',
  },
  {
    id: '2.6.7a',
    name: 'frontend.md exists for projects with a detected frontend/UI stack',
    tier: 'standard',
    category: 'Local Instructions',
    pts: 1,
    confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const checkName =
          'frontend.md exists for projects with a detected frontend/UI stack';
        const { hasFrontend, dirExists } = ctx.facts.shared.localInstructions;
        if (dirExists === false) {
          return {
            id: '2.6.7a',
            name: checkName,
            tier: 'standard',
            category: 'Local Instructions',
            status: 'na',
            points: 0,
            maxPoints: 0,
            confidence: 'high',
            message: 'No instructions directory',
          };
        }
        const langs = ctx.facts.stack.languages.map((l) => l.toLowerCase());
        const frontendSignals = [
          'typescript',
          'javascript',
          'react',
          'vue',
          'angular',
          'svelte',
        ];
        const needsFrontend = langs.some((l) => frontendSignals.includes(l));
        if (!needsFrontend) {
          return {
            id: '2.6.7a',
            name: checkName,
            tier: 'standard',
            category: 'Local Instructions',
            status: 'na',
            points: 0,
            maxPoints: 0,
            confidence: 'high',
            message: 'No frontend/UI stack detected',
          };
        }
        return {
          id: '2.6.7a',
          name: checkName,
          tier: 'standard',
          category: 'Local Instructions',
          status: hasFrontend ? 'pass' : 'fail',
          points: hasFrontend ? 1 : 0,
          maxPoints: 1,
          confidence: 'high',
          message: hasFrontend
            ? 'frontend.md found'
            : 'Project with frontend/UI stack should have frontend.md',
        };
      },
    },
    recommendation:
      'Create ai/coding-standards/frontend.md with frontend coding conventions for the detected UI stack',
    recommendationKey: 'create-frontend-instructions',
  },
  {
    id: '2.6.7b',
    name: 'backend.md exists for backend-language projects',
    tier: 'standard',
    category: 'Local Instructions',
    pts: 1,
    confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { hasBackend, dirExists } = ctx.facts.shared.localInstructions;
        if (dirExists === false) {
          return {
            id: '2.6.7b',
            name: 'backend.md exists for backend-language projects',
            tier: 'standard',
            category: 'Local Instructions',
            status: 'na',
            points: 0,
            maxPoints: 0,
            confidence: 'high',
            message: 'No instructions directory',
          };
        }
        const langs = ctx.facts.stack.languages.map((l) => l.toLowerCase());
        const backendLangs = ['go', 'python', 'rust', 'php'];
        const needsBackend = langs.some((l) => backendLangs.includes(l));
        if (!needsBackend) {
          return {
            id: '2.6.7b',
            name: 'backend.md exists for backend-language projects',
            tier: 'standard',
            category: 'Local Instructions',
            status: 'na',
            points: 0,
            maxPoints: 0,
            confidence: 'high',
            message: 'No backend language detected',
          };
        }
        const detectedLang = langs.find((l) => backendLangs.includes(l));
        return {
          id: '2.6.7b',
          name: 'backend.md exists for backend-language projects',
          tier: 'standard',
          category: 'Local Instructions',
          status: hasBackend ? 'pass' : 'fail',
          points: hasBackend ? 1 : 0,
          maxPoints: 1,
          confidence: 'high',
          message: hasBackend
            ? 'backend.md found'
            : `${detectedLang} project should have backend.md`,
        };
      },
    },
    recommendation:
      'Create ai/coding-standards/backend.md with backend coding conventions',
    recommendationKey: 'create-backend-instructions',
  },

  {
    id: '2.2.5h',
    name: 'Deny hook blocks cloud-destructive commands',
    tier: 'standard',
    category: 'Hooks',
    pts: 1,
    confidence: 'high',
    na: (ctx) =>
      ctx.agentFacts.hooks.denyExists === false ||
      ctx.facts.stack.signals.deployPlatforms.length === 0,
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => ({
        id: '2.2.5h',
        name: 'Deny hook blocks cloud-destructive commands',
        tier: 'standard',
        category: 'Hooks',
        status: ctx.agentFacts.hooks.denyBlocksCloudDestructive
          ? 'pass'
          : 'fail',
        points: ctx.agentFacts.hooks.denyBlocksCloudDestructive ? 1 : 0,
        maxPoints: 1,
        confidence: 'high',
        message: ctx.agentFacts.hooks.denyBlocksCloudDestructive
          ? 'Deny hook blocks cloud-destructive commands'
          : `Deploy platforms detected (${ctx.facts.stack.signals.deployPlatforms.join(', ')}) but deny hook does not block cloud-destructive commands (docker push, terraform destroy, aws s3 rm, etc.)`,
      }),
    },
    recommendation:
      'Deny hook should block cloud-destructive commands when deploy platforms are detected: docker push, terraform destroy, terraform apply -auto-approve, aws s3 rm, aws ec2 terminate-instances.',
    recommendationKey: 'fix-deny-cloud-destructive',
  },

  // === 2.7 Signal Follow-Through (signal-conditional checks) ===
  {
    id: '2.7.1',
    name: 'LLM integration addressed in instruction file',
    tier: 'standard',
    category: 'Signal Follow-Through',
    pts: 1,
    confidence: 'medium',
    na: (ctx) => !ctx.facts.stack.signals.llmIntegration,
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const content = ctx.agentFacts.instruction.content?.toLowerCase() ?? '';
        const addressed =
          /llm|prompt|model|ai\s+integration/i.test(content) &&
          /ask first|boundary|router/i.test(content);
        return {
          id: '2.7.1',
          name: 'LLM integration addressed in instruction file',
          tier: 'standard',
          category: 'Signal Follow-Through',
          status: addressed ? 'pass' : 'fail',
          points: addressed ? 1 : 0,
          maxPoints: 1,
          confidence: 'medium',
          message: addressed
            ? 'Instruction file addresses LLM integration'
            : 'LLM integration detected but instruction file does not address prompt handling or LLM boundaries',
        };
      },
    },
    recommendation:
      'LLM integration detected - add prompt/template paths to Router Table and "prompt changes require scenario testing" to Ask First boundaries',
    recommendationKey: 'fix-llm-signal-followthrough',
  },
  {
    id: '2.7.2',
    name: 'PHI/compliance on hot path',
    tier: 'standard',
    category: 'Signal Follow-Through',
    pts: 1,
    confidence: 'medium',
    na: (ctx) => !ctx.facts.stack.signals.complianceSignals,
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const content = ctx.agentFacts.instruction.content ?? '';
        const onHotPath =
          /\bPHI\b|HIPAA|patient.*data|tenant.*scope|MUST NOT log/i.test(
            content,
          );
        return {
          id: '2.7.2',
          name: 'PHI/compliance on hot path',
          tier: 'standard',
          category: 'Signal Follow-Through',
          status: onHotPath ? 'pass' : 'fail',
          points: onHotPath ? 1 : 0,
          maxPoints: 1,
          confidence: 'medium',
          message: onHotPath
            ? 'Compliance constraints in instruction file hot path'
            : 'PHI/compliance signals detected but constraints are not in the instruction file hot path',
        };
      },
    },
    recommendation:
      'PHI/compliance signals detected - add mandatory constraints to instruction file: "MUST NOT log PHI", "MUST scope queries by tenant". These belong in the hot path, not only in cold-path security docs.',
    recommendationKey: 'fix-compliance-signal-followthrough',
  },
  {
    id: '2.7.3',
    name: 'Formatter hook covers detected languages',
    tier: 'standard',
    category: 'Signal Follow-Through',
    pts: 1,
    confidence: 'medium',
    na: (ctx) => ctx.facts.stack.signals.formatterGaps.length === 0,
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const gaps = ctx.facts.stack.signals.formatterGaps;
        return {
          id: '2.7.3',
          name: 'Formatter hook covers detected languages',
          tier: 'standard',
          category: 'Signal Follow-Through',
          status: 'fail',
          points: 0,
          maxPoints: 1,
          confidence: 'medium',
          message: `Formatter gaps: ${gaps.join(', ')} - add formatters to PostToolUse hook (format-file.sh)`,
        };
      },
    },
    recommendation:
      'Add formatters for all detected languages to the PostToolUse hook (format-file.sh). Every language should have a formatter running automatically.',
    recommendationKey: 'fix-formatter-gaps',
  },
];
