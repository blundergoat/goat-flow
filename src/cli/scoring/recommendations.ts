import type { CheckResult, AntiPatternResult, Recommendation, CheckDef, AntiPatternDef } from '../types.js';

/** Shorthand alias for the priority union type */
type Priority = Recommendation['priority'];

/** Default priority assigned to failed checks based on their tier */
const TIER_PRIORITY: Record<string, Priority> = {
  foundation: 'critical',
  standard: 'high',
  full: 'medium',
};

/** Generate prioritised recommendations from failed checks and triggered anti-patterns */
export function generateRecommendations(
  checkResults: CheckResult[],
  antiPatternResults: AntiPatternResult[],
  checkDefs: CheckDef[],
  antiPatternDefs: AntiPatternDef[],
): Recommendation[] {
  /** Accumulated recommendations sorted before return */
  const recommendations: Recommendation[] = [];

  // Iterate over each check result to create recommendations for failures
  for (const result of checkResults) {
    if (result.status === 'pass' || result.status === 'na') continue;

    /** Matching check definition for this result */
    const def = checkDefs.find(c => c.id === result.id);
    if (def === undefined) continue;

    /** Priority based on partial status or the tier default */
    const priority: Priority = result.status === 'partial'
      ? 'low'
      : TIER_PRIORITY[result.tier] ?? 'medium';

    recommendations.push({
      priority,
      checkId: result.id,
      category: result.category,
      message: result.message,
      action: def.recommendation,
      key: def.recommendationKey,
    });
  }

  // Iterate over each anti-pattern result to create recommendations for triggered ones
  for (const result of antiPatternResults) {
    if (result.triggered === false) continue;

    /** Matching anti-pattern definition for this result */
    const def = antiPatternDefs.find(ap => ap.id === result.id);
    if (def === undefined) continue;

    recommendations.push({
      priority: Math.abs(def.deduction) >= 5 ? 'critical' : 'high',
      checkId: result.id,
      category: 'Anti-Pattern',
      message: result.message,
      action: def.recommendation,
      key: def.recommendationKey,
    });
  }

  /** Numeric ordering for sorting priorities from most to least urgent */
  const priorityOrder: Record<Priority, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  recommendations.sort((a, b) => {
    const diff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (diff !== 0) return diff;
    return a.checkId.localeCompare(b.checkId);
  });

  return recommendations;
}
