/**
 * Evidence-provenance schema for audit checks (M05).
 *
 * Co-located with each check's implementation so provenance travels with the
 * check and can't drift from its source. Defined here as the stable import
 * path so M11's back-fill work can consume it without redefining.
 *
 * Schema adapted from agnix rules.json + rust emission in
 * `/home/devgoat/projects/goat-flow-related/agnix/crates/agnix-core/`.
 *
 * The `"unknown"` source_type + required `reason` field is the critique-locked
 * escape hatch: M11 back-fills ~32 existing checks, ~50% of which cannot
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
  | "unknown"; // reason required - escape hatch for M11 back-fill

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
  /** Optional repo-local paths (e.g. `.goat-flow/footguns/...`, session log) that back the check. */
  evidence_paths?: string[];
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
function checkUnknownReason(e: CheckEvidence): string | null {
  if (e.source_type === "unknown" && (!e.reason || e.reason.trim() === "")) {
    return "source_type 'unknown' requires a non-empty `reason` explaining why provenance could not be reconstructed";
  }
  return null;
}

/** Check that `verified_on` uses YYYY-MM-DD. */
function checkVerifiedOn(e: CheckEvidence): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(e.verified_on)) return null;
  return `verified_on must be ISO date YYYY-MM-DD, got ${JSON.stringify(e.verified_on)}`;
}

/** Check that required source metadata is present. */
function checkSourceRequired(e: CheckEvidence): string | null {
  if (e.source_type === "unknown") return null;
  if (e.source_urls.length > 0) return null;
  if (e.evidence_paths && e.evidence_paths.length > 0) return null;
  return "non-unknown source_type must have at least one source_url or evidence_path";
}

/** Check that every evidence path exists. */
function checkEvidencePathsExist(
  e: CheckEvidence,
  pathExists: EvidencePathExists,
): string[] {
  if (!e.evidence_paths) return [];
  return e.evidence_paths
    .filter((p) => !pathExists(p))
    .map((p) => `evidence_path does not exist: ${p}`);
}

/** Runtime check that a CheckEvidence satisfies the unknown-reason contract. */
export function validateProvenance(
  e: CheckEvidence,
  pathExists?: EvidencePathExists,
): string[] {
  const errors: string[] = [];
  const unknownErr = checkUnknownReason(e);
  if (unknownErr) errors.push(unknownErr);
  const dateErr = checkVerifiedOn(e);
  if (dateErr) errors.push(dateErr);
  const sourceErr = checkSourceRequired(e);
  if (sourceErr) errors.push(sourceErr);
  if (pathExists) errors.push(...checkEvidencePathsExist(e, pathExists));
  return errors;
}
