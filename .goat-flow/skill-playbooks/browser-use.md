---
goat-flow-reference-version: "1.7.0"
---
# Browser Evidence Reference

Last verified against: browser-use v0.2.x (2026-04-26)

Use this when a task involves a URL, local HTML file, localhost page, screenshot request, browser-visible behavior, visual rendering issue, browser DevTools output, or browser console/network symptom.

`browser-use` is the default observation probe for agents: quick rendered state, screenshots, and simple interaction evidence. Playwright remains the better tool for durable automated browser tests, CI assertions, cross-browser coverage, and regression suites. For batch page capture (visit N pages, screenshot each, emit structured MD records), use `page-capture.md` instead.

## Availability Check

Before first use in a session, verify the tool is installed:

```bash
command -v browser-use || command -v browser-use-python
```

If found, run `browser-use doctor` (or `browser-use-python -c "import browser_use; print('ok')"` for the venv wrapper). If missing, offer to install: "browser-use is not installed. Want me to install it (`pip install browser-use` or `scripts/install-browser-tools.sh`)? Or I can work from manual evidence (screenshots, DevTools output) instead." Never install it without approval. If the user declines or installation fails, use the manual fallback section below.

## Observation Workflow

For viewing a page, checking static HTML, or capturing first evidence:

1. **Open the page:** `browser-use open <url>`
2. **Capture state:** `browser-use state` - returns URL, title, page dimensions, scroll, and clickable elements with indices
3. **Capture screenshot:** `browser-use screenshot [path.png]`
4. **Inspect deeper when needed:**
   - `browser-use get html [--selector "css"]` - page or scoped HTML
   - `browser-use get text <index>` - element text content
   - `browser-use get value <index>` - input/textarea value
   - `browser-use get attributes <index>` - element attributes
   - `browser-use get bbox <index>` - bounding box

Treat browser output as OBSERVED evidence. Interpretations remain INFERRED until mapped to source files or reproduction steps.

For local HTML files, prefer serving the directory over localhost before opening the page. `file://` URLs can produce empty or nonrepresentative browser state in agent environments.

## Interaction Workflow

Always run `browser-use state` before using element indices. Re-run `state` after navigation or major UI changes because indices can go stale.

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
3. Capture `browser-use screenshot [path.png]`.
4. Capture `browser-use state`.
5. Compare against the original symptom. A fix is not verified until the browser-visible symptom is gone.

## Browser Modes

```bash
browser-use open <url>                         # Default: headless Chromium
browser-use --headed open <url>                # Visible window for ambiguous headless results
browser-use connect                            # Connect to user's Chrome; requires explicit approval
browser-use --profile "Default" open <url>     # Specific Chrome profile; requires explicit approval
browser-use --session NAME open <url>          # Named session for parallel browsers (subagent flows, multi-tab QA)
```

Use `--headed` when headless output is ambiguous. Do not use `connect`, `--profile`, profile sync, or cloud mode without explicit user approval.

### When `browser-use connect` fails

If `connect` cannot find a running Chrome with remote debugging, do not silently fall back. Surface the choice to the user with both options and let them pick — installed-Chrome and managed-Chromium are not equivalent because each touches different state:

1. **Use the user's real Chrome.** They must enable remote debugging first: open `chrome://inspect/#remote-debugging` or relaunch Chrome with `--remote-debugging-port=9222`. Then retry `browser-use connect`.
2. **Use managed Chromium with a Chrome profile.** Run `browser-use profile list` to show available profiles, ask which one, then run `browser-use --profile "ProfileName" open <url>`. This launches a separate Chromium instance with the chosen profile (cookies, logins, extensions); no Chrome relaunch needed.

Both paths require explicit user approval — they read login state. Never pick one autonomously.

## Navigation and Sessions

```bash
browser-use back
browser-use sessions
browser-use open <url>
browser-use switch <index>
browser-use close-tab [index]
browser-use close
```

The browser persists between commands via a background daemon. Close it when done with `browser-use close`.

## Security Cautions

- Do NOT use `connect`, `--profile`, profile sync, or cloud mode without explicit user approval.
- Never paste cookies, tokens, auth headers, or credential-bearing URLs into commands or output.
- Summarize sensitive network data by method, route shape, status, and sanitized field names only.
- Screenshot files may contain sensitive rendered content. Save to temporary paths unless the user asked for an artifact.

## Fallback When browser-use Is Unavailable

When `browser-use` cannot be installed or run, capture equivalent evidence manually:

- **Screenshot:** OS screenshot tools or browser DevTools capture
- **DOM state:** browser DevTools Elements panel, copy outerHTML of relevant elements
- **Network trace:** browser DevTools Network tab, export HAR file
- **Console output:** browser DevTools Console tab, copy errors/warnings
- **Computed styles:** browser DevTools Computed tab for CSS debugging

Ask the user to provide this evidence. Manual evidence follows the same classification rules: raw captures are OBSERVED, interpretations are INFERRED.

## Troubleshooting

- **Browser will not start:** `browser-use close` then retry with `browser-use --headed open <url>`
- **Local HTML shows an empty DOM:** serve the directory over localhost and open the HTTP URL instead of `file://`
- **Element not found after state:** `browser-use scroll down` then `browser-use state`
- **Stale indices after navigation:** re-run `browser-use state`
- **Stuck session after a failed command:** `browser-use close` (or `browser-use close --all` to clear every named session) before retrying
- **Run diagnostics:** `browser-use doctor`

## Cleanup

When you are done with a browser-driven session, close the daemon and any side resources you opened:

```bash
browser-use close                  # Close the default session
browser-use close --all            # Close every named session if you used --session
browser-use tunnel stop --all      # Only if you started a tunnel earlier
```

Leaving the daemon running is harmless but consumes memory and keeps any open Chromium / cloud session alive.
