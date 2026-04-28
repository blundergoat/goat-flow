---
category: dashboard
last_reviewed: 2026-04-29
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
