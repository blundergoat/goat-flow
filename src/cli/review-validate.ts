/**
 * Deterministic validation for drafted goat-review Markdown.
 * The validator reads only the supplied report, semantic-anchor files under the
 * reviewed project, and claimed local refutation ledgers; it never persists reports.
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { CLIError } from "./cli-error.js";
import type { ParsedCLI } from "./cli-types.js";
import { writeOutput } from "./cli-output.js";

/** One actionable validation failure, optionally tied to a report line. */
interface ReviewValidationViolation {
  code: string;
  line: number | null;
  message: string;
}

/** Deterministic validator result consumed by tests and the CLI renderer. */
export interface ReviewValidationResult {
  status: "pass" | "fail";
  violations: ReviewValidationViolation[];
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
  refutationsLogged: number;
  refutationsLine: number | null;
}

const FINDING_SECTIONS = [
  "Findings",
  "Systemic Patterns",
  "Refuted by Refuter",
] as const;

const FINDING_CANDIDATE = /^\s*-\s+(?:R-|\[(?:MUST|SHOULD|MAY):)/u;
const FINDING_PREFIX =
  /^\s*-\s+(R-\d{3})\s+\[(MUST|SHOULD|MAY):(patch|needs-decision|intent-mismatch|needs-signal|pre-existing)\](?:\s+\[(?:(?:overlap-confirmed|bot-only-locally-verified|disputed-match):[^\]\s]+|local-only|CONFIRMED-CROSS-MODEL)\])*\s+\*\*[^*\n]+\*\*/u;
const EVIDENCE_TAG =
  /(?:^|\|\s*)Evidence:\s*(?:OBSERVED|INFERRED)(?=\s*(?:\||$))/u;
const PROOF_TAG =
  /(?:^|\|\s*)Proof:\s*(?:RUNTIME|CONTRACT-GREP|STATIC|NOT-REPRODUCED)(?=\s*(?:\||$))/u;
const HARM_TAG = /(?:^|\|\s*)Harm:\s*[^|\s][^|]*(?=\s*(?:\||$))/u;
const ANCHOR =
  /`([^`\r\n]+)`\s+\(search:\s*(?:`([^`\r\n]+)`|"([^"\r\n]+)")\)/gu;
const SPEC_DRIFT_LINE =
  /^\s*-\s+\[(?:advisory|ready-to-tick)\]\s+\*\*[^*\n]+\*\*\s+-\s+\S/u;

const REQUIRED_INTEGRITY_FIELDS: ReadonlyArray<
  readonly [label: string, valuePattern: RegExp]
> = [
  ["Scope snapshot", /\S/u],
  ["Files opened in Pass 2", /^\d+\/\d+\b/u],
  ["Evidence", /^\d+ OBSERVED\s*\/\s*\d+ INFERRED$/u],
  ["Verdicts", /^\d+\/\d+\/\d+\/\d+$/u],
  ["Refutations logged", /^\d+$/u],
  ["Gates", /^(?:run|unavailable|skipped \(.+\))$/u],
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
  /^\s*Review Integrity:\s*(?:confident|coverage-degraded|high-inference|partial);\s*\d+\/\d+\s+files opened;\s*\S.+$/u;

/** Return one H2 section without consuming nested H3 headings. */
function readSection(lines: string[], heading: string): MarkdownSection | null {
  let headingIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(/^##\s+(.+?)(?:\s+<!--.*)?\s*$/u);
    if (match?.[1]?.trim() === heading) {
      headingIndex = index;
      break;
    }
  }
  if (headingIndex < 0) return null;

  let endIndex = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (/^##\s+/u.test(lines[index] ?? "")) {
      endIndex = index;
      break;
    }
  }
  return {
    headingLine: headingIndex + 1,
    lines: lines.slice(headingIndex + 1, endIndex).map((text, index) => ({
      line: headingIndex + index + 2,
      text,
    })),
  };
}

/** Record one violation while preserving report order for readable CLI output. */
function addViolation(
  violations: ReviewValidationViolation[],
  code: string,
  line: number | null,
  message: string,
): void {
  violations.push({ code, line, message });
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

/** Resolve one literal semantic anchor without reading outside the reviewed project. */
function validateAnchor(
  projectRoot: string,
  filePath: string,
  searchText: string,
  line: number,
  violations: ReviewValidationViolation[],
): void {
  const candidatePath = resolve(projectRoot, filePath);
  if (!isWithinProject(projectRoot, candidatePath)) {
    addViolation(
      violations,
      "anchor-outside-project",
      line,
      `anchor path escapes the reviewed project: ${filePath}`,
    );
    return;
  }

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
      filePath,
      searchText,
      locatedLine.line,
      violations,
    );
  }
}

/** Validate one finding definition after its containing section identifies it as review output. */
function validateFindingLine(
  locatedLine: LocatedLine,
  projectRoot: string,
  violations: ReviewValidationViolation[],
): void {
  if (!FINDING_CANDIDATE.test(locatedLine.text)) return;
  const prefixMatch = locatedLine.text.match(FINDING_PREFIX);
  if (!prefixMatch) {
    addViolation(
      violations,
      "finding-grammar",
      locatedLine.line,
      "finding must use R-NNN, a supported severity/action, optional current provenance/refuter tags, and a bold title",
    );
    return;
  }

  validateFindingFields(
    locatedLine.text,
    prefixMatch[2] ?? "",
    locatedLine.line,
    violations,
  );
  validateFindingAnchors(locatedLine, projectRoot, violations);
}

type IntegrityFieldMap = Map<string, { value: string; line: number }>;

/** Extract colon-delimited integrity fields without interpreting their values. */
function collectIntegrityFields(section: MarkdownSection): IntegrityFieldMap {
  const fields: IntegrityFieldMap = new Map();
  for (const locatedLine of section.lines) {
    const match = locatedLine.text.match(/^\s*-\s+([^:]+):\s*(.*)$/u);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    fields.set(match[1].trim(), {
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

/** Convert a valid integer refutation field into the ledger claim. */
function readRefutationClaim(fields: IntegrityFieldMap): IntegrityResult {
  const refutations = fields.get("Refutations logged");
  if (!refutations || !/^\d+$/u.test(refutations.value)) {
    return { refutationsLogged: 0, refutationsLine: refutations?.line ?? null };
  }
  return {
    refutationsLogged: Number.parseInt(refutations.value, 10),
    refutationsLine: refutations.line,
  };
}

/** Validate the full Review Integrity field set and return its ledger claim. */
function validateFullIntegrity(
  section: MarkdownSection,
  violations: ReviewValidationViolation[],
): IntegrityResult {
  const fields = collectIntegrityFields(section);
  validateRequiredIntegrityFields(fields, section, violations);
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
  return readRefutationClaim(fields);
}

/** Validate either the full integrity block or M04's compact clean-review line. */
function validateIntegrity(
  lines: string[],
  violations: ReviewValidationViolation[],
): IntegrityResult {
  const fullSection = readSection(lines, "Review Integrity");
  if (fullSection) return validateFullIntegrity(fullSection, violations);

  const compactIndex = lines.findIndex((line) =>
    /^\s*Review Integrity:/u.test(line),
  );
  if (compactIndex >= 0 && COMPACT_INTEGRITY.test(lines[compactIndex] ?? "")) {
    return { refutationsLogged: 0, refutationsLine: null };
  }
  addViolation(
    violations,
    "integrity-format",
    compactIndex >= 0 ? compactIndex + 1 : null,
    compactIndex >= 0
      ? "compact Review Integrity line is malformed"
      : "report is missing Review Integrity",
  );
  return { refutationsLogged: 0, refutationsLine: null };
}

/** Check the claimed local refutation ledger without interpreting its free-form body. */
function validateRefutationLedger(
  projectRoot: string,
  integrity: IntegrityResult,
  violations: ReviewValidationViolation[],
): void {
  if (integrity.refutationsLogged <= 0) return;
  const ledgerRoot = join(projectRoot, ".goat-flow", "logs", "review");
  let hasLedger = false;
  if (existsSync(ledgerRoot)) {
    try {
      hasLedger = readdirSync(ledgerRoot, { withFileTypes: true }).some(
        (entry) =>
          entry.isFile() &&
          /^goat-review-refutations\..+\.txt$/u.test(entry.name) &&
          statSync(join(ledgerRoot, entry.name)).size > 0,
      );
    } catch {
      hasLedger = false;
    }
  }
  if (!hasLedger) {
    addViolation(
      violations,
      "refutation-ledger",
      integrity.refutationsLine,
      "Refutations logged is greater than zero but no non-empty goat-review-refutations.*.txt ledger exists",
    );
  }
}

/** Validate finding definitions in every output section that owns R-IDs. */
function validateFindingSections(
  lines: string[],
  projectRoot: string,
  violations: ReviewValidationViolation[],
): void {
  for (const heading of FINDING_SECTIONS) {
    const section = readSection(lines, heading);
    const locatedLines = section?.lines ?? [];
    for (const locatedLine of locatedLines) {
      validateFindingLine(locatedLine, projectRoot, violations);
    }
  }
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

/**
 * Validate a drafted goat-review report against files in the reviewed project root.
 *
 * @param markdown - drafted human-readable review report
 * @param projectRoot - reviewed project whose anchors and ledgers must resolve
 * @returns deterministic status plus every report violation
 */
export function validateReviewReport(
  markdown: string,
  projectRoot: string,
): ReviewValidationResult {
  const lines = markdown.split(/\r?\n/u);
  const violations: ReviewValidationViolation[] = [];
  const integrity = validateIntegrity(lines, violations);
  validateFindingSections(lines, projectRoot, violations);
  validateSpecDrift(lines, violations);
  validateRefutationLedger(projectRoot, integrity, violations);
  return { status: violations.length === 0 ? "pass" : "fail", violations };
}

/**
 * Render a deterministic human-readable validation result for shell pipelines.
 *
 * @param result - pure validation result
 * @returns one PASS line or a FAIL header followed by every violation
 */
export function renderReviewValidationResult(
  result: ReviewValidationResult,
): string {
  if (result.status === "pass") return "review validate: PASS";
  const lines = [
    `review validate: FAIL (${result.violations.length} violations)`,
  ];
  for (const violation of result.violations) {
    lines.push(
      `${violation.line === null ? "report" : `line ${violation.line}`} [${violation.code}] ${violation.message}`,
    );
  }
  return lines.join("\n");
}

/** Read stdin or one saved report, validate it against cwd, and emit all violations. */
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
  writeOutput(
    { ...options, output: null },
    renderReviewValidationResult(result),
  );
  if (result.status === "fail") process.exitCode = 1;
}
