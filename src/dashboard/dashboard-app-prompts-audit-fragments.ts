/**
 * Connect prompt browsing and editing, terminal image drops, navigation, and audit refresh controls to dashboard actions.
 *
 * Merge these fragments into Alpine so controls read the same selected prompt, editor draft, project, and session.
 * Shared helpers own validation and feature behavior; these entry points coordinate loading, focus, and visible feedback.
 */

// Focus a custom prompt editor field after Alpine renders the editor.
function dashboardFocusCustomPromptField(id = "custom-prompt-name"): void {
  requestAnimationFrame(() => {
    const field = document.getElementById(id);
    // Focus only after the requested editor control has appeared, so opening the editor does not target a missing field.
    if (field instanceof HTMLElement) field.focus();
  });
}

// Keep image files from a terminal drop; an empty or non-file drag produces no upload candidates.
function dashboardDroppedTerminalImageFiles(event: DragEvent): File[] {
  return Array.from(event.dataTransfer?.files ?? []).filter((file) =>
    file.type.startsWith("image/"),
  );
}

// Return true when a drag event includes at least one image file item.
function dashboardDragHasImageFiles(event: DragEvent): boolean {
  const items = event.dataTransfer?.items;
  // A drag with no file metadata cannot advertise an image upload target.
  if (!items || items.length === 0) return false;
  // One image in a mixed drag is enough to offer the terminal drop target.
  for (let index = 0; index < items.length; index += 1) {
    const entry = items[index];
    // Text items and absent entries cannot be uploaded as terminal images.
    if (entry?.kind === "file" && entry.type.startsWith("image/")) return true;
  }
  return false;
}

// Reset terminal drag highlight state after a drop or cancelled nested drag.
function dashboardResetTerminalDragState(ctx: DashboardAppContext): void {
  ctx._terminalDragDepth = 0;
  ctx.terminalDragActive = false;
}

// Upload dropped images to the selected terminal; it reports file, network, parsing, and backend failures as toasts.
async function dashboardUploadTerminalImages(
  ctx: DashboardAppContext,
  files: File[],
): Promise<void> {
  const sessionId = ctx.activeSessionId;
  // A closed or unselected session has no backend destination for the dropped images.
  if (!sessionId) return;
  ctx.terminalUploading = true;
  try {
    const encoded = await encodeTerminalUploadFiles(files);
    const res = await dashboardFetch(
      `/api/terminal/${encodeURIComponent(sessionId)}/upload-image`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: encoded }),
      },
    );
    const payload = readRecord(await res.json(), "Terminal upload response");
    const error = readErrorMessage(payload);
    // A rejected upload leaves the terminal running and shows the server's explanation.
    if (error) {
      ctx.showToast(error, true);
      return;
    }
    showTerminalUploadResult(ctx, sessionId, readTerminalUploadResult(payload));
  } catch (err) {
    // An unreadable dropped file, lost server connection, or malformed upload response leaves the terminal usable and reports a toast.
    const msg = err instanceof Error ? err.message : String(err);
    ctx.showToast(msg || "Terminal image upload failed", true);
  } finally {
    ctx.terminalUploading = false;
  }
}

// Validate and route a terminal image drop to the active session upload path.
async function dashboardHandleTerminalImageDrop(
  ctx: DashboardAppContext,
  event: DragEvent,
): Promise<void> {
  dashboardResetTerminalDragState(ctx);
  // Dropping onto an empty or ended terminal needs an explanation before any file data is read.
  if (!ctx.activeSessionId || ctx.terminalEnded) {
    ctx.showToast("No active terminal session for upload", true);
    return;
  }
  const files = dashboardDroppedTerminalImageFiles(event);
  // A drop containing no images cannot be sent through the terminal image endpoint.
  if (files.length === 0) {
    ctx.showToast(
      "Only image files (.png, .jpg, .webp, .gif) can be dropped here",
      true,
    );
    return;
  }
  await dashboardUploadTerminalImages(ctx, files);
}

// Build the audit API URL for the selected project and cache policy.
function dashboardAuditUrl(projectPath: string, includeFresh: boolean): string {
  const freshParam = includeFresh ? "&fresh=true" : "";
  return `/api/audit?path=${encodeURIComponent(projectPath)}&quality=true${freshParam}`;
}

// Apply a successful audit payload and refresh dependent setup/home state.
function dashboardApplyAuditPayload(
  ctx: DashboardAppContext,
  payload: JsonRecord,
  includeFresh: boolean,
): void {
  const cached = payload.cached === true;
  const cachedAt =
    typeof payload.cachedAt === "string" ? payload.cachedAt : null;
  ctx.report = readDashboardReport(payload);
  ctx.auditCached = cached;
  // Cached results retain their original age; responses without a cache timestamp are stamped when displayed.
  ctx.lastAuditTime = cachedAt ? new Date(cachedAt) : new Date();
  // A fresh audit invalidates setup prompts that were composed from earlier project facts.
  if (includeFresh) {
    ctx.setupOutputs = {};
    ctx._setupOutputProjectPath = ctx.projectPath;
    // Regenerate the visible Setup prompt after clearing the stale cache.
    if (ctx.activeView === "setup") ctx.scheduleSetupPrompt();
  }
  // Home refreshes its saved-quality summary alongside the new audit snapshot.
  if (ctx.activeView === "home") {
    void ctx.generateHomeQualitySummary();
  }
}

// Convert audit load failures into the dashboard toast copy users can act on.
function dashboardShowAuditError(ctx: DashboardAppContext, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  ctx.showToast(
    msg.includes("Failed to fetch")
      ? "Server not running. Start with: goat-flow dashboard ."
      : msg,
    true,
  );
}

// Refresh installed agents after an audit when the launcher has not loaded them yet.
function dashboardRefreshAgentsAfterAudit(ctx: DashboardAppContext): void {
  // Completed agent discovery already provides launcher choices and needs no extra request after auditing.
  if (ctx.agentsLoaded) return;
  void ctx.fetchInstalledAgents().then((loaded: boolean) => {
    // Failed discovery ends the first-load skeleton state while leaving the configured runner fallbacks available.
    if (!loaded) ctx.agentsLoaded = true;
  });
}

// Load an audit snapshot and recover network/server failures into toasts.
async function dashboardRunAudit(
  ctx: DashboardAppContext,
  includeFresh = false,
): Promise<void> {
  ctx.auditing = true;
  ctx.toast = "";
  try {
    const res = await dashboardFetch(
      dashboardAuditUrl(ctx.projectPath, includeFresh),
    );
    // An unsuccessful HTTP response cannot replace the displayed audit report.
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const payload = readRecord(await res.json(), "Audit response");
    const error = readErrorMessage(payload);
    // Server audit errors follow the same toast recovery path as request failures.
    if (error) throw new Error(error);
    dashboardApplyAuditPayload(ctx, payload, includeFresh);
  } catch (err) {
    // Stopping the dashboard server or receiving incompatible audit JSON leaves the previous report visible and shows an error toast.
    dashboardShowAuditError(ctx, err);
  }
  ctx.auditing = false;
  dashboardRefreshAgentsAfterAudit(ctx);
}

/**
 * Regenerate the project's learning-loop indexes after the user clicks the Home memory card, then refresh what that card shows.
 * It reports a failed regenerate in the card's own error line rather than throwing, so the rest of Home keeps working.
 *
 * @param ctx - live Alpine dashboard context
 */
async function dashboardRegenerateLearningLoopIndex(
  ctx: DashboardAppContext,
): Promise<void> {
  // Repeated clicks while regeneration runs must not start overlapping index writes.
  if (ctx.indexRegenerating) return;
  const requestProjectPath = ctx.projectPath;
  ctx.indexRegenerating = true;
  ctx.indexRegenerateError = "";
  try {
    const res = await dashboardFetch("/api/index/regenerate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: requestProjectPath }),
    });
    // A rejected regeneration request must not be followed by a success message or refreshed health claim.
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const payload = readRecord(await res.json(), "Index regenerate response");
    const error = readErrorMessage(payload);
    // A reported regeneration failure belongs in the memory card's error state.
    if (error) throw new Error(error);
    // A completed action for the previous project must not refresh the newly selected project's audit.
    if (ctx.projectPath !== requestProjectPath) return;
    await dashboardRunAudit(ctx, true);
    // Keep an audit-refresh error visible instead of covering it with a regeneration success toast.
    if (!ctx.toastError) ctx.showToast("Learning-loop index regenerated");
  } catch (err) {
    // A failed server request or invalid regeneration response reports a card error only for the project that started it.
    if (ctx.projectPath !== requestProjectPath) return;
    const msg = err instanceof Error ? err.message : String(err);
    ctx.indexRegenerateError =
      msg.length > 0 ? msg : "Index regeneration failed";
    ctx.showToast(ctx.indexRegenerateError, true);
  } finally {
    ctx.indexRegenerating = false;
  }
}

/**
 * Seed the prompt editor and browsing state before validation and action fragments read the current draft.
 *
 * @returns the fragment object of custom-prompt editor state fields merged into the Alpine app
 */
function dashboardPromptBrowserStateFragment(): DashboardAppFragment {
  return {
    showCustomPromptEditor: false,

    editingCustomPromptId: null as string | null,

    customPromptDraft: dashboardDefaultCustomPromptDraft(),

    customPromptSurfaceDraft: "",

    customPromptSubmitAttempted: false,

    showPromptStartPicker: false,

    customPromptStartId: "",

    presetFilter: "all",

    presetSearch: "",

    presetFavorites: readStoredStringArray("goat-flow-preset-favorites"),

    // Toggle a preset favorite state and persist the combined dashboard state.
    toggleFavorite(id: string) {
      dashboardToggleFavorite(this, id);
    },

    // Check whether a preset is marked as a favorite.
    isFavorite(id: string): boolean {
      return dashboardIsFavorite(this, id);
    },

    // Select a prompt row and show its preview, leaving custom edit mode.
    selectPreset(preset: Preset) {
      this.selectedPreset = preset;
      this.showCustomPromptEditor = false;
      this.editingCustomPromptId = null;
      this.customPromptSubmitAttempted = false;
      this.showPromptStartPicker = false;
    },

    // Move the preview selection up (-1) or down (1) in screen order, with wrap.
    selectPresetByOffset(delta: number) {
      dashboardSelectPresetByOffset(this, delta);
      // Moving to an available prompt exits editing so the preview follows the keyboard selection.
      if (this.selectedPreset) {
        this.showCustomPromptEditor = false;
        this.editingCustomPromptId = null;
        this.customPromptSubmitAttempted = false;
        this.showPromptStartPicker = false;
      }
    },

    // Return the preset category filters.
    get presetCats(): PresetCategory[] {
      return dashboardPresetCats(this);
    },

    // Compact prerequisite/fit badges for a preset row or detail view.
    presetBadges(preset: Preset): PresetBadge[] {
      return dashboardPresetBadges(preset);
    },

    // Route chip label for a prompt card or detail view.
    presetRouteLabel(preset: Preset): string {
      return dashboardPresetRouteLabel(preset);
    },

    // Left-edge category accent for a prompt card.
    presetCategoryAccent(preset: Preset): string {
      return dashboardPresetCategoryAccent(preset);
    },

    // Built-in presets plus local browser custom prompts.
    get allPresets(): Preset[] {
      return dashboardAllPresets(this);
    },

    // Filter the prompt library; outside search and Favorites-only mode, saved favorites lead the filtered list.
    get filteredPresets(): Preset[] {
      return dashboardFilteredPresets(this);
    },

    // Presets grouped by category for the Prompts page grouped rendering.
    get presetsByCategory(): Array<{
      id: string;
      label: string;
      items: Preset[];
    }> {
      return dashboardPresetsByCategory(this);
    },

    // Render category headers during unfiltered browsing and flat prompt rows during search or category filtering.
    get renderedPresetEntries(): Array<
      | { kind: "header"; id: string; label: string }
      | { kind: "row"; preset: Preset }
    > {
      return dashboardRenderedPresetEntries(this);
    },

    /**
     * Flat list of preset IDs in screen order for keyboard nav.
     * Uses grouped order when the list is grouped (filter=all + no search); otherwise falls back to filteredPresets order.
     */
    get flatPresetOrder(): string[] {
      return dashboardFlatPresetOrder(this);
    },

    // Adapt a preset prompt to the syntax expected by the selected runner.
    adaptPrompt(prompt: string, runner?: RunnerId): string {
      return dashboardAdaptPrompt(this, prompt, runner);
    },

    // Copy a preset prompt after applying runner-specific syntax tweaks.
    copyPreset(prompt: string) {
      dashboardCopyPreset(this, prompt);
    },

    // Return custom prompt route options with descriptions.
    customPromptRouteOptions(): CustomPromptRouteOption[] {
      return dashboardCustomPromptRouteOptions();
    },

    // Return the selected custom prompt route metadata.
    selectedCustomPromptRoute(): CustomPromptRouteOption {
      return dashboardSelectedCustomPromptRoute(this.customPromptDraft);
    },

    // Return grouped custom prompt flag metadata.
    customPromptFlagGroups(): CustomPromptFlagGroup[] {
      return dashboardCustomPromptFlagGroups();
    },

    // Check whether a custom prompt flag should be disabled.
    customPromptFlagDisabled(flag: CustomPromptFlagOption): boolean {
      return (
        flag.field === "globalSafe" &&
        this.customPromptDraft.requiresGoatFlowInstall
      );
    },

    // Keep Global safe false when a prompt requires target goat-flow install.
    syncCustomPromptFlag(flag: CustomPromptFlagOption) {
      // Requiring a target installation makes this prompt unsuitable for the Global safe option.
      if (
        flag.field === "requiresGoatFlowInstall" &&
        this.customPromptDraft.requiresGoatFlowInstall
      ) {
        this.customPromptDraft.globalSafe = false;
      }
    },

    // Return validation errors for the current custom prompt draft.
    customPromptErrors(): CustomPromptValidationError[] {
      return dashboardValidateCustomPromptDraftDetails(this);
    },
  };
}

/**
 * Expose draft errors, target-surface tags, and preview text to the custom prompt editor.
 * Shared validation helpers read the live draft before the user saves or launches it.
 */
function dashboardCustomPromptValidationFragment(): DashboardAppFragment {
  return {
    // Show the first validation message for an editor field; an empty result means that field has no message to display.
    customPromptFieldError(field: string): string {
      return dashboardCustomPromptFieldError(this, field);
    },

    // Show optional prompt-body guidance; an empty result adds no warning and does not block saving.
    customPromptWarning(): string {
      return dashboardCustomPromptPromptWarning(this);
    },

    // Return the current target surface tags.
    customPromptSurfaceTags(): string[] {
      return dashboardCustomPromptSurfaceTags(this);
    },

    // Return available target surface suggestions.
    customPromptSurfaceSuggestions(): string[] {
      return dashboardCustomPromptSurfaceSuggestions(this);
    },

    // Add a target surface tag.
    addCustomPromptSurface(surface: string) {
      dashboardAddCustomPromptSurface(this, surface);
    },

    // Commit the typed target surface tag, if any.
    commitCustomPromptSurfaceDraft() {
      dashboardAddCustomPromptSurface(
        this,
        this.customPromptSurfaceDraft ?? "",
      );
    },

    // Remove a target surface tag.
    removeCustomPromptSurface(surface: string) {
      dashboardRemoveCustomPromptSurface(this, surface);
    },

    // Return a live preset-shaped preview for the custom prompt draft.
    customPromptPreview(): Preset {
      return dashboardPreviewCustomPromptPreset(this);
    },

    // Return preview name text, including an explicit placeholder.
    customPromptPreviewName(): string {
      return this.customPromptDraft.name.trim() || "Untitled custom prompt";
    },

    // Return preview description text, including an explicit placeholder.
    customPromptPreviewDescription(): string {
      return this.customPromptDraft.desc.trim() || "No description yet";
    },
  };
}

// Open, focus, save, duplicate, or delete custom prompts while keeping validation errors attached to the editor draft.
function dashboardCustomPromptEditorActionsFragment(): DashboardAppFragment {
  return {
    // Focus a custom prompt editor control after Alpine renders it.
    focusCustomPromptField(id = "custom-prompt-name") {
      const self = this as typeof this & AlpineMagics<typeof this>;
      void self.$nextTick(() => {
        dashboardFocusCustomPromptField(id);
      });
    },

    // Focus the first invalid custom prompt field.
    focusFirstCustomPromptError() {
      const first = this.customPromptErrors()[0];
      this.focusCustomPromptField(first?.anchor ?? "custom-prompt-name");
    },

    // Open a blank custom prompt editor.
    openNewCustomPrompt() {
      dashboardOpenNewCustomPrompt(this);
      this.showPromptStartPicker = false;
      this.customPromptStartId = "";
      this.focusCustomPromptField();
    },

    // Edit the currently selected custom prompt.
    editSelectedCustomPrompt() {
      dashboardOpenEditCustomPrompt(this, this.selectedPreset);
      this.showPromptStartPicker = false;
      this.focusCustomPromptField();
    },

    // Start a new custom prompt from the selected preset.
    duplicateSelectedCustomPrompt() {
      dashboardDuplicateCustomPrompt(this, this.selectedPreset);
      this.showPromptStartPicker = false;
      this.customPromptStartId = "";
      this.focusCustomPromptField();
    },

    // Start a new custom prompt from one selected existing prompt.
    startCustomPromptFromPreset() {
      dashboardStartCustomPromptFromPresetId(this, this.customPromptStartId);
      this.showPromptStartPicker = false;
      this.customPromptStartId = "";
      this.focusCustomPromptField();
    },

    // Save a valid custom prompt; null keeps the editor open and focuses its first validation error.
    saveCustomPrompt(): CustomPrompt | null {
      this.customPromptSubmitAttempted = true;
      const saved = dashboardSaveCustomPrompt(this);
      // A rejected draft needs focus on its first error before the user can save it.
      if (!saved) this.focusFirstCustomPromptError();
      return saved;
    },

    // Save the draft and immediately launch it with the active runner.
    async saveAndRunCustomPrompt() {
      const saved = this.saveCustomPrompt();
      // Invalid drafts must be corrected before a terminal can launch their prompt.
      if (!saved) return;
      const preset = dashboardCustomPromptToPreset(saved);
      await this.launchPreset(preset.prompt, this.activeRunner, preset.name, {
        presetId: preset.id,
      });
    },

    // Delete the selected custom prompt after confirmation.
    deleteSelectedCustomPrompt() {
      dashboardDeleteSelectedCustomPrompt(this);
    },

    // Cancel custom prompt editing without changing persisted prompts.
    cancelCustomPromptEdit() {
      this.showCustomPromptEditor = false;
      this.editingCustomPromptId = null;
      this.customPromptSubmitAttempted = false;
      this.showPromptStartPicker = false;
    },
  };
}

// Build quality prompt and active-terminal send actions used by Prompts and Quality views.
function dashboardQualityPromptActionsFragment(): DashboardAppFragment {
  return {
    // Return quality-page prompt modes.
    get qualityModes(): QualityModeOption[] {
      return dashboardQualityModes(this);
    },

    // Find metadata for the selected Quality mode; null means its saved mode ID has no matching card.
    get selectedQualityModeMeta(): QualityModeOption | null {
      return dashboardSelectedQualityModeMeta(this);
    },

    // Return the label to use for quality-mode terminal sessions.
    qualityLaunchLabel(): string {
      return dashboardQualityLaunchLabel(this);
    },

    // Return the single project root that owns this mode's quality report.
    qualityReportProjectPath(): string {
      const mode = dashboardSelectedQualityModeMeta(this);
      // An unmatched mode uses the selected project until a valid Quality card identifies its report owner.
      return mode
        ? dashboardQualityReportProjectPath(this, mode)
        : this.projectPath;
    },

    // Return the selected setup target's instruction/config surfaces.
    setupInstructionSurfaces(): string {
      return dashboardSetupInstructionSurfaces(this);
    },

    // Send text to the active terminal session and focus it.
    sendToTerminal(
      text: string,
      { adapt = true }: { adapt?: boolean } = {},
    ): boolean {
      return dashboardSendToTerminal(this, text, { adapt });
    },

    // Send a preset prompt to an active session in the current project.
    async sendToProjectTarget(prompt: string, target: ServerSessionInfo) {
      await dashboardSendToProjectTarget(this, prompt, target);
    },
  };
}

/**
 * Build terminal image upload actions.
 *
 * Drag depth stays in this fragment with upload handling so nested drag events and backend upload
 * fallback behavior are maintained by one terminal-specific surface.
 */
function dashboardTerminalImageUploadFragment(): DashboardAppFragment {
  return {
    // --- Terminal image drag-drop ---
    // Highlight an active terminal as an image drop target, counting nested drag events until the drag leaves.
    handleTerminalDragEnter(event: DragEvent) {
      // Non-image drags keep their normal behavior instead of activating terminal upload feedback.
      if (!this._dragHasImageFiles(event)) return;
      // Ended or unselected sessions cannot accept images, so keep their drop highlight hidden.
      if (!this.activeSessionId || this.terminalEnded) return;
      this._terminalDragDepth = Number(this._terminalDragDepth) + 1;
      this.terminalDragActive = true;
    },

    // Keep image drops routed to the active terminal pane instead of the browser.
    handleTerminalDragOver(event: DragEvent) {
      // Non-image drags keep their normal behavior instead of activating terminal upload feedback.
      if (!this._dragHasImageFiles(event)) return;
      // When drag metadata is available, advertise copying the image into this terminal pane.
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    },

    // Clear terminal drag state when the nested drag counter returns to zero.
    handleTerminalDragLeave(_dragEvent: DragEvent) {
      this._terminalDragDepth = Math.max(0, this._terminalDragDepth - 1);
      // Only leaving the outermost nested drop area removes the highlight; moving between child elements keeps it active.
      if (this._terminalDragDepth === 0) this.terminalDragActive = false;
    },

    // Upload dropped image files to the active terminal session.
    async handleTerminalDrop(event: DragEvent) {
      await dashboardHandleTerminalImageDrop(this, event);
    },

    // Detect image-file drags before showing the terminal drop target.
    _dragHasImageFiles(event: DragEvent): boolean {
      return dashboardDragHasImageFiles(event);
    },

    // Encode and send dropped images to the backend terminal upload route; reports upload errors as toasts.
    async _uploadTerminalImages(files: File[]) {
      await dashboardUploadTerminalImages(this, files);
    },
  };
}

// Build dashboard lifecycle, navigation, and audit actions.
function dashboardAuditAndNavigationActionsFragment(): DashboardAppFragment {
  return {
    // --- Init ---
    // Initialize dashboard watchers and saved state; terminal asset warmup swallows its errors so navigation can still mount.
    init() {
      dashboardInit(this as DashboardAlpineContext);
    },

    // -- Navigation --
    // Toggle and persist the collapsed state of the dashboard side navigation.
    toggleSideNav() {
      this.sideNavCollapsed = !this.sideNavCollapsed;
      localStorage.setItem(
        "gf-side-nav-collapsed",
        String(this.sideNavCollapsed),
      );
    },

    // -- API Calls --
    // Load an audit snapshot; reports network/server errors as toasts because the dashboard must stay usable.
    async runAudit(includeFresh = false) {
      await dashboardRunAudit(this, includeFresh);
    },

    // Regenerate learning-loop indexes for the selected project and refresh Home.
    async regenerateLearningLoopIndex() {
      await dashboardRegenerateLearningLoopIndex(this);
    },
  };
}
