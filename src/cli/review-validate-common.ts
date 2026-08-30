/**
 * The shared vocabulary every review-report check speaks.
 *
 * A review report is validated by several independent passes - anchors, integrity fields, refutation ledger, sections, ship verdict - and they all
 * need the same things: the shape of a violation, the stable check id a user sees beside it, and how to slice the report into addressable sections
 * and lines.
 *
 * Keeping that here means a finding raised by any pass carries the same identity and points at the same line the author is looking at.
 * The check-id registry is the load-bearing part: those ids appear in user-facing output and in review contracts, so a code without one would surface
 * as an unattributable error.
 */
/** One actionable validation issue, optionally tied to a report line. */
export interface ReviewValidationViolation {
  checkId: ReviewCheckId;
  code: string;
  line: number | null;
  message: string;
}

/** Deterministic validator result consumed by tests and the CLI renderer. */
export interface ReviewValidationResult {
  status: "pass" | "fail";
  violations: ReviewValidationViolation[];
  warnings: ReviewValidationViolation[];
}

/** Validation phase controls whether the report is still awaiting its final proof. */
export type ReviewValidationStage = "draft" | "final";

/** One report line with its one-based source location. */
export interface LocatedLine {
  line: number;
  text: string;
}

/** H2 section body and the heading location used for missing-field errors. */
export interface MarkdownSection {
  headingLine: number;
  lines: LocatedLine[];
}

/** Refutation claim extracted while validating the integrity surface. */
export interface IntegrityResult {
  anchorAuthority: ReviewAnchorAuthority;
  conclusion: ReviewIntegrityConclusion | null;
  isRiskDepthDeclined: boolean;
  evidenceCounts: EvidenceCountClaim | null;
  refutationsLogged: number;
  isRefutationPersistenceSkipped: boolean;
  refutationsLine: number | null;
  refutationLedger: string | null;
  refutationLedgerLine: number | null;
  isAreaAudit: boolean;
  verdictCounts: VerdictCountClaim | null;
}

/** Parsed finding definition used for stable-ID and conditional-section checks. */
export interface FindingDefinition {
  action: FindingAction;
  evidence: "INFERRED" | "OBSERVED" | null;
  id: string;
  line: number;
  section: (typeof FINDING_SECTIONS)[number];
  severity: FindingSeverity;
}

/** What a finding asks the author to do next, shown beside its severity. */
export type FindingAction =
  | "patch"
  | "needs-decision"
  | "intent-mismatch"
  | "needs-signal"
  | "pre-existing";

/** How strongly a finding blocks shipping: MUST blocks, SHOULD argues, MAY suggests. */
export type FindingSeverity = "MUST" | "SHOULD" | "MAY";

/** The reviewer's own statement of how complete their pass was, which can downgrade the verdict. */
export type ReviewIntegrityConclusion =
  "confident" | "coverage-degraded" | "high-inference" | "partial";

/** The one line a reader acts on: whether this change is safe to ship. */
export type ShipVerdictDecision =
  | "YES"
  | "YES WITH CONDITIONS"
  | "PARTIAL"
  | "NO"
  | "PENDING REFUTER/HUMAN"
  | "N/A - AREA AUDIT ONLY";

/** Parsed user-facing decision and the report line that declared it. */
export interface ShipVerdictClaim {
  decision: ShipVerdictDecision;
  line: number;
}

/** Source whose bytes semantic anchors must be resolved against. */
export type ReviewAnchorAuthority =
  | { kind: "git-object"; oid: string }
  | { kind: "worktree" }
  | { kind: "invalid" };

/** Parsed Evidence totals and their report location. */
export interface EvidenceCountClaim {
  inferred: number;
  line: number;
  observed: number;
}

/** Parsed four-way Pass 2 disposition totals and their report location. */
export interface VerdictCountClaim {
  adjusted: number;
  confirmed: number;
  line: number;
  refuted: number;
  unresolved: number;
}

/** Canonical authority-bearing fields extracted from Scope snapshot. */
export interface ParsedScopeSnapshot {
  authority: string;
  bundle: string;
  chunking: string;
  drift: string;
  head: string;
  isAreaAudit: boolean;
  signals: string;
  source: string;
  uncommitted: string;
}

/** Numeric scope evidence parsed from a full or compact report receipt. */
export interface ReviewSizeClaim {
  fileCount: number;
  unitCount: number;
  unitLabel: string;
  line: number;
}

/** Compact scope evidence plus the terminal chunking state it declares. */
export interface CompactReviewSizeClaim extends ReviewSizeClaim {
  chunking: string;
}

/** Stable V-number shown beside each issue so a user can look the check up. */
type ReviewCheckId = "V1" | "V2" | "V3" | "V4" | "V5" | "V6" | "V7" | "V8";

/**
 * V1-V8 are the public validator check IDs. Detail codes keep each result actionable.
 *
 * Grammar anchors: SKILL.md (search: `Use prefix \`R-NNN [SEVERITY:ACTION]\``), SKILL.md (search: `## Review Integrity (confidence signal)`), and
 * SKILL.md (search: `Render only with content:`).
 */
const CHECK_IDENTIFIER_BY_CODE = {
  "anchor-outside-project": "V1",
  "anchor-unresolved": "V1",
  "anchor-format": "V1",
  "finding-grammar": "V2",
  "finding-section-duplicate": "V2",
  "finding-action-scope": "V2",
  "spec-drift-grammar": "V2",
  "finding-harm": "V3",
  "finding-evidence": "V4",
  "finding-proof": "V4",
  "integrity-format": "V5",
  "integrity-section-duplicate": "V5",
  "integrity-field-duplicate": "V5",
  "ship-verdict-format": "V5",
  "ship-verdict-contradiction": "V5",
  "degradation-flag-unknown": "V5",
  "finding-id-duplicate": "V6",
  "finding-reference-unresolved": "V6",
  "top-five-unexpected": "V7",
  "top-five-missing": "V7",
  "optional-section-empty": "V7",
  "refutation-ledger": "V8",
} as const satisfies Record<string, ReviewCheckId>;

/** Machine-readable issue name; every code maps to exactly one user-facing check id. */
export type ReviewIssueCode = keyof typeof CHECK_IDENTIFIER_BY_CODE;

export const FINDING_SECTIONS = [
  "Findings",
  "Systemic Patterns",
  "Refuted by Refuter",
] as const;

export const SURFACED_FINDING_SECTIONS = new Set<string>([
  "Findings",
  "Systemic Patterns",
]);

export const OPTIONAL_SECTIONS = [
  "Systemic Patterns",
  "Spec Drift",
  "Pre-existing Nearby",
  "Pre-existing Issues",
  "Breaking Changes",
  "Refuted by Refuter",
  "What's Good",
] as const;

export const TOP_FIVE_HEADINGS = [
  "Top 5 Risks",
  "Top 5 Risks (cross-tier)",
] as const;

export const FINDING_CANDIDATE = /^\s*-\s+\S/u;
export const FINDING_PREFIX =
  /^\s*-\s+(R-\d{3})\s+\[(MUST|SHOULD|MAY):(patch|needs-decision|intent-mismatch|needs-signal|pre-existing)\](?:\s+\[(?:(?:overlap-confirmed|bot-only-locally-verified|disputed-match):[^\]\s]+|local-only|CONFIRMED-CROSS-MODEL)\])*\s+\*\*[^*\n]+\*\*/u;
export const EVIDENCE_TAG =
  /(?:^|\|\s*)Evidence:\s*(OBSERVED|INFERRED)(?=\s*(?:\||$))/u;
export const PROOF_TAG =
  /(?:^|\|\s*)Proof:\s*(?:RUNTIME|CONTRACT-GREP|STATIC|NOT-REPRODUCED)(?=\s*(?:\||$))/u;
export const HARM_TAG = /(?:^|\|\s*)Harm:\s*[^|\s][^|]*(?=\s*(?:\||$))/u;
export const ANCHOR =
  /`([^`\r\n]+)`\s+\(search:\s*(?:`([^`\r\n]+)`|"([^"\r\n]+)")\)/gu;
export const SPEC_DRIFT_LINE =
  /^\s*-\s+\[(?:advisory|ready-to-tick)\]\s+\*\*[^*\n]+\*\*\s+-\s+\S/u;
export const REFUTATION_LEDGER_PATH =
  /^\.goat-flow\/logs\/review\/goat-review-refutations\.[^\/\s]+\.txt$/u;
export const REVIEW_BUNDLE_PATH =
  /^\.goat-flow\/logs\/review\/goat-review-bundle\.[^\/\s]+\.diff$/u;
export const IMMUTABLE_OBJECT_IDENTIFIER = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu;
export const SCOPE_SNAPSHOT =
  /^source=(worktree|staged|unstaged|PR(?:\s+#[^,\s]+)?|branch diff|area|explicit path list),\s*base=([^,]+),\s*head=([^,]+),\s*authority=([^,]+),\s*drift=([^,]+),\s*uncommitted=(yes|no|n\/a),\s*signals=(\d+),\s*bundle=([^,]+),\s*chunking=(\S.*)$/iu;
/** Twenty is binding because goat-review forbids larger file scopes from entering Pass 1 unchunked. */
export const REVIEW_CHUNK_FILE_LIMIT = 20;
/** Three thousand is binding because goat-review forbids larger diffs from entering Pass 1 unchunked. */
export const REVIEW_CHUNK_CHANGED_LINE_LIMIT = 3000;
export const FULL_REVIEW_SIZE_VALUE =
  /^(\d+)\s+files?,\s*(\d+)\s+(changed[- ]lines?|clusters?)\b/iu;
export const COMPACT_REVIEW_SCOPE_SIZE =
  /^\s*Scope:\s*\S.*?\b(\d+)\s+files?\s+(?:and|,)\s*(\d+)\s+changed[- ]lines?\b.*;\s*chunking=(no|none|accepted)\.?\s*$/iu;

export const REQUIRED_INTEGRITY_FIELDS: ReadonlyArray<
  readonly [label: string, valuePattern: RegExp]
> = [
  ["Scope snapshot", /\S/u],
  ["Files opened in Pass 2", /^\d+\/\d+\b/u],
  ["Evidence", /^\d+ OBSERVED\s*\/\s*\d+ INFERRED$/u],
  ["Verdicts", /^\d+\/\d+\/\d+\/\d+$/u],
  ["Refutations logged", /^\d+(?:\s+\(persist-skipped\))?$/u],
  [
    "Refutation ledger",
    /^(?:n\/a|persist-skipped|\.goat-flow\/logs\/review\/goat-review-refutations\.[^\/\s]+\.txt)$/u,
  ],
  ["Review validator", /^(?:validated|validator-unavailable)$/u],
  ["Gates", /^(?:run|unavailable|skipped \(.+\))$/u],
  [
    "Gate evidence",
    /^pass=\d+,\s*changed-code=\d+,\s*pre-existing=\d+,\s*infrastructure=\d+,\s*unresolved=\d+$/u,
  ],
  ["Size", /\S/u],
  ["Spec drift", /^(?:checked M\d+|skipped|unavailable)$/u],
  ["Degradation flags", /\S/u],
  ["Conclusion", /^(?:confident|coverage-degraded|high-inference|partial)$/u],
];

export const AUTOMATED_REVIEW_VALUE =
  /^(?:n\/a|no-automated-review-present|overlap-confirmed=\d+,\s*local-only=\d+,\s*bot-only-locally-verified=\d+,\s*disputed-match=\d+;\s*.+)$/u;
export const REFUTER_VALUE =
  /^(?:yes|no|skipped);\s*confirmed=\d+,\s*refuted=\d+,\s*unresolved=\d+,\s*leads-verified=\d+,\s*model=\S.+$/u;
const COMPACT_INTEGRITY =
  /^\s*Review Integrity:\s*(confident|coverage-degraded|high-inference|partial);\s*(\d+)\/(\d+)\s+files opened;\s*no degradation flags;\s*validator=(?:validated|validator-unavailable)\.?\s*$/u;
const COMPACT_DRAFT_INTEGRITY =
  /^\s*Review Integrity:\s*(confident|coverage-degraded|high-inference|partial);\s*(\d+)\/(\d+)\s+files opened;\s*no degradation flags;\s*validator=pending\.?\s*$/u;
export const COMPACT_CLEAN_REVIEW_FIELDS = [
  {
    label: "Scope",
    prefix: /^\s*Scope:/u,
    value: /^\s*Scope:\s*\S.*;\s*chunking=(?:no|none|accepted)\.?\s*$/iu,
    requirement:
      "must end with chunking=no, chunking=none, or chunking=accepted",
  },
  {
    label: "Zero findings",
    prefix: /^\s*Zero findings:/u,
    value: /^\s*Zero findings:\s*\S.*;\s*\S.*$/u,
    requirement: "must name checks and the evidence that disproved suspicions",
  },
  {
    label: "What I Didn't Examine",
    prefix: /^\s*What I Didn't Examine:/u,
    value: /^\s*What I Didn't Examine:\s*\S.*$/u,
    requirement: "must name an unexamined surface or state none",
  },
] as const;

export const FULL_SHIP_VERDICT =
  /^\s*Decision:\s*\*\*(YES|YES WITH CONDITIONS|PARTIAL|NO|PENDING REFUTER\/HUMAN|N\/A - AREA AUDIT ONLY)\*\*\s*$/u;
export const COMPACT_SHIP_VERDICT =
  /^\s*Ship Verdict:\s*\*\*(YES|YES WITH CONDITIONS|PARTIAL|NO|PENDING REFUTER\/HUMAN|N\/A - AREA AUDIT ONLY)\*\*(?:\s+(?:-|—)\s+(?!.*\*\*(?:YES|YES WITH CONDITIONS|PARTIAL|NO|PENDING REFUTER\/HUMAN|N\/A - AREA AUDIT ONLY)\*\*)\S.*)?\s*$/u;
export const SHIP_VERDICT_LADDER = [
  "YES",
  "YES WITH CONDITIONS",
  "PARTIAL",
  "NO",
] as const;

/** One ledger record; every field is mandatory, single-line, and free of separator pipes. */
export const REFUTATION_LEDGER_RECORD =
  /^-\s+R-\d{3}\s+\|\s+Suspicion:\s+[^|]*[^\s|][^|]*\s+\|\s+Evidence:\s+[^|]*[^\s|][^|]*\s+\|\s+Rationale:\s+[^|]*[^\s|][^|]*$/u;

/** Exact in-memory separator between a report draft and its transient ledger. */
export const REVIEW_DRAFT_LEDGER_MARKER =
  "<!-- goat-flow-review-ledger-draft -->";

export const KNOWN_DEGRADATION_FLAGS = new Set([
  "none",
  "persist-skipped: redactor-unavailable",
  "chunked-partial",
  "gates-not-run",
  "gate-evidence-incomplete",
  "risk-depth-declined",
  "high-inference-ratio",
  "files-not-opened",
  "unfamiliar-area",
  "missing-types",
  "footguns-unread",
  "not-reproduced-findings",
  "coverage-degraded",
  "callsite-completeness-grep-only",
  "base-detection-failed",
  "base-fetch-skipped",
  "base-fetch-failed",
  "intent-unstated",
  "automated-review-uningested",
  "cross-model-refuter-failed",
  "cross-model-unresolved",
  "refuter-citation-unverified",
]);

/** Historical flags that described a workflow state the current skill forbids. */
export const RETIRED_DEGRADATION_FLAGS = new Set([
  "large-diff-unchunked",
  "large-area-unchunked",
]);

/**
 * Return every matching H2 section without consuming nested H3 headings.
 *
 * @param lines - the report split into lines; an empty report fails earlier than this
 * @param heading - exact H2 heading to locate; a heading that never appears yields no section
 * @returns every matching section in report order; empty means the heading never appears, which callers treat as "not provided" rather than an error
 */
export function readSections(
  lines: string[],
  heading: string,
): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(/^##\s+(.+?)(?:\s+<!--.*)?\s*$/u);
    // A reviewer who wrote `## Ship Verdict ##` sees "Ship Verdict" rendered, so the section is
    // matched on what they see; comparing the raw line would report their verdict as missing.
    const renderedHeading = match?.[1]?.trim().replace(/\s+#+$/u, "");
    // Not the section being looked for, so keep scanning the rest of the report.
    if (renderedHeading !== heading) continue;
    let endIndex = lines.length;
    for (let end = index + 1; end < lines.length; end += 1) {
      if (/^##\s+/u.test(lines[end] ?? "")) {
        endIndex = end;
        break;
      }
    }
    sections.push({
      headingLine: index + 1,
      lines: lines.slice(index + 1, endIndex).map((text, lineOffset) => ({
        line: index + lineOffset + 2,
        text,
      })),
    });
  }
  return sections;
}

/**
 * Return the first matching H2 section for contracts that permit one copy.
 *
 * @param lines - the report split into lines; an empty report fails earlier than this
 * @param heading - exact H2 heading to locate; a heading that never appears yields no section
 * @returns the first matching section, or null when the heading is absent so the caller can decide whether that is allowed
 */
export function readSection(
  lines: string[],
  heading: string,
): MarkdownSection | null {
  return readSections(lines, heading).at(0) ?? null;
}

/**
 * Record one violation while preserving report order for readable CLI output.
 *
 * @param violations - shared violation list, appended in report order so a reader sees issues top-down; a violation makes the report fail
 * @param code - stable issue code, which carries the check id a reader sees beside the message
 * @param line - report line the issue belongs to; null means the issue is about the report as a whole
 * @param message - user-facing explanation of what is wrong and what would satisfy the check
 */
export function addViolation(
  violations: ReviewValidationViolation[],
  code: ReviewIssueCode,
  line: number | null,
  message: string,
): void {
  violations.push({
    checkId: CHECK_IDENTIFIER_BY_CODE[code],
    code,
    line,
    message,
  });
}

/**
 * Record one advisory issue without changing the validator's failure status.
 *
 * @param warnings - shared advisory list; entries here inform the author without changing the pass/fail verdict
 * @param code - stable issue code, which carries the check id a reader sees beside the message
 * @param line - report line the issue belongs to; null means the issue is about the report as a whole
 * @param message - user-facing explanation of what is wrong and what would satisfy the check
 */
export function addWarning(
  warnings: ReviewValidationViolation[],
  code: ReviewIssueCode,
  line: number | null,
  message: string,
): void {
  warnings.push({
    checkId: CHECK_IDENTIFIER_BY_CODE[code],
    code,
    line,
    message,
  });
}

/** One parsed Review Integrity row: the value the author claimed and where they wrote it. */
export interface IntegrityField {
  value: string;
  line: number;
}

/** Review Integrity rows keyed by field name; an absent key means the author omitted that row. */
export type IntegrityFieldMap = Map<string, IntegrityField>;

/**
 * Select the stage-specific grammar for one validator receipt.
 *
 * @param label - integrity row label being checked
 * @param valuePattern - final-report grammar owned by the row registry
 * @param validationStage - pending draft or completed final report
 * @returns the value grammar that binds at the selected stage
 */
export function reviewIntegrityValuePattern(
  label: string,
  valuePattern: RegExp,
  validationStage: ReviewValidationStage,
): RegExp {
  return label === "Review validator" && validationStage === "draft"
    ? /^pending$/u
    : valuePattern;
}

/**
 * Explain one malformed integrity row in stage-aware terms.
 *
 * @param label - integrity row label being checked
 * @param field - parsed row, or undefined when the row is absent
 * @param validationStage - pending draft or completed final report
 * @returns a user-facing violation message
 */
export function reviewIntegrityFormatMessage(
  label: string,
  field: IntegrityField | undefined,
  validationStage: ReviewValidationStage,
): string {
  if (!field) return `Review Integrity is missing ${label}`;
  if (label === "Review validator" && validationStage === "draft") {
    return "Review validator must remain pending until final validation passes";
  }
  return `Review Integrity ${label} has an invalid value`;
}

/**
 * Return whether measured scope requires accepted chunks under the skill contract.
 *
 * @param fileCount - files declared by the review receipt
 * @param unitCount - changed-line or cluster count declared by the receipt
 * @param unitLabel - unit paired with unitCount
 * @returns true only when a binding file or changed-line threshold is exceeded
 */
export function reviewScopeExceedsChunkLimit(
  fileCount: number,
  unitCount: number,
  unitLabel: string,
): boolean {
  const changedLines = /^changed/iu.test(unitLabel) ? unitCount : 0;
  return (
    fileCount > REVIEW_CHUNK_FILE_LIMIT ||
    changedLines > REVIEW_CHUNK_CHANGED_LINE_LIMIT
  );
}

/**
 * Read the full receipt's scoped-file denominator after its own grammar check.
 *
 * @param fields - parsed full Review Integrity rows
 * @returns the safe denominator, or null when another grammar check owns the defect
 */
export function fullReviewCoverageFileCount(
  fields: IntegrityFieldMap,
): number | null {
  const denominator = fields
    .get("Files opened in Pass 2")
    ?.value.match(/^\d+\/(\d+)\b/u)?.[1];
  if (denominator === undefined) return null;
  const parsed = Number(denominator);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Match the stage-specific compact validator receipt.
 *
 * @param line - compact Review Integrity line
 * @param validationStage - pending draft or completed final report
 * @returns the stage-specific match, or null for malformed input
 */
export function matchCompactReviewIntegrity(
  line: string,
  validationStage: ReviewValidationStage,
): RegExpMatchArray | null {
  const pattern =
    validationStage === "draft" ? COMPACT_DRAFT_INTEGRITY : COMPACT_INTEGRITY;
  return line.match(pattern);
}
