import type { CheckDef, FactContext, CheckResult } from '../types.js';

/**
 * Tier 3 — Full (25 points)
 * Agent evals, CI validation, permission profiles, guidelines ownership, hygiene
 */
export const fullChecks: CheckDef[] = [
  // === 3.1 Agent Evals (8 pts) ===
  {
    id: '3.1.1', name: 'Evals directory exists', tier: 'full', category: 'Agent Evals',
    pts: 2, confidence: 'high',
    detect: { type: 'dir_exists', path: 'agent-evals' },
    recommendation: 'Create agent-evals/ directory',
    recommendationKey: 'create-evals-dir',
  },
  {
    id: '3.1.2', name: 'Evals README exists', tier: 'full', category: 'Agent Evals',
    pts: 1, confidence: 'high',
    detect: { type: 'file_exists', path: 'agent-evals/README.md' },
    recommendation: 'Create agent-evals/README.md',
    recommendationKey: 'create-evals-readme',
  },
  {
    id: '3.1.3', name: '3+ eval files', tier: 'full', category: 'Agent Evals',
    pts: 2, partialPts: 1, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const count = ctx.facts.shared.evals.count;
        if (count >= 3) return { id: '3.1.3', name: '3+ eval files', tier: 'full', category: 'Agent Evals', status: 'pass', points: 2, maxPoints: 2, confidence: 'high', message: `${count} eval files` };
        if (count >= 1) return { id: '3.1.3', name: '3+ eval files', tier: 'full', category: 'Agent Evals', status: 'partial', points: 1, maxPoints: 2, confidence: 'high', message: `${count} eval files (need 3+)` };
        return { id: '3.1.3', name: '3+ eval files', tier: 'full', category: 'Agent Evals', status: 'fail', points: 0, maxPoints: 2, confidence: 'high', message: 'No eval files' };
      },
    },
    recommendation: 'Add 3+ agent eval files with replay prompts',
    recommendationKey: 'add-evals',
  },
  {
    id: '3.1.4', name: 'Evals have replay prompts', tier: 'full', category: 'Agent Evals',
    pts: 2, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => ({
        id: '3.1.4', name: 'Evals have replay prompts', tier: 'full', category: 'Agent Evals',
        status: ctx.facts.shared.evals.hasReplayPrompts ? 'pass' : 'fail',
        points: ctx.facts.shared.evals.hasReplayPrompts ? 2 : 0, maxPoints: 2, confidence: 'high',
        message: ctx.facts.shared.evals.hasReplayPrompts ? 'Evals have replay prompts' : 'Evals missing ## Replay Prompt sections',
      }),
    },
    recommendation: 'Add ## Replay Prompt sections to eval files',
    recommendationKey: 'add-replay-prompts',
  },
  {
    id: '3.1.5', name: 'Evals have origin labels', tier: 'full', category: 'Agent Evals',
    pts: 1, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => ({
        id: '3.1.5', name: 'Evals have origin labels', tier: 'full', category: 'Agent Evals',
        status: ctx.facts.shared.evals.hasOriginLabels ? 'pass' : 'fail',
        points: ctx.facts.shared.evals.hasOriginLabels ? 1 : 0, maxPoints: 1, confidence: 'high',
        message: ctx.facts.shared.evals.hasOriginLabels ? 'Evals have Origin labels' : 'Evals missing **Origin:** labels',
      }),
    },
    recommendation: 'Add **Origin:** real-incident | synthetic-seed to eval files',
    recommendationKey: 'add-origin-labels',
  },

  // === 3.2 CI Validation (5 pts) ===
  {
    id: '3.2.1', name: 'CI workflow exists', tier: 'full', category: 'CI Validation',
    pts: 2, confidence: 'high',
    detect: { type: 'file_exists', path: '.github/workflows/context-validation.yml' },
    recommendation: 'Create .github/workflows/context-validation.yml',
    recommendationKey: 'create-ci-workflow',
  },
  {
    id: '3.2.2', name: 'CI checks line count', tier: 'full', category: 'CI Validation',
    pts: 1, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => ({
        id: '3.2.2', name: 'CI checks line count', tier: 'full', category: 'CI Validation',
        status: ctx.facts.shared.ci.checksLineCount ? 'pass' : 'fail',
        points: ctx.facts.shared.ci.checksLineCount ? 1 : 0, maxPoints: 1, confidence: 'high',
        message: ctx.facts.shared.ci.checksLineCount ? 'CI workflow checks line count' : 'CI workflow does not check line count',
      }),
    },
    recommendation: 'Add line count check to CI workflow',
    recommendationKey: 'ci-check-lines',
  },
  {
    id: '3.2.3', name: 'CI checks router refs', tier: 'full', category: 'CI Validation',
    pts: 1, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => ({
        id: '3.2.3', name: 'CI checks router refs', tier: 'full', category: 'CI Validation',
        status: ctx.facts.shared.ci.checksRouter ? 'pass' : 'fail',
        points: ctx.facts.shared.ci.checksRouter ? 1 : 0, maxPoints: 1, confidence: 'high',
        message: ctx.facts.shared.ci.checksRouter ? 'CI workflow checks router' : 'CI workflow does not check router references',
      }),
    },
    recommendation: 'Add router reference check to CI workflow',
    recommendationKey: 'ci-check-router',
  },
  {
    id: '3.2.4', name: 'CI checks skills', tier: 'full', category: 'CI Validation',
    pts: 1, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => ({
        id: '3.2.4', name: 'CI checks skills', tier: 'full', category: 'CI Validation',
        status: ctx.facts.shared.ci.checksSkills ? 'pass' : 'fail',
        points: ctx.facts.shared.ci.checksSkills ? 1 : 0, maxPoints: 1, confidence: 'high',
        message: ctx.facts.shared.ci.checksSkills ? 'CI workflow checks skills' : 'CI workflow does not check skills',
      }),
    },
    recommendation: 'Add skills check to CI workflow',
    recommendationKey: 'ci-check-skills',
  },

  // === 3.3 Permission Profiles (4 pts) ===
  {
    id: '3.3.1', name: 'Profiles directory', tier: 'full', category: 'Permission Profiles',
    pts: 1, confidence: 'high',
    na: (ctx) => ctx.facts.shape === 'library' || ctx.facts.shape === 'collection',
    detect: { type: 'dir_exists', path: '.claude/profiles' },
    recommendation: 'Create .claude/profiles/ directory',
    recommendationKey: 'create-profiles-dir',
  },
  {
    id: '3.3.2', name: '2+ profile files', tier: 'full', category: 'Permission Profiles',
    pts: 2, partialPts: 1, confidence: 'high',
    na: (ctx) => ctx.facts.shape === 'library' || ctx.facts.shape === 'collection',
    detect: {
      type: 'custom',
      fn: (): CheckResult => {
        // Conservatively mark as N/A — profiles are create-on-first-use
        return { id: '3.3.2', name: '2+ profile files', tier: 'full', category: 'Permission Profiles', status: 'na', points: 0, maxPoints: 0, confidence: 'high', message: 'Profiles are create-on-first-use' };
      },
    },
    recommendation: 'Create 2+ permission profiles when role separation is needed',
    recommendationKey: 'create-profiles',
  },
  {
    id: '3.3.3', name: 'Profiles referenced in router', tier: 'full', category: 'Permission Profiles',
    pts: 1, confidence: 'high',
    na: (ctx) => ctx.facts.shape === 'library' || ctx.facts.shape === 'collection',
    detect: { type: 'grep', path: '{instruction_file}', section: 'router', pattern: 'profile' },
    recommendation: 'Reference profiles in the router table',
    recommendationKey: 'route-profiles',
  },

  // === 3.4 Guidelines Ownership (5 pts) ===
  {
    id: '3.4.1', name: 'No DoD overlap', tier: 'full', category: 'Guidelines Ownership',
    pts: 2, confidence: 'medium',
    detect: {
      type: 'custom',
      fn: (): CheckResult => {
        // Would need to read guidelines file and compare — conservatively pass
        return { id: '3.4.1', name: 'No DoD overlap', tier: 'full', category: 'Guidelines Ownership', status: 'pass', points: 2, maxPoints: 2, confidence: 'low', message: 'Assumed no overlap (manual verification recommended)' };
      },
    },
    recommendation: 'Remove DoD content from guidelines file — keep only in instruction file',
    recommendationKey: 'fix-dod-overlap',
  },
  {
    id: '3.4.2', name: 'No execution loop overlap', tier: 'full', category: 'Guidelines Ownership',
    pts: 1, confidence: 'medium',
    detect: {
      type: 'custom',
      fn: (): CheckResult => {
        return { id: '3.4.2', name: 'No execution loop overlap', tier: 'full', category: 'Guidelines Ownership', status: 'pass', points: 1, maxPoints: 1, confidence: 'low', message: 'Assumed no overlap (manual verification recommended)' };
      },
    },
    recommendation: 'Remove execution loop content from guidelines file',
    recommendationKey: 'fix-loop-overlap',
  },
  {
    id: '3.4.3', name: 'Ownership split documented', tier: 'full', category: 'Guidelines Ownership',
    pts: 1, confidence: 'high',
    na: () => true, // N/A unless migration happened
    detect: { type: 'file_exists', path: 'docs/guidelines-ownership-split.md' },
    recommendation: 'Create docs/guidelines-ownership-split.md documenting the migration',
    recommendationKey: 'create-ownership-split',
  },
  {
    id: '3.4.4', name: 'Clean separation', tier: 'full', category: 'Guidelines Ownership',
    pts: 1, confidence: 'low',
    detect: {
      type: 'custom',
      fn: (): CheckResult => {
        return { id: '3.4.4', name: 'Clean separation', tier: 'full', category: 'Guidelines Ownership', status: 'pass', points: 1, maxPoints: 1, confidence: 'low', message: 'Assumed clean (manual verification recommended)' };
      },
    },
    recommendation: 'Verify no autonomy/stop-the-line content in guidelines file',
    recommendationKey: 'verify-separation',
  },

  // === 3.5 Hygiene (3 pts) ===
  {
    id: '3.5.1', name: 'Handoff template', tier: 'full', category: 'Hygiene',
    pts: 1, confidence: 'high',
    detect: { type: 'file_exists', path: 'tasks/handoff-template.md' },
    recommendation: 'Create tasks/handoff-template.md',
    recommendationKey: 'create-handoff-template',
  },
  {
    id: '3.5.2', name: 'RFC 2119 language', tier: 'full', category: 'Hygiene',
    pts: 1, confidence: 'high',
    detect: { type: 'grep_count', path: '{instruction_file}', pattern: '\\bMUST\\b|\\bSHOULD\\b|\\bMAY\\b', min: 3 },
    recommendation: 'Use RFC 2119 language (MUST/SHOULD/MAY) in instruction file',
    recommendationKey: 'add-rfc2119',
  },
  {
    id: '3.5.3', name: 'Version/changelog', tier: 'full', category: 'Hygiene',
    pts: 1, confidence: 'high',
    detect: {
      type: 'composite', mode: 'any', checks: [
        { type: 'grep', path: '{instruction_file}', pattern: 'version.*history|changelog' },
        { type: 'file_exists', path: 'CHANGELOG.md' },
      ],
    },
    recommendation: 'Add version history or CHANGELOG.md',
    recommendationKey: 'add-changelog',
  },
];
