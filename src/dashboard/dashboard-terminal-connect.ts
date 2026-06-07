/**
 * Dashboard terminal WebSocket connection and session switching helpers.
 */
function dashboardConnectTerminal(
  ctx: DashboardTerminalContext,
  sessionId: string,
  wsUrl: string,
): void {
  const session = ctx.sessions.find((s) => s.id === sessionId);
  if (!session) return;
  const container = document.getElementById(`gf-terminal-${sessionId}`);
  if (!container) return;
  container.innerHTML = "";
  let TerminalCtor: NonNullable<Window["Terminal"]>;
  let FitAddonCtor: new () => FitAddonInstance;
  try {
    const constructors = getXtermConstructors();
    TerminalCtor = constructors.Terminal;
    FitAddonCtor = constructors.FitAddon;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.showToast(msg, true);
    return;
  }
  const term = new TerminalCtor({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    scrollback: 10000,
    theme: {
      background: "#0f1729",
      foreground: "#f3f4f6",
      cursor: "#f3f4f6",
    },
  });
  const fitAddon = new FitAddonCtor();
  term.loadAddon(fitAddon);
  term.open(container);
  term._addonFit = fitAddon;
  /** Fit the active xterm instance and report its size to the server. */
  const doFit = (): void => {
    if (!container.offsetWidth) return;
    fitAddon.fit();
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "resize",
          cols: term.cols,
          rows: term.rows,
        }),
      );
    }
  };
  // Alpine transitions, font loading, and mobile panel swaps can each land on different
  // layout frames. These staggered fits catch the collapsed-first-render case before the
  // backend locks in the wrong terminal size.
  for (const delay of TERMINAL_INITIAL_FIT_DELAYS_MS) {
    setTimeout(doFit, delay);
  }
  const resizeObserver = new ResizeObserver(() => {
    doFit();
  });
  resizeObserver.observe(container);
  /** Handle browser resizes for the active terminal. */
  const resizeHandler = (): void => {
    doFit();
  };
  window.addEventListener("resize", resizeHandler);
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(
    `${proto}//${location.host}${dashboardTerminalWsPath(wsUrl)}`,
  );
  let ageInterval: ReturnType<typeof setInterval> | null = null;
  /** Handle the terminal WebSocket opening. */
  ws.onopen = () => {
    dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
      target.connected = true;
    });
    dashboardSetTerminalLoadingPhase(ctx, sessionId, session, "loading");
    setTimeout(doFit, TERMINAL_REFIT_RETRY_DELAY_MS);
    dashboardArmLaunchPromptNoOutputFallback(ctx, sessionId);
    dashboardMaybeSendLaunchPrompt(ctx, sessionId);
    if (ageInterval) clearInterval(ageInterval);
    ageInterval = setInterval(() => {
      if (session.ended) {
        if (ageInterval) clearInterval(ageInterval);
        dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
          target.age = "";
        });
        return;
      }
      const elapsed = Math.floor((Date.now() - session.startTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const hrs = Math.floor(mins / 60);
      let age: string;
      if (hrs > 0) age = `${hrs}h ${mins % 60}m`;
      else age = `${mins}m`;
      if (session.lastInputTime && ctx.idleTimeoutMinutes > 0) {
        const idleSecs = Math.floor(
          (Date.now() - session.lastInputTime) / 1000,
        );
        const idleMins = Math.floor(idleSecs / 60);
        const timeout = ctx.idleTimeoutMinutes;
        const countdownAt = Math.floor(timeout * 0.97);
        const warnAt = Math.floor(timeout * 0.85);
        if (idleMins >= countdownAt) {
          age = `${mins}m | Timeout in ${Math.max(0, timeout - idleMins)}m`;
        } else if (idleMins >= warnAt) {
          age += ` | Idle ${idleMins}m`;
        }
      }
      dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
        target.age = age;
      });
    }, 30000);
    if (ctx._terminalRefs[sessionId]) {
      ctx._terminalRefs[sessionId].ageInterval = ageInterval;
    }
  };
  /** Handle incoming terminal WebSocket messages. */
  ws.onmessage = (event: MessageEvent) => {
    try {
      if (ctx._terminalRefs[sessionId]?.ws !== ws) return;
      if (typeof event.data !== "string") return;
      const msg = readRecord(JSON.parse(event.data), "Terminal message");
      const type = readString(msg.type);
      if (type === "output" && typeof msg.data === "string") {
        const reactive = ctx.sessions.find((s) => s.id === sessionId);
        const refs = ctx._terminalRefs[sessionId];
        const previousTail = reactive?.outputTail ?? session.outputTail ?? "";
        const previousAwaiting =
          reactive?.awaitingInput === true ||
          session.awaitingInput === true ||
          refs.awaitingInputTimer !== undefined;
        const tail = (previousTail + msg.data).slice(-5000);
        const awaitingInput = dashboardNextAwaitingInputState(
          previousAwaiting,
          previousTail,
          msg.data,
        );
        const runnerStartupFailed = dashboardOutputLooksRunnerStartupFailure(
          tail,
          session.runner,
        );
        dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
          target.outputTail = tail;
        });
        if (runnerStartupFailed) {
          dashboardSetTerminalLoadingPhase(
            ctx,
            sessionId,
            session,
            "error",
            dashboardRunnerStartupFailureMessage(tail),
          );
        } else {
          dashboardMarkTerminalLoadingReady(
            ctx,
            sessionId,
            session,
            previousTail,
            msg.data,
          );
        }
        dashboardHandlePasteSubmitOutput(ctx, sessionId, msg.data);
        if (refs.launchPrompt)
          dashboardHandleLaunchPromptOutput(ctx, sessionId);
        if (awaitingInput) {
          if (
            reactive?.awaitingInput === true ||
            session.awaitingInput === true
          ) {
            dashboardClearAwaitingInputTimer(ctx, sessionId);
            dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
              target.awaitingInput = true;
            });
          } else {
            dashboardScheduleAwaitingInputReveal(ctx, sessionId, session);
          }
        }
        // Round-6 design: the awaitingInput badge is NEVER cleared by output
        // chunks. Five rounds of trying to classify chunks (glyph allowlists,
        // tail-end heuristics, OSC-title preservation) failed because runners
        // emit continuous spinner / redraw cycles that vary by version and
        // accumulate over time, pushing the prompt content out of any bounded
        // tail window. The badge is now cleared only by signals that
        // unambiguously mean "user moved on":
        //   1. `term.onData` - user typed in the dashboard xterm. Xterm
        //      protocol replies such as focus-in/focus-out and DA responses
        //      still go to the PTY but do not clear pending paste-submit state.
        //   2. Ctrl+V paste from `attachCustomKeyEventHandler` - clipboard
        //      input goes straight to the WebSocket and bypasses `term.onData`,
        //      so it shares `markUserInputSent()` with the keystroke path
        //   3. `dashboardSendToTerminalSession` - programmatic input from a
        //      preset launch (line ~943)
        //   4. Session lifecycle (exit, terminal-ending error, refresh proves
        //      gone, detach-as-end) - multiple paths in this handler
        // If the runner is answered out-of-band (e.g. via Claude's remote
        // control), the badge stays on until session exit. That trade-off is
        // explicit and acceptable: a stuck badge after out-of-band answer is
        // far less harmful than a badge that never fires at all, which was
        // the bug we shipped five rounds trying to fix. See
        // .goat-flow/learning-loop/lessons/design-decisions.md (search: `Three rounds of
        // the same fix shape`) and .goat-flow/learning-loop/patterns/architecture.md
        // (search: `Asymmetric trust - set state from output`).
        term.write(msg.data);
      } else if (type === "exit") {
        dashboardClearAwaitingInputTimer(ctx, sessionId);
        dashboardClearPasteSubmitState(ctx, sessionId);
        dashboardClearLaunchPrompt(ctx, sessionId);
        dashboardClearTerminalLoadingTimers(ctx, sessionId);
        dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
          target.ended = true;
          target.connected = false;
          target.awaitingInput = false;
        });
        ctx.rememberRecentSession(session);
        ctx._forgetSavedSession(sessionId);
        if (
          session.presetId &&
          ctx.promptRunStates[session.presetId] === "running"
        ) {
          ctx.promptRunStates[session.presetId] = "pass";
        }
        void ctx.updateSessionCount();
      } else if (type === "error" && typeof msg.message === "string") {
        const terminalEnded = dashboardTerminalErrorEndsSession(msg.message);
        if (session.loadingPhase !== "ready") {
          dashboardSetTerminalLoadingPhase(
            ctx,
            sessionId,
            session,
            "error",
            msg.message,
          );
        }
        if (terminalEnded) {
          dashboardClearAwaitingInputTimer(ctx, sessionId);
          dashboardClearPasteSubmitState(ctx, sessionId);
          dashboardClearLaunchPrompt(ctx, sessionId);
          dashboardClearTerminalLoadingTimers(ctx, sessionId);
          dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
            target.ended = true;
            target.connected = false;
            target.awaitingInput = false;
          });
          ctx._forgetSavedSession(sessionId);
          void ctx.updateSessionCount();
        }
        term.write(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`);
      } else if (type === "shutdown") {
        dashboardClearAwaitingInputTimer(ctx, sessionId);
        dashboardClearPasteSubmitState(ctx, sessionId);
        dashboardClearLaunchPrompt(ctx, sessionId);
        dashboardClearTerminalLoadingTimers(ctx, sessionId);
        dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
          target.ended = true;
          target.connected = false;
          target.awaitingInput = false;
        });
      }
    } catch {
      /* ignore malformed messages */
    }
  };
  /** Handle the terminal WebSocket closing. */
  ws.onclose = () => {
    if (ctx._terminalRefs[sessionId]?.ws !== ws) return;
    dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
      target.connected = false;
    });
    void ctx.updateSessionCount();
  };
  /** Handle terminal WebSocket errors. */
  ws.onerror = () => {
    if (ctx._terminalRefs[sessionId]?.ws !== ws) return;
    if (session.loadingPhase !== "ready") {
      dashboardSetTerminalLoadingPhase(
        ctx,
        sessionId,
        session,
        "error",
        "WebSocket connection failed",
      );
    }
    dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
      target.connected = false;
    });
  };
  const markUserInputSent = (): void => {
    const lastInputTime = Date.now();
    dashboardClearAwaitingInputTimer(ctx, sessionId);
    dashboardClearPasteSubmitState(ctx, sessionId);
    dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
      target.lastInputTime = lastInputTime;
      target.awaitingInput = false;
    });
  };
  term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
    if (e.type === "keydown" && e.ctrlKey && e.key === "v") {
      e.preventDefault();
      navigator.clipboard
        .readText()
        .then((text) => {
          if (text && ws.readyState === WebSocket.OPEN) {
            // Bracketed-paste markers tell runners "this is one paste, do not
            // submit on internal newlines." Copilot in particular submits on
            // every '\n' without these markers, so multi-line clipboard text
            // gets fragmented across queries. Claude / Codex / Antigravity
            // composers tolerate raw multi-line text but still benefit from
            // the explicit marker, so wrap unconditionally.
            const prepared = dashboardPreparePasteBody(text);
            const data = "\x1b[200~" + prepared + "\x1b[201~";
            ws.send(JSON.stringify({ type: "input", data }));
            markUserInputSent();
          }
        })
        .catch(() => {});
      return false;
    }
    if (
      e.type === "keydown" &&
      e.ctrlKey &&
      e.key === "c" &&
      term.hasSelection()
    ) {
      navigator.clipboard.writeText(term.getSelection()).catch(() => {});
      return false;
    }
    return true;
  });
  term.onData((data: string) => {
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: "input", data }));
    if (!dashboardTerminalDataLooksProtocolResponse(data)) markUserInputSent();
  });
  term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
  });
  /** Tear down dashboard resources before the page unloads. */
  const cleanup = (): void => {
    resizeObserver.disconnect();
    window.removeEventListener("resize", resizeHandler);
    if (ageInterval) clearInterval(ageInterval);
    dashboardClearAwaitingInputTimer(ctx, sessionId);
    dashboardClearPasteSubmitState(ctx, sessionId);
    dashboardClearLaunchPrompt(ctx, sessionId);
    dashboardClearTerminalLoadingTimers(ctx, sessionId);
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    try {
      term.dispose();
    } catch {
      /* ignore */
    }
  };
  ctx._terminalRefs[sessionId] = {
    ...ctx._terminalRefs[sessionId],
    ws,
    xterm: term,
    cleanup,
  };
  term.focus();
}

/** End a local terminal session and release its browser bindings. */
function dashboardEndSession(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  const session = ctx.sessions.find((s) => s.id === sessionId);
  if (!session) return;
  if (session.presetId && ctx.promptRunStates[session.presetId] === "running") {
    ctx.promptRunStates[session.presetId] = "pass";
  }
  if (!session.ended) {
    dashboardFetch(`/api/terminal/${sessionId}`, { method: "DELETE" }).catch(
      () => {},
    );
  }
  ctx.rememberRecentSession(session);
  const refs = ctx._terminalRefs[sessionId];
  dashboardClearTerminalLoadingTimers(ctx, sessionId);
  if (refs?.cleanup) refs.cleanup();
  Reflect.deleteProperty(ctx._terminalRefs, sessionId);
  ctx.sessions = ctx.sessions.filter((s) => s.id !== sessionId);
  ctx._forgetSavedSession(sessionId);
  if (ctx.activeSessionId === sessionId) {
    ctx.activeSessionId = ctx.sessions[0]?.id || null;
  }
  void ctx.updateSessionCount();
}

/** Exit the active terminal session from the workspace view. */
function dashboardExitTerminal(ctx: DashboardTerminalContext): void {
  if (ctx.activeSessionId) ctx.endSession(ctx.activeSessionId);
}

/** Retry a terminal session that failed or stalled before first PTY output. */
async function dashboardRetryTerminalSession(
  ctx: DashboardTerminalContext,
  sessionId: string,
): Promise<void> {
  const session = ctx.sessions.find((s) => s.id === sessionId);
  if (!session) return;
  const refs = ctx._terminalRefs[sessionId];
  const prompt = refs?.retryPrompt ?? refs?.launchPrompt ?? "";
  const runner = session.runner;
  const promptLabel = refs?.retryPromptLabel ?? session.promptLabel;
  const presetId = refs?.retryPresetId ?? session.presetId;
  const cwdPath = refs?.retryCwdPath ?? session.cwd;
  const targetPath = refs?.retryTargetPath ?? session.targetPath;

  dashboardClearTerminalLoadingTimers(ctx, sessionId);
  if (refs?.cleanup) refs.cleanup();
  Reflect.deleteProperty(ctx._terminalRefs, sessionId);
  ctx.sessions = ctx.sessions.filter((s) => s.id !== sessionId);
  if (ctx.activeSessionId === sessionId) ctx.activeSessionId = null;
  await dashboardFetch(`/api/terminal/${sessionId}`, {
    method: "DELETE",
  }).catch(() => {});

  await ctx.launchInTerminal(prompt, runner, {
    promptLabel,
    presetId,
    cwdPath,
    targetPath,
  });
}

/** Switch the workspace to an existing local terminal session. */
function dashboardSwitchToSession(
  ctx: DashboardTerminalContext,
  sessionId: string,
): void {
  if (!ctx.sessions.find((s) => s.id === sessionId)) return;
  ctx.activeSessionId = sessionId;
}

/** Attach the workspace to an existing backend terminal session. */
async function dashboardOpenServerSession(
  ctx: DashboardTerminalContext,
  serverSession: ServerSessionInfo,
): Promise<void> {
  const local = ctx.sessions.find((s) => s.id === serverSession.id && !s.ended);
  if (local) {
    ctx.activeSessionId = local.id;
    ctx.activeView = "workspace";
    ctx.workspacePanel = "terminal";
    if (!local.connected) {
      const refs = ctx._terminalRefs[local.id];
      dashboardClearTerminalLoadingTimers(ctx, local.id);
      if (refs?.cleanup) refs.cleanup();
      ctx._terminalRefs[local.id] = {
        ...ctx._terminalRefs[local.id],
        retryPrompt: "",
        retryPromptLabel: local.promptLabel,
        retryPresetId: null,
        retryCwdPath: local.cwd,
        retryTargetPath: local.targetPath,
      };
      dashboardArmTerminalLoadingTimers(ctx, local.id, local);
      const self = ctx as DashboardTerminalContext &
        AlpineMagics<DashboardTerminalContext>;
      await self.$nextTick();
      ctx.connectTerminal(local.id, `/ws/terminal/${serverSession.id}`);
    }
    return;
  }
  ctx.sessions = ctx.sessions.filter((s) => s.id !== serverSession.id);
  const self = ctx as DashboardTerminalContext &
    AlpineMagics<DashboardTerminalContext>;
  await ctx.loadXterm();
  const session: LocalSession = {
    id: serverSession.id,
    runner: serverSession.runner,
    promptLabel: ctx.sessionTitleFor(serverSession),
    projectPath: serverSession.projectPath,
    cwd: serverSession.cwd,
    targetPath: serverSession.targetPath,
    startTime: new Date(serverSession.createdAt).getTime(),
    lastInputTime: serverSession.lastInputAt || Date.now(),
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
  ctx.activeSessionId = session.id;
  ctx.activeView = "workspace";
  ctx.workspacePanel = "terminal";
  await self.$nextTick();
  ctx.connectTerminal(session.id, `/ws/terminal/${serverSession.id}`);
}

/** Terminate a backend terminal session by ID. */
async function dashboardEndServerSession(
  ctx: DashboardTerminalContext,
  sessionId: string,
): Promise<void> {
  const local = ctx.sessions.find((s) => s.id === sessionId);
  if (local) {
    ctx.endSession(sessionId);
  } else {
    await dashboardFetch(`/api/terminal/${sessionId}`, {
      method: "DELETE",
    }).catch(() => {});
  }
  void ctx.updateSessionCount();
}
