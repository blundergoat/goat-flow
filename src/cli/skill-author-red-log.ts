/**
 * Checks the RED evidence a user must supply before scaffolding a hardened skill.
 *
 * Skill TDD asks an author to first document how the skill fails - the pressure applied, the rationalisation quoted verbatim, the concrete failure
 * seen - and only then scaffold.
 * This module is the gate that decides whether what they wrote is real evidence or a placeholder.
 *
 * The checks look pedantic on purpose.
 * A log saying "the agent might refuse" proves nothing and would let an author scaffold a skill whose hardening was never tested, so vague values,
 * negated assertions, and absent quotes are all rejected with a message naming what to add.
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
 * Tell an author what to do next when their RED evidence is missing or too weak.
 * Nothing is written in this case, so this is the whole of what they see: the steps that would let them come back and scaffold successfully.
 *
 * @param name - skill name they were trying to create, used in the suggested log path
 * @returns ordered steps to follow; never empty, because a blocked author always needs a
 *   route forward rather than a bare refusal
 */
export function redGateNextSteps(name: string): string[] {
  return [
    "Run a concrete failing scenario without the skill using at least three distinct documented pressures.",
    `Capture RED evidence at ${SKILL_TDD_LOG_DIR}/YYYY-MM-DD-${name}-tdd.md.`,
    `Re-run skill new with --red-log ${SKILL_TDD_LOG_DIR}/YYYY-MM-DD-${name}-tdd.md.`,
  ];
}

/**
 * Tell an author what to do next once their RED evidence was accepted and the scaffold exists.
 * Picks up from the evidence they already wrote rather than sending them back to the start.
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

/** Return whether a candidate evidence file escapes the canonical session-log root. */
function isOutsideLogRoot(logRoot: string, absolutePath: string): boolean {
  const pathWithinLogRoot = relative(logRoot, absolutePath);
  return (
    pathWithinLogRoot === ".." ||
    pathWithinLogRoot.startsWith("../") ||
    pathWithinLogRoot.startsWith("..\\")
  );
}

/** Return only the first RED iteration so later GREEN evidence cannot satisfy the gate. */
function redIterationSection(content: string): string | null {
  const heading = content.match(/^## Iteration \d+ \(RED\)\s*$/mu);
  if (heading?.index === undefined) return null;
  const remaining = content.slice(heading.index + heading[0].length);
  const nextHeading = remaining.search(/^## /mu);
  return nextHeading === -1 ? remaining : remaining.slice(0, nextHeading);
}

/** Read one canonical single-line field from the isolated RED iteration. */
function redField(section: string, label: string): string {
  const prefix = `${label}:`;
  const line = section
    .split(/\r?\n/u)
    .find((candidate) => candidate.startsWith(prefix));
  return line?.slice(prefix.length).trim() ?? "";
}

/** Reject empty values and the placeholders shipped by the authoring template. */
function isConcreteRedValue(value: string): boolean {
  const normalized = value.trim();
  return (
    normalized.length > 0 &&
    !/^(?:\[.*\]|<.*>|none|n\/a|unknown|tbd)$/iu.test(normalized)
  );
}

/** Detect a direct denial immediately after a field's positive classification. */
function startsWithNegatedAssertion(value: string): boolean {
  const normalized = value.trim().replace(/^[?:;,.\u2013\u2014-]+\s*/u, "");
  return /^(?:(?:no|not|none|never|false|absent|without|unknown|tbd|n\/a|zero|0)\b|(?:did|does|was|were)\s+not\b)/iu.test(
    normalized,
  );
}

/** Map one pressure description to the documented pressure taxonomy. */
function documentedPressure(
  value: string,
): (typeof RED_PRESSURE_TYPES)[number] | null {
  const normalized = value
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
  if (pressure === undefined) return null;
  const detail = normalized.slice(pressure.length);
  return startsWithNegatedAssertion(detail) ? null : pressure;
}

/** Count distinct recognized pressures instead of arbitrary comma-separated tokens. */
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

/** Require the behaviour field to lead with a failure classification, not mention one. */
function hasExplicitFailureOutcome(section: string): boolean {
  const behaviour = redField(section, "Agent behaviour");
  if (!isConcreteRedValue(behaviour)) return false;
  const classification = behaviour.match(
    /^(?:(?:the\s+)?agent\s+)?(?:fail(?:ed|ure)?|skip(?:ped)?|partial(?:ly)?|bypass(?:ed)?|rationali[sz](?:ed|ation)?|chose\s+[bc]\b|non[- ]compliant\b|wrong\b)/iu,
  );
  if (classification === null) return false;
  const remainder = behaviour.slice(classification[0].length).trim();
  return (
    !startsWithNegatedAssertion(remainder) &&
    !/^(?:to\s+fail|was\s+not|did\s+not)\b/iu.test(remainder)
  );
}

/** Strip one supported quote pair from a rationalisation bullet. */
function verbatimRationalisationValue(line: string): string | null {
  const bullet = line.trim();
  if (!bullet.startsWith("- ")) return null;
  const value = bullet.slice(2).trim();
  const quotePair = VERBATIM_QUOTE_PAIRS.find(
    ([open, close]) => value.startsWith(open) && value.endsWith(close),
  );
  if (quotePair === undefined || value.length <= 2) return null;
  return value.slice(quotePair[0].length, -quotePair[1].length);
}

/** Reject quoted prose that explicitly reports an absent rationalisation. */
function isAbsentRationalisation(value: string): boolean {
  const normalized = value.trim().replace(/\s+/gu, " ");
  return /^(?:(?:none|nothing)\s+(?:(?:(?:was|were)\s+)?(?:observed|captured|recorded|provided|available|said|heard|offered)|occurred|to\s+(?:capture|record|quote|say|provide|offer))|no\s+(?:rationali[sz]ations?|quotes?|excuses?)\s+(?:(?:(?:was|were)\s+)?(?:observed|captured|recorded|provided|available|given|made)|occurred)|(?:(?:the\s+)?agent\s+)?(?:did\s+not|never)\s+(?:rationali[sz]e|say|provide|offer|give))\b/iu.test(
    normalized,
  );
}

/** Accept only a substantive quoted bullet in the canonical rationalisation block. */
function hasVerbatimRationalisation(section: string): boolean {
  const lines = section.split(/\r?\n/u);
  const markerIndex = lines.findIndex(
    (line) => line.trim() === "Rationalisations captured (verbatim):",
  );
  if (markerIndex === -1) return false;
  for (const line of lines.slice(markerIndex + 1)) {
    if (/^[A-Z][^:]{1,60}:\s*/u.test(line)) break;
    const quoted = verbatimRationalisationValue(line);
    if (
      quoted !== null &&
      isConcreteRedValue(quoted) &&
      !isAbsentRationalisation(quoted)
    ) {
      return true;
    }
  }
  return false;
}

/** Validate the RED fields whose content proves a failure rather than file presence. */
function validateRedLogContent(content: string): string[] {
  const errors: string[] = [];
  const redSection = redIterationSection(content);
  if (redSection === null) {
    errors.push("RED log must contain an `## Iteration N (RED)` section.");
  }
  const isolatedRedSection = redSection ?? "";
  if (!isConcreteRedValue(redField(isolatedRedSection, "Scenario"))) {
    errors.push(
      "RED log must include a concrete `Scenario:` inside the RED section.",
    );
  }
  if (documentedPressureCount(isolatedRedSection) < 3) {
    errors.push(
      "RED log must record at least three pressures using three distinct documented pressures on `Pressures applied:`.",
    );
  }
  if (!hasExplicitFailureOutcome(isolatedRedSection)) {
    errors.push(
      "RED log `Agent behaviour:` must start with an explicit failure outcome.",
    );
  }
  if (!hasVerbatimRationalisation(isolatedRedSection)) {
    errors.push(
      "RED log must include at least one quoted verbatim rationalisation bullet.",
    );
  }
  return errors;
}

/**
 * Decide whether an author's RED log really documents a failure, or only claims one.
 *
 * This is the gate before scaffolding: it checks the log sits in the expected place and that its pressures, quoted rationalisation, and failure
 * outcome are concrete rather than placeholder text.
 *
 * @param projectRoot - project the author is working in, used to keep the log inside it
 * @param name - skill name being created, used in path and message text
 * @param redLogPath - path they passed to `--red-log`; omitted means they skipped the RED
 *   phase entirely, which is reported as a blocked scaffold rather than an error
 * @returns validation errors and the resolved log path; an empty error list means the
 *   evidence is real enough to scaffold from
 */
export function validateRedLog(
  projectRoot: string,
  name: string,
  redLogPath: string | undefined,
): RedLogValidation {
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
  if (isOutsideLogRoot(logRoot, absolutePath)) {
    errors.push(`RED log must be inside ${SKILL_TDD_LOG_DIR}/.`);
    return { relativePath, errors };
  }
  const expectedName = new RegExp(
    `^\\d{4}-\\d{2}-\\d{2}-${name}-tdd\\.md$`,
    "u",
  );
  if (!expectedName.test(basename(absolutePath))) {
    errors.push(`RED log filename must be YYYY-MM-DD-${name}-tdd.md.`);
  }
  let redLogStats;
  try {
    redLogStats = statSync(absolutePath);
  } catch {
    errors.push(`RED log not found: ${relativePath}.`);
    return { relativePath, errors };
  }
  if (!redLogStats.isFile()) {
    errors.push(`RED log must be a regular file: ${relativePath}.`);
    return { relativePath, errors };
  }

  let content: string;
  try {
    content = readFileSync(absolutePath, "utf-8");
  } catch {
    errors.push(`RED log could not be read: ${relativePath}.`);
    return { relativePath, errors };
  }

  return {
    relativePath,
    errors: [...errors, ...validateRedLogContent(content)],
  };
}
