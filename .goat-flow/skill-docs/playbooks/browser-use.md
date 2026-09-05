---
goat-flow-reference-version: "1.17.0"
---
# Browser Evidence Reference

Use this when a task involves a URL, local HTML file, localhost page, screenshot request, browser-visible behavior, visual rendering issue, browser DevTools output, or browser console/network symptom.

`browser-use` is the default observation probe for agents: quick rendered state, screenshots, and simple interaction evidence. Playwright remains the better tool for durable automated browser tests, CI assertions, cross-browser coverage, and regression suites. For batch page capture (visit N pages, screenshot each, emit structured MD records), use `page-capture.md` instead.

## Availability Check

Before first use in a session, verify the tool is installed without invoking a subcommand that can fetch a helper:

```bash
command -v browser-use || command -v browser-use-python
```

If `browser-use` is found, run `browser-use --help` as the read-only capability gate. If only the venv wrapper exists, run `browser-use-python -c "import browser_use; print('ok')"`. Do not use `profile` commands for discovery: some versions download a separate helper when it is absent. If the tool is missing, offer installation or manual evidence; never install without approval.

The repository installer keeps its two wrappers distinct: `browser-use` controls an approved user/system Chrome or explicit CDP endpoint, while `browser-use-python` exposes Python Playwright and its Playwright-managed Chromium. Its isolated smoke connects the CLI to that managed browser through an explicit loopback CDP endpoint; normal CLI use does not select the Playwright browser automatically.

Choose commands from the observed help shape, not a remembered version number:

- **Current CLI 3.0:** help shows stdin Python usage such as `browser-use <<'PY'` and helpers such as `page_info()`.
- **Legacy CLI 0.12:** help lists positional `open`, `state`, and `screenshot` subcommands.
- **Unknown shape:** stop and report the captured help. Do not try commands from either branch until the interface is identified.

## Intent

A coding agent uses browser evidence to turn a browser-visible claim into observed facts before editing or declaring a fix done. The useful proof is compact: URL, rendered state, screenshot or DOM/text capture, interaction sequence, and the before/after symptom.

Use `browser-use` for one-off observations and simple interactions. For repeatable multi-page capture, stop and load `page-capture.md`; for CI-grade regression coverage, write Playwright tests.

## Observation Workflow

### Current CLI 3.0

The current local CLI attaches to the user's running Chrome, or may launch Chrome when none is available. It can see open tabs and logged-in state. Before the first browser-controlling call, obtain explicit approval unless the user already asked to control their current browser. A generic request to debug a URL is not approval to inspect their browser state.

Pass untrusted URLs as data rather than interpolating them into Python. This command opens one new tab, waits for the page, prints state, and saves a screenshot to the path reported by the helper:

```bash
BROWSER_TARGET_URL='https://example.com' browser-use <<'PY'
import os

new_tab(os.environ["BROWSER_TARGET_URL"])
wait_for_load()
print(page_info())
print(capture_screenshot())
PY
```

Use `new_tab(url)` for first navigation and `goto_url(url)` after a real tab exists. Use `js(code)` for scoped DOM/text inspection and `cdp(method, ...)` for raw DevTools data. Run `browser-use skill show` for the full installed helper interface; `skill show` is read-only, while `skill install` or an upgrade still requires approval.

### Legacy CLI 0.12

Use this branch only when `--help` lists the positional subcommands:

1. **Open the page:** `browser-use open <url>`
2. **Capture state:** `browser-use state`
3. **Capture screenshot:** `browser-use screenshot [path.png]`
4. **Inspect deeper when needed:** `browser-use get html`, `get text`, `get value`, `get attributes`, or `get bbox` as listed by that installation's help.

Treat browser output as OBSERVED evidence. Interpretations remain INFERRED until mapped to source files or reproduction steps.

For local HTML files, prefer serving the directory over localhost before opening the page. `file://` URLs can produce empty or nonrepresentative browser state in agent environments.

## Interaction Workflow

Refresh evidence before every interaction. Current CLI 3.0 uses fresh DOM/accessibility evidence and coordinates; Legacy CLI 0.12 uses element indices from the latest `state` output.

Current CLI 3.0, illustrative command shape only (the coordinates must come from observed page evidence):

```bash
browser-use <<'PY'
print(page_info())
click_at_xy(420, 315)
wait_for_load()
print(page_info())
print(capture_screenshot())
PY
```

Prefer the accessibility tree from `cdp("Accessibility.getFullAXTree")` or a scoped `js(...)` query over guessing from a screenshot. Use `fill_input(selector, text)`, `type_text(text)`, `press_key(key)`, and `scroll(x, y)` only after identifying the target from fresh evidence.

Legacy CLI 0.12:

```bash
browser-use click <index>
browser-use input <index> "text"
browser-use keys "Enter"
browser-use select <index> "option"
browser-use scroll down
browser-use scroll down --amount 800
browser-use wait selector "css"
browser-use wait text "text"
```

For UI bugs, capture before/after evidence:

1. Open the same URL or local route.
2. Replay the original interaction sequence.
3. Capture a screenshot with `capture_screenshot()` on Current CLI 3.0 or `browser-use screenshot [path.png]` on Legacy CLI 0.12.
4. Refresh state with `page_info()` on Current CLI 3.0 or `browser-use state` on Legacy CLI 0.12.
5. Compare against the original symptom. A fix is not verified until the browser-visible symptom is gone.

## Browser Modes

**Current CLI 3.0:** local control uses the user's visible Chrome and one default daemon. It has no legacy `--headed`, `--profile`, `--session`, or `--connect` flow. `BU_CDP_URL=<http-endpoint>` or `BU_CDP_WS=<ws-endpoint>` selects a specific approved CDP browser. `BU_NAME=<name>` selects a named cloud daemon, not a parallel local profile. Starting cloud browsers, syncing profiles, or using the user's browser requires explicit approval; cloud browsers can incur cost until stopped.

**Legacy CLI 0.12:** only when the installed help lists these flags, `--headed` opens visible managed Chromium, `--connect` reads the user's Chrome, `--profile` reads the named profile, and `--session` selects a named local daemon. `--connect`, `--profile`, profile sync, and cloud mode require explicit approval. Do not discover profiles through `profile` commands because the missing helper path can download and execute an additional installer.

If an approved connection fails, run the version-matched diagnostics and report the choice rather than silently switching between the user's browser and managed Chromium. They touch different state.

## Navigation and Sessions

Current CLI 3.0 exposes `goto_url(url)`, `list_tabs()`, `switch_tab(target)`, and `close_tab(target)` inside the stdin Python interface. The default local daemon persists across calls. `browser-use --reload` stops that daemon so the next call starts fresh; it does not close the user's Chrome.

Legacy CLI 0.12 exposes `back`, `sessions`, `open`, `switch`, `close-tab`, and `close` subcommands. Verify each command in that installation's help before use.

## Security Cautions

- Do NOT use `connect`, `--profile`, profile sync, or cloud mode without explicit user approval.
- On Current CLI 3.0, the default local flow itself controls the user's Chrome; apply the same approval boundary before the first browser-controlling call.
- Never paste cookies, tokens, auth headers, or credential-bearing URLs into commands or output.
- Summarize sensitive network data by method, route shape, status, and sanitized field names only.
- Screenshot files may contain sensitive rendered content. Save to temporary paths unless the user asked for an artifact.

## Verification Gate

Before using browser evidence as proof:

1. **State was captured at the right time.** Run `page_info()` on Current CLI 3.0 or `browser-use state` on Legacy CLI 0.12 after opening the page and again after navigation or major UI changes.
2. **Visual claims have a capture.** Pair any rendered-layout, screenshot, or "the UI now shows X" claim with `capture_screenshot()` on Current CLI 3.0, `browser-use screenshot` on Legacy CLI 0.12, or scoped DOM/text output.
3. **Interactions are reproducible.** Record the click/input/key sequence in enough detail that another agent can replay it.
4. **Fix verification replays the original symptom.** A browser-visible bug is not fixed until the original URL and interaction sequence no longer reproduce it.
5. **Sensitive data is handled.** Screenshots and copied DOM/network output omit credentials, tokens, cookies, and personal data unless the user explicitly asked for that artifact and it is safe to share.

## Fallback When browser-use Is Unavailable

When `browser-use` cannot be installed or run, capture equivalent evidence manually:

- **Screenshot:** OS screenshot tools or browser DevTools capture
- **DOM state:** browser DevTools Elements panel, copy outerHTML of relevant elements
- **Network trace:** browser DevTools Network tab, export HAR file
- **Console output:** browser DevTools Console tab, copy errors/warnings
- **Computed styles:** browser DevTools Computed tab for CSS debugging

Ask the user to provide this evidence. Manual evidence follows the same classification rules: raw captures are OBSERVED, interpretations are INFERRED.

## Troubleshooting

- **Identify the interface first:** rerun `browser-use --help`; an unknown shape is unsupported evidence, not a reason to guess.
- **Current CLI 3.0 cannot connect:** run `browser-use --doctor` and follow its Chrome remote-debugging guidance. Do not enable access to the user's browser without approval.
- **Current CLI 3.0 daemon is stale:** run `browser-use --reload`, then retry the same stdin Python reproduction.
- **Legacy CLI 0.12 browser will not start:** `browser-use close` then retry with `browser-use --headed open <url>`.
- **Legacy CLI 0.12 times out in a root/container:** run `browser-use close --all`, then retry the same smoke with `IN_DOCKER=true browser-use open <url>` before declaring the wrapper unusable.
- **Local HTML shows an empty DOM:** serve the directory over localhost and open the HTTP URL instead of `file://`
- **Element is absent:** refresh `page_info()` on Current CLI 3.0 or scroll and rerun `state` on Legacy CLI 0.12 before interacting.
- **Run diagnostics:** `browser-use --doctor` on Current CLI 3.0; use the spelling shown by Legacy CLI 0.12 help on legacy installations.

## Cleanup

When done with Current CLI 3.0 local work, close task-created tabs if appropriate and use `browser-use --reload` when the daemon must release its connection; never close the user's Chrome. A cloud browser is different: ask whether to stop it, then use `stop_remote_daemon(name)` only after approval because it terminates the remote resource.

On Legacy CLI 0.12, use `browser-use close` for the selected session, `browser-use close --all` only when every named session is in scope, and `browser-use tunnel stop --all` only if you started those tunnels. Verify the commands in help before cleanup. Do not leave a cloud browser running accidentally; it may continue billing.

## Related References

- `.goat-flow/skill-docs/playbooks/page-capture.md` - batch capture across many known pages (screenshot each, emit one MD record per page); load it instead when the task is multi-page evidence rather than a single observation
- `.goat-flow/skill-docs/skill-preamble.md` - the Proof Gate and the OBSERVED / INFERRED evidence tagging this playbook applies to browser output
