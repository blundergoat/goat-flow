---
category: browser-evidence
last_reviewed: 2026-08-28
---

**Scope:** Proving browser-visible behaviour - live runner runs rather than timer units, serving local HTML over localhost, wrapper-path smokes, and reusing a route's real inputs instead of its composer. Dashboard-specific test mechanics are [dashboard-testing.md](dashboard-testing.md).

## Lesson: Real-timer terminal smoke tests need isolated verification

**Status:** active | **Created:** 2026-05-30

**Decision changed:** Process-lifecycle tests wait for an observable ready state before sending termination signals; elapsed time alone is never readiness. | **Trigger phase:** VERIFY | **Incident count:** 4 | **Latest occurrence:** 2026-08-06

**What happened:** During `docs.missing-internal-function-doc` cleanup, a combined focused command that grouped the dashboard smoke test with heavier unit suites failed `uses the fallback deadline when runner output keeps updating`: `spawned.writes` was still `[]` at the 5600ms assertion. The touched code was comment-only. Rerunning `node --import tsx --test test/smoke/dashboard-endpoints.test.ts` immediately afterward passed with `# pass 15` / `# fail 0`; the two edited unit files also passed in isolated runs.

**Recurrence 2026-07-17:** PR #56 CI run `29530759253` failed `cleans the child process group before returning a parent termination` after 255ms. The test sent SIGTERM 200ms after launching an intermediate Node runner, before its nested fixture emitted either PID marker. My first correction tried to wait for those markers on the runner's stdout, but the production runner intentionally buffers child output until close; exact Node 20 verification then failed `124 !== 143`. The corrected fixture uses an out-of-band readiness file created only after both processes exist.

**Recurrence 2026-08-05:** PR #57 CI run `30947991560` failed `shows retry progress before close while keeping child output captured` because the test compared two-decimal elapsed labels and required each displayed interval to be at least 0.03 seconds. CPU contention reproduced the failure even though progress remained bounded and visible. The correction makes the child remain alive until the fixture observes the first progress event through an out-of-band readiness file; it asserts the lifecycle contract without treating rounded display cadence as scheduler evidence.

**Recurrence 2026-08-06:** PR #57 pull-request run `31097377526` failed `returns after escalation when an escaped descendant retains the capture pipe` because its 100 ms timeout fired before the Node fixture wrote the detached child's PID. The push run for the same commit passed. The corrected fixture signals parent cleanup only after an out-of-band ready file proves the escaped child exists, while the production deadline remains unchanged.

**Root cause:** Real-timer tests treated scheduler time as proof that an asynchronous process or terminal had reached the state their assertions required. Heavy concurrent work can delay that state independently of the timer, and buffered output cannot serve as a live readiness signal.

**Prevention:** Isolate real-timer smoke tests from heavy suites. For process lifecycle tests, synchronize on an observable ready state through a channel whose contract is live at that point; do not sleep for an assumed startup window or wait on output that is documented to flush only at close. Reproduce failures on the CI-supported Node runtime before treating a newer local runtime as disproof. Evidence anchors: `test/smoke/dashboard-endpoints.test.ts` (search: `uses the fallback deadline when runner output keeps updating`), `test/integration/preflight-progress.test.ts` (search: `progressReadyFile`), `scripts/preflight-command-runner.mjs` (search: `capturedOutputChunks`).

---

## Lesson: Browser terminal fixes need live runner proof, not just timer-unit proof

**Status:** active | **Created:** 2026-05-12

**What happened:** While fixing dashboard setup prompt submission, the focused terminal unit tests passed but the browser-use reproduction still stopped at Claude's `[Pasted text #1 +18 lines]` composer placeholder. Two assumptions were wrong: the fallback timer could race Claude's paste commit, and the pasted-text marker could arrive after pending paste state had already been cleared.

**Root cause:** The unit tests modeled ideal timer order, not the real terminal output order from Claude Code inside xterm/WebSocket. I treated "timer sent Enter in a fake clock" as equivalent to "Claude accepted the prompt" before running the original browser reproduction.

**Fix:** Keep a browser-use reproduction in the proof loop for terminal launch changes: click the real dashboard button, verify the prompt advances past `[Pasted text...]`, and then clean up the terminal session. Evidence anchors: `src/dashboard/dashboard-terminal-connect.ts` (search: `dashboardHandlePasteSubmitOutput`), `test/unit/dashboard-terminal-launch/launch-flow-01.test.ts` (search: `ignores a late Claude paste echo after the no-marker fallback submitted`).

**Prevention:** For terminal automation, unit tests must cover lost/late paste state, but the Definition of Done still requires live browser evidence against the runner that originally failed. Do not close on fake timers alone when xterm, WebSocket, or agent composer behavior is involved.

**Recurrence 2026-05-28:** A fake-timer fix added `TERMINAL_CLAUDE_PASTE_NO_MARKER_FALLBACK_DELAY_MS = 1500` and the built bundle contained it, but live WebSocket probing still showed bracketed paste followed by xterm DA response `\x1b[?1;2c` and then no Enter. The missing test variable was xterm's own protocol replies through `term.onData`: they were forwarded like keystrokes and cleared the pending fallback timer. Future terminal-submit tests must model the actual browser input stream, not just helper timers. Evidence anchors: `src/dashboard/dashboard-terminal.ts` (search: `dashboardTerminalDataLooksProtocolResponse`), `test/unit/dashboard-terminal-launch/launch-flow-01.test.ts` (search: `keeps Claude no-marker fallback armed across xterm protocol replies`).

**Recurrence 2026-07-31:** A live Claude file-tool probe proved that `.goat-flow/logs/quality/` was writable, but the real generated quality prompt still failed because its redaction-and-validation Bash block was denied under `dontAsk`. The surrogate tested directory permission, not the complete persistence contract. The replacement moves persistence behind `quality save`, and the focused contract now exercises its exact heredoc command through the deny hook. Evidence anchors: `src/cli/quality/quality-command.ts` (search: `handleQualitySaveSubcommand`), `test/unit/quality-report-contract.test.ts` (search: `sends a thorough report block through the actual deny hook`).

**Recurrence 2026-07-31 (prompt envelope):** The first bounded-saver retry generated a quality prompt through the CLI's default JSON output, then passed the complete `{ prompt, auditSummary }` envelope to Claude instead of the raw prompt. Claude still found the embedded instructions, but the run did not reproduce the dashboard payload shape and could not close the live boundary. Evidence anchor: `src/cli/quality/quality-command.ts` (search: `if (options.format === "json")`).

**Prevention update:** When a prompt-generated workflow crosses tool and permission boundaries, reproduce the exact generated command and payload through the real runner. Use `--format text` or parse `.prompt` deliberately, then assert the payload shape before launch. A file-tool write, parser unit, permission-rule probe, or escaped JSON envelope proves only its own layer.

---

## Lesson: Serve local HTML over localhost for browser-use evidence

**Status:** active | **Created:** 2026-04-27

**What happened:** During M12 browser-use verification, `browser-use open file:///home/devgoat/projects/goat-flow/docs/site/goat-flow-landing.html` succeeded at navigation but `browser-use state` returned `Empty DOM tree`. Serving the same directory with `python3 -m http.server 4182 --bind 127.0.0.1` and opening `http://127.0.0.1:4182/goat-flow-landing.html` returned the expected rendered page state and screenshot.

**Root cause:** A `file://` URL is not representative enough for local browser evidence in this agent environment. The browser navigation can succeed while DOM/state capture is empty, which makes a false negative look like a page problem.

**Prevention:** For local HTML/browser-use verification, serve the directory over localhost before opening the page. Treat `file://` empty DOM output as a verification-environment issue to rerun over HTTP before drawing conclusions. Evidence anchors: `workflow/skills/playbooks/browser-use.md` (search: `Local HTML shows an empty DOM`), `.goat-flow/skill-docs/playbooks/browser-use.md` (search: `serve the directory over localhost`).

---

## Lesson: Browser-use installer smoke must exercise the wrapper path

**Status:** active | **Created:** 2026-05-12

**What happened:** While fixing browser-use availability, `browser-use doctor` and direct Python Playwright launch passed, but `browser-use open https://example.com` failed with a 30s `BrowserStartEvent` timeout. Foreground daemon logs showed `BrowserSession` launched `/usr/bin/google-chrome-stable` and then waited for CDP. Inspecting `BrowserSession(headless=True).browser_profile.get_args()` showed no `--no-sandbox`; setting `IN_DOCKER=true` made `browser-use open` and `browser-use state` pass. A first installer smoke used `file://` and produced an empty title, repeating the existing local-file browser-use trap.

**Root cause:** The installer verified the Python modules and direct Playwright launch path, but not the generated `browser-use` wrapper and daemon launch path. In this root container, browser-use's Docker detection returned false, so it omitted Chrome's no-sandbox flags and Chrome exited before CDP came up. `browser-use close` also removed session metadata while leaving the daemon/browser process alive in this environment.

**Prevention:** Browser tooling installers must run a real wrapper-level smoke: `command -v browser-use`, `browser-use open` against a localhost-served page, a DOM/title read, and session cleanup. For root-run wrappers, set `IN_DOCKER=true` before `browser_use.config` imports so Chrome gets no-sandbox flags. Snapshot and reap browser-use daemon PIDs around `close`, because PID files may disappear before the process exits. Evidence anchors: `scripts/install-browser-tools.sh` (search: `browser-use uses IN_DOCKER`), `scripts/install-browser-tools.sh` (search: `Verifying browser-use CLI launches`), `scripts/install-browser-tools.sh` (search: `browser_use_kill_pid`).

---

## Lesson: Reproducing a server route means reusing its inputs, not just its composer

**Status:** active | **Created:** 2026-07-31
**Decision changed:** When driving an end-to-end run that stands in for an HTTP route, build the payload from the route's own input helpers; if any are stubbed, name which conclusions the run can and cannot support BEFORE spending the run.
**Trigger phase:** ACT

**What happened:** The M06 end-to-end runs called the real `composeQuality` with `auditReport: null` and `priorReport: null`, while `/api/quality` passes `runAudit(...)`, `findLatestQualityReport(...)`, and `extractSharedFacts(...)`. Both approved cross-harness runs were spent before this surfaced. The persisted reports carried `audit_status: "unavailable"` and `prior_report_id: null`, so the agent was never asked to mark findings `persisted`; `quality diff` then reported `persisted: 0` with `resolved: 2` and `resolved: 5`, numbers that look like remediation success but are pure artifacts of missing prior linkage. The skills score drop (`setupDelta -10`, `systemDelta -15`) was equally uninterpretable. M06's persistence conclusion survived only because the staged-draft prompt section does not read audit or prior context - that was luck of layout, not design.

**Root cause:** I treated "calls the real composer" as equivalent to "reproduces the route". Passing `null` for optional context compiled, ran, and produced a plausible prompt, so nothing failed loudly - the degradation was visible only in two fields of the output report. Optional-but-populated inputs are the easiest fidelity gap to miss because the stub is a valid value.

**Prevention:**
1. Before a costly reproduction run, diff your call site against the real caller argument by argument (here: `src/cli/server/dashboard-quality-routes.ts`, search: `composeQuality`). Every argument the real caller populates and yours stubs is a fidelity gap to declare or close.
2. Assert route-fidelity in the run's own output check: a report with `audit_status: "unavailable"` or `prior_report_id: null` when history exists means the prompt was degraded, and any diff computed from it is not resolution evidence.
3. Scope the conclusion to the layer actually exercised. A stubbed input invalidates conclusions that read it and leaves untouched those that do not - state which is which rather than reporting one verdict for the whole run.

---
