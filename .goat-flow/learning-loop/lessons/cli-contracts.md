---
category: cli-contracts
last_reviewed: 2026-09-05
---

**Scope:** The CLI's own surface contract - parser headroom before refactoring, omission tests for required choices, output shape across one and many selections, and what an id-based comparison actually compares. Cooperation between separately-correct components is [integration-verification.md](integration-verification.md).

## Lesson: Quality diff compares saved report IDs, not report file paths

**Status:** active | **Created:** 2026-07-12

**Prevention:** Run `goat-flow quality diff --agent <id> --mode <mode>` for the latest matching pair, or pass one `<from-id>:<to-id>` argument as documented in `docs/cli.md` (search: `quality diff [<from-id>:<to-id>]`). Do not pass report filesystem paths.

**What happened:** During final quality-report verification, I passed two JSON file paths to `quality diff`. The CLI exited 2 because an explicit comparison is one colon-delimited `<from-id>:<to-id>` argument; selecting the latest same-agent reports with `--agent codex --mode agent-setup` then completed successfully.

**Root cause:** I inferred a conventional two-path diff interface instead of reading the command contract before the auxiliary close-out check.

---

## Lesson: New subcommands need parser headroom before the first GREEN refactor

**Status:** active | **Created:** 2026-07-13
**Decision changed:** Measure whole-file ESLint and gruff immediately after the first parser GREEN, and pay for new branches by removing duplicate parsing rather than adding a late helper alone.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 6 | **Latest occurrence:** 2026-09-05

**Prevention:**
1. Before extending a shared parser or dispatcher, measure its line and complexity headroom; near-threshold files need an extraction in the initial GREEN design.
2. Keep parser modules dependency-light. A diagnostic subcommand may lazy-load audit/manifest code after dispatch, but argv parsing must not import that runtime.
3. Before the human gate, run Knip and path-integrity through full preflight; focused TypeScript and analyzer checks do not prove the command's public exports or documentation references are clean.
4. After behavioral GREEN, run whole-file ESLint, typecheck, and gruff before documentation or task completion; the verification unit is the changed file set, not only the new test cases.

**What happened:** The first M02 `skill doctor` implementation passed its behavioral suite (`20 passed`, `0 failed`) but failed the whole-file quality gate. `parseSkillPositionals` and `validateSkillFlags` exceeded ESLint complexity limits, the first doctor collector had two more complexity failures, and adding one branch pushed `cli-parser.ts` and `cli-handlers.ts` above the 750-line gruff threshold. The final preflight later caught an unnecessary `renderSkillDoctorMarkdown` export and a bare backticked filename in `docs/cli.md` (search: `Canonical workflow source`) that focused tests, ESLint, typecheck, Prettier, and targeted gruff did not cover.

**Root cause:** I treated a behavioral GREEN as permission to finish the command inside two already-large shared modules. The tests proved output behavior, but they did not measure whether the new subcommand left the parser and dispatch surfaces easy to verify. Importing doctor helpers back into the parser would also have violated the existing lazy-import pattern by loading audit and manifest dependencies for unrelated commands.

**Fix:** Extract lightweight positional/flag rules into `src/cli/skill-command-parser.ts` (search: `parseSkillPositionals`), keep doctor runtime imports behind `src/cli/cli-handlers.ts` (search: `handleSkillCommand`), and split collection decisions inside `src/cli/skill-doctor.ts` (search: `inspectFrontmatterFields`). Whole-file ESLint, typecheck, and targeted gruff then passed without suppressions or threshold changes.

**Incident ledger:**

- **Recurrence 2026-07-18:** M02 reached 61/61 focused tests and typecheck before ESLint rejected `parseCLIArgs` at complexity 12. A helper extraction then crossed the file-length gate; removing duplicate namespace parsing in `src/cli/cli-parser.ts` (search: `selectCommandPositionals`) cleared both without a new module.
- **Recurrence 2026-07-29:** The checker and comment pass grew `cli-handlers.ts` to 751 lines and `plans-export.ts` to 753. Extracting the complete effort-notation concern into `src/cli/plans-effort.ts` (search: `Effort-estimate notation parser`) cleared the destination-size problem.
- **Recurrence 2026-08-07:** Timing stamp validation passed 116 focused tests before ESLint rejected `parseStamp` at complexity 11. A helper extraction created five file-length warnings. Deriving UTC from the epoch inside `parseStamp`, folding regressions into existing cases, and preserving the `plans-time.ts` size cleared the gates without weakening invalid-calendar or rendered-heading checks.
- **Recurrence 2026-09-01:** Playbook inventory tests passed before preflight rejected `driftSkillPlaybookInventory` at complexity 11. Extracting `describePlaybookInventoryProblems` preserved the exact-set cases and restored ESLint.
- **Recurrence 2026-09-05:** Adding `--max-active` produced 1,015 substantive lines against the configured 1,000-line gate. Folding flag checks together still left 1,008 lines after formatting. Moving plan argument handling into `src/cli/cli-parser-plans.ts` (search: `validatePlansFlags`) cleared the size error without importing plan runtime into the parser.

---

## Lesson: Required CLI choices need omission tests

**Status:** active | **Created:** 2026-07-13
**Decision changed:** Test valid, invalid, omitted, and explicit fallback forms; preserve invocation shape when omission selects a fallback.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 6 | **Latest occurrence:** 2026-09-05

**Prevention:** Add omission RED tests before implementation.
Exercise a missing option argument through the CLI process as well as the parser: a raw parser exception can select the fatal exit instead of the promised usage exit.
Required values must fail when absent; optional transport metadata must be omitted rather than converted to a new sentinel value.
When the parser maps omission to a fallback, test omitted and explicit fallback forms separately.
Preserve the invocation evidence needed by downstream behavior.
In relationship tests, make every preceding prerequisite explicit and valid so the assertion proves the intended error path.
Cover capture enabled with and without an owner, plus owner present with and without capture for each supported runner and mode.
Also cover wrong-runner/mode and retry payload presence/absence.
Evidence anchors: `src/cli/cli-parser.ts` (search: `parseHookScenarioArg`), `src/cli/server/decoders.ts`
(search: `is supported only for Claude reporting sessions`),
`src/dashboard/dashboard-terminal-connect.ts` (search: `qualityReportProjectPath ?`), and `test/unit/dashboard-terminal-launch/launch-flow-03.test.ts`
(search: `carries staged-draft capture through a retried launch`).

**What happened:** M17's plan and handler required `--scenario deny-hook`, but the parser returned that value when the flag was absent. Positive, invalid-value, and live explicit-command checks all passed, so only a final omission probe exposed the false choice.

A second incident added a required quality-report owner whenever staged draft capture is enabled. The first retry implementation forwarded an absent owner as explicit `null`, and the existing retry contract caught the changed payload shape during VERIFY.

A third incident added a Claude/reporting-only relationship ahead of the owner relationship. The first missing-owner fixture omitted `accessMode`, so it exercised the new mode guard instead of the intended owner guard.

**Recurrence update (2026-08-22):** M40's first contextual-help GREEN rendered `menu` help for global `--help`.
The parser deliberately normalizes that request to the fallback `menu` command.
Command-topic tests passed, but the existing root-help contract failed.
Passing explicit invocation-shape evidence from the CLI entry point restored global navigation without changing parser grammar.
Evidence: `src/cli/cli-parser.ts` (search: `GLOBAL_INFORMATIONAL_FLAGS`), `src/cli/cli.ts` (search: `requestedHelpCommand`), and
`test/integration/cli-help.test.ts` (search: `shows exactly four executable examples`).

**Recurrence 2026-08-22 (exit-code guidance):** Shared contextual help kept the `review` usage, subcommand, options, and examples.
It dropped the command's exit-code guidance.
The generic topic test passed because it checked shared sections; the existing review test caught the missing contract during the full suite.
When moving bespoke help into shared metadata, preserve command-specific operating details.
Grep existing command tests before treating generic coverage as complete.
Evidence: `src/cli/help.ts` (search: `Structural failures exit 1`) and `test/unit/review-validate-verdict.test.ts`
(search: `advisory warnings.*exit 0`).

**Recurrence 2026-09-05:** The first `--max-active` implementation validated supplied values, but a missing argument raised Node's raw option error and the CLI exited 1. The process-level omission test required exit 2. `src/cli/cli-parser.ts` (search: `parseCLITokens`) now translates this option-value error into `CLIError`; other option errors retain their existing behavior. The reproduction in `test/unit/plans-check-forecast.test.ts` (search: `rejects the cap on export, every timing action, and non-plan commands`) passed after that correction.

**Root cause:** I treated omitted/defaulted fields as harmless while testing one relationship.
An earlier relationship could still reject the same payload first.
The same assumption erased the difference between an omitted command and an explicitly selected fallback command.

---

## Lesson: Command output shape must survive one and many selected files

**Status:** active | **Created:** 2026-08-09
**Decision changed:** Execute documented search commands with one, many, and zero selected files before treating their output as stable.
**Trigger phase:** VERIFY
**Incident count:** 1 | **Latest occurrence:** 2026-08-09

**Prevention:** When a documented command selects optional files, execute its literal body with one, many, and zero inputs. Require explicit path-labelled output when users need to identify the source, and require a named failure for empty selection. Evidence: `test/unit/playbook-contract.test.ts` (search: `runs the documented registration command in a consumer checkout`).

**What happened:** Present-file selection fixed hook-registration exit handling, but the first GREEN run passed only one consumer config to `rg`. Ripgrep then omitted the filename, so users saw the matching line without knowing which registration file supplied it; the focused suite reported 8/9 until `--with-filename` made single- and multi-file output consistent.

**Root cause:** The command relied on ripgrep's input-count-dependent filename default while its output was evidence about file ownership.

---

## Lesson: Advisory output must not erase existing empty-result guidance

**Status:** active | **Created:** 2026-08-24
**Decision changed:** Derive an empty-result message from the underlying result lanes before appending independent diagnostics.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 1
**Merged:** 2026-09-05 - moved here from `.goat-flow/learning-loop/lessons/test-snapshots.md`; this is a command output-shape contract, which this bucket owns.

**Prevention:** Evaluate fallback messages from their owning result lanes, or emit them before unrelated diagnostics join the report. Pair every new
advisory lane with existing empty-input and legacy-output contracts. Evidence anchors: `src/cli/plans-check.ts` (search: `No effort rows and no errors`),
`test/unit/plans-check-forecast.test.ts` (search: `default mode preserves legacy plans`), and `test/unit/plans-check.test.ts` (search: `single info line`).

**What happened:** M22 appended plain-language warnings to `plans check` before testing whether a legacy plan had no effort report. The warnings made
the shared output array nonempty, so the established `no effort estimates found` line disappeared. Focused M22 tests passed, while the fast suite
failed both existing estimate-less-plan contracts.

**Root cause:** The final rendered output array was reused as the semantic test for whether effort data existed. An unrelated advisory changed that
array without changing the plan's effort state.
