/**
 * Checks that a review report has the sections a reader expects, populated as promised.
 * Findings must live under recognised headings, ids must be unique so they can be referenced,
 * cross-section pointers such as Top 5 Risks and refuter citations must resolve, and optional
 * sections that were started must not be left empty.
 *
 * The bias is toward warnings rather than violations for shape problems: a slightly odd Top 5
 * is worth flagging to the author, but it does not make the review's findings untrue.
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
  addWarning,
  type ReviewValidationViolation,
  type MarkdownSection,
  type IntegrityResult,
  type FindingDefinition,
  type ReviewAnchorAuthority,
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
 * @param authority - what the report claims as its source of truth - the live worktree or a pinned git object; this decides where anchors are resolved from
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
 * @param definitions - findings parsed from the report; empty means the review raised none, which is legitimate only if it also attests to that
 * @param violations - shared violation list, appended in report order so a reader sees issues top-down; a violation makes the report fail
 */
export function validateUniqueFindingIds(
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

/**
 * Reconcile integrity totals with visible findings and the refutation ledger claim.
 *
 * @param integrity - the parsed Review Integrity block; absent fields are reported individually rather than failing the whole block
 * @param definitions - findings parsed from the report; empty means the review raised none, which is legitimate only if it also attests to that
 * @param violations - shared violation list, appended in report order so a reader sees issues top-down; a violation makes the report fail
 */
export function validateIntegrityCounts(
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

/**
 * Read either documented Top 5 heading and reject multiple risk summaries.
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
 * @param authority - what the report claims as its source of truth - the live worktree or a pinned git object; this decides where anchors are resolved from
 * @param violations - shared violation list, appended in report order so a reader sees issues top-down; a violation makes the report fail
 */
export function validateSectionAnchors(
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

/**
 * Fail Top 5 references that do not name one surfaced finding definition.
 *
 * @param section - one located report section; null means the heading was absent entirely
 * @param definitions - findings parsed from the report; empty means the review raised none, which is legitimate only if it also attests to that
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

/**
 * Fail secondary R-ID references in refuter output when no definition exists.
 *
 * @param lines - the report split into lines; an empty report fails earlier than this
 * @param definitions - findings parsed from the report; empty means the review raised none, which is legitimate only if it also attests to that
 * @param violations - shared violation list, appended in report order so a reader sees issues top-down; a violation makes the report fail
 */
export function validateRefuterReferences(
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

/**
 * Warn when optional sections or the Top 5 threshold contradict the skill.
 *
 * @param lines - the report split into lines; an empty report fails earlier than this
 * @param topFive - the Top 5 Risks section; absent means the author did not provide one
 * @param definitions - findings parsed from the report; empty means the review raised none, which is legitimate only if it also attests to that
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
