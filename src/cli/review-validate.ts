/**
 * Deterministic validation for drafted goat-review Markdown.
 * The validator reads only the supplied report, semantic-anchor files under the
 * reviewed project, and claimed local refutation ledgers; it never persists reports.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { CLIError } from "./cli-error.js";
import type { ParsedCLI } from "./cli-types.js";
import { writeOutput } from "./cli-output.js";
import { maskNonRenderedMarkdown } from "./rendered-markdown.js";

/** One actionable validation issue, optionally tied to a report line. */
interface ReviewValidationViolation {
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
interface LocatedLine {
  line: number;
  text: string;
}

/** H2 section body and the heading location used for missing-field errors. */
interface MarkdownSection {
  headingLine: number;
  lines: LocatedLine[];
}

/** Refutation claim extracted while validating the integrity surface. */
interface IntegrityResult {
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
interface FindingDefinition {
  action: FindingAction;
  evidence: "INFERRED" | "OBSERVED" | null;
  id: string;
  line: number;
  section: (typeof FINDING_SECTIONS)[number];
  severity: FindingSeverity;
}

type FindingAction =
  | "patch"
  | "needs-decision"
  | "intent-mismatch"
  | "needs-signal"
  | "pre-existing";

type FindingSeverity = "MUST" | "SHOULD" | "MAY";

type ReviewIntegrityConclusion =
  "confident" | "coverage-degraded" | "high-inference" | "partial";

type ShipVerdictDecision =
  | "YES"
  | "YES WITH CONDITIONS"
  | "PARTIAL"
  | "NO"
  | "PENDING REFUTER/HUMAN"
  | "N/A - AREA AUDIT ONLY";

/** Parsed user-facing decision and the report line that declared it. */
interface ShipVerdictClaim {
  decision: ShipVerdictDecision;
  line: number;
}

/** Source whose bytes semantic anchors must be resolved against. */
type ReviewAnchorAuthority =
  | { kind: "git-object"; oid: string }
  | { kind: "worktree" }
  | { kind: "invalid" };

/** Parsed Evidence totals and their report location. */
interface EvidenceCountClaim {
  inferred: number;
  line: number;
  observed: number;
}

/** Parsed four-way Pass 2 disposition totals and their report location. */
interface VerdictCountClaim {
  adjusted: number;
  confirmed: number;
  line: number;
  refuted: number;
  unresolved: number;
}

/** Canonical authority-bearing fields extracted from Scope snapshot. */
interface ParsedScopeSnapshot {
  authority: string;
  bundle: string;
  drift: string;
  head: string;
  isAreaAudit: boolean;
  signals: string;
  source: string;
  uncommitted: string;
}

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

type ReviewIssueCode = keyof typeof CHECK_IDENTIFIER_BY_CODE;

const FINDING_SECTIONS = [
  "Findings",
  "Systemic Patterns",
  "Refuted by Refuter",
] as const;

const SURFACED_FINDING_SECTIONS = new Set<string>([
  "Findings",
  "Systemic Patterns",
]);

const OPTIONAL_SECTIONS = [
  "Systemic Patterns",
  "Spec Drift",
  "Pre-existing Nearby",
  "Pre-existing Issues",
  "Breaking Changes",
  "Refuted by Refuter",
  "What's Good",
] as const;

const TOP_FIVE_HEADINGS = ["Top 5 Risks", "Top 5 Risks (cross-tier)"] as const;

const FINDING_CANDIDATE = /^\s*-\s+\S/u;
const FINDING_PREFIX =
  /^\s*-\s+(R-\d{3})\s+\[(MUST|SHOULD|MAY):(patch|needs-decision|intent-mismatch|needs-signal|pre-existing)\](?:\s+\[(?:(?:overlap-confirmed|bot-only-locally-verified|disputed-match):[^\]\s]+|local-only|CONFIRMED-CROSS-MODEL)\])*\s+\*\*[^*\n]+\*\*/u;
const EVIDENCE_TAG =
  /(?:^|\|\s*)Evidence:\s*(OBSERVED|INFERRED)(?=\s*(?:\||$))/u;
const PROOF_TAG =
  /(?:^|\|\s*)Proof:\s*(?:RUNTIME|CONTRACT-GREP|STATIC|NOT-REPRODUCED)(?=\s*(?:\||$))/u;
const HARM_TAG = /(?:^|\|\s*)Harm:\s*[^|\s][^|]*(?=\s*(?:\||$))/u;
const ANCHOR =
  /`([^`\r\n]+)`\s+\(search:\s*(?:`([^`\r\n]+)`|"([^"\r\n]+)")\)/gu;
const SPEC_DRIFT_LINE =
  /^\s*-\s+\[(?:advisory|ready-to-tick)\]\s+\*\*[^*\n]+\*\*\s+-\s+\S/u;
const REFUTATION_LEDGER_PATH =
  /^\.goat-flow\/logs\/review\/goat-review-refutations\.[^\/\s]+\.txt$/u;
const REVIEW_BUNDLE_PATH =
  /^\.goat-flow\/logs\/review\/goat-review-bundle\.[^\/\s]+\.diff$/u;
const IMMUTABLE_OBJECT_IDENTIFIER = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu;
const SCOPE_SNAPSHOT =
  /^source=(worktree|staged|unstaged|PR(?:\s+#[^,\s]+)?|branch diff|area|explicit path list),\s*base=([^,]+),\s*head=([^,]+),\s*authority=([^,]+),\s*drift=([^,]+),\s*uncommitted=(yes|no|n\/a),\s*signals=(\d+),\s*bundle=([^,]+),\s*chunking=(\S.*)$/iu;

const REQUIRED_INTEGRITY_FIELDS: ReadonlyArray<
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

const AUTOMATED_REVIEW_VALUE =
  /^(?:n\/a|no-automated-review-present|overlap-confirmed=\d+,\s*local-only=\d+,\s*bot-only-locally-verified=\d+,\s*disputed-match=\d+;\s*.+)$/u;
const REFUTER_VALUE =
  /^(?:yes|no|skipped);\s*confirmed=\d+,\s*refuted=\d+,\s*unresolved=\d+,\s*leads-verified=\d+,\s*model=\S.+$/u;
const COMPACT_INTEGRITY =
  /^\s*Review Integrity:\s*(confident|coverage-degraded|high-inference|partial);\s*\d+\/\d+\s+files opened;\s*\S.+;\s*validator=(?:validated|validator-unavailable)\.?\s*$/u;

const FULL_SHIP_VERDICT =
  /^\s*Decision:\s*\*\*(YES|YES WITH CONDITIONS|PARTIAL|NO|PENDING REFUTER\/HUMAN|N\/A - AREA AUDIT ONLY)\*\*\s*$/u;
const COMPACT_SHIP_VERDICT =
  /^\s*Ship Verdict:\s*\*\*(YES|YES WITH CONDITIONS|PARTIAL|NO|PENDING REFUTER\/HUMAN|N\/A - AREA AUDIT ONLY)\*\*/u;
const SHIP_VERDICT_LADDER = [
  "YES",
  "YES WITH CONDITIONS",
  "PARTIAL",
  "NO",
] as const;

/** One durable ledger record; every field is mandatory and single-line. */
const REFUTATION_LEDGER_RECORD =
  /^-\s+R-\d{3}\s+\|\s+Suspicion:\s+[^|]*\S[^|]*\s+\|\s+Evidence:\s+[^|]*\S[^|]*\s+\|\s+Rationale:\s+\S.*$/u;

const KNOWN_DEGRADATION_FLAGS = new Set([
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

/** Return every matching H2 section without consuming nested H3 headings. */
function readSections(lines: string[], heading: string): MarkdownSection[] {
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

/** Return the first matching H2 section for contracts that permit one copy. */
function readSection(lines: string[], heading: string): MarkdownSection | null {
  return readSections(lines, heading).at(0) ?? null;
}

/** Record one violation while preserving report order for readable CLI output. */
function addViolation(
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

/** Record one advisory issue without changing the validator's failure status. */
function addWarning(
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

/** Return whether a resolved path remains under the reviewed project's real path. */
function isWithinProject(projectRoot: string, candidatePath: string): boolean {
  const pathFromRoot = relative(projectRoot, candidatePath);
  return (
    pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot)
  );
}

/** Resolve an anchor from one immutable Git commit or tree. */
function validateGitObjectAnchor(
  projectRoot: string,
  candidatePath: string,
  authority: Extract<ReviewAnchorAuthority, { kind: "git-object" }>,
  filePath: string,
  searchText: string,
  line: number,
  violations: ReviewValidationViolation[],
): void {
  const repositoryPath = relative(projectRoot, candidatePath)
    .split(sep)
    .join("/");
  try {
    const content = execFileSync(
      "git",
      ["-C", projectRoot, "show", `${authority.oid}:${repositoryPath}`],
      {
        encoding: "utf-8",
        maxBuffer: 16 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    if (!content.includes(searchText)) {
      addViolation(
        violations,
        "anchor-unresolved",
        line,
        `search text not found in ${filePath} at declared head ${authority.oid}: ${searchText}`,
      );
    }
  } catch {
    addViolation(
      violations,
      "anchor-unresolved",
      line,
      `cannot read anchor ${filePath} from declared head ${authority.oid}`,
    );
  }
}

/** Resolve an anchor from the declared live worktree without following escapes. */
function validateWorktreeAnchor(
  projectRoot: string,
  candidatePath: string,
  filePath: string,
  searchText: string,
  line: number,
  violations: ReviewValidationViolation[],
): void {
  if (!existsSync(candidatePath)) {
    addViolation(
      violations,
      "anchor-unresolved",
      line,
      `anchor file does not exist: ${filePath}`,
    );
    return;
  }

  try {
    const realProjectRoot = realpathSync(projectRoot);
    const realCandidatePath = realpathSync(candidatePath);
    if (
      !isWithinProject(realProjectRoot, realCandidatePath) ||
      !statSync(realCandidatePath).isFile()
    ) {
      addViolation(
        violations,
        "anchor-outside-project",
        line,
        `anchor is not a project file: ${filePath}`,
      );
      return;
    }
    if (!readFileSync(realCandidatePath, "utf-8").includes(searchText)) {
      addViolation(
        violations,
        "anchor-unresolved",
        line,
        `search text not found in ${filePath}: ${searchText}`,
      );
    }
  } catch (error) {
    addViolation(
      violations,
      "anchor-unresolved",
      line,
      `cannot read anchor ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Resolve one literal semantic anchor without reading outside the reviewed project. */
function validateAnchor(
  projectRoot: string,
  authority: ReviewAnchorAuthority,
  filePath: string,
  searchText: string,
  line: number,
  violations: ReviewValidationViolation[],
): void {
  const lexicalProjectRoot = resolve(projectRoot);
  const candidatePath = resolve(lexicalProjectRoot, filePath);
  if (!isWithinProject(lexicalProjectRoot, candidatePath)) {
    addViolation(
      violations,
      "anchor-outside-project",
      line,
      `anchor path escapes the reviewed project: ${filePath}`,
    );
    return;
  }

  // The scope violation already explains why no byte authority is available.
  if (authority.kind === "invalid") return;

  if (authority.kind === "git-object") {
    validateGitObjectAnchor(
      lexicalProjectRoot,
      candidatePath,
      authority,
      filePath,
      searchText,
      line,
      violations,
    );
    return;
  }
  validateWorktreeAnchor(
    lexicalProjectRoot,
    candidatePath,
    filePath,
    searchText,
    line,
    violations,
  );
}

/** Validate Evidence, Proof, and severity-dependent Harm fields. */
function validateFindingFields(
  text: string,
  severity: string,
  line: number,
  violations: ReviewValidationViolation[],
): void {
  if (!EVIDENCE_TAG.test(text)) {
    addViolation(
      violations,
      "finding-evidence",
      line,
      "finding is missing Evidence: OBSERVED or Evidence: INFERRED",
    );
  }
  if (!PROOF_TAG.test(text)) {
    addViolation(
      violations,
      "finding-proof",
      line,
      "finding is missing a supported Proof: class",
    );
  }
  const needsHarm = severity === "MUST" || severity === "SHOULD";
  if (needsHarm && !HARM_TAG.test(text)) {
    addViolation(
      violations,
      "finding-harm",
      line,
      "MUST and SHOULD findings require a non-empty Harm: segment",
    );
  }
}

/** Validate every literal semantic anchor carried by one finding. */
function validateFindingAnchors(
  locatedLine: LocatedLine,
  projectRoot: string,
  authority: ReviewAnchorAuthority,
  violations: ReviewValidationViolation[],
): void {
  const anchors = [...locatedLine.text.matchAll(ANCHOR)];
  if (anchors.length === 0) {
    addViolation(
      violations,
      "anchor-format",
      locatedLine.line,
      "finding requires at least one `path` (search: `literal`) anchor",
    );
    return;
  }
  for (const anchor of anchors) {
    const filePath = anchor[1];
    const searchText = anchor[2] ?? anchor[3];
    if (filePath === undefined || searchText === undefined) continue;
    validateAnchor(
      projectRoot,
      authority,
      filePath,
      searchText,
      locatedLine.line,
      violations,
    );
  }
}

/** Read the bounded evidence tag already checked by finding-field validation. */
function readFindingEvidence(text: string): FindingDefinition["evidence"] {
  const evidence = text.match(EVIDENCE_TAG)?.[1];
  if (evidence === "OBSERVED") return evidence;
  if (evidence === "INFERRED") return evidence;
  return null;
}

/** Validate one finding definition after its containing section identifies it as review output. */
function validateFindingLine(
  locatedLine: LocatedLine,
  section: (typeof FINDING_SECTIONS)[number],
  isAreaAudit: boolean,
  projectRoot: string,
  authority: ReviewAnchorAuthority,
  violations: ReviewValidationViolation[],
): FindingDefinition | null {
  if (!FINDING_CANDIDATE.test(locatedLine.text)) return null;
  const prefixMatch = locatedLine.text.match(FINDING_PREFIX);
  if (!prefixMatch) {
    addViolation(
      violations,
      "finding-grammar",
      locatedLine.line,
      "finding must use R-NNN, a supported severity/action, optional current provenance/refuter tags, and a bold title",
    );
    return null;
  }

  if (prefixMatch[3] === "pre-existing" && !isAreaAudit) {
    addViolation(
      violations,
      "finding-action-scope",
      locatedLine.line,
      "the pre-existing action is permitted only when Scope snapshot declares source=area",
    );
  }

  validateFindingFields(
    locatedLine.text,
    prefixMatch[2] ?? "",
    locatedLine.line,
    violations,
  );
  validateFindingAnchors(locatedLine, projectRoot, authority, violations);
  return {
    action: (prefixMatch[3] ?? "patch") as FindingAction,
    evidence: readFindingEvidence(locatedLine.text),
    id: prefixMatch[1] ?? "",
    line: locatedLine.line,
    section,
    severity: (prefixMatch[2] ?? "MAY") as FindingSeverity,
  };
}

/** One authoritative Review Integrity value and its report location. */
interface IntegrityField {
  value: string;
  line: number;
}

type IntegrityFieldMap = Map<string, IntegrityField>;

/** Extract colon-delimited integrity fields and fail repeated authority claims. */
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

/** Validate either the full integrity block or M04's compact clean-review line. */
function validateIntegrity(
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

  const compactIndex = lines.findIndex((line) =>
    /^\s*Review Integrity:/u.test(line),
  );
  const compactIntegrityMatch = (lines[compactIndex] ?? "").match(
    COMPACT_INTEGRITY,
  );
  // Zero-finding reviews may use the shorter user-facing integrity line.
  if (compactIndex >= 0 && compactIntegrityMatch) {
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

/** Validate the ledger marker used when no refutations were logged. */
function validateEmptyRefutationLedger(
  integrity: IntegrityResult,
  claimLine: number | null,
  violations: ReviewValidationViolation[],
): void {
  const ledgerClaim = integrity.refutationLedger;
  // Compact zero-finding reviews intentionally have no ledger fields.
  if (ledgerClaim === null && integrity.refutationsLine === null) return;
  if (ledgerClaim === "n/a") return;
  addViolation(
    violations,
    "refutation-ledger",
    claimLine,
    "zero refutations require Refutation ledger: n/a",
  );
}

/** Validate the ledger marker used when durable redaction was unavailable. */
function validateSkippedRefutationLedger(
  ledgerClaim: string | null,
  claimLine: number | null,
  violations: ReviewValidationViolation[],
): void {
  if (ledgerClaim === "persist-skipped") return;
  addViolation(
    violations,
    "refutation-ledger",
    claimLine,
    "persist-skipped refutations require Refutation ledger: persist-skipped",
  );
}

/** Read one exact, non-symlink ledger that resolves inside the reviewed project. */
function readDeclaredLedgerLines(
  projectRoot: string,
  ledgerClaim: string,
): string[] {
  const lexicalProjectRoot = resolve(projectRoot);
  const candidatePath = resolve(lexicalProjectRoot, ledgerClaim);
  if (!isWithinProject(lexicalProjectRoot, candidatePath)) {
    throw new Error("declared ledger is outside the project");
  }
  if (!existsSync(candidatePath)) {
    throw new Error("declared ledger is absent");
  }
  if (lstatSync(candidatePath).isSymbolicLink()) {
    throw new Error("declared ledger is a symlink");
  }

  const realProjectRoot = realpathSync(lexicalProjectRoot);
  const realLedgerPath = realpathSync(candidatePath);
  if (!isWithinProject(realProjectRoot, realLedgerPath)) {
    throw new Error("declared ledger resolves outside the project");
  }
  if (!statSync(realLedgerPath).isFile()) {
    throw new Error("declared ledger is not a regular project file");
  }
  return readFileSync(realLedgerPath, "utf-8")
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0);
}

/** Fail the first non-canonical durable ledger record. */
function validateLedgerRecordGrammar(
  lines: string[],
  claimLine: number | null,
  violations: ReviewValidationViolation[],
): boolean {
  const invalidLine = lines.findIndex(
    (line) => !REFUTATION_LEDGER_RECORD.test(line),
  );
  if (invalidLine < 0) return true;
  addViolation(
    violations,
    "refutation-ledger",
    claimLine,
    `declared ledger record ${invalidLine + 1} does not match the required one-line grammar`,
  );
  return false;
}

/** Validate the path, grammar, and exact record count of a persisted ledger. */
function validatePersistedRefutationLedger(
  projectRoot: string,
  integrity: IntegrityResult,
  claimLine: number | null,
  violations: ReviewValidationViolation[],
): void {
  const ledgerClaim = integrity.refutationLedger;
  if (!ledgerClaim || !REFUTATION_LEDGER_PATH.test(ledgerClaim)) {
    addViolation(
      violations,
      "refutation-ledger",
      claimLine,
      "persisted refutations require one declared goat-review-refutations.<random>.txt ledger path",
    );
    return;
  }

  try {
    const ledgerLines = readDeclaredLedgerLines(projectRoot, ledgerClaim);
    if (!validateLedgerRecordGrammar(ledgerLines, claimLine, violations))
      return;
    if (ledgerLines.length !== integrity.refutationsLogged) {
      addViolation(
        violations,
        "refutation-ledger",
        claimLine,
        `declared ledger has ${ledgerLines.length} records but Refutations logged claims ${integrity.refutationsLogged}`,
      );
    }
  } catch (error) {
    addViolation(
      violations,
      "refutation-ledger",
      claimLine,
      `cannot verify declared refutation ledger: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Check that one declared ledger contains exactly the claimed canonical records. */
function validateRefutationLedger(
  projectRoot: string,
  integrity: IntegrityResult,
  violations: ReviewValidationViolation[],
): void {
  const claimLine = integrity.refutationLedgerLine ?? integrity.refutationsLine;
  if (integrity.refutationsLogged === 0) {
    validateEmptyRefutationLedger(integrity, claimLine, violations);
    return;
  }
  if (integrity.isRefutationPersistenceSkipped) {
    validateSkippedRefutationLedger(
      integrity.refutationLedger,
      claimLine,
      violations,
    );
    return;
  }
  validatePersistedRefutationLedger(
    projectRoot,
    integrity,
    claimLine,
    violations,
  );
}

/** Validate finding definitions in every output section that owns R-IDs. */
function validateFindingSections(
  lines: string[],
  isAreaAudit: boolean,
  projectRoot: string,
  authority: ReviewAnchorAuthority,
  violations: ReviewValidationViolation[],
): FindingDefinition[] {
  const definitions: FindingDefinition[] = [];
  for (const heading of FINDING_SECTIONS) {
    const sections = readSections(lines, heading);
    const section = sections.at(0);
    for (const duplicate of sections.slice(1)) {
      addViolation(
        violations,
        "finding-section-duplicate",
        duplicate.headingLine,
        `${heading} duplicates the section at line ${section?.headingLine ?? "unknown"}`,
      );
    }
    const locatedLines = section?.lines ?? [];
    for (const locatedLine of locatedLines) {
      const definition = validateFindingLine(
        locatedLine,
        heading,
        isAreaAudit,
        projectRoot,
        authority,
        violations,
      );
      if (definition) definitions.push(definition);
    }
  }
  return definitions;
}

/** Count live finding-like bullets before selecting full or compact integrity. */
function countFindingCandidates(lines: string[]): number {
  return FINDING_SECTIONS.flatMap((heading) => readSections(lines, heading))
    .flatMap((section) => section.lines)
    .filter((locatedLine) => FINDING_CANDIDATE.test(locatedLine.text)).length;
}

/** Fail every repeated finding definition at its later source line. */
function validateUniqueFindingIds(
  definitions: FindingDefinition[],
  violations: ReviewValidationViolation[],
): void {
  const firstLines = new Map<string, number>();
  for (const definition of definitions) {
    const firstLine = firstLines.get(definition.id);
    if (firstLine === undefined) {
      firstLines.set(definition.id, definition.line);
      continue;
    }
    addViolation(
      violations,
      "finding-id-duplicate",
      definition.line,
      `${definition.id} duplicates its definition at line ${firstLine}`,
    );
  }
}

/** Reconcile integrity totals with visible findings and the refutation ledger claim. */
function validateIntegrityCounts(
  integrity: IntegrityResult,
  definitions: FindingDefinition[],
  violations: ReviewValidationViolation[],
): void {
  if (integrity.evidenceCounts) {
    const observed = definitions.filter(
      (definition) => definition.evidence === "OBSERVED",
    ).length;
    const inferred = definitions.filter(
      (definition) => definition.evidence === "INFERRED",
    ).length;
    if (
      observed !== integrity.evidenceCounts.observed ||
      inferred !== integrity.evidenceCounts.inferred
    ) {
      addViolation(
        violations,
        "integrity-format",
        integrity.evidenceCounts.line,
        `Evidence claims ${integrity.evidenceCounts.observed} OBSERVED / ${integrity.evidenceCounts.inferred} INFERRED but visible findings contain ${observed} OBSERVED / ${inferred} INFERRED`,
      );
    }
  }

  if (!integrity.verdictCounts) return;
  const visibleVerdicts =
    integrity.verdictCounts.confirmed +
    integrity.verdictCounts.adjusted +
    integrity.verdictCounts.unresolved;
  if (
    !Number.isSafeInteger(visibleVerdicts) ||
    visibleVerdicts !== definitions.length
  ) {
    addViolation(
      violations,
      "integrity-format",
      integrity.verdictCounts.line,
      `Verdicts claim ${visibleVerdicts} confirmed, adjusted, or unresolved results but ${definitions.length} visible findings are defined`,
    );
  }
  if (integrity.verdictCounts.refuted !== integrity.refutationsLogged) {
    addViolation(
      violations,
      "integrity-format",
      integrity.verdictCounts.line,
      `Verdicts claim ${integrity.verdictCounts.refuted} refuted results but Refutations logged claims ${integrity.refutationsLogged}`,
    );
  }
}

/** Read either documented Top 5 heading and reject multiple risk summaries. */
function readTopFiveSection(
  lines: string[],
  violations: ReviewValidationViolation[],
): MarkdownSection | null {
  const topFiveSections = TOP_FIVE_HEADINGS.flatMap((heading) =>
    readSections(lines, heading),
  ).sort((left, right) => left.headingLine - right.headingLine);
  const firstTopFiveSection = topFiveSections.at(0);
  // With no risk summary, the finding count later decides whether to warn the user.
  if (!firstTopFiveSection) return null;
  // Multiple aliases would present competing risk rankings in one review.
  for (const duplicateSection of topFiveSections.slice(1)) {
    addViolation(
      violations,
      "finding-section-duplicate",
      duplicateSection.headingLine,
      `Top 5 Risks duplicates the section at line ${firstTopFiveSection.headingLine}`,
    );
  }
  return firstTopFiveSection;
}

/** Resolve every literal semantic anchor cited in one reference-only section. */
function validateSectionAnchors(
  section: MarkdownSection | null,
  projectRoot: string,
  authority: ReviewAnchorAuthority,
  violations: ReviewValidationViolation[],
): void {
  for (const locatedLine of section?.lines ?? []) {
    for (const anchor of locatedLine.text.matchAll(ANCHOR)) {
      const filePath = anchor[1];
      const searchText = anchor[2] ?? anchor[3];
      if (filePath === undefined || searchText === undefined) continue;
      validateAnchor(
        projectRoot,
        authority,
        filePath,
        searchText,
        locatedLine.line,
        violations,
      );
    }
  }
}

/** Fail Top 5 references that do not name one surfaced finding definition. */
function validateTopFiveReferences(
  section: MarkdownSection | null,
  definitions: FindingDefinition[],
  violations: ReviewValidationViolation[],
): void {
  const surfacedIds = new Set(
    definitions
      .filter((definition) => SURFACED_FINDING_SECTIONS.has(definition.section))
      .map((definition) => definition.id),
  );
  for (const locatedLine of section?.lines ?? []) {
    for (const match of locatedLine.text.matchAll(/\bR-\d{3}\b/gu)) {
      const findingId = match[0];
      if (surfacedIds.has(findingId)) continue;
      addViolation(
        violations,
        "finding-reference-unresolved",
        locatedLine.line,
        `Top 5 Risks references undefined surfaced finding ${findingId}`,
      );
    }
  }
}

/** Fail secondary R-ID references in refuter output when no definition exists. */
function validateRefuterReferences(
  lines: string[],
  definitions: FindingDefinition[],
  violations: ReviewValidationViolation[],
): void {
  const section = readSection(lines, "Refuted by Refuter");
  const definitionIds = new Set(definitions.map((definition) => definition.id));
  for (const locatedLine of section?.lines ?? []) {
    const ownId = locatedLine.text.match(FINDING_PREFIX)?.[1];
    for (const match of locatedLine.text.matchAll(/\bR-\d{3}\b/gu)) {
      const findingId = match[0];
      if (findingId === ownId || definitionIds.has(findingId)) continue;
      addViolation(
        violations,
        "finding-reference-unresolved",
        locatedLine.line,
        `Refuted by Refuter references undefined finding ${findingId}`,
      );
    }
  }
}

/** Return whether an optional section contains prose beyond headings/comments. */
function hasSectionContent(section: MarkdownSection): boolean {
  return section.lines.some(({ text }) => {
    const trimmed = text.trim();
    return (
      trimmed.length > 0 &&
      !/^###\s+/u.test(trimmed) &&
      !/^<!--.*-->$/u.test(trimmed)
    );
  });
}

/** Warn for optional sections that carry no report content. */
function warnEmptyOptionalSections(
  lines: string[],
  warnings: ReviewValidationViolation[],
): void {
  for (const heading of OPTIONAL_SECTIONS) {
    const section = readSection(lines, heading);
    if (!section || hasSectionContent(section)) continue;
    addWarning(
      warnings,
      "optional-section-empty",
      section.headingLine,
      `${heading} is optional and must be omitted when empty`,
    );
  }
}

/** Warn when Top 5 presence contradicts the surfaced-finding threshold. */
function warnTopFiveShape(
  topFive: MarkdownSection | null,
  findingsHeadingLine: number | null,
  surfacedCount: number,
  warnings: ReviewValidationViolation[],
): void {
  // An empty risk section adds a heading in the UI without any ranked guidance.
  if (topFive && !hasSectionContent(topFive)) {
    addWarning(
      warnings,
      "optional-section-empty",
      topFive.headingLine,
      "Top 5 Risks is present but empty",
    );
  }
  // Five or fewer surfaced findings already fit in the primary user-facing list.
  if (topFive && surfacedCount <= 5) {
    addWarning(
      warnings,
      "top-five-unexpected",
      topFive.headingLine,
      `Top 5 Risks is present with only ${surfacedCount} surfaced findings`,
    );
  }
  // Above five findings, the review contract promises users a ranked summary.
  if (!topFive && surfacedCount > 5) {
    addWarning(
      warnings,
      "top-five-missing",
      findingsHeadingLine,
      `Top 5 Risks is missing for ${surfacedCount} surfaced findings`,
    );
  }
}

/** Warn when optional sections or the Top 5 threshold contradict the skill. */
function validateConditionalSections(
  lines: string[],
  topFive: MarkdownSection | null,
  definitions: FindingDefinition[],
  warnings: ReviewValidationViolation[],
): void {
  warnEmptyOptionalSections(lines, warnings);
  const surfacedCount = definitions.filter((definition) =>
    SURFACED_FINDING_SECTIONS.has(definition.section),
  ).length;
  const findingsHeadingLine =
    readSection(lines, "Findings")?.headingLine ?? null;
  warnTopFiveShape(topFive, findingsHeadingLine, surfacedCount, warnings);
}

/** Validate advisory-only Spec Drift bullets separately from findings. */
function validateSpecDrift(
  lines: string[],
  violations: ReviewValidationViolation[],
): void {
  const section = readSection(lines, "Spec Drift");
  for (const locatedLine of section?.lines ?? []) {
    const isTaggedBullet = /^\s*-\s+\[/u.test(locatedLine.text);
    if (!isTaggedBullet || SPEC_DRIFT_LINE.test(locatedLine.text)) continue;
    addViolation(
      violations,
      "spec-drift-grammar",
      locatedLine.line,
      "Spec Drift bullets must use [advisory] or [ready-to-tick] with a bold title",
    );
  }
}

/** Parse one bold Ship Verdict decision from its full or compact user-facing line. */
function parseShipVerdictDecision(
  line: string,
  pattern: RegExp,
): ShipVerdictDecision | null {
  return (line.match(pattern)?.[1] as ShipVerdictDecision | undefined) ?? null;
}

/** Read one dedicated Ship Verdict section after the caller has selected it as authority. */
function readFullShipVerdictClaim(
  fullVerdictSection: MarkdownSection,
  duplicateSections: MarkdownSection[],
  violations: ReviewValidationViolation[],
): ShipVerdictClaim | null {
  // More than one decision section leaves users without one authoritative outcome.
  for (const duplicateSection of duplicateSections) {
    addViolation(
      violations,
      "ship-verdict-format",
      duplicateSection.headingLine,
      `Ship Verdict duplicates the section at line ${fullVerdictSection.headingLine}`,
    );
  }
  const decisionLines = fullVerdictSection.lines.filter(({ text }) =>
    /^\s*Decision:/u.test(text),
  );
  const decisionLine = decisionLines.at(0);
  // The UI needs exactly one decision line to summarize the review safely.
  if (decisionLines.length !== 1 || !decisionLine) {
    addViolation(
      violations,
      "ship-verdict-format",
      fullVerdictSection.headingLine,
      "Ship Verdict must contain exactly one bold Decision line",
    );
    return null;
  }
  const decision = parseShipVerdictDecision(
    decisionLine.text,
    FULL_SHIP_VERDICT,
  );
  // Plain or unknown decision text does not satisfy the published report grammar.
  if (decision === null) {
    addViolation(
      violations,
      "ship-verdict-format",
      decisionLine.line,
      "Ship Verdict Decision must use one documented bold decision value",
    );
    return null;
  }
  return { decision, line: decisionLine.line };
}

/** Read the report's single Ship Verdict claim and explain malformed or repeated decisions. */
function readShipVerdictClaim(
  lines: string[],
  violations: ReviewValidationViolation[],
): ShipVerdictClaim | null {
  const fullVerdictSections = readSections(lines, "Ship Verdict");
  const fullVerdictSection = fullVerdictSections.at(0);
  // Full reports show the decision beneath a dedicated heading.
  if (fullVerdictSection) {
    return readFullShipVerdictClaim(
      fullVerdictSection,
      fullVerdictSections.slice(1),
      violations,
    );
  }

  const compactVerdictLines = lines
    .map((text, lineIndex) => ({ line: lineIndex + 1, text }))
    .filter(({ text }) => /^\s*Ship Verdict:/u.test(text));
  const compactVerdictLine = compactVerdictLines.at(0);
  // Even a clean compact review needs one visible outcome for the user.
  if (!compactVerdictLine) {
    addViolation(
      violations,
      "ship-verdict-format",
      null,
      "report is missing Ship Verdict",
    );
    return null;
  }
  // Repeated compact decisions are as ambiguous as repeated full sections.
  if (compactVerdictLines.length > 1) {
    addViolation(
      violations,
      "ship-verdict-format",
      compactVerdictLines[1]?.line ?? compactVerdictLine.line,
      `Ship Verdict duplicates the decision at line ${compactVerdictLine.line}`,
    );
  }
  const decision = parseShipVerdictDecision(
    compactVerdictLine.text,
    COMPACT_SHIP_VERDICT,
  );
  // A malformed compact line cannot be trusted as the review's visible outcome.
  if (decision === null) {
    addViolation(
      violations,
      "ship-verdict-format",
      compactVerdictLine.line,
      "compact Ship Verdict must use one documented bold decision value",
    );
    return null;
  }
  return { decision, line: compactVerdictLine.line };
}

/** Move one final decision down the documented confidence ladder. */
function downgradeShipVerdict(
  decision: (typeof SHIP_VERDICT_LADDER)[number],
): (typeof SHIP_VERDICT_LADDER)[number] {
  const currentDecisionIndex = SHIP_VERDICT_LADDER.indexOf(decision);
  const downgradedDecisionIndex = Math.min(
    currentDecisionIndex + 1,
    SHIP_VERDICT_LADDER.length - 1,
  );
  return SHIP_VERDICT_LADDER[downgradedDecisionIndex] ?? "NO";
}

/** Derive the decision users should see from surfaced severity and integrity confidence. */
function expectedShipVerdict(
  definitions: FindingDefinition[],
  conclusion: ReviewIntegrityConclusion | null,
  isRiskDepthDeclined: boolean,
): (typeof SHIP_VERDICT_LADDER)[number] {
  const surfacedFindings = definitions.filter((definition) =>
    SURFACED_FINDING_SECTIONS.has(definition.section),
  );
  const hasBlockingFinding = surfacedFindings.some(
    (definition) =>
      definition.severity === "MUST" || definition.action === "intent-mismatch",
  );
  const hasConditionalFinding = surfacedFindings.some(
    (definition) => definition.severity === "SHOULD",
  );
  let expectedDecision: (typeof SHIP_VERDICT_LADDER)[number] =
    hasBlockingFinding
      ? "NO"
      : hasConditionalFinding
        ? "YES WITH CONDITIONS"
        : "YES";
  const requiresConfidenceDowngrade =
    conclusion !== null && conclusion !== "confident";
  // Degraded review coverage moves the visible outcome down exactly one rung.
  if (requiresConfidenceDowngrade) {
    expectedDecision = downgradeShipVerdict(expectedDecision);
  }
  // A declined material-risk review can never certify a verdict above PARTIAL.
  if (
    isRiskDepthDeclined &&
    SHIP_VERDICT_LADDER.indexOf(expectedDecision) <
      SHIP_VERDICT_LADDER.indexOf("PARTIAL")
  ) {
    expectedDecision = "PARTIAL";
  }
  return expectedDecision;
}

/** Reject a final decision that understates or contradicts the report's visible risk surface. */
function validateShipVerdict(
  lines: string[],
  integrity: IntegrityResult,
  definitions: FindingDefinition[],
  violations: ReviewValidationViolation[],
): void {
  const verdictClaim = readShipVerdictClaim(lines, violations);
  // A missing or malformed claim already has a user-actionable format error.
  if (verdictClaim === null) return;
  // Pending review states intentionally defer the final risk decision.
  if (verdictClaim.decision === "PENDING REFUTER/HUMAN") return;
  // Area audits may report no release decision because shipping was outside the user's question.
  if (verdictClaim.decision === "N/A - AREA AUDIT ONLY") {
    // Diff and PR reviews must still give the user a release decision.
    if (!integrity.isAreaAudit) {
      addViolation(
        violations,
        "ship-verdict-contradiction",
        verdictClaim.line,
        "N/A - AREA AUDIT ONLY is valid only when Scope snapshot declares source=area",
      );
    }
    return;
  }
  const expectedDecision = expectedShipVerdict(
    definitions,
    integrity.conclusion,
    integrity.isRiskDepthDeclined,
  );
  // Matching severity and confidence produces one deterministic decision.
  if (verdictClaim.decision === expectedDecision) return;
  addViolation(
    violations,
    "ship-verdict-contradiction",
    verdictClaim.line,
    `Ship Verdict claims ${verdictClaim.decision} but surfaced findings and Review Integrity require ${expectedDecision}`,
  );
}

/**
 * Validate a drafted goat-review report against files in the reviewed project root.
 *
 * @param markdown - drafted human-readable review report
 * @param projectRoot - reviewed project whose anchors and ledgers must resolve
 * @returns deterministic status plus structural violations and advisory warnings
 */
export function validateReviewReport(
  markdown: string,
  projectRoot: string,
): ReviewValidationResult {
  const lines = maskNonRenderedMarkdown(markdown).split(/\r?\n/u);
  const violations: ReviewValidationViolation[] = [];
  const warnings: ReviewValidationViolation[] = [];
  const integrity = validateIntegrity(
    lines,
    countFindingCandidates(lines),
    violations,
    warnings,
  );
  const definitions = validateFindingSections(
    lines,
    integrity.isAreaAudit,
    projectRoot,
    integrity.anchorAuthority,
    violations,
  );
  validateUniqueFindingIds(definitions, violations);
  validateIntegrityCounts(integrity, definitions, violations);
  validateShipVerdict(lines, integrity, definitions, violations);
  const topFive = readTopFiveSection(lines, violations);
  validateSectionAnchors(
    topFive,
    projectRoot,
    integrity.anchorAuthority,
    violations,
  );
  validateTopFiveReferences(topFive, definitions, violations);
  validateRefuterReferences(lines, definitions, violations);
  validateSpecDrift(lines, violations);
  validateConditionalSections(lines, topFive, definitions, warnings);
  validateRefutationLedger(projectRoot, integrity, violations);
  return {
    status: violations.length === 0 ? "pass" : "fail",
    violations,
    warnings,
  };
}

/**
 * Render a deterministic human-readable validation result for shell pipelines.
 *
 * @param result - pure validation result
 * @returns a PASS/FAIL header followed by each structural violation and warning
 */
export function renderReviewValidationResult(
  result: ReviewValidationResult,
): string {
  if (result.status === "pass" && result.warnings.length === 0) {
    return "review validate: PASS";
  }
  const warningLabel = `${result.warnings.length} ${result.warnings.length === 1 ? "warning" : "warnings"}`;
  const warningSuffix = result.warnings.length > 0 ? `, ${warningLabel}` : "";
  const lines =
    result.status === "pass"
      ? [`review validate: PASS (${warningLabel})`]
      : [
          `review validate: FAIL (${result.violations.length} violations${warningSuffix})`,
        ];
  for (const violation of result.violations) {
    const location =
      violation.line === null ? "report" : `line ${violation.line}`;
    lines.push(
      `${location} [${violation.checkId}/${violation.code}] ERROR ${violation.message}`,
    );
  }
  for (const warning of result.warnings) {
    const location = warning.line === null ? "report" : `line ${warning.line}`;
    lines.push(
      `${location} [${warning.checkId}/${warning.code}] WARN ${warning.message}`,
    );
  }
  return lines.join("\n");
}

/**
 * Read stdin or one saved report, validate it against the selected project, and emit every issue.
 * Usage and read errors throw CLIError; structural report failures set the process exit code after rendering.
 *
 * @param options - parsed review request; a missing validate subcommand or unreadable path is a usage error
 * @returns nothing; validation output is written through the shared CLI sink
 * @throws CLIError when command usage is invalid or the report cannot be read
 */
export function handleReviewCommand(options: ParsedCLI): void {
  if (options.reviewSubcommand !== "validate") {
    throw new CLIError('review requires subcommand "validate".', 2);
  }
  let markdown: string;
  try {
    markdown = readFileSync(options.reviewValidatePath ?? 0, "utf-8");
  } catch (error) {
    throw new CLIError(
      `Cannot read review report: ${error instanceof Error ? error.message : String(error)}`,
      2,
    );
  }
  const result = validateReviewReport(markdown, options.projectPath);
  writeOutput(options, renderReviewValidationResult(result));
  if (result.status === "fail") process.exitCode = 1;
}
