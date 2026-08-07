---
category: integration-verification
last_reviewed: 2026-08-07
---

## Lesson: Manifest canonical vs stale_names misclassification silently broke skill installs

**Status:** active | **Created:** 2026-04-16

**What happened:** `workflow/manifest.json` and `src/cli/constants.ts` both listed only `"goat"` as canonical even though the installer and repo shipped seven skills. Audit, dashboard, and setup therefore reported "1/1 installed" while six functional skills were missing from a consumer install.

**Root cause:** A contract test proved two sources agreed, but both sources were wrong in the same direction; neither was checked against ground truth on disk or the installer list.

**Prevention:** Agreement tests need a ground-truth leg. For skill counts, validate manifest/constants against actual skill directories or installer inputs, not only against each other. Evidence anchors: `workflow/install-goat-flow.sh` (search: `for skill in`), `workflow/manifest.json` (search: `canonical`), `src/cli/constants.ts` (search: `getSkillNames`).

---

## Lesson: Redundant context files survive architecture changes because nobody measures token cost

**Status:** active | **Created:** 2026-04-16

**What happened:** RULES.md (432 words, 6 sections) loaded on every `/goat` dispatch was almost entirely duplicated from CLAUDE.md and skill-preamble.md. A coding agent critique flagged it: "432 words of token budget consumed for ~30 words of unique signal." The file had existed since the mono-skill dispatcher model. When the architecture split into 7 skills with a shared preamble, the preamble absorbed the same rules but nobody deleted RULES.md. Then an audit check was added requiring it, an install script clause was added to copy it, and a template was created for it - each reinforcing the file's perceived necessity.

**Root cause:** No step in the setup or review process measures whether a shared-context file provides net-new information. Files that are "loaded on every invocation" are never challenged on token cost. Once a file exists and is wired into audit checks, it becomes self-justifying: the audit requires it, so it must be needed.

**Fix:** Deleted RULES.md. Moved 2 unique lines to skill-preamble.md. Removed audit check and install script special-case.

**Prevention:** When reviewing shared-context files (anything loaded on every turn or every skill invocation), compare section-by-section against other loaded files. If >80% duplicates existing loaded content, merge the unique lines and delete the file. Architecture changes that add new shared surfaces (like skill-preamble.md) should include a cleanup pass of older surfaces they subsume.

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

**Root cause:** Verified the TypeScript surface but missed the dashboard server's dual runtime shape. The server can be exercised from built artifacts and from source-driven test runs. The new JSON asset was only wired for the built path, so verification exposed a runtime assumption that typecheck could not see.

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
**Root cause:** Treated the first matching line as the whole problem instead of verifying all repeated claims for that concept across the touched docs before closing the edit.
**Fix:** After a doc truthfulness fix, run a focused `rg` for both the old phrase and the corrected concept across every touched doc before claiming the update is complete.

**Recurrence 2026-08-03:** A patch intended for the `Pre-release prompts can resolve an older global CLI` metadata matched the first generic `Incident count` block in `quality.md` and briefly changed an unrelated footgun. Reading the exact diff caught it before validation; the corrected patch included the target heading as context.

**Prevention:**
1. For duplicated release-note bullets or summary sections, assume the same claim may appear more than once and verify with `rg`, not by eyeballing one section.
2. Anchor patches for repeated field names with the owning heading, then read the exact changed hunk or `git diff` once before closeout to catch accidental edits to a sibling entry.

---

## Lesson: Copilot instruction line caps count trailing newlines

**Status:** active | **Created:** 2026-04-25

**What happened:** A v1.3.0 version-bump pass added one Essential Commands line to `.github/copilot-instructions.md`. `wc -l` reported 120 lines, but `npm test` still failed the Copilot contract because the test counts `readFileSync(...).split(/\r?\n/)`, so a trailing newline makes a 120-line file count as 121 entries.

**Root cause:** I checked the human line count after the failure instead of reading the contract's counting helper first. The repository's enforced ceiling is the test helper, not `wc -l`.

**Prevention:**
1. When touching `.github/copilot-instructions.md`, keep `wc -l` below the configured target or run the instruction-line-count gate in `bash scripts/preflight-checks.sh` before broader verification.
2. For line-budget failures, read the exact line-count implementation before deciding how many lines need to be trimmed. Evidence anchor: `scripts/preflight-checks.sh` (search: `line_target`).

---

## Lesson: Runtime hook messages must stay paired with agent-config templates

**Status:** active | **Created:** 2026-04-27

**What happened:** Updated `.github/hooks/hooks.json` to improve the PowerShell fallback message, then the first `bash scripts/preflight-checks.sh` run failed `Agent Config Parity` because `workflow/hooks/agent-config/copilot-hooks.json` still contained the old string.

**Root cause:** Treated the installed Copilot hook config as the only file needing the UX copy change. The workflow template is the parity source for installed agent configs, so any installed hook-message change needs the template change in the same patch.

**Prevention:** When changing `.github/hooks/hooks.json`, grep `workflow/hooks/agent-config/` for the same hook payload and update the matching template before the first preflight run. Evidence anchor: `scripts/preflight-checks.sh` (search: `Agent Config Parity`).

---

## Lesson: Quality diff compares saved report IDs, not report file paths

**Status:** active | **Created:** 2026-07-12

**What happened:** During final quality-report verification, I passed two JSON file paths to `quality diff`. The CLI exited 2 because an explicit comparison is one colon-delimited `<from-id>:<to-id>` argument; selecting the latest same-agent reports with `--agent codex --mode agent-setup` then completed successfully.

**Root cause:** I inferred a conventional two-path diff interface instead of reading the command contract before the auxiliary close-out check.

**Prevention:** Run `goat-flow quality diff --agent <id> --mode <mode>` for the latest matching pair, or pass one `<from-id>:<to-id>` argument as documented in `docs/cli.md` (search: `quality diff [<from-id>:<to-id>]`). Do not pass report filesystem paths.

---

## Lesson: New subcommands need parser headroom before the first GREEN refactor

**Status:** active | **Created:** 2026-07-13

**What happened:** The first M02 `skill doctor` implementation passed its behavioral suite (`20 passed`, `0 failed`) but failed the whole-file quality gate. `parseSkillPositionals` and `validateSkillFlags` exceeded ESLint complexity limits, the first doctor collector had two more complexity failures, and adding one branch pushed `cli-parser.ts` and `cli-handlers.ts` above the 750-line gruff threshold. The final preflight later caught an unnecessary `renderSkillDoctorMarkdown` export and a bare backticked filename in `docs/cli.md` (search: `Canonical workflow source`) that focused tests, ESLint, typecheck, Prettier, and targeted gruff did not cover.

**Root cause:** I treated a behavioral GREEN as permission to finish the command inside two already-large shared modules. The tests proved output behavior, but they did not measure whether the new subcommand left the parser and dispatch surfaces easy to verify. Importing doctor helpers back into the parser would also have violated the existing lazy-import pattern by loading audit and manifest dependencies for unrelated commands.

**Fix:** Extract lightweight positional/flag rules into `src/cli/skill-command-parser.ts` (search: `parseSkillPositionals`), keep doctor runtime imports behind `src/cli/cli-handlers.ts` (search: `handleSkillCommand`), and split collection decisions inside `src/cli/skill-doctor.ts` (search: `inspectFrontmatterFields`). Whole-file ESLint, typecheck, and targeted gruff then passed without suppressions or threshold changes.

**Recurrence update (2026-07-18):** M02 informational-flag behavior reached 61/61 focused tests and typecheck exited 0 before whole-file ESLint rejected `parseCLIArgs` at complexity 12. Moving the branch into a helper fixed complexity, but targeted gruff then exposed growth beyond the already-marginal file-length threshold. Rewinding duplicate namespace parsing brought `src/cli/cli-parser.ts` (search: `selectCommandPositionals`) to zero targeted gruff findings without a suppression or new module.

**Recurrence update (2026-07-29):** `plans check` plus a comment pass pushed `cli-handlers.ts` to 751 then `plans-export.ts` to 753 - moving code re-trips the length gate in the destination. Extracting the whole effort-notation concern into `src/cli/plans-effort.ts` (search: `Effort-estimate notation parser`) with a nearby test cleared both; single-function shuffles only relocate the overflow.

**Recurrence update (2026-08-07):** Tightening Timing Receipt stamp validation passed 116 focused tests and typecheck before whole-file ESLint rejected `parseStamp` at complexity 11. The first helper extraction then made preflight report five new file-length warnings. Deriving canonical UTC from the epoch inside `parseStamp`, folding regressions into existing test cases, and restoring the accepted `plans-time.ts` size cleared targeted Gruff without weakening the invalid-calendar or rendered-heading checks.

**Decision changed:** Measure whole-file ESLint and gruff immediately after the first parser GREEN, and pay for new branches by removing duplicate parsing rather than adding a late helper alone. | **Trigger phase:** VERIFY | **Incident count:** 4 | **Latest occurrence:** 2026-08-07

**Prevention:**
1. Before extending a shared parser or dispatcher, measure its line and complexity headroom; near-threshold files need an extraction in the initial GREEN design.
2. Keep parser modules dependency-light. A diagnostic subcommand may lazy-load audit/manifest code after dispatch, but argv parsing must not import that runtime.
3. Before the human gate, run Knip and path-integrity through full preflight; focused TypeScript and analyzer checks do not prove the command's public exports or documentation references are clean.
4. After behavioral GREEN, run whole-file ESLint, typecheck, and gruff before documentation or task completion; the verification unit is the changed file set, not only the new test cases.

---

## Lesson: Required CLI choices need omission tests

**Status:** active | **Created:** 2026-07-13
**Decision changed:** Test valid, invalid, and omitted forms for every required CLI choice; omission must not silently select a default. | **Trigger phase:** VERIFY
**Incident count:** 3 | **Latest occurrence:** 2026-08-01

**What happened:** M17's plan and handler required `--scenario deny-hook`, but the parser returned that value when the flag was absent. Positive, invalid-value, and live explicit-command checks all passed, so only a final omission probe exposed the false choice.

A second incident added a required quality-report owner whenever staged draft capture is enabled. The first retry implementation forwarded an absent owner as explicit `null`, and the existing retry contract caught the changed payload shape during VERIFY.

A third incident added a Claude/reporting-only relationship ahead of the owner relationship. The first missing-owner fixture omitted `accessMode`, so it exercised the new mode guard instead of the intended owner guard.

**Root cause:** I treated omitted/defaulted fields as harmless while testing one relationship, even though an earlier relationship could legitimately reject the same payload first.

**Fix and prevention:** Add omission RED tests before implementation. Required values must fail when absent; optional transport metadata must be omitted rather than converted to a new sentinel value. In each relationship test, make every preceding prerequisite explicit and valid so the assertion proves the intended error path. Cover capture enabled with and without an owner, owner present with and without capture for each supported runner and mode, wrong-runner/mode, and retry payload presence/absence. Evidence anchors: `src/cli/cli-parser.ts` (search: `parseHookScenarioArg`), `src/cli/server/decoders.ts` (search: `is supported only for Claude reporting sessions`), `src/dashboard/dashboard-terminal-connect.ts` (search: `qualityReportProjectPath ?`), and `test/unit/dashboard-terminal-launch/launch-flow-03.test.ts` (search: `carries staged-draft capture through a retried launch`).

---

## Lesson: Milestone plans need exporter-contract verification before handoff

**Status:** active | **Created:** 2026-07-17
**Decision changed:** After writing or restructuring `M*.md` files, validate them with the shipped plan exporter before handoff; visual Markdown completeness is insufficient. | **Trigger phase:** VERIFY
**Incident count:** 4 | **Latest occurrence:** 2026-08-05

**What happened:** The 1.15.0 milestone files looked structurally complete and passed a custom heading/count check, but the first `plans export` preview warned that all 11 records lacked portable objectives and boundary notes. At that revision, the exporter accepted only the bold `Objective` field, while the files used a level-two `Objective` section. They also omitted `Boundary Notes` and initially placed CAO incident gates in peer sections the exporter would not include in task bodies.

**Recurrence (2026-07-31):** Goat-plan's compact reference introduced an inline Scope plus canonical `## Exit` containing `Stop/rescope if`, while the parser still accepted only a Scope section, legacy `## Exit criteria`, and a separate stop heading. The first full preflight also caught three parser complexity errors missed by the focused M02 suite. The correction added an end-to-end strict Small fixture, exporter coverage for compact Exit/stop, and split parser branches before rerunning repository gates.

**Dashboard recurrence (2026-07-31):** The first M03 dashboard GREEN reused the filename fallback as an objective when malformed Markdown had no outcome heading. Manual diff review caught the false objective before handoff. The correction keeps filename fallback for the row title, passes only a parsed outcome heading into objective fallback, and asserts that malformed objectives remain blank.

**Recurrence (2026-08-03):** A new milestone followed the field guide's prose form `Plan/admin overhead: n min other`, but the parser required the bold field `**Plan/admin overhead:**`. Strict validation rejected the unparseable estimate before implementation; correcting the field cleared the error. Evidence anchor: `src/cli/plans-export.ts` (search: `readMilestoneField(content, "Plan/admin overhead"`).

**Recurrence (2026-08-05):** The 1.16.0 strict checker and Markdown exporter both exited zero, but supplementary contract checks found 13 cited paths or search strings that did not resolve and one nine-word ISSUE delivery item below the documented minimum. Several references named the right concept in the wrong learning file; others preserved stale filenames or approximate headings. Correcting the citations and rerunning both validators prevented an implementation handoff built on nonexistent evidence or malformed issue copy.

**Root cause:** I validated the authoring layout I had produced instead of the repository's consumer contract. A Markdown reader could infer the intended fields, while `parseMilestoneMarkdown` intentionally recognizes a narrower portable schema.

**Fix and prevention:** Treat the canonical example as an executable consumer fixture, not prose. Cover compact and expanded representations through `parseMilestoneMarkdown`, run `goat-flow plans check <plan-path> --strict`, require exporter records to have zero warnings, and resolve every cited path plus exact semantic search string before handoff. Parser changes also run scoped ESLint before full preflight. Current objective parsing accepts a bold field, an `## Objective` section, or the outcome title. Other portable anchors are Status, compact or section Scope, Tasks, Proof, Exit/Exit criteria, and Stop/rescope. Evidence anchors: `src/cli/plans-export.ts` (search: `readFieldOrSectionMarkdown`), `src/cli/plans-export.ts` (search: `readStopMarkdown`), and `test/unit/plans-check.test.ts` (search: `accepts the compact Small rendering in strict mode`).
