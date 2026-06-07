---
category: naming
last_reviewed: 2026-05-31
---

## Lesson: Boundary payload names are not placeholder debt

**Status:** active | **Created:** 2026-05-30

**What happened:** During the M00 gruff cleanup, `naming.identifier-quality` reported 124 advisory findings. Most were `value` or `data` in decoders, validators, event readers, and safe JSON boundary code where the symbol intentionally represents an unknown inbound payload.

**Root cause:** The default placeholder list treats `value`, `data`, and `item` as generic local names. That is useful in business logic, but too broad for goat-flow's boundary-heavy code, where validators often start with unknown input and narrow it by shape.

**Prevention:** Keep `.gruff-ts.yaml` `placeholderNames` focused on throwaway placeholders (`foo`, `bar`, `baz`, `tmp`, `temp`, `thing`, `stuff`). Rename numbered or domain-ambiguous symbols case-by-case, but do not churn boundary validators away from `value` or `data` unless the narrower domain is already known. Evidence anchors: `.gruff-ts.yaml` (search: `placeholderNames`), `.goat-flow/plans/1.9.0/M00-gruff-ts-cleanup.md` (search: `naming.identifier-quality`).

---

## Lesson: Accept abbreviations only when the domain is obvious

**Status:** active | **Created:** 2026-05-30

**What happened:** The M00 short-variable pass found a mix of real rename targets (`r`, `af`, `a`, `b`, `m`) and project-standard abbreviations (`md`, `ws`, `fd`, `ms`, `tc`, `rl`). Renaming all short symbols would have created churn, while accepting every one-letter test local would have hidden unclear code.

**Root cause:** `naming.short-variable` is intentionally syntax-local. It cannot distinguish a throwaway `r` from a conventional `ws` WebSocket handle or `md` Markdown renderer without project vocabulary.

**Prevention:** Keep `.gruff-ts.yaml` `acceptedAbbreviations` limited to domain-standard two-letter terms, and rename concentrated one-letter locals where a clearer name is obvious. Do not add broad one-letter names such as `r`, `a`, `b`, or `m` to the allowlist. Evidence anchors: `.gruff-ts.yaml` (search: `repo-standard short names`), `.goat-flow/plans/1.9.0/M00-gruff-ts-cleanup.md` (search: `naming.short-variable`).

---

## Lesson: One-letter rename sweeps can corrupt regex flags

**Status:** active | **Created:** 2026-05-30

**What happened:** During the M00 short-variable pass, a mechanical `m`→`manifestJson` word-boundary rewrite in `test/unit/manifest.test.ts` also rewrote the `m` regex flag on manifest markdown assertions. The focused TypeScript test caught the syntax break before the milestone moved on.

**Root cause:** Word-boundary replacement is not safe for one-letter identifiers in TypeScript source because regex flags, string literals, and other syntax-adjacent one-letter tokens can also sit on word boundaries.

**Prevention:** For one-letter identifiers, inspect the local AST-shaped context or use a narrower pattern such as `const m =` plus explicit call-site replacements. Always run the focused test after the rename and before expanding the rename pattern to other files. Evidence anchors: `test/unit/manifest.test.ts` (search: `renderManifestMarkdown`), `.goat-flow/plans/1.9.0/M00-gruff-ts-cleanup.md` (search: `naming.short-variable`).

---

## Lesson: Boolean state prefixes differ from domain flags

**Status:** active | **Created:** 2026-05-30

**What happened:** During the M00 boolean-prefix pass, gruff reported 156 advisory findings across dashboard state, CLI flags, hook JSON, setup-detect DTOs, and tests. Many were not ambiguous booleans; they mirrored persisted JSON or operator flags such as `show*`, `loading*`, `fresh`, `verbose`, `enabled`, `instructionsPathScoped`, and `customPromptSubmitAttempted`.

**Root cause:** `naming.boolean-prefix` enforces an `is/has/can`-style grammar, but goat-flow has two other boolean naming grammars: UI state (`show*`, `loading*`, `selected*`, `terminal*`) and CLI/API flag names that intentionally match query params, JSON fields, or argv switches. Renaming those mechanically would make boundary code less traceable.

**Prevention:** Keep `.gruff-ts.yaml` `booleanPrefixes` extended for camelCase state and protocol prefixes used across dashboard and CLI surfaces. Do not use the prefix list to hide exact lowercase flag names; those remain fix-or-baseline candidates because gruff's prefix matcher requires an uppercase boundary after the prefix. Evidence anchors: `.gruff-ts.yaml` (search: `dashboard state and CLI option DTOs`), `.goat-flow/plans/1.9.0/M00-gruff-ts-cleanup.md` (search: `naming.boolean-prefix`).

---

## Lesson: Test-file rename sweeps need a focused test rerun

**Status:** active | **Created:** 2026-05-31

**What happened:** During the gruff cleanup, a local `c`→`concern` rename in `test/unit/audit-command.test.ts` updated the first two assertions but left three later `c.*` references in the same loop. `npm run typecheck` completed with exit code 0 because the repo typecheck does not cover test files, and `npm test` later failed with `ReferenceError: c is not defined`.

**Root cause:** I treated the rename as a simple local cleanup and relied on source typecheck before running the touched test. The old identifier was still valid JavaScript syntax, so only executing the test surfaced the missed references.

**Prevention:** After renaming identifiers inside test files, run a focused test for the touched file before the full suite, and grep the local block for the old identifier when it is not too generic. Evidence anchors: `test/unit/audit-command/json-contract.test.ts` (search: `has correct shape for harness mode`), failing output (search: `ReferenceError: c is not defined`).
