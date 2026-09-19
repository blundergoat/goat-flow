---
category: agent-frontend
last_reviewed: 2026-09-05
---

**Scope:** Building and visually verifying the dashboard UI - stale dev-mode audit caches, mockup-parity discipline, partial-data UI states, rendered-CSS diagnosis, and toast and loading semantics. Proving browser-visible behaviour with live runs is [browser-evidence.md](browser-evidence.md); testing the built dashboard is [dashboard-testing.md](dashboard-testing.md).

## Lesson: Dashboard audit cache survives code changes because signature doesn't cover compiled JS

**Status:** active | **Created:** 2026-05-01

**Prevention:** After changing audit logic in a source-run dashboard, delete the local audit cache file before re-testing through the UI, or request the route's fresh path. Packaged installs are unaffected because the package version changes between releases. Evidence anchors: `src/cli/server/dashboard-reporting.ts` (search: `AUDIT_CACHE_FILE`), `src/cli/server/dashboard-reporting.ts` (search: `buildAuditCacheSignature`).

**What happened:** After fixing `buildScope` in `src/cli/audit/audit.ts` to exclude metric failures from harness scope status, rebuilding, and reloading the dashboard, the UI still showed 94 percent and stale FAIL results, because the `Re-audit` button hit the cache and returned the pre-fix report.

**Root cause:** The cache signature covers project content files plus the running package version and config version, and never the compiled audit code. An upgrade therefore invalidates every cache, but a dev-mode run from source keeps the same package version across source edits, so changing audit logic changes nothing the signature can see.

**Why it matters:** In development every audit logic change produces stale dashboard results until the cache file is deleted, so the developer sees the old result and concludes the fix did not work.

---

## Lesson: A mockup is the spec, and parity is a layer-by-layer diff

**Status:** active | **Created:** 2026-04-05
**Decision changed:** Treat a supplied mockup as a binding spec and diff it across all four layers before calling UI work done, rather than reproducing its general look.
**Incident count:** 3 | **Latest occurrence:** 2026-04-26

**Prevention:** For UI work backed by a mockup or screenshots, diff four layers before calling it done; a pass on one layer says nothing about the others, and each incident below cleared some layers and failed a different one. Map mockup classes onto existing `gf-*` classes rather than reorganising the DOM around what seems right.

- **Structure:** sections appear in the mockup's order, element for element. Every live element absent from the mockup is a removal candidate, and no text, element, or wrapper the mockup lacks may be added.
- **Copy and data:** visible text, including project name, audit age, pill labels, and CTA labels, matches the mockup's intent.
- **Bindings:** every Alpine helper used in markup is local to `x-data` or exists on `app()`. Grep the helper names, then smoke the rendered view after rebuilding `dist/dashboard`; a missing helper fails silently and reads as a missing section.
- **Spacing and type:** every margin, padding, font family, and font size in the mockup CSS is a hard spec.

**What happened:** Three rounds shared one root cause. In the 2026-04-05 setup view, a mockup specified a `.left` div holding title, agent strip, and detected config beside a `.right` div holding the prompt card; the implementation put the title above both columns, made the strip full-width, and left the column as plain text with no card background, costing six correction rounds that were all visible in the mockup from the start. On 2026-04-26 the M05b Home work dropped the top rollup identity row and called a non-existent helper `agentLabel(...)` where the dashboard exposes `agentName(...)`, so the title expression failed silently and the section looked missing in screenshots. The same day, invented subtitle paragraphs appeared under headings the mockup lacks, section margins and padding differed from the spec, titles used mono where the mockup used sans-serif, and the ring rendered 128px against 92px; the first fix round corrected fonts and sizes but missed both the invented elements and the spacing model.

**Root cause:** The mockup was read as layout inspiration rather than a spec. Verification confirmed the page had one root and the API returned data, and compared CSS properties in isolation, instead of diffing the live DOM against the mockup, so added elements were never flagged.

**Evidence:** `src/dashboard/views/home.html` (search: `rollup-heading`) renders the project name row; `src/dashboard/dashboard-app-state-fragments.ts` (search: `agentName(agentId`) is the helper Home bindings use.

---

## Lesson: UI state matrices must include partial data states

**Status:** active | **Created:** 2026-04-26

**Prevention:** For dashboard status UIs, enumerate each meaningful state before testing the rendered screen: missing, partial, complete, stale, and unavailable. Verify that visible labels, project identity, card data source, and CTAs use the same state model; a broad failure helper is acceptable only for actions that truly apply to every failure mode. Evidence anchors: `src/dashboard/views/home.html` (search: `setupPartial()`), `src/dashboard/views/home.html` (search: `showPreviewAgents()`).

**What happened:** The M05b Home view treated every non-passing setup audit as the same "not installed" state, so a project with `1 of 13` setup components present rendered the fresh-install top section, disabled preview cards, and the "Not installed" label although the audit response carried partial setup evidence and agent scores.

**Root cause:** Verification covered the fully installed and fresh-install branches but not the intermediate state, and the view used one broad `setupFailed()` predicate for identity, preview copy, and learning-loop visibility instead of explicit missing, partial, and complete branches.

---

## Lesson: Check browser tooling before blaming source when rendered CSS disagrees

**Status:** active | **Created:** 2026-04-26
**Decision changed:** When a visual bug survives a source-level fix that should have worked, capture the rendered computed styles before editing again; ask a person only when no browser tool is available.
**Trigger phase:** READ
**Incident count:** 2 | **Latest occurrence:** 2026-04-27
**Merged:** 2026-09-05 - renamed from "CLI agents cannot diagnose rendered CSS - ask for browser inspection", whose Prevention predated the local browser tooling and contradicted the READ routing rule; absorbed "Check repo-provided browser tooling before declaring no browser" (2026-04-27).

**Prevention:** Run the availability check in `.goat-flow/skill-docs/playbooks/browser-use.md` (search: `command -v browser-use || command -v browser-use-python`) before claiming any browser task is impossible or asking a person to inspect for you; a project-local CLI at `~/.local/bin/` is a real tool, and no harness tool does not mean no tool. With the browser available, capture the element's computed styles and rendered state (search: `browser-use screenshot [path.png]`) rather than making another blind source edit. Only when the check fails, and after following the playbook's ask-before-install fallback, ask the user for devtools output: one inspection is worth more than five speculative CSS edits. For Tailwind projects, check whether a custom class name collides with a utility name before writing the rule.

**What happened:** The dashboard donut chart kept a dark hairline after `border: none` was added to the `.ring` rule, and several further CSS rounds failed because the cause was invisible in source: a Tailwind v4 `.ring` utility injected `box-shadow` onto the element. A browser inspection of the computed styles identified it, and renaming the class to `ring-chart` fixed it.

**Root cause:** Source files cannot show framework-generated CSS colliding with custom styles, so every source-level fix targeted the wrong property while the collision lived in generated output.

**Recurrence 2026-04-27:** Asked to view `docs/site/goat-flow-landing.html` and `docs/site/goat-flow-harness-engineering.html`, the agent checked for Playwright, Chromium, Firefox, and text browsers, then claimed no headless browser was installed. The user pointed at the repo's browser-use playbook: `browser-use doctor` reported 4 of 5 checks passing, and both local routes opened with rendered state and screenshots captured. Saying "there is no browser" when a project-local tool exists creates a false constraint and defeats the purpose of the playbooks. A 2026-05-03 downstream incident generalised it: agents that skip the playbook directory and go straight to harness tool search declare project-local CLI tools unavailable, so every instruction file routes to `.goat-flow/skill-docs/playbooks/` and audit fails when that pointer disappears.

---

## Lesson: Do not use error-colored toasts for expected loading states

**Status:** active | **Created:** 2026-04-29

**Prevention:** For expected in-place loading, put the state on the initiating control first: disable the button, change its label, or show a local spinner. Reserve toasts, especially error-coloured ones, for outcomes that are exceptional, backgrounded, or detached from the control the user is watching. Evidence anchors: `src/dashboard/views/workspace.html` (search: `Launching terminal...`), `src/dashboard/dashboard-terminal-runtime.ts` (search: `dashboardLaunchInTerminal`).

**What happened:** Making the Workspace terminal launch feel more responsive, the first UX pass added a toast saying `Launching Terminal...` although launch is a normal action and the button already read `Launching terminal...`. Because dashboard toasts share one channel with failures, the extra message read as an alert.

**Root cause:** An existing feedback mechanism was reused without checking whether the state was exceptional or already visible in the primary control.
