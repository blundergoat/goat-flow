/**
 * Dashboard summary tests for the Home and Quality views users scan after an audit.
 * They execute Alpine helpers in a browser-shaped VM and pin the labels shown beside concern scores.
 * Use when audit presentation changes so passing scores cannot hide evidence limits.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { createContext, runInContext } from "node:vm";
import { ScriptTarget, transpileModule } from "typescript";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const HOME_VIEW_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "views",
  "home.html",
);
const QUALITY_VIEW_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "views",
  "quality.html",
);
const SETUP_QUALITY_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "dashboard-setup-quality.ts",
);

type HomeModel = {
  /** Return true when every harness concern for an agent is passing. */
  agentAllConcernsPassing(agent: Record<string, unknown>): boolean;
  /** Return the score shown for one agent summary card. */
  agentScore(agent: Record<string, unknown>): number | null;
  /** Return the compact enforcement capability badge label. */
  enforcementBadge(row: Record<string, unknown>): string;
  /** Return the CSS class used for one enforcement badge. */
  enforcementBadgeClass(row: Record<string, unknown>): string;
  /** Return the proof label shown under one enforcement result. */
  enforcementEvidence(row: Record<string, unknown>): string;
  /** Return the enforcement rows rendered in the Home detail panel. */
  enforcementRows(agent: Record<string, unknown>): Record<string, unknown>[];
  /** Return the concern summary text rendered for one concern key. */
  formatConcernSummary(agent: Record<string, unknown>, key: string): string;
  /** Return the average harness score across agents. */
  harnessAverage(): number | null;
  /** Return the Home harness pill detail text. */
  harnessPillDetail(): string;
  /** Return the Home harness pill tone. */
  harnessPillTone(): string;
  /** Return the Home harness pill headline value. */
  harnessPillValue(): string;
  /** Return true when the regenerate-index button should be disabled. */
  learningIndexButtonDisabled(): boolean;
  /** Return true when the learning-loop panel shows real data instead of the NA state. */
  learningLoopReady(): boolean;
  /** Return the NA-state explanation for the learning-loop panel. */
  learningLoopNaText(): string;
  /** Return the Home learning-loop pill detail text. */
  learningPillDetail(): string;
  /** Return the Home learning-loop pill headline value. */
  learningPillValue(): string;
  /** Return the recommendation summary for one agent card. */
  recommendationSummary(agent: Record<string, unknown>): string;
  /** Return the Home next-action preview command or description. */
  nextActionCommand(): string | null;
  /** Run the primary Home next-action CTA. */
  runPrimaryAction(): Promise<void> | void;
  /** Return the section metadata text for the Home harness summary. */
  sectionMeta(): string;
};

type QualityBaselineModel = {
  /** Return evidence-limit text shown under one Quality concern score. */
  concernEvidenceLimitSummary(concern: Record<string, unknown> | null): string;
  /** Return the baseline-card action summary for one audited agent. */
  recommendationSummary(agent: Record<string, unknown> | null): string;
};

type LaunchPresetCall = {
  prompt: string;
  runner: string | undefined;
  label: string | undefined;
  options: Record<string, unknown> | undefined;
};

type HomeRuntimeContext = ReturnType<typeof createContext> & {
  __home: HomeModel;
  activeView: string;
  workspacePanel: string;
};

type PendingSetupResponse = {
  url: string;
  /** Resolve the mocked setup response with the JSON payload awaited by the dashboard fetch. */
  resolve(payload: Record<string, unknown>): void;
};

type SetupPromptContext = Record<string, unknown> & {
  projectPath: string;
  setupGenerating: boolean;
  setupOutputs: Record<string, string>;
  _setupOutputProjectPath: string | null;
  _setupPromptRequestKey: string | null;
};

type SetupPromptHelpers = {
  dashboardGenerateSetupPromptForAgent(
    ctx: SetupPromptContext,
    targetAgent: string,
    options?: { force?: boolean },
  ): Promise<string | null>;
};

/** Load the inline Home x-data model into a VM context for unit assertions. */
function loadHomeModel(
  report: unknown,
  globals: Record<string, unknown> = {},
): HomeModel {
  return loadHomeRuntime(report, globals).home;
}

/** Load the Home model plus its VM context for launch side-effect assertions. */
function loadHomeRuntime(
  report: unknown,
  globals: Record<string, unknown> = {},
): { home: HomeModel; context: HomeRuntimeContext } {
  const source = readFileSync(HOME_VIEW_PATH, "utf-8");
  const start = source.indexOf('x-data="{');
  assert.notEqual(start, -1, "home.html should contain an x-data object");
  const bodyStart = start + 'x-data="{'.length;
  const bodyEnd = source.indexOf('\n  }"\n  >', bodyStart);
  assert.notEqual(bodyEnd, -1, "home.html x-data object should be extractable");
  const body = source.slice(bodyStart, bodyEnd);
  const context = createContext({
    report,
    currentProjectSessions: [],
    supportedAgents: [
      { id: "claude", name: "Claude Code" },
      { id: "codex", name: "Codex CLI" },
    ],
    lastAuditTime: null,
    auditCached: false,
    activeRunner: "claude",
    terminalAvailable: true,
    projectPath: "/tmp/example-project",
    activeView: "home",
    workspacePanel: "overview",
    homeQualityLatest: null,
    homeQualityLoading: false,
    qualityAgent: "claude",
    presets: [],
    agentName: (agent: string) =>
      ({ claude: "Claude Code", codex: "Codex CLI" })[agent] ?? agent,
    formatAuditAge: () => "recently",
    detectStack: () => {},
    generateQuality: () => {},
    generateQualityHistory: () => {},
    generateSetupPromptForAgent: async () => "",
    launchInTerminal: () => {},
    launchPreset: () => {},
    showToast: () => {},
    ...globals,
  });
  runInContext(`globalThis.__home = ({${body}\n});`, context);
  const runtimeContext = context as HomeRuntimeContext;
  return { home: runtimeContext.__home, context: runtimeContext };
}

/** Load the Quality baseline-card helpers a user triggers by opening the Quality view. */
function loadQualityBaselineModel(): QualityBaselineModel {
  const source = readFileSync(QUALITY_VIEW_PATH, "utf-8");
  const startMarker = 'x-data="{\n            concernMeta:';
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, "quality.html should contain baseline x-data");
  const bodyStart = start + 'x-data="{'.length;
  const bodyEnd = source.indexOf('\n          }"', bodyStart);
  assert.notEqual(
    bodyEnd,
    -1,
    "quality.html baseline x-data should be extractable",
  );
  const body = source.slice(bodyStart, bodyEnd);
  const context = createContext({
    report: { agentScores: [] },
    qualityAgent: "claude",
  });
  runInContext(`globalThis.__quality = ({${body}\n});`, context);
  return (context as typeof context & { __quality: QualityBaselineModel })
    .__quality;
}

/** Load setup-prompt helpers into a VM so request-ordering can be tested without a browser. */
function loadSetupPromptHelpers(
  pendingResponses: PendingSetupResponse[],
): SetupPromptHelpers {
  const source = readFileSync(SETUP_QUALITY_PATH, "utf-8");
  const compiled = transpileModule(source, {
    compilerOptions: { target: ScriptTarget.ES2022 },
  }).outputText;
  const context = createContext({
    setTimeout,
    clearTimeout,
    dashboardFetch: (url: string) =>
      new Promise((resolve) => {
        pendingResponses.push({
          url,
          resolve: (payload: Record<string, unknown>) => {
            resolve({ json: async () => payload });
          },
        });
      }),
    readRecord: (value: unknown) =>
      value && typeof value === "object" && !Array.isArray(value) ? value : {},
    readErrorMessage: (payload: Record<string, unknown>) =>
      typeof payload.error === "string" ? payload.error : null,
    readString: (value: unknown) => (typeof value === "string" ? value : ""),
    readStringArray: (value: unknown) => (Array.isArray(value) ? value : []),
  });
  runInContext(compiled, context);
  return context as typeof context & SetupPromptHelpers;
}

/** Build the minimum setup-prompt context used by dashboard-setup-quality.ts tests. */
function makeSetupPromptContext(
  toastMessages: string[] = [],
): SetupPromptContext {
  return {
    projectPath: "/tmp/example-project",
    supportedAgents: [],
    activeRunner: "claude",
    setupSelectedAgent: "claude",
    setupDetecting: false,
    setupData: {},
    setupGenerating: false,
    setupOutputs: {},
    _setupOutputProjectPath: null,
    _setupPromptRequestKey: null,
    _setupPromptTimer: null,
    qualityAgent: "claude",
    selectedQualityModeId: "agent-setup",
    qualityLoading: false,
    qualityResult: null,
    qualityCopyLabel: "Copy",
    qualityHistoryLoading: false,
    qualityHistoryRows: [],
    qualityHistoryLatest: null,
    qualityHistoryWarnings: [],
    _qualityHistoryTimer: null,
    presets: [],
    showToast: (message: string) => {
      toastMessages.push(message);
    },
    copyText: () => {},
    generateSetupPrompt: async () => {},
    generateSetupPromptForAgent: async () => null,
    generateQuality: async () => {},
    generateQualityHistory: async () => {},
  };
}

/** Build one concern score fixture with the Home summary fields populated. */
function concern(
  status: "pass" | "fail",
  score: number,
  extra: Record<string, unknown> = {},
) {
  return {
    status,
    score,
    findings: [],
    limits: [],
    recommendations: [],
    howToFix: [],
    ...extra,
  };
}

/**
 * Load a Home model with one score-only metric warning on the Claude agent, because several tests need that exact
 * warning shape and building the full agent/scores fixture inline in each would obscure what they assert.
 */
function loadScoreOnlyWarningHomeModel(): {
  home: HomeModel;
  agent: Record<string, unknown>;
} {
  const agent = {
    id: "claude",
    name: "Claude Code",
    agent: { status: "pass", checks: [] },
    harness: {
      status: "pass",
      checks: [
        { id: "instruction", status: "pass", type: "integrity" },
        { id: "verification", status: "pass", type: "integrity" },
        {
          id: "post-turn-hook-integrity",
          status: "fail",
          type: "metric",
          impact: "score-only",
        },
      ],
    },
    concerns: {
      context: concern("pass", 100),
      constraints: concern("pass", 100),
      verification: concern("pass", 67, {
        findings: ["No post-turn hooks installed"],
      }),
      recovery: concern("pass", 100),
      feedback_loop: concern("pass", 100),
    },
  };
  const home = loadHomeModel({
    scopes: {
      setup: {
        status: "pass",
        checks: [{ id: "config-parses", status: "pass" }],
      },
    },
    agentScores: [agent],
  });
  return { home, agent };
}

/**
 * Load a Home model with hard and unknown enforcement rows for detail-panel assertions, because the detail-panel
 * tests need both enforcement variants present at once and assembling that agent fixture inline would repeat noise.
 */
function loadAdvisoryEnforcementHomeModel(): {
  home: HomeModel;
  agent: Record<string, unknown>;
} {
  const agent = {
    id: "claude",
    name: "Claude Code",
    agent: { status: "pass", checks: [] },
    harness: { status: "pass", checks: [] },
    concerns: {},
    enforcement: {
      capabilities: [
        {
          id: "shell-dangerous",
          label: "Dangerous shell commands",
          status: "hard",
          sources: ["local-hook"],
          assurance: "static-local",
          summary: "Deny mechanism blocks dangerous commands",
        },
        {
          id: "file-read-restrictions",
          label: "General file-read restrictions",
          status: "unknown",
          sources: ["not-observed"],
          assurance: "not-observed",
          summary: "Not inferred from secret-path coverage",
        },
      ],
    },
  };
  const home = loadHomeModel({
    scopes: {
      setup: {
        status: "pass",
        checks: [{ id: "config-parses", status: "pass" }],
      },
    },
    agentScores: [agent],
  });
  return { home, agent };
}

describe("Home harness summary", () => {
  it("launches generated setup prompt content from the Home setup CTA", async () => {
    const launchPresetCalls: LaunchPresetCall[] = [];
    const requestedSetupTargets: string[] = [];
    const generatedSetupPrompt = [
      "# GOAT Flow Upgrade - Claude Code",
      "",
      "## Detected install issues",
      "- Missing AGENTS.md",
    ].join("\n");
    const { home, context } = loadHomeRuntime(
      {
        scopes: {
          setup: {
            status: "fail",
            checks: [
              { id: "config-parses", status: "pass" },
              { id: "instruction-file", status: "fail" },
            ],
          },
        },
        agentScores: [],
      },
      {
        setupSelectedAgent: "codex",
        generateSetupPromptForAgent: async (targetAgent: string) => {
          requestedSetupTargets.push(targetAgent);
          return generatedSetupPrompt;
        },
        launchInTerminal: () => {
          throw new Error("Home setup should launch generated prompt content");
        },
        launchPreset: async (
          prompt: string,
          runner: string | undefined,
          label: string | undefined,
          options: Record<string, unknown> | undefined,
        ) => {
          launchPresetCalls.push({ prompt, runner, label, options });
        },
      },
    );

    assert.equal(
      home.nextActionCommand(),
      "Generated setup prompt for Claude Code",
    );
    await home.runPrimaryAction();

    assert.deepEqual(requestedSetupTargets, ["claude"]);
    assert.equal(launchPresetCalls.length, 1);
    assert.match(
      launchPresetCalls[0]!.prompt,
      /# GOAT Flow Upgrade - Claude Code/,
    );
    assert.match(launchPresetCalls[0]!.prompt, /## Detected install issues/);
    assert.notEqual(
      launchPresetCalls[0]!.prompt,
      "goat-flow setup . --agent claude",
    );
    assert.equal(launchPresetCalls[0]!.runner, "claude");
    assert.equal(
      launchPresetCalls[0]!.label,
      "Setup Claude Code via Claude Code",
    );
    assert.deepEqual(
      { ...launchPresetCalls[0]!.options },
      {
        cwdPath: "/tmp/example-project",
        targetPath: "/tmp/example-project",
      },
    );
    assert.equal(context.activeView, "workspace");
    assert.equal(context.workspacePanel, "terminal");
  });

  it("does not launch Home setup when generated prompt creation fails", async () => {
    const launchPresetCalls: LaunchPresetCall[] = [];
    const toastMessages: string[] = [];
    const { home, context } = loadHomeRuntime(
      {
        scopes: {
          setup: {
            status: "fail",
            checks: [
              { id: "config-parses", status: "pass" },
              { id: "instruction-file", status: "fail" },
            ],
          },
        },
        agentScores: [],
      },
      {
        generateSetupPromptForAgent: async () => {
          toastMessages.push("claude: setup API failed");
          return null;
        },
        launchPreset: async (
          prompt: string,
          runner: string | undefined,
          label: string | undefined,
          options: Record<string, unknown> | undefined,
        ) => {
          launchPresetCalls.push({ prompt, runner, label, options });
        },
        showToast: (message: string) => {
          toastMessages.push(message);
        },
      },
    );

    await home.runPrimaryAction();

    assert.deepEqual(launchPresetCalls, []);
    assert.deepEqual(toastMessages, ["claude: setup API failed"]);
    assert.equal(context.activeView, "home");
    assert.equal(context.workspacePanel, "overview");
  });

  it("keeps Home harness fix target separate from the active runner", async () => {
    const launchPresetCalls: LaunchPresetCall[] = [];
    const { home } = loadHomeRuntime(
      {
        scopes: {
          setup: {
            status: "pass",
            checks: [{ id: "config-parses", status: "pass" }],
          },
        },
        agentScores: [
          {
            id: "codex",
            name: "Codex CLI",
            agent: { status: "pass", checks: [] },
            harness: {
              status: "fail",
              checks: [{ id: "verification", status: "fail" }],
            },
            concerns: {
              context: concern("pass", 100),
              constraints: concern("pass", 100),
              verification: concern("fail", 60, {
                findings: ["Codex verification hook missing"],
              }),
              recovery: concern("pass", 100),
              feedback_loop: concern("pass", 100),
            },
          },
        ],
      },
      {
        activeRunner: "claude",
        launchPreset: async (
          prompt: string,
          runner: string | undefined,
          label: string | undefined,
          options: Record<string, unknown> | undefined,
        ) => {
          launchPresetCalls.push({ prompt, runner, label, options });
        },
      },
    );

    await home.runPrimaryAction();

    assert.equal(launchPresetCalls.length, 1);
    assert.equal(launchPresetCalls[0]!.runner, "claude");
    assert.equal(launchPresetCalls[0]!.label, "Harness fix Codex CLI");
    assert.match(launchPresetCalls[0]!.prompt, /- Target agent: codex/);
    assert.match(
      launchPresetCalls[0]!.prompt,
      /Codex verification hook missing/,
    );
  });

  // Fixture purpose: writes high-score agent data because hard harness failures override averages.
  it("does not show Passing when high-score agents have hard harness failures", () => {
    const expectedHarnessAverage = 93;
    const harnessChecks = Array.from({ length: 14 }, (_, index) => ({
      id: `check-${index}`,
      status: index === 0 ? "fail" : "pass",
      type: "integrity",
    }));
    const home = loadHomeModel({
      scopes: {
        setup: {
          status: "pass",
          checks: [{ id: "config-parses", status: "pass" }],
        },
      },
      agentScores: [
        {
          id: "claude",
          name: "Claude Code",
          agent: { status: "pass", checks: [] },
          harness: { status: "fail", checks: harnessChecks },
          concerns: {
            context: concern("fail", 80, { integrityFail: 1 }),
            constraints: concern("pass", 100),
            verification: concern("pass", 100),
            recovery: concern("pass", 100),
            feedback_loop: concern("pass", 100),
          },
        },
      ],
    });

    assert.equal(home.harnessAverage(), expectedHarnessAverage);
    assert.equal(home.harnessPillValue(), "Needs work");
    assert.equal(home.harnessPillTone(), "bad");
    assert.equal(
      home.harnessPillDetail(),
      "1 of 1 agents have failing checks - Context low",
    );
    assert.equal(
      home.sectionMeta(),
      "1 of 1 agents need fixes - widest gap is Context - click for details",
    );
  });

  it("surfaces score-only metric warnings in headline scoring and summaries", () => {
    const expectedScoreOnlyAgentScore = 67;
    const { home, agent } = loadScoreOnlyWarningHomeModel();

    assert.equal(home.agentScore(agent), expectedScoreOnlyAgentScore);
    assert.equal(home.recommendationSummary(agent), "1 score warning");
    assert.equal(home.agentAllConcernsPassing(agent), false);
    assert.equal(
      home.formatConcernSummary(agent, "verification"),
      "No post-turn hooks installed",
    );
  });

  it("shows a passing concern's evidence limit instead of a clean-state summary", () => {
    const evidenceLimit =
      "This audit did not execute project build, test, lint, typecheck, or format commands.";
    const home = loadHomeModel({
      scopes: {
        setup: {
          status: "pass",
          checks: [{ id: "config-parses", status: "pass" }],
        },
      },
      agentScores: [],
    });
    const agent = {
      concerns: {
        verification: concern("pass", 100, {
          limits: [evidenceLimit, "Runtime receipts were not inspected."],
        }),
      },
    };

    assert.equal(
      home.formatConcernSummary(agent, "verification"),
      `Evidence limit: ${evidenceLimit} (+1 more)`,
    );
    assert.equal(home.recommendationSummary(agent), "2 evidence limits");
  });

  it("shows the same evidence-limit vocabulary beside Quality concern scores", () => {
    const evidenceLimit = "End-to-end resumability was not demonstrated.";
    const quality = loadQualityBaselineModel();
    const qualitySource = readFileSync(QUALITY_VIEW_PATH, "utf-8");

    assert.equal(
      quality.concernEvidenceLimitSummary({ limits: [evidenceLimit] }),
      `Evidence limit: ${evidenceLimit}`,
    );
    assert.equal(quality.concernEvidenceLimitSummary({}), "");
    assert.equal(
      quality.recommendationSummary({
        concerns: {
          context: concern("pass", 100),
          constraints: concern("pass", 100),
          verification: concern("pass", 100, {
            limits: [evidenceLimit],
          }),
          recovery: concern("pass", 100),
          feedback_loop: concern("pass", 100),
        },
        harness: { checks: [] },
      }),
      "1 evidence limit",
    );
    assert.match(
      qualitySource,
      /x-text="concernEvidenceLimitSummary\(selectedAgent\.concerns\[ck\]\)"/,
    );
  });

  it("exposes advisory enforcement rows for the detail panel", () => {
    const expectedEnforcementRows = 2;
    const { home, agent } = loadAdvisoryEnforcementHomeModel();

    const rows = home.enforcementRows(agent);
    assert.equal(rows.length, expectedEnforcementRows);
    assert.equal(home.enforcementBadge(rows[0]!), "Hard");
    assert.equal(home.enforcementBadgeClass(rows[0]!), "pass");
    assert.equal(
      home.enforcementEvidence(rows[0]!),
      "Static local proof · Source: local hook",
    );
    assert.equal(home.enforcementBadge(rows[1]!), "Unk");
    assert.equal(home.enforcementBadgeClass(rows[1]!), "skipped");
    assert.equal(
      home.enforcementEvidence(rows[1]!),
      "Not observed · Source: not observed",
    );
  });
});

describe("Home learning loop", () => {
  const partialSetupScopes = {
    setup: {
      status: "fail",
      checks: [
        { id: "config-parses", status: "pass" },
        { id: "post-turn-hook", status: "fail" },
      ],
    },
  };

  it("shows learning-loop data when setup is incomplete", () => {
    const home = loadHomeModel({
      scopes: partialSetupScopes,
      agentScores: [],
      learningLoop: {
        status: "fresh",
        recordCount: 12,
        footgunCount: 5,
        lessonCount: 7,
        staleCount: 0,
        invalidLineRefCount: 0,
        oversizedCount: 0,
        indexes: [
          {
            bucket: "footguns",
            state: "fresh",
            entryCount: 5,
            indexPath: ".goat-flow/learning-loop/footguns/INDEX.md",
          },
        ],
      },
    });
    assert.equal(home.learningLoopReady(), true);
    assert.equal(home.learningPillValue(), "Fresh");
    assert.equal(home.learningPillDetail(), "5 footguns, 7 lessons");
    assert.equal(home.learningIndexButtonDisabled(), false);
  });

  it("keeps the NA state pointing at setup when no learning-loop files exist", () => {
    const home = loadHomeModel({
      scopes: partialSetupScopes,
      agentScores: [],
      learningLoop: null,
    });
    assert.equal(home.learningLoopReady(), false);
    assert.equal(
      home.learningLoopNaText(),
      "No learning-loop records yet - setup creates them.",
    );
    assert.equal(home.learningPillValue(), "N/A");
    assert.equal(home.learningPillDetail(), "created by setup");
  });
});

describe("Dashboard setup prompt generation", () => {
  it("keeps same-project setup output usable when another agent request supersedes the loading key", async () => {
    const pendingResponses: PendingSetupResponse[] = [];
    const helpers = loadSetupPromptHelpers(pendingResponses);
    const toastMessages: string[] = [];
    const ctx = makeSetupPromptContext(toastMessages);

    const claudePrompt = helpers.dashboardGenerateSetupPromptForAgent(
      ctx,
      "claude",
    );
    const codexPrompt = helpers.dashboardGenerateSetupPromptForAgent(
      ctx,
      "codex",
    );

    assert.equal(pendingResponses.length, 2);
    assert.match(pendingResponses[0]!.url, /agent=claude/);
    assert.match(pendingResponses[1]!.url, /agent=codex/);

    pendingResponses[0]!.resolve({ output: "claude generated setup" });

    assert.equal(await claudePrompt, "claude generated setup");
    assert.equal(ctx.setupOutputs.claude, "claude generated setup");
    assert.equal(ctx.setupGenerating, true);
    assert.equal(ctx._setupPromptRequestKey, "/tmp/example-project\0codex");

    pendingResponses[1]!.resolve({ output: "codex generated setup" });

    assert.equal(await codexPrompt, "codex generated setup");
    assert.equal(ctx.setupOutputs.codex, "codex generated setup");
    assert.equal(ctx.setupGenerating, false);
    assert.equal(ctx._setupPromptRequestKey, null);
    assert.deepEqual(toastMessages, []);
  });
});
