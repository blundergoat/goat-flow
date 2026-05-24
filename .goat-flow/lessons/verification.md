---
category: verification
last_reviewed: 2026-05-24
---

## Lesson: Validators can require explicit inventories and phrases despite README pointers

**Status:** active | **Created:** 2026-05-24

**What happened:** While implementing M07, I changed `.goat-flow/architecture.md` to point at `.goat-flow/skill-playbooks/README.md` instead of explicitly listing every top-level playbook. The targeted audit then failed with `skill-playbook-inventory-drift`, because `src/cli/audit/check-factual-claims.ts` (search: `driftSkillPlaybookInventory`) checks whether `.goat-flow/architecture.md` and `.goat-flow/code-map.md` include each live top-level `.goat-flow/skill-playbooks/*.md` filename.

**Same-session recurrence:** I then changed the instruction-file Key Resources line to point only at the README index. `bash scripts/preflight-checks.sh` failed the `Instruction parity` gate because `scripts/check-instruction-parity.mjs` (search: `tool-playbook Key Resources`) requires the exact browser-use/page-capture example paths and the phrase `read BEFORE declaring a tool unavailable`.

**Root cause:** I optimized for low-drift prose without reading the live validators that own those text contracts. The README pointer was human-useful but did not satisfy the machine-readable cross-doc checks.

**Prevention:** Before replacing an explicit inventory or required phrase with an index pointer, grep the content-quality, factual-claims, parity, and preflight checks for that surface. If a validator checks direct filename or phrase inclusion, keep the explicit words and add the README pointer around them instead of relying on an indirect reference alone.

---

## Lesson: Header-only edits leave bodies contradicting the new scope

**Status:** active | **Created:** 2026-05-16

**What happened:** Updated six milestone files across `.goat-flow/tasks/1.7.0/` and `.goat-flow/tasks/1.8.0/`: bumped five milestones (M02, M06, M15, M16, M17) and reframed M11 from "observer event trail" to "evidence envelope + dashboard session trace". For each touched milestone I edited the Status/Depends-on header and (for M11) the Objective + Tasks, but left the rest of the body untouched. A subsequent Codex review caught five contradictions I should have caught before claiming done:

- **M09** got a new `**Status:** planned, conditional (doc-only)` header, but the Tasks list still required `assertAutoCaptureAllowed` helper, the Exit Criteria still demanded helper-bound enforcement, and the Manual Testing Gate still asked for helper-rejection scenarios - sending implementers in the opposite direction from the header.
- **M14** still said `Depends on: none` even though it writes/removes files in agent skill mirror directories - clearly M13 (path validation) and M05 (manifest-backed capabilities) territory.
- **M17** Depends-on said "M17 wraps M14" but Scope kept "out of scope: CLI skill-management commands from M14" and Deferred kept "CLI `goat-flow skill list/add/remove` commands from M14" - treating M14 as parallel/future work in the same file that named M14 as a prerequisite.
- **M16** retained a `confidence` field in the insight schema, directly violating ADR-018 / AGENTS.md red-flag #4 (numeric confidence is itself a hedge). Values weren't numeric (`derived|inferred|observed`) but the field name invites the violation. Renamed to `evidenceBasis` with `direct|derived|heuristic`.
- **M11** content was rewritten in full but the filename `M11-local-observer-event-trail.md` retained the abandoned framing - a slow-burn revival hazard for the next reader (the file is now `M11-evidence-envelope-dashboard-session-trace.md`).

**Root cause:** Treated the Status/Depends-on header as if it *were* the scope change. When a milestone's scope shifts - status, dependency, framing, doctrine alignment - the change ripples through Scope Discipline, Tasks, Exit Criteria, Testing Gate, Deferred, sometimes the filename, and any field names that survived from the original spec. A header-only edit leaves the body pointing implementers in the opposite direction from the new header. This is the planning-doc surface variant of "Behavior-scope changes need assertion updates before the first focused run" (below): same pattern, different artifact.

**Prevention:** When applying a scope change to a milestone or planning doc:
1. Re-read the entire file end-to-end *after* the header edit, not just the area you changed.
2. Grep within the file for the old scope's keywords (helper, deferred-as-future, dependency-name) and confirm each hit still makes sense after the change.
3. Check the file's name - does it match the new scope, or is it a slow-burn revival hazard?
4. Check for doctrine violations (`confidence` numeric-hedge field names, `file:line` evidence, etc.) that may have been in the original spec and survived the bump untouched.
5. In the completion summary, list each touched milestone with *what was changed where* (header / scope / tasks / exit criteria), so a reviewer can do their own sweep without re-reading every file from scratch.

Applies whenever the change is: a status flip (`planned → conditional`, `planned → bumped`), a scope reframe (objective rewrite), or a dependency shift (the milestone now requires or is wrapped by another).

---

## Lesson: Browser-verifying local source needs `npm run dev`, not `npx goat-flow dashboard`

**Status:** active | **Created:** 2026-05-09

**What happened:** Verifying the new dashboard skill-quality workbench in a browser, ran `npx goat-flow dashboard .` to launch the dashboard. The Quality view loaded but the Skill Quality artifact list was empty - `skillQualityArtifacts` never populated. The new `loadSkillQualityInventory` method I had just added to `src/dashboard/app.ts` was missing from the served `/assets/app.js`. `curl -s ... /assets/app.js | grep -c loadSkillQualityInventory` returned `0`.

**Root cause:** `npx goat-flow ...` resolves the published `@blundergoat/goat-flow` from `~/.npm/_npx/...`, not the local source tree. The dashboard CLI from the published package bundles the package's own compiled assets - local source edits to `src/dashboard/app.ts` are invisible to it.

**Fix:** Use `npm run dev` (which runs `tsc && npm run build:dashboard && node dist/cli/cli.js dashboard . --dev`) to build and serve the local source. After that, `curl ... /assets/app.js | grep -c loadSkillQualityInventory` returned `2` and the workbench rendered correctly.

**Prevention:** Before browser-verifying a dashboard or CLI source change, confirm the running process is the local build, not the published package. One quick check: `ps aux | grep "node dist/cli/cli.js"` should show the local `dist/` path. If you see `~/.npm/_npx/...`, you are running the published package and your edits are invisible. Evidence anchors: `package.json` (search: `"dev":`), `src/cli/server/dashboard-assets.ts` (search: `loadDashboardAsset`).

---

## Lesson: Behavior-scope changes need assertion updates before the first focused run

**Status:** active | **Created:** 2026-05-04

**What happened:** Changed the dashboard Setup page prompt from harness-card scope to full setup remediation scope, then the first focused `dashboard /api/setup` integration run failed because one regression still expected a `--harness --agent codex` rerun command.

**Recurrence 2026-05-07:** Changed dashboard `/goat-plan` launch context from inline-only to Step 0/File-Write mode semantics. Focused skill and dashboard terminal tests passed, but the first full `npm test` failed because `test/unit/preset-prompts.test.ts` still asserted the old `treat bare task paths as read-only context` phrase. Evidence anchors: `src/dashboard/dashboard-terminal.ts` (search: `goat-plan global mode`), `test/unit/preset-prompts.test.ts` (search: `File-Write modes may create target`).

**Recurrence 2026-05-09:** Changed dashboard terminal launch prompts from runner argv/env delivery to PTY paste delivery. Focused terminal-spawn and dashboard-terminal tests passed, but the first full `npm test` failed because `test/smoke/dashboard-endpoints.test.ts` still expected `GOAT_PROMPT`, `GOAT_PROMPT_FLAG`, and `-i "$GOAT_PROMPT"` in `buildTerminalSpawnSpec` output. Evidence anchors: `src/cli/server/terminal.ts` (search: `initialInput`), `test/smoke/dashboard-endpoints.test.ts` (search: `injects POSIX launch prompts through PTY input`).

**Recurrence 2026-05-24:** Changed the instruction-file tool-playbook router row from a partial filename list to a README-index description. The first focused `node --import tsx --test test/unit/audit-command.test.ts` run failed because `test/unit/audit-command.test.ts` still asserted the old router-label regex `Tool playbooks (CLI/MCP availability checks: browser-use, page-capture, skill-quality-testing)`. Evidence anchors: `workflow/setup/02-instruction-file.md` (search: `README index for CLI/MCP availability checks`), `test/unit/audit-command.test.ts` (search: `keeps setup snippets aligned with the audit remediation contract`).

**Root cause:** Updated the route contract and one setup-prompt test, but missed the adjacent assertion that encoded the previous harness-only remediation behavior.

**Prevention:** When changing an endpoint or launch-context scope semantics, grep focused tests for the old flag/phrase contract before the first run. For setup prompt scope changes, search `test/integration/dashboard-server.test.ts` and `test/unit/audit-command.test.ts` for `harness-card`, `--harness`, and `All audit checks pass`. For dashboard terminal launch-context changes, search `test/unit/preset-prompts.test.ts` and `test/smoke/dashboard-endpoints.test.ts` for the old launch-context phrase, env var, or runner flag.

---

## Lesson: Defensive session rechecks can conflict with TypeScript narrowing

**Status:** active | **Created:** 2026-05-09

**What happened:** While chunking dashboard terminal initial prompt writes, the first `npm run typecheck` failed with `TS2367` because the loop checked `session.status === "terminated"` after an earlier guard had already narrowed the status to active/starting. The runtime intent was a defensive recheck, but the write loop was synchronous and no local status mutation could make that branch true.

**Root cause:** Treated a defensive runtime status check as free inside a narrowed synchronous scope. TypeScript correctly rejected a comparison that could not happen in that scope.

**Fix:** Capture stable session resources after the initial guard (`const pty = session.pty`) and keep the synchronous chunk write loop free of repeated status predicates. Evidence anchors: `src/cli/server/terminal.ts` (search: `const pty = session.pty`), `src/cli/server/terminal.ts` (search: `chunkTerminalInput`).

---

## Lesson: "Double check" means read the files, not re-run the tests

**Status:** active | **Created:** 2026-03-22

**What happened:** User asked to "double check" multiple times. Each time, re-ran typecheck + tests + scan. Never caught stale shape references, documentation inconsistencies, or content quality issues that three external agents found immediately by reading the actual files.
**Root cause:** Interpreted verification as "run the pipeline" instead of "read what changed." Tests only cover what they test.
**Fix:** Added removed-pattern check to preflight. "Double check" should include: (1) run pipeline, (2) grep removed patterns, (3) read 3-5 changed files for content accuracy.

---

## Lesson: New validators must run against the live repo before closeout

**Status:** active | **Created:** 2026-04-29

**What happened:** M06 added decision-file validation and the fixture tests passed, but the first live `node --import tsx src/cli/cli.ts stats . --check` run failed against existing ADR files and one stale lesson reference.

**Root cause:** Treated fixture coverage as enough proof for a repository-wide validator. The new rule was correct, but the live repo contained older records that predated the stricter contract.

**Fix:** After adding any validator that scans a project-wide artifact directory, run it against the live repository before the milestone gate and budget time for the live cleanup it exposes.

---

## Lesson: Agent doesn't tick milestone checkboxes (recurrence x4, unresolved)

**Status:** active | **Created:** 2026-03-31 | **Recurrences:** M1 (2026-03-31), M29 (2026-04-04), M32 (2026-04-05), M08 (2026-04-07)

**What happens:** The agent completes milestone tasks but ticks zero checkboxes. The user discovers it during review. CLAUDE.md VERIFY says "MUST tick `- [x]` on each task as it's completed - not at the end." The instruction exists in three places and is ignored every time.

**Root cause:** When parallelizing work or context-switching to user messages, the "tick as you go" step competes with "do the next thing" and loses. The agent tracks completion mentally but never writes it to the file.

**Why stronger rules haven't worked:** Each recurrence added a stronger prevention rule. M1: "tick immediately." M29: "FIRST action must be editing the milestone file." M32: "before doing anything else." All failed because documentation-level enforcement does not work for this pattern - the forcing function competes with whatever the agent wants to do next, and loses.

**Status:** Unresolved. Needs mechanical enforcement (hook or gate), not more rules.

---

## Lesson: Heading regexes can silently truncate router-table checks

**Status:** historical | **Created:** 2026-04-03 | **Reason:** Rubric check 2.4.3 no longer exists (ADR-013); markdown-parsing principle survives in later parser lessons

**What happened:** Tightened `2.4.3` to parse the Router Table directly, but the first extractor used a multiline regex with `$` in the lookahead. In JavaScript regexes, `$` under `/m` matches end-of-line, so the match stopped after the `## Router Table` heading and never included the rows below it. The new regression also referenced an undefined fixture constant, so the first focused test run broke twice before the real logic was verified.
**Root cause:** Reached for a compact heading regex instead of reusing the repo’s line-based section parsing style, then wrote a regression that depended on a fixture helper that did not exist in that file.
**Fix:** For markdown section extraction, prefer line-based parsers over multiline heading regexes with `$`. For new regressions, build the smallest self-contained fixture possible unless the shared fixture object is already in scope.

---

## Lesson: Path normalization can invalidate later path-shape heuristics

**Status:** historical | **Created:** 2026-04-03 | **Reason:** Rubric check 2.4.3 no longer exists (ADR-013); normalization-invariant principle applies to any parser

**What happened:** After normalizing router references by trimming trailing slashes, the follow-up `2.4.3` filter still looked for the literal substring `/skills/`. That turned `.claude/skills/` into `.claude/skills`, so the canonical passing fixture dropped from `100` to `99` even though the router row was correct.
**Root cause:** Mixed two phases of logic without rechecking the invariant after normalization. The filter assumed the original slash shape still existed after the normalizer had deliberately removed it.
**Fix:** When a parser normalizes paths, downstream checks must use shape tests that still hold after normalization, such as segment-boundary regexes (`/\/skills(?:\/|$)/`) instead of raw substring checks that depend on trailing separators.

---

## Lesson: Parallel sessions need concurrency-safe file patterns

**Status:** active | **Created:** 2026-04-05

**What happened:** Observed during parallel Claude sessions: two agents writing to the same learning-loop file simultaneously. Learning loop files (`.goat-flow/logs/`, `.goat-flow/lessons/`, `.goat-flow/footguns/`) are append-only by convention, but nothing prevents concurrent writes. Session logs use date-slug filenames which reduces collisions, but category bucket files (e.g. `.goat-flow/lessons/verification.md`) are shared write targets.

**Root cause:** goat-flow was designed for single-agent sessions. The category bucket format (multiple entries in one file) creates write contention that per-entry files (one file per lesson) wouldn't have.

**Prevention:**
1. Document which files are safe for concurrent access in the plugin instructions
2. For learning loop writes during parallel sessions, use unique filenames (date-agent-slug) rather than appending to shared buckets
3. Session logs already use unique filenames - extend this pattern to footgun/lesson entries when multi-agent mode is detected

---

## Lesson: Manifest canonical vs stale_names misclassification silently broke skill installs

**Status:** active | **Created:** 2026-04-16

**What happened:** `workflow/manifest.json` listed only `"goat"` in `skills.canonical` and classified the other 6 active skills (goat-debug, goat-plan, goat-review, goat-critique, goat-security, goat-qa) as `stale_names`. `src/cli/constants.ts` `SKILL_NAMES` also said `["goat"]`. The install script (`workflow/install-goat-flow.sh` (search: `for skill in`)) correctly installs all 7, and the repo itself has all 7 in `.claude/skills/`. But the audit read `canonical` to determine expected count, so it reported "1/1 installed" on target projects. The dashboard and setup prompt both showed "1/1 skills installed" - which looked correct but was silently wrong. The target consumer project only had the `goat` dispatcher installed; the other 6 functional skills were missing.

**Root cause:** At some point the manifest was updated to reflect a "mono-skill dispatcher" model where `goat` was the only canonical skill (it dispatches to the others). But the install script, the repo's own skill directories, and user expectations all assumed 7 canonical skills. The contract test `SKILL_NAMES matches manifest.json canonical` existed but passed because both constants.ts AND manifest.json were wrong in the same direction - the test validated consistency between two broken sources, not correctness.

**Fix:** Updated `manifest.json` `skills.canonical` to list all 7. Updated `constants.ts` `SKILL_NAMES` to list all 7. Contract test now passes with the correct count. Ran install script on the consumer project to deploy the missing 6 skills.

**Prevention:** Contract tests that validate two sources agree with each other are necessary but not sufficient - at least one source must be validated against ground truth (e.g., the actual files on disk or the install script's list). A test like "SKILL_NAMES matches the directories in .claude/skills/" would have caught this immediately.

---

## Lesson: Missing RULES.md went undetected because failing tests were dismissed as pre-existing

**Status:** historical | **Created:** 2026-04-16 | **Reason:** RULES.md deleted; "never dismiss test failures as pre-existing" rule survives as an active principle elsewhere in this file

**What happened:** `RULES.md` existed in `.agents/skills/goat/` (codex/gemini) but was missing from `.claude/skills/goat/`. The audit code in `check-agent-setup.ts` explicitly checked for it. The goat dispatcher's `SKILL.md` told the agent to "Read RULES.md in this directory immediately." But:
1. The install script (`install-goat-flow.sh`) only copied `SKILL.md` per skill - never copied `RULES.md`.
2. No template for `RULES.md` existed in `workflow/skills/`.
3. The 2 test failures (`audit on well-configured project`, `audit --harness`) were caused by this + the skill count bug, but were treated as "pre-existing failures" across an entire session of work.

**Root cause:** Two compounding failures. First, the install script was never updated to copy RULES.md when the audit check was added - the check and the installer were authored independently. Second, the resulting test failures were dismissed as background noise instead of investigated. Every test run showed "62 pass / 2 fail" and the response was "same 2 pre-existing failures, not from my change" - a correct but useless observation that prevented anyone from reading the actual failure messages.

**Fix:** Created a rules template for the goat skill. Updated install script to copy it. (RULES.md was later deleted entirely; its 2 unique lines were moved to `skill-preamble.md`.)

**Prevention:**
1. Never dismiss test failures as "pre-existing" without reading what they actually assert. If 2 tests fail, read the 2 failure messages.
2. When adding an audit check that requires a file, also update the install script that creates that file. Audit checks and install scripts must be updated together.
3. A contract test should verify that every file the audit checks for is also produced by the install script - otherwise the audit gates on something the installer never creates.

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

**Prevention:**
1. For duplicated release-note bullets or summary sections, assume the same claim may appear more than once and verify with `rg`, not by eyeballing one section.
2. After any doc-only patch, read the exact changed hunk or `git diff` once before closeout to catch accidental copy-edit regressions.

---

## Lesson: Copilot instruction line caps count trailing newlines

**Status:** active | **Created:** 2026-04-25

**What happened:** A v1.3.0 version-bump pass added one Essential Commands line to `.github/copilot-instructions.md`. `wc -l` reported 120 lines, but `npm test` still failed the Copilot contract because the test counts `readFileSync(...).split(/\r?\n/)`, so a trailing newline makes a 120-line file count as 121 entries.

**Root cause:** I checked the human line count after the failure instead of reading the contract's counting helper first. The repository's enforced ceiling is the test helper, not `wc -l`.

**Prevention:**
1. When touching `.github/copilot-instructions.md`, keep `wc -l` below the configured target or run `node --import tsx --test test/contract/copilot-and-skill-reference-contracts.test.ts` before broader verification.
2. For line-budget failures, read the exact contract helper before deciding how many lines need to be trimmed. Evidence anchor: `test/contract/copilot-and-skill-reference-contracts.test.ts` (search: `.github/copilot-instructions.md must stay at or under 125 lines`).

---

## Lesson: Runtime hook messages must stay paired with agent-config templates

**Status:** active | **Created:** 2026-04-27

**What happened:** Updated `.github/hooks/hooks.json` to improve the PowerShell fallback message, then the first `bash scripts/preflight-checks.sh` run failed `Agent Config Parity` because `workflow/hooks/agent-config/copilot-hooks.json` still contained the old string.

**Root cause:** Treated the installed Copilot hook config as the only file needing the UX copy change. The workflow template is the parity source for installed agent configs, so any installed hook-message change needs the template change in the same patch.

**Prevention:** When changing `.github/hooks/hooks.json`, grep `workflow/hooks/agent-config/` for the same hook payload and update the matching template before the first preflight run. Evidence anchor: `scripts/preflight-checks.sh` (search: `Agent Config Parity`).

---
