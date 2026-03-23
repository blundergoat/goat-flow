import type { AntiPatternDef, FactContext, AntiPatternResult } from '../types.js';

/**
 * Anti-Pattern Deductions (max -15)
 * AP1-AP9 in v1. AP10 + AP11 deferred to v2 (require git history).
 */
export const antiPatterns: AntiPatternDef[] = [
  // === AP1-AP3: Instruction File Anti-Patterns ===
  {
    id: 'AP1', name: 'Instruction file over 150 lines', deduction: -3, confidence: 'high',
    evaluate: (ctx: FactContext): AntiPatternResult => {
      const lines = ctx.agentFacts.instruction.lineCount;
      const triggered = lines > 150;
      return { id: 'AP1', name: 'Instruction file over 150 lines', triggered, deduction: triggered ? -3 : 0, confidence: 'high', message: triggered ? `${lines} lines (hard limit: 150)` : `${lines} lines (OK)`, evidence: ctx.agentFacts.agent.instructionFile };
    },
    recommendation: 'Compress instruction file below 150 lines',
    recommendationKey: 'ap-compress-instruction-file',
  },
  {
    id: 'AP2', name: 'Skill name conflicts with built-in', deduction: -3, confidence: 'high',
    evaluate: (ctx: FactContext): AntiPatternResult => {
      // Filter skills that lack the required goat- prefix
      const nonGoat = ctx.agentFacts.skills.found.filter(s => s.startsWith('goat-') === false);
      const triggered = nonGoat.length > 0;
      return { id: 'AP2', name: 'Skill name conflicts with built-in', triggered, deduction: triggered ? -3 : 0, confidence: 'high', message: triggered ? `Skills without goat- prefix: ${nonGoat.join(', ')}` : 'All skills use goat- prefix' };
    },
    recommendation: 'Rename skills to use goat- prefix',
    recommendationKey: 'ap-fix-skill-names',
  },
  {
    id: 'AP3', name: 'DoD in both instruction file and guidelines', deduction: -3, confidence: 'low',
    evaluate: (ctx: FactContext): AntiPatternResult => {
      // Check for actual DoD SECTION duplication (heading), not just the word "DoD" in passing
      const DOD_SECTION = /^#+\s*definition of done/im;
      const instructionContent = ctx.agentFacts.instruction.content;
      const conventionsContent = ctx.facts.shared.localInstructions.conventionsContent;
      const inInstruction = instructionContent !== null && DOD_SECTION.test(instructionContent);
      const inConventions = conventionsContent !== null && DOD_SECTION.test(conventionsContent);
      const triggered = inInstruction && inConventions;
      return { id: 'AP3', name: 'DoD in both instruction file and guidelines', triggered, deduction: triggered ? -3 : 0, confidence: 'low', message: triggered ? 'DoD appears in both instruction file and conventions.md — risk of conflicting definitions' : 'No DoD duplication detected' };
    },
    recommendation: 'Remove DoD from guidelines file',
    recommendationKey: 'ap-fix-dod-overlap',
  },

  // === AP4-AP6: Settings and Hooks Anti-Patterns ===
  {
    id: 'AP4', name: 'Footguns without file:line evidence', deduction: -5, confidence: 'high',
    evaluate: (ctx: FactContext): AntiPatternResult => {
      const { exists, hasEvidence } = ctx.facts.shared.footguns;
      const triggered = exists && hasEvidence === false;
      return { id: 'AP4', name: 'Footguns without file:line evidence', triggered, deduction: triggered ? -5 : 0, confidence: 'high', message: triggered ? 'footguns.md has no file:line evidence' : (exists ? 'Footguns have evidence' : 'No footguns.md') };
    },
    recommendation: 'Add file:line evidence to all footgun entries',
    recommendationKey: 'ap-add-footgun-evidence',
  },
  {
    id: 'AP5', name: 'settings.json invalid JSON', deduction: -5, confidence: 'high',
    na: (ctx) => ctx.agentFacts.agent.settingsFile === null,
    evaluate: (ctx: FactContext): AntiPatternResult => {
      if (ctx.agentFacts.settings.exists === false) return { id: 'AP5', name: 'settings.json invalid JSON', triggered: false, deduction: 0, confidence: 'high', message: 'No settings file' };
      const triggered = ctx.agentFacts.settings.valid === false;
      return { id: 'AP5', name: 'settings.json invalid JSON', triggered, deduction: triggered ? -5 : 0, confidence: 'high', message: triggered ? 'settings.json is invalid JSON' : 'settings.json is valid', evidence: ctx.agentFacts.agent.settingsFile ?? undefined };
    },
    recommendation: 'Fix settings.json — invalid JSON',
    recommendationKey: 'ap-fix-settings-json',
  },
  {
    id: 'AP6', name: 'Post-turn hook exits non-zero', deduction: -5, confidence: 'medium',
    evaluate: (ctx: FactContext): AntiPatternResult => {
      if (ctx.agentFacts.hooks.postTurnExists === false) return { id: 'AP6', name: 'Post-turn hook exits non-zero', triggered: false, deduction: 0, confidence: 'medium', message: 'No post-turn hook' };
      const triggered = ctx.agentFacts.hooks.postTurnExitsZero === false;
      return { id: 'AP6', name: 'Post-turn hook exits non-zero', triggered, deduction: triggered ? -5 : 0, confidence: 'medium', message: triggered ? 'Post-turn hook may not exit 0 (causes infinite loops)' : 'Post-turn hook exits 0' };
    },
    recommendation: 'Ensure stop-lint hook ends with exit 0',
    recommendationKey: 'ap-fix-hook-exit',
  },

  // === AP7-AP9: Local Files and Gitignore Anti-Patterns ===
  {
    id: 'AP7', name: 'Local per-directory instruction file over 20 lines', deduction: -2, confidence: 'high',
    evaluate: (ctx: FactContext): AntiPatternResult => {
      // Only check per-directory local files (e.g., src/api/CLAUDE.md)
      // EXCLUDE ai/instructions/ and .github/instructions/ — those are cold-path files meant to be 40-60 lines
      const oversize = ctx.facts.shared.localInstructions.localFileSizes
        .filter(f => f.path.includes('ai/instructions/') === false && f.path.includes('.github/instructions/') === false)
        .filter(f => f.lines > 20);
      const triggered = oversize.length > 0;
      const message = triggered
        ? `Oversize local files: ${oversize.map(f => `${f.path} (${f.lines} lines)`).join(', ')}`
        : 'All local per-directory instruction files are 20 lines or fewer';
      return { id: 'AP7', name: 'Local per-directory instruction file over 20 lines', triggered, deduction: triggered ? -2 : 0, confidence: 'high', message };
    },
    recommendation: 'Compress local instruction files to under 20 lines',
    recommendationKey: 'ap-compress-local-files',
  },
  {
    id: 'AP8', name: 'Generic Ask First boundaries', deduction: -2, confidence: 'medium',
    evaluate: (ctx: FactContext): AntiPatternResult => {
      const section = findSection(ctx, 'ask first');
      if (section === null) return { id: 'AP8', name: 'Generic Ask First boundaries', triggered: false, deduction: 0, confidence: 'medium', message: 'No Ask First section' };
      // Known template text that indicates the boundaries were not customized
      const genericMarkers = ['auth, routing, deployment, API, DB', 'Public API, dependencies, config', 'Shared sourced files, CONFIGURATION'];
      const triggered = genericMarkers.some(m => section.includes(m));
      return { id: 'AP8', name: 'Generic Ask First boundaries', triggered, deduction: triggered ? -2 : 0, confidence: 'medium', message: triggered ? 'Ask First matches template text' : 'Ask First appears project-specific' };
    },
    recommendation: 'Replace generic Ask First boundaries with project-specific ones',
    recommendationKey: 'ap-fix-generic-ask-first',
  },
  {
    id: 'AP9', name: 'settings.local.json committed', deduction: -2, confidence: 'high',
    na: (ctx) => ctx.agentFacts.agent.settingsFile === null,
    evaluate: (ctx: FactContext): AntiPatternResult => {
      if (ctx.facts.shared.gitignore.exists === false) {
        return { id: 'AP9', name: 'settings.local.json committed', triggered: true, deduction: -2, confidence: 'high', message: 'No .gitignore — settings.local.json is not protected' };
      }
      const triggered = ctx.facts.shared.gitignore.hasRequiredEntries === false;
      return { id: 'AP9', name: 'settings.local.json committed', triggered, deduction: triggered ? -2 : 0, confidence: 'high', message: triggered ? 'settings.local.json not in .gitignore' : 'settings.local.json is gitignored' };
    },
    recommendation: 'Add settings.local.json to .gitignore',
    recommendationKey: 'ap-gitignore-settings-local',
  },
  // === AP10-AP12: Quality Anti-Patterns ===
  {
    id: 'AP10', name: 'settings.local.json bloat', deduction: -2, confidence: 'high',
    na: (ctx) => ctx.agentFacts.agent.settingsFile === null,
    evaluate: (ctx: FactContext): AntiPatternResult => {
      const { exists, lineCount } = ctx.agentFacts.settingsLocal;
      if (!exists) return { id: 'AP10', name: 'settings.local.json bloat', triggered: false, deduction: 0, confidence: 'high', message: 'No settings.local.json' };
      const triggered = lineCount > 50;
      return { id: 'AP10', name: 'settings.local.json bloat', triggered, deduction: triggered ? -2 : 0, confidence: 'high', message: triggered ? `settings.local.json is ${lineCount} lines — prune session artifacts (target: under 20)` : `settings.local.json is ${lineCount} lines (OK)` };
    },
    recommendation: 'Prune settings.local.json — remove one-off debugging commands',
    recommendationKey: 'ap-prune-settings-local',
  },
  {
    id: 'AP11', name: 'Empty learning loop scaffolding', deduction: -2, confidence: 'high',
    evaluate: (ctx: FactContext): AntiPatternResult => {
      const { lessons, footguns, decisions } = ctx.facts.shared;
      const lessonsEmpty = lessons.exists && !lessons.hasEntries;
      const footgunsEmpty = footguns.exists && !footguns.hasEvidence;
      const decisionsEmpty = decisions.dirExists && decisions.fileCount === 0;
      const triggered = (lessonsEmpty && footgunsEmpty) || (lessonsEmpty && decisionsEmpty && footgunsEmpty);
      return { id: 'AP11', name: 'Empty learning loop scaffolding', triggered, deduction: triggered ? -2 : 0, confidence: 'high', message: triggered ? 'Learning loop files exist but are empty — populate with real incidents or remove' : 'Learning loop files have content' };
    },
    recommendation: 'Populate learning loop files with real incidents or remove empty scaffolding',
    recommendationKey: 'ap-fix-empty-scaffolding',
  },
  {
    id: 'AP12', name: 'Stale file references in footguns.md', deduction: -3, confidence: 'high',
    evaluate: (ctx: FactContext): AntiPatternResult => {
      const { staleRefs, totalRefs } = ctx.facts.shared.footguns;
      if (totalRefs === 0) return { id: 'AP12', name: 'Stale file references in footguns.md', triggered: false, deduction: 0, confidence: 'high', message: 'No file references to check' };
      const triggered = staleRefs.length > 0;
      return { id: 'AP12', name: 'Stale file references in footguns.md', triggered, deduction: triggered ? -3 : 0, confidence: 'high', message: triggered ? `${staleRefs.length} stale refs: ${staleRefs.slice(0, 3).join(', ')}` : 'All file references resolve', evidence: triggered ? staleRefs.join(', ') : undefined };
    },
    recommendation: 'Update or remove stale file:line references in footguns.md',
    recommendationKey: 'ap-fix-stale-references',
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
