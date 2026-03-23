import type { CheckDef, FactContext, CheckResult } from '../types.js';

// Confidence criteria:
//   high   = deterministic (file exists, line count, JSON valid, exact match)
//   medium = heuristic (regex pattern, ratio threshold, keyword detection)
//   low    = semantic inference (content quality judgment)

/**
 * Tier 1 — Foundation (47 points)
 * Instruction file, execution loop, autonomy tiers, DoD, enforcement.
 * These are baseline requirements every GOAT Flow project must satisfy.
 */
export const foundationChecks: CheckDef[] = [
  // === 1.1 Instruction File (9 pts) ===
  {
    id: '1.1.1', name: 'Instruction file exists', tier: 'foundation', category: 'Instruction File',
    pts: 2, confidence: 'high',
    detect: { type: 'file_exists', path: '{instruction_file}' },
    recommendation: 'Create the root instruction file for this agent',
    recommendationKey: 'create-instruction-file',
  },
  {
    id: '1.1.2', name: 'Under line target', tier: 'foundation', category: 'Instruction File',
    pts: 3, partialPts: 1, confidence: 'high',
    detect: { type: 'line_count', path: '{instruction_file}', pass: 120, partial: 150, fail: 150 },
    recommendation: 'Compress instruction file below 120 lines. Apply cut priority: verbose examples first, then explanatory paragraphs.',
    recommendationKey: 'compress-instruction-file',
  },
  {
    id: '1.1.3', name: 'Version header', tier: 'foundation', category: 'Instruction File',
    pts: 1, confidence: 'high',
    detect: { type: 'grep', path: '{instruction_file}', pattern: 'v[0-9]|\\d{4}-\\d{2}-\\d{2}' },
    recommendation: 'Add a version header (e.g., "v1.0 - 2026-03-21") to the instruction file',
    recommendationKey: 'add-version-header',
  },
  {
    id: '1.1.4', name: 'Essential commands section', tier: 'foundation', category: 'Instruction File',
    pts: 2, confidence: 'high',
    detect: { type: 'grep', path: '{instruction_file}', pattern: 'essential commands|## Commands' },
    recommendation: 'Add an Essential Commands section with build, test, lint commands',
    recommendationKey: 'add-essential-commands',
  },

  {
    id: '1.1.5', name: 'Instruction file has concrete examples', tier: 'foundation', category: 'Instruction File',
    pts: 1, confidence: 'medium',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const content = ctx.agentFacts.instruction.content;
        if (content === null) {
          return { id: '1.1.5', name: 'Instruction file has concrete examples', tier: 'foundation', category: 'Instruction File', status: 'fail', points: 0, maxPoints: 1, confidence: 'medium', message: 'No instruction file content' };
        }
        const matches = content.match(/\bBAD\b|\bGOOD\b|\bDON'T\b|\bexample:/gi) ?? [];
        if (matches.length >= 2) {
          return { id: '1.1.5', name: 'Instruction file has concrete examples', tier: 'foundation', category: 'Instruction File', status: 'pass', points: 1, maxPoints: 1, confidence: 'medium', message: `Instruction file uses concrete DO/DON'T or BAD/GOOD examples (${matches.length} matches)` };
        }
        return { id: '1.1.5', name: 'Instruction file has concrete examples', tier: 'foundation', category: 'Instruction File', status: 'fail', points: 0, maxPoints: 1, confidence: 'medium', message: 'No concrete examples found' };
      },
    },
    recommendation: 'Add concrete BAD/GOOD or DO/DON\'T examples to the instruction file — at least 2 pairs showing right vs wrong approaches',
    recommendationKey: 'add-concrete-examples',
  },

  // === 1.2 Execution Loop (13 pts) ===
  {
    id: '1.2.1', name: 'READ step', tier: 'foundation', category: 'Execution Loop',
    pts: 2, confidence: 'high',
    detect: { type: 'grep', path: '{instruction_file}', pattern: 'read.*first|never fabricate|MUST read' },
    recommendation: 'Add READ step: "MUST read relevant files before changes. Never fabricate codebase facts."',
    recommendationKey: 'add-read-step',
  },
  {
    id: '1.2.2', name: 'CLASSIFY step', tier: 'foundation', category: 'Execution Loop',
    pts: 2, confidence: 'high',
    detect: { type: 'grep', path: '{instruction_file}', pattern: 'classify|complexity.*budget|Hotfix.*Standard' },
    recommendation: 'Add CLASSIFY step with complexity budgets (Hotfix/Standard/System/Infrastructure)',
    recommendationKey: 'add-classify-step',
  },
  {
    id: '1.2.2a', name: 'CLASSIFY has budgets', tier: 'foundation', category: 'Execution Loop',
    pts: 1, confidence: 'medium',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const content = ctx.agentFacts.instruction.content;
        if (content === null) {
          return { id: '1.2.2a', name: 'CLASSIFY has budgets', tier: 'foundation', category: 'Execution Loop', status: 'fail', points: 0, maxPoints: 1, confidence: 'medium', message: 'No instruction file content' };
        }
        const hasBudgetTable = /Hotfix.*\d|Standard.*\d|read.*budget|turn.*budget/i.test(content);
        if (hasBudgetTable) {
          return { id: '1.2.2a', name: 'CLASSIFY has budgets', tier: 'foundation', category: 'Execution Loop', status: 'pass', points: 1, maxPoints: 1, confidence: 'medium', message: 'CLASSIFY section includes complexity budgets with numbers' };
        }
        return { id: '1.2.2a', name: 'CLASSIFY has budgets', tier: 'foundation', category: 'Execution Loop', status: 'fail', points: 0, maxPoints: 1, confidence: 'medium', message: 'CLASSIFY section has no complexity budget table' };
      },
    },
    recommendation: 'Add a complexity budget table to the CLASSIFY step with read/turn budgets per complexity level (Hotfix, Standard, System, Infrastructure)',
    recommendationKey: 'add-classify-budgets',
  },
  {
    id: '1.2.3', name: 'SCOPE step', tier: 'foundation', category: 'Execution Loop',
    pts: 2, confidence: 'high',
    detect: { type: 'grep', path: '{instruction_file}', pattern: 'scope.*declare|blast radius|non-goals|files allowed to change' },
    recommendation: 'Add SCOPE step: "MUST declare before acting: files allowed to change, non-goals, max blast radius."',
    recommendationKey: 'add-scope-step',
  },
  {
    id: '1.2.4', name: 'ACT step', tier: 'foundation', category: 'Execution Loop',
    pts: 2, confidence: 'high',
    detect: { type: 'grep', path: '{instruction_file}', pattern: 'State:.*\\|.*Goal:|mode.*behaviour|Plan.*Implement.*Debug' },
    recommendation: 'Add ACT step with state declaration format and mode table',
    recommendationKey: 'add-act-step',
  },
  {
    id: '1.2.5', name: 'VERIFY step', tier: 'foundation', category: 'Execution Loop',
    pts: 2, confidence: 'high',
    detect: { type: 'grep', path: '{instruction_file}', pattern: 'verify|stop.the.line|two corrections|MUST run.*shellcheck|MUST check cross-ref' },
    recommendation: 'Add VERIFY step with stop-the-line escalation and revert-and-rescope',
    recommendationKey: 'add-verify-step',
  },
  {
    id: '1.2.6', name: 'LOG step', tier: 'foundation', category: 'Execution Loop',
    pts: 2, confidence: 'medium',
    detect: { type: 'grep', path: '{instruction_file}', pattern: 'lessons\\.md|footguns\\.md|MUST update when tripped' },
    recommendation: 'Add LOG step referencing lessons.md, footguns.md',
    recommendationKey: 'add-log-step',
  },

  // === 1.3 Autonomy Tiers (10 pts) ===
  {
    id: '1.3.1', name: 'Three tiers present', tier: 'foundation', category: 'Autonomy Tiers',
    pts: 2, confidence: 'high',
    detect: {
      type: 'composite', mode: 'all', checks: [
        { type: 'grep', path: '{instruction_file}', pattern: '\\bAlways\\b' },
        { type: 'grep', path: '{instruction_file}', pattern: 'Ask First' },
        { type: 'grep', path: '{instruction_file}', pattern: '\\bNever\\b' },
      ],
    },
    recommendation: 'Add three autonomy tiers: Always, Ask First, Never',
    recommendationKey: 'add-autonomy-tiers',
  },
  {
    id: '1.3.2', name: 'Ask First project-specific', tier: 'foundation', category: 'Autonomy Tiers',
    pts: 3, confidence: 'medium',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        // Search section headings first, then fall back to body content
        let section = findSection(ctx, 'ask first');
        if (section === null) {
          // Try finding "Ask First" as bold text in the full content
          const content = ctx.agentFacts.instruction.content;
          if (content !== null) {
            const match = content.match(/\*\*Ask First\*\*[\s\S]*?(?=\n\*\*Never\*\*|\n##\s|$)/i);
            if (match) section = match[0];
          }
        }
        if (section === null) {
          return { id: '1.3.2', name: 'Ask First project-specific', tier: 'foundation', category: 'Autonomy Tiers', status: 'fail', points: 0, maxPoints: 3, confidence: 'medium', message: 'No Ask First section found' };
        }
        const lines = section.split('\n').filter(l => l.trim()).length;
        // Check whether the section contains backtick-wrapped file paths
        const hasProjectPaths = /`[^`]*[./][^`]*`/.test(section);
        if (lines > 5 && hasProjectPaths) {
          return { id: '1.3.2', name: 'Ask First project-specific', tier: 'foundation', category: 'Autonomy Tiers', status: 'pass', points: 3, maxPoints: 3, confidence: 'medium', message: `Ask First has ${lines} lines with project-specific content`, evidence: 'Ask First section' };
        }
        if (lines > 5) {
          return { id: '1.3.2', name: 'Ask First project-specific', tier: 'foundation', category: 'Autonomy Tiers', status: 'partial', points: 1, maxPoints: 3, confidence: 'medium', message: `Ask First has ${lines} lines but may be generic` };
        }
        return { id: '1.3.2', name: 'Ask First project-specific', tier: 'foundation', category: 'Autonomy Tiers', status: 'fail', points: 0, maxPoints: 3, confidence: 'medium', message: `Ask First section too short (${lines} lines)` };
      },
    },
    recommendation: 'Make Ask First boundaries project-specific with actual file paths and domain terms',
    recommendationKey: 'project-specific-ask-first',
  },
  {
    id: '1.3.2a', name: 'Ask First paths resolve', tier: 'foundation', category: 'Autonomy Tiers',
    pts: 2, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const { paths, resolved, unresolved } = ctx.agentFacts.askFirst;
        if (paths.length === 0) {
          return { id: '1.3.2a', name: 'Ask First paths resolve', tier: 'foundation', category: 'Autonomy Tiers', status: 'na', points: 0, maxPoints: 0, confidence: 'high', message: 'No backtick-wrapped paths in Ask First section' };
        }
        if (unresolved.length === 0) {
          return { id: '1.3.2a', name: 'Ask First paths resolve', tier: 'foundation', category: 'Autonomy Tiers', status: 'pass', points: 2, maxPoints: 2, confidence: 'high', message: `All ${resolved} Ask First paths resolve` };
        }
        if (resolved > 0) {
          return { id: '1.3.2a', name: 'Ask First paths resolve', tier: 'foundation', category: 'Autonomy Tiers', status: 'partial', points: 1, maxPoints: 2, confidence: 'high', message: `${resolved}/${paths.length} resolve. Broken: ${unresolved.join(', ')}`, evidence: unresolved.join(', ') };
        }
        return { id: '1.3.2a', name: 'Ask First paths resolve', tier: 'foundation', category: 'Autonomy Tiers', status: 'fail', points: 0, maxPoints: 2, confidence: 'high', message: `0/${paths.length} resolve. Broken: ${unresolved.join(', ')}`, evidence: unresolved.join(', ') };
      },
    },
    recommendation: 'Fix broken paths in Ask First section — every referenced file/directory must exist on disk',
    recommendationKey: 'fix-ask-first-paths',
  },
  {
    id: '1.3.3', name: 'Never tier destructive guards', tier: 'foundation', category: 'Autonomy Tiers',
    pts: 2, confidence: 'high',
    detect: { type: 'grep', path: '{instruction_file}', pattern: 'delete.*without|\\.\\.env|secrets|push.*main|force push|overwrite.*without' },
    recommendation: 'Add destructive guards to Never tier: delete, .env, secrets, push to main, force push',
    recommendationKey: 'add-never-guards',
  },
  {
    id: '1.3.4', name: 'Micro-checklist present', tier: 'foundation', category: 'Autonomy Tiers',
    pts: 1, confidence: 'high',
    detect: { type: 'grep', path: '{instruction_file}', pattern: 'boundary.*touched|rollback.*command|\\[\\s*\\].*boundary|footgun.*checked' },
    recommendation: 'Add 5-item micro-checklist for Ask First items (boundary, related code, footgun, local instruction, rollback)',
    recommendationKey: 'add-micro-checklist',
  },

  // === 1.4 Definition of Done (7 pts) ===
  {
    id: '1.4.1', name: 'DoD section exists', tier: 'foundation', category: 'Definition of Done',
    pts: 2, confidence: 'high',
    detect: { type: 'grep', path: '{instruction_file}', pattern: 'definition of done|done.*until|MUST confirm ALL' },
    recommendation: 'Add a Definition of Done section with explicit gates',
    recommendationKey: 'add-dod',
  },
  {
    id: '1.4.2', name: '4+ explicit gates', tier: 'foundation', category: 'Definition of Done',
    pts: 2, partialPts: 1, confidence: 'medium',
    detect: {
      type: 'count_items', path: '{instruction_file}', section: 'definition of done',
      pattern: '\\(\\d+\\)|^\\d+\\.|^- \\[', pass: 6, partial: 4,
    },
    recommendation: 'Add 6 DoD gates: tests green, preflight passes, no boundary violations, logs updated, working notes current, grep after renames',
    recommendationKey: 'add-dod-gates',
  },
  {
    id: '1.4.3', name: 'Grep-after-rename gate', tier: 'foundation', category: 'Definition of Done',
    pts: 2, confidence: 'high',
    detect: { type: 'grep', path: '{instruction_file}', pattern: 'grep.*old.*pattern|zero.*remaining|grep.*rename' },
    recommendation: 'Add grep-after-rename gate to DoD',
    recommendationKey: 'add-grep-gate',
  },
  {
    id: '1.4.4', name: 'Log-update gate', tier: 'foundation', category: 'Definition of Done',
    pts: 1, confidence: 'high',
    detect: { type: 'grep', path: '{instruction_file}', pattern: 'logs? updated|lessons.*updated|footguns.*updated|update.*log|log.*update|MUST.*log' },
    recommendation: 'Add log-update gate to DoD',
    recommendationKey: 'add-log-gate',
  },

  // === 1.5 Enforcement Baseline (8 pts) ===
  {
    id: '1.5.1', name: 'Deny mechanism exists', tier: 'foundation', category: 'Enforcement',
    pts: 3, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        const deny = ctx.agentFacts.agent.denyMechanism;
        // Whether any deny mechanism was found for this agent
        let exists = false;
        // Path(s) where the deny mechanism was detected
        let evidence = '';

        if (deny.type === 'settings-deny') {
          exists = ctx.agentFacts.settings.hasDenyPatterns;
          evidence = deny.path;
        } else if (deny.type === 'deny-script') {
          exists = ctx.agentFacts.hooks.denyExists;
          evidence = deny.path;
        } else {
          exists = ctx.agentFacts.settings.hasDenyPatterns || ctx.agentFacts.hooks.denyExists;
          evidence = `${deny.settingsPath} or ${deny.scriptPath}`;
        }

        return {
          id: '1.5.1', name: 'Deny mechanism exists', tier: 'foundation', category: 'Enforcement',
          status: exists ? 'pass' : 'fail', points: exists ? 3 : 0, maxPoints: 3, confidence: 'high',
          message: exists ? `Deny mechanism found at ${evidence}` : 'No deny mechanism found',
          evidence,
        };
      },
    },
    recommendation: 'Add a deny mechanism (permissions.deny in settings.json or deny-dangerous.sh script)',
    recommendationKey: 'add-deny-mechanism',
  },
  {
    id: '1.5.2', name: 'git commit blocked', tier: 'foundation', category: 'Enforcement',
    pts: 1, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => ({
        id: '1.5.2', name: 'git commit blocked', tier: 'foundation', category: 'Enforcement',
        status: ctx.agentFacts.deny.gitCommitBlocked ? 'pass' : 'fail',
        points: ctx.agentFacts.deny.gitCommitBlocked ? 1 : 0, maxPoints: 1, confidence: 'high',
        message: ctx.agentFacts.deny.gitCommitBlocked ? 'git commit is blocked' : 'git commit is not blocked',
      }),
    },
    recommendation: 'Block git commit in deny mechanism',
    recommendationKey: 'block-git-commit',
  },
  {
    id: '1.5.3', name: 'git push blocked', tier: 'foundation', category: 'Enforcement',
    pts: 2, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => ({
        id: '1.5.3', name: 'git push blocked', tier: 'foundation', category: 'Enforcement',
        status: ctx.agentFacts.deny.gitPushBlocked ? 'pass' : 'fail',
        points: ctx.agentFacts.deny.gitPushBlocked ? 2 : 0, maxPoints: 2, confidence: 'high',
        message: ctx.agentFacts.deny.gitPushBlocked ? 'git push is blocked' : 'git push is not blocked',
      }),
    },
    recommendation: 'Block git push in deny mechanism',
    recommendationKey: 'block-git-push',
  },
  {
    id: '1.5.4', name: 'Deny hook/script exists', tier: 'foundation', category: 'Enforcement',
    pts: 2, confidence: 'high',
    detect: {
      type: 'custom',
      fn: (ctx: FactContext): CheckResult => {
        // Whether a deny-dangerous script exists in the hooks directory
        const exists = ctx.agentFacts.hooks.denyExists;
        return {
          id: '1.5.4', name: 'Deny hook/script exists', tier: 'foundation', category: 'Enforcement',
          status: exists ? 'pass' : 'fail', points: exists ? 2 : 0, maxPoints: 2, confidence: 'high',
          message: exists ? 'Deny hook/script exists' : 'No deny hook/script found',
        };
      },
    },
    recommendation: 'Create deny-dangerous.sh hook/script',
    recommendationKey: 'create-deny-script',
  },
];

/**
 * Search the instruction file sections for a heading containing the given name.
 * Returns the section body text, or null if no matching heading is found.
 */
function findSection(ctx: FactContext, name: string): string | null {
  // Iterate over all parsed section headings in the instruction file
  for (const [heading, content] of ctx.agentFacts.instruction.sections) {
    if (heading.includes(name.toLowerCase())) return content;
  }
  return null;
}
