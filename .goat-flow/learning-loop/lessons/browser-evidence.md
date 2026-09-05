---
category: browser-evidence
last_reviewed: 2026-08-29
---

**Scope:** Proving browser-visible behaviour - live runner runs rather than timer units, serving local HTML over localhost, version-matched wrapper smokes, and reusing a route's real inputs instead of its composer. Dashboard-specific test mechanics are [dashboard-testing.md](dashboard-testing.md); process readiness and timeout bounds under a test are [verification-testing.md](verification-testing.md).

## Lesson: Browser terminal fixes need live runner proof, not just timer-unit proof

**Status:** active | **Created:** 2026-05-12

**Prevention:** For terminal automation, unit tests must cover lost/late paste state, but the Definition of Done still requires live browser evidence against the runner that originally failed. Do not close on fake timers alone when xterm, WebSocket, or agent composer behavior is involved.

**What happened:** During the dashboard setup prompt submission fix, the focused terminal unit tests passed but the browser-use reproduction still stopped at Claude's `[Pasted text #1 +18 lines]` composer placeholder. The tests did not model two behaviours: the fallback timer could race Claude's paste commit, and the pasted-text marker could arrive after pending paste state had already been cleared.

**Root cause:** The unit tests modeled ideal timer order, not the real terminal output order from Claude Code inside xterm/WebSocket. I treated "timer sent Enter in a fake clock" as equivalent to "Claude accepted the prompt" before running the original browser reproduction.

**Fix:** Keep a browser-use reproduction in the proof loop for terminal launch changes: click the real dashboard button, verify the prompt advances past `[Pasted text...]`, and then clean up the terminal session. Evidence anchors: `src/dashboard/dashboard-terminal-connect.ts` (search: `dashboardHandlePasteSubmitOutput`), `test/unit/dashboard-terminal-launch/launch-flow-01.test.ts` (search: `ignores a late Claude paste echo after the no-marker fallback submitted`).

**Recurrence 2026-05-28:** A fake-timer fix added `TERMINAL_CLAUDE_PASTE_NO_MARKER_FALLBACK_DELAY_MS = 1500` and the built bundle contained it, but live WebSocket probing still showed bracketed paste followed by xterm DA response `\x1b[?1;2c` and then no Enter. The missing test variable was xterm's own protocol replies through `term.onData`: they were forwarded like keystrokes and cleared the pending fallback timer. Future terminal-submit tests must model the actual browser input stream, not just helper timers. Evidence anchors: `src/dashboard/dashboard-terminal.ts` (search: `dashboardTerminalDataLooksProtocolResponse`), `test/unit/dashboard-terminal-launch/launch-flow-01.test.ts` (search: `keeps Claude no-marker fallback armed across xterm protocol replies`).

**Recurrence 2026-07-31:** A live Claude file-tool probe proved that `.goat-flow/logs/quality/` was writable, but the real generated quality prompt still failed because its redaction-and-validation Bash block was denied under `dontAsk`. The surrogate tested directory permission, not the complete persistence contract. The replacement moves persistence behind `quality save`, and the focused contract now exercises its exact heredoc command through the deny hook. Evidence anchors: `src/cli/quality/quality-command.ts` (search: `handleQualitySaveSubcommand`), `test/unit/quality-report-contract.test.ts` (search: `sends a thorough report block through the actual deny hook`).

**Recurrence 2026-07-31 (prompt envelope):** The first bounded-saver retry generated a quality prompt through the CLI's default JSON output, then passed the complete `{ prompt, auditSummary }` envelope to Claude instead of the raw prompt. Claude still found the embedded instructions, but the run did not reproduce the dashboard payload shape and could not close the live boundary. Evidence anchor: `src/cli/quality/quality-command.ts` (search: `if (options.format === "json")`).

**Prevention update:** When a prompt-generated workflow crosses tool and permission boundaries, reproduce the exact generated command and payload through the real runner. Use `--format text` or parse `.prompt` deliberately, then assert the payload shape before launch. A file-tool write, parser unit, permission-rule probe, or escaped JSON envelope proves only its own layer.

---

## Lesson: Serve local HTML over localhost for browser-use evidence

**Status:** active | **Created:** 2026-04-27

**Prevention:** For local HTML/browser-use verification, serve the directory over localhost before opening the page. Treat `file://` empty DOM output as a verification-environment issue to rerun over HTTP before drawing conclusions. Evidence anchors: `workflow/skills/playbooks/browser-use.md` (search: `Local HTML shows an empty DOM`), `.goat-flow/skill-docs/playbooks/browser-use.md` (search: `serve the directory over localhost`).

**What happened:** During browser-use verification, opening the tracked landing page through a local `file://` URL succeeded at navigation but `browser-use state` returned `Empty DOM tree`. Serving the same directory with `python3 -m http.server 4182 --bind 127.0.0.1` and opening `http://127.0.0.1:4182/goat-flow-landing.html` returned the expected rendered page state and screenshot.

**Root cause:** A `file://` URL is not representative enough for local browser evidence in this agent environment. The browser navigation can succeed while DOM/state capture is empty, which makes a false negative look like a page problem.

---

## Lesson: Browser-use installer smoke must exercise the wrapper path

**Status:** active | **Created:** 2026-05-12

**Decision changed:** Treat every browser-use dependency upgrade as an interface migration: resolve the published console entry point, bind the compatible release line, and smoke the generated wrapper through that interface before updating instructions.
**Trigger phase:** READ | **Caught at:** READ | **Incident count:** 2 | **Latest occurrence:** 2026-08-29

**Prevention:** Pin the managed browser-use line to the interface the installer implements. Before using remembered commands, inspect `browser-use --help` and the package's published console entry point. The installer smoke must call the generated wrapper against a localhost page through an isolated loopback CDP browser, assert the expected help shape, capture page state and a screenshot, and stop only its own daemon and child processes. Shipped guidance must retain separate detected branches for current and already-installed legacy interfaces.

**What happened:** During the browser-use availability fix, `browser-use doctor` and direct Python Playwright launch passed, but `browser-use open https://example.com` failed with a 30s `BrowserStartEvent` timeout. Foreground daemon logs showed `BrowserSession` launched `/usr/bin/google-chrome-stable` and then waited for CDP. Inspecting `BrowserSession(headless=True).browser_profile.get_args()` showed no `--no-sandbox`; setting `IN_DOCKER=true` made `browser-use open` and `browser-use state` pass. A first installer smoke used `file://` and produced an empty title, repeating the existing local-file browser-use trap.

**Root cause:** The installer verified the Python modules and direct Playwright launch path, but not the generated `browser-use` wrapper and daemon launch path. In this root container, browser-use's Docker detection returned false, so it omitted Chrome's no-sandbox flags and Chrome exited before CDP came up. `browser-use close` also removed session metadata while leaving the daemon/browser process alive in this environment.

**Recurrence 2026-08-29:** The installer still upgraded browser-use without a compatibility bound and then smoked `open`, `get title`, and `close`. Published browser-use 0.13.8 maps the console command to CLI 3.0, rejects those legacy subcommands, and accepts stdin Python helpers instead. The first source check inspected `browser_use/cli.py` in the 0.12.9 tag and incorrectly suggested the legacy interface was gone there; `pyproject.toml` showed that the published `browser-use` entry point actually targeted `browser_use.skill_cli.main`, which retained the legacy subcommands. The correction therefore verifies the installed entry point and help shape rather than inferring behavior from a similarly named module. Evidence anchors: `test/unit/playbook-contract.test.ts` (search: `pip install --upgrade --quiet browser-use playwright`), `scripts/install-browser-tools.sh` (search: `browser-use~=0.13.8`), `scripts/install-browser-tools.sh` (search: `Installed browser-use does not expose the required CLI 3.0 stdin-Python interface`), and `workflow/skills/playbooks/browser-use.md` (search: `Choose commands from the observed help shape`).

---

## Lesson: Reproducing a server route means reusing its inputs, not just its composer

**Status:** active | **Created:** 2026-07-31
**Decision changed:** When driving an end-to-end run that stands in for an HTTP route, build the payload from the route's own input helpers; if any are stubbed, name which conclusions the run can and cannot support BEFORE spending the run.
**Trigger phase:** ACT

**Prevention:**
1. Before a costly reproduction run, diff your call site against the real caller argument by argument (here: `src/cli/server/dashboard-quality-routes.ts`, search: `composeQuality`). Every argument the real caller populates and yours stubs is a fidelity gap to declare or close.
2. Assert route-fidelity in the run's own output check: a report with `audit_status: "unavailable"` or `prior_report_id: null` when history exists means the prompt was degraded, and any diff computed from it is not resolution evidence.
3. Scope the conclusion to the layer actually exercised. A stubbed input invalidates conclusions that read it and leaves untouched those that do not - state which is which rather than reporting one verdict for the whole run.

**What happened:** The dashboard reporting end-to-end runs called the real `composeQuality` with `auditReport: null` and `priorReport: null`, while `/api/quality` passes `runAudit(...)`, `findLatestQualityReport(...)`, and `extractSharedFacts(...)`. Both approved cross-harness runs were spent before this surfaced. The persisted reports carried `audit_status: "unavailable"` and `prior_report_id: null`, so the agent was never asked to mark findings `persisted`; `quality diff` then reported `persisted: 0` with `resolved: 2` and `resolved: 5`, numbers that look like remediation success but are pure artifacts of missing prior linkage. The skills score drop (`setupDelta -10`, `systemDelta -15`) was equally uninterpretable. The persistence conclusion survived only because the staged-draft prompt section does not read audit or prior context - that was luck of layout, not design.

**Root cause:** I treated "calls the real composer" as equivalent to "reproduces the route". Passing `null` for optional context compiled, ran, and produced a plausible prompt, so nothing failed loudly - the degradation was visible only in two fields of the output report. Optional-but-populated inputs are the easiest fidelity gap to miss because the stub is a valid value.

---
