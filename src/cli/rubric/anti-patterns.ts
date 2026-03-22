import type { AntiPatternDef, FactContext, AntiPatternResult } from '../types.js';

/**
 * Anti-Pattern Deductions (max -15)
 * AP1-AP9 in v1. AP10 + AP11 deferred to v2 (require git history).
 */
export const antiPatterns: AntiPatternDef[] = [
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
      const nonGoat = ctx.agentFacts.skills.found.filter(s => !s.startsWith('goat-'));
      const triggered = nonGoat.length > 0;
      return { id: 'AP2', name: 'Skill name conflicts with built-in', triggered, deduction: triggered ? -3 : 0, confidence: 'high', message: triggered ? `Skills without goat- prefix: ${nonGoat.join(', ')}` : 'All skills use goat- prefix' };
    },
    recommendation: 'Rename skills to use goat- prefix',
    recommendationKey: 'ap-fix-skill-names',
  },
  {
    id: 'AP3', name: 'DoD in both instruction file and guidelines', deduction: -3, confidence: 'low',
    evaluate: (): AntiPatternResult => {
      return { id: 'AP3', name: 'DoD in both instruction file and guidelines', triggered: false, deduction: 0, confidence: 'low', message: 'Cannot verify without guidelines file (manual check recommended)' };
    },
    recommendation: 'Remove DoD from guidelines file',
    recommendationKey: 'ap-fix-dod-overlap',
  },
  {
    id: 'AP4', name: 'Footguns without file:line evidence', deduction: -5, confidence: 'high',
    evaluate: (ctx: FactContext): AntiPatternResult => {
      const { exists, hasEvidence } = ctx.facts.shared.footguns;
      const triggered = exists && !hasEvidence;
      return { id: 'AP4', name: 'Footguns without file:line evidence', triggered, deduction: triggered ? -5 : 0, confidence: 'high', message: triggered ? 'footguns.md has no file:line evidence' : (exists ? 'Footguns have evidence' : 'No footguns.md') };
    },
    recommendation: 'Add file:line evidence to all footgun entries',
    recommendationKey: 'ap-add-footgun-evidence',
  },
  {
    id: 'AP5', name: 'settings.json invalid JSON', deduction: -5, confidence: 'high',
    na: (ctx) => ctx.agentFacts.agent.settingsFile === null,
    evaluate: (ctx: FactContext): AntiPatternResult => {
      if (!ctx.agentFacts.settings.exists) return { id: 'AP5', name: 'settings.json invalid JSON', triggered: false, deduction: 0, confidence: 'high', message: 'No settings file' };
      const triggered = !ctx.agentFacts.settings.valid;
      return { id: 'AP5', name: 'settings.json invalid JSON', triggered, deduction: triggered ? -5 : 0, confidence: 'high', message: triggered ? 'settings.json is invalid JSON' : 'settings.json is valid', evidence: ctx.agentFacts.agent.settingsFile ?? undefined };
    },
    recommendation: 'Fix settings.json — invalid JSON',
    recommendationKey: 'ap-fix-settings-json',
  },
  {
    id: 'AP6', name: 'Post-turn hook exits non-zero', deduction: -5, confidence: 'medium',
    evaluate: (ctx: FactContext): AntiPatternResult => {
      if (!ctx.agentFacts.hooks.postTurnExists) return { id: 'AP6', name: 'Post-turn hook exits non-zero', triggered: false, deduction: 0, confidence: 'medium', message: 'No post-turn hook' };
      const triggered = !ctx.agentFacts.hooks.postTurnExitsZero;
      return { id: 'AP6', name: 'Post-turn hook exits non-zero', triggered, deduction: triggered ? -5 : 0, confidence: 'medium', message: triggered ? 'Post-turn hook may not exit 0 (causes infinite loops)' : 'Post-turn hook exits 0' };
    },
    recommendation: 'Ensure stop-lint hook ends with exit 0',
    recommendationKey: 'ap-fix-hook-exit',
  },
  {
    id: 'AP7', name: 'Local instruction file over 20 lines', deduction: -2, confidence: 'high',
    evaluate: (): AntiPatternResult => {
      return { id: 'AP7', name: 'Local instruction file over 20 lines', triggered: false, deduction: 0, confidence: 'high', message: 'Not checked in v1 (requires per-file line count)' };
    },
    recommendation: 'Compress local instruction files to under 20 lines',
    recommendationKey: 'ap-compress-local-files',
  },
  {
    id: 'AP8', name: 'Generic Ask First boundaries', deduction: -2, confidence: 'medium',
    evaluate: (ctx: FactContext): AntiPatternResult => {
      const section = findSection(ctx, 'ask first');
      if (!section) return { id: 'AP8', name: 'Generic Ask First boundaries', triggered: false, deduction: 0, confidence: 'medium', message: 'No Ask First section' };
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
      const gitignored = ctx.facts.shared.gitignore.hasRequiredEntries;
      return { id: 'AP9', name: 'settings.local.json committed', triggered: false, deduction: 0, confidence: 'high', message: gitignored ? 'settings.local.json is gitignored' : 'Cannot verify without git' };
    },
    recommendation: 'Add settings.local.json to .gitignore',
    recommendationKey: 'ap-gitignore-settings-local',
  },
];

function findSection(ctx: FactContext, name: string): string | null {
  for (const [heading, content] of ctx.agentFacts.instruction.sections) {
    if (heading.includes(name.toLowerCase())) return content;
  }
  return null;
}
