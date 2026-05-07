---
category: verification
last_reviewed: 2026-05-07
---

## Lesson: Behavior-scope changes need assertion updates before the first focused run

**Status:** active | **Created:** 2026-05-04

**What happened:** Changed the dashboard Setup page prompt from harness-card scope to full setup remediation scope, then the first focused `dashboard /api/setup` integration run failed because one regression still expected a `--harness --agent codex` rerun command.

**Recurrence 2026-05-07:** Changed dashboard `/goat-plan` launch context from inline-only to Step 0/File-Write mode semantics. Focused skill and dashboard terminal tests passed, but the first full `npm test` failed because `test/unit/preset-prompts.test.ts` still asserted the old `treat bare task paths as read-only context` phrase. Evidence anchors: `src/dashboard/dashboard-terminal.ts` (search: `goat-plan global mode`), `test/unit/preset-prompts.test.ts` (search: `File-Write modes may create target`).

**Root cause:** Updated the route contract and one setup-prompt test, but missed the adjacent assertion that encoded the previous harness-only remediation behavior.

**Prevention:** When changing an endpoint or launch-context scope semantics, grep focused tests for the old flag/phrase contract before the first run. For setup prompt scope changes, search `test/integration/dashboard-server.test.ts` and `test/unit/audit-command.test.ts` for `harness-card`, `--harness`, and `All audit checks pass`. For dashboard terminal launch-context changes, search `test/unit/preset-prompts.test.ts` for the old launch-context phrase.

---

## Lesson: Do not cite gitignored task files from durable artifacts

**Status:** active | **Created:** 2026-05-07

**What happened:** While cleaning review findings for the `/goat-plan` dashboard preset change, I changed an ADR future-work pointer from one local task-file reference to another instead of removing the pointer. The user corrected it: learning-loop entries and decisions must not depend on gitignored task/log/scratchpad files as durable evidence.

**Root cause:** Treated local planning state as if it were a stable cross-reference. Task workspace files are useful coordination artifacts during a session, but they are not durable repo truth for ADRs, lessons, footguns, or patterns.

**Prevention:** Before adding or editing learning-loop or decision artifacts, reject references to gitignored workspace files unless the artifact is documenting that workspace policy itself. Cite committed source files, committed docs, issue/PR URLs, or semantic anchors in durable artifacts instead. Evidence anchors: `.goat-flow/decisions/README.md` (search: `Implementation TODO, checklist, milestone, or scoped plan`), `.goat-flow/decisions/ADR-014-optional-project-calibration-config.md` (search: `Personal preferences stay out`).

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
## Lesson: Framework paths vs project paths in verbatim-installed skills

**Status:** active | **Created:** 2026-04-11
**What happened:** M17a extracted skill modes into the repository template directory and left repository-local template references in the skill files. Skills are installed verbatim, so every project received instructions that pointed back into the goat-flow repo instead of the installed project. A subsequent multi-agent critique pass flagged the bug as the dominant cause of a system-wide quality regression.
**Evidence:** The critique flagged broken template references in 6 of 7 reviewed consumer projects. `workflow/skills/goat/SKILL.md`, `workflow/skills/goat-security/SKILL.md`, `workflow/skills/goat-qa/SKILL.md` all used repository-local template paths instead of installed-project template paths.
**Prevention:** After editing any skill file that references a path, verify the path exists from the PROJECT's perspective, not the goat-flow repo's perspective. Add to DoD: "grep skill files for repository-local template paths and replace them with the installed project-local equivalent before shipping."

---
## Lesson: Ignored `.goat-flow` paths need `rg -uu` during rename verification

**Status:** active | **Created:** 2026-04-15

**What happened:** While renaming the scratch workspace directory to `scratchpad`, the first reference scan used `rg --hidden` and incorrectly appeared clean. A follow-up scan with `rg -uu` found the real remaining self-reference in `commit.md` (later edits made the original line reference stale - exactly the drift pattern this lesson exists to prevent).

**Root cause:** `--hidden` includes hidden files but still respects ignore rules. For `.goat-flow` verification work, that can hide the exact content being checked.

**Prevention:** For path-renames or cross-reference checks that target ignored workspace state, use `rg -uu` from the start and grep both the old and new patterns before declaring the rename verified.

---
## Lesson: Backticks in shell grep patterns can fake a verification failure

**Status:** active | **Created:** 2026-04-18

**What happened:** During rename verification for ~~`.goat-flow/tasks/1.3.0`~~ to `.goat-flow/tasks/1.2.0-wave-6` (old path no longer exists - historical context), a ripgrep command embedded backticks in the shell pattern. Bash treated ``1.3.0`` as command substitution and failed with `/bin/bash: line 1: 1.3.0: command not found`, which made the verification step noisy and ambiguous.

**Recurrence 2026-05-05:** During 1.8.0 task-plan consolidation, a source-slice reference check embedded a literal markdown backtick in the shell regex (`reference/imported...\\.md` with a backtick exclusion). The PreToolUse hook blocked it with `Backtick command substitution hides nested execution`. The check was rerun with a safer single-quoted pattern that avoided backticks entirely.

**Root cause:** Mixed markdown-style quoting with shell quoting during a verification command. The search intent was correct, but the shell interpreted the pattern before `rg` saw it.

**Fix:** For verification grep commands, use single-quoted patterns or plain escaped literals only. Do not put markdown backticks inside the shell command. When a verification command fails due to quoting, rerun a narrower path-only search before claiming the rename is verified.

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
## Lesson: Optional skill-path examples still need real targets or non-path phrasing

**Status:** active | **Created:** 2026-04-18

**What happened:** The first preflight run after M14/M15/Wave 6 landed failed path integrity on installed `goat-security` copies and blocked release verification. Two new lines in `workflow/skills/goat-security/SKILL.md` still referenced `workflow/skills/**`, and the new optional policy hook named `.goat-flow/security-policy.md` without shipping the file. Preflight reported the exact failures:

- `FAIL: ./.claude/skills/goat-security/SKILL.md: contains framework-local workflow/ path`
- `FAIL: Installed skill references missing path: .goat-flow/security-policy.md`

**Root cause:** The skill rewrite was authored from the framework repo’s perspective instead of the installed project’s perspective. The policy hook text was written as “optional” in prose, but the path-integrity check correctly treated the literal path as a promised target. That is the same underlying mistake as other installed-skill path bugs: if a shipped skill names a path, the installed project must be able to resolve it.

**Fix:** Reworded the agent-surface bullets to use installed-project paths only, updated the CI/agent-surface reference pack to avoid `workflow/`, and added the canonical stub file at `.goat-flow/security-policy.md`. Preflight then passed with `PREFLIGHT PASSED  45 checks, 19 warning(s)`.

**Prevention:**
1. After editing any skill or reference pack, run path-integrity or full preflight before syncing milestone state.
2. If a path is truly optional, either ship a stub at that exact location or describe the surface without a literal unresolved path.
3. Treat installed skills as project-facing docs, not framework-facing docs; `workflow/` is evidence of perspective drift unless the file lives only in the framework repo.

---
## Lesson: Renaming a tracked file requires manifest fact updates, not just cross-ref updates

**Status:** active | **Created:** 2026-04-19

**What happened:** Renamed the dashboard's old setup-view file to `setup.html` and updated the include in `index.html`. `npm run typecheck` passed. User ran `npm run dashboard` and the CLI threw `ManifestValidationError: workflow/manifest.json has drifted from observed state` at startup because `facts.dashboard_views` still listed `wizard` instead of `setup`.

**Root cause:** Verified with typecheck + grep for direct references, but `workflow/manifest.json` tracks filesystem facts (view names, preset counts) that are validated against observed state at every CLI entry via `validateManifest()`. Typecheck and grep-for-filename don't cover static facts registered in the manifest; drift only surfaces when the manifest loader runs.

**Fix:** When renaming, adding, or removing files tracked in `workflow/manifest.json` `facts.*` arrays (currently `dashboard_views`, `presets_count`), update the manifest alongside the code change and run `node --import tsx src/cli/cli.ts manifest --check` before declaring done. `manifest --check` is the canonical gate for this drift; typecheck will not catch it.

**Prevention update (2026-04-19):**
1. `manifest --check` proves filesystem state, not git index state. New or replacement files can exist locally and still be missing from the next commit.
2. After any file add/rename/delete tied to manifest facts or install contracts, confirm the replacement is tracked with `git status --short` or `git ls-files --error-unmatch <path>`.
3. If the fix depends on a new repo-local path under `.goat-flow/`, verify that `.goat-flow/.gitignore` explicitly allows it to be tracked before declaring the issue closed.

---
## Lesson: Filesystem validation does not prove commit state

**Status:** active | **Created:** 2026-04-19

**What happened:** Two separate fixes looked complete locally but were still absent from the repository state that collaborators and CI would see. `src/dashboard/views/setup.html` existed on disk and satisfied `workflow/manifest.json`'s `dashboard_views` fact check, but the file was untracked while `wizard.html` was deleted. `.goat-flow/security-policy.md` also existed locally and satisfied path-integrity expectations for `goat-security`, but the file was ignored by `.goat-flow/.gitignore` and therefore absent from git history.

**Root cause:** The local verification gates used filesystem reads, not the git index. `src/cli/manifest/manifest.ts` validates dashboard views with `readdirSync()`, and preflight/path-integrity only care whether a path resolves on disk. That is necessary, but it does not prove the replacement file is staged, tracked, or even eligible to be tracked.

**Fix:** Add an explicit tracked-state checkpoint whenever a fix depends on a new or replacement file. For this incident the concrete repair was: whitelist `.goat-flow/security-policy.md` in `.goat-flow/.gitignore`, ensure the replacement dashboard view is tracked, and use `git status --short` plus `git ls-files --error-unmatch <path>` before closing the loop.

**Prevention:**
1. Treat filesystem checks and tracked-state checks as separate gates.
2. After any add/rename/delete, run `git status --short` and confirm the intended replacement path is listed as tracked or staged, not `??` or hidden behind ignore rules.
3. If a local-only fix relies on a repo path under `.goat-flow/`, inspect `.goat-flow/.gitignore` before assuming the file can ship.

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
## Lesson: Refactors that delete files also need tool-config cleanup

**Status:** active | **Created:** 2026-04-20

**What happened:** The setup-summary refactor passed `npm run typecheck` and the focused detector/dashboard tests, but full preflight still failed at the Knip gate. One failure was a stale ignore entry in `knip.json` for the old dashboard preset TypeScript module that had already been deleted; the other was an exported `SetupStackSummary` type that had no external consumer.

**Root cause:** Verified runtime behavior first and only learned about tooling drift at the end. File deletions and new exports change cold-path tool surfaces (`knip.json`, unused-export analysis) even when app behavior and tests are correct.

**Evidence:** `knip.json` (search: `dashboard-custom-prompts.ts`) - ignore list still carried the deleted dashboard preset TypeScript path; `src/cli/detect/project-stack.ts` (search: `interface SetupStackSummary`) - `SetupStackSummary` was exported even though only local consumers needed it.

**Fix:** Remove the stale Knip ignore entry, de-export the setup-summary interface, then rerun `npx knip` before the final preflight pass.

**Prevention:**
1. After deleting or renaming a source file, scan repo tool configs (`knip.json`, eslint/prettier ignores, test fixtures) for stale path references before relying on preflight.
2. After introducing a new exported symbol during a refactor, run `npx knip` before the full gate so unused exports are caught while the context is still local.

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
## Lesson: Manifest changes require matching snapshot updates

**Status:** active | **Created:** 2026-04-24

**What happened:** Changed the decisions directory anchor from the old dot-gitkeep placeholder to `.goat-flow/decisions/README.md` in `workflow/manifest.json` but missed the corresponding entry in `workflow/manifest-snapshots/v1.2.4.json`. The snapshot still listed the old placeholder after the live manifest had moved to `README.md`. Only caught when the user explicitly asked "did you update the snapshot too?"

**Root cause:** Treated `workflow/manifest.json` as a single source file, but v1.2.4 has a parallel snapshot copy that must stay in sync. The verification pass grepped for stale dot-gitkeep references across `workflow/` and `src/cli/` but the grep results included the snapshot hit and it was mentally dismissed as "historical" without reading which version it was. The v1.2.4 snapshot is the CURRENT version's snapshot - not historical.

**Prevention:**
1. After any edit to `workflow/manifest.json`, immediately check whether `workflow/manifest-snapshots/v<current-version>.json` needs the same change. The current-version snapshot is a live mirror, not a historical record.
2. When grepping for stale references, do not dismiss snapshot hits without checking the version number. Only snapshots for OLDER versions are frozen history.

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
