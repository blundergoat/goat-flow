---
category: integration-verification
last_reviewed: 2026-08-28
---

**Scope:** Proof that separately-correct components still cooperate - manifest against installer, built against source-run server paths, helper ownership across splits, and API contracts beyond the happy path.

## Lesson: Manifest canonical vs stale_names misclassification silently broke skill installs

**Status:** active | **Created:** 2026-04-16

**What happened:** `workflow/manifest.json` and `src/cli/constants.ts` both listed only `"goat"` as canonical even though the installer and repo shipped seven skills. Audit, dashboard, and setup therefore reported "1/1 installed" while six functional skills were missing from a consumer install.

**Root cause:** A contract test proved two sources agreed, but both sources were wrong in the same direction; neither was checked against ground truth on disk or the installer list.

**Prevention:** Give agreement tests a ground-truth leg. For skill counts, validate manifest/constants against actual skill directories or installer inputs, not only against each other. Evidence anchors: `workflow/install-goat-flow.sh` (search: `for skill in`), `workflow/manifest.json` (search: `canonical`), `src/cli/constants.ts` (search: `getSkillNames`).

---

## Lesson: Redundant context files survive architecture changes because nobody measures token cost

**Status:** active | **Created:** 2026-04-16

**What happened:** RULES.md (432 words, 6 sections) loaded on every `/goat` dispatch was almost entirely duplicated from CLAUDE.md and skill-preamble.md. A coding agent critique flagged it: "432 words of token budget consumed for ~30 words of unique signal." The file had existed since the mono-skill dispatcher model. When the architecture split into 7 skills with a shared preamble, the preamble absorbed the same rules but nobody deleted RULES.md. Then an audit check was added requiring it, an install script clause was added to copy it, and a template was created for it - each reinforcing the file's perceived necessity.

**Root cause:** No step in the setup or review process measures whether a shared-context file provides net-new information. Files that are "loaded on every invocation" are never challenged on token cost. Once a file exists and is wired into audit checks, it becomes self-justifying: the audit requires it, so it must be needed.

**Fix:** Deleted RULES.md. Moved 2 unique lines to skill-preamble.md. Removed audit check and install script special-case.

**Prevention:** When reviewing shared-context files (anything loaded on every turn or every skill invocation), compare section-by-section against other loaded files. If >80% duplicates existing loaded content, merge the unique lines and delete the file. When an architecture change adds a new shared surface (like skill-preamble.md), run a cleanup pass over the older surfaces it subsumes.

---

## Lesson: Dashboard API reviews need invalid-path assertions, not just happy-path shape checks

**Status:** active | **Created:** 2026-04-16

**What happened:** The new dashboard HTTP integration suite initially focused on successful responses and basic endpoint reachability. When an explicit negative-path test for `GET /api/audit?path=/does/not/exist` was added, the route returned `200` with an audit-shaped payload instead of a JSON error. The same risk applied to setup, critique, and stack-detection routes because they accepted a `path` string but did not first verify that it existed and was a directory.

**Root cause:** The dashboard server delegated path handling to downstream helpers and implicitly trusted them to reject bad inputs. That made the contract look healthy in happy-path tests while a false-success path remained live. The original tests asserted status enums and endpoint availability, but not that invalid inputs failed loudly.

**Fix:** Added a shared `requireProjectDirectory()` guard in `src/cli/server/dashboard.ts` and used it before audit, setup, critique, and stack-detection work. Expanded `test/integration/dashboard-server.test.ts` to cover invalid audit and browse paths, plus stronger JSON/content-shape assertions across the API.

**Prevention:**
1. For every dashboard route that accepts a filesystem path, add at least one invalid-path test alongside the happy path.
2. Treat `fetch().json()` shape assertions as necessary but insufficient - contract tests also need status-code assertions for malformed or nonexistent inputs.
3. When a route wraps shared project helpers, validate the path at the HTTP boundary instead of assuming downstream code will reject it consistently.

---

## Lesson: New dashboard assets must work in both built and source-run server paths

**Status:** active | **Created:** 2026-04-20

**What happened:** Moving the dashboard preset catalog into `src/dashboard/preset-prompts.json` compiled cleanly and updated the production build copy step, but the first focused verification run failed every dashboard-server integration test. `serveDashboard()` immediately tried to read `dist/dashboard/preset-prompts.json`, and the source-run test harness starts the server from `src/cli/server/dashboard.ts` without guaranteeing that newly added static files already exist under `dist/`.

**Root cause:** I verified the TypeScript surface but missed the dashboard server's dual runtime shape. The server can be exercised from built artifacts and from source-driven test runs. The new JSON asset was only wired for the built path, so verification exposed a runtime assumption that typecheck could not see.

**Fix:** Keep the production copy step in `package.json`, but make the dashboard server prefer `dist/dashboard/preset-prompts.json` and fall back to `src/dashboard/preset-prompts.json` when the built copy is absent. Re-run the focused dashboard + manifest tests after the fallback lands.

**Prevention:**
1. After introducing a new dashboard static asset, verify both the build script path and the source-run server/test path.
2. Treat `npm run typecheck` as schema coverage only; any new file-loading path still needs a runtime test.
3. When the dashboard server reads shipped assets during startup, prefer a controlled fallback instead of assuming `dist/` is always populated in local verification flows.

---

## Lesson: Shared runtime helpers must be re-owned explicitly during server splits

**Status:** active | **Created:** 2026-04-20

**What happened:** Extracting the dashboard terminal concern into `src/cli/server/dashboard-terminal.ts` compiled most of the new code, but the first verification run still failed `npm run typecheck`. `src/cli/server/dashboard.ts` still called the old shared `getWSS()` for dev-mode live reload even though terminal WebSocket ownership had moved into the new module, and the new terminal upgrade helper left one stale `Socket` type annotation even though Node's HTTP upgrade callback supplies a `Duplex`.

**Root cause:** The refactor moved the obvious terminal route bodies first but left one cross-cutting shared helper assumption behind. The old shape had one lazily created WebSocket server serving both live reload and terminal attach flows, so splitting one concern requires explicitly deciding who owns the remaining live-reload server and updating the upgrade-socket types at the same time.

**Fix:** Give live reload its own local `getLiveReloadWSS()` in `dashboard.ts`, keep the terminal module responsible only for terminal upgrades, and align the helper signature with the actual HTTP upgrade socket type (`Duplex`). Re-run `npm run typecheck` before trusting the focused dashboard integration suite.

**Prevention:**
1. When splitting server concerns that previously shared one lazy resource (`getWSS`, caches, singleton managers), make ownership explicit for every remaining caller before declaring the extraction done.
2. For Node HTTP upgrade handlers, verify the callback parameter types against the real server API during the extraction instead of copying a narrower type from a local helper.

---

## Lesson: Repeated doc claims need grep verification after the first patch

**Status:** active | **Created:** 2026-04-21

**What happened:** A small doc-only fix changed one `Sessions rail (cap=7)` claim to `cap=10`, but the first patch missed a second occurrence later in the same release note and briefly introduced a copy-edit typo in `CHANGELOG.md` while applying the correction.
**Root cause:** I treated the first matching line as the whole problem instead of verifying all repeated claims for that concept across the touched docs before closing the edit.
**Fix:** After a doc truthfulness fix, run a focused `rg` for both the old phrase and the corrected concept across every touched doc before claiming the update is complete.

**Recurrence 2026-08-03:** A patch intended for the `Pre-release prompts can resolve an older global CLI` metadata matched the first generic `Incident count` block in `quality.md` and briefly changed an unrelated footgun. Reading the exact diff caught it before validation; the corrected patch included the target heading as context.

**Prevention:**
1. For duplicated release-note bullets or summary sections, assume the same claim may appear more than once and verify with `rg`, not by eyeballing one section.
2. Anchor patches for repeated field names with the owning heading, then read the exact changed hunk or `git diff` once before closeout to catch accidental edits to a sibling entry.

---

## Lesson: Copilot instruction line caps count trailing newlines

**Status:** active | **Created:** 2026-04-25

**Incident count:** 2 | **Latest occurrence:** 2026-08-14

**What happened:** A v1.3.0 version-bump pass added one Essential Commands line to `.github/copilot-instructions.md`. `wc -l` reported 120 lines, but `npm test` still failed the Copilot contract because the test counts `readFileSync(...).split(/\r?\n/)`, so a trailing newline makes a 120-line file count as 121 entries. The same mistake recurred during the v1.16.0 naming-and-placement verification: I refreshed the since-removed gruff warning baseline from a `wc -l` result of 752, while Gruff's emitted metadata counted 753 lines and rejected the baseline.

**Root cause:** I treated `wc -l` as the repository's universal line metric instead of reading the enforcing contract or analyzer output. The consumer of the count owns the enforced value; a terminal newline can make that value differ from `wc -l`.

**Prevention:**
1. When touching `.github/copilot-instructions.md`, keep `wc -l` below the configured target or run the instruction-line-count gate in `bash scripts/preflight-checks.sh` before broader verification.
2. For any line-budget or accepted-debt update, run the owning checker and copy its emitted metric; do not translate a `wc -l` result into contract metadata.
3. Read the exact enforcement path before deciding how many lines need to be trimmed or baselined. Evidence anchors: `scripts/preflight-checks.sh` (search: `line_target`) and `scripts/gruff-warning-ratchet-checks.mjs` (search: `metadata regression`).

---

## Lesson: Runtime hook messages must stay paired with agent-config templates

**Status:** active | **Created:** 2026-04-27

**What happened:** Updated `.github/hooks/hooks.json` to improve the PowerShell fallback message, then the first `bash scripts/preflight-checks.sh` run failed `Agent Config Parity` because `workflow/hooks/agent-config/copilot-hooks.json` still contained the old string.

**Root cause:** Treated the installed Copilot hook config as the only file needing the UX copy change. The workflow template is the parity source for installed agent configs, so any installed hook-message change needs the template change in the same patch.

**Prevention:** When changing `.github/hooks/hooks.json`, grep `workflow/hooks/agent-config/` for the same hook payload and update the matching template before the first preflight run. Evidence anchor: `scripts/preflight-checks.sh` (search: `Agent Config Parity`).

---

## Lesson: Fixture-helper comments must disclose their local state mutation

**Status:** active | **Created:** 2026-08-15

**What happened:** The first comment on `downgradeCodexBaselineToSevenSkills` explained that the helper reproduced a seven-skill upgrade, but omitted that it reads and replaces the disposable consumer's install-state file. The post-edit Gruff hook emitted `docs.missing-side-effect-doc` before the RED suite ran.

**Root cause:** I documented the fixture's scenario instead of the caller-visible filesystem effect. The helper name explained the test setup but not which local state it mutates.

**Fix:** Expanded the original doc block to state that the helper reads and rewrites only the fixture's Codex baseline and why the next installer run needs that loaded state. Its v2 successor, `downgradeManagedStateToSevenCodexSkills`, preserves the contract by naming the contained `managed.json` rewrite and the next preview's invariant.

**Prevention:** For every fixture helper that writes, removes, or replaces local state, name the exact state class and containment boundary in the doc contract. A scenario-oriented name does not replace side-effect documentation. Evidence anchors: `test/integration/setup-install-preview.test.ts` (search: `downgradeManagedStateToSevenCodexSkills`) and `.goat-flow/skill-docs/playbooks/gruff-code-quality.md` (search: `Write comments for caller-visible contract`).
