---
category: naming
last_reviewed: 2026-08-31
---

**Scope:** Renaming and naming identifiers under an analyzer - which names are real placeholders, which abbreviations the project accepts, and what a mechanical rename sweep breaks. Running the analyzer itself is [gruff-cleanup.md](gruff-cleanup.md); what a split or rename breaks downstream is [refactor-fallout.md](refactor-fallout.md).
## Lesson: Boundary payload names are not placeholder debt

**Status:** active | **Created:** 2026-05-30

**Prevention:** Keep `.gruff-ts.yaml` `placeholderNames` focused on throwaway placeholders (`foo`, `bar`, `baz`, `tmp`, `temp`, `thing`, `stuff`). Rename numbered or domain-ambiguous symbols case-by-case, but do not churn boundary validators away from `value` or `data` unless the narrower domain is already known. Evidence anchors: `.gruff-ts.yaml` (search: `placeholderNames`).

**What happened:** During the M00 gruff cleanup, `naming.identifier-quality` reported 124 advisory findings. Most were `value` or `data` in decoders, validators, event readers, and safe JSON boundary code where the symbol intentionally represents an unknown inbound payload.

**Root cause:** The default placeholder list treats `value`, `data`, and `item` as generic local names. That is useful in business logic, but too broad for goat-flow's boundary-heavy code, where validators often start with unknown input and narrow it by shape.

---

## Lesson: Accept abbreviations only when the domain is obvious

**Status:** active | **Created:** 2026-05-30

**Prevention:** Keep `.gruff-ts.yaml` `acceptedAbbreviations` limited to domain-standard two-letter terms, and rename concentrated one-letter locals where a clearer name is obvious. Do not add broad one-letter names such as `r`, `a`, `b`, or `m` to the allowlist. Evidence anchors: `.gruff-ts.yaml` (search: `acceptedAbbreviations:`).

**What happened:** The M00 short-variable pass found a mix of real rename targets (`r`, `af`, `a`, `b`, `m`) and project-standard abbreviations (`md`, `ws`, `fd`, `ms`, `tc`, `rl`). Renaming all short symbols would have created churn, while accepting every one-letter test local would have hidden unclear code.

**Root cause:** `naming.short-variable` is intentionally syntax-local. It cannot distinguish a throwaway `r` from a conventional `ws` WebSocket handle or `md` Markdown renderer without project vocabulary.

---

## Lesson: One-letter rename sweeps can corrupt regex flags

**Status:** active | **Created:** 2026-05-30

**Prevention:** For one-letter identifiers, inspect the local AST-shaped context or use a narrower pattern such as `const m =` plus explicit call-site replacements. Always run the focused test after the rename and before expanding the rename pattern to other files. Evidence anchors: `test/unit/manifest.test.ts` (search: `renderManifestMarkdown`).

**What happened:** During the M00 short-variable pass, a mechanical `m`→`manifestJson` word-boundary rewrite in `test/unit/manifest.test.ts` also rewrote the `m` regex flag on manifest markdown assertions. The focused TypeScript test caught the syntax break before the milestone moved on.

**Root cause:** Word-boundary replacement is not safe for one-letter identifiers in TypeScript source because regex flags, string literals, and other syntax-adjacent one-letter tokens can also sit on word boundaries.

---

## Lesson: Boolean state prefixes differ from domain flags

**Status:** active | **Created:** 2026-05-30

**Prevention:** Use `.gruff-ts.yaml` `acceptedBooleanNames` for exact boundary flags and reserve `booleanPrefixes` for genuine project-wide prefix grammar. Do not use the prefix list to hide exact lowercase flag names because gruff requires an uppercase boundary after a prefix. Evidence anchors: `.gruff-ts.yaml` (search: `acceptedBooleanNames:`), `.gruff-ts.yaml` (search: `booleanPrefixes:`).

**What happened:** During the M00 boolean-prefix pass, gruff reported 156 advisory findings across dashboard state, CLI flags, hook JSON, setup-detect DTOs, and tests. Many were not ambiguous booleans; they mirrored persisted JSON or operator flags such as `show*`, `loading*`, `fresh`, `verbose`, `enabled`, `instructionsPathScoped`, and `customPromptSubmitAttempted`.

**Root cause:** `naming.boolean-prefix` enforces an `is/has/can`-style grammar, but goat-flow has two other boolean naming grammars: UI state (`show*`, `loading*`, `selected*`, `terminal*`) and CLI/API flag names that intentionally match query params, JSON fields, or argv switches. Renaming those mechanically would make boundary code less traceable.

---

## Lesson: Test-file rename sweeps need a focused test rerun

**Status:** active | **Created:** 2026-05-31
**Decision changed:** Anchor a local test rename to its unique test case, then inspect the exact diff and symbol occurrences before running that file.
**Trigger phase:** ACT
**Incident count:** 6 | **Latest occurrence:** 2026-08-31

**Prevention:** Anchor a test-file rename to a unique test title or declaration, then inspect the diff and remaining symbol occurrences.
Run the focused file before the full suite.
Also run `node --import tsx src/cli/cli.ts stats --check` when a changed name or comment may be a learning-loop evidence anchor.

**What happened:** A gruff cleanup renamed a local `c` to `concern` in the audit-command unit test, since split into `test/unit/audit-command/`, but left three later `c.*` references.
Source typecheck exited 0 because it does not cover test files; `npm test` later failed with `ReferenceError: c is not defined`.

**Root cause:** I treated the rename as local cleanup and relied on source typecheck before running the touched test.
The old identifier remained valid JavaScript syntax, so only executing the test exposed the missed references.

Evidence anchor: `test/unit/audit-command/json-contract.test.ts` (search: `has correct shape for harness mode`).

**Recurrence 2026-08-02:** A gruff cleanup renamed fixture tables and split looped assertions into named test cases.
Typecheck, focused tests, and gruff were green, but `npm test` failed because two learning-loop anchors still used the old names.
`stats --check` exposed the stale anchors; the sweep was incomplete even though the code checks were green.

**Recurrence 2026-08-18:** Comment and identifier rewrites caused the same stale-anchor failure twice in one session.
Focused checks were green, but `test/unit/support-bundle.test.ts` failed because its embedded audit runs `stats --check`.
Keep a cited comment substring or update its learning-loop entry in the same change; do the same for renamed identifiers.

**Recurrence 2026-08-31:** An under-anchored `selection`→`selectedContext` patch matched earlier declarations instead of the new test twice.
Diff inspection exposed both wrong edits; the correction used the unique test title as its patch anchor and reran the complete file.
Evidence anchor: `test/unit/learning-loop-context.test.ts` (search: `recomputes task zero-hit after the global byte budget drops the only match`).

**Earlier anchor-drift evidence:**

- `.goat-flow/learning-loop/footguns/quality-reporting.md` (search: `does not let unscoped npx resolve the deprecated package in`)
- `.goat-flow/learning-loop/lessons/refactor-fallout.md` (search: `LOCAL_STATE_README_ENTRIES`)

---

## Lesson: Mechanical extractions need generated-name and owner audits

**Status:** active | **Created:** 2026-08-10
**Decision changed:** Use identifier boundaries and classify every extracted symbol as shared, moved, or owner-local.
**Trigger phase:** ACT
**Incident count:** 2 | **Latest occurrence:** 2026-08-10

**Prevention:** Prefer one token-aware replacement per identifier, use word boundaries when text rewriting is unavoidable, and grep generated names for repeated prefixes. Before deleting an extracted range, classify every declaration as shared, moved, or owner-local and verify each destination. Evidence anchors: `src/cli/server/agent-hook-command.ts` (search: `isAgentHookJsonObject`) and `src/cli/server/agent-hook-writer.ts` (search: `type AgentHookJsonObject`).

**What happened:** While extracting hook command helpers, a specific replacement created `AgentHookJsonObject`, then a broader `JsonObject` replacement matched the suffix and produced a doubled name. Typecheck rejected the generated guard call before tests ran.

**Root cause:** The replacement target remained inside the replacement output, and the chained transformation did not use identifier boundaries.

**Recurrence (2026-08-10):** A runtime-evidence extraction moved a range containing the deny-only hook identifier. The shared destination intentionally omitted that private constant, but the extraction left the original owner without it, so typecheck found every missing reference. The fix kept the identifier private to deny verification while shared report contracts moved once. Evidence anchors: `src/cli/hooks-runtime-evidence.ts` (search: `MANAGED_HOOK_IDENTIFIER`) and `src/cli/hooks-configured-runtime-evidence.ts` (search: `Shared report contracts`).
