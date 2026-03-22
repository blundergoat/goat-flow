import type { CheckDef, AntiPatternDef } from '../types.js';
import { foundationChecks } from './foundation.js';
import { standardChecks } from './standard.js';
import { fullChecks } from './full.js';
import { antiPatterns } from './anti-patterns.js';

// Combined array of all rubric checks across all three tiers
const allChecks: CheckDef[] = [
  ...foundationChecks,
  ...standardChecks,
  ...fullChecks,
];

// Re-exported anti-pattern definitions for the scoring engine
const allAntiPatterns: AntiPatternDef[] = antiPatterns;

export { allChecks, allAntiPatterns };

/**
 * Look up a single check definition by its ID (e.g., "1.1.1").
 * Returns undefined if the ID does not match any registered check.
 */
export function getCheck(id: string): CheckDef | undefined {
  return allChecks.find(c => c.id === id);
}

/**
 * Return all check definitions belonging to the specified scoring tier.
 */
export function getChecksByTier(tier: 'foundation' | 'standard' | 'full'): CheckDef[] {
  return allChecks.filter(c => c.tier === tier);
}

/**
 * Return all check definitions belonging to the specified category name.
 */
export function getChecksByCategory(category: string): CheckDef[] {
  return allChecks.filter(c => c.category === category);
}
