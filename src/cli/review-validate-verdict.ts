/**
 * Checks that a review's Ship Verdict matches the findings it actually raised.
 * The verdict is the one line a reader acts on, so it must be derivable from the report rather
 * than asserted: an open MUST cannot coexist with a clean YES, and a verdict may be downgraded
 * by degradation flags even when every finding was resolved.
 *
 * Both the full and compact report shapes are handled, because a compact clean review states
 * its verdict in a different form while carrying the same obligation to be earned.
 */
import {
  SURFACED_FINDING_SECTIONS,
  FULL_SHIP_VERDICT,
  COMPACT_SHIP_VERDICT,
  SHIP_VERDICT_LADDER,
  readSections,
  addViolation,
  type ReviewValidationViolation,
  type MarkdownSection,
  type IntegrityResult,
  type FindingDefinition,
  type ReviewIntegrityConclusion,
  type ShipVerdictDecision,
  type ShipVerdictClaim,
} from "./review-validate-common.js";

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
  const compactVerdictLines = lines
    .map((text, lineIndex) => ({ line: lineIndex + 1, text }))
    .filter(({ text }) => /^\s*Ship Verdict:/u.test(text));
  // Full reports show the decision beneath a dedicated heading.
  if (fullVerdictSection) {
    for (const compactVerdict of compactVerdictLines) {
      addViolation(
        violations,
        "ship-verdict-format",
        compactVerdict.line,
        "Ship Verdict cannot mix compact and full forms",
      );
    }
    return readFullShipVerdictClaim(
      fullVerdictSection,
      fullVerdictSections.slice(1),
      violations,
    );
  }

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

/**
 * Reject the strongest confidence claim when the reviewer disclosed reduced coverage.
 *
 * @param flags - normalized disclosure tokens; `none` is the only non-degrading value
 * @param conclusion - claimed coverage level; absent or malformed values fail elsewhere
 * @param line - source line attached to a confidence contradiction
 * @param violations - shared structural failures, appended only for overconfidence
 */
export function validateDegradationConclusion(
  flags: ReadonlySet<string>,
  conclusion: string | undefined,
  line: number,
  violations: ReviewValidationViolation[],
): void {
  const hasDegradation = Array.from(flags).some(
    (flag) => flag.length > 0 && flag !== "none",
  );
  if (!hasDegradation || conclusion !== "confident") return;
  addViolation(
    violations,
    "integrity-format",
    line,
    "degradation flags require a non-confident Conclusion",
  );
}

/**
 * Derive the decision users should see from surfaced severity and integrity confidence.
 *
 * @param definitions - findings parsed from the report; empty means the review raised none, which is legitimate only if it also attests to that
 * @param conclusion - the report's own coverage conclusion; an absent one means the author did not state how complete the review was
 * @param isRiskDepthDeclined - whether the author explicitly declined risk-depth analysis, which is allowed but must be stated
 * @returns the verdict the findings actually justify, which the report's own verdict is compared against
 */
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

/**
 * Reject a final decision that understates or contradicts the report's visible risk surface.
 *
 * @param lines - the report split into lines; an empty report fails earlier than this
 * @param integrity - the parsed Review Integrity block; absent fields are reported individually rather than failing the whole block
 * @param definitions - findings parsed from the report; empty means the review raised none, which is legitimate only if it also attests to that
 * @param violations - shared violation list, appended in report order so a reader sees issues top-down; a violation makes the report fail
 */
export function validateShipVerdict(
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
