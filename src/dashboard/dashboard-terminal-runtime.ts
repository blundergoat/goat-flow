/**
 * Manage dashboard terminal availability, session refresh, xterm assets, and launches.
 * Use when a Workspace user opens, reconnects, clears, or sends prompts to browser-backed runners.
 * Helpers guard stale sessions and loading failures so the UI shows modals/toasts instead of
 * leaving a disconnected terminal pane.
 */
/**
 * Send a prompt to an existing terminal session for the current project.
 * Use when a user targets a running session instead of starting a new one.
 *
 * @param ctx - terminal dashboard state; missing active session means the helper opens/binds the target
 * @param prompt - prompt text to send; empty text still focuses/opens the session without useful input
 * @param target - server session to receive the prompt; wrong-project sessions are rejected for the user
 * @returns nothing; connection failures appear as toasts
 */
async function dashboardSendToProjectTarget(
  ctx: DashboardTerminalContext,
  prompt: string,
  target: ServerSessionInfo,
): Promise<void> {
  // Wrong-project sends would paste a prompt into a session the user is not viewing.
  if (target.projectPath !== ctx.projectPath) {
    ctx.showToast("Target session is not in this project", true);
    return;
  }
  // Locally bound sessions can be focused immediately in the Workspace terminal.
  if (ctx.isSessionBoundLocally(target.id)) {
    ctx.activeSessionId = target.id;
    ctx.activeView = "workspace";
    ctx.workspacePanel = "terminal";
  } else {
    await ctx.openServerSession(target);
  }
  const prepared = ctx.adaptPrompt(prompt, target.runner);
  /**
   * Retry delivery until the browser WebSocket is ready.
   * Use after opening a saved session because the visible terminal may still be connecting.
   *
   * @param attempts - retry count; high values mean the terminal never became ready
   * @returns nothing; timeout appears as a toast instead of dropping the prompt silently
   */
  const deliver = async (attempts: number): Promise<void> => {
    const refs = ctx._terminalRefs[ctx.activeSessionId ?? ""];
    // Open sockets can receive the prompt immediately.
    if (refs?.ws && refs.ws.readyState === WebSocket.OPEN) {
      ctx.sendToTerminal(prepared, { adapt: false });
      return;
    }
    // After repeated retries, tell the user the terminal could not connect.
    if (attempts > 20) {
      ctx.showToast("Could not connect to terminal", true);
      return;
    }
    await new Promise<void>((r) => setTimeout(r, 100));
    return deliver(attempts + 1);
  };
  await deliver(0);
}

/**
 * Refresh terminal feature availability from the health endpoint.
 * Use when the dashboard starts so Workspace can enable terminal actions only for runnable agents.
 *
 * @param ctx - terminal dashboard state; failed health checks disable terminal actions
 * @returns nothing; session count refresh is scheduled afterward
 */
async function dashboardCheckTerminalAvailable(
  ctx: DashboardTerminalContext,
): Promise<void> {
  try {
    const res = await dashboardFetch("/api/health");
    // Healthy responses may advertise runners, platform hints, and idle timeout.
    if (res.ok) {
      const payload = readRecord(await res.json(), "Health response");
      ctx.availableRunners = Array.isArray(payload.availableRunners)
        ? payload.availableRunners
            .map((runner) => readRunnerId(runner))
            .filter((runner): runner is RunnerId => runner !== null)
        : [];
      ctx.terminalAvailable =
        payload.nodePtyAvailable === true && ctx.availableRunners.length > 0;
      ctx.platformHint =
        typeof payload.platformHint === "string" ? payload.platformHint : null;
      ctx.idleTimeoutMinutes =
        typeof payload.idleTimeoutMinutes === "number"
          ? payload.idleTimeoutMinutes
          : 480;
      const [firstRunner] = ctx.availableRunners;
      // Pick the first runnable agent so launch buttons have a valid default.
      if (firstRunner) ctx.activeRunner = firstRunner;
      // Workspace/setup views are likely to launch a terminal, so warm assets in the background.
      if (
        ctx.terminalAvailable &&
        (ctx.activeView === "workspace" || ctx.activeView === "setup")
      ) {
        void dashboardWarmXterm(ctx);
      }
    }
  } catch {
    // Health failures mean terminal controls should stay disabled for the user.
    ctx.terminalAvailable = false;
  }
  void ctx.updateSessionCount();
}

/**
 * Debounce a terminal session refresh from the server.
 * Use after launches, reconnects, and cleanup so counters update without request bursts.
 *
 * @param ctx - terminal dashboard state; stale refreshes update the same session list
 * @returns promise for the pending refresh; existing promise means a refresh is already scheduled
 */
async function dashboardUpdateSessionCount(
  ctx: DashboardTerminalContext,
): Promise<void> {
  // Reuse an in-flight refresh so rapid UI events do not spam the sessions endpoint.
  if (sessionRefreshPromise) return sessionRefreshPromise;
  sessionRefreshPromise = new Promise<void>((resolve) => {
    sessionRefreshDebounceTimer = setTimeout(() => {
      void dashboardUpdateSessionCountImpl(ctx).finally(() => {
        sessionRefreshPromise = null;
        sessionRefreshDebounceTimer = null;
        resolve();
      });
    }, SESSION_REFRESH_DEBOUNCE_MS);
  });
  return sessionRefreshPromise;
}

/**
 * Refresh terminal session state from the server immediately.
 * Use behind the debounced public refresh so local ended sessions reconcile with backend truth.
 *
 * @param ctx - terminal dashboard state; failed refreshes leave current local state in place
 * @returns nothing; stale local sessions may be marked ended
 */
async function dashboardUpdateSessionCountImpl(
  ctx: DashboardTerminalContext,
): Promise<void> {
  try {
    const res = await dashboardFetch("/api/terminal/sessions");
    const payload = readRecord(await res.json(), "Terminal sessions response");
    ctx.terminalSessionCount =
      typeof payload.activeCount === "number" ? payload.activeCount : 0;
    // Server max sessions controls when the UI shows the max-sessions modal.
    if (typeof payload.maxSessions === "number") {
      ctx.serverMaxSessions = payload.maxSessions;
    }
    ctx.serverSessions = Array.isArray(payload.sessions)
      ? payload.sessions
          .map((session) => readServerSessionInfo(session))
          .filter((session): session is ServerSessionInfo => session !== null)
          .map((session) => ({
            ...session,
            projectName: ctx.displayNameFor(session.projectPath),
          }))
      : [];
    const activeIds = new Set(ctx.serverSessions.map((session) => session.id));
    // Local sessions absent from the server are marked ended so the UI stops showing them as reconnectable.
    for (const session of ctx.sessions) {
      // Ended, connected, or server-known sessions remain visible in their current state.
      if (session.ended || session.connected || activeIds.has(session.id)) {
        continue;
      }
      dashboardClearAwaitingInputTimer(ctx, session.id);
      dashboardClearTerminalLoadingTimers(ctx, session.id);
      session.ended = true;
      session.awaitingInput = false;
      ctx._forgetSavedSession(session.id);
    }
  } catch {
    // Session refresh is best-effort; keep the visible terminal state if the endpoint fails.
  }
}

/**
 * Clear recent inactive terminal sessions while preserving running backend sessions.
 * Use when the user clicks the clear/recent-session cleanup action in Workspace.
 *
 * @param ctx - terminal dashboard state; endpoint failures show a toast and keep current rows
 * @returns nothing; cleared count appears as a toast
 */
async function dashboardEndAllSessions(
  ctx: DashboardTerminalContext,
): Promise<void> {
  try {
    const res = await dashboardFetch("/api/terminal/sessions");
    const payload = readRecord(await res.json(), "Terminal sessions response");
    const sessions = Array.isArray(payload.sessions)
      ? payload.sessions
          .map((session) => readServerSessionInfo(session))
          .filter((session): session is ServerSessionInfo => session !== null)
      : [];
    const inactive = sessions.filter((session) => session.status !== "active");
    const activeIds = new Set(
      sessions
        .filter((session) => session.status === "active")
        .map((session) => session.id),
    );
    const localRecentCount = ctx.recentTerminalSessions.length;
    // Delete inactive backend sessions so stale recent rows disappear from the UI.
    for (const session of inactive) {
      await dashboardFetch(`/api/terminal/${session.id}`, {
        method: "DELETE",
      });
    }
    ctx.recentTerminalSessions = [];
    const keptRefs: typeof ctx._terminalRefs = {};
    // Keep terminal bindings only for sessions still active on the server.
    for (const id of Object.keys(ctx._terminalRefs)) {
      // Active sessions stay reconnectable after cleanup.
      if (activeIds.has(id)) {
        const active = ctx._terminalRefs[id];
        if (active) keptRefs[id] = active;
      } else {
        const refs = ctx._terminalRefs[id];
        dashboardClearTerminalLoadingTimers(ctx, id);
        if (refs?.cleanup) refs.cleanup();
      }
    }
    ctx._terminalRefs = keptRefs;
    const keptProjects: typeof ctx._projectSessions = {};
    // Preserve per-project saved sessions only when the backend still reports them active.
    for (const key of Object.keys(ctx._projectSessions)) {
      const kept = (ctx._projectSessions[key] ?? []).filter((s) =>
        activeIds.has(s.sessionId),
      );
      // Empty project session lists are pruned so reconnect buttons do not show stale choices.
      if (kept.length > 0) keptProjects[key] = kept;
    }
    ctx._projectSessions = keptProjects;
    // Project active-session pointers fall back to a kept session or disappear.
    for (const key of Object.keys(ctx._projectActiveSession)) {
      const activeSessionForProject = ctx._projectActiveSession[key];
      // Pointers to removed sessions need a replacement before the user reconnects.
      if (activeSessionForProject && !activeIds.has(activeSessionForProject)) {
        const projectSessions = keptProjects[key];
        // A remaining session becomes the project's reconnect default.
        if (projectSessions?.[0]) {
          ctx._projectActiveSession[key] = projectSessions[0].sessionId;
        } else {
          Reflect.deleteProperty(ctx._projectActiveSession, key);
        }
      }
    }
    ctx.sessions = ctx.sessions.filter((s) => activeIds.has(s.id));
    // If the visible session was cleared, select no active local session.
    if (ctx.activeSessionId && !activeIds.has(ctx.activeSessionId)) {
      ctx.activeSessionId = null;
    }
    // Preset run badges complete when their session disappeared during cleanup.
    for (const [presetId, state] of Object.entries(ctx.promptRunStates)) {
      // Only running presets with no matching local session are marked pass.
      if (
        state === "running" &&
        !ctx.sessions.some((s) => s.presetId === presetId)
      ) {
        ctx.promptRunStates[presetId] = "pass";
      }
    }
    await ctx.updateSessionCount();
    const count = inactive.length + localRecentCount;
    ctx.showToast(
      count > 0
        ? `Cleared ${count} recent session${count !== 1 ? "s" : ""}`
        : "No recent sessions to clear",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.showToast("Failed to clear sessions: " + msg, true);
  }
}

/**
 * Remove xterm asset tags after a failed load.
 * Use so the next explicit terminal launch can retry cleanly instead of reusing broken tags.
 *
 * @returns nothing; missing tags mean there is nothing to remove
 */
function removeXtermAssetElements(): void {
  document
    .querySelector('link[rel="stylesheet"][href="/assets/xterm.css"]')
    ?.remove();
  document.querySelector('script[src="/assets/xterm.js"]')?.remove();
  document.querySelector('script[src="/assets/addon-fit.js"]')?.remove();
}

/**
 * Wait for a stylesheet or script asset to load.
 * Use when xterm assets may already be loading from another terminal action.
 *
 * @param element - asset element to observe; already-loaded elements resolve immediately
 * @param label - user/debug label for failures; empty labels make timeout messages unclear
 * @returns promise that resolves on load or rejects on timeout/error
 */
function waitForAssetElement(
  element: HTMLLinkElement | HTMLScriptElement,
  label: string,
): Promise<void> {
  // Already-loaded assets can be reused for the next terminal without waiting.
  if (element.dataset["loaded"] === "true") return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} load timeout`));
    }, 5000);
    const cleanup = (): void => {
      clearTimeout(timer);
      element.removeEventListener("load", onLoad);
      element.removeEventListener("error", onError);
    };
    const onLoad = (): void => {
      cleanup();
      element.dataset["loaded"] = "true";
      resolve();
    };
    const onError = (): void => {
      cleanup();
      reject(new Error(`${label} load failed`));
    };
    element.addEventListener("load", onLoad, { once: true });
    element.addEventListener("error", onError, { once: true });
  });
}

/**
 * Load xterm CSS once.
 * Use before rendering a terminal so reconnects and repeated launches reuse the same stylesheet.
 *
 * @returns promise that resolves when terminal CSS is ready
 */
async function loadXtermStylesheet(): Promise<void> {
  const existing = document.querySelector<HTMLLinkElement>(
    'link[rel="stylesheet"][href="/assets/xterm.css"]',
  );
  // Existing stylesheet tags are reused so the document does not accumulate duplicate assets.
  if (existing) {
    await waitForAssetElement(existing, "xterm.css");
    return;
  }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/assets/xterm.css";
  const loaded = waitForAssetElement(link, "xterm.css");
  document.head.appendChild(link);
  await loaded;
}

/**
 * Load one xterm script asset.
 * Use for xterm core and the fit addon while sharing any script tag already in progress.
 *
 * @param src - script URL; empty would create an unusable asset tag
 * @param label - user/debug label for failures; empty labels make timeout messages unclear
 * @returns promise that resolves when the script is ready
 */
async function loadXtermScript(src: string, label: string): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(
    `script[src="${src}"]`,
  );
  // Existing script tags may still be loading, so wait for them instead of appending another.
  if (existing) {
    await waitForAssetElement(existing, label);
    return;
  }
  const script = document.createElement("script");
  script.src = src;
  const loaded = waitForAssetElement(script, label);
  document.head.appendChild(script);
  await loaded;
}

/**
 * Load xterm core and addons for the dashboard terminal.
 * Use before opening or reconnecting a Workspace terminal.
 *
 * @param ctx - terminal dashboard state; already-loaded state returns immediately
 * @returns nothing; failed loads reset asset tags so the next launch can retry
 */
async function dashboardLoadXterm(
  ctx: DashboardTerminalContext,
): Promise<void> {
  // Loaded assets can be reused for all later terminal sessions.
  if (ctx._xtermLoaded) return;
  // Share one load promise so concurrent launches wait on the same assets.
  if (!xtermLoadPromise) {
    xtermLoadPromise = (async () => {
      await loadXtermStylesheet();
      // The fit addon patches the global Terminal constructor, so xterm itself
      // has to finish loading before the addon script is appended.
      await loadXtermScript("/assets/xterm.js", "xterm.js");
      await loadXtermScript("/assets/addon-fit.js", "fit addon");
      getXtermConstructors();
    })();
  }
  try {
    await xtermLoadPromise;
    ctx._xtermLoaded = true;
  } catch (err) {
    // Failed asset tags are removed so explicit relaunch can try again.
    xtermLoadPromise = null;
    removeXtermAssetElements();
    throw err;
  }
}

/**
 * Warm xterm assets in the background.
 * Use after health confirms terminals are available so the first launch feels faster.
 *
 * @param ctx - terminal dashboard state; unavailable or already-loaded terminals do nothing
 * @returns nothing; background failures are surfaced later on explicit launch
 */
async function dashboardWarmXterm(
  ctx: DashboardTerminalContext,
): Promise<void> {
  // If terminal launch is unavailable or already warm, the user does not need background work.
  if (!ctx.terminalAvailable || ctx._xtermLoaded) return;
  try {
    await ctx.loadXterm();
  } catch {
    // Surface load failures only on explicit launch.
  }
}

/**
 * Launch a preset or custom prompt in the selected runner.
 * Use when the user clicks a dashboard prompt button and expects a Workspace terminal to open.
 *
 * @param ctx - terminal dashboard state; active launch blocks duplicate clicks
 * @param prompt - prompt text to send; empty launches a terminal with only launch context
 * @param runner - optional runner override; absent uses the active runner
 * @param label - optional visible prompt label; absent falls back to preset/custom text
 * @param options - launch metadata; empty values use current project and custom prompt defaults
 * @returns nothing; launch failures show modal/toast feedback
 */
async function dashboardLaunchPreset(
  ctx: DashboardTerminalContext,
  prompt: string,
  runner?: RunnerId,
  label?: string,
  options: {
    presetId?: string | null;
    cwdPath?: string | null;
    targetPath?: string | null;
  } = {},
): Promise<void> {
  // A launch is already in progress, so ignore duplicate button clicks.
  if (ctx.launching) return;
  const preset =
    (options.presetId
      ? (ctx.allPresets.find((p) => p.id === options.presetId) ?? null)
      : null) ??
    ctx.allPresets.find(
      (p) =>
        ctx.adaptPrompt(p.prompt) === ctx.adaptPrompt(prompt) ||
        (typeof label === "string" && p.name === label),
    ) ??
    null;
  const promptLabel = label || preset?.name || "Custom prompt";
  const presetId = preset?.id || options.presetId || null;
  const runnerResolved = runner || ctx.activeRunner;
  // Preset badges show running state while the terminal session is active.
  if (presetId) ctx.promptRunStates[presetId] = "running";
  let adapted = ctx.adaptPrompt(prompt, runnerResolved);
  adapted +=
    "\n\n" + dashboardGlobalLaunchContext(ctx, runnerResolved, preset ?? null);
  // Investigator role opens read-only guidance from the user's configured perspective.
  if (ctx.userRole === "investigator") {
    adapted =
      "You are in investigator mode. Read-only - investigate, plan, and review only. Do NOT make any code changes.\n\n" +
      adapted;
    // Tester role focuses the runner on QA/test work instead of implementation changes.
  } else if (ctx.userRole === "tester") {
    adapted =
      "You are in tester mode. Test-focused - generate test plans, verify coverage, run QA analysis. Do NOT make code changes beyond test files.\n\n" +
      adapted;
  }
  await ctx.launchInTerminal(adapted, runnerResolved, {
    promptLabel,
    presetId,
    cwdPath: options.cwdPath ?? null,
    targetPath: options.targetPath ?? ctx.projectPath,
  });
}

/**
 * Forget a saved session id across every project.
 * Use when the server proves a session ended so reconnect metadata stops pointing at it.
 *
 * @param ctx - terminal dashboard state; missing session maps mean there is nothing to prune
 * @param sessionId - session id to remove; empty ids do not match normal saved sessions
 * @returns nothing; saved project session maps update in place
 */
function dashboardForgetSavedSession(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  // A session can be saved under multiple project keys after navigation, so prune every list.
  for (const [path, list] of Object.entries(ctx._projectSessions)) {
    const filtered = list.filter((sv) => sv.sessionId !== sessionId);
    // Empty saved lists should disappear so reconnect controls do not show stale projects.
    if (filtered.length === 0) {
      Reflect.deleteProperty(ctx._projectSessions, path);
      // Changed lists keep only sessions the user can still reconnect.
    } else if (filtered.length !== list.length) {
      ctx._projectSessions[path] = filtered;
    }
    // Active-session pointers must move off the forgotten session.
    if (ctx._projectActiveSession[path] === sessionId) {
      const first = filtered[0];
      // Remaining saved session becomes the reconnect default.
      if (first) {
        ctx._projectActiveSession[path] = first.sessionId;
      } else {
        Reflect.deleteProperty(ctx._projectActiveSession, path);
      }
    }
  }
}

/** Detach the current browser terminal while preserving reconnect metadata. */
function dashboardDetachTerminal(
  ctx: DashboardTerminalContext,
  forProjectPath?: string,
): void {
  ctx._detaching = true;
  const savePath = forProjectPath || ctx.projectPath;
  const toSave: SavedSession[] = ctx.sessions
    .filter((s) => s.projectPath === savePath && !s.ended)
    .map((s) => ({
      sessionId: s.id,
      startTime: s.startTime,
      prompt: s.promptLabel,
      agent: s.runner,
      cwd: s.cwd,
      targetPath: s.targetPath,
    }));
  if (toSave.length > 0) {
    ctx._projectSessions[savePath] = toSave;
    const activeId = ctx.activeSessionId;
    const fallback = toSave[0];
    if (activeId && toSave.some((s) => s.sessionId === activeId)) {
      ctx._projectActiveSession[savePath] = activeId;
    } else if (fallback) {
      ctx._projectActiveSession[savePath] = fallback.sessionId;
    }
  } else {
    Reflect.deleteProperty(ctx._projectSessions, savePath);
    Reflect.deleteProperty(ctx._projectActiveSession, savePath);
  }
  for (const id of Object.keys(ctx._terminalRefs)) {
    const refs = ctx._terminalRefs[id];
    dashboardClearTerminalLoadingTimers(ctx, id);
    if (refs?.cleanup) refs.cleanup();
  }
  ctx._terminalRefs = {};
  ctx.sessions = [];
  ctx.activeSessionId = null;
  ctx.promptRunStates = {};
  ctx._detaching = false;
}

/** Reconnect the workspace to every saved backend session for this project. */
async function dashboardReconnectTerminal(
  ctx: DashboardTerminalContext,
): Promise<boolean> {
  const savedList = ctx._projectSessions[ctx.projectPath];
  const aliveMap = new Map<string, ServerSessionInfo>();
  try {
    const res = await dashboardFetch("/api/terminal/sessions");
    const payload = readRecord(await res.json(), "Terminal sessions response");
    if (Array.isArray(payload.sessions)) {
      for (const raw of payload.sessions) {
        const session = readServerSessionInfo(raw);
        if (session) aliveMap.set(session.id, session);
      }
    }
  } catch {
    Reflect.deleteProperty(ctx._projectSessions, ctx.projectPath);
    Reflect.deleteProperty(ctx._projectActiveSession, ctx.projectPath);
    return false;
  }
  if (!savedList || savedList.length === 0) {
    const activeId = ctx.activeSessionId;
    const activeServerSession = activeId ? aliveMap.get(activeId) : null;
    if (!activeServerSession) return false;
    await ctx.openServerSession(activeServerSession);
    return true;
  }
  const liveSaved = savedList.filter((sv) => aliveMap.has(sv.sessionId));
  if (liveSaved.length === 0) {
    Reflect.deleteProperty(ctx._projectSessions, ctx.projectPath);
    Reflect.deleteProperty(ctx._projectActiveSession, ctx.projectPath);
    return false;
  }
  ctx._projectSessions[ctx.projectPath] = liveSaved;
  const self = ctx as DashboardTerminalContext &
    AlpineMagics<DashboardTerminalContext>;
  await ctx.loadXterm();
  for (const saved of liveSaved) {
    const alive = aliveMap.get(saved.sessionId);
    if (!alive) continue;
    const session: LocalSession = {
      id: saved.sessionId,
      runner: saved.agent,
      promptLabel: saved.prompt,
      projectPath: alive.projectPath,
      cwd: alive.cwd || saved.cwd || alive.projectPath,
      targetPath: alive.targetPath || saved.targetPath || alive.projectPath,
      startTime: saved.startTime,
      lastInputTime: alive.lastInputAt,
      connected: false,
      ended: false,
      awaitingInput: false,
      outputTail: "",
      loadingPhase: "connecting",
      loadingShowSlowHint: false,
      loadingShowRetry: false,
      age: "",
      presetId: null,
    };
    ctx.rememberSessionTitle(session.id, session.promptLabel);
    ctx.sessions.push(session);
    ctx._terminalRefs[session.id] = {
      retryPrompt: "",
      retryPromptLabel: session.promptLabel,
      retryPresetId: null,
      retryCwdPath: session.cwd,
      retryTargetPath: session.targetPath,
    };
    dashboardArmTerminalLoadingTimers(ctx, session.id, session);
  }
  const savedActiveId = ctx._projectActiveSession[ctx.projectPath];
  const first = liveSaved[0];
  ctx.activeSessionId =
    savedActiveId && liveSaved.some((s) => s.sessionId === savedActiveId)
      ? savedActiveId
      : (first?.sessionId ?? null);
  ctx.activeView = "workspace";
  ctx.workspacePanel = "terminal";
  await self.$nextTick();
  for (const saved of liveSaved) {
    ctx.connectTerminal(saved.sessionId, `/ws/terminal/${saved.sessionId}`);
  }
  void ctx.updateSessionCount();
  return true;
}

/** Create a new backend terminal session and open it in the workspace. */
async function dashboardLaunchInTerminal(
  ctx: DashboardTerminalContext,
  prompt: string,
  runner: RunnerId = "claude",
  {
    promptLabel = null,
    presetId = null,
    cwdPath = null,
    targetPath = null,
  }: {
    promptLabel?: string | null;
    presetId?: string | null;
    cwdPath?: string | null;
    targetPath?: string | null;
  } = {},
): Promise<void> {
  if (
    Math.max(ctx.sessions.length, ctx.serverSessions.length) >=
    ctx.serverMaxSessions
  ) {
    ctx.showMaxSessionsModal = true;
    return;
  }
  let createdSessionId: string | null = null;
  ctx.launching = true;
  try {
    const self = ctx as DashboardTerminalContext &
      AlpineMagics<DashboardTerminalContext>;
    const selectedTargetPath = targetPath || ctx.projectPath;
    const controllingCwd = cwdPath || selectedTargetPath;
    let xtermPromise: Promise<{ ok: true } | { ok: false; error: unknown }>;
    try {
      xtermPromise = ctx.loadXterm().then(
        () => ({ ok: true }) as const,
        (error: unknown) => ({ ok: false, error }) as const,
      );
    } catch (error) {
      xtermPromise = Promise.resolve({ ok: false, error });
    }
    const res = await dashboardFetch("/api/terminal/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "",
        projectPath: controllingCwd,
        targetPath: selectedTargetPath,
        runner,
      }),
    });
    const payload = readRecord(await res.json(), "Terminal create response");
    const error = readErrorMessage(payload);
    if (error) throw new Error(error);
    const id = readString(payload.id);
    const wsUrl = readString(payload.wsUrl);
    if (!id || !wsUrl) {
      throw new Error("Terminal create response returned an invalid payload");
    }
    const session: LocalSession = {
      id,
      runner,
      promptLabel: promptLabel || "Custom prompt",
      projectPath: selectedTargetPath,
      cwd: controllingCwd,
      targetPath: selectedTargetPath,
      startTime: Date.now(),
      lastInputTime: Date.now(),
      connected: false,
      ended: false,
      awaitingInput: false,
      outputTail: "",
      loadingPhase: "connecting",
      loadingShowSlowHint: false,
      loadingShowRetry: false,
      age: "",
      presetId,
    };
    createdSessionId = session.id;
    ctx.rememberSessionTitle(session.id, session.promptLabel);
    ctx.sessions.push(session);
    ctx._terminalRefs[session.id] = {
      retryPrompt: prompt,
      retryPromptLabel: session.promptLabel,
      retryPresetId: presetId,
      retryCwdPath: controllingCwd,
      retryTargetPath: selectedTargetPath,
    };
    dashboardArmTerminalLoadingTimers(ctx, session.id, session);
    ctx.activeSessionId = session.id;
    ctx.activeView = "workspace";
    ctx.workspacePanel = "terminal";
    await self.$nextTick();
    const xtermResult = await xtermPromise;
    if (!xtermResult.ok) throw xtermResult.error;
    ctx.connectTerminal(session.id, wsUrl);
    dashboardScheduleLaunchPrompt(ctx, session.id, prompt);
    void ctx.updateSessionCount();
  } catch (err) {
    if (createdSessionId) {
      const failedSessionId = createdSessionId;
      const refs = ctx._terminalRefs[failedSessionId];
      dashboardClearTerminalLoadingTimers(ctx, failedSessionId);
      if (refs?.cleanup) refs.cleanup();
      Reflect.deleteProperty(ctx._terminalRefs, failedSessionId);
      ctx.sessions = ctx.sessions.filter((s) => s.id !== failedSessionId);
      if (ctx.activeSessionId === failedSessionId) {
        ctx.activeSessionId = ctx.sessions[0]?.id || null;
      }
      dashboardFetch(`/api/terminal/${failedSessionId}`, {
        method: "DELETE",
      }).catch(() => {});
      void ctx.updateSessionCount();
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Maximum") || msg.includes("concurrent")) {
      ctx.showMaxSessionsModal = true;
    } else {
      ctx.showToast(msg, true);
    }
  }
  ctx.launching = false;
}

/** Bind a browser xterm instance to a backend PTY session. */
