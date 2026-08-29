---
category: skill-guidance
last_reviewed: 2026-08-29
---

**Scope:** Editing shipped skill and playbook guidance - behavioural wording, authority alignment, contract caps, and load-budget signals. Skill candidacy and runtime authoring traps live in [skill-authoring.md](skill-authoring.md); mirror sync lives in [skills.md](skills.md).

## Footgun: Linter or security-scanner output can pressure rewrites of load-bearing skill language

**Status:** active | **Created:** 2026-05-26 | **Evidence:** OBSERVED
**Decision changed:** Treat forceful wording as a behavioural-control candidate, not an untouchable string: preserve or replace it according to behavioural evidence, then update every durable anchor.
**Trigger phase:** READ | **Caught at:** VERIFY | **Incident count:** 2 | **Latest occurrence:** 2026-08-29

**Prevention:**
1. Before rewriting a tool-flagged phrase, name the behaviour it controls and the evidence that the control is useful.
2. Require before/after behavioural evidence proportionate to the risk. Evidence that a phrase seeds bias is a valid reason to replace it; evidence that a softer replacement loses the control is a reason to retain or redesign it.
3. Treat structural skill scores as shape evidence only. Update contract and learning-loop anchors whenever the chosen wording changes.

**Symptoms:** An automated tool flags forceful framing inside a canonical skill. A rewrite then either softens the phrase merely to satisfy the tool or freezes the exact sentence merely because an older record called it load-bearing. Structural checks can pass in both cases while the actual behavioural control weakens or becomes biased.

**Why it happens:** Forceful framing can shift agent behaviour under pressure, but exact phrasing has no machine-readable marker that distinguishes useful control from conclusion-seeding rhetoric. goat-flow's structural scorer measures shape, not behaviour, so neither preservation nor replacement is justified by a structural pass alone.

**Evidence:**
- `.goat-flow/skill-docs/skill-quality-testing/adversarial-framing.md` (search: "skeptical, neutral reviewer") records the corrected control: role framing is a behavioural mechanism, but it must direct falsification without seeding a finding quota or conclusion. The former "cynical reviewer with zero patience" wording was retired because it biased the result rather than testing it.
- `src/cli/quality/skill-quality-score.ts` (search: `scoreContent`, `scoreAllArtifacts`) — the scorer composes text and runs rubric metrics; it does not execute the skill against agent prompts, so a "compliance" rewrite that preserves shape can pass scoring.
- `.claude/skills/goat-plan/SKILL.md` (search: `Excuse`, `Reality`) — the Excuse | Reality table is the persuasion surface most likely to attract a "this is unprofessional / aggressive / could be softened" rewrite suggestion.
- External corroboration: obra/superpowers PR #1608 ("fix(skill): remove prompt-injection marker") was closed as slop. The maintainer's comment: "the framing the scanner flagged is intentional — it's the mechanism that makes Superpowers actually shape agent behavior." Same shape of trap applies here.

**Recurrence 2026-08-29:** The quality pack correctly replaced a conclusion-seeding reviewer role with a neutral-skeptical one, but this footgun still cited the retired sentence as protected mechanism. `stats --check` found the stale anchor. The correction preserves the behavioural-control rule without treating one biased phrase as immutable evidence.

---

## Footgun: Playbook content edits collide with the ADR-023 word cap and exact-phrase contract assertions

**Status:** active | **Created:** 2026-08-10 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Measure the body budget and inventory phrase-pinning contracts, vocabulary consumers, and reconciliation owners before adding or compressing shipped skill guidance.
**Trigger phase:** READ
**Caught at:** ACT
**Incident count:** 8 | **Latest occurrence:** 2026-08-24

**Symptoms:** A playbook edit clears local checks, then preflight rejects its body budget or a compensating compression breaks exact-phrase contracts.

**Why it happens:** Binding per-file caps leave little headroom while regex assertions pin literal phrasing; neither constraint is visible in the Markdown editor.

**Evidence:** 2026-08-10, `writing-human-facing-prose.md`. Eight approved additions took the body from 2998 to 3672 words; `test/contract/skill-hardening-contracts.test.ts` (search: `ADR-023 word budget tiers`) reported `3672 words meets or exceeds progressive cap 3000`. Compressing back to 2997 broke eight assertions in `test/contract/skill-hardening-shared-2.test.ts` (search: `keeps human-facing prose edits truth-preserving and source-aware`), among them `claim strength and specificity to the evidence`, `Reference-list labels remain valid`, `Illustrative before`, and a capitalisation-only change from `status,` to `Status,` at the head of a Verification Gate item.

**Recurrence 2026-08-16:** Adding validator-anchor, refutation-ledger, and resumable-chunk guidance raised `workflow/skills/goat-review/SKILL.md` from 2499 to 2593 body words. The first compression returned it to 2499 but changed pinned phrases and failed 14 focused skill contracts. The next focused set passed 45/45 but omitted two shared-surface contracts, which the full suite caught. An all-file skill-hardening run then caught a case-sensitive prefix mismatch and a contract regressed while reclaiming words. Inventorying every direct reader before the final correction produced a 2499-word body with all 181 skill-hardening contracts passing. Evidence anchors: `test/contract/skill-hardening-contracts.test.ts` (search: `functional skills stay within the 2500-word cap`), `test/contract/skill-hardening-review-1.test.ts` (search: `forbids goat-review setup mutation and branch checkout`), `test/contract/skill-hardening-review-2.test.ts` (search: `calibrates goat-review severity from evidence before labels`), `test/contract/skill-hardening-review-2.test.ts` (search: `documents validator-ready anchors, REFUTED-only ledgers, and resumable chunks`), `test/contract/skill-hardening-shared-1.test.ts` (search: `defines two evidence-producing area audit passes`), and `test/contract/skill-hardening-shared-2.test.ts` (search: `keeps direction audits advisory, grounded, and separate from defect verdicts`).

**Recurrence 2026-08-17:** ADR-023's 3000-word cap was not binding: `test/contract/skill-hardening-contracts.test.ts` (search: `M02 playbooks stay within their rollout budgets`) capped `.goat-flow/skill-docs/playbooks/code-comments.md` at 2880, while the writing-diagnostics case in the same test capped `.goat-flow/skill-docs/playbooks/writing-sentence-diagnostics.md` at 900-1100. Six and two words of real headroom appeared as 126 and 1902 against the ADR; two additions failed. The comments playbook also had 84 `assert.match` pins, so compression there requires its own scope.

**Recurrence 2026-08-17 (mode-aware clarity gate):** A focused new contract proved both replacement empty-selection branches, but two older assertions in the same clarity contract still pinned phrases removed by the approved rewrite. The aggregate skill gate failed first on `zero eligible source files`, then on the comma-sensitive `binary or generated`. Re-reading the complete assertion block against the source diff preserved the binary/generated fail-closed invariant while removing only the superseded mode-agnostic phrase. Evidence anchors: `workflow/skills/goat-clarity/SKILL.md` (search: `when no selected unit is source code`; the 2026-08-19 write-authority rewrite replaced the mode-aware sentence with this clause) and `test/contract/skill-hardening-clarity.test.ts` (search: `fails closed on unsupported path state`).

**Recurrence 2026-08-17 (goat-clarity budget):** The new test dispositions and mode-aware empty-selection guidance passed focused contracts but raised goat-clarity from 2,457 to 2,641 body words. The full ADR-023 gate rejected it before the slow suite. Compressing duplicated test-selection explanation back into its owner left the explicit dispositions, equations, and report-only guard in the skill at 2,491 words across all mirrors. Evidence anchors: `workflow/skills/goat-clarity/SKILL.md` (search: `Added-test dispositions`) and `test/contract/skill-hardening-contracts.test.ts` (search: `functional skills stay within the 2500-word cap`).

**Recurrence 2026-08-17 (closed-vocabulary consumers):** An external review found that goat-clarity's added/removed-test vocabulary and equations had reached the skill and playbook while the batch checkpoint, public docs, changelog, and receipt still enumerated only existing-test outcomes. The focused suite was green because it pinned the checkpoint's stale five-label equation independently instead of relating selector mode to its applicable equation. Adding those missing consumer contracts briefly moved the 2,491-word skill to the rejecting 2,500 boundary; a semantics-preserving trim left 2,490 words and all 88 aggregate skill contracts green. Evidence anchors: `workflow/skills/goat-clarity/references/target-scope-and-evidence.md` (search: `batch_expected = assessed_added`) and `test/contract/skill-hardening-clarity.test.ts` (search: `batch_expected = assessed_added`).

**Recurrence 2026-08-18 (planning against the ADR instead of the contract):** Planning against 3000 claimed roughly 1000 and 2100 words of room. The routed budgets measured `.goat-flow/skill-docs/playbooks/writing-human-facing-prose.md` at 1992 within 1700-2000 and `.goat-flow/skill-docs/playbooks/writing-sentence-diagnostics.md` at 1136 within 900-1150: only 8 and 14 words remained, making the plan unbuildable. Evidence: `test/contract/skill-hardening-contracts.test.ts` (search: `M51 writing playbooks stay within their routed context budgets`).

**Recurrence 2026-08-24 (trim verdicts):** A 99-rule inventory gave `TRIM` to `workflow/skills/playbooks/writing-human-facing-prose.md` (1996 to 1978; duplicates of `Protect meaning before style` and its code-comment Scope Gate) and `workflow/skills/playbooks/writing-sentence-diagnostics.md` (1128 to 1114; duplicate of `These patterns diagnose reader cost, not authorship`). `workflow/skills/playbooks/writing-structure-diagnostics.md` was `NO-TRIM-NEEDED` at 858. Rules stayed at 99; caps and contracts stayed unchanged; mirrors matched. Budget evidence: `test/contract/skill-hardening-contracts.test.ts` (search: `M51 writing playbooks stay within their routed context budgets`). The first record reached 41,271 bytes and three shorthand paths triggered `stale-ref`; compacting it to 39,581 and using full paths cleared the check. Validator: `src/cli/stats/stats.ts` (search: `BUCKET_SIZE_WARN_BYTES`).

**Prevention:** Before editing a playbook, measure its body word count, read its actual cap from `test/contract/skill-hardening-contracts.test.ts` rather than assuming the ADR-023 tier, and grep the contract tests for its filename to list the pinned phrases:

```bash
node -e 'const t=require("fs").readFileSync(process.argv[1],"utf8").replace(/^---\n[\s\S]*?\n---\n?/,"");console.log(t.split(/\s+/).filter(Boolean).length)' .goat-flow/skill-docs/playbooks/<name>.md
rg -n "<name>|<distinctive heading or phrase>" test/contract/skill-hardening-*.test.ts
```

For a closed vocabulary or reconciliation equation, also grep every label and total across skills,
references, receipts, docs, and release prose. Contract which equation applies to each selector or
change state; independent literal-presence checks can preserve two contradictory owners.

Restore pinned phrases verbatim after any compression, take compensating words from prose no assertion covers, and run the relevant skill-hardening contract tests before preflight. Mirror the result to every installed skill or playbook copy in the same turn; preflight diffs them.

## Footgun: Adjective-shaped style rules in shipped guidance do not constrain another agent's output

**Status:** active | **Created:** 2026-08-16 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A skill's guidance states a quality bar in adjectives ("plain", "concrete", "jargon-free", "one line", "a reader outside the project understands"), the contract suite proves the guidance ships to every mirror, and a consuming agent still produces the exact prose the bar was written to prevent. Nothing fails, because the contract pins that the rule exists, never that output obeys it.

**Why it happens:** An adjective is self-assessed. An agent that writes a 33-word paragraph naming three internal identifiers can believe in good faith it wrote a concrete, jargon-free line, so the rule never binds. Worked BAD/GOOD examples help but carry their own trap: a single example reads as a special case for whatever surface it was drawn from.

**Evidence:** 2026-08-16, goat-plan's `What we lose without this` / `Why this helps` sections. Guidance shipped with the adjective rule plus one
security-flavoured BAD/GOOD pair; an external coding agent converted a 14-milestone plan train plus its issue summary and produced sections
averaging 33 words against a stated one-line bar. Eleven of 14 benefit lines described what ships rather than what a person gets, while an internal
release/milestone label, an external draft ADR token, and `v1 verdicts` survived "jargon-free". The same author had written 10-18 word lines by hand
for two other plan trains, so the gap was the guidance, not the corpus. Checkable rules first replaced the adjectives; a follow-up then moved
the length and identifier list into strict validation while the reference retained the checker pointer, subject rule, and second BAD/GOOD pair:
`workflow/skills/goat-plan/references/milestone-examples.md` (search: `enforces current-heading length and internal identifiers`).

**Prevention:** Write agent-facing style rules as things a reader can check without judgement - a number, a banned list, a required subject - and reserve adjectives for the surrounding explanation. Ship at least two worked examples from different surfaces so neither reads as domain-specific. Treat a contract assertion on guidance text as proof of delivery only; the proof that a rule binds is a run by an agent that did not write it, which is worth doing before assuming the wording works. Same trap class as `Linter or security-scanner output can pressure rewrites of load-bearing skill language` (search: "## Footgun: Linter or security-scanner output can pressure rewrites of load-bearing skill language"), inverted: there a mechanical check overrode meaning, here meaning shipped with no mechanical check at all.

## Footgun: A skill permission exception can outrun its accepted ADR authority

**Status:** active | **Created:** 2026-08-20 | **Evidence:** OBSERVED

**Symptoms:** A shipped skill grants a narrow mutation exception while the accepted ADR that defines the skill boundary still forbids that entire class of change. Both surfaces read coherently alone, phrase-presence tests pass, and agents receive contradictory authority depending on which source they consult.

**Why it happens:** Consumer-installed skills must be self-contained, while framework ADRs remain internal. A skill edit can therefore add useful operational detail without forcing a review of the decision that owns its authority. Mirror-parity tests prove delivery, not policy consistency.

**Evidence:** On 2026-08-20, `workflow/skills/goat-clarity/SKILL.md` Scope v2 allowed one public/exported rename, while `.goat-flow/learning-loop/decisions/ADR-009-skill-consolidation.md` still routed broader or public refactoring outside goat-clarity. A Codex quality review identified the contradiction. The repair now aligns the skill (search: `enumerated set of public or exported identifier renames`) and ADR-009 (search: `enumerated set of public or exported identifier spelling changes`), and `test/contract/skill-hardening-clarity.test.ts` (search: `keeps the accepted clarity authority aligned`) pins the cross-surface rule.

**Prevention:** Treat any new skill permission or write-mode exception as an authority change. Before editing the skill, identify the accepted ADR that owns its boundary, update or supersede that decision in the same approved change, and add one contract that reads both surfaces. Mirror parity remains necessary but is not policy proof.

---

## Footgun: goat-plan surface additions collide with near-full word-budget contract caps

**Status:** active | **Created:** 2026-08-15 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Measure both caps and enumerate every phrase pin before drafting; preserve existing pins and compact only new wording unless the human approves a cap or semantic change.
**Trigger phase:** SCOPE
**Caught at:** VERIFY
**Incident count:** 5 | **Latest occurrence:** 2026-08-29

**Prevention:** Before editing goat-plan, measure both caps and grep every contract that reads the target path. Preserve pinned semantics; compact only new wording, or ask the human to choose a cap or semantic change. Sync all four mirrors and rerun the fast contracts. After a cap change, grep ignored plans and docs for its old number and assertion text.

**Symptoms:** A small approved addition to goat-plan's SKILL.md or reference files passes every phrase-pinning assertion and the mirror byte-identical check, then fails `keeps the redesigned goat-plan canonical surface within its tighter budget` in the contract suite.

**Why it happens:** Two caps bound the goat-plan canonical surface: the SKILL.md body alone, and SKILL.md plus `references/milestone-examples.md` plus `references/issue-format.md` combined. The redesign left both within a few words of their caps (2099/2100 and 4499/4500 before 2026-08-15), so any addition overflows and forces a choice: condense existing prose, much of which is pinned by regex assertions, or raise the caps with user approval. Same trap class as the ADR-023 playbook word cap (search: "Playbook content edits collide with the ADR-023 word cap"), on a different surface with different caps in a different test file.

**Evidence:** 2026-08-15, adding `## How users will notice the difference` and `## Why` (renamed to `## Motivation` later the same day) to the Standard milestone template plus one SKILL.md sentence (97 words total) tipped both caps: 2117/2100 and 4596/4500. `test/contract/skill-hardening-plan-2.test.ts` (search: `redesign target of 2150 words`) holds the SKILL.md body cap; the same file (search: `canonical goat-plan surface has`) holds the combined cap; `test/contract/skill-hardening.helpers.ts` (search: `countSkillBodyWords`) excludes frontmatter from the body count. Resolved by raising the caps to 2150/4650 with user approval.

**Recurrence 2026-08-16:** Renaming those two sections to `## What we lose without this` / `## Why this helps` and adding derivation rules overflowed the combined cap. The obvious trim - `### Verification baseline` and `### Maintenance notes` - was pinned by `keeps goat-plan handoff artifacts drift-aware without burdening small plans`, so the approved resolution raised 4650 to 4700 (4671 used); the body cap stayed unchanged.

**Recurrence 2026-08-18:** A 27-token rewrite of goat-plan's Shared Conventions line (defining which modes read `skill-conventions.md`) passed every phrase pin and mirror check, then failed the combined cap at 4717/4700 - the surface had 3 words of headroom. Resolved by compacting to a 7-token line (`Modes R/1/3/4 also read`), the same length as the sentence it replaced.

**Update 2026-08-19:** Combined cap raised 4700 -> 5450 with user approval for the ISSUE.md plain-language redesign (checkable rules, a word swap table, two worked pairs, and a labelled worked sample moved inline into `issue-format.md`; 5373 used). The sweep for the old number found no live citations; old-format ISSUE and milestone artifacts under `.goat-flow/plans/` were left as historical outputs. Body cap unchanged (2128/2150 used). Raised again the same day, 5450 -> 5650, for the cut-words-never-facts rules and a third worked pair (5564 used).

**Recurrence 2026-08-28:** A cap audit measured every configured limit but missed older plan-contract pins. Mid-proof failed its amendment and dependency-transition contracts, and the body measured 2151/2150. Restoring those pins and compacting only the new rule produced 2144/2150 and `# pass 51`, `# fail 0`. Evidence anchors: `test/contract/skill-hardening-plan-1.test.ts` (search: `keeps goat-plan amendments behind the milestone approval gate`) and `test/contract/skill-hardening-plan-2.test.ts` (search: `redesign target of 2150 words`).

**Recurrence 2026-08-29:** A mode-order edit hit 2154/2150; its first trim broke a pinned path-only phrase. The new row ended at 2145/2150 with 24/24. Evidence: `test/contract/skill-hardening-plan-1.test.ts` (search: `makes explicit no-write signals outrank named-file mutation verbs`); TDD: `2026-08-29-goat-plan-mode-precedence-tdd.md`.

---

## Footgun: Dense functional skills satisfy the ADR-023 word cap yet lose skill-quality token points

**Status:** active | **Created:** 2026-08-16 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A functional skill sits under the ADR-023 2,500-word cap and passes every contract, yet the dashboard's deterministic skill-quality score shows Token / Load Cost 7/10 (`~5127 tokens` / `~5750 tokens`), and relocating whole sections into a progressive reference recovers less than the section sizes suggest.

**Why it happens:** The two budgets use different units. ADR-023 counts body words in `test/contract/skill-hardening.helpers.ts` (search: "countSkillBodyWords"); the rubric estimates tokens as `Math.ceil(content.length / 4)` over the raw SKILL.md including frontmatter, and steps 10/10 down to 7/10 above 5,000 tokens (`src/cli/quality/skill-quality-metrics.ts`, search: `tokens > 5000`). At about 8 chars per word the two agree; goat-security's pipe-delimited compound tokens run about 10 chars per word, so 2,072 body words is 20,604 chars and 5,151 tokens, while goat-review at 2,413 words is 19,972 chars and 4,993 tokens with 28 chars of headroom. Relocation also pays pointer overhead and cannot add a sixth `references/` file without a separate 3-point deduction (search: `subRefs > 5`), so estimated savings from section sizes alone overstate the result.

**Evidence:** 2026-08-16, moving goat-security's Step 0 exception-validity tuple (1,328 chars) and Compliance Mode body (1,546 chars) into `references/project-policy-template.md` netted 2,395 chars after pointers, leaving 20,604 chars and the same 7/10; a phrase-repeat scan found no remaining literal duplication, only contract-pinned procedure. The user chose to keep that 96% as a true density signal rather than move Full-only phases into `common-threats.md`, which the skill loads on every run anyway.

**Prevention:** Before promising a token-tier change, measure `content.length` of the exact SKILL.md, subtract the moved sections, add the pointer text you will leave behind, and check `references/` stays at five files. Prefer moving content the skill loads only in a specific mode; a move into an always-loaded reference changes the metric without changing what the agent reads. When editing goat-review, re-measure: 28 chars of headroom means one added sentence drops it to 7/10.
