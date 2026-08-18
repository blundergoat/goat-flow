/**
 * Wires up the dashboard's Alpine watchers, the reactions that fire when the user changes project, tab, or terminal layout.
 *
 * This is the glue that makes the UI respond: without it a user could switch project and the panels would keep showing the old one.
 *
 * Watchers are registered once at startup and deliberately kept thin, so the work they trigger lives in the feature modules they call.
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

/** Whether entering this view should warm xterm assets before a terminal is attached. */
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
  if (!dashboardShouldWarmXterm(ctx, view)) return;
  void ctx.loadXterm().catch(() => {});
}

/** Return the xterm handle only when it can be fitted by the addon. */
function dashboardRefitCapableXterm(
  refs: TerminalRefs | undefined,
): XTermInstance | null {
  const xterm = refs?.xterm;
  return xterm?._addonFit ? xterm : null;
}

/** Send the current xterm dimensions over an open backend WebSocket. */
function dashboardSendTerminalResize(
  socket: WebSocket | undefined,
  xterm: XTermInstance,
): void {
  if (socket?.readyState !== WebSocket.OPEN) return;
  socket.send(
    JSON.stringify({
      type: "resize",
      cols: xterm.cols,
      rows: xterm.rows,
    }),
  );
}

/** Fit a terminal and notify the backend of its new dimensions. */
function dashboardFitTerminalWithResize(
  xterm: XTermInstance,
  socket: WebSocket | undefined,
): void {
  xterm._addonFit?.fit();
  dashboardSendTerminalResize(socket, xterm);
}

/** Retry active-view refits until the freshly-shown terminal container has layout width. */
function dashboardPollActiveTerminalRefit(
  ctx: DashboardAlpineContext,
  refs: TerminalRefs,
  xterm: XTermInstance,
  attempts = 0,
): void {
  if (attempts > TERMINAL_REFIT_MAX_ATTEMPTS) return;
  requestAnimationFrame(() => {
    if (!dashboardResizeTerminalRef(ctx.activeSessionId ?? "", refs, xterm)) {
      setTimeout(() => {
        dashboardPollActiveTerminalRefit(ctx, refs, xterm, attempts + 1);
      }, TERMINAL_REFIT_RETRY_DELAY_MS);
    }
  });
}

/** Refit the active terminal after the workspace view becomes visible. */
function dashboardRefitWorkspaceViewTerminal(
  ctx: DashboardAlpineContext,
  view: string,
): void {
  if (view !== "workspace" || !ctx.activeSessionId) return;
  const refs = ctx._terminalRefs[ctx.activeSessionId];
  const xterm = dashboardRefitCapableXterm(refs);
  if (!refs || !xterm) return;
  void ctx.$nextTick(() => {
    dashboardPollActiveTerminalRefit(ctx, refs, xterm);
  });
}

/** Refit the active terminal when the workspace panel switches back to the terminal tab. */
function dashboardRefitWorkspacePanelTerminal(
  ctx: DashboardAlpineContext,
  view: string,
): void {
  const xterm = ctx._terminalXterm;
  if (view !== "terminal" || !xterm?._addonFit) return;
  requestAnimationFrame(() => {
    dashboardFitTerminalWithResize(xterm, ctx._terminalWs);
  });
}

/** Refit and focus a newly selected terminal tab after Alpine has rendered it. */
function dashboardRefitSelectedTerminal(
  ctx: DashboardAlpineContext,
  id: string | null,
): void {
  if (!id) return;
  const refs = ctx._terminalRefs[id];
  const xterm = dashboardRefitCapableXterm(refs);
  if (!refs || !xterm) return;
  void ctx.$nextTick(() => {
    requestAnimationFrame(() => {
      dashboardFitTerminalWithResize(xterm, refs.ws);
      xterm.focus();
    });
  });
}

/**
 * Reset all skill-quality view state to empty, aborting any in-flight evaluation request first.
 *
 * Called when the runner or project changes so a stale report/inventory never lingers across a switch.
 * Bumps skillQualityPrefetchGeneration so any prefetch that resolves after this reset is recognised as stale by its generation check and discarded
 * rather than applied.
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
 * Register the Alpine watchers that keep the xterm terminal sized and focused as the view changes.
 *
 * Watches activeView/workspacePanel/activeSessionId and, on each relevant change, refits the active terminal and pushes the new cols/rows to the
 * backend over the open WebSocket.
 *
 * The refit is done inside requestAnimationFrame (and a bounded retry poll for activeView) because a freshly-shown panel has zero width until the
 * browser lays it out; measuring too early yields a 0-size fit.
 *
 * The lazy `loadXterm()` triggered on view entry swallows its rejection - a failed asset load must not break view switching, and the terminal's own
 * loading overlay reports the failure to the user.
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
 * Register the watchers that lazy-load each view's data when the user navigates to it and react to the quality filters.
 * Entering a view triggers its loader (audit/quality/skills/setup/plans/hooks); the per-view fan-out is intentional because data is fetched on demand
 * rather than all at once on boot, keeping the initial render cheap.
 *
 * The workspace view additionally starts a 10s session-count poll that is cleared on every activeView change, because leaving the workspace must stop
 * the interval so only one poll is ever live and a backgrounded view does not keep hitting the server.
 */
function dashboardRegisterViewWatchers(ctx: DashboardAlpineContext): void {
  ctx.$watch("activeView", (view: string) => {
    if (ctx._workspacePoll) {
      clearInterval(ctx._workspacePoll);
      ctx._workspacePoll = null;
    }
    if (["home", "projects", "workspace", "prompts"].includes(view)) {
      void ctx.updateSessionCount();
    }
    if (view === "home") void ctx.generateHomeQualitySummary();
    if (view === "workspace") {
      ctx._workspacePoll = setInterval(() => {
        void ctx.updateSessionCount();
      }, 10_000);
    }
    if (view === "quality") {
      void ctx.generateQuality({ fast: true });
      ctx.scheduleQualityHistory();
    }
    if (view === "skills") void ctx.loadSkillQualityInventory();
    if (view === "setup") {
      void ctx.detectStack();
      ctx.scheduleSetupPrompt();
    }
    if (view === "plans") void ctx.loadTasks();
    if (view === "hooks") void ctx.loadHooks();
  });
  ctx.$watch("qualityAgent", () => {
    if (ctx.activeView === "quality") {
      void ctx.generateQuality({ fast: true });
      ctx.scheduleQualityHistory();
    }
  });
  ctx.$watch("selectedQualityModeId", () => {
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
    if (ctx.activeView === "home") void ctx.generateHomeQualitySummary();
    if (ctx.activeView === "skills") {
      dashboardResetSkillQualityState(ctx);
      void ctx.loadSkillQualityInventory();
    }
  });
  ctx.$watch("sessionsCollapsed", (value: boolean) => {
    localStorage.setItem("gf-sessions-collapsed", String(value));
  });
  // Keeps the browser tab title on the current project, so a user with several dashboards open can tell them apart.
  const updateTitle = (): void => {
    document.title = `${ctx.projectName} | GOAT Flow`;
  };
  ctx.$watch("projectPath", (newPath: string, oldPath: string) => {
    updateTitle();
    if (!oldPath || newPath === oldPath) return;
    ctx.detachTerminal(oldPath);
    void ctx.reconnectTerminal();
    void ctx.updateSessionCount();
    if (ctx.activeView === "quality") {
      void ctx.generateQuality({ fast: true });
      ctx.scheduleQualityHistory();
    }
    if (ctx.activeView === "setup") {
      void ctx.detectStack();
      ctx.scheduleSetupPrompt();
    }
    if (ctx.activeView === "home") void ctx.generateHomeQualitySummary();
    if (ctx.activeView === "plans") {
      ctx.selectedTaskPlan = null;
      void ctx.loadTasks();
    }
    if (ctx.activeView === "hooks") void ctx.loadHooks();
    dashboardResetSkillQualityState(ctx);
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
  if (
    event.key === "/" &&
    !["INPUT", "TEXTAREA", "SELECT"].includes(
      document.activeElement?.tagName ?? "",
    )
  ) {
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
      if (searchInput instanceof HTMLInputElement) searchInput.focus();
    });
    return true;
  }
  return false;
}

/**
 * Drive the prompt list from the keyboard: arrows move the selection, Enter launches it.
 *
 * Enter only launches when a preset is selected, no launch is already in flight, and the user is below their session
 * limit, so a held key cannot open a queue of terminals they never asked for.
 *
 * @param ctx - dashboard state supplying the selection, launch flag, and session counts
 * @param event - the keydown being handled; keys other than the three navigation keys are ignored
 * @returns nothing; the effect is the moved selection or the started launch. It may call preventDefault and start a terminal launch.
 */
function handlePromptListNavigation(
  ctx: DashboardAlpineContext,
  event: KeyboardEvent,
): void {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    ctx.selectPresetByOffset(1);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    ctx.selectPresetByOffset(-1);
    return;
  }
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
  if (event.key === "Escape") {
    if (ctx.presetSearch) ctx.presetSearch = "";
    else if (ctx.selectedPreset) ctx.selectedPreset = null;
  }
}

/**
 * Wire the single document-level keydown listener that drives the dashboard's keyboard shortcuts.
 *
 * Global shortcuts are tried first and, when one handles the event, the prompt-view shortcuts are skipped (the global handler returning true
 * short-circuits) so the two sets never both fire for one keypress.
 * One listener for the whole app, registered once during init.
 */
function dashboardRegisterKeyboardShortcuts(ctx: DashboardAlpineContext): void {
  document.addEventListener("keydown", (event: KeyboardEvent) => {
    if (dashboardHandleGlobalShortcut(ctx, event)) return;
    dashboardHandlePromptShortcut(ctx, event);
  });
}

/**
 * One-shot bootstrap run once when the Alpine app initialises: register every watcher and keyboard shortcut, apply the persisted dark-mode class,
 * load saved custom prompts and dashboard state, and kick off the first audit/agent/terminal-availability fetches.
 *
 * The initial network calls are guarded behind an http(s) protocol check so opening the built HTML from `file://` (no server) loads the UI without
 * firing requests that would only fail.
 * Side-effecting; returns nothing.
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
    if (ctx.projectsList.length > 0) void ctx.auditAllProjects();
  });
  if (location.protocol === "http:" || location.protocol === "https:") {
    void ctx.runAudit();
    void ctx.checkTerminalAvailable();
    void ctx.fetchInstalledAgents();
  }
  dashboardRegisterKeyboardShortcuts(ctx);
}
