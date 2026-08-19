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

/**
 * Replace the surface tags on the open draft, keeping the text field the user sees in the editor in step with the tag chips.
 *
 * @param ctx - live Alpine custom-prompt context whose draft is edited in place
 * @param surfaces - tags to show, in the order the user should see them
 */
function dashboardSetCustomPromptSurfaceTags(
  ctx: DashboardCustomPromptsContext,
  surfaces: string[],
): void {
  ctx.customPromptDraft.bestTargetSurfacesText =
    dashboardJoinTargetSurfaces(surfaces);
}

/**
 * Add the tag the user just typed and clear the entry box, so they can keep typing the next one.
 *
 * A blank or duplicate entry is dropped silently: the tag is already on screen, and an error toast for it would interrupt fast entry.
 *
 * @param ctx - live Alpine custom-prompt context whose draft is edited in place
 * @param surface - raw text from the surface entry box
 */
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

/**
 * Drop one tag when the user clicks its remove control; an unknown tag leaves the list unchanged.
 *
 * @param ctx - live Alpine custom-prompt context whose draft is edited in place
 * @param surface - tag text from the chip the user dismissed
 */
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

/**
 * Offer the surfaces other presets already use, minus the ones this draft carries, as one-click suggestions.
 *
 * The result is sorted so repeated opens of the editor show a stable order rather than preset-file order.
 *
 * @param ctx - live Alpine custom-prompt context supplying the draft and the loaded preset list
 * @returns de-duplicated suggestions in sorted order; empty when every known surface is already selected
 */
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

/**
 * Turn the in-progress draft into a preset shaped exactly like a saved one, so the preview pane renders what saving would produce.
 *
 * Empty fields fall back to visible placeholder copy instead of blanks, because a half-filled preview is harder to read than a labelled one.
 *
 * @param ctx - live Alpine custom-prompt context supplying the draft being edited
 * @returns a preset for preview only; it is never added to the saved list
 */
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

/**
 * Open the editor on an empty draft after the user clicks New.
 *
 * @param ctx - live Alpine custom-prompt context reset to a blank draft in place
 */
function dashboardOpenNewCustomPrompt(
  ctx: DashboardCustomPromptsContext,
): void {
  ctx.customPromptDraft = dashboardDefaultCustomPromptDraft();
  ctx.customPromptSurfaceDraft = "";
  ctx.customPromptSubmitAttempted = false;
  ctx.editingCustomPromptId = null;
  ctx.showCustomPromptEditor = true;
}

/**
 * Open the editor on an existing custom prompt after the user clicks Edit.
 *
 * Built-in presets and prompts that are no longer in the saved list are ignored, so a stale selection cannot open an editor with nothing behind it.
 *
 * @param ctx - live Alpine custom-prompt context loaded with the saved prompt in place
 * @param preset - preset the user selected; null or non-custom selections do nothing
 */
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

/**
 * Open the editor on a copy of any preset, named with a copy suffix so the user can tell the two apart in the list.
 *
 * The copy is unsaved until the user clicks Save, and it never carries the source id, so duplicating a built-in preset cannot overwrite it.
 *
 * @param ctx - live Alpine custom-prompt context loaded with the copied draft in place
 * @param preset - preset to copy; null does nothing
 */
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

/**
 * Start a copy from a preset id, for entry points that hold an id rather than the loaded preset.
 *
 * @param ctx - live Alpine custom-prompt context loaded with the copied draft in place
 * @param presetId - id to look up in the loaded preset list; an unknown id does nothing
 */
function dashboardStartCustomPromptFromPresetId(
  ctx: DashboardCustomPromptsContext,
  presetId: string,
): void {
  const preset = (ctx.allPresets ?? []).find((entry) => entry.id === presetId);
  if (!preset) return;
  dashboardDuplicateCustomPrompt(ctx, preset);
}

/**
 * Save the open draft, then close the editor and select the saved prompt so the user sees the result of their click.
 *
 * An invalid draft reports the first validation message as an error toast and leaves the editor open with the input intact.
 *
 * @param ctx - live Alpine custom-prompt context whose saved-prompt list and selection are updated in place
 * @returns the saved prompt, or null when validation rejected the draft
 */
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

/**
 * Delete the selected custom prompt after the user confirms the browser prompt, then clear the selection.
 *
 * Built-in presets are skipped: only prompts the user created can be removed here.
 *
 * @param ctx - live Alpine custom-prompt context whose saved-prompt list and selection are updated in place
 */
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
