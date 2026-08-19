/**
 * Dashboard terminal WebSocket connection and session switching helpers.
 * Use when a Workspace user attaches, retries, switches, or ends a terminal session.
 * Recovery paths retain the access and report-capture intent of the original launch.
 */

/** One attached terminal pane: the session row it shows, its xterm instance, and the socket feeding it. */
interface DashboardTerminalAttachment {
  ctx: DashboardTerminalContext;
  sessionId: string;
  session: LocalSession;
  term: XTermInstance;
  socket: WebSocket;
}

/**
 * Build the xterm instance for one terminal pane and mount it in the container.
 *
 * Error behavior: throws nothing; when the xterm assets are missing it reports the reason as a toast and returns null, so
 * the caller stops instead of attaching a socket to a pane that cannot display it.
 *
 * @param ctx - dashboard state, used for the toast shown when xterm is unavailable
 * @param container - the empty pane element the terminal is mounted into
 * @returns the terminal and its fit addon, or null when xterm could not be constructed
 */
function dashboardCreateTerminalInstance(
  ctx: DashboardTerminalContext,
  container: HTMLElement,
): { term: XTermInstance; fitAddon: FitAddonInstance } | null {
  let TerminalCtor: NonNullable<Window["Terminal"]>;
  let FitAddonCtor: new () => FitAddonInstance;
  try {
    const constructors = getXtermConstructors();
    TerminalCtor = constructors.Terminal;
    FitAddonCtor = constructors.FitAddon;
  } catch (err) {
    // xterm assets never loaded - for example the user opened the dashboard while the asset fetch was still failing.
    ctx.showToast(err instanceof Error ? err.message : String(err), true);
    return null;
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
  return { term, fitAddon };
}

/**
 * Keep the terminal sized to its pane and tell the backend whenever that size changes.
 *
 * A wrong size is visible straight away as wrapped or clipped output, so this fits on a few staggered frames as well as on
 * every later resize.
 *
 * @param container - the pane element the terminal is measured against; zero width means it is hidden and not measurable
 * @param term - the terminal whose column and row count is reported
 * @param fitAddon - the xterm fit addon that performs the measurement
 * @param socket - the session socket; a size is only sent while it is open
 * @returns the fit function plus the observer and listener the cleanup path has to release. It schedules initial fits, observes the container, and
 *   adds a window resize listener.
 */
function dashboardInstallTerminalFit(
  container: HTMLElement,
  term: XTermInstance,
  fitAddon: FitAddonInstance,
  socket: WebSocket,
): {
  doFit: () => void;
  resizeObserver: ResizeObserver;
  resizeHandler: () => void;
} {
  /** Fit the active xterm instance and report its size to the server. */
  const doFit = (): void => {
    // Zero width means the pane is hidden or mid-transition, so measuring now would lock in the wrong size.
    if (!container.offsetWidth) return;
    fitAddon.fit();
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }),
      );
    }
  };

  // Alpine transitions, font loading, and mobile panel swaps can each land on different layout frames.
  // These staggered fits catch the collapsed-first-render case before the backend locks in the wrong terminal size.
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
  return { doFit, resizeObserver, resizeHandler };
}

/**
 * Build the age label under a session row, adding an idle warning as the timeout approaches.
 *
 * The warning is what tells a user their terminal is about to be closed for them, so it replaces the plain age once the
 * deadline is close enough to act on.
 *
 * @param ctx - dashboard state, read for the configured idle timeout; zero or less disables the warning entirely
 * @param session - the session being labelled
 * @returns the label, such as "12m", "1h 4m", or "12m | Timeout in 3m"
 */
function dashboardFormatSessionAge(
  ctx: DashboardTerminalContext,
  session: LocalSession,
): string {
  const elapsed = Math.floor((Date.now() - session.startTime) / 1000);
  const mins = Math.floor(elapsed / 60);
  const hrs = Math.floor(mins / 60);
  let age = hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`;

  // No recorded input, or no configured timeout, means there is no idle deadline to warn about.
  if (!session.lastInputTime || ctx.idleTimeoutMinutes <= 0) return age;

  const idleSecs = Math.floor((Date.now() - session.lastInputTime) / 1000);
  const idleMins = Math.floor(idleSecs / 60);
  const timeout = ctx.idleTimeoutMinutes;
  const countdownAt = Math.floor(timeout * 0.97);
  const warnAt = Math.floor(timeout * 0.85);

  // Nearly out of time: the countdown replaces the age so the user can act before the session is closed for them.
  if (idleMins >= countdownAt) {
    return `${mins}m | Timeout in ${Math.max(0, timeout - idleMins)}m`;
  }
  // Getting idle: keep the age but say how long it has been sitting untouched.
  if (idleMins >= warnAt) age += ` | Idle ${idleMins}m`;
  return age;
}

/**
 * Start the half-minute ticker that keeps a session row's age label current.
 *
 * Side effect: creates an interval that stops itself once the session ends.
 *
 * @param ctx - dashboard state the label is written back into
 * @param sessionId - id of the session whose row is updated
 * @param session - the session being tracked
 * @returns the interval handle, which the cleanup path clears if the pane closes first
 */
function dashboardStartSessionAgeTicker(
  ctx: DashboardTerminalContext,
  sessionId: string,
  session: LocalSession,
): ReturnType<typeof setInterval> {
  const ageInterval = setInterval(() => {
    // The session ended, so the row drops its age label and the ticker stops with it.
    if (session.ended) {
      clearInterval(ageInterval);
      dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
        target.age = "";
      });
      return;
    }
    const age = dashboardFormatSessionAge(ctx, session);
    dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
      target.age = age;
    });
  }, 30000);
  return ageInterval;
}

/**
 * Bring a pane fully online once its socket opens: mark it connected, fit it, and start its age ticker.
 *
 * This is the moment the user's terminal stops saying "connecting" and starts showing the runner.
 *
 * @param attachment - the pane, its session, and its socket
 * @param doFit - re-measures the terminal once the pane has had a frame to settle
 * @param previousAgeInterval - ticker from an earlier attach, cleared first; null on a first connection
 * @returns the new age ticker handle
 */
function dashboardHandleTerminalSocketOpen(
  attachment: DashboardTerminalAttachment,
  doFit: () => void,
  previousAgeInterval: ReturnType<typeof setInterval> | null,
): ReturnType<typeof setInterval> {
  const { ctx, sessionId, session } = attachment;
  dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
    target.connected = true;
  });
  dashboardSetTerminalLoadingPhase(ctx, sessionId, session, "loading");
  setTimeout(doFit, TERMINAL_REFIT_RETRY_DELAY_MS);
  dashboardArmLaunchPromptNoOutputFallback(ctx, sessionId);
  dashboardMaybeSendLaunchPrompt(ctx, sessionId);

  // A reconnect reuses this pane, so the previous attach's ticker is stopped before a second one starts.
  if (previousAgeInterval) clearInterval(previousAgeInterval);
  const ageInterval = dashboardStartSessionAgeTicker(ctx, sessionId, session);
  const refs = ctx._terminalRefs[sessionId];
  // Refs are absent on the very first open, where they are written moments after this returns.
  if (refs) refs.ageInterval = ageInterval;
  return ageInterval;
}

/**
 * Show or delay the "waiting for you" badge after a chunk of runner output.
 *
 * A badge that is already up stays up immediately, while a new one is delayed slightly so a runner that is merely redrawing
 * does not make the badge flicker.
 *
 * @param attachment - the pane, its session, and its socket
 * @param reactive - the live Alpine copy of the session row, or undefined when the row has already been dropped
 * @param isAwaitingInput - whether the output suggests the runner is waiting; false leaves the badge exactly as it was
 * @returns nothing; the badge is never cleared here, only set or scheduled
 */
function dashboardApplyAwaitingInputState(
  attachment: DashboardTerminalAttachment,
  reactive: LocalSession | undefined,
  isAwaitingInput: boolean,
): void {
  // Nothing in this output suggests the runner is waiting, so the badge state is left alone.
  if (!isAwaitingInput) return;

  const { ctx, sessionId, session } = attachment;
  // The badge is already showing, so it is held up rather than re-revealed after another delay.
  if (reactive?.awaitingInput === true || session.awaitingInput === true) {
    dashboardClearAwaitingInputTimer(ctx, sessionId);
    dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
      target.awaitingInput = true;
    });
    return;
  }
  dashboardScheduleAwaitingInputReveal(ctx, sessionId, session);
}

/**
 * Write one chunk of runner output into the pane and update everything that reads from it.
 *
 * The same chunk drives four separate things the user sees: the visible text, the loading state, the paste-submit machinery,
 * and the waiting badge.
 *
 * @param attachment - the pane, its session, and its socket
 * @param output - the output chunk; an empty chunk still refreshes state from the existing tail
 * @returns nothing; the chunk is written to the terminal last, after state has settled
 */
function dashboardApplyTerminalOutput(
  attachment: DashboardTerminalAttachment,
  output: string,
): void {
  const { ctx, sessionId, session, term } = attachment;
  const reactive = ctx.sessions.find((s) => s.id === sessionId);
  const refs = ctx._terminalRefs[sessionId];
  const previousTail = reactive?.outputTail ?? session.outputTail ?? "";
  const previousAwaiting =
    reactive?.awaitingInput === true ||
    session.awaitingInput === true ||
    refs?.awaitingInputTimer !== undefined;
  const tail = (previousTail + output).slice(-5000);
  const awaitingInput = dashboardNextAwaitingInputState(
    previousAwaiting,
    previousTail,
    output,
  );
  const runnerStartupFailed = dashboardOutputLooksRunnerStartupFailure(
    tail,
    session.runner,
  );

  dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
    target.outputTail = tail;
  });
  // The runner printed a startup failure, so the pane shows that instead of pretending it is still loading.
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
      output,
    );
  }
  dashboardHandlePasteSubmitOutput(ctx, sessionId, output);
  // A launch prompt is still waiting to be sent, so this output may be the composer marker it was waiting for.
  if (refs?.launchPrompt) dashboardHandleLaunchPromptOutput(ctx, sessionId);
  dashboardApplyAwaitingInputState(attachment, reactive, awaitingInput);

  // Round-6 design: the awaitingInput badge is NEVER cleared by output chunks.
  //
  // Five rounds of trying to classify chunks (glyph allowlists, tail-end heuristics, OSC-title preservation) failed because runners emit
  // continuous spinner / redraw cycles that vary by version and accumulate over time, pushing the prompt content out of any bounded tail
  // window.
  //
  // The badge is now cleared only by signals that unambiguously mean "user moved on": 1.
  // `term.onData` - user typed in the dashboard xterm.
  // Xterm protocol replies such as focus-in/focus-out and DA responses still go to the PTY but do not clear pending paste-submit state. 2.
  //
  // Ctrl+V paste from `attachCustomKeyEventHandler` - clipboard input goes straight to the WebSocket and bypasses `term.onData`, so it shares
  // `markUserInputSent()` with the keystroke path 3.
  //
  // `dashboardSendToTerminalSession` - programmatic input from a preset launch 4.
  //
  // Session lifecycle (exit, terminal-ending error, refresh proves gone, detach-as-end) - multiple paths in this handler If the runner is
  // answered out-of-band (e.g. via Claude's remote control), the badge stays on until session exit.
  //
  // That trade-off is explicit and acceptable: a stuck badge after out-of-band answer is far less harmful than a badge that never fires at all,
  // which was the bug we shipped five rounds trying to fix.
  //
  // See .goat-flow/learning-loop/patterns/architecture.md (search: `Asymmetric trust - set state from output`) and
  // .goat-flow/learning-loop/footguns/dashboard-terminal.md (search: `Workspace terminal waiting state`).
  term.write(output);
}

/**
 * Retire a session row: stop every pending timer and mark it ended, disconnected, and no longer waiting.
 *
 * @param ctx - dashboard state holding the row and its timers
 * @param sessionId - id of the session being retired
 * @param session - the session row being updated
 * @returns nothing; safe to call more than once, which happens when an error and an exit both arrive
 */
function dashboardMarkTerminalSessionEnded(
  ctx: DashboardTerminalContext,
  sessionId: string,
  session: LocalSession,
): void {
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

/**
 * Handle the runner exiting normally: retire the row, keep it in recents, and settle any preset badge.
 *
 * @param attachment - the pane, its session, and its socket
 * @returns nothing; the row stays visible in recents so the user can still read the final output
 */
function dashboardApplyTerminalExit(
  attachment: DashboardTerminalAttachment,
): void {
  const { ctx, sessionId, session } = attachment;
  dashboardMarkTerminalSessionEnded(ctx, sessionId, session);
  ctx.rememberRecentSession(session);
  ctx._forgetSavedSession(sessionId);

  // A preset badge left spinning would never settle now that the session running it is gone.
  if (session.presetId && ctx.promptRunStates[session.presetId] === "running") {
    ctx.promptRunStates[session.presetId] = "pass";
  }
  void ctx.updateSessionCount();
}

/**
 * Show a backend error in the pane, retiring the session when the error was fatal to it.
 *
 * @param attachment - the pane, its session, and its socket
 * @param message - the error text, written into the terminal in red so it stands apart from runner output
 * @returns nothing; a non-fatal error leaves the session connected and usable
 */
function dashboardApplyTerminalError(
  attachment: DashboardTerminalAttachment,
  message: string,
): void {
  const { ctx, sessionId, session, term } = attachment;
  const terminalEnded = dashboardTerminalErrorEndsSession(message);

  // The pane never finished loading, so the error replaces the spinner rather than hiding behind it.
  if (session.loadingPhase !== "ready") {
    dashboardSetTerminalLoadingPhase(ctx, sessionId, session, "error", message);
  }
  // Some errors kill the session outright, so the row is retired rather than left looking reconnectable.
  if (terminalEnded) {
    dashboardMarkTerminalSessionEnded(ctx, sessionId, session);
    ctx._forgetSavedSession(sessionId);
    void ctx.updateSessionCount();
  }
  term.write(`\r\n\x1b[31m${message}\x1b[0m\r\n`);
}

/**
 * Route one WebSocket frame to the handler for its message type.
 *
 * Error behavior: throws nothing; a malformed frame swallows its error, because one bad message must not tear down a
 * working terminal.
 *
 * @param attachment - the pane, its session, and its socket
 * @param event - the raw message event; non-string data is ignored, as this protocol is JSON text only
 * @returns nothing; an unrecognised message type is ignored
 */
function dashboardRouteTerminalMessage(
  attachment: DashboardTerminalAttachment,
  event: MessageEvent,
): void {
  const { ctx, sessionId, session, socket } = attachment;
  try {
    // A stale socket from an earlier attach must not write into the pane the user is looking at now.
    if (ctx._terminalRefs[sessionId]?.ws !== socket) return;
    // Binary frames are not part of this protocol, so anything but text is ignored.
    if (typeof event.data !== "string") return;

    const msg = readRecord(JSON.parse(event.data), "Terminal message");
    switch (readString(msg.type)) {
      case "output":
        // An output frame without string data is malformed, so nothing is written to the pane.
        if (typeof msg.data === "string") {
          dashboardApplyTerminalOutput(attachment, msg.data);
        }
        break;
      case "exit":
        dashboardApplyTerminalExit(attachment);
        break;
      case "error":
        // An error frame with no message has nothing to show the user.
        if (typeof msg.message === "string") {
          dashboardApplyTerminalError(attachment, msg.message);
        }
        break;
      case "shutdown":
        dashboardMarkTerminalSessionEnded(ctx, sessionId, session);
        break;
      default:
        break;
    }
  } catch {
    /* ignore malformed messages */
  }
}

/**
 * Wire the socket's close and error events back to the session row.
 *
 * Both mark the row disconnected, which is what turns the pane's live terminal into a Reconnect button.
 *
 * @param attachment - the pane, its session, and its socket
 * @returns nothing; events from a socket that is no longer this pane's are ignored
 */
function dashboardBindTerminalSocketLifecycle(
  attachment: DashboardTerminalAttachment,
): void {
  const { ctx, sessionId, session, socket } = attachment;

  /** Handle the terminal WebSocket closing. */
  socket.onclose = () => {
    // A stale socket closing must not mark the pane the user is currently looking at as disconnected.
    if (ctx._terminalRefs[sessionId]?.ws !== socket) return;
    dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
      target.connected = false;
    });
    void ctx.updateSessionCount();
  };

  /** Handle terminal WebSocket errors. */
  socket.onerror = () => {
    if (ctx._terminalRefs[sessionId]?.ws !== socket) return;
    // The pane never finished loading, so the failure replaces the spinner instead of appearing behind a live terminal.
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
}

/**
 * Send the clipboard to the runner as one bracketed paste. Runs when the user presses Ctrl+V in a Workspace terminal.
 *
 * Error behavior: throws nothing; a denied clipboard read swallows its error because the browser has already shown the user its own prompt.
 *
 * @param socket - the session socket; a closed socket drops the paste rather than queueing it
 * @param markUserInputSent - records that the user acted, clearing the waiting badge and resetting the idle clock
 * @returns nothing; an empty clipboard sends nothing at all
 */
function dashboardSendClipboardPaste(
  socket: WebSocket,
  markUserInputSent: () => void,
): void {
  navigator.clipboard
    .readText()
    .then((text) => {
      // Nothing on the clipboard, or a session that already closed, leaves nothing to send.
      if (!text || socket.readyState !== WebSocket.OPEN) return;

      // Bracketed-paste markers tell runners "this is one paste, do not submit on internal newlines." Copilot in particular submits on every
      // '\n' without these markers, so multi-line clipboard text gets fragmented across queries.
      //
      // Claude / Codex / Antigravity composers tolerate raw multi-line text but still benefit from the explicit marker, so wrap
      // unconditionally.
      const prepared = dashboardPreparePasteBody(text);
      const bracketedPaste = "\x1b[200~" + prepared + "\x1b[201~";
      // The server accepts terminal input only under `data`; any other field name is rejected and the paste never reaches the runner.
      socket.send(JSON.stringify({ type: "input", data: bracketedPaste }));
      markUserInputSent();
    })
    // For example the user declined the browser's clipboard permission prompt; the browser already told them, so nothing more is shown.
    .catch(() => {});
}

/**
 * Wire keyboard, typing, and resize events from the terminal back to the backend session.
 *
 * Ctrl+V and Ctrl+C are intercepted because a user expects them to mean paste and copy in a browser, while a raw terminal
 * would send them straight to the runner as control codes.
 *
 * @param attachment - the pane, its session, and its socket
 * @param markUserInputSent - records that the user acted, clearing the waiting badge and resetting the idle clock
 * @returns nothing; it swallows input sent while the socket is closed rather than queueing it, so a reconnect never replays old keystrokes
 */
function dashboardInstallTerminalInputHandlers(
  attachment: DashboardTerminalAttachment,
  markUserInputSent: () => void,
): void {
  const { term, socket } = attachment;

  term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
    // Ctrl+V: clipboard text never reaches term.onData, so the paste is read and sent from here instead.
    if (e.type === "keydown" && e.ctrlKey && e.key === "v") {
      e.preventDefault();
      dashboardSendClipboardPaste(socket, markUserInputSent);
      return false;
    }
    // Ctrl+C with text selected means copy, not interrupt - the runner should not see a SIGINT here.
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
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "input", data }));
    }
    // Xterm protocol replies such as focus events are not the user typing, so they must not clear the waiting badge.
    if (!dashboardTerminalDataLooksProtocolResponse(data)) markUserInputSent();
  });

  term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  });
}

/**
 * Build the teardown that releases every browser resource this pane holds.
 *
 * Runs when the user closes a terminal, switches project, or leaves the page; missing any one of these leaves a listener or
 * timer running against a pane that is no longer on screen.
 *
 * @param attachment - the pane, its session, and its socket
 * @param fit - the resize observer and window listener installed for this pane
 * @param getAgeInterval - reads the current age ticker, which is null when the socket never opened
 * @returns the cleanup function stored on the pane's refs; it swallows teardown errors so one dead listener cannot block the rest
 */
function dashboardBuildTerminalCleanup(
  attachment: DashboardTerminalAttachment,
  fit: { resizeObserver: ResizeObserver; resizeHandler: () => void },
  getAgeInterval: () => ReturnType<typeof setInterval> | null,
): () => void {
  const { ctx, sessionId, term, socket } = attachment;
  return () => {
    fit.resizeObserver.disconnect();
    window.removeEventListener("resize", fit.resizeHandler);

    const ageInterval = getAgeInterval();
    // Null means the socket never opened, so no ticker was ever started for this pane.
    if (ageInterval) clearInterval(ageInterval);
    dashboardClearAwaitingInputTimer(ctx, sessionId);
    dashboardClearPasteSubmitState(ctx, sessionId);
    dashboardClearLaunchPrompt(ctx, sessionId);
    dashboardClearTerminalLoadingTimers(ctx, sessionId);

    try {
      socket.close();
    } catch {
      /* ignore: a socket that is already closed needs no closing */
    }
    try {
      term.dispose();
    } catch {
      /* ignore: a terminal that is already disposed needs no disposal */
    }
  };
}

/**
 * Attach one browser terminal pane to its backend session over a WebSocket.
 *
 * This is what runs after a user clicks Launch or Reconnect: the pane is mounted, sized, wired to the socket, and
 * focused so they can start typing straight away.
 *
 * @param ctx - dashboard state holding the session rows and pane refs
 * @param sessionId - the session being attached; an id with no row or no pane element is a no-op
 * @param wsUrl - backend socket path returned by the create call
 * @returns nothing. It mounts an xterm instance in the pane, opens a WebSocket, and registers the pane's refs and
 *   cleanup; a failure to construct xterm reports as a toast and leaves the pane empty.
 */
function dashboardConnectTerminal(
  ctx: DashboardTerminalContext,
  sessionId: string,
  wsUrl: string,
): void {
  const session = ctx.sessions.find((s) => s.id === sessionId);
  // The row was cleared while this connect was queued, so there is nothing left to attach.
  if (!session) return;
  const container = document.getElementById(`gf-terminal-${sessionId}`);
  // The pane is not in the DOM, which happens when the user switched view before the connect ran.
  if (!container) return;

  container.innerHTML = "";
  const view = dashboardCreateTerminalInstance(ctx, container);
  // A null view means xterm could not be built, and the user has already been told why.
  if (!view) return;

  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(
    `${proto}//${location.host}${dashboardTerminalWsPath(wsUrl)}`,
  );
  const attachment: DashboardTerminalAttachment = {
    ctx,
    sessionId,
    session,
    term: view.term,
    socket,
  };
  const fit = dashboardInstallTerminalFit(
    container,
    view.term,
    view.fitAddon,
    socket,
  );

  let ageInterval: ReturnType<typeof setInterval> | null = null;
  socket.onopen = () => {
    ageInterval = dashboardHandleTerminalSocketOpen(
      attachment,
      fit.doFit,
      ageInterval,
    );
  };
  socket.onmessage = (event: MessageEvent) => {
    dashboardRouteTerminalMessage(attachment, event);
  };
  dashboardBindTerminalSocketLifecycle(attachment);

  /** Record that the user just typed or pasted, which drops the waiting badge and restarts the idle clock. */
  const markUserInputSent = (): void => {
    const lastInputTime = Date.now();
    dashboardClearAwaitingInputTimer(ctx, sessionId);
    dashboardClearPasteSubmitState(ctx, sessionId);
    dashboardMutateLocalSession(ctx, sessionId, session, (target) => {
      target.lastInputTime = lastInputTime;
      target.awaitingInput = false;
    });
  };
  dashboardInstallTerminalInputHandlers(attachment, markUserInputSent);

  ctx._terminalRefs[sessionId] = {
    ...ctx._terminalRefs[sessionId],
    ws: socket,
    xterm: view.term,
    cleanup: dashboardBuildTerminalCleanup(attachment, fit, () => ageInterval),
  };
  view.term.focus();
}

/**
 * End the terminal the user just closed and release everything the pane was holding.
 * It swallows the failure of the server-side delete, because the pane is already gone from the user's screen either way.
 *
 * @param ctx - live Alpine terminal context
 * @param sessionId - session the user closed; an unknown id does nothing
 */
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

/**
 * Retry a session that never produced output, reusing the prompt the user originally launched with.
 * A session restored from the server has no recorded prompt, so it is left intact rather than restarted empty; it reports other failures
 * through the pane's own error state.
 *
 * @param ctx - live Alpine terminal context
 * @param sessionId - session the user asked to retry
 */
async function dashboardRetryTerminalSession(
  ctx: DashboardTerminalContext,
  sessionId: string,
): Promise<void> {
  const session = ctx.sessions.find((s) => s.id === sessionId);
  if (!session) return;
  const refs = ctx._terminalRefs[sessionId];
  // A server-rehydrated session has no reproducible launch prompt. Keep it
  // intact instead of deleting it and silently starting an empty retry.
  if (!dashboardHasTerminalRetryPrompt(refs)) {
    session.loadingShowRetry = false;
    return;
  }
  const prompt = refs?.retryPrompt ?? refs?.launchPrompt ?? "";
  const runner = session.runner;
  const promptLabel = refs?.retryPromptLabel ?? session.promptLabel;
  const presetId = refs?.retryPresetId ?? session.presetId;
  const cwdPath = refs?.retryCwdPath ?? session.cwd;
  const targetPath = refs?.retryTargetPath ?? session.targetPath;
  const accessMode = refs?.retryAccessMode ?? session.accessMode;
  // Rehydrated sessions may have no launch ref, so retry falls back to their server-backed intent.
  const captureQualityDrafts =
    refs?.retryCaptureQualityDrafts ?? session.captureQualityDrafts;
  // A null owner means the original launch did not choose a mode-specific quality destination.
  const qualityReportProjectPath =
    refs?.retryQualityReportProjectPath ?? session.qualityReportProjectPath;

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
    accessMode,
    captureQualityDrafts,
    ...(qualityReportProjectPath ? { qualityReportProjectPath } : {}),
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
  // Existing browser rows refresh their authority from the backend before a reconnect or retry.
  if (local) {
    local.accessMode = serverSession.accessMode;
    local.captureQualityDrafts = serverSession.captureQualityDrafts;
    local.qualityReportProjectPath = serverSession.qualityReportProjectPath;
    ctx.activeSessionId = local.id;
    ctx.activeView = "workspace";
    ctx.workspacePanel = "terminal";
    if (!local.connected) {
      const refs = ctx._terminalRefs[local.id];
      dashboardClearTerminalLoadingTimers(ctx, local.id);
      if (refs?.cleanup) refs.cleanup();
      ctx._terminalRefs[local.id] = {
        ...ctx._terminalRefs[local.id],
        retryPromptLabel: local.promptLabel,
        retryPresetId: null,
        retryCwdPath: local.cwd,
        retryTargetPath: local.targetPath,
        retryAccessMode: local.accessMode,
        retryCaptureQualityDrafts: local.captureQualityDrafts,
        retryQualityReportProjectPath: local.qualityReportProjectPath,
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
    accessMode: serverSession.accessMode,
    captureQualityDrafts: serverSession.captureQualityDrafts,
    qualityReportProjectPath: serverSession.qualityReportProjectPath,
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
    retryPromptLabel: session.promptLabel,
    retryPresetId: null,
    retryCwdPath: session.cwd,
    retryTargetPath: session.targetPath,
    retryAccessMode: session.accessMode,
    retryCaptureQualityDrafts: session.captureQualityDrafts,
    retryQualityReportProjectPath: session.qualityReportProjectPath,
  };
  dashboardArmTerminalLoadingTimers(ctx, session.id, session);
  ctx.activeSessionId = session.id;
  ctx.activeView = "workspace";
  ctx.workspacePanel = "terminal";
  await self.$nextTick();
  ctx.connectTerminal(session.id, `/ws/terminal/${serverSession.id}`);
}

/**
 * End a session on the server, whether or not this browser still has a pane for it.
 * It swallows the delete failure, because a session that is already gone is the expected case when cleaning up stale rows.
 *
 * @param ctx - live Alpine terminal context
 * @param sessionId - session to terminate
 */
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
