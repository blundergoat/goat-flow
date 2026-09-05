---
category: refactoring
last_reviewed: 2026-09-05
---

## Pattern: Hold the file-length line continuously, not in a cleanup pass

**Context:** A file-length gate accumulates violations quietly because no single edit crosses it. Each edit adds twenty lines to an already large file, and the bill arrives as one cleanup project. Goat-flow's gate is `size.file-length` in `.gruff-ts.yaml` (search: `size.file-length`): a 750-line warning until 2026-08-16, a 1000-line error since.

**Approach:** Split a file that is nearing the threshold while you are already editing it and still hold the seam in context. Measure the formatted file, not the draft, and treat a green behaviour suite as incomplete until the size ratchet also runs. Expect a planned two-way split to become three modules when private helpers are used on both sides. After any extraction run `goat-flow stats --check` and `goat-flow index`: moving a symbol silently breaks every learning-loop anchor that cites it by path, and typecheck cannot see a Markdown citation. Judge a long cleanup by per-pillar finding counts, because clearing one pillar can lower the composite score while the code improves.

**Evidence (ACTUAL_MEASURED):**
- 2026-08-04: a gruff sweep found 35 files over the 750-line gate, about 13,200 lines above threshold. Splitting `src/cli/facts/shared/learning-loop-common.ts` (836 lines) took roughly 15 tool calls and produced three modules, because `isFileRef`, `isIntentionallyGitignored`, and `isCheckableForStaleness` were used on both sides of the seam: `src/cli/facts/shared/reference-paths.ts` (search: `isCheckableForStaleness`), `src/cli/facts/shared/search-anchors.ts` (search: `evaluateSearchAnchors`). Four learning-loop anchors then pointed at symbols that had moved; typecheck and focused tests stayed green, and the break surfaced only as `support-bundle` exiting 1: `.goat-flow/learning-loop/lessons/audit-contracts.md` (search: `function toCheckResult`), `.goat-flow/learning-loop/footguns/hook-installation.md` (search: `checkCodexWorkspaceRootExactPaths`). Adding required doc comments took one test file from 749 to 753 lines and created a size finding.
- 2026-08-13: `test/integration/setup-install-migrations.test.ts` (search: `keeps disabled hooks installed and inert`) reached 751 lines after formatting with a green suite; removing one blank line fixed it.
- 2026-08-16: `test/integration/post-turn-safety-hook.test.ts` reached 891 lines with 59 focused tests and the full 2,083-test run green; preflight rejected it, and the controller cases moved to `test/integration/post-turn-safety-controller.test.ts` (search: `explicit non-Git controller roots`).

## Pattern: Extract to a new module without a convenience re-export

**Context:** Splitting a large file while letting existing consumers keep importing from the original path.

**Approach:** Point consumers at the module that now owns the symbol. A re-export from the original file creates an import cycle as soon as the new module imports anything back (a shared type, a helper); TypeScript compiles the cycle without complaint and only gruff's `design.circular-import` catches it, so a run that skips gruff ships it. Delete the re-export and update the two or three real consumers.

**Evidence (ACTUAL_MEASURED, 2026-08-05):** Hit twice in one session with the same shape. `src/cli/quality/history-diff.ts` (search: `buildQualityDiff`) imported types back from the `history.ts` that re-exported it, and `src/cli/prompt/compose-quality-contract.ts` (search: `appendQualityReportContract`) imported formatting helpers back from the `compose-quality-common.ts` that re-exported the renderer. Typecheck passed both times.

## Pattern: Resolve every cut boundary before splicing any of them

**Context:** Scripting a multi-block extraction where each block's end marker is the next block's start.

**Approach:** Resolve all boundaries against the untouched file first, then splice bottom-up. Deleting as you iterate erases the marker the next lookup needs, and the failure reads as "not found" for a symbol that is plainly still in the file. Scripted extraction also over-exports by default: run knip afterwards and un-export what only its own module uses.

**Evidence (ACTUAL_MEASURED, 2026-08-05):** A five-block extraction from `src/cli/review-validate.ts` aborted on its second cut while looking for `parseShipVerdictDecision`, which the first cut had just removed; the symbol now lives in `src/cli/review-validate-verdict.ts` (search: `parseShipVerdictDecision`). Nothing was corrupted because it failed before writing, but two runs went to re-verifying markers by hand.

## Pattern: Canary-first contract changes (one consumer before all consumers)

**Context:** Changing the semantics of a contract with N consumers (every env class, every audit check, every renderer, every agent config). Changing all N in one PR means a wrong contract costs the same N-file surface to revert, parity has to be re-proven across it, and reviewers cannot tell which consumer's symptom motivated the revert.

**Approach:** Apply the change to one representative consumer, land it, and run it through one real work cycle (a session, a CI run, a benchmark) before propagating to the rest in a follow-up PR. The canary PR must say why that consumer shares the failure mode with its peers; otherwise it is just a smaller change. The smallest canary here is one audit check, one skill, or one agent harness config. Contracts with this shape: `CheckResult` and `HarnessCheckResult` in `src/cli/audit/types.ts` (search: `HarnessCheckResult`), the manifest in `workflow/manifest.json`, and the skill composition contract in `src/cli/audit/check-drift.ts`.

**Evidence (EXTERNAL_REFERENCE):** mini-swe-agent PR #683 (merged 2026-01-05) moved the submit marker from first line to last line across 5 environment classes, 4 benchmark configs, and 6+ test files at once, for a real bug (issue #659). Commit `1ce8e917` on 2026-01-12 reverted the same 15 files without a stated reason; the complementary `returncode == 0` fix landed months later in PR #747. A `LocalEnvironment`-only canary would have exposed the failure against a one-file revert.

**When not to use:** Pure renames. They either work or do not, and no edge case shows up in only some consumers.

## Pattern: Verify structural renames with a repo-wide grep

**Context:** Renaming setup files, moving shared references, or changing canonical doc paths.

**Approach:** Update the replacement file first, grep the old path across active docs and code, fix every live reference, then rerun `bash scripts/preflight-checks.sh` and the relevant `goat-flow audit` command before closing the task. Skill renames need the wider sweep in the next entry.

## Pattern: Skill consolidation requires a full grep after every merge

**Context:** Renaming, merging, or deleting skills.

**Approach:** After any skill rename, merge, or delete: grep the entire repo for every old name; check every installed skill root listed in `workflow/manifest.json` (search: `"skills_dir"`); check constants, types, and test fixtures; run the full test suite and audit. "It builds and tests pass" is not enough - read the changed files.

## Pattern: Put prompt side effects on the CLI side of the boundary

**Context:** A prompt contract forbids tracked-file writes or unrestricted I/O, but a new feature needs persistence, capture, or report history.

**Approach:** Keep the prompt read-only or limited to a single path, and move extraction, path validation, suffix numbering, schema validation, and writes into CLI code. If the prompt must write, pin the path to a gitignored local-state directory and make the exception explicit. Anchor: `src/cli/prompt/compose-quality-static-sections.ts` (search: `No tracked-file writes`).

## Pattern: Sandwich-layer refactor for behavior-preserving migration of load-bearing seams

**Context:** Changing a load-bearing boundary type with many call sites on both sides: a request/response envelope, a check-result schema, a manifest shape. Migrating every call site in one PR has a large blast radius, leaks subtle behaviour changes (defaulting, field order, validation timing), and leaves the seam undefined after a partial revert. Canary-first covers a change one consumer can validate; it does not help when the boundary itself changes and every consumer must keep working immediately.

**Approach:** Introduce the new normalized type as a middle layer that converts back to the legacy shape on both sides, so producers and consumers keep seeing what they saw. Migrate one call site per PR by having it speak the new type directly, and delete the old type only after the last one. The cost is a double conversion during the migration window, acceptable off the hot path. Seams here with this shape: the audit result types in `src/cli/audit/types.ts` (search: `HarnessCheckResult`) and the manifest between `loadManifest()` in `src/cli/manifest/manifest.ts` (search: `loadManifest`) and its consumers. Canary and sandwich compose: a sandwich can roll out through a canary consumer first.

**Evidence (EXTERNAL_REFERENCE):** stanfordnlp/dspy PR #9802 introduced `LMRequest` and `LMResponse` in `dspy/clients/openai_format.py` as the adapter-to-LM boundary, converting back to the legacy OpenAI-format dict on the LM side and the legacy parsed-completion dict on the adapter side (search: `_legacy_call_kwargs`); TODOs in `dspy/adapters/base.py` mark each call site's future migration PR.

**When not to use:** Hot inner loops where the double conversion is measurable; lossy round-trips, where the migration must be breaking and canary-first applies instead; small, well-known surfaces that will migrate in one PR anyway.
