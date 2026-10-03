---
category: instruction-word-budgets
last_reviewed: 2026-10-01
---

**Scope:** Word and line budgets for instruction and reference edits; preserve contract wording while restoring headroom. General guidance remains in [contract-testing.md](contract-testing.md).

## Lesson: Reference-pack wording fixes must check word budget immediately

**Status:** active | **Created:** 2026-05-19
**Severity:** INTEGRATION

**Decision changed:** Run the canonical word-budget contract immediately after every skill or shared-reference wording edit.

**Trigger phase:** ACT
**Caught at:** VERIFY

**Incident count:** 33

**Latest occurrence:** 2026-09-20

**Prevention:** Run `node --import tsx --test test/contract/skill-hardening-contracts.test.ts` immediately after each edit, before aggregate suites; compact before expanding scope. Check bucket headroom first; several sit within tens of bytes of the 40,000-byte gate.

**What happened:** Repeated wording edits and learning captures crossed caps. Unless noted, the gate is `test/contract/skill-hardening-contracts.test.ts`:

- **2026-05-19/22:** TDD packs 3022/3008 words, preamble over 1500, QA over 2578 (search: `progressive reference packs stay within the 3000-word cap per file`).
- **2026-06-14:** Dispatcher 653/555 - `workflow/skills/goat/SKILL.md` (search: `Emit a Route Snapshot`).
- **2026-07-12 preflight verification:** `verification-preflight.md` hit 40KB - `scripts/preflight-checks.sh` (search: `Learning-Loop Schema`).
- **2026-07-12 boundary rollout:** Plan/QA 2503/2524 while a bad delimiter count said 1202 (search: `Counts user-facing skill guidance without YAML frontmatter`).
- **2026-07-12 goat-plan handoff work:** Plan 2533 - `workflow/skills/goat-plan/SKILL.md` (search: `Handoff-grade artifacts`).
- **2026-07-13 shared-reference compaction:** Shared references 1560/1601, compacted to 1484/1490 (search: `always-loaded shared references stay within the 1500-word cap`).
- **2026-07-16 PR #56:** Goat/plan/preamble/TDD 597/2689/1540/3021; compaction also repaired stale assertions (search: `requires pre-write redaction for durable local text`).
- **2026-07-17–19, 2026-08-01 review hardening, 2026-08-02 PR #57:** QA, plan, review, preamble, and dispatcher edits repeatedly reached 2506–2762 / 1514 / 579 words; focused contracts restored every surface before mirror sync (search: `functional skills stay within the 2500-word cap across all mirrors`).
- **2026-08-01 learning capture:** A new lesson pushed this bucket to 40KB; narrower routing and recurrence consolidation restored it - `src/cli/stats/stats.ts` (search: `rule: "bucket-size"`).
- **2026-08-02 PR #57 CI:** `verification-preflight.md` reached 40,415 bytes and failed the merge build - the round-trip installer fixture runs preflight inside a temp install. Local `stats --check` had flagged it for days as an accepted baseline. Buckets gate the build.
- **2026-08-03 v1.15 ship hardening:** Unifying goat-critique's meta-audit rubric left every mirrored SKILL.md at exactly 2,500 words, so the focused contract failed until the new pointer was compacted. Evidence anchor: `test/contract/skill-hardening-skills-2.test.ts` (search: `uses one reproducible goat-critique meta-audit rubric`).
- **2026-08-03 goat-review base clause:** A one-clause scope fix added 23 words to a skill sitting at 2,498/2,500 and simultaneously reworded away a contract-pinned literal, so two contracts failed at once (search: `stops oversized inferred branch scopes before review begins`). Wording edits have two budgets, not one: the word cap AND the exact phrases contracts assert. Measure headroom and grep `test/` for the phrases being reworded BEFORE editing; when headroom is one word, attach the change to an unpinned line and pay for it with a same-line trim.
- **2026-08-04 goat-review mutation vocabulary:** Synchronizing the five shared mutation verbs pushed the root skill to 2,506 words. The first compaction then removed the exact Spec Drift phrase pinned at `test/contract/skill-hardening-review-3.test.ts` (search: `keeps an unselected optional Spec Drift pass out of review degradation`). Restoring the pinned phrase and compacting unpinned optional-output prose returned the focused run to 3/3 pass.
- **2026-08-06 human-facing prose scope extension:** Adding a learning-loop Scope Gate row plus a Why paragraph pushed `writing-human-facing-prose.md` to 3,026 words; the fix trimmed the just-added paragraph, never pre-existing load-bearing text (search: `progressive reference packs stay within the 3000-word cap per file`). A same-day review-pass register edit then broke the pinned literal `Reports and reviews` because the pin grep ran before Stage A but not before the follow-up edit (search: `keeps human-facing prose edits truth-preserving and source-aware`); restoring the literal and attaching the addition as an unpinned clause returned both focused contracts to green.
- **2026-08-09 v1.15.1 goat-plan:** Correcting the ISSUE write target raised the 2,100-word redesign surface to 2,103. Trimming three words from an unpinned fresh-plan sentence returned it to exactly 2,100 without changing the artifact rule. Evidence: historical owner `test/contract/skill-hardening-plan-2.test.ts`; current body-cap owner `test/contract/skill-hardening-contracts.test.ts` (search: `functional skills stay within the 2500-word cap across all mirrors`).
- **2026-08-17 goat-review integrity guidance:** Resolved-only integrity guidance raised the skill to 2,560 words. Compressing only the new guidance restored the cap but removed three pinned semantics: diff-path disclosure, verdict grammar, and explicit gate-evidence classification. The word-budget contract, all goat-review shards, and the shared-surface shard had to pass together. Evidence: `test/contract/skill-hardening-contracts.test.ts` (search: `functional skills stay within the 2500-word cap across all mirrors`), `test/contract/skill-hardening-review-1.test.ts` (search: `keeps area audits independent of diff-only metadata and verdicts`), and `test/contract/skill-hardening-shared-1.test.ts` (search: `classifies gate evidence without inventing changed-code causality`).
- **2026-08-24 goat-plan checker-pointer rewrite:** The first checker-pointer rewrite added three words to the near-full canonical surface. Measuring the combined reference
  pack immediately led to a tighter sentence that removed the duplicated identifier list and freed seven words without weakening the contract.
  Evidence anchor: `test/contract/skill-hardening-plan-2.test.ts` (search: `enforces current-heading length and internal identifiers`).

**Recurrence 2026-08-29:** Adding the accepted two-tier sub-agent budget to both shared convention copies raised each body from 1496 to 1539 words. The focused budget contract ran only after the aggregate fast suite, delaying attribution. The first trim then changed five redaction phrases pinned by the shared-surface contract. Applying the agent-facing writing playbook's one-owner and pruning rules around those fixed phrases removed duplicate continuity prose and restored both mirrors to 1481 words. Evidence: `test/contract/skill-hardening-contracts.test.ts` (search: `always-loaded shared references stay within the 1500-word cap`), `test/contract/skill-hardening-shared-3.test.ts` (search: `requires pre-write redaction for durable local text`), and `workflow/skills/reference/skill-preamble.md` (search: `session, handoff, critique, review, quality, security, or export text`), which owned that artifact wording from 2026-09-07 when M29 consolidated it out of `skill-conventions.md` so Quick depth could reach it.

**Recurrence 2026-09-01:** Inserting a retrieval-cap clause into the shared READ bullet raised that line to 861-863 characters across the seven parity-checked files, and `scripts/check-instruction-parity.mjs` (search: `MAX_INSTRUCTION_LINE_CHARACTERS`) failed on its 800-character line limit - a cap no instruction file or setup template states. Contract and link checks had already passed, so parity was the only gate that saw it. Rewriting the clause to 93 characters with the same meaning restored parity at 794. Instruction files carry a third budget beyond word caps and pinned phrases: characters per line. Measure the target line before inserting, and run the parity script first when a shared section changes.

**Recurrence 2026-09-05:** The lane-aware planning edit first checked only its three new cases and skill-body cap. The complete plan/parity run then reported `# pass 61`, `# fail 7`: six existing phrase pins and a 6,080/5,650 combined surface. The wider skill suite also caught conventions at 1,690 words against the exclusive 1,500 cap. Restoring pinned guidance and routing duplicate rules to their owners yielded 2,139 body words, 5,649 combined words, 1,497 conventions words, and `# pass 249`, `# fail 0`. Measure every affected owner together before mirror writes. Evidence: historical owner `test/contract/skill-hardening-plan-2.test.ts`; current per-file owner `test/contract/skill-hardening-contracts.test.ts` (search: `progressive reference packs stay within the 3000-word cap per file`), `test/contract/skill-hardening-contracts.test.ts` (search: `always-loaded shared references stay within the 1500-word cap`), and `test/contract/skill-hardening-shared-1.test.ts` (search: `carries explicit build intent through planning into ordinary ACT`).

**Recurrence 2026-09-20:** One new sentence in goat-plan's milestone reference, permitting a single likely floor, raised the file from 2,966 to 3,002 words. The plan had named the fast suite as the proof route, so the budget contract first ran there, after the three installed copies were written, and they had to be copied again. Trimming the new sentence left 2,986. The INDEX search before the work never used the word budget, although the milestone named reference budgets as a risk. `test/contract/skill-hardening-contracts.test.ts` (search: `progressive reference packs stay within the 3000-word cap per file`).

**Root cause:** Treated capped prose as tiny.

---

