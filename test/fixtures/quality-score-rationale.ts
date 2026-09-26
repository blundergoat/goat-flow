/**
 * Supply complete score-rationale fixtures for quality parsing, persistence, and rendering tests.
 *
 * Every setup and system axis receives the same controlled evidence and deduction text.
 * Tests can change one axis without accidentally omitting the rest of the required ledger.
 */
/**
 * Build a fresh rationale ledger when a quality test needs all required axes present.
 *
 * @returns separate axis objects with nonempty fixture text; callers can change one axis without changing another
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
