import type {
  CheckResult, AntiPatternResult, ScoreSummary, TierScore, Grade,
  FactContext, CheckDef, AntiPatternDef,
} from '../types.js';
import { evaluateCheck } from '../scanner/check-evaluator.js';

/** Percentage thresholds mapped to letter grades, checked top-down */
const GRADE_THRESHOLDS: [number, Grade][] = [
  [90, 'A'],
  [75, 'B'],
  [60, 'C'],
  [40, 'D'],
  [0, 'F'],
];

/** Floor for total anti-pattern deductions to prevent runaway penalties */
const MAX_DEDUCTION = -15;
/** Minimum ratio of applicable checks before grading; below this yields insufficient-data */
const INFLATION_THRESHOLD = 0.10;

/** Execute all check definitions against the fact context and return results */
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
      /** Evaluation result from running the check's detect function */
      const result = evaluateCheck(
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

/** Execute all anti-pattern definitions against the fact context and return results */
export function runAntiPatterns(patterns: AntiPatternDef[], ctx: FactContext): AntiPatternResult[] {
  return patterns.map(antiPattern => {
    if (antiPattern.na && antiPattern.na(ctx)) {
      return {
        id: antiPattern.id,
        name: antiPattern.name,
        triggered: false,
        deduction: 0,
        confidence: antiPattern.confidence,
        message: 'Not applicable',
      };
    }
    try {
      return antiPattern.evaluate(ctx);
    } catch (err) {
      return {
        id: antiPattern.id,
        name: antiPattern.name,
        triggered: false,
        deduction: 0,
        confidence: antiPattern.confidence,
        message: `Anti-pattern check crashed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  });
}

/** Compute the overall score summary from check results and anti-pattern results */
export function computeScore(
  checkResults: CheckResult[],
  antiPatternResults: AntiPatternResult[],
  totalCheckCount: number,
): ScoreSummary {
  /** Foundation tier score */
  const foundation = scoreTier(checkResults, 'foundation');
  /** Standard tier score */
  const standard = scoreTier(checkResults, 'standard');
  /** Full tier score */
  const full = scoreTier(checkResults, 'full');

  /** Total earned points across all tiers */
  const earned = foundation.earned + standard.earned + full.earned;
  /** Total available points across all tiers */
  const available = foundation.available + standard.available + full.available;

  /** Sum of deductions from all triggered anti-patterns before clamping */
  const rawDeductions = antiPatternResults
    .filter(ap => ap.triggered)
    .reduce((sum, ap) => sum + ap.deduction, 0);
  /** Clamped deductions, floored at MAX_DEDUCTION */
  const deductions = Math.max(rawDeductions, MAX_DEDUCTION);

  /** Final raw score after applying deductions, floored at zero */
  const raw = Math.max(0, earned + deductions);
  /** Percentage score rounded to the nearest integer */
  const percentage = available > 0 ? Math.round((raw / available) * 100) : 0;

  /** Number of checks that are not N/A */
  const applicableChecks = checkResults.filter(c => c.status !== 'na').length;
  /** Ratio of applicable checks to total, used for inflation guard */
  const applicableRatio = totalCheckCount > 0 ? applicableChecks / totalCheckCount : 0;
  /** Letter grade, or insufficient-data if too few checks are applicable */
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

/** Calculate earned and available points for a single scoring tier */
function scoreTier(results: CheckResult[], tier: 'foundation' | 'standard' | 'full'): TierScore {
  /** Check results that belong to this tier */
  const tierResults = results.filter(r => r.tier === tier);

  // Sum raw weighted values, round once at the end (not per-check).
  // This ensures 1pt medium checks actually contribute 0.5, not 1.0.
  let rawEarned = 0;
  let rawAvailable = 0;
  // Iterate over each tier result to accumulate weighted points
  for (const r of tierResults) {
    /** Confidence-based weight: medium/low checks count at half value */
    const weight = r.confidence === 'medium' || r.confidence === 'low' ? 0.5 : 1.0;
    rawEarned += r.points * weight;
    rawAvailable += r.maxPoints * weight;
  }
  /** Earned points for this tier, rounded from weighted sum */
  const earned = Math.round(rawEarned);
  /** Available points for this tier, rounded from weighted sum */
  const available = Math.round(rawAvailable);

  /** Percentage score for this tier */
  const percentage = available > 0 ? Math.round((earned / available) * 100) : 0;
  return { tier, earned, available, percentage };
}

/** Map a percentage to a letter grade using the threshold table */
function computeGrade(percentage: number): Grade {
  // Iterate over each threshold to find the first one the percentage meets
  for (const [threshold, grade] of GRADE_THRESHOLDS) {
    if (percentage >= threshold) return grade;
  }
  return 'F';
}
