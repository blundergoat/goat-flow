/**
 * Unit tests for browser-local dashboard payload readers.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { ScriptTarget, transpileModule } from "typescript";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const READERS_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "dashboard-readers.ts",
);
const MODEL_READERS_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "dashboard-model-readers.ts",
);

type HelperContext = {
  readRunnerId: (_value: unknown) => string | null;
  readInjectedSupportedAgents: () => SupportedAgent[];
  readDashboardReport: (_value: unknown) => {
    scopes: {
      setup: {
        checks: {
          status: string;
          displayStatus: string;
          impact: string;
          type?: string;
          acknowledged?: boolean;
          evidenceKind?: string;
          assurance?: string;
          provenance: {
            framework_evidence_paths?: string[];
            target_evidence_paths?: string[];
          };
          details?: Record<string, unknown>;
        }[];
      };
    };
    agentScores: {
      harness: {
        checks: {
          status: string;
          displayStatus: string;
          impact: string;
          type?: string;
          acknowledged?: boolean;
          evidenceKind?: string;
          assurance?: string;
          provenance: {
            framework_evidence_paths?: string[];
            target_evidence_paths?: string[];
          };
          details?: Record<string, unknown>;
        }[];
      } | null;
      enforcement: {
        capabilities: {
          id: string;
          label: string;
          status: string;
          sources: string[];
          summary: string;
          evidence: string[];
        }[];
        summary: Record<string, number>;
      } | null;
    }[];
  };
  readTaskState: (_value: unknown) => {
    taskRoot: string;
    exists: boolean;
    active: string | null;
    activeExists: boolean;
    selectedPlan: string | null;
    plans: Array<{
      name: string;
      path: string;
      modifiedAt: string;
      milestoneCount: number;
      active: boolean;
    }>;
    milestones: Array<{
      filename: string;
      path: string;
      title: string;
      status: string;
      objective: string;
      totalTasks: number;
      completedTasks: number;
      modifiedAt: string;
    }>;
  };
  readSecurityReviewArtifact: (_value: unknown) => {
    contractVersion: string;
    findings: Array<{ evidence: "OBSERVED" | "INFERRED" }>;
  };
};

type SupportedAgent = {
  id: string;
  name: string;
  terminalBinary: string;
  setupSurfaces: string[];
  promptInvocationStyle: string;
  skillSource: string;
  supportsPostTurnHook: boolean;
};

function supportedAgent(
  id: string,
  overrides: Partial<SupportedAgent> = {},
): SupportedAgent {
  return {
    id,
    name: id === "codex" ? "Codex" : "Claude Code",
    terminalBinary: id,
    setupSurfaces: id === "codex" ? ["AGENTS.md"] : ["CLAUDE.md"],
    promptInvocationStyle: id === "codex" ? "dollar" : "slash",
    skillSource: id === "claude" ? "installed" : "agent-mirror",
    supportsPostTurnHook: id !== "copilot",
    ...overrides,
  };
}

/** Load dashboard reader helpers into a browser-shaped VM context. */
function loadHelpers(
  windowOverrides: Record<string, unknown> = {},
): HelperContext {
  const js = [MODEL_READERS_PATH, READERS_PATH]
    .map(
      (path) =>
        transpileModule(readFileSync(path, "utf-8"), {
          compilerOptions: { target: ScriptTarget.ES2023 },
        }).outputText,
    )
    .join("\n");
  const context = createContext({
    URL,
    window: {
      location: { href: "http://127.0.0.1:1234/?token=test-token" },
      history: { replaceState: () => undefined },
      __GOAT_FLOW_RUNNER_IDS__: ["claude"],
      __GOAT_FLOW_REPORT__: null,
      __GOAT_FLOW_AGENTS__: [supportedAgent("claude")],
      ...windowOverrides,
    },
  });
  runInContext(
    `${js}
globalThis.__helpers = {
  readRunnerId,
  readInjectedSupportedAgents,
  readDashboardReport,
  readTaskState,
  readSecurityReviewArtifact,
};`,
    context,
  );
  return (context as typeof context & { __helpers: HelperContext }).__helpers;
}

/** Provide the minimum structured provenance object required by check readers. */
function provenance(): Record<string, unknown> {
  return {
    source_type: "spec",
    source_urls: [],
    verified_on: "2026-05-01",
    normative_level: "MUST",
  };
}

/** Build one dashboard check fixture with canonical provenance unless a test overrides fields. */
function check(
  id: string,
  status: "pass" | "fail" | "skipped",
  type: "integrity" | "advisory" | "metric",
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    name: id,
    status,
    type,
    provenance: provenance(),
    ...extra,
  };
}

/** Build a minimal audit scope fixture accepted by dashboard report readers. */
function scope(
  checks: Record<string, unknown>[] = [],
): Record<string, unknown> {
  return {
    status: "pass",
    checks,
    failures: [],
    summary: {},
  };
}

/**
 * Read a report whose harness checks cover integrity, advisory, and metric rows, because the type-handling tests
 * need all three check types in one report and inlining that fixture per test would bury the assertion.
 */
function readHarnessCheckTypesReport(): ReturnType<
  HelperContext["readDashboardReport"]
> {
  return loadHelpers().readDashboardReport({
    status: "pass",
    target: "/repo",
    overall: { status: "pass" },
    scopes: {
      setup: scope(),
      agent: scope(),
      harness: scope(),
    },
    learningLoop: null,
    recentLessons: [],
    agentScores: [
      {
        id: "claude",
        name: "Claude Code",
        agent: scope(),
        harness: scope([
          check("integrity-ok", "pass", "integrity"),
          check("limited-pass", "pass", "integrity", {
            displayStatus: "info",
            assurance: "limited",
            provenance: {
              ...provenance(),
              framework_evidence_paths: ["docs/harness-audit.md"],
              target_evidence_paths: ["CLAUDE.md"],
            },
          }),
          check("advisory-ack", "fail", "advisory", {
            acknowledged: true,
            displayStatus: "warn",
            impact: "score-only",
          }),
          check("metric-info", "fail", "metric", {
            displayStatus: "warn",
            impact: "score-only",
            evidenceKind: "structural",
            details: {
              verification: [
                {
                  agent: "claude",
                  reason: "post-turn hook missing",
                },
              ],
            },
          }),
        ]),
        concerns: null,
        enforcement: null,
      },
    ],
  });
}

/**
 * Read a report with advisory enforcement rows preserved for the Home detail panel, because these tests check
 * that the reader keeps enforcement metadata intact and need a report shaped to carry it.
 */
function readAdvisoryEnforcementReport(): ReturnType<
  HelperContext["readDashboardReport"]
> {
  return loadHelpers().readDashboardReport({
    status: "pass",
    target: "/repo",
    overall: { status: "pass" },
    scopes: {
      setup: scope(),
      agent: scope(),
      harness: scope(),
    },
    learningLoop: null,
    recentLessons: [],
    agentScores: [
      {
        id: "claude",
        name: "Claude Code",
        agent: scope(),
        harness: scope(),
        concerns: null,
        enforcement: {
          agent: "claude",
          name: "Claude Code",
          advisory: true,
          summary: {
            hard: 1,
            limited: 0,
            soft: 0,
            missing: 0,
            unknown: 1,
            experimental: 99,
          },
          capabilities: [
            {
              id: "shell-dangerous",
              label: "Dangerous shell commands",
              status: "hard",
              sources: ["local-hook"],
              summary: "Deny mechanism blocks dangerous commands",
              evidence: ["AgentFacts.hooks"],
            },
            {
              id: "file-read-restrictions",
              label: "General file-read restrictions",
              status: "unknown",
              sources: ["not-observed"],
              summary: "Not inferred from secret-path coverage",
              evidence: [],
            },
          ],
        },
      },
    ],
  });
}

/** Read task-state fixture data with every Plans view field populated. */
function readPlansViewTaskState(): ReturnType<HelperContext["readTaskState"]> {
  return loadHelpers().readTaskState({
    taskRoot: "/repo/.goat-flow/plans",
    exists: true,
    active: "current",
    activeExists: true,
    selectedPlan: "current",
    plans: [
      {
        name: "current",
        path: "/repo/.goat-flow/plans/current",
        modifiedAt: "2026-05-15T06:00:00.000Z",
        milestoneCount: 2,
        active: true,
      },
    ],
    milestones: [
      {
        filename: "Milestone-side-menu-navigation.md",
        path: "/repo/.goat-flow/plans/current/Milestone-side-menu-navigation.md",
        title: "Side Menu Navigation and Plans View",
        status: "in-progress",
        objective: "Build the side menu.",
        totalTasks: 13,
        completedTasks: 4,
        modifiedAt: "2026-05-15T06:30:00.000Z",
      },
    ],
  });
}

describe("dashboard payload readers", () => {
  it("narrows supported agents from injected runner metadata", () => {
    const helpers = loadHelpers({
      __GOAT_FLOW_RUNNER_IDS__: ["claude", "codex"],
      __GOAT_FLOW_AGENTS__: [
        supportedAgent("claude"),
        supportedAgent("opencode", {
          name: "OpenCode",
          terminalBinary: "opencode",
          setupSurfaces: ["OPENCODE.md"],
          promptInvocationStyle: "slash",
          skillSource: "agent-mirror",
        }),
        supportedAgent("codex", {
          setupSurfaces: ["AGENTS.md", ".codex/hooks.json"],
        }),
      ],
    });

    assert.equal(helpers.readRunnerId("codex"), "codex");
    assert.equal(helpers.readRunnerId("opencode"), null);

    const agents = helpers.readInjectedSupportedAgents();
    assert.deepEqual(
      agents.map((agent) => agent.id),
      ["claude", "codex"],
    );
    assert.deepEqual(agents[1]?.setupSurfaces, [
      "AGENTS.md",
      ".codex/hooks.json",
    ]);
    assert.equal(agents[1]?.promptInvocationStyle, "dollar");
  });

  it("preserves skipped setup checks so Home totals match the audit API", () => {
    const helpers = loadHelpers();

    const report = helpers.readDashboardReport({
      status: "fail",
      target: "/repo",
      overall: { status: "fail" },
      scopes: {
        setup: {
          status: "fail",
          checks: [
            check("config-parses", "fail", "integrity"),
            check("config-version", "skipped", "integrity", {
              displayStatus: "skipped",
              impact: "none",
            }),
          ],
          failures: [],
          summary: {},
        },
        agent: scope(),
        harness: scope(),
      },
      learningLoop: null,
      recentLessons: [],
      agentScores: [],
    });

    assert.deepEqual(
      report.scopes.setup.checks.map((entry) => entry.status),
      ["fail", "skipped"],
    );
  });

  it("preserves harness check type so metric failures can be shown as non-gating score evidence", () => {
    const report = readHarnessCheckTypesReport();

    const checks = report.agentScores[0]?.harness?.checks ?? [];
    assert.deepEqual(
      checks.map((entry) => entry.type),
      ["integrity", "integrity", "advisory", "metric"],
    );
    assert.deepEqual(
      checks.map((entry) => entry.displayStatus),
      ["pass", "info", "warn", "warn"],
    );
    assert.deepEqual(
      checks.map((entry) => entry.impact),
      ["none", "none", "score-only", "score-only"],
    );
    assert.equal(checks[1]?.assurance, "limited");
    assert.deepEqual(checks[1]?.provenance.framework_evidence_paths, [
      "docs/harness-audit.md",
    ]);
    assert.deepEqual(checks[1]?.provenance.target_evidence_paths, [
      "CLAUDE.md",
    ]);
    assert.equal(checks[2]?.acknowledged, true);
    assert.equal(checks[3]?.evidenceKind, "structural");
    assert.deepEqual(checks[3]?.details, {
      verification: [
        {
          agent: "claude",
          reason: "post-turn hook missing",
        },
      ],
    });

    const score = Math.round(
      (checks.filter((entry) => entry.status === "pass").length /
        checks.length) *
        100,
    );
    const expectedTwoPassesOutOfFourScore = 50;
    assert.equal(score, expectedTwoPassesOutOfFourScore);
  });

  it("preserves advisory enforcement matrix rows", () => {
    const report = readAdvisoryEnforcementReport();

    const enforcement = report.agentScores[0]?.enforcement;
    const expectedCapabilityCount = 2;
    assert.equal(enforcement?.agent, "claude");
    assert.equal(enforcement?.capabilities.length, expectedCapabilityCount);
    assert.equal(enforcement?.capabilities[1]?.status, "unknown");
    assert.deepEqual(enforcement?.capabilities[0]?.sources, ["local-hook"]);
    assert.equal(enforcement?.summary.hard, 1);
    assert.equal(enforcement?.summary.limited, 0);
    assert.equal(enforcement?.summary.soft, 0);
    assert.equal(enforcement?.summary.missing, 0);
    assert.equal(enforcement?.summary.unknown, 1);
    assert.equal(
      Object.hasOwn(enforcement?.summary ?? {}, "experimental"),
      false,
    );
  });

  it("preserves task-state fields used by the Plans view", () => {
    const state = readPlansViewTaskState();

    const expectedMilestoneCount = 2;
    const expectedMilestoneTaskTotal = 13;
    const expectedCompletedTasks = 4;
    assert.equal(state.taskRoot, "/repo/.goat-flow/plans");
    assert.equal(state.active, "current");
    assert.equal(state.activeExists, true);
    assert.equal(state.selectedPlan, "current");
    assert.equal(state.plans[0]?.milestoneCount, expectedMilestoneCount);
    assert.equal(state.plans[0]?.active, true);
    assert.equal(state.milestones[0]?.status, "in-progress");
    assert.equal(state.milestones[0]?.objective, "Build the side menu.");
    assert.equal(state.milestones[0]?.completedTasks, expectedCompletedTasks);
    assert.equal(state.milestones[0]?.totalTasks, expectedMilestoneTaskTotal);
  });

  it("degrades unknown security evidence to inferred", () => {
    const artifact = loadHelpers().readSecurityReviewArtifact({
      resultKind: "goat-flow-security-result",
      contractVersion: "1",
      generatedAt: "2026-06-07T00:00:00.000Z",
      target: { projectPath: "/repo", mode: "diff", agent: "agent" },
      posture: {
        conclusion: "confident",
        rollupBySeverity: { Critical: 0, High: 0, Medium: 0, Low: 1 },
      },
      findings: [
        {
          id: "S-01",
          file: "src/app.ts",
          anchor: "handler",
          title: "Finding",
          body: "Concrete body.",
          severity: "Low",
          confidence: "CONFIRMED",
          proofClass: "STATIC",
          evidence: "MAYBE",
          asset: "asset",
          entry: "entry",
          sink: "sink",
          trustBoundary: "boundary",
          blastRadius: "local",
          source: { tool: "agent", ruleId: null, pillar: "security" },
        },
      ],
      integrity: {
        filesOpened: { opened: 0, total: 0, paths: [] },
        observed: 0,
        inferred: 1,
        degradationFlags: [],
      },
    });

    assert.equal(artifact.findings[0]?.evidence, "INFERRED");
  });

  it("rejects unknown security artifact contract versions", () => {
    assert.throws(
      () =>
        loadHelpers().readSecurityReviewArtifact({
          resultKind: "goat-flow-security-result",
          contractVersion: "2",
        }),
      /invalid contract version/,
    );
  });
});
