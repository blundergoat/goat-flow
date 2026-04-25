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

interface DashboardSetupQualityContext {
  projectPath: string;
  supportedAgents: SupportedAgent[];
  activeRunner: RunnerId;
  setupSelectedAgent: RunnerId;
  setupDetecting: boolean;
  setupData: SetupData;
  setupGenerating: boolean;
  setupOutputs: Record<string, string>;
  qualityAgent: RunnerId;
  selectedQualityModeId: string;
  qualityLoading: boolean;
  qualityResult: QualityResult | null;
  qualityCopyLabel: string;
  qualityHistoryLoading: boolean;
  qualityHistoryRows: QualityHistoryRow[];
  qualityHistoryLatest: QualityHistoryLatest | null;
  qualityHistoryWarnings: string[];
  presets: Preset[];
  showToast(msg: string, isError?: boolean): void;
  copyText(text: string): void;
  generateQualityHistory(): Promise<void>;
}

const SETUP_INSTRUCTION_SURFACES: Record<RunnerId, string> = {
  claude: "CLAUDE.md, .claude/settings.json",
  codex: "AGENTS.md, .codex/config.toml, .codex/hooks.json",
  gemini: "GEMINI.md, .gemini/settings.json",
  copilot:
    ".github/copilot-instructions.md, .github/instructions/**/*.instructions.md, .github/hooks/hooks.json",
};

function dashboardAgentDisplayName(
  ctx: DashboardSetupQualityContext,
  agentId: RunnerId,
): string {
  return (
    ctx.supportedAgents.find((agent) => agent.id === agentId)?.name ?? agentId
  );
}

function dashboardSetupInstructionSurfaces(
  ctx: DashboardSetupQualityContext,
): string {
  return (
    SETUP_INSTRUCTION_SURFACES[ctx.setupSelectedAgent] ?? ctx.setupSelectedAgent
  );
}

function dashboardQualityModePreset(
  ctx: DashboardSetupQualityContext,
  presetId: string,
): Preset | null {
  return ctx.presets.find((preset) => preset.id === presetId) ?? null;
}

function dashboardHarnessQualityPrompt(): string {
  return [
    "AI Harness Engineering Quality Assessment",
    "",
    "REPORTING-ONLY ASSESSMENT MODE. Do not edit tracked files. Do not use /goat-review or any goat skill as the wrapper for this assessment; this prompt is the full assessment contract. You may read files, run read-only validation commands, and write only normal gitignored reporting artifacts if the runner requires them.",
    "",
    "Assess whether the selected target project's agent harness is actually usable, not only structurally present. Focus on context loading, constraint safety, verification evidence, recovery paths, feedback-loop durability, and whether instructions distinguish the controlling goat-flow workspace from the selected target.",
    "",
    "Grounding commands to run or explicitly mark skipped: git status --short --untracked-files=all; node --import tsx src/cli/cli.ts audit . --harness --format json from the controlling workspace when applicable; node --import tsx src/cli/cli.ts stats . --check when the selected target is a goat-flow installation. Command output wins over prose.",
    "",
    "Read next: target instruction files, local agent settings/hooks, .goat-flow/config.yaml when present, .goat-flow/skill-reference/ when present, controlling-workspace harness code under src/cli/audit/harness/, and any dashboard terminal/runner context text that affects selected-target execution.",
    "",
    "Output sections: Harness Scorecard; Findings ordered by severity; Concern-by-concern analysis; False positive and false negative risks; Top 5 improvements; What was not verified. For each deterministic harness concern (Context, Constraints, Verification, Recovery, Feedback Loop), state what works, what fails or is weak, exact file or semantic-anchor evidence, and a verification command that would prove the fix. Treat Workspace Boundary as a qualitative cross-cutting risk, not as a deterministic harness score, unless the audit output explicitly exposes a Workspace Boundary concern.",
    "",
    "Do not treat a structural PASS as quality PASS. If a score or check claims completeness, verify what behavior it actually proves.",
  ].join("\n");
}

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
      id: "process",
      label: "GOAT Flow Process",
      desc: "Review framework artifacts, instructions, references, hooks, and workflow policy.",
      source: "preset",
      presetId: "quality-check-goatflow",
      targetScope:
        "controlling goat-flow workspace, plus selected target only when it is a goat-flow installation",
      prompt: qualityCheck?.prompt,
    },
    {
      id: "agent-setup",
      label: "Agent Setup Quality",
      desc: "Generate a read-only setup-quality assessment prompt for the selected agent installation.",
      source: "api",
      targetScope: "selected project and selected agent installation",
    },
    {
      id: "harness",
      label: "Harness Engineering",
      desc: "Assess context, constraints, verification, recovery, and feedback-loop quality.",
      source: "registry",
      targetScope:
        "selected target project harness, interpreted from the controlling workspace",
      prompt: dashboardHarnessQualityPrompt(),
    },
    {
      id: "skills",
      label: "Skills",
      desc: "Pressure-test goat-flow skills with the RED/GREEN/REFACTOR quality protocol.",
      source: "preset",
      presetId: "skill-quality-test",
      targetScope:
        "controlling goat-flow workspace skills and shared references",
      prompt: skillQuality?.prompt,
    },
  ];
}

function dashboardSelectedQualityModeMeta(
  ctx: DashboardSetupQualityContext,
): QualityModeOption | null {
  return (
    dashboardQualityModes(ctx).find(
      (mode) => mode.id === ctx.selectedQualityModeId,
    ) ?? null
  );
}

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

function dashboardQualityReportLogPrompt(
  ctx: DashboardSetupQualityContext,
  mode: QualityModeOption,
): string {
  const agent = ctx.qualityAgent;
  const projectPath = ctx.projectPath;
  const agentJson = JSON.stringify(agent);
  const projectPathJson = JSON.stringify(projectPath);
  const modeJson = JSON.stringify(mode.id);
  const versionJson = JSON.stringify(window.__GOAT_FLOW_VERSION__ ?? "unknown");
  return [
    "Quality report log:",
    "- Write the final machine-readable report to `.goat-flow/logs/quality/`. This path is gitignored and expected; do not write the JSON inline only.",
    "- Filename format: `YYYY-MM-DD-HHMM-<agent>-<rand5>.json`, where `<agent>` is the literal selected quality target shown below.",
    "- Derive the timestamp and random suffix from the shell at write time:",
    "```bash",
    'STAMP="$(date +"%Y-%m-%d-%H%M")"',
    "RAND=\"$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 5)\"",
    `FILE=".goat-flow/logs/quality/\${STAMP}-${agent}-\${RAND}.json"`,
    "mkdir -p .goat-flow/logs/quality",
    "```",
    "- JSON body shape:",
    "```json",
    "{",
    '  "report_kind": "goat-flow-quality-report",',
    `  "goat_flow_version": ${versionJson},`,
    `  "agent": ${agentJson},`,
    `  "project_path": ${projectPathJson},`,
    '  "run_date": "YYYY-MM-DD",',
    '  "audit_status": "pass | fail | unavailable",',
    '  "scope": "framework-self | consumer",',
    `  "rubric_version": ${versionJson},`,
    `  "quality_mode": ${modeJson},`,
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
    '- Use `delta_tag: "new"` unless the finding materially matches prior quality history for this same agent/mode; then use `persisted`.',
    "- Live review findings may cite `file` + `line` after re-reading that line. Durable footguns, lessons, patterns, and decisions must use file paths plus semantic anchors rather than line numbers.",
    '- Validate before confirming: `node --import tsx src/cli/cli.ts quality validate "$FILE"`.',
    '- Verify the file exists and is non-zero: `ls -la "$FILE"`.',
    `- End your response with: \`Wrote quality report to .goat-flow/logs/quality/<filename>.json\`.`,
    `- This log requirement applies to the ${mode.label} mode; do not skip it even when the prose assessment is complete.`,
  ].join("\n");
}

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

/** Detect the selected project's stack and existing GOAT Flow setup state. */
async function dashboardDetectStack(
  ctx: DashboardSetupQualityContext,
): Promise<void> {
  ctx.setupDetecting = true;
  try {
    const res = await fetch(
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
        typeof agents[agentId] === "boolean"
          ? agents[agentId]
          : (defaultAgents[agentId] ?? false),
      ]),
    );
    if (!Object.values(ctx.setupData.agents).some((v) => v)) {
      ctx.setupData.agents[ctx.setupSelectedAgent] = true;
    }
    ctx.setupData.existing = {
      skills:
        typeof existing.skills === "boolean"
          ? existing.skills
          : DEFAULT_EXISTING_ARTIFACTS.skills,
      instructionsRepoWide:
        typeof existing.instructionsRepoWide === "boolean"
          ? existing.instructionsRepoWide
          : DEFAULT_EXISTING_ARTIFACTS.instructionsRepoWide,
      instructionsPathScoped:
        typeof existing.instructionsPathScoped === "boolean"
          ? existing.instructionsPathScoped
          : DEFAULT_EXISTING_ARTIFACTS.instructionsPathScoped,
      lessons:
        typeof existing.lessons === "boolean"
          ? existing.lessons
          : DEFAULT_EXISTING_ARTIFACTS.lessons,
      footguns:
        typeof existing.footguns === "boolean"
          ? existing.footguns
          : DEFAULT_EXISTING_ARTIFACTS.footguns,
      config:
        typeof existing.config === "boolean"
          ? existing.config
          : DEFAULT_EXISTING_ARTIFACTS.config,
    };
    ctx.setupData.nonGoatFlow = readStringArray(payload.nonGoatFlow);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.showToast(msg || "Detection failed", true);
  }
  ctx.setupDetecting = false;
}

/** Generate setup output for the agent selected in the setup view. */
async function dashboardGenerateSetupPrompt(
  ctx: DashboardSetupQualityContext,
): Promise<void> {
  ctx.setupGenerating = true;
  ctx.setupOutputs = {};
  const agent = ctx.setupSelectedAgent;
  try {
    const res = await fetch(
      `/api/setup?path=${encodeURIComponent(ctx.projectPath)}&agent=${agent}`,
    );
    const payload = readRecord(await res.json(), "Setup response");
    const error = readErrorMessage(payload);
    if (error) {
      ctx.showToast(`${agent}: ${error}`, true);
    } else {
      ctx.setupOutputs[agent] =
        readString(payload.output) || "No output generated.";
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.showToast(msg || "Generation failed", true);
  }
  ctx.setupGenerating = false;
}

/** Generate a quality prompt for the selected project and agent. */
async function dashboardGenerateQuality(
  ctx: DashboardSetupQualityContext,
): Promise<void> {
  ctx.qualityLoading = true;
  ctx.qualityResult = null;
  ctx.qualityCopyLabel = "Copy";
  const requestModeId = ctx.selectedQualityModeId;
  const requestProjectPath = ctx.projectPath;
  const requestAgent = ctx.qualityAgent;
  const isCurrentRequest = (): boolean =>
    ctx.selectedQualityModeId === requestModeId &&
    ctx.projectPath === requestProjectPath &&
    ctx.qualityAgent === requestAgent;
  const mode = dashboardSelectedQualityModeMeta(ctx);
  if (mode && mode.source !== "api") {
    const prompt = dashboardBuildQualityModePrompt(ctx, mode);
    if (!prompt) {
      ctx.showToast(`${mode.label} prompt is unavailable`, true);
      ctx.qualityLoading = false;
      return;
    }
    ctx.qualityResult = {
      command: "quality",
      agent: ctx.qualityAgent,
      auditStatus: "unavailable",
      auditSummary: `${mode.label}: ${mode.desc}`,
      prompt,
    };
    ctx.qualityLoading = false;
    return;
  }
  try {
    const res = await fetch(
      `/api/quality?path=${encodeURIComponent(requestProjectPath)}&agent=${encodeURIComponent(requestAgent)}`,
    );
    const payload = readRecord(await res.json(), "Quality response");
    if (!isCurrentRequest()) return;
    const error = readErrorMessage(payload);
    if (error) {
      ctx.showToast(error, true);
    } else {
      ctx.qualityResult = readQualityResult(payload);
      void ctx.generateQualityHistory();
    }
  } catch (err) {
    if (!isCurrentRequest()) return;
    const msg = err instanceof Error ? err.message : String(err);
    ctx.showToast(msg || "Quality prompt generation failed", true);
  }
  if (isCurrentRequest()) ctx.qualityLoading = false;
}

/** Load persisted quality-history rows for the selected project and agent. */
async function dashboardGenerateQualityHistory(
  ctx: DashboardSetupQualityContext,
): Promise<void> {
  ctx.qualityHistoryLoading = true;
  ctx.qualityHistoryRows = [];
  ctx.qualityHistoryLatest = null;
  ctx.qualityHistoryWarnings = [];
  const requestModeId = ctx.selectedQualityModeId;
  const requestProjectPath = ctx.projectPath;
  const requestAgent = ctx.qualityAgent;
  const isCurrentRequest = (): boolean =>
    ctx.selectedQualityModeId === requestModeId &&
    ctx.projectPath === requestProjectPath &&
    ctx.qualityAgent === requestAgent;
  try {
    const res = await fetch(
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

/** Copy the current quality prompt to the clipboard. */
function dashboardCopyQuality(ctx: DashboardSetupQualityContext): void {
  if (!ctx.qualityResult?.prompt) return;
  ctx.copyText(ctx.qualityResult.prompt);
  ctx.qualityCopyLabel = "Copied!";
  setTimeout(() => (ctx.qualityCopyLabel = "Copy"), 2000);
}
