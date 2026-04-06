import type { CheckDef, FactContext, CheckResult } from '../../types.js';
import { getRequiredRouterPathCheckResult, getRouterSkillsCheckResult } from './router-helpers.js';

/** Standard-tier checks for the router table and path resolution (2.4.x). */
export const routerChecks: CheckDef[] = [
  {
    id: '2.4.1',
    name: 'Router section exists',
    tier: 'standard',
    category: 'Router Table',
    pts: 1,
    confidence: 'high',
    priority: 'required',
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
    priority: 'recommended',
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
    priority: 'recommended',
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
    priority: 'optional',
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
    priority: 'optional',
    na: (ctx) =>
      !ctx.agentFacts.instruction.content?.toLowerCase().includes('router'),
    detect: {
      type: 'grep',
      path: '{instruction_file}',
      section: 'router',
      pattern: 'architecture|arch',
    },
    recommendation: 'Add ai-docs/architecture.md to the router table',
    recommendationKey: 'route-architecture',
  },
  {
    id: '2.4.6',
    name: 'Evals in router',
    tier: 'standard',
    category: 'Router Table',
    pts: 1,
    confidence: 'high',
    priority: 'optional',
    na: (ctx) =>
      !ctx.agentFacts.instruction.content?.toLowerCase().includes('router') ||
      !ctx.facts.shared.evals.dirExists,
    detect: {
      type: 'grep',
      path: '{instruction_file}',
      section: 'router',
      pattern: 'eval|agent-eval',
    },
    recommendation: 'Add ai-docs/evals/ to the router table',
    recommendationKey: 'route-evals',
  },
  // 2.4.7 (handoff template in router) removed - handoff is workspace-level, not a rubric concern.
  {
    id: '2.4.8',
    name: 'Config in router',
    tier: 'standard',
    category: 'Router Table',
    pts: 1,
    confidence: 'high',
    priority: 'optional',
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

];
