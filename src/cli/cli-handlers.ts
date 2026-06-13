/**
 * Command-dispatch layer for the CLI: one handler per subcommand plus the COMMAND_HANDLERS table
 * and dispatchCommand entry that routes a parsed ParsedCLI to the right one. Handlers lazy-import
 * their heavy dependencies (audit, facts, quality, dashboard, stats) so a single command never pays
 * for modules it does not use. The shared error convention is to throw CLIError for user-facing
 * failures (the entry point maps that to an exit code) and to set process.exitCode (not exit) for
 * non-zero-but-successful outcomes like a failing audit, so buffered stdout still flushes.
 */

import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import type { AgentId, ProjectFacts } from "./types.js";
import type { AuditReport, AuditScope, CheckResult } from "./audit/types.js";
import { classifyProjectState } from "./classify-state.js";
import { CLIError } from "./cli-error.js";
import { writeOutput } from "./cli-output.js";
import {
  MULTI_AGENT_SYNC_BANNER,
  validAgentFlags,
  validAgents,
} from "./cli-agent-options.js";
import type { Command, ParsedCLI } from "./cli-types.js";
import { createFS } from "./facts/fs.js";
import { handleHooksCommand } from "./hooks-command.js";
import {
  buildInstallerInvocation,
  buildInstallerSpawnSpec,
} from "./install-invocation.js";
import { getPackageVersion, getTemplatePath } from "./paths.js";
import {
  emitIndexGenerationInstallResult,
  handleIndexCommand,
} from "./learning-loop-index/command.js";
import {
  ensureGitCommitInstructions,
  type CommitConventionDetection,
} from "./prompt/commit-guidance.js";
import type { CandidacyResult } from "./quality/candidacy.js";
import { handleQualityCommand as runQualityCommand } from "./quality/quality-command.js";

const PACKAGE_VERSION = getPackageVersion();

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
  needsAgent: boolean;
}

const MENU_ACTIONS: MenuAction[] = [
  {
    key: "1",
    label: "Start dashboard",
    command: "dashboard",
    needsAgent: false,
  },
  {
    key: "2",
    label: "Install/update goat-flow files",
    command: "install",
    needsAgent: true,
  },
  {
    key: "3",
    label: "Generate setup prompt",
    command: "setup",
    needsAgent: true,
  },
  {
    key: "4",
    label: "Audit current project",
    command: "audit",
    needsAgent: false,
  },
  {
    key: "5",
    label: "Show project status",
    command: "status",
    needsAgent: false,
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
  rl: ReturnType<typeof createInterface>,
): Promise<string> {
  const answer = await rl.question("Project path [.] ");
  return resolve(answer.trim() || ".");
}

/** Ask for one supported agent id. */
async function promptAgent(
  rl: ReturnType<typeof createInterface>,
): Promise<AgentId> {
  const agents = validAgents();
  for (;;) {
    const answer = await rl.question(`Agent (${agents.join("/")}) `);
    const selected = answer.trim();
    if (agents.includes(selected as AgentId)) return selected as AgentId;
    console.log(`Use one of: ${agents.join(", ")}`);
  }
}

/** Ask whether install should overwrite settings/config. */
async function promptForce(
  rl: ReturnType<typeof createInterface>,
): Promise<boolean> {
  const answer = await rl.question(
    "Overwrite existing settings/config? [y/N] ",
  );
  return /^y(?:es)?$/iu.test(answer.trim());
}

/** Read all menu answers and build the command options to run. */
async function promptMenuCommand(
  options: ParsedCLI,
  rl: ReturnType<typeof createInterface>,
): Promise<ParsedCLI> {
  console.log(renderMenuText());
  const choice = await rl.question("\nChoice [1] ");
  const action = findMenuAction(choice || "1");
  if (!action) {
    throw new CLIError("Unknown menu choice.", 2);
  }

  const projectPath = await promptProjectPath(rl);
  const agent = action.needsAgent ? await promptAgent(rl) : options.agent;
  const shouldForce =
    action.command === "install" ? await promptForce(rl) : false;

  return {
    ...options,
    command: action.command,
    projectPath,
    agent,
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

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let nextOptions: ParsedCLI;
  try {
    nextOptions = await promptMenuCommand(options, rl);
  } finally {
    rl.close();
  }
  await dispatchCommand(nextOptions);
}

/** Handle the status command: classify and display project adoption state */
async function handleStatusCommand(options: ParsedCLI): Promise<void> {
  const { createFS } = await import("./facts/fs.js");
  const { classifyProjectState } = await import("./classify-state.js");

  const fs = createFS(options.projectPath);
  const result = classifyProjectState(fs, options.agent ?? undefined);

  if (options.format === "json") {
    writeOutput(
      options,
      JSON.stringify(
        { path: options.projectPath, ...result, version: PACKAGE_VERSION },
        null,
        2,
      ),
    );
    return;
  }

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
  ].join("\n");
  writeOutput(options, rendered);
}

/** Pick the agent list for setup output from the CLI override or extracted facts. */
function getSetupAgentIds(options: ParsedCLI, facts: ProjectFacts): AgentId[] {
  return options.agent
    ? [options.agent]
    : facts.agents.map((af) => af.agent.id);
}

/** Print the banner that warns multi-agent setup output must stay in sync. */
function writeMultiAgentSyncBanner(withDivider: boolean): void {
  const lines = withDivider
    ? [...MULTI_AGENT_SYNC_BANNER, "", "---", ""]
    : [...MULTI_AGENT_SYNC_BANNER, "", ""];
  process.stdout.write(lines.join("\n"));
}

/** Handle the setup command: compose and render setup prompts per agent */
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
    const output = composeSetup(auditReport, facts, agentId);
    if (output) parts.push(output);
  }
  if (parts.length > 0) {
    writeOutput(options, parts.join("\n\n---\n\n"));
  }
}

/** Derive installer flags from the project's adoption state. */
function deriveInstallFlags(
  projectPath: string,
  agentId: string,
  options: ParsedCLI,
): string[] {
  if (options.shouldForce) return [];
  try {
    const projectFS = createFS(projectPath);
    const state = classifyProjectState(projectFS, agentId);
    const flags: string[] = [];
    if (
      !options.updateConfigVersion &&
      (state.state === "outdated" || state.state === "v0.9")
    ) {
      flags.push("--update-config-version");
    }
    if (!options.cleanDeprecated && state.state === "v0.9") {
      flags.push("--clean-deprecated");
    }
    return flags;
  } catch {
    return [];
  }
}

/** Build the user-supplied installer flag list for the bundled bash script. */
function collectInstallerFlags(options: ParsedCLI, agent: AgentId): string[] {
  const flags: string[] = [];
  if (options.shouldForce) flags.push("--force");
  if (options.updateConfigVersion) flags.push("--update-config-version");
  if (options.cleanDeprecated) flags.push("--clean-deprecated");
  flags.push(...deriveInstallFlags(options.projectPath, agent, options));
  return flags;
}

function commitGuidanceInstallSummary(
  detection: CommitConventionDetection,
): string {
  if (detection.status === "insufficient-history") {
    return detection.gitAvailable
      ? `stub generated from ${detection.total} commits`
      : "stub generated because git history was unavailable";
  }
  return `${detection.status} guidance generated from ${detection.total} commits`;
}

/** Print commit-guide generation status only when install wrote new guidance. */
function emitCommitGuidanceInstallResult(projectPath: string): void {
  const result = ensureGitCommitInstructions(projectPath);
  if (result.status !== "written" || result.detection === null) return;
  console.log("");
  console.log("Git commit instructions:");
  console.log(
    `  ✓ ${result.path} (${commitGuidanceInstallSummary(result.detection)})`,
  );
}

/** Handle deterministic install/update; spawns the bundled installer through the safe-exec gate and reports CLIError failures. */
async function handleInstallCommand(options: ParsedCLI): Promise<void> {
  if (!options.agent) {
    throw new CLIError(
      `install requires --agent. Use one of: ${validAgentFlags()}\n  (--apply installs per-agent surfaces; each agent needs a separate run)`,
      2,
    );
  }
  if (options.output !== null) {
    throw new CLIError("--output is not supported for install.", 2);
  }

  const invocation = buildInstallerInvocation({
    scriptPath: getTemplatePath("workflow/install-goat-flow.sh"),
    projectPath: options.projectPath,
    agent: options.agent,
    installerFlags: collectInstallerFlags(options, options.agent),
    platform: process.platform,
  });
  if (!invocation.ok) {
    throw new CLIError(invocation.error, 1);
  }

  const { spawnInheritedSync } = await import("./server/safe-exec.js");
  const spawnSpec = buildInstallerSpawnSpec(invocation);
  const result = spawnInheritedSync({
    command: spawnSpec.command,
    args: spawnSpec.args,
    allowedBasenames: ["bash", "bash.exe"],
    env: spawnSpec.env,
  });
  if (result.error) {
    throw new CLIError(
      `Could not run installer with ${spawnSpec.command}: ${result.error.message}`,
      1,
    );
  }
  if (result.signal) {
    throw new CLIError(`Installer terminated by signal ${result.signal}`, 1);
  }
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    return;
  }
  emitCommitGuidanceInstallResult(options.projectPath);
  emitIndexGenerationInstallResult(options.projectPath);
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
    // The deny-mechanism runtime smoke executes the target checkout's own hook
    // code (configured launcher string and managed script) and runs by default.
    // `--untrusted-target` keeps the deny check static for a checkout you do not
    // trust; otherwise the property is omitted, leaving the default unchanged.
    // (The dashboard separately audits selected targets at "static".)
    ...(options.untrustedTarget
      ? { denyMechanismEvidenceLevel: "static" as const }
      : {}),
  });

  const reportForRender = options.auditDetails
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

/**
 * Run the quality command by delegating to the quality module with CLI-side dependencies injected.
 * The error/output behaviour lives in the injected collaborators - CLIError for failures and
 * writeOutput for results - so this wrapper only supplies them and forwards the parsed options.
 */
async function handleQualityCommand(options: ParsedCLI): Promise<void> {
  await runQualityCommand(options, {
    CLIError,
    formatCandidacyArtifact,
    validAgents,
    writeOutput,
  });
}

/** Handle the stats command: report learning-loop health (live counts, stale refs, freshness). */
async function handleStatsCommand(options: ParsedCLI): Promise<void> {
  const { createFS } = await import("./facts/fs.js");
  const { loadConfig } = await import("./config/reader.js");
  const { extractFootgunFacts, extractLessonsFacts } =
    await import("./facts/shared/learning-loop.js");
  const { buildStatsReport, checkStats, buildDecisionsSection } =
    await import("./stats/stats.js");
  const {
    renderStatsText,
    renderStatsJson,
    renderStatsMarkdown,
    renderStatsCheckText,
  } = await import("./stats/render.js");

  const { collectIndexFreshness } = await import("./stats/index-freshness.js");
  const { resolveIndexBucketPaths } =
    await import("./learning-loop-index/parse-bucket.js");

  const fs = createFS(options.projectPath);
  const configState = loadConfig(options.projectPath, fs);
  const report = buildStatsReport({
    footguns: extractFootgunFacts(fs, configState),
    lessons: extractLessonsFacts(fs, configState),
    decisions: buildDecisionsSection(fs, configState.config.decisions.path),
    indexes: collectIndexFreshness(
      fs,
      resolveIndexBucketPaths(configState.config),
    ),
  });

  if (options.shouldCheck) {
    const verdict = checkStats(report);
    if (options.format === "json") {
      writeOutput(options, JSON.stringify(verdict, null, 2));
    } else {
      writeOutput(options, renderStatsCheckText(verdict).trimEnd());
    }
    if (verdict.status === "fail") process.exitCode = 1;
    return;
  }

  let rendered: string;
  if (options.format === "json") {
    rendered = renderStatsJson(report);
  } else if (options.format === "markdown") {
    rendered = renderStatsMarkdown(report);
  } else {
    rendered = renderStatsText(report);
  }
  writeOutput(options, rendered.trimEnd());
}

/**
 * Handle `events tail`, reading the most recent local evidence-envelope events for the project.
 * Throws a usage CLIError (exit 2) for any subcommand other than `tail`. Emits the events as a
 * JSON array under `--format json`, otherwise one compact JSON object per line (JSONL) for piping.
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
 * Handle the manifest command: resolve + print the single-source-of-truth manifest.
 * The function forks up front on `--check` because the two modes are genuinely different outputs,
 * not formatting variants of one: `--check` is the CI gate that runs checkManifest and sets
 * process.exitCode to 1 on drift (so the pipeline fails), while the default branch just loads and
 * prints the resolved manifest with no exit-code side effect. They are kept in one handler so both
 * honour the same `--format` flag, but the early return after the check branch is intentional - it
 * avoids the printer ever running in CI mode.
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
  skill: handleSkillCommand,
  manifest: handleManifestCommand,
  stats: handleStatsCommand,
  index: handleIndexCommand,
  status: handleStatusCommand,
  dashboard: runDashboardCommand,
  info: handleInfoCommand,
};

/**
 * Run `skill new`, scaffolding a skill/playbook from a description, draft, or interactive prompt.
 * Throws a usage CLIError (exit 2) when the subcommand is not `new` or when the skill author
 * reports a SkillNewInputError (bad/missing input); any other author error is rethrown unchanged.
 * Emits a JSON candidacy/path/score summary under `--format json`, otherwise the author's text.
 */
async function handleSkillCommand(options: ParsedCLI): Promise<void> {
  if (options.skillSubcommand !== "new") {
    throw new CLIError(
      'Usage: goat-flow skill new ["<description>" | --draft <path> | --interactive]',
      2,
    );
  }
  const { runSkillNew, SkillNewInputError } = await import("./skill-author.js");
  let result: Awaited<ReturnType<typeof runSkillNew>>;
  try {
    result = await runSkillNew({
      description: options.skillDescription ?? undefined,
      draftPath: options.skillDraftPath ?? undefined,
      shouldUseInteractivePrompt: options.skillInteractive,
      name: options.skillName ?? undefined,
      shouldSkipConfirm: options.skillSkipConfirm,
      projectRoot: options.projectPath,
    });
  } catch (err) {
    if (err instanceof SkillNewInputError) {
      throw new CLIError(err.message, 2);
    }
    throw err;
  }
  if (options.format === "json") {
    writeOutput(
      options,
      JSON.stringify(
        {
          candidacy: result.candidacy,
          proposedPath: result.proposedPath,
          written: result.written,
          postScaffoldScore: result.postScaffoldScore ?? null,
        },
        null,
        2,
      ),
    );
    return;
  }
  writeOutput(options, result.output.join("\n"));
}

/** Dispatch one parsed CLI command to its handler. */
export async function dispatchCommand(options: ParsedCLI): Promise<void> {
  const handler = COMMAND_HANDLERS[options.command];
  if (handler) {
    await handler(options);
    return;
  }
  if (options.shouldApply) {
    await handleInstallCommand(options);
    return;
  }
  // Remaining command: setup (uses audit + facts to compose setup guidance).
  await runSetupPipeline(options);
}
