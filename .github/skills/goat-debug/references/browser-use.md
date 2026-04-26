# goat-debug reference: browser-use CLI

Last verified against: browser-use v0.2.x (2026-04-26)

Use when the bug report references a URL, a UI element, a visual rendering issue, browser DevTools output, or a browser console/network symptom.

## Availability check

Before first use in a session, verify the tool is installed:

```bash
command -v browser-use && browser-use doctor
```

If missing, ask the user before installing — never auto-install. If installation is not feasible, use the manual fallback section below.

## D1 evidence capture workflow

After reading the primary file and writing hypotheses, use browser evidence to confirm or eliminate UI-related hypotheses. Evidence classification: browser output is OBSERVED; interpretations remain INFERRED until mapped to `file:line`.

1. **Open the page:** `browser-use open <url>` — launches headless browser
2. **Capture state:** `browser-use state` — returns URL, title, clickable elements with indices
3. **Interact to reproduce:** use indices from state to replay the reported bug
   - `browser-use click <index>` — click element
   - `browser-use input <index> "text"` — clear and type into element
   - `browser-use keys "Enter"` — send keyboard keys
   - `browser-use select <index> "option"` — select dropdown value
   - `browser-use scroll down` — scroll (use `--amount N` for pixels)
4. **Capture evidence:** `browser-use screenshot [path.png]` — save or return base64
5. **Inspect deeper when needed:**
   - `browser-use eval "js code"` — execute JavaScript, return result
   - `browser-use get html [--selector "css"]` — page or scoped HTML
   - `browser-use get text <index>` — element text content
   - `browser-use get value <index>` — input/textarea value
   - `browser-use get attributes <index>` — element attributes
   - `browser-use get bbox <index>` — bounding box (x, y, width, height)
6. **Wait for async UI:** `browser-use wait selector "css"` or `browser-use wait text "text"`

Always run `state` before using element indices. Indices go stale after navigation or major UI changes — re-run `state` after any page transition.

## D4 verification workflow

After the fix is applied, rerun the original reproduction from D1:

1. `browser-use open <url>` — open the same page
2. Replay the same interaction sequence from D1
3. `browser-use screenshot [path.png]` — capture post-fix state
4. `browser-use state` — confirm expected elements are present/absent
5. Compare with D1 evidence: symptom should be gone

This is required proof for the Proof Gate on UI bugs.

## Browser modes

```bash
browser-use open <url>                         # Default: headless Chromium
browser-use --headed open <url>                # Visible window (useful for debugging)
browser-use connect                            # Connect to user's Chrome (requires approval)
browser-use --profile "Default" open <url>     # Specific Chrome profile (requires approval)
```

`--headed` is the most useful mode for debugging — shows exactly what the browser sees. Use it when headless results are ambiguous.

## Navigation and tabs

```bash
browser-use back                               # Go back in history
browser-use tab list                           # List all tabs
browser-use tab new [url]                      # Open a new tab
browser-use tab switch <index>                 # Switch to tab by index
browser-use tab close <index>                  # Close a tab
```

## Session management

```bash
browser-use close                              # Close browser and stop daemon
browser-use sessions                           # List active sessions
```

The browser persists between commands via a background daemon. Commands can be chained with `&&` when intermediate output is not needed:

```bash
browser-use open <url> && browser-use state
```

## Security cautions

- Do NOT use `connect`, `--profile`, profile sync, or cloud mode without explicit user approval
- Never paste cookies, tokens, auth headers, or credential-bearing URLs into commands or output
- Summarize sensitive network data by method, route shape, status, and sanitized field names only
- Screenshot files may contain sensitive rendered content — note this when saving to disk

## Fallback when browser-use is unavailable

When browser-use cannot be installed or run, capture equivalent evidence manually:

- **Screenshot:** OS screenshot tools or browser DevTools capture
- **DOM state:** browser DevTools Elements panel → copy outerHTML of relevant elements
- **Network trace:** browser DevTools Network tab → export HAR file
- **Console output:** browser DevTools Console tab → copy errors/warnings
- **Computed styles:** browser DevTools Computed tab for CSS debugging

Ask the user to provide this evidence. Manual evidence follows the same classification rules: raw captures are OBSERVED, interpretations are INFERRED.

## Troubleshooting

- **Browser won't start:** `browser-use close` then retry with `browser-use --headed open <url>`
- **Element not found after state:** `browser-use scroll down` then `browser-use state`
- **Stale indices after navigation:** re-run `browser-use state` to refresh
- **Run diagnostics:** `browser-use doctor`
