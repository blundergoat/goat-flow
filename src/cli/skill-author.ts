/** Scaffolds and validates `goat-flow skill new` skill/playbook drafts. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { createInterface, type Interface } from "node:readline/promises";

import { getPackageVersion } from "./paths.js";
import {
  runCandidacyCheck,
  type CandidacyResult,
} from "./quality/candidacy.js";
import { findArtifact, scoreArtifact } from "./quality/skill-quality.js";

const WORKFLOW_TEMPLATE = `---
name: {{NAME}}
description: "{{DESCRIPTION}}"
goat-flow-skill-version: "{{VERSION}}"
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
  /** A natural-language description of the skill (description mode). */
  description?: string | undefined;
  /** Path to an existing markdown draft (draft-validation mode). */
  draftPath?: string | undefined;
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
  /** Quality score after scaffold (skill kind only). */
  postScaffoldScore?: { totalScore: number; profileMax: number } | undefined;
  /** Human-readable lines for terminal output. */
  output: string[];
}

const SKILL_DIR = ".claude/skills";
const PLAYBOOK_DIR = ".goat-flow/skill-docs/playbooks";

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
      : join(projectRoot, SKILL_DIR, name, "SKILL.md")
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
    const stem = basename(options.draftPath).replace(/\.md$/, "");
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

async function runDescriptionMode(
  description: string,
  options: SkillNewOptions,
  prompts: InteractivePrompts,
): Promise<SkillNewResult> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const candidacy = runCandidacyCheck({
    kind: "description",
    text: description,
  });

  const scaffolded = resolveScaffold(
    projectRoot,
    suggestName(options, candidacy),
    candidacy.recommendedArtifact,
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
  const scaffold = fillTemplate(final.template, {
    NAME: name,
    DESCRIPTION: description,
    VERSION: getPackageVersion(),
  });

  const written = await maybeWrite(
    final.proposedPath,
    scaffold,
    options,
    prompts,
  );

  const output: string[] = [
    `Candidacy: ${describeArtifact(candidacy.recommendedArtifact)} (confidence ${Math.round(
      candidacy.confidence * 100,
    )}%)`,
    `Path: ${relative(projectRoot, final.proposedPath)}`,
    written ? "Wrote scaffold." : "Scaffold not written.",
  ];

  let postScaffoldScore: SkillNewResult["postScaffoldScore"];
  if (written && !final.isReference) {
    postScaffoldScore = scoreFreshSkill(projectRoot, name);
    if (postScaffoldScore) {
      output.push(
        `Initial quality: ${postScaffoldScore.totalScore}/${postScaffoldScore.profileMax}`,
      );
    }
  }

  return {
    candidacy,
    proposedPath: final.proposedPath,
    scaffold,
    written,
    postScaffoldScore,
    output,
  };
}

function scoreFreshSkill(
  projectRoot: string,
  name: string,
): SkillNewResult["postScaffoldScore"] {
  const artifact = findArtifact(projectRoot, `skill:${name}`);
  if (!artifact) return undefined;
  const report = scoreArtifact(projectRoot, artifact);
  return {
    totalScore: report.totalScore,
    profileMax: report.profileMax,
  };
}

async function maybeWrite(
  proposedPath: string,
  scaffold: string,
  options: SkillNewOptions,
  prompts: InteractivePrompts,
): Promise<boolean> {
  if (existsSync(proposedPath)) return false;
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
  const suggestedName = basename(absolutePath, ".md");
  const candidacy = runCandidacyCheck({
    kind: "draft",
    content,
    suggestedName,
  });

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
  if (resolve(expectedPath) !== absolutePath) {
    output.push("");
    output.push(`Expected location: ${relative(projectRoot, expectedPath)}`);
    output.push(
      `Suggested move:    mv ${relative(projectRoot, absolutePath)} ${relative(projectRoot, expectedPath)}`,
    );
    output.push("(not executed; review before moving.)");
  } else if (!scaffolded.isReference) {
    const postScore = scoreFreshSkill(projectRoot, suggestedName);
    if (postScore) {
      output.push(
        `Quality: ${postScore.totalScore}/${postScore.profileMax} (snapshot of current draft)`,
      );
    }
  }

  return {
    candidacy,
    proposedPath: expectedPath,
    scaffold: null,
    written: false,
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
