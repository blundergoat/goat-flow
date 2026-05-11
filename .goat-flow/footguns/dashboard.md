---
category: dashboard
last_reviewed: 2026-05-12
---

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

## Footgun: Dashboard terminal prompts can be dropped before browser attachment

**Status:** active | **Created:** 2026-05-10 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Clicking a dashboard action such as "Run Quality Assessment in Runner" creates a Claude terminal session with the right title, but the terminal lands at Claude's empty `❯` prompt with no assessment prompt pasted. A related Claude Code variant shows `[Pasted text #N +... lines]` in the composer and never submits it.

**Evidence:**
- User-observed dashboard session on 2026-05-10: "Quality Agent Installation for Claude Code via Claude Code" opened in Claude Code v2.1.138, reached the `❯` prompt, and no quality prompt appeared.
- `test/smoke/dashboard-endpoints.test.ts` (search: `waits for runner output to settle before initial prompt delivery`) reproduces the multi-chunk startup condition: a second output chunk must reset the initial-input timer, and no prompt may be written until output has been quiet.
- `src/dashboard/dashboard-terminal.ts` (search: `dashboardOutputLooksReadyForLaunchPrompt`) sends dashboard-launched prompts after the browser terminal is attached and the runner output reaches an interactive prompt, with a fallback timer for runners whose readiness cannot be detected.
- Built-dashboard browser verification on 2026-05-10: clicking "Run Quality Assessment in Runner" opened Claude Code v2.1.138 and pasted the generated `# GOAT Flow Quality Assessment - Claude Code` prompt into the terminal.
- User-observed Skills page session on 2026-05-10: "Assess in Runner" opened Claude Code v2.1.138 and showed `[Pasted text #1 +110 lines]` instead of running the skill quality prompt.
- `src/dashboard/dashboard-terminal.ts` (search: `TERMINAL_PASTE_SUBMIT_DELAY_MS`) submits dashboard-launched pasted prompts as a second PTY input after the bracketed paste, so Claude Code can commit the pasted-text block before Enter is sent.
- `test/unit/dashboard-terminal-launch.test.ts` (search: `data: "\r"`) pins the split paste-then-submit browser wire contract.
- Built-dashboard browser verification on 2026-05-11: clicking Skills -> Assess in Runner sent the prompt when Claude Code reached its footer, detected the `[Pasted text #1 +108 lines]` echo, sent Enter 112 ms after paste, and the terminal proceeded to read `.goat-flow/skill-reference/skill-preamble.md` instead of remaining at the pasted-text composer.
- `src/dashboard/dashboard-terminal.ts` (search: `dashboardHandlePasteSubmitOutput`) submits browser-side pasted prompts on Claude Code's pasted-text echo, with `TERMINAL_PASTE_SUBMIT_DELAY_MS` as the fallback for runners that do not echo that state.
- Built-dashboard browser verification on 2026-05-12: clicking Setup with runner `gemini` and target Gemini CLI opened Gemini CLI v0.41.2, waited through the signed-in/auth splash, then sent `# GOAT Flow Setup - Gemini CLI`; Gemini entered `Thinking...` after receiving the `goat-flow audit . --harness --agent gemini` instruction.
- `src/dashboard/dashboard-terminal.ts` (search: `dashboardOutputLooksReadyForLaunchPrompt`) treats Gemini's `Type your message or @path/to/file` composer as the input-safe marker before sending launch prompts.
- `src/dashboard/dashboard-terminal.ts` (search: `dashboardOutputLooksCommittedPaste`) recognises Gemini's `[Pasted Text: N lines]` marker, and `src/dashboard/dashboard-terminal.ts` (search: `dashboardHandlePasteSubmitOutput`) delays Gemini's Enter submit briefly after that marker so the TUI has committed the collapsed paste.

**Why it happens:** Agent CLIs render startup screens in multiple PTY chunks, and Claude Code's remote-control startup can ignore a server-side initial PTY paste even after a simple delay. The PTY write succeeds from goat-flow's perspective, but the runner can drop or ignore the prompt before the browser-attached terminal path is ready. For browser-side Claude Code sends, sending bracketed paste markers, prompt text, and Enter in one PTY write, or sending Enter before Claude has committed the pasted-text block, can also leave Claude in its pasted-text composer state without submitting.

**Prevention:**
1. For dashboard launch buttons, create promptless backend terminal sessions and send the prompt after the browser terminal is attached and runner output looks ready or has gone quiet.
2. When changing `scheduleInitialInput`, test at least two output chunks with a delay between them and assert no prompt write before the final quiet window.
3. For browser-side sends, keep bracketed paste and Enter as separate ordered WebSocket inputs; submit on Claude Code's pasted-text echo or a bounded fallback, and do not collapse them back into one `paste + "\r"` payload.
4. Verify built-dashboard behavior after restarting the dashboard process; a running `dist/cli/cli.js dashboard` server keeps old terminal code in memory until restart.
5. For runner TUIs with auth or splash redraws, gate launch prompts on that runner's real composer marker and test its pasted-text marker separately; Gemini needs both `Type your message or @path/to/file` readiness and delayed submit after `[Pasted Text: ...]`.

---

## Footgun: Dashboard agent-targeting uses activeRunner where it should use the failing or selected agent

**Status:** active | **Created:** 2026-05-03 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** The Home "Fix First" card shows a command like `--agent claude` but the agent with the actual failing harness check is a different agent (e.g. codex at 93%). The Setup page shows harness grades (A 100%, A 93%) on the target cards but the generated setup prompt reflects a different audit scope, so a 93% agent can show "All audit checks pass" and a 100% agent can show "1 audit check failing".

**Evidence:**
- `src/dashboard/views/home.html` (search: `nextActionCommand`) composed the harness fix command with `activeRunner` instead of the agent that actually had the failing check. The same applied to `harnessFixPrompt` (search: `harnessFixPrompt`) which built the fix prompt context for `activeRunner` instead of the failing agent.
- `src/cli/server/dashboard-routes.ts` (search: `/api/setup`) called `runAudit` with `harness: false`, so the setup prompt was generated from install-scope checks only. But the Setup target cards scored agents using `report.agentScores[].harness.checks` (harness scope). The two scopes have different check sets, producing contradictory pass/fail signals on the same page.
- `src/cli/prompt/compose-setup.ts` (search: `renderAuditFail`) collected failing checks from `scopes.setup` and `scopes.agent` only, omitting `scopes.harness` — so even when harness was enabled, harness failures were invisible in the setup prompt output.
- Observed live on 2026-05-03: basedata.halaxy.net project, Codex at A 93% (Context concern: Artifact Routing), Claude at A 100%. Home Fix First said `--agent claude`. Setup prompt for Codex said "All audit checks pass"; setup prompt for Claude showed a failing check.

**Why it happens:** The dashboard has two distinct agent roles — the **runner** (which CLI executes the prompt, set via the header dropdown as `activeRunner`) and the **target** (which agent's config to inspect or fix). Several code paths conflated the two. Separately, the Setup page card grades and the setup prompt API used different audit scopes (`harness: true` for display vs `harness: false` for generation), so the prompt contradicted the grade shown directly above it.

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
