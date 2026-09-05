---
category: dashboard
last_reviewed: 2026-09-05
---

## Footgun: Tailwind utility class names collide with custom component classes

**Status:** active | **Created:** 2026-04-26 | **Evidence:** ACTUAL_MEASURED

**Prevention:**
1. Never give a custom component class a bare Tailwind utility name (`ring`, `shadow`, `blur`, `inset`, `container`, `table`, `hidden`, `visible`, `fixed`, `absolute`, `relative`, `block`, `flex`, `grid`, `border`, `outline`, `accent`, `columns`). Prefix it, as in `gf-ring` or `ring-chart`.
2. When an element shows a hairline, shadow, or outline its CSS never declares, inspect computed styles for a Tailwind rule on the same class name. The property to override may not be the one you expect.

**Symptoms:** A custom rule looks correct in source, but the rendered element carries a `box-shadow`, `border`, or `outline` it never declares, and `border: none` or `box-shadow: none` does not remove it.

**Why it happens:** Tailwind generates utilities from common property names, so a custom class with the same name inherits those declarations at equal or higher specificity. The collision is invisible in source because the generated CSS lives in a separate output.

**Evidence:** The donut chart used `class="ring"`; Tailwind v4's `.ring` utility added a 1px `box-shadow` hairline that `border: none` could not clear. The class was renamed to `ring-chart` in `src/dashboard/styles.css` (search: `ring-chart`) and in the markup.

---

## Footgun: Dashboard reader decoders can erase score-critical API fields

**Status:** active | **Created:** 2026-05-01 | **Evidence:** ACTUAL_MEASURED

**Prevention:** When a view branches or scores on an API field, confirm the matching `readDashboardReport` helper preserves it. Pair every backend scoring change with a browser-reader regression for discriminants such as `type`, `status`, `concern`, and `id`, and compare the built `dist/` dashboard against `/api/audit` output, because source-only tests miss packaged reader drift.

**Symptoms:** Concern scores, metric notes, or pass/fail labels disagree with `/api/audit`. The payload is right; the decoded browser object has lost the discriminant the view needs.

**Why it happens:** Views score the decoded browser model, not the raw JSON. A reader that drops one field collapses a `metric` check into an ordinary failure without failing anything.

**Evidence:** `src/dashboard/dashboard-readers.ts` (search: `function readAuditCheck`) decodes checks; `src/dashboard/views/home.html` (search: `setupBlocked()`) gates on the result; `src/cli/server/types.ts` (search: `type?: HarnessCheckType`) records the wire contract; `test/unit/dashboard-readers.test.ts` (search: `preserves harness check type so metric failures can be shown as non-gating score evidence`) pins the reader contract.

---

## Footgun: Dashboard aggregate facts and Home agent cards can use different agent sets

**Status:** active | **Created:** 2026-05-13 | **Evidence:** ACTUAL_MEASURED

**Prevention:** Change Home agent visibility in both `resolveDashboardManagedAgentIds` and the `runAuditBatch` fact-extraction path. Assert both `report.agentScores[].id` and `report.scopes.agent` from a fixture whose `.goat-flow/config.yaml` lists one agent while the registry expects all dashboard agents.

**Symptoms:** Home shows or hides agent cards differently from the aggregate Agent Setup scope, so aggregate `agent-instruction` can pass while the summary is meant to expose missing agents.

**Why it happens:** Aggregate scopes and per-agent cards are separate paths. Changing the route-level helper does not change the facts already extracted inside `runAuditBatch`, which needs the same managed agent ids before it derives either.

**Evidence:** `src/cli/server/dashboard-audit-routes.ts` (search: `resolveDashboardManagedAgentIds`) resolves the card ids; `src/cli/audit/audit.ts` (search: `runAuditBatch`) extracts facts once; `src/cli/facts/orchestrator.ts` (search: `managedAgentIds`) receives the shared set; `test/integration/dashboard-audit-api.test.ts` (search: `includes all supported agents even when config lists one`) caught the half-fix where cards moved to all agents while the aggregate scope still passed on one.

---

## Footgun: Dashboard agent-targeting uses activeRunner where it should use the failing or selected agent

**Status:** active | **Created:** 2026-05-03 | **Evidence:** ACTUAL_MEASURED

**Prevention:** `activeRunner` is the executor argument for `launchPreset` and nothing else. Resolve the target of a fix command, prompt body, `--agent` flag, or `agentFilter` from the audit data, for example `failingHarnessAgent()` in `home.html`. Generate a card's prompt from the same audit scope that produced its grade; a harness-scored card needs `harness: true` on the prompt API.

**Symptoms:** The Home "Fix First" card says `--agent claude` while Codex holds the failing harness check, or a Setup card grades an agent at 93% while the prompt below it says "All audit checks pass".

**Why it happens:** Runner and target are different roles, and several paths conflated them. The Setup cards scored from harness scope while `/api/setup` generated prompts with `harness: false`, so two surfaces on one page disagreed.

**Evidence:** `src/dashboard/views/home.html` (search: `nextActionCommand`) and (search: `harnessFixPrompt`) targeted `activeRunner`; `src/cli/server/dashboard-audit-routes.ts` (search: `/api/setup`) ran the audit without harness scope; `src/cli/prompt/compose-setup.ts` (search: `renderAuditFail`) omitted `scopes.harness`. Observed live on 2026-05-03 in a downstream project with Codex at 93% and Claude at 100%.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: Project-browser modal is reachable only via header-span click, not from the add-project flow

**Status:** resolved | **Created:** 2026-04-18 | **Resolved:** 2026-08-18 | **Evidence:** ACTUAL_MEASURED

**Resolution:** The Add Project form now has a Browse button that opens the same picker: `src/dashboard/views/projects.html` (search: `showAddProject = false; openBrowser()`). The header span in `src/dashboard/index.html` (search: `@click="openBrowser()"`) remains as a second trigger.

**Original symptoms:** Users adding a project found only a text input. The picker existed, but its only trigger was the header span labelled "Switch project", and a 2026-04-18 tester had to set `showBrowser = true` in Alpine state to reach it.

**Prevention retained:** When adding a modal behind Alpine `x-show`, add a smoke test or manual-test note proving the intended visible trigger opens it.

---

## Footgun: Alpine.js string `:style` replaces static `style` attribute

**Status:** resolved | **Created:** 2026-04-05 | **Resolved:** 2026-04-18 | **Evidence:** ACTUAL_MEASURED

**Resolution:** Both live violations in `src/dashboard/index.html` were converted to object `:style` syntax. Remaining string `:style` usages in other views sit on elements without a static `style=`, so they do not trigger the trap.

**Original symptoms:** Inline padding, border-radius, and colours vanished at runtime while the source looked correct. A string `:style` replaces the whole `style` attribute; an object `:style` merges with it. The browser-directory button's `:style="dir.isProject ? 'font-weight: 600' : ''"` cleared its static padding and radius whenever the condition was false.

**Prevention retained:** Never pair a static `style="..."` with a string `:style`. Use `:style="{ prop: value }"` or move static styles to a class. When an element looks wrong at runtime but right in source, check the rendered `style` attribute in devtools.
