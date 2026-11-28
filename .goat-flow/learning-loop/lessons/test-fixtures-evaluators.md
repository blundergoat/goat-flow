---
category: test-fixtures-evaluators
last_reviewed: 2026-11-28
---

**Scope:** Fixtures for skill-evaluation trials - pressure scenarios that isolate one rule, evaluator prompts and restrictions, worktree scheduling for parallel evaluator runs, and what a blind evaluator or executor session loads at start. Test-suite fixtures are [test-fixtures.md](test-fixtures.md); scoring what a trial produced is [skill-trial-evidence.md](skill-trial-evidence.md).

## Lesson: Pressure scenarios must isolate the rule under test

**Status:** active | **Created:** 2026-07-12
**Severity:** CORRECTNESS
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

**What happened:** The change launched the bare-path planning baseline, which hashes the fixture milestones and must write nothing, and the interrupted-task recovery baseline, which ticks a fixture task, in the same worktree. The bare-path evaluator saw its hash change between its start and end commands, guessed that the strict plan check had written the file, and reported an unexplained anomaly. The change was the recovery run's registered tick. The candidate arms ran in separate checkouts and the bare-path hashes stayed identical.

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

## Lesson: Nested Node fixtures inherit the parent test context

**Status:** active | **Created:** 2026-11-28 | **Evidence:** OBSERVED
**Decision changed:** Give a fixture child its own Node test context when its stdout is evidence.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Clear the child's inherited `NODE_TEST_CONTEXT` and request TAP before matching assertion output.

**What happened:** The required-QA eval's focused test received binary runner messages from the nested fixture, including its assertion failure. The TAP matcher rejected the output. A fresh test context produced TAP with the same failure and exit code. Evidence: `test/unit/evals-cases.test.ts` (search: `fixtureEnv`).

## Lesson: Eval collection must bind the observed evidence to its source

**Status:** active | **Created:** 2026-11-28 | **Evidence:** OBSERVED
**Decision changed:** Match complete owner reads and snapshot records before attributing a compound command failure to them.
**Incident count:** 4
**Latest occurrence:** 2026-11-28
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Match each prepared owner path as a command argument, use the recorded working directory for relative paths, and check the full owner bytes. For staged reviews, bind the complete snapshot to the prepared index blob and fingerprint. Preserve the `owner paths` diagnostic when changing the owner allowlist.

**What happened:** One review sample emitted the staged snapshot before a later command failed against an unborn HEAD. Two clarity samples fully read their owners from the sample or owner directory, which the collector rejected. A fresh sample read the exact absolute owner paths from the harness root and exposed the same assumption. The clarity fixture also needed the matching source redactor to exercise an edit. The focused validator test caught an owner-diagnostic change. Evidence: `evals/lib/transcript.mjs` (search: `recordedPreparedOwnerRead`) and `test/unit/evals-reference-boundaries.test.ts` (search: `only the prepared stage`).

**Recurrence 2026-11-28:** A transcript command reading a backup with identical bytes satisfied the owner check because its filename began with the prepared path. The focused test now rejects that command and checks a quoted relative read. Evidence: `test/unit/evals-reference-boundaries.test.ts` (search: `binds prepared owner bytes`).

**Recurrence 2026-11-28 (PR #71):** The review found that the scorer accepted a staged source fragment even though the prepared snapshot identified a particular Git blob. The command could show different bytes with the same expression. Verify the blob ID from the full observed output and use the command-specific status for compound shell runs. Evidence: `test/unit/evals-reference-boundaries.test.ts` (search: `only the prepared stage`) and `test/unit/evals-cases.test.ts` (search: `npm test; exit 1`).

**Recurrence 2026-11-28 (PR #71 recheck):** The Codex collector counted a command between the final answer and task completion. The milestone scorer also missed an indented invocation. Bound evidence by the earlier delivery event and exercise command parsing with ordinary shell whitespace. Evidence: `test/unit/evals-kit.test.ts` (search: `lateCommand`) and `test/unit/evals-workflow-gates.test.ts` (search: `a correct planning answer fails if a timer start targeted blocked M02`).

## Lesson: A pinned policy fixture needs tree metadata for review snapshots

**Status:** active | **Created:** 2026-11-28 | **Evidence:** OBSERVED
**Decision changed:** Verify the policy fixture with the version-matched snapshot reader before launching samples.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Copy the pinned commit, its tree metadata, and the selected policy blob. Keep unrelated file contents outside the fixture. Verify the selected path in the snapshot. Tell samples which comparison source applies when fixture HEAD is unborn, and bound their inventory to the assessed path.

**What happened:** The policy-only fixture resolved `git show` with just the policy's ancestor trees. The snapshot reader enumerated the full tree and exited 2 on missing sibling metadata. Adding the directory objects let the snapshot resolve the selected policy. The first Codex run still missed the trusted read twice when broader metadata inspection hit tool limits. The scoped rerun emitted one complete policy as JSON and one clearance decision with a dash. Match the selector and exact decoded bytes, and read the explicit clearance decision. Evidence: `evals/fixtures/policy-authority/build.mjs` (search: `buildPolicyAuthority`), `evals/run.mjs` (search: `HEAD is unborn`), and `test/unit/evals-policy-authority.test.ts` (search: `recorded as JSON`).

Preflight also found an export used only by the temporary qualification command. Keep the fixture's `policyExceptionId` private unless a checked-in consumer imports it.

## Lesson: Clear inherited Git overrides before preparing eval fixtures

**Status:** active | **Created:** 2026-11-28 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Bind runner Git commands and snapshot preparation to the explicitly selected repository.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Clear inherited `GIT_*` variables when the eval runner selects a repository via its working directory or `--project`. Verify that each prepared fixture has its own index.

**What happened:** `prep --case critique-handback` returned success with `GIT_INDEX_FILE` set and wrote the inherited index outside its fixtures. After the fix, all six samples prepared for `critique-handback` and `review-staged-authority` used fixture indexes under the same environment override. Evidence: `evals/run.mjs` (search: `const gitEnv`).
