---
category: cli-contracts
last_reviewed: 2026-10-20
---

**Scope:** The CLI's own surface contract - parser headroom before refactoring, omission tests for required choices, output shape across one and many selections, and what an id-based comparison actually compares. Cooperation between separately-correct components is [integration-verification.md](integration-verification.md).

## Lesson: Preserve escaped controls when rewriting saved policy evidence

**Status:** active | **Created:** 2026-10-20
**Decision changed:** Check serialized bytes as well as parsed equality when editing a saved policy oracle; preserve escaped control characters.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Keep intentional Unicode test inputs escaped in JSON source. After rebuilding expectations, compare every original input and outcome, then run the repository's touched-file checks before presenting the patch. JSON parse equality alone does not prove the serialized artifact meets its text contract.

**What happened:** M13 recovery-message reconciliation used JSON serialization that turned two existing escape sequences into literal U+200B and U+202E. The candidate comparison and parsed-value checks passed, but live verification reported `FAIL Unicode` for `test/fixtures/hooks-bash/policy-reference.json`. Restoring the escaped spellings preserved all parsed values and yielded `PASS Unicode (0.12s) - 16 changed text file(s); 0 invisible control(s)`. The retained cases are `selftest-deny-git-mutations-4fa00485f47710e2-1` and `selftest-deny-git-mutations-bb2b605927dfbe1b-1`; the checker is `scripts/check-touched.mjs` (search: `runUnicodeCheck`).

---

## Lesson: Keep installer templates stable while verification runs

**Status:** active | **Created:** 2026-10-20
**Decision changed:** Finish template and generated-mirror writes before starting tests that copy or verify those templates; keep the live source tree stable until the run ends.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Parallelize read-only checks, but do not regenerate workflow hooks while installer or recovery tests are using them. If a run overlaps a source edit, retain its failure and rerun the owning test and required preflight against stable bytes before drawing a conclusion.

**What happened:** During M13, a hook-comment correction regenerated the live runtime mirrors while preflight was running. The recovery test in `test/integration/managed-divergence-messaging.test.ts` (search: `leaves a receipt-free checkpoint after interrupted cutover`) failed with the installer's managed-template mismatch error. With no further template writes, all 17 tests in that file passed, and the failing case also passed in isolation. The overlap suggests a template-copy race; a controlled interleaving has not reproduced that cause. The verification guard is in `src/cli/install-command.ts` (search: `Installer exited successfully, but`). The subsequent stable-tree preflight reported `PASS (with warnings)   74 checks · 4 warnings · 38.1s`.

---

## Lesson: Pipeline continuation changes must preserve heredoc and comment boundaries

**Status:** active | **Created:** 2026-10-20
**Decision changed:** Run the full retained corpus after changing pipeline boundaries; focused executable-pipeline cases do not prove that comment and heredoc text stay inert.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Before joining physical lines, distinguish an executable trailing pipe from pipe text inside a comment or heredoc body. Retain the corpus's ordinary-data controls alongside the executable cases. When those contexts are unresolved, keep the working parser and narrow the patch rather than introducing a new boundary rule.

**What happened:** A draft Node pipeline fix joined newlines after trailing pipes. Its focused tests passed, but full comparison changed two retained controls: an unquoted heredoc body containing `step one |` was refused, and a trailing comment ending in a pipe hid the following download-to-shell command. The newline change was rewound, both controls were rerun successfully, and newline-pipeline gaps remain open. The committed inputs and expectations are in `workflow/hooks/deny-dangerous/corpus.json` (search: `history-matrix-34-deny-dangerous`, `history-matrix-38-deny-dangerous`); executable boundaries are owned by `src/hooks/policy-segments.mts` (search: `consumeSegmentSeparator`).

**Recurrence (2026-10-20, substitution pipelines):** A combined output-flow draft passed its focused policy tests but exceeded the ESLint complexity limit and changed the existing denial text for `selftest-deny-dangerous-e5133c4c859034ae-1` without changing its denied status. The draft was withdrawn. Keep command-string and process-stream changes in separate batches, run lint before broad comparison, and compare diagnostic bytes as well as decisions. Evidence: `workflow/hooks/deny-dangerous/corpus.json` (search: `selftest-deny-dangerous-e5133c4c859034ae-1`) and `src/hooks/policy-evaluation.mts` (search: `preparePolicySegment`). The replacement command-string rule was kept isolated for review and applied after approval.

**Recurrence 2026-10-20, scanner integration:** The context-aware continuation draft hit the complexity limit in `scanHeredocCharacter`, then in `evaluatePolicyCommand`. The integration step was rewound before retrying. A typed command-frame predicate and a separate deferred-refusal ordering helper kept both dispatchers within their limits. Check an owning dispatcher's lint headroom before adding scan modes or another refusal branch. Evidence: `src/hooks/policy-heredoc.mts` (search: `scanHeredocCharacter`) and `src/hooks/policy-evaluation.mts` (search: `evaluatePolicyCommand`). The replacement remains an isolated candidate; its full comparisons retain the heredoc/comment controls and report 28 differences without new difference IDs.



---

## Lesson: Exercise the CLI after extracting a dynamically imported module

**Status:** active | **Created:** 2026-10-20
**Decision changed:** After extracting a dynamically imported module, test the real CLI as well as its imported API, and check whether the new module imports its entrypoint.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Do not await a dynamic import at module top level when the imported module needs exports from that same entrypoint. Start the asynchronous CLI dispatch after defining the module, and preserve a process-level success case alongside the direct API test.

**What happened:** The candidate runner was extracted from `scripts/check-hook-parity.mjs` into `scripts/check-hook-parity-candidate.mjs`, which imports shared reference helpers from the original module. The direct parity suite passed, but the CLI's top-level `await import()` stalled module initialization and Node exited 13 with an unsettled-top-level-await warning. `scripts/check-hook-parity.mjs` (search: `async function runCli`) now starts the dispatch without a top-level wait. `test/integration/hook-parity.test.ts` (search: `assert.equal(cli.status, 0, cli.stderr)`) exercises the actual CLI before the direct API checks.

---

## Lesson: Validator fixtures must exercise documented input alternatives

**Status:** active | **Created:** 2026-09-21
**Decision changed:** Compare a validator's accepted fixtures with each documented input branch before treating a green suite as contract coverage.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 2 | **Latest occurrence:** 2026-10-10
**Severity:** CORRECTNESS

**Prevention:** Test a valid input for each materially different evidence branch, its missing-evidence control, and any legacy default. For retained evidence, pair producer-generated valid captures with freshly rehashed contradictions between fields; test admission through the public consumer. For citation grammar, pair each supported punctuation form with an unrelated-sentence control. A passing check proves only the inputs its parser recognizes; inspect extraction before interpreting an empty findings array as complete validation.

**What happened:** During the 1.17.0 release follow-up, production scaffold probes rejected technique, pattern and reference receipts for lacking discipline pressure and rationalisation, although the authoring guide permits capability tests. A separate citation probe showed that a period immediately after a file path hid both valid and stale needles. Existing discipline and unrelated-sentence controls passed while those valid-input branches failed.

**Root cause:** The exercised receipt fixtures represented only discipline evidence, and citation extraction treated direct punctuation like intervening prose. The fixes preserve the old discipline default and unrelated-sentence exclusion while accepting the documented alternatives. Evidence: `src/cli/skill-author-red-log.ts` (search: `validateSkillTypeEvidence`), `test/integration/skill-author.test.ts` (search: `skill from capability evidence without invented pressure`), `src/cli/facts/shared/search-anchors.ts` (search: `activeFilePathAfterGap`), and `test/unit/check-content-quality.test.ts` (search: `checks a direct citation after sentence punctuation without borrowing across prose`).

**Recurrence 2026-10-10:** During the PR 67 double-check, I found that my retained-authority fix validated field shapes and hashes but missed relationships between source selection and inventory. A freshly rehashed capture selected live bytes while describing index bytes; the saved-quality path incorrectly confirmed its fix claim. A two-dot range also accepted a comparison base different from its left endpoint. Producer-generated controls now cover each source variant after a later workspace edit, while rehashed negative controls reject contradictory origins, revisions, parents, bases, Git context and unchanged comparison members. Evidence: `src/cli/review-validate-snapshot.ts` (search: `checkInventoryOrigins`), `test/integration/review-validate-authority.test.ts` (search: `rejects rehashed retained captures with contradictory source relationships`), and `test/integration/quality-history-diff.test.ts` (search: `rejects correctly rehashed malformed captures`).

---

## Lesson: Quality diff compares saved report IDs, not report file paths

**Status:** active | **Created:** 2026-07-12

**Prevention:** Run `goat-flow quality diff --agent <id> --mode <mode>` for the latest matching pair, or pass one `<from-id>:<to-id>` argument as documented in `docs/cli.md` (search: `quality diff [<from-id>:<to-id>]`). Do not pass report filesystem paths.

**What happened:** During final quality-report verification, I passed two JSON file paths to `quality diff`. The CLI exited 2 because an explicit comparison is one colon-delimited `<from-id>:<to-id>` argument; selecting the latest same-agent reports with `--agent codex --mode agent-setup` then completed successfully.

**Root cause:** I inferred a conventional two-path diff interface instead of reading the command contract before the auxiliary close-out check.

---

## Lesson: New subcommands need parser headroom before the first GREEN refactor

**Status:** active | **Created:** 2026-07-13
**Severity:** INTEGRATION
**Decision changed:** Measure whole-file ESLint and gruff immediately after the first parser GREEN, and pay for new branches by removing duplicate parsing rather than adding a late helper alone.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 10 | **Latest occurrence:** 2026-10-18

**Prevention:**
1. Before extending a shared parser or dispatcher, measure its line and complexity headroom; near-threshold files need an extraction in the initial GREEN design.
2. Keep parser modules dependency-light. A diagnostic subcommand may lazy-load audit/manifest code after dispatch, but argv parsing must not import that runtime.
3. Before the human gate, run Knip and path-integrity through full preflight; focused TypeScript and analyzer checks do not prove the command's public exports or documentation references are clean.
4. After behavioral GREEN, run whole-file ESLint, typecheck, and gruff before documentation or task completion; the verification unit is the changed file set, not only the new test cases.

**What happened:** The first `skill doctor` implementation passed its behavioral suite (`20 passed`, `0 failed`) but failed the whole-file quality gate. `parseSkillPositionals` and `validateSkillFlags` exceeded ESLint complexity limits, the first doctor collector had two more complexity failures, and adding one branch pushed `cli-parser.ts` and `cli-handlers.ts` above the 750-line gruff threshold. The final preflight later caught an unnecessary `renderSkillDoctorMarkdown` export and a bare backticked filename in `docs/cli.md` (search: `Canonical workflow source`) that focused tests, ESLint, typecheck, Prettier, and targeted gruff did not cover.

**Root cause:** I treated a behavioral GREEN as permission to finish the command inside two already-large shared modules. The tests proved output behavior, but they did not measure whether the new subcommand left the parser and dispatch surfaces easy to verify. Importing doctor helpers back into the parser would also have violated the existing lazy-import pattern by loading audit and manifest dependencies for unrelated commands.

**Fix:** Extract lightweight positional/flag rules into `src/cli/skill-command-parser.ts` (search: `parseSkillPositionals`), keep doctor runtime imports behind `src/cli/cli-handlers.ts` (search: `handleSkillCommand`), and split collection decisions inside `src/cli/skill-doctor.ts` (search: `inspectFrontmatterFields`). Whole-file ESLint, typecheck, and targeted gruff then passed without suppressions or threshold changes.

**Incident ledger:**

- **Recurrence 2026-07-18:** The change reached 61/61 focused tests and typecheck before ESLint rejected `parseCLIArgs` at complexity 12. A helper extraction then crossed the file-length gate; removing duplicate namespace parsing in `src/cli/cli-parser.ts` (search: `selectCommandPositionals`) cleared both without a new module.
- **Recurrence 2026-07-29:** The checker and comment pass grew `cli-handlers.ts` to 751 lines and `plans-export.ts` to 753. Extracting the complete effort-notation concern into `src/cli/plans-effort.ts` (search: `Effort-estimate notation parser`) cleared the destination-size problem.
- **Recurrence 2026-08-07:** Timing stamp validation passed 116 focused tests before ESLint rejected `parseStamp` at complexity 11. A helper extraction created five file-length warnings. Deriving UTC from the epoch inside `parseStamp`, folding regressions into existing cases, and preserving the `plans-time.ts` size cleared the gates without weakening invalid-calendar or rendered-heading checks.
- **Recurrence 2026-09-01:** Playbook inventory tests passed before preflight rejected `driftSkillPlaybookInventory` at complexity 11. Extracting `describePlaybookInventoryProblems` preserved the exact-set cases and restored ESLint.
- **Recurrence 2026-09-05:** Adding `--max-active` produced 1,015 substantive lines against the configured 1,000-line gate. Folding flag checks together still left 1,008 lines after formatting. Moving plan argument handling into `src/cli/cli-parser-plans.ts` (search: `validatePlansFlags`) cleared the size error without importing plan runtime into the parser.
- **Recurrence 2026-09-19:** A test file hit the same gate twice in one milestone. Seven new hook cases took `test/integration/gruff-code-quality-contract.test.ts` to 1,002 substantive lines; shortening the case labels bought 14 lines, and two more tests then took it to 1,038. The cases moved to `test/integration/gruff-code-quality-quiet-feedback.test.ts` (search: `quiets edits outside the analysed scope`), which needed a second allowlist approval mid-milestone. Measure a test file's Gruff headroom before the first case is added, and plan the new file when the headroom is smaller than the planned cases.


- **Recurrence 2026-10-18:** The M09 native segment port hit the same verification limits: quote, separator and tracking helpers exceeded ESLint complexity 10, and the directory fixture table exceeded the test-function length limit. Focused behavior tests alone did not establish acceptance. In `src/hooks/policy-segments.mts` (search: `segmentSeparatorWidth`, `directoryCommandStart`, `configCommandStart`), separate parsing decisions restored typed lint. In `test/unit/hook-policy-segments.test.ts` (search: `directoryContextCases`), keeping the unchanged table outside the test function restored the warning ratchet. Measure both source and test headroom before extending either; preserve every assertion when relocating fixture data.

- **Recurrence 2026-10-18 (write rules):** The M10 direct port passed five focused tests before ESLint rejected `cobraBooleanFlagEnabled` at complexity 17 and `isGitLfsWriteTarget` at 30. The first extraction still left the LFS classifier at 12. In `src/hooks/deny-dangerous/patterns-writes.mts` (search: `scanCobraArguments`, `isLfsWriteCommand`), sharing option scanning and separating mutation-family matching brought every function below the unchanged limit. Read lint complexity before broad proof; a first helper extraction alone is not evidence that the whole file passes. The broader checks also rejected a test non-null assertion and a nested code-map row; both were corrected without dropping cases. The continuation hit complexity limits in Git option/pathspec loops and exact optional-property typing in fetch parsing. Split option recognition from traversal, omit absent fields instead of assigning undefined, and run typed lint immediately after each batch. A frozen comparison exposed lost command-substitution newline trimming in `isGitPublicationAliasConfig`; its quoted trailing-newline assertion now retains the publication decision. The invocation continuation also exceeded complexity limits in global-option and saved-alias helpers. Separating option retention, directory selection and supervised lookup restored the same limit; the first split still exceeded it and required another inspection. In `src/hooks/deny-dangerous/git-command.mts` (search: `consumeGlobalOption`, `readGitAlias`), the caller supplies the remaining deadline and the existing supervisor owns bounded output and cleanup. The new direct test initially expected a bare `stash` alias to omit the conservative history flag; 281 frozen invocation comparisons established the retained result, and `test/unit/hook-policy-writes.test.ts` (search: `preserves direct and inline-alias write decisions`) now asserts it.


- **Recurrence 2026-10-18 (path rules):** The M12 port passed its first frozen comparisons but still exceeded ESLint complexity 10 in quote, search and credential handlers. Shared option-state traversal also triggered TypeScript's circular inference until its local result had an explicit type. In `src/hooks/deny-dangerous/patterns-paths.mts` (search: `searchOptionAt`, `searchWordsTouchSecret`, `ghAuthShowsToken`), keeping option recognition separate from traversal restored typed lint without changing the reference outcomes. Run the actual ESLint limit and compiler after each bounded source batch; Gruff's separate complexity threshold is not a substitute.

---

## Lesson: Required CLI choices need omission tests

**Status:** active | **Created:** 2026-07-13
**Severity:** CORRECTNESS
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

**What happened:** The plan and handler required `--scenario deny-hook`, but the parser returned that value when the flag was absent. Positive, invalid-value, and live explicit-command checks all passed, so only a final omission probe exposed the false choice.

A second incident added a required quality-report owner whenever staged draft capture is enabled. The first retry implementation forwarded an absent owner as explicit `null`, and the existing retry contract caught the changed payload shape during VERIFY.

A third incident added a Claude/reporting-only relationship ahead of the owner relationship. The first missing-owner fixture omitted `accessMode`, so it exercised the new mode guard instead of the intended owner guard.

**Recurrence update (2026-08-22):** The first contextual-help GREEN rendered `menu` help for global `--help`.
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
Evidence: `src/cli/help.ts` (search: `Structural failures exit 1`) and `test/unit/review-command-parser.test.ts`
(search: `advisory warnings.*exit 0`).

**Recurrence 2026-09-05:** The first `--max-active` implementation validated supplied values, but a missing argument raised Node's raw option error and the CLI exited 1. The process-level omission test required exit 2. `src/cli/cli-parser.ts` (search: `parseCLITokens`) now translates this option-value error into `CLIError`; other option errors retain their existing behavior. The reproduction in `test/unit/config-reader.test.ts` (search: `rejects the cap on export, every timing action, and non-plan commands`) passed after that correction.

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

**What happened:** The change appended plain-language warnings to `plans check` before testing whether a legacy plan had no effort report. The warnings made
the shared output array nonempty, so the established `no effort estimates found` line disappeared. Focused tests passed, while the fast suite
failed both existing estimate-less-plan contracts.

**Root cause:** The final rendered output array was reused as the semantic test for whether effort data existed. An unrelated advisory changed that
array without changing the plan's effort state.

---

## Lesson: Worst-case report rules need a before-and-after run over real archived inputs

**Status:** active | **Created:** 2026-10-11
**Decision changed:** Before shipping a conservative rule that adds report text for each unreadable input, snapshot the command over every local plan before and after the change and group the difference by plan and clause.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 1 | **Latest occurrence:** 2026-10-11

**Prevention:** Capture `plans check` readiness and join lines for every local plan in default, strict and raised-cap modes before editing, rerun after, and group the difference by plan before calling the change narrow. A rule that gives each unreadable milestone a line naming every other unreadable milestone grows with the square of plan size. Evidence anchors: `src/cli/plans-check-summary.ts` (search: `an unreadable Status is not known to be unstarted`) and `test/unit/plans-check.test.ts` (search: `counts an unsupported status as possibly holding the cap`).

**What happened:** Applying "an unreadable field means wait" to a milestone's own Status gave every such milestone a `waiting:` line that also listed the others as possible cap holders. Focused tests passed. A before-and-after snapshot of local plans, measured 2026-10-11, changed 141 plan-and-mode blocks, mostly archived plans written with older Status wording such as `done (date)`. Printing no line for a milestone whose own Status is unreadable, while still counting it as possibly active for others, kept the guarantee and cut the change to 22 blocks, each from a plan that really contained an unreadable field.

**Root cause:** The fixtures placed one invalid milestone among valid ones, so they could not show how the rule scaled when most milestones in a plan used legacy vocabulary.

---

## Lesson: Preserve newline matching when porting Bash regular expressions

**Status:** active | **Created:** 2026-10-18
**Decision changed:** Compare quoted filenames and C-locale character boundaries against the original engine before accepting a regex port.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Bash ERE dot matches newlines inside a quoted word. Use JavaScript dotAll only where that original rule requires it; keep ASCII character classes explicit. Compare both engines on newline-bearing operands before broad proof.

**What happened:** The first native key-extension matcher copied Bash's pattern into JavaScript without dotAll. All 99 initial helper comparisons agreed, but additional boundary probes found that quoted filenames containing LF or U+2028 were protected by Bash and missed by the candidate. The candidate was isolated and no proposed command ran.

**Evidence:** `src/hooks/deny-dangerous/patterns-paths.mts` (search: `keyMaterialPathTouch`) preserves dotAll for that filename rule. `test/unit/hook-policy-paths.test.ts` (search: `private\nname.key`) retains both reproduced operands beside ordinary key files and query-data controls.

---

## Lesson: Type an injected policy evaluator from its whole callee chain

**Status:** active | **Created:** 2026-10-19
**Decision changed:** Before fixing the callback type of an evaluator that is not ported yet, trace the callees it will reach; if any of them waits on a process, the callback returns a promise.
**Trigger phase:** ACT
**Caught at:** ACT

**Prevention:** A helper ported ahead of its evaluator must still compose with the real one. Saved Git alias lookup spawns `git` under the hook deadline, so any evaluator that can reach Git rules is asynchronous.

**What happened:** M13 batch 2 typed the substitution checker's evaluator as synchronous, and that batch was approved and applied with matching comparisons. Designing batch 3 showed the shared evaluator reaches saved-alias lookup, so batch 3 changed the checker to await an asynchronous evaluator before any real caller existed.

**Evidence:** `src/hooks/policy-substitutions.mts` (search: `export type PolicySegmentEvaluator`) and `src/hooks/deny-dangerous/git-command.mts` (search: `async function readGitAlias`).

---

## Lesson: Preserve longest-match semantics when porting command parsers

**Status:** active | **Created:** 2026-10-18 | **Evidence:** ACTUAL_MEASURED
**Severity:** SECURITY
**Decision changed:** Compare ambiguous command grammar against the original parser before accepting a regex port.
**Trigger phase:** ACT | **Caught at:** VERIFY

**Prevention:** A POSIX expression can select a longer alternative than JavaScript's first successful alternative. For command conditions, compare every valid form and optional-prefix interpretation, then retain the longest consumed span. Test an ambiguous keyword operand alongside the ordinary forms.

**What happened:** The M09 Node parser exposed `equ git push origin main` from `if defined equ equ git push origin main`; the frozen Bash parser exposed `git push origin main`. Treating the leading `equ` as an executable could hide the protected Git command. The existing ordinary-condition cases had passed.

**Fix and evidence:** `src/hooks/policy-syntax.mts` (search: `longestPolicyCmdCondition`) compares unary and comparison forms with their valid optional prefixes. `test/unit/hook-policy-syntax.test.ts` (search: `if defined equ equ git push origin main`) retains the reproduction and its prefixed form. The reference remains `test/fixtures/hooks-bash/workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `native_cmd_condition_re`); its bytes were unchanged. Direct comparisons now expose the same command. Complete policy verdicts remain a separate integration requirement.
