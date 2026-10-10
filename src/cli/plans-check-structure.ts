/**
 * Runs the plan-wide checks behind `plans check`, so a plan author sees every readability and ordering problem in one run.
 *
 * Each finding names the milestone file, so the author can open it and fix the exact sentence or dependency. The checks catch:
 * - problem and benefit summaries with the wrong length or shape, or with internal IDs an outside reader cannot decode;
 * - milestone IDs that are duplicated or disagree between filename and title;
 * - dependencies that are missing, unresolved, circular, or still open under active or finished work;
 * - more active milestones than the cap allows, and superseded milestones that name no successor;
 * - open work that ends in more than one milestone, so no single milestone confirms the combined result.
 */
import { scrubDurableText } from "./evidence/redaction.js";
import type { PlanExportRecord } from "./plans-export.js";

/** Hidden parsed sections used by `plans check`; symbol keys never enter a user's JSON or Markdown export. */
export const PLAN_STRUCTURE_SECTIONS = Symbol("planStructureSections");

/** Statuses that hold an active slot: work under way, in testing, or waiting for human sign-off. */
const ACTIVE_STATUSES = new Set([
  "in-progress",
  "testing-gate",
  "human-verification-pending",
]);

/** Statuses whose work has left the plan, so the final milestone need not depend on them; `blocked` work is still owed and must be joined. */
const FINAL_JOIN_EXCLUDED_STATUSES = new Set([
  "abandoned",
  "superseded",
  "deferred",
]);

const MINIMUM_PLAIN_LANGUAGE_CHARACTERS = 70;
const MAXIMUM_PLAIN_LANGUAGE_CHARACTERS = 120;
const EXPECTED_PLAIN_LANGUAGE_LENGTH = `${MINIMUM_PLAIN_LANGUAGE_CHARACTERS}-${MAXIMUM_PLAIN_LANGUAGE_CHARACTERS} characters`;
const EXPECTED_PUBLIC_IDENTIFIER_TEXT =
  "no milestone ID, ADR number, version, flag, or internal file path";

/** One problem-or-benefit contract with current and historical user-facing headings. */
interface PlainLanguageSectionContract {
  role: "problem" | "benefit";
  currentHeading: string;
  legacyHeading: string;
}

/** One actionable prose result plus whether current strict authoring must reject it. */
interface PlainLanguageFinding {
  message: string;
  isStrictBlocking: boolean;
}

/** One internal-token matcher and the capture containing the exact text an author must replace. */
interface InternalIdentifierPattern {
  pattern: RegExp;
  tokenCaptureIndex: number;
}

const PLAIN_LANGUAGE_SECTION_CONTRACTS: readonly PlainLanguageSectionContract[] =
  [
    {
      role: "problem",
      currentHeading: "what problem are we solving",
      legacyHeading: "the problem",
    },
    {
      role: "benefit",
      currentHeading: "who benefits and how",
      legacyHeading: "what you get",
    },
  ];

/** Tokens an outside reader cannot decode, tried in order: milestone IDs, decision numbers, versions, flags, then file paths. */
const INTERNAL_IDENTIFIER_PATTERNS: readonly InternalIdentifierPattern[] = [
  { pattern: /\bM\d+\b/iu, tokenCaptureIndex: 0 },
  { pattern: /\bADR-\d+\b/iu, tokenCaptureIndex: 0 },
  {
    pattern: /\bv?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/iu,
    tokenCaptureIndex: 0,
  },
  { pattern: /--[a-z][a-z0-9-]*/iu, tokenCaptureIndex: 0 },
  {
    pattern:
      /`((?:\.{0,2}\/)?(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.[A-Za-z0-9]{1,16})`/iu,
    tokenCaptureIndex: 1,
  },
  {
    pattern:
      /(?:^|[\s("'])((?:\.{0,2}\/)?(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+\.[A-Za-z0-9]{1,16})(?=$|[\s,.;:!?"')])/iu,
    tokenCaptureIndex: 1,
  },
];

/**
 * Find the first internal token that makes a reader-facing sentence depend on project context.
 * Use when a plan author needs the exact milestone, decision, version, flag, or path to replace.
 *
 * @param sectionBody - rendered section text; empty text contains no identifier
 * @returns the redacted token to show the author, or null when the sentence contains no banned identifier
 */
function findInternalIdentifier(sectionBody: string): string | null {
  // Pattern order keeps specific planning identifiers ahead of the broader file-path form.
  for (const identifierPattern of INTERNAL_IDENTIFIER_PATTERNS) {
    const identifierMatch = sectionBody.match(identifierPattern.pattern);
    // A non-match means this identifier class gives the user nothing to replace.
    if (!identifierMatch) continue;
    const matchedToken = identifierMatch[identifierPattern.tokenCaptureIndex];
    // A missing capture is malformed matcher output, so it cannot support a user-facing finding.
    if (matchedToken === undefined || matchedToken.length === 0) continue;
    return scrubDurableText(matchedToken);
  }
  // Null means the sentence is self-contained for every deterministic identifier class this gate owns.
  return null;
}

/**
 * Capitalize a lowercased heading so a finding quotes it the way the author wrote it in the milestone template.
 *
 * @param normalizedHeading - heading the Markdown splitter lowercased; empty stays empty so the finding shows exactly what was parsed
 * @returns the heading with its first letter capitalized
 */
function displaySectionHeading(normalizedHeading: string): string {
  // An empty parser value gives the user no first character to capitalize.
  if (normalizedHeading.length === 0) return "";
  return `${normalizedHeading[0]?.toUpperCase() ?? ""}${normalizedHeading.slice(1)}`;
}

/**
 * Check one problem or benefit summary against the rules an author can fix by rewriting that sentence.
 *
 * Use after the Markdown splitter has tagged the heading as current or legacy.
 * Each broken rule becomes its own finding instead of throwing, so one run lists every correction.
 *
 * @param heading - normalized level-two heading; empty text is reported literally
 * @param sectionBody - unchanged rendered body; empty text produces a zero-character finding
 * @param isCurrentHeading - true makes the finding strict-blocking; false preserves legacy compatibility
 * @returns length and identifier findings; empty means this one section satisfies both rules
 * @throws Never; invalid prose is returned as an actionable finding
 */
function collectPlainLanguageSectionFindings(
  heading: string,
  sectionBody: string,
  isCurrentHeading: boolean,
): PlainLanguageFinding[] {
  const findings: PlainLanguageFinding[] = [];
  const sectionKind = isCurrentHeading ? "current" : "legacy";
  const displayedHeading = displaySectionHeading(heading);
  const characterCount = Array.from(sectionBody).length;

  // A summary that is too short says nothing a reviewer can use, and one that is too long is hard to scan.
  if (
    characterCount < MINIMUM_PLAIN_LANGUAGE_CHARACTERS ||
    characterCount > MAXIMUM_PLAIN_LANGUAGE_CHARACTERS
  ) {
    findings.push({
      isStrictBlocking: isCurrentHeading,
      message:
        `${sectionKind} plain-language section "${displayedHeading}" has an invalid length; ` +
        `expected "${EXPECTED_PLAIN_LANGUAGE_LENGTH}"; received "${characterCount} characters"`,
    });
  }

  const internalIdentifier = findInternalIdentifier(sectionBody);
  // A null result means the author already wrote the sentence without project-only identifiers.
  if (internalIdentifier !== null) {
    findings.push({
      isStrictBlocking: isCurrentHeading,
      message:
        `${sectionKind} plain-language section "${displayedHeading}" names an internal identifier; ` +
        `expected "${EXPECTED_PUBLIC_IDENTIFIER_TEXT}"; received "${internalIdentifier}"`,
    });
  }

  const nonEmptyLines = sectionBody
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0);
  const sentenceText = sectionBody.trim();
  const hasTerminalPunctuation = /[.!?]$/u.test(sentenceText);
  const hasEarlierSentenceBoundary = /[.!?][\t ]+\S/u.test(
    sentenceText.slice(0, -1),
  );
  // Each summary must be one line holding one sentence, so exports and issue text show a single clear statement.
  if (
    nonEmptyLines.length !== 1 ||
    !hasTerminalPunctuation ||
    hasEarlierSentenceBoundary
  ) {
    findings.push({
      isStrictBlocking: isCurrentHeading,
      message:
        `${sectionKind} plain-language section "${displayedHeading}" has an invalid shape; ` +
        `expected "one plain line and one sentence"; received "${nonEmptyLines.length} non-empty line(s)"`,
    });
  }
  return findings;
}

/**
 * Check that a milestone has exactly one problem (or benefit) heading and does not mix current and legacy heading styles.
 *
 * @param sectionContract - current and legacy headings for the problem or benefit role
 * @param currentSectionCount - sections using the current heading; zero in a current-template milestone means the summary is missing
 * @param legacySectionCount - sections using the older heading
 * @param doesMilestoneUseCurrentHeadings - true when either role uses a current heading, which commits the milestone to the current template
 * @returns deterministic findings; empty means this role has no cardinality or style conflict
 * @throws Never; invalid cardinality is represented as findings
 */
function collectPlainLanguageCardinalityFindings(
  sectionContract: PlainLanguageSectionContract,
  currentSectionCount: number,
  legacySectionCount: number,
  doesMilestoneUseCurrentHeadings: boolean,
): PlainLanguageFinding[] {
  const findings: PlainLanguageFinding[] = [];
  // A current pair has exactly one section for each role and cannot fall back to a legacy half.
  if (doesMilestoneUseCurrentHeadings && currentSectionCount === 0) {
    findings.push({
      isStrictBlocking: true,
      message:
        `current plain-language ${sectionContract.role} section is missing; ` +
        `expected "## ${displaySectionHeading(sectionContract.currentHeading)}"; received "legacy heading only"`,
    });
  }
  // Two current headings for one role leave reviewers with competing summaries and no way to tell which one counts.
  if (currentSectionCount > 1) {
    findings.push({
      isStrictBlocking: true,
      message:
        `current plain-language ${sectionContract.role} section is duplicated; ` +
        `expected "exactly one ## ${displaySectionHeading(sectionContract.currentHeading)}"; received "${currentSectionCount} matching sections"`,
    });
  }
  // A legacy heading beside a current one means the milestone was only half moved to the current template.
  if (doesMilestoneUseCurrentHeadings && legacySectionCount > 0) {
    findings.push({
      isStrictBlocking: true,
      message:
        `current milestone mixes plain-language ${sectionContract.role} heading styles; ` +
        `expected "## ${displaySectionHeading(sectionContract.currentHeading)} only"; received "## ${displaySectionHeading(sectionContract.legacyHeading)}"`,
    });
  }
  return findings;
}

/**
 * Check both the problem and benefit summaries of one milestone.
 *
 * Default and strict checks must share these findings; a complete milestone keeps sentence fixes as warnings so finished plans stay valid.
 * Heading-count problems still block, and broken prose becomes findings instead of stopping the remaining checks.
 *
 * @param record - parsed milestone; an absent hidden section list means an older caller supplied no prose evidence
 * @returns all present, missing, current, and legacy findings; empty means the pair is complete and compliant
 * @throws Never; missing or malformed sections are returned as findings
 */
function collectMilestonePlainLanguageFindings(
  record: PlanExportRecord,
): PlainLanguageFinding[] {
  const parsedSections = record[PLAN_STRUCTURE_SECTIONS] ?? [];
  const findings: PlainLanguageFinding[] = [];
  const milestoneUsesCurrentHeadings = PLAIN_LANGUAGE_SECTION_CONTRACTS.some(
    (sectionContract) =>
      parsedSections.some(
        (section) => section.heading === sectionContract.currentHeading,
      ),
  );

  // Problem and benefit have separate findings so the author can repair both in one check run.
  for (const sectionContract of PLAIN_LANGUAGE_SECTION_CONTRACTS) {
    const currentSections = parsedSections.filter(
      (section) => section.heading === sectionContract.currentHeading,
    );
    const legacySections = parsedSections.filter(
      (section) => section.heading === sectionContract.legacyHeading,
    );

    findings.push(
      ...collectPlainLanguageCardinalityFindings(
        sectionContract,
        currentSections.length,
        legacySections.length,
        milestoneUsesCurrentHeadings,
      ),
    );

    // No matching heading is strict only when its sibling proves this milestone chose the current pair.
    if (currentSections.length === 0 && legacySections.length === 0) {
      // Current milestones already received the stricter missing-counterpart finding above.
      if (milestoneUsesCurrentHeadings) continue;
      findings.push({
        isStrictBlocking: false,
        message:
          `legacy-compatible plain-language ${sectionContract.role} section is missing; ` +
          `expected "## ${displaySectionHeading(sectionContract.currentHeading)} or ## ${displaySectionHeading(sectionContract.legacyHeading)}"; received "no matching section"`,
      });
      continue;
    }

    // Every duplicate current section receives its own deterministic correction rather than being silently selected.
    for (const currentSection of currentSections) {
      findings.push(
        ...collectPlainLanguageSectionFindings(
          sectionContract.currentHeading,
          currentSection.body,
          true,
        ).map((finding) => ({
          ...finding,
          // Finished records remain navigable without rewriting historical prose; structural and lifecycle gates still apply.
          isStrictBlocking:
            finding.isStrictBlocking &&
            record.status.trim().toLowerCase() !== "complete",
        })),
      );
    }
    // Historical aliases remain visible but advisory even when the user explicitly chooses strict mode.
    for (const legacySection of legacySections) {
      findings.push(
        ...collectPlainLanguageSectionFindings(
          sectionContract.legacyHeading,
          legacySection.body,
          false,
        ),
      );
    }
  }
  return findings;
}

/**
 * List the `warning:` lines `plans check` prints; none of them change the exit code.
 *
 * Default mode warns about every summary issue; strict mode prints current-template issues as errors instead, because each issue must
 * appear in exactly one lane, never both.
 * Strict mode also warns when a finished plan has more than one ending, because only new work needs a final milestone.
 *
 * @param records - milestones in the selected plan; an empty list yields no warnings
 * @param isStrict - true when the author ran `--strict`, which hides warnings the error list owns and adds the finished-plan ending note
 * @returns `<file>: <message>` or `plan: <message>` lines; empty means nothing needs the author's attention
 */
export function collectPlanStructureAdvisories(
  records: PlanExportRecord[],
  isStrict: boolean,
): string[] {
  const advisories: string[] = [];
  // Each warning keeps its milestone filename, so the author knows which file to open.
  for (const record of records) {
    const milestoneFindings = collectMilestonePlainLanguageFindings(record);
    // A milestone can break several summary rules at once, and each one gets its own line.
    for (const finding of milestoneFindings) {
      // Under `--strict` this issue already prints as an error, so a matching warning would only repeat it.
      if (isStrict && finding.isStrictBlocking) continue;
      advisories.push(`${record.sourceFile}: ${finding.message}`);
    }
  }
  // Plan shape belongs to the strict gate, so a default check stays quiet about a finished plan's endings.
  if (isStrict) {
    const graph = readDependencyGraph(records, []);
    // A dependency loop already fails strict validation, and endings inside a loop would point the author at the wrong fix.
    if (!findDependencyCycle(graph.byId)) {
      advisories.push(...collectFinalJoinFindings(graph.byId).advisories);
    }
  }
  return advisories;
}

/**
 * List the strict-mode errors for current-template problem and benefit summaries; each must appear exactly once, labelled with its file.
 *
 * @param records - milestones in the selected plan; an empty list yields no errors
 * @returns `<file>: <message>` lines; empty means every current-template summary passes
 */
function collectStrictPlainLanguageErrors(
  records: PlanExportRecord[],
): string[] {
  const errors: string[] = [];
  // Each error keeps its milestone filename, so the author knows which file to open.
  for (const record of records) {
    const milestoneFindings = collectMilestonePlainLanguageFindings(record);
    // A milestone can break several summary rules at once, and each one gets its own line.
    for (const finding of milestoneFindings) {
      // Legacy headings and finished milestones stay warnings, so older plans still pass a strict check.
      if (!finding.isStrictBlocking) continue;
      errors.push(`${record.sourceFile}: ${finding.message}`);
    }
  }
  return errors;
}

/** One milestone file as the dependency checks see it: its ID, the file it came from, and what it depends on. */
interface MilestoneIdentity {
  id: string;
  /** Milestone number without leading zeros, so `M03` and `M3` are caught as the same milestone. */
  numericId: string;
  record: PlanExportRecord;
  /** IDs from the `Depends on` field; empty until the field is parsed, and empty for `none`. */
  dependencies: string[];
}

/**
 * Read a milestone's ID from its filename, such as `M18` from `M18-go-precision.md`, so every finding uses the ID the author sees.
 *
 * @param record - parsed milestone file
 * @returns the identity with no dependencies parsed yet, or null when the filename has no `M<digits>` prefix and so skips dependency checks
 */
function readMilestoneIdentity(
  record: PlanExportRecord,
): MilestoneIdentity | null {
  const milestoneFilenameMatch = record.sourceFile.match(/^m(\d+).*\.md$/iu);
  // A non-milestone filename has no local ID, so plan-level relationship checks skip it.
  if (!milestoneFilenameMatch?.[1]) return null;
  const id = `M${milestoneFilenameMatch[1]}`;
  return {
    id,
    numericId: milestoneFilenameMatch[1].replace(/^0+(?=\d)/u, ""),
    record,
    dependencies: [],
  };
}

/**
 * Read one milestone's `Depends on` field into milestone IDs, so the checks can work out a start order the author can follow.
 *
 * @param identity - milestone whose field is read
 * @param requiresField - true in a plan with several milestones, where a blank field leaves no start order and is an error
 * @param errors - receives one line for a blank or unreadable field
 * @returns dependency IDs; empty for `none`, for a blank field, or for a field written as prose instead of IDs
 */
function readDependencies(
  identity: MilestoneIdentity,
  requiresField: boolean,
  errors: string[],
): string[] {
  const rawDependencies = identity.record.dependencies.trim();
  // A blank field gives the author no start order once the plan has more than one milestone.
  if (rawDependencies.length === 0) {
    // A one-milestone plan has nothing to order, so only larger plans report the gap.
    if (requiresField) {
      errors.push(
        `${identity.record.sourceFile}: missing dependencies for a multi-milestone plan`,
      );
    }
    return [];
  }
  // `none` says the milestone can start without waiting for any other milestone in the plan.
  if (rawDependencies === "none") return [];
  // Prose such as `M01 (soft)` cannot become a reliable dependency, so the author is shown the accepted shape.
  if (!/^M\d+(?:\s*,\s*M\d+)*$/u.test(rawDependencies)) {
    errors.push(
      `${identity.record.sourceFile}: dependencies must be \`none\` or comma-separated local milestone IDs`,
    );
    return [];
  }
  return rawDependencies.split(",").map((dependency) => dependency.trim());
}

/**
 * Find the first dependency loop, such as M01 waiting on M02 while M02 waits on M01, which leaves the author no milestone to start.
 *
 * @param identitiesById - milestones by ID; a dependency on an ID outside the plan is skipped because it has its own error
 * @returns the loop as IDs that end where they began, or null when the plan has a valid start order
 */
function findDependencyCycle(
  identitiesById: ReadonlyMap<string, MilestoneIdentity>,
): string[] | null {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const path: string[] = [];

  /**
   * Follow one milestone's dependencies and report the first loop they lead back into.
   *
   * @param id - milestone to walk from
   * @returns the loop from its first repeated milestone, or null when no path from here leads back to a milestone already on it
   */
  function visit(id: string): string[] | null {
    // Reaching a milestone already on the current path means the author wrote a loop with no starting point.
    if (visiting.has(id)) {
      const cycleStart = path.indexOf(id);
      return [...path.slice(cycleStart), id];
    }
    // A milestone already walked from was proven loop-free, so it is not walked again.
    if (visited.has(id)) return null;
    visiting.add(id);
    path.push(id);
    const identity = identitiesById.get(id);
    // Only the `Depends on` field orders work; prose elsewhere in the milestone never adds a dependency.
    for (const dependency of identity?.dependencies ?? []) {
      // An ID outside the plan already has its own error and cannot be part of a loop here.
      if (!identitiesById.has(dependency)) continue;
      const cycle = visit(dependency);
      // One loop is enough to show the author the exact dependency they must break.
      if (cycle) return cycle;
    }
    path.pop();
    visiting.delete(id);
    visited.add(id);
    return null;
  }

  // Every milestone is a starting point, because a group of milestones unconnected to the rest can hold its own loop.
  for (const id of identitiesById.keys()) {
    const cycle = visit(id);
    // Stopping at the first loop keeps the report to one line instead of every route around the same loop.
    if (cycle) return cycle;
  }
  return null;
}

/** Lookups by full ID and by number, so `M03` and `M3` can be reported as the same milestone. */
interface MilestoneIndexes {
  byId: Map<string, MilestoneIdentity>;
  byNumber: Map<string, MilestoneIdentity>;
}

/**
 * Read the milestone ID from a title written as `M18: ...` or `Milestone 18 ...`, so it can be compared with the filename.
 *
 * @param title - milestone heading text
 * @returns the ID in `M<digits>` form, or undefined when the title carries no milestone number
 */
function readTitleMilestoneId(title: string): string | undefined {
  const compactTitleNumber = title.match(/^M(\d+)\b/iu)?.[1];
  // `M18: ...` is the form the current milestone template produces.
  if (compactTitleNumber !== undefined) return `M${compactTitleNumber}`;
  const longTitleNumber = title.match(/^Milestone\s+(\d+)\b/iu)?.[1];
  // Neither title form matched, so the title gives the author no milestone number to compare.
  return longTitleNumber === undefined ? undefined : `M${longTitleNumber}`;
}

/**
 * Report a milestone whose filename or title would point the author at a different ID than the one the checks use.
 *
 * @param identity - milestone read from its filename
 * @param requiresTitleId - true in a plan with several milestones, where a title without its ID makes dependencies hard to follow
 * @param errors - receives one line per filename or title problem
 */
function collectMilestoneIdentityErrors(
  identity: MilestoneIdentity,
  requiresTitleId: boolean,
  errors: string[],
): void {
  // A filename like `m03-x.md` still parses, but every finding then prints `M03`, which no longer matches the file the author searches for.
  if (!/^M\d.*\.md$/u.test(identity.record.sourceFile)) {
    errors.push(
      `${identity.record.sourceFile}: milestone filename must begin with an uppercase M and digits`,
    );
  }
  const titleId = readTitleMilestoneId(identity.record.title);
  // With several milestones, a title without its ID forces readers to open filenames to follow `Depends on` lines.
  if (!titleId && requiresTitleId) {
    errors.push(
      `${identity.record.sourceFile}: multi-milestone title must begin with its milestone ID`,
    );
  }
  // A title that names a different ID sends the reader to the wrong milestone even when the filename is valid.
  if (titleId && titleId !== identity.id) {
    errors.push(
      `${identity.record.sourceFile}: title ID ${titleId} does not match filename ID ${identity.id}`,
    );
  }
}

/**
 * Record one milestone's number, reporting a second file that claims it, such as `M3-...` beside `M03-...`.
 *
 * @param identity - milestone to record
 * @param identitiesByNumber - numbers recorded so far; the first file to claim a number keeps it
 * @param errors - receives one line when this file's number is already taken
 */
function indexMilestoneNumber(
  identity: MilestoneIdentity,
  identitiesByNumber: Map<string, MilestoneIdentity>,
  errors: string[],
): void {
  const duplicate = identitiesByNumber.get(identity.numericId);
  // Two files with the same number leave `Depends on` lines pointing at an ambiguous milestone.
  if (duplicate) {
    errors.push(
      `${identity.record.sourceFile}: duplicate milestone ID ${identity.id} conflicts with ${duplicate.id}`,
    );
    return;
  }
  identitiesByNumber.set(identity.numericId, identity);
}

/**
 * Build the ID and number lookups the dependency checks use, reporting duplicate numbers and title mismatches along the way.
 *
 * @param identities - milestones read from their filenames, in file order
 * @param requiresTitleId - true in a plan with several milestones, where each title must start with its ID
 * @param errors - receives one line per identity problem
 * @returns lookups by full ID and by number; a file whose number was already taken appears only in the full-ID lookup
 */
function indexMilestones(
  identities: MilestoneIdentity[],
  requiresTitleId: boolean,
  errors: string[],
): MilestoneIndexes {
  const identitiesById = new Map<string, MilestoneIdentity>();
  const identitiesByNumber = new Map<string, MilestoneIdentity>();

  // Each milestone gets its filename and title checked before its ID is used in any dependency finding.
  for (const identity of identities) {
    collectMilestoneIdentityErrors(identity, requiresTitleId, errors);
    indexMilestoneNumber(identity, identitiesByNumber, errors);
    identitiesById.set(identity.id, identity);
  }
  return { byId: identitiesById, byNumber: identitiesByNumber };
}

/**
 * Fill in each milestone's dependencies and report any that name itself or an ID missing from the plan.
 *
 * @param identities - milestones whose `dependencies` lists this fills in; later checks read those lists
 * @param identitiesById - every milestone in the plan by ID
 * @param requiresDependencies - true in a plan with several milestones, where a blank `Depends on` field is an error
 * @param errors - receives one line per unreadable field or unusable dependency
 */
function collectDependencyReferenceErrors(
  identities: MilestoneIdentity[],
  identitiesById: ReadonlyMap<string, MilestoneIdentity>,
  requiresDependencies: boolean,
  errors: string[],
): void {
  // Every field is parsed here once, so the loop, state, and final-milestone checks all read the same dependencies.
  for (const identity of identities) {
    identity.dependencies = readDependencies(
      identity,
      requiresDependencies,
      errors,
    );
    // Each dependency must name another milestone in this plan that the author can finish first.
    for (const dependency of identity.dependencies) {
      // A milestone that waits on itself can never start.
      if (dependency === identity.id) {
        errors.push(
          `${identity.record.sourceFile}: milestone cannot depend on itself`,
        );
        // An ID with no file in this plan gives the author nothing to finish first.
      } else if (!identitiesById.has(dependency)) {
        errors.push(
          `${identity.record.sourceFile}: dependency ${dependency} does not resolve in this plan`,
        );
      }
    }
  }
}

/**
 * Report a milestone marked active or complete while something it depends on is still unfinished.
 *
 * @param identities - milestones with their dependencies already filled in
 * @param identitiesById - every milestone in the plan by ID
 * @returns one error per unfinished dependency; empty means no milestone started or finished ahead of its prerequisites
 */
function collectDependencyStateErrors(
  identities: MilestoneIdentity[],
  identitiesById: ReadonlyMap<string, MilestoneIdentity>,
): string[] {
  const errors: string[] = [];
  // Only a milestone already started or finished can claim progress its prerequisites do not support.
  for (const identity of identities) {
    const status = identity.record.status.trim().toLowerCase();
    // Not-started, blocked, and dropped milestones claim no progress, so their prerequisites may still be open.
    if (!ACTIVE_STATUSES.has(status) && status !== "complete") continue;
    // Every prerequisite is checked, so the author sees each unfinished one in a single run.
    for (const dependency of identity.dependencies) {
      const dependencyRecord = identitiesById.get(dependency)?.record;
      // Starting work early is reported here; a dependency missing from the plan already has its own error.
      if (
        dependencyRecord &&
        dependencyRecord.status.trim().toLowerCase() !== "complete"
      ) {
        errors.push(
          `${identity.record.sourceFile}: active or complete milestone requires dependency ${dependency} to be complete`,
        );
      }
    }
  }
  return errors;
}

/**
 * Require every superseded milestone to name, in its Status reason, the milestone that now carries its remaining work.
 *
 * @param identities - milestones with their statuses and reasons
 * @param identitiesByNumber - every milestone by number, so `M3` and `M03` both resolve
 * @returns one error per missing, self-referential, or unresolved successor; empty means every superseded milestone points at real work
 */
function collectSupersededSuccessorErrors(
  identities: MilestoneIdentity[],
  identitiesByNumber: ReadonlyMap<string, MilestoneIdentity>,
): string[] {
  const errors: string[] = [];
  // Only a superseded milestone promises a successor; abandoned and deferred work owe no pointer.
  for (const identity of identities) {
    if (identity.record.status.trim().toLowerCase() !== "superseded") continue;
    const successorIds = Array.from(
      identity.record.statusReason.matchAll(/\bM(\d+)\b/giu),
      (successorMatch) => successorMatch[1] ?? "",
    ).filter((digits) => digits.length > 0);
    // A reason without any milestone ID leaves the reader no live milestone to follow.
    if (successorIds.length === 0) {
      errors.push(
        `${identity.record.sourceFile}: superseded milestone must name its successor milestone in Status reason`,
      );
      continue;
    }
    // Each named successor must be a real milestone in this plan other than the superseded one itself.
    for (const successorDigits of successorIds) {
      const successorNumber = successorDigits.replace(/^0+(?=\d)/u, "");
      // Naming itself sends the reader in a circle; naming a missing ID sends them nowhere.
      if (successorNumber === identity.numericId) {
        errors.push(
          `${identity.record.sourceFile}: superseded milestone cannot name itself as its successor`,
        );
      } else if (!identitiesByNumber.has(successorNumber)) {
        errors.push(
          `${identity.record.sourceFile}: superseded successor M${successorDigits} does not resolve in this plan`,
        );
      }
    }
  }
  return errors;
}

/** One milestone holding an active slot, as shown in the `active:` lines and counted against the cap. */
interface ActiveMilestone {
  id: string;
  status: string;
  /** Null marks an invalid or repeated Lane value; a missing or empty Lane means `default`. */
  lane: string | null;
}

/**
 * List the milestones holding an active slot, with their lanes, for the `active:` report lines and the cap check.
 *
 * @param records - parsed milestones in file order; not-started, blocked, finished, and dropped milestones hold no slot
 * @returns active milestones in that same order; one with an invalid lane still holds a slot under the overall cap
 */
export function readActiveMilestones(
  records: PlanExportRecord[],
): ActiveMilestone[] {
  const active: ActiveMilestone[] = [];
  // Each active milestone keeps its file order, so the report lists them as the author sees them in the folder.
  for (const record of records) {
    const status = record.status.trim().toLowerCase();
    // Only work under way, in testing, or awaiting sign-off holds a slot.
    if (!ACTIVE_STATUSES.has(status)) continue;
    const identity = readMilestoneIdentity(record);
    // A file without an `M<digits>` name has no ID to show in the `active:` line.
    if (identity === null) continue;
    const declaredLane = record.lane ?? "";
    // A repeated Lane line or a value like `Bad!` cannot name a lane, but the milestone still counts toward the overall cap.
    const isLaneInvalid =
      record.warnings.includes("multiple Lane values supplied") ||
      (declaredLane !== "" && !/^[a-z0-9][a-z0-9-]{0,39}$/u.test(declaredLane));
    active.push({
      id: identity.id,
      status,
      lane: isLaneInvalid ? null : declaredLane || "default",
    });
  }
  return active;
}

/**
 * Report too many active milestones: one at a time under the default cap, or one per lane plus an overall cap when the author raised it.
 *
 * @param active - milestones holding an active slot, in file order
 * @param maxActive - cap from `--max-active` or the project config; 1 keeps the single-active rule and ignores lanes
 * @returns `plan:` error lines; empty means the active work fits its lanes and the cap
 */
function collectActiveStateErrors(
  active: ActiveMilestone[],
  maxActive: number,
): string[] {
  const activeIds = active.map((milestone) => milestone.id).join(", ");
  // With a cap of one, lanes do not matter and the author sees the same single-active error as before lanes existed.
  if (maxActive === 1) {
    return active.length > 1
      ? [`plan: multiple active milestones: ${activeIds}`]
      : [];
  }
  const lanes = new Map<string, string[]>();
  // Active milestones are grouped by lane, so two in one lane can be reported together.
  for (const milestone of active) {
    // An invalid lane already has its own error on that file, so it never creates a fake collision here.
    if (milestone.lane === null) continue;
    const ids = lanes.get(milestone.lane) ?? [];
    ids.push(milestone.id);
    lanes.set(milestone.lane, ids);
  }
  const errors: string[] = [];
  // Each lane allows one active milestone, so the author can run independent work side by side without overlap.
  for (const [lane, ids] of lanes) {
    if (ids.length < 2) continue;
    const laneLabel = lane === "default" ? "" : ` in lane ${lane}`;
    errors.push(
      `plan: multiple active milestones${laneLabel}: ${ids.join(", ")}`,
    );
  }
  // The overall cap still applies across lanes, so the author cannot open more work than the plan allows at once.
  if (active.length > maxActive) {
    errors.push(
      `plan: active milestone cap ${maxActive} exceeded: ${activeIds}`,
    );
  }
  return errors;
}

/** A plan's milestones with their dependencies filled in, plus lookups by ID and by number. */
interface DependencyGraph extends MilestoneIndexes {
  identities: MilestoneIdentity[];
}

/**
 * Read every milestone's ID and dependencies once, so all plan-wide checks agree on what depends on what.
 *
 * @param records - every milestone parsed from the plan directory
 * @param errors - receives identity and dependency errors; pass a throwaway list when the caller only needs the graph
 * @returns milestones in file order plus ID and number lookups; files without an `M<digits>` name are left out
 */
function readDependencyGraph(
  records: PlanExportRecord[],
  errors: string[],
): DependencyGraph {
  // A file without an `M<digits>` name has no ID other milestones could depend on, so it stays out of the graph.
  const identities = records
    .map(readMilestoneIdentity)
    .filter((identity): identity is MilestoneIdentity => identity !== null);
  const indexes = indexMilestones(identities, records.length > 1, errors);
  collectDependencyReferenceErrors(
    identities,
    indexes.byId,
    records.length > 1,
    errors,
  );
  return { identities, ...indexes };
}

/**
 * Collect every milestone one milestone builds on, directly or through other milestones, including dropped ones in between.
 *
 * @param identity - starting milestone; it appears in its own result only if it depends on itself
 * @param identitiesById - every milestone in the plan by ID; an ID missing from the plan is skipped because it has its own error
 * @returns IDs of every prerequisite; empty when the milestone depends on nothing in the plan
 */
function collectAllPrerequisiteIds(
  identity: MilestoneIdentity,
  identitiesById: ReadonlyMap<string, MilestoneIdentity>,
): Set<string> {
  const reached = new Set<string>();
  const pending = [...identity.dependencies];
  // Each prerequisite found adds its own prerequisites, until no new milestone turns up.
  while (pending.length > 0) {
    const dependency = pending.pop();
    // A milestone already counted adds nothing new, and an ID missing from the plan has no prerequisites to follow.
    if (
      dependency === undefined ||
      reached.has(dependency) ||
      !identitiesById.has(dependency)
    ) {
      continue;
    }
    reached.add(dependency);
    pending.push(...(identitiesById.get(dependency)?.dependencies ?? []));
  }
  return reached;
}

/** Final-milestone findings: errors fail `plans check --strict`, advisories print as warnings only. */
interface FinalJoinFindings {
  errors: string[];
  advisories: string[];
}

/**
 * Check that a plan with open work ends in one final milestone, so a single sign-off covers every lane.
 *
 * An ending is a milestone that no other participating milestone depends on, even indirectly.
 * Every participating milestone sits under some ending, so the listed endings are exactly what a new final milestone must depend on.
 *
 * @param identitiesById - loop-free milestones by ID; abandoned, superseded, and deferred ones keep their links but never count as endings
 * @returns one error per ending while work remains, or one advisory when every participant is complete; empty means zero or one ending
 */
function collectFinalJoinFindings(
  identitiesById: ReadonlyMap<string, MilestoneIdentity>,
): FinalJoinFindings {
  const participants = [...identitiesById.values()].filter(
    (identity) =>
      !FINAL_JOIN_EXCLUDED_STATUSES.has(
        identity.record.status.trim().toLowerCase(),
      ),
  );
  const prerequisitesOfOthers = new Set<string>();
  // A milestone that some other participant builds on is already covered by that later work, so it is not an ending.
  for (const participant of participants) {
    // Every prerequisite counts, even one reached only through an abandoned or deferred milestone in between.
    for (const id of collectAllPrerequisiteIds(participant, identitiesById)) {
      // A milestone that depends on itself has its own error and does not cover itself.
      if (id !== participant.id) prerequisitesOfOthers.add(id);
    }
  }
  const endings = participants.filter(
    (participant) => !prerequisitesOfOthers.has(participant.id),
  );
  // No participants means there is nothing to join, and a single ending is already the plan's final milestone.
  if (endings.length < 2) return { errors: [], advisories: [] };
  const endingIds = endings.map((ending) => ending.id).join(", ");
  const endingsPhrase = endings.length === 2 ? "both" : `all ${endings.length}`;
  // A finished plan keeps its historical shape and only gets a warning, so archived plans do not start failing.
  if (
    participants.every(
      (participant) =>
        participant.record.status.trim().toLowerCase() === "complete",
    )
  ) {
    return {
      errors: [],
      advisories: [
        `plan: finished plan has ${endings.length} endings (${endingIds}); any new milestone must depend on ${endingsPhrase}`,
      ],
    };
  }
  // For example, a Go lane and a PHP lane both build on a shared baseline, but no milestone merges them before release.
  return {
    errors: endings.map(
      (ending) =>
        `${ending.record.sourceFile}: plan has ${endings.length} endings (${endingIds}); add a final milestone that depends on ${endingsPhrase}`,
    ),
    advisories: [],
  };
}

/**
 * List the strict-mode errors about how a plan's milestones fit together, each naming the file to fix.
 *
 * Runs only under `plans check --strict`, after each milestone file has been checked on its own.
 * Covers milestone IDs, dependencies and loops, active-slot limits, superseded successors, and a plan with more than one ending.
 *
 * @param records - every milestone parsed from the plan directory; an empty list has nothing to cross-check and yields no errors
 * @param maxActive - cap from `--max-active` or the project config; 1 keeps the single-active rule
 * @returns one error line per problem; empty means the milestones fit together and the author has a workable order
 */
export function collectPlanStructureErrors(
  records: PlanExportRecord[],
  maxActive = 1,
): string[] {
  const errors = collectStrictPlainLanguageErrors(records);
  const { identities, ...indexes } = readDependencyGraph(records, errors);
  const cycle = findDependencyCycle(indexes.byId);
  // A dependency loop is reported as the exact route the author must break.
  if (cycle) {
    errors.push(`plan: dependency cycle detected: ${cycle.join(" -> ")}`);
  } else {
    // Endings only make sense once the plan has a start order, so the loop error stands alone until the author breaks it.
    errors.push(...collectFinalJoinFindings(indexes.byId).errors);
  }
  errors.push(...collectDependencyStateErrors(identities, indexes.byId));
  errors.push(
    ...collectSupersededSuccessorErrors(identities, indexes.byNumber),
  );
  errors.push(
    ...collectActiveStateErrors(readActiveMilestones(records), maxActive),
  );
  return errors;
}
