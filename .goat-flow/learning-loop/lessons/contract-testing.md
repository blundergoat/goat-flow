---
category: contract-testing
last_reviewed: 2026-09-01
---

**Scope:** Tests that pin a contract rather than behaviour - exact wording, path semantics, word budgets, and user-visible serialization. When the thing under test is a hook, dashboard surface, or fixture, use the bucket that owns it.

## Lesson: Reference-pack wording fixes must check word budget immediately

**Status:** active | **Created:** 2026-05-19

**Decision changed:** Run the canonical word-budget contract immediately after every skill or shared-reference wording edit.

**Trigger phase:** ACT
**Caught at:** VERIFY

**Incident count:** 31

**Latest occurrence:** 2026-09-01

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
- **2026-08-09 v1.15.1 goat-plan:** Correcting the ISSUE write target raised the 2,100-word redesign surface to 2,103. Trimming three words from an unpinned fresh-plan sentence returned it to exactly 2,100 without changing the artifact rule. Evidence: `test/contract/skill-hardening-plan-2.test.ts` (search: `redesigned goat-plan canonical surface`).
- **2026-08-17 goat-review integrity guidance:** Resolved-only integrity guidance raised the skill to 2,560 words. Compressing only the new guidance restored the cap but removed three pinned semantics: diff-path disclosure, verdict grammar, and explicit gate-evidence classification. The word-budget contract, all goat-review shards, and the shared-surface shard had to pass together. Evidence: `test/contract/skill-hardening-contracts.test.ts` (search: `functional skills stay within the 2500-word cap across all mirrors`), `test/contract/skill-hardening-review-1.test.ts` (search: `keeps area audits independent of diff-only metadata and verdicts`), and `test/contract/skill-hardening-shared-1.test.ts` (search: `classifies gate evidence without inventing changed-code causality`).
- **2026-08-24 goat-plan checker-pointer rewrite:** The first checker-pointer rewrite added three words to the near-full canonical surface. Measuring the combined reference
  pack immediately led to a tighter sentence that removed the duplicated identifier list and freed seven words without weakening the contract.
  Evidence anchor: `test/contract/skill-hardening-plan-2.test.ts` (search: `enforces current-heading length and internal identifiers`).

**Recurrence 2026-08-29:** Adding the accepted two-tier sub-agent budget to both shared convention copies raised each body from 1496 to 1539 words. The focused budget contract ran only after the aggregate fast suite, delaying attribution. The first trim then changed five redaction phrases pinned by the shared-surface contract. Applying the agent-facing writing playbook's one-owner and pruning rules around those fixed phrases removed duplicate continuity prose and restored both mirrors to 1481 words. Evidence: `test/contract/skill-hardening-contracts.test.ts` (search: `always-loaded shared references stay within the 1500-word cap`), `test/contract/skill-hardening-shared-3.test.ts` (search: `requires pre-write redaction for durable local text`), and `workflow/skills/reference/skill-conventions.md` (search: `For session, handoff`).

**Recurrence 2026-09-01:** Inserting a retrieval-cap clause into the shared READ bullet raised that line to 861-863 characters across the seven parity-checked files, and `scripts/check-instruction-parity.mjs` (search: `MAX_INSTRUCTION_LINE_CHARACTERS`) failed on its 800-character line limit - a cap no instruction file or setup template states. Contract and link checks had already passed, so parity was the only gate that saw it. Rewriting the clause to 93 characters with the same meaning restored parity at 794. Instruction files carry a third budget beyond word caps and pinned phrases: characters per line. Measure the target line before inserting, and run the parity script first when a shared section changes.

**Root cause:** Treated capped prose as tiny.

---

## Lesson: Skill compaction must preserve indexed semantic anchors

**Status:** active | **Created:** 2026-07-12

**Decision changed:** Preserve or update indexed and contract anchors during compaction; run focused contracts and `stats --check`.

**Trigger phase:** ACT
**Caught at:** VERIFY

**Incident count:** 12

**Latest occurrence:** 2026-09-05

**Prevention:** Search indexes, contracts, and tracked semantic-anchor references before changing headings or compacting prose; run focused contracts and `stats --check`; repair anchors together. Never head-cap or single-line that sweep: the pinned citation listed thirteenth, or split across a line break, is the one that breaks.

**What happened:** Eleven prose edits removed or changed durable or contract-pinned anchors:

- **2026-07-12–19:** Four compactions removed anchors; stats/contracts restored them. Evidence: `workflow/skills/reference/skill-preamble.md` (search: `Routing rule`).
- **2026-08-01:** A review-contract rollout changed pinned wording, split one code span, and removed “with R-ID”; contracts restored all. Evidence: `test/contract/skill-hardening-review-2.test.ts` (search: `gives goat-review findings stable IDs, harm, and distinct evidence axes`).
- **2026-08-09:** A prose-style pass changed `Decide First` to sentence case and broke a learning-loop semantic anchor. The midpoint content audit caught `stale-semantic-anchor`; restoring `docs/skill-authoring.md` (search: `## Decide First`) preserved the reference.
- **2026-08-09 v1.15.1 goat-critique:** The new clean-attestation contract passed within budget, but the first compaction removed four phrases pinned by the adjacent meta-rubric contract. The focused suite reported 17/18 until those phrases were restored and unpinned output-list prose paid the word cost. Evidence: `test/contract/skill-hardening-skills-2.test.ts` (search: `uses one reproducible goat-critique meta-audit rubric`).
- **2026-09-04:** M15's content audit found that ADR-006 still cited a shared-preamble phrase shortened during compaction. Updating the decision's needle to the current wording restored the semantic-anchor contract. Evidence: `.goat-flow/learning-loop/decisions/ADR-006-autonomous-skill-mode.md` (search: `an invoked skill runs its full protocol`) and `.goat-flow/skill-docs/skill-preamble.md` (search: `an invoked skill runs its full protocol`).
- **2026-09-04 release acceptance:** Consolidating a timing recurrence removed its cited `go-live M15 activation` heading fragment. `stats --check` rejected the stale inbound reference; restoring the fragment preserved the existing anchor without dropping the expanded timing rule. Evidence: `.goat-flow/learning-loop/lessons/verification-testing.md` (search: `go-live M15 activation`) and `.goat-flow/learning-loop/lessons/milestone-accounting.md` (search: `go-live M15 activation`).
- **2026-09-05 ADR concision rewrite:** Condensing 30 ADRs dropped twelve phrases pinned by contract tests or learning-loop anchors across six records: `return-to-implement` and two siblings in ADR-005, four headings and sentences in ADR-006, `A skill must have at least one of` and `explicit user acceptance for each compatibility break` in ADR-009, `Canonical agents` in ADR-020, `shipped and reverted` in ADR-037, and `exec form` in ADR-053. The pre-rewrite sweep found 14 anchors and missed these because its grep was capped at 12 lines and single-line. `stats --check` and the three ADR-reading contracts caught every one, and all were restored verbatim. Evidence: `.goat-flow/learning-loop/decisions/ADR-009-skill-consolidation.md` (search: `explicit user acceptance for each compatibility break`) and `test/contract/skill-hardening-clarity.test.ts` (search: `keeps the accepted clarity authority aligned`).

**Root cause:** Edited prose carried durable external anchors.

---

## Lesson: Source-regex dashboard tests must tolerate formatter reflow

**Status:** active | **Created:** 2026-05-11

**Prevention:** After changing source-grep tests for dashboard classic scripts, run Prettier before the focused test rerun. If a regex only protects structure, make whitespace flexible enough for formatter reflow or use a small VM helper test instead.

**What happened:** During the dashboard terminal paste-submission fix, focused `test/unit/dashboard-terminal-launch.test.ts` first passed. After Prettier formatted the touched files, the rerun failed only because the "warms xterm" source assertion expected a multi-line `if` block shape that Prettier collapsed into one line. The runtime behavior was still correct; the test was over-specified to formatting.

**Root cause:** A classic-script source grep test used a whitespace-sensitive regex to assert control-flow structure. Formatter reflow changed the syntax layout without changing semantics.

**Fix:** Keep source-regex tests focused on semantic tokens and tolerate formatter-owned whitespace. Evidence anchors: `test/unit/dashboard-terminal-launch/launch-flow-06.test.ts` (search: `warms xterm when the workspace or setup view opens`), `src/dashboard/dashboard-app-init.ts` (search: `view === "workspace" || view === "setup"`).

**Recurrence (2026-08-14):** A new Gruff D6 assertion preserved the intended qualifier order but required a literal space between `non-obvious` and `contract`; Markdown wrapping inserted a newline and left correct prose RED. Allowing whitespace only at that gap kept the semantic boundary pinned without owning layout. Evidence anchor: `test/contract/comment-playbook-doctrine.test.ts` (search: `file\\/module\\/class boundary has a non-obvious\\s+contract`).

**Recurrence 2026-05-12:** While self-hosting xterm assets, `test/integration/dashboard-server.test.ts` fetched `/assets/xterm.js` successfully but failed because the assertion looked for `XTerm`, a string not present in the minified upstream bundle. The route was correct; the test anchor was wrong. For vendored/minified assets, assert route status/content type and stable feature strings observed in the actual bundle, such as `bracketedPasteMode`, not package names or branding text.

**Recurrence 2026-05-16:** While moving setup instruction surfaces into manifest-backed agent capabilities, full `npm test` failed because a source-grep prompt test still asserted literal `CLAUDE.md, .claude/settings.json` strings in `dashboard-setup-quality.ts`. The product change was correct; the test had become a stale parallel authority. For manifest-backed refactors, update source-grep tests to assert the data boundary (`workflow/manifest.json` plus injected fields) instead of the old duplicated literals.

**Recurrences 2026-05-27 and 2026-05-31:** `npx prettier --check` flagged touched dashboard classic-script test files - `test/unit/dashboard-terminal-launch.test.ts` after long fake-timer assertions (paste-submit hardening in `src/dashboard/dashboard-terminal.ts`), then `test/unit/dashboard-terminal-launch/helpers.ts` after a rename's source-list edit. Running Prettier on the touched files before the focused rerun fixed both. Prevention unchanged: format changed dashboard classic-script tests before claiming verification complete.
---

## Lesson: Config mergers must preserve user-visible serialization

**Status:** active | **Created:** 2026-08-12

**Decision changed:** Compare both parsed state and serialized output when replacing migration logic, and seed compatibility proof through the predecessor producer when it remains callable.

**Trigger phase:** ACT | **Caught at:** VERIFY
**Incident count:** 2 | **Latest occurrence:** 2026-08-27

**Prevention:** When migrating serialized state, reproduce its whitespace, trailing newline, key shape, and ordering contract as well as parsed semantics. Drive at least one compatibility fixture through the supported predecessor writer instead of rebuilding its output from the new reader's assumptions.

**What happened:** The generated desired-state merger produced semantically correct Codex hooks but wrote minified JSON. The focused installer matrix failed two user-visible formatting assertions, including the expected `"timeout": 90` form.

**Root cause:** I reused compact serialization for both semantic equality and the final file write, overlooking the installer's established two-space JSON output.

**Fix:** Keep compact JSON only for before/after comparison and pretty-print the user file. Evidence anchors: `workflow/install-goat-flow.sh` (search: `JSON.stringify(currentConfig, null, 2)`) and `test/integration/setup-install-agent-matrix.test.ts` (search: `timeout\": 90`).

**Recurrence 2026-08-27:** The first v2 bootstrap fixture rebuilt small v1 files in an order that happened to satisfy the new UTF-8 canonicalizer. The production v1 writer orders its complete path set with `localeCompare`; a direct writer-to-facade reproduction returned `malformed-blocking` for every agent shape checked. The correction preserves parsed v1 row order during byte normalization, then applies UTF-8 sorting only to the virtual v2 state. Evidence anchors: `src/cli/managed-setup-state.ts` (search: `V1 predates UTF-8 canonical ordering`) and `test/unit/managed-setup-preview.test.ts` (search: `bootstraps a baseline written by the v1 state writer`).

---

## Lesson: Retire shared contract vocabulary only after predecessor consumers migrate

**Status:** active | **Created:** 2026-08-27

**Decision changed:** Stop emitting predecessor-only values at the new boundary first; narrow a shared type only after every producer and consumer has migrated.

**Trigger phase:** SCOPE | **Caught at:** VERIFY

**Prevention:** Before narrowing an exported union during a staged migration, search every producer and consumer. Keep predecessor-only members available to unmigrated internals while making the new public boundary use only its replacement vocabulary.

**What happened:** The first v2 status-union migration removed `"invalid"` from `ManagedSetupBaselineStatus` while the v1 state reader still returned it and admission still compared against it. TypeScript rejected both predecessor consumers. The correction retained `"invalid"` as an internal compatibility member while the v2 preview reports the granular replacement statuses and never emits it.

**Recurrence 2026-08-28:** Task 8 migrated the final direct per-agent reader, after which Knip proved that no module imported the status union. The union and its `"invalid"` compatibility member remain module-local because preview and admission still classify that conservative internal state; only the obsolete export was retired. Run the exact consumer search and Knip immediately after the final import disappears, then refresh durable anchors in the same slice.

**Root cause:** I changed the shared type at the migrated producer boundary without first accounting for consumers that still owned predecessor behavior.

**Evidence anchors:** `src/cli/managed-setup-preview.ts` (search: `type ManagedSetupBaselineStatus`), `src/cli/managed-setup-preview.ts` (search: `baselineStatus === "invalid"`), and `src/cli/managed-setup-admission.ts` (search: `baselineStatus === "invalid"`).

---

## Lesson: Regressions caught too late - tests run at milestone granularity, not edit granularity

**Status:** active | **Created:** 2026-04-05

**Prevention:**
1. Consider an optional post-write hook that runs the project's test command after file changes (configured via `config.yaml`, off by default)
2. Add a "run tests" checkpoint every N edits to skills with implementation phases, not just at phase boundaries
3. For test-heavy projects (1000+ tests), a focused test subset (changed files only) avoids the full-suite penalty while still catching regressions early
4. Treat an explicit mid-implementation proof as a write boundary: stop later edits until the named focused slice is green.
---

**What happened:** Claude Insights reported 68 buggy-code friction events across 112 sessions (61% of sessions had at least one). The `/goat-qa` skill generates test plans after implementation, and `stop-lint.sh` used to run linting after every turn before its removal from goat-flow core per ADR-037, but neither caught logic regressions mid-implementation. Tests only run when the user explicitly asks or when a milestone completes. Regressions introduced in turn 3 of a 10-turn implementation aren't caught until the end, when the debugging context is stale.

**Recurrence (2026-08-14):** During comment-doctrine work, reader/layer and defect-vocabulary edits crossed a declared focused-test checkpoint before the earlier width/branch slice was proven green. The later edits were rewound and resumed only after the intended contract slice passed. Evidence anchor: `test/contract/comment-playbook-doctrine.test.ts` (search: `treats 150 as a ceiling instead of a width target`).

**Root cause:** The verification loop runs at the wrong granularity. Lint after every turn catches syntax. Tests after every milestone catch logic. The gap between these two is where regressions hide.

## Lesson: Semantic drift checks must normalize natural-language lists before claiming mismatch

**Status:** active | **Created:** 2026-04-18

**Prevention:**
1. When adding semantic drift checks for prose, test both a known-bad example and the current canonical wording.
2. Normalize natural-language list glue (`and`, Oxford commas, surrounding whitespace) before comparing against code-backed enumerations.
3. Treat a new drift rule that immediately flags corrected docs as a checker bug until the parser is disproven.

**What happened:** A new semantic-drift check was added for the runner list in `docs/dashboard.md`. The first verification run still failed content audit even after the doc was corrected to "Claude, Codex, and Gemini". The checker split on commas before handling the Oxford-comma `and`, so it parsed the claim as `["Claude", "Codex", "and Gemini"]` and reported a false mismatch against the manifest-backed list.

**Root cause:** The drift check compared human-written prose too literally. It handled exact token matches but not natural-language list formatting, so a doc that was semantically correct still failed verification. The bug was in the checker, not in the docs.

**Fix:** Normalize list items before comparison by stripping a leading `and ` token after the split, then add a regression test that proves the current dashboard wording does not trigger `dashboard-runner-drift`.

---

## Lesson: Filtered manifest ids still need explicit indexed-lookup proof in TypeScript

**Status:** active | **Created:** 2026-04-21

**Prevention:**
1. After refactoring manifest/registry code that filters ids and then indexes a `Record`, run `npm run typecheck` even if the focused unit tests already pass.
2. When a helper signature or typed callback changes in a touched `.ts` file, include `prettier --check` or `prettier --write` in the focused verification pass before closeout.
---

**What happened:** A manifest-backed registry cleanup reused one `loadManifest().agents` snapshot per public call and filtered configured ids with `isKnownAgentId()`. The focused unit tests passed, but the first `npm run typecheck` still failed on the follow-up mapping step because `agents[id]` was treated as possibly `undefined` inside `.map((id) => toRuntimeProfile(id, agents[id]))`. The same verification pass also caught a Prettier reflow issue in the touched registry file.

**Root cause:** Runtime truth from a filter callback does not always carry through to a later indexed `Record<string, T>` lookup strongly enough for TypeScript to discharge `undefined`. The refactor was logically correct, but the type proof at the final lookup site was incomplete. Formatting drift surfaced because the new helper signature changed line wrapping and the file had not yet been reflowed.

**Fix:** Add the explicit proof at the indexed lookup site (`agents[id]!` or a typed-entry helper), run Prettier on the touched TypeScript file, and rerun the exact failing gates.

**Recurrence 2026-07-04:** While addressing PR #54 review feedback, the first
`npm run typecheck` caught `TS4104` after `classifyProjectState` assigned the
readonly result of `getSkillNames()` to a mutable `string[]`. The fix was to
keep the manifest-derived list readonly through the local variable and helper
parameter. Evidence anchor: `src/cli/classify-state.ts` (search: `let canonicalSkills: readonly string[]`).

## Lesson: Semantic prose contracts must bind to the owned section

**Status:** active | **Created:** 2026-08-14

**Decision changed:** Make semantic wording assertions case-insensitive unless casing is the contract, and bound shared files to the exact owned section, object, or fence.

**Trigger phase:** ACT | **Incident count:** 7 | **Latest occurrence:** 2026-08-29
**Caught at:** VERIFY

**Prevention:**
1. Treat capitalization as formatter or prose presentation unless exact casing is itself the contract.
2. Extract the narrowest semantic owner: a fenced template, named section, or explicit object set.
3. Keep unrelated sibling content outside neutrality and doctrine assertions.
4. Rerun the focused contract before expanding verification.
5. When a downstream check counts prose records, define canonical values in the producer and normalize only presentation wrappers; do not infer identity from unconstrained display text.
6. In sentence-bounded prose regexes, tolerate Markdown whitespace and grammatical inflection that do not carry policy; keep the semantic actors, action, and boundary pinned.
---

**What happened:** The first partial GREEN for test-selection rejected correct prose because heading and table capitalization differed; it also stopped a template block at a nested heading before its records and scanned an entire shared preset catalog instead of the four owned prompts. Evidence anchors: `test/contract/test-selection-playbook-doctrine.test.ts` (search: `function templateBlock`) and (search: `affectedPresetIds`).

**Recurrence (2026-08-14):** The first portability sweep repeated the shared-container mistake by scanning every complete ledger file. It stopped on an older absolute path in the generated lessons index, while the local milestone necessarily contained the deny patterns it documented. The corrected proof keeps ledger existence exhaustive but binds residue assertions to the redacted receipts, new doctrine, byte-identical catalog mirror, and exact QA-facing owner slices. Evidence anchor: `test/contract/test-selection-playbook-doctrine.test.ts` (search: `test-selection source neutrality`).

**Recurrence (2026-08-14):** The first playbook-precedence GREEN rejected three correct fallback clauses because the semantic matcher accepted singular `default` but not plural `defaults`. The doctrine was present; the contract owned incidental morphology. Expanding only that token to `defaults?` restored semantic variation without weakening the bounded authority checks. A sentence-level sweep then found an identical protected-boundary sentence in three disciplines; varying those sentences kept the shared meaning without turning one formulation into policy. Evidence anchor: `test/contract/playbook-precedence-doctrine.test.ts` (search: `generic fallback is not bounded`).

**Recurrence (2026-08-14):** The first unsafe-authority sweep searched every playbook for `This playbook owns` and rejected valid discipline routing in `writing-human-facing-prose.md` plus an out-of-scope hook playbook. The corrected sweep inspects precedence direction inside the eight target disciplines and keeps unrelated ownership statements outside the semantic owner. Evidence anchor: `workflow/skills/playbooks/writing-human-facing-prose.md` (search: `Sibling playbooks own`).

**Recurrence (2026-08-15):** Goat-clarity's first-use cardinality proof expected literal lowercase agent and selector IDs, while the receipt template allowed a free-form integration name and accepted invocation. Real agents emitted values such as `Codex`, `uncommitted files`, and Markdown-emphasized labels, so a complete receipt could never satisfy its consumer. The correction makes canonical IDs part of the producer contract and lets the scanner ignore optional emphasis without weakening the values. Evidence anchors: `workflow/skills/goat-clarity/SKILL.md` (search: `Agent: <claude | codex | antigravity | copilot>`) and `test/contract/skill-hardening-clarity.test.ts` (search: `Selector: <github-pr | uncommitted | paths>`; the selector kinds collapsed to `paths` on 2026-08-19 when path lists became one selector).

**Recurrence (2026-08-17):** New goat-clarity disposition contracts first rejected correct Markdown wrapping at `uncertain identity` and `bound comparison baseline`, while an older literal assertion rejected the grammatical change from `keep` to `keeps`. The correction made whitespace flexible only inside the same bounded sentence and aligned the existing phrase pin with the producer without weakening the replacement-coverage requirement. Evidence anchors: `test/contract/test-selection-playbook-doctrine.test.ts` (search: `rename-shaped pair with uncertain\\s+identity`) and `test/contract/skill-hardening-clarity.test.ts` (search: `keeps the original until replacement coverage passes`).

**Recurrence (2026-08-29):** A preflight contract used one greedy file-wide regex to require `instruction-files`, `new Set`, and `instruction_file`. Replacing the owned mode body with `process.exit(0)` still matched those tokens in later sibling modes, so the test could pass after deduplication was removed. The correction locates the exact `instruction-files` mode boundaries, slices only that owner, and asserts the deduplication tokens inside it. Evidence anchor: `test/contract/command-phrases.test.ts` (search: `instruction-files must remain a bounded manifest mode`).

**Root cause:** The contract parser treated presentation boundaries and a shared container as the semantic owner, or expected canonical values that the producer never promised. The assertions therefore coupled correct doctrine to incidental casing, Markdown nesting, unrelated sibling content, and free-form labels.

**Fix:** Use case-insensitive semantic regular expressions, bound template extraction to its code fence, inspect only the named prompt objects owned by the change, define machine-counted values in the producer, normalize presentation-only wrappers, and separate exhaustive path-existence proof from content checks over exact semantic owners.
