/**
 * The button and form actions behind the custom-prompt editor: adding surface tags, saving a draft, and removing a saved prompt.
 *
 * A user reaches these by opening Prompts, clicking New or Edit, and filling in the fields the dashboard shows.
 * Draft edits keep the form live; Save and Delete persist the saved-prompt list in browser storage.
 */

/**
 * Read the surface chips shown on the open custom-prompt draft.
 *
 * @param ctx - editor state; an empty surface field means no chips are selected
 * @returns normalized tags in entry order, or an empty list when the field has no usable tags
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
 * @param surfaces - tags to show in display order; an empty list clears the draft's surface field
 */
function dashboardSetCustomPromptSurfaceTags(
  ctx: DashboardCustomPromptsContext,
  surfaces: string[],
): void {
  ctx.customPromptDraft.bestTargetSurfacesText =
    dashboardJoinTargetSurfaces(surfaces);
}

/**
 * Add a new surface chip and clear the entry box after a nonblank tag is entered.
 *
 * Duplicate tags also clear the entry box; blank input leaves the draft unchanged without a toast.
 *
 * @param ctx - live Alpine custom-prompt context whose draft is edited in place
 * @param surface - raw text from the surface entry box
 */
function dashboardAddCustomPromptSurface(
  ctx: DashboardCustomPromptsContext,
  surface: string,
): void {
  const next = dashboardNormalizeSurfaceTag(surface);
  // A blank entry adds no chip and leaves the entry box untouched.
  if (!next) return;
  const tags = dashboardCustomPromptSurfaceTags(ctx);
  // An existing chip already represents this surface, so only new tags extend the list.
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
 * @returns de-duplicated suggestions in sorted order; empty when no usable, unselected surfaces are available
 */
function dashboardCustomPromptSurfaceSuggestions(
  ctx: DashboardCustomPromptsContext,
): string[] {
  const selected = new Set(dashboardCustomPromptSurfaceTags(ctx));
  const seen = new Set<string>();
  const suggestions: string[] = [];
  // Loaded presets supply suggestions; an unavailable catalog contributes none.
  for (const preset of ctx.allPresets ?? []) {
    // A preset without surface tags adds no suggestions to the editor.
    for (const surface of preset.bestTargetSurfaces ?? []) {
      const normalized = dashboardNormalizeSurfaceTag(surface);
      // Skip blank tags, selected chips, and suggestions already offered by another preset.
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
 * Render the current draft in the preset preview while the user edits it.
 *
 * Empty fields use preview labels, and an unsupported route uses Direct; saving still requires validation.
 *
 * @param ctx - live Alpine custom-prompt context supplying the draft being edited
 * @returns a preset for preview only; it is never added to the saved list
 */
function dashboardPreviewCustomPromptPreset(
  ctx: DashboardCustomPromptsContext,
): Preset {
  const draft = ctx.customPromptDraft;
  const prompt = draft.prompt.trim();
  // Keep the preview route usable while the draft still contains an unsupported value.
  const route = CUSTOM_PROMPT_ROUTES.has(draft.route) ? draft.route : "direct";
  const requiresGoatFlowInstall = draft.requiresGoatFlowInstall === true;
  // New drafts use a preview id; blank title, description, and body fields get labels until the user fills them in.
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
  // Edit applies only to a selected custom prompt; built-in presets remain outside this editor.
  if (!preset?.id.startsWith("custom:")) return;
  const custom = ctx.customPrompts.find((entry) => entry.id === preset.id);
  // The selected prompt is no longer saved, so there is no record to reopen.
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
  // Copy needs a selected preset; an empty selection leaves the current draft alone.
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
  // Before the catalog loads, no preset id can resolve to a draft source.
  const preset = (ctx.allPresets ?? []).find((entry) => entry.id === presetId);
  // A removed or unknown preset cannot supply the copy the user requested.
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
  // Keep the editor open and show the first problem when Save finds an incomplete or conflicting draft.
  if (errors.length > 0) {
    ctx.showToast(errors[0] ?? "Custom prompt is invalid", true);
    return null;
  }
  const editing = ctx.editingCustomPromptId;
  // A null editing id means New or Copy; only an existing saved record is replaced.
  const existing = editing
    ? ctx.customPrompts.find((custom) => custom.id === editing)
    : undefined;
  const next = dashboardBuildCustomPrompt(ctx, existing);
  // Editing preserves the prompt's place in the list; New and Copy append a saved prompt.
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
  // An empty selection or built-in preset cannot be deleted through the custom-prompt controls.
  if (!selected?.id.startsWith("custom:")) return;
  // Cancel keeps the selected prompt and its saved text intact.
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
