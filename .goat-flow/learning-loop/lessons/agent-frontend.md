---
category: agent-frontend
last_reviewed: 2026-05-18
---

## Lesson: Dashboard audit cache survives code changes because signature doesn't cover compiled JS

**Created:** 2026-05-01

**What happened:** After fixing `buildScope` in `src/cli/audit/audit.ts` to exclude metric failures from harness scope status, rebuilding (`npm run build`), and reloading the dashboard, the dashboard still showed 94% and stale FAIL results. The local audit cache file controlled by `src/cli/server/dashboard-reporting.ts` (search: `AUDIT_CACHE_FILE`) was keyed on config, instruction files, and learning-loop directories - not on the compiled audit code itself. The `Re-audit` button hit the cache and returned the pre-fix result.

**Root cause:** `buildAuditCacheSignature` in `src/cli/server/dashboard-reporting.ts` (search: `buildAuditCacheSignature`) hashes project content files but not the package version or compiled code. In packaged installs, the package version changes on upgrade and invalidates the cache. In dev mode (running from source via `tsx`), the package version stays the same across code changes, so the cache signature doesn't change when audit logic changes.

**Why it matters:** During development, every audit logic change (new checks, scoring fixes, concern removal) produces stale dashboard results until the cache file is manually deleted. The developer sees the old result and concludes the fix didn't work.

**Prevention:** After changing audit logic during development, clear the local dashboard audit cache file identified by `src/cli/server/dashboard-reporting.ts` (search: `AUDIT_CACHE_FILE`) before re-testing via the dashboard. For packaged installs this is a non-issue because the package version bumps between releases.

---

## Lesson: When a mockup exists, match it element-for-element
**Created:** 2026-04-05

**What happened:** User provided an HTML mockup with exact structure (`.left` div containing title + agent strip + detected config, `.right` div with prompt card) and screenshots. The agent interpreted the layout its own way - putting the title above both columns, the agent strip full-width, and the left column as plain text without a card background. This required 6+ correction rounds to get right: moving the title into the left column, moving the agent strip into the left column, adding the card background, fixing the width from 340px to 50%, adding `align-self: flex-start` so the card doesn't stretch full height. Every one of these was visible in the mockup from the start.

**Why it matters:** Each round of "fix this one thing" costs the user time and patience. The mockup HTML was a working reference with every structural decision already made. The agent's job was to wire up Alpine.js data bindings to the mockup's DOM structure - not to redesign the layout.

**Prevention:** When a mockup HTML file exists, open it and copy the structure directly. Map mockup CSS classes to existing `gf-*` classes or create matching ones. Do not reorganize the DOM structure based on what "seems right." The mockup is the spec - match it element-for-element, then add the dynamic bindings.

---

## Lesson: Mockup parity includes visible copy and live bindings
**Created:** 2026-04-26

**What happened:** In M05b Home redesign, the first implementation copied the broad section order but missed the mockup's top rollup identity row. The shipped Home started with "Home readiness" and subtitle text instead of the project name plus audit age. It also used a non-existent Alpine helper (`agentLabel(...)`) where the dashboard already exposes `agentName(...)`, so the project-title expression silently failed in the browser and the top section looked missing in user screenshots.

**Root cause:** The implementation treated the mockup as layout inspiration instead of a binding-level spec. Verification checked that there was one Home root and that the API returned data, but did not compare the rendered first viewport against the reference screenshots or exercise every dynamic expression used in the top section.

**Prevention:** For UI work backed by screenshots/mockup HTML, verify three layers before calling it done:

- Structure: sections appear in the same order as the mockup.
- Copy/data: key visible text such as project name, audit age, pill labels, and CTA labels matches the mockup intent.
- Bindings: every new Alpine helper used in markup is either local to `x-data` or exists on `app()`; grep for helper names and smoke the rendered browser view after rebuilding `dist/dashboard`.

**Evidence:** `src/dashboard/views/home.html` (search: `rollup-heading`) now renders the project name row; `src/dashboard/dashboard-app-state-fragments.ts` (search: `agentName(agentId`) is the existing helper used by Home bindings.

---

## Lesson: UI state matrices must include partial data states
**Created:** 2026-04-26

**What happened:** The M05b Home view treated every non-passing setup audit as the same "not installed" state. A project with a partial goat-flow install (`1 of 13` setup components present) rendered the fresh-install top section, disabled preview cards, and "Not installed" label even though the audit response included partial setup evidence and agent scores.

**Root cause:** Verification covered the fully installed and fresh-install branches, but not the intermediate state where setup fails while some checks and agent audit data are present. The view used a broad `setupFailed()` predicate for identity, preview copy, and learning-loop visibility instead of explicit `setupMissing()`, `setupPartial()`, and `setupComplete()` branches.

**Prevention:** For dashboard status UIs, enumerate each meaningful state before testing the rendered screen: missing, partial, complete, stale, and unavailable. Verify that visible labels, project identity, card data source, and CTAs all use the same state model; broad failure helpers are acceptable only for actions that truly apply to every failure mode.

**Evidence:** `src/dashboard/views/home.html` (search: `setupPartial()`) now distinguishes partial setup from missing setup; `src/dashboard/views/home.html` (search: `showPreviewAgents()`) uses real agent audit data when present instead of disabling cards solely because setup failed.

---

## Lesson: Mockup parity includes exact structure and visual spacing

**Created:** 2026-04-26

**What happened:** A static HTML mockup defined the exact visual design for the dashboard homepage. The implementation diverged: subtitle `<p>` elements were added under section and panel headings that do not exist in the mockup, section margins (rollup `margin-bottom: 12px`, next-action `margin-bottom: 20px`, section-head `margin: 0 0 10px`, agent-grid `margin-bottom: 22px`) were missing, padding values differed (`next-action` 16px vs mockup's 18px 22px), font families were wrong (section/panel titles used mono instead of sans-serif), and sizing was off (ring 128px vs 92px, grade-letter 24px/800 vs 18px/600). The first fix round only addressed fonts and sizes but missed the structural HTML additions and the spacing model entirely.

**Root cause:** The agent treated the mockup as a loose visual guide rather than a pixel-level spec. It compared individual CSS properties in isolation instead of doing a full structural diff (HTML elements, margin/padding on every section, font-family on every text element). Adding "helpful" subtitles that weren't in the mockup violated the spec without being flagged.

**Prevention:** When a static mockup defines the target, diff the mockup HTML structure against the live HTML element-by-element before touching CSS. Every element in the live page that doesn't exist in the mockup is a removal candidate. Every margin, padding, font-family, and font-size value in the mockup CSS is a hard spec, not a suggestion. Do not add content (text, elements, wrappers) that the mockup does not contain.

---

## Lesson: CLI agents cannot diagnose rendered CSS - ask for browser inspection

**Created:** 2026-04-26

**What happened:** The dashboard's donut chart had a dark hairline border that the user asked to remove. The agent added `border: none` to the `.ring` CSS rule but the hairline persisted. Multiple rounds of CSS changes failed because the agent was guessing at the cause from source code alone. The actual problem was a Tailwind v4 `.ring` utility injecting `box-shadow` onto the element - a class-name collision invisible in source. The user had to use a browser extension (Claude browser) to inspect the rendered computed styles and identify the `box-shadow` from Tailwind's generated CSS. Only then was the real fix clear: rename the class from `ring` to `ring-chart`.

**Root cause:** The agent cannot render CSS or inspect computed styles. It can only read source files. When a visual bug comes from framework-generated CSS (Tailwind, PostCSS, CSS-in-JS) colliding with custom styles, the source code shows no conflict. The agent kept applying source-level fixes (`border: none`, adding properties) that couldn't work because the wrong property was being targeted and the collision was in generated output.

**Prevention:** When a CSS visual bug persists after a source-level fix that should have worked, stop guessing. Tell the user: "I can't see the rendered styles from here. Can you inspect the element's computed styles in devtools and tell me what properties are applied?" One browser inspection gives more diagnostic value than five rounds of blind CSS edits. For Tailwind projects specifically, check whether custom class names collide with Tailwind utility names before writing the CSS rule.

---

## Lesson: Check repo-provided browser tooling before declaring no browser

**Created:** 2026-04-27

**What happened:** User asked the agent to view two static site pages (`docs/site/goat-flow-landing.html` and `docs/site/goat-flow-harness-engineering.html`). The agent checked for Playwright, Chromium, Firefox, and text browsers, then claimed there was no headless browser installed. The user pointed at the repo's browser-use skill reference, now canonical at `.goat-flow/skill-docs/playbooks/browser-use.md`, which documents the local `browser-use` CLI. `browser-use` was installed and worked immediately: `browser-use doctor` reported 4/5 checks passed, and the agent was able to open both local routes, capture rendered state, and save screenshots.

**Root cause:** The agent treated "view this HTML" as a generic static-file inspection task instead of a UI/browser-evidence task. It searched for familiar tools from habit and failed to check repository-provided skill references before making a broad tooling claim.

**Why this matters:** Saying "there is no browser" when a project-specific browser tool exists creates false constraints and wastes the user's time. It also undermines the purpose of local skill references: they are there to encode exactly this kind of workflow knowledge.

**Evidence:**
- `.goat-flow/skill-docs/playbooks/browser-use.md` (search: `command -v browser-use || command -v browser-use-python`) documents the availability check.
- `.goat-flow/skill-docs/playbooks/browser-use.md` (search: `browser-use screenshot [path.png]`) documents rendered evidence capture.

**Prevention:** When a task asks to view, inspect, screenshot, debug, or verify a local UI, check local browser references before falling back to generic tooling assumptions. Run `command -v browser-use || command -v browser-use-python` before saying browser automation is unavailable. If `browser-use` is missing, follow the reference's ask-before-install fallback instead of declaring the task impossible.

**2026-05-03 reinforcement:** A downstream incident showed the broader failure mode: agents that skip `.goat-flow/skill-docs/playbooks/` and go straight to harness ToolSearch can declare project-local CLI tools unavailable when they are not. The structural fix is to route every instruction file to `.goat-flow/skill-docs/playbooks/` and make audit fail when that pointer disappears.

---

## Lesson: Do not use error-colored toasts for expected loading states

**Created:** 2026-04-29

**What happened:** While making the Workspace terminal launch feel more responsive, the first UX pass added a toast saying `Launching Terminal...` even though launch was a normal expected action and the button itself already changed to `Launching terminal...`. Because dashboard toasts use the same channel for failures, that extra message read like an alert rather than helpful progress feedback.

**Root cause:** The implementation reached for an existing feedback mechanism without checking whether the state was exceptional or already visible in the primary control. A toast is appropriate when the user needs asynchronous feedback they might otherwise miss; it is poor UX when the user just clicked the exact button whose label already reflects the loading state.

**Prevention:** For expected in-place loading, prefer inline state on the initiating control first: disable the button, change its label, or show a local spinner. Reserve toast messages, especially error-colored or alert-styled ones, for outcomes that are exceptional, backgrounded, or detached from the control the user is watching. Evidence anchors: `src/dashboard/views/workspace.html` (search: `Launching terminal...`), `src/dashboard/dashboard-terminal-runtime.ts` (search: `dashboardLaunchInTerminal`).

---
