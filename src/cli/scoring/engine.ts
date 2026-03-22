import type {
  CheckResult, AntiPatternResult, ScoreSummary, TierScore, Grade,
  FactContext, CheckDef, AntiPatternDef,
} from '../types.js';
import { evaluate } from '../evaluate/evaluators.js';

const GRADE_THRESHOLDS: [number, Grade][] = [
  [90, 'A'],
  [75, 'B'],
  [60, 'C'],
  [40, 'D'],
  [0, 'F'],
];

const MAX_DEDUCTION = -15;
const INFLATION_THRESHOLD = 0.10; // <10% applicable = insufficient data

export function runChecks(checks: CheckDef[], ctx: FactContext): CheckResult[] {
  return checks.map(check => {
    // Check N/A condition
    if (check.na && check.na(ctx)) {
      return {
        id: check.id,
        name: check.name,
        tier: check.tier,
        category: check.category,
        status: 'na' as const,
        points: 0,
        maxPoints: 0,
        confidence: check.confidence,
        message: 'Not applicable',
        recommendationKey: check.recommendationKey,
      };
    }

    try {
      const result = evaluate(
        check.id, check.name, check.tier, check.category,
        check.pts, check.partialPts, check.detect, check.confidence, ctx,
      );
      result.recommendationKey = check.recommendationKey;
      return result;
    } catch (err) {
      return {
        id: check.id,
        name: check.name,
        tier: check.tier,
        category: check.category,
        status: 'fail' as const,
        points: 0,
        maxPoints: check.pts,
        confidence: check.confidence,
        message: `Check crashed: ${err instanceof Error ? err.message : String(err)}`,
        recommendationKey: check.recommendationKey,
      };
    }
  });
}

export function runAntiPatterns(patterns: AntiPatternDef[], ctx: FactContext): AntiPatternResult[] {
  return patterns.map(ap => {
    if (ap.na && ap.na(ctx)) {
      return {
        id: ap.id,
        name: ap.name,
        triggered: false,
        deduction: 0,
        confidence: ap.confidence,
        message: 'Not applicable',
      };
    }
    try {
      return ap.evaluate(ctx);
    } catch (err) {
      return {
        id: ap.id,
        name: ap.name,
        triggered: false,
        deduction: 0,
        confidence: ap.confidence,
        message: `Anti-pattern check crashed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  });
}

export function computeScore(
  checkResults: CheckResult[],
  antiPatternResults: AntiPatternResult[],
  totalCheckCount: number,
): ScoreSummary {
  // Per-tier scoring
  const foundation = scoreTier(checkResults, 'foundation');
  const standard = scoreTier(checkResults, 'standard');
  const full = scoreTier(checkResults, 'full');

  // Overall
  const earned = foundation.earned + standard.earned + full.earned;
  const available = foundation.available + standard.available + full.available;

  // Anti-pattern deductions
  const rawDeductions = antiPatternResults
    .filter(ap => ap.triggered)
    .reduce((sum, ap) => sum + ap.deduction, 0);
  const deductions = Math.max(rawDeductions, MAX_DEDUCTION);

  // Final score
  const raw = Math.max(0, earned + deductions);
  const percentage = available > 0 ? Math.round((raw / available) * 100) : 0;

  // N/A inflation guard
  const applicableChecks = checkResults.filter(c => c.status !== 'na').length;
  const applicableRatio = totalCheckCount > 0 ? applicableChecks / totalCheckCount : 0;
  const grade = applicableRatio < INFLATION_THRESHOLD
    ? 'insufficient-data' as Grade
    : computeGrade(percentage);

  return {
    earned,
    available,
    deductions,
    percentage,
    grade,
    tiers: { foundation, standard, full },
  };
}

function scoreTier(results: CheckResult[], tier: string): TierScore {
  const tierResults = results.filter(r => r.tier === tier);

  // Sum raw weighted values, round once at the end (not per-check)
  // This ensures 1pt medium checks actually contribute 0.5, not 1.0
  let rawEarned = 0;
  let rawAvailable = 0;
  for (const r of tierResults) {
    const weight = r.confidence === 'medium' || r.confidence === 'low' ? 0.5 : 1.0;
    rawEarned += r.points * weight;
    rawAvailable += r.maxPoints * weight;
  }
  const earned = Math.round(rawEarned);
  const available = Math.round(rawAvailable);

  const percentage = available > 0 ? Math.round((earned / available) * 100) : 0;
  return { tier: tier as TierScore['tier'], earned, available, percentage };
}

function computeGrade(percentage: number): Grade {
  for (const [threshold, grade] of GRADE_THRESHOLDS) {
    if (percentage >= threshold) return grade;
  }
  return 'F';
}
