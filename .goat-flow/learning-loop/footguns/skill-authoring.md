---
category: skill-authoring
last_reviewed: 2026-08-20
---

**Scope:** Authoring and editing skill, playbook, and slash-command bodies - candidacy, word-budget and contract-phrase caps, tool-isolation constraints on prescribed commands, and pressure to reword load-bearing language. Keeping workflow templates and installed copies in sync lives in [skills.md](skills.md).

## Footgun: Bash-prescribed slash-command or skill bodies break under per-block tool isolation

**Status:** active | **Created:** 2026-05-26 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A SKILL.md or slash-command body grows past one or two `!cmd` invocations into a multi-block bash program. The agent runtime treats each bash block as an independent tool invocation. Variables defined in block N are gone in block N+1; heredocs with substitution, `BASH_REMATCH`, associative arrays, and `$(tool …)` substitution all become unreliable because the shell state is reset between blocks. The command starts producing parse errors or silently does the wrong thing.

**Why it happens:** Authors write a skill body the way they'd write a shell script — top to bottom, with variables shared across steps. Claude Code (and the other supported agent CLIs) treat each fenced bash block as a separate `Bash` tool call. The slash-command body should describe steps declaratively for the agent to execute; it should not prescribe an exact multi-block bash program. The cost is hidden until the body crosses ~10 lines or ~2 blocks — short skills look fine.

**Evidence:**
- External: `kennyjpowers/claude-flow` PR #2 ("feat: add feedback workflow command" follow-up, MERGED 2025-11-21, 1,691 additions / 3,174 deletions). The original `feedback.md` shipped in PR #1 had 26+ bash blocks using `BASH_REMATCH`, heredocs with substitution, and `$(stm list …)` substitution. The PR #2 feedback log in the external specs/add-feedback-workflow-command/05-feedback.md file (search: `Variable Persistence Problem: Bash variables don't persist between separate Bash tool invocations`) names the root cause: *"The command tries to prescribe exact bash scripts instead of providing declarative guidance for Claude to follow."* Fix: declarative steps + direct `!claudekit status stm` invocations replacing `$(claudekit status stm)` substitution.
- External, follow-up: the same defect remained in sibling `decompose.md` (16 bash blocks) until a second feedback cycle. Same author, same codebase, same fix needed twice. Reinforces "when refactoring is the right answer, do the same refactor across sibling files."
- Goat-flow surfaces at risk: every `workflow/skills/*/SKILL.md`, especially the dispatcher (`goat`) and any skill that orchestrates multi-step shell work. Verification: `rg -c '^```bash' workflow/skills/*/SKILL.md` lists current bash-block counts per skill.

**Prevention:**
1. If a SKILL.md body contains a bash block longer than ~10 lines OR more than 2 bash blocks total, refactor to declarative steps that name the tool and the inputs but let the agent pick the invocation.
2. Use direct `!` tool invocations (e.g. `!goat-flow audit`) not `$(goat-flow audit)` substitution — the substitution form forces a subshell whose state doesn't persist beyond the block.
3. Replace heredocs-with-substitution and associative-array tricks with a single file write + read, or with prose that asks the agent to track the value across steps.
4. Validate by reading the SKILL.md as if a fresh agent ran each bash block in isolation: if any block expects a variable from a prior block, the body is prescriptive — refactor before shipping.
5. When a sibling skill has the same shape (multiple skills wrapping the same kind of tool orchestration), audit them together. The kennyjpowers PR #2/decompose.md pattern shows that fixing only the one that bit leaves the rest as latent traps.

Applies wherever goat-flow ships a SKILL.md or command body that orchestrates multi-step bash work. Cross-reference: `.goat-flow/learning-loop/footguns/skills.md` (search: `Skill parity edits can miss`) for the parallel concern about edits not propagating across installed mirrors — a bash-heavy skill compounds that risk because each block must remain byte-identical across all four installed copies.

## Footgun: Release-version bumps can break skill-rename work through stale fixtures and hardcoded current-version routing

**Status:** active | **Created:** 2026-04-18 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A skill rename can look complete on directory, manifest, and docs surfaces but still fail verification because release-coupled helpers lag the version bump. On 2026-04-18, the M07 rename run first failed `npm test` in `test/integration/audit-build.test.ts` because the shared config stub still encoded the previous release version. After fixing that, the same verification pass exposed a second break: setup routing still hardcoded `1.1.x` as the only current branch, so a healthy `1.2.0` project was misclassified as needing an upgrade.

**Evidence:**
- `src/cli/audit/check-goat-flow.ts` (search: `configVersionCurrent`) enforces exact equality between `.goat-flow/config.yaml` and `AUDIT_VERSION`.
- `test/fixtures/projects/index.ts` (search: `stubConfig`) is the shared config stub used by audit-build fixtures; if it drifts from `AUDIT_VERSION`, "healthy project" tests fail for the wrong reason.
- `src/cli/classify-state.ts` (search: `CURRENT_VERSION_FAMILY`) derives the current version family and routes current vs outdated installs; hardcoding a previous family breaks `composeSetup()` as soon as the package version advances.
- `workflow/install-goat-flow.sh` (search: `Read version from package.json`) must derive the install version from `package.json`; a hardcoded fallback recreates the same stale-version trap at install time.

**Prevention:** When a skill rename ships with a version bump, treat version-sensitive helpers as part of the rename surface. Update current-version classifiers, shared config fixtures, install-script version discovery, and setup-routing tests in the same change before trusting `npm test`.

## Footgun: New skill proposals can be configuration systems shaped around one workflow rather than general-purpose tools

**Status:** active | **Created:** 2026-05-26 | **Evidence:** OBSERVED

**Symptoms:** A thoughtful, first-person, well-written proposal lands for an eighth canonical skill. It solves a real problem the author actually had. On read-through it turns out the skill is parameterised by the proposer's working style (multi-domain isolation, per-project keyword auto-loading, session-locked context, personal taxonomy) rather than by a structural property of any goat-flow project. Accepting it grows the canonical skill set and forces every downstream consumer (and every audit pass that scores skill quality) to carry weight for a workflow most projects do not have.

**Why it happens:** goat-flow has no prose document defining what makes a skill belong in `workflow/manifest.json` (search: `"canonical"`) vs in an out-of-tree plugin. ADR-009 (search: `A skill must have at least one of`) records the *historical* doctrine of consolidating skills, and ADR-021 (search: `goat-critique runs in one mode: full delegated`) records the rejection of one over-narrow mode, but neither serves as a forward-facing scoping checklist for new skill proposals. `docs/skill-authoring.md` covers how to write a skill once accepted, not whether to accept one. Without that gate, well-intentioned skill PRs are evaluated on craft (which they often pass) rather than scope (where they should fail).

**Evidence:**
- `workflow/manifest.json` (search: `"canonical"`) enumerates the eight canonical skills; a ninth grows the surface area of every per-harness mirror, every audit check, and every parity script.
- `.goat-flow/learning-loop/decisions/ADR-009-skill-consolidation.md` (search: `A skill must have at least one of`) records the doctrine but does not encode it as an authoring-time gate.
- `.goat-flow/learning-loop/decisions/ADR-021-goat-critique-full-mode-only.md` (search: `goat-critique runs in one mode: full delegated`) is the closest prior art for rejecting a configuration-flavored alternative; it lives as a per-skill decision, not a generic test.
- `docs/skill-authoring.md` (search: `Decide First`) is structured as scaffold / validate / interactive / dashboard / authoring checks; none of the sections gate on general-purpose vs. workflow-specific.
- External corroboration: obra/superpowers PR #1571 ("feat: add context-management skill with domain isolation") was closed with the maintainer comment "the skill as designed is shaped around your specific multi-domain workflow ... that's a configuration system, not [a skill]." Superpowers and goat-flow share the same risk because both maintain a small canonical-skill surface.

**Prevention:**
1. Before adding any skill to `workflow/manifest.json` `skills.canonical`, write a one-paragraph "general-purpose justification" answering: would a project with no overlap to the proposer's workflow still benefit? Record it in the corresponding ADR.
2. Treat skill-shaped configuration (per-domain context auto-loading, session-locked taxonomies, opinion-locked keyword maps) as a signal that the work belongs in a downstream plugin or `.goat-flow/skill-docs/playbooks/` rather than a new canonical skill.
3. If the proposal is craft-strong but scope-narrow, route to `.goat-flow/skill-docs/playbooks/` (which agents can opt into per project) rather than `workflow/skills/` (which every harness installs).

## Footgun: Linter or security-scanner output can pressure rewrites of load-bearing skill language

**Status:** active | **Created:** 2026-05-26 | **Evidence:** OBSERVED

**Symptoms:** An automated tool (security scanner, prompt-injection detector, prose linter) flags a phrase or framing inside a canonical SKILL.md - `**EXTREMELY IMPORTANT**`-style emphasis, the Excuse | Reality tables, a forceful "Iron Law" line, the deliberate "your AI partner" phrasing. A well-meaning PR rewrites the flagged language to "comply" with the tool's guidance. The rewrite passes the tool, passes typecheck, passes structural skill-quality scoring (`src/cli/quality/skill-quality-score.ts` — search: `scoreContent`), and silently degrades the skill's behaviour-shaping power because the flagged phrasing was load-bearing.

**Why it happens:** Excuse | Reality tables and forceful framing exist precisely *because* they shift agent behaviour under pressure. They look like editorial emphasis to an external tool (and to agents reading them cold) but they are the persuasion mechanism the skill depends on. goat-flow's existing structural scorer measures shape (presence of gates, table rows, frontmatter) but not behaviour, so a "compliance" rewrite passes every CI check while quietly weakening the runtime contract. The trap is structural: load-bearing prose has no machine-distinguishable signature from decorative prose.

**Evidence:**
- `.goat-flow/skill-docs/skill-quality-testing/adversarial-framing.md` (search: `cynical reviewer with zero patience`, `Zero-findings HALT rule`) documents that specific phrasing in review-class skills is the mechanism, not the message.
- `src/cli/quality/skill-quality-score.ts` (search: `scoreContent`, `scoreAllArtifacts`) — the scorer composes text and runs rubric metrics; it does not execute the skill against agent prompts, so a "compliance" rewrite that preserves shape can pass scoring.
- `.claude/skills/goat-plan/SKILL.md` (search: `Excuse`, `Reality`) — the Excuse | Reality table is the persuasion surface most likely to attract a "this is unprofessional / aggressive / could be softened" rewrite suggestion.
- External corroboration: obra/superpowers PR #1608 ("fix(skill): remove prompt-injection marker") was closed as slop. The maintainer's comment: "the framing the scanner flagged is intentional — it's the mechanism that makes Superpowers actually shape agent behavior." Same shape of trap applies here.

**Prevention:**
1. Mark known-load-bearing prose surfaces (Excuse | Reality tables, hard gates, forceful framing lines, the `your AI partner` term) as protected in `docs/skill-authoring.md` so authors know rewording requires evidence.
2. Treat any PR that rewords skill text in response to *tool output* (scanner, linter, model review) as requiring before/after behavioural eval evidence, not just passing structural checks. When the M10 behavioural eval harness lands, this becomes enforceable.
3. CI rule (cheap, valuable): fail PRs whose bodies match canned scanner output patterns (`Risk score:`, `Matched signals:`, `pre-flight guardrails passed`) unless an explicit `[manual-review]` marker is present in the body.

---

## Footgun: Playbook content edits collide with the ADR-023 word cap and exact-phrase contract assertions

**Status:** active | **Created:** 2026-08-10 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Measure the body budget and inventory phrase-pinning contracts, vocabulary consumers, and reconciliation owners before adding or compressing shipped skill guidance.
**Trigger phase:** ACT
**Incident count:** 7 | **Latest occurrence:** 2026-08-18

**Symptoms:** An approved content addition to a shipped playbook passes typecheck, content lint, and the playbook contract test, then fails preflight twice. First on the ADR-023 progressive-pack word cap. Then, after the compression pass that makes room, on skill-hardening assertions pinning exact sentences the compression reworded.

**Why it happens:** Playbooks under `.goat-flow/skill-docs/playbooks/` are trimmed to sit just below the 3000-word cap, so headroom is often single digits and any addition forces compression across sections unrelated to the change. Those same sections carry regex assertions matching literal phrasing, including capitalisation. Word-count pressure and phrase-exactness pressure point in opposite directions, and neither is visible while editing the Markdown.

**Evidence:** 2026-08-10, `writing-style.md`. Eight approved additions took the body from 2998 to 3672 words; `test/contract/skill-hardening-contracts.test.ts` (search: `ADR-023 word budget tiers`) reported `3672 words meets or exceeds progressive cap 3000`. Compressing back to 2997 broke eight assertions in `test/contract/skill-hardening-shared-2.test.ts` (search: `keeps writing-style edits truth-preserving and source-aware`), among them `claim strength and specificity to the evidence`, `Reference-list labels remain valid`, `Illustrative before`, and a capitalisation-only change from `status,` to `Status,` at the head of a Verification Gate item.

**Recurrence 2026-08-16:** Adding validator-anchor, refutation-ledger, and resumable-chunk guidance raised `workflow/skills/goat-review/SKILL.md` from 2499 to 2593 body words. The first compression returned it to 2499 but changed pinned phrases and failed 14 focused skill contracts. The next focused set passed 45/45 but omitted two shared-surface contracts, which the full suite caught. An all-file skill-hardening run then caught a case-sensitive prefix mismatch and a contract regressed while reclaiming words. Inventorying every direct reader before the final correction produced a 2499-word body with all 181 skill-hardening contracts passing. Evidence anchors: `test/contract/skill-hardening-contracts.test.ts` (search: `functional skills stay within the 2500-word cap`), `test/contract/skill-hardening-review-1.test.ts` (search: `forbids goat-review setup mutation and branch checkout`), `test/contract/skill-hardening-review-2.test.ts` (search: `calibrates goat-review severity from evidence before labels`), `test/contract/skill-hardening-review-2.test.ts` (search: `documents validator-ready anchors, REFUTED-only ledgers, and resumable chunks`), `test/contract/skill-hardening-shared-1.test.ts` (search: `defines two evidence-producing area audit passes`), and `test/contract/skill-hardening-shared-2.test.ts` (search: `keeps direction audits advisory, grounded, and separate from defect verdicts`).

**Recurrence 2026-08-17:** The 3000-word ADR-023 progressive cap is not the binding limit. `test/contract/skill-hardening-contracts.test.ts` also enforces tighter per-playbook rollout budgets - measured that day, `code-comments.md` caps at 2880 (M02) and `writing-sentence-diagnostics.md` must sit inside 900-1100 (M51). Both files were already within six and two words of those numbers, so a headroom figure computed against 3000 read as 126 and 1902 words of room that did not exist, and two approved additions failed the suite. Read the caps from the contract before sizing an edit; `code-comments.md` additionally carries 84 `assert.match` assertions, so funding an addition by compression there is its own scoped task, not a side edit.

**Recurrence 2026-08-17 (mode-aware clarity gate):** A focused new contract proved both replacement empty-selection branches, but two older assertions in the same clarity contract still pinned phrases removed by the approved rewrite. The aggregate skill gate failed first on `zero eligible source files`, then on the comma-sensitive `binary or generated`. Re-reading the complete assertion block against the source diff preserved the binary/generated fail-closed invariant while removing only the superseded mode-agnostic phrase. Evidence anchors: `workflow/skills/goat-clarity/SKILL.md` (search: `when no selected unit is source code`; the 2026-08-19 write-authority rewrite replaced the mode-aware sentence with this clause) and `test/contract/skill-hardening-clarity.test.ts` (search: `fails closed on unsupported path state`).

**Recurrence 2026-08-17 (goat-clarity budget):** The new test dispositions and mode-aware empty-selection guidance passed focused contracts but raised goat-clarity from 2,457 to 2,641 body words. The full ADR-023 gate rejected it before the slow suite. Compressing duplicated test-selection explanation back into its owner left the explicit dispositions, equations, and report-only guard in the skill at 2,491 words across all mirrors. Evidence anchors: `workflow/skills/goat-clarity/SKILL.md` (search: `Added-test dispositions`) and `test/contract/skill-hardening-contracts.test.ts` (search: `functional skills stay within the 2500-word cap`).

**Recurrence 2026-08-17 (closed-vocabulary consumers):** An external review found that goat-clarity's added/removed-test vocabulary and equations had reached the skill and playbook while the batch checkpoint, public docs, changelog, and receipt still enumerated only existing-test outcomes. The focused suite was green because it pinned the checkpoint's stale five-label equation independently instead of relating selector mode to its applicable equation. Adding those missing consumer contracts briefly moved the 2,491-word skill to the rejecting 2,500 boundary; a semantics-preserving trim left 2,490 words and all 88 aggregate skill contracts green. Evidence anchors: `workflow/skills/goat-clarity/references/target-scope-and-evidence.md` (search: `batch_expected = assessed_added`) and `test/contract/skill-hardening-clarity.test.ts` (search: `batch_expected = assessed_added`).

**Recurrence 2026-08-18 (planning against the ADR instead of the contract):** A milestone was authored proposing additions to `.goat-flow/skill-docs/playbooks/writing-style.md` and its structure sibling on a headroom figure taken from ADR-023's generic 3000-word cap, giving roughly 1000 and 2100 words of room. The binding limits are routed per-playbook budgets with floors as well as ceilings - measured that day, `.goat-flow/skill-docs/playbooks/writing-style.md` 1700-2000 with a 1992-word body and `.goat-flow/skill-docs/playbooks/writing-sentence-diagnostics.md` 900-1150 with 1136 - so the real headroom was 8 and 14 words and the plan was unbuildable as written. The trap survives because the ADR is the document a planner reaches for and the tighter number lives only in a test. Read the routed budget from the contract, not the ADR, before sizing any playbook edit. Evidence anchor: `test/contract/skill-hardening-contracts.test.ts` (search: `M51 writing playbooks stay within their routed context budgets`).

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

**Evidence:** 2026-08-16, goat-plan's `What we lose without this` / `Why this helps` sections. Guidance shipped with the adjective rule plus one security-flavoured BAD/GOOD pair; an external coding agent converted `.goat-flow/plans/1.18.0/` (14 milestones plus ISSUE.md) and produced sections averaging 33 words against a stated one-line bar, with 11 of 14 benefit lines describing what ships rather than what a person gets, and `1.17.0 M12`, `ADR-056` (an external draft token, not a repository decision file), and `v1 verdicts` surviving "jargon-free". The same author had written 10-18 word lines by hand for two other plan trains, so the gap was the guidance, not the corpus. Fixed by replacing the adjectives with checkable rules in `workflow/skills/goat-plan/references/milestone-examples.md` (search: `70 to 120 characters, naming no milestone`): a word count, a banned-referent list, a subject rule for the benefit line, and a second BAD/GOOD pair from a different surface.

**Prevention:** Write agent-facing style rules as things a reader can check without judgement - a number, a banned list, a required subject - and reserve adjectives for the surrounding explanation. Ship at least two worked examples from different surfaces so neither reads as domain-specific. Treat a contract assertion on guidance text as proof of delivery only; the proof that a rule binds is a run by an agent that did not write it, which is worth doing before assuming the wording works. Same trap class as `Linter or security-scanner output can pressure rewrites of load-bearing skill language` (search: "## Footgun: Linter or security-scanner output can pressure rewrites of load-bearing skill language"), inverted: there a mechanical check overrode meaning, here meaning shipped with no mechanical check at all.

---

## Footgun: goat-plan surface additions collide with near-full word-budget contract caps

**Status:** active | **Created:** 2026-08-15 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A small approved addition to goat-plan's SKILL.md or reference files passes every phrase-pinning assertion and the mirror byte-identical check, then fails `keeps the redesigned goat-plan canonical surface within its tighter budget` in the contract suite.

**Why it happens:** Two caps bound the goat-plan canonical surface: the SKILL.md body alone, and SKILL.md plus `references/milestone-examples.md` plus `references/issue-format.md` combined. The redesign left both within a few words of their caps (2099/2100 and 4499/4500 before 2026-08-15), so any addition overflows and forces a choice: condense existing prose, much of which is pinned by regex assertions, or raise the caps with user approval. Same trap class as the ADR-023 playbook word cap (search: "Playbook content edits collide with the ADR-023 word cap"), on a different surface with different caps in a different test file.

**Evidence:** 2026-08-15, adding `## How users will notice the difference` and `## Why` (renamed to `## Motivation` later the same day) to the Standard milestone template plus one SKILL.md sentence (97 words total) tipped both caps: 2117/2100 and 4596/4500. `test/contract/skill-hardening-plan-2.test.ts` (search: `redesign target of 2150 words`) holds the SKILL.md body cap; the same file (search: `canonical goat-plan surface has`) holds the combined cap; `test/contract/skill-hardening.helpers.ts` (search: `countSkillBodyWords`) excludes frontmatter from the body count. Resolved by raising the caps to 2150/4650 with user approval. Recurred 2026-08-16 renaming those two sections to `## What we lose without this` / `## Why this helps` and adding the derivation rules: the obvious trim - the `### Verification baseline` and `### Maintenance notes` subsections, which restate bullets six lines above them - is itself pinned by `keeps goat-plan handoff artifacts drift-aware without burdening small plans` in the same file, so the only trim on offer cost a shipped contract. Combined cap raised 4650 -> 4700 (4671 used); body cap unchanged.

**Recurrence 2026-08-18:** a 27-token rewrite of goat-plan's Shared Conventions line (defining which modes read `skill-conventions.md`) passed every phrase pin and mirror check, then failed the combined cap at 4717/4700 - the surface had 3 words of headroom. Resolved by compacting to a 7-token line (`Modes R/1/3/4 also read`), the same length as the sentence it replaced.

**Update 2026-08-19:** combined cap raised 4700 -> 5450 with user approval for the ISSUE.md plain-language redesign (checkable rules, a word swap table, two worked pairs, and a labelled worked sample moved inline into `issue-format.md`; 5373 used). The sweep for the old number found no live citations; old-format ISSUE and milestone artifacts under `.goat-flow/plans/` were left as historical outputs. Body cap unchanged (2128/2150 used). Raised again the same day, 5450 -> 5650, for the cut-words-never-facts rules and a third worked pair (5564 used).

**Prevention:** Before adding content to goat-plan's SKILL.md or references, measure both counts against the caps in `test/contract/skill-hardening-plan-2.test.ts`. On overflow, present condense-versus-raise to the user instead of silently trimming pinned prose. Enumerate what the contract suite pins in the target file *before* choosing a trim - grep the test file for regexes read against that path - because the most redundant-looking prose here is disproportionately likely to be pinned, and discovering that after the edit turns a trim into a choice between reverting and weakening someone else's check. Edit all four skill mirrors (`workflow/skills/`, `.claude/skills/`, `.agents/skills/`, `.github/skills/`) in the same batch and rerun the fast contract suite. After raising a cap, grep gitignored plan files and docs for the old numbers and the old assertion-message text: a milestone that budgeted against the old cap keeps citing it, and its `(search:)` anchor into the assertion message stops resolving the moment the message changes. That happened the same day to `.goat-flow/plans/1.16.0/M38-goat-plan-dispatchable-tasks.md`, which cited `redesign target of 2100 words` in a Read-first line plus the old caps in its Commands table and stop condition.

---

## Footgun: Dense functional skills satisfy the ADR-023 word cap yet lose skill-quality token points

**Status:** active | **Created:** 2026-08-16 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A functional skill sits under the ADR-023 2,500-word cap and passes every contract, yet the dashboard's deterministic skill-quality score shows Token / Load Cost 7/10 (`~5127 tokens` / `~5750 tokens`), and relocating whole sections into a progressive reference recovers less than the section sizes suggest.

**Why it happens:** The two budgets use different units. ADR-023 counts body words (`test/contract/skill-hardening.helpers.ts`, search: `countSkillBodyWords`); the rubric estimates tokens as `Math.ceil(content.length / 4)` over the raw SKILL.md including frontmatter and steps 10/10 down to 7/10 above 5,000 tokens (`src/cli/quality/skill-quality-metrics.ts`, search: `tokens > 5000`). At about 8 chars per word the two agree; goat-security's pipe-delimited compound tokens run about 10 chars per word, so 2,072 body words is 20,604 chars and 5,151 tokens, while goat-review at 2,413 words is 19,972 chars and 4,993 tokens with 28 chars of headroom. Relocation also pays pointer overhead and cannot add a sixth `references/` file without a separate 3-point deduction (search: `subRefs > 5`), so estimated savings from section sizes alone overstate the result.

**Evidence:** 2026-08-16, moving goat-security's Step 0 exception-validity tuple (1,328 chars) and Compliance Mode body (1,546 chars) into `references/project-policy-template.md` netted 2,395 chars after pointers, leaving 20,604 chars and the same 7/10; a phrase-repeat scan found no remaining literal duplication, only contract-pinned procedure. The user chose to keep that 96% as a true density signal rather than move Full-only phases into `common-threats.md`, which the skill loads on every run anyway.

**Prevention:** Before promising a token-tier change, measure `content.length` of the exact SKILL.md, subtract the moved sections, add the pointer text you will leave behind, and check `references/` stays at five files. Prefer moving content the skill loads only in a specific mode; a move into an always-loaded reference changes the metric without changing what the agent reads. When editing goat-review, re-measure: 28 chars of headroom means one added sentence drops it to 7/10.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: Routing skill-conventions into goat-security overflows the skill-quality composition cap

**Status:** resolved | **Created:** 2026-08-18 | **Resolved:** 2026-08-18 | **Evidence:** ACTUAL_MEASURED

**Original symptoms:** Adding goat-security's required Full-depth route to `skill-conventions.md` made the deterministic quality scorer report `composition truncated at 32KB`. Six other functional skills were already truncated, while goat-security's five packs were absent from composition because the skill named bare filenames instead of `references/<file>.md` paths.

**Why it happened:** The 32 KiB composition ceiling was smaller than the context the skills actually instruct agents to load. That evaluator limit encouraged omission of binding guidance from the runtime skill and made incomplete scoring look complete.

**Resolution:** Goat-security now routes Full depth to conventions and names all five packs with explicit `references/` paths. The scorer's bounded composition window is 128 KiB, below the existing 256 KiB artifact ceiling; measured current functional compositions range from 40.5 to 79.1 KiB. A general contract scores every functional skill and rejects any truncation, while the security contract checks its exact composed sources.

**Resolution evidence:** `src/cli/quality/quality-config.ts` (search: `Current full functional contexts measure 40.5-79.1 KiB`), `test/contract/skill-hardening-contracts.test.ts` (search: `against its complete configured context`), and `test/contract/skill-hardening-security-1.test.ts` (search: `goat-security quality composition must include its full configured context`). Local TDD receipt filename: `2026-08-18-goat-security-tdd.md`.

**Prevention:** Treat every required route and reference pointer as runtime truth first and evaluator input second. Measure all functional compositions after changing shared guidance, keep the bounded ceiling below `maxArtifactBytes`, and never remove binding guidance merely to satisfy a scorer cap.

---

## Footgun: Review skills can choose the wrong PR base when they hardcode `origin/main`

**Status:** resolved | **Created:** 2026-04-25 | **Resolved:** 2026-04-25 | **Evidence:** ACTUAL_MEASURED

**Original symptoms:** `/goat-review` could misclassify PR-style review scope or generate the wrong comparison diff in consumer projects whose real integration branch is not `main`. A consumer quality report on 2026-04-25 found a project comparing feature branches to `origin/deploy` while `/goat-review` defaulted local PR detection and fallback review to `origin/main`/`main`.

**Why it happened:** The review skill treated a common GitHub default as a universal project invariant. That leaked a goat-flow/framework assumption into consumer repositories, where the correct base may be `deploy`, `develop`, `trunk`, a release branch, or a PR-specific base returned by hosting metadata.

**Original evidence:**
- `workflow/skills/goat-review/SKILL.md` (search: `commits ahead of \`origin/main\``) makes PR-style auto-detection depend on `origin/main`.
- `workflow/skills/goat-review/SKILL.md` (search: `Base branch? (default: \`main\``) makes local PR fallback default to `main`.
- `.claude/skills/goat-review/SKILL.md` (search: `commits ahead of \`origin/main\``) shows the installed Claude mirror has the same behaviour.
- `.agents/skills/goat-review/SKILL.md` (search: `Base branch? (default: \`main\``) shows the installed Codex/agents mirror has the same behaviour.
- `.github/skills/goat-review/SKILL.md` (search: `Base branch? (default: \`main\``) shows the installed GitHub/Copilot mirror has the same behaviour.

**Resolution:** `/goat-review` now resolves PR bases by preference order instead of assuming `main`: PR metadata, explicit user base, remote default-branch discovery, then asking the user. `main` remains only a last-resort fallback with `base-detection-failed` recorded in Review Integrity.

**Resolution evidence:**
- `workflow/skills/goat-review/SKILL.md` (search: `baseRefName`) prefers PR metadata when a PR URL or number is available.
- `workflow/skills/goat-review/SKILL.md` (search: `remote HEAD`) discovers the remote default branch before asking.
- `workflow/skills/goat-review/SKILL.md` (search: `base-detection-failed`) records degraded fallback use instead of hiding it.

**Prevention:** Review-base selection must be discovered, not assumed. Prefer PR metadata (`gh pr view ... baseRefName`) when available, then an explicit user-provided base, then remote default-branch discovery from remote HEAD or `git remote show origin`; ask for the base before diffing if discovery fails. Treat `main` only as a last-resort fallback and record a degradation flag when fallback is used.

---

## Footgun: Skills have phase gates but no time/call budget for context gathering

**Status:** resolved | **Created:** 2026-04-05 | **Resolved:** 2026-04-15 | **Evidence:** ACTUAL_MEASURED

Skills enforce phase gates (Step 0 must complete before Phase 1, gates pause for human approval) but have no budget for how long Step 0 can take. Claude can spend an entire session reading templates, exploring the codebase, and gathering context without ever producing output or asking a question.

**Resolution:** Both preventions implemented in `.goat-flow/skill-docs/skill-preamble.md` (search: `## Step 0 Budget`):
1. Step 0 budget: "If Step 0 exceeds 5 file reads without producing output or asking a question, checkpoint with what you know so far."
2. Mid-Step-0 checkpointing: "Checkpoint mid-Step-0 for complex projects rather than silently reading indefinitely."

**Original evidence (historical):** Claude Insights (112 sessions) showed agents reading 20+ files in Step 0 without checkpointing, requiring user intervention to interrupt.

---

- **Workflow-summarising skill descriptions cause CSO shortcutting** (resolved 2026-04-19) - All 7 current goat-* descriptions (including the dispatcher) are compliant with the trigger-only rule ("Use when …"), not workflow summaries. The rule is enforced in `workflow/skills/playbooks/skill-quality-testing/deployment.md` (search: `CSO-optimised`). Original incident was in the external `superpowers-skills` repo; the goat-flow regression was on the dispatcher description and was rewritten the same day it was caught.
- **Dispatcher intent mapping has no coverage for analysis/evaluation verbs** (resolved 2026-04-14) - Added analysis/evaluation verbs to the dispatcher disambiguation table so ambiguous requests prompt skill selection instead of auto-routing.
- **CI template derives skill names by prefixing instead of listing them** (resolved 2026-04-14) - Removed `src/cli/prompt/fragments/` directory in v1.1.0; CI template generation no longer exists.
- **Blind mv/cp/Write can overwrite existing files** (resolved 2026-04-18) - Covered by the Never-tier no-clobber rule and destination-check guidance in the hot-path instruction files; no longer kept as an active architectural footgun.
