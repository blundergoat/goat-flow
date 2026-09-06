/**
 * Shared report fields and authority metadata used throughout review validation.
 * Use these types and JSON helpers when capturing a selection or checking a saved receipt.
 *
 * Stable issue codes connect every failed check to the report line the reviewer can repair.
 * Canonical serialization keeps the same selected bytes identifiable across capture, anchors, and recorded gate attempts.
 */
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";

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
  | {
      kind: "snapshot";
      snapshot: ReviewAuthoritySnapshot;
      readAnchor: (path: string, side?: "old" | "new") => Buffer;
    }
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
  base: string;
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
  "authority-format": "V5",
  "authority-object": "V5",
  "authority-path": "V5",
  "authority-unsupported": "V5",
  "authority-drift": "V5",
  "gate-origin": "V5",
  "gate-state": "V5",
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
export const SCOPE_SNAPSHOT =
  /^source=(worktree|staged|unstaged|PR(?:\s+#[^,\s]+)?|branch diff|range \.{2,3}|commit|area|explicit path list),\s*base=([^,]+),\s*head=([^,]+),\s*authority=([^,]+),\s*drift=([^,]+),\s*uncommitted=(yes|no|n\/a),\s*signals=(\d+),\s*bundle=([^,]+),\s*chunking=(\S.*)$/iu;
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
  ["Authority snapshot", /\S/u],
  ["Gate authority", /\S/u],
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
  // Only visible H2 headings can establish the report sections that later checks trust.
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(/^##\s+(.+?)(?:\s+<!--.*)?\s*$/u);
    // A reviewer who wrote `## Ship Verdict ##` sees "Ship Verdict" rendered, so the section is
    // matched on what they see; comparing the raw line would report their verdict as missing.
    const renderedHeading = match?.[1]?.trim().replace(/\s+#+$/u, "");
    // Not the section being looked for, so keep scanning the rest of the report.
    if (renderedHeading !== heading) continue;
    let endIndex = lines.length;
    // A section ends at the next H2; nested headings remain part of its evidence.
    for (let end = index + 1; end < lines.length; end += 1) {
      // The next report section must not lend fields or anchors to the current one.
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
 *
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
 *
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
 *
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
 *
 * @returns a user-facing violation message
 */
export function reviewIntegrityFormatMessage(
  label: string,
  field: IntegrityField | undefined,
  validationStage: ReviewValidationStage,
): string {
  // An omitted field needs an actionable missing-field message instead of a value-format error.
  if (!field) return `Review Integrity is missing ${label}`;
  // A draft is still awaiting final proof, so its validator receipt must explicitly remain pending.
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
 *
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
  // Malformed coverage is already reported by its grammar check and cannot supply a denominator.
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

/**
 * Values admitted by review requests and receipts; null is an explicit absence marker.
 */
export type JsonValue =
  null | boolean | number | string | JsonValue[] | JsonRecord;
/**
 * Named request or receipt fields; schema checks reject missing and unknown keys.
 */
export interface JsonRecord {
  [key: string]: JsonValue;
}
/**
 * Regular-file modes supported by byte authority; executable permission remains part of the selected state.
 */
export type FileMode = "100644" | "100755";
/**
 * One selected side; absent records a missing file, while file records identify its raw bytes and origin.
 */
export type FileState =
  | { kind: "absent" }
  | {
      kind: "file";
      from: "git" | "index" | "live";
      mode: FileMode;
      sha256: string;
      blob?: string;
      revision?: string;
    };
/**
 * One literal selected path; old is null when the request has no comparison side.
 */
export interface InventoryMember {
  path: string;
  old: FileState | null;
  new: FileState;
}
/**
 * A staged path and its semantic flags; timestamps are excluded so a Git refresh does not invalidate the review.
 */
export interface IndexEntry {
  path: string;
  mode: FileMode;
  blob: string;
  stage: number;
  intentToAdd: boolean;
  skipWorktree: boolean;
  assumeUnchanged: boolean;
}
/**
 * Transient local Git reads for one selected project; objectFormat is null outside Git and cached blobs never persist.
 */
export interface GitContext {
  root: string;
  objectFormat: "sha1" | "sha256" | null;
  blobs: Map<string, Buffer>;
  index?: IndexEntry[];
}
/**
 * Resolved source and its old/new files; null before means no comparison, and null index means no staged identity is needed.
 */
export interface SelectedFiles {
  source: JsonRecord;
  before: Map<string, FileState> | null;
  after: Map<string, FileState>;
  index: string | null;
}

/** Metadata retained by the reviewer; null workspace means no executable source state was captured. */
export interface ReviewAuthoritySnapshot {
  schema: "goat-review-authority/v1";
  objectFormat: "sha1" | "sha256" | null;
  source: JsonRecord;
  index: string | null;
  inventory: InventoryMember[];
  renames: { old: string; new: string }[];
  workspace: string | null;
  fingerprint: string;
}

/** Capture response separates immutable review identity from the operator's current checkout. */
export interface ReviewSnapshotEnvelope {
  authority: ReviewAuthoritySnapshot;
  checkout: { fingerprint: string | null; reason: string | null };
}

/**
 * An actionable capture refusal, retained as a V5 code when validating a report.
 *
 * An unresolved branch stops the review instead of selecting HEAD.
 * The CLI renders the same cause as a capture error without exposing file contents.
 */
export class ReviewAuthorityError extends Error {
  /**
   * Keep the stable failure code beside the explanation the reviewer can act on.
   *
   * @param code - issue category retained by report validation
   * @param message - refusal shown without exposing selected file contents
   */
  constructor(
    public readonly code: ReviewIssueCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Reject an ambiguous selection before it can supply evidence for a finding.
 *
 * @param condition - required source or receipt constraint; false means this authority cannot be used
 * @param message - repairable refusal shown to the reviewer
 * @param code - stable issue category; omitted uses authority-format
 *
 * @returns nothing; a true condition allows validation to continue
 * @throws ReviewAuthorityError when the selected source or receipt breaks the required constraint
 */
export function requireAuthority(
  condition: unknown,
  message: string,
  code: ReviewIssueCode = "authority-format",
): asserts condition {
  // A failed condition means the report cannot identify the files it claims to review.
  if (!condition) throw new ReviewAuthorityError(code, message);
}

/** Reject text whose UTF-16 spelling cannot round-trip through the UTF-8 wire format. */
function validText(value: string): string {
  requireAuthority(
    Buffer.from(value, "utf8").toString("utf8") === value,
    "authority text must round-trip as UTF-8",
  );
  return value;
}

/** Check the decimal spelling before floating-point rounding can change the caller's selected parent or recorded exit code. */
function isExactIntegerLiteral(literal: string): boolean {
  const [coefficient = "", exponent = "0"] = literal.toLowerCase().split("e");
  const fractionLength = coefficient.split(".")[1]?.length ?? 0;
  const digits = coefficient.replace(/[-.]/gu, "");
  const significantDigits = digits.replace(/0+$/u, "");
  // Every spelling of zero is exact, including exponents too large to represent as a number.
  if (significantDigits === "") return true;
  return (
    Number(exponent) -
      fractionLength +
      digits.length -
      significantDigits.length >=
    0
  );
}

/**
 * Read request JSON without allowing duplicate fields to hide an earlier selection.
 *
 * The cursor handles one JSON value at a time; ordinary request whitespace is allowed.
 * Frozen evidence additionally has to match the canonical serializer byte for byte.
 */
class ReviewJsonReader {
  private cursor = 0;
  /**
   * Retain the caller's transient JSON text while parsing its selection.
   *
   * @param text - one request or frozen receipt; empty text is refused when parsing starts
   */
  constructor(private readonly text: string) {}
  /** Advance to the next visible JSON token; whitespace carries no request meaning. */
  private skipSpace(): void {
    this.cursor += this.text
      .slice(this.cursor)
      .match(/^[\t\n\r ]*/u)![0].length;
  }
  /** Read a field name or literal string without accepting malformed escapes. */
  private readString(): string {
    const match = this.text
      .slice(this.cursor)
      .match(/^"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/u);
    requireAuthority(match, "authority JSON contains an invalid string");
    this.cursor += match[0].length;
    return validText(JSON.parse(match[0]) as string);
  }
  /** Read one object and reject repeated keys, including differently escaped spellings. */
  private readObject(depth: number): JsonRecord {
    const record: JsonRecord = Object.create(null) as JsonRecord;
    this.cursor++;
    this.skipSpace();
    // An empty object is syntactically valid; the selected schema checks required fields later.
    if (this.text[this.cursor] === "}") {
      this.cursor++;
      return record;
    }
    // Every object field must be read so a later duplicate cannot silently replace an earlier selection.
    while (true) {
      const key = this.readString();
      requireAuthority(
        !Object.hasOwn(record, key),
        `duplicate authority JSON key: ${key}`,
      );
      this.skipSpace();
      requireAuthority(
        this.text[this.cursor++] === ":",
        "authority JSON requires a colon after each key",
      );
      record[key] = this.readValue(depth + 1);
      this.skipSpace();
      const separator = this.text[this.cursor++];
      // The closing brace completes this selection; another member needs an explicit comma.
      if (separator === "}") return record;
      requireAuthority(
        separator === ",",
        "authority JSON requires a comma or closing brace",
      );
      this.skipSpace();
    }
  }
  /** Read a path or evidence list without discarding an empty or malformed member. */
  private readArray(depth: number): JsonValue[] {
    const values: JsonValue[] = [];
    this.cursor++;
    this.skipSpace();
    // Empty lists remain explicit, so later checks can distinguish no gates from missing evidence.
    if (this.text[this.cursor] === "]") {
      this.cursor++;
      return values;
    }
    // Every list member stays in the request; malformed separators cannot hide an omitted path or gate.
    while (true) {
      values.push(this.readValue(depth + 1));
      this.skipSpace();
      const separator = this.text[this.cursor++];
      // A closing bracket finishes this list; trailing commas are never accepted.
      if (separator === "]") return values;
      requireAuthority(
        separator === ",",
        "authority JSON requires a comma or closing bracket",
      );
    }
  }
  /** Parse one schema value with bounded nesting and exact integer values. */
  private readValue(depth: number): JsonValue {
    requireAuthority(depth <= 100, "authority JSON exceeds 100 nested values");
    this.skipSpace();
    const token = this.text[this.cursor];
    // Objects, lists, and strings preserve their original members for schema validation.
    if (token === "{") return this.readObject(depth);
    // A selected list retains member order and explicit empty membership for its schema check.
    if (token === "[") return this.readArray(depth);
    // A quoted filename or evidence literal must keep its exact spelling through parsing.
    if (token === '"') return this.readString();
    const literal = this.text
      .slice(this.cursor)
      .match(
        /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u,
      );
    requireAuthority(literal, "authority JSON contains an invalid value");
    this.cursor += literal[0].length;
    const value = JSON.parse(literal[0]) as null | boolean | number;
    requireAuthority(
      typeof value !== "number" ||
        (Number.isSafeInteger(value) && isExactIntegerLiteral(literal[0])),
      "authority JSON numbers must be safe integers",
    );
    return value;
  }
  /** Finish one request; appended JSON cannot override its earlier fields. */
  read(): JsonValue {
    const value = this.readValue(0);
    this.skipSpace();
    requireAuthority(
      this.cursor === this.text.length,
      "authority JSON has trailing content",
    );
    return value;
  }
}

/**
 * Serialize review metadata with stable key order and escapes that keep JSON visible in Markdown.
 *
 * @param value - request or receipt metadata; null remains explicit and arrays retain their recorded order
 * @returns canonical JSON used by snapshots, report fields, and fingerprint inputs
 * @throws ReviewAuthorityError when text cannot round-trip as UTF-8 or a value is outside the supported JSON grammar
 */
export function canonicalReviewJson(value: unknown): string {
  // Null is a deliberate absence marker, never a missing field silently dropped by JSON.stringify.
  if (value === null) return "null";
  // Markdown punctuation is escaped so a filename cannot hide or split its containing authority field.
  if (typeof value === "string")
    return JSON.stringify(validText(value)).replace(
      /[<>&`|]/gu,
      (character) =>
        `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
  // Boolean request choices retain their explicit true/false meaning in the receipt.
  if (typeof value === "boolean") return String(value);
  // Counts must remain exact so rounding cannot change the identity of an authority record.
  if (typeof value === "number") {
    requireAuthority(
      Number.isSafeInteger(value),
      "authority numbers must be safe integers",
    );
    return String(value);
  }
  // Ordered lists retain their captured membership instead of being treated as unordered JSON objects.
  if (Array.isArray(value))
    return `[${value.map(canonicalReviewJson).join(",")}]`;
  requireAuthority(
    typeof value === "object",
    "authority contains a value outside JSON",
  );
  return `{${Object.entries(value)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(
      ([key, member]) =>
        `${canonicalReviewJson(key)}:${canonicalReviewJson(member)}`,
    )
    .join(",")}}`;
}

/**
 * Parse requests or frozen evidence without allowing duplicate keys to change the selected source.
 *
 * @param text - supplied JSON; empty, malformed, or trailing content is refused
 * @param frozen - true requires the exact canonical spelling retained by the snapshot producer
 * @returns parsed metadata; null is a JSON value and is rejected later where a record is required
 *
 * @throws ReviewAuthorityError when JSON is ambiguous, unsupported, or noncanonical frozen evidence
 */
export function parseReviewJson(text: string, frozen = false): JsonValue {
  const value = new ReviewJsonReader(text).read();
  requireAuthority(
    !frozen || canonicalReviewJson(value) === text,
    "authority evidence must use canonical JSON from review snapshot",
  );
  return value;
}

/**
 * Require one named record before checking its authority fields.
 *
 * @param value - parsed schema value; null, absent values, and lists cannot stand in for a record
 * @param label - field name used to identify the invalid input in the CLI refusal
 * @returns the record for its source-specific checks
 *
 * @throws ReviewAuthorityError when the input is not a record
 */
export function record(
  value: JsonValue | undefined,
  label: string,
): JsonRecord {
  requireAuthority(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`,
  );
  return value;
}

/**
 * Reject omitted, misspelled, or additional fields instead of silently changing a request's meaning.
 *
 * @param value - parsed record whose shape must match the selected schema
 * @param required - fields that must be present, even when their value may be null
 * @param optional - permitted extra fields; empty means only required fields are accepted
 *
 * @throws ReviewAuthorityError when any required field is missing or an unknown field is present
 */
export function exactKeys(
  value: JsonRecord,
  required: string[],
  optional: string[] = [],
): void {
  requireAuthority(
    required.every((key) => Object.hasOwn(value, key)) &&
      Object.keys(value).every(
        (key) => required.includes(key) || optional.includes(key),
      ),
    `expected fields: ${required.join(", ")}${optional.length ? `; optional: ${optional.join(", ")}` : ""}`,
  );
}

/**
 * Require a nonempty literal before using a path, selector, or receipt label.
 *
 * @param value - parsed field; absent, empty, and non-text values stop authority validation
 * @param label - field name used in the reviewer's refusal message
 * @returns the unchanged UTF-8-compatible text
 *
 * @throws ReviewAuthorityError when the field cannot identify its intended source or receipt value
 */
export function textField(value: JsonValue | undefined, label: string): string {
  requireAuthority(
    typeof value === "string" && value.length > 0 && !value.includes("\0"),
    `${label} must be nonempty text without NUL`,
  );
  return value;
}

/**
 * Keep path inventories in byte order so locale settings cannot change a review fingerprint.
 *
 * @param left - first literal project path to compare
 * @param right - second literal project path to compare
 * @returns negative, zero, or positive for UTF-8 byte order
 */
export function comparePaths(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

/**
 * Require a literal path that stays within the selected project without normalization.
 *
 * @param value - project-relative path; absent, empty, absolute, or traversal spellings are refused
 * @param directory - allow the exact dot path when the operator selects the project root
 * @returns the unchanged safe path used to identify a selected file or area
 *
 * @throws ReviewAuthorityError when the path is unsafe or has an ambiguous spelling
 */
export function projectPath(
  value: JsonValue | undefined,
  directory = false,
): string {
  const path = textField(value, "path");
  // The operator may select the project root as a directory, but never as a file anchor.
  if (directory && path === ".") return path;
  requireAuthority(
    !isAbsolute(path) &&
      !/^[a-z]:/iu.test(path) &&
      !path.includes("\\") &&
      path
        .split("/")
        .every(
          (part) =>
            part !== "" &&
            part !== "." &&
            part !== ".." &&
            part.toLowerCase() !== ".git",
        ),
    `unsafe or ambiguous project path: ${canonicalReviewJson(path)}`,
    "authority-path",
  );
  return path;
}

/**
 * Read a unique, ordered selection without merging differently spelled paths.
 *
 * @param value - path array; empty is allowed here and source-specific checks decide whether it is meaningful
 * @param directories - allow dot as an explicit project-root selection
 * @returns the selected paths in UTF-8 byte order
 *
 * @throws ReviewAuthorityError when paths are duplicated, unsafe, or not supplied as an array
 */
export function pathList(
  value: JsonValue | undefined,
  directories = false,
): string[] {
  requireAuthority(Array.isArray(value), "path membership must be an array");
  const paths = value.map((path) => projectPath(path, directories));
  requireAuthority(
    new Set(paths).size === paths.length,
    "duplicate selected path",
    "authority-path",
  );
  return paths.sort(comparePaths);
}

/**
 * Identify the exact selected bytes without Git filters or text normalization.
 *
 * @param bytes - file bytes or protocol text; empty content still has a real hash
 * @returns lowercase raw SHA-256 used in file and provenance records
 */
export function rawHash(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Separate authority, index, workspace, and gate identities so one kind cannot substitute for another.
 *
 * @param kind - protocol domain that fixes the hash prefix and identity label
 * @param value - metadata serialized canonically before hashing
 * @returns the versioned domain fingerprint retained in the review receipt
 */
export function taggedHash(
  kind: "index" | "authority" | "workspace" | "gate",
  value: unknown,
): string {
  const label = kind === "authority" ? "review" : kind;
  return `${label}-v1:sha256:${rawHash(`goat-review-${kind}/v1\0${canonicalReviewJson(value)}`)}`;
}

/**
 * Identify one selected command from its arguments, working directory, and trusted origin.
 *
 * @param argv - exact executable and arguments; gate validation rejects an empty command
 * @param cwd - literal project-relative execution directory, including dot for the root
 * @param origin - recorded trusted Git source or host instruction reference
 *
 * @returns the stable gate-v1 fingerprint used to detect duplicate or substituted commands
 */
export function reviewGateId(
  argv: string[],
  cwd: string,
  origin: unknown,
): string {
  return taggedHash("gate", { argv, cwd, origin });
}
