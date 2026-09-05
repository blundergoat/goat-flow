---
category: skill-guidance
last_reviewed: 2026-09-05
---

**Scope:** Editing shipped skill and playbook guidance: behavioural wording, authority alignment, contract caps, and load-budget signals. Skill candidacy and runtime authoring traps live in [skill-authoring.md](skill-authoring.md); mirror sync lives in [skills.md](skills.md).

## Footgun: Linter or security-scanner output can pressure rewrites of load-bearing skill language

**Status:** active | **Created:** 2026-05-26 | **Evidence:** OBSERVED
**Decision changed:** Treat forceful wording as a behavioural-control candidate, not an untouchable string: preserve or replace it according to behavioural evidence, then update every durable anchor.
**Trigger phase:** READ | **Caught at:** VERIFY | **Incident count:** 2 | **Latest occurrence:** 2026-08-29

**Prevention:** Before rewriting a tool-flagged phrase, name the behaviour it controls and the evidence that the control is useful, then require before/after behavioural evidence proportionate to the risk. Evidence that a phrase seeds bias justifies replacing it; evidence that a softer replacement loses the control justifies retaining or redesigning it. Structural skill scores are shape evidence only, and every contract and learning-loop anchor changes with the chosen wording.

**Symptoms:** An automated tool flags forceful framing inside a canonical skill, and a rewrite either softens the phrase to satisfy the tool or freezes it because an older record called it load-bearing. Structural checks pass either way while the behavioural control weakens or becomes biased.

**Why it happens:** Forceful framing can shift agent behaviour under pressure, but exact phrasing carries no machine-readable marker separating useful control from conclusion-seeding rhetoric, and goat-flow's scorer measures shape, not behaviour.

**Evidence:** `.goat-flow/skill-docs/skill-quality-testing/adversarial-framing.md` (search: "skeptical, neutral reviewer") records the corrected control: role framing is a mechanism, but it directs falsification without seeding a finding quota, and the former "cynical reviewer with zero patience" wording was retired because it biased the result. `src/cli/quality/skill-quality-score.ts` (search: `scoreContent`, `scoreAllArtifacts`) composes text and runs rubric metrics without executing the skill, so a shape-preserving rewrite passes scoring. `.claude/skills/goat-plan/SKILL.md` (search: `Excuse`, `Reality`) is the persuasion surface most likely to attract a "could be softened" suggestion. External corroboration: obra/superpowers PR #1608 ("fix(skill): remove prompt-injection marker") was closed with "the framing the scanner flagged is intentional". **Recurrence 2026-08-29:** the quality pack correctly replaced a conclusion-seeding reviewer role, but this entry still cited the retired sentence as protected mechanism until `stats --check` found the stale anchor.

---

## Footgun: Playbook content edits collide with the ADR-023 word cap and exact-phrase contract assertions

**Status:** active | **Created:** 2026-08-10 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Measure the body budget and inventory phrase-pinning contracts, vocabulary consumers, and reconciliation owners before adding or compressing shipped skill guidance.
**Trigger phase:** READ
**Caught at:** ACT
**Incident count:** 8 | **Latest occurrence:** 2026-08-24

**Prevention:** Before editing a playbook or skill, measure its body word count, read its actual cap from `test/contract/skill-hardening-contracts.test.ts` rather than assuming the ADR-023 tier, and grep the contract tests for its filename to list the pinned phrases:

```bash
node -e 'const t=require("fs").readFileSync(process.argv[1],"utf8").replace(/^---\n[\s\S]*?\n---\n?/,"");console.log(t.split(/\s+/).filter(Boolean).length)' .goat-flow/skill-docs/playbooks/<name>.md
rg -n "<name>|<distinctive heading or phrase>" test/contract/skill-hardening-*.test.ts
```

For a closed vocabulary or reconciliation equation, also grep every label and total across skills, references, receipts, docs, and release prose, and contract which equation applies to each selector or change state; independent literal-presence checks can preserve two contradictory owners. Restore pinned phrases verbatim after any compression, take compensating words from prose no assertion covers, run the relevant skill-hardening contracts before preflight, and mirror the result to every installed copy in the same turn.

**Symptoms:** A playbook edit clears local checks, then preflight rejects its body budget, or a compensating compression breaks exact-phrase contracts.

**Why it happens:** Binding per-file caps leave little headroom while regex assertions pin literal phrasing, and neither constraint is visible in the Markdown editor. The routed caps are often far below the ADR tier: `code-comments.md` is capped at 2880 with 84 `assert.match` pins, and the writing playbooks at 1700-2000 and 900-1150 words.

**Evidence:** 2026-08-10, `writing-human-facing-prose.md`: eight approved additions took the body from 2998 to 3672 words, `test/contract/skill-hardening-contracts.test.ts` (search: `ADR-023 word budget tiers`) reported `3672 words meets or exceeds progressive cap 3000`, and compressing back to 2997 broke eight assertions in `test/contract/skill-hardening-shared-2.test.ts` (search: `keeps human-facing prose edits truth-preserving and source-aware`), among them `claim strength and specificity to the evidence` and a capitalisation-only change from `status,` to `Status,`.

**Incident ledger:**
- **Recurrence 2026-08-16:** goat-review rose from 2499 to 2593 body words; the first compression restored 2499 but changed pinned phrases and failed 14 contracts, the next focused set omitted two shared-surface contracts, and only an inventory of every direct reader produced a 2499-word body with all 181 skill-hardening contracts passing. Anchors: `test/contract/skill-hardening-contracts.test.ts` (search: `functional skills stay within the 2500-word cap`), `test/contract/skill-hardening-review-1.test.ts` (search: `forbids goat-review setup mutation and branch checkout`), `test/contract/skill-hardening-review-2.test.ts` (search: `calibrates goat-review severity from evidence before labels`) and (search: `documents validator-ready anchors, REFUTED-only ledgers, and resumable chunks`), `test/contract/skill-hardening-shared-1.test.ts` (search: `defines two evidence-producing area audit passes`), `test/contract/skill-hardening-shared-2.test.ts` (search: `keeps direction audits advisory, grounded, and separate from defect verdicts`).
- **Recurrence 2026-08-17:** the ADR-023 3000-word cap was not binding; `test/contract/skill-hardening-contracts.test.ts` (search: `M02 playbooks stay within their rollout budgets`) capped `.goat-flow/skill-docs/playbooks/code-comments.md` at 2880 and `.goat-flow/skill-docs/playbooks/writing-sentence-diagnostics.md` at 900-1100, so six and two words of real headroom read as 126 and 1902.
- **Recurrence 2026-08-17 (clarity gate):** two older assertions still pinned phrases an approved rewrite removed; the aggregate gate failed on `zero eligible source files` and the comma-sensitive `binary or generated` until only the superseded phrase was removed. Anchors: `workflow/skills/goat-clarity/SKILL.md` (search: `when no selected unit is source code`) and `test/contract/skill-hardening-clarity.test.ts` (search: `fails closed on unsupported path state`).
- **Recurrence 2026-08-17 (clarity budget):** goat-clarity rose from 2,457 to 2,641 words and the full gate rejected it before the slow suite; compressing duplicated test-selection explanation back into its owner left 2,491 across all mirrors: `workflow/skills/goat-clarity/SKILL.md` (search: `Added-test dispositions`).
- **Recurrence 2026-08-17 (closed vocabulary):** goat-clarity's added/removed-test vocabulary reached the skill while the batch checkpoint, docs, changelog, and receipt still enumerated only existing-test outcomes, and the focused suite pinned the stale equation independently; adding consumer contracts moved the skill to the rejecting 2,500 boundary and a semantics-preserving trim left 2,490. Anchors: `workflow/skills/goat-clarity/references/target-scope-and-evidence.md` (search: `batch_expected = assessed_added`) and `test/contract/skill-hardening-clarity.test.ts` (search: `batch_expected = assessed_added`).
- **Recurrence 2026-08-18:** planning against 3000 claimed roughly 1000 and 2100 words of room, while the routed budgets measured `.goat-flow/skill-docs/playbooks/writing-human-facing-prose.md` at 1992 within 1700-2000 and `.goat-flow/skill-docs/playbooks/writing-sentence-diagnostics.md` at 1136 within 900-1150, leaving 8 and 14 words: `test/contract/skill-hardening-contracts.test.ts` (search: `M51 writing playbooks stay within their routed context budgets`).
- **Recurrence 2026-08-24:** a 99-rule inventory trimmed duplicates from `workflow/skills/playbooks/writing-human-facing-prose.md` (1996 to 1978) and `workflow/skills/playbooks/writing-sentence-diagnostics.md` (1128 to 1114) with rules, caps, contracts, and mirrors unchanged; this entry's own record then reached 41,271 bytes and tripped `stale-ref` on three shorthand paths until compacted with full paths, per `src/cli/stats/stats.ts` (search: `BUCKET_SIZE_WARN_BYTES`).

## Footgun: Adjective-shaped style rules in shipped guidance do not constrain another agent's output

**Status:** active | **Created:** 2026-08-16 | **Evidence:** ACTUAL_MEASURED

**Prevention:** Write agent-facing style rules as things a reader can check without judgement, a number, a banned list, or a required subject, and reserve adjectives for the surrounding explanation. Ship at least two worked examples from different surfaces so neither reads as domain-specific. A contract assertion on guidance text proves delivery only; the proof that a rule binds is a run by an agent that did not write it. This is the inverse of "Linter or security-scanner output can pressure rewrites of load-bearing skill language" above: there a mechanical check overrode meaning, here meaning shipped with no mechanical check.

**Symptoms:** A skill states a quality bar in adjectives ("plain", "concrete", "jargon-free", "one line"), the contract suite proves the guidance ships to every mirror, and a consuming agent still produces exactly the prose the bar was written to prevent.

**Why it happens:** An adjective is self-assessed, so an agent that writes a 33-word paragraph naming three internal identifiers can believe it wrote a concrete, jargon-free line. A single BAD/GOOD example reads as a special case for whatever surface it came from.

**Evidence:** 2026-08-16, goat-plan's `What we lose without this` and `Why this helps` sections shipped with the adjective rule plus one security-flavoured example pair. An external coding agent converting a 14-milestone plan train produced sections averaging 33 words against a one-line bar, with 11 of 14 benefit lines describing what ships rather than what a person gets and internal labels surviving "jargon-free", while the same author had written 10-18 word lines by hand for two other trains. Checkable rules replaced the adjectives, and the length and identifier list then moved into strict validation: `workflow/skills/goat-plan/references/milestone-examples.md` (search: `enforces current-heading length and internal identifiers`).

## Footgun: A skill permission exception can outrun its accepted ADR authority

**Status:** active | **Created:** 2026-08-20 | **Evidence:** OBSERVED

**Prevention:** Treat any new skill permission or write-mode exception as an authority change. Before editing the skill, identify the accepted ADR that owns its boundary, update or supersede that decision in the same approved change, and add one contract that reads both surfaces; mirror parity is necessary but is not policy proof.

**Symptoms:** A shipped skill grants a narrow mutation exception while the ADR that defines its boundary still forbids the whole class of change, so agents receive contradictory authority depending on which source they consult while phrase-presence tests pass.

**Why it happens:** Consumer-installed skills must be self-contained while framework ADRs stay internal, so a skill edit can add operational detail without forcing review of the decision that owns its authority.

**Evidence:** On 2026-08-20 `workflow/skills/goat-clarity/SKILL.md` Scope v2 allowed one public/exported rename while ADR-009 still routed public refactoring outside goat-clarity, and a Codex quality review found the contradiction. The skill (search: `enumerated set of public or exported identifier renames`) and `.goat-flow/learning-loop/decisions/ADR-009-skill-consolidation.md` (search: `enumerated set of public or exported identifier spelling changes`) now align, pinned by `test/contract/skill-hardening-clarity.test.ts` (search: `keeps the accepted clarity authority aligned`).

---

## Footgun: goat-plan surface additions collide with near-full word-budget contract caps

**Status:** active | **Created:** 2026-08-15 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Measure both caps and enumerate every phrase pin before drafting; preserve existing pins and compact only new wording unless the human approves a cap or semantic change.
**Trigger phase:** SCOPE
**Caught at:** VERIFY
**Incident count:** 5 | **Latest occurrence:** 2026-08-29

**Prevention:** Before editing goat-plan, measure both caps and grep every contract that reads the target path, including older plan-contract pins. Preserve pinned semantics and compact only new wording, or ask the human to choose a cap or semantic change. Sync all four mirrors and rerun the fast contracts; after a cap change, grep ignored plans and docs for the old number and assertion text.

**Symptoms:** A small approved addition to goat-plan's SKILL.md or reference files passes every phrase-pinning assertion and the mirror byte-identical check, then fails `keeps the redesigned goat-plan canonical surface within its tighter budget`.

**Why it happens:** Two caps bound the canonical surface, the SKILL.md body alone and SKILL.md plus `references/milestone-examples.md` plus `references/issue-format.md` combined, and the redesign left both within a few words of their caps (2099/2100 and 4499/4500 before 2026-08-15). Same class as the ADR-023 playbook cap above, on a different surface with different caps in a different test file: `test/contract/skill-hardening-plan-2.test.ts` (search: `redesign target of 2150 words`) holds the body cap and (search: `canonical goat-plan surface has`) the combined cap, while `test/contract/skill-hardening.helpers.ts` (search: `countSkillBodyWords`) excludes frontmatter.

**Incident ledger:**
- **2026-08-15:** adding two template sections plus one SKILL.md sentence (97 words) tipped both caps to 2117/2100 and 4596/4500; the user approved raising them to 2150/4650.
- **Recurrence 2026-08-16:** renaming those sections and adding derivation rules overflowed the combined cap; the obvious trim was pinned by `keeps goat-plan handoff artifacts drift-aware without burdening small plans`, so the cap rose to 4700 (4671 used).
- **Recurrence 2026-08-18:** a 27-token rewrite of the Shared Conventions line failed the combined cap at 4717/4700 with 3 words of headroom; compacting to a 7-token line (`Modes R/1/3/4 also read`) resolved it.
- **Recurrence 2026-08-19:** the combined cap rose 4700 to 5450 for the ISSUE.md plain-language redesign (5373 used) and again to 5650 for the cut-words-never-facts rules (5564 used), both with user approval; the body cap stayed 2150 (2128 used).
- **Recurrence 2026-08-28:** a cap audit measured every configured limit but missed older plan-contract pins, so mid-proof failed its amendment and dependency-transition contracts at 2151/2150; restoring the pins and compacting only the new rule gave 2144/2150 and `# pass 51`, `# fail 0`: `test/contract/skill-hardening-plan-1.test.ts` (search: `keeps goat-plan amendments behind the milestone approval gate`).
- **Recurrence 2026-08-29:** a mode-order edit hit 2154/2150 and its first trim broke a pinned path-only phrase; the final row ended at 2145/2150 with 24/24: `test/contract/skill-hardening-plan-1.test.ts` (search: `makes explicit no-write signals outrank named-file mutation verbs`).

---

## Footgun: Dense functional skills satisfy the ADR-023 word cap yet lose skill-quality token points

**Status:** active | **Created:** 2026-08-16 | **Evidence:** ACTUAL_MEASURED

**Prevention:** Before promising a token-tier change, measure `content.length` of the exact SKILL.md, subtract the sections to move, add the pointer text left behind, and confirm `references/` stays at five files. Prefer moving content the skill loads only in a specific mode; a move into an always-loaded reference changes the metric without changing what the agent reads. When editing goat-review, re-measure: 28 chars of headroom means one added sentence drops it to 7/10.

**Symptoms:** A functional skill sits under the 2,500-word cap and passes every contract, yet the dashboard's deterministic skill-quality score shows Token / Load Cost 7/10 (`~5127 tokens` and `~5750 tokens`), and relocating whole sections recovers less than their size suggests.

**Why it happens:** The two budgets use different units. ADR-023 counts body words in `test/contract/skill-hardening.helpers.ts` (search: "countSkillBodyWords"); the rubric estimates tokens as `Math.ceil(content.length / 4)` over the raw SKILL.md including frontmatter and steps from 10/10 to 7/10 above 5,000 tokens in `src/cli/quality/skill-quality-metrics.ts` (search: `tokens > 5000`). At about 8 chars per word they agree, but goat-security's pipe-delimited compound tokens run about 10 chars per word, so 2,072 body words is 20,604 chars and 5,151 tokens, while goat-review at 2,413 words is 19,972 chars and 4,993 tokens with 28 chars of headroom. Relocation pays pointer overhead and cannot add a sixth `references/` file without a separate 3-point deduction in the same metrics file (search: `subRefs > 5`).

**Evidence:** 2026-08-16: moving goat-security's Step 0 exception-validity tuple (1,328 chars) and Compliance Mode body (1,546 chars) into `references/project-policy-template.md` netted 2,395 chars after pointers, leaving 20,604 chars and the same 7/10, with no remaining literal duplication. The user chose to keep that 96% as a true density signal rather than move Full-only phases into `common-threats.md`, which loads on every run anyway.
