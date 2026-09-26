/**
 * Checks the receipt an author supplies before skill scaffolding.
 *
 * Discipline skills need pressure and rationalisation evidence; capability skills need an already-correct control.
 * Both need a recorded failure so the scaffold addresses an observed problem.
 *
 * Missing fields, known placeholders, and negated failure assertions produce guidance on what to add.
 * Acceptance confirms receipt completeness, not that an agent trial actually occurred.
 */
import { readFileSync, statSync } from "node:fs";
import { basename, relative, resolve } from "node:path";

const SKILL_TDD_LOG_DIR = ".goat-flow/logs/sessions";
const RED_PRESSURE_TYPES = [
  "time",
  "sunk cost",
  "authority",
  "economic",
  "exhaustion",
  "social",
  "pragmatic",
] as const;
const VERBATIM_QUOTE_PAIRS = [
  ['"', '"'],
  ["'", "'"],
  ["“", "”"],
  ["‘", "’"],
  ["`", "`"],
] as const;

/** Result of checking the failing-first receipt required by the skill TDD contract. */
interface RedLogValidation {
  relativePath: string | null;
  errors: string[];
}

/**
 * Guide an author whose RED receipt was rejected; no scaffold has been written yet.
 * These steps explain what evidence to record before retrying skill new.
 *
 * @param name - skill name they were trying to create, used in the suggested log path
 * @returns ordered recovery steps; never empty, so a blocked author always has a next action
 */
export function redGateNextSteps(name: string): string[] {
  return [
    "Run a concrete failing scenario without the skill and record its Skill type: discipline-enforcing, technique, pattern, or reference.",
    "Discipline-enforcing (the default) requires three distinct documented pressures and a quoted rationalisation; other types require a concrete Control naming an already-correct case and its expected unchanged outcome.",
    `Capture RED evidence at ${SKILL_TDD_LOG_DIR}/YYYY-MM-DD-${name}-tdd.md.`,
    `Re-run skill new with --red-log ${SKILL_TDD_LOG_DIR}/YYYY-MM-DD-${name}-tdd.md.`,
  ];
}

/**
 * Guide an author from an accepted receipt and written scaffold through the remaining skill tests.
 * Reuse their RED evidence so they can continue with GREEN instead of repeating the first trial.
 *
 * @param redLogPath - the accepted RED log, quoted back so they know which one was used
 * @returns ordered steps from scaffold to a hardened skill; never empty
 */
export function scaffoldNextSteps(redLogPath: string): string[] {
  return [
    `Use the accepted RED evidence in ${redLogPath}.`,
    "Replace scaffold placeholders only to close failures captured during RED.",
    "Run GREEN, REFACTOR, and STAY GREEN from .goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md before scoring.",
    "Complete .goat-flow/skill-docs/skill-quality-testing/deployment.md before merge.",
  ];
}

/** Reject an author's receipt path when it leaves the project's session-log directory. */
function isOutsideLogRoot(logRoot: string, absolutePath: string): boolean {
  const pathWithinLogRoot = relative(logRoot, absolutePath);
  return (
    pathWithinLogRoot === ".." ||
    pathWithinLogRoot.startsWith("../") ||
    pathWithinLogRoot.startsWith("..\\")
  );
}

/** Read the author's first RED trial; null means it is missing, and later GREEN evidence cannot fill its fields. */
function redIterationSection(content: string): string | null {
  const heading = content.match(/^## Iteration \d+ \(RED\)\s*$/mu);
  // Without a RED heading, the author has not supplied the trial section required for scaffolding.
  if (heading?.index === undefined) return null;
  const remaining = content.slice(heading.index + heading[0].length);
  const nextHeading = remaining.search(/^## /mu);
  // A final RED section runs to the end of the receipt; otherwise its evidence stops at the next section.
  return nextHeading === -1 ? remaining : remaining.slice(0, nextHeading);
}

/** Read a named RED field; an empty string lets the caller apply its default or missing-value rule. */
function redField(section: string, label: string): string {
  const prefix = `${label}:`;
  const line = section
    .split(/\r?\n/u)
    .find((candidate) => candidate.startsWith(prefix));
  // An omitted or blank field remains empty; the caller decides whether to use a default or report missing evidence.
  return line?.slice(prefix.length).trim() ?? "";
}

/** Check that an author replaced the template field with text; this does not prove the recorded trial occurred. */
function hasNonPlaceholderRedValue(evidenceText: string): boolean {
  const normalized = evidenceText.trim();
  // Blank fields and unchanged placeholders cannot satisfy the author's evidence requirement.
  return (
    normalized.length > 0 &&
    !/^(?:\[.*\]|<.*>|none|n\/a|unknown|tbd)$/iu.test(normalized)
  );
}

/** Detect wording that denies the claimed result, so writing a failure label alone cannot make a successful trial count as RED. */
function startsWithNegatedAssertion(assertionText: string): boolean {
  const normalized = assertionText
    .trim()
    .replace(/^[?:;,.\u2013\u2014-]+\s*/u, "");
  return /^(?:(?:no|not|none|never|false|absent|without|unknown|tbd|n\/a|zero|0)\b|(?:did|does|was|were)\s+not\b)/iu.test(
    normalized,
  );
}

/** Recognize a pressure category in the author's description; null means unknown or explicitly denied pressure. */
function documentedPressure(
  pressureText: string,
): (typeof RED_PRESSURE_TYPES)[number] | null {
  const normalized = pressureText
    .toLowerCase()
    .replace(/[-_]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const pressure = RED_PRESSURE_TYPES.find(
    (candidate) =>
      normalized === candidate ||
      normalized.startsWith(`${candidate} `) ||
      normalized.startsWith(`${candidate}:`),
  );
  // Unrecognized categories do not count toward the pressures a discipline-skill author must demonstrate.
  if (pressure === undefined) return null;
  const detail = normalized.slice(pressure.length);
  // A named pressure followed by a denial does not show that the author applied it.
  return startsWithNegatedAssertion(detail) ? null : pressure;
}

/** Count distinct recognized pressures; an empty field counts as zero, and repeated categories cannot fill the requirement. */
function documentedPressureCount(section: string): number {
  const pressureLine = redField(section, "Pressures applied");
  const pressures = pressureLine
    .split(/[,;|]/u)
    .map(documentedPressure)
    .filter(
      (pressure): pressure is (typeof RED_PRESSURE_TYPES)[number] =>
        pressure !== null,
    );
  return new Set(pressures).size;
}

/** Check that the author's reported outcome starts with a failure, rather than merely mentioning failure elsewhere. */
function hasExplicitFailureOutcome(section: string): boolean {
  const behaviour = redField(section, "Agent behaviour");
  // A blank outcome or template placeholder gives the author no failing behavior to harden the skill against.
  if (!hasNonPlaceholderRedValue(behaviour)) return false;
  const failurePrefix = behaviour.match(
    /^(?:(?:the\s+)?agent\s+)?(?:fail(?:ed|ure)?|skip(?:ped)?|partial(?:ly)?|bypass(?:ed)?|rationali[sz](?:ed|ation)?|chose\s+[bc]\b|non[- ]compliant\b|wrong\b)/iu,
  );
  // A successful or unclassified outcome cannot establish the RED trial needed before scaffolding.
  if (failurePrefix === null) return false;
  const remainder = behaviour.slice(failurePrefix[0].length).trim();
  return (
    !startsWithNegatedAssertion(remainder) &&
    !/^(?:to\s+fail|was\s+not|did\s+not)\b/iu.test(remainder)
  );
}

/** Read an author's quoted rationalisation bullet; null means the line is not a nonempty supported quotation. */
function verbatimRationalisationValue(line: string): string | null {
  const bullet = line.trim();
  // Only a listed quotation is evidence; surrounding receipt prose must not be mistaken for the agent's words.
  if (!bullet.startsWith("- ")) return null;
  const bulletText = bullet.slice(2).trim();
  const quotePair = VERBATIM_QUOTE_PAIRS.find(
    ([open, close]) =>
      bulletText.startsWith(open) && bulletText.endsWith(close),
  );
  // Missing quote marks or an empty pair leave the author without a verbatim rationalisation.
  if (quotePair === undefined || bulletText.length <= 2) return null;
  return bulletText.slice(quotePair[0].length, -quotePair[1].length);
}

/** Reject quotations saying no rationalisation was captured; quoting an absence does not supply the missing evidence. */
function isAbsentRationalisation(rationalisationText: string): boolean {
  const normalized = rationalisationText.trim().replace(/\s+/gu, " ");
  return /^(?:(?:none|nothing)\s+(?:(?:(?:was|were)\s+)?(?:observed|captured|recorded|provided|available|said|heard|offered)|occurred|to\s+(?:capture|record|quote|say|provide|offer))|no\s+(?:rationali[sz]ations?|quotes?|excuses?)\s+(?:(?:(?:was|were)\s+)?(?:observed|captured|recorded|provided|available|given|made)|occurred)|(?:(?:the\s+)?agent\s+)?(?:did\s+not|never)\s+(?:rationali[sz]e|say|provide|offer|give))\b/iu.test(
    normalized,
  );
}

/** Find a substantive quotation in the author's rationalisation section, without borrowing evidence from another field. */
function hasVerbatimRationalisation(section: string): boolean {
  const lines = section.split(/\r?\n/u);
  const markerIndex = lines.findIndex(
    (line) => line.trim() === "Rationalisations captured (verbatim):",
  );
  // An omitted rationalisation section needs its own diagnostic, even if another section contains quotes.
  if (markerIndex === -1) return false;
  // Read the author's listed quotations until the next receipt field begins.
  for (const line of lines.slice(markerIndex + 1)) {
    // The next field belongs to another part of the receipt and cannot supply this section's quotation.
    if (/^[A-Z][^:]{1,60}:\s*/u.test(line)) break;
    const quoted = verbatimRationalisationValue(line);
    // One non-placeholder quotation is enough, provided it does not say that no rationalisation occurred.
    if (
      quoted !== null &&
      hasNonPlaceholderRedValue(quoted) &&
      !isAbsentRationalisation(quoted)
    ) {
      return true;
    }
  }
  return false;
}

/** Tell an author which evidence their declared skill type still needs; older receipts retain the discipline requirements. */
function validateSkillTypeEvidence(redSection: string): string[] {
  // Receipts without a skill type keep the existing discipline gate instead of silently weakening their evidence requirement.
  const skillType =
    redField(redSection, "Skill type").toLowerCase() || "discipline-enforcing";
  // Capability authors demonstrate a failing case and an already-correct control, without inventing pressure or rationalisations.
  if (["technique", "pattern", "reference"].includes(skillType)) {
    return hasNonPlaceholderRedValue(redField(redSection, "Control"))
      ? []
      : [
          "RED log must include a concrete `Control:` naming an already-correct case and its expected unchanged outcome.",
        ];
  }
  // An unknown type needs correction before the CLI can decide which evidence to require.
  if (skillType !== "discipline-enforcing") {
    return [
      "RED log `Skill type:` must be discipline-enforcing, technique, pattern, or reference.",
    ];
  }
  const errors: string[] = [];
  // A discipline receipt must show distinct pressures; repeated or unrecognized labels do not fill the gap.
  if (documentedPressureCount(redSection) < 3) {
    errors.push(
      "RED log must record at least three pressures using three distinct documented pressures on `Pressures applied:`.",
    );
  }
  // Ask for the agent's actual words when the author has supplied no usable rationalisation quotation.
  if (!hasVerbatimRationalisation(redSection)) {
    errors.push(
      "RED log must include at least one quoted verbatim rationalisation bullet.",
    );
  }
  return errors;
}

/** Collect the missing or invalid RED fields so the author can repair the receipt before retrying skill new. */
function validateRedLogContent(content: string): string[] {
  const errors: string[] = [];
  const redSection = redIterationSection(content);
  // An author may have supplied a log containing only later trials; it still needs a first failing RED trial.
  if (redSection === null) {
    errors.push("RED log must contain an `## Iteration N (RED)` section.");
  }
  // An absent RED section stays empty so the author receives the remaining missing-field diagnostics in the same response.
  const isolatedRedSection = redSection ?? "";
  // The author must identify the task attempted, not leave the scenario blank or copy a template placeholder.
  if (!hasNonPlaceholderRedValue(redField(isolatedRedSection, "Scenario"))) {
    errors.push(
      "RED log must include a concrete `Scenario:` inside the RED section.",
    );
  }
  // Without an explicit failing outcome, the receipt does not explain which problem the new skill will address.
  if (!hasExplicitFailureOutcome(isolatedRedSection)) {
    errors.push(
      "RED log `Agent behaviour:` must start with an explicit failure outcome.",
    );
  }
  return [...errors, ...validateSkillTypeEvidence(isolatedRedSection)];
}

/**
 * Reports every receipt problem instead of throwing so callers can block scaffolding with actionable diagnostics.
 * Failure evidence and skill-type-specific fields must be concrete; the recorded trial itself is not verified here.
 *
 * @param projectRoot - project the author is working in, used to keep the log inside it
 * @param name - skill name being created, used in path and message text
 * @param redLogPath - path passed to `--red-log`; omission or an empty value blocks scaffolding with a missing-receipt diagnostic
 * @returns validation errors and the resolved log path; an empty error list means the required fields were accepted
 */
export function validateRedLog(
  projectRoot: string,
  name: string,
  redLogPath: string | undefined,
): RedLogValidation {
  // Running skill new without --red-log returns the next evidence step instead of creating an untested scaffold.
  if (!redLogPath) {
    return {
      relativePath: null,
      errors: ["No --red-log receipt was supplied."],
    };
  }

  const absolutePath = resolve(projectRoot, redLogPath);
  const logRoot = resolve(projectRoot, SKILL_TDD_LOG_DIR);
  const relativePath = relative(projectRoot, absolutePath).replace(/\\/gu, "/");
  const errors: string[] = [];
  // Keep the receipt with this project's session evidence; a path outside that directory is rejected before reading it.
  if (isOutsideLogRoot(logRoot, absolutePath)) {
    errors.push(`RED log must be inside ${SKILL_TDD_LOG_DIR}/.`);
    return { relativePath, errors };
  }
  const expectedName = new RegExp(
    `^\\d{4}-\\d{2}-\\d{2}-${name}-tdd\\.md$`,
    "u",
  );
  // The required filename includes this skill's name so a mismatched receipt gets a diagnostic.
  if (!expectedName.test(basename(absolutePath))) {
    errors.push(`RED log filename must be YYYY-MM-DD-${name}-tdd.md.`);
  }
  let redLogStats;
  try {
    redLogStats = statSync(absolutePath);
  } catch {
    // A moved receipt or an inaccessible parent folder prevents lookup; the author gets a missing-log diagnostic.
    errors.push(`RED log not found: ${relativePath}.`);
    return { relativePath, errors };
  }
  // Selecting a directory instead of the receipt file needs a corrective diagnostic, not a failed file read.
  if (!redLogStats.isFile()) {
    errors.push(`RED log must be a regular file: ${relativePath}.`);
    return { relativePath, errors };
  }

  let content: string;
  try {
    content = readFileSync(absolutePath, "utf-8");
  } catch {
    // Removal after lookup or unreadable file permissions returns a read-error diagnostic so the author can restore access and retry.
    errors.push(`RED log could not be read: ${relativePath}.`);
    return { relativePath, errors };
  }

  return {
    relativePath,
    errors: [...errors, ...validateRedLogContent(content)],
  };
}
