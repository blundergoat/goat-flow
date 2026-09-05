/**
 * Exercises the browser-local helpers users reach from the dashboard's Prompts screen.
 * Use when prompt cards, editor validation, routing, persistence, or launch metadata changes.
 *
 * The VM loads the real classic scripts, so tests cover visible form state without opening a browser.
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
const CUSTOM_PROMPTS_ACTIONS_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "dashboard-custom-prompts-actions.ts",
);
const PRESET_PROMPTS_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "preset-prompts.json",
);
const DIRECT_ROUTE_PRESET_CASES = [
  { id: "flow-diagram", deliverableMarker: /```mermaid/u },
  {
    id: "walkthrough-with-testing",
    deliverableMarker: /exactly three sections/iu,
  },
  {
    id: "browser-verify",
    deliverableMarker: /skill-docs\/playbooks\/browser-use\.md/u,
  },
  { id: "page-capture", deliverableMarker: /one MD record per page/iu },
] as const;

/**
 * Browser helper API exposed to the VM fixture with the same names the dashboard calls.
 * Use it to drive New, Edit, Duplicate, Save, Delete, validation, and launch-safety flows as a user would.
 */
type HelperContext = {
  /** Return a fresh browser-local custom prompt draft with default flags. */
  dashboardDefaultCustomPromptDraft(): Record<string, unknown>;
  /** Infer the route style from prompt text before saving a custom prompt. */
  dashboardInferPromptRoute(prompt: string): string;
  /** Open a blank custom-prompt editor in the test context. */
  dashboardOpenNewCustomPrompt(ctx: TestContext): void;
  /** Open the selected custom prompt for editing; null leaves the editor unchanged, as no card was selected. */
  dashboardOpenEditCustomPrompt(
    ctx: TestContext,
    preset: TestPreset | null,
  ): void;
  /** Open a copy of the selected preset; null leaves the editor unchanged, as no card was selected. */
  dashboardDuplicateCustomPrompt(
    ctx: TestContext,
    preset: TestPreset | null,
  ): void;
  /** Save the current draft, or return null when validation keeps the user in the editor. */
  dashboardSaveCustomPrompt(ctx: TestContext): TestCustomPrompt | null;
  /** Delete the selected custom prompt from the mocked custom prompt list. */
  dashboardDeleteSelectedCustomPrompt(ctx: TestContext): void;
  /** Load prompts from mocked browser storage; missing or invalid data leaves the user with an empty custom list. */
  dashboardLoadCustomPrompts(ctx: TestContext): void;
  /** Return route options rendered by the custom prompt editor. */
  dashboardCustomPromptRouteOptions(): Array<Record<string, unknown>>;
  /** Return grouped flag options rendered by the custom prompt editor. */
  dashboardCustomPromptFlagGroups(): Array<Record<string, unknown>>;
  /** Build the preset-shaped preview for the current custom prompt draft. */
  dashboardPreviewCustomPromptPreset(ctx: TestContext): TestPreset;
  /** Return normalized target-surface tags for the current draft; empty means the editor shows no target chips. */
  dashboardCustomPromptSurfaceTags(ctx: TestContext): string[];
  /** Add one target-surface tag to the draft when it is not already present. */
  dashboardAddCustomPromptSurface(ctx: TestContext, surface: string): void;
  /** Remove one target-surface tag from the draft. */
  dashboardRemoveCustomPromptSurface(ctx: TestContext, surface: string): void;
  /** Return user-facing validation messages for the current draft; empty means Save is available. */
  dashboardValidateCustomPromptDraft(ctx: TestContext): string[];
  /** Return one field-linked problem for each invalid value; empty means no field needs correction. */
  dashboardValidateCustomPromptDraftDetails(
    ctx: TestContext,
  ): Array<Record<string, unknown>>;
  /** Convert a saved custom prompt into a preset row for dashboard rendering. */
  dashboardCustomPromptToPreset(custom: TestCustomPrompt): TestPreset;
  /** Decide whether a prompt can be launched safely against external targets. */
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

/**
 * Minimal Alpine state the real helpers mutate while a user works in the custom-prompt editor.
 * Property names intentionally mirror dashboard state so this fixture detects integration drift rather than adapting around it.
 */
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
  /** Capture the message a user sees; an absent error flag means the normal success style. */
  showToast(message: string, isError?: boolean): void;
};

/**
 * Load the dashboard's classic prompt scripts into an isolated browser-like VM.
 * Use when a test needs the same helpers and local storage behavior a user gets from the Prompts screen.
 *
 * @param runnerIds - runners available to the editor; empty means no runner-specific hint is valid
 * @returns callable dashboard helpers plus empty in-memory browser storage
 */
function loadHelpers(
  runnerIds = ["claude", "codex", "antigravity", "copilot"],
): {
  helpers: HelperContext;
  storage: Map<string, string>;
} {
  const storage = new Map<string, string>();
  const source = [
    readFileSync(CUSTOM_PROMPTS_PATH, "utf-8"),
    readFileSync(CUSTOM_PROMPTS_ACTIONS_PATH, "utf-8"),
  ].join("\n");
  const compiled = transpileModule(source, {
    compilerOptions: { target: ScriptTarget.ES2023 },
  }).outputText;
  const context = createContext({
    Date,
    localStorage: {
      // A missing browser-storage key returns null, which makes the dashboard load an empty custom-prompt list.
      getItem: (key: string): string | null => storage.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        storage.set(key, value);
      },
    },
    window: {
      confirm: () => true,
      __GOAT_FLOW_RUNNER_IDS__: runnerIds,
    },
    // Null is not a browser record, so malformed saved values cannot be treated as prompt objects.
    isRecord: (value: unknown): value is Record<string, unknown> =>
      typeof value === "object" && value !== null && !Array.isArray(value),
    // Non-string persisted values become the field's fallback; the default empty value renders a blank input.
    readString: (value: unknown, fallback = ""): string =>
      typeof value === "string" ? value : fallback,
    // Invalid or absent tag collections become an empty list, so the editor displays no target chips.
    readStringArray: (value: unknown): string[] =>
      Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === "string")
        : [],
  });
  runInContext(
    `${compiled}
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

/**
 * Build the blank Alpine state a user gets before opening a custom-prompt editor.
 * Use with the VM helpers so each test starts without saved prompts, a selected card, or a visible toast.
 *
 * @param helpers - loaded dashboard helpers used to create the default draft
 * @returns isolated dashboard state; null selections and empty arrays mean the user has not acted yet
 */
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
    /** Capture the message a user sees; an absent error flag keeps the normal success style. */
    showToast(message: string, isError?: boolean): void {
      ctx.toast = message;
      // Calls without an error flag represent ordinary success feedback in the dashboard.
      ctx.toastError = isError ?? false;
    },
  };
  return ctx;
}

describe("custom prompt helpers", () => {
  it("delegates Coverage Audit scope and output to goat-qa", () => {
    const presets = JSON.parse(
      readFileSync(PRESET_PROMPTS_PATH, "utf-8"),
    ) as Array<Record<string, unknown>>;
    const preset = presets.find((candidate) => candidate.id === "test-audit");

    assert.ok(preset, "missing test-audit preset");
    const prompt = String(preset.prompt);
    assert.equal(preset.route, "goat-qa");
    assert.match(prompt, /^\/goat-qa audit\b/u);
    assert.match(prompt, /skill's Audit Mode scope/u);
    assert.match(prompt, /blocking-gate contract/u);
    assert.doesNotMatch(prompt, /most-changed|Output as a table|File \|/u);
  });

  // Each direct card must keep its promised deliverable without unexpectedly invoking a goat-qa workflow.
  for (const { id, deliverableMarker } of DIRECT_ROUTE_PRESET_CASES) {
    it(`keeps the ${id} catalog workflow on the direct route`, () => {
      const presets = JSON.parse(
        readFileSync(PRESET_PROMPTS_PATH, "utf-8"),
      ) as Array<Record<string, unknown>>;
      const preset = presets.find((candidate) => candidate.id === id);
      assert.ok(preset, `missing ${id} preset`);
      const prompt = String(preset.prompt);
      assert.equal(preset.route, "direct", `${id} route`);
      assert.doesNotMatch(prompt, /(?:^|\s)[/$]goat-qa\b/iu, id);
      assert.match(prompt, deliverableMarker, `${id} deliverable`);
    });
  }

  // Both browser cards must send users through the detected CLI interface instead of assuming one browser-use command shape.
  for (const id of ["browser-verify", "browser-debug"] as const) {
    it(`routes the ${id} preset through the detected CLI interface`, () => {
      const presets = JSON.parse(
        readFileSync(PRESET_PROMPTS_PATH, "utf-8"),
      ) as Array<Record<string, unknown>>;
      const preset = presets.find((candidate) => candidate.id === id);
      assert.ok(preset, `missing ${id} preset`);
      const prompt = String(preset.prompt);
      assert.match(
        prompt,
        /\.goat-flow\/skill-docs\/playbooks\/browser-use\.md/u,
        id,
      );
      assert.match(prompt, /browser-use --help/u, id);
      assert.doesNotMatch(
        prompt,
        /browser-use (?:open|state|screenshot|close)\b/u,
        id,
      );
    });
  }

  it("aligns browser preset fallbacks and write access with their workflows", () => {
    const presets = JSON.parse(
      readFileSync(PRESET_PROMPTS_PATH, "utf-8"),
    ) as Array<Record<string, unknown>>;
    const browserVerify = presets.find(
      (candidate) => candidate.id === "browser-verify",
    );
    const pageCapture = presets.find(
      (candidate) => candidate.id === "page-capture",
    );

    assert.ok(browserVerify, "missing browser-verify preset");
    assert.ok(pageCapture, "missing page-capture preset");
    assert.match(String(browserVerify.fallbackPrompt), /approval/u);
    assert.doesNotMatch(
      String(browserVerify.fallbackPrompt),
      /Install it first/u,
    );
    assert.equal(pageCapture.mayWriteFiles, true);
    assert.equal(pageCapture.artifactRequired, false);
  });

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
    assert.equal(
      helpers.dashboardInferPromptRoute("/goat-clarity uncommitted files"),
      "goat-clarity",
    );
  });

  it("saves, loads, edits, duplicates, and deletes custom prompts locally", () => {
    const { helpers } = loadHelpers();
    const ctx = makeContext(helpers);
    const expectedDuplicatedPromptCount = 2;

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
    assert.equal(ctx.customPrompts.length, expectedDuplicatedPromptCount);
    assert.notEqual(ctx.customPrompts[0]!.id, ctx.customPrompts[1]!.id);

    const reloaded = makeContext(helpers);
    helpers.dashboardLoadCustomPrompts(reloaded);
    assert.equal(reloaded.customPrompts.length, expectedDuplicatedPromptCount);

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
    assert.ok(
      helpers
        .dashboardCustomPromptRouteOptions()
        .some((route) => route.id === "goat-clarity"),
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

  it("validates runner hints from injected runner ids", () => {
    const { helpers } = loadHelpers(["codex"]);
    const ctx = makeContext(helpers);
    ctx.customPromptDraft.name = "Codex prompt";
    ctx.customPromptDraft.prompt = "$goat-review review this diff";
    ctx.customPromptDraft.runnerHint = "codex";
    assert.deepEqual(
      Array.from(helpers.dashboardValidateCustomPromptDraft(ctx)),
      [],
    );

    ctx.customPromptDraft.runnerHint = "claude";
    assert.deepEqual(
      Array.from(helpers.dashboardValidateCustomPromptDraft(ctx)),
      ["Runner hint is invalid."],
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
    // Saving normally selects the new card; the empty fallback forces this safety assertion to fail if selection regresses.
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
    const expectedStoredPromptCount = 2;
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

    assert.equal(ctx.customPrompts.length, expectedStoredPromptCount);
    assert.equal(ctx.customPrompts[0]!.artifactRequired, false);
    assert.equal(ctx.customPrompts[0]!.globalSafe, true);
    assert.equal(ctx.customPrompts[1]!.artifactRequired, false);
    assert.equal(ctx.customPrompts[1]!.globalSafe, false);
  });
});
