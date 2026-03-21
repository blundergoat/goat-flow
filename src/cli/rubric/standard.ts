import type { CheckDef, FactContext, CheckResult } from '../types.js';

/**
 * Tier 2 — Standard (35 points)
 * Skills, hooks, learning loop, router, architecture, local context
 */
export const standardChecks: CheckDef[] = [
  // === 2.1 Skills (8 pts) ===
  ...['preflight', 'debug', 'audit', 'investigate', 'review', 'plan', 'test'].map((skill, i) => ({
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

];
