---
category: contract-testing
last_reviewed: 2026-08-04
---

## Lesson: Reference-pack wording fixes must check word budget immediately

**Status:** active | **Created:** 2026-05-19

**Decision changed:** Run the canonical word-budget contract immediately after every skill or shared-reference wording edit.

**Trigger phase:** VERIFY

**Incident count:** 24

**Latest occurrence:** 2026-08-04

**What happened:** Repeated wording edits and learning captures crossed caps. Unless noted, the gate is `test/contract/skill-hardening-contracts.test.ts`:

- **2026-05-19/22:** TDD packs 3022/3008 words, preamble over 1500, QA over 2578 (search: `progressive reference packs stay within the 3000-word cap per file`).
- **2026-06-14:** Dispatcher 653/555 - `workflow/skills/goat/SKILL.md` (search: `Emit a Route Snapshot`).
- **2026-07-12 M33:** `verification-preflight.md` hit 40KB - `scripts/preflight-checks.sh` (search: `Learning-Loop Schema`).
- **2026-07-12 boundary rollout:** Plan/QA 2503/2524 while a bad delimiter count said 1202 (search: `Counts user-facing skill guidance without YAML frontmatter`).
- **2026-07-12 M15:** Plan 2533 - `workflow/skills/goat-plan/SKILL.md` (search: `Handoff-grade artifacts`).
- **2026-07-13 M13:** Shared references 1560/1601, compacted to 1484/1490 (search: `always-loaded shared references stay within the 1500-word cap`).
- **2026-07-16 PR #56:** Goat/plan/preamble/TDD 597/2689/1540/3021; compaction also repaired stale assertions (search: `requires pre-write redaction for durable local text`).
- **2026-07-17–19, 2026-08-01 review hardening, 2026-08-02 PR #57:** QA, plan, review, preamble, and dispatcher edits repeatedly reached 2506–2762 / 1514 / 579 words; focused contracts restored every surface before mirror sync (search: `functional skills stay within the 2500-word cap across all mirrors`).
- **2026-08-01 M03:** A new lesson pushed this bucket to 40KB; narrower routing and recurrence consolidation restored it - `src/cli/stats/stats.ts` (search: `rule: "bucket-size"`).
- **2026-08-02 PR #57 CI:** `verification-preflight.md` reached 40,415 bytes and failed the merge build - the round-trip installer fixture runs preflight inside a temp install. Local `stats --check` had flagged it for days as an accepted baseline. Buckets gate the build.
- **2026-08-03 v1.15 ship hardening:** Unifying goat-critique's meta-audit rubric left every mirrored SKILL.md at exactly 2,500 words, so the focused contract failed until the new pointer was compacted. Evidence anchor: `test/contract/skill-hardening-contracts.test.ts` (search: `uses one reproducible goat-critique meta-audit rubric`).
- **2026-08-03 goat-review base clause:** A one-clause scope fix added 23 words to a skill sitting at 2,498/2,500 and simultaneously reworded away a contract-pinned literal, so two contracts failed at once (search: `stops oversized inferred branch scopes before review begins`). Wording edits have two budgets, not one: the word cap AND the exact phrases contracts assert. Measure headroom and grep `test/` for the phrases being reworded BEFORE editing; when headroom is one word, attach the change to an unpinned line and pay for it with a same-line trim.
- **2026-08-04 goat-review mutation vocabulary:** Synchronizing the five shared mutation verbs pushed the root skill to 2,506 words. The first compaction then removed the exact Spec Drift phrase pinned at `test/contract/skill-hardening-contracts.test.ts` (search: `keeps an unselected optional Spec Drift pass out of review degradation`). Restoring the pinned phrase and compacting unpinned optional-output prose returned the focused run to 3/3 pass; the iteration is recorded in `.goat-flow/logs/sessions/2026-08-04-goat-review-tdd.md`.

**Root cause:** Treated capped prose as tiny.

**Prevention:** Run `node --import tsx --test test/contract/skill-hardening-contracts.test.ts` after each edit; compact before expanding scope. Check bucket headroom first; several sit within tens of bytes of the 40,000-byte gate.

---

## Lesson: Skill compaction must preserve indexed semantic anchors

**Status:** active | **Created:** 2026-07-12

**Decision changed:** Preserve or update indexed and contract anchors during compaction; run focused contracts and `stats --check`.

**Trigger phase:** VERIFY

**Incident count:** 7

**Latest occurrence:** 2026-08-01

**What happened:** Seven compactions removed durable or contract-pinned anchors:

- **2026-07-12–19:** Four compactions removed anchors; stats/contracts restored them. Evidence: `workflow/skills/reference/skill-preamble.md` (search: `Routing rule`).
- **2026-08-01:** M02/M03 changed pinned wording, split one code span, and removed “with R-ID”; contracts restored all. Evidence: `test/contract/skill-hardening-contracts.test.ts` (search: `gives goat-review findings stable IDs, harm, and distinct evidence axes`).

**Root cause:** Compacted prose had durable external anchors.

**Prevention:** Search indexes/contracts before compaction; run focused contracts and `stats --check`; repair anchors together.

---

## Lesson: Source-regex dashboard tests must tolerate formatter reflow

**Status:** active | **Created:** 2026-05-11

**What happened:** While fixing dashboard terminal paste submission, focused `test/unit/dashboard-terminal-launch.test.ts` first passed. After formatting touched files, the rerun failed only because the "warms xterm" source assertion expected a multi-line `if` block shape that Prettier collapsed into one line. The runtime behavior was still correct; the test was over-specified to formatting.

**Root cause:** A classic-script source grep test used a whitespace-sensitive regex to assert control-flow structure. Formatter reflow changed the syntax layout without changing semantics.

**Fix:** Keep source-regex tests focused on semantic tokens and tolerate formatter-owned whitespace. Evidence anchors: `test/unit/dashboard-terminal-launch/launch-flow-06.test.ts` (search: `warms xterm when the workspace or setup view opens`), `src/dashboard/dashboard-app-init.ts` (search: `view === "workspace" || view === "setup"`).

**Prevention:** After changing source-grep tests for dashboard classic scripts, run Prettier before the focused test rerun. If a regex only protects structure, make whitespace flexible enough for formatter reflow or use a small VM helper test instead.

**Recurrence 2026-05-12:** While self-hosting xterm assets, `test/integration/dashboard-server.test.ts` fetched `/assets/xterm.js` successfully but failed because the assertion looked for `XTerm`, a string not present in the minified upstream bundle. The route was correct; the test anchor was wrong. For vendored/minified assets, assert route status/content type and stable feature strings observed in the actual bundle, such as `bracketedPasteMode`, not package names or branding text.

**Recurrence 2026-05-16:** While moving setup instruction surfaces into manifest-backed agent capabilities, full `npm test` failed because a source-grep prompt test still asserted literal `CLAUDE.md, .claude/settings.json` strings in `dashboard-setup-quality.ts`. The product change was correct; the test had become a stale parallel authority. For manifest-backed refactors, update source-grep tests to assert the data boundary (`workflow/manifest.json` plus injected fields) instead of the old duplicated literals.

**Recurrences 2026-05-27 and 2026-05-31:** `npx prettier --check` flagged touched dashboard classic-script test files - `test/unit/dashboard-terminal-launch.test.ts` after long fake-timer assertions (paste-submit hardening in `src/dashboard/dashboard-terminal.ts`), then `test/unit/dashboard-terminal-launch/helpers.ts` after a rename's source-list edit. Running Prettier on the touched files before the focused rerun fixed both. Prevention unchanged: format changed dashboard classic-script tests before claiming verification complete.
---

## Lesson: Regressions caught too late - tests run at milestone granularity, not edit granularity

**Status:** active | **Created:** 2026-04-05

**What happened:** Claude Insights reported 68 buggy-code friction events across 112 sessions (61% of sessions had at least one). The `/goat-qa` skill generates test plans after implementation, and `stop-lint.sh` used to run linting after every turn before its removal from goat-flow core per ADR-015, but neither caught logic regressions mid-implementation. Tests only run when the user explicitly asks or when a milestone completes. Regressions introduced in turn 3 of a 10-turn implementation aren't caught until the end, when the debugging context is stale.

**Root cause:** The verification loop runs at the wrong granularity. Lint after every turn catches syntax. Tests after every milestone catch logic. The gap between these two is where regressions hide.

**Prevention:**
1. Consider an optional post-write hook that runs the project's test command after file changes (configured via `config.yaml`, off by default)
2. Skills with implementation phases should include a "run tests" checkpoint every N edits, not just at phase boundaries
3. For test-heavy projects (1000+ tests), a focused test subset (changed files only) avoids the full-suite penalty while still catching regressions early
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

## Lesson: Filtered manifest ids still need explicit indexed-lookup proof in TypeScript

**Status:** active | **Created:** 2026-04-21

**What happened:** A manifest-backed registry cleanup reused one `loadManifest().agents` snapshot per public call and filtered configured ids with `isKnownAgentId()`. The focused unit tests passed, but the first `npm run typecheck` still failed on the follow-up mapping step because `agents[id]` was treated as possibly `undefined` inside `.map((id) => toRuntimeProfile(id, agents[id]))`. The same verification pass also caught a Prettier reflow issue in the touched registry file.

**Root cause:** Runtime truth from a filter callback does not always carry through to a later indexed `Record<string, T>` lookup strongly enough for TypeScript to discharge `undefined`. The refactor was logically correct, but the type proof at the final lookup site was incomplete. Formatting drift surfaced because the new helper signature changed line wrapping and the file had not yet been reflowed.

**Fix:** Add the explicit proof at the indexed lookup site (`agents[id]!` or a typed-entry helper), run Prettier on the touched TypeScript file, and rerun the exact failing gates.

**Recurrence 2026-07-04:** While addressing PR #54 review feedback, the first
`npm run typecheck` caught `TS4104` after `classifyProjectState` assigned the
readonly result of `getSkillNames()` to a mutable `string[]`. The fix was to
keep the manifest-derived list readonly through the local variable and helper
parameter. Evidence anchor: `src/cli/classify-state.ts` (search: `let canonicalSkills: readonly string[]`).

**Prevention:**
1. After refactoring manifest/registry code that filters ids and then indexes a `Record`, run `npm run typecheck` even if the focused unit tests already pass.
2. When a helper signature or typed callback changes in a touched `.ts` file, include `prettier --check` or `prettier --write` in the focused verification pass before closeout.
---
