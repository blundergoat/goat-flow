/**
 * The shared vocabulary every review-report check speaks.
 * A review report is validated by several independent passes - anchors, integrity fields,
 * refutation ledger, sections, ship verdict - and they all need the same things: the shape of
 * a violation, the stable check id a user sees beside it, and how to slice the report into
 * addressable sections and lines.
 *
 * Keeping that here means a finding raised by any pass carries the same identity and points at
 * the same line the author is looking at. The check-id registry is the load-bearing part: those
 * ids appear in user-facing output and in review contracts, so a code without one would surface
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
  drift: string;
  head: string;
  isAreaAudit: boolean;
  signals: string;
  source: string;
  uncommitted: string;
}

/** Stable V-number shown beside each issue so a user can look the check up. */
type ReviewCheckId = "V1" | "V2" | "V3" | "V4" | "V5" | "V6" | "V7" | "V8";

/**
 * V1-V8 are the public validator check IDs. Detail codes keep each result actionable.
 * Grammar anchors: SKILL.md (search: `Use prefix \`R-NNN [SEVERITY:ACTION]\``),
 * SKILL.md (search: `## Review Integrity (confidence signal)`), and
 * SKILL.md (search: `Render optional sections only with content`).
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
export const COMPACT_INTEGRITY =
  /^\s*Review Integrity:\s*(confident|coverage-degraded|high-inference|partial);\s*\d+\/\d+\s+files opened;\s*no degradation flags;\s*validator=(?:validated|validator-unavailable)\.?\s*$/u;
export const COMPACT_CLEAN_REVIEW_FIELDS = [
  {
    label: "Scope",
    prefix: /^\s*Scope:/u,
    value: /^\s*Scope:\s*\S.*$/u,
    requirement: "must not be empty",
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

/** One durable ledger record; every field is mandatory and single-line. */
export const REFUTATION_LEDGER_RECORD =
  /^-\s+R-\d{3}\s+\|\s+Suspicion:\s+[^|]*\S[^|]*\s+\|\s+Evidence:\s+[^|]*\S[^|]*\s+\|\s+Rationale:\s+\S.*$/u;

export const KNOWN_DEGRADATION_FLAGS = new Set([
  "none",
  "persist-skipped: redactor-unavailable",
  "chunked-partial",
  "large-diff-unchunked",
  "large-area-unchunked",
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
    if (match?.[1]?.trim() !== heading) continue;
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
