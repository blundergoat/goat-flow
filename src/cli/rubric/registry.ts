import type { CheckDef, AntiPatternDef } from '../types.js';
import { foundationChecks } from './foundation.js';
import { standardChecks } from './standard.js';
import { fullChecks } from './full.js';
import { antiPatterns } from './anti-patterns.js';

export const allChecks: CheckDef[] = [
  ...foundationChecks,
  ...standardChecks,
  ...fullChecks,
];

export const allAntiPatterns: AntiPatternDef[] = antiPatterns;

export function getCheck(id: string): CheckDef | undefined {
  return allChecks.find(c => c.id === id);
}

export function getChecksByTier(tier: 'foundation' | 'standard' | 'full'): CheckDef[] {
  return allChecks.filter(c => c.tier === tier);
}

export function getChecksByCategory(category: string): CheckDef[] {
  return allChecks.filter(c => c.category === category);
}
