/**
 * Prompt, custom-prompt, terminal-upload, and audit fragments of the dashboard Alpine app.
 * dashboardMergeAppFragments later stitches these into one app object. These fragments own the
 * user-authored custom prompt editor, preset browsing/copying, terminal image drops, app init,
 * navigation helpers, and audit refresh actions. Heavy validation and workflow logic lives in
 * shared dashboard helpers; the methods here are thin `this`-bound entry points so Alpine can call
 * them by name.
 */

/** Focus a custom prompt editor field after Alpine renders the editor. */
function dashboardFocusCustomPromptField(id = "custom-prompt-name"): void {
  requestAnimationFrame(() => {
    const field = document.getElementById(id);
    if (field instanceof HTMLElement) field.focus();
  });
}

/** Return image files from a terminal drop event. */
function dashboardDroppedTerminalImageFiles(event: DragEvent): File[] {
  return Array.from(event.dataTransfer?.files ?? []).filter((file) =>
    file.type.startsWith("image/"),
  );
}

/** Return true when a drag event includes at least one image file item. */
function dashboardDragHasImageFiles(event: DragEvent): boolean {
  const items = event.dataTransfer?.items;
  if (!items || items.length === 0) return false;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item?.kind === "file" && item.type.startsWith("image/")) return true;
  }
  return false;
}

/** Reset terminal drag highlight state after a drop or cancelled nested drag. */
function dashboardResetTerminalDragState(ctx: DashboardAppContext): void {
  ctx._terminalDragDepth = 0;
  ctx.terminalDragActive = false;
}

/**
 * Upload dropped terminal images. Fetch/parse/backend failures recover into toasts so a bad upload
 * reports in-view instead of breaking the active terminal session.
 */
async function dashboardUploadTerminalImages(
  ctx: DashboardAppContext,
  files: File[],
): Promise<void> {
  const sessionId = ctx.activeSessionId;
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
    if (error) {
      ctx.showToast(error, true);
      return;
    }
    showTerminalUploadResult(ctx, sessionId, readTerminalUploadResult(payload));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.showToast(msg || "Terminal image upload failed", true);
  } finally {
    ctx.terminalUploading = false;
  }
}

/** Validate and route a terminal image drop to the active session upload path. */
async function dashboardHandleTerminalImageDrop(
  ctx: DashboardAppContext,
  event: DragEvent,
): Promise<void> {
  dashboardResetTerminalDragState(ctx);
  if (!ctx.activeSessionId || ctx.terminalEnded) {
    ctx.showToast("No active terminal session for upload", true);
    return;
  }
  const files = dashboardDroppedTerminalImageFiles(event);
  if (files.length === 0) {
    ctx.showToast(
      "Only image files (.png, .jpg, .webp, .gif) can be dropped here",
      true,
    );
    return;
  }
  await dashboardUploadTerminalImages(ctx, files);
}

/** Build the audit API URL for the selected project and cache policy. */
function dashboardAuditUrl(projectPath: string, includeFresh: boolean): string {
  const freshParam = includeFresh ? "&fresh=true" : "";
  return `/api/audit?path=${encodeURIComponent(projectPath)}&quality=true${freshParam}`;
}

/** Apply a successful audit payload and refresh dependent setup/home state. */
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
  ctx.lastAuditTime = cachedAt ? new Date(cachedAt) : new Date();
  if (includeFresh) {
    ctx.setupOutputs = {};
    ctx._setupOutputProjectPath = ctx.projectPath;
    if (ctx.activeView === "setup") ctx.scheduleSetupPrompt();
  }
  if (ctx.activeView === "home") {
    void ctx.generateHomeQualitySummary();
  }
}

/** Convert audit load failures into the dashboard toast copy users can act on. */
function dashboardShowAuditError(ctx: DashboardAppContext, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  ctx.showToast(
    msg.includes("Failed to fetch")
      ? "Server not running. Start with: goat-flow dashboard ."
      : msg,
    true,
  );
}

/** Refresh installed agents after an audit when the launcher has not loaded them yet. */
function dashboardRefreshAgentsAfterAudit(ctx: DashboardAppContext): void {
  if (ctx.agentsLoaded) return;
  void ctx.fetchInstalledAgents().then((loaded: boolean) => {
    if (!loaded) ctx.agentsLoaded = true;
  });
}

/** Load an audit snapshot and recover network/server failures into toasts. */
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
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const payload = readRecord(await res.json(), "Audit response");
    const error = readErrorMessage(payload);
    if (error) throw new Error(error);
    dashboardApplyAuditPayload(ctx, payload, includeFresh);
  } catch (err) {
    dashboardShowAuditError(ctx, err);
  }
  ctx.auditing = false;
  dashboardRefreshAgentsAfterAudit(ctx);
}

/** Regenerate learning-loop indexes for the selected project, then refresh the Home audit payload. */
async function dashboardRegenerateLearningLoopIndex(
  ctx: DashboardAppContext,
): Promise<void> {
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
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const payload = readRecord(await res.json(), "Index regenerate response");
    const error = readErrorMessage(payload);
    if (error) throw new Error(error);
    if (ctx.projectPath !== requestProjectPath) return;
    await dashboardRunAudit(ctx, true);
    if (!ctx.toastError) ctx.showToast("Learning-loop index regenerated");
  } catch (err) {
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
 * Build the custom-prompt editor fragment: the draft being edited and its open/closed editor flags.
 * One input to dashboardMergeAppFragments; the validation getters that read this draft live in the
 * sibling fragment below, so this fragment must merge before they are evaluated.
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

    /** Toggle a preset favorite state and persist the combined dashboard state. */
    toggleFavorite(id: string) {
      dashboardToggleFavorite(this, id);
    },

    /** Check whether a preset is marked as a favorite. */
    isFavorite(id: string): boolean {
      return dashboardIsFavorite(this, id);
    },

    /** Select a prompt row and show its preview, leaving custom edit mode. */
    selectPreset(preset: Preset) {
      this.selectedPreset = preset;
      this.showCustomPromptEditor = false;
      this.editingCustomPromptId = null;
      this.customPromptSubmitAttempted = false;
      this.showPromptStartPicker = false;
    },

    /** Move the preview selection up (-1) or down (1) in screen order, with wrap. */
    selectPresetByOffset(delta: number) {
      dashboardSelectPresetByOffset(this, delta);
      if (this.selectedPreset) {
        this.showCustomPromptEditor = false;
        this.editingCustomPromptId = null;
        this.customPromptSubmitAttempted = false;
        this.showPromptStartPicker = false;
      }
    },

    /** Return the preset category filters. */
    get presetCats(): PresetCategory[] {
      return dashboardPresetCats(this);
    },

    /** Compact prerequisite/fit badges for a preset row or detail view. */
    presetBadges(preset: Preset): PresetBadge[] {
      return dashboardPresetBadges(preset);
    },

    /** Route chip label for a prompt card or detail view. */
    presetRouteLabel(preset: Preset): string {
      return dashboardPresetRouteLabel(preset);
    },

    /** Left-edge category accent for a prompt card. */
    presetCategoryAccent(preset: Preset): string {
      return dashboardPresetCategoryAccent(preset);
    },

    /** Built-in presets plus local browser custom prompts. */
    get allPresets(): Preset[] {
      return dashboardAllPresets(this);
    },

    /**
     * Favorites stay pinned to the top unless the user explicitly switches into
     * the favorites-only filter, which keeps mixed browsing fast on large lists.
     */
    get filteredPresets(): Preset[] {
      return dashboardFilteredPresets(this);
    },

    /** Presets grouped by category for the Prompts page grouped rendering. */
    get presetsByCategory(): Array<{
      id: string;
      label: string;
      items: Preset[];
    }> {
      return dashboardPresetsByCategory(this);
    },

    /**
     * Unified sequence of entries for the Prompts page list: inserts category
     * headers before each group in grouped mode, falls back to flat rows
     * otherwise. Rendered with a single `template x-for` in prompts.html.
     */
    get renderedPresetEntries(): Array<
      | { kind: "header"; id: string; label: string }
      | { kind: "row"; preset: Preset }
    > {
      return dashboardRenderedPresetEntries(this);
    },

    /**
     * Flat list of preset IDs in screen order for keyboard nav. Uses grouped
     * order when the list is grouped (filter=all + no search); otherwise
     * falls back to filteredPresets order.
     */
    get flatPresetOrder(): string[] {
      return dashboardFlatPresetOrder(this);
    },

    /**
     * Escaped, optionally search-highlighted HTML for the prompt preview.
     * Escapes user-facing content before injecting <mark> tags so the preview
     * stays safe when rendered via x-html.
     */
    get highlightedPromptHtml(): string {
      return dashboardHighlightedPromptHtml(this);
    },

    /** Adapt a preset prompt to the syntax expected by the selected runner. */
    adaptPrompt(prompt: string, runner?: RunnerId): string {
      return dashboardAdaptPrompt(this, prompt, runner);
    },

    /** Copy a preset prompt after applying runner-specific syntax tweaks. */
    copyPreset(prompt: string) {
      dashboardCopyPreset(this, prompt);
    },

    /** Return custom prompt route options with descriptions. */
    customPromptRouteOptions(): CustomPromptRouteOption[] {
      return dashboardCustomPromptRouteOptions();
    },

    /** Return the selected custom prompt route metadata. */
    selectedCustomPromptRoute(): CustomPromptRouteOption {
      return dashboardSelectedCustomPromptRoute(this.customPromptDraft);
    },

    /** Return grouped custom prompt flag metadata. */
    customPromptFlagGroups(): CustomPromptFlagGroup[] {
      return dashboardCustomPromptFlagGroups();
    },

    /** Check whether a custom prompt flag should be disabled. */
    customPromptFlagDisabled(flag: CustomPromptFlagOption): boolean {
      return (
        flag.field === "globalSafe" &&
        this.customPromptDraft.requiresGoatFlowInstall
      );
    },

    /** Keep Global safe false when a prompt requires target goat-flow install. */
    syncCustomPromptFlag(flag: CustomPromptFlagOption) {
      if (
        flag.field === "requiresGoatFlowInstall" &&
        this.customPromptDraft.requiresGoatFlowInstall
      ) {
        this.customPromptDraft.globalSafe = false;
      }
    },

    /** Return validation errors for the current custom prompt draft. */
    customPromptErrors(): CustomPromptValidationError[] {
      return dashboardValidateCustomPromptDraftDetails(this);
    },
  };
}

/**
 * Build the custom-prompt validation fragment: per-field error lookups and draft-validity getters
 * that read the editor draft seeded by the editor-state fragment. Each method delegates to a shared
 * dashboard validation helper rather than inlining the rules, because the same validation must run
 * identically here and on the server, so the branchy logic lives in one shared place and these
 * methods only pass `this` so the helper sees live draft state. Merged by dashboardMergeAppFragments.
 */
function dashboardCustomPromptValidationFragment(): DashboardAppFragment {
  return {
    /** Return the first validation error for one draft field. */
    customPromptFieldError(field: string): string {
      return dashboardCustomPromptFieldError(this, field);
    },

    /** Return non-blocking prompt-body guidance. */
    customPromptWarning(): string {
      return dashboardCustomPromptPromptWarning(this);
    },

    /** Return the current target surface tags. */
    customPromptSurfaceTags(): string[] {
      return dashboardCustomPromptSurfaceTags(this);
    },

    /** Return available target surface suggestions. */
    customPromptSurfaceSuggestions(): string[] {
      return dashboardCustomPromptSurfaceSuggestions(this);
    },

    /** Add a target surface tag. */
    addCustomPromptSurface(surface: string) {
      dashboardAddCustomPromptSurface(this, surface);
    },

    /** Commit the typed target surface tag, if any. */
    commitCustomPromptSurfaceDraft() {
      dashboardAddCustomPromptSurface(
        this,
        this.customPromptSurfaceDraft ?? "",
      );
    },

    /** Remove a target surface tag. */
    removeCustomPromptSurface(surface: string) {
      dashboardRemoveCustomPromptSurface(this, surface);
    },

    /** Return a live preset-shaped preview for the custom prompt draft. */
    customPromptPreview(): Preset {
      return dashboardPreviewCustomPromptPreset(this);
    },

    /** Return preview name text, including an explicit placeholder. */
    customPromptPreviewName(): string {
      return this.customPromptDraft.name.trim() || "Untitled custom prompt";
    },

    /** Return preview description text, including an explicit placeholder. */
    customPromptPreviewDescription(): string {
      return this.customPromptDraft.desc.trim() || "No description yet";
    },
  };
}

/**
 * Build custom-prompt editor actions.
 *
 * These methods open, focus, save, duplicate, and delete the editor draft seeded by
 * dashboardPromptBrowserStateFragment while keeping validation failures focused in-view.
 */
function dashboardCustomPromptEditorActionsFragment(): DashboardAppFragment {
  return {
    /** Focus a custom prompt editor control after Alpine renders it. */
    focusCustomPromptField(id = "custom-prompt-name") {
      const self = this as typeof this & AlpineMagics<typeof this>;
      void self.$nextTick(() => {
        dashboardFocusCustomPromptField(id);
      });
    },

    /** Focus the first invalid custom prompt field. */
    focusFirstCustomPromptError() {
      const first = this.customPromptErrors()[0];
      this.focusCustomPromptField(first?.anchor ?? "custom-prompt-name");
    },

    /** Open a blank custom prompt editor. */
    openNewCustomPrompt() {
      dashboardOpenNewCustomPrompt(this);
      this.showPromptStartPicker = false;
      this.customPromptStartId = "";
      this.focusCustomPromptField();
    },

    /** Edit the currently selected custom prompt. */
    editSelectedCustomPrompt() {
      dashboardOpenEditCustomPrompt(this, this.selectedPreset);
      this.showPromptStartPicker = false;
      this.focusCustomPromptField();
    },

    /** Start a new custom prompt from the selected preset. */
    duplicateSelectedCustomPrompt() {
      dashboardDuplicateCustomPrompt(this, this.selectedPreset);
      this.showPromptStartPicker = false;
      this.customPromptStartId = "";
      this.focusCustomPromptField();
    },

    /** Start a new custom prompt from one selected existing prompt. */
    startCustomPromptFromPreset() {
      dashboardStartCustomPromptFromPresetId(this, this.customPromptStartId);
      this.showPromptStartPicker = false;
      this.customPromptStartId = "";
      this.focusCustomPromptField();
    },

    /** Save the custom prompt editor draft. */
    saveCustomPrompt(): CustomPrompt | null {
      this.customPromptSubmitAttempted = true;
      const saved = dashboardSaveCustomPrompt(this);
      if (!saved) this.focusFirstCustomPromptError();
      return saved;
    },

    /** Save the draft and immediately launch it with the active runner. */
    async saveAndRunCustomPrompt() {
      const saved = this.saveCustomPrompt();
      if (!saved) return;
      const preset = dashboardCustomPromptToPreset(saved);
      await this.launchPreset(preset.prompt, this.activeRunner, preset.name, {
        presetId: preset.id,
      });
    },

    /** Delete the selected custom prompt after confirmation. */
    deleteSelectedCustomPrompt() {
      dashboardDeleteSelectedCustomPrompt(this);
    },

    /** Cancel custom prompt editing without changing persisted prompts. */
    cancelCustomPromptEdit() {
      this.showCustomPromptEditor = false;
      this.editingCustomPromptId = null;
      this.customPromptSubmitAttempted = false;
      this.showPromptStartPicker = false;
    },
  };
}

/** Build quality prompt and active-terminal send actions used by Prompts and Quality views. */
function dashboardQualityPromptActionsFragment(): DashboardAppFragment {
  return {
    /** Return quality-page prompt modes. */
    get qualityModes(): QualityModeOption[] {
      return dashboardQualityModes(this);
    },

    /** Return the selected quality mode option. */
    get selectedQualityModeMeta(): QualityModeOption | null {
      return dashboardSelectedQualityModeMeta(this);
    },

    /** Return the label to use for quality-mode terminal sessions. */
    qualityLaunchLabel(): string {
      return dashboardQualityLaunchLabel(this);
    },

    /** Return the selected setup target's instruction/config surfaces. */
    setupInstructionSurfaces(): string {
      return dashboardSetupInstructionSurfaces(this);
    },

    /** Send text to the active terminal session and focus it. */
    sendToTerminal(
      text: string,
      { adapt = true }: { adapt?: boolean } = {},
    ): boolean {
      return dashboardSendToTerminal(this, text, { adapt });
    },

    /** Send a preset prompt to an active session in the current project. */
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
    handleTerminalDragEnter(event: DragEvent) {
      if (!this._dragHasImageFiles(event)) return;
      if (!this.activeSessionId || this.terminalEnded) return;
      this._terminalDragDepth = Number(this._terminalDragDepth) + 1;
      this.terminalDragActive = true;
    },

    /** Keep image drops routed to the active terminal pane instead of the browser. */
    handleTerminalDragOver(event: DragEvent) {
      if (!this._dragHasImageFiles(event)) return;
      // Setting dropEffect on the dataTransfer is what lets browsers fire `drop`
      // on this pane instead of routing the file to the OS handler.
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    },

    /** Clear terminal drag state when the nested drag counter returns to zero. */
    handleTerminalDragLeave(_dragEvent: DragEvent) {
      this._terminalDragDepth = Math.max(0, this._terminalDragDepth - 1);
      if (this._terminalDragDepth === 0) this.terminalDragActive = false;
    },

    /** Upload dropped image files to the active terminal session. */
    async handleTerminalDrop(event: DragEvent) {
      await dashboardHandleTerminalImageDrop(this, event);
    },

    /** Detect image-file drags before showing the terminal drop target. */
    _dragHasImageFiles(event: DragEvent): boolean {
      return dashboardDragHasImageFiles(event);
    },

    /** Encode and send dropped images to the backend terminal upload route; reports upload errors as toasts. */
    async _uploadTerminalImages(files: File[]) {
      await dashboardUploadTerminalImages(this, files);
    },
  };
}

/** Build dashboard lifecycle, navigation, and audit actions. */
function dashboardAuditAndNavigationActionsFragment(): DashboardAppFragment {
  return {
    // --- Init ---
    /** Register Alpine watchers and swallows lazy terminal warmup errors because init must keep mounting. */
    init() {
      dashboardInit(this as DashboardAlpineContext);
    },

    // -- Navigation --
    comingSoonMeta(view: string): { title: string; desc: string } | null {
      const meta: Record<string, { title: string; desc: string }> = {};
      return meta[view] ?? null;
    },

    /** Return whether a requested dashboard view is still routed to the coming-soon panel. */
    isComingSoonView(view?: string): boolean {
      return this.comingSoonMeta(view ?? this.activeView) !== null;
    },

    /** Toggle and persist the collapsed state of the dashboard side navigation. */
    toggleSideNav() {
      this.sideNavCollapsed = !this.sideNavCollapsed;
      localStorage.setItem(
        "gf-side-nav-collapsed",
        String(this.sideNavCollapsed),
      );
    },

    // -- API Calls --
    /** Load an audit snapshot; reports network/server errors as toasts because the dashboard must stay usable. */
    async runAudit(includeFresh = false) {
      await dashboardRunAudit(this, includeFresh);
    },

    /** Regenerate learning-loop indexes for the selected project and refresh Home. */
    async regenerateLearningLoopIndex() {
      await dashboardRegenerateLearningLoopIndex(this);
    },
  };
}
