/**
 * Check that readers can follow each finding, refutation, and cross-reference in the report.
 *
 * Use after parsing integrity fields to reconcile active IDs, final outcomes, evidence, and provenance totals.
 * Optional section-shape issues remain warnings; contradictory evidence or undefined references fail validation.
 */
import {
  FINDING_SECTIONS,
  SURFACED_FINDING_SECTIONS,
  OPTIONAL_SECTIONS,
  TOP_FIVE_HEADINGS,
  FINDING_CANDIDATE,
  FINDING_PREFIX,
  ANCHOR,
  SPEC_DRIFT_LINE,
  readSections,
  readSection,
  addViolation,
  readSafeIntegrityCount,
  readFindingPrefixTags,
  type IntegrityFieldMap,
  type EvidenceCountClaim,
  type VerdictCountClaim,
  addWarning,
  readIntegrityJson,
  requireDegradationReferences,
  record,
  requireAuthority,
  type ReviewValidationViolation,
  type MarkdownSection,
  type IntegrityResult,
  type FindingDefinition,
  type ReviewAnchorAuthority,
  type FinalDisposition,
  type JsonRecord,
  type IntegrityField,
} from "./review-validate-common.js";
import {
  validateAnchor,
  validateFindingLine,
} from "./review-validate-anchors.js";

/**
 * Validate finding definitions in every output section that owns R-IDs.
 *
 * @param lines - the report split into lines; an empty report fails earlier than this
 * @param isAreaAudit - whether the report declared itself an area audit, which relaxes some coverage expectations
 * @param projectRoot - reviewed project root; anchors are confined to it so a report cannot cite files it was never authorised to read
 * @param authority - selected live, index, or Git source used to resolve anchors; invalid authority supplies no evidence
 * @param violations - shared violation list, appended in report order so a reader sees issues top-down; a violation makes the report fail
 * @returns findings parsed from every recognised section; empty means the report surfaced none
 */
export function validateFindingSections(
  lines: string[],
  isAreaAudit: boolean,
  projectRoot: string,
  authority: ReviewAnchorAuthority,
  violations: ReviewValidationViolation[],
): FindingDefinition[] {
  const definitions: FindingDefinition[] = [];
  // Findings and optional refuter history are the sections that can define IDs used elsewhere in the report.
  for (const heading of FINDING_SECTIONS) {
    const sections = readSections(lines, heading);
    const section = sections.at(0);
    // Repeated finding sections leave readers without one authoritative set for that heading.
    for (const duplicate of sections.slice(1)) {
      addViolation(
        violations,
        "finding-section-duplicate",
        duplicate.headingLine,
        `${heading} duplicates the section at line ${section?.headingLine ?? "unknown"}`,
      );
    }
    const locatedLines = section?.lines ?? [];
    // Read each visible bullet so valid findings can participate in the report's cross-section checks.
    for (const locatedLine of locatedLines) {
      const definition = validateFindingLine(
        locatedLine,
        heading,
        isAreaAudit,
        projectRoot,
        authority,
        violations,
      );
      // Non-finding prose contributes no issue ID; malformed findings have already received their own violation.
      if (definition)
        definitions.push({ ...definition, text: locatedLine.text });
    }
  }
  return definitions;
}

/**
 * Count live finding-like bullets before selecting full or compact integrity.
 *
 * @param lines - the report split into lines; an empty report fails earlier than this
 * @returns how many list items look like findings, used to distinguish an empty section from a malformed one
 */
export function countFindingCandidates(lines: string[]): number {
  return FINDING_SECTIONS.flatMap((heading) => readSections(lines, heading))
    .flatMap((section) => section.lines)
    .filter((locatedLine) => FINDING_CANDIDATE.test(locatedLine.text)).length;
}

/**
 * Fail every repeated finding definition at its later source line.
 *
 * @param definitions - parsed active findings and optional refuter history; empty means the report defines no issue IDs
 * @param violations - shared violation list, appended in report order so a reader sees issues top-down; a violation makes the report fail
 */
export function validateUniqueFindingIds(
  definitions: FindingDefinition[],
  violations: ReviewValidationViolation[],
): void {
  const firstLines = new Map<string, number>();
  // Retain the first definition so a repeated ID points the reviewer back to the conflicting finding.
  for (const definition of definitions) {
    const firstLine = firstLines.get(definition.id);
    // An unseen ID establishes the location later references must identify.
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

/**
 * Reconcile integrity totals with visible findings and the refutation ledger claim.
 *
 * @param integrity - the parsed Review Integrity block; absent fields are reported individually rather than failing the whole block
 * @param definitions - parsed active findings and optional refuter history; empty means the report defines no issue IDs
 * @param violations - shared violation list, appended in report order so a reader sees issues top-down; a violation makes the report fail
 */
export function validateIntegrityCounts(
  integrity: IntegrityResult,
  definitions: FindingDefinition[],
  violations: ReviewValidationViolation[],
): void {
  const active = definitions.filter((definition) =>
    SURFACED_FINDING_SECTIONS.has(definition.section),
  );
  validateFinalDispositions(integrity, definitions, violations);
  validateRefuterOutcomes(integrity, definitions, violations);
  validateActiveProvenance(integrity, active, violations);
  // Valid evidence totals can be checked against active findings; malformed totals already have a field error.
  if (integrity.evidenceCounts) {
    const observed = active.filter(
      (definition) => definition.evidence === "OBSERVED",
    ).length;
    const inferred = active.filter(
      (definition) => definition.evidence === "INFERRED",
    ).length;
    // More inferred than observed active findings requires its specific evidence limitation, excluding refuted history.
    if (inferred > observed !== integrity.flags.has("high-inference-ratio"))
      addViolation(
        violations,
        "integrity-format",
        integrity.evidenceCounts.line,
        "high-inference-ratio must be present exactly when active INFERRED findings outnumber OBSERVED findings",
      );
    const unreproduced = active.filter((definition) =>
      /\|\s*Proof:\s*NOT-REPRODUCED(?:\s*\||\s*$)/u.test(definition.text ?? ""),
    );
    // Unreproduced active findings need a visible limitation, while refuted history cannot justify that flag.
    if (
      unreproduced.length > 0 !==
      integrity.flags.has("not-reproduced-findings")
    )
      addViolation(
        violations,
        "integrity-format",
        integrity.evidenceCounts.line,
        "active NOT-REPRODUCED findings require not-reproduced-findings; the flag requires such an active finding",
      );
    requireDegradationReferences(
      integrity,
      "high-inference-ratio",
      [`${observed} OBSERVED`, `${inferred} INFERRED`],
      violations,
    );
    requireDegradationReferences(
      integrity,
      "not-reproduced-findings",
      unreproduced.map((finding) => finding.id),
      violations,
    );
    // Evidence totals describe surviving concerns and must not include historical refutations.
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

  // Without parsed verdict totals, stop arithmetic checks and leave the existing field error actionable.
  if (!integrity.verdictCounts) return;
  const visibleVerdicts =
    integrity.verdictCounts.confirmed +
    integrity.verdictCounts.adjusted +
    integrity.verdictCounts.unresolved;
  // Every surviving concern needs exactly one confirmed, adjusted, or unresolved count.
  if (
    !Number.isSafeInteger(visibleVerdicts) ||
    visibleVerdicts !== active.length
  ) {
    addViolation(
      violations,
      "integrity-format",
      integrity.verdictCounts.line,
      `Verdicts claim ${visibleVerdicts} confirmed, adjusted, or unresolved results but ${active.length} active findings are defined`,
    );
  }
  // A refutation earns one verdict only when the ledger claim accounts for it.
  if (integrity.verdictCounts.refuted !== integrity.refutationsLogged) {
    addViolation(
      violations,
      "integrity-format",
      integrity.verdictCounts.line,
      `Verdicts claim ${integrity.verdictCounts.refuted} refuted results but Refutations logged claims ${integrity.refutationsLogged}`,
    );
  }
}

/** Reconcile one final disposition per ID, using legacy inference only when every outcome is uniquely recoverable. */
function validateFinalDispositions(
  integrity: IntegrityResult,
  definitions: FindingDefinition[],
  violations: ReviewValidationViolation[],
): void {
  const active = definitions.filter((definition) =>
    SURFACED_FINDING_SECTIONS.has(definition.section),
  );
  inferLegacyDispositions(integrity, active, violations);
  const counts = integrity.verdictCounts;
  const dispositions = integrity.finalDispositions;
  // Ambiguous legacy output needs explicit IDs before any final counts can be trusted.
  if (!dispositions) {
    addViolation(
      violations,
      "integrity-format",
      counts?.line ?? null,
      "add Final dispositions: a canonical R-ID map; legacy outcomes cannot be inferred unambiguously",
    );
    return;
  }
  const tally = { confirmed: 0, adjusted: 0, refuted: 0, unresolved: 0 };
  // Each map entry contributes once; active placement must agree with the final outcome.
  for (const [id, disposition] of Object.entries(dispositions)) {
    tally[disposition] += 1;
    const definition = active.find((candidate) => candidate.id === id);
    // Refuted IDs cannot survive as active findings, and surviving IDs need a visible finding.
    if ((disposition === "refuted") === Boolean(definition))
      addViolation(
        violations,
        "integrity-format",
        counts?.line ?? null,
        `${id} disposition ${disposition} does not match its active/refuted placement`,
      );
  }
  validateDispositionPlacement(dispositions, definitions, violations);
  // Matching grand totals cannot hide a different distribution of confirmed, adjusted, and unresolved findings.
  if (
    counts &&
    Object.entries(tally).some(
      ([outcome, total]) => counts[outcome as keyof typeof tally] !== total,
    )
  )
    addViolation(
      violations,
      "integrity-format",
      counts.line,
      "Verdicts must match the exact Final dispositions distribution",
    );
  validateRefutedIds(integrity, dispositions, violations);
}

/** Recover legacy IDs only when every surviving result is confirmed and any refuted IDs come from an available ledger. */
function inferLegacyDispositions(
  integrity: IntegrityResult,
  active: FindingDefinition[],
  violations: ReviewValidationViolation[],
): void {
  const counts = integrity.verdictCounts;
  // Missing maps can preserve old confirmed-only output when no adjusted or unresolved identity needs to be guessed.
  if (
    integrity.fields.has("Final dispositions") ||
    !counts ||
    counts.adjusted !== 0 ||
    counts.unresolved !== 0 ||
    counts.confirmed !== active.length
  )
    return;
  // Without ledger bytes, a nonzero refuted total cannot identify which suspicions were dismissed.
  if (integrity.refutationsLogged > 0 && integrity.ledgerIds === null) return;
  const dispositions: Record<string, FinalDisposition> = Object.fromEntries(
    active.map((definition) => [definition.id, "confirmed"]),
  );
  addLegacyRefutedIds(
    integrity.ledgerIds ?? [],
    dispositions,
    counts.line,
    violations,
  );
  integrity.finalDispositions = dispositions;
}

/** Add available legacy refutations, reporting any ID that would also survive as an active finding. */
function addLegacyRefutedIds(
  ids: string[],
  dispositions: Record<string, FinalDisposition>,
  line: number,
  violations: ReviewValidationViolation[],
): void {
  // Available ledger IDs determine refutations only if none is also an active finding.
  for (const id of ids) {
    // A surviving legacy finding cannot also be inferred as a refutation from ledger history.
    if (dispositions[id])
      addViolation(
        violations,
        "integrity-format",
        line,
        `${id} cannot be both active and refuted`,
      );
    dispositions[id] = "refuted";
  }
}

/** Keep refuted history separate and show each unresolved concern as a request for proof or a decision. */
function validateDispositionPlacement(
  dispositions: Record<string, FinalDisposition>,
  definitions: FindingDefinition[],
  violations: ReviewValidationViolation[],
): void {
  // History is a view of the same refuted ID; it never increments the surviving counts.
  for (const definition of definitions) {
    const disposition = dispositions[definition.id];
    // History must remain refuted, and every defined ID needs an explicit or safely inferred final outcome.
    if (
      !disposition ||
      (definition.section === "Refuted by Refuter" && disposition !== "refuted")
    )
      addViolation(
        violations,
        "integrity-format",
        definition.line,
        `${definition.id} needs one matching final disposition; Refuted by Refuter requires refuted`,
      );
    // An unresolved concern must stay visible as an unconfirmed decision/signal request with a useful next check.
    if (disposition === "unresolved")
      validateUnresolvedFinding(definition, violations);
  }
}

/** Require an unconfirmed title and useful next check before an unresolved item can appear beside established findings. */
function validateUnresolvedFinding(
  definition: FindingDefinition,
  violations: ReviewValidationViolation[],
): void {
  const text = definition.text ?? "";
  const title =
    text.match(FINDING_PREFIX)?.[0].match(/\*\*([^*]+)\*\*/u)?.[1] ?? "";
  // A patch request or missing evidence capsule would present uncertainty as an established defect.
  if (
    !/^Unconfirmed:\s*\S/u.test(title) ||
    !["needs-decision", "needs-signal"].includes(definition.action) ||
    !/\|\s*Missing proof:\s*[^|\s][^|]*(?=\s*(?:\||$))/u.test(text) ||
    !/\|\s*Next check:\s*[^|\s][^|]*(?=\s*(?:\||$))/u.test(text)
  )
    addViolation(
      violations,
      "integrity-format",
      definition.line,
      `${definition.id} unresolved needs an Unconfirmed: title, needs-decision/needs-signal action, Missing proof, and Next check`,
    );
}

/** Match the final refuted IDs to the declared count and to ledger contents whenever those contents are available. */
function validateRefutedIds(
  integrity: IntegrityResult,
  dispositions: Record<string, FinalDisposition>,
  violations: ReviewValidationViolation[],
): void {
  const refuted = Object.keys(dispositions)
    .filter((id) => dispositions[id] === "refuted")
    .sort();
  // Available ledger IDs must match the refuted set exactly; skipped persistence retains only the declared-count check.
  if (
    refuted.length !== integrity.refutationsLogged ||
    (integrity.ledgerIds !== null &&
      JSON.stringify([...integrity.ledgerIds].sort()) !==
        JSON.stringify(refuted))
  )
    addViolation(
      violations,
      "refutation-ledger",
      integrity.refutationsLine,
      "refutation ledger unique IDs must equal Final dispositions refuted IDs and Refutations logged",
    );
}

/** Match host-accepted refuter outcomes to their final IDs while keeping verified leads outside the submitted-ID counts. */
function validateRefuterOutcomes(
  integrity: IntegrityResult,
  definitions: FindingDefinition[],
  violations: ReviewValidationViolation[],
): void {
  const field = integrity.fields.get("Refuter pass");
  const match = field?.value.match(
    /^(yes|no|skipped);\s*confirmed=(\d+),\s*refuted=(\d+),\s*unresolved=(\d+),\s*leads-verified=(\d+),\s*model=(\S.*)$/u,
  );
  const rawOutcomes = readIntegrityJson(
    integrity.fields,
    "Refuter outcomes",
    violations,
  );
  try {
    const outcomes = record(
      integrity.fields.has("Refuter outcomes") ? rawOutcomes : {},
      "Refuter outcomes",
    );
    const counts = readRefuterRunCounts(match, outcomes);
    const tally = tallyRefuterOutcomes(outcomes, integrity);
    requireAuthority(
      [tally.confirmed, tally.refuted, tally.unresolved].every(
        (count, index) => count === counts[index],
      ),
      "Refuter pass counts require matching per-ID Refuter outcomes; verified leads are separate",
    );
    const availableLeads = definitions.filter(
      (definition) =>
        SURFACED_FINDING_SECTIONS.has(definition.section) &&
        !Object.hasOwn(outcomes, definition.id) &&
        ["confirmed", "adjusted"].includes(
          integrity.finalDispositions?.[definition.id] ?? "",
        ),
    );
    requireAuthority(
      counts[3]! <= availableLeads.length,
      "verified refuter leads cannot exceed active confirmed/adjusted IDs outside the submitted outcomes",
    );
    requireAuthority(
      tally.unresolved > 0 === integrity.flags.has("cross-model-unresolved"),
      "cross-model-unresolved must match host-accepted unresolved refuter outcomes",
    );
    requireDegradationReferences(
      integrity,
      "cross-model-unresolved",
      Object.keys(outcomes).filter((id) => outcomes[id] === "unresolved"),
      violations,
    );
    validateRefuterTags(outcomes, definitions);
  } catch (error) {
    // A copied refuter total or stale synthesis tag cannot supply a different finding's verification.
    addViolation(
      violations,
      "integrity-format",
      field?.line ?? null,
      error instanceof Error ? error.message : "invalid refuter reconciliation",
    );
  }
}

/** Read the refuter's counts, rejecting claimed results from a declined or absent run. */
function readRefuterRunCounts(
  match: RegExpMatchArray | null | undefined,
  outcomes: JsonRecord,
): number[] {
  const counts = match ? match.slice(2, 6).map(Number) : [0, 0, 0, 0];
  requireAuthority(
    counts.every(Number.isSafeInteger),
    "Refuter pass counts must be safe integers",
  );
  const didRun = match?.[1] === "yes";
  requireAuthority(
    didRun ||
      (counts.every((count) => count === 0) &&
        (!match || match[6] === "n/a") &&
        Object.keys(outcomes).length === 0),
    "no/skipped refuter requires zero counts, model=n/a, and no outcomes",
  );
  requireAuthority(
    !didRun || match?.[6] !== "n/a",
    "a completed refuter needs its actual model identifier",
  );
  return counts;
}

/** Count host-accepted outcomes once per submitted ID; throw when synthesis contradicts that ID's final disposition. */
function tallyRefuterOutcomes(
  outcomes: JsonRecord,
  integrity: IntegrityResult,
): { confirmed: number; refuted: number; unresolved: number } {
  const tally = { confirmed: 0, refuted: 0, unresolved: 0 };
  // Submitted IDs must keep a compatible final result; leads cannot masquerade as refuted or confirmed submissions.
  for (const [id, outcome] of Object.entries(outcomes)) {
    requireAuthority(
      /^R-\d{3}$/u.test(id) &&
        (outcome === "confirmed" ||
          outcome === "refuted" ||
          outcome === "unresolved"),
      "Refuter outcomes needs R-IDs and confirmed/refuted/unresolved values",
    );
    const disposition = integrity.finalDispositions?.[id];
    requireAuthority(
      disposition &&
        (outcome === "confirmed"
          ? ["confirmed", "adjusted"].includes(disposition)
          : disposition === outcome),
      `${id} refuter outcome conflicts with its final disposition`,
    );
    tally[outcome] += 1;
  }
  return tally;
}

/** Reject history or cross-model tags that do not have a matching host-accepted refuter result. */
function validateRefuterTags(
  outcomes: JsonRecord,
  definitions: FindingDefinition[],
): void {
  // Historical refutations and cross-model confirmation tags both require the host-accepted outcome for that same ID.
  for (const definition of definitions) {
    // Refuter history requires a matching host-verified refutation for the same issue.
    if (definition.section === "Refuted by Refuter")
      requireAuthority(
        outcomes[definition.id] === "refuted",
        `${definition.id} history requires a host-verified refuted Refuter outcome`,
      );
    // A cross-model confirmation label must be backed by that finding's accepted refuter result.
    if (
      readFindingPrefixTags(definition.text ?? "").includes(
        "CONFIRMED-CROSS-MODEL",
      ) &&
      definition.section !== "Refuted by Refuter"
    )
      requireAuthority(
        outcomes[definition.id] === "confirmed",
        `${definition.id} cross-model tag requires a confirmed Refuter outcome`,
      );
  }
}

/** Compare PR provenance counters and missed-ID lists with active findings only; historical tags remain historical context. */
function validateActiveProvenance(
  integrity: IntegrityResult,
  active: FindingDefinition[],
  violations: ReviewValidationViolation[],
): void {
  const field = integrity.fields.get("Automated-review provenance");
  const isPr =
    integrity.anchorAuthority.kind === "snapshot" &&
    integrity.anchorAuthority.snapshot.source.kind === "pr";
  // Local output may omit this PR-only surface; a truthful legacy n/a adds no provenance claim.
  if (!isPr) {
    validateLocalProvenance(field, active, violations);
    return;
  }
  // A missing provenance field has already been handled by scope requirements; do not invent PR counters.
  if (!field) return;
  const classes = [
    "overlap-confirmed",
    "local-only",
    "bot-only-locally-verified",
    "disputed-match",
  ];
  const ids = classes.map((kind) =>
    active
      .filter((definition) =>
        readFindingPrefixTags(definition.text ?? "").some(
          (tag) => tag.split(":")[0] === kind,
        ),
      )
      .map((definition) => definition.id)
      .sort(),
  );
  // No bot activity or unavailable ingestion grants no bot-derived tags; ingestion failure must stay distinct from an empty successful response.
  if (field.value === "no-automated-review-present" || field.value === "n/a") {
    validateAbsentPrProvenance(field, integrity, ids, violations);
    return;
  }
  validatePrProvenanceCounts(field, active, ids, violations);
}

/** Keep local review output free of claims about PR bot activity. */
function validateLocalProvenance(
  field: IntegrityField | undefined,
  active: FindingDefinition[],
  violations: ReviewValidationViolation[],
): void {
  // A local review has no PR ingestion surface to support numeric bot counts.
  if (field && field.value !== "n/a")
    addViolation(
      violations,
      "integrity-format",
      field.line,
      "outside PR mode omit Automated-review provenance or use n/a",
    );
  // Bot-derived tags would imply PR evidence that this source selection cannot provide.
  if (
    active.some((definition) =>
      readFindingPrefixTags(definition.text ?? "").some((tag) =>
        /^(?:overlap-confirmed|bot-only-locally-verified|disputed-match):/u.test(
          tag,
        ),
      ),
    )
  )
    addViolation(
      violations,
      "integrity-format",
      field?.line ?? null,
      "automated-review finding tags require a PR provenance surface",
    );
}

/** Distinguish a successful empty bot response from missing ingestion without crediting either as bot verification. */
function validateAbsentPrProvenance(
  field: IntegrityField,
  integrity: IntegrityResult,
  ids: string[][],
  violations: ReviewValidationViolation[],
): void {
  const ingestionFailed = integrity.flags.has("automated-review-uningested");
  const hasBotTags = ids[0]!.length + ids[2]!.length + ids[3]!.length > 0;
  // Missing ingestion needs its own flag, while an empty successful response must not claim that failure.
  if ((field.value === "n/a") !== ingestionFailed || hasBotTags)
    addViolation(
      violations,
      "integrity-format",
      field.line,
      "PR provenance must distinguish unavailable ingestion, no automated review, and verified bot findings",
    );
}

/** Match PR bot counters and missed-ID lists to surviving findings, excluding refuted history. */
function validatePrProvenanceCounts(
  field: IntegrityField,
  active: FindingDefinition[],
  ids: string[][],
  violations: ReviewValidationViolation[],
): void {
  const match = field.value.match(
    /^overlap-confirmed=(\d+),\s*local-only=(\d+),\s*bot-only-locally-verified=(\d+),\s*disputed-match=(\d+);\s*automated findings the local review missed: ([^;]+);\s*local findings every bot missed: ([^;]+)$/u,
  );
  // The explicit none marker means no surviving finding belongs in that missed-ID list.
  const listed = (text: string): string[] =>
    text === "none" ? [] : text.split(/,\s*/u).sort();
  // The four provenance totals and missed-finding lists must describe the active IDs readers can inspect.
  if (
    !match ||
    active.some(
      (definition) =>
        ids.filter((group) => group.includes(definition.id)).length !== 1,
    ) ||
    ids.some((group, index) => group.length !== Number(match[index + 1])) ||
    JSON.stringify(listed(match[5]!)) !== JSON.stringify(ids[2]) ||
    JSON.stringify(listed(match[6]!)) !== JSON.stringify(ids[1])
  )
    addViolation(
      violations,
      "integrity-format",
      field.line,
      "Automated-review provenance counts and missed-ID lists must match exactly one class per active finding",
    );
}

/**
 * Read either documented Top 5 heading and reject multiple risk summaries.
 * One risk summary per report is the contract: two would leave a reader unsure which set of risks the review actually stands behind.
 *
 * @param lines - the report split into lines; an empty report fails earlier than this
 * @param violations - shared violation list, appended in report order so a reader sees issues top-down; a violation makes the report fail
 * @returns the Top 5 Risks section, or null when the author did not include one
 */
export function readTopFiveSection(
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

/**
 * Resolve every literal semantic anchor cited in one reference-only section.
 *
 * @param section - one located report section; null means the heading was absent entirely
 * @param projectRoot - reviewed project root; anchors are confined to it so a report cannot cite files it was never authorised to read
 * @param authority - selected live, index, or Git source used to resolve anchors; invalid authority supplies no evidence
 * @param violations - shared violation list, appended in report order so a reader sees issues top-down; a violation makes the report fail
 */
export function validateSectionAnchors(
  section: MarkdownSection | null,
  projectRoot: string,
  authority: ReviewAnchorAuthority,
  violations: ReviewValidationViolation[],
): void {
  // Inspect the risk summary's cited evidence even when the underlying finding has its own anchor.
  for (const locatedLine of section?.lines ?? []) {
    // Every cited location must resolve against the selected source, not just the first anchor on the line.
    for (const anchor of locatedLine.text.matchAll(ANCHOR)) {
      const filePath = anchor[1];
      const searchText = anchor[2] ?? anchor[3];
      // An incomplete anchor supplies no resolvable location; it cannot earn evidence credit.
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

/**
 * Fail Top 5 references that do not name one surfaced finding definition.
 *
 * @param section - one located report section; null means the heading was absent entirely
 * @param definitions - parsed active findings and optional refuter history; empty means the report defines no issue IDs
 * @param violations - shared violation list, appended in report order so a reader sees issues top-down; a violation makes the report fail
 */
export function validateTopFiveReferences(
  section: MarkdownSection | null,
  definitions: FindingDefinition[],
  violations: ReviewValidationViolation[],
): void {
  const surfacedIds = new Set(
    definitions
      .filter((definition) => SURFACED_FINDING_SECTIONS.has(definition.section))
      .map((definition) => definition.id),
  );
  // Top 5 Risks summarizes active concerns and must not introduce additional finding IDs.
  for (const locatedLine of section?.lines ?? []) {
    // Each mentioned ID must lead readers to a surfaced finding.
    for (const match of locatedLine.text.matchAll(/\bR-\d{3}\b/gu)) {
      const findingId = match[0];
      // A reference to an existing active finding already has a destination.
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

/**
 * Fail secondary R-ID references in refuter output when no definition exists.
 *
 * @param lines - the report split into lines; an empty report fails earlier than this
 * @param definitions - parsed active findings and optional refuter history; empty means the report defines no issue IDs
 * @param violations - shared violation list, appended in report order so a reader sees issues top-down; a violation makes the report fail
 */
export function validateRefuterReferences(
  lines: string[],
  definitions: FindingDefinition[],
  violations: ReviewValidationViolation[],
): void {
  const section = readSection(lines, "Refuted by Refuter");
  const definitionIds = new Set(definitions.map((definition) => definition.id));
  // Historical refutations may cite their own ID or another defined finding, but cannot invent a secondary concern.
  for (const locatedLine of section?.lines ?? []) {
    const ownId = locatedLine.text.match(FINDING_PREFIX)?.[1];
    // Check every ID in the refutation explanation so readers can follow each cross-reference.
    for (const match of locatedLine.text.matchAll(/\bR-\d{3}\b/gu)) {
      const findingId = match[0];
      // The history item's own ID and existing definitions are valid destinations for these references.
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

/**
 * Warn for optional sections that carry no report content.
 *
 * @param lines - the report split into lines; an empty report fails earlier than this
 * @param warnings - shared advisory list; entries here inform the author without changing the pass/fail verdict
 */
function warnEmptyOptionalSections(
  lines: string[],
  warnings: ReviewValidationViolation[],
): void {
  // Optional headings should appear only when there is something useful for the reader beneath them.
  for (const heading of OPTIONAL_SECTIONS) {
    const section = readSection(lines, heading);
    // An omitted section or one with content needs no empty-heading warning.
    if (!section || hasSectionContent(section)) continue;
    addWarning(
      warnings,
      "optional-section-empty",
      section.headingLine,
      `${heading} is optional and must be omitted when empty`,
    );
  }
}

/**
 * Warn when Top 5 presence contradicts the surfaced-finding threshold.
 *
 * @param topFive - the Top 5 Risks section; absent means the author did not provide one
 * @param findingsHeadingLine - line the Findings heading sits on, so a shape warning points the author at the right place
 * @param surfacedCount - how many findings the report actually surfaced, cross-checked against its own claims
 * @param warnings - shared advisory list; entries here inform the author without changing the pass/fail verdict
 */
function warnTopFiveShape(
  topFive: MarkdownSection | null,
  findingsHeadingLine: number | null,
  surfacedCount: number,
  warnings: ReviewValidationViolation[],
): void {
  // An empty risk section gives the reader a heading without any ranked guidance.
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

/**
 * Warn when optional sections or the Top 5 threshold contradict the skill.
 *
 * @param lines - the report split into lines; an empty report fails earlier than this
 * @param topFive - the Top 5 Risks section; absent means the author did not provide one
 * @param definitions - parsed active findings and optional refuter history; empty means the report defines no issue IDs
 * @param warnings - shared advisory list; entries here inform the author without changing the pass/fail verdict
 */
export function validateConditionalSections(
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

/**
 * Validate advisory-only Spec Drift bullets separately from findings.
 *
 * @param lines - the report split into lines; an empty report fails earlier than this
 * @param violations - shared violation list, appended in report order so a reader sees issues top-down; a violation makes the report fail
 */
export function validateSpecDrift(
  lines: string[],
  violations: ReviewValidationViolation[],
): void {
  const section = readSection(lines, "Spec Drift");
  // Spec Drift annotations are advisory workflow records with a separate grammar from defect findings.
  for (const locatedLine of section?.lines ?? []) {
    const isTaggedBullet = /^\s*-\s+\[/u.test(locatedLine.text);
    // Ordinary prose and correctly shaped drift notes need no repair.
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
 * Parse the visible finding-evidence totals for later reconciliation.
 *
 * @param fields - visible integrity rows; missing or malformed Evidence is diagnosed by the field validator
 * @param violations - errors to append when a count cannot be represented exactly
 * @returns OBSERVED/INFERRED totals, including zero; null means no complete valid pair is available
 */
export function readEvidenceCounts(
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

/**
 * Parse confirmed/adjusted/refuted/unresolved totals for reconciliation.
 *
 * @param fields - visible integrity rows; missing or malformed Verdicts is diagnosed by the field validator
 * @param violations - errors to append when a disposition count cannot be represented exactly
 * @returns four exclusive outcome totals, including zeros; null prevents arithmetic on absent or invalid counts
 */
export function readVerdictCounts(
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

/**
 * Require sampled area reports to disclose their excluded surroundings beside the frozen roots and selected paths.
 *
 * @param integrity - selected source authority; whole-area and non-area reviews need no sample exclusion
 * @param lines - rendered report lines used to locate the excluded surroundings
 * @param violations - errors to append when a sampled area lacks a meaningful exclusion disclosure
 */
export function validateAreaSampleBoundary(
  integrity: IntegrityResult,
  lines: string[],
  violations: ReviewValidationViolation[],
): void {
  const authority = integrity.anchorAuthority;
  // Whole-area and diff reviews do not use a sampled-area exclusion disclosure.
  if (
    authority.kind !== "snapshot" ||
    authority.snapshot.source.kind !== "area"
  )
    return;
  const request = record(authority.snapshot.source.requested, "area request");
  // The source producer nests the original request; a null sample means the complete area was selected.
  if (request.sample === null) return;
  const section = readSections(lines, "What I Didn't Examine").at(0);
  const exclusions =
    section?.lines
      .map(({ text }) =>
        text
          .trim()
          .replace(/^(?:[-+*]|\d+[.)])\s+/u, "")
          .replace(/[*_~]/gu, ""),
      )
      .filter(Boolean)
      .join(" ") ?? "";
  // A selected sample cannot imply that all surrounding files received the same review.
  if (!exclusions || /^(?:(?:none|n\/a|nothing)[.!]?\s*)+$/iu.test(exclusions))
    addViolation(
      violations,
      "integrity-format",
      section?.headingLine ?? null,
      "area sample requires excluded surroundings in What I Didn't Examine; roots and selected paths remain in Authority snapshot",
    );
}

/**
 * Parse the final per-ID map; absence is retained for the narrow legacy inference checked after ledger reads.
 *
 * @param fields - visible integrity rows; an omitted map retains the narrow legacy inference route
 * @param violations - errors to append for noncanonical maps, malformed IDs, or unknown outcomes
 * @returns one final outcome per ID; an empty map has no issues, while null needs legacy inference or error handling
 */
export function readFinalDispositions(
  fields: IntegrityFieldMap,
  violations: ReviewValidationViolation[],
): Record<string, FinalDisposition> | null {
  const value = readIntegrityJson(fields, "Final dispositions", violations);
  // Legacy output may omit the map only when active findings and available ledger IDs determine it without guessing.
  if (value === null) return null;
  try {
    const entries = record(value, "Final dispositions");
    const dispositions: Record<string, FinalDisposition> = {};
    // Every suspicion needs one recognized terminal state; arbitrary labels would hide unresolved work.
    for (const [id, disposition] of Object.entries(entries)) {
      requireAuthority(
        /^R-\d{3}$/u.test(id),
        "Final dispositions keys must be R-NNN IDs",
      );
      requireAuthority(
        disposition === "confirmed" ||
          disposition === "adjusted" ||
          disposition === "refuted" ||
          disposition === "unresolved",
        "Final dispositions values must be confirmed, adjusted, refuted, or unresolved",
      );
      dispositions[id] = disposition;
    }
    return dispositions;
  } catch (error) {
    // A hand-edited map may name an unknown outcome; report the invalid contract without inferring a replacement.
    addViolation(
      violations,
      "integrity-format",
      fields.get("Final dispositions")?.line ?? null,
      error instanceof Error ? error.message : "invalid Final dispositions map",
    );
    return null;
  }
}
