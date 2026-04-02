import type { CheckResult, AntiPatternResult, Recommendation, CheckDef, AntiPatternDef } from '../types.js';

/** Shorthand alias for the priority union type */
type Priority = Recommendation['priority'];

/** Default priority assigned to failed checks based on their tier */
const TIER_PRIORITY: Record<string, Priority> = {
  foundation: 'critical',
  standard: 'high',
  full: 'medium',
};

const PRIORITY_ORDER: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function createCheckRecommendation(result: CheckResult, checkDefs: CheckDef[]): Recommendation | null {
  if (result.status === 'pass' || result.status === 'na') return null;

  const definition = checkDefs.find(check => check.id === result.id);
  if (definition === undefined) return null;

  return {
    priority: result.status === 'partial' ? 'low' : TIER_PRIORITY[result.tier] ?? 'medium',
    checkId: result.id,
    category: result.category,
    message: result.message,
    action: definition.recommendation,
    key: definition.recommendationKey,
  };
}

function createAntiPatternRecommendation(
  result: AntiPatternResult,
  antiPatternDefs: AntiPatternDef[],
): Recommendation | null {
  if (result.triggered === false) return null;

  const definition = antiPatternDefs.find(antiPattern => antiPattern.id === result.id);
  if (definition === undefined) return null;

  return {
    priority: Math.abs(definition.deduction) >= 5 ? 'critical' : 'high',
    checkId: result.id,
    category: 'Anti-Pattern',
    message: result.message,
    action: definition.recommendation,
    key: definition.recommendationKey,
  };
}

/** Generate prioritised recommendations from failed checks and triggered anti-patterns */
export function generateRecommendations(
  checkResults: CheckResult[],
  antiPatternResults: AntiPatternResult[],
  checkDefs: CheckDef[],
  antiPatternDefs: AntiPatternDef[],
): Recommendation[] {
  /** Accumulated recommendations sorted before return */
  const recommendations: Recommendation[] = [];

  for (const result of checkResults) {
    const recommendation = createCheckRecommendation(result, checkDefs);
    if (recommendation) recommendations.push(recommendation);
  }

  for (const result of antiPatternResults) {
    const recommendation = createAntiPatternRecommendation(result, antiPatternDefs);
    if (recommendation) recommendations.push(recommendation);
  }

  recommendations.sort((a, b) => {
    const diff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (diff !== 0) return diff;
    return a.checkId.localeCompare(b.checkId);
  });

  return recommendations;
}
