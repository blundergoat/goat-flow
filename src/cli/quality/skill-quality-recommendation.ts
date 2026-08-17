/**
 * Turns the scored metric rows into a single human-facing Recommendation plus explanatory fit notes.
 * This is the last stage of the scoring pipeline, after classification and metric scoring: it reads the total score band, per-metric failures,
 * classification confidence, and shape mismatch to decide keep / revise / reclassify / retire, or escalate to human review.
 *
 * The thresholds here (confidence cutoff, score bands) are advisory routing, not hard gates - a reviewer still owns the final call; the notes exist
 * to make that call quick.
 * Subtype/shape disagreement always surfaces as a note so a misfiled artifact never passes silently.
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
 * Explain when a high-scoring artifact still needs subtype review.
 */
function reclassifyNote(classification: ClassificationResult): string {
  const top = classification.alternatives[0];
  const altText = top
    ? `Could also be ${top.subtype} (match score ${top.score}).`
    : "No clear alternative subtype.";
  return `Strong structure but classification confidence is ${Math.round(
    classification.confidence * 100,
  )}% in ${classification.detectedSubtype}. ${altText}`;
}

function shapeMismatchNote(
  artifact: ArtifactEntry,
  subtype: ArtifactSubtype,
  shape: ShapeDetectionResult,
): string | null {
  if (shape.detectedShape === subtype) return null;
  const packagedAs = artifact.kind === "skill" ? "skill" : "shared reference";
  return `Packaged as ${packagedAs} using ${subtype} scoring profile, but semantic shape reads as ${shape.detectedShape} (${Math.round(
    shape.confidence * 100,
  )}% confidence).`;
}

/** The already-computed signals a verdict is drawn from, so neither branch recomputes them. */
interface RecommendationInputs {
  pct: number;
  failCount?: number;
  confident: boolean;
  fitMetric: MetricResult | undefined;
  classification: ClassificationResult;
}

/**
 * Decide what to tell the user about an artifact installed as a skill.
 *
 * The order matters: a demote signal is reported before the score, because an artifact that is not shaped like a skill
 * should be moved rather than merely improved.
 *
 * Side effect: appends the user-facing explanation to `fitNotes`.
 *
 * @param inputs - the score ratio, fail count, classification confidence, and fit metric
 * @param fitNotes - accumulator appended to in place; this is the text shown under the recommendation
 * @returns the recommendation and the notes explaining it
 */
function recommendForSkill(
  inputs: RecommendationInputs,
  fitNotes: string[],
): { recommendation: Recommendation; fitNotes: string[] } {
  // The artifact does not look like a skill at all, so moving it beats improving it in place.
  if (inputs.fitMetric?.signals?.shouldDemote) {
    fitNotes.push(
      "Artifact lacks skill structure. Consider converting it to a reference or playbook instead of a runnable skill.",
    );
    return { recommendation: "reference-playbook", fitNotes };
  }
  // Several failing metrics at once is more than a scoring nudge can usefully summarise.
  if ((inputs.failCount ?? 0) >= 4) {
    fitNotes.push(
      `${inputs.failCount} metrics scored "fail". Manual review recommended.`,
    );
    return { recommendation: "needs-human-review", fitNotes };
  }
  if (inputs.pct >= 0.7) {
    // Scoring well against a subtype nobody is confident about is not evidence the skill is right.
    if (!inputs.confident) {
      fitNotes.push(reclassifyNote(inputs.classification));
      return { recommendation: "consider-reclassifying", fitNotes };
    }
    fitNotes.push("Strong skill identity with adequate structural quality.");
    return { recommendation: "keep-skill", fitNotes };
  }
  fitNotes.push(
    "Moderate quality. Review metric details for improvement opportunities.",
  );
  return { recommendation: "consider-revision", fitNotes };
}

/**
 * Decide what to tell the user about an artifact filed as a reference or playbook.
 *
 * Side effect: appends the user-facing explanation to `fitNotes`.
 *
 * @param inputs - the score ratio, classification confidence, and fit metric
 * @param fitNotes - accumulator appended to in place; this is the text shown under the recommendation
 * @returns the recommendation and the notes explaining it
 */
function recommendForReference(
  inputs: RecommendationInputs,
  fitNotes: string[],
): { recommendation: Recommendation; fitNotes: string[] } {
  // Reference content carrying real skill structure is probably something the user meant to install as a skill.
  if (inputs.fitMetric?.signals?.shouldPromote) {
    fitNotes.push(
      "Strong skill signals detected. Consider promoting to a first-class goat-* skill.",
    );
    return { recommendation: "needs-human-review", fitNotes };
  }
  // A high score against an uncertain classification says the profile, not the artifact, may be wrong.
  if (inputs.pct >= 0.7 && !inputs.confident) {
    fitNotes.push(reclassifyNote(inputs.classification));
    return { recommendation: "consider-reclassifying", fitNotes };
  }
  fitNotes.push("Fits reference/playbook classification.");
  return { recommendation: "reference-playbook", fitNotes };
}

/**
 * Answer the verdicts that hold whatever kind the artifact is, before the skill and reference rules diverge.
 *
 * These come first because each one describes a condition the per-kind advice could not sensibly override: a meta
 * reference is never promotable, a shape mismatch means the score was computed against the wrong profile, a very low
 * score means the artifact may not be worth keeping, and a zeroed metric is a gap a human should look at.
 *
 * Side effect: appends the user-facing explanation to `fitNotes`.
 *
 * @param artifact - the artifact being judged
 * @param inputs - the score ratio, fit metric, and the zeroed metric when one exists
 * @param mismatchNote - the shape-mismatch note when the detected shape disagrees with the scoring profile
 * @param fitNotes - accumulator appended to in place
 * @returns the verdict, or null when none of these conditions applies and per-kind rules should decide
 */
function recommendKindIndependentVerdict(
  artifact: ArtifactEntry,
  inputs: {
    pct: number;
    fitMetric: MetricResult | undefined;
    zeroMetric: MetricResult | undefined;
  },
  mismatchNote: string | null,
  fitNotes: string[],
): { recommendation: Recommendation; fitNotes: string[] } | null {
  // Meta references are shared context rather than anything the user invokes, so they are never promoted.
  if (inputs.fitMetric?.signals?.isMetaReference) {
    fitNotes.push(inputs.fitMetric.detail);
    return { recommendation: "reference-playbook", fitNotes };
  }
  // The score came from the wrong profile, so acting on it would act on the wrong measurement.
  if (mismatchNote) {
    fitNotes.push(
      "Semantic shape differs from the applied scoring profile. Manual review required before keeping this recommendation.",
    );
    return { recommendation: "consider-reclassifying", fitNotes };
  }
  if (inputs.pct < 0.3) {
    fitNotes.push(
      artifact.kind === "skill"
        ? "Very low quality score. Verify the artifact is still maintained and useful."
        : "Very low quality score for a reference.",
    );
    return { recommendation: "retire", fitNotes };
  }
  // A metric that scored nothing at all is a specific gap, not a general quality level.
  if (inputs.zeroMetric) {
    fitNotes.push(
      `${inputs.zeroMetric.label} scored 0/${inputs.zeroMetric.maxScore}. Manual review required before keeping this recommendation.`,
    );
    if (artifact.kind === "shared-reference") {
      fitNotes.push(
        "Still classified as reference/playbook; quality needs review.",
      );
    }
    return { recommendation: "needs-human-review", fitNotes };
  }
  return null;
}

/**
 * Turn the scored metrics into the single recommendation and explanation a user reads in the Skills tab.
 *
 * This is the last stage of scoring: keep, revise, reclassify, retire, or escalate to a human.
 *
 * The thresholds are advisory routing rather than hard gates, so the notes matter as much as the verdict; a reviewer still
 * owns the final call.
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
  const fitNotes: string[] = [];
  const pct = maxTotalScore > 0 ? totalScore / maxTotalScore : 0;
  const fitMetric = metrics.find((m) => m.metric === "skill-reference-fit");
  const failCount = metrics.filter((m) => m.severity === "fail").length;
  const zeroMetric = metrics.find((m) => m.maxScore > 0 && m.score === 0);
  const confident = classification.confidence >= CONFIDENCE_THRESHOLD;
  const mismatchNote = shapeMismatchNote(
    artifact,
    classification.detectedSubtype,
    shape,
  );
  if (mismatchNote) fitNotes.push(mismatchNote);

  const kindIndependent = recommendKindIndependentVerdict(
    artifact,
    { pct, fitMetric, zeroMetric },
    mismatchNote,
    fitNotes,
  );
  if (kindIndependent) return kindIndependent;

  return artifact.kind === "skill"
    ? recommendForSkill(
        { pct, failCount, confident, fitMetric, classification },
        fitNotes,
      )
    : recommendForReference(
        { pct, confident, fitMetric, classification },
        fitNotes,
      );
}
