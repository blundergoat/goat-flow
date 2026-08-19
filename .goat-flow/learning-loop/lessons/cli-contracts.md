---
category: cli-contracts
last_reviewed: 2026-08-15
---

**Scope:** The CLI's own surface contract - parser headroom before refactoring, omission tests for required choices, output shape across one and many selections, and what an id-based comparison actually compares. Cooperation between separately-correct components is [integration-verification.md](integration-verification.md).

## Lesson: Quality diff compares saved report IDs, not report file paths

**Status:** active | **Created:** 2026-07-12

**What happened:** During final quality-report verification, I passed two JSON file paths to `quality diff`. The CLI exited 2 because an explicit comparison is one colon-delimited `<from-id>:<to-id>` argument; selecting the latest same-agent reports with `--agent codex --mode agent-setup` then completed successfully.

**Root cause:** I inferred a conventional two-path diff interface instead of reading the command contract before the auxiliary close-out check.

**Prevention:** Run `goat-flow quality diff --agent <id> --mode <mode>` for the latest matching pair, or pass one `<from-id>:<to-id>` argument as documented in `docs/cli.md` (search: `quality diff [<from-id>:<to-id>]`). Do not pass report filesystem paths.

---

## Lesson: New subcommands need parser headroom before the first GREEN refactor

**Status:** active | **Created:** 2026-07-13

**What happened:** The first M02 `skill doctor` implementation passed its behavioral suite (`20 passed`, `0 failed`) but failed the whole-file quality gate. `parseSkillPositionals` and `validateSkillFlags` exceeded ESLint complexity limits, the first doctor collector had two more complexity failures, and adding one branch pushed `cli-parser.ts` and `cli-handlers.ts` above the 750-line gruff threshold. The final preflight later caught an unnecessary `renderSkillDoctorMarkdown` export and a bare backticked filename in `docs/cli.md` (search: `Canonical workflow source`) that focused tests, ESLint, typecheck, Prettier, and targeted gruff did not cover.

**Root cause:** I treated a behavioral GREEN as permission to finish the command inside two already-large shared modules. The tests proved output behavior, but they did not measure whether the new subcommand left the parser and dispatch surfaces easy to verify. Importing doctor helpers back into the parser would also have violated the existing lazy-import pattern by loading audit and manifest dependencies for unrelated commands.

**Fix:** Extract lightweight positional/flag rules into `src/cli/skill-command-parser.ts` (search: `parseSkillPositionals`), keep doctor runtime imports behind `src/cli/cli-handlers.ts` (search: `handleSkillCommand`), and split collection decisions inside `src/cli/skill-doctor.ts` (search: `inspectFrontmatterFields`). Whole-file ESLint, typecheck, and targeted gruff then passed without suppressions or threshold changes.

**Recurrence update (2026-07-18):** M02 informational-flag behavior reached 61/61 focused tests and typecheck exited 0 before whole-file ESLint rejected `parseCLIArgs` at complexity 12. Moving the branch into a helper fixed complexity, but targeted gruff then exposed growth beyond the already-marginal file-length threshold. Rewinding duplicate namespace parsing brought `src/cli/cli-parser.ts` (search: `selectCommandPositionals`) to zero targeted gruff findings without a suppression or new module.

**Recurrence update (2026-07-29):** `plans check` plus a comment pass pushed `cli-handlers.ts` to 751 then `plans-export.ts` to 753 - moving code re-trips the length gate in the destination. Extracting the whole effort-notation concern into `src/cli/plans-effort.ts` (search: `Effort-estimate notation parser`) with a nearby test cleared both; single-function shuffles only relocate the overflow.

**Recurrence update (2026-08-07):** Tightening Timing Receipt stamp validation passed 116 focused tests and typecheck before whole-file ESLint rejected `parseStamp` at complexity 11. The first helper extraction then made preflight report five new file-length warnings. Deriving canonical UTC from the epoch inside `parseStamp`, folding regressions into existing test cases, and restoring the accepted `plans-time.ts` size cleared targeted Gruff without weakening the invalid-calendar or rendered-heading checks.

**Decision changed:** Measure whole-file ESLint and gruff immediately after the first parser GREEN, and pay for new branches by removing duplicate parsing rather than adding a late helper alone. | **Trigger phase:** VERIFY | **Incident count:** 4 | **Latest occurrence:** 2026-08-07

**Prevention:**
1. Before extending a shared parser or dispatcher, measure its line and complexity headroom; near-threshold files need an extraction in the initial GREEN design.
2. Keep parser modules dependency-light. A diagnostic subcommand may lazy-load audit/manifest code after dispatch, but argv parsing must not import that runtime.
3. Before the human gate, run Knip and path-integrity through full preflight; focused TypeScript and analyzer checks do not prove the command's public exports or documentation references are clean.
4. After behavioral GREEN, run whole-file ESLint, typecheck, and gruff before documentation or task completion; the verification unit is the changed file set, not only the new test cases.

---

## Lesson: Required CLI choices need omission tests

**Status:** active | **Created:** 2026-07-13
**Decision changed:** Test valid, invalid, and omitted forms for every required CLI choice; omission must not silently select a default. | **Trigger phase:** VERIFY
**Incident count:** 3 | **Latest occurrence:** 2026-08-01

**What happened:** M17's plan and handler required `--scenario deny-hook`, but the parser returned that value when the flag was absent. Positive, invalid-value, and live explicit-command checks all passed, so only a final omission probe exposed the false choice.

A second incident added a required quality-report owner whenever staged draft capture is enabled. The first retry implementation forwarded an absent owner as explicit `null`, and the existing retry contract caught the changed payload shape during VERIFY.

A third incident added a Claude/reporting-only relationship ahead of the owner relationship. The first missing-owner fixture omitted `accessMode`, so it exercised the new mode guard instead of the intended owner guard.

**Root cause:** I treated omitted/defaulted fields as harmless while testing one relationship, even though an earlier relationship could legitimately reject the same payload first.

**Fix and prevention:** Add omission RED tests before implementation. Required values must fail when absent; optional transport metadata must be omitted rather than converted to a new sentinel value. In each relationship test, make every preceding prerequisite explicit and valid so the assertion proves the intended error path. Cover capture enabled with and without an owner, owner present with and without capture for each supported runner and mode, wrong-runner/mode, and retry payload presence/absence. Evidence anchors: `src/cli/cli-parser.ts` (search: `parseHookScenarioArg`), `src/cli/server/decoders.ts` (search: `is supported only for Claude reporting sessions`), `src/dashboard/dashboard-terminal-connect.ts` (search: `qualityReportProjectPath ?`), and `test/unit/dashboard-terminal-launch/launch-flow-03.test.ts` (search: `carries staged-draft capture through a retried launch`).

---

## Lesson: Command output shape must survive one and many selected files

**Status:** active | **Created:** 2026-08-09
**Decision changed:** Execute documented search commands with one, many, and zero selected files before treating their output as stable.
**Trigger phase:** VERIFY
**Incident count:** 1 | **Latest occurrence:** 2026-08-09

**What happened:** Present-file selection fixed hook-registration exit handling, but the first GREEN run passed only one consumer config to `rg`. Ripgrep then omitted the filename, so users saw the matching line without knowing which registration file supplied it; the focused suite reported 8/9 until `--with-filename` made single- and multi-file output consistent.

**Root cause:** The command relied on ripgrep's input-count-dependent filename default while its output was evidence about file ownership.

**Prevention:** When a documented command selects optional files, execute its literal body with one, many, and zero inputs. Require explicit path-labelled output when users need to identify the source, and require a named failure for empty selection. Evidence: `test/unit/playbook-contract.test.ts` (search: `runs the documented registration command in a consumer checkout`).

---

