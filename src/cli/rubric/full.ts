import type { CheckDef, FactContext, CheckResult } from '../types.js';

// Confidence criteria:
//   high   = deterministic (file exists, line count, JSON valid, exact match)
//   medium = heuristic (regex pattern, ratio threshold, keyword detection)
//   low    = semantic inference (content quality judgment)

/**
 * Tier 3 — Full (20 points)
 * Agent evals, CI validation, hygiene.
 * These checks represent mature GOAT Flow adoption with CI integration.
 */
export const fullChecks: CheckDef[] = [
  // === 3.1 Agent Evals (9 pts: 1 existence + 1 count + 2 replay + 1 origin + 1 agents + 2 coverage + 1 frontmatter) ===
  {
    id: '3.1.1', name: 'Evals directory exists', tier: 'full', category: 'Agent Evals',
    pts: 1, confidence: 'high',
    detect: { type: 'dir_exists', path: 'agent-evals' },
    recommendation: 'Create agent-evals/ directory',
    recommendationKey: 'create-evals-dir',
  },
  {
    id: '3.1.3', name: '3+ eval files', tier: 'full', category: 'Agent Evals',
    pts: 1, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const count = ctx.facts.shared.evals.count;
        if (count >= 3) return { id: '3.1.3', name: '3+ eval files', tier: 'full', category: 'Agent Evals', status: 'pass', points: 1, maxPoints: 1, confidence: 'high', message: `${count} eval files` };
        if (count >= 1) return { id: '3.1.3', name: '3+ eval files', tier: 'full', category: 'Agent Evals', status: 'fail', points: 0, maxPoints: 1, confidence: 'high', message: `${count} eval files (need 3+)` };
        return { id: '3.1.3', name: '3+ eval files', tier: 'full', category: 'Agent Evals', status: 'fail', points: 0, maxPoints: 1, confidence: 'high', message: 'No eval files' };
      },
    },
    recommendation: 'Add 3+ agent eval files — diversity across skills matters more than count',
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
    id: '3.1.5a', name: 'Evals have Agents labels', tier: 'full', category: 'Agent Evals',
    pts: 1, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => ({
        id: '3.1.5a', name: 'Evals have Agents labels', tier: 'full', category: 'Agent Evals',
        status: ctx.facts.shared.evals.hasAgentsLabels ? 'pass' : 'fail',
        points: ctx.facts.shared.evals.hasAgentsLabels ? 1 : 0, maxPoints: 1, confidence: 'high',
        message: ctx.facts.shared.evals.hasAgentsLabels ? 'Evals have Agents labels' : 'Evals missing **Agents:** labels (all | codex | claude | gemini)',
      }),
    },
    recommendation: 'Add **Agents:** all | codex | claude | gemini to eval files',
    recommendationKey: 'add-agents-labels',
  },
  {
    id: '3.1.7', name: 'Evals use YAML frontmatter', tier: 'full', category: 'Agent Evals',
    pts: 1, confidence: 'high',
    na: (ctx) => ctx.facts.shared.evals.count === 0,
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => ({
        id: '3.1.7', name: 'Evals use YAML frontmatter', tier: 'full', category: 'Agent Evals',
        status: ctx.facts.shared.evals.hasFrontmatter ? 'pass' : 'fail',
        points: ctx.facts.shared.evals.hasFrontmatter ? 1 : 0, maxPoints: 1, confidence: 'high',
        message: ctx.facts.shared.evals.hasFrontmatter ? 'All evals use YAML frontmatter' : 'Some evals use legacy format — migrate to YAML frontmatter with name, description, origin, agents, skill fields',
      }),
    },
    recommendation: 'Migrate eval files to YAML frontmatter format: ---\\nname: eval-name\\ndescription: "..."\\norigin: real-incident | synthetic-seed\\nagents: all\\nskill: goat-*\\n---',
    recommendationKey: 'fix-eval-frontmatter',
  },
  {
    id: '3.1.6', name: 'Eval skill coverage', tier: 'full', category: 'Agent Evals',
    pts: 2, partialPts: 1, confidence: 'medium',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { evalSkillCount, count } = ctx.facts.shared.evals;
        const TOTAL_SKILLS = 8;
        if (count === 0) {
          return { id: '3.1.6', name: 'Eval skill coverage', tier: 'full', category: 'Agent Evals', status: 'fail', points: 0, maxPoints: 2, confidence: 'medium', message: 'No eval files' };
        }
        if (evalSkillCount >= TOTAL_SKILLS) {
          return { id: '3.1.6', name: 'Eval skill coverage', tier: 'full', category: 'Agent Evals', status: 'pass', points: 2, maxPoints: 2, confidence: 'medium', message: `All ${TOTAL_SKILLS} canonical skills covered` };
        }
        if (evalSkillCount >= 4) {
          return { id: '3.1.6', name: 'Eval skill coverage', tier: 'full', category: 'Agent Evals', status: 'partial', points: 1, maxPoints: 2, confidence: 'medium', message: `${evalSkillCount}/${TOTAL_SKILLS} skills covered — add evals for the missing ones` };
        }
        return { id: '3.1.6', name: 'Eval skill coverage', tier: 'full', category: 'Agent Evals', status: 'fail', points: 0, maxPoints: 2, confidence: 'medium', message: evalSkillCount === 0 ? 'No skill: labels in evals — add skill: goat-X to frontmatter' : `${evalSkillCount}/${TOTAL_SKILLS} skills covered — diversity matters more than count` };
      },
    },
    recommendation: 'Add evals covering all 8 skills: goat-debug, goat-investigate, goat-plan, goat-refactor, goat-review, goat-security, goat-simplify, goat-test. Diversity across skills matters more than eval count.',
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

  // === 3.3 Hygiene (5 pts) ===
  {
    id: '3.3.1', name: 'Handoff template', tier: 'full', category: 'Hygiene',
    pts: 1, confidence: 'high',
    detect: { type: 'file_exists', path: 'tasks/handoff-template.md' },
    recommendation: 'Create tasks/handoff-template.md',
    recommendationKey: 'create-handoff-template',
  },
  {
    id: '3.3.1a', name: 'Handoff template has required sections', tier: 'full', category: 'Hygiene',
    pts: 1, confidence: 'medium',
    na: (ctx) => !ctx.facts.shared.handoffTemplate.exists,
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { hasRequiredSections, sectionCount } = ctx.facts.shared.handoffTemplate;
        return {
          id: '3.3.1a',
          name: 'Handoff template has required sections',
          tier: 'full',
          category: 'Hygiene',
          status: hasRequiredSections ? 'pass' : 'fail',
          points: hasRequiredSections ? 1 : 0,
          maxPoints: 1,
          confidence: 'medium',
          message: hasRequiredSections
            ? `Found ${sectionCount}/5 required sections`
            : `Found ${sectionCount}/5 required sections`,
        };
      },
    },
    recommendation: 'Add required sections to handoff template: Status, Current State, Key Decisions, Known Risks, Next Step',
    recommendationKey: 'fix-handoff-sections',
  },
  {
    id: '3.3.2', name: 'RFC 2119 language', tier: 'full', category: 'Hygiene',
    pts: 1, confidence: 'high',
    detect: { type: 'grep_count', path: '{instruction_file}', pattern: '\\bMUST\\b|\\bSHOULD\\b|\\bMAY\\b', min: 10 },
    recommendation: 'Use RFC 2119 language (MUST/SHOULD/MAY) in instruction file',
    recommendationKey: 'add-rfc2119',
  },
  // 3.3.3 (changelog) removed — CHANGELOG.md is a project-level concern, not an AI workflow check.
  {
    id: '3.3.4', name: 'Execution loop consistent across agents', tier: 'standard', category: 'Dual-Agent Consistency',
    pts: 3, confidence: 'medium',
    na: (ctx) => ctx.facts.agents.length <= 1,
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        /** Extract execution loop text between READ and Autonomy/Router headings */
        const extractLoop = (content: string | null): string => {
          if (!content) return '';
          /** Match READ as a heading (## READ, ### READ) or bold (**READ**) */
          const readMatch = content.match(/(?:###?\s+|\*\*)READ\b/i);
          if (!readMatch) return '';
          const start = readMatch.index!;
          /** Find the end marker AFTER the READ match — Autonomy Tiers, Router Table, Hard Rules, or Working Memory */
          const afterRead = content.slice(start);
          const endMatch = afterRead.match(/^##\s+(Autonomy|Router|Hard Rules|Working Memory|Definition of Done)\b/im);
          const end = endMatch ? start + endMatch.index! : content.length;
          return content.slice(start, end).replace(/\s+/g, ' ').trim();
        };
        const loops = ctx.facts.agents
          .filter(a => a.instruction.exists && a.instruction.content)
          .map(a => ({ agent: a.agent.instructionFile, loop: extractLoop(a.instruction.content) }));
        if (loops.length <= 1) return { id: '3.3.4', name: 'Execution loop consistent across agents', tier: 'standard', category: 'Dual-Agent Consistency', status: 'na', points: 0, maxPoints: 0, confidence: 'medium', message: 'Only one agent instruction file' };
        // Normalize for comparison: lowercase, strip markdown formatting
        const normalize = (s: string): string[] =>
          s.toLowerCase()
            .replace(/[*`|_\-#]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ')
            .filter(w => w.length > 0);

        // Compare each pair — word-intersection similarity (Jaccard index)
        const diverged: string[] = [];
        for (let i = 1; i < loops.length; i++) {
          const a = loops[0]!, b = loops[i]!;
          const wordsA = new Set(normalize(a.loop));
          const wordsB = new Set(normalize(b.loop));
          const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
          const union = new Set([...wordsA, ...wordsB]).size;
          const similarity = union > 0 ? intersection / union : 1;
          // 0.75 threshold tolerates minor wording variation while catching structural divergence
          if (similarity < 0.75 || a.loop.length === 0 || b.loop.length === 0) {
            diverged.push(`${a.agent} vs ${b.agent}`);
          }
        }
        if (diverged.length === 0) return { id: '3.3.4', name: 'Execution loop consistent across agents', tier: 'standard', category: 'Dual-Agent Consistency', status: 'pass', points: 3, maxPoints: 3, confidence: 'medium', message: `Execution loops consistent across ${loops.length} agent files` };
        return { id: '3.3.4', name: 'Execution loop consistent across agents', tier: 'standard', category: 'Dual-Agent Consistency', status: 'fail', points: 0, maxPoints: 3, confidence: 'medium', message: `Execution loops diverged: ${diverged.join(', ')}. Write the loop in one file, copy verbatim to others` };
      },
    },
    recommendation: 'Reconcile execution loop sections across agent instruction files',
    recommendationKey: 'fix-execution-loop-sync',
  },

  // 3.4.1 removed — duplicate of 3.1.6 after both were updated to require all 8 canonical skills.
];
