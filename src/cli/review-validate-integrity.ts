/**
 * Check the coverage claims in a review's full or compact integrity receipt.
 * Use this pass before accepting finding evidence or deriving the final ship verdict.
 *
 * It validates visible fields, source and size declarations, refutation claims, and degradation disclosures.
 * Counts are cross-checked against the findings actually present by later passes using the claims parsed here.
 */
import {
  REVIEW_BUNDLE_PATH,
  SCOPE_SNAPSHOT,
  REQUIRED_INTEGRITY_FIELDS,
  AUTOMATED_REVIEW_VALUE,
  REFUTER_VALUE,
  COMPACT_CLEAN_REVIEW_FIELDS,
  COMPACT_REVIEW_SCOPE_SIZE,
  FULL_REVIEW_SIZE_VALUE,
  KNOWN_DEGRADATION_FLAGS,
  REVIEW_CHUNK_CHANGED_LINE_LIMIT,
  REVIEW_CHUNK_FILE_LIMIT,
  RETIRED_DEGRADATION_FLAGS,
  fullReviewCoverageFileCount,
  matchCompactReviewIntegrity,
  readSections,
  addViolation,
  addWarning,
  reviewIntegrityFormatMessage,
  reviewIntegrityValuePattern,
  reviewScopeExceedsChunkLimit,
  type ReviewValidationViolation,
  type MarkdownSection,
  type IntegrityResult,
  type ReviewIntegrityConclusion,
  type ReviewValidationStage,
  type ReviewAnchorAuthority,
  type EvidenceCountClaim,
  type VerdictCountClaim,
  type ParsedScopeSnapshot,
  type IntegrityField,
  type IntegrityFieldMap,
  type CompactReviewSizeClaim,
  type LocatedLine,
  type ReviewSizeClaim,
} from "./review-validate-common.js";
import {
  validateAuthorityScope,
  validateVisibleAuthorityFields,
  compactAuthorityFields,
  readAuthorityFields,
} from "./review-validate-authority.js";
import { validateDegradationConclusion } from "./review-validate-verdict.js";

const OMIT_WHEN_INAPPLICABLE_INTEGRITY_FIELDS = new Set([
  "Refutation ledger",
  "Spec drift",
]);

/**
 * Extract colon-delimited integrity fields and fail repeated authority claims.
 *
 * @param section - existing full receipt section; its heading locates missing-field issues
 * @param violations - shared violation list, appended in report order so a reader sees issues top-down; a violation makes the report fail
 * @returns the Review Integrity rows keyed by field name; an empty map means the block was missing entirely
 */
function collectIntegrityFields(
  section: MarkdownSection,
  violations: ReviewValidationViolation[],
): IntegrityFieldMap {
  const fields: IntegrityFieldMap = new Map();
  // Read every visible receipt row so repeated or contradictory claims are reported where the reviewer wrote them.
  for (const locatedLine of section.lines) {
    const match = locatedLine.text.match(/^\s*-\s+([^:]+):\s*(.*)$/u);
    // Ordinary prose is not a receipt row and cannot supply a required integrity value.
    if (match?.[1] === undefined || match[2] === undefined) continue;
    const label = match[1].trim();
    const prior = fields.get(label);
    // A repeated label makes the receipt ambiguous even when one of its values is valid.
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

/** Validate mandatory rows and the grammar of every conditional row that was emitted. */
function validateIntegrityFieldGrammar(
  fields: IntegrityFieldMap,
  section: MarkdownSection,
  violations: ReviewValidationViolation[],
  validationStage: ReviewValidationStage,
): void {
  // Check each required disclosure before letting the report's coverage claims influence the verdict.
  for (const [label, valuePattern] of REQUIRED_INTEGRITY_FIELDS) {
    const field = fields.get(label);
    // An inapplicable optional row can stay absent; visible triggers are checked separately.
    if (!field && OMIT_WHEN_INAPPLICABLE_INTEGRITY_FIELDS.has(label)) continue;
    // A valid field is ready for relationship checks against the rest of the report.
    if (
      field &&
      reviewIntegrityValuePattern(label, valuePattern, validationStage).test(
        field.value,
      )
    ) {
      continue;
    }
    addViolation(
      violations,
      "integrity-format",
      field?.line ?? section.headingLine,
      reviewIntegrityFormatMessage(label, field, validationStage),
    );
  }
}

/** Parse the leading counts in a full-report Size row. */
function parseFullSizeClaim(
  field: IntegrityField,
  violations: ReviewValidationViolation[],
): ReviewSizeClaim | null {
  const match = field.value.match(FULL_REVIEW_SIZE_VALUE);
  // An unreadable size claim cannot justify a completed review or its chunking decision.
  if (!match) {
    addViolation(
      violations,
      "integrity-format",
      field.line,
      "Size must begin with numeric files and changed lines or clusters",
    );
    return null;
  }
  const fileCount = readSafeIntegrityCount(
    match[1] as string,
    "Size file count",
    field.line,
    violations,
  );
  const unitCount = readSafeIntegrityCount(
    match[2] as string,
    "Size changed-line or cluster count",
    field.line,
    violations,
  );
  // An imprecise file count has already produced an issue and cannot establish review size.
  if (fileCount === null) return null;
  // An imprecise line or cluster count cannot establish the workload reviewed.
  if (unitCount === null) return null;
  return {
    fileCount,
    unitCount,
    unitLabel: match[3] as string,
    line: field.line,
  };
}

/** Keep the Size unit aligned with the source class declared by Scope snapshot. */
function validateFullSizeUnit(
  size: ReviewSizeClaim,
  scope: ParsedScopeSnapshot,
  violations: ReviewValidationViolation[],
): boolean {
  const expectedUnit = scope.isAreaAudit ? /^clusters?$/iu : /^changed/iu;
  // Matching units let the same count describe the selected diff or area meaningfully.
  if (expectedUnit.test(size.unitLabel)) return true;
  addViolation(
    violations,
    "integrity-format",
    size.line,
    scope.isAreaAudit
      ? "area review Size must use clusters"
      : "diff or path review Size must use changed lines",
  );
  return false;
}

/** Bind the full Size file count to the coverage denominator. */
function validateFullSizeFileCount(
  size: ReviewSizeClaim,
  fields: IntegrityFieldMap,
  violations: ReviewValidationViolation[],
): boolean {
  const coverageFileCount = fullReviewCoverageFileCount(fields);
  // An invalid coverage denominator is already reported; this check cannot compare it with Size.
  if (coverageFileCount === null) return true;
  // The size and opened-file denominator describe the same selected file population.
  if (coverageFileCount === size.fileCount) return true;
  addViolation(
    violations,
    "integrity-format",
    size.line,
    `Size file count ${size.fileCount} does not match Files opened in Pass 2 denominator ${coverageFileCount}`,
  );
  return false;
}

/** Cross-check full-report size claims against the terminal chunking state. */
function validateFullScopeSize(
  fields: IntegrityFieldMap,
  scope: ParsedScopeSnapshot,
  violations: ReviewValidationViolation[],
): boolean {
  const field = fields.get("Size");
  // Missing Size already blocks the receipt and cannot supply a chunking decision.
  if (!field) return false;
  const size = parseFullSizeClaim(field, violations);
  // A malformed Size cannot establish that the review stayed within its agreed limits.
  if (!size) return false;
  // Area clusters and changed lines measure different work, so a unit mismatch blocks this scope.
  if (!validateFullSizeUnit(size, scope, violations)) return false;
  // Contradictory file populations prevent the receipt from establishing completed coverage.
  if (!validateFullSizeFileCount(size, fields, violations)) return false;
  // A scope within both limits needs no accepted chunking arrangement.
  if (
    !reviewScopeExceedsChunkLimit(
      size.fileCount,
      size.unitCount,
      size.unitLabel,
    )
  ) {
    return true;
  }
  // An oversized scope is valid here only after the reviewer records accepted chunks.
  if (scope.chunking === "accepted") return true;
  addViolation(
    violations,
    "integrity-format",
    size.line,
    `Size exceeds ${REVIEW_CHUNK_FILE_LIMIT} files or ${REVIEW_CHUNK_CHANGED_LINE_LIMIT} changed lines; completed review requires chunking=accepted`,
  );
  return false;
}

/** Require one conditional row after the rest of the report proves it applies. */
function requireIntegrityField(
  fields: IntegrityFieldMap,
  section: MarkdownSection,
  label: string,
  violations: ReviewValidationViolation[],
): void {
  // The triggered disclosure is already present; its grammar is checked by the common field pass.
  if (fields.has(label)) return;
  addViolation(
    violations,
    "integrity-format",
    section.headingLine,
    `Review Integrity is missing ${label}`,
  );
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
  // An absent optional extension needs no value check, and a valid one can proceed unchanged.
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
  // Missing or malformed refutation text earns no count while the field grammar reports its defect.
  if (!refutations || !match?.[1]) {
    return {
      refutationsLogged: 0,
      isRefutationPersistenceSkipped: false,
      refutationsLine: refutations?.line ?? null,
    };
  }
  const refutationsLogged = Number(match[1]);
  // A rounded count could overstate discarded suspicions, so it cannot receive refutation credit.
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
  const refutationCount = readRefutationCount(
    fields.get("Refutations logged"),
    violations,
  );
  return {
    ...refutationCount,
    refutationLedger:
      ledger?.value ?? (refutationCount.refutationsLogged === 0 ? "n/a" : null),
    refutationLedgerLine: ledger?.line ?? null,
  };
}

/** Detect PR mode from the validated scope field. */
function reportUsesPrScope(fields: IntegrityFieldMap): boolean {
  const source = fields.get("Scope snapshot")?.value.match(SCOPE_SNAPSHOT)?.[1];
  return /^PR(?:\s|$)/iu.test(source ?? "");
}

/** Detect visible evidence that a cross-model refuter affected the review. */
function reportShowsRefuterActivity(lines: string[]): boolean {
  return lines.some((line) =>
    /\[CONFIRMED-CROSS-MODEL\]|cross-model-refuter-failed|cross-model-unresolved|refuter-citation-unverified/u.test(
      line,
    ),
  );
}

/** Require conditional rows whose triggers are visible elsewhere in the report. */
function validateResolvedIntegrityFields(
  fields: IntegrityFieldMap,
  section: MarkdownSection,
  lines: string[],
  violations: ReviewValidationViolation[],
): void {
  // A PR review must disclose how automated findings were reconciled with local evidence.
  if (reportUsesPrScope(fields)) {
    requireIntegrityField(
      fields,
      section,
      "Automated-review provenance",
      violations,
    );
  }
  // Visible cross-model activity requires a matching refuter disclosure.
  if (reportShowsRefuterActivity(lines)) {
    requireIntegrityField(fields, section, "Refuter pass", violations);
  }
  // A Spec Drift section requires its integrity status to be disclosed too.
  if (readSections(lines, "Spec Drift").length > 0) {
    requireIntegrityField(fields, section, "Spec drift", violations);
  }
}

/** Warn once per degradation flag that is not documented by goat-review. */
function warnUnknownDegradationFlags(
  flags: ReadonlySet<string>,
  line: number,
  warnings: ReviewValidationViolation[],
): void {
  // Unknown flags remain visible as warnings so reviewers can distinguish new limits from recognized ones.
  for (const flag of flags) {
    const configuredBase = /^configured-base-unresolved=\S+$/u.test(flag);
    // Recognized and separately rejected flags need no additional unknown-flag warning.
    if (
      KNOWN_DEGRADATION_FLAGS.has(flag) ||
      RETIRED_DEGRADATION_FLAGS.has(flag) ||
      configuredBase
    )
      continue;
    addWarning(
      warnings,
      "degradation-flag-unknown",
      line,
      `unknown degradation flag: ${flag || "<empty>"}`,
    );
  }
}

/** Reject historical escape hatches that bypass the skill's mandatory size stop. */
function rejectRetiredDegradationFlags(
  flags: ReadonlySet<string>,
  line: number,
  violations: ReviewValidationViolation[],
): void {
  // Check every declared limit for retired ways of bypassing mandatory chunking.
  for (const flag of flags) {
    // Only retired flags belong to this refusal; current flags are checked by their own rules.
    if (!RETIRED_DEGRADATION_FLAGS.has(flag)) continue;
    addViolation(
      violations,
      "integrity-format",
      line,
      `${flag} is retired; an oversized review must stop before Pass 1 or use accepted chunks`,
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
  // Declining the recommended depth caps the report at a partial conclusion.
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
  // A missing row is already explained by the required-field check shown to the reviewer.
  if (!field) return new Set();
  const listedFlags = field.value.split(",").map((flag) => flag.trim());
  const flags = new Set(listedFlags);

  // An empty list item leaves the reviewer unable to tell which degradation was intended.
  if (listedFlags.some((flag) => flag.length === 0)) {
    addViolation(
      violations,
      "integrity-format",
      field.line,
      "Degradation flags must not contain an empty list item",
    );
  }

  // "none" is the reader-facing claim that no degradation occurred, so another flag contradicts it.
  if (flags.has("none") && listedFlags.some((flag) => flag !== "none")) {
    addViolation(
      violations,
      "integrity-format",
      field.line,
      'Degradation flags cannot combine "none" with another flag',
    );
  }

  rejectRetiredDegradationFlags(flags, field.line, violations);
  warnUnknownDegradationFlags(flags, field.line, warnings);
  const conclusionField = fields.get("Conclusion");
  validateDegradationConclusion(
    flags,
    conclusionField?.value,
    conclusionField?.line ?? field.line,
    violations,
  );
  validateRiskDepthConclusion(flags, fields, field.line, violations);
  return flags;
}

/** Convert one integrity count while rejecting precision-losing integers. */
function readSafeIntegrityCount(
  countText: string,
  label: string,
  line: number,
  violations: ReviewValidationViolation[],
): number | null {
  const count = Number(countText);
  // Exact counts can be reconciled; values that lose integer precision must be refused.
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
  // Missing or malformed evidence totals cannot supply observed or inferred credit.
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
  // Both evidence counts must be exact before they can be compared with the surfaced findings.
  if (observed === null || inferred === null) return null;
  return { inferred, line: field.line, observed };
}

/**
 * Confirm all four disposition counts can be reconciled without using absent or imprecise values.
 */
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
  // A missing verdict row has no disposition counts for later reconciliation.
  if (!field) return null;
  const match = field.value.match(/^(\d+)\/(\d+)\/(\d+)\/(\d+)$/u);
  // Malformed disposition text cannot be treated as a partial set of valid totals.
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
  // All four counts must be exact before the report can claim their combined disposition.
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
  // Without the required scope fields, the report cannot identify what its findings reviewed.
  if (!match) {
    addViolation(
      violations,
      "integrity-format",
      field.line,
      "Scope snapshot must declare source, base, head, authority, drift, uncommitted, signals, bundle, and chunking in canonical order",
    );
    return null;
  }
  return readScopeSnapshotFields(match);
}

/** Normalize a complete scope claim before matching its labels with the captured source and review limits. */
function readScopeSnapshotFields(match: RegExpMatchArray): ParsedScopeSnapshot {
  const [
    ,
    sourceText = "",
    base = "",
    head = "",
    authority = "",
    drift = "",
    uncommitted = "",
    signals = "",
    bundle = "",
    chunking = "",
  ] = match;
  const source = sourceText.trim().toLowerCase();
  return {
    authority: authority.trim(),
    base: base.trim(),
    bundle: bundle.trim(),
    chunking: chunking.trim().toLowerCase(),
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
  const hasCompletedChunking = ["no", "none", "accepted"].includes(
    scope.chunking,
  );
  // A report must explicitly disclose a completed drift check before its proof can pass.
  if (!hasVerifiedDrift) {
    addViolation(
      violations,
      "integrity-format",
      line,
      "Scope snapshot drift must be verified before review proof can pass",
    );
  }
  // A durable bundle needs its documented path or the explicit redaction-unavailable disclosure.
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
  // Proposed, declined, or unknown chunking states cannot describe a completed review.
  if (!hasCompletedChunking) {
    addViolation(
      violations,
      "integrity-format",
      line,
      `completed review Scope snapshot has invalid chunking=${scope.chunking || "<empty>"}; use no, none, or accepted`,
    );
  }
  return hasSafeSignals && hasVerifiedDrift && hasCompletedChunking;
}

/** Bind semantic-anchor reads to the canonical scope snapshot authority. */
function readScopeAuthority(
  fields: IntegrityFieldMap,
  projectRoot: string,
  violations: ReviewValidationViolation[],
): { anchorAuthority: ReviewAnchorAuthority; isAreaAudit: boolean } {
  const field = fields.get("Scope snapshot");
  // Missing readable scope already blocks authority and cannot be replaced by another report field.
  if (!field) {
    return { anchorAuthority: { kind: "invalid" }, isAreaAudit: false };
  }
  const scope = parseScopeSnapshot(field, violations);
  // Malformed readable scope prevents later evidence from receiving a valid review identity.
  if (!scope) {
    return { anchorAuthority: { kind: "invalid" }, isAreaAudit: false };
  }
  const hasValidState =
    validateScopeState(scope, field.line, violations) &&
    validateFullScopeSize(fields, scope, violations);
  const anchorAuthority = readAuthorityFields(fields, projectRoot, violations);
  // The readable summary must describe the same source that will answer anchor reads.
  if (anchorAuthority.kind === "snapshot")
    validateAuthorityScope(
      scope,
      anchorAuthority.snapshot,
      field.line,
      violations,
    );
  // Existing size and drift declarations remain required beside the verified byte authority.
  if (!hasValidState)
    return {
      anchorAuthority: { kind: "invalid" },
      isAreaAudit: scope.isAreaAudit,
    };
  return { anchorAuthority, isAreaAudit: scope.isAreaAudit };
}

/** Validate the full Review Integrity field set and return its ledger claim. */
function validateFullIntegrity(
  projectRoot: string,
  section: MarkdownSection,
  lines: string[],
  violations: ReviewValidationViolation[],
  warnings: ReviewValidationViolation[],
  validationStage: ReviewValidationStage,
): IntegrityResult {
  const fields = collectIntegrityFields(section, violations);
  validateIntegrityFieldGrammar(fields, section, violations, validationStage);
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
  validateResolvedIntegrityFields(fields, section, lines, violations);
  const scope = readScopeAuthority(fields, projectRoot, violations);
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
  // Every compact disclosure remains mandatory even when the review has no findings.
  for (const field of COMPACT_CLEAN_REVIEW_FIELDS) {
    const matches = lines
      .map((text, lineIndex) => ({ line: lineIndex + 1, text }))
      .filter(({ text }) => field.prefix.test(text));
    const first = matches.at(0);
    // An omitted compact disclosure leaves readers unable to assess the claimed clean result.
    if (!first) {
      addViolation(
        violations,
        "integrity-format",
        null,
        `compact clean review is missing ${field.label}`,
      );
      continue;
    }
    // An empty or malformed disclosure cannot provide the explanation its label promises.
    if (!field.value.test(first.text)) {
      addViolation(
        violations,
        "integrity-format",
        first.line,
        `compact ${field.label} ${field.requirement}`,
      );
    }
    // Repeated compact disclosures can contradict the first one and must be reported separately.
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

/** Locate the compact Scope disclosure that owns its size claim. */
function findCompactScopeLine(lines: string[]): LocatedLine | undefined {
  return lines
    .map((text, index) => ({ line: index + 1, text }))
    .find(({ text }) => /^\s*Scope:/u.test(text));
}

/** Parse numeric evidence and terminal chunking from a compact Scope line. */
function parseCompactSizeClaim(
  located: LocatedLine,
  violations: ReviewValidationViolation[],
): CompactReviewSizeClaim | null {
  const match = located.text.match(COMPACT_REVIEW_SCOPE_SIZE);
  // An unreadable compact size cannot support its claimed coverage or chunking state.
  if (!match) {
    addViolation(
      violations,
      "integrity-format",
      located.line,
      "compact Scope must declare numeric files, changed lines, and terminal chunking",
    );
    return null;
  }
  const fileCount = readSafeIntegrityCount(
    match[1] as string,
    "compact Scope file count",
    located.line,
    violations,
  );
  const changedLines = readSafeIntegrityCount(
    match[2] as string,
    "compact Scope changed-line count",
    located.line,
    violations,
  );
  // An imprecise file count cannot establish the compact review's scope.
  if (fileCount === null) return null;
  // An imprecise changed-line count cannot establish whether chunking was required.
  if (changedLines === null) return null;
  return {
    fileCount,
    unitCount: changedLines,
    unitLabel: "changed lines",
    line: located.line,
    chunking: (match[3] as string).toLowerCase(),
  };
}

/** Validate the compact opened/scoped pair and return its scope denominator. */
function validateCompactOpenedCoverage(
  match: RegExpMatchArray,
  line: number,
  violations: ReviewValidationViolation[],
): number | null {
  const openedFileCount = readSafeIntegrityCount(
    match[2] as string,
    "compact files opened numerator",
    line,
    violations,
  );
  const scopedFileCount = readSafeIntegrityCount(
    match[3] as string,
    "compact files opened denominator",
    line,
    violations,
  );
  // An imprecise opened count cannot support the compact report's coverage claim.
  if (openedFileCount === null) return null;
  // An imprecise scope count cannot supply a valid coverage denominator.
  if (scopedFileCount === null) return null;
  // A report cannot claim to have opened more files than it scoped.
  if (openedFileCount > scopedFileCount) {
    addViolation(
      violations,
      "integrity-format",
      line,
      `compact files opened claims ${openedFileCount}/${scopedFileCount}; opened files cannot exceed scoped files`,
    );
  }
  return scopedFileCount;
}

/** Cross-check compact scope counts against its terminal chunking state. */
function validateCompactScopeSize(
  lines: string[],
  coverageFileCount: number | null,
  violations: ReviewValidationViolation[],
): void {
  const located = findCompactScopeLine(lines);
  // The missing compact Scope disclosure is already reported by its required-field check.
  if (!located) return;
  const size = parseCompactSizeClaim(located, violations);
  // A malformed compact size cannot be used to validate coverage relationships.
  if (!size) return;
  // The size and coverage denominator must describe the same selected files.
  if (coverageFileCount !== null && size.fileCount !== coverageFileCount) {
    addViolation(
      violations,
      "integrity-format",
      size.line,
      `compact Scope file count ${size.fileCount} does not match files opened denominator ${coverageFileCount}`,
    );
  }
  // A compact review within both limits needs no accepted chunking arrangement.
  if (
    !reviewScopeExceedsChunkLimit(
      size.fileCount,
      size.unitCount,
      size.unitLabel,
    )
  ) {
    return;
  }
  // Accepted chunks satisfy the oversized-review requirement recorded in the compact scope.
  if (size.chunking === "accepted") return;
  addViolation(
    violations,
    "integrity-format",
    size.line,
    `compact Scope exceeds ${REVIEW_CHUNK_FILE_LIMIT} files or ${REVIEW_CHUNK_CHANGED_LINE_LIMIT} changed lines; use chunking=accepted`,
  );
}

/** Validate a compact clean-review receipt and the disclosures that support its verdict. */
function validateCompactIntegrity(
  projectRoot: string,
  lines: string[],
  findingCandidateCount: number,
  violations: ReviewValidationViolation[],
  validationStage: ReviewValidationStage,
): IntegrityResult {
  const compactIntegrityLines = lines
    .map((text, lineIndex) => ({ line: lineIndex + 1, text }))
    .filter(({ text }) => /^\s*Review Integrity:/u.test(text));
  const compactIntegrityLine = compactIntegrityLines.at(0);
  const compactIndex = compactIntegrityLine
    ? compactIntegrityLine.line - 1
    : -1;
  const compactIntegrityMatch = matchCompactReviewIntegrity(
    lines[compactIndex] ?? "",
    validationStage,
  );
  // Zero-finding reviews may use the shorter user-facing integrity line.
  if (compactIndex >= 0 && compactIntegrityMatch) {
    // Each extra integrity line could contradict the first receipt and needs its own reported location.
    for (const duplicate of compactIntegrityLines.slice(1)) {
      addViolation(
        violations,
        "integrity-field-duplicate",
        duplicate.line,
        `compact Review Integrity duplicates the field at line ${compactIndex + 1}`,
      );
    }
    validateCompactCleanReviewFields(lines, violations);
    const coverageFileCount = validateCompactOpenedCoverage(
      compactIntegrityMatch,
      compactIndex + 1,
      violations,
    );
    validateCompactScopeSize(lines, coverageFileCount, violations);
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
      anchorAuthority: readAuthorityFields(
        compactAuthorityFields(lines),
        projectRoot,
        violations,
      ),
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
 * Validate a full or compact receipt before its coverage and evidence claims can influence the verdict.
 *
 * @param projectRoot - selected project whose original authority must still resolve
 * @param lines - visible report lines; empty input is reported as missing integrity
 * @param findingCandidateCount - candidate finding rows; nonzero disallows the compact clean-review form
 *
 * @param violations - appended failures that prevent the report from passing
 * @param warnings - advisory issues that inform the reader without failing validation
 * @param validationStage - draft requires a pending receipt; final requires a completed validator state
 *
 * @returns parsed claims for later passes; absent or malformed fields have already produced issues
 */
export function validateIntegrity(
  projectRoot: string,
  lines: string[],
  findingCandidateCount: number,
  violations: ReviewValidationViolation[],
  warnings: ReviewValidationViolation[],
  validationStage: ReviewValidationStage = "final",
): IntegrityResult {
  validateVisibleAuthorityFields(lines, violations);
  const fullSections = readSections(lines, "Review Integrity");
  const fullSection = fullSections.at(0);
  // A full receipt is authoritative whenever the user includes its H2 section.
  if (fullSection) {
    const compactIntegrityLines = lines
      .map((text, lineIndex) => ({ line: lineIndex + 1, text }))
      .filter(({ text }) => /^\s*Review Integrity:/u.test(text));
    // A full receipt cannot borrow or contradict a compact integrity claim elsewhere in the report.
    for (const compactIntegrity of compactIntegrityLines) {
      addViolation(
        violations,
        "integrity-format",
        compactIntegrity.line,
        "Review Integrity cannot mix compact and full forms",
      );
    }
    // Repeated receipts would let a report present conflicting validation state.
    for (const duplicate of fullSections.slice(1)) {
      addViolation(
        violations,
        "integrity-section-duplicate",
        duplicate.headingLine,
        `Review Integrity duplicates the section at line ${fullSection.headingLine}`,
      );
    }
    return validateFullIntegrity(
      projectRoot,
      fullSection,
      lines,
      violations,
      warnings,
      validationStage,
    );
  }
  return validateCompactIntegrity(
    projectRoot,
    lines,
    findingCandidateCount,
    violations,
    validationStage,
  );
}
