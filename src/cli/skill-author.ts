/** Scaffolds and validates `goat-flow skill new` skill/playbook drafts. */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  statSync,
  type Stats,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { createInterface, type Interface } from "node:readline/promises";

import { getAgentProfile } from "./agents/registry.js";
import { getPackageVersion } from "./paths.js";
import {
  runCandidacyCheck,
  type CandidacyResult,
} from "./quality/candidacy.js";
import { findArtifact, scoreArtifact } from "./quality/skill-quality.js";
import type { AgentId } from "./types.js";

const WORKFLOW_TEMPLATE = `---
name: {{NAME}}
description: "{{DESCRIPTION}}"
goat-flow-skill-version: "{{VERSION}}"
goat-flow-ownership: "user-owned"
---

# /{{NAME}}

## Shared Conventions

Always read \`.goat-flow/skill-docs/skill-preamble.md\` (Proof Gate, evidence discipline, mode system) and \`.goat-flow/skill-docs/skill-conventions.md\` before acting.

## When to Use

Use when [describe the trigger condition for this skill].

**NOT this skill:** [list distinctly different intents that route elsewhere].

## Read First

[List the files / directories the skill must load before acting.]

## Step 0 - Intake

State the intake context:
- Goal: [one-line goal]
- Mode: [Read-Only | File-Write - defaults to Read-Only]
- Read first: [files this skill will load]

## Phase 1 - [Title]

[Procedure for the first phase.]

CHECKPOINT: [what stops execution before continuing to Phase 2].

## Phase 2 - [Title]

[Procedure for the second phase.]

CHECKPOINT: [what stops execution before continuing].

## Phase 3 - [Title]

[Procedure for the third phase.]

## Verification

Apply the Proof Gate from \`skill-preamble.md\` to every claim. Evidence required for every CONFIRMED finding.

- [ ] [criterion 1]
- [ ] [criterion 2]

BLOCKING GATE: human approval required before [final action].

## Modes

- **Read-Only mode**: [describe what this skill does in read-only mode].
- **File-Write mode**: [describe; requires explicit mode confirmation and human approval].

Mode escalation requires explicit user approval before any write.
`;

const DISPATCHER_TEMPLATE = `---
name: {{NAME}}
description: "{{DESCRIPTION}}"
goat-flow-skill-version: "{{VERSION}}"
goat-flow-ownership: "user-owned"
---

# /{{NAME}}

## Shared Conventions

Always read \`.goat-flow/skill-docs/skill-preamble.md\` (Proof Gate, evidence discipline) before routing.

## When to Use

Use when the user's intent matches one of the routes below. This skill does not execute work itself; it dispatches to other skills.

## How It Works

This skill is a router. It reads user intent, matches it against the route map, and dispatches to the appropriate sibling skill. No file writes happen at this layer - the dispatched skill owns its own gates and verification.

## Route Map

| User intent | Route to |
|---|---|
| [intent A - describe] | [/skill-name-a] |
| [intent B - describe] | [/skill-name-b] |
| Unknown intent | Ask the user to clarify before dispatching |

## Read First

Read \`skill-preamble.md\` for the Proof Gate the dispatched skill will apply.
`;

const REPORT_TEMPLATE = `---
name: {{NAME}}
description: "{{DESCRIPTION}}"
goat-flow-skill-version: "{{VERSION}}"
goat-flow-ownership: "user-owned"
---

# /{{NAME}}

## Shared Conventions

Always read \`.goat-flow/skill-docs/skill-preamble.md\` (Proof Gate, evidence discipline) before scanning.

## When to Use

Use when [describe the assessment trigger - audit, review, scan].

**NOT this skill:** [list distinctly different intents - for instance, this is reporting-only; if writes are required, route elsewhere].

## Read First

Read \`skill-preamble.md\` and any project-specific scope files before scanning.

## Quick Scan Path

[Fast assessment for low-risk cases. Lists targets, surfaces obvious findings, exits with a summary.]

## Full Assessment Path

[Deeper assessment for high-risk cases. Multi-phase scan with structured output.]

## Output Format

Reports findings as structured markdown:

\`\`\`markdown
## Findings

- **CONFIRMED**: [finding] - evidence: [OBSERVED file + semantic anchor]
- **SUSPECTED**: [finding] - evidence: [INFERRED reasoning]
\`\`\`

## Constraints

This skill is reporting-only. It must not write files or modify state. If a finding warrants action, route to the appropriate execution skill via the dispatcher.

## Verification

Apply the Proof Gate from \`skill-preamble.md\`. Every CONFIRMED finding requires fresh evidence (OBSERVED tag with file + semantic anchor) re-read in the current session.

- [ ] every finding has cited evidence
- [ ] no fabricated or paraphrased claims

BLOCKING GATE: human reviews findings before any action is taken.
`;

const PLAYBOOK_TEMPLATE = `---
goat-flow-reference-version: "{{VERSION}}"
goat-flow-ownership: "user-owned"
---

# {{NAME}}

## Purpose

{{DESCRIPTION}}

## Availability Check

\`\`\`bash
command -v {{NAME}} || echo "{{NAME}} not installed; use the manual fallback below"
\`\`\`

If the tool is unavailable, use the [Fallback / Troubleshooting](#fallback--troubleshooting) section.

## Boundary

- **Use when:** [describe the tool/capability situation this playbook handles].
- **Do not use when:** [name the adjacent skill, playbook, or instruction-file route].
- **Writes:** read-only guidance unless the workflow below names an explicit file-write action and verification gate.

## Workflow

### Step 1: [Action]

\`\`\`bash
[command]
\`\`\`

[What this step does and what to verify.]

### Step 2: [Verify]

[How to confirm the action succeeded - what file appears, what output is expected.]

## Fallback / Troubleshooting

If the tool is unavailable or fails:
- **Alternative tool**: [describe the alternative]
- **Manual approach**: [describe the manual procedure]
- **Common errors**: [list likely failure modes and remedies]

## Verification Gate

- [ ] Availability check result recorded, or non-runnable reference load condition stated.
- [ ] Boundary still routes adjacent work to the right skill, playbook, instruction file, or CLI.
- [ ] Workflow output has concrete pass/fail evidence.

## When to Load

Skills load this playbook when [describe the trigger - e.g., when user evidence requires browser interaction].
`;

const TEMPLATES_BY_SUBTYPE: Record<string, string> = {
  workflow: WORKFLOW_TEMPLATE,
  dispatcher: DISPATCHER_TEMPLATE,
  report: REPORT_TEMPLATE,
  playbook: PLAYBOOK_TEMPLATE,
};

/** Input contract for the three mutually exclusive `skill new` modes. */
interface SkillNewOptions {
  /** Agent whose manifest-defined skill directory receives skill scaffolds. */
  agent?: AgentId | null | undefined;
  /** A natural-language description of the skill (description mode). */
  description?: string | undefined;
  /** Path to an existing markdown draft (draft-validation mode). */
  draftPath?: string | undefined;
  /** RED-phase evidence required before a skill scaffold becomes discoverable. */
  redLogPath?: string | undefined;
  /** Open the interactive prompt flow even when other inputs are provided. */
  shouldUseInteractivePrompt?: boolean;
  /** Skip the y/n confirmation prompt before writing (used by tests). */
  shouldSkipConfirm?: boolean;
  /** Override the skill name (otherwise prompts in interactive mode). */
  name?: string | undefined;
  /** Project root for path resolution (default: process.cwd()). */
  projectRoot?: string;
  /** Pre-supplied stdin lines (used by tests in place of readline). */
  stdinAnswers?: string[];
}

/** Result returned by `skill new`, including dry-run output when no file is written. */
interface SkillNewResult extends Record<"written", boolean> {
  candidacy: CandidacyResult;
  /** Absolute path the scaffold was (or would be) written to. */
  proposedPath: string | null;
  /** Filled scaffold content. */
  scaffold: string | null;
  /** Quality score for a substantive draft; untouched scaffolds defer scoring. */
  postScaffoldScore?:
    { totalScore: number; profileMax: number } | null | undefined;
  /** Machine-readable handoff after a placeholder scaffold is written. */
  nextSteps?: string[] | undefined;
  /** Human-readable lines for terminal output. */
  output: string[];
}

const PLAYBOOK_DIR = ".goat-flow/skill-docs/playbooks";
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

/** Build the blocked-flow handoff without writing or exposing a skill draft. */
function redGateNextSteps(name: string): string[] {
  return [
    "Run a concrete failing scenario without the skill using at least three distinct documented pressures.",
    `Capture RED evidence at ${SKILL_TDD_LOG_DIR}/YYYY-MM-DD-${name}-tdd.md.`,
    `Re-run skill new with --red-log ${SKILL_TDD_LOG_DIR}/YYYY-MM-DD-${name}-tdd.md.`,
  ];
}

/** Continue the authoring loop from accepted RED evidence instead of restarting after a draft. */
function scaffoldNextSteps(redLogPath: string): string[] {
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
  const heading = /^## Iteration \d+ \(RED\)\s*$/mu.exec(content);
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
  const classification =
    /^(?:(?:the\s+)?agent\s+)?(?:fail(?:ed|ure)?|skip(?:ped)?|partial(?:ly)?|bypass(?:ed)?|rationali[sz](?:ed|ation)?|chose\s+[bc]\b|non[- ]compliant\b|wrong\b)/iu.exec(
      behaviour,
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

/** Verify that one canonical session log records a real failing RED scenario. */
function validateRedLog(
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

/** Resolve the manifest-defined destination while preserving Claude as the legacy default. */
function skillDirectoryFor(agent: AgentId | null | undefined): string {
  return getAgentProfile(agent ?? "claude").skillsDir;
}

/** Align skill-placement guidance with the same manifest profile used for the resolved path. */
function withSkillDestination(
  candidacy: CandidacyResult,
  skillsDirectory: string,
): CandidacyResult {
  if (candidacy.recommendedArtifact.type !== "skill") return candidacy;
  return {
    ...candidacy,
    nextSteps: candidacy.nextSteps.map((step) =>
      step.action.startsWith("Place under ")
        ? {
            ...step,
            action: `Place under ${skillsDirectory}/<name>/SKILL.md`,
          }
        : step,
    ),
  };
}

/** User-facing validation error for invalid `skill new` mode combinations. */
class SkillNewInputError extends Error {
  /** Preserve the custom error name so the CLI can classify input failures. */
  constructor(message: string) {
    super(message);
    this.name = "SkillNewInputError";
  }
}

export { SkillNewInputError };

/** Resolved scaffold target and template after candidacy chooses an artifact kind. */
interface ResolvedScaffold {
  template: string;
  proposedPath: string;
  isReference: boolean;
}

/** Replace scaffold placeholders after candidacy has selected a concrete artifact. */
function fillTemplate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (acc, [key, value]) => acc.replaceAll(`{{${key}}}`, value),
    template,
  );
}

function templateForRecommendation(
  recommendation: CandidacyResult["recommendedArtifact"],
): { templateKey: string; isReference: boolean } | null {
  if (recommendation.type === "skill") {
    return { templateKey: recommendation.subtype, isReference: false };
  }
  if (recommendation.type === "reference") {
    if (recommendation.subtype === "playbook") {
      return { templateKey: "playbook", isReference: true };
    }
    return null;
  }
  return null;
}

function resolveScaffold(
  projectRoot: string,
  name: string,
  recommendation: CandidacyResult["recommendedArtifact"],
  skillsDirectory: string,
): ResolvedScaffold | null {
  const choice = templateForRecommendation(recommendation);
  if (!choice) return null;
  const template = TEMPLATES_BY_SUBTYPE[choice.templateKey];
  if (!template) return null;
  // Forward-slash form so the path renders consistently in CLI/dashboard
  // output and matches assertion shapes; `node:fs` accepts both separators.
  const proposedPath = (
    choice.isReference
      ? join(projectRoot, PLAYBOOK_DIR, `${name}.md`)
      : join(projectRoot, skillsDirectory, name, "SKILL.md")
  ).replace(/\\/g, "/");
  return { template, proposedPath, isReference: choice.isReference };
}

/** Return the explicitly selected input modes so ambiguous invocations fail before prompting. */
function selectedInputModes(options: SkillNewOptions): string[] {
  const modes: string[] = [];
  if ((options.description ?? "").trim().length > 0) modes.push("description");
  if ((options.draftPath ?? "").trim().length > 0) modes.push("--draft");
  if (options.shouldUseInteractivePrompt) modes.push("--interactive");
  return modes;
}

/** Throws on mixed modes because description, draft, and interactive flows branch early. */
function assertSingleInputMode(options: SkillNewOptions): void {
  if (options.redLogPath && options.draftPath) {
    throw new SkillNewInputError(
      "--red-log is not valid with --draft; draft validation is read-only and does not scaffold.",
    );
  }
  const modes = selectedInputModes(options);
  if (modes.length <= 1) return;
  throw new SkillNewInputError(
    `skill new accepts exactly one input mode; received ${modes.join(", ")}. Use one of: description, --draft, --interactive.`,
  );
}

/** Validate scaffold names against filesystem-safe kebab-case skill paths. */
function isValidSkillName(name: string): boolean {
  return /^[a-z][a-z0-9-]{1,40}$/.test(name);
}

async function promptLine(
  rl: Interface,
  question: string,
  preset: string | undefined,
): Promise<string> {
  if (preset !== undefined) return preset;
  return (await rl.question(question)).trim();
}

/** Prompt adapter lets tests drive interactive flows without touching real stdin. */
interface InteractivePrompts {
  /** Read the natural-language skill description. */
  promptDescription(): Promise<string>;
  /** Read or accept the suggested kebab-case name. */
  promptName(suggested: string): Promise<string>;
  /** Confirm the write after showing a scaffold preview. */
  confirmWrite(path: string, scaffold: string): Promise<boolean>;
  /** Release any prompt resources once the mode finishes. */
  close(): void;
}

/** Deterministic prompt adapter for tests; answers are consumed in call order. */
function fakePrompts(answers: string[]): InteractivePrompts {
  let i = 0;
  /** Return the next scripted answer, defaulting to an empty response. */
  const next = () => answers[i++] ?? "";
  return {
    promptDescription: () => Promise.resolve(next()),
    promptName: (suggested) => {
      const answer = next();
      return Promise.resolve(answer.length > 0 ? answer : suggested);
    },
    confirmWrite: () => Promise.resolve(/^y/i.test(next())),
    close: () => {
      /* no-op */
    },
  };
}

/** Real readline-backed prompt adapter for interactive CLI use. */
function readlinePrompts(): InteractivePrompts {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return {
    promptDescription: () =>
      promptLine(
        readline,
        "Describe the skill you want to create:\n> ",
        undefined,
      ),
    promptName: async (suggested) =>
      (await promptLine(
        readline,
        `Name (kebab-case, default ${suggested}): `,
        undefined,
      )) || suggested,
    confirmWrite: async (path, scaffold) => {
      process.stdout.write(`\nProposed file: ${path}\n`);
      const preview = scaffold.split("\n").slice(0, 12).join("\n");
      process.stdout.write(`---\n${preview}\n…\n---\n`);
      const answer = await readline.question("Write this file? (y/N) ");
      return /^y/i.test(answer.trim());
    },
    close: () => {
      readline.close();
    },
  };
}

function suggestName(
  options: SkillNewOptions,
  candidacy: CandidacyResult,
): string {
  if (options.name && isValidSkillName(options.name)) return options.name;
  if (options.draftPath) {
    const stem = draftNameForPath(options.draftPath);
    if (isValidSkillName(stem)) return stem;
  }
  if (options.description) {
    const slug = options.description
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32);
    if (isValidSkillName(slug)) return slug;
  }
  return `new-${candidacy.recommendedArtifact.type}`;
}

/** Installed skills use their parent directory as the artifact name, not the generic SKILL.md stem. */
function draftNameForPath(draftPath: string): string {
  const filename = basename(draftPath);
  return filename.toLowerCase() === "skill.md"
    ? basename(dirname(draftPath))
    : filename.replace(/\.md$/iu, "");
}

function describeArtifact(
  recommendation: CandidacyResult["recommendedArtifact"],
): string {
  switch (recommendation.type) {
    case "skill":
      return `skill (${recommendation.subtype})`;
    case "reference":
      return `reference (${recommendation.subtype})`;
    case "instruction-file":
      return `instruction-file rule (${recommendation.reason})`;
    case "learning-loop":
      return `learning-loop (${recommendation.subtype})`;
    case "cli-command":
      return "cli-command";
    case "do-not-create":
      return `do-not-create (${recommendation.reason})`;
  }
}

/** Render candidacy guidance when the request should not create a skill/playbook. */
function nonScaffoldOutput(candidacy: CandidacyResult): string[] {
  return [
    `Candidacy: ${describeArtifact(candidacy.recommendedArtifact)} (confidence ${Math.round(
      candidacy.confidence * 100,
    )}%)`,
    "",
    "Reasoning:",
    ...candidacy.reasoning.map((r) => `  - ${r}`),
    "",
    "Next steps:",
    ...candidacy.nextSteps.map((s) => `  - ${s.action}`),
    "",
    "No skill or playbook will be scaffolded. Update the description or draft and re-run.",
  ];
}

/** Enforce RED for skills, then write the confirmed scaffold and emit its handoff. */
async function writeResolvedScaffold(
  projectRoot: string,
  name: string,
  description: string,
  candidacy: CandidacyResult,
  resolvedScaffold: ResolvedScaffold,
  options: SkillNewOptions,
  prompts: InteractivePrompts,
): Promise<SkillNewResult> {
  const redLog = resolvedScaffold.isReference
    ? { relativePath: null, errors: [] }
    : validateRedLog(projectRoot, name, options.redLogPath);
  if (redLog.errors.length > 0) {
    const nextSteps = redGateNextSteps(name);
    return {
      candidacy,
      proposedPath: resolvedScaffold.proposedPath,
      scaffold: null,
      written: false,
      nextSteps,
      output: [
        `Candidacy: ${describeArtifact(candidacy.recommendedArtifact)} (confidence ${Math.round(
          candidacy.confidence * 100,
        )}%)`,
        `Path: ${relative(projectRoot, resolvedScaffold.proposedPath)}`,
        "RED gate blocked: no skill scaffold was written.",
        "Evidence problems:",
        ...redLog.errors.map((error) => `  - ${error}`),
        "Next steps:",
        ...nextSteps.map((step) => `  - ${step}`),
      ],
    };
  }

  const scaffold = fillTemplate(resolvedScaffold.template, {
    NAME: name,
    DESCRIPTION: description,
    VERSION: getPackageVersion(),
  });
  const written = await maybeWrite(
    projectRoot,
    resolvedScaffold.proposedPath,
    scaffold,
    options,
    prompts,
  );
  const output: string[] = [
    `Candidacy: ${describeArtifact(candidacy.recommendedArtifact)} (confidence ${Math.round(
      candidacy.confidence * 100,
    )}%)`,
    `Path: ${relative(projectRoot, resolvedScaffold.proposedPath)}`,
    written ? "Wrote scaffold." : "Scaffold not written.",
  ];
  let postScaffoldScore: SkillNewResult["postScaffoldScore"];
  let nextSteps: string[] | undefined;
  if (written && !resolvedScaffold.isReference) {
    postScaffoldScore = null;
    nextSteps = scaffoldNextSteps(redLog.relativePath ?? "accepted RED log");
    output.push(
      `RED gate passed: ${redLog.relativePath}.`,
      "Scoring deferred until GREEN, REFACTOR, and STAY GREEN have run.",
      "Next steps:",
      ...nextSteps.map((step) => `  - ${step}`),
    );
  }
  return {
    candidacy,
    proposedPath: resolvedScaffold.proposedPath,
    scaffold,
    written,
    postScaffoldScore,
    nextSteps,
    output,
  };
}

async function runDescriptionMode(
  description: string,
  options: SkillNewOptions,
  prompts: InteractivePrompts,
): Promise<SkillNewResult> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const skillsDirectory = skillDirectoryFor(options.agent);
  const candidacy = withSkillDestination(
    runCandidacyCheck({
      kind: "description",
      text: description,
    }),
    skillsDirectory,
  );

  const scaffolded = resolveScaffold(
    projectRoot,
    suggestName(options, candidacy),
    candidacy.recommendedArtifact,
    skillsDirectory,
  );

  if (!scaffolded) {
    return {
      candidacy,
      proposedPath: null,
      scaffold: null,
      written: false,
      output: nonScaffoldOutput(candidacy),
    };
  }

  const name =
    options.name ?? (await prompts.promptName(suggestName(options, candidacy)));
  if (!isValidSkillName(name)) {
    return {
      candidacy,
      proposedPath: null,
      scaffold: null,
      written: false,
      output: [
        `Invalid name "${name}". Use kebab-case: lowercase letters, digits, and dashes.`,
      ],
    };
  }

  const final = resolveScaffold(
    projectRoot,
    name,
    candidacy.recommendedArtifact,
    skillsDirectory,
  );
  if (!final) {
    return {
      candidacy,
      proposedPath: null,
      scaffold: null,
      written: false,
      output: nonScaffoldOutput(candidacy),
    };
  }
  return writeResolvedScaffold(
    projectRoot,
    name,
    description,
    candidacy,
    final,
    options,
    prompts,
  );
}

function scoreFreshSkill(
  projectRoot: string,
  name: string,
  absolutePath: string,
): SkillNewResult["postScaffoldScore"] {
  const artifact = findArtifact(projectRoot, `skill:${name}`);
  if (!artifact) return undefined;
  const selectedPath = relative(projectRoot, absolutePath).replace(/\\/g, "/");
  const selectedArtifact =
    artifact.path === selectedPath
      ? artifact
      : artifact.mirrorPaths?.includes(selectedPath)
        ? { ...artifact, path: selectedPath }
        : null;
  if (!selectedArtifact) return undefined;
  const report = scoreArtifact(projectRoot, selectedArtifact);
  return {
    totalScore: report.totalScore,
    profileMax: report.profileMax,
  };
}

/** Read one path entry without following a final symlink; a missing entry is safe to create later. */
function lstatIfPresent(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw new SkillNewInputError(
      `Cannot inspect scaffold path safely: ${path}`,
    );
  }
}

/** Reject redirected or non-directory parent entries before creating a scaffold. */
function assertSafeScaffoldDestination(
  projectRoot: string,
  proposedPath: string,
): void {
  const resolvedProjectRoot = resolve(projectRoot);
  const resolvedDestination = resolve(proposedPath);
  const relativeDestination = relative(
    resolvedProjectRoot,
    resolvedDestination,
  );

  if (
    relativeDestination.length === 0 ||
    relativeDestination === ".." ||
    relativeDestination.startsWith(`..${sep}`) ||
    isAbsolute(relativeDestination)
  ) {
    throw new SkillNewInputError(
      `Unsafe scaffold destination outside the selected project: ${proposedPath}`,
    );
  }

  const relativeParent = dirname(relativeDestination);
  if (relativeParent === ".") return;

  let inspectedPath = resolvedProjectRoot;
  for (const component of relativeParent.split(sep)) {
    inspectedPath = join(inspectedPath, component);
    const pathStats = lstatIfPresent(inspectedPath);
    if (pathStats === null) break;
    if (pathStats.isSymbolicLink() || !pathStats.isDirectory()) {
      throw new SkillNewInputError(
        `Unsafe scaffold parent is a symlink or non-directory: ${inspectedPath}`,
      );
    }
  }
}

async function maybeWrite(
  projectRoot: string,
  proposedPath: string,
  scaffold: string,
  options: SkillNewOptions,
  prompts: InteractivePrompts,
): Promise<boolean> {
  assertSafeScaffoldDestination(projectRoot, proposedPath);
  if (lstatIfPresent(proposedPath) !== null) return false;
  const allow = options.shouldSkipConfirm
    ? true
    : await prompts.confirmWrite(proposedPath, scaffold);
  if (!allow) return false;
  mkdirSync(dirname(proposedPath), { recursive: true });
  writeFileSync(proposedPath, scaffold);
  return true;
}

function runDraftMode(
  draftPath: string,
  options: SkillNewOptions,
): SkillNewResult {
  const projectRoot = options.projectRoot ?? process.cwd();
  const absolutePath = resolve(draftPath);
  if (!existsSync(absolutePath)) {
    return {
      candidacy: {
        recommendedArtifact: {
          type: "do-not-create",
          reason: "no-clear-intent",
        },
        confidence: 1,
        reasoning: [`draft file not found: ${absolutePath}`],
        nextSteps: [],
      },
      proposedPath: null,
      scaffold: null,
      written: false,
      output: [`Draft file not found: ${absolutePath}`],
    };
  }
  const content = readFileSync(absolutePath, "utf-8");
  const suggestedName = draftNameForPath(absolutePath);
  const skillsDirectory = skillDirectoryFor(options.agent);
  const candidacy = withSkillDestination(
    runCandidacyCheck({
      kind: "draft",
      content,
      suggestedName,
    }),
    skillsDirectory,
  );

  const output: string[] = [
    `Draft: ${relative(projectRoot, absolutePath)}`,
    `Candidacy: ${describeArtifact(candidacy.recommendedArtifact)} (confidence ${Math.round(
      candidacy.confidence * 100,
    )}%)`,
    "",
    "Reasoning:",
    ...candidacy.reasoning.map((r) => `  - ${r}`),
  ];

  const scaffolded = resolveScaffold(
    projectRoot,
    suggestedName,
    candidacy.recommendedArtifact,
    skillsDirectory,
  );
  if (!scaffolded) {
    output.push(
      "",
      "Next steps:",
      ...candidacy.nextSteps.map((s) => `  - ${s.action}`),
    );
    return {
      candidacy,
      proposedPath: null,
      scaffold: null,
      written: false,
      output,
    };
  }

  const expectedPath = scaffolded.proposedPath;
  let postScaffoldScore: SkillNewResult["postScaffoldScore"];
  if (resolve(expectedPath) !== absolutePath) {
    output.push("");
    output.push(`Expected location: ${relative(projectRoot, expectedPath)}`);
    output.push(
      `Suggested move:    mv ${relative(projectRoot, absolutePath)} ${relative(projectRoot, expectedPath)}`,
    );
    output.push("(not executed; review before moving.)");
  } else if (!scaffolded.isReference) {
    postScaffoldScore = scoreFreshSkill(
      projectRoot,
      suggestedName,
      absolutePath,
    );
    if (postScaffoldScore) {
      output.push(
        `Quality: ${postScaffoldScore.totalScore}/${postScaffoldScore.profileMax} (snapshot of current draft)`,
      );
    }
  }

  return {
    candidacy,
    proposedPath: expectedPath,
    scaffold: null,
    written: false,
    postScaffoldScore,
    output,
  };
}

async function runInteractiveMode(
  options: SkillNewOptions,
  prompts: InteractivePrompts,
): Promise<SkillNewResult> {
  const description = (await prompts.promptDescription()).trim();
  if (description.length === 0) {
    return {
      candidacy: {
        recommendedArtifact: {
          type: "do-not-create",
          reason: "no-clear-intent",
        },
        confidence: 1,
        reasoning: ["empty description"],
        nextSteps: [],
      },
      proposedPath: null,
      scaffold: null,
      written: false,
      output: ["Empty description; aborting."],
    };
  }
  return runDescriptionMode(description, options, prompts);
}

export async function runSkillNew(
  options: SkillNewOptions,
): Promise<SkillNewResult> {
  assertSingleInputMode(options);
  const prompts =
    options.stdinAnswers !== undefined
      ? fakePrompts(options.stdinAnswers)
      : readlinePrompts();
  try {
    if (options.draftPath) {
      return runDraftMode(options.draftPath, options);
    }
    if (
      options.shouldUseInteractivePrompt ||
      (!options.description && !options.draftPath)
    ) {
      return await runInteractiveMode(options, prompts);
    }
    if (options.description) {
      return await runDescriptionMode(options.description, options, prompts);
    }
    return {
      candidacy: {
        recommendedArtifact: {
          type: "do-not-create",
          reason: "no-clear-intent",
        },
        confidence: 1,
        reasoning: ["no input provided"],
        nextSteps: [],
      },
      proposedPath: null,
      scaffold: null,
      written: false,
      output: [
        'Usage: goat-flow skill new "<description>" | --draft <path> | --interactive',
      ],
    };
  } finally {
    prompts.close();
  }
}
