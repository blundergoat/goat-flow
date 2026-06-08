/**
 * Alpine watcher registration for the dashboard app.
 */

type DashboardAlpineContext = DashboardAppContext &
  AlpineMagics<DashboardAppContext>;

function dashboardResizeTerminalRef(
  sessionId: string,
  refs: TerminalRefs,
  xterm: XTermInstance,
): boolean {
  const container = document.getElementById(`gf-terminal-${sessionId}`);
  if (!container || container.offsetWidth === 0) return false;
  xterm._addonFit?.fit();
  if (refs.ws?.readyState === WebSocket.OPEN) {
    refs.ws.send(
      JSON.stringify({ type: "resize", cols: xterm.cols, rows: xterm.rows }),
    );
  }
  return true;
}

/**
 * Reset all skill-quality view state to empty, aborting any in-flight evaluation request first.
 * Called when the runner or project changes so a stale report/inventory never lingers across a
 * switch. Bumps skillQualityPrefetchGeneration so any prefetch that resolves after this reset is
 * recognised as stale by its generation check and discarded rather than applied.
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
 * Watches activeView/workspacePanel/activeSessionId and, on each relevant change, refits the active
 * terminal and pushes the new cols/rows to the backend over the open WebSocket. The refit is done
 * inside requestAnimationFrame (and a bounded retry poll for activeView) because a freshly-shown
 * panel has zero width until the browser lays it out; measuring too early yields a 0-size fit. The
 * lazy `loadXterm()` triggered on view entry swallows its rejection - a failed asset load must not
 * break view switching, and the terminal's own loading overlay reports the failure to the user.
 */
function dashboardRegisterTerminalWatchers(ctx: DashboardAlpineContext): void {
  ctx.$watch("activeView", (view: string) => {
    if ((view === "workspace" || view === "setup") && ctx.terminalAvailable) {
      void ctx.loadXterm().catch(() => {});
    }
    if (view !== "workspace" || !ctx.activeSessionId) return;
    const refs = ctx._terminalRefs[ctx.activeSessionId];
    const xterm = refs?.xterm;
    if (!xterm?._addonFit || !refs) return;
    const poll = (attempts = 0): void => {
      if (attempts > TERMINAL_REFIT_MAX_ATTEMPTS) return;
      requestAnimationFrame(() => {
        if (
          !dashboardResizeTerminalRef(ctx.activeSessionId ?? "", refs, xterm)
        ) {
          setTimeout(() => {
            poll(attempts + 1);
          }, TERMINAL_REFIT_RETRY_DELAY_MS);
        }
      });
    };
    void ctx.$nextTick(() => {
      poll();
    });
  });
  ctx.$watch("workspacePanel", (view: string) => {
    const xterm = ctx._terminalXterm;
    if (view !== "terminal" || !xterm?._addonFit) return;
    requestAnimationFrame(() => {
      xterm._addonFit?.fit();
      if (ctx._terminalWs?.readyState === WebSocket.OPEN) {
        ctx._terminalWs.send(
          JSON.stringify({
            type: "resize",
            cols: xterm.cols,
            rows: xterm.rows,
          }),
        );
      }
    });
  });
  ctx.$watch("activeSessionId", (id: string | null) => {
    if (!id) return;
    const refs = ctx._terminalRefs[id];
    const xterm = refs?.xterm;
    if (!xterm?._addonFit || !refs) return;
    void ctx.$nextTick(() => {
      requestAnimationFrame(() => {
        xterm._addonFit?.fit();
        if (refs.ws?.readyState === WebSocket.OPEN) {
          refs.ws.send(
            JSON.stringify({
              type: "resize",
              cols: xterm.cols,
              rows: xterm.rows,
            }),
          );
        }
        xterm.focus();
      });
    });
  });
}

/**
 * Register the watchers that lazy-load each view's data when the user navigates to it and react to
 * the quality filters. Entering a view triggers its loader (audit/quality/skills/setup/plans/hooks);
 * the per-view fan-out is intentional because data is fetched on demand rather than all at once on
 * boot, keeping the initial render cheap. The workspace view additionally starts a 10s session-count
 * poll that is cleared on every activeView change, because leaving the workspace must stop the
 * interval so only one poll is ever live and a backgrounded view does not keep hitting the server.
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

function dashboardHandleGlobalShortcut(
  ctx: DashboardAlpineContext,
  event: KeyboardEvent,
): boolean {
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

function dashboardHandlePromptShortcut(
  ctx: DashboardAlpineContext,
  event: KeyboardEvent,
): void {
  if (ctx.activeView !== "prompts") return;
  if (event.key === "Escape" && ctx.showCustomPromptEditor) {
    event.preventDefault();
    ctx.cancelCustomPromptEdit();
    return;
  }
  const inputFocused = ["INPUT", "TEXTAREA", "SELECT"].includes(
    document.activeElement?.tagName ?? "",
  );
  if (!inputFocused) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      ctx.selectPresetByOffset(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      ctx.selectPresetByOffset(-1);
    } else if (
      event.key === "Enter" &&
      ctx.selectedPreset &&
      !ctx.launching &&
      Math.max(ctx.sessions.length, ctx.serverSessions.length) <
        ctx.serverMaxSessions
    ) {
      event.preventDefault();
      void ctx.launchPreset(
        ctx.selectedPreset.prompt,
        ctx.activeRunner,
        ctx.selectedPreset.name,
        { presetId: ctx.selectedPreset.id },
      );
    }
  }
  if (event.key === "Escape") {
    if (ctx.presetSearch) ctx.presetSearch = "";
    else if (ctx.selectedPreset) ctx.selectedPreset = null;
  }
}

/**
 * Wire the single document-level keydown listener that drives the dashboard's keyboard shortcuts.
 * Global shortcuts are tried first and, when one handles the event, the prompt-view shortcuts are
 * skipped (the global handler returning true short-circuits) so the two sets never both fire for
 * one keypress. One listener for the whole app, registered once during init.
 */
function dashboardRegisterKeyboardShortcuts(ctx: DashboardAlpineContext): void {
  document.addEventListener("keydown", (event: KeyboardEvent) => {
    if (dashboardHandleGlobalShortcut(ctx, event)) return;
    dashboardHandlePromptShortcut(ctx, event);
  });
}

/**
 * One-shot bootstrap run once when the Alpine app initialises: register every watcher and keyboard
 * shortcut, apply the persisted dark-mode class, load saved custom prompts and dashboard state, and
 * kick off the first audit/agent/terminal-availability fetches. The initial network calls are
 * guarded behind an http(s) protocol check so opening the built HTML from `file://` (no server)
 * loads the UI without firing requests that would only fail. Side-effecting; returns nothing.
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
