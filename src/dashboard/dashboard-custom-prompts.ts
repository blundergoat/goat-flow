/**
 * Custom prompt-library helpers for the dashboard Alpine app.
 * Custom prompts stay browser-local and separate from the built-in JSON catalog.
 */

const CUSTOM_PROMPT_STORAGE_KEY = "goat-flow-custom-prompts";
const CUSTOM_PROMPT_ROUTES = new Set([
  "direct",
  "goat",
  "goat-critique",
  "goat-debug",
  "goat-plan",
  "goat-qa",
  "goat-review",
  "goat-security",
]);

interface DashboardCustomPromptsContext {
  customPrompts: CustomPrompt[];
  customPromptDraft: CustomPromptDraft;
  editingCustomPromptId: string | null;
  showCustomPromptEditor: boolean;
  selectedPreset: Preset | null;
  showToast(msg: string, isError?: boolean): void;
}

function dashboardDefaultCustomPromptDraft(): CustomPromptDraft {
  return {
    name: "",
    desc: "",
    prompt: "",
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
    bestTargetSurfacesText: "repo",
    notes: "",
  };
}

function dashboardInferPromptRoute(prompt: string): string {
  const match = prompt.trim().match(/^(?:\/|\$)(goat(?:-[a-z]+)?)\b/);
  return match?.[1] ?? "direct";
}

function dashboardSlugifyCustomPromptName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "prompt";
}

function dashboardReadBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

function dashboardReadCustomPrompt(value: unknown): CustomPrompt | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const name = readString(value.name).trim();
  const prompt = readString(value.prompt).trim();
  if (!id.startsWith("custom:") || !name || !prompt) return null;
  const route = readString(value.route) || dashboardInferPromptRoute(prompt);
  if (!CUSTOM_PROMPT_ROUTES.has(route)) return null;
  const runnerHintValue = readString(value.runnerHint);
  const runnerHint =
    runnerHintValue === "any" ||
    runnerHintValue === "claude" ||
    runnerHintValue === "codex" ||
    runnerHintValue === "gemini" ||
    runnerHintValue === "copilot"
      ? runnerHintValue
      : "any";
  const now = new Date().toISOString();
  return {
    id,
    name,
    desc: readString(value.desc),
    prompt,
    route,
    runnerHint,
    requiresGh: dashboardReadBoolean(value.requiresGh),
    requiresPrOrIssue: dashboardReadBoolean(value.requiresPrOrIssue),
    requiresLocalDiff: dashboardReadBoolean(value.requiresLocalDiff),
    requiresUiApp: dashboardReadBoolean(value.requiresUiApp),
    requiresDependencyFiles: dashboardReadBoolean(
      value.requiresDependencyFiles,
    ),
    requiresGoatFlowInstall: dashboardReadBoolean(
      value.requiresGoatFlowInstall,
    ),
    mayCheckoutBranch: dashboardReadBoolean(value.mayCheckoutBranch),
    requiresCleanWorktree: dashboardReadBoolean(value.requiresCleanWorktree),
    mayWriteFiles: dashboardReadBoolean(value.mayWriteFiles),
    artifactRequired: dashboardReadBoolean(value.artifactRequired),
    globalSafe: typeof value.globalSafe === "boolean" ? value.globalSafe : true,
    bestTargetSurfaces: readStringArray(value.bestTargetSurfaces),
    notes: readString(value.notes),
    createdAt: readString(value.createdAt) || now,
    updatedAt: readString(value.updatedAt) || now,
  };
}

function dashboardReadCustomPrompts(value: unknown): CustomPrompt[] {
  return Array.isArray(value)
    ? value
        .map((entry) => dashboardReadCustomPrompt(entry))
        .filter((entry): entry is CustomPrompt => entry !== null)
    : [];
}

function dashboardLoadCustomPrompts(ctx: DashboardCustomPromptsContext): void {
  try {
    ctx.customPrompts = dashboardReadCustomPrompts(
      JSON.parse(localStorage.getItem(CUSTOM_PROMPT_STORAGE_KEY) || "[]"),
    );
  } catch {
    ctx.customPrompts = [];
  }
}

function dashboardPersistCustomPrompts(
  ctx: DashboardCustomPromptsContext,
): void {
  localStorage.setItem(
    CUSTOM_PROMPT_STORAGE_KEY,
    JSON.stringify(ctx.customPrompts),
  );
}

function dashboardCustomPromptToPreset(custom: CustomPrompt): Preset {
  return {
    id: custom.id,
    name: custom.name,
    desc: custom.desc || custom.notes || "Custom prompt",
    prompt: custom.prompt,
    cat: "custom",
    route: custom.route,
    source: "custom",
    globalSafe: custom.globalSafe,
    internalOnly: false,
    qualityMode: false,
    requiresGh: custom.requiresGh,
    requiresPrOrIssue: custom.requiresPrOrIssue,
    requiresLocalDiff: custom.requiresLocalDiff,
    requiresUiApp: custom.requiresUiApp,
    requiresDependencyFiles: custom.requiresDependencyFiles,
    requiresGoatFlowInstall: custom.requiresGoatFlowInstall,
    mayCheckoutBranch: custom.mayCheckoutBranch,
    requiresCleanWorktree: custom.requiresCleanWorktree,
    mayWriteFiles: custom.mayWriteFiles,
    artifactRequired: custom.artifactRequired,
    bestTargetSurfaces: custom.bestTargetSurfaces,
    fallbackPrompt: custom.notes,
    costTier: "medium",
  };
}

function dashboardCustomPromptDraftFromCustom(
  custom: CustomPrompt,
): CustomPromptDraft {
  return {
    name: custom.name,
    desc: custom.desc,
    prompt: custom.prompt,
    route: custom.route,
    runnerHint: custom.runnerHint,
    requiresGh: custom.requiresGh,
    requiresPrOrIssue: custom.requiresPrOrIssue,
    requiresLocalDiff: custom.requiresLocalDiff,
    requiresUiApp: custom.requiresUiApp,
    requiresDependencyFiles: custom.requiresDependencyFiles,
    requiresGoatFlowInstall: custom.requiresGoatFlowInstall,
    mayCheckoutBranch: custom.mayCheckoutBranch,
    requiresCleanWorktree: custom.requiresCleanWorktree,
    mayWriteFiles: custom.mayWriteFiles,
    artifactRequired: custom.artifactRequired,
    globalSafe: custom.globalSafe,
    bestTargetSurfacesText: custom.bestTargetSurfaces.join(", "),
    notes: custom.notes,
  };
}

function dashboardValidateCustomPromptDraft(
  ctx: DashboardCustomPromptsContext,
): string[] {
  const draft = ctx.customPromptDraft;
  const errors: string[] = [];
  const name = draft.name.trim();
  const prompt = draft.prompt.trim();
  if (!name) errors.push("Name is required.");
  if (!prompt) errors.push("Prompt is required.");
  const route =
    draft.route === "direct"
      ? dashboardInferPromptRoute(prompt)
      : draft.route || dashboardInferPromptRoute(prompt);
  if (!CUSTOM_PROMPT_ROUTES.has(route)) {
    errors.push("Route must be direct or a known goat skill.");
  }
  if (
    draft.runnerHint !== "any" &&
    !["claude", "codex", "gemini", "copilot"].includes(draft.runnerHint)
  ) {
    errors.push("Runner hint is invalid.");
  }
  const duplicateIds = new Set<string>();
  for (const custom of ctx.customPrompts) {
    if (duplicateIds.has(custom.id)) {
      errors.push(`Duplicate custom prompt id: ${custom.id}`);
      break;
    }
    duplicateIds.add(custom.id);
  }
  const editing = ctx.editingCustomPromptId;
  if (editing && !ctx.customPrompts.some((custom) => custom.id === editing)) {
    errors.push("The custom prompt being edited no longer exists.");
  }
  return errors;
}

function dashboardBuildCustomPrompt(
  ctx: DashboardCustomPromptsContext,
  existing?: CustomPrompt,
): CustomPrompt {
  const draft = ctx.customPromptDraft;
  const now = new Date().toISOString();
  const prompt = draft.prompt.trim();
  const route =
    draft.route === "direct"
      ? dashboardInferPromptRoute(prompt)
      : draft.route || dashboardInferPromptRoute(prompt);
  let id =
    existing?.id ?? `custom:${dashboardSlugifyCustomPromptName(draft.name)}`;
  if (!existing && ctx.customPrompts.some((custom) => custom.id === id)) {
    id += `-${Date.now().toString(36)}`;
  }
  return {
    id,
    name: draft.name.trim(),
    desc: draft.desc.trim(),
    prompt,
    route,
    runnerHint: draft.runnerHint,
    requiresGh: draft.requiresGh,
    requiresPrOrIssue: draft.requiresPrOrIssue,
    requiresLocalDiff: draft.requiresLocalDiff,
    requiresUiApp: draft.requiresUiApp,
    requiresDependencyFiles: draft.requiresDependencyFiles,
    requiresGoatFlowInstall: draft.requiresGoatFlowInstall,
    mayCheckoutBranch: draft.mayCheckoutBranch,
    requiresCleanWorktree: draft.requiresCleanWorktree,
    mayWriteFiles: draft.mayWriteFiles,
    artifactRequired: draft.artifactRequired,
    globalSafe: draft.globalSafe,
    bestTargetSurfaces: draft.bestTargetSurfacesText
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    notes: draft.notes.trim(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

function dashboardOpenNewCustomPrompt(
  ctx: DashboardCustomPromptsContext,
): void {
  ctx.customPromptDraft = dashboardDefaultCustomPromptDraft();
  ctx.editingCustomPromptId = null;
  ctx.showCustomPromptEditor = true;
}

function dashboardOpenEditCustomPrompt(
  ctx: DashboardCustomPromptsContext,
  preset: Preset | null,
): void {
  if (!preset?.id.startsWith("custom:")) return;
  const custom = ctx.customPrompts.find((entry) => entry.id === preset.id);
  if (!custom) return;
  ctx.customPromptDraft = dashboardCustomPromptDraftFromCustom(custom);
  ctx.editingCustomPromptId = custom.id;
  ctx.showCustomPromptEditor = true;
}

function dashboardDuplicateCustomPrompt(
  ctx: DashboardCustomPromptsContext,
  preset: Preset | null,
): void {
  if (!preset?.id.startsWith("custom:")) return;
  const custom = ctx.customPrompts.find((entry) => entry.id === preset.id);
  if (!custom) return;
  ctx.customPromptDraft = {
    ...dashboardCustomPromptDraftFromCustom(custom),
    name: `${custom.name} copy`,
  };
  ctx.editingCustomPromptId = null;
  ctx.showCustomPromptEditor = true;
}

function dashboardSaveCustomPrompt(ctx: DashboardCustomPromptsContext): void {
  const errors = dashboardValidateCustomPromptDraft(ctx);
  if (errors.length > 0) {
    ctx.showToast(errors[0] ?? "Custom prompt is invalid", true);
    return;
  }
  const editing = ctx.editingCustomPromptId;
  const existing = editing
    ? ctx.customPrompts.find((custom) => custom.id === editing)
    : undefined;
  const next = dashboardBuildCustomPrompt(ctx, existing);
  if (existing) {
    ctx.customPrompts = ctx.customPrompts.map((custom) =>
      custom.id === existing.id ? next : custom,
    );
  } else {
    ctx.customPrompts = [...ctx.customPrompts, next];
  }
  dashboardPersistCustomPrompts(ctx);
  ctx.selectedPreset = dashboardCustomPromptToPreset(next);
  ctx.showCustomPromptEditor = false;
  ctx.editingCustomPromptId = null;
  ctx.showToast(existing ? "Custom prompt updated" : "Custom prompt saved");
}

function dashboardDeleteSelectedCustomPrompt(
  ctx: DashboardCustomPromptsContext,
): void {
  const selected = ctx.selectedPreset;
  if (!selected?.id.startsWith("custom:")) return;
  if (!window.confirm(`Delete custom prompt "${selected.name}"?`)) return;
  ctx.customPrompts = ctx.customPrompts.filter(
    (custom) => custom.id !== selected.id,
  );
  dashboardPersistCustomPrompts(ctx);
  ctx.selectedPreset = null;
  ctx.showCustomPromptEditor = false;
  ctx.editingCustomPromptId = null;
  ctx.showToast("Custom prompt deleted");
}
