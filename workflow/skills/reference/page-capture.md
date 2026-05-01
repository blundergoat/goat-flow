---
goat-flow-reference-version: "1.4.0"
---
# Page Capture Reference

Use this when a task requires visiting a list of pages in a real browser, capturing a screenshot of each, and emitting a markdown record per page. Typical triggers: documenting new pages after a feature ships, capturing a UI baseline before a release, recording before/after evidence across multiple pages, or producing an audit-style page snapshot.

Page Capture is the durable batch workflow: scripted, repeatable, evidence-grade. `browser-use` is the right tool for one-off mid-task observation. Playwright MCP plus this reference is the right tool for batch capture across multiple pages with load verification, especially when authentication or framework-specific patterns matter.

## Boundary

| Job | Tool | Reference |
|---|---|---|
| Single observation, mid-skill, agent decides what to look at | `browser-use` CLI | `browser-use.md` |
| Visit N known pages, screenshot each, emit structured MD | Playwright MCP | this file |
| Test-suite-driven evidence (assertion → screenshot → record on fail) | Playwright Test + custom reporter | not in goat-flow; see Playwright reporter docs |
| Crawl/discover pages an agent hasn't seen | `browser-use` with agent loop | `browser-use.md` |

If the task fits row 1 or row 4, stop and load `browser-use.md` instead. If the task fits row 3, document it as a project-level test-runner concern, not a goat-flow workflow.

## Availability Check

Before first use in a session, confirm Playwright MCP tools are available. The skill should be able to call:

- `browser_navigate` - load a URL
- `browser_screenshot` - capture visual screenshot to file
- `browser_snapshot` - DOM/accessibility tree with refs
- `browser_evaluate` - run JS in page context
- `browser_resize` - set viewport
- `browser_wait_for` - wait for text or selector
- `browser_console_messages` - capture console output by level
- `browser_network_requests` - list requests with filter

If any are missing, state which and stop. Do not fall back to a less capable tool silently - capture quality drops and the discipline below cannot be honoured.

## Project Reference Pattern

This file is generic by design. Project-specific knowledge does NOT live in `.goat-flow/skill-reference/` - that directory is reserved for goat-flow's own references. Project knowledge splits across two layers:

| Layer | What it holds | Where it lives |
|---|---|---|
| Project reference | How-to playbook for driving the project's app - auth flow, framework gotchas, selectors, viewport conventions | `.goat-flow/patterns/<project>-playwright.md` (vendor-neutral, readable by any coding agent) |
| Project learning loop | Recurring traps with file evidence, dated lessons from incidents, repeatable patterns | `.goat-flow/footguns/<category>.md`, `.goat-flow/lessons/<category>.md`, `.goat-flow/patterns/<category>.md` |

The split matters: a project reference is taught knowledge ("here's how to drive this app"), while footguns and lessons are learned-from-incident knowledge ("here's a trap we hit, with the evidence"). A framework gotcha that surfaced once goes in the project reference. A framework gotcha that has bitten three times with file:line evidence belongs as a footgun entry.

A project reference typically covers:

- Auth flow specifics - login URL, 2FA, storage state path
- Framework gotchas - debug toolbars to hide, JS init waits, dropdown libraries that bypass native events, editor models that hide their value
- Selector conventions - data attributes, class patterns, ID conventions
- Viewport conventions if the project tests at non-default sizes
- Pages or routes to exclude - admin, destructive, slow, flaky

A goat-flow skill loading this `page-capture.md` reference should also:

1. Detect and load any project reference at the conventional path
2. Run the standard footgun grep against `.goat-flow/footguns/` for the target area before capture begins

Project specifics never leak into this file. If a pattern keeps recurring across projects, that's the signal to lift it here - but the bar is high.

## Capture Workflow

### Step 0 - Intake

Confirm before proceeding. Ask only what's missing.

1. **Page list** - explicit URLs, manifest path, or a diff to derive from
2. **Auth** - required? If yes: storage state path, login flow, or none
3. **Viewport** - default `1280×800` desktop unless stated; `390×844` for mobile checks
4. **Output dir** - where MD files and screenshots land
5. **Project reference** - does one exist at `.goat-flow/patterns/<project>-playwright.md`? Read it now if so. Also run the footgun grep for the target area against `.goat-flow/footguns/` per `skill-preamble.md`

If any answer is unclear, ask. Do not guess URLs or auth flow.

### Step 1 - Pre-flight

- Set viewport once: `browser_resize → width: <W>, height: <H>`. Consistency across captures matters; do not resize per page.
- If auth is required:
  - Storage state path → load it before navigating
  - Login flow → run it once at the start, capture storage state, reuse for the rest of the run
  - Never paste credentials, tokens, or session IDs into MD output

### Step 2 - Per-Page Loop

For each URL:

1. **Navigate** - `browser_navigate → <url>`
2. **Verify load** - wait for an anchor before screenshotting. In order of preference:
  - `browser_wait_for → text: "<expected page text>"` (best - anchored to content)
  - `browser_wait_for → selector: "<css>"` (good - anchored to structure)
  - Network idle via `browser_network_requests` polling (fallback)
  - Fixed `browser_wait_for → time: <n>` (last resort; mark capture's load as INFERRED)
3. **Apply project reference fixes** - hide debug toolbars, dismiss banners, wait for app-specific JS init, anything documented in the project reference
4. **Screenshot** - full page via `browser_screenshot`, save to `<output_dir>/screenshots/<slug>.png`. Slug is derived from the URL path (strip query params and fragments; use param values only if two URLs share the same path). Collisions get a numeric suffix
5. **Capture metadata** - URL, page title (`browser_evaluate → () => document.title` or snapshot depth 1), viewport, UTC ISO 8601 timestamp, console error count via `browser_console_messages → level: "error"` (count only, do not paste contents)
6. **Write MD record** to `<output_dir>/<slug>.md` using the output format below

If verification fails (timeout, 4xx/5xx, console error class) - do NOT skip silently. Record the page with status `failed` and the failure reason. Continue to the next page.

### Step 3 - Index

After all pages processed, write `<output_dir>/index.md`:

```markdown
# Page Capture - <run_label>

**Captured:** <UTC timestamp>
**Viewport:** <W>×<H>
**Auth:** authenticated / unauthenticated
**Pages:** <N total>, <N succeeded>, <N failed>

## Pages

| # | Page | Status | Record |
|---|------|--------|--------|
| 1 | <title> | ok / failed | `./<slug>.md` |

## Failures

<list each failure with URL and reason, or "None">
```

### Step 4 - Verification Gate

Before claiming the run complete, verify:

- Every URL in the input list has a corresponding MD file or a recorded failure
- Every screenshot path in every MD file resolves to a real file on disk
- Index file exists and lists every record
- No credentials, tokens, or PII appear in any MD file (grep the output dir before closing)

State the count: "Captured N/M pages successfully. Index at `<path>`." If any verification step fails, state which and stop. This is the Proof Gate from `skill-preamble.md` applied to the capture run - every claim ("captured", "succeeded") must be substantiated by a file on disk in this session, not by a tool call return value.

## Diff-Driven Mode

When the task is "capture pages affected by these changes," map diff to pages via a manifest:

- Project ships a manifest mapping routes to source files (e.g. `<project>-playwright.config` listing `{ route, source_paths }`)
- Read `git diff` (or PR-derived diff via `gh pr diff`)
- Intersect changed source paths with manifest entries
- Capture matching routes; report unmatched changed paths so the manifest can be updated

Heuristic mode (infer routes from changed file paths without a manifest) is possible but lower confidence. Mark such captures' page selection as INFERRED until a human confirms route coverage.

## Output Format

One MD file per page:

```markdown
# <Page title>

**URL:** <url>
**Captured:** <UTC ISO 8601>
**Viewport:** <W>×<H>
**Status:** ok / failed
**Load verification:** text / selector / network-idle / time (INFERRED)
**Console errors:** <count>

`./screenshots/<slug>.png`

## Notes

<one or two sentences describing what's on the page - visible headings, primary action, anything notable. OBSERVED only. Leave blank if nothing noteworthy.>

## Failure

<only present when status: failed. Include the reason (timeout, 4xx, console error class) and the wait condition that didn't resolve. No stack traces, no full error bodies.>
```

## Discipline

- Screenshot evidence is OBSERVED. Any post-capture interpretation in the Notes section is INFERRED unless mapped to a `file:line` or repeatable reproduction.
- Failures are recorded, never skipped. A run that captured 8 of 10 pages with 2 failures is more honest than a run that silently dropped 2.
- Read-only navigation. Do not click buttons that mutate state, submit forms, or follow destructive links unless the task explicitly requires it (e.g. capturing a confirmation page after submission).
- Per-run consistency: viewport, auth, browser version stable across all pages in the same run. Different runs may legitimately differ; within a run they should not.

## Security Cautions

- Never paste cookies, tokens, auth headers, session IDs, or credential-bearing URLs into MD output or screenshots' surrounding text
- Console output may contain stack traces with secrets - record error counts and sanitised class names, never raw bodies
- Network requests may contain auth headers - when summarising, give method, route shape, status; never headers or bodies
- Screenshots may render sensitive content (PII, account data, internal IDs) - save to a temporary path until reviewed; only move to a shared location after review
- For healthcare or regulated contexts, use synthetic accounts; never capture pages logged in as a real user

## Fallback When Playwright MCP Is Unavailable

If Playwright MCP isn't connected or the tools above are missing, capture equivalent evidence manually:

- Manual screenshot via OS or browser DevTools
- Page title and headings via DevTools Console copy
- Console errors via DevTools Console export
- Network requests via DevTools Network tab → HAR export

Ask the user to provide this evidence. Manual evidence follows the same classification: raw captures are OBSERVED, interpretations are INFERRED. Note in the index that the run was manual; reproducibility drops and that should be visible.

## Troubleshooting

- **Page seems loaded but screenshot is blank** - JS init not complete. Add a `browser_wait_for` on a known late-rendered element from the project reference, or wait for a network idle window
- **Screenshot crops the modal or content** - viewport too short. Resize to `1280×800` or larger and re-capture; document the size used
- **Auth state not persisting between pages** - storage state file path wrong, or login session has IP/UA binding. Recapture storage state at run start
- **Console errors on every page** - likely third-party (analytics, tracking). Filter by source URL before deciding the page failed; document filter in the project reference
- **Same slug for two URLs** - append `-2`, `-3` deterministically. Do not silently overwrite
- **Diff-driven mode captures wrong pages** - manifest is stale. Surface the unmatched changed paths and ask the user to update the manifest before relying on the run

## Related References

- `browser-use.md` - single-observation probe; load this instead when the task is mid-skill spot-check
- `skill-preamble.md` - Proof Gate, OBSERVED/INFERRED tagging, evidence discipline that all goat-flow output inherits
- `skill-conventions.md` - footgun and lesson entry shapes for project-level traps that recur with evidence
- Project Playwright reference (e.g. `.goat-flow/patterns/<project>-playwright.md`) - framework gotchas, auth, selectors. Vendor-neutral path so any coding agent can read it.
