/** Scaffolds and validates `goat-flow skill new` skill/playbook drafts. */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
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
import { TEMPLATES_BY_SUBTYPE } from "./skill-author-templates.js";
import {
  redGateNextSteps,
  scaffoldNextSteps,
  validateRedLog,
} from "./skill-author-red-log.js";

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

/**
 * Map a candidacy recommendation onto the scaffold template that should be generated.
 * Only skills and playbook references have templates; every other recommendation returns null so the caller reports guidance instead of scaffolding a
 * file the project has no shape for.
 *
 * @param recommendation - what the candidacy check decided the draft should become
 * @returns the template key and whether it is a reference, or null when nothing is scaffoldable
 */
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

/**
 * Resolve the destination path and rendered template for one recommendation.
 * A recommendation with no template, or a template key the project does not ship, yields null rather than a partial scaffold, so the caller never
 * writes a file it could not fully render.
 *
 * @param projectRoot - project the scaffold would be written into
 * @param name - validated artifact name used in the path and template variables
 * @param recommendation - what the candidacy check decided the draft should become
 * @param skillsDirectory - agent-specific skills directory the scaffold belongs under
 * @returns the resolved path and rendered scaffold, or null when nothing should be scaffolded
 */
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

/**
 * Ask one interactive question, or return the preset answer without prompting.
 * A preset short-circuits the prompt entirely, which is how non-interactive runs and tests supply answers without a terminal.
 *
 * @param readlineInterface - open readline interface used when no preset is supplied
 * @param question - prompt text shown to the user
 * @param preset - pre-supplied answer; `undefined` means actually ask
 * @returns the trimmed answer, or the preset verbatim
 */
async function promptLine(
  readlineInterface: Interface,
  question: string,
  preset: string | undefined,
): Promise<string> {
  if (preset !== undefined) return preset;
  return (await readlineInterface.question(question)).trim();
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

/**
 * Choose the artifact name, preferring the most explicit source the user gave.
 * An explicit `--name` wins, then the draft filename, then a slug of the description; each candidate must still pass name validation, so an unusable
 * one falls through rather than producing a bad path.
 *
 * @param options - CLI options carrying any explicit name, draft path, or description
 * @param candidacy - candidacy result used only for the last-resort generated name
 * @returns a filesystem-safe kebab-case name; never empty
 */
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

/**
 * Render one recommendation as the short label the CLI shows the user.
 *
 * @param recommendation - what the candidacy check decided the draft should become
 * @returns a human-readable label naming the artifact kind and its subtype or reason
 */
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

/**
 * Run the description-driven flow: assess the description, scaffold it, then score the result.
 * Side effect: may create the scaffold file when the user confirms or confirmation is skipped.
 *
 * @param description - natural-language description of the intended artifact
 * @param options - CLI options controlling project root, agent, and confirmation behaviour
 * @param prompts - prompt adapter, so tests can drive the flow without a terminal
 * @returns the candidacy verdict, proposed path, scaffold text, and whether a file was written
 */
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

/**
 * Score a scaffold that was just written, so the user immediately sees its starting quality.
 * Returns undefined rather than a zero score when discovery cannot find the new artifact, because a missing artifact means the score is unknown
 * rather than bad.
 *
 * @param projectRoot - project the artifact was written into
 * @param name - skill name used to build the artifact id
 * @param absolutePath - absolute path of the file just written
 * @returns the score, or undefined when the new artifact is not discoverable yet
 */
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

/** Read one path without following its final symlink; missing entries recover to null and other errors throw. */
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

/**
 * Reject redirected or non-directory parent entries before creating a scaffold.
 *
 * Every parent component is walked rather than only the immediate one, because a symlink anywhere in the chain could redirect the write outside the
 * selected project.
 *
 * Error behavior: throws SkillNewInputError for a destination outside the project or a symlinked or non-directory parent; walking stops at the first
 * component that does not exist yet.
 *
 * @param projectRoot - project the scaffold must stay inside
 * @param proposedPath - absolute destination the caller wants to create
 * @returns nothing; returning means the destination is safe to create
 */
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

/**
 * Write the scaffold once the destination is proved safe and the user has agreed.
 *
 * An existing file is never overwritten; the call reports false instead, so re-running the command cannot destroy work already in the destination.
 * Side effect: creates the parent directory and writes the scaffold file.
 *
 * Error behavior: throws SkillNewInputError when the destination is unsafe, before any write.
 *
 * @param projectRoot - project the scaffold must stay inside
 * @param proposedPath - absolute destination to create
 * @param scaffold - rendered file contents
 * @param options - CLI options; `shouldSkipConfirm` bypasses the confirmation prompt
 * @param prompts - prompt adapter used to ask for confirmation
 * @returns true when a file was written; false when it already existed or the user declined
 */
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

/**
 * Run the draft-file flow: read an existing draft, assess it, and report where it should live.
 *
 * This mode never writes; it reports the expected path so the user can move the draft themselves.
 * A missing draft reports a do-not-create verdict rather than throwing, because a mistyped path is ordinary user error rather than a fault.
 *
 * @param draftPath - path to the draft file to assess
 * @param options - CLI options controlling project root and agent
 * @returns the candidacy verdict, expected path, and any post-scaffold score
 */
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

/**
 * Ask the user to describe the artifact, then hand off to the description flow.
 * An empty description aborts with a do-not-create verdict rather than scaffolding from nothing.
 *
 * @param options - CLI options controlling project root, agent, and confirmation behaviour
 * @param prompts - prompt adapter, so tests can drive the flow without a terminal
 * @returns the description flow's result, or an abort verdict when nothing was entered
 */
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

/**
 * Entry point for `skill new`, selecting the draft, interactive, or description flow.
 *
 * Exactly one input mode is accepted, and the prompt adapter is closed on every exit path so an aborted run never leaves stdin held open.
 * Error behavior: throws SkillNewInputError when more than one input mode is supplied, or when a scaffold destination is unsafe.
 *
 * @param options - CLI options selecting input mode, project root, agent, and confirmation behaviour
 * @returns the candidacy verdict, proposed path, scaffold text, and whether a file was written
 */
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
