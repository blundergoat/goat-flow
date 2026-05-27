---
category: dashboard
last_reviewed: 2026-05-28
---

<!-- Note: pre-v1.8.0 entries below may reference "Gemini"; Antigravity replaced Gemini in v1.8.0. Where the underlying trap shape applies equally to Antigravity (box-bordered menus, selection-bullet glyphs, CUP positioning), the Gemini references are kept as historical evidence. Where they describe current code behavior, they have been updated to Antigravity. -->


## Footgun: Project-browser modal is reachable only via header-span click, not from the add-project flow

**Status:** active | **Created:** 2026-04-18 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Users looking for a filesystem-browse capability while adding a project find only a text input. The browse modal exists and works, but its only visible trigger is the project-name span in the page header (tooltip: "Switch project"). Reviewers testing the "Add Project" flow report the modal as "not opened directly from a visible UI button".

**Evidence:**
- Trigger is a clickable span in the header: `src/dashboard/index.html` (search: `@click="openBrowser()"`), tooltip via `title="Switch project"`.
- Modal markup behind the trigger: `src/dashboard/index.html` (search: `x-show="showBrowser"`).
- Handler: `src/dashboard/app.ts` (search: `async openBrowser()`) toggles `showBrowser` and calls `browseTo(this.projectPath)`.
- Live UI session on 2026-04-18: tester exercising the Add Project flow needed programmatic `showBrowser = true` via Alpine state to reach the modal. They did not notice the header span because the Add Project form shows a text input and no Browse button.

**Why it happens:** Two independent add-project surfaces exist - a text input on the Add Project view, and a filesystem picker triggered from the header's "Switch project" affordance. There is no visible cross-link between the two, and the "Switch project" label does not suggest adding a new project.

**Prevention:**
1. If refactoring the header, grep for `openBrowser` before changing the project-name span - it is currently the only visible path to the filesystem picker.
2. If the Add Project flow gains its own Browse button, remove the header-only path to avoid duplication; otherwise keep both and document the header trigger in the Add Project view so users in that mental model can find it.
3. When adding any modal with Alpine `x-show`, add a smoke test or manual-test note that clicking the intended visible trigger actually opens it.

---

## Footgun: Tailwind utility class names collide with custom component classes

**Status:** active | **Created:** 2026-04-26 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A custom CSS rule appears correct in source but the rendered element has unexpected `box-shadow`, `border`, `outline`, or other properties that the custom rule never declares. Adding `border: none` or `box-shadow: none` to the custom rule has no effect because Tailwind's utility has equal or higher specificity and re-applies the property. The unwanted style is only visible in the browser's computed styles panel.

**Evidence:**
- The donut chart element used `class="ring"` with a custom `.ring` rule in `src/dashboard/styles.css` (search: `ring-chart`) providing `conic-gradient`, `border-radius: 999px`, etc.
- Tailwind v4 generates a `.ring` utility that applies `box-shadow: 0 0 0 calc(1px + ...) var(--tw-ring-color, currentcolor)`, stacking a 1px dark hairline border on the donut.
- The agent tried `border: none` on `.ring` but the shadow persisted because it was `box-shadow`, not `border`. The root cause was only identified when the user inspected computed styles via a browser extension and found the Tailwind-generated `box-shadow` rule.
- Fix: renamed the custom class from `ring` to `ring-chart` in both CSS and HTML.

**Why it happens:** Tailwind generates utility classes from common CSS property names (`ring`, `shadow`, `blur`, `inset`, `container`, `table`, `hidden`, etc.). Any custom component class that shares one of these names will silently inherit Tailwind's declarations. The collision is invisible in source code because the custom CSS file and Tailwind's generated output are separate. Agents cannot diagnose this from source alone - it requires inspecting the rendered DOM's computed styles.

**Prevention:**
1. Never name custom component classes with bare Tailwind utility names. Prefix with the project namespace (e.g., `gf-ring`, `ring-chart`) or use multi-word names that Tailwind won't generate.
2. Known collision-prone names to avoid: `ring`, `shadow`, `blur`, `inset`, `container`, `table`, `hidden`, `visible`, `fixed`, `absolute`, `relative`, `block`, `flex`, `grid`, `border`, `outline`, `accent`, `columns`.
3. When an element has unexpected visual artifacts (hairlines, shadows, outlines) that don't appear in your CSS, check the browser's computed styles for Tailwind-generated rules on the same class name.
4. When `border: none` / `box-shadow: none` doesn't fix a visual artifact, the property you're overriding may not be the one causing it - inspect computed styles to find the actual property.

---

## Footgun: Native Windows terminal sessions need both a Windows shell plan and a Windows runner shim

**Status:** active | **Created:** 2026-04-29 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** The Workspace view reports `File not found` when `Open terminal` is clicked on native Windows, even though the same runner works in WSL or a regular Windows shell. `/api/health` may also under-report available runners because the extensionless npm wrapper is found before the runnable Windows shim.

**Evidence:**
- `src/cli/server/terminal.ts` (search: `buildTerminalSpawnSpec`) now branches the PTY launch by platform and uses `powershell.exe` on `win32` instead of assuming a POSIX shell.
- `src/cli/server/terminal.ts` (search: `pickWindowsRunnerPath`) ranks `where` results so `.exe` / `.cmd` / `.bat` shims win over extensionless npm wrapper files.
- `test/smoke/dashboard-endpoints.test.ts` (search: `builds a Windows PTY launch that keeps PowerShell open`) pins the Windows shell contract.
- `test/smoke/dashboard-endpoints.test.ts` (search: `prefers runnable Windows shims over POSIX npm wrappers`) pins the Windows runner-selection contract.

**Why it happens:** Native Windows and POSIX need different launch mechanics, but npm installs both kinds of runner wrapper in the same global bin directory. If terminal code assumes `/bin/bash`, native Windows cannot spawn the shell. If runner discovery trusts the first `where <runner>` hit, it can choose the extensionless POSIX wrapper instead of the runnable `.cmd` shim. Fixing only one half still leaves the feature broken.

**Prevention:**
1. Keep Windows shell selection and Windows runner-path selection in the same change set; touching only one is a partial fix.
2. When editing dashboard terminal launch behavior, verify both `buildTerminalSpawnSpec` and `pickWindowsRunnerPath`, then run a native Windows `TerminalManager.create("", ".", "<runner>")` repro.
3. Preserve host-independent tests that exercise both `win32` and POSIX spawn specs, even when working from a non-Windows machine.

---

## Footgun: Dashboard reader decoders can erase score-critical API fields

**Status:** active | **Created:** 2026-05-01 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** The dashboard can show concern scores, metric notes, or pass/fail labels that disagree with `/api/audit`. The API payload is correct, but the browser-side decoded object has lost the discriminant needed by the view's scoring and display expression.

**Evidence:**
- `src/dashboard/dashboard-readers.ts` (search: `function readAuditCheck`) decodes `/api/audit` checks before the views score them.
- `src/dashboard/views/home.html` (search: `setupBlocked()`) gates setup-blocked projects before showing harness readiness scores.
- `src/cli/server/types.ts` (search: `type?: HarnessCheckType`) now records the wire contract so `type` is preserved across the server/dashboard boundary.
- `test/unit/dashboard-readers.test.ts` (search: `preserves harness check type so metric failures can be shown as non-gating score evidence`) pins the reader contract: a failing `metric` check must remain visible as a metric so the UI can apply metric-specific scoring and copy instead of treating it as an ordinary failed audit check.

**Why it happens:** Dashboard views run from classic browser scripts and score the already-decoded browser model, not the raw API JSON. Backend scoring and API typing can be correct while a browser reader silently drops a discriminant such as `type`, collapsing `metric` into "ordinary failed check" or hiding why a score changed without failing the concern.

**Prevention:**
1. When a dashboard view branches or scores on an API field, verify the matching `readDashboardReport` / helper decoder preserves that field.
2. Pair backend scoring changes with a browser-reader regression, especially for discriminants such as `type`, `status`, `concern`, and `id`.
3. Browser-verify the built `dist/` dashboard and compare it with `/api/audit` output; source-only tests can miss packaged reader drift.

---

## Footgun: Dashboard aggregate facts and Home agent cards can use different agent sets

**Status:** active | **Created:** 2026-05-13 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Home can show or hide agent cards differently from the aggregate Agent Setup scope. A project may report aggregate `agent-instruction` as passing even when the Home summary is supposed to expose missing supported agents.

**Evidence:**
- `src/cli/server/dashboard-routes.ts` (search: `resolveDashboardManagedAgentIds`) resolves the managed agent ids used for dashboard per-agent cards.
- `src/cli/audit/audit.ts` (search: `runAuditBatch`) extracts aggregate facts once, then derives per-agent facts from that batch.
- `src/cli/facts/orchestrator.ts` (search: `managedAgentIds`) receives the dashboard-managed agent set so aggregate facts and per-agent cards use the same ids.
- `test/integration/dashboard-server.test.ts` (search: `includes all supported agents even when config lists one`) caught the partial-fix failure: cards were moving toward all supported agents, but the aggregate agent scope still passed with only the config-listed agent.

**Why it happens:** The dashboard report has two related but separate paths: aggregate audit scopes and per-agent Home cards. Changing only the route-level managed-agent helper does not change the fact extraction already performed inside `runAuditBatch`; the batch extractor needs the same managed agent ids before it derives aggregate and per-agent facts.

**Prevention:**
1. For Home agent visibility changes, update both `resolveDashboardManagedAgentIds` and the `runAuditBatch` aggregate fact extraction path.
2. Regression tests must assert both `report.agentScores[].id` and `report.scopes.agent`; card-only assertions can miss aggregate scope drift.
3. Use a fixture where `.goat-flow/config.yaml` lists only one agent while supported registry expectations require all dashboard agents.

---

## Footgun: Dashboard terminal helper tests can leak event-loop handles

**Status:** active | **Created:** 2026-05-24 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A dashboard terminal helper test suite prints passing assertions but the Node test process keeps running until an outer timeout or CI job limit kills it. In GitHub Actions this presents as the `Test` step staying in progress long after setup, install, and build completed.

**Evidence:**
- `src/dashboard/dashboard-terminal.ts` (search: `ageInterval = setInterval`) starts a session age/update interval when the browser WebSocket opens.
- `test/unit/dashboard-terminal-launch.test.ts` (search: `dashboardConnectTerminal`) opens fake browser terminal sessions that exercise the same lifecycle code.
- `test/unit/dashboard-terminal-launch.test.ts` (search: `type TimerControls`) must include both timeout and interval functions when loading helpers into `node:vm`.
- Repro from 2026-05-24: `timeout 35s node --import tsx --test --test-reporter=spec test/unit/dashboard-terminal-launch.test.ts` printed a passing `dashboard terminal launch flow` suite, then exited via the outer timeout instead of naturally.

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
- User-observed dashboard session on 2026-05-10: "Quality Agent Installation for Claude Code via Claude Code" opened in Claude Code v2.1.138, reached the `❯` prompt, and no quality prompt appeared.
- `test/smoke/dashboard-endpoints.test.ts` (search: `waits for runner output to settle before initial prompt delivery`) reproduces the multi-chunk startup condition: a second output chunk must reset the initial-input timer, and no prompt may be written until output has been quiet.
- `src/dashboard/dashboard-terminal.ts` (search: `dashboardOutputLooksReadyForLaunchPrompt`) sends dashboard-launched prompts after the browser terminal is attached and the runner output reaches an interactive prompt, with a fallback timer for runners whose readiness cannot be detected.
- Built-dashboard browser verification on 2026-05-10: clicking "Run Quality Assessment in Runner" opened Claude Code v2.1.138 and pasted the generated `# GOAT Flow Quality Assessment - Claude Code` prompt into the terminal.
- User-observed Skills page session on 2026-05-10: "Assess in Runner" opened Claude Code v2.1.138 and showed `[Pasted text #1 +110 lines]` instead of running the skill quality prompt.
- `src/dashboard/dashboard-terminal.ts` (search: `TERMINAL_PASTE_MARKER_SETTLE_DELAY_MS`) submits dashboard-launched pasted prompts as a second PTY input after the bracketed paste, so Claude Code can commit the pasted-text block before Enter is sent.
- `test/unit/dashboard-terminal-launch.test.ts` (search: `data: "\r"`) pins the split paste-then-submit browser wire contract.
- Built-dashboard browser verification on 2026-05-11: clicking Skills -> Assess in Runner sent the prompt when Claude Code reached its footer, detected the `[Pasted text #1 +108 lines]` echo, sent Enter 112 ms after paste, and the terminal proceeded to read `.goat-flow/skill-reference/skill-preamble.md` instead of remaining at the pasted-text composer.
- `src/dashboard/dashboard-terminal.ts` (search: `dashboardHandlePasteSubmitOutput`) submits browser-side pasted prompts on Claude Code's pasted-text echo, with `TERMINAL_PASTE_COMMIT_FALLBACK_DELAY_MS` as the fallback for runners that do not echo that state.
- Built-dashboard browser verification on 2026-05-12: clicking Setup with runner `gemini` and target Gemini CLI opened Gemini CLI v0.41.2, waited through the signed-in/auth splash, then sent `# GOAT Flow Setup - Gemini CLI`; Gemini entered `Thinking...` after receiving the `goat-flow audit . --harness --agent gemini` instruction.
- `src/dashboard/dashboard-terminal.ts` (search: `dashboardOutputLooksReadyForLaunchPrompt`) treats Antigravity's `Antigravity CLI [version]` identity line plus the `for shortcuts` composer hint as the input-safe marker before sending launch prompts. (Pre-v1.8.0 this slot was held by Gemini's `Type your message or @path/to/file` marker; Gemini was removed when Antigravity replaced it.)
- `src/dashboard/dashboard-terminal.ts` (search: `dashboardOutputLooksCommittedPaste`) recognises the `[Pasted text #N +M lines]` / `[Pasted Text: N lines]` marker for Claude and Antigravity, and `src/dashboard/dashboard-terminal.ts` (search: `dashboardHandlePasteSubmitOutput`) delays Enter submits briefly after that marker so the TUI has committed the collapsed paste.
- User-provided installed dashboard at `http://127.0.0.1:34769/` on 2026-05-12: clicking Setup -> Run Setup in Terminal for Claude Code v2.1.139 pasted `[Pasted text #1 +36 lines]` and stayed there after a 4s wait; one manual Enter advanced the same prompt into Claude's command execution.
- `src/dashboard/dashboard-terminal.ts` (search: `TERMINAL_PASTE_MARKER_SETTLE_DELAY_MS`) now delays Claude and Antigravity Enter submits after pasted-text markers so the TUI has a quiet window to commit the collapsed paste before Enter is sent.
- User-observed dashboard session on 2026-05-27: Claude Code v2.1.152 "Run Quality Assessment in Runner" landed a 394-line / ~32 KB prompt as `[Pasted text #1 +394 lines]` and never submitted. Live `_terminalRefs` snapshot (session id ending `63940c04`) showed `pasteSubmitTimer: false`, `pasteSubmitAwaitingCommit: false` while xterm buffer still showed the parked paste, proving the dashboard had fired `\r` before Claude's TUI was ready to treat it as submit.
- PTY artifacts in the stuck 2026-05-27 buffer included `\x1b[7m[\x1b[27m` (reverse-video literal `[`) and a stray `PR #44` line, evidence that Claude's renderer/parser briefly exposed bracketed-paste internals on the fat payload.
- `src/dashboard/dashboard-terminal.ts` (search: `dashboardArmPasteSubmitRetryIfStillCommitted`) now turns the post-submit verifier into a bounded retry loop while `dashboardOutputStillAtCommittedPaste` still classifies the composer as parked.
- User-observed dashboard sessions on 2026-05-28: Codex and Antigravity "Run in Terminal" quality launches auto-submitted, but Claude Code left the same prompt pasted and waiting for manual Enter. Local trace inspection for the comparable 2026-05-27 Claude sessions showed a ~33 KB `prompt.send` without a following `"\r"` submit before cleanup, so marker-triggered submit/retry was not enough when the visible Claude pasted-text marker failed to drive the browser helper path.
- `src/dashboard/dashboard-terminal.ts` (search: `TERMINAL_CLAUDE_PASTE_NO_MARKER_FALLBACK_DELAY_MS`) adds a short Claude-only no-marker submit fallback before the generic 15s delayed-paste safety net, and routes that fallback through `dashboardArmPasteSubmitRetryIfStillCommitted`.
- User-provided live WebSocket probe on 2026-05-28 after the no-marker fallback was deployed showed bracketed paste at +933 ms, xterm DA response `\x1b[?1;2c` at +1049 ms, then no `"\r"` / `"\n"` for the next ~7 seconds. Manual Enter immediately advanced Claude Code, proving the browser-to-server input channel was healthy and the pending fallback had been cancelled in the browser helper path.
- `src/dashboard/dashboard-terminal.ts` (search: `dashboardTerminalDataLooksProtocolResponse`) keeps xterm-generated focus, DA, DSR, and cursor-position protocol replies from clearing pending paste-submit state while still forwarding them to the PTY. `test/unit/dashboard-terminal-launch.test.ts` (search: `keeps Claude no-marker fallback armed across xterm protocol replies`) pins the live failure shape: bracketed paste, `\x1b[?1;2c`, then fallback Enter.
- User-observed Codex dashboard session on 2026-05-19: Codex CLI 0.131.0 failed during config load, returned to the fallback shell, and the queued quality prompt was pasted into bash where its Markdown lines executed as shell commands.
- `src/dashboard/dashboard-terminal.ts` (search: `dashboardOutputLooksRunnerStartupFailure`) suppresses queued launch prompts when runner startup output proves the prompt would land in a fallback shell instead of the agent composer.

**Why it happens:** Agent CLIs render startup screens in multiple PTY chunks, and Claude Code's remote-control startup can ignore a server-side initial PTY paste even after a simple delay. The PTY write succeeds from goat-flow's perspective, but the runner can drop or ignore the prompt before the browser-attached terminal path is ready. For browser-side Claude Code sends, sending bracketed paste markers, prompt text, and Enter in one PTY write, sending Enter before Claude has committed the pasted-text block, relying only on the pasted-text marker callback, or treating every `term.onData` event as human input can leave Claude in its pasted-text composer state without submitting. Xterm can emit protocol replies such as focus-in/focus-out, device-attributes, device-status, and cursor-position responses through the same `onData` path as keystrokes; if those replies clear `pasteSubmitTimer`, the fallback Enter never fires. If the runner exits during startup, goat-flow's terminal wrapper intentionally leaves an interactive shell open, so launch-prompt fallback timers must distinguish agent composers from shell prompts after runner failure.

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
- `src/dashboard/views/workspace.html` (search: `waitingForRunner: s.connected === true`) maps local loading/no-output sessions into the same waiting path used by the rail and meters.
- `src/dashboard/dashboard-terminal.ts` (search: `dashboardNextAwaitingInputState`) keeps awaiting-input state latched across transient spinner/status redraws instead of clearing it on every non-empty output chunk.
- `test/unit/dashboard-terminal-launch.test.ts` (search: `excludes waiting sessions from the Workspace running meter`) pins the meter split, and `test/unit/dashboard-terminal-launch.test.ts` (search: `"\r✻ Thinking…"`) pins redraw preservation.
- `src/cli/server/terminal.ts` (search: `WebSocket close means browser detach`) treats browser WebSocket close as detach; `src/dashboard/dashboard-terminal.ts` (search: `Handle the terminal WebSocket closing`) must not convert that detach into local `ended=true` unless `exit`, `shutdown`, a terminal-ending error, or a session refresh proves the backend session is gone.
- `test/unit/dashboard-terminal-launch.test.ts` (search: `treats terminal WebSocket close as detach until an exit message arrives`) pins the detach-vs-ended contract, and `test/unit/dashboard-terminal-launch.test.ts` (search: `marks disconnected local sessions ended when refresh proves they are gone`) pins the true-termination reconciliation.
- `test/unit/__fixtures__/awaiting-input/` (added 2026-05-21) holds real node-pty captures from each runner - `claude-trust.txt`, `claude-bash-approval.txt`, `codex-startup.txt`, `copilot-startup.txt`, `antigravity-startup.txt`, and the legacy `gemini-startup.txt` (positive: must fire), plus `*-running.txt` (negative: must not false-fire). `test/unit/dashboard-terminal-launch.test.ts` (search: `from captured PTY bytes`) loads each fixture and asserts `dashboardOutputLooksAwaitingInput` matches the runner's real prompt body.
- `src/dashboard/dashboard-terminal.ts` (search: `CUP / HVP (cursor position)`) normalises Codex's row-changing positionings to `\n ` so words and rows survive into the regex layer; without this fix Codex's trust prompt collapses to `Doyoutrustthecontentsofthisdirectory?` and no word-boundary regex matches.
- `src/dashboard/dashboard-terminal.ts` (search: `Unicode box-drawing characters`) replaces `│ ... │` border glyphs with spaces so Copilot and Gemini bordered menus expose `\n\s*1.` to the numbered-choices regex.
- `src/dashboard/dashboard-terminal.ts` (search: `dashboardOutputHasConfirmFooter`) adds `Enter to confirm`, `Press enter to continue`, and `enter to select` as a `(confirmFooter && numberedChoices)` clause so the trust dialogs (which lack the in-session `Esc to cancel · Tab to amend` footer) still fire the badge.
- `test/unit/dashboard-terminal-launch.test.ts` (search: `wires all four Workspace waiting surfaces to a single awaitingInput field`) pins the header dot, the "Awaiting input" pill, the left-rail `is-waiting` class, and `meterWaiting()` against `LocalSession.awaitingInput` so a future surface cannot silently diverge.
- `src/dashboard/dashboard-terminal.ts` (search: `Round-6 design: the awaitingInput badge is NEVER cleared by output`) is the canonical fix after FIVE rounds of output-driven clearing strategies failed: glyph allowlists (R2 added `●` for Claude, R3 added `◦` and braille for Codex, plus circular variants for future runners), tail-end heuristics with a normalized slice (R4 reviewer fix), raw-byte slice that preserves OSC titles (R5 to fix Codex sustained-CUP). Each round passed its tests but a new runner pattern always defeated it. Round 6 removes the output-driven clear entirely: the badge is now cleared only by input-side authoritative signals - the `term.onData((data: string) =>` keystroke path, `dashboardSendToTerminalSession` (search: `function dashboardSendToTerminalSession`), and lifecycle paths (exit, terminating error, detach-as-end). The badge stays on across arbitrary output until one of those fires. Pattern reference: `.goat-flow/patterns/architecture.md` (search: `Asymmetric trust - set state from output, clear state from input`). Defense-in-depth: spinner-glyph transient classification at (search: `spinner-glyph frame`) and the trust-prompt heuristic remain for SETTING the badge correctly - they just no longer participate in clearing.
- `test/unit/dashboard-terminal-launch.test.ts` (search: `keeps the badge on across unknown chunks`) pins the rearchitecture with a synthetic future-runner glyph (`⚡`) that is intentionally not in any classifier - 8 chunks of it must NOT clear the badge while the prompt is in tail. (search: `keeps the badge on across unknown chunks for ANSI-heavy prompt tails`) pins the normalized-tail requirement with a real Gemini fixture whose raw last 1500 bytes miss the visible prompt. (search: `clears the badge once runner output pushes the prompt`) pins the inverse: 1700+ chars of fresh output do clear the badge. (search: `keeps awaiting state across Claude Code's lone-bullet spinner frame`) and (search: `keeps awaiting state across Codex's lone-bullet spinner frame`) cover the still-shipped glyph-level fast path.

**Why it happens:** `/api/terminal/sessions` only exposes lifecycle `status` (`active` / `terminated`) plus age and idle duration. Browser-only facts such as `awaitingInput`, loading/no-output state, transient runner redraws, and the distinction between a detached WebSocket and an ended PTY live in `src/dashboard/dashboard-terminal.ts`, `src/dashboard/app.ts`, and `src/dashboard/views/workspace.html`. If a new UI surface counts sessions directly from `status === 'active'`, clears `awaitingInput` based on a single PTY output chunk instead of the still-visible terminal tail, or treats browser WebSocket close as terminal exit, the Workspace surfaces drift apart. Runner-specific rendering quirks compound the problem: Codex positions every word with CUP (`ESC[r;cH`) and never emits `\r\n` between rows, Copilot and Gemini wrap menus in box-drawing borders (`│ … │`), and Gemini uses `●` as its selection bullet - each of which silently defeats text-based regex unless the plain-text normaliser strips and accommodates them.

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
10. The 1200ms reveal timer is killable by ANY chunk that `dashboardNextAwaitingInputState` classifies as "not awaiting" (the else branch at line 1916 of `dashboard-terminal.ts` clears it). When a runner emits a periodic idle frame (spinner, cursor blink, OSC progress hint, bare bell, mode toggle), the frame MUST classify as `dashboardOutputLooksTransientStatusRedraw === true` or it will reset the badge every tick. Investigate any new "badge never appears" report by adding `console.log` to `ws.onmessage` around line 1916 and watching for chunks where `awaitingInput === false` while the prompt is visibly on screen.

---

## Footgun: Dashboard agent-targeting uses activeRunner where it should use the failing or selected agent

**Status:** active | **Created:** 2026-05-03 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** The Home "Fix First" card shows a command like `--agent claude` but the agent with the actual failing harness check is a different agent (e.g. codex at 93%). The Setup page shows harness grades (A 100%, A 93%) on the target cards but the generated setup prompt reflects a different audit scope, so a 93% agent can show "All audit checks pass" and a 100% agent can show "1 audit check failing".

**Evidence:**
- `src/dashboard/views/home.html` (search: `nextActionCommand`) composed the harness fix command with `activeRunner` instead of the agent that actually had the failing check. The same applied to `harnessFixPrompt` (search: `harnessFixPrompt`) which built the fix prompt context for `activeRunner` instead of the failing agent.
- `src/cli/server/dashboard-routes.ts` (search: `/api/setup`) called `runAudit` with `harness: false`, so the setup prompt was generated from install-scope checks only. But the Setup target cards scored agents using `report.agentScores[].harness.checks` (harness scope). The two scopes have different check sets, producing contradictory pass/fail signals on the same page.
- `src/cli/prompt/compose-setup.ts` (search: `renderAuditFail`) collected failing checks from `scopes.setup` and `scopes.agent` only, omitting `scopes.harness` - so even when harness was enabled, harness failures were invisible in the setup prompt output.
- Observed live on 2026-05-03: a real downstream project, Codex at A 93% (Context concern: Artifact Routing), Claude at A 100%. Home Fix First said `--agent claude`. Setup prompt for Codex said "All audit checks pass"; setup prompt for Claude showed a failing check.

**Why it happens:** The dashboard has two distinct agent roles - the **runner** (which CLI executes the prompt, set via the header dropdown as `activeRunner`) and the **target** (which agent's config to inspect or fix). Several code paths conflated the two. Separately, the Setup page card grades and the setup prompt API used different audit scopes (`harness: true` for display vs `harness: false` for generation), so the prompt contradicted the grade shown directly above it.

**Prevention:**
1. When composing a fix/action command or prompt for harness issues, resolve the target agent from the audit data (which agent actually has the finding), not from `activeRunner`. Use a priority-specific target helper such as `failingHarnessAgent()` (search: `failingHarnessAgent()` in `home.html`) so a concern-only failure does not hijack a harness action.
2. When a dashboard surface displays a grade/score and also generates a prompt below it, both MUST use the same audit scope. If the card shows harness scores, the prompt API must pass `harness: true`.
3. Watch for the runner-vs-target conflation pattern: `activeRunner` is correct for the `launchPreset` executor argument, but wrong for the prompt content's agent target, the command's `--agent` flag, and the `agentFilter` in API calls that feed those prompts.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: Alpine.js string `:style` replaces static `style` attribute

**Status:** resolved | **Created:** 2026-04-05 | **Resolved:** 2026-04-18 | **Evidence:** ACTUAL_MEASURED

**Resolution:** Both live violations in `src/dashboard/index.html` converted to object `:style` syntax. Remaining `:style` usages in other view files (for example `src/dashboard/views/projects.html` and `src/dashboard/views/settings.html`) use string syntax but on elements without a static `style=`, so they do not trigger the merge-vs-replace trap.

**Original symptoms:** Inline styles (padding, border-radius, font-size, background color) silently disappear at runtime. Elements render with browser defaults. The source HTML looks correct - the bug is invisible until you inspect the rendered DOM.

**Why it happens:** Alpine.js handles `:style` differently depending on whether you pass a string or an object. A **string** `:style` replaces the entire `style` attribute, wiping any static `style="..."` on the same element. An **object** `:style` merges with the static attribute.

**Original evidence (historical):**
- `src/dashboard/index.html` `<body>` tag paired static `style="background:#1a1a1e;color:#e4e4e7"` with string `:style="darkMode ? '...' : '...'"`. Latent pattern (dynamic string happened to repeat static properties), fixed by converting to object syntax.
- `src/dashboard/index.html` browser directory `<button>` paired static `style="text-align:left;padding:6px 8px;border-radius:4px;..."` with string `:style="dir.isProject ? 'font-weight: 600' : ''"`. Live bug: when `dir.isProject` was falsy, the empty string replaced the full static style, clearing padding, border-radius, cursor, and other declarations. Fixed by converting to `:style="dir.isProject ? { fontWeight: 600 } : {}"`.

**Pattern illustration (kept for future guidance):**
```html
<!-- BUG: static style gets wiped -->
<div style="padding: 20px; background: #4ade80;" :style="`width: ${pct}%`">
<!-- Rendered DOM: style="width: 50%" - padding and background gone -->

<!-- FIX: object syntax merges -->
<div style="padding: 20px; background: #4ade80;" :style="{ width: pct + '%' }">
<!-- Rendered DOM: style="padding: 20px; background: #4ade80; width: 50%" -->
```

**Prevention (retained):**
1. Never combine static `style="..."` with string `:style="..."`. Use object `:style="{ prop: value }"` when a static `style` exists.
2. Alternatively, move all static styles to a CSS class and keep `:style` for dynamic values only.
3. When a UI element looks wrong at runtime but correct in source, check the rendered `style` attribute in devtools - if properties are missing, this is the cause.
