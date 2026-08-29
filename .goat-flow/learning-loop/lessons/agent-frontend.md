---
category: agent-frontend
last_reviewed: 2026-08-20
---

**Scope:** Building and visually verifying the dashboard UI - stale dev-mode audit caches, mockup-parity discipline, partial-data UI states, rendered-CSS diagnosis, and toast/loading semantics. Proving browser-visible behaviour with live runs is [browser-evidence.md](browser-evidence.md); testing the built dashboard is [dashboard-testing.md](dashboard-testing.md).

## Lesson: Dashboard audit cache survives code changes because signature doesn't cover compiled JS

**Created:** 2026-05-01

**What happened:** After fixing `buildScope` in `src/cli/audit/audit.ts` to exclude metric failures from harness scope status, rebuilding (`npm run build`), and reloading the dashboard, the dashboard still showed 94% and stale FAIL results. The local audit cache file controlled by `src/cli/server/dashboard-reporting.ts` (search: `AUDIT_CACHE_FILE`) was keyed on config, instruction files, and learning-loop directories - not on the compiled audit code itself. The `Re-audit` button hit the cache and returned the pre-fix result.

**Root cause:** `buildAuditCacheSignature` in `src/cli/server/dashboard-reporting.ts` (search: `buildAuditCacheSignature`) hashes project content files but not the package version or compiled code. In packaged installs, the package version changes on upgrade and invalidates the cache. In dev mode (running from source via `tsx`), the package version stays the same across code changes, so the cache signature doesn't change when audit logic changes.

**Why it matters:** During development, every audit logic change (new checks, scoring fixes, concern removal) produces stale dashboard results until the cache file is manually deleted. The developer sees the old result and concludes the fix didn't work.

**Prevention:** After changing audit logic during development, clear the local dashboard audit cache file identified by `src/cli/server/dashboard-reporting.ts` (search: `AUDIT_CACHE_FILE`) before re-testing via the dashboard. For packaged installs this is a non-issue because the package version bumps between releases.

---

## Lesson: A mockup is the spec, and parity is a layer-by-layer diff

**Created:** 2026-04-05
**Decision changed:** Treat a supplied mockup as a binding spec and diff it across all four layers before calling UI work done, rather than reproducing its general look.
**Incident count:** 3
**Latest occurrence:** 2026-04-26

**What happened:** Three separate rounds, one root cause.

- **2026-04-05, setup view.** A mockup gave exact structure - a `.left` div holding title, agent strip, and detected config; a `.right` div holding the prompt card. The agent reinterpreted it: title above both columns, agent strip full-width, left column as plain text with no card background. Six-plus correction rounds followed - move the title in, move the strip in, add the card background, change width from 340px to 50%, add `align-self: flex-start` so the card stops stretching. Every one was visible in the mockup from the start.
- **2026-04-26, M05b Home, bindings.** The implementation copied the broad section order but dropped the top rollup identity row, so Home opened with "Home readiness" instead of project name plus audit age. It also called a non-existent Alpine helper (`agentLabel(...)`) where the dashboard exposes `agentName(...)`, so the title expression failed silently in the browser and the section looked missing in the user's screenshots.
- **2026-04-26, M05b Home, spacing.** Subtitle `<p>` elements were invented under headings the mockup does not have; section margins were missing (rollup 12px, next-action 20px, section-head `0 0 10px`, agent-grid 22px); padding differed (next-action 16px against the mockup's `18px 22px`); titles used mono where the mockup used sans-serif; the ring rendered 128px against 92px and grade-letter 24px/800 against 18px/600. The first fix round corrected fonts and sizes but missed both the invented elements and the spacing model.

**Root cause:** The mockup was read as layout inspiration rather than a spec. Verification confirmed the page had one root and the API returned data, and compared CSS properties in isolation, instead of diffing the live DOM against the mockup. Adding "helpful" elements the mockup does not contain never got flagged, because nothing was checking for additions.

**Prevention:** For UI work backed by a mockup or screenshots, diff four layers before calling it done. A pass on one layer says nothing about the others - each incident above cleared some layers and failed a different one.

- **Structure:** sections appear in the mockup's order, element-for-element. Every element in the live page absent from the mockup is a removal candidate; do not add text, elements, or wrappers the mockup does not contain.
- **Copy/data:** visible text - project name, audit age, pill labels, CTA labels - matches the mockup's intent.
- **Bindings:** every Alpine helper used in markup is local to `x-data` or exists on `app()`. Grep the helper names, then smoke the rendered view after rebuilding `dist/dashboard`; a missing helper fails silently and reads as a missing section.
- **Spacing and type:** every margin, padding, font-family, and font-size in the mockup CSS is a hard spec, not a suggestion.

Map mockup classes onto existing `gf-*` classes rather than reorganising the DOM around what seems right.

**Evidence:** `src/dashboard/views/home.html` (search: `rollup-heading`) renders the project name row; `src/dashboard/dashboard-app-state-fragments.ts` (search: `agentName(agentId`) is the helper Home bindings actually use.

---

## Lesson: UI state matrices must include partial data states
**Created:** 2026-04-26

**What happened:** The M05b Home view treated every non-passing setup audit as the same "not installed" state. A project with a partial goat-flow install (`1 of 13` setup components present) rendered the fresh-install top section, disabled preview cards, and the "Not installed" label even though the audit response included partial setup evidence and agent scores.

**Root cause:** Verification covered the fully installed and fresh-install branches, but not the intermediate state where setup fails while some checks and agent audit data are present. The view used a broad `setupFailed()` predicate for identity, preview copy, and learning-loop visibility instead of explicit `setupMissing()`, `setupPartial()`, and `setupComplete()` branches.

**Prevention:** For dashboard status UIs, enumerate each meaningful state before testing the rendered screen: missing, partial, complete, stale, and unavailable. Verify that visible labels, project identity, card data source, and CTAs all use the same state model; broad failure helpers are acceptable only for actions that truly apply to every failure mode.

**Evidence:** `src/dashboard/views/home.html` (search: `setupPartial()`) now distinguishes partial setup from missing setup; `src/dashboard/views/home.html` (search: `showPreviewAgents()`) uses real agent audit data when present instead of disabling cards solely because setup failed.

---

## Lesson: CLI agents cannot diagnose rendered CSS - ask for browser inspection

**Created:** 2026-04-26

**What happened:** The dashboard's donut chart had a dark hairline border that the user asked to remove. The agent added `border: none` to the `.ring` CSS rule but the hairline persisted. Multiple rounds of CSS changes failed because the agent was guessing at the cause from source code alone. The actual problem was a Tailwind v4 `.ring` utility injecting `box-shadow` onto the element - a class-name collision invisible in source. The user had to use a browser extension (Claude browser) to inspect the rendered computed styles and identify the `box-shadow` from Tailwind's generated CSS. Only then was the real fix clear: rename the class from `ring` to `ring-chart`.

**Root cause:** The agent cannot render CSS or inspect computed styles. It can only read source files. When a visual bug comes from framework-generated CSS (Tailwind, PostCSS, CSS-in-JS) colliding with custom styles, the source code shows no conflict. The agent kept applying source-level fixes (`border: none`, adding properties) that couldn't work because the wrong property was being targeted and the collision was in generated output.

**Prevention:** When a CSS visual bug persists after a source-level fix that should have worked, stop guessing. Tell the user: "I can't see the rendered styles from here. Can you inspect the element's computed styles in devtools and tell me what properties are applied?" One browser inspection gives more diagnostic value than five rounds of blind CSS edits. For Tailwind projects specifically, check whether custom class names collide with Tailwind utility names before writing the CSS rule.

---

## Lesson: Check repo-provided browser tooling before declaring no browser

**Created:** 2026-04-27

**What happened:** The user asked the agent to view two static site pages (`docs/site/goat-flow-landing.html` and `docs/site/goat-flow-harness-engineering.html`). The agent checked for Playwright, Chromium, Firefox, and text browsers, then claimed there was no headless browser installed. The user pointed at the repo's browser-use skill reference, now canonical at `.goat-flow/skill-docs/playbooks/browser-use.md`, which documents the local `browser-use` CLI. `browser-use` was installed and worked immediately: `browser-use doctor` reported 4/5 checks passed, and the agent opened both local routes, captured rendered state, and saved screenshots.

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
