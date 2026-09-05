/**
 * Routes parsed CLI commands through lazy handlers so unrelated commands avoid heavy imports.
 *
 * User failures throw CLIError; report failures set process.exitCode so stdout can flush.
 * Use this layer when a command needs shared output and exit conventions.
 */
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import type { AgentId, ProjectFacts } from "./types.js";
import type { AuditReport, AuditScope, CheckResult } from "./audit/types.js";
import { CLIError } from "./cli-error.js";
import { writeOutput } from "./cli-output.js";
import { handleClaimsCommand } from "./claims-command.js";
import { handleDiagnosticsCommand } from "./diagnostics-command.js";
import { handleStatsCommand } from "./stats-command.js";
import {
  MULTI_AGENT_SYNC_BANNER,
  validAgentFlags,
  validAgents,
} from "./cli-agent-options.js";
import type { Command, ParsedCLI } from "./cli-types.js";
import { handleHooksCommand } from "./hooks-command.js";
import { handleInstallCommand } from "./install-command.js";
import { handleReviewCommand } from "./review-validate.js";
import { getPackageVersion } from "./paths.js";
import { handleIndexCommand } from "./learning-loop-index/command.js";
import { handleLearningLoopRecallCommand } from "./learning-loop-recall.js";
import type { CandidacyResult } from "./quality/candidacy.js";
import { handleQualityCommand as runQualityCommand } from "./quality/quality-command.js";
import { handleRedactCommand } from "./redact-command.js";
import { handlePlansCommand } from "./plans-check.js";
import type { runSkillNew } from "./skill-author.js";
const PACKAGE_VERSION = getPackageVersion();

/**
 * Render one candidacy recommendation as the short label the CLI prints.
 *
 * @param recommendation - what the candidacy check decided the draft should become
 * @returns a human-readable label naming the artifact kind and its subtype or reason
 */
function formatCandidacyArtifact(
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

/** Return a shallow copy of one check with its heavy `details` payload removed for compact JSON. */
function stripCheckDetails(check: CheckResult): CheckResult {
  const stripped: CheckResult = { ...check };
  delete stripped.details;
  return stripped;
}

/** Remove detail payloads from every check inside one audit scope. */
function stripScopeDetails(scope: AuditScope): AuditScope {
  return {
    ...scope,
    checks: scope.checks.map(stripCheckDetails),
  };
}

/** Return the compact audit report shape used by non-verbose JSON output. */
function stripAuditDetails(report: AuditReport): AuditReport {
  return {
    ...report,
    scopes: {
      setup: stripScopeDetails(report.scopes.setup),
      agent: stripScopeDetails(report.scopes.agent),
      harness: report.scopes.harness
        ? stripScopeDetails(report.scopes.harness)
        : null,
    },
  };
}

/** One interactive menu row and the command it dispatches to. */
interface MenuAction {
  key: string;
  label: string;
  command: "dashboard" | "install" | "setup" | "audit" | "status";
  requiresAgentSelection: boolean;
}

const MENU_ACTIONS: MenuAction[] = [
  {
    key: "1",
    label: "Start dashboard",
    command: "dashboard",
    requiresAgentSelection: false,
  },
  {
    key: "2",
    label: "Install/update goat-flow files",
    command: "install",
    requiresAgentSelection: true,
  },
  {
    key: "3",
    label: "Generate setup prompt",
    command: "setup",
    requiresAgentSelection: true,
  },
  {
    key: "4",
    label: "Audit current project",
    command: "audit",
    requiresAgentSelection: false,
  },
  {
    key: "5",
    label: "Show project status",
    command: "status",
    requiresAgentSelection: false,
  },
];

/** Render the no-args command picker. */
function renderMenuText(): string {
  const lines = [
    "goat-flow",
    "",
    "What do you want to do?",
    ...MENU_ACTIONS.map((action) => `  ${action.key}. ${action.label}`),
    "",
    "Run a command directly any time, for example:",
    "  goat-flow dashboard .",
    "  goat-flow install . --agent codex",
    "  goat-flow audit . --harness",
  ];
  return lines.join("\n");
}

/** Return true when the process can safely ask questions. */
function canPrompt(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/** Find a menu action by number or case-insensitive label prefix. */
function findMenuAction(input: string): MenuAction | null {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return null;
  return (
    MENU_ACTIONS.find(
      (action) =>
        action.key === normalized ||
        action.label.toLowerCase().startsWith(normalized),
    ) ?? null
  );
}

/** Ask for a project path, defaulting to the current working directory. */
async function promptProjectPath(
  readlineInterface: ReturnType<typeof createInterface>,
): Promise<string> {
  const answer = await readlineInterface.question("Project path [.] ");
  return resolve(answer.trim() || ".");
}

/** Ask for one supported agent id. */
async function promptAgent(
  readlineInterface: ReturnType<typeof createInterface>,
): Promise<AgentId> {
  const agents = validAgents();
  for (;;) {
    const answer = await readlineInterface.question(
      `Agent (${agents.join("/")}) `,
    );
    const selected = answer.trim();
    if (agents.includes(selected as AgentId)) return selected as AgentId;
    console.log(`Use one of: ${agents.join(", ")}`);
  }
}

/** Ask whether install should overwrite settings/config. */
async function promptForce(
  readlineInterface: ReturnType<typeof createInterface>,
): Promise<boolean> {
  const answer = await readlineInterface.question(
    "Overwrite existing settings/config? [y/N] ",
  );
  return /^y(?:es)?$/iu.test(answer.trim());
}

/**
 * Read all menu answers and build the command options to run.
 *
 * Error behavior: throws CLIError with exit code 2 for an unrecognised menu choice, before any further question is asked, so the user is not walked
 * through a flow that cannot run.
 *
 * @param options - parsed CLI options the answers are layered onto
 * @param readlineInterface - open readline interface used for every question
 * @returns the options to dispatch, with command, project path, agent, and force filled in
 */
async function promptMenuCommand(
  options: ParsedCLI,
  readlineInterface: ReturnType<typeof createInterface>,
): Promise<ParsedCLI> {
  console.log(renderMenuText());
  const menuChoice = await readlineInterface.question("\nChoice [1] ");
  const selectedAction = findMenuAction(menuChoice || "1");
  // An unknown menu choice stops before asking for project or agent details that the CLI cannot use.
  if (!selectedAction) {
    throw new CLIError("Unknown menu choice.", 2);
  }

  const projectPath = await promptProjectPath(readlineInterface);
  const selectedAgent = selectedAction.requiresAgentSelection
    ? await promptAgent(readlineInterface)
    : options.agent;
  const shouldForce =
    selectedAction.command === "install"
      ? await promptForce(readlineInterface)
      : false;

  return {
    ...options,
    command: selectedAction.command,
    projectPath,
    agent: selectedAgent,
    shouldForce,
    shouldApply: false,
  };
}

/** Handle the interactive no-args command picker. */
async function handleMenuCommand(options: ParsedCLI): Promise<void> {
  if (!canPrompt() || options.output !== null) {
    writeOutput(options, renderMenuText());
    return;
  }

  const readlineInterface = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let nextOptions: ParsedCLI;
  try {
    nextOptions = await promptMenuCommand(options, readlineInterface);
  } finally {
    readlineInterface.close();
  }
  await dispatchCommand(nextOptions);
}

/** Handle the status command: classify and display project adoption state */
async function handleStatusCommand(options: ParsedCLI): Promise<void> {
  const { createFS } = await import("./facts/fs.js");
  const { classifyProjectState } = await import("./classify-state.js");

  const fs = createFS(options.projectPath);
  const result = classifyProjectState(fs, options.agent ?? undefined);

  if (options.format === "markdown") {
    const lines = [
      `**Path:** ${options.projectPath}`,
      `**State:** ${result.state}`,
      `**Action:** ${result.action}`,
      `**Details:** ${result.details}`,
    ];
    writeOutput(options, lines.join("\n"));
    return;
  }

  const {
    buildManagedInstallEvidenceReport,
    renderManagedInstallEvidenceText,
  } = await import("./managed-install-evidence.js");
  const managedInstallEvidence = buildManagedInstallEvidenceReport(
    options.projectPath,
  );

  if (options.format === "json") {
    writeOutput(
      options,
      JSON.stringify(
        {
          path: options.projectPath,
          ...result,
          version: PACKAGE_VERSION,
          managedInstallEvidence,
        },
        null,
        2,
      ),
    );
    return;
  }

  const stateColors: Record<string, string> = {
    bare: "\x1b[90m",
    partial: "\x1b[33m",
    "v0.9": "\x1b[31m",
    outdated: "\x1b[36m",
    current: "\x1b[32m",
    error: "\x1b[31m",
  };
  const reset = "\x1b[0m";
  const color = stateColors[result.state] || "";

  const rendered = [
    `  Path:    ${options.projectPath}`,
    `  State:   ${color}${result.state}${reset}`,
    `  Action:  ${result.action}`,
    `  Details: ${result.details}`,
    "",
    renderManagedInstallEvidenceText(managedInstallEvidence),
  ].join("\n");
  writeOutput(options, rendered);
}

/** Pick the agent list for setup output from the CLI override or extracted facts. */
function getSetupAgentIds(options: ParsedCLI, facts: ProjectFacts): AgentId[] {
  return options.agent
    ? [options.agent]
    : facts.agents.map((af) => af.agent.id);
}

/**
 * Return full setup evidence only when the trusted runtime probe named this exact agent.
 *
 * @param options - Parsed trust choice and optional agent bound to the setup audit.
 * @param agentId - Agent whose setup prompt is being rendered.
 * @returns Full evidence for an exact trusted-agent match; otherwise static evidence.
 */
export function setupDenyMechanismEvidenceLevel(
  options: Pick<ParsedCLI, "agent" | "isTargetTrusted">,
  agentId: AgentId,
): "full" | "static" {
  return options.isTargetTrusted && options.agent === agentId
    ? "full"
    : "static";
}

/** Print the banner that warns multi-agent setup output must stay in sync. */
function writeMultiAgentSyncBanner(withDivider: boolean): void {
  const lines = withDivider
    ? [...MULTI_AGENT_SYNC_BANNER, "", "---", ""]
    : [...MULTI_AGENT_SYNC_BANNER, "", ""];
  process.stdout.write(lines.join("\n"));
}

/**
 * Handle the setup command: compose and render setup prompts per agent.
 *
 * Error behavior: throws CLIError when the selected agent has no composable setup, so a user asking for an unsupported agent gets that message rather
 * than an empty prompt.
 */
async function handleSetupCommand(
  options: ParsedCLI,
  auditReport: AuditReport,
  facts: ProjectFacts,
): Promise<void> {
  const { composeSetup } = await import("./prompt/compose-setup.js");

  const agentIds = getSetupAgentIds(options, facts);
  if (agentIds.length === 0) {
    throw new CLIError(
      `No agents detected. Use one of: ${validAgentFlags()}`,
      1,
    );
  }

  if (agentIds.length > 1) {
    writeMultiAgentSyncBanner(true);
  }

  const parts: string[] = [];
  for (const agentId of agentIds) {
    const output = composeSetup(auditReport, facts, agentId, {
      denyMechanismEvidenceLevel: setupDenyMechanismEvidenceLevel(
        options,
        agentId,
      ),
    });
    if (output) parts.push(output);
  }
  if (parts.length > 0) {
    writeOutput(options, parts.join("\n\n---\n\n"));
  }
}

/** Handle the removed info command; throws CLIError with the current audit replacement. */
function handleInfoCommand(options: ParsedCLI): void {
  // The subcommand is the first positional arg after 'info'.
  // parseCLIArgs resolves projectPath to an absolute path, so extract the basename.
  const sub = options.projectPath.split(/[/\\]/).pop() ?? "";

  if (sub === "rubrics" || sub === "anti-patterns") {
    throw new CLIError(
      `"info ${sub}" was removed. Use "audit" for setup validation or "audit --harness" for advisory scoring.`,
      2,
    );
  }

  throw new CLIError(
    'Usage: goat-flow info <rubrics|anti-patterns>\n  Both subcommands were removed in v1.1.0. Use "audit" instead.',
    2,
  );
}

/** Run the audit command: validate setup correctness and optionally check harness completeness. */
async function handleAuditCommand(options: ParsedCLI): Promise<void> {
  const { createFS } = await import("./facts/fs.js");
  const { runAudit } = await import("./audit/audit.js");
  const {
    renderAuditText,
    renderAuditJson,
    renderAuditMarkdown,
    renderAuditSarif,
  } = await import("./audit/render.js");

  const fs = createFS(options.projectPath);
  const report = runAudit(fs, options.projectPath, {
    agentFilter: options.agent ?? null,
    harness: options.includeHarness,
    checkDrift: options.checkDrift,
    checkContent: options.checkContent,
    // Runtime proof executes the target checkout's configured launcher and
    // managed script, so only an affirmative trust choice may enable it.
    denyMechanismEvidenceLevel: options.isTargetTrusted ? "full" : "static",
  });

  const reportForRender = options.includeAuditDetails
    ? report
    : stripAuditDetails(report);

  let rendered: string;
  if (options.format === "json") {
    rendered = renderAuditJson(reportForRender);
  } else if (options.format === "markdown") {
    rendered = renderAuditMarkdown(reportForRender);
  } else if (options.format === "sarif") {
    rendered = renderAuditSarif(reportForRender);
  } else {
    rendered = renderAuditText(reportForRender);
  }

  writeOutput(options, rendered);

  if (report.status === "fail") {
    process.exitCode = 1;
  }
}

/** Delegate every quality mode with the CLI's shared error/output collaborators. */
async function handleQualityCommand(options: ParsedCLI): Promise<void> {
  await runQualityCommand(options, {
    CLIError,
    formatCandidacyArtifact,
    validAgents,
    writeOutput,
  });
}

/**
 * Handle `events tail`, reading the most recent local evidence-envelope events for the project.
 *
 * Throws a usage CLIError (exit 2) for any subcommand other than `tail`.
 * Emits the events as a JSON array under `--format json`, otherwise one compact JSON object per line (JSONL) for piping.
 */
async function handleEventsCommand(options: ParsedCLI): Promise<void> {
  if (options.eventsSubcommand !== "tail") {
    throw new CLIError("Usage: goat-flow events tail [path] [--limit 20]", 2);
  }
  const { tailEvidenceEvents } = await import("./evidence/envelope.js");
  const events = tailEvidenceEvents(options.projectPath, options.eventsLimit);
  if (options.format === "json") {
    writeOutput(options, JSON.stringify(events, null, 2));
    return;
  }
  writeOutput(options, events.map((event) => JSON.stringify(event)).join("\n"));
}

/**
 * Print the resolved manifest or run its `--check` CI gate.
 *
 * Branches stay separate because check mode owns exit status while default only renders.
 * Both paths preserve the same format contract without mixing their outputs.
 */
async function handleManifestCommand(options: ParsedCLI): Promise<void> {
  const { loadManifest, checkManifest, renderManifestMarkdown } =
    await import("./manifest/manifest.js");

  if (options.shouldCheck) {
    const report = checkManifest();
    let rendered: string;
    if (options.format === "json") {
      rendered = JSON.stringify(report, null, 2);
    } else {
      const lines: string[] = [];
      if (report.status === "pass") {
        lines.push("Manifest check: PASS");
      } else {
        lines.push("Manifest check: FAIL");
        for (const f of report.findings) {
          lines.push(`  - [${f.rule}] ${f.message}`);
        }
      }
      rendered = lines.join("\n");
    }
    writeOutput(options, rendered);
    if (report.status === "fail") process.exitCode = 1;
    return;
  }

  const manifest = loadManifest();
  if (options.format === "json") {
    writeOutput(options, JSON.stringify(manifest, null, 2));
    return;
  }
  writeOutput(options, renderManifestMarkdown(manifest));
}

/** Run the default `setup` command pipeline: facts + audit + compose. */
async function runSetupPipeline(options: ParsedCLI): Promise<void> {
  const { createFS } = await import("./facts/fs.js");
  const { runAudit } = await import("./audit/audit.js");
  const { extractProjectFacts } = await import("./facts/orchestrator.js");
  const { loadConfig } = await import("./config/reader.js");
  const fs = createFS(options.projectPath);
  const configState = loadConfig(options.projectPath, fs);
  const facts = extractProjectFacts(fs, {
    agentFilter: options.agent ?? null,
    projectPath: options.projectPath,
    configState,
  });
  const auditReport = runAudit(fs, options.projectPath, {
    agentFilter: options.agent ?? null,
    harness: false,
    denyMechanismEvidenceLevel:
      options.isTargetTrusted && options.agent !== null ? "full" : "static",
  });
  await handleSetupCommand(options, auditReport, facts);
}

/** Launch the web dashboard. */
async function runDashboardCommand(options: ParsedCLI): Promise<void> {
  const { serveDashboard } = await import("./server/dashboard.js");
  await serveDashboard({
    projectPath: options.projectPath,
    isDevMode: options.isDevMode,
  });
}

const COMMAND_HANDLERS: Partial<
  Record<Command, (options: ParsedCLI) => Promise<void> | void>
> = {
  menu: handleMenuCommand,
  install: handleInstallCommand,
  audit: handleAuditCommand,
  quality: handleQualityCommand,
  events: handleEventsCommand,
  hooks: handleHooksCommand,
  claims: handleClaimsCommand,
  skill: handleSkillCommand,
  manifest: handleManifestCommand,
  stats: handleStatsCommand,
  recall: handleLearningLoopRecallCommand,
  learn: handleLearnCommand,
  diagnostics: handleDiagnosticsCommand,
  index: handleIndexCommand,
  redact: handleRedactCommand,
  review: handleReviewCommand,
  plans: handlePlansCommand,
  status: handleStatusCommand,
  dashboard: runDashboardCommand,
  info: handleInfoCommand,
};

/**
 * Run the explicit learning-loop scaffold selected by the developer.
 * Use after parsing has validated flag placement; it throws a usage error for incomplete programmatic calls and forwards writer failures.
 */
async function handleLearnCommand(options: ParsedCLI): Promise<void> {
  // Missing authoring fields mean a programmatic caller bypassed normal parsing, so dispatch returns the same actionable usage contract.
  if (
    options.learnSubcommand !== "new" ||
    options.learnEntryType === null ||
    options.learnCategory === null ||
    options.learnTitle === null
  ) {
    throw new CLIError(
      "Usage: goat-flow learn new [project-path] --type <footgun|lesson|pattern> --category <bucket> --title <title> [flags]",
      2,
    );
  }
  const { runLearnScaffold } = await import("./learn-scaffold.js");
  const result = runLearnScaffold({
    projectRoot: options.projectPath,
    entryType: options.learnEntryType,
    category: options.learnCategory,
    title: options.learnTitle,
    evidencePaths: options.learnEvidencePaths,
    searchLiterals: options.learnSearchLiterals,
    evidenceKind: options.learnEvidenceKind,
    shouldDryRun: options.shouldDryRun,
  });
  const output =
    options.format === "json"
      ? JSON.stringify(
          {
            command: "learn",
            subcommand: "new",
            targetPath: result.targetPath,
            wasWritten: result.wasWritten,
            warnings: result.warnings,
            scaffold: result.skeleton,
          },
          null,
          2,
        )
      : result.output;
  writeOutput(options, output);
}

/** Route `skill new` authoring or read-only `skill doctor` diagnosis. */
async function handleSkillCommand(options: ParsedCLI): Promise<void> {
  // Doctor reports installed discovery evidence without entering the write-capable authoring flow.
  if (options.skillSubcommand === "doctor") {
    const { handleSkillDoctorCommand } = await import("./skill-doctor.js");
    handleSkillDoctorCommand(options);
    return;
  }
  await handleSkillNewCommand(options);
}

type SkillNewCommandResult = Awaited<ReturnType<typeof runSkillNew>>;
/** Build the authoring request from parsed CLI fields while omitting absent optional values. */
function skillNewRequest(options: ParsedCLI) {
  return {
    agent: options.agent,
    description: options.skillDescription ?? undefined,
    draftPath: options.skillDraftPath ?? undefined,
    redLogPath: options.skillRedLogPath ?? undefined,
    shouldUseInteractivePrompt: options.skillInteractive,
    name: options.skillName ?? undefined,
    shouldSkipConfirm: options.skillSkipConfirm,
    projectRoot: options.projectPath,
  };
}
/** Render one authoring result in the caller's selected JSON or human-readable contract. */
function renderSkillNewResult(
  result: SkillNewCommandResult,
  shouldRenderJson: boolean,
): string {
  if (!shouldRenderJson) return result.output.join("\n");
  return JSON.stringify(
    {
      candidacy: result.candidacy,
      proposedPath: result.proposedPath,
      written: result.written,
      postScaffoldScore: result.postScaffoldScore ?? null,
      nextSteps: result.nextSteps,
    },
    null,
    2,
  );
}
/** Run skill authoring; throws `CLIError` for usage/input failures and preserves JSON/text output. */
async function handleSkillNewCommand(options: ParsedCLI): Promise<void> {
  // Any remaining mode must be the existing skill-new authoring contract.
  if (options.skillSubcommand !== "new") {
    throw new CLIError(
      "Usage: goat-flow skill <new|doctor> [project-path] [flags]",
      2,
    );
  }
  const { runSkillNew, SkillNewInputError } = await import("./skill-author.js");
  let skillCreationResult: Awaited<ReturnType<typeof runSkillNew>>;
  try {
    skillCreationResult = await runSkillNew(skillNewRequest(options));
  } catch (error) {
    // Invalid `skill new` answers or flags become a usage message without an internal stack trace.
    if (error instanceof SkillNewInputError) {
      throw new CLIError(error.message, 2);
    }
    throw error;
  }
  writeOutput(
    options,
    renderSkillNewResult(skillCreationResult, options.format === "json"),
  );
}

/**
 * Dispatch one parsed CLI command to its handler.
 *
 * The handler table is consulted first; setup preview and apply are routed separately because both use the deterministic install path rather than
 * prompt composition.
 *
 * @param options - fully parsed and validated CLI options selecting the command to run
 * @returns nothing; the selected handler owns all output and exit behaviour
 */
export async function dispatchCommand(options: ParsedCLI): Promise<void> {
  const handler = COMMAND_HANDLERS[options.command];
  if (handler) {
    await handler(options);
    return;
  }
  // Setup preview and setup apply both use the deterministic install path instead of prompt composition.
  if (options.shouldApply || options.shouldDryRun) {
    await handleInstallCommand(options);
    return;
  }
  // Remaining command: setup (uses audit + facts to compose setup guidance).
  await runSetupPipeline(options);
}
