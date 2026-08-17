/**
 * The button and form actions behind the custom-prompt editor: adding surface tags, saving a draft, and removing a saved prompt.
 *
 * A user reaches these by opening Prompts, clicking New or Edit, and filling in the fields the dashboard shows.
 *
 * Each action mutates the Alpine draft in place so the form stays live, then persists only once the user commits the change.
 */
function dashboardCustomPromptSurfaceTags(
  ctx: DashboardCustomPromptsContext,
): string[] {
  return dashboardParseTargetSurfaces(
    ctx.customPromptDraft.bestTargetSurfacesText,
  );
}

function dashboardSetCustomPromptSurfaceTags(
  ctx: DashboardCustomPromptsContext,
  surfaces: string[],
): void {
  ctx.customPromptDraft.bestTargetSurfacesText =
    dashboardJoinTargetSurfaces(surfaces);
}

function dashboardAddCustomPromptSurface(
  ctx: DashboardCustomPromptsContext,
  surface: string,
): void {
  const next = dashboardNormalizeSurfaceTag(surface);
  if (!next) return;
  const tags = dashboardCustomPromptSurfaceTags(ctx);
  if (!tags.includes(next)) {
    dashboardSetCustomPromptSurfaceTags(ctx, [...tags, next]);
  }
  ctx.customPromptSurfaceDraft = "";
}

function dashboardRemoveCustomPromptSurface(
  ctx: DashboardCustomPromptsContext,
  surface: string,
): void {
  const target = dashboardNormalizeSurfaceTag(surface);
  dashboardSetCustomPromptSurfaceTags(
    ctx,
    dashboardCustomPromptSurfaceTags(ctx).filter((tag) => tag !== target),
  );
}

function dashboardCustomPromptSurfaceSuggestions(
  ctx: DashboardCustomPromptsContext,
): string[] {
  const selected = new Set(dashboardCustomPromptSurfaceTags(ctx));
  const seen = new Set<string>();
  const suggestions: string[] = [];
  for (const preset of ctx.allPresets ?? []) {
    for (const surface of preset.bestTargetSurfaces ?? []) {
      const normalized = dashboardNormalizeSurfaceTag(surface);
      if (!normalized || selected.has(normalized) || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      suggestions.push(normalized);
    }
  }
  return suggestions.sort();
}

function dashboardPreviewCustomPromptPreset(
  ctx: DashboardCustomPromptsContext,
): Preset {
  const draft = ctx.customPromptDraft;
  const prompt = draft.prompt.trim();
  const route = CUSTOM_PROMPT_ROUTES.has(draft.route) ? draft.route : "direct";
  const requiresGoatFlowInstall = draft.requiresGoatFlowInstall === true;
  return {
    id: ctx.editingCustomPromptId ?? "custom:preview",
    name: draft.name.trim() || "Untitled custom prompt",
    desc: draft.desc.trim() || draft.notes.trim() || "Custom prompt",
    prompt: prompt || "Write your prompt body...",
    cat: "custom",
    route,
    source: "custom",
    globalSafe: dashboardResolvedGlobalSafe({
      requiresGoatFlowInstall,
      globalSafe: draft.globalSafe,
    }),
    internalOnly: false,
    qualityMode: false,
    requiresGh: draft.requiresGh,
    requiresPrOrIssue: draft.requiresPrOrIssue,
    requiresLocalDiff: draft.requiresLocalDiff,
    requiresUiApp: draft.requiresUiApp,
    requiresDependencyFiles: draft.requiresDependencyFiles,
    requiresGoatFlowInstall,
    mayCheckoutBranch: draft.mayCheckoutBranch,
    requiresCleanWorktree: draft.requiresCleanWorktree,
    mayWriteFiles: draft.mayWriteFiles,
    artifactRequired: draft.artifactRequired,
    bestTargetSurfaces: dashboardCustomPromptSurfaceTags(ctx),
    fallbackPrompt: draft.notes.trim(),
    costTier: "medium",
  };
}

function dashboardOpenNewCustomPrompt(
  ctx: DashboardCustomPromptsContext,
): void {
  ctx.customPromptDraft = dashboardDefaultCustomPromptDraft();
  ctx.customPromptSurfaceDraft = "";
  ctx.customPromptSubmitAttempted = false;
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
  ctx.customPromptSurfaceDraft = "";
  ctx.customPromptSubmitAttempted = false;
  ctx.editingCustomPromptId = custom.id;
  ctx.showCustomPromptEditor = true;
}

function dashboardDuplicateCustomPrompt(
  ctx: DashboardCustomPromptsContext,
  preset: Preset | null,
): void {
  if (!preset) return;
  ctx.customPromptDraft = {
    ...dashboardCustomPromptDraftFromPreset(preset),
    name: `${preset.name} (copy)`,
  };
  ctx.customPromptSurfaceDraft = "";
  ctx.customPromptSubmitAttempted = false;
  ctx.editingCustomPromptId = null;
  ctx.showCustomPromptEditor = true;
}

function dashboardStartCustomPromptFromPresetId(
  ctx: DashboardCustomPromptsContext,
  presetId: string,
): void {
  const preset = (ctx.allPresets ?? []).find((entry) => entry.id === presetId);
  if (!preset) return;
  dashboardDuplicateCustomPrompt(ctx, preset);
}

function dashboardSaveCustomPrompt(
  ctx: DashboardCustomPromptsContext,
): CustomPrompt | null {
  const errors = dashboardValidateCustomPromptDraft(ctx);
  if (errors.length > 0) {
    ctx.showToast(errors[0] ?? "Custom prompt is invalid", true);
    return null;
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
  ctx.customPromptSubmitAttempted = false;
  ctx.showToast(existing ? "Custom prompt updated" : "Custom prompt saved");
  return next;
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
  ctx.customPromptSubmitAttempted = false;
  ctx.showToast("Custom prompt deleted");
}
