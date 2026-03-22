import type { CheckDef, FactContext, CheckResult } from '../types.js';

// All skills must be interactive — no exceptions, strict scoring
const SKILL_QUALITY_THRESHOLD = 0.8;

/**
 * Tier 2 — Standard (35 points)
 * Skills, hooks, learning loop, router, architecture, local context
 */
export const standardChecks: CheckDef[] = [
  // === 2.1 Skills (8 pts) ===
  ...['security', 'debug', 'audit', 'investigate', 'review', 'plan', 'test'].map((skill, i) => ({
    id: `2.1.${i + 1}` as string,
    name: `goat-${skill} skill`,
    tier: 'standard' as const,
    category: 'Skills',
    pts: 1,
    confidence: 'high' as const,
    detect: { type: 'file_exists' as const, path: `{skills_dir}/goat-${skill}/SKILL.md` },
    recommendation: `Create goat-${skill} skill`,
    recommendationKey: `create-skill-${skill}`,
  })),
  {
    id: '2.1.8', name: 'All 7 skills present', tier: 'standard', category: 'Skills',
    pts: 1, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => ({
        id: '2.1.8', name: 'All 7 skills present', tier: 'standard', category: 'Skills',
        status: ctx.agentFacts.skills.allPresent ? 'pass' : 'fail',
        points: ctx.agentFacts.skills.allPresent ? 1 : 0, maxPoints: 1, confidence: 'high',
        message: ctx.agentFacts.skills.allPresent
          ? 'All 7 skills present'
          : `Missing: ${ctx.agentFacts.skills.missing.join(', ')}`,
      }),
    },
    recommendation: 'Create all 7 goat-* skills',
    recommendationKey: 'create-all-skills',
  },

  // === 2.1.9-2.1.12 Skill Content Quality (4 pts) ===
  {
    id: '2.1.9', name: 'Skills gather context (Step 0)', tier: 'standard', category: 'Skills',
    pts: 1, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { quality } = ctx.agentFacts.skills;
        if (quality.total === 0) {
          return { id: '2.1.9', name: 'Skills gather context (Step 0)', tier: 'standard', category: 'Skills', status: 'fail', points: 0, maxPoints: 1, confidence: 'high', message: 'No skills found' };
        }
        const ratio = quality.withStep0 / quality.total;
        if (ratio >= SKILL_QUALITY_THRESHOLD) {
          return { id: '2.1.9', name: 'Skills gather context (Step 0)', tier: 'standard', category: 'Skills', status: 'pass', points: 1, maxPoints: 1, confidence: 'high', message: `${quality.withStep0}/${quality.total} skills ask questions before acting` };
        }
        return { id: '2.1.9', name: 'Skills gather context (Step 0)', tier: 'standard', category: 'Skills', status: 'fail', points: 0, maxPoints: 1, confidence: 'high', message: `Only ${quality.withStep0}/${quality.total} skills gather context — most should ask before acting` };
      },
    },
    recommendation: 'Skills should ask clarifying questions before acting (Step 0 pattern)',
    recommendationKey: 'add-skill-step0',
  },
  {
    id: '2.1.10', name: 'Skills have human gates', tier: 'standard', category: 'Skills',
    pts: 1, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { quality } = ctx.agentFacts.skills;
        if (quality.total === 0) {
          return { id: '2.1.10', name: 'Skills have human gates', tier: 'standard', category: 'Skills', status: 'fail', points: 0, maxPoints: 1, confidence: 'high', message: 'No skills found' };
        }
        const ratio = quality.withHumanGate / quality.total;
        if (ratio >= SKILL_QUALITY_THRESHOLD) {
          return { id: '2.1.10', name: 'Skills have human gates', tier: 'standard', category: 'Skills', status: 'pass', points: 1, maxPoints: 1, confidence: 'high', message: `${quality.withHumanGate}/${quality.total} skills include human gates` };
        }
        return { id: '2.1.10', name: 'Skills have human gates', tier: 'standard', category: 'Skills', status: 'fail', points: 0, maxPoints: 1, confidence: 'high', message: `Only ${quality.withHumanGate}/${quality.total} skills have human gates — agents should pause for review` };
      },
    },
    recommendation: 'Skills should include HUMAN GATE checkpoints where the agent pauses for human review',
    recommendationKey: 'add-skill-human-gates',
  },
  {
    id: '2.1.11', name: 'Skills have MUST/MUST NOT constraints', tier: 'standard', category: 'Skills',
    pts: 1, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { quality } = ctx.agentFacts.skills;
        if (quality.total === 0) {
          return { id: '2.1.11', name: 'Skills have MUST/MUST NOT constraints', tier: 'standard', category: 'Skills', status: 'fail', points: 0, maxPoints: 1, confidence: 'high', message: 'No skills found' };
        }
        const ratio = quality.withConstraints / quality.total;
        if (ratio >= SKILL_QUALITY_THRESHOLD) {
          return { id: '2.1.11', name: 'Skills have MUST/MUST NOT constraints', tier: 'standard', category: 'Skills', status: 'pass', points: 1, maxPoints: 1, confidence: 'high', message: `${quality.withConstraints}/${quality.total} skills have RFC 2119 constraints` };
        }
        return { id: '2.1.11', name: 'Skills have MUST/MUST NOT constraints', tier: 'standard', category: 'Skills', status: 'fail', points: 0, maxPoints: 1, confidence: 'high', message: `Only ${quality.withConstraints}/${quality.total} skills have MUST/MUST NOT constraints` };
      },
    },
    recommendation: 'Skills should use MUST/MUST NOT constraints to enforce boundaries',
    recommendationKey: 'add-skill-constraints',
  },
  {
    id: '2.1.12', name: 'Skills have phased process', tier: 'standard', category: 'Skills',
    pts: 1, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { quality } = ctx.agentFacts.skills;
        if (quality.total === 0) {
          return { id: '2.1.12', name: 'Skills have phased process', tier: 'standard', category: 'Skills', status: 'fail', points: 0, maxPoints: 1, confidence: 'high', message: 'No skills found' };
        }
        const ratio = quality.withPhases / quality.total;
        if (ratio >= SKILL_QUALITY_THRESHOLD) {
          return { id: '2.1.12', name: 'Skills have phased process', tier: 'standard', category: 'Skills', status: 'pass', points: 1, maxPoints: 1, confidence: 'high', message: `${quality.withPhases}/${quality.total} skills have phased execution` };
        }
        return { id: '2.1.12', name: 'Skills have phased process', tier: 'standard', category: 'Skills', status: 'fail', points: 0, maxPoints: 1, confidence: 'high', message: `Only ${quality.withPhases}/${quality.total} skills have phased execution — structure prevents skipping steps` };
      },
    },
    recommendation: 'Skills should have a phased process (Phase 1, Phase 2, etc.) to prevent step-skipping',
    recommendationKey: 'add-skill-phases',
  },
  {
    id: '2.1.13', name: 'Skills are conversational', tier: 'standard', category: 'Skills',
    pts: 1, confidence: 'medium',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { quality } = ctx.agentFacts.skills;
        if (quality.total === 0) {
          return { id: '2.1.13', name: 'Skills are conversational', tier: 'standard', category: 'Skills', status: 'fail', points: 0, maxPoints: 1, confidence: 'medium', message: 'No skills found' };
        }
        const ratio = quality.withConversational / quality.total;
        if (ratio >= SKILL_QUALITY_THRESHOLD) {
          return { id: '2.1.13', name: 'Skills are conversational', tier: 'standard', category: 'Skills', status: 'pass', points: 1, maxPoints: 1, confidence: 'medium', message: `${quality.withConversational}/${quality.total} skills encourage conversational interaction` };
        }
        return { id: '2.1.13', name: 'Skills are conversational', tier: 'standard', category: 'Skills', status: 'fail', points: 0, maxPoints: 1, confidence: 'medium', message: `Only ${quality.withConversational}/${quality.total} skills are conversational — skills should present findings then let humans drill in, not dump one-shot output` };
      },
    },
    recommendation: 'Skills should be conversational — present findings, then let the human drill in with follow-up questions. One-shot dumps miss architectural problems.',
    recommendationKey: 'add-skill-conversational',
  },
  {
    id: '2.1.14', name: 'Skills have chaining', tier: 'standard', category: 'Skills',
    pts: 1, confidence: 'medium',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { quality } = ctx.agentFacts.skills;
        if (quality.total === 0) {
          return { id: '2.1.14', name: 'Skills have chaining', tier: 'standard', category: 'Skills', status: 'fail', points: 0, maxPoints: 1, confidence: 'medium', message: 'No skills found' };
        }
        const ratio = quality.withChaining / quality.total;
        if (ratio >= SKILL_QUALITY_THRESHOLD) {
          return { id: '2.1.14', name: 'Skills have chaining', tier: 'standard', category: 'Skills', status: 'pass', points: 1, maxPoints: 1, confidence: 'medium', message: `${quality.withChaining}/${quality.total} skills link to related skills` };
        }
        return { id: '2.1.14', name: 'Skills have chaining', tier: 'standard', category: 'Skills', status: 'fail', points: 0, maxPoints: 1, confidence: 'medium', message: `Only ${quality.withChaining}/${quality.total} skills have chaining — skills should link to related skills` };
      },
    },
    recommendation: 'Skills should include a "Chains with" footer linking to related skills',
    recommendationKey: 'add-skill-chaining',
  },
  {
    id: '2.1.15', name: 'Skills have structured choices', tier: 'standard', category: 'Skills',
    pts: 1, confidence: 'medium',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { quality } = ctx.agentFacts.skills;
        if (quality.total === 0) {
          return { id: '2.1.15', name: 'Skills have structured choices', tier: 'standard', category: 'Skills', status: 'fail', points: 0, maxPoints: 1, confidence: 'medium', message: 'No skills found' };
        }
        const ratio = quality.withChoices / quality.total;
        if (ratio >= SKILL_QUALITY_THRESHOLD) {
          return { id: '2.1.15', name: 'Skills have structured choices', tier: 'standard', category: 'Skills', status: 'pass', points: 1, maxPoints: 1, confidence: 'medium', message: `${quality.withChoices}/${quality.total} skills offer choices at phase transitions` };
        }
        return { id: '2.1.15', name: 'Skills have structured choices', tier: 'standard', category: 'Skills', status: 'fail', points: 0, maxPoints: 1, confidence: 'medium', message: `Only ${quality.withChoices}/${quality.total} skills have structured choices — use (a)/(b)/(c) options, not yes/no gates` };
      },
    },
    recommendation: 'Skills should offer choices at phase transitions, not just yes/no gates',
    recommendationKey: 'add-skill-choices',
  },

  // === 2.2 Hooks / Verification Scripts (7 pts) ===
  {
    id: '2.2.1', name: 'Settings/config valid', tier: 'standard', category: 'Hooks',
    pts: 1, confidence: 'high',
    na: (ctx) => ctx.agentFacts.agent.settingsFile === null,
    detect: { type: 'json_valid', path: '{settings_file}' },
    recommendation: 'Fix settings.json — invalid JSON',
    recommendationKey: 'fix-settings-json',
  },
  {
    id: '2.2.2', name: 'Post-turn hook registered', tier: 'standard', category: 'Hooks',
    pts: 2, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => ({
        id: '2.2.2', name: 'Post-turn hook registered', tier: 'standard', category: 'Hooks',
        status: ctx.agentFacts.hooks.postTurnExists ? 'pass' : 'fail',
        points: ctx.agentFacts.hooks.postTurnExists ? 2 : 0, maxPoints: 2, confidence: 'high',
        message: ctx.agentFacts.hooks.postTurnExists ? 'Post-turn hook exists' : 'No post-turn hook (stop-lint)',
      }),
    },
    recommendation: 'Create stop-lint hook for post-turn verification',
    recommendationKey: 'create-stop-lint',
  },
  {
    id: '2.2.3', name: 'Post-turn hook exits 0', tier: 'standard', category: 'Hooks',
    pts: 1, confidence: 'medium',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        if (!ctx.agentFacts.hooks.postTurnExists) {
          return { id: '2.2.3', name: 'Post-turn hook exits 0', tier: 'standard', category: 'Hooks', status: 'na', points: 0, maxPoints: 0, confidence: 'medium', message: 'No post-turn hook to check' };
        }
        return {
          id: '2.2.3', name: 'Post-turn hook exits 0', tier: 'standard', category: 'Hooks',
          status: ctx.agentFacts.hooks.postTurnExitsZero ? 'pass' : 'fail',
          points: ctx.agentFacts.hooks.postTurnExitsZero ? 1 : 0, maxPoints: 1, confidence: 'medium',
          message: ctx.agentFacts.hooks.postTurnExitsZero ? 'Post-turn hook exits 0' : 'Post-turn hook may not exit 0 (causes infinite loops)',
        };
      },
    },
    recommendation: 'Ensure stop-lint hook ends with exit 0 (non-zero causes infinite loops)',
    recommendationKey: 'fix-hook-exit',
  },
  {
    id: '2.2.4', name: 'Post-tool hook or documented skip', tier: 'standard', category: 'Hooks',
    pts: 1, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const exists = ctx.agentFacts.hooks.postToolExists;
        // Also pass if no formatter configured (documented skip)
        const noFormatter = ctx.facts.stack.formatCommand === null;
        const pass = exists || noFormatter;
        return {
          id: '2.2.4', name: 'Post-tool hook or documented skip', tier: 'standard', category: 'Hooks',
          status: pass ? 'pass' : 'fail', points: pass ? 1 : 0, maxPoints: 1, confidence: 'high',
          message: exists ? 'Post-tool hook exists' : (noFormatter ? 'No formatter — skip is correct' : 'No post-tool hook and formatter exists'),
        };
      },
    },
    recommendation: 'Create format-file hook or document why it was skipped (no formatter)',
    recommendationKey: 'create-format-hook',
  },
  {
    id: '2.2.4a', name: 'Deny hook has blocking logic', tier: 'standard', category: 'Hooks',
    pts: 1, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        if (!ctx.agentFacts.hooks.denyExists) {
          return { id: '2.2.4a', name: 'Deny hook has blocking logic', tier: 'standard', category: 'Hooks', status: 'na', points: 0, maxPoints: 0, confidence: 'high', message: 'No deny hook' };
        }
        return {
          id: '2.2.4a', name: 'Deny hook has blocking logic', tier: 'standard', category: 'Hooks',
          status: ctx.agentFacts.hooks.denyHasBlocks ? 'pass' : 'fail',
          points: ctx.agentFacts.hooks.denyHasBlocks ? 1 : 0, maxPoints: 1, confidence: 'high',
          message: ctx.agentFacts.hooks.denyHasBlocks ? 'Deny hook has real blocking logic' : 'Deny hook exists but has no blocking logic (just exit 0)',
        };
      },
    },
    recommendation: 'Deny hook should contain actual blocking patterns (exit 2 for dangerous commands), not just exit 0',
    recommendationKey: 'add-deny-blocks',
  },
  {
    id: '2.2.4b', name: 'Post-turn hook has validation logic', tier: 'standard', category: 'Hooks',
    pts: 1, confidence: 'medium',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        if (!ctx.agentFacts.hooks.postTurnExists) {
          return { id: '2.2.4b', name: 'Post-turn hook has validation logic', tier: 'standard', category: 'Hooks', status: 'na', points: 0, maxPoints: 0, confidence: 'medium', message: 'No post-turn hook' };
        }
        return {
          id: '2.2.4b', name: 'Post-turn hook has validation logic', tier: 'standard', category: 'Hooks',
          status: ctx.agentFacts.hooks.postTurnHasValidation ? 'pass' : 'fail',
          points: ctx.agentFacts.hooks.postTurnHasValidation ? 1 : 0, maxPoints: 1, confidence: 'medium',
          message: ctx.agentFacts.hooks.postTurnHasValidation ? 'Post-turn hook runs actual checks' : 'Post-turn hook exists but has no validation logic (lint/typecheck/format)',
        };
      },
    },
    recommendation: 'Post-turn hook should run actual validation (shellcheck, typecheck, lint, format check), not just exit 0',
    recommendationKey: 'add-stop-lint-validation',
  },
  {
    id: '2.2.4c', name: 'Compaction hook registered', tier: 'standard', category: 'Hooks',
    pts: 1, confidence: 'medium',
    na: (ctx) => ctx.agentFacts.agent.settingsFile === null,
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => ({
        id: '2.2.4c', name: 'Compaction hook registered', tier: 'standard', category: 'Hooks',
        status: ctx.agentFacts.hooks.compactionHookExists ? 'pass' : 'fail',
        points: ctx.agentFacts.hooks.compactionHookExists ? 1 : 0, maxPoints: 1, confidence: 'medium',
        message: ctx.agentFacts.hooks.compactionHookExists
          ? 'Notification hook for compaction found — context preserved across long sessions'
          : 'No compaction hook — context may be lost during long sessions. Add a Notification hook with compact matcher.',
      }),
    },
    recommendation: 'Register a Notification hook for compaction that re-injects current task, modified files, and constraints after context compaction',
    recommendationKey: 'add-compaction-hook',
  },
  {
    id: '2.2.5', name: 'Preflight script', tier: 'standard', category: 'Hooks',
    pts: 1, confidence: 'high',
    detect: { type: 'file_exists', path: 'scripts/preflight-checks.sh' },
    recommendation: 'Create scripts/preflight-checks.sh',
    recommendationKey: 'create-preflight-script',
  },
  {
    id: '2.2.6', name: 'Context validation', tier: 'standard', category: 'Hooks',
    pts: 1, confidence: 'high',
    detect: {
      type: 'composite', mode: 'any', checks: [
        { type: 'file_exists', path: 'scripts/context-validate.sh' },
        { type: 'file_exists', path: '.github/workflows/context-validation.yml' },
      ],
    },
    recommendation: 'Create context validation script or CI workflow',
    recommendationKey: 'create-context-validation',
  },

  // === 2.3 Learning Loop (7 pts) ===
  {
    id: '2.3.1', name: 'lessons.md exists', tier: 'standard', category: 'Learning Loop',
    pts: 1, confidence: 'high',
    detect: { type: 'file_exists', path: 'docs/lessons.md' },
    recommendation: 'Create docs/lessons.md',
    recommendationKey: 'create-lessons',
  },
  {
    id: '2.3.2', name: 'lessons.md has entries', tier: 'standard', category: 'Learning Loop',
    pts: 1, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => ({
        id: '2.3.2', name: 'lessons.md has entries', tier: 'standard', category: 'Learning Loop',
        status: ctx.facts.shared.lessons.hasEntries ? 'pass' : 'fail',
        points: ctx.facts.shared.lessons.hasEntries ? 1 : 0, maxPoints: 1, confidence: 'high',
        message: ctx.facts.shared.lessons.hasEntries ? 'lessons.md has entries' : 'lessons.md is empty or has no entries',
      }),
    },
    recommendation: 'Add entries to docs/lessons.md from real incidents',
    recommendationKey: 'seed-lessons',
  },
  {
    id: '2.3.3', name: 'footguns.md exists', tier: 'standard', category: 'Learning Loop',
    pts: 2, confidence: 'high',
    detect: { type: 'file_exists', path: 'docs/footguns.md' },
    recommendation: 'Create docs/footguns.md',
    recommendationKey: 'create-footguns',
  },
  {
    id: '2.3.4', name: 'Footguns have file:line evidence', tier: 'standard', category: 'Learning Loop',
    pts: 2, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => ({
        id: '2.3.4', name: 'Footguns have file:line evidence', tier: 'standard', category: 'Learning Loop',
        status: ctx.facts.shared.footguns.hasEvidence ? 'pass' : 'fail',
        points: ctx.facts.shared.footguns.hasEvidence ? 2 : 0, maxPoints: 2, confidence: 'high',
        message: ctx.facts.shared.footguns.hasEvidence ? 'Footguns have file:line evidence' : 'Footguns missing file:line evidence',
      }),
    },
    recommendation: 'Add file:line evidence to footgun entries',
    recommendationKey: 'add-footgun-evidence',
  },

  // === 2.4 Router Table (5 pts) ===
  {
    id: '2.4.1', name: 'Router section exists', tier: 'standard', category: 'Router Table',
    pts: 1, confidence: 'high',
    detect: { type: 'grep', path: '{instruction_file}', pattern: 'router|## Router' },
    recommendation: 'Add a Router Table section to the instruction file',
    recommendationKey: 'add-router',
  },
  {
    id: '2.4.2', name: 'Router references resolve', tier: 'standard', category: 'Router Table',
    pts: 3, partialPts: 1, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { paths, resolved, unresolved } = ctx.agentFacts.router;
        if (paths.length === 0) {
          return { id: '2.4.2', name: 'Router references resolve', tier: 'standard', category: 'Router Table', status: 'fail', points: 0, maxPoints: 3, confidence: 'high', message: 'No router paths found' };
        }
        if (unresolved.length === 0) {
          return { id: '2.4.2', name: 'Router references resolve', tier: 'standard', category: 'Router Table', status: 'pass', points: 3, maxPoints: 3, confidence: 'high', message: `All ${resolved} router paths resolve` };
        }
        if (resolved > 0) {
          return { id: '2.4.2', name: 'Router references resolve', tier: 'standard', category: 'Router Table', status: 'partial', points: 1, maxPoints: 3, confidence: 'high', message: `${resolved}/${paths.length} resolve. Missing: ${unresolved.join(', ')}`, evidence: unresolved.join(', ') };
        }
        return { id: '2.4.2', name: 'Router references resolve', tier: 'standard', category: 'Router Table', status: 'fail', points: 0, maxPoints: 3, confidence: 'high', message: `0/${paths.length} resolve` };
      },
    },
    recommendation: 'Fix broken router table references',
    recommendationKey: 'fix-router-refs',
  },
  {
    id: '2.4.3', name: 'Skills referenced in router', tier: 'standard', category: 'Router Table',
    pts: 1, confidence: 'high',
    detect: { type: 'grep', path: '{instruction_file}', section: 'router', pattern: 'skills|goat-' },
    recommendation: 'Add skill directories to the router table',
    recommendationKey: 'route-skills',
  },

  // === 2.5 Architecture Docs (4 pts) ===
  {
    id: '2.5.1', name: 'architecture.md exists', tier: 'standard', category: 'Architecture',
    pts: 2, confidence: 'high',
    detect: { type: 'file_exists', path: 'docs/architecture.md' },
    recommendation: 'Create docs/architecture.md',
    recommendationKey: 'create-architecture',
  },
  {
    id: '2.5.2', name: 'architecture.md under 100 lines', tier: 'standard', category: 'Architecture',
    pts: 1, confidence: 'high',
    na: (ctx) => !ctx.facts.shared.architecture.exists,
    detect: { type: 'line_count', path: 'docs/architecture.md', pass: 100, fail: 200 },
    recommendation: 'Compress docs/architecture.md below 100 lines',
    recommendationKey: 'compress-architecture',
  },
  {
    id: '2.5.3', name: 'domain-reference.md exists', tier: 'standard', category: 'Architecture',
    pts: 1, confidence: 'high',
    na: () => true, // N/A unless migration happened — conservatively skip
    detect: { type: 'file_exists', path: 'docs/domain-reference.md' },
    recommendation: 'Create docs/domain-reference.md if domain content was migrated',
    recommendationKey: 'create-domain-reference',
  },

  // === 2.6 Local Instructions (cold path) (6 pts) ===
  {
    id: '2.6.1', name: 'Instructions directory exists', tier: 'standard', category: 'Local Instructions',
    pts: 1, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { dirExists, location } = ctx.facts.shared.localInstructions;
        return {
          id: '2.6.1', name: 'Instructions directory exists', tier: 'standard', category: 'Local Instructions',
          status: dirExists ? 'pass' : 'fail',
          points: dirExists ? 1 : 0, maxPoints: 1, confidence: 'high',
          message: dirExists ? `Found at ${location === 'ai' ? 'ai/instructions/' : '.github/instructions/'}` : 'No ai/instructions/ or .github/instructions/ directory',
        };
      },
    },
    recommendation: 'Create ai/instructions/ with project coding guidelines',
    recommendationKey: 'create-instructions-dir',
  },
  {
    id: '2.6.2', name: 'Router exists', tier: 'standard', category: 'Local Instructions',
    pts: 1, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { hasRouter, dirExists } = ctx.facts.shared.localInstructions;
        if (!dirExists) {
          return { id: '2.6.2', name: 'Router exists', tier: 'standard', category: 'Local Instructions', status: 'fail', points: 0, maxPoints: 1, confidence: 'high', message: 'No instructions directory — router not applicable' };
        }
        return {
          id: '2.6.2', name: 'Router exists', tier: 'standard', category: 'Local Instructions',
          status: hasRouter ? 'pass' : 'fail',
          points: hasRouter ? 1 : 0, maxPoints: 1, confidence: 'high',
          message: hasRouter ? 'ai/README.md exists' : 'ai/README.md not found — agents need a router to discover instruction files',
        };
      },
    },
    recommendation: 'Create ai/README.md as routing map for instruction files',
    recommendationKey: 'create-instructions-router',
  },
  {
    id: '2.6.3', name: 'base.md exists', tier: 'standard', category: 'Local Instructions',
    pts: 1, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { hasBase, dirExists } = ctx.facts.shared.localInstructions;
        if (!dirExists) {
          return { id: '2.6.3', name: 'base.md exists', tier: 'standard', category: 'Local Instructions', status: 'fail', points: 0, maxPoints: 1, confidence: 'high', message: 'No instructions directory' };
        }
        return {
          id: '2.6.3', name: 'base.md exists', tier: 'standard', category: 'Local Instructions',
          status: hasBase ? 'pass' : 'fail',
          points: hasBase ? 1 : 0, maxPoints: 1, confidence: 'high',
          message: hasBase ? 'base.md found' : 'base.md not found — project needs a universal coding contract',
        };
      },
    },
    recommendation: 'Create ai/instructions/base.md with project-wide conventions',
    recommendationKey: 'create-base-instructions',
  },
  {
    id: '2.6.4', name: 'code-review.md exists', tier: 'standard', category: 'Local Instructions',
    pts: 1, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { hasCodeReview, dirExists } = ctx.facts.shared.localInstructions;
        if (!dirExists) {
          return { id: '2.6.4', name: 'code-review.md exists', tier: 'standard', category: 'Local Instructions', status: 'fail', points: 0, maxPoints: 1, confidence: 'high', message: 'No instructions directory' };
        }
        return {
          id: '2.6.4', name: 'code-review.md exists', tier: 'standard', category: 'Local Instructions',
          status: hasCodeReview ? 'pass' : 'fail',
          points: hasCodeReview ? 1 : 0, maxPoints: 1, confidence: 'high',
          message: hasCodeReview ? 'code-review.md found' : 'code-review.md not found — project needs review standards',
        };
      },
    },
    recommendation: 'Create ai/instructions/code-review.md with review standards',
    recommendationKey: 'create-code-review-instructions',
  },
  {
    id: '2.6.5', name: 'git-commit.md exists', tier: 'standard', category: 'Local Instructions',
    pts: 1, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { hasGitCommit, dirExists } = ctx.facts.shared.localInstructions;
        if (!dirExists) {
          return { id: '2.6.5', name: 'git-commit.md exists', tier: 'standard', category: 'Local Instructions', status: 'fail', points: 0, maxPoints: 1, confidence: 'high', message: 'No instructions directory' };
        }
        return {
          id: '2.6.5', name: 'git-commit.md exists', tier: 'standard', category: 'Local Instructions',
          status: hasGitCommit ? 'pass' : 'fail',
          points: hasGitCommit ? 1 : 0, maxPoints: 1, confidence: 'high',
          message: hasGitCommit ? 'git-commit.md found' : 'git-commit.md not found — project needs commit conventions',
        };
      },
    },
    recommendation: 'Create ai/instructions/git-commit.md with commit format and PR workflow',
    recommendationKey: 'create-git-commit-instructions',
  },
  {
    id: '2.6.6', name: 'git-commit-instructions.md in .github/', tier: 'standard', category: 'Local Instructions',
    pts: 1, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => ({
        id: '2.6.6', name: 'git-commit-instructions.md in .github/', tier: 'standard', category: 'Local Instructions',
        status: ctx.facts.shared.gitCommitInstructions.exists ? 'pass' : 'fail',
        points: ctx.facts.shared.gitCommitInstructions.exists ? 1 : 0, maxPoints: 1, confidence: 'high',
        message: ctx.facts.shared.gitCommitInstructions.exists ? '.github/git-commit-instructions.md found' : '.github/git-commit-instructions.md not found',
      }),
    },
    recommendation: 'Create .github/git-commit-instructions.md for universal commit guidance',
    recommendationKey: 'create-github-git-commit',
  },
];
