---
category: verification
---

## Lesson: "Double check" means read the files, not re-run the tests

**Created:** 2026-03-22

**What happened:** User asked to "double check" multiple times. Each time, re-ran typecheck + tests + scan. Never caught stale shape references, documentation inconsistencies, or content quality issues that three external agents found immediately by reading the actual files.
**Root cause:** Interpreted verification as "run the pipeline" instead of "read what changed." Tests only cover what they test.
**Fix:** Added removed-pattern check to preflight. "Double check" should include: (1) run pipeline, (2) grep removed patterns, (3) read 3-5 changed files for content accuracy.

---

## Lesson: Agent doesn't tick milestone checkboxes (recurrence x4, unresolved)

**Created:** 2026-03-31 | **Recurrences:** M1 (2026-03-31), M29 (2026-04-04), M32 (2026-04-05), M08 (2026-04-07)

**What happens:** The agent completes milestone tasks but ticks zero checkboxes. The user discovers it during review. CLAUDE.md VERIFY says "MUST tick `- [x]` on each task as it's completed - not at the end." The instruction exists in three places and is ignored every time.

**Root cause:** When parallelizing work or context-switching to user messages, the "tick as you go" step competes with "do the next thing" and loses. The agent tracks completion mentally but never writes it to the file.

**Why stronger rules haven't worked:** Each recurrence added a stronger prevention rule. M1: "tick immediately." M29: "FIRST action must be editing the milestone file." M32: "before doing anything else." All failed because documentation-level enforcement does not work for this pattern - the forcing function competes with whatever the agent wants to do next, and loses.

**Status:** Unresolved. Needs mechanical enforcement (hook or gate), not more rules.

---

## Lesson: Formatter verification must preserve repo style flags

**Created:** 2026-04-03

**What happened:** While tightening scanner messages, verification included a `prettier --write` pass on three rubric files without the repo's single-quote flag. The code was still valid, but the formatter rewrote quote style across entire files and created a much larger diff than intended.
**Root cause:** Treated formatting as a neutral cleanup step instead of part of the blast radius. The command matched the tool, but not the repo's existing style contract.
**Fix:** When formatting targeted files during verification, use the same style flags the repo already uses or the same invocation pattern that previous maintenance/test scripts used. Always check `git diff --stat` immediately after formatter runs to catch accidental blast-radius expansion.

---

## Lesson: Workflow parser refactors need both fixture coverage and typecheck

**Created:** 2026-04-03

**What happened:** While tightening CI-validation checks, the first pass on the workflow `run:` parser read the wrong regex capture group and then used a router heuristic that only matched commands containing the word `router`. The focused regression suite and `tsc` both failed before the broader test run finished.
**Root cause:** Changed parsing and heuristics together without first validating the extracted command shape. The new regression covered the shell pattern, but the implementation still assumed the old capture layout and overfit to existing workflow wording.
**Fix:** For parser refactors, verify in this order: (1) print/exercise the extracted intermediate values, (2) run the focused regression suite, (3) run `npx tsc --noEmit`, then (4) run the full test suite. Heuristics should match behavior patterns like `grep ... | while read ... [ ! -e ]`, not just keywords in step names.

---

## Lesson: Rubric honesty changes need both in-memory and disk-backed fixture sync

**Created:** 2026-04-03

**What happened:** Tightened `2.2.2` so a registered stop hook only passes when it also runs real validation commands. The new focused regression passed immediately, but the disk-backed `failing-known` fixture still expected the old failure set and broke on the next verification step.
**Root cause:** Updated the rubric logic and the in-memory regression corpus first, but forgot that `test/fixtures/projects/failing-known/fixture.json` and `test/fixtures/project-fixtures.test.ts` also encode expected failing check IDs. Scanner honesty work touches more than one fixture layer.
**Fix:** Whenever a rubric check changes semantics, verify in this order: (1) focused in-memory regression, (2) disk-backed fixture corpus, (3) full suite. Search for the check ID in `test/fixtures/` before treating the change as complete.

---

## Lesson: New blocking checks can break passing fixtures even when the scanner is correct

**Created:** 2026-04-03

**What happened:** Added a new deny-hook check for pipe-to-shell blocking. The focused scanner regression passed, but the next full-suite run dropped both disk-backed `passing-minimal` and `passing-full` from `100` to `99`.
**Root cause:** The new rubric requirement was correct, but the "passing" fixture baseline still used settings-based deny rules that blocked `rm -rf`, force push, and `chmod 777` without also blocking `curl | bash` / `wget | sh`. Positive fixtures are just as sensitive to new honesty checks as failing fixtures.
**Fix:** When adding a new required check, audit both failure fixtures and passing baselines. For rubric changes, verify in this order: (1) focused regression, (2) disk-backed passing fixtures, (3) disk-backed failing fixtures, (4) full suite. If a positive fixture drops, update the fixture input first, not the expected score.

---

## Lesson: Heading regexes can silently truncate router-table checks

**Created:** 2026-04-03

**What happened:** Tightened `2.4.3` to parse the Router Table directly, but the first extractor used a multiline regex with `$` in the lookahead. In JavaScript regexes, `$` under `/m` matches end-of-line, so the match stopped after the `## Router Table` heading and never included the rows below it. The new regression also referenced an undefined fixture constant, so the first focused test run broke twice before the real logic was verified.
**Root cause:** Reached for a compact heading regex instead of reusing the repo’s line-based section parsing style, then wrote a regression that depended on a fixture helper that did not exist in that file.
**Fix:** For markdown section extraction, prefer line-based parsers over multiline heading regexes with `$`. For new regressions, build the smallest self-contained fixture possible unless the shared fixture object is already in scope.

---

## Lesson: Path normalization can invalidate later path-shape heuristics

**Created:** 2026-04-03

**What happened:** After normalizing router references by trimming trailing slashes, the follow-up `2.4.3` filter still looked for the literal substring `/skills/`. That turned `.claude/skills/` into `.claude/skills`, so the canonical passing fixture dropped from `100` to `99` even though the router row was correct.
**Root cause:** Mixed two phases of logic without rechecking the invariant after normalization. The filter assumed the original slash shape still existed after the normalizer had deliberately removed it.
**Fix:** When a parser normalizes paths, downstream checks must use shape tests that still hold after normalization, such as segment-boundary regexes (`/\/skills(?:\/|$)/`) instead of raw substring checks that depend on trailing separators.

---

## Lesson: Regressions caught too late - tests run at milestone granularity, not edit granularity

**Created:** 2026-04-05

**What happened:** Claude Insights reported 68 buggy-code friction events across 112 sessions (61% of sessions had at least one). The `/goat-test` skill generates test plans after implementation, and `stop-lint.sh` runs linting after every turn, but neither catches logic regressions mid-implementation. Tests only run when the user explicitly asks or when a milestone completes. Regressions introduced in turn 3 of a 10-turn implementation aren't caught until the end, when the debugging context is stale.

**Root cause:** The verification loop runs at the wrong granularity. Lint after every turn catches syntax. Tests after every milestone catch logic. The gap between these two is where regressions hide.

**Prevention:**
1. Consider an optional post-write hook that runs the project's test command after file changes (configured via `config.yaml`, off by default)
2. Skills with implementation phases should include a "run tests" checkpoint every N edits, not just at phase boundaries
3. For test-heavy projects (1000+ tests), a focused test subset (changed files only) avoids the full-suite penalty while still catching regressions early

---

## Lesson: Parallel sessions (37% of messages) need concurrency-safe file patterns

**Created:** 2026-04-05

**What happened:** Claude Insights showed 75 overlap events across 77 sessions - 37% of all messages happened during parallel Claude sessions. Learning loop files (`.goat-flow/logs/`, `.goat-flow/lessons/`, `.goat-flow/footguns/`) are append-only by convention, but nothing prevents two agents from writing to the same file simultaneously. Session logs use date-slug filenames which reduces collisions, but category bucket files (e.g. `.goat-flow/lessons/verification.md`) are shared write targets.

**Root cause:** goat-flow was designed for single-agent sessions. The category bucket format (multiple entries in one file) creates write contention that per-entry files (one file per lesson) wouldn't have.

**Prevention:**
1. Document which files are safe for concurrent access in the plugin instructions
2. For learning loop writes during parallel sessions, use unique filenames (date-agent-slug) rather than appending to shared buckets
3. Session logs already use unique filenames - extend this pattern to footgun/lesson entries when multi-agent mode is detected

## Lesson: Framework paths vs project paths in verbatim-installed skills

**Created:** 2026-04-11
**What happened:** M17a extracted skill modes into the repository template directory and left repository-local template references in the skill files. Skills are installed verbatim, so every project received instructions that pointed back into the goat-flow repo instead of the installed project. R9 scored system avg 42 (down from 53.7) largely because of this single bug.
**Evidence:** R9 critiques - 6 of 7 projects flagged broken template references. `workflow/skills/goat/SKILL.md`, `workflow/skills/goat-security/SKILL.md`, `workflow/skills/goat-test/SKILL.md` all used repository-local template paths instead of installed-project template paths. (Paths updated from retired flat-file layout to current directory structure.)
**Prevention:** After editing any skill file that references a path, verify the path exists from the PROJECT's perspective, not the goat-flow repo's perspective. Add to DoD: "grep skill files for repository-local template paths and replace them with the installed project-local equivalent before shipping."

---

## Lesson: Multi-agent critique finds findings single reviewers miss - but synthesis is the expensive part

**Created:** 2026-04-13

**What happened:** 9 independent agent reviews of goat-flow v1.1.0 found 25 confirmed defects. No single reviewer found all 25. The Codex compaction hook false positive (M1) was found by 1 of 9 reviewers. The ask_first glob-unaware false positive (M8) was found by 1 of 9 reviewers. Both are MAJOR audit honesty issues. The first review established ~60-70% of findings; each additional review added diminishing but non-zero value, including MAJOR findings in reviews 6 and 9.

**What this means for critique practice:**
1. Multi-agent critique is worth doing for large surfaces. A single thorough review will miss things, and the things it misses can be important.
2. Model diversity matters more than count. Codex scored 93/100 (most generous) because it systemically missed documentation surfaces. One Codex + one Gemini + one Claude covers more ground than three Claudes.
3. The synthesis + verification layer is where the value is captured. ~15-20% of claims across 9 reviews were wrong or needed active verification. Unverified multi-agent output is noisier, not more reliable.
4. Sweet spot: 4-5 reviews from different models for a framework/architecture audit. 3 for a feature or module.
5. Score convergence across reviewers is the signal that coverage is adequate - not review count. High score variance (74 vs 93 on the same codebase) means some reviewer missed a major category.

**Prevention:** When commissioning multi-agent critique, plan for synthesis work. Budget time to: (a) verify disputed claims against source code, (b) track first-discovery of each finding, (c) dispute false claims with evidence. The critique is an input that requires judgment, not a spec that gets executed.

---

## Lesson: Blindly applying review feedback without verifying findings

**Created:** 2026-04-11
**What happened:** After receiving 8 critic reviews of the goat-flow framework, the agent started fixing every cited `file:line` without first checking whether the findings were still valid. Several of the cited issues had already been fixed by sub-agents earlier in the same session. The agent was about to edit files that were already correct, potentially reintroducing bugs or making nonsensical changes.

**Root cause:** Treating review output as a task list instead of as claims to verify. The agent read "CLAUDE.md:11 still has 6-step loop" and jumped to editing without running `sed -n '11p' CLAUDE.md` first. Reviews are evidence-tagged opinions, not commands. The evidence can be stale by the time you read it - especially when multiple agents are editing the same repo in the same session.

**Prevention:**
1. Before acting on any review finding, verify the cited evidence is still current: read the actual file at the cited line
2. Batch-verify all findings first (`grep`, `sed -n`, `head`), then fix only what's actually broken
3. Reviews from agents that didn't run the latest code are particularly likely to cite stale evidence
4. "8 critics agree" does not mean "8 critics are right" - they may all be reading the same stale state

---

## Lesson: 14 self-dogfooding bugs survived 9 rounds of critique and 17 milestones

**Created:** 2026-04-11
**What happened:** After M17, 6 external critics independently reviewed the goat-flow framework itself (not installed projects). They found 14 verified bugs that had survived all prior milestones: foundation.ts emitting v1.0, SKILL_TEMPLATES missing goat-sbao, config.yaml referencing a renamed script, README overclaiming hooks, stale test fixtures encoding the wrong skill count, setup fragments still creating coding-standards (removed in M13), classify-state marking "healthy" from version alone, and more. Every bug was a 1-5 line fix.

**Why these were missed:**
1. **Tests validated shape, not truth.** Contract tests checked "does this section heading exist" not "is the skill count correct." `evaluate-check.test.ts:270` literally says "All 6 skills present" - nobody noticed when goat-sbao made it 7.
2. **Self-critique was pipeline-focused.** Every milestone ran `tsc`, `npm test`, `scan`, `preflight`. All passed. None caught that README said "Six" or that foundation.ts hardcoded v1.0. The pipeline tests what it tests; it doesn't read prose.
3. **No external review until R8+.** The first 7 rounds critiqued goat-flow as installed on OTHER projects. Nobody reviewed the goat-flow repo itself until round 8. Self-review is blind to self-consistency.
4. **Rename survivors.** `context-validate.sh` was renamed to `validate-goat-flow-setup.sh` but config.yaml kept the old name. `presets.js` was renamed to `preset-prompts.js` but architecture.md kept the old name. No grep-after-rename discipline for config/docs (only code).

**Prevention:**
1. Add contract tests that link canonical constants to docs: `SKILL_NAMES.length` must match README, docs, config, SKILL_TEMPLATES, and test fixtures
2. After any rename, grep ALL file types (not just `.ts` and `.md` - also `.yaml`, `.json`, `.sh`)
3. Periodically invite external review of the goat-flow repo itself, not just installed output
4. `preflight-checks.sh` should verify SKILL_NAMES count consistency across surfaces

---

## Lesson: Blindly applying critique recommendations without verifying claims

**Created:** 2026-04-14

**What happened:** A critique agent claimed `.goat-flow/architecture.md:18` had the wrong build-check breakdown: "says 7+9, actual code shows 12+4." The claim was accepted at face value and the doc was changed. A subsequent refactor restructured the checks into `SETUP_CHECKS` (12 checks) and `AGENT_CHECKS` (4 checks), making the actual breakdown **12 setup + 4 agent** (16 total). The preflight's "Architecture doc counts match code" check only validates the total (16), not the sub-breakdown, so incorrect breakdowns pass all automated gates.

**Root cause:** The first critique agent likely miscounted or read a stale build of the code. The claim was plausible (it got the total right), which made it easy to accept without running the verification command. The same session also changed `code-map.md` correctly for a different issue, creating a false sense that all claims were verified.

**Evidence:** `node --input-type=module -e "const a=await import('./dist/cli/audit/check-goat-flow.js'); const b=await import('./dist/cli/audit/check-agent-setup.js'); console.log('setup:', a.SETUP_CHECKS.length, 'agent:', b.AGENT_CHECKS.length)"` - outputs 12 setup + 4 agent (16 total).

**Prevention:**
1. Before changing any numeric claim in a canonical doc, run the verification command yourself - never trust a critique's count.
2. The preflight should validate sub-breakdowns, not just totals.
3. Treat external critique findings as hypotheses, not facts. Verify each one independently before applying.

---

## Lesson: Ignored `.goat-flow` paths need `rg -uu` during rename verification

**Created:** 2026-04-15

**What happened:** While renaming the scratch workspace directory to `scratchpad`, the first reference scan used `rg --hidden` and incorrectly appeared clean. A follow-up scan with `rg -uu` found the real remaining self-reference in `commit.md:12` (note: `commit.md` was later edited to 9 lines, making this line reference stale - exactly the drift pattern this lesson exists to prevent).

**Root cause:** `--hidden` includes hidden files but still respects ignore rules. For `.goat-flow` verification work, that can hide the exact content being checked.

**Prevention:** For path-renames or cross-reference checks that target ignored workspace state, use `rg -uu` from the start and grep both the old and new patterns before declaring the rename verified.

---

## Lesson: Structural audit passing hides cold-path content drift (8-critique finding)

**Created:** 2026-04-15

**What happened:** Eight independent critiques (3 Claude, 5 Codex) reviewed the goat-flow v1.1.0 setup on its own repo. All 8 confirmed structural integrity: 7 skills matched templates, 57 tests passed, all router paths resolved, deny hook self-test passed, architecture doc numeric claims verified. Despite this, the 8 critiques collectively found 20+ verified content-accuracy failures in cold-path surfaces that no automated check caught. Examples: `docs/audit-and-critique.md:38-47` describing checks that no longer exist in code; `docs/coding-standards/conventions.md:10` claiming zero runtime deps when `package.json` has js-yaml and ws; `.goat-flow/glossary.md:21` pointing Task Tracking at the wrong file; `.goat-flow/code-map.md:71` listing a script under the wrong directory; `scripts/stop-lint.sh` existing despite ADR-040 saying it was removed; `.goat-flow/tasks/.gitignore:2` ignoring all milestone files while goat-plan claims durable shared state. Setup scored 58-90/100 across the 8 critiques - the range itself shows the split between structural soundness and content accuracy.

**Root cause:** The audit validates structure (files exist, versions match, paths resolve) but not content truth. Preflight validates some doc/code counts but not descriptions, claims, or cross-file consistency. Cold-path docs are updated manually and drift as code changes. The Step 01 early-stop rule (`workflow/setup/01-system-overview.md:12`) says stop when audit passes, hardening stale content into "done."

**Evidence:** All findings verified with direct file reads and command output during the critique session. The critique convergence table documents which critiques found which findings.

**Prevention:**
1. Add content-drift checks to preflight or audit: doc check descriptions match code, convention claims match package.json, glossary canonical files exist
2. Change Step 01 early-stop to require content-drift checks, not just structural audit pass
3. Add a cold-path truth audit step to the release process: verify footguns, docs, coding-standards, glossary, and code-map against actual code before each release
4. Consider auto-generating audit docs from check code exports to prevent drift permanently

---

## Lesson: Manifest canonical vs stale_names misclassification silently broke skill installs

**Created:** 2026-04-16

**What happened:** `workflow/manifest.json` listed only `"goat"` in `skills.canonical` and classified the other 6 active skills (goat-debug, goat-plan, goat-review, goat-sbao, goat-security, goat-test) as `stale_names`. `src/cli/constants.ts` `SKILL_NAMES` also said `["goat"]`. The install script (`workflow/install-goat-flow.sh:137`) correctly installs all 7, and the repo itself has all 7 in `.claude/skills/`. But the audit read `canonical` to determine expected count, so it reported "1/1 installed" on target projects. The dashboard and setup prompt both showed "1/1 skills installed" - which looked correct but was silently wrong. Target project `/srv/halaxy-cypress` only had the `goat` dispatcher installed; the other 6 functional skills were missing.

**Root cause:** At some point the manifest was updated to reflect a "mono-skill dispatcher" model where `goat` was the only canonical skill (it dispatches to the others). But the install script, the repo's own skill directories, and user expectations all assumed 7 canonical skills. The contract test `SKILL_NAMES matches manifest.json canonical` existed but passed because both constants.ts AND manifest.json were wrong in the same direction - the test validated consistency between two broken sources, not correctness.

**Fix:** Updated `manifest.json` `skills.canonical` to list all 7. Updated `constants.ts` `SKILL_NAMES` to list all 7. Contract test now passes with the correct count. Ran install script on halaxy-cypress to deploy the missing 6 skills.

**Prevention:** Contract tests that validate two sources agree with each other are necessary but not sufficient - at least one source must be validated against ground truth (e.g., the actual files on disk or the install script's list). A test like "SKILL_NAMES matches the directories in .claude/skills/" would have caught this immediately.

---

## Lesson: Missing RULES.md went undetected because failing tests were dismissed as pre-existing

**Created:** 2026-04-16

**What happened:** `RULES.md` existed in `.agents/skills/goat/` (codex/gemini) but was missing from `.claude/skills/goat/`. The audit code (`check-agent-setup.ts:76-82`) explicitly checks for it. The goat dispatcher's `SKILL.md` tells the agent to "Read RULES.md in this directory immediately." But:
1. The install script (`install-goat-flow.sh`) only copied `SKILL.md` per skill - never copied `RULES.md`.
2. No template for `RULES.md` existed in `workflow/skills/`.
3. The 2 test failures (`audit on well-configured project`, `audit --harness`) were caused by this + the skill count bug, but were treated as "pre-existing failures" across an entire session of work.

**Root cause:** Two compounding failures. First, the install script was never updated to copy RULES.md when the audit check was added - the check and the installer were authored independently. Second, the resulting test failures were dismissed as background noise instead of investigated. Every test run showed "62 pass / 2 fail" and the response was "same 2 pre-existing failures, not from my change" - a correct but useless observation that prevented anyone from reading the actual failure messages.

**Fix:** Created a rules template for the goat skill. Updated install script to copy it. (RULES.md was later deleted entirely per ADR-042; its 2 unique lines were moved to `skill-preamble.md`.)

**Prevention:**
1. Never dismiss test failures as "pre-existing" without reading what they actually assert. If 2 tests fail, read the 2 failure messages.
2. When adding an audit check that requires a file, also update the install script that creates that file. Audit checks and install scripts must be updated together.
3. A contract test should verify that every file the audit checks for is also produced by the install script - otherwise the audit gates on something the installer never creates.

---

## Lesson: Redundant context files survive architecture changes because nobody measures token cost

**Created:** 2026-04-16

**What happened:** RULES.md (432 words, 6 sections) loaded on every `/goat` dispatch was almost entirely duplicated from CLAUDE.md and skill-preamble.md. A coding agent critique flagged it: "432 words of token budget consumed for ~30 words of unique signal." The file had existed since the mono-skill dispatcher model. When the architecture split into 7 skills with a shared preamble, the preamble absorbed the same rules but nobody deleted RULES.md. Then an audit check was added requiring it, an install script clause was added to copy it, and a template was created for it - each reinforcing the file's perceived necessity.

**Root cause:** No step in the setup or review process measures whether a shared-context file provides net-new information. Files that are "loaded on every invocation" are never challenged on token cost. Once a file exists and is wired into audit checks, it becomes self-justifying: the audit requires it, so it must be needed.

**Fix:** Deleted RULES.md (ADR-042). Moved 2 unique lines to skill-preamble.md. Removed audit check and install script special-case.

**Prevention:** When reviewing shared-context files (anything loaded on every turn or every skill invocation), compare section-by-section against other loaded files. If >80% duplicates existing loaded content, merge the unique lines and delete the file. Architecture changes that add new shared surfaces (like skill-preamble.md) should include a cleanup pass of older surfaces they subsume.

---

## Lesson: Dashboard API reviews need invalid-path assertions, not just happy-path shape checks

**Created:** 2026-04-16

**What happened:** The new dashboard HTTP integration suite initially focused on successful responses and basic endpoint reachability. When an explicit negative-path test for `GET /api/audit?path=/does/not/exist` was added, the route returned `200` with an audit-shaped payload instead of a JSON error. The same risk applied to setup, critique, and stack-detection routes because they accepted a `path` string but did not first verify that it existed and was a directory.

**Root cause:** The dashboard server delegated path handling to downstream helpers and implicitly trusted them to reject bad inputs. That made the contract look healthy in happy-path tests while a false-success path remained live. The original tests asserted status enums and endpoint availability, but not that invalid inputs failed loudly.

**Fix:** Added a shared `requireProjectDirectory()` guard in `src/cli/server/dashboard.ts` and used it before audit, setup, critique, and stack-detection work. Expanded `test/integration/dashboard-server.test.ts` to cover invalid audit and browse paths, plus stronger JSON/content-shape assertions across the API.

**Prevention:**
1. For every dashboard route that accepts a filesystem path, add at least one invalid-path test alongside the happy path.
2. Treat `fetch().json()` shape assertions as necessary but insufficient - contract tests also need status-code assertions for malformed or nonexistent inputs.
3. When a route wraps shared project helpers, validate the path at the HTTP boundary instead of assuming downstream code will reject it consistently.

---

## Lesson: Cross-critique review catches cold-path drift that single reviews and preflight miss

**Created:** 2026-04-16

**What happened:** A single diff review of 89 files on feat/1.1.0 found 2 cross-reference breakages (setup prompt, code-map skill tree). Then 4 independent coding agent critiques were run. Together they surfaced 15 additional cold-path issues: wrong check counts in CONTRIBUTING.md (8 vs 16), stale .js extensions in architecture.md and code-map, CLI help text with wrong harness count (15 vs 16), 6 stale footgun entries, and footgun file ordering that violated the scan contract. One critique (Critique 4) also produced a false positive (PreToolUse blind spot) that was disproved by finding the check in a different file (check-constraints.ts).

**Root cause:** Cold-path docs (CONTRIBUTING.md, code-map, architecture, footguns, CLI help text) are not validated by preflight for content accuracy -- only for structural presence and path resolution. A single reviewer reads the diff but not the surrounding docs. Multiple independent reviewers each read different files and catch different drift. The cold-path drift footgun already documented this pattern but the footgun's own evidence list had gone stale, demonstrating the recursive nature of the problem.

**Fix:** Applied all 15 fixes. Updated cold-path drift footgun with Round 2 evidence. Preflight now passes (33 checks, 0 errors).

**Prevention:**
1. After any rename, count change, or structural reorganization, grep for the old names/numbers across ALL docs, not just the files in the diff.
2. Run multi-agent critique on release branches -- the cross-review pattern (compare findings across 3+ independent reviewers, verify each, disprove false positives) is the most effective cold-path drift detector available.
3. Consider automating: extract check counts from code exports and validate against doc claims in preflight.
