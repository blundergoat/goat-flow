/**
 * Setup and quality controller helpers for the dashboard Alpine app.
 * These functions are classic-script globals called by thin methods in app.ts.
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
 * Resolve an agent's human-readable name for setup and quality labels.
 *
 * @param ctx - dashboard state holding the supported-agent list
 * @param agentId - agent to name; ids absent from the list are still rendered rather than dropped
 * @returns the agent's display name, or `agentId` itself when the list has no entry for it
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
 * List the instruction files the selected agent installs, for the Setup view's explanatory line.
 *
 * @param ctx - dashboard state; `setupSelectedAgent` chooses whose surfaces are listed
 * @returns comma-separated surface list, or the bare agent id when that agent is not in the list
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
 * Look up one configured quality preset by id.
 *
 * @param ctx - dashboard state holding the loaded presets
 * @param presetId - preset to find; an unknown id is a normal miss, not an error
 * @returns the matching preset, or null when presets have not loaded yet or the id is unknown
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
 * Build the Quality view's mode cards in display order.
 * Preset-backed cards render before their preset resolves, so a card can exist with no prompt text
 * yet; callers must treat a missing prompt as "not ready" rather than "empty prompt".
 *
 * @param ctx - dashboard state supplying the loaded presets and the selected project
 * @returns the mode cards in display order; `prompt` is undefined on a preset-backed card whose
 *   preset has not loaded
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
 * Resolve the Quality mode card the user currently has selected.
 *
 * @param ctx - dashboard state; `selectedQualityModeId` chooses the card
 * @returns the selected card, or null before a choice is made or when the stored id matches no card
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
 * Single-quote text for the shell snippets embedded in generated quality-report prompts.
 *
 * @param unquotedText - raw text such as a project path; embedded single quotes are escaped, so any
 *   path the user can select stays one shell word
 * @returns the quoted text including its surrounding quotes; never empty
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
 * Build the label shown on the Quality launch button.
 * Prefers the preset's own name so the button matches what the user configured, falling back to the
 * mode label and finally to the target agent id when no mode is selected.
 *
 * @param ctx - dashboard state supplying the selected mode, target agent, and active runner
 * @returns the launch label; never empty
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
 * Build the report-logging contract appended to every generated quality prompt.
 * This half of the prompt tells the agent where the report must be saved and what schema it must
 * satisfy, so a saved report stays loadable by `quality history`.
 *
 * @param ctx - dashboard state supplying the target agent and selected project
 * @param mode - selected mode; decides the owning project and the mode name written into the contract
 * @returns the contract block as newline-joined Markdown; never empty
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
 * Assemble one mode's full prompt: the preset text, the scope block, then the report-log contract.
 *
 * @param ctx - dashboard state supplying the controlling workspace and the selected target project
 * @param mode - selected mode; one whose preset has not loaded carries no prompt text yet
 * @returns the complete prompt, or an empty string when the mode has no prompt text to build on
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
 * Detect the selected project's stack and existing GOAT Flow setup state.
 * Every payload field is read through a typed fallback because the response is untrusted JSON, so a
 * partial or malformed reply still leaves the Setup form usable instead of half-populated.
 * Error behavior: never throws; transport failures and error payloads surface as a toast.
 *
 * @param ctx - dashboard state mutated in place with the detected stack, agents, and existing artifacts
 * @returns nothing; callers read `ctx.setupData` after awaiting
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
    const msg = err instanceof Error ? err.message : String(err);
    ctx.showToast(msg || "Detection failed", true);
  }
  ctx.setupDetecting = false;
}

/**
 * Decide whether this agent's cached setup output can be returned without another request.
 * Switching project empties the whole cache because every cached output describes one project's
 * detected state, so a stale entry would misdescribe the newly selected target.
 *
 * @param ctx - dashboard state whose cache is emptied in place when the project changed
 * @param agent - agent whose cached output is wanted
 * @param requestProjectPath - project this request targets; a mismatch clears every cached agent
 * @param shouldForce - true skips the cache so the caller always refetches
 * @returns the output to return immediately, or null when the caller must fetch
 */
function dashboardReusableSetupOutput(
  ctx: DashboardSetupQualityContext,
  agent: RunnerId,
  requestProjectPath: string,
  shouldForce: boolean,
): string | null {
  if (ctx._setupOutputProjectPath !== requestProjectPath) {
    ctx.setupOutputs = {};
    ctx._setupOutputProjectPath = requestProjectPath;
  }
  if (shouldForce) return null;
  return ctx.setupOutputs[agent] || null;
}

/**
 * Generate setup output for a specific target agent and selected project.
 * Three staleness guards exist because the user can switch project or agent mid-request; only the
 * newest request may overwrite cached output or raise a toast.
 * Error behavior: never throws; an error payload or transport failure reports as a toast, returns null.
 *
 * @param ctx - dashboard state whose `setupOutputs` cache is populated on success
 * @param targetAgent - agent to generate for; supplies both the request and the cache key
 * @param options - `force` true regenerates even when this agent already has cached output
 * @returns the generated output, or null when the request went stale or the server reported an error
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
    if (error) {
      if (shouldApplyResult()) ctx.showToast(`${agent}: ${error}`, true);
      return null;
    }
    const output = readString(payload.output) || "No output generated.";
    if (shouldApplyResult()) ctx.setupOutputs[agent] = output;
    return output;
  } catch (err) {
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
 * Generate a quality prompt for the selected project and agent.
 * Error behavior: never throws; an error payload or transport failure reports as a toast and leaves
 * `qualityResult` null so the view keeps its empty state rather than showing a stale report.
 *
 * @param ctx - dashboard state mutated in place with the generated result and loading flag
 * @param options - `fast` allows a cached answer, `fresh` forces regenerated evidence
 * @returns nothing; callers read `ctx.qualityResult` after awaiting
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
    if (error) {
      ctx.showToast(error, true);
    } else {
      ctx.qualityResult = readQualityResult(payload);
    }
  } catch (err) {
    if (!isCurrentRequest()) return;
    const msg = err instanceof Error ? err.message : String(err);
    ctx.showToast(msg || "Quality prompt generation failed", true);
  }
  if (isCurrentRequest()) ctx.qualityLoading = false;
}

/**
 * Load persisted quality-history rows for the selected project and agent.
 * Rows that fail to parse are dropped rather than rejecting the batch, so one corrupt saved report
 * cannot hide the rest of the user's history.
 * Error behavior: never throws; an error payload or transport failure reports as a toast.
 *
 * @param ctx - dashboard state mutated in place with rows, the latest entry, and any warnings
 * @returns nothing; callers read `ctx.qualityHistoryRows` after awaiting
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
