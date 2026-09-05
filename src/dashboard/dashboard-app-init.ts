/**
 * Connect dashboard navigation and keyboard actions to the loaders and terminal controls they need.
 *
 * Register these watchers once at startup so switching project refreshes the visible panels and terminal layout.
 * Feature modules perform the requested work; this file decides when user navigation should trigger it.
 */

type DashboardAlpineContext = DashboardAppContext &
  AlpineMagics<DashboardAppContext>;

/**
 * Refit one terminal to its panel and tell the server the new size, so wrapped output matches what the user sees.
 *
 * @param sessionId - session whose panel is being resized
 * @param refs - live socket references for that session
 * @param xterm - terminal instance to refit
 * @returns true when the resize applied; false means the panel is hidden and the caller should try again later
 */
function dashboardResizeTerminalRef(
  sessionId: string,
  refs: TerminalRefs,
  xterm: XTermInstance,
): boolean {
  const container = document.getElementById(`gf-terminal-${sessionId}`);
  // The panel is not on screen yet, so measuring it now would size the terminal to zero columns.
  if (!container || container.offsetWidth === 0) return false;
  xterm._addonFit?.fit();
  // Only a live socket can carry the new size; a reconnect sends it again on open.
  if (refs.ws?.readyState === WebSocket.OPEN) {
    refs.ws.send(
      JSON.stringify({ type: "resize", cols: xterm.cols, rows: xterm.rows }),
    );
  }
  return true;
}

// Whether entering this view should warm xterm assets before a terminal is attached.
function dashboardShouldWarmXterm(
  ctx: DashboardAlpineContext,
  view: string,
): boolean {
  return (view === "workspace" || view === "setup") && ctx.terminalAvailable;
}

/**
 * Start loading the terminal engine in the background when the user moves toward a view that will need it.
 * It swallows a failed warmup, because the terminal overlay reports the real failure when the user actually opens a session.
 *
 * @param ctx - live Alpine dashboard context
 * @param view - view the user is switching to
 */
function dashboardWarmXtermForView(
  ctx: DashboardAlpineContext,
  view: string,
): void {
  // Only views that can open terminals need these assets; other navigation can stay lightweight.
  if (!dashboardShouldWarmXterm(ctx, view)) return;
  // A failed terminal-asset download must not stop view navigation; opening a session provides the visible loading error.
  void ctx.loadXterm().catch(() => {});
}

// Find the resize-ready terminal; null means the newly opened panel must wait for terminal initialization.
function dashboardRefitCapableXterm(
  refs: TerminalRefs | undefined,
): XTermInstance | null {
  const xterm = refs?.xterm;
  // A missing terminal or fit addon means its panel cannot be measured yet.
  return xterm?._addonFit ? xterm : null;
}

// Send the current xterm dimensions over an open backend WebSocket.
function dashboardSendTerminalResize(
  socket: WebSocket | undefined,
  xterm: XTermInstance,
): void {
  // A disconnected terminal cannot receive dimensions; its reconnect path will send the current size.
  if (socket?.readyState !== WebSocket.OPEN) return;
  socket.send(
    JSON.stringify({
      type: "resize",
      cols: xterm.cols,
      rows: xterm.rows,
    }),
  );
}

// Fit a terminal and notify the backend of its new dimensions.
function dashboardFitTerminalWithResize(
  xterm: XTermInstance,
  socket: WebSocket | undefined,
): void {
  xterm._addonFit?.fit();
  dashboardSendTerminalResize(socket, xterm);
}

// Retry active-view refits until the freshly-shown terminal container has layout width.
function dashboardPollActiveTerminalRefit(
  ctx: DashboardAlpineContext,
  refs: TerminalRefs,
  xterm: XTermInstance,
  attempts = 0,
): void {
  // A panel that stays hidden must not keep scheduling resize work indefinitely.
  if (attempts > TERMINAL_REFIT_MAX_ATTEMPTS) return;
  requestAnimationFrame(() => {
    // A tab opened before browser layout has width needs another frame before its output can wrap correctly.
    if (!dashboardResizeTerminalRef(ctx.activeSessionId ?? "", refs, xterm)) {
      setTimeout(() => {
        dashboardPollActiveTerminalRefit(ctx, refs, xterm, attempts + 1);
      }, TERMINAL_REFIT_RETRY_DELAY_MS);
    }
  });
}

// Refit the active terminal after the workspace view becomes visible.
function dashboardRefitWorkspaceViewTerminal(
  ctx: DashboardAlpineContext,
  view: string,
): void {
  // Only an open workspace with a selected session has a terminal panel to restore.
  if (view !== "workspace" || !ctx.activeSessionId) return;
  const refs = ctx._terminalRefs[ctx.activeSessionId];
  const xterm = dashboardRefitCapableXterm(refs);
  // A tab still creating its terminal has no resize-ready instance; its initialization path will fit it when ready.
  if (!refs || !xterm) return;
  void ctx.$nextTick(() => {
    dashboardPollActiveTerminalRefit(ctx, refs, xterm);
  });
}

// Refit the active terminal when the workspace panel switches back to the terminal tab.
function dashboardRefitWorkspacePanelTerminal(
  ctx: DashboardAlpineContext,
  view: string,
): void {
  const xterm = ctx._terminalXterm;
  // Switching to another panel, or opening one before xterm is ready, leaves the current terminal dimensions alone.
  if (view !== "terminal" || !xterm?._addonFit) return;
  requestAnimationFrame(() => {
    dashboardFitTerminalWithResize(xterm, ctx._terminalWs);
  });
}

// Refit and focus a newly selected terminal tab after Alpine has rendered it.
function dashboardRefitSelectedTerminal(
  ctx: DashboardAlpineContext,
  id: string | null,
): void {
  // Closing the last session clears selection, so there is no terminal to focus.
  if (!id) return;
  const refs = ctx._terminalRefs[id];
  const xterm = dashboardRefitCapableXterm(refs);
  // A tab still creating its terminal has no resize-ready instance; its initialization path will fit it when ready.
  if (!refs || !xterm) return;
  void ctx.$nextTick(() => {
    requestAnimationFrame(() => {
      dashboardFitTerminalWithResize(xterm, refs.ws);
      xterm.focus();
    });
  });
}

/**
 * Clear skill inventory and reports when the user changes project or runner.
 * Abort the selected report request and advance the prefetch generation so earlier results cannot repopulate the new selection.
 */
function dashboardResetSkillQualityState(ctx: DashboardAppContext): void {
  ctx.skillQualityAbortController?.abort();
  ctx.skillQualityAbortController = null;
  ctx.skillQualityArtifacts = [];
  ctx.skillQualitySelectedId = null;
  ctx.skillQualityReport = null;
  ctx.skillQualityLoading = false;
  ctx.skillQualityReports = {};
  ctx.skillQualityAuditedAt = null;
  ctx.skillQualityPrefetching = false;
  ctx.skillQualityPrefetchGeneration =
    Number(ctx.skillQualityPrefetchGeneration) + 1;
}

/**
 * Keep terminal size and focus aligned with the workspace panel or session the user selects.
 *
 * Wait for browser layout before measuring newly visible panels, then send their dimensions to the backend.
 * Asset warmup swallows load failures so navigation remains usable; opening the terminal reports the failure through its own overlay.
 */
function dashboardRegisterTerminalWatchers(ctx: DashboardAlpineContext): void {
  ctx.$watch("activeView", (view: string) => {
    dashboardWarmXtermForView(ctx, view);
    dashboardRefitWorkspaceViewTerminal(ctx, view);
  });
  ctx.$watch("workspacePanel", (view: string) => {
    dashboardRefitWorkspacePanelTerminal(ctx, view);
  });
  ctx.$watch("activeSessionId", (id: string | null) => {
    dashboardRefitSelectedTerminal(ctx, id);
  });
}

/**
 * Load each view's data when the user opens it, and refresh Quality when its filters change.
 * The workspace polls session counts every 10 seconds while visible; every view change stops the previous poll.
 */
function dashboardRegisterViewWatchers(ctx: DashboardAlpineContext): void {
  ctx.$watch("activeView", (view: string) => {
    // Leaving or reopening Workspace ends its previous poll before a new view can start one.
    if (ctx._workspacePoll) {
      clearInterval(ctx._workspacePoll);
      ctx._workspacePoll = null;
    }
    // These views show session availability, so entering them refreshes the server count.
    if (["home", "projects", "workspace", "prompts"].includes(view)) {
      void ctx.updateSessionCount();
    }
    // Home needs the latest saved review for its quality summary.
    if (view === "home") void ctx.generateHomeQualitySummary();
    // While Workspace is visible, include sessions opened or ended outside this browser tab.
    if (view === "workspace") {
      ctx._workspacePoll = setInterval(() => {
        void ctx.updateSessionCount();
      }, 10_000);
    }
    // Opening Quality refreshes its prompt and schedules saved reviews after the first paint.
    if (view === "quality") {
      void ctx.generateQuality({ fast: true });
      ctx.scheduleQualityHistory();
    }
    // Opening Skills discovers the current project and runner artifacts before showing their reports.
    if (view === "skills") void ctx.loadSkillQualityInventory();
    // Setup needs detected project facts before it can prepare the installation prompt.
    if (view === "setup") {
      void ctx.detectStack();
      ctx.scheduleSetupPrompt();
    }
    // Plans reads the selected project when its view opens so milestones reflect the current workspace.
    if (view === "plans") void ctx.loadTasks();
    // Hooks loads current installed settings when the user opens its controls.
    if (view === "hooks") void ctx.loadHooks();
  });
  ctx.$watch("qualityAgent", () => {
    // Changing the Quality runner refreshes only that visible review view.
    if (ctx.activeView === "quality") {
      void ctx.generateQuality({ fast: true });
      ctx.scheduleQualityHistory();
    }
  });
  ctx.$watch("selectedQualityModeId", () => {
    // A different assessment mode needs its own prompt and history while Quality is open.
    if (ctx.activeView === "quality") {
      void ctx.generateQuality({ fast: true });
      ctx.scheduleQualityHistory();
    }
  });
}

/**
 * Register the watchers that keep the page in step when the user switches runner or project.
 * Without these, changing project would leave the previous project's summaries and skill lists on screen.
 *
 * @param ctx - live Alpine dashboard context whose watchers are registered in place
 */
function dashboardRegisterRunnerAndProjectWatchers(
  ctx: DashboardAlpineContext,
): void {
  ctx.$watch("activeRunner", () => {
    // Home summaries follow the newly selected runner.
    if (ctx.activeView === "home") void ctx.generateHomeQualitySummary();
    // A runner switch changes which installed skill artifacts and reports belong in the sidebar.
    if (ctx.activeView === "skills") {
      dashboardResetSkillQualityState(ctx);
      void ctx.loadSkillQualityInventory();
    }
  });
  ctx.$watch("sessionsCollapsed", (value: boolean) => {
    localStorage.setItem("gf-sessions-collapsed", String(value));
  });
  // Keep the browser tab title on the selected project so multiple open dashboards can be distinguished.
  const updateTitle = (): void => {
    document.title = `${ctx.projectName} | GOAT Flow`;
  };
  ctx.$watch("projectPath", (newPath: string, oldPath: string) => {
    updateTitle();
    // Initial selection and unchanged paths need no terminal detach or second round of project fetches.
    if (!oldPath || newPath === oldPath) return;
    ctx.detachTerminal(oldPath);
    void ctx.reconnectTerminal();
    void ctx.updateSessionCount();
    // A project switch invalidates the Quality prompt and saved-review list on screen.
    if (ctx.activeView === "quality") {
      void ctx.generateQuality({ fast: true });
      ctx.scheduleQualityHistory();
    }
    // Setup must detect the new project before showing an installation prompt for it.
    if (ctx.activeView === "setup") {
      void ctx.detectStack();
      ctx.scheduleSetupPrompt();
    }
    // Home must replace the previous project review with the newly selected project summary.
    if (ctx.activeView === "home") void ctx.generateHomeQualitySummary();
    // A plan selection from another project cannot identify the new project milestones.
    if (ctx.activeView === "plans") {
      ctx.selectedTaskPlan = null;
      void ctx.loadTasks();
    }
    // The hook controls must reflect the new project settings.
    if (ctx.activeView === "hooks") void ctx.loadHooks();
    dashboardResetSkillQualityState(ctx);
    // Only the visible Skills view needs an immediate inventory reload after the reset.
    if (ctx.activeView === "skills") void ctx.loadSkillQualityInventory();
  });
  updateTitle();
}

/**
 * Handle the keyboard shortcuts that work anywhere in the dashboard, before any view-specific handler sees the key.
 *
 * @param ctx - live Alpine dashboard context
 * @param event - the key the user pressed
 * @returns true when the shortcut was handled and no other handler should act on it
 */
function dashboardHandleGlobalShortcut(
  ctx: DashboardAlpineContext,
  event: KeyboardEvent,
): boolean {
  // Escape always closes the directory picker, wherever the user opened it from.
  if (event.key === "Escape") ctx.showBrowser = false;
  // Ctrl+Shift+D ends the active workspace terminal without requiring the session menu.
  if (
    event.key === "D" &&
    event.ctrlKey &&
    event.shiftKey &&
    ctx.activeView === "workspace" &&
    ctx.terminalSessionId
  ) {
    event.preventDefault();
    ctx.exitTerminal();
    return true;
  }
  // Slash opens prompt search when the user is not entering text into a form field.
  if (
    event.key === "/" &&
    !["INPUT", "TEXTAREA", "SELECT"].includes(
      document.activeElement?.tagName ?? "",
    )
  ) {
    // A running terminal owns slash input, including agent commands, so dashboard search must not take it.
    if (
      ctx.activeView === "workspace" &&
      ctx.terminalSessionId &&
      !ctx.terminalEnded
    ) {
      return true;
    }
    event.preventDefault();
    ctx.activeView = "prompts";
    void ctx.$nextTick(() => {
      const searchInput = ctx.$refs.presetSearchInput;
      // Focus search only after its input exists in the newly opened Prompts view.
      if (searchInput instanceof HTMLInputElement) searchInput.focus();
    });
    return true;
  }
  return false;
}

/**
 * Move through prompts with the arrow keys and launch the selected prompt with Enter.
 * Enter requires a selection, no pending launch, and room below the session limit so a held key cannot queue extra terminals.
 *
 * @param ctx - dashboard state supplying the selection, launch flag, and session counts
 * @param event - the keydown being handled; keys other than the three navigation keys are ignored
 * @returns nothing; the effect is the moved selection or the started launch. It may call preventDefault and start a terminal launch.
 */
function handlePromptListNavigation(
  ctx: DashboardAlpineContext,
  event: KeyboardEvent,
): void {
  // Down moves to the next prompt instead of scrolling the page.
  if (event.key === "ArrowDown") {
    event.preventDefault();
    ctx.selectPresetByOffset(1);
    return;
  }
  // Up moves to the previous prompt instead of scrolling the page.
  if (event.key === "ArrowUp") {
    event.preventDefault();
    ctx.selectPresetByOffset(-1);
    return;
  }
  // Other keys keep their normal behavior once list navigation has been handled.
  if (event.key !== "Enter") return;

  const canLaunchNow =
    ctx.selectedPreset &&
    !ctx.launching &&
    Math.max(ctx.sessions.length, ctx.serverSessions.length) <
      ctx.serverMaxSessions;
  // Nothing selected, a launch already running, or the session limit reached each mean Enter must do nothing.
  if (!canLaunchNow || !ctx.selectedPreset) return;

  event.preventDefault();
  void ctx.launchPreset(
    ctx.selectedPreset.prompt,
    ctx.activeRunner,
    ctx.selectedPreset.name,
    { presetId: ctx.selectedPreset.id },
  );
}

/**
 * Handle the shortcuts that only apply while the user is on the Prompts view.
 *
 * @param ctx - live Alpine dashboard context
 * @param event - the key the user pressed
 */
function dashboardHandlePromptShortcut(
  ctx: DashboardAlpineContext,
  event: KeyboardEvent,
): void {
  // The user is somewhere else, so these keys belong to that view instead.
  if (ctx.activeView !== "prompts") return;
  // Escape closes the editor first, which is what a user expects before it starts affecting anything behind it.
  if (event.key === "Escape" && ctx.showCustomPromptEditor) {
    event.preventDefault();
    ctx.cancelCustomPromptEdit();
    return;
  }
  const isTypingInField = ["INPUT", "TEXTAREA", "SELECT"].includes(
    document.activeElement?.tagName ?? "",
  );
  // While the user is typing, arrow keys and Enter belong to the field they are in, not the prompt list.
  if (!isTypingInField) handlePromptListNavigation(ctx, event);
  // Escape clears search first, then clears prompt selection on a later press.
  if (event.key === "Escape") {
    // Clearing the search restores the full prompt list before dismissing a selected prompt.
    if (ctx.presetSearch) ctx.presetSearch = "";
    // With no search text left, Escape removes the current prompt selection.
    else if (ctx.selectedPreset) ctx.selectedPreset = null;
  }
}

/**
 * Register one dashboard keyboard listener at startup.
 * Global shortcuts get first refusal so one keypress cannot also trigger prompt-list navigation.
 */
function dashboardRegisterKeyboardShortcuts(ctx: DashboardAlpineContext): void {
  document.addEventListener("keydown", (event: KeyboardEvent) => {
    // A handled global shortcut must not also move or launch a prompt.
    if (dashboardHandleGlobalShortcut(ctx, event)) return;
    dashboardHandlePromptShortcut(ctx, event);
  });
}

/**
 * Initialize navigation, theme, saved prompts, and project state when the dashboard first opens.
 * Start audit, agent, and terminal discovery only when the page is served over HTTP or HTTPS.
 */
function dashboardInit(ctx: DashboardAlpineContext): void {
  ctx.$watch("darkMode", (value: boolean) => {
    localStorage.setItem("gf-dark", String(value));
    document.documentElement.classList.toggle("dark", value);
  });
  dashboardRegisterTerminalWatchers(ctx);
  dashboardRegisterViewWatchers(ctx);
  dashboardRegisterRunnerAndProjectWatchers(ctx);
  document.documentElement.classList.toggle("dark", ctx.darkMode);
  dashboardLoadCustomPrompts(ctx);
  void ctx._loadSavedDashboardState().then(() => {
    // Saved projects need their audit summaries refreshed once the project list has loaded.
    if (ctx.projectsList.length > 0) void ctx.auditAllProjects();
  });
  // Opening the built HTML directly has no API server, so leave its injected state visible without starting these requests.
  if (location.protocol === "http:" || location.protocol === "https:") {
    void ctx.runAudit();
    void ctx.checkTerminalAvailable();
    void ctx.fetchInstalledAgents();
  }
  dashboardRegisterKeyboardShortcuts(ctx);
}
