/**
 * Validate goat-review ledgers, pending drafts, and completed reports for the selected project.
 * Use the snapshot command before reviewing, then validate the retained report and its evidence.
 *
 * The validator checks visible Markdown, frozen source authority, trusted gate records, and declared local ledgers.
 * Validation does not persist artifacts or run gates; the CLI writes only the explicitly requested validation output.
 */
import { readFileSync, realpathSync, statSync } from "node:fs";
import { getPackageVersion } from "./paths.js";
import { CLIError } from "./cli-error.js";
import type { ParsedCLI } from "./cli-types.js";
import { writeOutput } from "./cli-output.js";
import { maskNonRenderedMarkdown } from "./rendered-markdown.js";
import {
  canonicalReviewJson,
  captureReviewSnapshot,
  ReviewAuthorityError,
  verifyReviewAuthority,
} from "./review-validate-authority.js";
import { validateEscapedReviewAnchors } from "./review-validate-anchors.js";
import {
  REVIEW_DRAFT_LEDGER_MARKER,
  addViolation,
  type IntegrityResult,
  type FindingDefinition,
  type IntegrityField,
  type LocatedLine,
  type ReviewValidationResult,
  type ReviewValidationStage,
  type ReviewValidationViolation,
  requireAuthority,
  record,
  exactKeys,
  textField,
  projectPath,
  parseReviewJson,
  reviewGateId,
  type JsonValue,
  type JsonRecord,
  type GitContext,
  type ReviewAuthoritySnapshot,
  readSections,
  readIntegrityJson,
  requireDegradationReferences,
} from "./review-validate-common.js";
import { gitContext, commitId, treeFiles } from "./review-validate-anchors.js";
import { validateIntegrity } from "./review-validate-integrity.js";
import {
  validateRefutationLedger,
  validateRefutationLedgerText,
} from "./review-validate-ledger.js";
import {
  countFindingCandidates,
  readTopFiveSection,
  validateConditionalSections,
  validateFindingSections,
  validateIntegrityCounts,
  validateRefuterReferences,
  validateSectionAnchors,
  validateSpecDrift,
  validateTopFiveReferences,
  validateUniqueFindingIds,
} from "./review-validate-sections.js";
import { validateShipVerdict } from "./review-validate-verdict.js";

/** Parsed integrity retained beside the public result for draft-envelope checks. */
interface ReviewEvaluation {
  integrity: IntegrityResult;
  result: ReviewValidationResult;
}

/** Locate a visible receipt value so an execution issue points to the line the reviewer can repair. */
function readGateReceiptField(
  lines: LocatedLine[],
  label: string,
  isFullReceipt: boolean,
): IntegrityField | null {
  const prefix = isFullReceipt ? "^\\s*-\\s+" : "^\\s*";
  const separator = isFullReceipt ? "\\s*" : " ";
  const pattern = new RegExp(`${prefix}${label}:${separator}(.*)$`, "u");
  const locatedLine = lines.find(({ text }) => pattern.test(text));
  // Missing fields have no execution evidence; the integrity pass reports whether that omission is allowed.
  if (!locatedLine) return null;
  const value = locatedLine.text.match(pattern)?.[1] ?? "";
  return {
    value: isFullReceipt ? value.trim() : value,
    line: locatedLine.line,
  };
}

/** Check the visible gate receipt against the same source selection used for finding evidence. */
function validateReportGateAuthority(
  lines: string[],
  projectRoot: string,
  integrity: IntegrityResult,
  violations: ReviewValidationViolation[],
  definitions: FindingDefinition[],
): void {
  // Invalid selection already blocks the report; gate evidence cannot supply a replacement source.
  if (integrity.anchorAuthority.kind !== "snapshot") return;
  const fullSection = readSections(lines, "Review Integrity").at(0);
  const receiptLines =
    fullSection?.lines ??
    lines.map((text, index) => ({ text, line: index + 1 }));
  const gateField = readGateReceiptField(
    receiptLines,
    "Gate authority",
    fullSection !== undefined,
  );
  // The integrity pass owns missing fields; only an existing receipt can be checked for execution credit.
  if (!gateField) return;
  const claimedGates = integrity.fields.get("Gates");
  const gates = validateReviewGates(
    gateField.value,
    projectRoot,
    integrity.anchorAuthority.snapshot,
    claimedGates?.value ?? null,
    gateField.line,
    violations,
  );
  // Only authority-validated command records can be reconciled with the displayed outcomes and findings.
  if (gates)
    reconcileGateOutcomes(gates, integrity, definitions, lines, violations);
}

/** Reconcile distinct command outcomes with the summary, disclosures, and active findings without executing any command. */
function reconcileGateOutcomes(
  gates: JsonRecord[],
  integrity: IntegrityResult,
  definitions: FindingDefinition[],
  lines: string[],
  violations: ReviewValidationViolation[],
): void {
  const field = integrity.fields.get("Gate evidence");
  const labels = [
    "pass",
    "changed-code",
    "pre-existing",
    "infrastructure",
    "unresolved",
  ];
  const expected = labels.map(
    (label) => gates.filter((gate) => gate.outcome === label).length,
  );
  const match = field?.value.match(
    /^pass=(\d+),\s*changed-code=(\d+),\s*pre-existing=(\d+),\s*infrastructure=(\d+),\s*unresolved=(\d+)$/u,
  );
  // One selected command counts once, regardless of how many assertions its output claims to have checked.
  if (
    !match ||
    expected.some((count, index) => Number(match[index + 1]) !== count)
  )
    addViolation(
      violations,
      "gate-state",
      field?.line ?? null,
      "Gate evidence totals must equal distinct credited commands in Gate authority",
    );
  validateGateSummary(gates, expected, integrity, violations);
  const incompleteIds = gates
    .filter(
      (gate) =>
        gate.outcome === "infrastructure" || gate.outcome === "unresolved",
    )
    .map((gate) => textField(gate.id, "gate id"));
  requireDegradationReferences(
    integrity,
    "gate-evidence-incomplete",
    incompleteIds,
    violations,
  );
  validateGateFindingLinks(gates, integrity, definitions, violations);
  validatePreExistingGateIssue(gates, integrity, lines, violations);
}

/** Keep skipped and incomplete checks visible in the report's execution summary. */
function validateGateSummary(
  gates: JsonRecord[],
  counts: number[],
  integrity: IntegrityResult,
  violations: ReviewValidationViolation[],
): void {
  const field = integrity.fields.get("Gate evidence");
  const hasUnexecutedGates =
    gates.length === 0 ||
    gates.some(
      (gate) => gate.outcome === "skipped" || gate.outcome === "unavailable",
    );
  const hasIncompleteGateEvidence = gates.some(
    (gate) =>
      gate.outcome === "infrastructure" || gate.outcome === "unresolved",
  );
  validateGateGapFlags(
    hasUnexecutedGates,
    hasIncompleteGateEvidence,
    integrity,
    violations,
  );
  const summary = integrity.fields.get("Gates")?.value;
  const executedCount = counts.reduce((sum, count) => sum + count, 0);
  const expectedSummary = hasUnexecutedGates
    ? executedCount > 0
      ? "unavailable"
      : null
    : "run";
  // An entirely unexecuted selection can explain a skip; mixed execution must remain unavailable.
  if (
    expectedSummary === null ? summary === "run" : summary !== expectedSummary
  )
    addViolation(
      violations,
      "gate-state",
      field?.line ?? null,
      "Gates must be run for complete execution, unavailable for mixed execution, or a disclosed skip/unavailability with no execution",
    );
}

/** Require each execution gap's disclosure even when another selected command passed. */
function validateGateGapFlags(
  skipped: boolean,
  incomplete: boolean,
  integrity: IntegrityResult,
  violations: ReviewValidationViolation[],
): void {
  // Execution gaps must remain visible even when an unrelated command passed.
  for (const [flag, needed] of [
    ["gates-not-run", skipped],
    ["gate-evidence-incomplete", incomplete],
  ] as const)
    // A stale or omitted gap flag would misstate which selected commands actually supplied evidence.
    if (needed !== integrity.flags.has(flag))
      addViolation(
        violations,
        "gate-state",
        integrity.fields.get("Gate evidence")?.line ?? null,
        `${flag} must agree with the selected gate outcomes`,
      );
}

/** Require a separate nearby-issue disclosure when a diff review classifies a failure as pre-existing. */
function validatePreExistingGateIssue(
  gates: JsonRecord[],
  integrity: IntegrityResult,
  lines: string[],
  violations: ReviewValidationViolation[],
): void {
  // A base failure in a diff remains an untagged nearby issue; area reviews retain their existing pre-existing action route.
  if (
    gates.some((gate) => gate.outcome === "pre-existing") &&
    !integrity.isAreaAudit &&
    !["Pre-existing Nearby", "Pre-existing Issues"].some((heading) =>
      readSections(lines, heading).some((section) =>
        section.lines.some(
          ({ text }) => /^\s*-\s+\S/u.test(text) && !/\bR-\d{3}\b/u.test(text),
        ),
      ),
    )
  )
    addViolation(
      violations,
      "gate-state",
      integrity.fields.get("Gate evidence")?.line ?? null,
      "pre-existing gate failure requires an untagged nearby issue with base evidence",
    );
}

/** Bind required gate consequences to real active IDs; skipped commands and unrelated findings cannot supply failure proof. */
function validateGateFindingLinks(
  gates: JsonRecord[],
  integrity: IntegrityResult,
  definitions: FindingDefinition[],
  violations: ReviewValidationViolation[],
): void {
  const field = integrity.fields.get("Gate findings");
  const links = readIntegrityJson(
    integrity.fields,
    "Gate findings",
    violations,
  );
  const required = gates.filter(
    (gate) => gate.outcome === "changed-code" || gate.outcome === "unresolved",
  );
  try {
    const mappings = record(field ? links : {}, "Gate findings");
    requireAuthority(
      Object.keys(mappings).length === required.length &&
        required.every((gate) =>
          Object.hasOwn(mappings, textField(gate.id, "gate id")),
        ),
      "Gate findings must name exactly the changed-code and unresolved gates",
      "gate-state",
    );
    // Each required gate needs its own active consequence; history cannot make a failed check actionable.
    for (const gate of required) {
      validateLinkedGateFindings(
        gate,
        mappings[textField(gate.id, "gate id")],
        integrity,
        definitions,
      );
    }
  } catch (error) {
    // A report may retain a gate link after a finding was refuted or point a failing gate at an unrelated success.
    addViolation(
      violations,
      "gate-state",
      field?.line ?? null,
      error instanceof Error ? error.message : "invalid Gate findings",
    );
  }
}

/** Reject missing, historical, or incompatible finding links so each failure keeps its required visible consequence. */
function validateLinkedGateFindings(
  gate: JsonRecord,
  ids: JsonValue | undefined,
  integrity: IntegrityResult,
  definitions: FindingDefinition[],
): void {
  requireAuthority(
    Array.isArray(ids) && ids.length > 0 && new Set(ids).size === ids.length,
    "Gate findings requires unique nonempty active ID lists",
    "gate-state",
  );
  // Every linked ID must still be an active finding after refutation and synthesis.
  for (const id of ids) {
    const finding = definitions.find(
      (definition) =>
        definition.id === id && definition.section !== "Refuted by Refuter",
    );
    requireAuthority(
      finding,
      "Gate findings references an absent or historical ID",
      "gate-state",
    );
    const disposition = integrity.finalDispositions?.[finding.id];
    requireAuthority(
      gate.outcome !== "changed-code" ||
        disposition === "confirmed" ||
        disposition === "adjusted",
      "changed-code gate needs an active confirmed/adjusted finding",
      "gate-state",
    );
    requireAuthority(
      gate.outcome !== "unresolved" ||
        (finding.severity === "MUST" &&
          finding.action === "needs-decision" &&
          disposition === "unresolved"),
      "unresolved gate needs an active MUST:needs-decision unresolved verification blocker",
      "gate-state",
    );
  }
}

/**
 * Evaluate one report while retaining parsed integrity for draft-envelope checks.
 *
 * @param markdown - human-readable report without a transient ledger appendix
 * @param projectRoot - reviewed project whose anchors and ledgers must resolve
 * @param shouldVerifyPersistedLedger - whether the declared ledger must already exist
 *
 * @param validationStage - pending draft or completed final report
 * @returns parsed integrity and deterministic public validation result
 */
function evaluateReviewReport(
  markdown: string,
  projectRoot: string,
  shouldVerifyPersistedLedger: boolean,
  validationStage: ReviewValidationStage,
  draftEnvelope: {
    ledgerText: string | null;
    markerCount: number;
  } | null = null,
): ReviewEvaluation {
  const lines = maskNonRenderedMarkdown(markdown).split(/\r?\n/u);
  const violations: ReviewValidationViolation[] = [];
  const warnings: ReviewValidationViolation[] = [];
  const integrity = validateIntegrity(
    projectRoot,
    lines,
    countFindingCandidates(lines),
    violations,
    warnings,
    validationStage,
  );
  const definitions = validateFindingSections(
    lines,
    integrity.isAreaAudit,
    projectRoot,
    integrity.anchorAuthority,
    violations,
  );
  validateUniqueFindingIds(definitions, violations);
  validateEscapedReviewAnchors(
    // Scope and coverage disclosures contain literal filenames; an anchor= marker in that metadata is not finding evidence.
    lines.map((line) =>
      /^\s*(?:-\s+)?(?:Scope snapshot|Source coverage|Degradation evidence):/u.test(
        line,
      )
        ? ""
        : line,
    ),
    projectRoot,
    integrity.anchorAuthority,
    violations,
  );
  validateRefutationLedger(
    projectRoot,
    integrity,
    violations,
    shouldVerifyPersistedLedger,
  );
  // Transient IDs must be available before disposition inference; a draft path never stands in for those actual records.
  if (draftEnvelope)
    validateDraftLedgerEnvelope(
      draftEnvelope.ledgerText,
      draftEnvelope.markerCount,
      integrity,
      violations,
    );
  validateIntegrityCounts(integrity, definitions, violations);
  validateReportGateAuthority(
    lines,
    projectRoot,
    integrity,
    violations,
    definitions,
  );
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
  // A zero-finding report still needs a final comparison with its original selected source.
  if (integrity.anchorAuthority.kind === "snapshot")
    verifyReviewAuthority(
      projectRoot,
      integrity.anchorAuthority.snapshot,
      violations,
    );
  // A transient draft appendix cannot remain in the completed report handed to the reader.
  if (
    validationStage === "final" &&
    markdown
      .split(/\r?\n/u)
      .some((line) => line.trim() === REVIEW_DRAFT_LEDGER_MARKER)
  ) {
    addViolation(
      violations,
      "integrity-format",
      null,
      "final review must not include the transient draft-ledger marker",
    );
  }
  return {
    integrity,
    result: {
      status: violations.length === 0 ? "pass" : "fail",
      violations,
      warnings,
    },
  };
}

/**
 * Validate a completed report, including the exact persisted ledger it declares.
 *
 * @param markdown - completed human-readable review report
 * @param projectRoot - reviewed project whose anchors and ledger must resolve
 * @returns deterministic status plus structural violations and advisory warnings
 */
export function validateReviewReport(
  markdown: string,
  projectRoot: string,
): ReviewValidationResult {
  return evaluateReviewReport(markdown, projectRoot, true, "final").result;
}

/** Split the exact transient marker from the report bytes it must not enter. */
function splitReviewDraftEnvelope(input: string): {
  ledgerText: string | null;
  markerCount: number;
  reportMarkdown: string;
} {
  const lines = input.split(/\r?\n/u);
  const markerIndexes = lines.flatMap((line, index) =>
    line.trim() === REVIEW_DRAFT_LEDGER_MARKER ? [index] : [],
  );
  const firstMarker = markerIndexes.at(0);
  // A draft without an appendix marker has no transient ledger to reconcile.
  if (firstMarker === undefined) {
    return { ledgerText: null, markerCount: 0, reportMarkdown: input };
  }
  return {
    ledgerText: lines.slice(firstMarker + 1).join("\n"),
    markerCount: markerIndexes.length,
    reportMarkdown: `${lines.slice(0, firstMarker).join("\n")}\n`,
  };
}

/** Bind one report's refutation claim to the exact transient records in its draft envelope. */
function validateDraftLedgerEnvelope(
  ledgerText: string | null,
  markerCount: number,
  integrity: IntegrityResult,
  violations: ReviewValidationViolation[],
): void {
  // Several ledger markers could assign conflicting refutation evidence to the same draft.
  if (markerCount > 1) {
    addViolation(
      violations,
      "refutation-ledger",
      null,
      "review draft envelope must contain exactly one ledger marker",
    );
    return;
  }
  // A zero-refutation review needs no ledger appendix.
  if (integrity.refutationsLogged === 0) {
    // An appendix beside a zero count would retain evidence the report says does not exist.
    if (markerCount > 0) {
      addViolation(
        violations,
        "refutation-ledger",
        null,
        "zero refutations must not include a draft-ledger appendix",
      );
    }
    return;
  }
  // Nonzero refutations require the transient ledger before persistence can be considered.
  if (ledgerText === null) {
    addViolation(
      violations,
      "refutation-ledger",
      integrity.refutationsLine,
      `nonzero refutations require ${REVIEW_DRAFT_LEDGER_MARKER} followed by the transient records`,
    );
    return;
  }
  const ledgerResult = validateRefutationLedgerText(ledgerText);
  // Only valid unique transient records can establish which IDs were refuted before persistence.
  if (ledgerResult.status === "pass") integrity.ledgerIds = ledgerResult.ids;
  violations.push(...ledgerResult.violations);
  // The draft count must match its actual ledger records before the reviewer can retain the evidence.
  if (ledgerResult.recordCount !== integrity.refutationsLogged) {
    addViolation(
      violations,
      "refutation-ledger",
      integrity.refutationsLine,
      `draft ledger has ${ledgerResult.recordCount} records but Refutations logged claims ${integrity.refutationsLogged}`,
    );
  }
}

/** Validate one pending report and its transient ledger together before persistence. */
function validateReviewDraftEnvelope(
  input: string,
  projectRoot: string,
): ReviewValidationResult {
  const envelope = splitReviewDraftEnvelope(input);
  const evaluation = evaluateReviewReport(
    envelope.reportMarkdown,
    projectRoot,
    false,
    "draft",
    envelope,
  );
  evaluation.result.status =
    evaluation.result.violations.length === 0 ? "pass" : "fail";
  return evaluation.result;
}

/** Build the one-line command verdict before individual issues are appended. */
function renderReviewValidationHeader(
  result: ReviewValidationResult,
  commandLabel: string,
  passContext: string | null,
): string {
  const warningCount = result.warnings.length;
  const warningLabel = `${warningCount} ${warningCount === 1 ? "warning" : "warnings"}`;
  const passContextSuffix = passContext ? ` (${passContext})` : "";
  const contextualWarningLabel = passContext
    ? `${warningLabel}; ${passContext}`
    : warningLabel;
  const failureWarningSuffix = warningCount > 0 ? `, ${warningLabel}` : "";
  // A passing report still needs any advisory limitations rendered beside its result.
  if (result.status === "pass") {
    // With no warnings, the reviewer needs only the successful validation receipt.
    if (warningCount === 0) {
      return `${commandLabel}: PASS${passContextSuffix}`;
    }
    return `${commandLabel}: PASS (${contextualWarningLabel})`;
  }
  return `${commandLabel}: FAIL (${result.violations.length} violations${failureWarningSuffix})`;
}

/**
 * Render a deterministic human-readable validation result for shell pipelines.
 *
 * @param result - pure validation result
 * @param commandLabel - subcommand name shown in the verdict header
 * @param passContext - qualifier appended to a passing header; null means no additional proof limitation is shown
 *
 * @returns a PASS/FAIL header followed by each structural violation and warning
 */
export function renderReviewValidationResult(
  result: ReviewValidationResult,
  commandLabel = "review validate",
  passContext: string | null = null,
): string {
  const lines = [
    renderReviewValidationHeader(result, commandLabel, passContext),
  ];
  // Show every blocking issue so the reviewer can repair the complete report in one pass.
  for (const violation of result.violations) {
    const location =
      violation.line === null ? "report" : `line ${violation.line}`;
    lines.push(
      `${location} [${violation.checkId}/${violation.code}] ERROR ${violation.message}`,
    );
  }
  // Warnings stay visible while preserving the successful status of an otherwise valid report.
  for (const warning of result.warnings) {
    const location = warning.line === null ? "report" : `line ${warning.line}`;
    lines.push(
      `${location} [${warning.checkId}/${warning.code}] WARN ${warning.message}`,
    );
  }
  return lines.join("\n");
}

/** Render the transient ledger gate with the exact record count a report must claim. */
function renderLedgerValidationResult(
  result: ReturnType<typeof validateRefutationLedgerText>,
): string {
  // A valid ledger receives its record count; a failed ledger uses the shared issue renderer.
  if (result.status === "pass") {
    const noun = result.recordCount === 1 ? "record" : "records";
    return `review validate-ledger: PASS (${result.recordCount} ${noun})`;
  }
  return renderReviewValidationResult(result, "review validate-ledger");
}

/**
 * Produce canonical source metadata for the operator to retain throughout the review.
 *
 * @throws CLIError when the request or selected source cannot be captured without ambiguity
 */
function renderReviewSnapshot(input: string, projectRoot: string): string {
  try {
    return canonicalReviewJson(captureReviewSnapshot(input, projectRoot));
  } catch (error) {
    // A branch may have been removed or a selected path may be a symlink; neither can become a fallback review source.
    throw new CLIError(
      error instanceof ReviewAuthorityError
        ? `${error.code}: ${error.message}`
        : "Cannot capture the selected review source.",
      2,
    );
  }
}

/**
 * Read the supplied report or request without silently replacing invalid UTF-8 bytes.
 *
 * @param path - saved input file; null reads stdin from the calling terminal or pipeline
 * @returns exact decoded input; empty text remains empty so the selected parser can report its missing content
 * @throws CLIError when stdin or the named file is unreadable or cannot round-trip as UTF-8
 */
function readReviewInput(path: string | null): string {
  try {
    const bytes = readFileSync(path ?? 0);
    const text = bytes.toString("utf8");
    // Lossy decoding could select a different literal filename than the operator supplied.
    if (!Buffer.from(text, "utf8").equals(bytes))
      throw new CLIError("Review input must be round-trip UTF-8.", 2);
    return text;
  } catch (error) {
    // A moved or unreadable saved report cannot be validated; report the input error before evaluating any evidence.
    throw new CLIError(
      `Cannot read review input: ${error instanceof Error ? error.message : String(error)}`,
      2,
    );
  }
}

/**
 * Read stdin or one saved validation input, run the selected review proof gate, and emit every issue.
 * Usage and read errors throw CLIError; structural failures set the process exit code after rendering.
 *
 * @param options - parsed review request; a missing validation operation or unreadable input path is a usage error
 * @returns nothing; validation output is written through the shared CLI sink
 * @throws CLIError when command usage is invalid or the selected input cannot be read
 */
export function handleReviewCommand(options: ParsedCLI): void {
  validateReviewCommandUsage(options);
  const projectRoot =
    options.reviewSubcommand === "validate-ledger"
      ? options.projectPath
      : resolveReviewedProject(options.projectPath);
  const input = readReviewInput(options.reviewValidatePath);
  dispatchReviewInput(options, projectRoot, input);
}

/** Refuse unsupported operations or validator versions before reading the operator's input. */
function validateReviewCommandUsage(options: ParsedCLI): void {
  const actualVersion = getPackageVersion();
  // A skill can reject an older PATH binary before it reads report data or asks the operator for stdin.
  if (
    options.reviewExpectedVersion &&
    options.reviewExpectedVersion !== actualVersion
  )
    throw new CLIError(
      `Review validator version mismatch: expected ${JSON.stringify(options.reviewExpectedVersion)}, actual ${actualVersion}.`,
      2,
    );
  // Without an operation, the CLI cannot know which review artifact the operator wants checked.
  if (!options.reviewSubcommand) {
    throw new CLIError(
      'review requires subcommand "snapshot", "validate", "validate-draft", or "validate-ledger".',
      2,
    );
  }
  // Snapshot output is transient authority metadata; --output would create an unsupported persisted baseline.
  if (options.reviewSubcommand === "snapshot" && options.output)
    throw new CLIError(
      "review snapshot does not accept --output; retain its stdout metadata through the review.",
      2,
    );
}

/** Validate the selected input and write the result the operator requested. */
function dispatchReviewInput(
  options: ParsedCLI,
  projectRoot: string,
  input: string,
): void {
  // The operator requested a source selection, so produce its authority before any report validation.
  if (options.reviewSubcommand === "snapshot") {
    writeOutput(options, renderReviewSnapshot(input, projectRoot));
    return;
  }
  // Ledger-only validation checks its text grammar without claiming that a report has persisted it.
  if (options.reviewSubcommand === "validate-ledger") {
    const result = validateRefutationLedgerText(input);
    writeOutput(options, renderLedgerValidationResult(result));
    // A failed ledger must signal failure to the operator's shell or calling tool.
    if (result.status === "fail") process.exitCode = 1;
    return;
  }
  const result =
    options.reviewSubcommand === "validate-draft"
      ? validateReviewDraftEnvelope(input, projectRoot)
      : validateReviewReport(input, projectRoot);
  const rendered = renderReviewValidationResult(
    result,
    `review ${options.reviewSubcommand}`,
    options.reviewSubcommand === "validate-draft"
      ? "persistence unverified"
      : null,
  );
  writeOutput(options, rendered);
  // A failed report must signal failure even after all repairable issues have been printed.
  if (result.status === "fail") process.exitCode = 1;
}

/** Resolve the operator's chosen project once before any saved input is read; a missing directory is a usage error. */
function resolveReviewedProject(selectedPath: string): string {
  try {
    const projectRoot = realpathSync(selectedPath);
    // Selecting a report file as the project cannot establish a directory for source evidence.
    if (!statSync(projectRoot).isDirectory())
      throw new Error("expected a directory");
    return projectRoot;
  } catch (error) {
    // A moved project folder or a file passed to --project needs a corrected path, not a fallback to this workspace.
    throw new CLIError(
      `Cannot open reviewed project ${JSON.stringify(selectedPath)}: ${error instanceof Error ? error.message : String(error)}`,
      2,
    );
  }
}

/** Require an origin's literal raw hash rather than accepting an arbitrary label as command provenance. */
function sha256Field(value: JsonValue | undefined, label: string): string {
  const hash = textField(value, label);
  requireAuthority(
    /^[0-9a-f]{64}$/u.test(hash),
    `${label} must be a lowercase raw SHA-256`,
    "gate-origin",
  );
  return hash;
}

/** Validate host declarations as provenance records; this cannot authenticate human consent or historic execution. */
function hostInstructions(value: JsonValue | undefined): JsonRecord[] {
  requireAuthority(
    Array.isArray(value),
    "hostInstructions must be an array",
    "gate-origin",
  );
  const references = new Set<string>();
  return value.map((item) => {
    const instruction = record(item, "host instruction");
    exactKeys(instruction, ["reference", "sha256"]);
    const reference = textField(instruction.reference, "host reference");
    sha256Field(instruction.sha256, "host instruction hash");
    requireAuthority(
      !references.has(reference),
      "duplicate host instruction reference",
      "gate-origin",
    );
    references.add(reference);
    return instruction;
  });
}

/** Verify the declared trusted origin without treating reviewed instructions as execution permission. */
function validateGateOrigin(
  context: GitContext,
  origin: JsonRecord,
  trustedBase: string | null,
  instructions: JsonRecord[],
): void {
  // A host origin must match the retained instruction record supplied by the reviewer.
  if (origin.kind === "host") {
    exactKeys(origin, ["kind", "reference", "sha256"]);
    textField(origin.reference, "host reference");
    sha256Field(origin.sha256, "host instruction hash");
    requireAuthority(
      instructions.some(
        (instruction) =>
          instruction.reference === origin.reference &&
          instruction.sha256 === origin.sha256,
      ),
      "gate host origin has no matching instruction record",
      "gate-origin",
    );
    return;
  }
  exactKeys(origin, ["kind", "revision", "path", "sha256", "literal"]);
  requireAuthority(
    origin.kind === "git" &&
      trustedBase !== null &&
      origin.revision === trustedBase,
    "gate Git origin must name the separately declared trusted base",
    "gate-origin",
  );
  const path = projectPath(origin.path);
  const state = treeFiles(context, trustedBase, new Set([path])).get(path);
  requireAuthority(
    state?.kind === "file",
    "trusted gate source file is unavailable",
    "gate-origin",
  );
  const hash = sha256Field(origin.sha256, "gate source hash");
  const literal = textField(origin.literal, "gate source literal");
  const bytes = context.blobs.get(textField(state.blob, "trusted gate blob"));
  requireAuthority(
    state.sha256 === hash && bytes?.includes(Buffer.from(literal)),
    "gate source hash or literal does not match trusted source bytes",
    "gate-origin",
  );
}

/** Check the single retained attempt without claiming the validator itself observed the process. */
function validateGateAttempt(
  gate: JsonRecord,
  snapshot: ReviewAuthoritySnapshot,
): void {
  requireAuthority(
    Array.isArray(gate.attempts) && gate.attempts.length <= 1,
    "a gate may retain at most one attempt",
    "gate-state",
  );
  const outcome = textField(gate.outcome, "gate outcome");
  requireAuthority(
    [
      "pass",
      "changed-code",
      "pre-existing",
      "infrastructure",
      "unresolved",
      "skipped",
      "unavailable",
    ].includes(outcome),
    "unsupported gate outcome",
    "gate-state",
  );
  const uncredited = outcome === "skipped" || outcome === "unavailable";
  requireAuthority(
    gate.reason === null || typeof gate.reason === "string",
    "gate reason must be text or null",
    "gate-state",
  );
  requireAuthority(
    !uncredited ||
      (typeof gate.reason === "string" && gate.reason.trim().length > 0),
    "skipped or unavailable gate needs a reason",
    "gate-state",
  );
  const value = gate.attempts[0];
  // No command was run, so only a disclosed skip or unavailability can be reported.
  if (value === undefined) {
    requireAuthority(
      uncredited,
      "unattempted gate cannot receive execution credit",
      "gate-state",
    );
    return;
  }
  validateRecordedAttempt(value, gate, snapshot, uncredited);
}

/** Match one recorded before/after state to the selected review and full execution source. */
function attemptMatches(
  attempt: JsonRecord,
  gate: JsonRecord,
  snapshot: ReviewAuthoritySnapshot,
): boolean {
  return (
    snapshot.workspace !== null &&
    gate.expectedWorkspace === snapshot.workspace &&
    attempt.reviewBefore === snapshot.fingerprint &&
    attempt.reviewAfter === snapshot.fingerprint &&
    attempt.workspaceBefore === snapshot.workspace &&
    attempt.workspaceAfter === snapshot.workspace
  );
}

/** Keep unknown execution measurements explicit; non-null measurements must be real protocol fingerprints. */
function validateAttemptFingerprints(attempt: JsonRecord): void {
  // A missing measurement may retain an uncredited attempt, but arbitrary labels or numbers cannot masquerade as source identities.
  for (const [field, kind] of [
    ["reviewBefore", "review"],
    ["reviewAfter", "review"],
    ["workspaceBefore", "workspace"],
    ["workspaceAfter", "workspace"],
  ]) {
    const value = attempt[field!];
    requireAuthority(
      value === null ||
        (typeof value === "string" &&
          new RegExp(`^${kind}-v1:sha256:[0-9a-f]{64}$`, "u").test(value)),
      "gate attempt fingerprints must use their tagged format or null for an unavailable measurement",
      "gate-state",
    );
  }
}

/** Check a retained process result; null exitCode means it did not complete and cannot prove a pass. */
function validateRecordedAttempt(
  value: JsonValue,
  gate: JsonRecord,
  snapshot: ReviewAuthoritySnapshot,
  uncredited: boolean,
): void {
  const attempt = record(value, "gate attempt");
  exactKeys(attempt, [
    "number",
    "reviewBefore",
    "reviewAfter",
    "workspaceBefore",
    "workspaceAfter",
    "exitCode",
    "output",
  ]);
  validateAttemptFingerprints(attempt);
  requireAuthority(
    attempt.number === 1 && typeof attempt.output === "string",
    "gate attempt requires number 1 and literal output, including empty output",
    "gate-state",
  );
  requireAuthority(
    attempt.exitCode === null ||
      (typeof attempt.exitCode === "number" &&
        Number.isSafeInteger(attempt.exitCode)),
    "gate exitCode must be an integer or null",
    "gate-state",
  );
  const matches = attemptMatches(attempt, gate, snapshot);
  requireAuthority(
    matches || (uncredited && gate.reason === "selected-state-mismatch"),
    "gate ran against another or unavailable selected state; record skipped/unavailable with selected-state-mismatch",
    "gate-state",
  );
  requireAuthority(
    gate.outcome !== "pass" || (matches && attempt.exitCode === 0),
    "passing gate requires matching before/after source state and exit code 0",
    "gate-state",
  );
  validateFailureOutcome(gate, attempt);
}

/** Reject failure classifications without a completed failure or their stated causality evidence. */
function validateFailureOutcome(gate: JsonRecord, attempt: JsonRecord): void {
  // Completed failures require an actual nonzero exit; interruption can describe infrastructure trouble only.
  const outcome = textField(gate.outcome, "gate outcome");
  requireAuthority(
    !["changed-code", "pre-existing", "unresolved"].includes(outcome) ||
      (typeof attempt.exitCode === "number" && attempt.exitCode !== 0),
    "changed-code, pre-existing, and unresolved gates require a completed nonzero exit",
    "gate-state",
  );
  requireAuthority(
    gate.outcome !== "infrastructure" || attempt.exitCode !== 0,
    "infrastructure failure requires a failed or interrupted attempt",
    "gate-state",
  );
  // A classified failure needs the host's causality, base, or environment explanation beside the actual attempt.
  requireAuthority(
    !["changed-code", "pre-existing", "infrastructure"].includes(outcome) ||
      (typeof gate.reason === "string" && gate.reason.trim().length > 0),
    "classified failure requires changed-source causality, base evidence, or an environment reason",
    "gate-state",
  );
}

/** Validate one command identity, origin, and attempt under the report's fixed authority. */
function validateGate(
  context: GitContext,
  value: JsonValue,
  snapshot: ReviewAuthoritySnapshot,
  trustedBase: string | null,
  instructions: JsonRecord[],
  identities: Set<string>,
): void {
  const gate = record(value, "gate");
  exactKeys(gate, [
    "id",
    "argv",
    "cwd",
    "origin",
    "expectedWorkspace",
    "attempts",
    "outcome",
    "reason",
  ]);
  requireAuthority(
    Array.isArray(gate.argv) &&
      gate.argv.length > 0 &&
      gate.argv.every(
        (argument) => typeof argument === "string" && !argument.includes("\0"),
      ) &&
      gate.argv[0] !== "",
    "gate argv must identify one literal command",
    "gate-origin",
  );
  const cwd = projectPath(gate.cwd, true);
  const origin = record(gate.origin, "gate origin");
  validateGateOrigin(context, origin, trustedBase, instructions);
  const identifier = reviewGateId(gate.argv as string[], cwd, origin);
  requireAuthority(
    gate.id === identifier && !identities.has(identifier),
    "gate identity is invalid or duplicated",
    "gate-origin",
  );
  identities.add(identifier);
  requireAuthority(
    gate.expectedWorkspace === snapshot.workspace,
    "gate expectedWorkspace must equal the selected authority workspace, including null when unavailable",
    "gate-state",
  );
  validateGateAttempt(gate, snapshot);
}

/**
 * Validate recorded gate provenance and source-state consistency without executing a command.
 *
 * @param text - exactly one canonical gates record; an empty gate list means no execution credit
 * @param projectRoot - reviewed project where a trusted Git source must resolve
 * @param snapshot - original review authority shared by every recorded attempt
 *
 * @param claimedGates - readable Gates field, or null for a compact receipt without that field
 * @param line - visible report location; null means the report as a whole
 * @param violations - appended failures; host consent and actual historic execution remain outside this validator's proof
 */
function validateReviewGates(
  text: string,
  projectRoot: string,
  snapshot: ReviewAuthoritySnapshot,
  claimedGates: string | null,
  line: number | null,
  violations: ReviewValidationViolation[],
): JsonRecord[] | null {
  try {
    const gates = record(parseReviewJson(text, true), "gate authority");
    exactKeys(gates, [
      "schema",
      "review",
      "trustedBase",
      "hostInstructions",
      "gates",
    ]);
    requireAuthority(
      gates.schema === "goat-review-gates/v1" &&
        gates.review === snapshot.fingerprint,
      "gate authority must bind this review fingerprint",
      "gate-state",
    );
    const context = gitContext(projectRoot);
    const trustedBase =
      gates.trustedBase === null ? null : commitId(context, gates.trustedBase);
    requireAuthority(
      gates.trustedBase === trustedBase,
      "trustedBase must be a full resolved commit ID or null",
      "gate-origin",
    );
    const instructions = hostInstructions(gates.hostInstructions);
    requireAuthority(
      Array.isArray(gates.gates),
      "gates must be an array",
      "gate-state",
    );
    requireAuthority(
      claimedGates !== "run" || gates.gates.length > 0,
      "empty gate inventory cannot claim Gates: run",
      "gate-state",
    );
    const identities = new Set<string>();
    // Each selected command contributes one identity, even if its underlying test runner reports many assertions.
    for (const gate of gates.gates)
      validateGate(
        context,
        gate,
        snapshot,
        trustedBase,
        instructions,
        identities,
      );
    requireAuthority(
      claimedGates !== "run" ||
        gates.gates.every(
          (value) =>
            !["skipped", "unavailable"].includes(
              record(value, "gate").outcome as string,
            ),
        ),
      "Gates: run requires every selected gate to execute on its matching source state",
      "gate-state",
    );
    return gates.gates.map((gate) => record(gate, "gate"));
  } catch (error) {
    // A report may cite a changed package script or a different checkout; preserve the provenance/state refusal without running it.
    addViolation(
      violations,
      error instanceof ReviewAuthorityError
        ? error.code
        : "authority-unsupported",
      line,
      error instanceof ReviewAuthorityError
        ? error.message
        : "cannot read gate authority",
    );
    return null;
  }
}
