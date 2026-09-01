/**
 * Checks that a plan stays readable and its milestones fit together as a set.
 *
 * Reader-facing problem and benefit sections receive actionable length and internal-identifier findings before a plan reaches review.
 * Plan-level checks then catch missing dependencies, cycles, duplicate IDs, competing active milestones, and superseded milestones that name no
 * resolvable successor.
 *
 * Each finding names the milestone file so an author can go directly to the sentence or relationship that needs correction.
 */
import { scrubDurableText } from "./evidence/redaction.js";
import type { PlanExportRecord } from "./plans-export.js";

/** Hidden parsed sections used by `plans check`; symbol keys never enter a user's JSON or Markdown export. */
export const PLAN_STRUCTURE_SECTIONS = Symbol("planStructureSections");

/** States that represent one currently active execution or review boundary. */
const ACTIVE_STATUSES = new Set([
  "in-progress",
  "testing-gate",
  "human-verification-pending",
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
 * Convert the splitter's normalized heading back to the title text users see.
 * Use only for fixed plain-language headings; empty input stays empty for an honest diagnostic.
 */
function displaySectionHeading(normalizedHeading: string): string {
  // An empty parser value gives the user no first character to capitalize.
  if (normalizedHeading.length === 0) return "";
  return `${normalizedHeading[0]?.toUpperCase() ?? ""}${normalizedHeading.slice(1)}`;
}

/**
 * Validate one present problem or benefit section against the rules an author can fix mechanically.
 * Use after the shared Markdown splitter identifies whether the heading is current or legacy.
 * Invalid input becomes findings rather than throwing, so one check can report every correction.
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

  // A sentence outside the published band makes review either cryptic or needlessly dense.
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
  // Standard+ summaries are deliberately one plain line and one sentence so exports have one unambiguous reader-facing value.
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
 * Return strict cardinality and heading-style findings for one reader-facing role.
 *
 * @param sectionContract - current and legacy names for the problem or benefit role
 * @param currentSectionCount - visible sections using the current heading
 * @param legacySectionCount - visible sections using the compatibility heading
 * @param doesMilestoneUseCurrentHeadings - whether either role selected the current pair
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
  if (currentSectionCount > 1) {
    findings.push({
      isStrictBlocking: true,
      message:
        `current plain-language ${sectionContract.role} section is duplicated; ` +
        `expected "exactly one ## ${displaySectionHeading(sectionContract.currentHeading)}"; received "${currentSectionCount} matching sections"`,
    });
  }
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
 * Evaluate both reader-facing section roles from one parsed milestone.
 * Use for default advisories and strict failures so both modes share exactly one interpretation.
 * Missing or malformed prose becomes findings and never interrupts the rest of the plan check.
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
        ),
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
 * Return plain-language guidance that stays non-blocking in the selected checker mode.
 * Use in CLI output so default mode explains every issue while strict mode avoids duplicating current errors as warnings.
 * Invariant: a current strict finding appears only in the error lane, never in both lanes.
 *
 * @param records - selected milestones; an empty list produces no advisory output
 * @param isStrict - true hides current findings because the strict error lane owns them
 * @returns source-labelled advisory lines; empty means no non-blocking prose issue remains
 */
export function collectPlanStructureAdvisories(
  records: PlanExportRecord[],
  isStrict: boolean,
): string[] {
  const advisories: string[] = [];
  // Each milestone remains independently actionable in the terminal report.
  for (const record of records) {
    const milestoneFindings = collectMilestonePlainLanguageFindings(record);
    // Current findings move from warning to error only when the user chooses strict mode.
    for (const finding of milestoneFindings) {
      // Strict errors are omitted here so the same issue never appears twice to the user.
      if (isStrict && finding.isStrictBlocking) continue;
      advisories.push(`${record.sourceFile}: ${finding.message}`);
    }
  }
  return advisories;
}

/**
 * Collect source-labelled current-heading findings for the strict plan gate.
 *
 * Use when a user requests blocking validation; legacy and compatibility findings stay advisory.
 * Invariant: a current strict finding enters this error lane exactly once.
 */
function collectStrictPlainLanguageErrors(
  records: PlanExportRecord[],
): string[] {
  const errors: string[] = [];
  // Strict mode evaluates each milestone separately so every error retains its file label.
  for (const record of records) {
    const milestoneFindings = collectMilestonePlainLanguageFindings(record);
    // Legacy findings stay advisory and therefore never enter this error lane.
    for (const finding of milestoneFindings) {
      // A non-blocking finding preserves historical plans even under an explicit strict check.
      if (!finding.isStrictBlocking) continue;
      errors.push(`${record.sourceFile}: ${finding.message}`);
    }
  }
  return errors;
}

/** Parsed filename identity used for local dependency validation. */
interface MilestoneIdentity {
  id: string;
  numericId: string;
  record: PlanExportRecord;
  dependencies: string[];
}

/**
 * Extract the local milestone ID and its zero-insensitive duplicate key.
 * Use before showing dependency findings so every message points to the ID users see.
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
 * Parse strict dependency metadata while keeping narrative sequencing out of the graph.
 * Use when building the start order a plan author can follow.
 */
function readDependencies(
  identity: MilestoneIdentity,
  requiresField: boolean,
  errors: string[],
): string[] {
  const rawDependencies = identity.record.dependencies.trim();
  // An empty field leaves users without an executable order in a multi-milestone plan.
  if (rawDependencies.length === 0) {
    // Single-milestone plans need no explicit graph edge, while larger plans do.
    if (requiresField) {
      errors.push(
        `${identity.record.sourceFile}: missing dependencies for a multi-milestone plan`,
      );
    }
    return [];
  }
  // `none` explicitly tells the user this milestone can start without another local milestone.
  if (rawDependencies === "none") return [];
  // Narrative qualifiers cannot become reliable graph edges, so the author receives the accepted shape.
  if (!/^M\d+(?:\s*,\s*M\d+)*$/u.test(rawDependencies)) {
    errors.push(
      `${identity.record.sourceFile}: dependencies must be \`none\` or comma-separated local milestone IDs`,
    );
    return [];
  }
  return rawDependencies.split(",").map((dependency) => dependency.trim());
}

/**
 * Find one cycle in a fully local dependency graph.
 * Use to show the first prerequisite loop that prevents a user from starting work.
 */
function findDependencyCycle(
  identitiesById: ReadonlyMap<string, MilestoneIdentity>,
): string[] | null {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const path: string[] = [];

  /**
   * Walk one dependency chain and return its first reachable cycle.
   * Use internally to preserve the milestone order shown in the user's plan.
   */
  function visit(id: string): string[] | null {
    // Re-entering the active path closes a cycle that would prevent a user from finding a valid start order.
    if (visiting.has(id)) {
      const cycleStart = path.indexOf(id);
      return [...path.slice(cycleStart), id];
    }
    // A completed branch was already proven cycle-free during this traversal.
    if (visited.has(id)) return null;
    visiting.add(id);
    path.push(id);
    const identity = identitiesById.get(id);
    // Follow only declared local prerequisites because narrative sequencing is not executable plan state.
    for (const dependency of identity?.dependencies ?? []) {
      // An unresolved dependency already has its own actionable error and cannot extend this local cycle.
      if (!identitiesById.has(dependency)) continue;
      const cycle = visit(dependency);
      // The first cycle is enough to show the author the exact loop they must break.
      if (cycle) return cycle;
    }
    path.pop();
    visiting.delete(id);
    visited.add(id);
    return null;
  }

  // Start from every milestone because a disconnected component can contain its own cycle.
  for (const id of identitiesById.keys()) {
    const cycle = visit(id);
    // Return the first deterministic cycle so the CLI avoids repetitive paths through the same loop.
    if (cycle) return cycle;
  }
  return null;
}

/** Canonical lookup tables used to reconcile milestone IDs and numeric aliases. */
interface MilestoneIndexes {
  byId: Map<string, MilestoneIdentity>;
  byNumber: Map<string, MilestoneIdentity>;
}

/**
 * Read either supported title prefix into the canonical local ID shape.
 * Use when checking that the heading and filename send users to the same milestone.
 */
function readTitleMilestoneId(title: string): string | undefined {
  const compactTitleNumber = title.match(/^M(\d+)\b/iu)?.[1];
  // The compact title is the current form authors see in generated milestone examples.
  if (compactTitleNumber !== undefined) return `M${compactTitleNumber}`;
  const longTitleNumber = title.match(/^Milestone\s+(\d+)\b/iu)?.[1];
  // Undefined means neither supported title form gives the user a milestone identity.
  return longTitleNumber === undefined ? undefined : `M${longTitleNumber}`;
}

/**
 * Report filename and title drift for one local milestone identity.
 * Use before dependency checks so later messages cannot point users to a conflicting ID.
 */
function collectMilestoneIdentityErrors(
  identity: MilestoneIdentity,
  requiresTitleId: boolean,
  errors: string[],
): void {
  // Lowercase or ID-less filenames make CLI findings harder for users to map back to milestone labels.
  if (!/^M\d.*\.md$/u.test(identity.record.sourceFile)) {
    errors.push(
      `${identity.record.sourceFile}: milestone filename must begin with an uppercase M and digits`,
    );
  }
  const titleId = readTitleMilestoneId(identity.record.title);
  // Multi-milestone titles need their ID so readers can reconcile dependencies without opening filenames separately.
  if (!titleId && requiresTitleId) {
    errors.push(
      `${identity.record.sourceFile}: multi-milestone title must begin with its milestone ID`,
    );
  }
  // A conflicting title sends a user to the wrong milestone even when the filename itself is valid.
  if (titleId && titleId !== identity.id) {
    errors.push(
      `${identity.record.sourceFile}: title ID ${titleId} does not match filename ID ${identity.id}`,
    );
  }
}

/**
 * Insert one numeric identity while reporting zero-padding aliases.
 * Use to prevent two filenames from presenting the same milestone number to users.
 */
function indexMilestoneNumber(
  identity: MilestoneIdentity,
  identitiesByNumber: Map<string, MilestoneIdentity>,
  errors: string[],
): void {
  const duplicate = identitiesByNumber.get(identity.numericId);
  // Zero-padding variants still represent one user-facing milestone number and must not coexist.
  if (duplicate) {
    errors.push(
      `${identity.record.sourceFile}: duplicate milestone ID ${identity.id} conflicts with ${duplicate.id}`,
    );
    return;
  }
  identitiesByNumber.set(identity.numericId, identity);
}

/**
 * Index local IDs while reporting duplicate numeric identities and title drift.
 * Use once per plan to prepare the lookups behind dependency guidance.
 */
function indexMilestones(
  identities: MilestoneIdentity[],
  requiresTitleId: boolean,
  errors: string[],
): MilestoneIndexes {
  const identitiesById = new Map<string, MilestoneIdentity>();
  const identitiesByNumber = new Map<string, MilestoneIdentity>();

  // Every parsed milestone contributes its title checks and one numeric lookup entry.
  for (const identity of identities) {
    collectMilestoneIdentityErrors(identity, requiresTitleId, errors);
    indexMilestoneNumber(identity, identitiesByNumber, errors);
    identitiesById.set(identity.id, identity);
  }
  return { byId: identitiesById, byNumber: identitiesByNumber };
}

/**
 * Parse dependency fields and report unresolved or self-referential edges.
 * Use to turn each visible prerequisite into a milestone the author can actually complete.
 */
function collectDependencyReferenceErrors(
  identities: MilestoneIdentity[],
  identitiesById: ReadonlyMap<string, MilestoneIdentity>,
  requiresDependencies: boolean,
  errors: string[],
): void {
  // Parse each field before checking its edges so later state checks share one graph.
  for (const identity of identities) {
    identity.dependencies = readDependencies(
      identity,
      requiresDependencies,
      errors,
    );
    // Each dependency either resolves locally, points to itself, or tells the author what ID is missing.
    for (const dependency of identity.dependencies) {
      // Self-dependency leaves this milestone permanently unable to start.
      if (dependency === identity.id) {
        errors.push(
          `${identity.record.sourceFile}: milestone cannot depend on itself`,
        );
        // A missing local ID gives the user no milestone they can complete to unblock this work.
      } else if (!identitiesById.has(dependency)) {
        errors.push(
          `${identity.record.sourceFile}: dependency ${dependency} does not resolve in this plan`,
        );
      }
    }
  }
}

/**
 * Report active or complete milestones whose declared prerequisites remain open.
 * Use to stop users claiming progress before the plan's visible start conditions are satisfied.
 */
function collectDependencyStateErrors(
  identities: MilestoneIdentity[],
  identitiesById: ReadonlyMap<string, MilestoneIdentity>,
): string[] {
  const errors: string[] = [];
  // Only work that is active or claimed complete can contradict an unfinished prerequisite.
  for (const identity of identities) {
    const status = identity.record.status.trim().toLowerCase();
    // Future or abandoned milestones make no claim that their dependency gate has passed.
    if (!ACTIVE_STATUSES.has(status) && status !== "complete") continue;
    // Check every declared prerequisite so the user sees each blocker in the selected milestone.
    for (const dependency of identity.dependencies) {
      const dependencyRecord = identitiesById.get(dependency)?.record;
      // A resolved dependency still blocks when its own visible status is not complete.
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
 * Require every superseded milestone to name the successor that carries its remainder.
 * Use so a reader can follow a spent milestone to the live work without searching the plan.
 *
 * @param identities - parsed milestone identities with their statuses and reasons
 * @param identitiesByNumber - zero-insensitive lookup of every local milestone
 * @returns one error per missing, self-referential, or unresolved successor; empty means every superseded milestone points at real work
 */
function collectSupersededSuccessorErrors(
  identities: MilestoneIdentity[],
  identitiesByNumber: ReadonlyMap<string, MilestoneIdentity>,
): string[] {
  const errors: string[] = [];
  // Only a superseded milestone promises a successor; the other terminal states owe no pointer.
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

/**
 * Enforce one active execution or verification boundary per plan.
 * Use so timing and next-action guidance point users to exactly one current milestone.
 */
function collectActiveStateErrors(identities: MilestoneIdentity[]): string[] {
  const activeMilestones = identities.filter((identity) =>
    ACTIVE_STATUSES.has(identity.record.status.trim().toLowerCase()),
  );
  // Two active milestones make timing and next-action guidance ambiguous for the user.
  if (activeMilestones.length > 1) {
    return [
      `plan: multiple active milestones: ${activeMilestones.map((identity) => identity.id).join(", ")}`,
    ];
  }
  return [];
}

/**
 * Check that a plan's milestones form a workable set, not just valid files.
 * Use in strict mode after each milestone passes on its own, so the author learns about duplicate ids, missing or circular dependencies, and two
 * milestones being active at once.
 *
 * @param records - every milestone parsed from the plan directory; an empty list means there
 *   is no plan to cross-check and nothing is reported
 * @returns one error line per structural problem, each naming its milestone file; empty means
 *   the milestones fit together and the author has a workable order
 */
export function collectPlanStructureErrors(
  records: PlanExportRecord[],
): string[] {
  const errors = collectStrictPlainLanguageErrors(records);
  // Files without a milestone ID cannot participate in local graph relationships.
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
  const cycle = findDependencyCycle(indexes.byId);
  // A discovered loop names the exact dependency route the author must break.
  if (cycle) {
    errors.push(`plan: dependency cycle detected: ${cycle.join(" -> ")}`);
  }
  errors.push(...collectDependencyStateErrors(identities, indexes.byId));
  errors.push(
    ...collectSupersededSuccessorErrors(identities, indexes.byNumber),
  );
  errors.push(...collectActiveStateErrors(identities));
  return errors;
}
