/**
 * Unit tests for browser-local setup and quality helpers.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { ScriptTarget, transpileModule } from "typescript";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const SETUP_QUALITY_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "dashboard-setup-quality.ts",
);

type TestContext = {
  projectPath: string;
  setupSelectedAgent: string;
  setupGenerating: boolean;
  setupOutputs: Record<string, string>;
  _setupOutputProjectPath: string | null;
  qualityAgent: string;
  selectedQualityModeId: string;
  qualityLoading: boolean;
  qualityResult: unknown;
  qualityCopyLabel: string;
  qualityHistoryLoading: boolean;
  qualityHistoryRows: unknown[];
  qualityHistoryLatest: unknown;
  qualityHistoryWarnings: string[];
  presets: unknown[];
  toast: string | null;
  toastError: boolean;
  showToast(msg: string, isError?: boolean): void;
};

type HelperContext = {
  dashboardGenerateSetupPrompt(
    ctx: TestContext,
    options?: { force?: boolean },
  ): Promise<void>;
  dashboardGenerateQuality(
    ctx: TestContext,
    options?: { fast?: boolean; fresh?: boolean },
  ): Promise<void>;
  dashboardGenerateQualityHistory(ctx: TestContext): Promise<void>;
};

function loadHelpers(fetchImpl: typeof fetch): HelperContext {
  const source = readFileSync(SETUP_QUALITY_PATH, "utf-8");
  const js = transpileModule(source, {
    compilerOptions: { target: ScriptTarget.ES2023 },
  }).outputText;
  const context = createContext({
    fetch: fetchImpl,
    dashboardFetch: fetchImpl,
    setTimeout,
    clearTimeout,
    readRecord(value: unknown): Record<string, unknown> {
      return typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    },
    readErrorMessage(value: Record<string, unknown>): string | null {
      return typeof value.error === "string" ? value.error : null;
    },
    readString(value: unknown): string {
      return typeof value === "string" ? value : "";
    },
    readStringArray(value: unknown): string[] {
      return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === "string")
        : [];
    },
    readQualityHistoryRow(value: unknown): unknown {
      return value;
    },
    readQualityHistoryLatest(value: unknown): unknown {
      return value ?? null;
    },
    readQualityResult(value: unknown): unknown {
      return value;
    },
  });
  runInContext(
    `${js}
globalThis.__helpers = {
  dashboardGenerateSetupPrompt,
  dashboardGenerateQuality,
  dashboardGenerateQualityHistory,
};`,
    context,
  );
  return (context as typeof context & { __helpers: HelperContext }).__helpers;
}

function makeContext(): TestContext {
  return {
    projectPath: "/repo",
    setupSelectedAgent: "claude",
    setupGenerating: false,
    setupOutputs: {},
    _setupOutputProjectPath: null,
    qualityAgent: "claude",
    selectedQualityModeId: "agent-setup",
    qualityLoading: false,
    qualityResult: null,
    qualityCopyLabel: "Copy",
    qualityHistoryLoading: false,
    qualityHistoryRows: [{ date: "old" }],
    qualityHistoryLatest: { date: "old" },
    qualityHistoryWarnings: ["old warning"],
    presets: [],
    toast: null,
    toastError: false,
    showToast(msg: string, isError = false): void {
      this.toast = msg;
      this.toastError = isError;
    },
  };
}

describe("dashboardGenerateSetupPrompt", () => {
  it("clears cached setup prompts when the project path changes", async () => {
    const helpers = loadHelpers(
      async () =>
        new Response(JSON.stringify({ output: "fresh setup output" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const ctx = makeContext();
    ctx.setupOutputs = { claude: "stale setup output", codex: "other stale" };
    ctx._setupOutputProjectPath = "/old-repo";

    await helpers.dashboardGenerateSetupPrompt(ctx);

    assert.deepEqual(Object.keys(ctx.setupOutputs), ["claude"]);
    assert.equal(ctx.setupOutputs.claude, "fresh setup output");
    assert.equal(ctx._setupOutputProjectPath, "/repo");
    assert.equal(ctx.setupGenerating, false);
  });
});

describe("dashboardGenerateQuality", () => {
  it("uses the fast quality endpoint for automatic page loads", async () => {
    let requested = "";
    const helpers = loadHelpers(async (input: RequestInfo | URL) => {
      requested = String(input);
      return new Response(
        JSON.stringify({
          command: "quality",
          agent: "claude",
          auditStatus: "unavailable",
          auditSummary: "cache-only",
          prompt: "fast quality prompt",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    const ctx = makeContext();

    await helpers.dashboardGenerateQuality(ctx, { fast: true });

    assert.match(requested, /[?&]fast=true(?:&|$)/);
    assert.doesNotMatch(requested, /[?&]fresh=true(?:&|$)/);
    assert.deepEqual(ctx.qualityResult, {
      command: "quality",
      agent: "claude",
      auditStatus: "unavailable",
      auditSummary: "cache-only",
      prompt: "fast quality prompt",
    });
    assert.equal(ctx.qualityLoading, false);
  });

  it("requests a fresh audit for explicit quality regeneration", async () => {
    let requested = "";
    const helpers = loadHelpers(async (input: RequestInfo | URL) => {
      requested = String(input);
      return new Response(
        JSON.stringify({
          command: "quality",
          agent: "claude",
          auditStatus: "fail",
          auditSummary: "fresh audit",
          prompt: "fresh quality prompt",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    const ctx = makeContext();

    await helpers.dashboardGenerateQuality(ctx, { fresh: true });

    assert.match(requested, /[?&]fresh=true(?:&|$)/);
    assert.doesNotMatch(requested, /[?&]fast=true(?:&|$)/);
    assert.deepEqual(ctx.qualityResult, {
      command: "quality",
      agent: "claude",
      auditStatus: "fail",
      auditSummary: "fresh audit",
      prompt: "fresh quality prompt",
    });
    assert.equal(ctx.qualityLoading, false);
  });
});

describe("dashboardGenerateQualityHistory", () => {
  it("clears stale history when the history endpoint returns an error", async () => {
    const helpers = loadHelpers(
      async () =>
        new Response(JSON.stringify({ error: "history failed" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    );
    const ctx = makeContext();

    await helpers.dashboardGenerateQualityHistory(ctx);

    assert.equal(ctx.qualityHistoryRows.length, 0);
    assert.equal(ctx.qualityHistoryLatest, null);
    assert.equal(ctx.qualityHistoryWarnings.length, 0);
    assert.equal(ctx.qualityHistoryLoading, false);
    assert.equal(ctx.toast, "history failed");
    assert.equal(ctx.toastError, true);
  });
});
