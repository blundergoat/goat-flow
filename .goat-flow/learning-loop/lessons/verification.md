---
category: verification
last_reviewed: 2026-08-03
---

## Lesson: Stryker sandboxes need local-state ignores and mutation-safe test selection

**Status:** active | **Created:** 2026-05-15 | **Merged during:** M11 learning-loop consolidation

**What happened:** The first `scripts/mutation-test.sh` audit-engine run failed before mutation testing because Stryker copied gitignored `.goat-flow/scratchpad` content into its sandbox. After local-state ignores were added, the dry run still failed because instrumented source broke learning-loop semantic-anchor checks and the sandbox lacked `dist/cli/cli.js` for the main-module guard. On 2026-06-14, `post-turn-safety` also looped Claude Stop by scanning ignored `_temp/stryker-tmp/sandbox-*` env examples copied from scratchpad material.

**Root cause:** Mutation sandboxes are not the same as the live checkout. They copy and instrument files, so repo self-inspection tests and local working artifacts can break before a mutation campaign begins.

**Prevention:** For mutation-test helpers, run `bash scripts/mutation-test.sh '<target>' -- --dryRunOnly` before a full campaign. Keep Stryker sandbox inputs focused on committed anchors, ignore `.goat-flow/logs/`, `.goat-flow/scratchpad/`, and `.goat-flow/plans/` local contents, and keep post-turn/generated-output scanners scoped to committable content rather than gitignored local state. Use mutation-safe test selection for source-text and built-dist guards. Evidence anchors: `scripts/mutation-test.sh` (search: `ignorePatterns`), `scripts/mutation-test.sh` (search: `--test-skip-pattern`), and `workflow/hooks/post-turn-safety.sh` (search: `scan_untracked_changes`).

---

## Lesson: RegExp constructor assertions need a real escape helper

**Status:** active | **Created:** 2026-05-28

**Incident count:** 2 | **Latest occurrence:** 2026-08-01

**What happened:** While adding a hook smoke test for extension-based gruff binary selection, the first assertion escaped path separators for a `RegExp` constructor with `replaceAll("/", "\\\\/")`. The hook output used the expected slash-separated PHP fixture path, but the generated regex expected an extra backslash and the focused test failed.

**Root cause:** I treated slash escaping for regex literals and `RegExp` constructor strings as the same problem. In constructor strings, `/` is not a delimiter and does not need escaping; only regex metacharacters do.

**Recurrence (2026-08-01):** An M04 contract built a dynamic `RegExp` with a template literal that also contained escaped Markdown backticks. The TypeScript transform failed before any behavioural test ran. String concatenation produced the intended pattern and exposed the genuine three-failure RED.

**Prevention:** When asserting dynamic paths or rule IDs through `new RegExp(...)`, use a small `escapeRegex` helper for regex metacharacters instead of ad hoc slash replacement. If the pattern includes Markdown backticks, avoid nesting them in a template literal; concatenate the literal delimiters around the dynamic value. Evidence anchors: `test/integration/gruff-code-quality-smoke.helpers.ts` (search: `function escapeRegex`), `test/integration/gruff-code-quality-smoke.test.ts` (search: `selects the gruff binary from the edited file extension`), and `test/contract/skill-hardening-contracts.test.ts` (search: `conditionalSection`).

## Lesson: Harness fixture counts must match the reported unit

**Status:** active | **Created:** 2026-05-25

**What happened:** During the gruff documentation pass on `src/cli/audit/harness/check-verification.ts`, the focused evidence-before-claims test failed because the fixture expected `4 present instruction file` even though Codex and Antigravity both pointed at the same `AGENTS.md`. The harness reported the correct deduplicated count: 3 unique present instruction files.

**Root cause:** The assertion counted agent profiles, while the check reports unique instruction-file paths. Shared instruction files make those units diverge.

**Prevention:** In harness tests, name and assert the reported unit explicitly: profiles, unique files, findings, or checks. When a fixture deliberately maps multiple agents to the same instruction file, document that duplicate-path case next to the fixture helper. Evidence anchors: `test/unit/audit-harness/check-evidence-before-claims.test.ts` (search: `unique present instruction files`), `src/cli/audit/harness/check-verification.ts` (search: `instructionFilePaths`), `test/fixtures/evidence-before-claims.ts` (search: `antigravity: "AGENTS.md"`).

## Lesson: Validators can require explicit inventories and phrases despite README pointers

**Status:** active | **Created:** 2026-05-24

**What happened:** Replacing explicit playbook filenames in `.goat-flow/architecture.md` with a README pointer failed `skill-playbook-inventory-drift`; replacing instruction Key Resources examples with only an index pointer then failed `Instruction parity`.

**Root cause:** I optimized for low-drift prose before reading the validators that require direct filenames and phrases.

**Prevention:** Before replacing explicit inventories or required phrases with index pointers, grep content-quality, factual-drift, parity, and preflight checks. If a validator checks direct filename or phrase inclusion, keep the explicit text and add the index pointer around it. Evidence anchors: `src/cli/audit/check-factual-semantic-drift.ts` (search: `driftSkillPlaybookInventory`), `scripts/check-instruction-parity.mjs` (search: `tool-playbook Key Resources`).

---

## Lesson: Header-only edits leave bodies contradicting the new scope

**Status:** active | **Created:** 2026-05-16

**What happened:** I updated status/dependency headers across several milestone files and reframed M11, but left body sections, deferred items, field names, and one filename contradicting the new scope. Review caught doc-only milestones still requiring code helpers, stale dependencies, an old `confidence` field, and an abandoned filename.

**Root cause:** I treated the header as the scope change. In planning docs, status/dependency/framing changes ripple through Scope Discipline, Tasks, Exit Criteria, Testing Gate, Deferred, filenames, and schema field names.

**Prevention:** After a milestone scope change, re-read the whole file, grep old-scope keywords, check the filename, and scan for doctrine violations such as `confidence` or file-line evidence. In closeout, list what changed in each touched milestone so reviewers can target the same surfaces. Evidence anchor: `.goat-flow/skill-docs/skill-conventions.md` (search: `Task Tracking`).

---

## Lesson: Browser-verifying local source needs `npm run dev`, not `npx goat-flow dashboard`

**Status:** active | **Created:** 2026-05-09

**What happened:** Verifying the new dashboard skill-quality workbench in a browser, ran `npx goat-flow dashboard .` to launch the dashboard. The Quality view loaded but the Skill Quality artifact list was empty - `skillQualityArtifacts` never populated. The new `loadSkillQualityInventory` method I had just added to `src/dashboard/app.ts` was missing from the served `/assets/app.js`. `curl -s ... /assets/app.js | grep -c loadSkillQualityInventory` returned `0`.

**Root cause:** `npx goat-flow ...` resolves the published `@blundergoat/goat-flow` from `~/.npm/_npx/...`, not the local source tree. The dashboard CLI from the published package bundles the package's own compiled assets - local source edits to `src/dashboard/app.ts` are invisible to it.

**Fix:** Use `npm run dev` (which runs `tsc && npm run build:dashboard && node dist/cli/cli.js dashboard . --dev`) to build and serve the local source. After that, `curl ... /assets/app.js | grep -c loadSkillQualityInventory` returned `2` and the workbench rendered correctly.

**Prevention:** Before browser-verifying a dashboard or CLI source change, confirm the running process is the local build, not the published package. One quick check: `ps aux | grep "node dist/cli/cli.js"` should show the local `dist/` path. If you see `~/.npm/_npx/...`, you are running the published package and your edits are invisible. Evidence anchors: `package.json` (search: `"dev":`), `src/cli/server/dashboard-assets.ts` (search: `loadDashboardAsset`).

---

## Lesson: Behavior-scope changes need assertion updates before the first focused run

**Status:** active | **Created:** 2026-05-04

**What happened:** Behavior changes left adjacent assertions pinned to old flags, phrases, counts, routes, or errors, so focused checks failed only after implementation.

**Root cause:** I changed the contract and obvious test without grepping every encoded form of the old behavior.

**Prevention:** Before the first focused run, grep implementation and adjacent tests for old flags, phrases, counts, routes, and errors; update them with the behavior. Evidence anchors: `src/cli/server/terminal.ts` (search: `initialInput`), `test/integration/audit-drift.test.ts` (search: `expectedDeprecatedHookComparisons`), `test/contract/skill-hardening-contracts.test.ts` (search: `carries explicit build intent through planning into ordinary ACT`), `test/unit/evidence-envelope.test.ts` (search: `keeps append failures non-fatal`).

**Recurrence (2026-07-19):** A path-safe evidence diagnostic replaced raw OS errors, but the adjacent non-fatal assertion still accepted only the old error forms; the first focused GREEN run stopped at 117/118.

**Latest recurrence (2026-07-29):** A newly authored contract regex pinned capitalized `Honor \`Depends on\`` from memory after an edit earlier in the same session had folded it to lowercase `honor`; the first full run failed the new test. Grep current file text before encoding an assertion, even for text written earlier the same session.

**Latest recurrence (2026-08-01):** M03's first RED used heading helpers at the wrong Markdown levels, and a later GREEN assertion treated `same-file` capitalization as semantic. Re-reading the helper contract produced the genuine four-failure RED; matching prose case-insensitively removed the false GREEN failure. Validate assertion machinery before accepting RED, and copy exact source text unless case is intentionally irrelevant.

---

## Lesson: Defensive session rechecks can conflict with TypeScript narrowing

**Status:** active | **Created:** 2026-05-09

**What happened:** While chunking dashboard terminal initial prompt writes, the first `npm run typecheck` failed with `TS2367` because the loop checked `session.status === "terminated"` after an earlier guard had already narrowed the status to active/starting. The runtime intent was a defensive recheck, but the write loop was synchronous and no local status mutation could make that branch true.

**Root cause:** Treated a defensive runtime status check as free inside a narrowed synchronous scope. TypeScript correctly rejected a comparison that could not happen in that scope.

**Fix:** Capture stable session resources after the initial guard (`const pty = session.pty`) and keep the synchronous chunk write loop free of repeated status predicates. Evidence anchors: `src/cli/server/terminal.ts` (search: `const pty = session.pty`), `src/cli/server/terminal.ts` (search: `chunkTerminalInput`).

---

## Lesson: "Double check" means read the files, not re-run the tests

**Status:** active | **Created:** 2026-03-22

**What happened:** User asked to "double check" multiple times. Each time, re-ran typecheck + tests + scan. Never caught stale shape references, documentation inconsistencies, or content quality issues that three external agents found immediately by reading the actual files.
**Root cause:** Interpreted verification as "run the pipeline" instead of "read what changed." Tests only cover what they test.
**Fix:** Added removed-pattern check to preflight. "Double check" should include: (1) run pipeline, (2) grep removed patterns, (3) read 3-5 changed files for content accuracy.

---

## Lesson: New validators must run against the live repo before closeout

**Status:** active | **Created:** 2026-04-29

**What happened:** M06 added decision-file validation and the fixture tests passed, but the first live `node --import tsx src/cli/cli.ts stats . --check` run failed against existing ADR files and one stale lesson reference.

**Root cause:** Treated fixture coverage as enough proof for a repository-wide validator. The new rule was correct, but the live repo contained older records that predated the stricter contract.

**Fix:** After adding any validator that scans a project-wide artifact directory, run it against the live repository before the milestone gate and budget time for the live cleanup it exposes.

**Recurrence (2026-07-13):** M07 ownership fixtures passed focused manifest tests, but full preflight found three packaged-mode `ManifestJson` fixtures that omitted the new required `file_ownership` contract. It also caught ESLint complexity and Knip exports outside the focused commands. After a manifest schema change, grep every `ManifestJson` fixture and run the full static/test gate, not only the new validator suite. Evidence anchors: `test/unit/packaged-install.test.ts` (search: `file_ownership`), `src/cli/manifest/manifest-json.ts` (search: `OWNERSHIP_EVIDENCE_FINDERS`).

---

## Lesson: Agent doesn't tick milestone checkboxes (recurrence x4, unresolved)

**Status:** active | **Created:** 2026-03-31 | **Recurrences:** M1 (2026-03-31), M29 (2026-04-04), M32 (2026-04-05), M08 (2026-04-07)

**What happens:** The agent completes milestone tasks but ticks zero checkboxes. The user discovers it during review. CLAUDE.md VERIFY says "MUST tick `- [x]` on each task as it's completed - not at the end." The instruction exists in three places and is ignored every time.

**Root cause:** When parallelizing work or context-switching to user messages, the "tick as you go" step competes with "do the next thing" and loses. The agent tracks completion mentally but never writes it to the file.

**Why stronger rules haven't worked:** Each recurrence added a stronger prevention rule. M1: "tick immediately." M29: "FIRST action must be editing the milestone file." M32: "before doing anything else." All failed because documentation-level enforcement does not work for this pattern - the forcing function competes with whatever the agent wants to do next, and loses.

**Mechanical enforcement was tried and withdrawn (do not re-propose it blind).** ADR-038 (search: `Plan Checkbox Guard`) shipped `plan-checkbox-guard.sh` as a Claude-only Stop hook in v1.12.0 - exactly the "hook or gate" this lesson asks for. ADR-039 (search: `Remove Plan Checkbox Guard`) removed it one day later in v1.12.1: the reminder cost default Stop surface, dashboard hook list, installer/config schema, manifest, and audit fixtures, while non-Claude Stop delivery stayed unverified and stale registrations could keep invoking a deleted script. ADR-039 also explicitly rejected swapping in a replacement reminder immediately, because that "risks rebuilding the same plan-state heuristics under a new name" - a replacement needs its own plan.

**Status:** Unresolved, and deliberately so. The gap is real but the obvious fix has already been paid for once and reverted. Any new proposal must start from ADR-039's rejection list and show what it does differently - not restate "needs a hook."

---

## Lesson: Heading regexes can silently truncate router-table checks

**Status:** active | **Created:** 2026-04-03 | **Last recurrence:** 2026-07-18

**What happened:** Tightened `2.4.3` to parse the Router Table directly, but the first extractor used a multiline regex with `$` in the lookahead. In JavaScript regexes, `$` under `/m` matches end-of-line, so the match stopped after the `## Router Table` heading and never included the rows below it. The new regression also referenced an undefined fixture constant, so the first focused test run broke twice before the real logic was verified.
**Root cause:** Reached for a compact heading regex instead of reusing the repo’s line-based section parsing style, then wrote a regression that depended on a fixture helper that did not exist in that file.
**Recurrence:** A goat-review regression read the `## Constraints` section with `readMarkdownSection`, but that helper treated a `## Constraints` heading inside the skill's fenced output template as the next real section. The test therefore reported a missing rule after the production fix was already present. Reading the full skill document exposed the false failure. Evidence anchors: `test/contract/skill-hardening-contracts.test.ts` (search: `keeps an unselected optional Spec Drift pass out of review degradation`) and local TDD receipt `.goat-flow/logs/sessions/2026-07-18-goat-review-tdd.md`.

**Fix:** For markdown section extraction, prefer a line-based parser that tracks fenced-code state over multiline heading regexes with `$`. When the invariant is file-wide, assert against the full document instead of a section helper. For new regressions, build the smallest self-contained fixture possible unless the shared fixture object is already in scope.

---

## Lesson: Path normalization can invalidate later path-shape heuristics

**Status:** historical | **Created:** 2026-04-03 | **Reason:** Rubric check 2.4.3 no longer exists (ADR-013); normalization-invariant principle applies to any parser

**What happened:** After normalizing router references by trimming trailing slashes, the follow-up `2.4.3` filter still looked for the literal substring `/skills/`. That turned `.claude/skills/` into `.claude/skills`, so the canonical passing fixture dropped from `100` to `99` even though the router row was correct.
**Root cause:** Mixed two phases of logic without rechecking the invariant after normalization. The filter assumed the original slash shape still existed after the normalizer had deliberately removed it.
**Fix:** When a parser normalizes paths, downstream checks must use shape tests that still hold after normalization, such as segment-boundary regexes (`/\/skills(?:\/|$)/`) instead of raw substring checks that depend on trailing separators.

---

## Lesson: Parallel sessions need concurrency-safe file patterns

**Status:** active | **Created:** 2026-04-05

**What happened:** Observed during parallel Claude sessions: two agents writing to the same learning-loop file simultaneously. Learning loop files (`.goat-flow/logs/`, `.goat-flow/learning-loop/lessons/`, `.goat-flow/learning-loop/footguns/`) are append-only by convention, but nothing prevents concurrent writes. Session logs use date-slug filenames which reduces collisions, but category bucket files (e.g. `.goat-flow/learning-loop/lessons/verification.md`) are shared write targets.

**Root cause:** goat-flow was designed for single-agent sessions. The category bucket format (multiple entries in one file) creates write contention that per-entry files (one file per lesson) wouldn't have.

**Prevention:**
1. Document which files are safe for concurrent access in the plugin instructions
2. For learning loop writes during parallel sessions, use unique filenames (date-agent-slug) rather than appending to shared buckets
3. Session logs already use unique filenames - extend this pattern to footgun/lesson entries when multi-agent mode is detected

---
