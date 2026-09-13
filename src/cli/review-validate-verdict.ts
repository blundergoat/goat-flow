/**
 * Check that the Ship Verdict follows the report's active findings and declared confidence.
 *
 * Use after findings and integrity fields are parsed, in either full or compact output.
 * An active MUST blocks shipping; reduced confidence lowers the finding-derived verdict once.
 */
import {
  SURFACED_FINDING_SECTIONS,
  FULL_SHIP_VERDICT,
  COMPACT_SHIP_VERDICT,
  SHIP_VERDICT_LADDER,
  readSections,
  addViolation,
  KNOWN_DEGRADATION_FLAGS,
  RETIRED_DEGRADATION_FLAGS,
  readIntegrityJson,
  record,
  requireAuthority,
  type IntegrityFieldMap,
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
  // The reader needs exactly one decision line to act on the review.
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
    // A second compact verdict would give the reader a competing outcome beside the full decision.
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
 * Require the exact conclusion justified by the report's disclosed limits.
 *
 * @param flags - normalized limits and disclosures; intent-unstated and base-fetch-skipped alone do not reduce confidence
 * @param conclusion - claimed coverage level; absent or malformed values fail elsewhere
 * @param line - source line attached to a confidence contradiction
 * @param violations - report errors to append when the claimed confidence differs from its disclosed limits
 */
function validateDegradationConclusion(
  flags: ReadonlySet<string>,
  conclusion: string | undefined,
  line: number,
  violations: ReviewValidationViolation[],
): void {
  const requiredConclusion = conclusionForDegradationFlags(flags);
  // Confidence describes the strongest disclosed limit once, regardless of how many flags explain it.
  if (conclusion === requiredConclusion || conclusion === undefined) return;
  addViolation(
    violations,
    "integrity-format",
    line,
    `degradation flags require Conclusion: ${requiredConclusion}`,
  );
}

/**
 * Combine disclosed limits once; partial source/depth coverage outranks coverage gaps, which outrank inferred evidence.
 *
 * @param flags - declared limits and disclosures; empty or disclosure-only sets permit confident
 * @returns strongest applicable confidence limit, applied once across all flags
 */
function conclusionForDegradationFlags(
  flags: ReadonlySet<string>,
): ReviewIntegrityConclusion {
  const limits = [...flags].filter(
    (flag) => !["none", "intent-unstated", "base-fetch-skipped"].includes(flag),
  );
  // Incomplete chunks or a declined depth pass cannot claim a completed review.
  if (
    limits.some((flag) =>
      ["chunked-partial", "risk-depth-declined"].includes(flag),
    )
  )
    return "partial";
  const inferenceFlags = new Set([
    "high-inference-ratio",
    "not-reproduced-findings",
    "cross-model-unresolved",
    "refuter-citation-unverified",
  ]);
  // Missing coverage or execution evidence takes precedence over the quality of the remaining findings.
  if (limits.some((flag) => !inferenceFlags.has(flag)))
    return "coverage-degraded";
  return limits.length > 0 ? "high-inference" : "confident";
}

/**
 * Derive the decision users should see from surfaced severity and integrity confidence.
 *
 * @param definitions - parsed active findings and optional refuter history; empty means the report defines no issue IDs
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
 * @param definitions - parsed active findings and optional refuter history; empty means the report defines no issue IDs
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
  // An unfinished human/refuter decision belongs only in a draft and cannot hide an already visible blocker.
  if (verdictClaim.decision === "PENDING REFUTER/HUMAN") {
    // A final report or an already blocking finding cannot use a pending decision to defer its required verdict.
    if (
      integrity.validationStage !== "draft" ||
      definitions.some(
        (definition) =>
          SURFACED_FINDING_SECTIONS.has(definition.section) &&
          (definition.severity === "MUST" ||
            definition.action === "intent-mismatch"),
      )
    )
      addViolation(
        violations,
        "ship-verdict-contradiction",
        verdictClaim.line,
        "PENDING REFUTER/HUMAN cannot certify final proof or conceal an active blocker",
      );
    return;
  }
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
 * Read the validated integrity conclusion used to apply the user-visible verdict downgrade.
 *
 * @param fields - visible integrity fields collected from either report presentation
 * @returns recognized conclusion; null leaves absent or malformed confidence to the field validator
 */
export function readIntegrityConclusion(
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

/** Reject undocumented limitation tokens so a report cannot invent its own confidence rules. */
function rejectUnknownDegradationFlags(
  flags: ReadonlySet<string>,
  line: number,
  violations: ReviewValidationViolation[],
): void {
  // Every declared token must have a defined confidence effect before the report can pass.
  for (const flag of flags) {
    const configuredBase = /^configured-base-unresolved=\S+$/u.test(flag);
    // Recognized tokens and separately rejected retired tokens need no second unknown-token error.
    if (
      KNOWN_DEGRADATION_FLAGS.has(flag) ||
      RETIRED_DEGRADATION_FLAGS.has(flag) ||
      configuredBase
    )
      continue;
    addViolation(
      violations,
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

/**
 * Validate declared limitation tokens and their required confidence before deriving a ship verdict.
 *
 * @param fields - visible integrity fields; a missing flags row is diagnosed by the required-field check
 * @param violations - errors to append for unknown, duplicate, empty, retired, or inconsistent flags
 * @returns unique declared tokens, including invalid ones for subsequent checks; empty means no flags row was available
 */
export function validateDegradationFlags(
  fields: IntegrityFieldMap,
  violations: ReviewValidationViolation[],
): Set<string> {
  const field = fields.get("Degradation flags");
  // A missing row is already explained by the required-field check shown to the reviewer.
  if (!field) return new Set();
  const listedFlags = field.value.split(",").map((flag) => flag.trim());
  const flags = new Set(listedFlags);
  // Duplicate tokens cannot stand in for independent evidence about the same limitation.
  if (flags.size !== listedFlags.length)
    addViolation(
      violations,
      "integrity-format",
      field.line,
      "Degradation flags must not contain duplicate tokens",
    );

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
  rejectUnknownDegradationFlags(flags, field.line, violations);
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

/**
 * Require one nonempty explanation for each declared limit; explanations disclose host work rather than proving it occurred.
 *
 * @param integrity - declared flags and their explanation map; no flags requires an empty object
 * @param violations - errors to append for missing, extra, or incompatible explanations
 */
export function validateDegradationEvidence(
  integrity: IntegrityResult,
  violations: ReviewValidationViolation[],
): void {
  const field = integrity.fields.get("Degradation evidence");
  const value = readIntegrityJson(
    integrity.fields,
    "Degradation evidence",
    violations,
  );
  try {
    const evidence = record(value, "Degradation evidence");
    const flags = [...integrity.flags].filter((flag) => flag !== "none");
    requireAuthority(
      Object.keys(evidence).length === flags.length &&
        flags.every(
          (flag) =>
            typeof evidence[flag] === "string" &&
            evidence[flag].trim().length > 0,
        ),
      "Degradation evidence must contain exactly one nonempty explanation per emitted flag; none uses {}",
    );
    const authority = integrity.anchorAuthority;
    // A fetch limitation can refer only to a resolved local comparison; a flag cannot create missing source authority.
    if (
      flags.some((flag) =>
        ["base-fetch-skipped", "base-fetch-failed"].includes(flag),
      ) &&
      authority.kind === "snapshot"
    )
      requireAuthority(
        reviewScopeLabels(authority.snapshot).base !== "n/a",
        "base-fetch disclosures require a resolved local comparison and no remote-freshness claim",
      );
    // A PR ingestion failure must refer to an actual PR review, not a local review without that data source.
    if (
      flags.includes("automated-review-uningested") &&
      authority.kind === "snapshot"
    )
      requireAuthority(
        authority.snapshot.source.kind === "pr",
        "automated-review-uningested requires a PR ingestion surface",
      );
  } catch (error) {
    // A reviewer may add a limitation without its reason or retain stale evidence after removing the flag.
    addViolation(
      violations,
      "integrity-format",
      field?.line ?? null,
      error instanceof Error ? error.message : "invalid Degradation evidence",
    );
  }
}

import { reviewScopeLabels } from "./review-validate-authority.js";
