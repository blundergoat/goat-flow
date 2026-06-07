/**
 * Evidence-provenance schema for audit checks.
 *
 * Co-located with each check's implementation so provenance travels with the
 * check and can't drift from its source. Defined here as the stable import
 * path so back-fill work can consume it without redefining.
 *
 * Schema adapted from agnix rules.json + rust emission in
 * `/home/devgoat/projects/goat-flow-related/agnix/crates/agnix-core/`.
 *
 * The `"unknown"` source_type + required `reason` field is the critique-locked
 * escape hatch: existing checks include historical entries that cannot
 * have their provenance reconstructed. Such checks declare `source_type:
 * "unknown"` and state the reason (e.g. "pre-dates v1.1.0 cleanup"),
 * rather than fabricating a citation or stalling the back-fill.
 */

/** Where a check's norm came from. */
type ProvenanceSource =
  | "spec" // upstream specification (Claude Code hook spec, SDK docs)
  | "vendor_docs" // official vendor docs (Anthropic prompt engineering docs)
  | "paper" // research paper with a URL
  | "incident" // real incident in this repo with a footgun/lesson trail
  | "community" // community post / blog / benchmark
  | "unknown"; // reason required - escape hatch for historical back-fill

/**
 * Strength of the rule the check enforces.
 *  - MUST: violation is a failure (fail the scope).
 *  - SHOULD: violation is a WARN finding; fails the scope.
 *  - BEST_PRACTICE: violation is an INFO finding; logged but does not fail.
 */
type NormativeLevel = "MUST" | "SHOULD" | "BEST_PRACTICE";

/** Evidence metadata for an audit check. Co-located with the check definition. */
export interface CheckEvidence {
  source_type: ProvenanceSource;
  /** URLs to specs, vendor docs, papers, or incident trails. Empty for `incident` if the citation is a footgun/lesson path in `evidence_paths`. */
  source_urls: string[];
  /** ISO-8601 date the evidence was last verified (YYYY-MM-DD). */
  verified_on: string;
  normative_level: NormativeLevel;
  /** Optional repo-local paths (e.g. `.goat-flow/learning-loop/footguns/...`, session log) that back the check. */
  evidence_paths?: string[];
  /** Evidence paths that resolve against the goat-flow framework/package, not the audited target project. */
  framework_evidence_paths?: string[];
  /** Evidence paths that resolve against the audited target project. */
  target_evidence_paths?: string[];
  /**
   * Required when `source_type === "unknown"`. Explains why the provenance
   * can't be reconstructed. The type system does not enforce this because
   * it depends on a runtime field; `validateProvenance` below does.
   */
  reason?: string;
}

/** Filesystem lookup used to verify repo-local evidence paths when available. */
type EvidencePathExists = (path: string) => boolean;

/** Check that unknown-source evidence includes a reason. */
function checkUnknownReason(evidence: CheckEvidence): string | null {
  if (
    evidence.source_type === "unknown" &&
    (!evidence.reason || evidence.reason.trim() === "")
  ) {
    return "source_type 'unknown' requires a non-empty `reason` explaining why provenance could not be reconstructed";
  }
  return null;
}

/** Check that `verified_on` uses YYYY-MM-DD. */
function checkVerifiedOn(evidence: CheckEvidence): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(evidence.verified_on)) return null;
  return `verified_on must be ISO date YYYY-MM-DD, got ${JSON.stringify(evidence.verified_on)}`;
}

/**
 * Check that non-unknown provenance has at least one citation channel.
 *
 * The separate branches are intentional because legacy checks may cite vendor
 * URLs, framework files, target-project files, or pre-split evidence_paths; the
 * validator must preserve all four channels while still blocking uncited norms.
 */
function checkSourceRequired(evidence: CheckEvidence): string | null {
  if (evidence.source_type === "unknown") return null;
  if (evidence.source_urls.length > 0) return null;
  if (evidence.evidence_paths && evidence.evidence_paths.length > 0) {
    return null;
  }
  if (
    evidence.framework_evidence_paths &&
    evidence.framework_evidence_paths.length > 0
  ) {
    return null;
  }
  if (
    evidence.target_evidence_paths &&
    evidence.target_evidence_paths.length > 0
  ) {
    return null;
  }
  return "non-unknown source_type requires a non-empty source_url, evidence_path, framework_evidence_path, or target_evidence_path";
}

/** Check that every evidence path exists. */
function checkEvidencePathsExist(
  evidence: CheckEvidence,
  pathExists: EvidencePathExists,
): string[] {
  const paths = [
    ...(evidence.evidence_paths ?? []),
    ...(evidence.framework_evidence_paths ?? []),
    ...(evidence.target_evidence_paths ?? []),
  ];
  return paths
    .filter((evidencePath) => !pathExists(evidencePath))
    .map((evidencePath) => `evidence_path does not exist: ${evidencePath}`);
}

/**
 * Runtime check that a CheckEvidence record satisfies the audit schema.
 *
 * @param evidence - Provenance record attached to an audit check or runtime event.
 * @param pathExists - Optional resolver used by development/preflight checks to reject stale local evidence paths.
 * @returns Validation errors; an empty array means the record is usable.
 */
export function validateProvenance(
  evidence: CheckEvidence,
  pathExists?: EvidencePathExists,
): string[] {
  const errors: string[] = [];
  const unknownErr = checkUnknownReason(evidence);
  if (unknownErr) errors.push(unknownErr);
  const dateErr = checkVerifiedOn(evidence);
  if (dateErr) errors.push(dateErr);
  const sourceErr = checkSourceRequired(evidence);
  if (sourceErr) errors.push(sourceErr);
  if (pathExists) errors.push(...checkEvidencePathsExist(evidence, pathExists));
  return errors;
}
