---
category: dashboard-terminal
last_reviewed: 2026-09-01
---

<!-- Note: pre-v1.8.0 evidence below may reference "Gemini"; Antigravity replaced Gemini in v1.8.0. Where a trap shape applies equally to Antigravity (box-bordered menus, selection-bullet glyphs, quiet-delay submits), Gemini references are kept as historical evidence; the `gemini-startup.txt` fixture is retained as legacy coverage. Current code behavior anchors already name Antigravity. -->

## Footgun: Native Windows terminal sessions need both a Windows shell plan and a Windows runner shim

**Status:** active | **Created:** 2026-04-29 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** The Workspace view reports `File not found` when `Open terminal` is clicked on native Windows, even though the same runner works in WSL or a regular Windows shell. `/api/health` may also under-report available runners because runner discovery finds the extensionless npm wrapper before the runnable Windows shim.

**Evidence:**
- `src/cli/server/terminal.ts` (search: `buildTerminalSpawnSpec`) branches the PTY launch by platform and uses `powershell.exe` on `win32` instead of assuming a POSIX shell.
- `src/cli/server/terminal.ts` (search: `pickWindowsRunnerPath`) ranks `where` results so `.exe` / `.cmd` / `.bat` shims win over extensionless npm wrapper files.
- `test/smoke/dashboard-endpoints.test.ts` (search: `builds a Windows PTY launch that keeps PowerShell open`) pins the Windows shell contract.
- `test/smoke/dashboard-endpoints.test.ts` (search: `prefers runnable Windows shims over POSIX npm wrappers`) pins the Windows runner-selection contract.

**Why it happens:** Native Windows and POSIX need different launch mechanics, but npm installs both kinds of runner wrapper in the same global bin directory. If terminal code assumes `/bin/bash`, native Windows cannot spawn the shell. If runner discovery trusts the first `where <runner>` hit, it can choose the extensionless POSIX wrapper instead of the runnable `.cmd` shim. Fixing only one half still leaves the feature broken.

**Prevention:**
1. Keep Windows shell selection and Windows runner-path selection in the same change set; touching only one is a partial fix.
2. When editing dashboard terminal launch behavior, verify both `buildTerminalSpawnSpec` and `pickWindowsRunnerPath`, then run a native Windows `TerminalManager.create("", ".", "<runner>")` repro.
3. Preserve host-independent tests that exercise both `win32` and POSIX spawn specs, even when working from a non-Windows machine.

---

## Footgun: Dashboard terminal helper tests can leak event-loop handles

**Status:** active | **Created:** 2026-05-24 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A dashboard terminal helper test suite prints passing assertions but the Node test process keeps running until an outer timeout or CI job limit kills it. In GitHub Actions this presents as the `Test` step staying in progress long after setup, install, and build completed.

**Evidence:**
- `src/dashboard/dashboard-terminal-connect.ts` (search: `ageInterval = setInterval`) starts a session age/update interval when the browser WebSocket opens.
- `test/unit/dashboard-terminal-launch/launch-flow-03.test.ts` (search: `dashboardConnectTerminal`) opens fake browser terminal sessions that exercise the same lifecycle code.
- `test/unit/dashboard-terminal-launch/helpers.ts` (search: `type TimerControls`) must include both timeout and interval functions when loading helpers into `node:vm`.
- Repro from 2026-05-24, against the pre-split monolithic suite (since divided into `test/unit/dashboard-terminal-launch/launch-flow-0*.test.ts`, so this exact command no longer resolves): running the launch-flow suite under `timeout 35s` printed a passing `dashboard terminal launch flow` suite, then exited via the outer timeout instead of naturally. Re-run the current equivalent against the directory to reproduce.

**Why it happens:** The dashboard terminal browser helper owns long-lived lifecycle resources: WebSocket bindings, resize observers, loading timers, paste-submit timers, launch-prompt timers, and the age-update interval. VM-loaded tests can fake only part of that environment. If `setInterval` remains real while the test controls only `setTimeout`, a fake socket open can leave a real interval in the host event loop even when every assertion has finished.

**Prevention:**
1. When loading `src/dashboard/dashboard-terminal.ts` through `node:vm`, inject `setInterval` and `clearInterval` from the same fake timer harness as `setTimeout` and `clearTimeout`.
2. For tests that intentionally use real timers, call the helper cleanup path or simulate terminal lifecycle messages that clear timer state before the test returns.
3. Verify terminal helper suites with an outer timeout command at least once after lifecycle/timer changes; a green assertion summary alone does not prove Node can exit.

---

## Footgun: Dashboard terminal prompts can be dropped before browser attachment

**Status:** active | **Created:** 2026-05-10 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Clicking a dashboard action such as "Run Quality Assessment in Runner" creates a Claude terminal session with the right title, but the terminal lands at Claude's empty `❯` prompt with no assessment prompt pasted. A related Claude Code variant shows `[Pasted text #N +... lines]` in the composer and never submits it.

**Evidence:**
- `test/smoke/dashboard-endpoints.test.ts` (search: `waits for runner output to settle before initial prompt delivery`) reproduces the multi-chunk startup condition: a second output chunk must reset the initial-input timer, and no prompt may be written until output has been quiet.
- `src/dashboard/dashboard-terminal.ts` (search: `dashboardOutputLooksReadyForLaunchPrompt`) sends dashboard-launched prompts after the browser terminal is attached and the runner output reaches an interactive prompt, with a fallback timer for runners whose readiness cannot be detected.
- `src/dashboard/dashboard-terminal.ts` (search: `TERMINAL_PASTE_MARKER_SETTLE_DELAY_MS`) submits dashboard-launched pasted prompts as a second PTY input after the bracketed paste, so Claude Code can commit the pasted-text block before Enter is sent.
- `test/unit/dashboard-terminal-launch/launch-flow-02.test.ts` (search: `data: "\r"`) pins the split paste-then-submit browser wire contract.
- `src/dashboard/dashboard-terminal-paste.ts` (search: `dashboardHandlePasteSubmitOutput`) submits browser-side pasted prompts on Claude Code's pasted-text echo, with `TERMINAL_PASTE_COMMIT_FALLBACK_DELAY_MS` as the fallback for runners that do not echo that state.
- `src/dashboard/dashboard-terminal.ts` (search: `dashboardOutputLooksReadyForLaunchPrompt`) treats Antigravity's `Antigravity CLI [version]` identity line plus the `for shortcuts` composer hint as the input-safe marker before sending launch prompts. (Pre-v1.8.0 this slot was held by Gemini's `Type your message or @path/to/file` marker; Gemini was removed when Antigravity replaced it.)
- `src/dashboard/dashboard-terminal.ts` (search: `dashboardOutputLooksCommittedPaste`) recognises the `[Pasted text #N +M lines]` / `[Pasted Text: N lines]` marker for Claude and Antigravity, and `src/dashboard/dashboard-terminal-paste.ts` (search: `dashboardHandlePasteSubmitOutput`) delays Enter submits briefly after that marker so the TUI has committed the collapsed paste.
- `src/dashboard/dashboard-terminal.ts` (search: `TERMINAL_PASTE_MARKER_SETTLE_DELAY_MS`) delays Claude and Antigravity Enter submits after pasted-text markers so the TUI has a quiet window to commit the collapsed paste before Enter is sent.
- `src/dashboard/dashboard-terminal-paste.ts` (search: `dashboardArmPasteSubmitRetryIfStillCommitted`) turns the post-submit verifier into a bounded retry loop while `dashboardOutputStillAtCommittedPaste` still classifies the composer as parked.
- `src/dashboard/dashboard-terminal.ts` (search: `TERMINAL_CLAUDE_PASTE_NO_MARKER_FALLBACK_DELAY_MS`) adds a short Claude-only no-marker submit fallback before the generic 15s delayed-paste safety net, and routes that fallback through `dashboardArmPasteSubmitRetryIfStillCommitted`.
- `src/dashboard/dashboard-terminal.ts` (search: `dashboardTerminalDataLooksProtocolResponse`) keeps xterm-generated focus, DA, DSR, and cursor-position protocol replies from clearing pending paste-submit state while still forwarding them to the PTY. `test/unit/dashboard-terminal-launch/launch-flow-01.test.ts` (search: `keeps Claude no-marker fallback armed across xterm protocol replies`) pins the live failure shape: bracketed paste, `\x1b[?1;2c`, then fallback Enter.
- `src/dashboard/dashboard-terminal.ts` (search: `dashboardOutputLooksRunnerStartupFailure`) suppresses queued launch prompts when runner startup output proves the prompt would land in a fallback shell instead of the agent composer.
- Historical live reproductions from 2026-05-10 through 2026-05-28 covered missing prompt paste, parked `[Pasted text #N +... lines]`, manual-Enter recovery, Claude no-marker fallback cancellation by xterm protocol replies, and prompt leakage into fallback shells after runner startup failure.

**Why it happens:** Agent CLIs render startup screens in multiple PTY chunks, and Claude Code can ignore early server-side PTY pastes. Browser-side sends also fail when bracketed paste, prompt text, and Enter are collapsed into one payload; when Enter fires before Claude commits the pasted-text block; when marker callbacks never arrive; or when xterm protocol replies are misclassified as human input and clear pending timers. If the runner exits during startup, goat-flow intentionally leaves a fallback shell open, so launch-prompt timers must distinguish an agent composer from a shell prompt.

**Prevention:**
1. For dashboard launch buttons, create promptless backend terminal sessions and send the prompt after the browser terminal is attached and runner output looks ready or has gone quiet.
2. When changing `scheduleInitialInput`, test at least two output chunks with a delay between them and assert no prompt write before the final quiet window.
3. For browser-side sends, keep bracketed paste and Enter as separate ordered WebSocket inputs; submit on Claude Code's pasted-text echo or a short Claude-specific no-marker fallback, and do not collapse them back into one `paste + "\r"` payload.
4. Verify built-dashboard behavior after restarting the dashboard process; a running `dist/cli/cli.js dashboard` server keeps old terminal code in memory until restart.
5. For runner TUIs with auth or splash redraws, gate launch prompts on that runner's real composer marker and test its pasted-text marker separately; Antigravity needs both `Antigravity CLI [version]` + `for shortcuts` readiness and delayed submit after `[Pasted Text: ...]`.
6. Do not make pasted-text marker handling instant for Claude Code; Claude Code v2.1.139 can drop an Enter sent in the same redraw burst as `[Pasted text #N +M lines]`, so marker-triggered submit needs a short quiet delay just like Gemini.
7. Treat runner config/startup errors as prompt-delivery blockers; do not let quiet-window or absolute fallback timers force-send prompts after output such as `Error loading configuration:`.
8. If Codex and Antigravity launches auto-submit but Claude remains parked at `[Pasted text ...]`, inspect browser-to-server WebSocket input frames first. Absence of a `data: "\r"` frame means the browser helper failed to submit; presence of repeated `"\r"` frames means Claude's accepted-submit sequence has changed.
9. When testing `term.onData` behavior, include xterm protocol replies as non-user input. DA/DSR/focus replies must still be forwarded to the PTY, but they must not clear paste-submit timers or awaiting-commit state.

---

## Footgun: Workspace terminal waiting state has multiple derived surfaces

**Status:** active | **Created:** 2026-05-19 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** The Workspace header or terminal pane can show a session waiting while the summary meters still count it as running, or an active session can briefly show "Awaiting input" and then flip back to running while the terminal is still visibly blocked on a prompt. A browser-side terminal can also show "Session ended" while `/api/terminal/sessions` still lists the backend PTY as active and the terminal scrollback is visibly waiting on a runner permission prompt. The badge can also fail to fire at all for runner-specific prompt formats - workspace-trust dialogs on first launch (every runner), Codex CUP-positioned text, and Copilot/Gemini box-bordered menus all looked benign to the pre-2026-05-21 heuristic even though the runner was visibly parked on a numbered choice.

**Evidence:**
- `src/dashboard/views/workspace.html` (search: `runningSessions()`) excludes `sessionIsWaiting(s)` from the running meter after the 2026-05-19 fix. Before that, `meterRunning()` counted every `status === 'active'` session, including waiting sessions.
- `src/dashboard/views/workspace.html` (search: `waitingForRunner: session.connected === true`) maps local loading/no-output sessions into the same waiting path used by the rail and meters.
- `src/dashboard/dashboard-terminal.ts` (search: `dashboardNextAwaitingInputState`) keeps awaiting-input state latched across transient spinner/status redraws instead of clearing it on every non-empty output chunk.
- `test/unit/dashboard-terminal-launch/launch-flow-06.test.ts` (search: `excludes waiting sessions from the Workspace running meter`) pins the meter split, and `test/unit/dashboard-terminal-launch/launch-flow-04.test.ts` (search: `"\r✻ Thinking…"`) pins redraw preservation.
- `src/cli/server/terminal.ts` (search: `WebSocket close means browser detach`) treats browser WebSocket close as detach; `src/dashboard/dashboard-terminal-connect.ts` (search: `Handle the terminal WebSocket closing`) must not convert that detach into local `ended=true` unless `exit`, `shutdown`, a terminal-ending error, or a session refresh proves the backend session is gone.
- `test/unit/dashboard-terminal-launch/launch-flow-03.test.ts` (search: `treats terminal WebSocket close as detach until an exit message arrives`) pins the detach-vs-ended contract, and `test/unit/dashboard-terminal-launch/launch-flow-03.test.ts` (search: `marks disconnected local sessions ended when refresh proves they are gone`) pins the true-termination reconciliation.
- `test/unit/__fixtures__/awaiting-input/` (added 2026-05-21) holds real node-pty captures from each runner - `claude-trust.txt`, `claude-bash-approval.txt`, `codex-startup.txt`, `copilot-startup.txt`, `antigravity-startup.txt`, and the legacy `gemini-startup.txt` (positive: must fire), plus `*-running.txt` (negative: must not false-fire). `test/unit/dashboard-terminal-launch/launch-flow-04.test.ts` (search: `from captured PTY bytes`) loads each fixture and asserts `dashboardOutputLooksAwaitingInput` matches the runner's real prompt body.
- `src/dashboard/dashboard-terminal.ts` (search: `CUP / HVP (cursor position)`) normalises Codex's row-changing positionings to `\n ` so words and rows survive into the regex layer; without this fix Codex's trust prompt collapses to `Doyoutrustthecontentsofthisdirectory?` and no word-boundary regex matches.
- `src/dashboard/dashboard-terminal.ts` (search: `Unicode box-drawing characters`) replaces `│ ... │` border glyphs with spaces so Copilot and Gemini bordered menus expose `\n\s*1.` to the numbered-choices regex.
- `src/dashboard/dashboard-terminal.ts` (search: `dashboardOutputHasConfirmFooter`) adds `Enter to confirm`, `Press enter to continue`, and `enter to select` as a `(confirmFooter && numberedChoices)` clause so the trust dialogs (which lack the in-session `Esc to cancel · Tab to amend` footer) still fire the badge.
- `test/unit/dashboard-terminal-launch/launch-flow-06.test.ts` (search: `wires all four Workspace waiting surfaces to a single awaitingInput field`) pins the header dot, the "Awaiting input" pill, the left-rail `is-waiting` class, and `meterWaiting()` against `LocalSession.awaitingInput` so a future surface cannot silently diverge.
- `src/dashboard/dashboard-terminal-connect.ts` (search: `Round-6 design: the awaitingInput badge is NEVER cleared by output`) is the canonical fix after FIVE rounds of output-driven clearing strategies failed: glyph allowlists (R2 added `●` for Claude, R3 added `◦` and braille for Codex, plus circular variants for future runners), tail-end heuristics with a normalized slice (R4 reviewer fix), raw-byte slice that preserves OSC titles (R5 to fix Codex sustained-CUP). Each round passed its tests but a new runner pattern always defeated it. Round 6 removes the output-driven clear entirely: the badge is now cleared only by input-side authoritative signals - the `term.onData((data: string) =>` keystroke path, `dashboardSendToTerminalSession` (search: `function dashboardSendToTerminalSession`), and lifecycle paths (exit, terminating error, detach-as-end). The badge stays on across arbitrary output until one of those fires. Pattern reference: `.goat-flow/learning-loop/patterns/architecture.md` (search: `Asymmetric trust - set state from output, clear state from input`). Defense-in-depth: spinner-glyph transient classification at (search: `spinner-glyph frame`) and the trust-prompt heuristic remain for SETTING the badge correctly - they just no longer participate in clearing.
- The rearchitecture is pinned by (`test/unit/dashboard-terminal-launch/launch-flow-04.test.ts`, search: `keeps the badge on across unknown chunks`), which pushes 8 chunks of a synthetic future-runner glyph (`⚡`) that is intentionally in no classifier and asserts they must NOT clear the badge while the prompt is in the tail, and by (`test/unit/dashboard-terminal-launch/launch-flow-04.test.ts`, search: `keeps the badge on across unknown chunks for ANSI-heavy prompt tails`), which pins the normalized-tail requirement with a real Gemini fixture whose raw last 1500 bytes miss the visible prompt. Consistent with the Round-6 design above, (`test/unit/dashboard-terminal-launch/launch-flow-05.test.ts`, search: `badge persists across arbitrary output volume - only user input clears`) proves the badge survives even 1700+ chars of fresh runner output - only input-side signals clear it. The still-shipped glyph-level fast path is covered by (`test/unit/dashboard-terminal-launch/launch-flow-04.test.ts`, search: `keeps awaiting state across Claude Code's lone-bullet spinner frame`) and (`test/unit/dashboard-terminal-launch/launch-flow-05.test.ts`, search: `keeps awaiting state across Codex's lone-bullet spinner frame`).

**Why it happens:** `/api/terminal/sessions` only exposes lifecycle `status` (`active` / `terminated`) plus age and idle duration. Browser-only facts such as `awaitingInput`, loading/no-output state, transient runner redraws, and the distinction between a detached WebSocket and an ended PTY live in `src/dashboard/dashboard-terminal.ts`, `src/dashboard/app.ts`, and `src/dashboard/views/workspace.html`. If a new UI surface counts sessions directly from `status === 'active'`, clears `awaitingInput` based on a single PTY output chunk instead of the still-visible terminal tail, or treats browser WebSocket close as terminal exit, the Workspace surfaces drift apart. Runner-specific rendering quirks compound the problem: Codex positions every word with CUP (`ESC[r;cH`) and never emits `\r\n` between rows, Copilot and Gemini wrap menus in box-drawing borders (`│ … │`), and Gemini uses `●` as its selection bullet - these quirks silently defeat text-based regex unless the plain-text normaliser strips and accommodates them.

**Prevention:**
1. For Workspace session summaries, derive running from "active and not waiting", never from `status === 'active'` alone.
2. Keep waiting classification shared across expanded cards, collapsed pips, top meters, and the active terminal header.
3. When changing terminal output heuristics, test redraw frames such as `\r✻ Thinking…` separately from real progress text like `Continuing...`.
4. Do not assume the server can classify "waiting" unless the wire contract grows a durable field; today that state is browser-local.
5. Treat browser WebSocket close as detached/disconnected until a backend `exit`, `shutdown`, terminal-ending error, or `/api/terminal/sessions` refresh proves the PTY is gone.
6. When changing reconnect or local-session binding, test stale ended local shells separately from live disconnected shells so an old local overlay cannot block `openServerSession`.
7. Ground the waiting-input heuristic in real captured PTY bytes from each runner, not invented prompt text. Add a fixture under `test/unit/__fixtures__/awaiting-input/` whenever a new runner or a new prompt format is supported, and assert both a positive (must fire) and a negative (must not false-fire) case in `test/unit/dashboard-terminal-launch.test.ts`. Capture each fixture under node-pty against the live runner.
8. When normalising terminal control codes in `dashboardPlainTerminalText`, treat CUP/HVP (`ESC[r;cH`/`ESC[r;cf`) like CHA - replace with a `\n ` token, not strip to empty - so runners that lay out rows by absolute positioning still expose newlines between numbered options. Strip Unicode box-drawing characters (U+2500–U+257F) so bordered menu cells expose their text content.
9. When adding a new selection-bullet glyph for a runner, extend BOTH `numberedChoices` regexes (primary detector and continuation detector) and add a positive fixture so future drift is caught.
10. Investigate any new "badge never appears" report by adding `console.log` to `ws.onmessage` in `dashboard-terminal.ts` around line 1916 and watching for chunks where `awaitingInput === false` while the prompt is visibly on screen. ANY chunk that `dashboardNextAwaitingInputState` classifies as "not awaiting" kills the 1200ms reveal timer (the else branch at line 1916 clears it). When a runner emits a periodic idle frame (spinner, cursor blink, OSC progress hint, bare bell, mode toggle), the frame MUST classify as `dashboardOutputLooksTransientStatusRedraw === true` or it will reset the badge every tick.

---

## Footgun: Dashboard-launched Codex access must match the task's write intent

**Status:** active | **Created:** 2026-06-14 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Preserve separate workspace and reporting launch policies; never collapse every dashboard Codex session onto one sandbox shape.
**Trigger phase:** SCOPE
**Caught at:** ACT

**Symptoms:** A write-enabled Codex session launched from the Workspace terminal fails `bash scripts/preflight-checks.sh` when it inherits the default restricted sandbox, while a reporting-only session can modify tracked files if it inherits the blanket `danger-full-access` override. The first failure shape looks like product regressions: child-process-heavy tests fail, registry DNS is unavailable, and nested npm spawns report `EPERM`.

**Evidence:**
- `src/cli/server/terminal-spawn.ts` (search: `CODEX_DASHBOARD_ARGS`) keeps ordinary write-enabled Codex sessions on `--sandbox danger-full-access`; `buildCodexReportingProfile` supplies the restricted reporting alternative.
- `src/dashboard/dashboard-terminal-paste.ts` (search: `dashboardTerminalAccessMode`) maps prompt and role intent to `workspace` or `reporting`, while retry/reconnect state preserves that decision.
- `test/smoke/dashboard-endpoints.test.ts` (search: `preflight-capable sandbox`) pins the POSIX and Windows Codex launch shapes.
- `test/unit/terminal-spawn.test.ts` (search: `restricted permission profile`) pins reporting profile construction and Git-proven ignored-directory admission.
- Live probe on 2026-06-14: bare `codex doctor --summary` reported `restricted fs + restricted network`, while `codex --sandbox danger-full-access doctor --summary` reported `unrestricted fs + enabled network`.
- Live profile probe on 2026-07-26: ignored report/build writes exited 0; source, canonical-anchor, dynamic tracked-anchor, rename, and delete attempts exited 1 and left protected files unchanged.

**Why it happens:** The dashboard starts a real agent runner, and the runner owns the command sandbox used by that agent's tool calls. Implementation and full verification need nested processes, network, and project writes; quality/reporting prompts need reads plus narrowly admitted local artifacts. A single global override cannot satisfy both contracts.

**Prevention:**
1. When refactoring `buildTerminalSpawnSpec`, preserve `--sandbox danger-full-access` for workspace sessions and the native read-mostly permission profile for reporting sessions.
2. For Codex-only preflight failures, run `codex doctor --summary` and a Node `child_process.spawnSync` probe before treating child-process test failures as product regressions.
3. Test both directions: allowed local artifact writes and blocked tracked-file overwrite/rename/delete attempts. Prompt wording alone is not enforcement.
4. Preserve `accessMode` through create, session metadata, retry, reconnect, and recent-session projection; a dropped field silently returns the session to workspace access.
