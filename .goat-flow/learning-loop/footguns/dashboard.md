---
category: dashboard
last_reviewed: 2026-07-26
---

<!-- Note: pre-v1.8.0 entries below may reference "Gemini"; Antigravity replaced Gemini in v1.8.0. Where the underlying trap shape applies equally to Antigravity (box-bordered menus, selection-bullet glyphs, CUP positioning), the Gemini references are kept as historical evidence. Where they describe current code behavior, they have been updated to Antigravity. -->


## Footgun: Project-browser modal is reachable only via header-span click, not from the add-project flow

**Status:** active | **Created:** 2026-04-18 | **Evidence:** ACTUAL_MEASURED

**Prevention:**
1. If refactoring the header, grep for `openBrowser` before changing the project-name span - it is currently the only visible path to the filesystem picker.
2. If the Add Project flow gains its own Browse button, remove the header-only path to avoid duplication; otherwise keep both and document the header trigger in the Add Project view so users in that mental model can find it.
3. When adding any modal with Alpine `x-show`, add a smoke test or manual-test note that clicking the intended visible trigger actually opens it.

**Symptoms:** Users looking for a filesystem-browse capability while adding a project find only a text input. The browse modal exists and works, but its only visible trigger is the project-name span in the page header (tooltip: "Switch project"). Reviewers testing the "Add Project" flow report the modal as "not opened directly from a visible UI button".

**Evidence:**
- Trigger is a clickable span in the header: `src/dashboard/index.html` (search: `@click="openBrowser()"`), tooltip via `title="Switch project"`.
- Modal markup behind the trigger: `src/dashboard/index.html` (search: `x-show="showBrowser"`).
- Handler: `src/dashboard/dashboard-app-hook-setup-fragments.ts` (search: `async openBrowser()`) toggles `showBrowser` and calls `browseTo(this.projectPath)`.
- Live UI session on 2026-04-18: tester exercising the Add Project flow needed programmatic `showBrowser = true` via Alpine state to reach the modal. They did not notice the header span because the Add Project form shows a text input and no Browse button.

**Why it happens:** Two independent add-project surfaces exist - a text input on the Add Project view, and a filesystem picker triggered from the header's "Switch project" affordance. There is no visible cross-link between the two, and the "Switch project" label does not suggest adding a new project.

---

## Footgun: Tailwind utility class names collide with custom component classes

**Status:** active | **Created:** 2026-04-26 | **Evidence:** ACTUAL_MEASURED

**Prevention:**
1. Never name custom component classes with bare Tailwind utility names. Prefix with the project namespace (e.g., `gf-ring`, `ring-chart`) or use multi-word names that Tailwind won't generate.
2. Avoid these known collision-prone names: `ring`, `shadow`, `blur`, `inset`, `container`, `table`, `hidden`, `visible`, `fixed`, `absolute`, `relative`, `block`, `flex`, `grid`, `border`, `outline`, `accent`, `columns`.
3. When an element has unexpected visual artifacts (hairlines, shadows, outlines) that don't appear in your CSS, check the browser's computed styles for Tailwind-generated rules on the same class name.
4. When `border: none` / `box-shadow: none` doesn't fix a visual artifact, inspect computed styles to find the actual property - the property you're overriding may not be the one causing it.

**Symptoms:** A custom CSS rule appears correct in source but the rendered element has unexpected `box-shadow`, `border`, `outline`, or other properties that the custom rule never declares. Adding `border: none` or `box-shadow: none` to the custom rule has no effect because Tailwind's utility has equal or higher specificity and re-applies the property. The unwanted style is only visible in the browser's computed styles panel.

**Evidence:**
- The donut chart element used `class="ring"` with a custom `.ring` rule in `src/dashboard/styles.css` (search: `ring-chart`) providing `conic-gradient`, `border-radius: 999px`, etc.
- Tailwind v4 generates a `.ring` utility that applies `box-shadow: 0 0 0 calc(1px + ...) var(--tw-ring-color, currentcolor)`, stacking a 1px dark hairline border on the donut.
- The agent tried `border: none` on `.ring` but the shadow persisted because it was `box-shadow`, not `border`. The user identified the root cause only after inspecting computed styles via a browser extension and finding the Tailwind-generated `box-shadow` rule.
- Fix: renamed the custom class from `ring` to `ring-chart` in both CSS and HTML.

**Why it happens:** Tailwind generates utility classes from common CSS property names (`ring`, `shadow`, `blur`, `inset`, `container`, `table`, `hidden`, etc.). Any custom component class that shares one of these names will silently inherit Tailwind's declarations. The collision is invisible in source code because the custom CSS file and Tailwind's generated output are separate. Agents cannot diagnose this from source alone - it requires inspecting the rendered DOM's computed styles.

---

## Footgun: Dashboard reader decoders can erase score-critical API fields

**Status:** active | **Created:** 2026-05-01 | **Evidence:** ACTUAL_MEASURED

**Prevention:**
1. When a dashboard view branches or scores on an API field, verify the matching `readDashboardReport` / helper decoder preserves that field.
2. Pair backend scoring changes with a browser-reader regression, especially for discriminants such as `type`, `status`, `concern`, and `id`.
3. Browser-verify the built `dist/` dashboard and compare it with `/api/audit` output; source-only tests can miss packaged reader drift.

**Symptoms:** The dashboard can show concern scores, metric notes, or pass/fail labels that disagree with `/api/audit`. The API payload is correct, but the browser-side decoded object has lost the discriminant needed by the view's scoring and display expression.

**Evidence:**
- `src/dashboard/dashboard-readers.ts` (search: `function readAuditCheck`) decodes `/api/audit` checks before the views score them.
- `src/dashboard/views/home.html` (search: `setupBlocked()`) gates setup-blocked projects before showing harness readiness scores.
- `src/cli/server/types.ts` (search: `type?: HarnessCheckType`) now records the wire contract so `type` is preserved across the server/dashboard boundary.
- `test/unit/dashboard-readers.test.ts` (search: `preserves harness check type so metric failures can be shown as non-gating score evidence`) pins the reader contract: a failing `metric` check must remain visible as a metric so the UI can apply metric-specific scoring and copy instead of treating it as an ordinary failed audit check.

**Why it happens:** Dashboard views run from classic browser scripts and score the already-decoded browser model, not the raw API JSON. Backend scoring and API typing can be correct while a browser reader silently drops a discriminant such as `type`, collapsing `metric` into "ordinary failed check" or hiding why a score changed without failing the concern.

---

## Footgun: Dashboard aggregate facts and Home agent cards can use different agent sets

**Status:** active | **Created:** 2026-05-13 | **Evidence:** ACTUAL_MEASURED

**Prevention:**
1. For Home agent visibility changes, update both `resolveDashboardManagedAgentIds` and the `runAuditBatch` aggregate fact extraction path.
2. Regression tests must assert both `report.agentScores[].id` and `report.scopes.agent`; card-only assertions can miss aggregate scope drift.
3. Use a fixture where `.goat-flow/config.yaml` lists only one agent while supported registry expectations require all dashboard agents.

**Symptoms:** Home can show or hide agent cards differently from the aggregate Agent Setup scope. A project may report aggregate `agent-instruction` as passing even when the Home summary is supposed to expose missing supported agents.

**Evidence:**
- `src/cli/server/dashboard-audit-routes.ts` (search: `resolveDashboardManagedAgentIds`) resolves the managed agent ids used for dashboard per-agent cards.
- `src/cli/audit/audit.ts` (search: `runAuditBatch`) extracts aggregate facts once, then derives per-agent facts from that batch.
- `src/cli/facts/orchestrator.ts` (search: `managedAgentIds`) receives the dashboard-managed agent set so aggregate facts and per-agent cards use the same ids.
- `test/integration/dashboard-audit-api.test.ts` (search: `includes all supported agents even when config lists one`) caught the partial-fix failure: cards were moving toward all supported agents, but the aggregate agent scope still passed with only the config-listed agent.

**Why it happens:** The dashboard report has two related but separate paths: aggregate audit scopes and per-agent Home cards. Changing only the route-level managed-agent helper does not change the fact extraction already performed inside `runAuditBatch`; the batch extractor needs the same managed agent ids before it derives aggregate and per-agent facts.

---

## Footgun: Dashboard agent-targeting uses activeRunner where it should use the failing or selected agent

**Status:** active | **Created:** 2026-05-03 | **Evidence:** ACTUAL_MEASURED

**Prevention:**
1. When composing a fix/action command or prompt for harness issues, resolve the target agent from the audit data (which agent actually has the finding), not from `activeRunner`. Use a priority-specific target helper such as `failingHarnessAgent()` (search: `failingHarnessAgent()` in `home.html`) so a concern-only failure does not hijack a harness action.
2. When a dashboard surface displays a grade/score and also generates a prompt below it, both MUST use the same audit scope. If the card shows harness scores, the prompt API must pass `harness: true`.
3. Watch for the runner-vs-target conflation pattern: `activeRunner` is correct for the `launchPreset` executor argument, but wrong for the prompt content's agent target, the command's `--agent` flag, and the `agentFilter` in API calls that feed those prompts.

**Symptoms:** The Home "Fix First" card shows a command like `--agent claude` but the agent with the actual failing harness check is a different agent (e.g. codex at 93%). The Setup page shows harness grades (A 100%, A 93%) on the target cards but the generated setup prompt reflects a different audit scope, so a 93% agent can show "All audit checks pass" and a 100% agent can show "1 audit check failing".

**Evidence:**
- `src/dashboard/views/home.html` (search: `nextActionCommand`) composed the harness fix command with `activeRunner` instead of the agent that actually had the failing check. The same applied to `harnessFixPrompt` (search: `harnessFixPrompt`) which built the fix prompt context for `activeRunner` instead of the failing agent.
- `src/cli/server/dashboard-audit-routes.ts` (search: `/api/setup`) called `runAudit` with `harness: false`, so the setup prompt was generated from install-scope checks only. But the Setup target cards scored agents using `report.agentScores[].harness.checks` (harness scope). The two scopes have different check sets, producing contradictory pass/fail signals on the same page.
- `src/cli/prompt/compose-setup.ts` (search: `renderAuditFail`) collected failing checks from `scopes.setup` and `scopes.agent` only, omitting `scopes.harness` - so even when harness was enabled, harness failures were invisible in the setup prompt output.
- Observed live on 2026-05-03: a real downstream project, Codex at A 93% (Context concern: Artifact Routing), Claude at A 100%. Home Fix First said `--agent claude`. Setup prompt for Codex said "All audit checks pass"; setup prompt for Claude showed a failing check.

**Why it happens:** The dashboard has two distinct agent roles - the **runner** (which CLI executes the prompt, set via the header dropdown as `activeRunner`) and the **target** (which agent's config to inspect or fix). Several code paths conflated the two. Separately, the Setup page card grades and the setup prompt API used different audit scopes (`harness: true` for display vs `harness: false` for generation), so the prompt contradicted the grade shown directly above it.

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
