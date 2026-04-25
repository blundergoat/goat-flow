/**
 * Unit tests for browser-local custom prompt helpers.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { ScriptTarget, transpileModule } from "typescript";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const CUSTOM_PROMPTS_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "dashboard-custom-prompts.ts",
);

type HelperContext = {
  dashboardDefaultCustomPromptDraft(): Record<string, unknown>;
  dashboardInferPromptRoute(prompt: string): string;
  dashboardOpenNewCustomPrompt(ctx: TestContext): void;
  dashboardOpenEditCustomPrompt(
    ctx: TestContext,
    preset: TestPreset | null,
  ): void;
  dashboardDuplicateCustomPrompt(
    ctx: TestContext,
    preset: TestPreset | null,
  ): void;
  dashboardSaveCustomPrompt(ctx: TestContext): void;
  dashboardDeleteSelectedCustomPrompt(ctx: TestContext): void;
  dashboardLoadCustomPrompts(ctx: TestContext): void;
  dashboardValidateCustomPromptDraft(ctx: TestContext): string[];
  dashboardCustomPromptToPreset(custom: TestCustomPrompt): TestPreset;
};

type TestCustomPrompt = Record<string, unknown> & {
  id: string;
  name: string;
  prompt: string;
};

type TestPreset = Record<string, unknown> & {
  id: string;
  name: string;
  prompt: string;
  source?: string;
};

type TestContext = {
  customPrompts: TestCustomPrompt[];
  customPromptDraft: Record<string, unknown>;
  editingCustomPromptId: string | null;
  showCustomPromptEditor: boolean;
  selectedPreset: TestPreset | null;
  toast: string | null;
  toastError: boolean;
  showToast(msg: string, isError?: boolean): void;
};

function loadHelpers(): {
  helpers: HelperContext;
  storage: Map<string, string>;
} {
  const storage = new Map<string, string>();
  const source = readFileSync(CUSTOM_PROMPTS_PATH, "utf-8");
  const js = transpileModule(source, {
    compilerOptions: { target: ScriptTarget.ES2023 },
  }).outputText;
  const context = createContext({
    Date,
    localStorage: {
      getItem: (key: string): string | null => storage.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        storage.set(key, value);
      },
    },
    window: { confirm: () => true },
    isRecord: (value: unknown): value is Record<string, unknown> =>
      typeof value === "object" && value !== null && !Array.isArray(value),
    readString: (value: unknown, fallback = ""): string =>
      typeof value === "string" ? value : fallback,
    readStringArray: (value: unknown): string[] =>
      Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === "string")
        : [],
  });
  runInContext(
    `${js}
globalThis.__helpers = {
  dashboardDefaultCustomPromptDraft,
  dashboardInferPromptRoute,
  dashboardOpenNewCustomPrompt,
  dashboardOpenEditCustomPrompt,
  dashboardDuplicateCustomPrompt,
  dashboardSaveCustomPrompt,
  dashboardDeleteSelectedCustomPrompt,
  dashboardLoadCustomPrompts,
  dashboardValidateCustomPromptDraft,
  dashboardCustomPromptToPreset,
};`,
    context,
  );
  return {
    helpers: (context as typeof context & { __helpers: HelperContext })
      .__helpers,
    storage,
  };
}

function makeContext(helpers: HelperContext): TestContext {
  const ctx = {
    customPrompts: [],
    customPromptDraft: helpers.dashboardDefaultCustomPromptDraft(),
    editingCustomPromptId: null,
    showCustomPromptEditor: false,
    selectedPreset: null,
    toast: null,
    toastError: false,
    showToast(msg: string, isError?: boolean): void {
      ctx.toast = msg;
      ctx.toastError = isError ?? false;
    },
  };
  return ctx;
}

describe("custom prompt helpers", () => {
  it("infers direct and goat-skill routes without forcing plain text", () => {
    const { helpers } = loadHelpers();
    assert.equal(
      helpers.dashboardInferPromptRoute("Summarize this repo"),
      "direct",
    );
    assert.equal(
      helpers.dashboardInferPromptRoute("/goat-review review this diff"),
      "goat-review",
    );
    assert.equal(
      helpers.dashboardInferPromptRoute("$goat-qa audit coverage"),
      "goat-qa",
    );
  });

  it("saves, loads, edits, duplicates, and deletes custom prompts locally", () => {
    const { helpers } = loadHelpers();
    const ctx = makeContext(helpers);

    helpers.dashboardOpenNewCustomPrompt(ctx);
    ctx.customPromptDraft.name = "Review target";
    ctx.customPromptDraft.desc = "Local custom review";
    ctx.customPromptDraft.prompt = "/goat-review review the selected target";
    ctx.customPromptDraft.route = "goat-review";
    ctx.customPromptDraft.requiresGh = true;
    ctx.customPromptDraft.requiresPrOrIssue = true;
    helpers.dashboardSaveCustomPrompt(ctx);

    assert.equal(ctx.customPrompts.length, 1);
    assert.equal(ctx.selectedPreset?.source, "custom");
    assert.equal(ctx.selectedPreset?.requiresGh, true);
    assert.equal(ctx.toastError, false);

    const saved = ctx.customPrompts[0]!;
    helpers.dashboardOpenEditCustomPrompt(ctx, ctx.selectedPreset);
    ctx.customPromptDraft.name = "Review target deeply";
    ctx.customPromptDraft.prompt = "/goat-review audit uncommitted changes";
    helpers.dashboardSaveCustomPrompt(ctx);
    assert.equal(ctx.customPrompts.length, 1);
    assert.equal(ctx.customPrompts[0]!.id, saved.id);
    assert.equal(ctx.customPrompts[0]!.name, "Review target deeply");

    helpers.dashboardDuplicateCustomPrompt(ctx, ctx.selectedPreset);
    helpers.dashboardSaveCustomPrompt(ctx);
    assert.equal(ctx.customPrompts.length, 2);
    assert.notEqual(ctx.customPrompts[0]!.id, ctx.customPrompts[1]!.id);

    const reloaded = makeContext(helpers);
    helpers.dashboardLoadCustomPrompts(reloaded);
    assert.equal(reloaded.customPrompts.length, 2);

    reloaded.selectedPreset = helpers.dashboardCustomPromptToPreset(
      reloaded.customPrompts[1]!,
    );
    helpers.dashboardDeleteSelectedCustomPrompt(reloaded);
    assert.equal(reloaded.customPrompts.length, 1);
    assert.equal(reloaded.selectedPreset, null);
  });

  it("validates metadata before saving custom prompts", () => {
    const { helpers } = loadHelpers();
    const ctx = makeContext(helpers);
    ctx.customPromptDraft.name = "";
    ctx.customPromptDraft.prompt = "";
    assert.deepEqual(
      Array.from(helpers.dashboardValidateCustomPromptDraft(ctx)),
      ["Name is required.", "Prompt is required."],
    );

    ctx.customPromptDraft.name = "Bad route";
    ctx.customPromptDraft.prompt = "Do a thing";
    ctx.customPromptDraft.route = "unknown-route";
    assert.match(
      helpers.dashboardValidateCustomPromptDraft(ctx).join("\n"),
      /Route must be direct/,
    );

    ctx.customPromptDraft.route = "direct";
    ctx.customPrompts = [
      { id: "custom:dup", name: "A", prompt: "A" },
      { id: "custom:dup", name: "B", prompt: "B" },
    ];
    assert.match(
      helpers.dashboardValidateCustomPromptDraft(ctx).join("\n"),
      /Duplicate custom prompt id/,
    );
  });

  it("preserves custom prompt launch metadata for the shared launcher", () => {
    const { helpers } = loadHelpers();
    const preset = helpers.dashboardCustomPromptToPreset({
      id: "custom:plain",
      name: "Plain note",
      desc: "Plain direct prompt",
      prompt: "Summarize this target without a goat route.",
      route: "direct",
      runnerHint: "any",
      requiresGh: false,
      requiresPrOrIssue: false,
      requiresLocalDiff: false,
      requiresUiApp: false,
      requiresDependencyFiles: false,
      requiresGoatFlowInstall: false,
      mayCheckoutBranch: false,
      requiresCleanWorktree: false,
      mayWriteFiles: false,
      artifactRequired: false,
      globalSafe: true,
      bestTargetSurfaces: ["repo"],
      notes: "Plain-text escape hatch",
      createdAt: "2026-04-25T00:00:00.000Z",
      updatedAt: "2026-04-25T00:00:00.000Z",
    });
    assert.equal(preset.source, "custom");
    assert.equal(preset.route, "direct");
    assert.equal(preset.globalSafe, true);
    assert.equal(preset.fallbackPrompt, "Plain-text escape hatch");
    assert.equal(preset.prompt.startsWith("/goat"), false);
  });
});
