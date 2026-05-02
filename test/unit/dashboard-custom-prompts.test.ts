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
  dashboardSaveCustomPrompt(ctx: TestContext): TestCustomPrompt | null;
  dashboardDeleteSelectedCustomPrompt(ctx: TestContext): void;
  dashboardLoadCustomPrompts(ctx: TestContext): void;
  dashboardCustomPromptRouteOptions(): Array<Record<string, unknown>>;
  dashboardCustomPromptFlagGroups(): Array<Record<string, unknown>>;
  dashboardPreviewCustomPromptPreset(ctx: TestContext): TestPreset;
  dashboardCustomPromptSurfaceTags(ctx: TestContext): string[];
  dashboardAddCustomPromptSurface(ctx: TestContext, surface: string): void;
  dashboardRemoveCustomPromptSurface(ctx: TestContext, surface: string): void;
  dashboardValidateCustomPromptDraft(ctx: TestContext): string[];
  dashboardValidateCustomPromptDraftDetails(
    ctx: TestContext,
  ): Array<Record<string, unknown>>;
  dashboardCustomPromptToPreset(custom: TestCustomPrompt): TestPreset;
  dashboardGlobalSafeAllowed(prompt: Record<string, unknown>): boolean;
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
  customPromptSurfaceDraft: string;
  customPromptSubmitAttempted: boolean;
  editingCustomPromptId: string | null;
  showCustomPromptEditor: boolean;
  selectedPreset: TestPreset | null;
  allPresets: TestPreset[];
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
  dashboardCustomPromptRouteOptions,
  dashboardCustomPromptFlagGroups,
  dashboardPreviewCustomPromptPreset,
  dashboardCustomPromptSurfaceTags,
  dashboardAddCustomPromptSurface,
  dashboardRemoveCustomPromptSurface,
  dashboardValidateCustomPromptDraft,
  dashboardValidateCustomPromptDraftDetails,
  dashboardCustomPromptToPreset,
  dashboardGlobalSafeAllowed,
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
    customPromptSurfaceDraft: "",
    customPromptSubmitAttempted: false,
    editingCustomPromptId: null,
    showCustomPromptEditor: false,
    selectedPreset: null,
    allPresets: [],
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

  it("duplicates built-in prompts into editable custom drafts", () => {
    const { helpers } = loadHelpers();
    const ctx = makeContext(helpers);
    const preset = {
      id: "code-review",
      name: "Code Review",
      desc: "Review recent changes",
      prompt: "/goat-review review the diff",
      cat: "review",
      route: "goat-review",
      source: "builtin",
      requiresLocalDiff: true,
      mayWriteFiles: false,
      globalSafe: true,
      bestTargetSurfaces: ["repo", "library"],
      fallbackPrompt: "If no diff exists, ask for one.",
    };

    helpers.dashboardDuplicateCustomPrompt(ctx, preset);

    assert.equal(ctx.showCustomPromptEditor, true);
    assert.equal(ctx.editingCustomPromptId, null);
    assert.equal(ctx.customPromptDraft.name, "Code Review (copy)");
    assert.equal(ctx.customPromptDraft.route, "goat-review");
    assert.equal(ctx.customPromptDraft.requiresLocalDiff, true);
    assert.equal(ctx.customPromptDraft.bestTargetSurfacesText, "repo, library");
    assert.equal(
      ctx.customPromptDraft.notes,
      "If no diff exists, ask for one.",
    );
  });

  it("returns saved custom prompts and validates case-insensitive name uniqueness", () => {
    const { helpers } = loadHelpers();
    const ctx = makeContext(helpers);

    helpers.dashboardOpenNewCustomPrompt(ctx);
    ctx.customPromptDraft.name = "Review target";
    ctx.customPromptDraft.prompt = "/goat-review review the selected target";
    const saved = helpers.dashboardSaveCustomPrompt(ctx);

    assert.equal(saved?.name, "Review target");
    assert.equal(ctx.toastError, false);

    helpers.dashboardOpenNewCustomPrompt(ctx);
    ctx.customPromptDraft.name = "review TARGET";
    ctx.customPromptDraft.prompt = "/goat-review review the selected target";

    assert.deepEqual(
      Array.from(helpers.dashboardValidateCustomPromptDraft(ctx)),
      ["Name already exists."],
    );
    const [firstError] = helpers.dashboardValidateCustomPromptDraftDetails(ctx);
    assert.equal(firstError?.field, "name");
    assert.equal(firstError?.message, "Name already exists.");
    assert.equal(firstError?.anchor, "custom-prompt-name");
  });

  it("manages target surface tags without changing persisted array shape", () => {
    const { helpers } = loadHelpers();
    const ctx = makeContext(helpers);

    helpers.dashboardOpenNewCustomPrompt(ctx);
    ctx.customPromptDraft.bestTargetSurfacesText = "Repo, api, repo";
    helpers.dashboardAddCustomPromptSurface(ctx, " UI App ");
    helpers.dashboardRemoveCustomPromptSurface(ctx, "api");

    assert.deepEqual(
      Array.from(helpers.dashboardCustomPromptSurfaceTags(ctx)),
      ["repo", "ui-app"],
    );

    ctx.customPromptDraft.name = "Surface prompt";
    ctx.customPromptDraft.prompt = "Summarize this target repository.";
    helpers.dashboardSaveCustomPrompt(ctx);

    assert.deepEqual(Array.from(ctx.customPrompts[0]!.bestTargetSurfaces), [
      "repo",
      "ui-app",
    ]);
  });

  it("builds route, flag, and live-preview metadata for the form", () => {
    const { helpers } = loadHelpers();
    const ctx = makeContext(helpers);

    ctx.customPromptDraft.name = "Critique artifact";
    ctx.customPromptDraft.prompt = "/goat-critique review this plan";
    ctx.customPromptDraft.route = "goat-critique";
    ctx.customPromptDraft.artifactRequired = true;

    assert.ok(
      helpers
        .dashboardCustomPromptRouteOptions()
        .some((route) => route.id === "goat-security"),
    );
    assert.deepEqual(
      Array.from(
        helpers.dashboardCustomPromptFlagGroups().map((group) => group.id),
      ),
      ["prerequisites", "permissions", "compatibility"],
    );

    const preview = helpers.dashboardPreviewCustomPromptPreset(ctx);
    assert.equal(preview.name, "Critique artifact");
    assert.equal(preview.route, "goat-critique");
    assert.equal(preview.artifactRequired, true);
    assert.equal(preview.source, "custom");
  });

  it("uses the selected route pill instead of reparsing slash commands", () => {
    const { helpers } = loadHelpers();
    const ctx = makeContext(helpers);

    ctx.customPromptDraft.name = "Direct slash text";
    ctx.customPromptDraft.prompt = "/goat-review pasted as literal text";
    ctx.customPromptDraft.route = "direct";

    const preview = helpers.dashboardPreviewCustomPromptPreset(ctx);
    assert.equal(preview.route, "direct");

    helpers.dashboardSaveCustomPrompt(ctx);
    assert.equal(ctx.customPrompts[0]!.route, "direct");
    assert.equal(ctx.selectedPreset?.route, "direct");
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

  it("prevents GOAT-install custom prompts from being marked global safe", () => {
    const { helpers } = loadHelpers();
    const ctx = makeContext(helpers);

    helpers.dashboardOpenNewCustomPrompt(ctx);
    ctx.customPromptDraft.name = "Target setup audit";
    ctx.customPromptDraft.prompt = "/goat-review audit target goat-flow setup";
    ctx.customPromptDraft.requiresGoatFlowInstall = true;
    ctx.customPromptDraft.globalSafe = true;
    helpers.dashboardSaveCustomPrompt(ctx);

    assert.equal(ctx.customPrompts.length, 1);
    assert.equal(ctx.customPrompts[0]!.requiresGoatFlowInstall, true);
    assert.equal(ctx.customPrompts[0]!.globalSafe, false);
    assert.equal(ctx.selectedPreset?.requiresGoatFlowInstall, true);
    assert.equal(ctx.selectedPreset?.globalSafe, false);
    assert.equal(
      helpers.dashboardGlobalSafeAllowed(ctx.selectedPreset ?? {}),
      false,
    );
  });

  it("round-trips artifact-required custom prompt metadata", () => {
    const { helpers } = loadHelpers();
    const ctx = makeContext(helpers);

    helpers.dashboardOpenNewCustomPrompt(ctx);
    ctx.customPromptDraft.name = "Critique artifact";
    ctx.customPromptDraft.prompt = "/goat-critique review the selected report";
    ctx.customPromptDraft.artifactRequired = true;
    helpers.dashboardSaveCustomPrompt(ctx);

    assert.equal(ctx.customPrompts[0]!.artifactRequired, true);
    assert.equal(ctx.selectedPreset?.artifactRequired, true);

    helpers.dashboardOpenEditCustomPrompt(ctx, ctx.selectedPreset);
    assert.equal(ctx.customPromptDraft.artifactRequired, true);
  });

  it("loads older saved custom prompts with safe metadata defaults", () => {
    const { helpers, storage } = loadHelpers();
    storage.set(
      "goat-flow-custom-prompts",
      JSON.stringify([
        {
          id: "custom:old",
          name: "Old prompt",
          prompt: "Summarize this target",
          route: "direct",
        },
        {
          id: "custom:old-goat",
          name: "Old setup prompt",
          prompt: "/goat-review audit target setup",
          route: "goat-review",
          requiresGoatFlowInstall: true,
          globalSafe: true,
        },
      ]),
    );
    const ctx = makeContext(helpers);

    helpers.dashboardLoadCustomPrompts(ctx);

    assert.equal(ctx.customPrompts.length, 2);
    assert.equal(ctx.customPrompts[0]!.artifactRequired, false);
    assert.equal(ctx.customPrompts[0]!.globalSafe, true);
    assert.equal(ctx.customPrompts[1]!.artifactRequired, false);
    assert.equal(ctx.customPrompts[1]!.globalSafe, false);
  });
});
