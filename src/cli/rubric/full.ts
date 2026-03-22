import type { CheckDef, FactContext, CheckResult } from '../types.js';

/**
 * Tier 3 — Full (16 points)
 * Agent evals, CI validation, hygiene.
 * These checks represent mature GOAT Flow adoption with CI integration.
 */
export const fullChecks: CheckDef[] = [
  // === 3.1 Agent Evals (7 pts: 1 existence + 2 count + 2 replay + 1 origin + 1 coverage) ===
  {
    id: '3.1.1', name: 'Evals directory exists', tier: 'full', category: 'Agent Evals',
    pts: 1, confidence: 'high',
    detect: { type: 'dir_exists', path: 'agent-evals' },
    recommendation: 'Create agent-evals/ directory',
    recommendationKey: 'create-evals-dir',
  },
  {
    id: '3.1.3', name: '3+ eval files', tier: 'full', category: 'Agent Evals',
    pts: 2, partialPts: 1, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        // Number of eval files found in agent-evals/
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
  {
    id: '3.1.6', name: 'Evals cover multiple skills', tier: 'full', category: 'Agent Evals',
    pts: 1, confidence: 'medium',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        // Number of distinct skill names referenced across all eval files
        const count = ctx.facts.shared.evals.evalSkillCount;
        if (ctx.facts.shared.evals.count === 0) {
          return { id: '3.1.6', name: 'Evals cover multiple skills', tier: 'full', category: 'Agent Evals', status: 'fail', points: 0, maxPoints: 1, confidence: 'medium', message: 'No eval files' };
        }
        if (count >= 2) {
          return { id: '3.1.6', name: 'Evals cover multiple skills', tier: 'full', category: 'Agent Evals', status: 'pass', points: 1, maxPoints: 1, confidence: 'medium', message: `Evals reference ${count} distinct skills` };
        }
        return { id: '3.1.6', name: 'Evals cover multiple skills', tier: 'full', category: 'Agent Evals', status: 'fail', points: 0, maxPoints: 1, confidence: 'medium', message: count === 1 ? 'Evals only cover 1 skill — add evals for at least 2 distinct skills' : 'Evals do not reference any skills — add **Skill:** labels to eval files' };
      },
    },
    recommendation: 'Add **Skill:** labels to eval files and ensure at least 2 distinct skills are covered',
    recommendationKey: 'add-eval-skill-coverage',
  },

  // === 3.2 CI Validation (6 pts) ===
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
  {
    id: '3.2.5', name: 'CI triggers on PRs', tier: 'full', category: 'CI Validation',
    pts: 1, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        if (ctx.facts.shared.ci.workflowExists === false) {
          return { id: '3.2.5', name: 'CI triggers on PRs', tier: 'full', category: 'CI Validation', status: 'na', points: 0, maxPoints: 0, confidence: 'high', message: 'No CI workflow' };
        }
        return {
          id: '3.2.5', name: 'CI triggers on PRs', tier: 'full', category: 'CI Validation',
          status: ctx.facts.shared.ci.ciTriggersOnPRs ? 'pass' : 'fail',
          points: ctx.facts.shared.ci.ciTriggersOnPRs ? 1 : 0, maxPoints: 1, confidence: 'high',
          message: ctx.facts.shared.ci.ciTriggersOnPRs ? 'CI runs automatically on pull requests' : 'CI does not trigger on PRs',
        };
      },
    },
    recommendation: 'Add pull_request trigger to CI workflow so validation runs on every PR',
    recommendationKey: 'ci-trigger-prs',
  },

  // === 3.3 Hygiene (3 pts) ===
  {
    id: '3.3.1', name: 'Handoff template', tier: 'full', category: 'Hygiene',
    pts: 1, confidence: 'high',
    detect: { type: 'file_exists', path: 'tasks/handoff-template.md' },
    recommendation: 'Create tasks/handoff-template.md',
    recommendationKey: 'create-handoff-template',
  },
  {
    id: '3.3.2', name: 'RFC 2119 language', tier: 'full', category: 'Hygiene',
    pts: 1, confidence: 'high',
    detect: { type: 'grep_count', path: '{instruction_file}', pattern: '\\bMUST\\b|\\bSHOULD\\b|\\bMAY\\b', min: 3 },
    recommendation: 'Use RFC 2119 language (MUST/SHOULD/MAY) in instruction file',
    recommendationKey: 'add-rfc2119',
  },
  {
    id: '3.3.3', name: 'Version/changelog', tier: 'full', category: 'Hygiene',
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
