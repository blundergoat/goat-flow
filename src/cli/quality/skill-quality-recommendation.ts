/**
 * Converts scored artifact metrics into the recommendation and fit notes shown in the Skills tab.
 * Use after classification and scoring when a reviewer needs to keep, revise, reclassify, retire, or manually inspect an artifact.
 *
 * Score bands, failed metrics, classification confidence, and shape mismatch determine the suggested route.
 * Thresholds remain advisory: the reviewer owns the final decision, and every subtype/shape disagreement stays visible in the notes.
 */
import type { ArtifactSubtype } from "./quality-config.js";
import type {
  ArtifactEntry,
  ClassificationResult,
  MetricResult,
  Recommendation,
  ShapeDetectionResult,
} from "./skill-quality-types.js";

const CONFIDENCE_THRESHOLD = 0.7; // Threshold: below 70%, strong scores still need human subtype review.

/**
 * Explain why a high-scoring artifact still needs subtype review.
 * Use when the Skills tab cannot confidently identify the artifact's subtype.
 */
function createClassificationReviewNote(
  classification: ClassificationResult,
): string {
  const topAlternative = classification.alternatives[0];
  const alternativeText = topAlternative
    ? `Could also be ${topAlternative.subtype} (match score ${topAlternative.score}).`
    : "No clear alternative subtype.";
  return `Strong structure but classification confidence is ${Math.round(
    classification.confidence * 100,
  )}% in ${classification.detectedSubtype}. ${alternativeText}`;
}

/**
 * Say plainly when a file is filed as one kind of artifact but reads like another, so a misfiled document cannot pass review silently.
 *
 * @param artifact - artifact being scored, supplying the path shown in the note
 * @param subtype - subtype the classifier settled on
 * @param shape - shape the content actually reads as
 * @returns the note shown to the reviewer, or null when filing and content agree and there is nothing to warn about
 */
function shapeMismatchNote(
  artifact: ArtifactEntry,
  subtype: ArtifactSubtype,
  shape: ShapeDetectionResult,
): string | null {
  // Matching filing and content shape needs no warning in the user's recommendation notes.
  if (shape.detectedShape === subtype) return null;
  const packagedArtifactKind =
    artifact.kind === "skill" ? "skill" : "shared reference";
  return `Packaged as ${packagedArtifactKind} using ${subtype} scoring profile, but semantic shape reads as ${shape.detectedShape} (${Math.round(
    shape.confidence * 100,
  )}% confidence).`;
}

/** The already-computed signals a verdict is drawn from, so neither branch recomputes them. */
interface RecommendationInputs {
  scoreRatio: number;
  failedMetricCount?: number;
  isClassificationConfident: boolean;
  artifactFitMetric: MetricResult | undefined;
  classification: ClassificationResult;
}

/**
 * Decide what to tell the user about an artifact installed as a skill.
 *
 * The order matters: a demote signal is reported before the score, because an artifact that is not shaped like a skill
 * should be moved rather than merely improved.
 *
 * @param inputs - score ratio, failed-metric count, classification confidence, and artifact-fit metric
 * @param recommendationNotes - user-facing explanation accumulated under the recommendation
 * @returns the recommendation and the same notes array after appending the explanation
 */
function recommendForSkill(
  inputs: RecommendationInputs,
  recommendationNotes: string[],
): { recommendation: Recommendation; fitNotes: string[] } {
  // The artifact does not look like a skill at all, so moving it beats improving it in place.
  if (inputs.artifactFitMetric?.signals?.shouldDemote) {
    recommendationNotes.push(
      "Artifact lacks skill structure. Consider converting it to a reference or playbook instead of a runnable skill.",
    );
    return {
      recommendation: "reference-playbook",
      fitNotes: recommendationNotes,
    };
  }
  // Several failing metrics at once is more than a scoring nudge can usefully summarise.
  if ((inputs.failedMetricCount ?? 0) >= 4) {
    recommendationNotes.push(
      `${inputs.failedMetricCount} metrics scored "fail". Manual review recommended.`,
    );
    return {
      recommendation: "needs-human-review",
      fitNotes: recommendationNotes,
    };
  }
  // A score of at least 70% can keep the skill only when subtype classification is also trustworthy.
  if (inputs.scoreRatio >= 0.7) {
    // Scoring well against a subtype nobody is confident about is not evidence the skill is right.
    if (!inputs.isClassificationConfident) {
      recommendationNotes.push(
        createClassificationReviewNote(inputs.classification),
      );
      return {
        recommendation: "consider-reclassifying",
        fitNotes: recommendationNotes,
      };
    }
    recommendationNotes.push(
      "Strong skill identity with adequate structural quality.",
    );
    return { recommendation: "keep-skill", fitNotes: recommendationNotes };
  }
  recommendationNotes.push(
    "Moderate quality. Review metric details for improvement opportunities.",
  );
  return { recommendation: "consider-revision", fitNotes: recommendationNotes };
}

/**
 * Decide what to tell the user about an artifact filed as a reference or playbook.
 *
 * Side effect: appends the user-facing explanation to `recommendationNotes`.
 *
 * @param inputs - the score ratio, classification confidence, and fit metric
 * @param recommendationNotes - user-facing explanation accumulated under the recommendation
 * @returns the recommendation and the notes explaining it
 */
function recommendForReference(
  inputs: RecommendationInputs,
  recommendationNotes: string[],
): { recommendation: Recommendation; fitNotes: string[] } {
  // Reference content carrying real skill structure is probably something the user meant to install as a skill.
  if (inputs.artifactFitMetric?.signals?.shouldPromote) {
    recommendationNotes.push(
      "Strong skill signals detected. Consider promoting to a first-class goat-* skill.",
    );
    return {
      recommendation: "needs-human-review",
      fitNotes: recommendationNotes,
    };
  }
  // A high score against an uncertain classification says the profile, not the artifact, may be wrong.
  if (inputs.scoreRatio >= 0.7 && !inputs.isClassificationConfident) {
    recommendationNotes.push(
      createClassificationReviewNote(inputs.classification),
    );
    return {
      recommendation: "consider-reclassifying",
      fitNotes: recommendationNotes,
    };
  }
  recommendationNotes.push("Fits reference/playbook classification.");
  return {
    recommendation: "reference-playbook",
    fitNotes: recommendationNotes,
  };
}

/**
 * Answer the verdicts that hold whatever kind the artifact is, before the skill and reference rules diverge.
 *
 * These rules come first because kind-specific advice cannot override meta-reference, shape-mismatch, retirement, or zero-score outcomes.
 * Each outcome either gives the user a final route or hands control to the skill/reference rules.
 *
 * @param artifact - the artifact being judged
 * @param inputs - score ratio, artifact-fit metric, and zero-score metric when one exists
 * @param shapeMismatchWarning - note shown when detected shape disagrees with the scoring profile; null means both agree
 * @param recommendationNotes - user-facing explanation accumulated under the recommendation
 * @returns the verdict, or null when none of these conditions applies and per-kind rules should decide
 */
function recommendKindIndependentVerdict(
  artifact: ArtifactEntry,
  inputs: {
    scoreRatio: number;
    artifactFitMetric: MetricResult | undefined;
    zeroScoreMetric: MetricResult | undefined;
  },
  shapeMismatchWarning: string | null,
  recommendationNotes: string[],
): { recommendation: Recommendation; fitNotes: string[] } | null {
  // Meta references are shared context rather than anything the user invokes, so they are never promoted.
  if (inputs.artifactFitMetric?.signals?.isMetaReference) {
    recommendationNotes.push(inputs.artifactFitMetric.detail);
    return {
      recommendation: "reference-playbook",
      fitNotes: recommendationNotes,
    };
  }
  // The score came from the wrong profile, so acting on it would act on the wrong measurement.
  if (shapeMismatchWarning !== null) {
    recommendationNotes.push(
      "Semantic shape differs from the applied scoring profile. Manual review required before keeping this recommendation.",
    );
    return {
      recommendation: "consider-reclassifying",
      fitNotes: recommendationNotes,
    };
  }
  // Scores below 30% tell the user to question whether the artifact remains worth keeping.
  if (inputs.scoreRatio < 0.3) {
    recommendationNotes.push(
      artifact.kind === "skill"
        ? "Very low quality score. Verify the artifact is still maintained and useful."
        : "Very low quality score for a reference.",
    );
    return { recommendation: "retire", fitNotes: recommendationNotes };
  }
  // A metric that scored nothing at all is a specific gap, not a general quality level.
  if (inputs.zeroScoreMetric) {
    recommendationNotes.push(
      `${inputs.zeroScoreMetric.label} scored 0/${inputs.zeroScoreMetric.maxScore}. Manual review required before keeping this recommendation.`,
    );
    // Shared references keep their filing recommendation while the zero-score gap remains visible for review.
    if (artifact.kind === "shared-reference") {
      recommendationNotes.push(
        "Still classified as reference/playbook; quality needs review.",
      );
    }
    return {
      recommendation: "needs-human-review",
      fitNotes: recommendationNotes,
    };
  }
  return null;
}

/**
 * Turn the scored metrics into the single recommendation and explanation a user reads in the Skills tab.
 *
 * This is the last stage of scoring: keep, revise, reclassify, retire, or escalate to a human. The thresholds are
 * advisory routing rather than hard gates, so the notes matter as much as the verdict and a reviewer owns the call.
 *
 * @param artifact - the artifact being judged
 * @param metrics - every scored metric row, read for failures and zeroed dimensions
 * @param totalScore - summed score across metrics
 * @param maxTotalScore - the profile maximum; zero means nothing applied and the ratio is treated as zero
 * @param classification - the detected subtype and how confident that detection was
 * @param shape - the independently detected shape, compared against the scoring profile
 * @returns the recommendation together with the fit notes explaining it
 */
export function deriveRecommendation(
  artifact: ArtifactEntry,
  metrics: MetricResult[],
  totalScore: number,
  maxTotalScore: number,
  classification: ClassificationResult,
  shape: ShapeDetectionResult,
): { recommendation: Recommendation; fitNotes: string[] } {
  const recommendationNotes: string[] = [];
  const scoreRatio = maxTotalScore > 0 ? totalScore / maxTotalScore : 0;
  const artifactFitMetric = metrics.find(
    (metric) => metric.metric === "skill-reference-fit",
  );
  const failedMetricCount = metrics.filter(
    (metric) => metric.severity === "fail",
  ).length;
  const zeroScoreMetric = metrics.find(
    (metric) => metric.maxScore > 0 && metric.score === 0,
  );
  const isClassificationConfident =
    classification.confidence >= CONFIDENCE_THRESHOLD;
  const shapeMismatchWarning = shapeMismatchNote(
    artifact,
    classification.detectedSubtype,
    shape,
  );
  // A detected filing mismatch appears before the final recommendation so the user sees why manual review is required.
  if (shapeMismatchWarning !== null) {
    recommendationNotes.push(shapeMismatchWarning);
  }

  const kindIndependentVerdict = recommendKindIndependentVerdict(
    artifact,
    { scoreRatio, artifactFitMetric, zeroScoreMetric },
    shapeMismatchWarning,
    recommendationNotes,
  );
  // Universal retire, mismatch, meta-reference, and zero-score outcomes take precedence over artifact-kind advice.
  if (kindIndependentVerdict) return kindIndependentVerdict;

  return artifact.kind === "skill"
    ? recommendForSkill(
        {
          scoreRatio,
          failedMetricCount,
          isClassificationConfident,
          artifactFitMetric,
          classification,
        },
        recommendationNotes,
      )
    : recommendForReference(
        {
          scoreRatio,
          isClassificationConfident,
          artifactFitMetric,
          classification,
        },
        recommendationNotes,
      );
}
