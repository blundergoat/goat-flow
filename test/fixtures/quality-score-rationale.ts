/**
 * Build the compact rationale ledger required beside every current quality score.
 * Tests reuse one complete shape so parser, persistence, and renderer fixtures cannot omit an axis accidentally.
 */
export function makeQualityScoreRationale() {
  const rationale = {
    evidence: "The cited source and runtime evidence support this axis score.",
    deduction: "The cited rating-band evidence explains the points deducted.",
  };
  return {
    setup: {
      accuracy: { ...rationale },
      relevance: { ...rationale },
      completeness: { ...rationale },
      friction: { ...rationale },
    },
    system: {
      usefulness: { ...rationale },
      signal_to_noise: { ...rationale },
      adaptability: { ...rationale },
      learnability: { ...rationale },
    },
  };
}
