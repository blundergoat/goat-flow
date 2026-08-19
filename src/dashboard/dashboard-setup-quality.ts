/**
 * Powers the dashboard's Setup and Quality tabs: detecting a project's stack, generating the setup prompt, and running quality reports.
 *
 * A user lands here after picking a project on Home, then either opens Setup to get install guidance or opens Quality to assess what is installed.
 *
 * Everything in this file is a classic-script global called by thin Alpine methods in app.ts, so:
 * - state lives on the Alpine component and is mutated in place, never returned
 * - every network path is best-effort, because a failed fetch must leave the visible tab usable
 * - stale replies are discarded, since the user can switch project, agent, or mode mid-request
 */

const DEFAULT_SETUP_COMMANDS: SetupCommands = {
  test: "",
  lint: "",
  build: "",
  format: "",
};

const DEFAULT_EXISTING_ARTIFACTS: ExistingArtifacts = {
  skills: false,
  instructionsRepoWide: false,
  instructionsPathScoped: false,
  lessons: false,
  footguns: false,
  config: false,
};

const QUALITY_HISTORY_LOAD_DELAY_MS = 50;
const SETUP_PROMPT_LOAD_DELAY_MS = 50;

/** Dashboard state contract shared by setup-prompt and quality-report helpers. */
interface DashboardSetupQualityContext {
  projectPath: string;
  supportedAgents: SupportedAgent[];
  activeRunner: RunnerId;
  setupSelectedAgent: RunnerId;
  setupDetecting: boolean;
  setupData: SetupData;
  setupGenerating: boolean;
  setupOutputs: Record<string, string>;
  _setupOutputProjectPath: string | null;
  _setupPromptRequestKey: string | null;
  _setupPromptTimer: ReturnType<typeof setTimeout> | null;
  qualityAgent: RunnerId;
  selectedQualityModeId: string;
  qualityLoading: boolean;
  qualityResult: QualityResult | null;
  qualityCopyLabel: string;
  qualityHistoryLoading: boolean;
  qualityHistoryRows: QualityHistoryRow[];
  qualityHistoryLatest: QualityHistoryLatest | null;
  qualityHistoryWarnings: string[];
  _qualityHistoryTimer: ReturnType<typeof setTimeout> | null;
  presets: Preset[];
  /** Surface a dashboard toast message, with error styling when requested. */
  showToast(msg: string, isError?: boolean): void;
  /** Copy generated prompt text through the shared dashboard clipboard helper. */
  copyText(text: string): void;
  /** Generate setup guidance for the selected agent and project. */
  generateSetupPrompt(shouldForce?: boolean): Promise<void>;
  /** Generate setup guidance for a specific target agent and project. */
  generateSetupPromptForAgent(
    targetAgent: RunnerId,
    shouldForce?: boolean,
  ): Promise<string | null>;
  /** Generate the selected quality prompt or report request. */
  generateQuality(options?: DashboardQualityGenerateOptions): Promise<void>;
  /** Load saved quality-history rows for the selected quality mode. */
  generateQualityHistory(): Promise<void>;
}

/** Options that choose fast/fresh quality generation behavior from UI controls. */
type DashboardQualityGenerateOptions = Partial<
  Record<"fast" | "fresh", boolean>
>;

/**
 * Turns an agent id into the name the user actually sees on Setup and Quality buttons and labels.
 *
 * @param ctx - dashboard state holding the supported-agent list the server sent
 * @param agentId - agent to name; an id the server did not list still renders as itself rather than vanishing from the button
 * @returns the display name, or the bare id when the list has no entry, so a label is never blank
 */
function dashboardAgentDisplayName(
  ctx: DashboardSetupQualityContext,
  agentId: RunnerId,
): string {
  return (
    ctx.supportedAgents.find((agent) => agent.id === agentId)?.name ?? agentId
  );
}

/**
 * Lists which instruction files the selected agent will write, shown as the Setup tab's "this will touch" line.
 *
 * @param ctx - dashboard state; the agent chosen in the Setup dropdown decides which surfaces are listed
 * @returns a comma-separated list, or the bare agent id when the agent is unknown, so the line still names something
 */
function dashboardSetupInstructionSurfaces(
  ctx: DashboardSetupQualityContext,
): string {
  const agent = ctx.supportedAgents.find(
    (entry) => entry.id === ctx.setupSelectedAgent,
  );
  return agent?.setupSurfaces.join(", ") ?? ctx.setupSelectedAgent;
}

/**
 * Finds one configured quality preset so a Quality card can show the prompt the user set up.
 *
 * @param ctx - dashboard state holding presets fetched when the dashboard started
 * @param presetId - preset to find; an unknown id is a normal miss while presets are still loading
 * @returns the preset, or null when presets have not arrived yet, which the caller shows as a card without prompt text
 */
function dashboardQualityModePreset(
  ctx: DashboardSetupQualityContext,
  presetId: string,
): Preset | null {
  return ctx.presets.find((preset) => preset.id === presetId) ?? null;
}

/** Reset quality-history rows and warnings before loading a new mode or project. */
function dashboardClearQualityHistory(ctx: DashboardSetupQualityContext): void {
  ctx.qualityHistoryRows = [];
  ctx.qualityHistoryLatest = null;
  ctx.qualityHistoryWarnings = [];
}

/** Build the read-only harness-engineering assessment prompt used by the Quality page. */
function dashboardHarnessQualityPrompt(): string {
  return [
    "AI Harness Engineering Quality Assessment",
    "",
    "REPORTING-ONLY ASSESSMENT MODE. Do not edit tracked files. Do not use /goat-review or any goat skill as the wrapper for this assessment; this prompt is the full assessment contract. You may read files, run read-only validation commands, and write normal gitignored reporting/local-state artifacts if the runner requires them. In this contract, gitignored logs, scratchpad notes, critique snapshots, quality reports, and task-local state do not count as writes; do not report them as read-only violations.",
    "",
    "Assess whether the selected target project's agent harness is actually usable, not only structurally present. Focus on context loading, constraint safety, verification evidence, recovery paths, feedback-loop durability, and whether instructions distinguish the controlling goat-flow workspace from the selected target.",
    "",
    "Grounding commands to run or explicitly mark skipped: git status --short --untracked-files=all; node --import tsx src/cli/cli.ts audit . --harness --format json from the controlling workspace when applicable; node --import tsx src/cli/cli.ts stats . --check when the selected target is a goat-flow installation. Command output wins over prose.",
    "",
    "Read next: target instruction files, local agent settings/hooks, .goat-flow/config.yaml when present, .goat-flow/skill-docs/ and .goat-flow/skill-docs/playbooks/ when present, controlling-workspace harness code under src/cli/audit/harness/, and any dashboard terminal/runner context text that affects selected-target execution.",
    "",
    "Output sections: Harness Scorecard; Findings ordered by severity; Concern-by-concern analysis; False positive and false negative risks; Top 5 improvements; What was not verified. For each deterministic harness concern (Context, Constraints, Verification, Recovery, Feedback Loop), state what works, what fails or is weak, exact file or semantic-anchor evidence, and a verification command that would prove the fix.",
    "",
    "Do not treat a structural PASS as quality PASS. If a score or check claims completeness, verify what behavior it actually proves.",
  ].join("\n");
}

/**
 * Builds the cards the user picks from on the Quality tab, in the order they appear on screen.
 *
 * Cards render before their presets arrive, so a card can exist with no prompt yet; treat a missing prompt as "not ready", not "empty".
 *
 * @param ctx - dashboard state supplying loaded presets and the selected project
 * @returns the cards in display order; `prompt` is undefined on a preset-backed card whose preset has not loaded yet
 */
function dashboardQualityModes(
  ctx: DashboardSetupQualityContext,
): QualityModeOption[] {
  const qualityCheck = dashboardQualityModePreset(
    ctx,
    "quality-check-goatflow",
  );
  const skillQuality = dashboardQualityModePreset(ctx, "skill-quality-test");
  return [
    {
      id: "agent-setup",
      label: "Agent Installation",
      desc: "Assess the active agent installation across accuracy, relevance, completeness, and friction.",
      source: "api",
      targetScope: "selected project and selected agent installation",
    },
    {
      id: "process",
      label: "GOAT Flow Process",
      desc: "Review framework artifacts, instructions, references, hooks, and workflow policy.",
      source: "api",
      presetId: "quality-check-goatflow",
      targetScope:
        "controlling goat-flow workspace, plus selected target only when it is a goat-flow installation",
      prompt: qualityCheck?.prompt,
    },
    {
      id: "harness",
      label: "Harness Engineering",
      desc: "Assess context, constraints, verification, recovery, and feedback-loop quality.",
      source: "api",
      targetScope:
        "selected target project harness, interpreted from the controlling workspace",
      prompt: dashboardHarnessQualityPrompt(),
    },
    {
      id: "skills",
      label: "Skills",
      desc: "Pressure-test goat-flow skills with the RED/GREEN/REFACTOR quality protocol.",
      source: "api",
      presetId: "skill-quality-test",
      targetScope:
        "controlling goat-flow workspace skills and shared references",
      prompt: skillQuality?.prompt,
    },
  ];
}

/**
 * Resolves which Quality card the user currently has highlighted, so the launch button and prompt match their choice.
 *
 * @param ctx - dashboard state; the card the user clicked is remembered as `selectedQualityModeId`
 * @returns the selected card, or null before the user picks one, which leaves the launch button on its neutral label
 */
function dashboardSelectedQualityModeMeta(
  ctx: DashboardSetupQualityContext,
): QualityModeOption | null {
  return (
    dashboardQualityModes(ctx).find(
      (mode) => mode.id === ctx.selectedQualityModeId,
    ) ?? null
  );
}

/** Return the goat-flow controlling workspace path for framework-scoped quality modes. */
function dashboardQualityControllingWorkspace(): string {
  return window.__GOAT_FLOW_DEFAULT_PATH__ ?? ".";
}

/**
 * Quotes text for the shell commands embedded in a generated quality prompt, so a project path with spaces still pastes and runs.
 *
 * @param unquotedText - raw text, usually a project path the user picked; embedded quotes are escaped so it stays one shell word
 * @returns the quoted text including its surrounding quotes; never empty, so the command never loses an argument
 */
function dashboardQualityShellQuote(unquotedText: string): string {
  return `'${unquotedText.replace(/'/g, "'\\''")}'`;
}

/**
 * Select the project that owns the active quality mode's saved report.
 * Use for both prompt text and runner permissions so the UI shows and enforces one destination.
 *
 * @param ctx - Quality view state; an empty project path means target selection has not finished
 * @param mode - selected quality mode; never null after the user chooses a Quality card
 * @returns controlling workspace for process/skills, otherwise the selected target; never empty in a launch
 */
function dashboardQualityReportProjectPath(
  ctx: DashboardSetupQualityContext,
  mode: QualityModeOption,
): string {
  // Framework modes save beside the framework evidence the user asked to assess.
  if (mode.id === "process" || mode.id === "skills") {
    return dashboardQualityControllingWorkspace();
  }
  // Target modes save beside the selected project's setup or harness evidence.
  return ctx.projectPath;
}

/**
 * Builds the text on the Quality launch button so the user can see exactly what is about to run, and against which agent.
 *
 * The preset's own name wins so the button echoes what the user configured, then the mode label, then the target agent id.
 *
 * @param ctx - dashboard state supplying the selected mode, target agent, and active runner
 * @returns the button label; never empty, because an unlabelled launch button gives the user nothing to check before clicking
 */
function dashboardQualityLaunchLabel(
  ctx: DashboardSetupQualityContext,
): string {
  const mode = dashboardSelectedQualityModeMeta(ctx);
  const modeLabel = mode
    ? mode.presetId
      ? (dashboardQualityModePreset(ctx, mode.presetId)?.name ?? mode.label)
      : mode.label
    : ctx.qualityAgent;
  return `Quality ${modeLabel} for ${dashboardAgentDisplayName(ctx, ctx.qualityAgent)} via ${dashboardAgentDisplayName(ctx, ctx.activeRunner)}`;
}

/**
 * Builds the "where to save the report" half of a quality prompt, so the run a user launches lands in their history rather than a transcript.
 *
 * It tells the agent the owning project, the exact filename rules, and the schema the report must satisfy to stay loadable by `quality history`.
 *
 * @param ctx - dashboard state supplying the target agent and selected project
 * @param mode - the Quality card the user picked; decides which project owns the saved report
 * @returns the contract block as newline-joined Markdown; never empty, since a prompt without it produces a report nobody can find again
 */
function dashboardQualityReportLogPrompt(
  ctx: DashboardSetupQualityContext,
  mode: QualityModeOption,
): string {
  const agent = ctx.qualityAgent;
  const projectPath = dashboardQualityReportProjectPath(ctx, mode);
  const agentJson = JSON.stringify(agent);
  const projectPathJson = JSON.stringify(projectPath);
  const modeJson = JSON.stringify(mode.id);
  const versionJson = JSON.stringify(window.__GOAT_FLOW_VERSION__ ?? "unknown");
  const scopeJson = JSON.stringify(
    mode.id === "process" || mode.id === "skills"
      ? "framework-self"
      : "consumer",
  );
  const reportRootShell = dashboardQualityShellQuote(projectPath);
  return [
    "Quality report log:",
    `- Report owner project_path for this mode: ${projectPath}`,
    "- Persist the final report through the bounded saver. It redacts and validates stdin in memory, then chooses a filename under the owner project's gitignored `.goat-flow/logs/quality/`.",
    "- Filename format: `YYYY-MM-DD-HHMM-<agent>-<rand5>.json`; the saver derives every filename component.",
    "- JSON body shape:",
    "```json",
    "{",
    '  "report_kind": "goat-flow-quality-report",',
    `  "goat_flow_version": ${versionJson},`,
    `  "agent": ${agentJson},`,
    `  "project_path": ${projectPathJson},`,
    '  "run_date": "YYYY-MM-DD",',
    '  "audit_status": "pass | fail | unavailable",',
    `  "scope": ${scopeJson},`,
    `  "rubric_version": ${versionJson},`,
    `  "quality_mode": ${modeJson},`,
    '  "prior_report_id": null,',
    '  "assessment_context": {',
    '    "project_revision": null,',
    '    "working_tree_state": "unavailable",',
    '    "grounding_status": "blocked",',
    '    "unverified_probes": ["runtime grounding not yet recorded"],',
    '    "score_confidence": "low"',
    "  },",
    '  "scores": {',
    '    "setup": { "total": 0, "accuracy": 0, "relevance": 0, "completeness": 0, "friction": 0 },',
    '    "system": { "total": 0, "usefulness": 0, "signal_to_noise": 0, "adaptability": 0, "learnability": 0 }',
    "  },",
    '  "findings": [',
    '    { "type": "setup_quality", "severity": "MAJOR", "file": ".goat-flow/architecture.md", "line": null, "summary": "One-line finding summary", "detail": "Why it matters", "evidence_quality": "OBSERVED", "evidence_method": "static-analysis", "delta_tag": "new" }',
    "  ]",
    "}",
    "```",
    "- Use exact score axis values `0 | 5 | 10 | 15 | 20 | 25`; each total must equal its axis sum.",
    "- Allowed finding types: `setup_quality`, `skill_flaw`, `contradiction`, `false_path`, `content_quality`, `framework_flaw`.",
    "- Allowed severities: `BLOCKER`, `MAJOR`, `MINOR`. Allowed evidence methods: `runtime-probe`, `static-analysis`, `mixed`.",
    '- `prior_report_id`: keep `null` unless you can cite a specific prior report id (from `goat-flow quality history`) for this same agent/mode. When it is set, `delta_tag` is REQUIRED on every finding (`"new"` unless the finding materially matches that prior report; then `"persisted"`); when it is `null`, leave `delta_tag` as `null` or omit it.',
    "- `assessment_context`: record `project_revision`, `working_tree_state` (`clean`, `dirty`, `not-git`, or `unavailable`), `grounding_status` (`complete`, `partial`, or `blocked`), every skipped, denied, or unavailable command or skill probe in `unverified_probes`, and `score_confidence` (`high`, `medium`, or `low`). Use an empty probe array only for complete grounding. This metadata does not change or cap the rubric scores.",
    "- Live review findings should cite `file` + semantic anchor after re-reading the cited file and anchor. Durable footguns, lessons, patterns, and decisions must use file paths plus semantic anchors rather than line numbers.",
    "- **Version-skew calibration:** Executable version checks select a compatible report saver; they are not findings or score inputs. Before publication, the framework checkout may be newer than the bare `goat-flow` on `PATH`; use the matching source CLI and do not report or score that PATH-only skew. Raise version findings only when repository-owned declarations or managed target artifacts disagree.",
    "- In the controlling goat-flow checkout, confirm `node --import tsx src/cli/cli.ts --version` matches the report version, then run:",
    "```bash",
    `node --import tsx src/cli/cli.ts quality save ${reportRootShell} <<'JSON'`,
    "<insert the complete report object as one JSON line here>",
    "JSON",
    "```",
    "- Outside the framework checkout, use the matching installed CLI:",
    "```bash",
    `goat-flow quality save ${reportRootShell} <<'JSON'`,
    "<insert the complete report object as one JSON line here>",
    "JSON",
    "```",
    "- Minify the completed object to one JSON line; multi-line heredoc bodies can be mistaken for chained commands by safety hooks.",
    "- Never stage the raw JSON or pass `--output`. If neither saver is compatible, report `persist-skipped: redactor-unavailable`.",
    "- Success prints `OK <absolute-report-path>` only after the report exists and validates.",
    "- End your response with: `Wrote quality report to <absolute-report-path>` using the exact `OK` path.",
    `- This log requirement applies to the ${mode.label} mode; do not skip it even when the prose assessment is complete.`,
  ].join("\n");
}

/**
 * Assembles the full prompt the user copies or launches: the preset text, the scope block, then the report-log contract.
 *
 * @param ctx - dashboard state supplying the controlling workspace and the project the user selected
 * @param mode - the Quality card the user picked; one whose preset has not loaded yet carries no prompt text
 * @returns the complete prompt, or an empty string when there is nothing to build on, which the Quality tab shows as a card that cannot launch yet
 */
function dashboardBuildQualityModePrompt(
  ctx: DashboardSetupQualityContext,
  mode: QualityModeOption,
): string {
  const prompt = mode.prompt?.trim();
  if (!prompt) {
    return "";
  }
  return [
    prompt,
    "",
    "Quality mode scope:",
    `- Mode: ${mode.label}`,
    `- Controlling goat-flow workspace: ${window.__GOAT_FLOW_DEFAULT_PATH__ ?? "."}`,
    `- Selected target project: ${ctx.projectPath}`,
    `- Scope rule: ${mode.targetScope}`,
    "- Treat missing target .goat-flow files as normal unless this mode explicitly audits a goat-flow installation.",
    "- Keep this assessment read-only unless the user explicitly asks for edits.",
    `- Selected quality target agent: ${ctx.qualityAgent}`,
    "",
    dashboardQualityReportLogPrompt(ctx, mode),
  ].join("\n");
}

/**
 * Fills the Setup tab's form by asking the server what languages, commands, agents, and goat-flow artifacts the selected project already has.
 *
 * Runs when the user picks a project or hits Re-detect, and is the step that decides what the generated setup prompt will claim.
 *
 * Every field is read through a typed fallback because the reply is untrusted JSON, so:
 * - a partial response still leaves a usable form instead of half-filled inputs
 * - Error behavior: never throws; a dead endpoint or an error payload surfaces as a toast and keeps the previous values
 */
async function dashboardDetectStack(
  ctx: DashboardSetupQualityContext,
): Promise<void> {
  ctx.setupDetecting = true;
  try {
    const res = await dashboardFetch(
      `/api/setup/detect?path=${encodeURIComponent(ctx.projectPath)}`,
    );
    const payload = readRecord(await res.json(), "Setup detection response");
    const error = readErrorMessage(payload);
    // The server refused the path itself, so the user sees why instead of an empty form that looks like a clean project.
    if (error) {
      ctx.showToast(error, true);
      ctx.setupDetecting = false;
      return;
    }
    const commands = isRecord(payload.commands) ? payload.commands : {};
    const agents = isRecord(payload.agents) ? payload.agents : {};
    const existing = isRecord(payload.existing) ? payload.existing : {};
    ctx.setupData.languages = readStringArray(payload.languages);
    ctx.setupData.frameworks = readStringArray(payload.frameworks);
    ctx.setupData.commands = {
      test: readString(commands.test),
      lint: readString(commands.lint),
      build: readString(commands.build),
      format: readString(commands.format),
    };
    const defaultAgents = buildDefaultSetupAgents(
      ctx.supportedAgents,
      ctx.setupSelectedAgent,
    );
    ctx.setupData.agents = Object.fromEntries(
      (Object.keys(defaultAgents) as RunnerId[]).map((agentId) => [
        agentId,
        readBoolean(agents[agentId], defaultAgents[agentId] ?? false),
      ]),
    );
    // No agent came back ticked, so the one the user already selected stays ticked and the Setup form never renders with nothing chosen.
    if (!Object.values(ctx.setupData.agents).some((v) => v)) {
      ctx.setupData.agents[ctx.setupSelectedAgent] = true;
    }
    ctx.setupData.existing = {
      skills: readBoolean(existing.skills, DEFAULT_EXISTING_ARTIFACTS.skills),
      instructionsRepoWide: readBoolean(
        existing.instructionsRepoWide,
        DEFAULT_EXISTING_ARTIFACTS.instructionsRepoWide,
      ),
      instructionsPathScoped: readBoolean(
        existing.instructionsPathScoped,
        DEFAULT_EXISTING_ARTIFACTS.instructionsPathScoped,
      ),
      lessons: readBoolean(
        existing.lessons,
        DEFAULT_EXISTING_ARTIFACTS.lessons,
      ),
      footguns: readBoolean(
        existing.footguns,
        DEFAULT_EXISTING_ARTIFACTS.footguns,
      ),
      config: readBoolean(existing.config, DEFAULT_EXISTING_ARTIFACTS.config),
    };
    ctx.setupData.nonGoatFlow = readStringArray(payload.nonGoatFlow);
  } catch (err) {
    // For example, the user stopped the dashboard server, or picked a path on a network drive that went offline mid-detect.
    const msg = err instanceof Error ? err.message : String(err);
    ctx.showToast(msg || "Detection failed", true);
  }
  ctx.setupDetecting = false;
}

/**
 * Decides whether the Setup tab can show cached output instantly instead of making the user wait for another round trip.
 *
 * Switching project empties the whole cache, because every cached prompt describes one project's detected state.
 *
 * @param ctx - dashboard state whose cache is emptied in place when the project changed
 * @param agent - agent whose cached output is wanted
 * @param requestProjectPath - project this request targets; a mismatch clears every cached agent rather than showing the old project's prompt
 * @param shouldForce - true when the user clicked Regenerate, which skips the cache entirely
 * @returns the output to show immediately, or null when the caller must fetch
 */
function dashboardReusableSetupOutput(
  ctx: DashboardSetupQualityContext,
  agent: RunnerId,
  requestProjectPath: string,
  shouldForce: boolean,
): string | null {
  // The user switched projects, so every cached prompt now describes the wrong one and must go.
  if (ctx._setupOutputProjectPath !== requestProjectPath) {
    ctx.setupOutputs = {};
    ctx._setupOutputProjectPath = requestProjectPath;
  }
  // The user asked for a fresh generation, so the cache is skipped even when it holds a usable prompt.
  if (shouldForce) return null;
  return ctx.setupOutputs[agent] || null;
}

/**
 * Generates the setup prompt the user copies into their agent, for one target agent and the selected project.
 *
 * Guards exist because the user can switch project or agent while a request is in flight, so only the newest reply may land on screen.
 *
 * Error behavior: never throws; a failed generation reports as a toast and returns null, leaving whatever the pane already showed.
 *
 * @param ctx - dashboard state whose prompt cache is populated on success
 * @param targetAgent - agent to generate for; supplies both the request and the cache key
 * @param options - `force` true when the user clicked Regenerate, which bypasses cached output
 * @returns the generated prompt, or null when the request went stale or the server reported an error, both of which leave the pane unchanged
 */
async function dashboardGenerateSetupPromptForAgent(
  ctx: DashboardSetupQualityContext,
  targetAgent: RunnerId,
  { force: shouldForce = false }: Partial<Record<"force", boolean>> = {},
): Promise<string | null> {
  const requestProjectPath = ctx.projectPath;
  const agent = targetAgent;
  const cachedOutput = dashboardReusableSetupOutput(
    ctx,
    agent,
    requestProjectPath,
    shouldForce,
  );
  if (cachedOutput !== null) return cachedOutput;

  const requestKey = `${requestProjectPath}\0${agent}`;
  ctx._setupPromptRequestKey = requestKey;
  ctx.setupGenerating = true;
  /** False once the user has switched projects, so this reply must be discarded entirely. */
  const isCurrentProject = (): boolean =>
    ctx.projectPath === requestProjectPath;
  /** False once a newer request started, so this reply may not overwrite cached output. */
  const isLatestRequest = (): boolean =>
    ctx._setupPromptRequestKey === requestKey;
  /** A superseded reply still counts when the user has no cached output to fall back on. */
  const shouldApplyResult = (): boolean =>
    isLatestRequest() || !ctx.setupOutputs[agent];
  try {
    const res = await dashboardFetch(
      `/api/setup?path=${encodeURIComponent(requestProjectPath)}&agent=${encodeURIComponent(agent)}`,
    );
    const payload = readRecord(await res.json(), "Setup response");
    if (!isCurrentProject()) return null;
    const error = readErrorMessage(payload);
    // The server could not compose a prompt for this agent, so the user is told which agent failed rather than seeing a silent no-op.
    if (error) {
      if (shouldApplyResult()) ctx.showToast(`${agent}: ${error}`, true);
      return null;
    }
    const output = readString(payload.output) || "No output generated.";
    if (shouldApplyResult()) ctx.setupOutputs[agent] = output;
    return output;
  } catch (err) {
    // For example, the user closed the laptop mid-request and the fetch aborted, or they switched projects while the server was still composing.
    if (!isCurrentProject()) return null;
    const msg = err instanceof Error ? err.message : String(err);
    if (shouldApplyResult()) ctx.showToast(msg || "Generation failed", true);
    return null;
  } finally {
    if (isLatestRequest()) {
      ctx.setupGenerating = false;
      ctx._setupPromptRequestKey = null;
    }
  }
}

/** Generate setup output for the agent selected in the setup view. */
async function dashboardGenerateSetupPrompt(
  ctx: DashboardSetupQualityContext,
  { force: shouldForce = false }: Partial<Record<"force", boolean>> = {},
): Promise<void> {
  await dashboardGenerateSetupPromptForAgent(ctx, ctx.setupSelectedAgent, {
    force: shouldForce,
  });
}

/** Schedule setup prompt generation after setup detection gets a paint. */
function dashboardScheduleSetupPrompt(ctx: DashboardSetupQualityContext): void {
  if (ctx._setupPromptTimer !== null) {
    clearTimeout(ctx._setupPromptTimer);
  }
  ctx._setupPromptTimer = setTimeout(() => {
    ctx._setupPromptTimer = null;
    void ctx.generateSetupPrompt();
  }, SETUP_PROMPT_LOAD_DELAY_MS);
}

/**
 * Generates the quality prompt or report for whichever Quality card the user selected, and drops the result into the Quality pane.
 *
 * Error behavior: never throws; a failure toasts and leaves the pane empty rather than showing a stale report the user might read as current.
 *
 * @param ctx - dashboard state mutated in place with the generated result and loading flag
 * @param options - `fast` accepts a cached answer, `fresh` forces the server to regather evidence
 * @returns nothing; the Quality pane reads `ctx.qualityResult` once this resolves
 */
async function dashboardGenerateQuality(
  ctx: DashboardSetupQualityContext,
  {
    fast: useFastCache = false,
    fresh: includeFresh = false,
  }: DashboardQualityGenerateOptions = {},
): Promise<void> {
  ctx.qualityLoading = true;
  ctx.qualityResult = null;
  ctx.qualityCopyLabel = "Copy";
  const requestModeId = ctx.selectedQualityModeId;
  const requestMode = dashboardSelectedQualityModeMeta(ctx);
  const requestProjectPath = requestMode
    ? dashboardQualityReportProjectPath(ctx, requestMode)
    : ctx.projectPath;
  const requestSelectedProjectPath = ctx.projectPath;
  const requestAgent = ctx.qualityAgent;
  const fastParam = useFastCache ? "&fast=true" : "";
  const freshParam = includeFresh ? "&fresh=true" : "";
  /** False once mode, project, or agent changed, so this reply must not land in the Quality view. */
  const isCurrentRequest = (): boolean =>
    ctx.selectedQualityModeId === requestModeId &&
    ctx.projectPath === requestSelectedProjectPath &&
    ctx.qualityAgent === requestAgent;
  try {
    const res = await dashboardFetch(
      `/api/quality?path=${encodeURIComponent(requestProjectPath)}&agent=${encodeURIComponent(requestAgent)}&mode=${encodeURIComponent(requestModeId)}&target=${encodeURIComponent(requestSelectedProjectPath)}${fastParam}${freshParam}`,
    );
    const payload = readRecord(await res.json(), "Quality response");
    if (!isCurrentRequest()) return;
    const error = readErrorMessage(payload);
    // The server rejected this mode or project, so the user sees the reason instead of an empty Quality pane.
    if (error) {
      ctx.showToast(error, true);
    } else {
      ctx.qualityResult = readQualityResult(payload);
    }
  } catch (err) {
    // For example, the user picked a project that was deleted from disk after the dashboard listed it.
    if (!isCurrentRequest()) return;
    const msg = err instanceof Error ? err.message : String(err);
    ctx.showToast(msg || "Quality prompt generation failed", true);
  }
  if (isCurrentRequest()) ctx.qualityLoading = false;
}

/**
 * Loads the saved quality runs shown in the Quality tab's history table for the selected project and agent.
 *
 * Unparseable rows are dropped rather than failing the batch, so one corrupt saved report cannot hide the rest of the user's history.
 *
 * Error behavior: never throws; an unreachable endpoint reports as a toast and leaves the history table empty rather than stale.
 *
 * @param ctx - dashboard state mutated in place with rows, the latest entry, and any warnings
 * @returns nothing; the history table reads `ctx.qualityHistoryRows` once this resolves
 */
async function dashboardGenerateQualityHistory(
  ctx: DashboardSetupQualityContext,
): Promise<void> {
  ctx.qualityHistoryLoading = true;
  dashboardClearQualityHistory(ctx);
  const requestModeId = ctx.selectedQualityModeId;
  const requestMode = dashboardSelectedQualityModeMeta(ctx);
  const requestProjectPath = requestMode
    ? dashboardQualityReportProjectPath(ctx, requestMode)
    : ctx.projectPath;
  const requestSelectedProjectPath = ctx.projectPath;
  const requestAgent = ctx.qualityAgent;
  /** False once mode, project, or agent changed, so these rows belong to a view the user left. */
  const isCurrentRequest = (): boolean =>
    ctx.selectedQualityModeId === requestModeId &&
    ctx.projectPath === requestSelectedProjectPath &&
    ctx.qualityAgent === requestAgent;
  try {
    const res = await dashboardFetch(
      `/api/quality/history?path=${encodeURIComponent(requestProjectPath)}&agent=${encodeURIComponent(requestAgent)}&mode=${encodeURIComponent(requestModeId)}&limit=20`,
    );
    const payload = readRecord(await res.json(), "Quality history response");
    if (!isCurrentRequest()) return;
    const error = readErrorMessage(payload);
    if (error) {
      ctx.showToast(error, true);
    } else {
      ctx.qualityHistoryRows = Array.isArray(payload.rows)
        ? payload.rows
            .map((row) => readQualityHistoryRow(row))
            .filter((row): row is QualityHistoryRow => row !== null)
        : [];
      ctx.qualityHistoryLatest = readQualityHistoryLatest(payload.latest);
      ctx.qualityHistoryWarnings = readStringArray(payload.warnings);
    }
  } catch (err) {
    if (!isCurrentRequest()) return;
    const msg = err instanceof Error ? err.message : String(err);
    ctx.showToast(msg || "Quality history loading failed", true);
  }
  if (isCurrentRequest()) ctx.qualityHistoryLoading = false;
}

/** Schedule quality-history loading after the prompt path gets a paint. */
function dashboardScheduleQualityHistory(
  ctx: DashboardSetupQualityContext,
): void {
  if (ctx._qualityHistoryTimer !== null) {
    clearTimeout(ctx._qualityHistoryTimer);
  }
  ctx._qualityHistoryTimer = setTimeout(() => {
    ctx._qualityHistoryTimer = null;
    void ctx.generateQualityHistory();
  }, QUALITY_HISTORY_LOAD_DELAY_MS);
}

/** Copy the current quality prompt to the clipboard. */
function dashboardCopyQuality(ctx: DashboardSetupQualityContext): void {
  if (!ctx.qualityResult?.prompt) return;
  ctx.copyText(ctx.qualityResult.prompt);
  ctx.qualityCopyLabel = "Copied!";
  setTimeout(() => (ctx.qualityCopyLabel = "Copy"), 2000);
}
