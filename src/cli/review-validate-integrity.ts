/**
 * Checks the Review Integrity block - the part of a report that states how thorough it was.
 * Scope, files opened, evidence counts, verdict tallies, degradation flags and conclusion are
 * the reviewer's own claims about their coverage, and they are the fields most likely to be
 * quietly overstated. This pass makes each one either verifiable or a violation.
 *
 * Counts are cross-checked against the findings actually present rather than taken at face
 * value, because a report claiming more evidence than it shows is worse than one admitting it
 * was partial - a reader trusts the number and stops looking.
 */
import {
  REVIEW_BUNDLE_PATH,
  IMMUTABLE_OBJECT_IDENTIFIER,
  SCOPE_SNAPSHOT,
  REQUIRED_INTEGRITY_FIELDS,
  AUTOMATED_REVIEW_VALUE,
  REFUTER_VALUE,
  COMPACT_INTEGRITY,
  COMPACT_CLEAN_REVIEW_FIELDS,
  KNOWN_DEGRADATION_FLAGS,
  readSections,
  addViolation,
  addWarning,
  type ReviewValidationViolation,
  type MarkdownSection,
  type IntegrityResult,
  type ReviewIntegrityConclusion,
  type ReviewAnchorAuthority,
  type EvidenceCountClaim,
  type VerdictCountClaim,
  type ParsedScopeSnapshot,
  type IntegrityField,
  type IntegrityFieldMap,
} from "./review-validate-common.js";

/**
 * Extract colon-delimited integrity fields and fail repeated authority claims.
 *
 * @param section - one located report section; null means the heading was absent entirely
 * @param violations - shared violation list, appended in report order so a reader sees issues top-down; a violation makes the report fail
 * @returns the Review Integrity rows keyed by field name; an empty map means the block was missing entirely
 */
function collectIntegrityFields(
  section: MarkdownSection,
  violations: ReviewValidationViolation[],
): IntegrityFieldMap {
  const fields: IntegrityFieldMap = new Map();
  for (const locatedLine of section.lines) {
    const match = locatedLine.text.match(/^\s*-\s+([^:]+):\s*(.*)$/u);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    const label = match[1].trim();
    const prior = fields.get(label);
    if (prior) {
      addViolation(
        violations,
        "integrity-field-duplicate",
        locatedLine.line,
        `Review Integrity ${label} duplicates its value at line ${prior.line}`,
      );
      continue;
    }
    fields.set(label, {
      value: match[2].trim(),
      line: locatedLine.line,
    });
  }
  return fields;
}

/** Validate all mandatory integrity fields against their bounded value grammar. */
function validateRequiredIntegrityFields(
  fields: IntegrityFieldMap,
  section: MarkdownSection,
  violations: ReviewValidationViolation[],
): void {
  for (const [label, valuePattern] of REQUIRED_INTEGRITY_FIELDS) {
    const field = fields.get(label);
    if (field && valuePattern.test(field.value)) continue;
    addViolation(
      violations,
      "integrity-format",
      field?.line ?? section.headingLine,
      field
        ? `Review Integrity ${label} has an invalid value`
        : `Review Integrity is missing ${label}`,
    );
  }
}

/** Reject a Pass 2 file count that claims more opened files than the reviewed scope contains. */
function validateOpenedFileCoverage(
  fields: IntegrityFieldMap,
  violations: ReviewValidationViolation[],
): void {
  const coverageField = fields.get("Files opened in Pass 2");
  const coverageMatch = coverageField?.value.match(/^(\d+)\/(\d+)\b/u);
  // The required-field check already explains a missing or malformed coverage value.
  if (!coverageField || !coverageMatch?.[1] || !coverageMatch[2]) return;
  const openedFileCount = readSafeIntegrityCount(
    coverageMatch[1],
    "Files opened in Pass 2 numerator",
    coverageField.line,
    violations,
  );
  const scopedFileCount = readSafeIntegrityCount(
    coverageMatch[2],
    "Files opened in Pass 2 denominator",
    coverageField.line,
    violations,
  );
  // Unsafe integers already have a precise format violation for the report author.
  if (openedFileCount === null || scopedFileCount === null) return;
  // A reviewer cannot open more unique files than the scope presented to the user.
  if (openedFileCount > scopedFileCount) {
    addViolation(
      violations,
      "integrity-format",
      coverageField.line,
      `Files opened in Pass 2 claims ${openedFileCount}/${scopedFileCount}; opened files cannot exceed scoped files`,
    );
  }
}

/** Read the validated integrity conclusion used to apply the user-visible verdict downgrade. */
function readIntegrityConclusion(
  fields: IntegrityFieldMap,
): ReviewIntegrityConclusion | null {
  const conclusion = fields.get("Conclusion")?.value;
  return [
    "confident",
    "coverage-degraded",
    "high-inference",
    "partial",
  ].includes(conclusion ?? "")
    ? (conclusion as ReviewIntegrityConclusion)
    : null;
}

/** Validate one optional extension only when the report emitted it. */
function validateOptionalIntegrityField(
  fields: IntegrityFieldMap,
  label: string,
  valuePattern: RegExp,
  violations: ReviewValidationViolation[],
): void {
  const field = fields.get(label);
  if (!field || valuePattern.test(field.value)) return;
  addViolation(
    violations,
    "integrity-format",
    field.line,
    `${label} has an invalid value`,
  );
}

/** Parse the refutation count field while rejecting precision-losing integers. */
function readRefutationCount(
  refutations: IntegrityField | undefined,
  violations: ReviewValidationViolation[],
): Pick<
  IntegrityResult,
  "refutationsLogged" | "isRefutationPersistenceSkipped" | "refutationsLine"
> {
  const match = refutations?.value.match(
    /^(\d+)(?:\s+\((persist-skipped)\))?$/u,
  );
  if (!refutations || !match?.[1]) {
    return {
      refutationsLogged: 0,
      isRefutationPersistenceSkipped: false,
      refutationsLine: refutations?.line ?? null,
    };
  }
  const refutationsLogged = Number(match[1]);
  if (!Number.isSafeInteger(refutationsLogged)) {
    addViolation(
      violations,
      "integrity-format",
      refutations.line,
      "Refutations logged must be a safe non-negative integer",
    );
  }
  return {
    refutationsLogged: Number.isSafeInteger(refutationsLogged)
      ? refutationsLogged
      : 0,
    isRefutationPersistenceSkipped: match[2] === "persist-skipped",
    refutationsLine: refutations.line,
  };
}

/** Convert valid refutation fields into one count-and-ledger claim. */
function readRefutationClaim(
  fields: IntegrityFieldMap,
  violations: ReviewValidationViolation[],
): Pick<
  IntegrityResult,
  | "refutationsLogged"
  | "isRefutationPersistenceSkipped"
  | "refutationsLine"
  | "refutationLedger"
  | "refutationLedgerLine"
> {
  const ledger = fields.get("Refutation ledger");
  return {
    ...readRefutationCount(fields.get("Refutations logged"), violations),
    refutationLedger: ledger?.value ?? null,
    refutationLedgerLine: ledger?.line ?? null,
  };
}

/** Warn once per degradation flag that is not documented by goat-review. */
function warnUnknownDegradationFlags(
  flags: ReadonlySet<string>,
  line: number,
  warnings: ReviewValidationViolation[],
): void {
  for (const flag of flags) {
    const configuredBase = /^configured-base-unresolved=\S+$/u.test(flag);
    if (KNOWN_DEGRADATION_FLAGS.has(flag) || configuredBase) continue;
    addWarning(
      warnings,
      "degradation-flag-unknown",
      line,
      `unknown degradation flag: ${flag || "<empty>"}`,
    );
  }
}

/** Keep the declared review confidence within the documented declined-depth cap. */
function validateRiskDepthConclusion(
  flags: ReadonlySet<string>,
  fields: IntegrityFieldMap,
  fallbackLine: number,
  violations: ReviewValidationViolation[],
): void {
  if (
    flags.has("risk-depth-declined") &&
    fields.get("Conclusion")?.value !== "partial"
  ) {
    addViolation(
      violations,
      "integrity-format",
      fields.get("Conclusion")?.line ?? fallbackLine,
      "risk-depth-declined requires Conclusion: partial",
    );
  }
}

/** Parse, warn on, and cross-check the report's declared degradation flags. */
function validateDegradationFlags(
  fields: IntegrityFieldMap,
  violations: ReviewValidationViolation[],
  warnings: ReviewValidationViolation[],
): Set<string> {
  const field = fields.get("Degradation flags");
  if (!field) return new Set();
  const flags = new Set(field.value.split(",").map((flag) => flag.trim()));
  warnUnknownDegradationFlags(flags, field.line, warnings);
  validateRiskDepthConclusion(flags, fields, field.line, violations);
  return flags;
}

/** Convert one integrity count while rejecting precision-losing integers. */
function readSafeIntegrityCount(
  value: string,
  label: string,
  line: number,
  violations: ReviewValidationViolation[],
): number | null {
  const count = Number(value);
  if (Number.isSafeInteger(count)) return count;
  addViolation(
    violations,
    "integrity-format",
    line,
    `${label} must be a safe non-negative integer`,
  );
  return null;
}

/** Parse the visible finding-evidence totals for later reconciliation. */
function readEvidenceCounts(
  fields: IntegrityFieldMap,
  violations: ReviewValidationViolation[],
): EvidenceCountClaim | null {
  const field = fields.get("Evidence");
  const match = field?.value.match(/^(\d+) OBSERVED\s*\/\s*(\d+) INFERRED$/u);
  if (!field || !match?.[1] || !match[2]) return null;
  const observed = readSafeIntegrityCount(
    match[1],
    "Evidence OBSERVED count",
    field.line,
    violations,
  );
  const inferred = readSafeIntegrityCount(
    match[2],
    "Evidence INFERRED count",
    field.line,
    violations,
  );
  if (observed === null || inferred === null) return null;
  return { inferred, line: field.line, observed };
}

/** Parse confirmed/adjusted/refuted/unresolved totals for reconciliation. */
function hasFourSafeCounts(
  counts: Array<number | null>,
): counts is [number, number, number, number] {
  return counts.length === 4 && counts.every((count) => count !== null);
}

/** Parse confirmed/adjusted/refuted/unresolved totals for reconciliation. */
function readVerdictCounts(
  fields: IntegrityFieldMap,
  violations: ReviewValidationViolation[],
): VerdictCountClaim | null {
  const field = fields.get("Verdicts");
  if (!field) return null;
  const match = field.value.match(/^(\d+)\/(\d+)\/(\d+)\/(\d+)$/u);
  if (!match) return null;
  const [
    ,
    confirmedText = "",
    adjustedText = "",
    refutedText = "",
    unresolvedText = "",
  ] = match;
  const confirmed = readSafeIntegrityCount(
    confirmedText,
    "Verdicts confirmed count",
    field.line,
    violations,
  );
  const adjusted = readSafeIntegrityCount(
    adjustedText,
    "Verdicts adjusted count",
    field.line,
    violations,
  );
  const refuted = readSafeIntegrityCount(
    refutedText,
    "Verdicts refuted count",
    field.line,
    violations,
  );
  const unresolved = readSafeIntegrityCount(
    unresolvedText,
    "Verdicts unresolved count",
    field.line,
    violations,
  );
  const counts = [confirmed, adjusted, refuted, unresolved];
  if (!hasFourSafeCounts(counts)) return null;
  const [confirmedCount, adjustedCount, refutedCount, unresolvedCount] = counts;
  return {
    adjusted: adjustedCount,
    confirmed: confirmedCount,
    line: field.line,
    refuted: refutedCount,
    unresolved: unresolvedCount,
  };
}

/** Parse the canonical scope fields after the required-field check runs. */
function parseScopeSnapshot(
  field: IntegrityField,
  violations: ReviewValidationViolation[],
): ParsedScopeSnapshot | null {
  const match = field.value.match(SCOPE_SNAPSHOT);
  if (!match) {
    addViolation(
      violations,
      "integrity-format",
      field.line,
      "Scope snapshot must declare source, base, head, authority, drift, uncommitted, signals, bundle, and chunking in canonical order",
    );
    return null;
  }
  const [
    ,
    sourceText = "",
    ,
    head = "",
    authority = "",
    drift = "",
    uncommitted = "",
    signals = "",
    bundle = "",
  ] = match;
  const source = sourceText.trim().toLowerCase();
  return {
    authority: authority.trim(),
    bundle: bundle.trim(),
    drift: drift.trim(),
    head: head.trim(),
    isAreaAudit: source === "area",
    signals,
    source,
    uncommitted: uncommitted.trim(),
  };
}

/** Validate authority-independent scope state and bundle metadata. */
function validateScopeState(
  scope: ParsedScopeSnapshot,
  line: number,
  violations: ReviewValidationViolation[],
): boolean {
  const hasSafeSignals =
    readSafeIntegrityCount(
      scope.signals,
      "Scope snapshot signals",
      line,
      violations,
    ) !== null;
  const hasVerifiedDrift = scope.drift === "verified";
  if (!hasVerifiedDrift) {
    addViolation(
      violations,
      "integrity-format",
      line,
      "Scope snapshot drift must be verified before review proof can pass",
    );
  }
  if (
    scope.bundle !== "persist-skipped: redactor-unavailable" &&
    !REVIEW_BUNDLE_PATH.test(scope.bundle)
  ) {
    addViolation(
      violations,
      "integrity-format",
      line,
      "Scope snapshot bundle must name one review bundle receipt or the documented persist-skipped marker",
    );
  }
  return hasSafeSignals && hasVerifiedDrift;
}

/** Return whether the scope's Pass 2 files live in one Git object. */
function scopeUsesGitObject(source: string): boolean {
  return (
    source === "staged" || source === "branch diff" || source.startsWith("pr")
  );
}

/** Return whether uncommitted metadata contradicts a Git-object source. */
function hasGitUncommittedConflict(scope: ParsedScopeSnapshot): boolean {
  if (scope.source === "staged") return scope.uncommitted !== "yes";
  if (scope.source === "branch diff") return scope.uncommitted !== "no";
  if (scope.source.startsWith("pr")) return scope.uncommitted !== "no";
  return false;
}

/** Resolve a committed or staged scope into its immutable anchor authority. */
function readGitScopeAuthority(
  scope: ParsedScopeSnapshot,
  line: number,
  hasValidState: boolean,
  violations: ReviewValidationViolation[],
): ReviewAnchorAuthority {
  let isValidAuthority = hasValidState;
  if (
    !IMMUTABLE_OBJECT_IDENTIFIER.test(scope.head) ||
    scope.authority === "n/a"
  ) {
    addViolation(
      violations,
      "integrity-format",
      line,
      "committed and staged review scopes require a full immutable head or tree OID and a non-n/a authority",
    );
    isValidAuthority = false;
  }
  if (hasGitUncommittedConflict(scope)) {
    addViolation(
      violations,
      "integrity-format",
      line,
      "Scope snapshot uncommitted state contradicts its declared source",
    );
  }
  return isValidAuthority
    ? { kind: "git-object", oid: scope.head }
    : { kind: "invalid" };
}

/** Resolve a live source while validating its uncommitted marker. */
function readWorktreeScopeAuthority(
  scope: ParsedScopeSnapshot,
  line: number,
  hasValidState: boolean,
  violations: ReviewValidationViolation[],
): ReviewAnchorAuthority {
  const requiresUncommitted = ["worktree", "unstaged"].includes(scope.source);
  if (requiresUncommitted && scope.uncommitted !== "yes") {
    addViolation(
      violations,
      "integrity-format",
      line,
      "Scope snapshot uncommitted state contradicts its declared source",
    );
  }
  return hasValidState ? { kind: "worktree" } : { kind: "invalid" };
}

/** Bind semantic-anchor reads to the canonical scope snapshot authority. */
function readScopeAuthority(
  fields: IntegrityFieldMap,
  violations: ReviewValidationViolation[],
): { anchorAuthority: ReviewAnchorAuthority; isAreaAudit: boolean } {
  const field = fields.get("Scope snapshot");
  if (!field) {
    return { anchorAuthority: { kind: "invalid" }, isAreaAudit: false };
  }
  const scope = parseScopeSnapshot(field, violations);
  if (!scope) {
    return { anchorAuthority: { kind: "invalid" }, isAreaAudit: false };
  }
  const hasValidState = validateScopeState(scope, field.line, violations);
  const anchorAuthority = scopeUsesGitObject(scope.source)
    ? readGitScopeAuthority(scope, field.line, hasValidState, violations)
    : readWorktreeScopeAuthority(scope, field.line, hasValidState, violations);
  return { anchorAuthority, isAreaAudit: scope.isAreaAudit };
}

/** Validate the full Review Integrity field set and return its ledger claim. */
function validateFullIntegrity(
  section: MarkdownSection,
  violations: ReviewValidationViolation[],
  warnings: ReviewValidationViolation[],
): IntegrityResult {
  const fields = collectIntegrityFields(section, violations);
  validateRequiredIntegrityFields(fields, section, violations);
  validateOpenedFileCoverage(fields, violations);
  validateOptionalIntegrityField(
    fields,
    "Automated-review provenance",
    AUTOMATED_REVIEW_VALUE,
    violations,
  );
  validateOptionalIntegrityField(
    fields,
    "Refuter pass",
    REFUTER_VALUE,
    violations,
  );
  const degradationFlags = validateDegradationFlags(
    fields,
    violations,
    warnings,
  );
  const scope = readScopeAuthority(fields, violations);
  return {
    ...scope,
    conclusion: readIntegrityConclusion(fields),
    isRiskDepthDeclined: degradationFlags.has("risk-depth-declined"),
    evidenceCounts: readEvidenceCounts(fields, violations),
    ...readRefutationClaim(fields, violations),
    verdictCounts: readVerdictCounts(fields, violations),
  };
}

/** Require one visible, non-empty copy of each disclosure surrounding a compact receipt. */
function validateCompactCleanReviewFields(
  lines: string[],
  violations: ReviewValidationViolation[],
): void {
  for (const field of COMPACT_CLEAN_REVIEW_FIELDS) {
    const matches = lines
      .map((text, lineIndex) => ({ line: lineIndex + 1, text }))
      .filter(({ text }) => field.prefix.test(text));
    const first = matches.at(0);
    if (!first) {
      addViolation(
        violations,
        "integrity-format",
        null,
        `compact clean review is missing ${field.label}`,
      );
      continue;
    }
    if (!field.value.test(first.text)) {
      addViolation(
        violations,
        "integrity-format",
        first.line,
        `compact ${field.label} ${field.requirement}`,
      );
    }
    for (const duplicate of matches.slice(1)) {
      addViolation(
        violations,
        "integrity-field-duplicate",
        duplicate.line,
        `compact ${field.label} duplicates the field at line ${first.line}`,
      );
    }
  }
}

/** Validate M04's compact clean-review receipt and its surrounding disclosures. */
function validateCompactIntegrity(
  lines: string[],
  findingCandidateCount: number,
  violations: ReviewValidationViolation[],
): IntegrityResult {
  const compactIntegrityLines = lines
    .map((text, lineIndex) => ({ line: lineIndex + 1, text }))
    .filter(({ text }) => /^\s*Review Integrity:/u.test(text));
  const compactIntegrityLine = compactIntegrityLines.at(0);
  const compactIndex = compactIntegrityLine
    ? compactIntegrityLine.line - 1
    : -1;
  const compactIntegrityMatch = (lines[compactIndex] ?? "").match(
    COMPACT_INTEGRITY,
  );
  // Zero-finding reviews may use the shorter user-facing integrity line.
  if (compactIndex >= 0 && compactIntegrityMatch) {
    for (const duplicate of compactIntegrityLines.slice(1)) {
      addViolation(
        violations,
        "integrity-field-duplicate",
        duplicate.line,
        `compact Review Integrity duplicates the field at line ${compactIndex + 1}`,
      );
    }
    validateCompactCleanReviewFields(lines, violations);
    // A compact receipt cannot account for visible finding evidence or verdict totals.
    if (findingCandidateCount > 0) {
      addViolation(
        violations,
        "integrity-format",
        compactIndex + 1,
        "compact Review Integrity is permitted only for a zero-finding review",
      );
    }
    return {
      anchorAuthority: { kind: "invalid" },
      conclusion: (compactIntegrityMatch[1] ??
        "confident") as ReviewIntegrityConclusion,
      isRiskDepthDeclined: false,
      evidenceCounts: null,
      refutationsLogged: 0,
      isRefutationPersistenceSkipped: false,
      refutationsLine: null,
      refutationLedger: null,
      refutationLedgerLine: null,
      isAreaAudit: false,
      verdictCounts: null,
    };
  }
  addViolation(
    violations,
    "integrity-format",
    compactIndex >= 0 ? compactIndex + 1 : null,
    compactIndex >= 0
      ? "compact Review Integrity line is malformed"
      : "report is missing Review Integrity",
  );
  return {
    anchorAuthority: { kind: "invalid" },
    conclusion: null,
    isRiskDepthDeclined: false,
    evidenceCounts: null,
    refutationsLogged: 0,
    isRefutationPersistenceSkipped: false,
    refutationsLine: null,
    refutationLedger: null,
    refutationLedgerLine: null,
    isAreaAudit: false,
    verdictCounts: null,
  };
}

/**
 * Validate either the full integrity block or M04's compact clean-review line.
 *
 * @param lines - the report split into lines; an empty report fails earlier than this
 * @param findingCandidateCount - how many list items looked like findings, used to tell an empty section from a malformed one
 * @param violations - shared violation list, appended in report order so a reader sees issues top-down; a violation makes the report fail
 * @param warnings - shared advisory list; entries here inform the author without changing the pass/fail verdict
 * @returns the parsed integrity claims used by later passes; absent fields have already been reported
 */
export function validateIntegrity(
  lines: string[],
  findingCandidateCount: number,
  violations: ReviewValidationViolation[],
  warnings: ReviewValidationViolation[],
): IntegrityResult {
  const fullSections = readSections(lines, "Review Integrity");
  const fullSection = fullSections.at(0);
  // A full receipt is authoritative whenever the user includes its H2 section.
  if (fullSection) {
    // Repeated receipts would let a report present conflicting validation state.
    for (const duplicate of fullSections.slice(1)) {
      addViolation(
        violations,
        "integrity-section-duplicate",
        duplicate.headingLine,
        `Review Integrity duplicates the section at line ${fullSection.headingLine}`,
      );
    }
    return validateFullIntegrity(fullSection, violations, warnings);
  }
  return validateCompactIntegrity(lines, findingCandidateCount, violations);
}
