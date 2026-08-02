/**
 * Dashboard terminal launch flow, part 1: send payloads keep controlling cwd separate from the selected target
 * and route text to the requested session, single-line/non-Claude sends submit immediately, and Claude pastes
 * use the no-marker fallback (armed across xterm replies, retried while parked, ignoring a late paste echo).
 */
import {
  assert,
  createFakeTimers,
  describe,
  it,
  loadHelpers,
  makeBrowserTerminalGlobals,
  makeCapturingWebSocket,
  makeContext,
  makeTerminalSendHarness,
  makeTerminalSession,
} from "./helpers.js";

/** Build two live sessions so send-routing assertions can prove only the requested tab receives input. */
function makeRequestedSessionRoutingHarness(): {
  helpers: ReturnType<typeof loadHelpers>;
  ctx: ReturnType<typeof makeContext>;
  sent: Record<"upload" | "active", string[]>;
} {
  const helpers = loadHelpers(
    async () => ({ json: async () => ({}) }) as Response,
  );
  const sent: Record<"upload" | "active", string[]> = {
    upload: [],
    active: [],
  };
  const ctx = makeContext({
    activeSessionId: "session-active",
    sessions: [
      makeTerminalSession({
        id: "session-upload",
        runner: "claude",
        promptLabel: "Upload target",
        awaitingInput: true,
      }),
      makeTerminalSession({
        id: "session-active",
        runner: "codex",
        promptLabel: "Active target",
        awaitingInput: false,
      }),
    ],
    _terminalRefs: {
      "session-upload": {
        ws: makeCapturingWebSocket(sent.upload),
      },
      "session-active": {
        ws: makeCapturingWebSocket(sent.active),
      },
    },
  });
  return { helpers, ctx, sent };
}

describe("dashboard terminal launch flow", () => {
  it("maps read-only presets and investigator sessions to reporting access", () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );

    assert.equal(
      helpers.dashboardTerminalAccessMode({ mayWriteFiles: false }, "builder"),
      "reporting",
    );
    assert.equal(
      helpers.dashboardTerminalAccessMode({ mayWriteFiles: true }, "builder"),
      "workspace",
    );
    assert.equal(
      helpers.dashboardTerminalAccessMode(
        { mayWriteFiles: true },
        "investigator",
      ),
      "reporting",
    );
    assert.equal(
      helpers.dashboardTerminalAccessMode(null, "builder"),
      "reporting",
    );
  });

  it("honors explicit workspace access for dynamic write-oriented prompts", async () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      { setTimeout, clearTimeout, setInterval, clearInterval },
      { window: { __GOAT_FLOW_DEFAULT_PATH__: "/tmp/controller" } },
    );
    const launches: Array<Record<string, unknown>> = [];
    const ctx = makeContext({
      allPresets: [],
      userRole: "builder",
      async launchInTerminal(
        prompt: string,
        runner: string,
        options: Record<string, unknown>,
      ): Promise<void> {
        launches.push({ prompt, runner, ...options });
      },
    });

    await helpers.dashboardLaunchPreset(
      ctx,
      "repair the harness",
      "claude",
      "Harness repair",
      { accessMode: "workspace" },
    );

    assert.equal(launches[0]?.accessMode, "workspace");
    assert.match(
      String(launches[0]?.prompt),
      /this preset may write only after the prompt or user explicitly approves it/u,
    );
    assert.doesNotMatch(String(launches[0]?.prompt), /reporting-only/u);
  });

  it("describes native Claude enforcement only for reporting Claude launches", async () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      { setTimeout, clearTimeout, setInterval, clearInterval },
      { window: { __GOAT_FLOW_DEFAULT_PATH__: "/tmp/controller" } },
    );
    const launches: Array<Record<string, unknown>> = [];
    const ctx = makeContext({
      allPresets: [],
      userRole: "builder",
      async launchInTerminal(
        prompt: string,
        runner: string,
        options: Record<string, unknown>,
      ): Promise<void> {
        launches.push({ prompt, runner, ...options });
      },
    });

    await helpers.dashboardLaunchPreset(ctx, "review", "claude", "Review", {
      accessMode: "reporting",
    });
    await helpers.dashboardLaunchPreset(
      ctx,
      "review",
      "antigravity",
      "Review",
      { accessMode: "reporting" },
    );

    assert.match(String(launches[0]?.prompt), /Claude permission overlay/u);
    assert.doesNotMatch(
      String(launches[0]?.prompt),
      /prompt and hook guardrails/u,
    );
    assert.match(String(launches[1]?.prompt), /prompt and hook guardrails/u);
  });

  it("keeps controlling cwd and selected target separate in terminal create payloads", async () => {
    const createBodies: unknown[] = [];
    const helpers = loadHelpers(async (input, init) => {
      if (String(input) === "/api/terminal/create") {
        createBodies.push(JSON.parse(String(init?.body ?? "{}")));
        return {
          json: async () => ({
            id: "session-boundary",
            wsUrl: "/ws/terminal/session-boundary",
          }),
        } as Response;
      }
      return { json: async () => ({ ok: true }) } as Response;
    });
    const ctx = makeContext({
      projectPath: "/tmp/selected-target",
    });

    await helpers.dashboardLaunchInTerminal(ctx, "inspect target", "claude", {
      cwdPath: "/tmp/controlling-goat-flow",
      targetPath: "/tmp/selected-target",
      promptLabel: "Boundary check",
      accessMode: "reporting",
    });

    assert.deepStrictEqual(createBodies, [
      {
        prompt: "",
        projectPath: "/tmp/controlling-goat-flow",
        targetPath: "/tmp/selected-target",
        runner: "claude",
        accessMode: "reporting",
        // Reporting access alone must never request staged-draft capture, or
        // every read-only launch would build a staging tree in the target.
        captureQualityDrafts: false,
      },
    ]);
    assert.equal(ctx.sessions[0]?.cwd, "/tmp/controlling-goat-flow");
    assert.equal(ctx.sessions[0]?.targetPath, "/tmp/selected-target");
    assert.equal(ctx.sessions[0]?.projectPath, "/tmp/selected-target");
    assert.equal(ctx.sessions[0]?.accessMode, "reporting");
  });

  it("sends exactly one explicit report owner for staged-draft capture", async () => {
    const createBodies: unknown[] = [];
    const helpers = loadHelpers(async (input, init) => {
      if (String(input) === "/api/terminal/create") {
        createBodies.push(JSON.parse(String(init?.body ?? "{}")));
        return {
          json: async () => ({
            id: "session-capture-owner",
            wsUrl: "/ws/terminal/session-capture-owner",
          }),
        } as Response;
      }
      return { json: async () => ({ ok: true }) } as Response;
    });
    const ctx = makeContext({ projectPath: "/tmp/selected-target" });

    await helpers.dashboardLaunchInTerminal(ctx, "assess process", "claude", {
      cwdPath: "/tmp/controlling-goat-flow",
      targetPath: "/tmp/selected-target",
      accessMode: "reporting",
      captureQualityDrafts: true,
      qualityDraftProjectPath: "/tmp/controlling-goat-flow",
    });

    assert.deepStrictEqual(createBodies, [
      {
        prompt: "",
        projectPath: "/tmp/controlling-goat-flow",
        targetPath: "/tmp/selected-target",
        runner: "claude",
        accessMode: "reporting",
        captureQualityDrafts: true,
        qualityDraftProjectPath: "/tmp/controlling-goat-flow",
      },
    ]);
  });

  it("sends terminal text to the requested session instead of the current active tab", async () => {
    const { helpers, ctx, sent } = makeRequestedSessionRoutingHarness();

    assert.equal(
      helpers.dashboardSendToTerminalSession(
        ctx,
        "session-upload",
        "Attached files",
        { adapt: false },
      ),
      true,
    );

    assert.equal(sent.active.length, 0);
    assert.deepStrictEqual(JSON.parse(sent.upload[0] ?? "{}"), {
      type: "input",
      data: "\x1b[200~Attached files\x1b[201~",
    });
    helpers.dashboardHandlePasteSubmitOutput(
      ctx,
      "session-upload",
      "[Pasted text #1 +1 lines]",
    );
    assert.deepStrictEqual(JSON.parse(sent.upload[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.equal(sent.active.length, 0);
    assert.equal(ctx.sessions[0]?.awaitingInput, false);
  });

  it("submits single-line or non-Claude sends immediately", async () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const sent: string[] = [];
    const ctx = makeContext({
      activeSessionId: "session-upload",
      sessions: [
        {
          id: "session-upload",
          runner: "codex",
          promptLabel: "Upload target",
          projectPath: "/tmp/example",
          cwd: "/tmp/example",
          targetPath: "/tmp/example",
          startTime: Date.now(),
          lastInputTime: 0,
          connected: true,
          ended: false,
          awaitingInput: false,
          age: "0s",
          presetId: null,
        },
      ],
      _terminalRefs: {
        "session-upload": {
          ws: makeCapturingWebSocket(sent),
        },
      },
    });

    assert.equal(
      helpers.dashboardSendToTerminalSession(
        ctx,
        "session-upload",
        "Attached files",
        { adapt: false },
      ),
      true,
    );

    assert.deepStrictEqual(JSON.parse(sent[0] ?? "{}"), {
      type: "input",
      data: "\x1b[200~Attached files\x1b[201~",
    });
    assert.deepStrictEqual(JSON.parse(sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.equal(
      ctx._terminalRefs["session-upload"]?.pasteSubmitTimer,
      undefined,
    );
  });

  it("submits single-line Claude pastes immediately without waiting for the paste-text marker", async () => {
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
    );
    const sent: string[] = [];
    const ctx = makeContext({
      activeSessionId: "session-upload",
      sessions: [
        {
          id: "session-upload",
          runner: "claude",
          promptLabel: "Upload target",
          projectPath: "/tmp/example",
          cwd: "/tmp/example",
          targetPath: "/tmp/example",
          startTime: Date.now(),
          lastInputTime: 0,
          connected: true,
          ended: false,
          awaitingInput: false,
          age: "0s",
          presetId: null,
        },
      ],
      _terminalRefs: {
        "session-upload": {
          ws: makeCapturingWebSocket(sent),
        },
      },
    });

    assert.equal(
      helpers.dashboardSendToTerminalSession(
        ctx,
        "session-upload",
        "goat-flow setup . --agent claude",
        { adapt: false },
      ),
      true,
    );

    assert.deepStrictEqual(JSON.parse(sent[0] ?? "{}"), {
      type: "input",
      data: "\x1b[200~goat-flow setup . --agent claude\x1b[201~",
    });
    assert.deepStrictEqual(JSON.parse(sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.equal(
      ctx._terminalRefs["session-upload"]?.pasteSubmitTimer,
      undefined,
    );
    assert.ok(!ctx._terminalRefs["session-upload"]?.pasteSubmitAwaitingCommit);
    assert.equal(timers.pending(), 0);
  });

  it("normalizes paste bodies before wrapping them in bracketed paste markers", async () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const sent: string[] = [];
    const ctx = makeContext({
      activeSessionId: "session-upload",
      sessions: [
        {
          id: "session-upload",
          runner: "codex",
          promptLabel: "Upload target",
          projectPath: "/tmp/example",
          cwd: "/tmp/example",
          targetPath: "/tmp/example",
          startTime: Date.now(),
          lastInputTime: 0,
          connected: true,
          ended: false,
          awaitingInput: false,
          age: "0s",
          presetId: null,
        },
      ],
      _terminalRefs: {
        "session-upload": {
          ws: makeCapturingWebSocket(sent),
        },
      },
    });

    assert.equal(
      helpers.dashboardSendToTerminalSession(
        ctx,
        "session-upload",
        "first\r\nsecond\x1b[201~third\x1b[200~\rfourth",
        { adapt: false },
      ),
      true,
    );

    assert.deepStrictEqual(JSON.parse(sent[0] ?? "{}"), {
      type: "input",
      data: "\x1b[200~first\nsecondthird\nfourth\x1b[201~",
    });
    assert.deepStrictEqual(JSON.parse(sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
  });

  it("falls back quickly for Claude pasted terminal text when no paste echo arrives", async () => {
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
    );
    const sent: string[] = [];
    const ctx = makeContext({
      activeSessionId: "session-upload",
      sessions: [
        {
          id: "session-upload",
          runner: "claude",
          promptLabel: "Upload target",
          projectPath: "/tmp/example",
          cwd: "/tmp/example",
          targetPath: "/tmp/example",
          startTime: Date.now(),
          lastInputTime: 0,
          connected: true,
          ended: false,
          awaitingInput: false,
          age: "0s",
          presetId: null,
        },
      ],
      _terminalRefs: {
        "session-upload": {
          ws: makeCapturingWebSocket(sent),
        },
      },
    });

    assert.equal(
      helpers.dashboardSendToTerminalSession(
        ctx,
        "session-upload",
        "Attached files\nsecond line",
        { adapt: false },
      ),
      true,
    );

    const expectedInitialPasteSendCount = 1;
    const expectedFallbackSendCount = 2;
    assert.equal(sent.length, expectedInitialPasteSendCount);
    ctx.sessions[0]!.outputTail = "";
    timers.tick(helpers.TERMINAL_CLAUDE_PASTE_NO_MARKER_FALLBACK_DELAY_MS);
    assert.deepStrictEqual(JSON.parse(sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.equal(timers.pending(), 1);
    timers.tick(helpers.TERMINAL_PASTE_SUBMIT_RETRY_CADENCE_MS);
    assert.equal(timers.pending(), 0);
  });

  it("keeps Claude no-marker fallback armed across xterm protocol replies", () => {
    const { globals, sockets, terminals } = makeBrowserTerminalGlobals();
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
      globals,
    );
    const session = makeTerminalSession({
      id: "session-protocol",
      runner: "claude",
      promptLabel: "Protocol reply test",
      connected: false,
      age: "",
    });
    const ctx = makeContext({
      activeSessionId: "session-protocol",
      sessions: [session],
      _terminalRefs: { "session-protocol": {} },
    });

    helpers.dashboardConnectTerminal(
      ctx,
      "session-protocol",
      "/ws/terminal/session-protocol",
    );
    const socket = sockets[0];
    const term = terminals[0];
    assert.ok(socket);
    assert.ok(term);
    socket.onopen?.();

    assert.equal(
      helpers.dashboardSendToTerminalSession(
        ctx,
        "session-protocol",
        "Setup prompt\nsecond line",
        { adapt: false },
      ),
      true,
    );
    term.emitData("\x1b[?1;2c");

    const beforeFallbackInputs = socket.sent
      .map((payload) => JSON.parse(payload) as { type: string; data?: string })
      .filter((payload) => payload.type === "input")
      .map((payload) => payload.data);
    assert.deepStrictEqual(beforeFallbackInputs, [
      "\x1b[200~Setup prompt\nsecond line\x1b[201~",
      "\x1b[?1;2c",
    ]);
    assert.notEqual(
      ctx._terminalRefs["session-protocol"]?.pasteSubmitTimer,
      undefined,
      "xterm protocol replies must not clear the pending Claude fallback",
    );

    timers.tick(helpers.TERMINAL_CLAUDE_PASTE_NO_MARKER_FALLBACK_DELAY_MS);

    const afterFallbackInputs = socket.sent
      .map((payload) => JSON.parse(payload) as { type: string; data?: string })
      .filter((payload) => payload.type === "input")
      .map((payload) => payload.data);
    assert.deepStrictEqual(afterFallbackInputs.slice(-1), ["\r"]);
  });

  it("retries Claude fallback submit when the visible composer stays parked", async () => {
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
    );
    const { ctx, sent, session } = makeTerminalSendHarness({
      runner: "claude",
      session: {
        outputTail:
          "[Pasted text #1 +2 lines]\n────────────────\npaste again to expand ❯",
      },
    });

    assert.equal(
      helpers.dashboardSendToTerminalSession(
        ctx,
        "session-upload",
        "Setup prompt\nsecond line",
        { adapt: false },
      ),
      true,
    );

    const expectedInitialPasteSendCount = 1;
    const expectedFallbackSendCount = 2;
    assert.equal(sent.length, expectedInitialPasteSendCount);
    timers.tick(helpers.TERMINAL_CLAUDE_PASTE_NO_MARKER_FALLBACK_DELAY_MS);
    assert.deepStrictEqual(JSON.parse(sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });

    timers.tick(helpers.TERMINAL_PASTE_SUBMIT_RETRY_CADENCE_MS);
    assert.deepStrictEqual(JSON.parse(sent[2] ?? "{}"), {
      type: "input",
      data: "\r",
    });

    session.outputTail = "Running quality assessment";
    timers.tick(helpers.TERMINAL_PASTE_SUBMIT_RETRY_CADENCE_MS);
    assert.equal(timers.pending(), 0);
  });

  it("ignores a late Claude paste echo after the no-marker fallback submitted", async () => {
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
    );
    const sent: string[] = [];
    const ctx = makeContext({
      activeSessionId: "session-upload",
      sessions: [
        {
          id: "session-upload",
          runner: "claude",
          promptLabel: "Upload target",
          projectPath: "/tmp/example",
          cwd: "/tmp/example",
          targetPath: "/tmp/example",
          startTime: Date.now(),
          lastInputTime: 0,
          connected: true,
          ended: false,
          awaitingInput: false,
          age: "0s",
          presetId: null,
        },
      ],
      _terminalRefs: {
        "session-upload": {
          ws: makeCapturingWebSocket(sent),
        },
      },
    });

    assert.equal(
      helpers.dashboardSendToTerminalSession(
        ctx,
        "session-upload",
        "Setup prompt\nsecond line",
        { adapt: false },
      ),
      true,
    );

    const expectedInitialPasteSendCount = 1;
    const expectedFallbackSendCount = 2;
    assert.equal(sent.length, expectedInitialPasteSendCount);
    ctx.sessions[0]!.outputTail = "";
    timers.tick(helpers.TERMINAL_CLAUDE_PASTE_NO_MARKER_FALLBACK_DELAY_MS);
    assert.deepStrictEqual(JSON.parse(sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.equal(
      ctx._terminalRefs["session-upload"]?.pasteSubmitAwaitingCommit,
      false,
    );

    helpers.dashboardHandlePasteSubmitOutput(
      ctx,
      "session-upload",
      "[Pasted text #1 +2 lines]",
    );
    assert.equal(sent.length, expectedFallbackSendCount);
    timers.tick(helpers.TERMINAL_PASTE_MARKER_SETTLE_DELAY_MS);
    timers.tick(helpers.TERMINAL_PASTE_SUBMIT_RETRY_CADENCE_MS);

    assert.equal(sent.length, expectedFallbackSendCount);
    assert.equal(timers.pending(), 0);
  });

  it("retries Claude submit when output is still on the pasted-text placeholder", async () => {
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
    );
    const { ctx, sent, session } = makeTerminalSendHarness({
      runner: "claude",
      session: {
        outputTail:
          "[Pasted text #1 +2 lines]\n────────────────\npasteagaintoexpand ◉ xhigh · /effort",
      },
    });

    assert.equal(
      helpers.dashboardSendToTerminalSession(
        ctx,
        "session-upload",
        "Setup prompt\nsecond line",
        { adapt: false },
      ),
      true,
    );

    helpers.dashboardHandlePasteSubmitOutput(
      ctx,
      "session-upload",
      "[Pasted text #1 +2 lines]",
    );
    const expectedInitialPasteSendCount = 1;
    assert.equal(sent.length, expectedInitialPasteSendCount);
    timers.tick(helpers.TERMINAL_PASTE_MARKER_SETTLE_DELAY_MS);
    assert.deepStrictEqual(JSON.parse(sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.equal(timers.pending(), 1);

    timers.tick(helpers.TERMINAL_PASTE_SUBMIT_RETRY_CADENCE_MS);
    assert.deepStrictEqual(JSON.parse(sent[2] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.equal(timers.pending(), 1);

    session.outputTail = "Running quality assessment";
    timers.tick(helpers.TERMINAL_PASTE_SUBMIT_RETRY_CADENCE_MS);
    assert.equal(timers.pending(), 0);
  });
});
