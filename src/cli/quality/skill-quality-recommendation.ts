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

// eslint-disable-next-line complexity -- intentional because the recommendation tree dispatches over kind × score-band × confidence × structured fit signals
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

  if (fitMetric?.signals?.isMetaReference) {
    fitNotes.push(fitMetric.detail);
    return { recommendation: "reference-playbook", fitNotes };
  }

  if (mismatchNote) {
    fitNotes.push(
      "Semantic shape differs from the applied scoring profile. Manual review required before keeping this recommendation.",
    );
    return { recommendation: "consider-reclassifying", fitNotes };
  }

  if (pct < 0.3) {
    fitNotes.push(
      artifact.kind === "skill"
        ? "Very low quality score. Verify the artifact is still maintained and useful."
        : "Very low quality score for a reference.",
    );
    return { recommendation: "retire", fitNotes };
  }

  if (zeroMetric) {
    fitNotes.push(
      `${zeroMetric.label} scored 0/${zeroMetric.maxScore}. Manual review required before keeping this recommendation.`,
    );
    if (artifact.kind === "shared-reference") {
      fitNotes.push(
        "Still classified as reference/playbook; quality needs review.",
      );
    }
    return { recommendation: "needs-human-review", fitNotes };
  }

  if (artifact.kind === "skill") {
    if (fitMetric?.signals?.shouldDemote) {
      fitNotes.push(
        "Artifact lacks skill structure. Consider converting it to a reference or playbook instead of a runnable skill.",
      );
      return { recommendation: "reference-playbook", fitNotes };
    }
    if (failCount >= 4) {
      fitNotes.push(
        `${failCount} metrics scored "fail". Manual review recommended.`,
      );
      return { recommendation: "needs-human-review", fitNotes };
    }
    if (pct >= 0.7) {
      if (!confident) {
        fitNotes.push(reclassifyNote(classification));
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

  if (fitMetric?.signals?.shouldPromote) {
    fitNotes.push(
      "Strong skill signals detected. Consider promoting to a first-class goat-* skill.",
    );
    return { recommendation: "needs-human-review", fitNotes };
  }
  if (pct >= 0.7 && !confident) {
    fitNotes.push(reclassifyNote(classification));
    return { recommendation: "consider-reclassifying", fitNotes };
  }
  fitNotes.push("Fits reference/playbook classification.");
  return { recommendation: "reference-playbook", fitNotes };
}
