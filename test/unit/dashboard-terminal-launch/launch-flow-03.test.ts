/**
 * Dashboard terminal launch flow, part 3: session lifecycle and the loading overlay - disconnected local
 * sessions end when refresh proves them gone, the overlay escalates slow starts and clears on first output while
 * staying per-session, WebSocket close is treated as detach until an exit/missing-session message arrives, and
 * stale ended shells reconnect to server-active sessions.
 */
import {
  assert,
  createFakeTimers,
  describe,
  it,
  loadHelpers,
  makeBrowserTerminalGlobals,
  makeContext,
  makeTerminalSession,
  readDashboardTerminalSource,
} from "./helpers.js";

/**
 * Build a failed-loading session that records cleanup and retry relaunch metadata, because the pre-output retry
 * tests need to observe both the backend-cleanup call and the relaunch arguments, which inline setup would hide.
 */
function makePreOutputRetryHarness(): {
  calls: string[];
  ctx: ReturnType<typeof makeContext>;
  helpers: ReturnType<typeof loadHelpers>;
  launchCalls: Array<{ prompt: string; runner?: string; options?: unknown }>;
  session: ReturnType<typeof makeTerminalSession>;
} {
  const calls: string[] = [];
  const helpers = loadHelpers(async (input, init) => {
    calls.push(`fetch:${init?.method ?? "GET"}:${String(input)}`);
    return { json: async () => ({ ok: true }) } as Response;
  });
  const launchCalls: Array<{
    prompt: string;
    runner?: string;
    options?: unknown;
  }> = [];
  const session = makeTerminalSession({
    id: "session-error",
    runner: "claude",
    promptLabel: "Setup Claude",
    presetId: "preset-setup",
    cwd: "/tmp/example",
    targetPath: "/tmp/target",
    loadingPhase: "connecting",
    accessMode: "reporting",
  });
  const ctx = makeContext({
    activeSessionId: "session-error",
    sessions: [session],
    _terminalRefs: {
      "session-error": {
        retryPrompt: "setup prompt",
        retryPromptLabel: "Setup Claude",
        retryPresetId: "preset-setup",
        retryCwdPath: "/tmp/example",
        retryTargetPath: "/tmp/target",
        retryAccessMode: "reporting",
        // Stub that records the backend-shell teardown the retry path must perform before relaunching.
        cleanup(): void {
          calls.push("cleanup:session-error");
        },
      },
    },
    // Stub that captures relaunch arguments without starting a second real terminal session.
    async launchInTerminal(
      prompt: string,
      runner?: string,
      options?: unknown,
    ): Promise<void> {
      launchCalls.push({ prompt, runner, options });
    },
  });
  return { calls, ctx, helpers, launchCalls, session };
}

/** Build the stale-local-session reconnect harness with call ordering exposed. */
function makeStaleReconnectHarness(): {
  calls: string[];
  ctx: ReturnType<typeof makeContext>;
  helpers: ReturnType<typeof loadHelpers>;
} {
  const calls: string[] = [];
  const helpers = loadHelpers(
    async () => ({ json: async () => ({}) }) as Response,
  );
  const endedLocal = makeTerminalSession({
    id: "session-live",
    runner: "codex",
    promptLabel: "Stale local session",
    connected: false,
    ended: true,
    awaitingInput: false,
    age: "",
  });
  const ctx = makeContext({
    activeSessionId: "session-live",
    sessions: [endedLocal],
    // Stub that records the xterm-load step in the reconnect ordering without loading real assets.
    async loadXterm(): Promise<void> {
      calls.push("loadXterm");
    },
    // Stub that records the attach call and its arguments instead of opening a real socket.
    connectTerminal(sessionId: string, wsUrl: string): void {
      calls.push(`connect:${sessionId}:${wsUrl}`);
    },
    // Stub for Alpine's post-render hook, recording where the flow yields during reconnect.
    async $nextTick(): Promise<void> {
      calls.push("$nextTick");
    },
  });
  return { calls, ctx, helpers };
}

/**
 * Build the end-session harness that records browser cleanup and recent-history state, because the end-session
 * tests assert on the cleanup, forget, and recent-history side effects together and inline setup would scatter them.
 */
function makeRecentHistoryEndHarness(): {
  calls: string[];
  ctx: ReturnType<typeof makeContext>;
  helpers: ReturnType<typeof loadHelpers>;
} {
  const calls: string[] = [];
  const helpers = loadHelpers(async (input, init) => {
    calls.push(`fetch:${init?.method ?? "GET"}:${String(input)}`);
    return { json: async () => ({ ok: true }) } as Response;
  });
  const ctx = makeContext({
    activeSessionId: "session-3",
    promptRunStates: { "preset-debug-ui": "running" },
    sessions: [
      makeTerminalSession({
        id: "session-3",
        runner: "claude",
        promptLabel: "Debug UI in Browser",
        presetId: "preset-debug-ui",
        startTime: Date.now() - 120_000,
        awaitingInput: false,
      }),
    ],
    _terminalRefs: {
      "session-3": {
        // Stub that records the per-session teardown the end flow runs.
        cleanup(): void {
          calls.push("cleanup:session-3");
        },
      },
    },
    // Stub that records which saved session the end flow drops from browser storage.
    _forgetSavedSession(sessionId: string): void {
      calls.push(`forget:${sessionId}`);
    },
    // Stub that captures the recent-history row shape so tests can assert what the rail keeps.
    rememberRecentSession(session: Record<string, unknown>): void {
      this.recentTerminalSessions.push({
        id: session.id,
        promptLabel: session.promptLabel,
        runner: session.runner,
      });
    },
  });
  return { calls, ctx, helpers };
}

describe("dashboard terminal launch flow", () => {
  it("marks disconnected local sessions ended when refresh proves they are gone", async () => {
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () =>
        ({
          json: async () => ({
            activeCount: 0,
            maxSessions: 10,
            sessions: [],
          }),
        }) as Response,
      timers,
    );
    const session = makeTerminalSession({
      id: "session-gone",
      runner: "claude",
      promptLabel: "Gone session",
      connected: false,
      awaitingInput: true,
      outputTail: "Do you want to proceed?\n1. Yes\n2. No",
      age: "",
    });
    const ctx = makeContext({
      sessions: [session],
      _terminalRefs: { "session-gone": {} },
    });

    const refresh = helpers.dashboardUpdateSessionCount(ctx);
    timers.tick(50);
    await refresh;

    assert.equal(session.ended, true);
    assert.equal(session.awaitingInput, false);
  });

  it("loading overlay escalates slow starts and clears on first output", () => {
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
    );
    const session = {
      id: "session-loading",
      runner: "claude",
      promptLabel: "Loading session",
      loadingPhase: "connecting",
      loadingShowSlowHint: false,
      loadingShowRetry: false,
      ended: false,
      outputTail: "",
    };
    const ctx = makeContext({
      sessions: [session],
      _terminalRefs: {
        "session-loading": { retryPrompt: "loading prompt" },
      },
    });

    helpers.dashboardArmTerminalLoadingTimers(ctx, "session-loading", session);

    timers.tick(2999);
    assert.equal(session.loadingShowSlowHint, false);
    assert.equal(session.loadingShowRetry, false);

    timers.tick(1);
    assert.equal(session.loadingShowSlowHint, true);
    assert.equal(session.loadingShowRetry, false);

    timers.tick(7000);
    assert.equal(session.loadingShowRetry, true);

    helpers.dashboardSetTerminalLoadingPhase(
      ctx,
      "session-loading",
      session,
      "loading",
    );
    helpers.dashboardMarkTerminalLoadingReady(
      ctx,
      "session-loading",
      session,
      "",
      "first byte",
    );

    assert.equal(session.loadingPhase, "ready");
    assert.equal(session.loadingShowSlowHint, false);
    assert.equal(session.loadingShowRetry, false);
    assert.equal(timers.pending(), 0);
  });

  it("loading overlay avoids escalation when first output arrives quickly", () => {
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
    );
    const session = {
      id: "session-fast",
      runner: "codex",
      promptLabel: "Fast session",
      loadingPhase: "connecting",
      loadingShowSlowHint: false,
      loadingShowRetry: false,
      ended: false,
      outputTail: "",
    };
    const ctx = makeContext({
      sessions: [session],
      _terminalRefs: {
        "session-fast": {},
      },
    });

    helpers.dashboardArmTerminalLoadingTimers(ctx, "session-fast", session);
    helpers.dashboardMarkTerminalLoadingReady(
      ctx,
      "session-fast",
      session,
      "",
      "first byte",
    );
    timers.tick(10000);

    assert.equal(session.loadingPhase, "ready");
    assert.equal(session.loadingShowSlowHint, false);
    assert.equal(session.loadingShowRetry, false);
    assert.equal(timers.pending(), 0);
  });

  it("loading overlay state stays per-session when switching active sessions", () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const connecting = makeTerminalSession({
      id: "session-connecting",
      runner: "claude",
      promptLabel: "Connecting session",
      loadingPhase: "connecting",
    });
    const loading = makeTerminalSession({
      id: "session-loading",
      runner: "antigravity",
      promptLabel: "Loading session",
      loadingPhase: "loading",
    });
    const ctx = makeContext({
      activeSessionId: "session-connecting",
      sessions: [connecting, loading],
      _terminalRefs: {
        "session-connecting": {},
        "session-loading": {},
      },
    });

    ctx.activeSessionId = "session-loading";
    helpers.dashboardMarkTerminalLoadingReady(
      ctx,
      "session-loading",
      loading,
      "",
      "first byte",
    );

    assert.equal(connecting.loadingPhase, "connecting");
    assert.equal(loading.loadingPhase, "ready");
  });

  it("loading overlay records pre-output errors and retries the original launch", async () => {
    const { calls, ctx, helpers, launchCalls, session } =
      makePreOutputRetryHarness();

    helpers.dashboardSetTerminalLoadingPhase(
      ctx,
      "session-error",
      session,
      "error",
      "WebSocket connection failed",
    );

    assert.equal(session.loadingPhase, "error");
    assert.equal(session.loadingError, "WebSocket connection failed");
    assert.equal(session.loadingShowRetry, true);

    await helpers.dashboardRetryTerminalSession(ctx, "session-error");

    assert.ok(calls.includes("cleanup:session-error"));
    assert.ok(calls.includes("fetch:DELETE:/api/terminal/session-error"));
    assert.deepStrictEqual(ctx.sessions, []);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(launchCalls)), [
      {
        prompt: "setup prompt",
        runner: "claude",
        options: {
          promptLabel: "Setup Claude",
          presetId: "preset-setup",
          cwdPath: "/tmp/example",
          targetPath: "/tmp/target",
          accessMode: "reporting",
          captureQualityDrafts: false,
        },
      },
    ]);
  });

  it("keeps a rehydrated session when its original retry prompt is unavailable", async () => {
    const { ctx, helpers, launchCalls, session } = makePreOutputRetryHarness();
    const refs = ctx._terminalRefs[session.id];
    if (refs) {
      delete refs.retryPrompt;
      delete refs.launchPrompt;
    }
    session.loadingShowRetry = true;

    await helpers.dashboardRetryTerminalSession(ctx, session.id);

    assert.deepStrictEqual(ctx.sessions, [session]);
    assert.deepStrictEqual(launchCalls, []);
    assert.equal(session.loadingShowRetry, false);
  });

  it("carries staged-draft capture through a retried launch", async () => {
    const { ctx, helpers, launchCalls } = makePreOutputRetryHarness();
    const refs = ctx._terminalRefs["session-error"];
    if (refs) {
      refs.retryCaptureQualityDrafts = true;
      refs.retryQualityReportProjectPath = "/tmp/report-owner";
    }

    await helpers.dashboardRetryTerminalSession(ctx, "session-error");

    // Dropping the flag here would reopen the session without a staging
    // directory, leaving the agent waiting on a receipt that never arrives.
    assert.equal(
      (launchCalls[0]?.options as { captureQualityDrafts?: boolean })
        ?.captureQualityDrafts,
      true,
    );
    assert.equal(
      (
        launchCalls[0]?.options as {
          qualityReportProjectPath?: string | null;
        }
      )?.qualityReportProjectPath,
      "/tmp/report-owner",
    );
  });

  it("falls back to rehydrated session capture metadata when retry refs are absent", async () => {
    const { ctx, helpers, launchCalls, session } = makePreOutputRetryHarness();
    session.captureQualityDrafts = true;
    session.qualityReportProjectPath = "/tmp/report-owner";

    await helpers.dashboardRetryTerminalSession(ctx, "session-error");

    assert.equal(
      (launchCalls[0]?.options as { captureQualityDrafts?: boolean })
        ?.captureQualityDrafts,
      true,
    );
    assert.equal(
      (
        launchCalls[0]?.options as {
          qualityReportProjectPath?: string | null;
        }
      )?.qualityReportProjectPath,
      "/tmp/report-owner",
    );
  });

  it("treats terminal WebSocket close as detach until an exit message arrives", () => {
    const { globals, sockets } = makeBrowserTerminalGlobals();
    const calls: string[] = [];
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
      globals,
    );
    const session = makeTerminalSession({
      id: "session-detach",
      runner: "copilot",
      promptLabel: "Detached session",
      connected: false,
      awaitingInput: true,
      outputTail: "Do you want to run this command?\n1. Yes\n2. No",
      age: "",
    });
    const ctx = makeContext({
      activeSessionId: "session-detach",
      sessions: [session],
      _terminalRefs: { "session-detach": {} },
      // Detach should refresh counts without converting the local session to ended.
      async updateSessionCount(): Promise<void> {
        calls.push("updateSessionCount");
      },
    });

    helpers.dashboardConnectTerminal(
      ctx,
      "session-detach",
      "/ws/terminal/session-detach",
    );
    const socket = sockets[0];
    assert.ok(socket);
    socket.onopen?.();
    assert.equal(session.connected, true);

    socket.onclose?.();

    assert.equal(session.connected, false);
    assert.equal(session.ended, false);
    assert.equal(session.awaitingInput, true);
    assert.deepStrictEqual(ctx.recentTerminalSessions, []);

    socket.onmessage?.({
      data: JSON.stringify({ type: "exit", code: 0, signal: null }),
    });

    assert.equal(session.ended, true);
    assert.equal(session.connected, false);
    assert.equal(session.awaitingInput, false);
  });

  it("treats missing-session WebSocket errors as true termination", () => {
    const { globals, sockets } = makeBrowserTerminalGlobals();
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
      globals,
    );
    const session = makeTerminalSession({
      id: "session-missing",
      runner: "claude",
      promptLabel: "Missing session",
      connected: false,
      awaitingInput: true,
      loadingPhase: "connecting",
      age: "",
    });
    const ctx = makeContext({
      activeSessionId: "session-missing",
      sessions: [session],
      _terminalRefs: { "session-missing": {} },
    });

    helpers.dashboardConnectTerminal(
      ctx,
      "session-missing",
      "/ws/terminal/session-missing",
    );
    const socket = sockets[0];
    assert.ok(socket);
    socket.onmessage?.({
      data: JSON.stringify({
        type: "error",
        message: "Session not found or already terminated",
      }),
    });
    socket.onclose?.();

    assert.equal(session.ended, true);
    assert.equal(session.connected, false);
    assert.equal(session.awaitingInput, false);
  });

  it("reconnects server-active sessions when an ended local shell is stale", async () => {
    const { calls, ctx, helpers } = makeStaleReconnectHarness();

    await helpers.dashboardOpenServerSession(ctx, {
      id: "session-live",
      runner: "codex",
      status: "active",
      createdAt: new Date().toISOString(),
      projectPath: "/tmp/example",
      cwd: "/tmp/example",
      targetPath: "/tmp/example",
      accessMode: "workspace",
      lastInputAt: Date.now(),
    });

    assert.equal(ctx.sessions.length, 1);
    assert.equal(ctx.sessions[0]?.id, "session-live");
    assert.equal(ctx.sessions[0]?.ended, false);
    assert.deepStrictEqual(calls, [
      "loadXterm",
      "$nextTick",
      "connect:session-live:/ws/terminal/session-live",
    ]);
  });

  it("cleans up the backend session when xterm loading fails after creation", async () => {
    const calls: string[] = [];
    const helpers = loadHelpers(async (input, init) => {
      calls.push(`fetch:${init?.method ?? "GET"}:${String(input)}`);
      if (String(input) === "/api/terminal/create") {
        return {
          json: async () => ({
            id: "session-2",
            wsUrl: "/ws/terminal/session-2",
          }),
        } as Response;
      }
      return { json: async () => ({ ok: true }) } as Response;
    });
    const ctx = makeContext({
      // Throws after backend create so the failure path must delete that shell.
      async loadXterm(): Promise<void> {
        calls.push("loadXterm");
        throw new Error("xterm.js load failed");
      },
      // Count refresh proves the failure path reconciles server state.
      async updateSessionCount(): Promise<void> {
        calls.push("updateSessionCount");
      },
      // Included so the failed path can still reach the normal attach boundary.
      async $nextTick(): Promise<void> {
        calls.push("$nextTick");
      },
    });

    await helpers.dashboardLaunchInTerminal(ctx, "", "claude", {
      promptLabel: "Manual session",
    });

    assert.equal(ctx.sessions.length, 0);
    assert.equal(ctx.activeSessionId, null);
    assert.ok(calls.includes("fetch:DELETE:/api/terminal/session-2"));
    assert.equal(ctx.toasts[0]?.isError, true);
    assert.match(ctx.toasts[0]?.msg ?? "", /xterm\.js load failed/);
  });

  it("loads xterm assets from the local dashboard asset route", () => {
    const source = readDashboardTerminalSource();
    assert.match(source, /link\.href = "\/assets\/xterm\.css"/);
    assert.match(
      source,
      /loadXtermScript\("\/assets\/xterm\.js", "xterm\.js"\)/,
    );
    assert.match(
      source,
      /loadXtermScript\("\/assets\/addon-fit\.js", "fit addon"\)/,
    );
    assert.doesNotMatch(source, /cdn\.jsdelivr\.net\/npm\/@xterm/);
  });

  it("deduplicates xterm DOM elements and removes partial inserts on retry", () => {
    const source = readDashboardTerminalSource();
    assert.match(
      source,
      /document\.querySelector<HTMLLinkElement>\(\s*'link\[rel="stylesheet"\]\[href="\/assets\/xterm\.css"\]'/,
    );
    assert.match(source, /document\.querySelector<HTMLScriptElement>/);
    assert.match(source, /element\.dataset\["loaded"\] = "true"/);
    assert.match(source, /removeXtermAssetElements\(\)/);
    assert.match(source, /xtermLoadPromise = null/);
  });

  it("keeps the launch title when a local session is ended into recent history", () => {
    const { calls, ctx, helpers } = makeRecentHistoryEndHarness();

    helpers.dashboardEndSession(ctx, "session-3");

    assert.deepStrictEqual(ctx.sessions, []);
    assert.equal(ctx.activeSessionId, null);
    assert.equal(ctx.promptRunStates["preset-debug-ui"], "pass");
    assert.deepStrictEqual(ctx.recentTerminalSessions, [
      {
        id: "session-3",
        promptLabel: "Debug UI in Browser",
        runner: "claude",
      },
    ]);
    assert.ok(calls.includes("fetch:DELETE:/api/terminal/session-3"));
    assert.ok(calls.includes("cleanup:session-3"));
    assert.ok(calls.includes("forget:session-3"));
  });

  it("detects terminal output that is awaiting interactive input", () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );

    assert.equal(
      helpers.dashboardOutputLooksAwaitingInput(
        "Do you want to proceed?\n1. Yes\n2. Yes, and remember\n3. No",
      ),
      true,
    );
    assert.equal(
      helpers.dashboardOutputLooksAwaitingInput(
        "Do\x1b[1Cyou\x1b[1Cwant\x1b[1Cto\x1b[1Cproceed?\n1. Yes\n2. Yes, and remember\n3. No",
      ),
      true,
    );
    assert.equal(
      helpers.dashboardOutputLooksAwaitingInput(
        "Bash command\ncommand -v browser-use\nEsc to cancel · Tab to amend · ctrl+e to explain",
      ),
      true,
    );
    assert.equal(
      helpers.dashboardOutputLooksAwaitingInput(
        "Bash command\ncommand -v browser-use\nEsc\x1b[1Cto\x1b[1Ccancel\x1b[1C·\x1b[1CTab\x1b[1Cto\x1b[1Camend\x1b[1C·\x1b[1Cctrl+e\x1b[1Cto\x1b[1Cexplain",
      ),
      true,
    );
    assert.equal(
      helpers.dashboardOutputLooksAwaitingInput("All checks passing\nDone."),
      false,
    );
    assert.equal(
      helpers.dashboardOutputLooksAwaitingInput(
        "Implementation plan\n1. Read files\n2. Patch code\n3. Run tests",
      ),
      false,
    );
    assert.equal(
      helpers.dashboardOutputLooksAwaitingInput(
        "Choose an option:\n1) Continue\n2) Explain\n3) Cancel",
      ),
      true,
    );
    assert.equal(
      helpers.dashboardOutputLooksAwaitingInput(
        "Do you want to run this command?\n1. Yes\n2. Yes, and don't ask again for [...] in this repo\n3. No, and tell Copilot what to do differently (Esc to stop)",
      ),
      true,
    );
    assert.equal(
      helpers.dashboardOutputLooksAwaitingInput(
        "Allow execution of [bash]\n1. Allow once\n2. Allow for this session\n3. No, suggest changes (esc)",
      ),
      true,
    );
    assert.equal(
      helpers.dashboardOutputLooksAwaitingInput(
        "Would you like to run the following command?\n1. Yes, proceed\n2. Yes, and don't ask again for commands that start with '...'\n3. No, and tell Codex what to do differently\n(esc)",
      ),
      true,
    );
    assert.equal(
      helpers.dashboardOutputLooksAwaitingInput(
        "Bash command ...\nDo you want to proceed?\n1. Yes\n2. No\nEsc to cancel · Tab to amend · ctrl+e to explain",
      ),
      true,
    );
  });
});
