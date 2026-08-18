/**
 * Dashboard terminal launch flow, part 5: the awaiting-input badge persists across output volume and spinner
 * frames (held by an OSC title alone) and clears only on user input or session exit, per-session; plus runner
 * readiness detection for fresh launches - distinguishing a real composer from auth/config-failure output - that
 * gates when launch prompts are sent.
 */
import {
  assert,
  createFakeTimers,
  delay,
  describe,
  it,
  loadHelpers,
  loadFixture,
  makeBrowserTerminalGlobals,
  makeContext,
  makeLaunchPromptContext,
  makeTerminalSession,
} from "./helpers.js";

describe("dashboard terminal launch flow", () => {
  it("keeps the badge on for Codex's sustained-CUP idle state held by OSC title alone", () => {
    // Round-5 finding (browser-extension live trace): in a long-running Codex
    // session in steady-state waiting, CUP positioning escapes fill the tail
    // so the visible plain-text content is ~100 chars - the question phrase
    // and numbered choices are NOT in the window. The signal that holds the
    // badge is Codex's window-title broadcast `[ ! ] Action Required`. The
    // R4 tail check MUST pass raw bytes so the OSC title is extracted by
    // `dashboardTerminalTitlesFromOutput` before normalization. A
    // normalize-first slice would strip the OSC entirely and clear the badge
    // on the next spinner chunk.
    const { globals, sockets } = makeBrowserTerminalGlobals();
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
      globals,
    );
    const session = {
      id: "session-codex-sustained",
      runner: "codex" as const,
      promptLabel: "Codex sustained CUP test",
      projectPath: "/tmp/example",
      cwd: "/tmp/example",
      targetPath: "/tmp/example",
      startTime: Date.now(),
      lastInputTime: Date.now(),
      connected: false,
      ended: false,
      awaitingInput: false,
      outputTail: "",
      loadingPhase: "ready",
      loadingShowSlowHint: false,
      loadingShowRetry: false,
      age: "",
      presetId: null,
    };
    const ctx = makeContext({
      activeSessionId: "session-codex-sustained",
      sessions: [session],
      _terminalRefs: { "session-codex-sustained": {} },
    });
    helpers.dashboardConnectTerminal(
      ctx,
      "session-codex-sustained",
      "/ws/terminal/session-codex-sustained",
    );
    const socket = sockets[0];
    assert.ok(socket);
    socket.onopen?.();

    // Sustained CUP redraw (~4400 bytes of cursor positioning) wrapping an
    // OSC title broadcast that signals attention.
    const cupNoise = Array(400)
      .fill("\x1b[5;1H\x1b[2K \x1b[6;1H\x1b[2K ")
      .join("");
    socket.onmessage?.({
      data: JSON.stringify({
        type: "output",
        data:
          cupNoise.slice(0, 2200) +
          "\x1b]0;[ ! ] Action Required | goat-flow\x07" +
          cupNoise.slice(0, 2200),
      }),
    });
    timers.tick(1500);
    assert.equal(
      session.awaitingInput,
      true,
      "Codex badge fires via OSC title even when plain-text content is mostly empty",
    );

    // Next chunk is an unknown spinner glyph - badge must stay on because
    // the OSC title is still in the raw tail window.
    socket.onmessage?.({
      data: JSON.stringify({ type: "output", data: "\r\x1b[2m⚡\x1b[0m" }),
    });
    assert.equal(
      session.awaitingInput,
      true,
      "Codex badge survives unknown spinner chunk because OSC title is still in raw tail",
    );
  });

  it("badge persists across arbitrary output volume - only user input clears", () => {
    // Regression guard: output chunks can never clear the awaiting badge.
    // Five rounds of trying to classify chunks (glyph allowlists, tail-end
    // heuristics, OSC-title preservation) failed because runners emit
    // continuous spinner/redraw cycles that vary by version and accumulate
    // over time, eventually pushing the prompt out of any bounded tail
    // window. The badge is now cleared only by signals that unambiguously
    // mean "user moved on": term.onData, sendToTerminalSession, lifecycle.
    const { globals, sockets } = makeBrowserTerminalGlobals();
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
      globals,
    );
    const session = makeTerminalSession({
      id: "session-persist",
      runner: "claude" as const,
      promptLabel: "Persistence test",
      connected: false,
      age: "",
    });
    const ctx = makeContext({
      activeSessionId: "session-persist",
      sessions: [session],
      _terminalRefs: { "session-persist": {} },
    });
    helpers.dashboardConnectTerminal(
      ctx,
      "session-persist",
      "/ws/terminal/session-persist",
    );
    const socket = sockets[0];
    assert.ok(socket);
    socket.onopen?.();
    // Prompt arrives and the reveal timer fires.
    socket.onmessage?.({
      data: JSON.stringify({
        type: "output",
        data:
          "Do you want to proceed?\n❯ 1. Yes\n  2. No\n\n" +
          "Esc to cancel · Tab to amend · ctrl+e to explain",
      }),
    });
    timers.tick(1500);
    assert.equal(session.awaitingInput, true);

    // A LARGE block of output arrives - under the round-6 contract this
    // must NOT clear the badge. Pre-round-6, this output would push the
    // prompt out of the visible tail window and the badge would clear.
    const bigOutput = "Tool output line " + "x".repeat(8000);
    socket.onmessage?.({
      data: JSON.stringify({ type: "output", data: bigOutput }),
    });
    assert.equal(
      session.awaitingInput,
      true,
      "badge must persist across large output - only user input or lifecycle clears",
    );

    // Many spinner cycles accumulate.
    const spinnerOn =
      "\r\x1b[25A\x1b[38;5;246m●\x1b[39m\r" +
      "\r\n".repeat(25) +
      "\x1b[1C\x1b[4A\x1b[1D\x1b[4B";
    for (let i = 0; i < 100; i += 1) {
      socket.onmessage?.({
        data: JSON.stringify({ type: "output", data: spinnerOn }),
      });
    }
    assert.equal(
      session.awaitingInput,
      true,
      "badge survives 100 spinner cycles (~9000 accumulated bytes)",
    );
  });

  it("badge clears when the user types in the dashboard xterm (term.onData)", () => {
    // User input is the authoritative clear signal; term.onData fires for
    // any keystroke routed through the xterm widget.
    const { globals, sockets } = makeBrowserTerminalGlobals();
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
      globals,
    );
    const session = makeTerminalSession({
      id: "session-userinput",
      runner: "claude" as const,
      promptLabel: "User-input test",
      connected: false,
      age: "",
    });
    const ctx = makeContext({
      activeSessionId: "session-userinput",
      sessions: [session],
      _terminalRefs: { "session-userinput": {} },
    });
    helpers.dashboardConnectTerminal(
      ctx,
      "session-userinput",
      "/ws/terminal/session-userinput",
    );
    const socket = sockets[0];
    assert.ok(socket);
    socket.onopen?.();
    socket.onmessage?.({
      data: JSON.stringify({
        type: "output",
        data:
          "Do you want to proceed?\n❯ 1. Yes\n  2. No\n\n" +
          "Esc to cancel · Tab to amend · ctrl+e to explain",
      }),
    });
    timers.tick(1500);
    assert.equal(session.awaitingInput, true);

    // User answers via xterm. dashboardSendToTerminalSession is the dashboard
    // path that simulates the same effect as term.onData - both clear the
    // badge by directly mutating session.awaitingInput.
    const sent = helpers.dashboardSendToTerminalSession(
      ctx,
      "session-userinput",
      "1",
      { adapt: false },
    );
    assert.equal(sent, true);
    assert.equal(
      session.awaitingInput,
      false,
      "badge clears immediately when user input is sent through the dashboard",
    );
  });

  it("clearing one session's badge does not affect another session", () => {
    // Multi-session independence: each LocalSession.awaitingInput is a
    // per-session field, mutations target a specific session id, and clears
    // from one session's input must NOT touch any other session's state.
    const { globals, sockets } = makeBrowserTerminalGlobals();
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
      globals,
    );
    /**
     * Builds sessions that differ only by id/runner so the test isolates
     * per-session awaitingInput mutation.
     */
    function makeAwaitingSession(id: string, runner: "claude" | "codex") {
      return {
        id,
        runner,
        promptLabel: `${id} test`,
        projectPath: "/tmp/example",
        cwd: "/tmp/example",
        targetPath: "/tmp/example",
        startTime: Date.now(),
        lastInputTime: Date.now(),
        connected: false,
        ended: false,
        awaitingInput: false,
        outputTail: "",
        loadingPhase: "ready",
        loadingShowSlowHint: false,
        loadingShowRetry: false,
        age: "",
        presetId: null,
      };
    }
    const firstSession = makeAwaitingSession("multi-a", "claude");
    const secondSession = makeAwaitingSession("multi-b", "codex");
    const thirdSession = makeAwaitingSession("multi-c", "claude");
    const ctx = makeContext({
      activeSessionId: "multi-a",
      sessions: [firstSession, secondSession, thirdSession],
      _terminalRefs: {
        "multi-a": {},
        "multi-b": {},
        "multi-c": {},
      },
    });
    for (const id of ["multi-a", "multi-b", "multi-c"]) {
      helpers.dashboardConnectTerminal(ctx, id, `/ws/terminal/${id}`);
    }
    const [skA, skB, skC] = sockets;
    [skA, skB, skC].forEach((s) => s?.onopen?.());

    // Each session receives a prompt and the reveal fires.
    for (const sock of [skA, skB, skC]) {
      sock?.onmessage?.({
        data: JSON.stringify({
          type: "output",
          data:
            "Do you want to proceed?\n❯ 1. Yes\n  2. No\n\n" +
            "Esc to cancel · Tab to amend · ctrl+e to explain",
        }),
      });
    }
    timers.tick(1500);
    assert.equal(firstSession.awaitingInput, true, "A fires");
    assert.equal(secondSession.awaitingInput, true, "B fires");
    assert.equal(thirdSession.awaitingInput, true, "C fires");

    // Clear only session B's badge by sending input there.
    const wasDelivered = helpers.dashboardSendToTerminalSession(
      ctx,
      "multi-b",
      "1",
      {
        adapt: false,
      },
    );
    assert.equal(wasDelivered, true);
    assert.equal(
      secondSession.awaitingInput,
      false,
      "B cleared by its own input",
    );
    assert.equal(firstSession.awaitingInput, true, "A unaffected by B's input");
    assert.equal(thirdSession.awaitingInput, true, "C unaffected by B's input");
  });

  it("session exit message clears the awaitingInput badge", () => {
    // Lifecycle path: when the PTY exits (runner died, user closed it), the
    // badge must clear via the exit-message branch even if no user input
    // arrived first. Pins one of the three input-side clear paths from R6.
    const { globals, sockets } = makeBrowserTerminalGlobals();
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
      globals,
    );
    const session = makeTerminalSession({
      id: "session-exit",
      runner: "claude" as const,
      promptLabel: "Exit test",
      connected: false,
      age: "",
    });
    const ctx = makeContext({
      activeSessionId: "session-exit",
      sessions: [session],
      _terminalRefs: { "session-exit": {} },
    });
    helpers.dashboardConnectTerminal(
      ctx,
      "session-exit",
      "/ws/terminal/session-exit",
    );
    const socket = sockets[0];
    assert.ok(socket);
    socket.onopen?.();
    socket.onmessage?.({
      data: JSON.stringify({
        type: "output",
        data:
          "Do you want to proceed?\n❯ 1. Yes\n  2. No\n\n" +
          "Esc to cancel · Tab to amend · ctrl+e to explain",
      }),
    });
    timers.tick(1500);
    assert.equal(session.awaitingInput, true);

    // PTY exits before user answers - lifecycle MUST clear the badge,
    // otherwise terminated sessions would render as "Waiting" forever.
    socket.onmessage?.({
      data: JSON.stringify({ type: "exit", code: 0, signal: null }),
    });
    assert.equal(session.ended, true, "exit message marks session ended");
    assert.equal(
      session.awaitingInput,
      false,
      "exit message clears awaitingInput badge",
    );
  });

  it("keeps awaiting state across Codex's lone-bullet spinner frame (◦ U+25E6)", () => {
    // Round-3 live trace (2026-05-21): after the round-2 fix Claude was stable
    // but Codex still flickered. Codex's idle-spinner glyph is `◦` (U+25E6
    // WHITE BULLET), painted via `CUP \x1b[28;1H\x1b[2m` dim. The round-2
    // character class `[●✻✢✳✶*•·]` did not include `◦`, so every spinner tick still
    // returned false from `dashboardNextAwaitingInputState` and the badge
    // flickered set→clear within ~100ms on a 2.4s cadence. Also exercised
    // braille spinners (U+2800–U+28FF) used by many other CLIs.
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const prompt =
      "Would you like to run the following command?\n› 1. Yes, proceed\n  2. No, suggest changes\nPress enter to confirm or esc to cancel";
    const codexBullet =
      "\r\x1b[28;1H\x1b[2m\x1b[39;49m◦\x1b[39m\x1b[49m\x1b[0m\x1b[?25l\x1b[?2026l";
    const codexBulletOff =
      "\r\x1b[28;1H\x1b[2m\x1b[39;49m \x1b[39m\x1b[49m\x1b[0m\x1b[?25l\x1b[?2026l";
    const brailleFrame = "\r\x1b[2m⠋\x1b[0m";
    // Sanity: each frame on its own is not awaiting input.
    assert.equal(helpers.dashboardOutputLooksAwaitingInput(codexBullet), false);
    assert.equal(
      helpers.dashboardOutputLooksAwaitingInput(brailleFrame),
      false,
    );
    // The Codex bullet, the off frame, and the braille tick must all KEEP
    // the awaiting state when the prompt is still in the tail.
    assert.equal(
      helpers.dashboardNextAwaitingInputState(true, prompt, codexBullet),
      true,
    );
    assert.equal(
      helpers.dashboardNextAwaitingInputState(true, prompt, codexBulletOff),
      true,
    );
    assert.equal(
      helpers.dashboardNextAwaitingInputState(true, prompt, brailleFrame),
      true,
    );
    // 8-tick simulation alternating Codex bullet-on / bullet-off must never
    // knock state down (the actual flicker reproducer).
    let isAwaitingInput = true;
    let tail = prompt;
    for (let i = 0; i < 8; i += 1) {
      const chunk = i % 2 === 0 ? codexBullet : codexBulletOff;
      isAwaitingInput = helpers.dashboardNextAwaitingInputState(
        isAwaitingInput,
        tail,
        chunk,
      );
      tail = (tail + chunk).slice(-5000);
      assert.equal(isAwaitingInput, true, `codex tick ${i} cleared the state`);
    }
    // Real Codex status output starting with `◦` followed by text must still
    // clear so the badge drops when the user has answered.
    assert.equal(
      helpers.dashboardNextAwaitingInputState(
        true,
        prompt,
        "◦ Running shell command: ls /tmp",
      ),
      false,
    );
  });

  it("detects freshly launched runner readiness before sending launch prompts", () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );

    assert.equal(
      helpers.dashboardOutputLooksReadyForLaunchPrompt(
        "/remote-control is active · Code in CLI\n\n❯  ",
      ),
      true,
    );
    assert.equal(
      helpers.dashboardOutputLooksReadyForLaunchPrompt(
        [
          "Claude Code v2.1.138",
          "/remote-control is active · Code in CLI",
          "────────────────────────────────",
          "? for shortcuts     ● high · /effort",
        ].join("\n"),
      ),
      true,
    );
    assert.equal(
      helpers.dashboardOutputLooksReadyForLaunchPrompt(
        "/remote-control is active · Code in CLI\nloading project...",
      ),
      false,
    );
  });

  it("does not treat a Codex config failure followed by a shell prompt as runner readiness", () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const output = [
      "Error loading configuration: filesystem glob path `**/*.key` only supports `none` access; use an exact path or trailing `/**` for `none` subtree access",
      "$ ",
    ].join("\n");

    assert.equal(
      helpers.dashboardOutputLooksRunnerStartupFailure(output, "codex"),
      true,
    );
    assert.equal(
      helpers.dashboardOutputLooksReadyForLaunchPrompt(output, "codex"),
      false,
    );
  });

  it("detects Antigravity readiness only after the composer appears", () => {
    // Verified live against `agy` 1.0.1 (2026-05-24 browser-use smoke):
    // - Pre-composer auth output (no `Antigravity CLI <version>` identity row
    //   yet OR no `? for shortcuts` hint) must not fire readiness.
    // - The full composer-ready signature (identity row + composer hint) must.
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );

    assert.equal(
      helpers.dashboardOutputLooksReadyForLaunchPrompt(
        [
          "Welcome to the Antigravity CLI. You are currently not signed in.",
          "Signing in...",
        ].join("\n"),
        "antigravity",
      ),
      false,
    );
    assert.equal(
      helpers.dashboardOutputLooksReadyForLaunchPrompt(
        [
          "Antigravity CLI 1.0.1",
          "thatmatthansen@gmail.com (Google AI Pro)",
          "Gemini 3.5 Flash (High)",
          "~/projects/goat-flow",
          "────────────────────────────────────────",
          ">",
          "────────────────────────────────────────",
          "? for shortcuts            Gemini 3.5 Flash (High)",
        ].join("\n"),
        "antigravity",
      ),
      true,
    );
  });

  it("detects Antigravity readiness from a real captured `agy` startup", () => {
    // Fixture captured 2026-05-24 by spawning `agy` through node-pty (see
    // scripts/capture-agy.mjs in the local investigation log). The raw bytes include
    // ANSI escapes, the Antigravity logo, "Antigravity CLI 1.0.1" identity
    // row, and the `? for shortcuts` composer hint - exactly the two anchors
    // the readiness regex relies on.
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const bytes = loadFixture("antigravity-startup.txt");
    assert.equal(
      helpers.dashboardOutputLooksReadyForLaunchPrompt(bytes, "antigravity"),
      true,
    );
  });

  it("does NOT fire Antigravity readiness on running output from another runner", () => {
    // Negative regression: the Antigravity-specific readiness regex must not
    // match a runner-busy capture from a different runner (Gemini fixture
    // retained for parser regression coverage). The `Antigravity CLI` anchor
    // is unique to `agy`, so cross-runner captures cannot trigger.
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const bytes = loadFixture("gemini-running.txt");
    assert.equal(
      helpers.dashboardOutputLooksReadyForLaunchPrompt(bytes, "antigravity"),
      false,
    );
  });

  it("does NOT fire Antigravity readiness on pre-composer auth output", () => {
    // The "signing in" spinner state must not be treated as ready - the
    // `Antigravity CLI <version>` identity row only appears AFTER auth.
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const preComposer = [
      "Welcome to the Antigravity CLI. You are currently not signed in.",
      "Signing in...",
    ].join("\n");
    assert.equal(
      helpers.dashboardOutputLooksReadyForLaunchPrompt(
        preComposer,
        "antigravity",
      ),
      false,
    );
  });

  it("sends launch prompts immediately when runner readiness is already visible", async () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const ctx = makeLaunchPromptContext();
    const session = ctx.sessions[0] as Record<string, unknown>;
    session.outputTail = [
      "Claude Code v2.1.138",
      "/remote-control is active · Code in CLI",
      "────────────────────────────────",
      "? for shortcuts     ● high · /effort",
    ].join("\n");

    helpers.dashboardScheduleLaunchPrompt(ctx, "launch-session", "run prompt");

    assert.deepStrictEqual(JSON.parse(ctx.sent[0] ?? "{}"), {
      type: "input",
      data: "\x1b[200~run prompt\x1b[201~",
    });
    helpers.dashboardHandlePasteSubmitOutput(
      ctx,
      "launch-session",
      "[Pasted text #1 +1 lines]",
    );
    await delay(1220);
    assert.deepStrictEqual(JSON.parse(ctx.sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.equal(ctx._terminalRefs["launch-session"]?.launchPrompt, undefined);
    assert.equal(
      ctx._terminalRefs["launch-session"]?.launchPromptFallbackTimer,
      undefined,
    );
  });
});
