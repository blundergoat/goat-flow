---
category: test-fixtures-evaluators
last_reviewed: 2026-09-19
---

**Scope:** Fixtures for skill-evaluation trials - pressure scenarios that isolate one rule, evaluator prompts and restrictions, worktree scheduling for parallel evaluator runs, and what a blind evaluator or executor session loads at start. Test-suite fixtures are [test-fixtures.md](test-fixtures.md); scoring what a trial produced is [skill-trial-evidence.md](skill-trial-evidence.md).

## Lesson: Pressure scenarios must isolate the rule under test

**Status:** active | **Created:** 2026-07-12
**Decision changed:** Validate every pressure fact and evaluator restriction against the loaded contract before launch; non-target constraints must not decide the result.
**Trigger phase:** SCOPE
**Caught at:** VERIFY
**Incident count:** 6 | **Latest occurrence:** 2026-08-16
**Merged:** 2026-09-15 - moved here from `.goat-flow/learning-loop/lessons/test-fixtures.md` when that bucket was split along the evaluator-fixture seam to recover its headroom.

**Prevention:** Before using a pressure or application fixture, compare every option and prompt restriction with always-loaded instructions and accepted ADRs, attach a literal source anchor to every fact, and remove output fields that disclose the graded rule. Do not blend incidents, block mandatory reads, or ask the evaluator to recite the target technique; keep non-target obligations equal so only the tested rule explains the result. Dry-run command guards with the producer's real global flags and working-directory form. When a canary prohibits reads, provide the exact editable source declaration or allow one bounded read. Evidence anchors: `workflow/skills/playbooks/skill-quality-testing/tdd-iteration.md` (search: `Illustrative four-pressure scenario`), `test/contract/skill-hardening-shared-2.test.ts` (search: `isolated from repository-history policy`).

**What happened:** The flagship skill-TDD scenario offered `Commit now` as the expected failing choice although ADR-025 and every installed instruction file forbid coding-agent commits, so an agent could reject that option without following test-first discipline. The replacement is an explicitly illustrative security-depth scenario that holds file scope and mirror duties constant; it defines input and output shape, never incident evidence.

**Root cause:** The scenario varied both test ordering and repository-history authority, so its wrong answer was independently invalid under always-loaded policy.

**Recurrence 2026-08-02:** The first goat-debug hardening wave added an unsupported "one-line patch" and a transplanted "teammate is waiting" pressure; all three evaluators chose the safe option and the host invalidated the wave. `src/dashboard/preset-prompts.json` (search: `"id": "fix-bug"`) holds the real fix intent with no patch-size or waiting claim.
**Recurrence 2026-08-02 (recitation):** A hypothesis evaluator prompt explicitly asked "What would disconfirm each", naming the target field and measuring recitation rather than unaided technique; the host excluded the run and rewound.
**Recurrence 2026-08-09:** A goat-debug GREEN evaluator chose the correct Investigate path, but the prompt's three-call cap and read ban prevented the skill's mandatory learning-loop retrieval, so the pass was discarded. `workflow/skills/goat-debug/SKILL.md` (search: `Footgun check`).
**Recurrence 2026-08-10:** A live provider canary prohibited reads but named only old and new values for four edits; the agent guessed four incompatible declarations and every patch failed, exercising Stop without PostToolUse. `test/integration/hook-consumer-canary.test.ts` (search: `writeObservedCodexFeedbackConfig`).
**Recurrence 2026-08-16:** A goat-clarity Copilot evaluator guard recognised read-only Git only when the subcommand came first; Copilot prefixed `--no-optional-locks` and `-C <worktree>`, so the guard misclassified the disposable clone as non-Git and the run was discarded. `workflow/skills/goat-clarity/SKILL.md` (search: `repository root resolved from the invocation working directory`).

---

## Lesson: Concurrent evaluator runs must not share a fixture worktree when any run writes

**Created:** 2026-09-11
**Decision changed:** Schedule parallel evaluator runs by write set, not by case: every run that may write gets its own disposable worktree, and a read-only run that hashes fixtures shares a checkout only with other read-only runs.
**Trigger phase:** SCOPE
**Caught at:** VERIFY
**Merged:** 2026-09-15 - moved here from `.goat-flow/learning-loop/lessons/test-fixtures.md` when that bucket was split along the evaluator-fixture seam to recover its headroom.

**Prevention:** Before launching evaluator runs in parallel, list each run's registered write set. Give every run with a non-empty write set a dedicated `git worktree add --detach` checkout with its own fixture copies, keep hash-taking read-only runs away from writers, and record the checkout name in each trace so a changed hash is attributable before anyone calls it an anomaly. The shared conventions already require a named merge boundary for parallel tasks sharing files, `workflow/skills/reference/skill-conventions.md` (search: `Parallel tasks sharing files require a named merge boundary`); evaluator fixtures are files in that sense.

**What happened:** M31 launched the bare-path planning baseline, which hashes the fixture milestones and must write nothing, and the interrupted-task recovery baseline, which ticks a fixture task, in the same worktree. The bare-path evaluator saw its M02 hash change between its start and end commands, guessed that the strict plan check had written the file, and reported an unexplained anomaly. The change was the recovery run's registered tick. The candidate arms ran in separate checkouts and the bare-path hashes stayed identical.

**Root cause:** The host treated dependency independence between cases as write independence and scheduled by case rather than by write set.

---

## Lesson: Agent memory reaches every session in the checkout, so a blind evaluator or executor is not blind to it

**Status:** active | **Created:** 2026-09-19
**Decision changed:** Before saving anything to the agent's per-project memory, and before starting a session that must not know something, check whether that session loads the memory; keep predictions, expected answers and graded rules out of it.
**Trigger phase:** SCOPE
**Caught at:** VERIFY

**Prevention:** Before starting a session that must stay blind - an evaluator running a baseline, or an executor whose work is being predicted - list every channel it loads at start: instruction files, hooks, and the agent's per-project memory. Claude Code loads that memory into every session started in the checkout, and its index line alone names the file to open. Keep study-sensitive facts in plan-local files, name those files in the blind session's brief as not to be opened, and store only a pointer in memory. When the blind role can run without instruction files and hooks, start it with auto-memory skipped, as the refuter recipe does: `workflow/skills/goat-review/references/refuter-spec.md` (search: `auto-memory, and instruction-file auto-discovery skipped`). Otherwise start it from a checkout at another path; on 2026-09-19 this machine held separate memory directories for the fixture worktree paths earlier sessions had used.

**What happened:** On 2026-09-19 a diagnosing session froze forecast predictions for eleven not-started milestones as a shadow test and told the requester that the executing agent must not see them. For the convenience of later analysis sessions it then saved a memory entry that named the rules under test and the measured rates. The executor of the first milestone, a second Claude Code session in the same checkout, opened that memory file after its timer was finalized and reported the exposure in its closeout. Its own timing predated the read and the dated predictions stayed unseen, but it then knew the rules for the ten milestones still to run. The memory file was rewritten without rules or rates, its index line now steers executors away from the prediction files, and the requester was advised to continue in a fresh session.

**Root cause:** The agent treated its memory as a private notebook. It guarded the plan-local prediction files, then copied their sensitive part into the one place every session in the checkout reads.
