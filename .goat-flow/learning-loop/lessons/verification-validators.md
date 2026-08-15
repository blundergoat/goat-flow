---
category: verification-validators
last_reviewed: 2026-08-15
---

**Scope:** Getting a checker itself right - regex and wildcard construction, path resolution inside guards, what a validator must inventory, and counting contracts between a check and what it reports. Whether a claim was verified at all is [verification.md](verification.md).

## Lesson: Permission wildcards must stay separate from escaped literal paths

**Status:** active | **Created:** 2026-08-05 | **Incident count:** 2 | **Latest occurrence:** 2026-08-05
**Decision changed:** Build permission patterns by escaping the literal directory first, then append deliberate wildcard grammar and assert the serialized rule. | **Trigger phase:** ACT

**What happened:** While denying Claude reporting-agent writes to server-owned quality result and claim receipts, the first implementation passed each wildcard-bearing filename through `claudePermissionPath`. The focused terminal-profile test failed because that helper correctly escaped `*` as a literal path character, so the deny rule matched no receipt family.

**Recurrence 2026-08-05:** The corrected wildcard construction still enumerated only result and claim markers. Full branch review of the adjacent quality-claim implementation found the separate `goat-quality-reap-*` server-owned fence, which the reporting agent could still edit. The permission inventory now names result, claim, and reaper families together.

**Root cause:** I used a literal-path escaping helper to encode a permission pattern. The directory and the wildcard suffix have different grammars even though they appear in one rule string.

**Prevention:** Pass only literal filesystem components through path escaping. Append reviewed permission wildcards afterward, then assert every server-owned filename family in the serialized deny rules. Evidence anchors: `src/cli/server/terminal-reporting-profile.ts` (search: `stagingServerFileDenies`), `test/unit/terminal-spawn.test.ts` (search: `launches Claude reporting sessions with a restrictive settings overlay`).

---

## Lesson: Input/output alias guards must compare resolved filesystem paths

**Status:** active | **Created:** 2026-08-05 | **Incident count:** 2 | **Latest occurrence:** 2026-08-05
**Decision changed:** Before a forced writer runs, compare every existing destination with every source after filesystem resolution, then test an alternate path spelling. | **Trigger phase:** VERIFY

**What happened:** Full branch review reproduced `plans export --format json --output <source milestone> --force` exiting 0 and replacing the milestone with generated JSON. The first guard compared `resolve()` strings and blocked that direct spelling.

**Recurrence 2026-08-05:** A follow-up reproduction selected the plan through a directory symlink while naming the same source through its real path. The lexical guard again exited 0 and changed the source. The correction compares `realpathSync` results for existing sources and destinations before any export write.

**Root cause:** I treated normalized path strings as filesystem identity. A symlink gives one file multiple normalized absolute names, so lexical equality cannot prove that input and output are distinct.

**Prevention:** For commands that read source files and later honor `--force`, canonicalize existing source and destination paths before collision checks, while retaining separate symlink and hardlink write guards. Re-run the destructive reproduction through a second path spelling before accepting the fix. Evidence anchors: `src/cli/plans-export-output.ts` (search: `assertOutputPathsDoNotAliasSources`), `test/unit/plans-export-writes.test.ts` (search: `refuses forced JSON output that aliases a source through the selected plan path`).

---

## Lesson: RegExp constructor assertions need a real escape helper

**Status:** active | **Created:** 2026-05-28

**Incident count:** 2 | **Latest occurrence:** 2026-08-01

**What happened:** While adding a hook smoke test for extension-based gruff binary selection, the first assertion escaped path separators for a `RegExp` constructor with `replaceAll("/", "\\\\/")`. The hook output used the expected slash-separated PHP fixture path, but the generated regex expected an extra backslash and the focused test failed.

**Root cause:** I treated slash escaping for regex literals and `RegExp` constructor strings as the same problem. In constructor strings, `/` is not a delimiter and does not need escaping; only regex metacharacters do.

**Recurrence (2026-08-01):** An M04 contract built a dynamic `RegExp` with a template literal that also contained escaped Markdown backticks. The TypeScript transform failed before any behavioural test ran. String concatenation produced the intended pattern and exposed the genuine three-failure RED.

**Prevention:** When asserting dynamic paths or rule IDs through `new RegExp(...)`, use a small `escapeRegex` helper for regex metacharacters instead of ad hoc slash replacement. If the pattern includes Markdown backticks, avoid nesting them in a template literal; concatenate the literal delimiters around the dynamic value. Evidence anchors: `test/integration/gruff-code-quality-smoke.helpers.ts` (search: `function escapeRegex`), `test/integration/gruff-code-quality-smoke.test.ts` (search: `selects the gruff binary from the edited file extension`), and `test/contract/skill-hardening-review-2.test.ts` (search: `conditionalSection`).

## Lesson: Harness fixture counts must match the reported unit

**Status:** active | **Created:** 2026-05-25
**Incident count:** 2 | **Latest occurrence:** 2026-08-10

**What happened:** During the gruff documentation pass on `src/cli/audit/harness/check-verification.ts`, the focused evidence-before-claims test failed because the fixture expected `4 present instruction file` even though Codex and Antigravity both pointed at the same `AGENTS.md`. The harness reported the correct deduplicated count: 3 unique present instruction files.

**Root cause:** The assertion counted agent profiles, while the check reports unique instruction-file paths. Shared instruction files make those units diverge.

**Prevention:** In harness tests, name and assert the reported unit explicitly: profiles, unique files, findings, or checks. When a fixture deliberately maps multiple agents to the same instruction file, document that duplicate-path case next to the fixture helper. Evidence anchors: `test/unit/audit-harness/check-evidence-before-claims.test.ts` (search: `unique present instruction files`), `src/cli/audit/harness/check-verification.ts` (search: `instructionFilePaths`), `test/fixtures/evidence-before-claims.ts` (search: `antigravity: "AGENTS.md"`).

**Recurrence (2026-08-10):** A migrated Gruff result fixture asserted only the first finding code. Replacing that partial check with the complete user-visible code list failed because the analyzer envelope also carries `naming.short`. The expected result now enumerates both findings, so a missing or extra detail row is visible. Evidence anchors: `test/integration/hook-provider-contracts.test.ts` (search: `expectedFindingCodes`) and `test/integration/gruff-code-quality-smoke.helpers.ts` (search: `FINDING_GRUFF_CONTRACT_ENVELOPE`).

## Lesson: Validators can require explicit inventories and phrases despite README pointers

**Status:** active | **Created:** 2026-05-24

**What happened:** Replacing explicit playbook filenames in `.goat-flow/architecture.md` with a README pointer failed `skill-playbook-inventory-drift`; replacing instruction Key Resources examples with only an index pointer then failed `Instruction parity`.

**Root cause:** I optimized for low-drift prose before reading the validators that require direct filenames and phrases.

**Prevention:** Before replacing explicit inventories or required phrases with index pointers, grep content-quality, factual-drift, parity, and preflight checks. If a validator checks direct filename or phrase inclusion, keep the explicit text and add the index pointer around it. Evidence anchors: `src/cli/audit/check-factual-semantic-drift.ts` (search: `driftSkillPlaybookInventory`), `scripts/check-instruction-parity.mjs` (search: `tool-playbook Key Resources`).

---

## Lesson: Behavior-scope changes need assertion updates before the first focused run

**Status:** active | **Created:** 2026-05-04

**What happened:** Behavior changes left adjacent assertions pinned to old flags, phrases, counts, routes, or errors, so focused checks failed only after implementation.

**Root cause:** I changed the contract and obvious test without grepping every encoded form of the old behavior.

**Prevention:** Before the first focused run, grep implementation and adjacent tests for old flags, phrases, counts, routes, and errors; include install/round-trip suites when generated config shape changes. Update those assertions with the behavior. Evidence anchors: `src/cli/server/terminal.ts` (search: `initialInput`), `test/integration/audit-drift.test.ts` (search: `expectedDeprecatedHookComparisons`), `test/contract/skill-hardening-shared-1.test.ts` (search: `carries explicit build intent through planning into ordinary ACT`), `test/unit/evidence-envelope.test.ts` (search: `keeps append failures non-fatal`).

**Recurrence (2026-07-19):** A path-safe evidence diagnostic replaced raw OS errors, but the adjacent non-fatal assertion still accepted only the old error forms; the first focused GREEN run stopped at 117/118.

**Latest recurrence (2026-07-29):** A newly authored contract regex pinned capitalized `Honor \`Depends on\`` from memory after an edit earlier in the same session had folded it to lowercase `honor`; the first full run failed the new test. Grep current file text before encoding an assertion, even for text written earlier the same session.

**Latest recurrence (2026-08-01):** M03's first RED used heading helpers at the wrong Markdown levels, and a later GREEN assertion treated `same-file` capitalization as semantic. Re-reading the helper contract produced the genuine four-failure RED; matching prose case-insensitively removed the false GREEN failure. Validate assertion machinery before accepting RED, and copy exact source text unless case is intentionally irrelevant.

**Latest recurrence (2026-08-03):** The active Timing Receipt regression correctly failed strict validation, but its new assertion guessed `duplicate segment id M01-S01` instead of copying the parser's emitted `timing receipt segment ids must be unique`. The focused run stopped at 62/63 despite correct product behaviour. Run the reproduction once or inspect the parser warning before pinning diagnostic text; do not invent a more specific contract than the implementation emits.

**Latest recurrence (2026-08-06):** Replacing Copilot's `Get-Command bash` fallback with the shared Node launcher cleared the focused registrar and drift suites, but the full installer matrix still required the retired PowerShell marker in two cases. The corrected assertion now requires `run-with-bash.mjs` and rejects `Get-Command bash`. Evidence anchors: `test/integration/setup-install-agent-matrix.test.ts` (search: `must use the managed Bash resolver`) and `src/cli/server/agent-hook-writer.ts` (search: `powershell: crossPlatformCommand`).

---

## Lesson: New validators must run against the live repo before closeout

**Status:** active | **Created:** 2026-04-29
**Incident count:** 5 | **Latest occurrence:** 2026-08-05

**What happened:** M06 added decision-file validation and the fixture tests passed, but the first live `node --import tsx src/cli/cli.ts stats . --check` run failed against existing ADR files and one stale lesson reference.

**Root cause:** Treated fixture coverage as enough proof for a repository-wide validator. The new rule was correct, but the live repo contained older records that predated the stricter contract.

**Fix:** After adding any validator that scans a project-wide artifact directory, run it against the live repository before the milestone gate and budget time for the live cleanup it exposes.

**Recurrence (2026-07-13):** M07 ownership fixtures passed focused manifest tests, but full preflight found three packaged-mode `ManifestJson` fixtures that omitted the new required `file_ownership` contract. It also caught ESLint complexity and Knip exports outside the focused commands. After a manifest schema change, grep every `ManifestJson` fixture and run the full static/test gate, not only the new validator suite. Evidence anchors: `test/unit/packaged-install.test.ts` (search: `file_ownership`), `src/cli/manifest/manifest-json.ts` (search: `OWNERSHIP_EVIDENCE_FINDERS`).

**Recurrence (2026-08-03):** Compact-review, config, and version regressions reported 75 passing focused tests, but repository preflight still failed because `validateIntegrity` exceeded the ESLint complexity limit and three touched TypeScript files were not Prettier-clean. The compact branch moved to `validateCompactIntegrity`, and only the three reported files were formatted before rerunning the focused and full gates. Evidence anchors: `src/cli/review-validate-integrity.ts` (search: `function validateCompactIntegrity`) and `scripts/preflight-checks.sh` (search: `TypeScript`).

**Recurrence (2026-08-05):** Focused validator suites passed before direct ESLint found three touched functions above the complexity ceiling. After extracting the parsing helpers, the full formatter still rejected the new Setext regression layout, and the live content audit found two stale semantic anchors in the learning-loop edits. The work returned to implementation after each failure and reran the failed gate before continuing. Evidence anchors: `src/cli/audit/check-content-quality.ts` (search: `parseAtxHeading`), `test/unit/check-content-quality.test.ts` (search: `closes readiness before scanning a setext heading title`), and `scripts/preflight-checks.sh` (search: `TypeScript`).

**Recurrence (2026-08-05):** The first final goat-review draft summarized adjudication totals in its Review Integrity evidence and verdict fields, but the live `review validate` command correctly rejected those counts because only one current finding was visible. It also rejected `source=PR#57` because the canonical authority grammar requires `source=PR #57`. The report returned to drafting with visible-finding counts and the canonical scope spelling before delivery. Evidence anchors: `src/cli/review-validate-integrity.ts` (search: `Counts are cross-checked against the findings actually present`) and `src/cli/review-validate-common.ts` (search: `export const SCOPE_SNAPSHOT`).

---

## Lesson: Heading regexes can silently truncate router-table checks

**Status:** active | **Created:** 2026-04-03 | **Last recurrence:** 2026-07-18

**What happened:** Tightened `2.4.3` to parse the Router Table directly, but the first extractor used a multiline regex with `$` in the lookahead. In JavaScript regexes, `$` under `/m` matches end-of-line, so the match stopped after the `## Router Table` heading and never included the rows below it. The new regression also referenced an undefined fixture constant, so the first focused test run broke twice before the real logic was verified.
**Root cause:** Reached for a compact heading regex instead of reusing the repo’s line-based section parsing style, then wrote a regression that depended on a fixture helper that did not exist in that file.
**Recurrence:** A goat-review regression read the `## Constraints` section with `readMarkdownSection`, but that helper treated a `## Constraints` heading inside the skill's fenced output template as the next real section. The test therefore reported a missing rule after the production fix was already present. Reading the full skill document exposed the false failure. Evidence anchor: `test/contract/skill-hardening-review-3.test.ts` (search: `keeps an unselected optional Spec Drift pass out of review degradation`).

**Fix:** For markdown section extraction, prefer a line-based parser that tracks fenced-code state over multiline heading regexes with `$`. When the invariant is file-wide, assert against the full document instead of a section helper. For new regressions, build the smallest self-contained fixture possible unless the shared fixture object is already in scope.

---

## Lesson: Path normalization can invalidate later path-shape heuristics

**Status:** historical | **Created:** 2026-04-03 | **Reason:** Rubric check 2.4.3 no longer exists (ADR-013); normalization-invariant principle applies to any parser

**What happened:** After normalizing router references by trimming trailing slashes, the follow-up `2.4.3` filter still looked for the literal substring `/skills/`. That turned `.claude/skills/` into `.claude/skills`, so the canonical passing fixture dropped from `100` to `99` even though the router row was correct.
**Root cause:** Mixed two phases of logic without rechecking the invariant after normalization. The filter assumed the original slash shape still existed after the normalizer had deliberately removed it.
**Fix:** When a parser normalizes paths, downstream checks must use shape tests that still hold after normalization, such as segment-boundary regexes (`/\/skills(?:\/|$)/`) instead of raw substring checks that depend on trailing separators.

---

## Lesson: Expected classifier statuses must be captured around `set -e`

**Status:** active | **Created:** 2026-08-10
**Decision changed:** Capture expected nonzero helper statuses before restoring shell fail-fast mode.
**Trigger phase:** VERIFY

**What happened:** Gruff range classification correctly returned distinct statuses for deletion-only and unavailable hunks, but the legacy caller assigned the result under `set -e`. The shell exited with status 10 or 11 before the existing fail-soft skip branch ran.

**Root cause:** I added meaningful nonzero returns to a shared helper without auditing every caller for shell error-mode semantics. A command substitution assignment is still a failing command under `set -e`.

**Prevention:** When a shell helper uses nonzero statuses as data, wrap each call in `set +e`, capture `$?` immediately, restore `set -e`, and test the top-level script exit as well as its message. Evidence anchors: `workflow/hooks/gruff-code-quality.sh` (search: `range_status=$?`) and `test/integration/gruff-code-quality-smoke.test.ts` (search: `does not print whole-file findings when no changed range is available`).

---

