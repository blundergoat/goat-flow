---
category: verification
last_reviewed: 2026-04-24
---

## Lesson: "Double check" means read the files, not re-run the tests

**Status:** active | **Created:** 2026-03-22

**What happened:** User asked to "double check" multiple times. Each time, re-ran typecheck + tests + scan. Never caught stale shape references, documentation inconsistencies, or content quality issues that three external agents found immediately by reading the actual files.
**Root cause:** Interpreted verification as "run the pipeline" instead of "read what changed." Tests only cover what they test.
**Fix:** Added removed-pattern check to preflight. "Double check" should include: (1) run pipeline, (2) grep removed patterns, (3) read 3-5 changed files for content accuracy.

---

## Lesson: Agent doesn't tick milestone checkboxes (recurrence x4, unresolved)

**Status:** active | **Created:** 2026-03-31 | **Recurrences:** M1 (2026-03-31), M29 (2026-04-04), M32 (2026-04-05), M08 (2026-04-07)

**What happens:** The agent completes milestone tasks but ticks zero checkboxes. The user discovers it during review. CLAUDE.md VERIFY says "MUST tick `- [x]` on each task as it's completed - not at the end." The instruction exists in three places and is ignored every time.

**Root cause:** When parallelizing work or context-switching to user messages, the "tick as you go" step competes with "do the next thing" and loses. The agent tracks completion mentally but never writes it to the file.

**Why stronger rules haven't worked:** Each recurrence added a stronger prevention rule. M1: "tick immediately." M29: "FIRST action must be editing the milestone file." M32: "before doing anything else." All failed because documentation-level enforcement does not work for this pattern - the forcing function competes with whatever the agent wants to do next, and loses.

**Status:** Unresolved. Needs mechanical enforcement (hook or gate), not more rules.

---

## Lesson: Formatter verification must preserve repo style flags

**Status:** active | **Created:** 2026-04-03

**What happened:** While tightening scanner messages, verification included a `prettier --write` pass on three rubric files without the repo's single-quote flag. The code was still valid, but the formatter rewrote quote style across entire files and created a much larger diff than intended.
**Root cause:** Treated formatting as a neutral cleanup step instead of part of the blast radius. The command matched the tool, but not the repo's existing style contract.
**Fix:** When formatting targeted files during verification, use the same style flags the repo already uses or the same invocation pattern that previous maintenance/test scripts used. Always check `git diff --stat` immediately after formatter runs to catch accidental blast-radius expansion.

---

## Lesson: Workflow parser refactors need both fixture coverage and typecheck

**Status:** active | **Created:** 2026-04-03

**What happened:** While tightening CI-validation checks, the first pass on the workflow `run:` parser read the wrong regex capture group and then used a router heuristic that only matched commands containing the word `router`. The focused regression suite and `tsc` both failed before the broader test run finished.
**Root cause:** Changed parsing and heuristics together without first validating the extracted command shape. The new regression covered the shell pattern, but the implementation still assumed the old capture layout and overfit to existing workflow wording.
**Fix:** For parser refactors, verify in this order: (1) print/exercise the extracted intermediate values, (2) run the focused regression suite, (3) run `npx tsc --noEmit`, then (4) run the full test suite. Heuristics should match behavior patterns like `grep ... | while read ... [ ! -e ]`, not just keywords in step names.

---

## Lesson: Rubric honesty changes need both in-memory and disk-backed fixture sync

**Status:** historical | **Created:** 2026-04-03 | **Reason:** Rubric/scanner system removed per ADR-013; specific check IDs no longer exist

**What happened:** Tightened `2.2.2` so a registered stop hook only passes when it also runs real validation commands. The new focused regression passed immediately, but the disk-backed `failing-known` fixture still expected the old failure set and broke on the next verification step.
**Root cause:** Updated the rubric logic and the in-memory regression corpus first, but forgot that `test/fixtures/projects/failing-known/fixture.json` and `test/fixtures/project-fixtures.test.ts` also encode expected failing check IDs. Scanner honesty work touches more than one fixture layer.
**Fix:** Whenever a rubric check changes semantics, verify in this order: (1) focused in-memory regression, (2) disk-backed fixture corpus, (3) full suite. Search for the check ID in `test/fixtures/` before treating the change as complete.

---

## Lesson: New blocking checks can break passing fixtures even when the scanner is correct

**Status:** historical | **Created:** 2026-04-03 | **Reason:** Scanner/rubric system removed per ADR-013

**What happened:** Added a new deny-hook check for pipe-to-shell blocking. The focused scanner regression passed, but the next full-suite run dropped both disk-backed `passing-minimal` and `passing-full` from `100` to `99`.
**Root cause:** The new rubric requirement was correct, but the "passing" fixture baseline still used settings-based deny rules that blocked `rm -rf`, force push, and `chmod 777` without also blocking `curl | bash` / `wget | sh`. Positive fixtures are just as sensitive to new honesty checks as failing fixtures.
**Fix:** When adding a new required check, audit both failure fixtures and passing baselines. For rubric changes, verify in this order: (1) focused regression, (2) disk-backed passing fixtures, (3) disk-backed failing fixtures, (4) full suite. If a positive fixture drops, update the fixture input first, not the expected score.

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

## Lesson: Regressions caught too late - tests run at milestone granularity, not edit granularity

**Status:** active | **Created:** 2026-04-05

**What happened:** Claude Insights reported 68 buggy-code friction events across 112 sessions (61% of sessions had at least one). The `/goat-qa` skill generates test plans after implementation, and `stop-lint.sh` runs linting after every turn, but neither catches logic regressions mid-implementation. Tests only run when the user explicitly asks or when a milestone completes. Regressions introduced in turn 3 of a 10-turn implementation aren't caught until the end, when the debugging context is stale.

**Root cause:** The verification loop runs at the wrong granularity. Lint after every turn catches syntax. Tests after every milestone catch logic. The gap between these two is where regressions hide.

**Prevention:**
1. Consider an optional post-write hook that runs the project's test command after file changes (configured via `config.yaml`, off by default)
2. Skills with implementation phases should include a "run tests" checkpoint every N edits, not just at phase boundaries
3. For test-heavy projects (1000+ tests), a focused test subset (changed files only) avoids the full-suite penalty while still catching regressions early

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

## Lesson: Multi-agent critique finds findings single reviewers miss - but synthesis is the expensive part

**Status:** active | **Created:** 2026-04-13

**What happened:** A multi-agent critique run on goat-flow v1.1.0 surfaced more defects than any single reviewer caught alone. MAJOR audit-honesty findings (Codex compaction hook false positive, ask_first glob-unaware false positive) were each raised by a single reviewer. First-pass reviews established the bulk of findings; later reviews added diminishing but non-zero value, including MAJOR findings no earlier reviewer had raised.

**What this means for critique practice:**
1. Multi-agent critique is worth doing for large surfaces. A single thorough review will miss things, and the things it misses can be important.
2. Model diversity matters more than reviewer count. Different model families have different systematic blind spots - one family may under-weight documentation surfaces, another may miss integration glue. Mixing families covers more ground than stacking instances of one.
3. The synthesis + verification layer is where the value is captured. A non-trivial share of raw multi-agent claims will be wrong or need active verification. Unverified multi-agent output is noisier, not more reliable.
4. Sweet spot: several reviews from different model families for a framework/architecture audit; fewer for a feature or module.
5. Score convergence across reviewers is the signal that coverage is adequate - not review count. High score variance means some reviewer missed a major category.

**Prevention:** When commissioning multi-agent critique, plan for synthesis work. Budget time to: (a) verify disputed claims against source code, (b) track first-discovery of each finding, (c) dispute false claims with evidence. The critique is an input that requires judgment, not a spec that gets executed.

---

## Lesson: Blindly applying review feedback without verifying findings

**Status:** active | **Created:** 2026-04-11
**What happened:** After receiving 8 critic reviews of the goat-flow framework, the agent started fixing every cited `file:line` without first checking whether the findings were still valid. Several of the cited issues had already been fixed by sub-agents earlier in the same session. The agent was about to edit files that were already correct, potentially reintroducing bugs or making nonsensical changes.

**Root cause:** Treating review output as a task list instead of as claims to verify. The agent read "CLAUDE.md:11 still has 6-step loop" and jumped to editing without running `sed -n '11p' CLAUDE.md` first. Reviews are evidence-tagged opinions, not commands. The evidence can be stale by the time you read it - especially when multiple agents are editing the same repo in the same session.

**Prevention:**
1. Before acting on any review finding, verify the cited evidence is still current: read the actual file at the cited line
2. Batch-verify all findings first (`grep`, `sed -n`, `head`), then fix only what's actually broken
3. Reviews from agents that didn't run the latest code are particularly likely to cite stale evidence
4. "8 critics agree" does not mean "8 critics are right" - they may all be reading the same stale state

---

## Lesson: 14 self-dogfooding bugs survived 9 rounds of critique and 17 milestones

**Status:** active | **Created:** 2026-04-11
**What happened:** After M17, 6 external critics independently reviewed the goat-flow framework itself (not installed projects). They found 14 verified bugs that had survived all prior milestones: foundation.ts emitting v1.0, SKILL_TEMPLATES missing goat-sbao, config.yaml referencing a renamed script, README overclaiming hooks, stale test fixtures encoding the wrong skill count, setup fragments still creating coding-standards (removed in M13), classify-state marking "healthy" from version alone, and more. Every bug was a 1-5 line fix.

**Why these were missed:**
1. **Tests validated shape, not truth.** Contract tests checked "does this section heading exist" not "is the skill count correct." `evaluate-check.test.ts:270` literally says "All 6 skills present" - nobody noticed when goat-sbao made it 7.
2. **Self-critique was pipeline-focused.** Every milestone ran `tsc`, `npm test`, `scan`, `preflight`. All passed. None caught that README said "Six" or that foundation.ts hardcoded v1.0. The pipeline tests what it tests; it doesn't read prose.
3. **No external review until R8+.** The first 7 rounds critiqued goat-flow as installed on OTHER projects. Nobody reviewed the goat-flow repo itself until round 8. Self-review is blind to self-consistency.
4. **Rename survivors.** A setup-validator rename left config.yaml on the old path, and `presets.js` was renamed to `preset-prompts.js` while architecture.md kept the old name. No grep-after-rename discipline for config/docs (only code).

**Prevention:**
1. Add contract tests that link canonical constants to docs: `SKILL_NAMES.length` must match README, docs, config, SKILL_TEMPLATES, and test fixtures
2. After any rename, grep ALL file types (not just `.ts` and `.md` - also `.yaml`, `.json`, `.sh`)
3. Periodically invite external review of the goat-flow repo itself, not just installed output
4. `preflight-checks.sh` should verify SKILL_NAMES count consistency across surfaces

---

## Lesson: Blindly applying critique recommendations without verifying claims

**Status:** active | **Created:** 2026-04-14

**What happened:** A critique agent claimed `.goat-flow/architecture.md:18` had the wrong build-check breakdown: "says 7+9, actual code shows 12+4." The claim was accepted at face value and the doc was changed. A subsequent refactor restructured the checks into `SETUP_CHECKS` (13 checks) and `AGENT_CHECKS` (4 checks), making the actual breakdown **13 setup + 4 agent** (17 total). The preflight's "Architecture doc counts match code" check only validates the total (17), not the sub-breakdown, so incorrect breakdowns pass all automated gates.

**Root cause:** The first critique agent likely miscounted or read a stale build of the code. The claim was plausible (it got the total right), which made it easy to accept without running the verification command. The same session also changed `code-map.md` correctly for a different issue, creating a false sense that all claims were verified.

**Evidence:** `node --input-type=module -e "const a=await import('./dist/cli/audit/check-goat-flow.js'); const b=await import('./dist/cli/audit/check-agent-setup.js'); console.log('setup:', a.SETUP_CHECKS.length, 'agent:', b.AGENT_CHECKS.length)"` - outputs 13 setup + 4 agent (17 total).

**Prevention:**
1. Before changing any numeric claim in a canonical doc, run the verification command yourself - never trust a critique's count.
2. The preflight should validate sub-breakdowns, not just totals.
3. Treat external critique findings as hypotheses, not facts. Verify each one independently before applying.

---

## Lesson: Ignored `.goat-flow` paths need `rg -uu` during rename verification

**Status:** active | **Created:** 2026-04-15

**What happened:** While renaming the scratch workspace directory to `scratchpad`, the first reference scan used `rg --hidden` and incorrectly appeared clean. A follow-up scan with `rg -uu` found the real remaining self-reference in `commit.md:12` (note: `commit.md` was later edited to 9 lines, making this line reference stale - exactly the drift pattern this lesson exists to prevent).

**Root cause:** `--hidden` includes hidden files but still respects ignore rules. For `.goat-flow` verification work, that can hide the exact content being checked.

**Prevention:** For path-renames or cross-reference checks that target ignored workspace state, use `rg -uu` from the start and grep both the old and new patterns before declaring the rename verified.

---

## Lesson: Structural audit passing hides cold-path content drift (8-critique finding)

**Status:** active | **Created:** 2026-04-15

**What happened:** Eight independent critiques (3 Claude, 5 Codex) reviewed the goat-flow v1.1.0 setup on its own repo. All 8 confirmed structural integrity: 7 skills matched templates, 57 tests passed, all router paths resolved, deny hook self-test passed, architecture doc numeric claims verified. Despite this, the 8 critiques collectively found 20+ verified content-accuracy failures in cold-path surfaces that no automated check caught. Examples at the time (all since resolved or removed): ~~`docs/audit-and-critique.md:38-47`~~ describing checks that no longer exist in code; `docs/coding-standards/conventions.md:10` claiming zero runtime deps when `package.json` has js-yaml and ws; `.goat-flow/glossary.md:21` pointing Task Tracking at the wrong file; `.goat-flow/code-map.md:71` listing a script under the wrong directory; ~~`scripts/stop-lint.sh`~~ existing despite ADR-015 saying it was removed; `.goat-flow/tasks/.gitignore:2` ignoring all milestone files while goat-plan claims durable shared state. Setup scored 58-90/100 across the 8 critiques - the range itself shows the split between structural soundness and content accuracy.

**Root cause:** The audit validates structure (files exist, versions match, paths resolve) but not content truth. Preflight validates some doc/code counts but not descriptions, claims, or cross-file consistency. Cold-path docs are updated manually and drift as code changes. Step 01 (`workflow/setup/01-system-overview.md` (search: `## State check`)) now requires a cold-path truth spot-check before stopping (prevention #2 below, implemented), but coverage depends on which claims the agent chooses to verify.

**Evidence:** All findings verified with direct file reads and command output during the critique session. The critique convergence table documents which critiques found which findings.

**Prevention:**
1. Add content-drift checks to preflight or audit: doc check descriptions match code, convention claims match package.json, glossary canonical files exist
2. ~~Change Step 01 early-stop to require content-drift checks, not just structural audit pass~~ (done: Step 01 now requires cold-path truth spot-check before stopping)
3. Add a cold-path truth audit step to the release process: verify footguns, docs, coding-standards, glossary, and code-map against actual code before each release
4. Consider auto-generating audit docs from check code exports to prevent drift permanently

---

## Lesson: Backticks in shell grep patterns can fake a verification failure

**Status:** active | **Created:** 2026-04-18

**What happened:** During rename verification for ~~`.goat-flow/tasks/1.3.0`~~ to `.goat-flow/tasks/1.2.0-wave-6` (old path no longer exists - historical context), a ripgrep command embedded backticks in the shell pattern. Bash treated ``1.3.0`` as command substitution and failed with `/bin/bash: line 1: 1.3.0: command not found`, which made the verification step noisy and ambiguous.

**Root cause:** Mixed markdown-style quoting with shell quoting during a verification command. The search intent was correct, but the shell interpreted the pattern before `rg` saw it.

**Fix:** For verification grep commands, use single-quoted patterns or plain escaped literals only. Do not put markdown backticks inside the shell command. When a verification command fails due to quoting, rerun a narrower path-only search before claiming the rename is verified.

---

## Lesson: Manifest canonical vs stale_names misclassification silently broke skill installs

**Status:** active | **Created:** 2026-04-16

**What happened:** `workflow/manifest.json` listed only `"goat"` in `skills.canonical` and classified the other 6 active skills (goat-debug, goat-plan, goat-review, goat-critique, goat-security, goat-qa) as `stale_names`. `src/cli/constants.ts` `SKILL_NAMES` also said `["goat"]`. The install script (`workflow/install-goat-flow.sh:137`) correctly installs all 7, and the repo itself has all 7 in `.claude/skills/`. But the audit read `canonical` to determine expected count, so it reported "1/1 installed" on target projects. The dashboard and setup prompt both showed "1/1 skills installed" - which looked correct but was silently wrong. The target consumer project only had the `goat` dispatcher installed; the other 6 functional skills were missing.

**Root cause:** At some point the manifest was updated to reflect a "mono-skill dispatcher" model where `goat` was the only canonical skill (it dispatches to the others). But the install script, the repo's own skill directories, and user expectations all assumed 7 canonical skills. The contract test `SKILL_NAMES matches manifest.json canonical` existed but passed because both constants.ts AND manifest.json were wrong in the same direction - the test validated consistency between two broken sources, not correctness.

**Fix:** Updated `manifest.json` `skills.canonical` to list all 7. Updated `constants.ts` `SKILL_NAMES` to list all 7. Contract test now passes with the correct count. Ran install script on the consumer project to deploy the missing 6 skills.

**Prevention:** Contract tests that validate two sources agree with each other are necessary but not sufficient - at least one source must be validated against ground truth (e.g., the actual files on disk or the install script's list). A test like "SKILL_NAMES matches the directories in .claude/skills/" would have caught this immediately.

---

## Lesson: Missing RULES.md went undetected because failing tests were dismissed as pre-existing

**Status:** historical | **Created:** 2026-04-16 | **Reason:** RULES.md deleted; "never dismiss test failures as pre-existing" rule survives as an active principle elsewhere in this file

**What happened:** `RULES.md` existed in `.agents/skills/goat/` (codex/gemini) but was missing from `.claude/skills/goat/`. The audit code (`check-agent-setup.ts:76-82`) explicitly checks for it. The goat dispatcher's `SKILL.md` tells the agent to "Read RULES.md in this directory immediately." But:
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

## Lesson: Cross-critique review catches cold-path drift that single reviews and preflight miss

**Status:** active | **Created:** 2026-04-16

**What happened:** A single diff review of 89 files on feat/1.1.0 found 2 cross-reference breakages (setup prompt, code-map skill tree). Then 4 independent coding agent critiques were run. Together they surfaced 15 additional cold-path issues: wrong check counts in CONTRIBUTING.md (8 vs 16), stale .js extensions in architecture.md and code-map, CLI help text with wrong harness count (15 vs 16), 6 stale footgun entries, and footgun file ordering that violated the scan contract. One critique (Critique 4) also produced a false positive (PreToolUse blind spot) that was disproved by finding the check in a different file (check-constraints.ts).

**Root cause:** Cold-path docs (CONTRIBUTING.md, code-map, architecture, footguns, CLI help text) are not validated by preflight for content accuracy -- only for structural presence and path resolution. A single reviewer reads the diff but not the surrounding docs. Multiple independent reviewers each read different files and catch different drift. The cold-path drift footgun already documented this pattern but the footgun's own evidence list had gone stale, demonstrating the recursive nature of the problem.

**Fix:** Applied all 15 fixes. Updated cold-path drift footgun with Round 2 evidence. Preflight now passes (33 checks, 0 errors).

**Prevention:**
1. After any rename, count change, or structural reorganization, grep for the old names/numbers across ALL docs, not just the files in the diff.
2. Run multi-agent critique on release branches -- the cross-review pattern (compare findings across 3+ independent reviewers, verify each, disprove false positives) is the most effective cold-path drift detector available.
3. Consider automating: extract check counts from code exports and validate against doc claims in preflight.

---

## Lesson: Verification rationalization anti-patterns

**Status:** active | **Created:** 2026-04-18

**What happens:** The 5 hallucination red-flags in AGENTS.md:51-58 forbid claims without evidence (tests pass, completion, fix verification, hedged claims, check passed). Agents still ship unverified claims under pressure by producing rationalizations that feel distinct from the forbidden claim but are logically equivalent to it. "I'm 95% confident", "the sub-agent said it passed", "the change looks correct" - each slips past the red-flags because the red-flags name the violation, not the specific excuse pattern.

**Root cause:** The red-flags catalog what NOT to claim. They do not enumerate the specific rationalizations that convert "I didn't run the proof" into "it's fine." Under pressure (deadline, fatigue, long turn, trusted sub-agent report, partial run that "mostly worked"), the agent reaches for a rationalization the red-flags do not explicitly name, and the claim lands anyway.

**Rationalizations to reject:**
- "Confidence ≠ evidence" - high subjective confidence does not substitute for running the verification command in this message.
- "Just this once" - partial compliance compounds into no compliance. There is no exemption for a single turn.
- "The downstream agent said success, so it passes" - delegated claims are subject to the same red-flags; do not launder an unverified sub-agent output by restating it yourself.
- "Partial check is enough" - a subset of tests is not the test suite. If the red-flag applies to the whole check, a partial run does not discharge it.
- "Code changed, so probably fixed" - red-flag #3 requires re-running the reproduction that originally demonstrated the bug. "Probably fixed" is a hedged claim (red-flag #4).
- "Looks correct to me" - structural inspection is not verification. If the red-flag demands output, reading code is not output.

**Fix:** The Proof Gate in `skill-preamble.md` names the positive procedure (identify → run fresh → read → verify → cite). This lesson names the negative counterpart: the rationalization patterns that specifically defeat the red-flags. Before any completion, fix, or "passing" claim, check whether the next sentence you are about to write matches one of the patterns above. If it does, stop and satisfy the Proof Gate instead - or downgrade the claim to UNVERIFIED and state what evidence is still missing.

---

## Lesson: `npm test -- <file>` can still run the full suite

**Status:** active | **Created:** 2026-04-18

**What happened:** A focused verification run used `npm test -- test/unit/quality-command.test.ts`, expecting only the quality prompt tests to run. In this repo, `package.json` defines `test` as `node --import tsx --test test/*/*.test.ts`, so npm appended the file argument without removing the existing glob. The command still executed the full suite and surfaced unrelated audit failures, obscuring whether the changed file actually passed its own regression.

**Root cause:** Assumed npm positional passthrough would replace the script's built-in test target. It only appends arguments, so any existing glob or file list in the script still runs unless the underlying command supports overriding it.

**Fix:** For focused test verification in this repo, invoke the underlying command directly: `node --import tsx --test test/unit/quality-command.test.ts`. Reserve `npm test` for deliberate full-suite runs.

---

## Lesson: Repo-wide preflight can be blocked by unrelated formatter drift

**Status:** active | **Created:** 2026-04-18

**What happened:** After deleting the dedicated setup validator and rewiring preflight around the remaining script surface, focused verification passed (`shellcheck`, `npm run typecheck`, targeted smoke/unit tests, and exact grep for the removed path). But `bash scripts/preflight-checks.sh` still failed because `scripts/prettier-check.sh` reported four unformatted files that were outside the change set: `src/cli/classify-state.ts`, `src/dashboard/app.ts`, `test/integration/preamble-sync.test.ts`, and `test/unit/quality-command.test.ts`.

**Root cause:** Preflight is repo-wide, not diff-scoped. A local task can leave its own files clean and still inherit unrelated formatter debt already present in the worktree or committed baseline. If that debt is not separated from task-local regressions, the final report becomes ambiguous about whether the task itself broke verification.

**Fix:** Format any touched files first, then rerun the focused checks. If preflight still fails, run the narrower verifier (`scripts/prettier-check.sh` or equivalent) to identify whether the remaining failures are in untouched files. Report that split explicitly instead of calling preflight a task regression.

**Recurrence update (2026-04-21):** A v1.2.2 version-bump run had `npm test` fail only because the installer round-trip fixture runs full preflight and found committed formatter drift in `src/dashboard/index.html`, a file outside the version-bump edit set. `npm run format:check` reproduced the same single-file failure.

**Prevention:**
1. When preflight fails, immediately identify whether the failing files are in `git status` for the current task.
2. Treat repo-wide formatter failures in untouched files as residual baseline debt, not silent task fallout.
3. Keep the final verification section split between "checks that passed for this change" and "repo-wide checks still blocked by unrelated drift."

---

## Lesson: Semantic drift checks must normalize natural-language lists before claiming mismatch

**Status:** active | **Created:** 2026-04-18

**What happened:** A new semantic-drift check was added for the runner list in `docs/dashboard.md`. The first verification run still failed content audit even after the doc was corrected to "Claude, Codex, and Gemini". The checker split on commas before handling the Oxford-comma `and`, so it parsed the claim as `["Claude", "Codex", "and Gemini"]` and reported a false mismatch against the manifest-backed list.

**Root cause:** The drift check compared human-written prose too literally. It handled exact token matches but not natural-language list formatting, so a doc that was semantically correct still failed verification. The bug was in the checker, not in the docs.

**Fix:** Normalize list items before comparison by stripping a leading `and ` token after the split, then add a regression test that proves the current dashboard wording does not trigger `dashboard-runner-drift`.

**Prevention:**
1. When adding semantic drift checks for prose, test both a known-bad example and the current canonical wording.
2. Normalize natural-language list glue (`and`, Oxford commas, surrounding whitespace) before comparing against code-backed enumerations.
3. Treat a new drift rule that immediately flags corrected docs as a checker bug until the parser is disproven.

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

## Lesson: Temp-repo preflight harnesses inherit formatting debt from copied test files

**Status:** active | **Created:** 2026-04-19

**What happened:** The new M14 round-trip integration test cloned the repo into a tmpdir, patched the temp copy, and ran `bash scripts/preflight-checks.sh`. Installer, parity, and drift logic were correct, but the first verification run still failed because the cloned `test/integration/audit-drift.test.ts` was not formatted, and preflight's formatter gate checks `test/**/*.ts`, not just the files patched inside the tmp repo after cloning.

**Root cause:** Treated the tmp repo like a narrow scratch fixture instead of a full repo clone. Formatting only the temp-mutated files under-approximated the real preflight surface, so the harness initially proved a weaker condition than the milestone claimed.

**Fix:** For tmp-repo preflight coverage, either keep the source test file formatted in the real checkout before cloning or explicitly format any copied `src/**/*.ts` and `test/**/*.ts` files that changed in the source repo. Assume preflight sees the entire cloned repo, not only the temp patch set.

**Prevention update (2026-04-20):**
1. Treat any unformatted tracked file in the real checkout as a blocker for `checkDrift` round-trip fixtures, because the temp repo inherits that formatting debt before its own assertions run.
2. After touching `src/**/*.ts` or `test/**/*.ts`, run the formatter before trusting installer/preflight round-trip tests as evidence about drift logic.

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

**Evidence:** `knip.json:3` - ignore list still carried the deleted dashboard preset TypeScript path; `src/cli/detect/project-stack.ts:27` - `SetupStackSummary` was exported even though only local consumers needed it.

**Fix:** Remove the stale Knip ignore entry, de-export the setup-summary interface, then rerun `npx knip` before the final preflight pass.

**Prevention:**
1. After deleting or renaming a source file, scan repo tool configs (`knip.json`, eslint/prettier ignores, test fixtures) for stale path references before relying on preflight.
2. After introducing a new exported symbol during a refactor, run `npx knip` before the full gate so unused exports are caught while the context is still local.

---

## Lesson: Classic dashboard script splits need Knip ignore coverage

**Status:** active | **Created:** 2026-04-21

**What happened:** Splitting `src/dashboard/app.ts` into additional classic browser scripts passed dashboard typecheck and server asset tests, but `npx knip --no-progress` flagged the new script-tag files as unused because they are loaded from `src/dashboard/index.html` rather than imported by TypeScript.

**Root cause:** The dashboard frontend intentionally uses classic scripts (`x-data="app()"`) and shared browser globals. Knip follows module imports, not HTML script-tag reachability, so new `src/dashboard/dashboard-*.ts` files look unused unless `knip.json` names them alongside the existing `src/dashboard/app.ts` / `globals.d.ts` ignores.

**Evidence:** `knip.json` ignore list carries the dashboard classic-script files; `src/dashboard/index.html` loads `dashboard-readers.js`, `dashboard-setup-quality.js`, `dashboard-projects.js`, `dashboard-prompts.js`, `dashboard-terminal.js`, and `app.js` in order.

**Prevention:**
1. After adding a dashboard classic-script file, add it to `knip.json` in the same change.
2. Re-run `npx knip --no-progress` before relying on preflight, because dashboard typecheck and asset tests will not catch Knip reachability gaps.

---

## Lesson: New server helper files still count as repo-wide formatting debt

**Status:** active | **Created:** 2026-04-20

**What happened:** Extracting setup-detection helpers out of `src/cli/server/dashboard.ts` passed `npm run typecheck` and the focused dashboard integration suite, but `bash scripts/preflight-checks.sh` still failed. The real checkout had three unformatted server files (`src/cli/server/dashboard.ts`, `src/cli/server/setup-detect.ts`, `src/cli/server/dashboard-assets.ts`), so preflight's Prettier gate failed locally and the installer round-trip fixture failed too because it clones the current checkout before running temp-repo preflight.

**Root cause:** Treated the structural refactor like a code-only change and stopped at type/runtime verification. In this repo, formatting debt in the source checkout is not isolated: the round-trip fixture inherits it and replays the same formatter failure inside the temp clone.

**Fix:** Run Prettier on every touched `src/**/*.ts` file before trusting preflight or fixture-backed drift tests. Re-run the focused failing test (`test/integration/audit-drift.test.ts`) after formatting, not just the original happy-path suite.

**Prevention:**
1. After adding a new TypeScript helper file, treat `prettier --check` as part of the focused verification, not only the final repo-wide gate.
2. When preflight and the installer round-trip fixture fail together on formatting, fix the real checkout first; the temp fixture will usually heal with it.

**Prevention update (2026-04-20):**
1. This pattern recurred on the next dashboard-server split when `src/cli/server/dashboard-routes.ts` and the rewritten `dashboard.ts` were left unformatted. Treat any new `src/cli/server/*.ts` extraction as high-risk for this exact preflight + round-trip failure pair.

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

## Lesson: Untracked source-shadow files can poison lint, formatter, and drift gates together

**Status:** active | **Created:** 2026-04-20

**What happened:** A tiny Prompts view color tweak looked unrelated to the TypeScript gates, but the first verification rerun still failed preflight and the installer round-trip fixture. The real blocker was an untracked JavaScript shadow file sitting next to the canonical `src/cli/types.ts`. ESLint tried to parse the stray `.js` file against the TypeScript project config, Prettier treated it as a source file under `src/**/*.{ts,js,html}`, and the fixture cloned the same bad state into its temp repo.

**Root cause:** A generated or accidental source-shadow file under `src/` can evade attention because typecheck and the visible diff for the requested change point elsewhere. The repo gates scan the filesystem, not just tracked TS files, so an untracked sibling output can contaminate lint/format/drift verification far away from the user-visible edit.

**Fix:** Check `git status` and `git ls-files` when lint/prettier/fixture failures do not match the touched file. If the blocker is an untracked source-shadow file like `src/**/*.js` beside a canonical `src/**/*.ts`, delete it and rerun the exact failing gates.

**Prevention:**
1. When preflight suddenly fails with mixed ESLint + Prettier + drift-fixture errors after a small change, scan for untracked source-shadow files under `src/` before changing the requested code again.
2. Treat `src/**/*.js` siblings of tracked `src/**/*.ts` files as suspicious unless the repo intentionally tracks them.

---

## Lesson: Shared hook refactors need both hook-local proof and repo-wide preflight

**Created:** 2026-04-21

**What happened:** A `deny-dangerous.sh` hardening pass looked correct after the first edit, but the canonical self-test immediately failed because `BASH_REMATCH` was reused after a recursive `check_segment` call inside the new command-substitution helper. After fixing that, the hook copies all passed their own `--self-test`, yet full `bash scripts/preflight-checks.sh` still failed because `scripts/deny-dangerous.sh` is linted under the stricter repo-wide `shellcheck scripts/*.sh` profile, which does not exclude `SC2016` the way the hook-directory check does. The installer round-trip fixture failed for the same reason because it clones the current checkout before running temp-repo preflight.

**Prevention:**
1. In Bash regex helpers, copy `BASH_REMATCH[n]` into local variables before any recursive call or nested regex operation that can overwrite it.
2. For shared hook templates, do not stop at `bash workflow/hooks/deny-dangerous.sh --self-test`; also rerun the repo-wide `shellcheck scripts/*.sh scripts/maintenance/*.sh` and full `bash scripts/preflight-checks.sh`, because `scripts/deny-dangerous.sh` and fixture clones exercise stricter paths than the hook directories.

---

## Lesson: Filtered manifest ids still need explicit indexed-lookup proof in TypeScript

**Status:** active | **Created:** 2026-04-21

**What happened:** A manifest-backed registry cleanup reused one `loadManifest().agents` snapshot per public call and filtered configured ids with `isKnownAgentId()`. The focused unit tests passed, but the first `npm run typecheck` still failed on the follow-up mapping step because `agents[id]` was treated as possibly `undefined` inside `.map((id) => toRuntimeProfile(id, agents[id]))`. The same verification pass also caught a Prettier reflow issue in the touched registry file.

**Root cause:** Runtime truth from a filter callback does not always carry through to a later indexed `Record<string, T>` lookup strongly enough for TypeScript to discharge `undefined`. The refactor was logically correct, but the type proof at the final lookup site was incomplete. Formatting drift surfaced because the new helper signature changed line wrapping and the file had not yet been reflowed.

**Fix:** Add the explicit proof at the indexed lookup site (`agents[id]!` or a typed-entry helper), run Prettier on the touched TypeScript file, and rerun the exact failing gates.

**Prevention:**
1. After refactoring manifest/registry code that filters ids and then indexes a `Record`, run `npm run typecheck` even if the focused unit tests already pass.
2. When a helper signature or typed callback changes in a touched `.ts` file, include `prettier --check` or `prettier --write` in the focused verification pass before closeout.

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

## Lesson: Snapshot fixtures can carry metadata beyond the typed numeric contract

**Status:** active | **Created:** 2026-04-24

**What happened:** A backfill for missing v1.2.0–v1.2.4 manifest snapshots added a repo-integration test that `deepEqual`ed `loadSnapshotFacts()` output against numeric expectations. The first verification run failed because the historical `v1.1.0` snapshot already includes an extra `_note` key inside `snapshot_facts`, so the runtime payload was broader than the narrowed TypeScript interface used by the checker.

**Root cause:** I treated the snapshot loader as if it returned only the typed numeric fields, but the JSON contract in the repository also carries human-facing metadata that survives parsing.

**Fix:** Assert the numeric fields individually and allow extra metadata keys in historical snapshot fixtures.

**Prevention:**
1. When adding repo-integration tests for parsed JSON fixtures, inspect the real file shape before using `deepEqual` on a narrowed TypeScript view.
2. For historical compatibility tests, verify the required semantic fields and tolerate additive metadata unless the test is explicitly enforcing exact wire format.

---

## Lesson: Manifest changes require matching snapshot updates

**Status:** active | **Created:** 2026-04-24

**What happened:** Changed `.goat-flow/decisions/.gitkeep` to `.goat-flow/decisions/README.md` in `workflow/manifest.json` but missed the corresponding entry in `workflow/manifest-snapshots/v1.2.4.json`. The snapshot still listed `.gitkeep` after the live manifest had moved to `README.md`. Only caught when the user explicitly asked "did you update the snapshot too?"

**Root cause:** Treated `workflow/manifest.json` as a single source file, but v1.2.4 has a parallel snapshot copy that must stay in sync. The verification pass grepped for stale `.gitkeep` references across `workflow/` and `src/cli/` but the grep results included the snapshot hit and it was mentally dismissed as "historical" without reading which version it was. The v1.2.4 snapshot is the CURRENT version's snapshot - not historical.

**Prevention:**
1. After any edit to `workflow/manifest.json`, immediately check whether `workflow/manifest-snapshots/v<current-version>.json` needs the same change. The current-version snapshot is a live mirror, not a historical record.
2. When grepping for stale references, do not dismiss snapshot hits without checking the version number. Only snapshots for OLDER versions are frozen history.

---

## Lesson: Test suite must exercise the published invocation path

**Status:** active | **Created:** 2026-04-24

**What happened:** Commit 918ca3e wrapped the bare `main().catch(...)` call in an `import.meta.url` guard to prevent side effects on import. The guard used `resolve(process.argv[1]) === fileURLToPath(import.meta.url)`, which silently fails when the CLI is invoked through a symlink (the standard npm/npx path). All 359 tests passed because every test imports CLI functions directly or shells out via `node dist/cli/cli.js` — no test invoked the binary through a symlink, which is how every real consumer runs it.

**Root cause:** The test suite verified internal function behavior but never exercised the actual entry-point guard through the `.bin/` symlink path that `npx` uses. The refactor commit was titled "update goat-critique documentation," making it easy to overlook a CLI entry-point change during review.

**Prevention:**
1. `test/integration/main-guard.test.ts` now tests the CLI via a temp-dir symlink — the exact path that broke. This test would have caught the regression.
2. When modifying the entry-point guard or anything that controls whether `main()` runs, verify via symlink invocation, not just direct `node dist/cli/cli.js`.
