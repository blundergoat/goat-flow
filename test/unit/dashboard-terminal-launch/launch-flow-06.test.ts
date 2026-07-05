/**
 * Dashboard terminal launch flow, part 6: launch-prompt delivery and workspace wiring - prompts stay queued
 * through Antigravity auth output until the composer is ready and clear/fall back on Codex config errors, the
 * awaiting-input badge is debounced and mapped into the workspace waiting state and meters, and prompts are
 * deferred until after terminal attachment.
 */
import {
  assert,
  assertExists,
  createFakeTimers,
  delay,
  describe,
  it,
  loadHelpers,
  makeLaunchPromptContext,
  PROJECT_ROOT,
  readFileSync,
  readDashboardAppSource,
  readDashboardTerminalSource,
  resolve,
  SETUP_VIEW_PATH,
  WORKSPACE_VIEW_PATH,
} from "./helpers.js";

describe("dashboard terminal launch flow", () => {
  it("keeps Antigravity launch prompts queued through auth output until the composer is ready", () => {
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
    );
    const ctx = makeLaunchPromptContext();
    const session = ctx.sessions[0] as Record<string, unknown>;
    session.runner = "antigravity";

    helpers.dashboardScheduleLaunchPrompt(
      ctx,
      "launch-session",
      "run prompt\nsecond line",
    );

    timers.tick(6000);
    assert.deepStrictEqual(ctx.sent, []);
    assert.equal(
      ctx._terminalRefs["launch-session"]?.launchPrompt,
      "run prompt\nsecond line",
    );

    session.outputTail = [
      "Welcome to the Antigravity CLI. You are currently not signed in.",
      "Signing in...",
    ].join("\n");
    helpers.dashboardHandleLaunchPromptOutput(ctx, "launch-session");
    timers.tick(2500);

    assert.deepStrictEqual(ctx.sent, []);
    assert.equal(
      ctx._terminalRefs["launch-session"]?.launchPrompt,
      "run prompt\nsecond line",
    );

    session.outputTail = `${session.outputTail}\nAntigravity CLI 1.0.1\nthatmatthansen@gmail.com\n? for shortcuts`;
    helpers.dashboardHandleLaunchPromptOutput(ctx, "launch-session");

    assert.deepStrictEqual(JSON.parse(ctx.sent[0] ?? "{}"), {
      type: "input",
      data: "\x1b[200~run prompt\nsecond line\x1b[201~",
    });
    assert.equal(ctx.sent.length, 1);

    helpers.dashboardHandlePasteSubmitOutput(
      ctx,
      "launch-session",
      "[Pasted Text: 2 lines]",
    );

    assert.equal(ctx.sent.length, 1);
    timers.tick(helpers.TERMINAL_PASTE_MARKER_SETTLE_DELAY_MS);

    assert.deepStrictEqual(JSON.parse(ctx.sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    assert.equal(ctx._terminalRefs["launch-session"]?.launchPrompt, undefined);
  });

  it("clears queued launch prompts when Codex fails before prompt delivery", () => {
    const timers = createFakeTimers();
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
      timers,
    );
    const ctx = makeLaunchPromptContext();
    const session = ctx.sessions[0] as Record<string, unknown>;
    session.runner = "codex";

    helpers.dashboardScheduleLaunchPrompt(ctx, "launch-session", "run prompt");
    session.outputTail = [
      "Error loading configuration: filesystem glob path `**/*.key` only supports `none` access; use an exact path or trailing `/**` for `none` subtree access",
      "$ ",
    ].join("\n");
    helpers.dashboardHandleLaunchPromptOutput(ctx, "launch-session");
    timers.tick(7000);

    assert.deepStrictEqual(ctx.sent, []);
    assert.equal(ctx._terminalRefs["launch-session"]?.launchPrompt, undefined);
    assert.equal(session.loadingPhase, "error");
    assert.equal(
      session.loadingError,
      "Runner failed before prompt delivery. Check the terminal output above. Error loading configuration: filesystem glob path `**/*.key` only supports `none` access; use an exact path or trailing `/**` for `none` subtree access",
    );
  });

  it("extracts the Codex config-error detail from the runner output tail", () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const tail = [
      "OpenAI Codex v0.131.0",
      "Error loading configuration: filesystem glob path `**/*.key` only supports `none` access; use an exact path or trailing `/**` for `none` subtree access",
      "$ ",
    ].join("\n");

    assert.equal(
      helpers.dashboardExtractRunnerStartupError(tail),
      "Error loading configuration: filesystem glob path `**/*.key` only supports `none` access; use an exact path or trailing `/**` for `none` subtree access",
    );
    assert.equal(
      helpers.dashboardRunnerStartupFailureMessage(tail),
      "Runner failed before prompt delivery. Check the terminal output above. Error loading configuration: filesystem glob path `**/*.key` only supports `none` access; use an exact path or trailing `/**` for `none` subtree access",
    );
  });

  it("falls back to the generic runner-startup message when no error pattern is captured", () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    assert.equal(helpers.dashboardExtractRunnerStartupError("$ "), null);
    assert.equal(
      helpers.dashboardRunnerStartupFailureMessage("$ "),
      "Runner failed before prompt delivery. Check the terminal output above.",
    );
  });

  it("truncates very long captured runner-startup errors to keep the banner readable", () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const longDetail = "Error loading configuration: " + "x".repeat(500);
    const detail = helpers.dashboardExtractRunnerStartupError(longDetail);
    assertExists(detail);
    assert.ok(detail.length <= 303);
    assert.ok(detail.endsWith("..."));
  });

  it("detects the compact Claude composer footer as runner readiness", () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );

    assert.equal(
      helpers.dashboardOutputLooksReadyForLaunchPrompt(
        "Claude Code v2.1.138\n/remote-control is active\n?forshortcuts●high·/effort",
      ),
      true,
    );
  });

  it("sends launch prompts after output stays quiet and resets quiet timing per chunk", async () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const ctx = makeLaunchPromptContext();
    const session = ctx.sessions[0] as Record<string, unknown>;

    helpers.dashboardScheduleLaunchPrompt(ctx, "launch-session", "run prompt");
    await delay(120);

    assert.deepStrictEqual(ctx.sent, []);

    session.outputTail = "runner banner\n";
    helpers.dashboardHandleLaunchPromptOutput(ctx, "launch-session");
    await delay(300);
    session.outputTail = String(session.outputTail) + "still loading\n";
    helpers.dashboardHandleLaunchPromptOutput(ctx, "launch-session");
    await delay(300);

    assert.deepStrictEqual(ctx.sent, []);

    await delay(260);
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
    const expectedPromptAndSubmitSendCount = 2;
    assert.equal(ctx.sent.length, expectedPromptAndSubmitSendCount);
    assert.equal(ctx._terminalRefs["launch-session"]?.launchPrompt, undefined);
    assert.equal(
      ctx._terminalRefs["launch-session"]?.launchPromptQuietTimer,
      undefined,
    );
    assert.equal(
      ctx._terminalRefs["launch-session"]?.launchPromptFallbackTimer,
      undefined,
    );
  });

  it("keeps the after-output fallback capped from the first output chunk", async () => {
    const helpers = loadHelpers(
      async () => ({ json: async () => ({}) }) as Response,
    );
    const ctx = makeLaunchPromptContext();
    const session = ctx.sessions[0] as Record<string, unknown>;

    helpers.dashboardScheduleLaunchPrompt(ctx, "launch-session", "run prompt");
    await delay(120);

    for (let index = 0; index < 6; index += 1) {
      session.outputTail = `${String(session.outputTail)}loading ${index}\n`;
      helpers.dashboardHandleLaunchPromptOutput(ctx, "launch-session");
      await delay(320);
    }
    await delay(220);

    assert.deepStrictEqual(JSON.parse(ctx.sent[0] ?? "{}"), {
      type: "input",
      data: "\x1b[200~run prompt\x1b[201~",
    });
    helpers.dashboardHandlePasteSubmitOutput(
      ctx,
      "launch-session",
      "paste again to expand",
    );
    await delay(1220);
    assert.deepStrictEqual(JSON.parse(ctx.sent[1] ?? "{}"), {
      type: "input",
      data: "\r",
    });
    const expectedCappedFallbackSendCount = 2;
    assert.equal(ctx.sent.length, expectedCappedFallbackSendCount);
    assert.equal(ctx._terminalRefs["launch-session"]?.launchPrompt, undefined);
  });

  it("debounces the visible awaiting-input badge", () => {
    const source = readDashboardTerminalSource();
    assert.match(source, /const AWAITING_INPUT_VISIBLE_DELAY_MS = 1200/);
    assert.match(
      source,
      /dashboardScheduleAwaitingInputReveal\(ctx, sessionId, session\)/,
    );
    assert.match(source, /dashboardClearAwaitingInputTimer\(ctx, sessionId\)/);
    assert.doesNotMatch(source, /target\.awaitingInput = awaitingInput/);
  });

  it("maps awaiting-input sessions into the workspace waiting state", () => {
    const source = readFileSync(WORKSPACE_VIEW_PATH, "utf-8");
    assert.match(source, /awaitingInput: session\.awaitingInput === true/);
    assert.match(source, /waitingForRunner: session\.connected === true/);
    assert.match(source, /return session\.awaitingInput === true \|\|/);
    assert.match(source, /session\.waitingForRunner === true/);
    assert.match(
      source,
      /this\.allSessions\(\)\.filter\(session => this\.sessionIsWaiting\(session\)\)/,
    );
  });

  it("keeps detached live sessions out of recent history", () => {
    const source = readFileSync(WORKSPACE_VIEW_PATH, "utf-8");
    assert.match(
      source,
      /const inactive = this\.serverSessions\.filter\(session => session\.status !== 'active'\)/,
    );
    assert.match(
      source,
      /const rows = \[\.\.\.this\.recentTerminalSessions, \.\.\.inactive\]/,
    );
    assert.doesNotMatch(
      source,
      /recentSessions\(\)[\s\S]{0,500}localSessionRows/,
    );
  });

  it("excludes waiting sessions from the Workspace running meter", () => {
    const source = readFileSync(WORKSPACE_VIEW_PATH, "utf-8");
    assert.match(source, /runningSessions\(\) \{/);
    assert.match(
      source,
      /session\.status === 'active' && !this\.sessionIsWaiting\(session\)/,
    );
    assert.match(
      source,
      /meterRunning\(\) \{ return this\.runningSessions\(\)\.length; \}/,
    );
  });

  it("uses the Alpine projectName getter for Workspace metadata fallbacks", () => {
    const source = readFileSync(WORKSPACE_VIEW_PATH, "utf-8");
    assert.match(
      source,
      /sessionMeta\(session\) \{[\s\S]{0,180}session\.projectName \|\| this\.projectName/,
    );
    assert.match(
      source,
      /sessionProjectAgeMeta\(session\) \{[\s\S]{0,180}session\.projectName \|\| this\.projectName/,
    );
    assert.doesNotMatch(source, /session\.projectName \|\| projectName/);
  });

  it("wires all four Workspace waiting surfaces to a single awaitingInput field", () => {
    // All Workspace waiting surfaces derive from LocalSession.awaitingInput
    // so the header dot, pill, left-rail style, and meter count cannot drift
    // when the terminal heuristic changes.
    const workspace = readFileSync(WORKSPACE_VIEW_PATH, "utf-8");
    const app = readDashboardAppSource();
    // (1) Active terminal header dot reads terminalAwaitingInput (or waiting-for-runner).
    assert.match(
      workspace,
      /:class="\(terminalWaitingForRunner \|\| terminalAwaitingInput\) \? 'gf-status-waiting'/,
    );
    // (2) "Awaiting input" pill is x-show on terminalAwaitingInput.
    assert.match(workspace, /x-show="terminalAwaitingInput"/);
    assert.match(workspace, />Awaiting input</);
    // (3) Left-rail card adds the is-waiting class via sessionIsWaiting(s).
    assert.match(workspace, /'is-waiting': sessionIsWaiting\(s\)/);
    // (4) sessionIsWaiting derives from awaitingInput so the meter, dot, and
    //     left-rail share one source of truth.
    assert.match(
      workspace,
      /sessionIsWaiting\(session\) \{[\s\S]{0,250}session\.awaitingInput === true/,
    );
    // app.ts must define terminalAwaitingInput off the same field.
    assert.match(
      app,
      /get terminalAwaitingInput\(\): boolean \{[\s\S]{0,120}_activeSession\?\.awaitingInput === true/,
    );
    // localSessionRows passes awaitingInput through unchanged so the rail
    // and meters see the same value the header sees.
    assert.match(workspace, /awaitingInput: session\.awaitingInput === true/);
  });

  it("warms xterm when the workspace or setup view opens", () => {
    const source = readDashboardAppSource();
    assert.match(
      source,
      /function dashboardShouldWarmXterm\([\s\S]{0,220}\(view === "workspace" \|\| view === "setup"\) && ctx\.terminalAvailable/,
    );
    assert.match(
      source,
      /function dashboardWarmXtermForView\([\s\S]{0,260}dashboardShouldWarmXterm\(ctx, view\)[\s\S]{0,120}ctx\.loadXterm\(\)\.catch\(\(\) => \{\}\)/,
    );
    assert.match(
      source,
      /ctx\.\$watch\("activeView"[\s\S]{0,120}dashboardWarmXtermForView\(ctx, view\)/,
    );
  });

  it("shows a visible launching label on the workspace terminal button", () => {
    const source = readFileSync(WORKSPACE_VIEW_PATH, "utf-8");
    assert.match(
      source,
      /x-text="launching \? 'Launching terminal\.\.\.' : 'Open terminal'"/,
    );
  });

  it("keeps manual terminal launch available from the active workspace", () => {
    const source = readFileSync(WORKSPACE_VIEW_PATH, "utf-8");
    assert.match(source, /Open new terminal/);
    assert.match(
      source,
      /x-text="launching \? 'Launching\.\.\.' : 'New terminal'"/,
    );
    assert.match(source, /class="workspace-session-rail"/);
    assert.match(source, /'is-collapsed': sessionsCollapsed/);
  });

  it("keeps the collapsed workspace rail actionable", () => {
    const source = readFileSync(WORKSPACE_VIEW_PATH, "utf-8");
    assert.match(source, /aria-label="New session"/);
    assert.match(source, /:key="'ws-collapsed-' \+ s\.id"/);
    assert.match(source, /@click="openSession\(s\)"/);
    assert.match(source, /:aria-label="'Open ' \+ sessionTitleFor\(s\)"/);
    assert.match(source, /class="workspace-session-dot"/);
    assert.match(source, /:class="'is-' \+ sessionPipTone\(s\)"/);
    assert.match(source, />Expand sessions</);
  });

  it("routes terminal upload notes to the originating session", () => {
    const source = readDashboardAppSource();
    assert.match(
      source,
      /dashboardSendToTerminalSession\(ctx, sessionId, result\.note, \{\s+adapt: false,\s+\}\)/,
    );
  });

  it("defers dashboard launch prompts until after terminal attachment", () => {
    const source = readDashboardTerminalSource();
    assert.match(
      source,
      /const TERMINAL_LAUNCH_PROMPT_NO_OUTPUT_FALLBACK_DELAY_MS = 6000/,
    );
    assert.match(
      source,
      /const TERMINAL_LAUNCH_PROMPT_AFTER_OUTPUT_FALLBACK_DELAY_MS = 2000/,
    );
    assert.match(source, /const TERMINAL_LAUNCH_PROMPT_QUIET_DELAY_MS = 500/);
    assert.match(source, /const TERMINAL_PASTE_MARKER_SETTLE_DELAY_MS = 300/);
    assert.match(
      source,
      /const TERMINAL_CLAUDE_PASTE_NO_MARKER_FALLBACK_DELAY_MS = 1500/,
    );
    assert.match(
      source,
      /const TERMINAL_PASTE_COMMIT_FALLBACK_DELAY_MS = 15000/,
    );
    assert.match(source, /const TERMINAL_PASTE_SUBMIT_RETRY_CADENCE_MS = 500/);
    assert.match(source, /const TERMINAL_PASTE_SUBMIT_RETRY_DELAY_MS = 300/);
    assert.match(source, /body: JSON\.stringify\(\{\s+prompt: ""/);
    assert.match(
      source,
      /ctx\.connectTerminal\(session\.id, wsUrl\);\s+dashboardScheduleLaunchPrompt\(ctx, session\.id, prompt\)/,
    );
    assert.match(source, /dashboardHandleLaunchPromptOutput\(ctx, sessionId\)/);
  });

  it("only treats image file drag items as terminal upload candidates", () => {
    const source = readDashboardAppSource();
    assert.match(
      source,
      /item\?\.kind === "file" && item\.type\.startsWith\("image\/"\)/,
    );
  });

  it("shows an in-place launching label on the Setup terminal button", () => {
    const source = readFileSync(SETUP_VIEW_PATH, "utf-8");
    assert.match(
      source,
      /x-text="launching \? 'Starting setup\.\.\.' : 'Run Setup in Terminal'"/,
    );
  });

  it("uses agent-specific copy on the Setup prompt generating row", () => {
    const source = readFileSync(SETUP_VIEW_PATH, "utf-8");
    assert.match(
      source,
      /x-text="'Generating setup prompt for ' \+ agentName\(setupSelectedAgent\) \+ '\.\.\.'"/,
    );
  });

  it("exposes terminalWaitingForRunner so Workspace can show inline progress", () => {
    const source = readDashboardAppSource();
    assert.match(source, /get terminalWaitingForRunner\(\): boolean/);
    assert.match(
      source,
      /if \(!session\.connected \|\| session\.ended\) return false/,
    );
    assert.match(source, /if \(session\.awaitingInput\) return false/);
    assert.match(
      source,
      /session\.loadingPhase === "ready" \|\| session\.loadingPhase === "error"/,
    );
    assert.match(source, /return tail\.length === 0/);
    assert.match(source, /get terminalDetached\(\): boolean/);
    assert.match(
      source,
      /serverSession\.id === session\.id && serverSession\.status === "active"/,
    );
    assert.match(
      source,
      /s\.id === id && s\.ended !== true && s\.connected === true/,
    );
  });

  it("renders the Waiting-for-runner badge in the workspace header", () => {
    const source = readFileSync(WORKSPACE_VIEW_PATH, "utf-8");
    assert.match(source, /x-show="terminalWaitingForRunner"/);
    assert.match(source, /Waiting for runner\.\.\./);
    assert.match(
      source,
      /\(terminalWaitingForRunner \|\| terminalAwaitingInput\) \? 'gf-status-waiting'/,
    );
  });

  it("renders a terminal loading overlay inside each session shell", () => {
    const workspace = readFileSync(WORKSPACE_VIEW_PATH, "utf-8");
    const styles = readFileSync(
      resolve(PROJECT_ROOT, "src", "dashboard", "styles.css"),
      "utf-8",
    );
    assert.match(workspace, /class="terminal-session-shell"/);
    assert.match(workspace, /class="terminal-loading-overlay"/);
    assert.match(workspace, /terminalDetached \|\| terminalEnded/);
    assert.match(workspace, /Session detached/);
    assert.match(
      workspace,
      /x-show="!session\.ended && session\.loadingPhase !== 'ready'"/,
    );
    assert.match(workspace, /terminalLoadingMessage\(session\)/);
    assert.match(workspace, /retryTerminalSession\(session\.id\)/);
    assert.match(styles, /\.terminal-loading-overlay/);
    assert.match(styles, /@keyframes terminal-loading-spinner/);
  });
});
