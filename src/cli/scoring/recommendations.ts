import type { CheckResult, AntiPatternResult, Recommendation, CheckDef, AntiPatternDef } from '../types.js';

type Priority = Recommendation['priority'];

const TIER_PRIORITY: Record<string, Priority> = {
  foundation: 'critical',
  standard: 'high',
  full: 'medium',
};

export function generateRecommendations(
  checkResults: CheckResult[],
  antiPatternResults: AntiPatternResult[],
  checkDefs: CheckDef[],
  antiPatternDefs: AntiPatternDef[],
): Recommendation[] {
  const recommendations: Recommendation[] = [];

  // Failed/partial checks
  for (const result of checkResults) {
    if (result.status === 'pass' || result.status === 'na') continue;

    const def = checkDefs.find(c => c.id === result.id);
    if (!def) continue;

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

  // Triggered anti-patterns
  for (const result of antiPatternResults) {
    if (!result.triggered) continue;

    const def = antiPatternDefs.find(ap => ap.id === result.id);
    if (!def) continue;

    recommendations.push({
      priority: Math.abs(def.deduction) >= 5 ? 'critical' : 'high',
      checkId: result.id,
      category: 'Anti-Pattern',
      message: result.message,
      action: def.recommendation,
      key: def.recommendationKey,
    });
  }

  // Sort by priority
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
