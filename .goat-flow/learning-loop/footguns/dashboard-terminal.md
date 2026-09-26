---
category: dashboard-terminal
last_reviewed: 2026-09-05
---

Pre-v1.8.0 evidence below may name Gemini; Antigravity replaced Gemini in v1.8.0. Where a trap shape applies equally to Antigravity (box-bordered menus, selection-bullet glyphs, quiet-delay submits), the Gemini references stay as historical evidence and the `gemini-startup.txt` fixture remains legacy coverage.

## Footgun: Native Windows terminal sessions need both a Windows shell plan and a Windows runner shim

**Status:** active | **Created:** 2026-04-29 | **Evidence:** ACTUAL_MEASURED

**Prevention:** Keep Windows shell selection and Windows runner-path selection in one change set; touching one is a partial fix. When editing dashboard terminal launch behaviour, verify both `buildTerminalSpawnSpec` and `pickWindowsRunnerPath`, run a native Windows `TerminalManager.create("", ".", "<runner>")` repro, and keep host-independent tests for both `win32` and POSIX spawn specs.

**Symptoms:** The Workspace view reports `File not found` when `Open terminal` is clicked on native Windows although the runner works in WSL, and `/api/health` under-reports runners because discovery finds the extensionless npm wrapper before the runnable shim.

**Why it happens:** npm installs both wrapper kinds in one global bin directory. Terminal code that assumes `/bin/bash` cannot spawn on native Windows, and discovery that trusts the first `where <runner>` hit picks the POSIX wrapper over the `.cmd` shim.

**Evidence:** `src/cli/server/terminal.ts` (search: `buildTerminalSpawnSpec`) uses `powershell.exe` on `win32`, and the same file (search: `pickWindowsRunnerPath`) ranks `.exe`, `.cmd`, and `.bat` shims above extensionless wrappers; `test/smoke/dashboard-endpoints.test.ts` (search: `builds a Windows PTY launch that keeps PowerShell open`) and (search: `prefers runnable Windows shims over POSIX npm wrappers`) pin both contracts.

---

## Footgun: Dashboard terminal helper tests can leak event-loop handles

**Status:** active | **Created:** 2026-05-24 | **Evidence:** ACTUAL_MEASURED

**Prevention:** When loading `src/dashboard/dashboard-terminal.ts` through `node:vm`, inject `setInterval` and `clearInterval` from the same fake timer harness as `setTimeout` and `clearTimeout`. Tests that use real timers call the helper cleanup path or simulate lifecycle messages that clear timer state before returning. After lifecycle or timer changes, run the terminal helper suites under an outer timeout at least once; a green assertion summary does not prove Node can exit.

**Symptoms:** A terminal helper suite prints passing assertions but the Node process keeps running until an outer timeout or CI job limit kills it, which in GitHub Actions looks like the `Test` step staying in progress long after build.

**Why it happens:** The browser helper owns WebSocket bindings, resize observers, loading, paste-submit, and launch-prompt timers, and an age-update interval. VM-loaded tests fake only part of that environment, so a real `setInterval` outlives every assertion.

**Evidence:** `src/dashboard/dashboard-terminal-connect.ts` (search: `ageInterval = setInterval`) starts the interval on WebSocket open; `test/unit/dashboard-terminal-launch/launch-flow-03.test.ts` (search: `dashboardConnectTerminal`) exercises that path; `test/unit/dashboard-terminal-launch/helpers.ts` (search: `type TimerControls`) must carry both timeout and interval functions. Reproduced 2026-05-24 against the pre-split monolithic suite under `timeout 35s`, which printed a passing suite and exited through the outer timeout; the suite has since been divided into `launch-flow-0*.test.ts` parts.

---

## Footgun: Dashboard terminal prompts can be dropped before browser attachment

**Status:** active | **Created:** 2026-05-10 | **Evidence:** ACTUAL_MEASURED

**Prevention:**
1. Dashboard launch buttons create promptless backend sessions and send the prompt after the browser terminal attaches and runner output looks ready or has gone quiet. Any change to `scheduleInitialInput` tests at least two output chunks with a delay between them and asserts no prompt write before the final quiet window.
2. Browser-side sends keep bracketed paste and Enter as separate ordered WebSocket inputs; never collapse them into one `paste + "\r"` payload.
3. Gate each runner's launch prompt on its real composer marker and test its pasted-text marker separately. Antigravity needs `Antigravity CLI [version]` plus `for shortcuts` for readiness and a delayed submit after `[Pasted Text: ...]`; Claude Code v2.1.139 can drop an Enter sent in the same redraw burst as `[Pasted text #N +M lines]`, so marker-triggered submit keeps a short quiet delay.
4. Treat runner config or startup errors such as `Error loading configuration:` as prompt-delivery blockers; quiet-window and absolute fallback timers must not force-send after them.
5. If Codex and Antigravity launches auto-submit but Claude stays parked at `[Pasted text ...]`, inspect browser-to-server WebSocket input frames first: no `data: "\r"` frame means the browser helper failed to submit; repeated `"\r"` frames mean Claude's accepted-submit sequence changed.
6. In `term.onData` tests, include xterm protocol replies as non-user input: DA, DSR, and focus replies are forwarded to the PTY but must not clear paste-submit timers or awaiting-commit state.
7. Restart the dashboard process before verifying built behaviour; a running `dist/cli/cli.js dashboard` keeps old terminal code in memory.

**Symptoms:** Clicking a dashboard action such as "Run Quality Assessment in Runner" opens a Claude session with the right title that lands at an empty `❯` prompt with nothing pasted, or shows `[Pasted text #N +... lines]` in the composer and never submits it.

**Why it happens:** Agent CLIs render startup in multiple PTY chunks and Claude Code can ignore early server-side pastes. Browser sends fail when paste, text, and Enter are one payload, when Enter fires before Claude commits the pasted block, when marker callbacks never arrive, or when xterm protocol replies are misclassified as human input and clear pending timers. A runner that exits during startup leaves a fallback shell open, so launch timers must tell an agent composer from a shell prompt.

**Evidence:** `src/dashboard/dashboard-terminal.ts` (search: `dashboardOutputLooksReadyForLaunchPrompt`) sends launch prompts once output reaches an interactive composer, treating Antigravity's identity line plus `for shortcuts` as the marker. The same file (search: `dashboardOutputLooksCommittedPaste`) recognises the Claude and Antigravity pasted-text markers, (search: `TERMINAL_PASTE_MARKER_SETTLE_DELAY_MS`) delays Enter after them, (search: `TERMINAL_CLAUDE_PASTE_NO_MARKER_FALLBACK_DELAY_MS`) adds a short Claude-only no-marker fallback ahead of the generic 15s safety net, (search: `dashboardTerminalDataLooksProtocolResponse`) keeps xterm focus, DA, DSR, and cursor-position replies from clearing pending state, and (search: `dashboardOutputLooksRunnerStartupFailure`) suppresses queued prompts when startup output proves they would land in a fallback shell. `src/dashboard/dashboard-terminal-paste.ts` (search: `dashboardHandlePasteSubmitOutput`) submits on Claude's pasted-text echo with `TERMINAL_PASTE_COMMIT_FALLBACK_DELAY_MS` for runners that do not echo, and the same file (search: `dashboardArmPasteSubmitRetryIfStillCommitted`) turns the post-submit verifier into a bounded retry while `dashboardOutputStillAtCommittedPaste` sees the composer parked. Tests: `test/smoke/dashboard-endpoints.test.ts` (search: `waits for runner output to settle before initial prompt delivery`); `test/unit/dashboard-terminal-launch/launch-flow-02.test.ts` (search: `data: "\r"`) pins the split paste-then-submit wire contract; `test/unit/dashboard-terminal-launch/launch-flow-01.test.ts` (search: `keeps Claude no-marker fallback armed across xterm protocol replies`) pins the live failure shape of bracketed paste, `\x1b[?1;2c`, then fallback Enter. Live reproductions from 2026-05-10 to 2026-05-28 covered every symptom above.

---

## Footgun: Workspace terminal waiting state has multiple derived surfaces

**Status:** active | **Created:** 2026-05-19 | **Evidence:** ACTUAL_MEASURED

**Prevention:**
1. Derive "running" as active and not waiting, never from `status === 'active'` alone, and keep waiting classification shared across expanded cards, collapsed pips, top meters, and the active terminal header. The server cannot classify "waiting" unless the wire contract grows a durable field; today that state is browser-local.
2. Treat browser WebSocket close as detached until a backend `exit`, `shutdown`, terminal-ending error, or `/api/terminal/sessions` refresh proves the PTY is gone, and test stale ended local shells separately from live disconnected shells so an old overlay cannot block `openServerSession`.
3. Ground the awaiting-input heuristic in real captured PTY bytes from each runner. Add a fixture under `test/unit/__fixtures__/awaiting-input/` for every new runner or prompt format with a positive and a negative case beside the fixture-driven cases in `test/unit/dashboard-terminal-launch/launch-flow-04.test.ts` (search: `from captured PTY bytes`), and never recreate a monolithic launch-flow file.
4. In `dashboardPlainTerminalText`, treat CUP/HVP (`ESC[r;cH`, `ESC[r;cf`) like CHA, replacing with a `\n ` token rather than stripping, so runners that position rows absolutely still expose newlines; strip Unicode box-drawing characters (U+2500 to U+257F) so bordered menu cells expose their text. When adding a selection-bullet glyph, extend both `numberedChoices` regexes and add a positive fixture.
5. The badge is never cleared by output. Investigate a "badge never appears" report by logging each chunk's `dashboardNextAwaitingInputState` result in `src/dashboard/dashboard-terminal-connect.ts` (search: `function dashboardApplyTerminalOutput`) while the prompt is on screen; a chunk classified "not awaiting" is ignored (search: `the badge is never cleared here, only set or scheduled`), so a missing badge means no chunk or tail ever classified as awaiting. Fix the detector or fixtures; never reintroduce an output-driven clear or timer reset.

**Symptoms:** The header or terminal pane shows a session waiting while the meters count it as running; an active session flashes "Awaiting input" and flips back while the terminal is visibly blocked on a prompt; a browser terminal shows "Session ended" while `/api/terminal/sessions` still lists the PTY as active; or the badge never fires for workspace-trust dialogs, Codex CUP-positioned text, or Copilot and Gemini box-bordered menus.

**Why it happens:** `/api/terminal/sessions` exposes only lifecycle `status`, age, and idle duration, so `awaitingInput`, loading state, transient redraws, and detached-versus-ended all live in the browser, and any new surface that counts from `status`, clears on a single output chunk, or treats socket close as exit drifts. Runner quirks compound it: Codex positions every word with CUP and never emits `\r\n` between rows, Copilot and Gemini wrap menus in `│ … │`, and Gemini uses `●` as its selection bullet. Five rounds of output-driven clearing strategies (glyph allowlists, tail heuristics, raw-byte slices preserving OSC titles) each passed their tests and were defeated by the next runner pattern.

**Evidence:** `src/dashboard/views/workspace.html` (search: `runningSessions()`) excludes `sessionIsWaiting(s)` from the running meter, and the same view (search: `waitingForRunner: session.connected === true`) maps loading sessions into the same waiting path. `src/dashboard/dashboard-terminal.ts` (search: `dashboardNextAwaitingInputState`) latches awaiting state across spinner redraws, (search: `CUP / HVP (cursor position)`) normalises Codex positioning, (search: `Unicode box-drawing characters`) strips borders, and (search: `dashboardOutputHasConfirmFooter`) adds `Enter to confirm`, `Press enter to continue`, and `enter to select` so trust dialogs without the `Esc to cancel · Tab to amend` footer still fire. `src/cli/server/terminal.ts` (search: `WebSocket close means browser detach`) and `src/dashboard/dashboard-terminal-connect.ts` (search: `Handle the terminal WebSocket closing`) keep detach separate from ended. `src/dashboard/dashboard-terminal-connect.ts` (search: `Round-6 design: the awaitingInput badge is NEVER cleared by output`) is the canonical fix: the badge clears only on input-side signals, the `term.onData((data: string) =>` keystroke path, `src/dashboard/dashboard-terminal-paste.ts` (search: `function dashboardSendToTerminalSession`), and lifecycle paths, following `.goat-flow/learning-loop/patterns/architecture.md` (search: `Asymmetric trust - set state from output, clear state from input`). Spinner-glyph transient classification (search: `spinner-glyph frame`) remains only for setting the badge. Fixtures added 2026-05-21 under `test/unit/__fixtures__/awaiting-input/` are real node-pty captures: `claude-trust.txt`, `claude-bash-approval.txt`, `codex-startup.txt`, `copilot-startup.txt`, `antigravity-startup.txt`, legacy `gemini-startup.txt`, and `*-running.txt` negatives. Tests: `test/unit/dashboard-terminal-launch/launch-flow-06.test.ts` (search: `excludes waiting sessions from the Workspace running meter`) and (search: `wires all four Workspace waiting surfaces to a single awaitingInput field`); `test/unit/dashboard-terminal-launch/launch-flow-04.test.ts` (search: `"\r✻ Thinking…"`), (search: `keeps the badge on across unknown chunks`), (search: `keeps the badge on across unknown chunks for ANSI-heavy prompt tails`), and (search: `keeps awaiting state across Claude Code's lone-bullet spinner frame`); `test/unit/dashboard-terminal-launch/launch-flow-05.test.ts` (search: `badge persists across arbitrary output volume - only user input clears`) and (search: `keeps awaiting state across Codex's lone-bullet spinner frame`); `test/unit/dashboard-terminal-launch/launch-flow-03.test.ts` (search: `treats terminal WebSocket close as detach until an exit message arrives`) and (search: `marks disconnected local sessions ended when refresh proves they are gone`).

---

## Footgun: Dashboard-launched Codex access must match the task's write intent

**Status:** active | **Created:** 2026-06-14 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Preserve separate workspace and reporting launch policies; never collapse every dashboard Codex session onto one sandbox shape.
**Trigger phase:** SCOPE
**Caught at:** ACT

**Prevention:** When refactoring `buildTerminalSpawnSpec`, preserve `--sandbox danger-full-access` for workspace sessions and the native read-mostly profile for reporting sessions, and carry `accessMode` through create, session metadata, retry, reconnect, and recent-session projection; a dropped field silently returns the session to workspace access. Test both directions, allowed local artifact writes and blocked tracked-file overwrite, rename, and delete, because prompt wording is not enforcement. For Codex-only preflight failures, run `codex doctor --summary` and a Node `child_process.spawnSync` probe before treating child-process test failures as regressions.

**Symptoms:** A write-enabled Codex session launched from the Workspace terminal fails `bash scripts/preflight-checks.sh` under the default restricted sandbox, with child-process tests failing, registry DNS unavailable, and nested npm spawns reporting `EPERM`; or a reporting-only session can modify tracked files under a blanket `danger-full-access` override.

**Why it happens:** The runner owns the sandbox for its own tool calls. Implementation and full verification need nested processes, network, and project writes; quality and reporting prompts need reads plus narrowly admitted local artifacts. One global override cannot satisfy both.

**Evidence:** `src/cli/server/terminal-spawn.ts` (search: `CODEX_DASHBOARD_ARGS`) keeps workspace sessions on `--sandbox danger-full-access` and `buildCodexReportingProfile` supplies the restricted alternative; `src/dashboard/dashboard-terminal-paste.ts` (search: `dashboardTerminalAccessMode`) maps prompt and role intent to `workspace` or `reporting`; `test/smoke/dashboard-endpoints.test.ts` (search: `preflight-capable sandbox`) pins POSIX and Windows launch shapes; `test/unit/terminal-spawn.test.ts` (search: `restricted permission profile`) pins profile construction. Probes: on 2026-06-14 bare `codex doctor --summary` reported `restricted fs + restricted network` while `codex --sandbox danger-full-access doctor --summary` reported `unrestricted fs + enabled network`; on 2026-07-26 ignored report and build writes exited 0 while source, tracked-anchor, rename, and delete attempts exited 1.
