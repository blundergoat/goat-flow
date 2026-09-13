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
  REVIEW_CHUNK_CHANGED_LINE_LIMIT,
  REVIEW_CHUNK_FILE_LIMIT,
  matchCompactReviewIntegrity,
  readSections,
  addViolation,
  readIntegrityJson,
  readSafeIntegrityCount,
  readFindingPrefixTags,
  disclosureNamesPath,
  reviewIntegrityFormatMessage,
  reviewIntegrityValuePattern,
  reviewScopeExceedsChunkLimit,
  type ReviewValidationViolation,
  type MarkdownSection,
  type IntegrityResult,
  type ReviewValidationStage,
  type ReviewAnchorAuthority,
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
  readAuthorityFields,
  reviewScopeLabels,
} from "./review-validate-authority.js";
import {
  validateDegradationFlags,
  validateDegradationEvidence,
  readIntegrityConclusion,
} from "./review-validate-verdict.js";
import { validateBundleReceipt } from "./review-validate-ledger.js";
import {
  validateAreaSampleBoundary,
  readFinalDispositions,
  readEvidenceCounts,
  readVerdictCounts,
} from "./review-validate-sections.js";

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
      "Size must be n files, u changed lines (source coverage: k/n exactly once); area uses clusters",
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
function reportShowsRefuterActivity(
  lines: string[],
  flags: ReadonlySet<string>,
): boolean {
  return (
    lines.some((line) =>
      readFindingPrefixTags(line).includes("CONFIRMED-CROSS-MODEL"),
    ) ||
    flags.has("cross-model-refuter-failed") ||
    flags.has("cross-model-unresolved") ||
    flags.has("refuter-citation-unverified")
  );
}

/** Require conditional rows whose triggers are visible elsewhere in the report. */
function validateResolvedIntegrityFields(
  fields: IntegrityFieldMap,
  section: MarkdownSection,
  lines: string[],
  flags: ReadonlySet<string>,
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
  if (reportShowsRefuterActivity(lines, flags)) {
    requireIntegrityField(fields, section, "Refuter pass", violations);
  }
  // A Spec Drift section requires its integrity status to be disclosed too.
  if (readSections(lines, "Spec Drift").length > 0) {
    requireIntegrityField(fields, section, "Spec drift", violations);
  }
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
  _warnings: ReviewValidationViolation[],
  validationStage: ReviewValidationStage,
): IntegrityResult {
  const fields = collectIntegrityFields(section, violations);
  validateIntegrityFieldGrammar(fields, section, violations, validationStage);
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
  const degradationFlags = validateDegradationFlags(fields, violations);
  validateResolvedIntegrityFields(
    fields,
    section,
    lines,
    degradationFlags,
    violations,
  );
  const scope = readScopeAuthority(fields, projectRoot, violations);
  const integrity: IntegrityResult = {
    fields,
    flags: degradationFlags,
    isCompact: false,
    validationStage,
    finalDispositions: readFinalDispositions(fields, violations),
    ledgerIds: null,
    ...scope,
    conclusion: readIntegrityConclusion(fields),
    isRiskDepthDeclined: degradationFlags.has("risk-depth-declined"),
    evidenceCounts: readEvidenceCounts(fields, violations),
    ...readRefutationClaim(fields, violations),
    verdictCounts: readVerdictCounts(fields, violations),
  };
  validateCoverageManifest(integrity, violations);
  validateAreaSampleBoundary(integrity, lines, violations);
  validateBundleReceipt(projectRoot, integrity, violations);
  validateDegradationEvidence(integrity, violations);
  return integrity;
}

/** Read a canonical list of literal selected paths; empty means no file received the claimed coverage. */
function readCoveragePaths(
  value: unknown,
  label: string,
  line: number | null,
  violations: ReviewValidationViolation[],
): string[] | null {
  // Delimiter-bearing paths must survive as literal JSON strings, without empty entries or repeated file credit.
  if (
    !Array.isArray(value) ||
    !value.every(
      (path): path is string => typeof path === "string" && path.length > 0,
    ) ||
    new Set(value).size !== value.length
  ) {
    addViolation(
      violations,
      "integrity-format",
      line,
      `${label} must be a canonical array of unique nonempty paths`,
    );
    return null;
  }
  return value;
}

/** Resolve the opened-file list without letting commas or Markdown delimiters silently change a filename. */
function readOpenedPaths(
  field: IntegrityField | undefined,
  violations: ReviewValidationViolation[],
): string[] | null {
  const match = field?.value.match(/^\d+\/\d+ \((diff paths|paths): (.*)\)$/u);
  // A bare count does not tell the reader which selected files were actually opened.
  if (!field || !match) {
    addViolation(
      violations,
      "integrity-format",
      field?.line ?? null,
      "Files opened in Pass 2 requires k/n (diff paths: ...) or k/n (paths: [canonical JSON strings])",
    );
    return null;
  }
  const text = match[2]!;
  // The legacy simple list is safe only when its filenames cannot contain its own separators.
  if (match[1] === "diff paths") {
    const paths = text === "none" ? [] : text.split(/,\s*/u);
    // Legacy path lists cannot preserve delimiter-bearing filenames; those reports need the canonical JSON form.
    if (paths.some((path) => !/^[\w./@+-]+$/u.test(path))) {
      addViolation(
        violations,
        "integrity-format",
        field.line,
        "delimiter-bearing opened paths require the canonical JSON paths form",
      );
      return null;
    }
    return readCoveragePaths(
      paths,
      "Files opened in Pass 2",
      field.line,
      violations,
    );
  }
  const temporaryFields = new Map([
    ["opened paths", { value: text, line: field.line }],
  ]);
  return readCoveragePaths(
    readIntegrityJson(temporaryFields, "opened paths", violations),
    "Files opened in Pass 2",
    field.line,
    violations,
  );
}

/** Require a limitation flag and explain a missing selection using its unchanged literal paths. */
function requireCoverageFlag(
  integrity: IntegrityResult,
  flag: string,
  missing: string[],
  violations: ReviewValidationViolation[],
): void {
  // Complete coverage needs no missing-path explanation or reduced-confidence route.
  if (missing.length === 0) return;
  const evidence = readIntegrityJson(
    integrity.fields,
    "Degradation evidence",
    violations,
  );
  const reason =
    evidence && !Array.isArray(evidence) && typeof evidence === "object"
      ? evidence[flag]
      : null;
  // Each missing file must stay visible so a reviewer cannot shrink the denominator to make a partial pass look complete.
  if (
    !integrity.flags.has(flag) ||
    typeof reason !== "string" ||
    missing.some((path) => !disclosureNamesPath(reason, path))
  )
    addViolation(
      violations,
      "integrity-format",
      integrity.fields.get("Source coverage")?.line ?? null,
      `incomplete selected coverage requires ${flag} and Degradation evidence naming missing paths: ${JSON.stringify(missing)}`,
    );
}

/** Reconcile opened files and completed source coverage against the frozen selected inventory. */
function validateCoverageManifest(
  integrity: IntegrityResult,
  violations: ReviewValidationViolation[],
): void {
  const { fields, anchorAuthority } = integrity;
  // Invalid authority cannot establish a replacement denominator from report prose.
  if (anchorAuthority.kind !== "snapshot") return;
  const selected = anchorAuthority.snapshot.inventory.map(
    (member) => member.path,
  );
  const present = new Set(
    anchorAuthority.snapshot.inventory
      .filter(
        (member) => member.new.kind === "file" || member.old?.kind === "file",
      )
      .map((member) => member.path),
  );
  const sizeField = fields.get("Size");
  const size = sizeField?.value.match(FULL_REVIEW_SIZE_VALUE);
  const openedCounts = fields
    .get("Files opened in Pass 2")
    ?.value.match(/^(\d+)\/(\d+)\b/u);
  // Both claims count unique selected files, never chunks, assertions, old/new sides, or surrounding files.
  for (const [label, counts, flag] of [
    ["Source coverage", size?.slice(4, 6), "chunked-partial"],
    ["Files opened in Pass 2", openedCounts?.slice(1, 3), "files-not-opened"],
  ] as const) {
    validateCoverageClaim(
      { label, counts, flag, selected, present },
      integrity,
      violations,
    );
  }
  // Size is a statement about the frozen selection, even when only some selected source has been covered.
  if (size && sizeField && Number(size[1]) !== selected.length)
    addViolation(
      violations,
      "integrity-format",
      sizeField.line,
      `Size must retain all ${selected.length} selected files`,
    );
}

/** Validate one file coverage claim against the selected inventory, preserving its denominator and missing paths. */
function validateCoverageClaim(
  claim: {
    label: string;
    counts: string[] | undefined;
    flag: string;
    selected: string[];
    present: Set<string>;
  },
  integrity: IntegrityResult,
  violations: ReviewValidationViolation[],
): void {
  const { label, counts, flag, selected, present } = claim;
  const field = integrity.fields.get(label);
  const line = field?.line ?? null;
  const paths =
    label === "Source coverage"
      ? readCoveragePaths(
          readIntegrityJson(integrity.fields, label, violations),
          label,
          line,
          violations,
        )
      : readOpenedPaths(field, violations);
  // A malformed manifest or count already needs repair before coverage can be reconciled.
  if (!paths || !counts) return;
  const totals = counts.map(Number);
  // Paths count once and must belong to the actual files available in the selected source.
  if (
    !coverageCountsMatch(totals, paths.length, selected.length) ||
    paths.some((path) => !present.has(path))
  )
    addViolation(
      violations,
      "integrity-format",
      line,
      `${label} counts and unique paths must match the ${selected.length} files in the selected inventory`,
    );
  requireCoverageFlag(
    integrity,
    flag,
    selected.filter((path) => !paths.includes(path)),
    violations,
  );
  // A completed manifest cannot simultaneously claim missing reads or unfinished chunks.
  if (paths.length === selected.length && integrity.flags.has(flag))
    addViolation(
      violations,
      "integrity-format",
      line,
      `${flag} requires incomplete selected coverage`,
    );
}

/** Require exact file totals so rounded numbers or a smaller denominator cannot overstate coverage. */
function coverageCountsMatch(
  totals: number[],
  coveredFiles: number,
  selectedFiles: number,
): boolean {
  return (
    totals.every(Number.isSafeInteger) &&
    totals[0] === coveredFiles &&
    totals[1] === selectedFiles
  );
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

/** Collect compact metadata into the same receipt section consumed by full reports, retaining original line locations. */
function compactIntegritySection(
  lines: string[],
  match: readonly string[],
  receiptLine: number,
): MarkdownSection {
  const labels = new Set([
    ...REQUIRED_INTEGRITY_FIELDS.map(([label]) => label),
    "Final dispositions",
    "Refuter outcomes",
    "Refuter pass",
    "Automated-review provenance",
    "Gate findings",
  ]);
  const metadata = lines.flatMap((text, index) => {
    const label = text.match(/^\s*([^:]+):/u)?.[1]?.trim();
    // Only standalone metadata belongs to a compact receipt; ordinary prose cannot supply an integrity field.
    return label && labels.has(label)
      ? [{ text: `- ${text.trim()}`, line: index + 1 }]
      : [];
  });
  metadata.push(
    { text: `- Conclusion: ${match[1]}`, line: receiptLine },
    { text: `- Degradation flags: ${match[4] ?? "none"}`, line: receiptLine },
    {
      text: `- Review validator: ${lines[receiptLine - 1]?.match(/validator=(validated|validator-unavailable|pending)/u)?.[1] ?? ""}`,
      line: receiptLine,
    },
  );
  return { headingLine: receiptLine, lines: metadata };
}

/** Require compact scope prose and its short opened pair to agree with the complete shared metadata. */
function validateCompactRelationships(
  lines: string[],
  match: RegExpMatchArray,
  integrity: IntegrityResult,
  violations: ReviewValidationViolation[],
): void {
  const scopeLine = findCompactScopeLine(lines);
  const size = scopeLine ? parseCompactSizeClaim(scopeLine, violations) : null;
  // The compact summary cannot replace a missing manifest or contradict its coverage and size.
  if (
    !compactOpenedCountsMatch(match, integrity) ||
    !compactSizeMatches(size, integrity)
  )
    addViolation(
      violations,
      "integrity-format",
      scopeLine?.line ?? null,
      "compact Scope and files opened must agree with Scope snapshot, Size, and Files opened in Pass 2",
    );
  const authority = integrity.anchorAuthority;
  // Missing scope or invalid authority already fails the report; neither can support further source-label checks.
  if (authority.kind !== "snapshot" || !scopeLine) return;
  const label = reviewScopeLabels(authority.snapshot).source;
  const readableScope = scopeLine.text.replace(/^\s*Scope:\s*/u, "");
  // The short scope label must identify the same source as its retained authority metadata.
  if (!readableScope.toLowerCase().startsWith(`${label.toLowerCase()};`))
    addViolation(
      violations,
      "integrity-format",
      scopeLine.line,
      `compact Scope must begin with ${label}; to identify its canonical source`,
    );
  validateCompactEligibility(match, integrity, violations);
}

/** Compare the compact opened count with its complete per-file metadata before allowing a clean summary. */
function compactOpenedCountsMatch(
  match: RegExpMatchArray,
  integrity: IntegrityResult,
): boolean {
  const opened = integrity.fields
    .get("Files opened in Pass 2")
    ?.value.match(/^(\d+)\/(\d+)\b/u);
  return (
    opened !== undefined &&
    opened !== null &&
    opened[1] === match[2] &&
    opened[2] === match[3]
  );
}

/** Compare compact workload and chunking claims with the full shared size declaration. */
function compactSizeMatches(
  size: CompactReviewSizeClaim | null,
  integrity: IntegrityResult,
): boolean {
  const fullSize = integrity.fields
    .get("Size")
    ?.value.match(FULL_REVIEW_SIZE_VALUE);
  // Missing size metadata cannot establish the compact form's eligibility.
  if (!size || !fullSize) return false;
  const chunking = integrity.fields
    .get("Scope snapshot")
    ?.value.match(SCOPE_SNAPSHOT)?.[9]
    ?.toLowerCase();
  return (
    size.fileCount === Number(fullSize[1]) &&
    size.unitCount === Number(fullSize[2]) &&
    size.chunking === chunking
  );
}

/** Identify refuter work that requires the full output even when no active finding survived. */
function hasCompactRefuterWork(
  integrity: IntegrityResult,
  violations: ReviewValidationViolation[],
): boolean {
  const refuter = integrity.fields.get("Refuter pass")?.value;
  const outcomes = readIntegrityJson(
    integrity.fields,
    "Refuter outcomes",
    violations,
  );
  return (
    refuter?.startsWith("yes;") === true ||
    (outcomes !== null &&
      (typeof outcomes !== "object" || Object.keys(outcomes).length > 0))
  );
}

/** Require full output whenever selected source, coverage, or unresolved review work cannot support a compact clean result. */
function validateCompactEligibility(
  match: RegExpMatchArray,
  integrity: IntegrityResult,
  violations: ReviewValidationViolation[],
): void {
  const authority = integrity.anchorAuthority;
  // Invalid authority is already refused and cannot be rescued by choosing another presentation.
  if (authority.kind !== "snapshot") return;
  const ineligibleSource = isFullOnlySource(authority);
  const hasRefuterWork = hasCompactRefuterWork(integrity, violations);
  // A short clean result cannot hide sampled areas, unread files, refutations, or work requiring a reduced conclusion.
  if (
    ineligibleSource ||
    match[2] !== match[3] ||
    integrity.conclusion !== "confident" ||
    integrity.refutationsLogged > 0 ||
    hasRefuterWork ||
    [...integrity.flags].some(
      (flag) =>
        !["none", "intent-unstated", "base-fetch-skipped"].includes(flag),
    )
  )
    addViolation(
      violations,
      "integrity-format",
      integrity.fields.get("Scope snapshot")?.line ?? null,
      "use full output: compact requires a complete diff/PR selection, zero refutations/refuter work, and no confidence-reducing flag",
    );
}

/** Area and explicit-path selections require the full report's scope and audit disclosures. */
function isFullOnlySource(
  authority: Extract<ReviewAnchorAuthority, { kind: "snapshot" }>,
): boolean {
  return (
    authority.snapshot.source.kind === "area" ||
    authority.snapshot.source.kind === "paths"
  );
}

/** Validate compact presentation through the full receipt reader so shorter prose never bypasses source or persistence checks. */
function validateCompactIntegrity(
  projectRoot: string,
  lines: string[],
  findingCandidateCount: number,
  violations: ReviewValidationViolation[],
  validationStage: ReviewValidationStage,
): IntegrityResult {
  const receipts = lines.flatMap((text, index) =>
    /^\s*Review Integrity:/u.test(text) ? [{ text, line: index + 1 }] : [],
  );
  const receipt = receipts[0];
  const match = readCompactReceipt(receipts, validationStage, violations);
  validateCompactCleanReviewFields(lines, violations);
  const integrity = validateFullIntegrity(
    projectRoot,
    compactIntegritySection(lines, match ?? [], receipt?.line ?? 1),
    lines,
    violations,
    [],
    validationStage,
  );
  integrity.isCompact = true;
  // Findings and refuted history require the full report even when the short summary claims zero results.
  if (findingCandidateCount > 0)
    addViolation(
      violations,
      "integrity-format",
      receipt?.line ?? null,
      "compact Review Integrity is permitted only for a zero-finding review; use full output",
    );
  // Only a parsed compact summary can be compared with the shared metadata beneath it.
  if (match) validateCompactRelationships(lines, match, integrity, violations);
  return integrity;
}

/** Read one compact receipt and report duplicate, missing, or malformed summaries at their visible locations. */
function readCompactReceipt(
  receipts: LocatedLine[],
  stage: ReviewValidationStage,
  violations: ReviewValidationViolation[],
): RegExpMatchArray | null {
  const receipt = receipts[0];
  const match = matchCompactReviewIntegrity(receipt?.text ?? "", stage);
  // Every repeated visible receipt could contradict the first, even when their strings match.
  for (const duplicate of receipts.slice(1))
    addViolation(
      violations,
      "integrity-field-duplicate",
      duplicate.line,
      "compact Review Integrity must appear exactly once",
    );
  // An absent or malformed summary cannot make the report eligible for compact validation.
  if (!match)
    addViolation(
      violations,
      "integrity-format",
      receipt?.line ?? null,
      receipt
        ? "compact Review Integrity line is malformed"
        : "report is missing Review Integrity",
    );
  return match;
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
