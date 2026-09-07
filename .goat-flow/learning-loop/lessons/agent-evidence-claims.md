---
category: agent-evidence-claims
last_reviewed: 2026-09-08
---

**Scope:** What counts as citable evidence - mechanism claims need a read source, absence and exact-count claims need untruncated searches, gitignored paths are never durable anchors, and final verification gates need supported scopes with captured logs. Reading the request and retrieving memory is [agent-behavior.md](agent-behavior.md); using tools and the environment is [agent-tooling.md](agent-tooling.md).

## Lesson: A config change that fails to fix a symptom is not proof of the mechanism

**Status:** active | **Created:** 2026-08-16
**Decision changed:** Read a tool's own schema or source before stating why one of its options did not work.
**Trigger phase:** READ
**Caught at:** VERIFY
**Incident count:** 1 | **Latest occurrence:** 2026-08-16

**Prevention:** When an option does not do what you expected, read its definition before explaining why; `node_modules/<pkg>/schema.json`, the type declarations, or the source are cheaper than another timed run and are authoritative. State symptom evidence as symptom evidence ("adding it did not stop the OOM") and keep the mechanism claim separate until something documents it. Evidence anchor: `.goat-flow/learning-loop/footguns/preflight-plumbing.md` (search: `Knip's `ignore` cannot shrink what preflight`).

**What happened:** Adding a large directory to `knip.json` `ignore` did not stop a Knip out-of-memory failure in preflight, and the report stated that "`ignore` filters reported issues, not what it reads" as a read fact. When the user asked whether Knip really could not ignore the folder, the claim was walked back, then reinstated after reading `node_modules/knip/schema.json`, whose `ignore` title is "Files to exclude from the report (any issue type)".

**Root cause:** A mechanism was inferred from one negative result and stated with the confidence of a read fact; a config change that does not fix a symptom has many explanations, and the confident answer then flip-flopped under one question.

## Lesson: Agent cited gitignored content as evidence in committed docs

**Status:** active | **Created:** 2026-05-11
**Decision changed:** Before citing a local file as durable evidence, verify that Git tracks it or cite the committed detector or source that supports the claim.
**Incident count:** 5 | **Latest occurrence:** 2026-09-03

**Prevention:**
1. Never cite a `.goat-flow/scratchpad/`, `.goat-flow/plans/`, `.goat-flow/logs/sessions/`, `.goat-flow/logs/quality/`, or `.goat-flow/logs/critiques/` path from a committed file; those subtrees are gitignored except anchor files (`README.md`, `.gitignore`, `.gitkeep`). Promote source material to a committed location first, or restate the principle without the citation.
2. Strip third-party and competitor skill or vendor names from generic guidance; state the pattern provider-neutrally and use placeholders such as `<VENDOR>_API_KEY`.
3. Apply the same rule to test files and code comments; fixtures and inline comments shape contributor habits.
4. When auditing docs, run `command grep -rnE '\.goat-flow/(scratchpad|plans|logs)/' --include='*.md' --include='*.ts' .` for gitignored citations plus a project-specific list of competitor names, and record findings in the `docs-and-crossrefs` footgun resolution rounds. The detector is structural: `src/cli/facts/shared/learning-loop-common.ts` (search: `gitignored path used as durable evidence anchor`) fails evidence-grammar references to gitignored paths, and `src/cli/facts/shared/learning-loop-common.ts` (search: `isCheckableForStaleness`) resolves backticked slash-containing paths locally.

**What happened:** A 2026-05-11 documentation audit found four committed surfaces citing `.goat-flow/scratchpad/skills-example-prime/...` skill files as authoritative evidence: `docs/dashboard.md` for the anti-convergence checklist, `.goat-flow/skill-docs/skill-quality-testing/README.md` for two authoring patterns and a verification-claim table, `.goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md` as verbatim "empirical evidence" with a search anchor, and `workflow/skills/reference/skill-preamble.md`, which allowed Excuse/Reality additions from "the prime corpus". The same surfaces leaked third-party skill names (MySQL, Valyu, a writing-skills pack, an external frontend-design skill) and a `VALYU_API_KEY` example. The Evidence Standard requires citations anyone can re-read: `workflow/skills/reference/skill-preamble.md` (search: `re-read each cited file and anchor`); the surfaces fixed are recorded in `.goat-flow/learning-loop/footguns/docs-drift.md` (search: `Round 4 (2026-05-11`).

**Root cause:** Pattern docs seeded from material staged under `.goat-flow/scratchpad/` kept verbatim citations because the path lived inside `.goat-flow/`, missing that the whole subtree is gitignored, and imported provider vocabulary with the structural pattern.

**Recurrence 2026-07-16:** Pre-1.14.0 quality report `2026-07-16-1018-codex-vwcaf` found five new `.goat-flow/scratchpad/related/` citations in `.goat-flow/learning-loop/lessons/coordination.md`, the external-lessons patterns bucket (empty since 2026-08-01 and removed 2026-09-02), and `.goat-flow/learning-loop/patterns/refactoring.md`; each now cites upstream provenance in plain prose.
**Recurrence 2026-07-17:** `.goat-flow/plans/**` and one quality-report path were cited as durable evidence in seven lessons and four footguns, three of them already deleted; all were replaced with committed anchors or plain prose, and the detector above became the structural prevention.
**Recurrence 2026-08-06:** A new recurrence about an ignored-search failure cited the renamed gitignored milestone; `stats --check` failed with `stale-ref` and `gitignored path used as durable evidence anchor`, and the citation was replaced with the ignore rule and detector anchors.
**Recurrence 2026-09-03:** A committed verification lesson named a gitignored session receipt while cross-linking Security Quick deployment evidence; write-scope reconciliation caught it before closeout, and the lesson now cites `.goat-flow/learning-loop/lessons/verification-testing.md` (search: `Depth headings do not create runtime stop boundaries`) and `test/contract/skill-hardening-security-2.test.ts` (search: `uses one Quick gap-ledger row while Full keeps exhaustive rows`).

---

## Lesson: Structural audit pass does not mean the project is correct

**Status:** active | **Created:** 2026-03-31

**Prevention:** Do not treat a structural audit pass as a quality gate for the whole project; use structural checks for what they cover and preflight or targeted verification for functional correctness, and investigate when they disagree.

**What happened:** goat-flow scored 100 percent on its own scanner system (removed per ADR-013) while `preflight-checks.sh` failed with 8 errors; the scanner checked structural presence, preflight checked that commands work, paths resolve, and versions match.

---

## Lesson: Single-source-of-truth claims need a cold-path review pass

**Status:** active | **Created:** 2026-04-18

**Prevention:** When claiming a single writable authority, run a cold-path pass for hardcoded enums, literal allowlists, and docs or templates restating the same contract. The migration is complete only when manifest, installer, config validation, audit failures, and frontend payload readers agree on one authority.

**What happened:** M12 moved agent support metadata into `workflow/manifest.json`, but a follow-up review still found parallel authority: Codex had a fictional `post_turn: "Stop"` event in the manifest, the dashboard frontend narrowed injected agent ids back to `claude | codex | gemini`, and unknown `.goat-flow/config.yaml` `agents:` ids only warned, so audit status stayed green.

---

## Lesson: Verify agent capabilities against official docs, not assumptions

**Status:** active | **Created:** 2026-04-15 | **Merged during:** M11 learning-loop consolidation

**Prevention:** When a profile field says an agent cannot do something, verify against current product docs and runtime evidence before building a workaround. For Codex permission grammar the anchors are `workflow/hooks/agent-config/codex.toml` (search: `hooks = true`), `.goat-flow/hooks/deny-dangerous/patterns-paths.sh` (search: `is_secret_path_touch`), and `src/cli/facts/agent/settings.ts` (search: `collectCodexWorkspaceRootEntries`).

**What happened:** Codex was assumed to lack PreToolUse hook support, so its profile left the hook field empty and a parallel Starlark execpolicy workaround was built; later doc and runtime checks showed Codex did support hooks, leaving copied guardrail scripts as dead code until registration was fixed.

**Root cause:** A stale platform assumption propagated through templates, install scripts, fact extraction, and setup guides without a check against primary docs or the binary.

---

## Lesson: Absence claims need untruncated searches

**Status:** active | **Created:** 2026-07-03
**Incident count:** 3 | **Latest occurrence:** 2026-08-16

**Prevention:** Before claiming a pattern is absent, rerun the exact single pattern with no `head` or `tail` truncation, or count with `grep -c`. For an exact path claim, use `test -e` on that path or an exact tracked-file query; a filename filter designed for neighbouring names is only a sample. Derive an exact-count claim from the widest search it implies, `git grep` over the tracked tree, before pinning it into a stop condition. Evidence anchor: `scripts/preflight-checks.sh` (search: `Learning-Loop Schema`).

**What happened:** `grep -n "stats\|quality\|audit\|index" scripts/preflight-checks.sh | head -20` showed no `stats` hit, and the analysis claimed `stats --check` ran in no local gate; the `head -20` had truncated the match list, and preflight's Learning-Loop Schema section already ran `node dist/cli/cli.js stats . --check`. The user's "double check" exposed the false absence claim before it shaped the fix.

**Root cause:** A multi-pattern grep piped through `head` answers "what appears early", not "does X appear at all".

**Recurrence 2026-08-12:** A `5-call` census over six hand-picked directories returned seven paths, about to ship as an exact-count stop condition; `git grep -ln "5-call"` over the tracked tree returned eight, because `.goat-flow/learning-loop/decisions/ADR-042-cross-harness-invocation-ask-first.md` (search: `5-call`) sat outside every scanned directory.
**Recurrence 2026-08-16:** An M04 path audit filtered filenames with contiguous `hooks-runtime` and reported that `hooks-configured-runtime-evidence.ts` did not exist; `test -e` disproved it immediately. `src/cli/hooks-configured-runtime-evidence.ts` (search: `readManagedConfiguredHookState`).

---

## Lesson: A learning-loop entry's evidence lines are claims, not proof

**Status:** active | **Created:** 2026-08-07
**Decision changed:** Re-read cited call sites when reusing a claim, and update the learning entry when later code changes invalidate it.
**Trigger phase:** READ

**Prevention:**
1. Before restating a learning-loop claim in a plan, report, or recommendation, open the cited call site; the entry supplies the anchor to check, not the answer.
2. Prove reach by running the command, not by reading the gate: `audit .` reports `Agent deny mechanism: skipped`, `audit . --agent claude` reports `pass`.
3. Never widen a source's qualifier; if the entry says `--agent <id>`, the restatement says `--agent <id>`.
4. When an entry is wrong, correct it in place with the dating evidence and grep for what inherited it.
5. `ACTUAL_MEASURED` means the author measured something once; date it against the code with `git log -L <lines>:<file>`.
6. When behaviour changes at a cited call site, search the learning-loop indexes for that file or symbol and update affected entries in the same change; index freshness cannot detect a semantically obsolete claim.

**What happened:** `footguns/auditor.md` was cited to assert that `goat-flow audit` executes an untrusted checkout's hook launcher by default and that the dashboard was already safe on `"static"`; a cross-harness review disputed both. The CLI claim needed the `--agent` qualifier, and `buildDashboardAuditReport` then requested `"full"`. Commit `9007a9e` corrected the entry at 07:09 on 2026-08-07; commit `19046c08` changed the dashboard branch to `"static"` at 17:06 without updating this lesson or the footgun. `test/integration/dashboard-audit-api.test.ts` (search: `does not execute selected-project hook launcher in /api/audit`) proves the selected-agent endpoint does not run the configured launcher.

**Root cause:** A bucket entry tagged `ACTUAL_MEASURED` was treated as verified truth; the qualifier was dropped, a call site was forwarded unread, and later code changed the corrected behaviour without refreshing the entries describing it.

---

## Lesson: Final verification gates need supported scopes and captured logs

**Status:** active | **Created:** 2026-05-19
**Decision changed:** Use repository-owned package scripts for supported gates; baseline bespoke checks and scope them to the claim they prove.
**Trigger phase:** VERIFY
**Incident count:** 24 | **Latest occurrence:** 2026-08-28

**Prevention:** Run supported format, lint, Knip, and test gates with captured output, one command per gate. A predecessor may exempt one named RED fixture only when a blocked dependent owns it; preserve the full failure receipt, run every other test, and keep the green gate downstream. Any extra failure stops. Copy each gate's invocation from its owner instead of improvising a scope, and quote the literal result line: `package.json` (search: `test:fast`), `package.json` (search: `"format:check"`), `scripts/preflight-checks.sh` (search: `lint_targets[@]`), `knip.json` (search: `ignoreDependencies`). Evidence anchor: `test/integration/setup-install-agent-matrix.test.ts` (search: `must have one exact registration`).

**What happened:** Several closeouts sent ignored tests or workflow `.mjs` files to TypeScript-only ESLint, and one ran `npm test` beside expensive checks and lost the failing block; a captured rerun passed (`# tests 881`, `# pass 881`, `# fail 0`).

**Root cause:** Repo-supported verification scopes were mixed with improvised paths, and parallel final gates were treated as interchangeable with a clean final evidence run, so the first failure was ambiguous and had to be rerun.

**Recurrences 2026-05-19 and 2026-08-08:** Commit-guidance helpers passed focused tests, but preflight reported `Knip: 2 unused exports/types`; making internal types private fixed it. Later, removing the history detector also removed the cited `CommitGuidanceStatus`, so audit failed on a stale anchor until the type was kept as the template-copy status. Run `goat-flow stats --check` before deleting cited symbols. `src/cli/prompt/commit-guidance.ts` (search: `type CommitGuidanceStatus`).
**Recurrence 2026-05-19 (perf fixture):** A dashboard Markdown performance test used a newline-heavy 500KB fixture; focused runs passed, but preflight's concurrent fast suite exceeded the 100ms budget, and the fixture was changed to measure plain Markdown throughput.
**Recurrences 2026-05-26 and 2026-06-14:** The same test, since removed with the 1.13.0 viewer (formerly `test/unit/dashboard-markdown.test.ts`), passed alone and in `npm test` but failed under `npm run test:coverage` with `expected <100ms, got 115ms` and later `159ms`; a 750ms ceiling stayed machine-sensitive, so the test compared the 500KB render with a same-process 100KB baseline.
**Recurrence 2026-07-03:** Every 1.13.0 milestone passed its scoped gate, but `npm run publish:check` found three full-tree failures: `test/integration/dashboard-server.test.ts` still matched `alpinejs@3` after the asset was vendored at `/assets/alpine.js`; `appendQualityReportContract` shipped at complexity 21 because scoped ESLint checked only the diff; deleting `coming-soon` left its name in `.goat-flow/code-map.md`, `docs/dashboard.md`, `.goat-flow/architecture.md`, and seven backticked learning-loop references that tripped the round-trip fixture's preflight. Run publish-check last after deleting files, moving symbols, or swapping served assets.
**Recurrences 2026-07-12 and 2026-08-09:** Two hook-contract batches aimed ESLint at ignored tests; `--no-ignore` failed outside the parser project, and one batch omitted Gruff's `analyse` subcommand. `test/contract/command-phrases.test.ts` (search: `agent mutation and external-write authority`), `test/unit/playbook-contract.test.ts` (search: `assertRegistrationCommandForEachPlaybook`).
**Recurrence 2026-07-12:** A gate listed ignored unit and integration files in `npx eslint --max-warnings 0`; the corrected gate linted only changed `src/cli/audit/` files. `eslint.config.mjs` (search: `"test/**"`).
**Recurrence 2026-07-13:** A context-report gate hit Prettier on three files, ESLint on out-of-project tests, and Knip on four internal exports. `test/unit/context-report.test.ts` (search: `static context report`).
**Recurrence 2026-07-31:** Two audit batches caught ESLint complexity, a Node directory target, a probe without `PATH`, and stale terminal-environment smoke expectations; the fixes extracted a helper, targeted `*.test.ts` (91/91), reused `process.env`, and aligned the smoke contract (20/20). `src/cli/audit/check-factual-claims.ts`, `test/smoke/dashboard-endpoints.test.ts` (search: `GOAT_CLAUDE_REPORTING_SETTINGS`).
**Recurrence 2026-08-07:** An EXIT-trap cleanup made the executor reject M05's `test:fast` wrapper before npm ran; retaining the printed `mktemp` log produced `1580` passes and `0` failures, and gate wrappers no longer bundle destructive cleanup.
**Recurrence 2026-08-09:** A runtime-adapter check sent workflow `.mjs` to TypeScript-only ESLint; workflow modules use `node --check`, Prettier, targeted Gruff, runtime fixtures, and preflight instead. `workflow/hooks/hook-provider-adapters.mjs` (search: `Decodes bounded provider-neutral hook results`), `scripts/preflight-checks.sh` (search: `lint_targets[@]`).
**Recurrence 2026-08-14:** M03 ran `scripts/generate-managed-hook-desired-state.mjs` with plain Node, which could not resolve `registry.ts`'s `.js` import of the TypeScript manifest; the `check:managed-hook-contract` package script supplied `--import tsx`. `package.json` (search: `check:managed-hook-contract`), `src/cli/agents/registry.ts` (search: `loadManifest`), `scripts/generate-managed-hook-desired-state.mjs` (search: `managed-hook contract current`).
**Recurrence 2026-08-14 (path integrity):** Full preflight rejected the slash-joined "workflow" and "job permissions" phrase in all three goat-security mirrors as a framework-local path, the generic skill-creator validator rejected the required `goat-flow-skill-version`, and backticking the slash phrase while recording the incident triggered `stale-ref`. `scripts/check-path-integrity.sh` (search: `framework-local`), `scripts/check-versions.mjs` (search: `goat-flow-skill-version`), `src/cli/facts/shared/reference-paths.ts` (search: `export function isFileRef`), `workflow/skills/goat-security/references/supply-chain-and-cicd.md` (search: `workflow and job permissions`).
**Recurrence 2026-08-15:** Four PR-backed skill RED attempts spent their bounded implementation calls reproducing fixture seals with unavailable isolate hashing, over-limit segments, or cleanup displacing final-state verification; all four were excluded, and host preflight now seals fixtures. `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `Command has more than 50 chained segments`), `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `rm -r without safe scoping`), `.goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md` (search: `Each phase is one isolated evaluator run`).
**Recurrence 2026-08-15 (owner comparison):** An exact-owner comparison repeated the over-50-segment failure and proved nothing; one bounded read per owner with immediate completion evidence replaced it. `AGENTS.md` (search: `Sub-agents: ONE objective`).
**Recurrence 2026-08-15 (fifth call):** A fresh evaluator hit orchestration guards, then used the verification-only fifth call to finish reads, write four files, and run checks; the run was invalid despite its contained diff. Reserve the final call by behaviour, not number. `AGENTS.md` (search: `Fix verification`).
**Recurrence 2026-08-27 (formatter scope):** `npx prettier --check` was given `workflow/install-goat-flow.sh` beside supported paths and exited 2 with no parser for the shell file; use `npm run format:check` and keep shell proof in the shell gates.
**Recurrence 2026-08-27 (Knip heap):** Ad-hoc `npx knip` reached Node's default heap and aborted with exit 134; the repository command `node --max-old-space-size=5120 node_modules/knip/bin/knip.js --no-progress --no-gitignore` exited zero. `scripts/preflight-checks.sh` (search: `The project graph exceeds`).
**Recurrence 2026-08-27 (yielded handle):** Three commands in one orchestrated call, then `Promise.all`, discarded a live session identifier and terminal status from the long install matrix; the process was terminated by PID and rerun serially to `# tests 13`, `# pass 13`, `# fail 0`. `AGENTS.md` (search: `literal pass/fail line copied verbatim`).
**Recurrence 2026-08-27 (plan command shape):** `plans check --strict` was given a milestone file and rejected it with `ENOTDIR`; it consumes the version directory while `plans time` consumes one file. `src/cli/help.ts` (search: `goat-flow plans check .goat-flow/plans/1.17.0 --strict`), `src/cli/plans-export.ts` (search: `Cannot read plan directory`).
**Recurrence 2026-08-27 (ignored lint):** `npx eslint test/integration/preflight-progress.test.ts` exited zero with an ignored-file diagnostic and was labelled PASS; `eslint.config.mjs` (search: `"test/**"`) keeps that path outside the lint scope, so cover ignored tests with typecheck, Prettier, and their runtime suite.
**Recurrence 2026-08-28 (export capture):** A full plan export exited 0 but the tool truncated its 10,093 JSON lines; piping it into inline `node -e` was blocked as `Pipe to interpreter`, and a bounded `jq` selector exposed the required fields. `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `Known language runtimes may consume local data only when their program is explicit`), `src/cli/plans-export.ts` (search: `No output path is the safe preview mode`).
**Recurrence 2026-08-28 (proof scope):** A line-budget command scanned every physical line in eight instruction files although the claim covered only ACT-local reminders, and exited 1 on a 1,677-character READ line measured before the edit; baseline bespoke proof before editing and scope it to the claim. `workflow/setup/reference/execution-loop.md` (search: `MUST read relevant files before changes`), `test/contract/command-phrases.test.ts` (search: `assertMilestoneReminder`).

## Lesson: Score a skill's output grammar with its validator, not by reading the report

**Status:** active | **Created:** 2026-09-07 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** When a milestone's success criterion is that produced output validates, the acceptance test is the validator's result on produced output, and by-eye grammar scoring is a lead only.
**Trigger phase:** SCOPE
**Caught at:** VERIFY

**Prevention:** Before scoring any produced report as conforming, save it and run the repository's validator on it; score from the violation list. Do this on the baseline runs too, so the failure classes you register are the ones the parser enforces rather than the ones you noticed. When a produced report cannot reach the validator under its run conditions, say the grammar claim is unverified rather than scoring it by inspection.

**What happened:** Twelve isolated goat-review runs were scored by reading. Four format classes looked fixed between baseline and candidate. Running `goat-flow review validate-draft` on one candidate report afterwards returned 12 violations. Two were regressions the candidate wording had caused: a sentence saying Pass 2 refutations "carry no R-ID" had led three runs to drop refuted IDs from the disposition map, and a rule against inventing tokens had led four runs to park disclosures as extra evidence keys. Five further classes had gone unregistered because no eye caught them: code-span-wrapped JSON and a dropped literal `exactly once` in every one of the twelve reports, an empty `Gate authority` object, extra evidence keys, and conclusion precedence. The milestone had predicted this exact failure in its own stop condition, "measuring compliance by cited text while the agent skips the corresponding code check".

**Root cause:** The parser's grammar is literal and the reviewer's reading is semantic, so a report that means the right thing can fail every row. Evidence anchors: `src/cli/review-validate-common.ts` (search: `FULL_REVIEW_SIZE_VALUE`), `src/cli/review-validate-sections.ts` (search: `validateFinalDispositions`), and the corrected root `workflow/skills/goat-review/SKILL.md` (search: `refutations keep a distinct R-ID`).

## Lesson: A structural gap in skill text is not evidence of a behavioural gap

**Status:** active | **Created:** 2026-09-07 | **Evidence:** OBSERVED
**Decision changed:** Bind behavioural claims to an observed decision or action; neither missing wording nor correct recitation proves how an agent uses guidance. Run the baseline before sizing a behavioural correction.

**Prevention:** Search the skill text for the route, then test the behaviour anyway. Score application on the report's own opened-file trace, never on detection alone, because a seeded defect can be reachable by another path. Keep the seeded rule out of the fixture's code comments; a docstring that states the invariant makes the defect generically discoverable and the fixture stops discriminating. If the baseline passes, record the KEEP and reduce the task to a pointer or nothing; the iron law forbids a new mandatory rule with no failing test behind it.

Before ticking any RUNTIME or [agent-evaluated] proof item, name the specific decision or action the trial required, the observable outcome, and its supporting artifact or trace, distinct from wording reproduced. If the trial only elicits quotation or explanation, the behavioural claim is **UNVERIFIED** and stays unticked even when every mechanical gate is green. Correct attribution may earn an explicit traceability criterion only. Identify prompting in the claim: asking both arms to flag disagreement permits a prompted comparison, not an unprompted failure rate. When both arms already make the correct decision, report preservation or reduced ambiguity rather than claiming a wrong decision was fixed.

**What happened:** A milestone sized its two largest tasks on the premise that reviewers miss a project's own coding standards, supported by a grep showing the shipped skill had no route to them. The baseline runs disproved the premise: with a fixture project whose instruction file named its standards directory, every applicable run found the rules, cited them, applied them to code decisions, and left two documented exceptions alone. The route the skill text lacked was supplied by the reviewed project's instruction file and the shared preamble's INDEX-first retrieval. One seeded rule-only defect was also found in a project with no standards at all, through a docstring in the fixture's own constants module that stated the invariant, so detection had to be discounted and the trace used instead. With approval, the two tasks shrank to a heading fix and one sentence, and the effort moved to format failures the same runs had measured.

**Root cause:** Absence in one document was read as absence in the system; the converse error treats corrected wording as demonstrated behaviour. Skills run inside instruction files, preambles and project guidance. The evidence must show the resulting action, not just one layer's text. Evidence anchors: `.goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md` (search: `Score application, not citation`), `.goat-flow/skill-docs/skill-preamble.md` (search: `Learning-Loop Retrieval`), `workflow/skills/goat-review/SKILL.md` (search: `**Project guidance:**`).


**Recurrence 2026-09-07:** The original M29 review record credited redaction, recovery and learning-entry application from retrieval answers. It preserved green mechanical results while the later review withdrew those original application claims; section identity supported a static preservation claim only. No original linked action receipts supported the behavioural promotion. The prompted-disagreement limitation belongs to the neighboring M40 debug comparison: both arms were asked to flag conflicts, and some already reached the same correct decision. These records support the action-versus-citation discriminator; no unprompted failure rate was established. Tracked rule: `.goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md` (search: `Score application, not citation`, `Bad vs good scenarios`); it already requires the produced diff, decision or report to demonstrate the outcome.


---

## Lesson: Evidence tooling is evidence, so run the fixture and re-derive every count

**Status:** active | **Created:** 2026-09-07 | **Evidence:** OBSERVED
**Decision changed:** Execute every evaluation fixture and re-derive run counts from artifacts before any claim rests on them; a scorer and its fixtures are graded material, not scaffolding.
**Trigger phase:** VERIFY
**Caught at:** VERIFY

**Prevention:** Before an evidence record is offered for approval, run each fixture's own test suite and confirm every expected failure is one you designed. Before reporting a completed-run total, reconcile unique evaluator session IDs with their terminal results and required artifacts. Count registered, started, completed and blocked runs separately; multiple case/arm results from one invocation are not independent runs, and a continuation does not create a fresh session. Map each proof item to completed case IDs and supporting outputs; an aggregate count cannot cover an unrun case. Give each scorer a deliberately wrong input per fixture and confirm it fails, because a scorer proven only against a passing input has not been proven at all. When a scorer and a report disagree, read the report rows first: the scorer is the newer, less reviewed artifact.

**What happened:** A self-audit of 1.17.0 M25, requested before approval, found five defects in work already reported as verified. The evidence record claimed "five isolated runs" when the runner logs showed four, and claimed three of them were mis-scored on the first pass when all four were. An F1 fixture asserted `roundToCents(1.005) === 1.01`, which is false because `1.005 * 100` is `100.49999999999999`; the fixture had never been executed. Two F2 fixture tests called `assert.snapshot`, which does not exist on `node:assert`. The F2 scorer matched behaviours only by symbol, so a report that split one function into invariant rows labelled by file and branch scored a false failure, which also showed the original pass had been partly luck. One F2 criterion forbade `NONE` anywhere in a file whose uncovered invariants correctly carried it.

**Root cause:** The fixtures and scorer were treated as apparatus rather than as claims. Every rule applied to the thing under test, that assertions are verified before they are believed and counts are derived rather than recalled, applies equally to the instrument doing the testing. Recurrence is likeliest when a scorer is corrected mid-run: four scorer corrections were needed across M25's four runs, each found by reading flagged rows rather than trusting the number and each re-proved against golden and wrong inputs before the result was accepted. Evidence anchors: `.goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md` (search: `Score application, not citation`), `test/contract/skill-hardening-skills-2.test.ts` (search: `defines each goat-qa coverage depth by the evidence that earns it`).


**Recurrence 2026-09-07 (shared-guidance review):** The M29 application-proof mistake is recorded under `A structural gap in skill text is not evidence of a behavioural gap`. Its repair omitted the pending report from the first two persistence fixtures; both evaluators correctly stopped before writing. Record those as blocked fixture runs, supply the missing input, and preserve the proof gate. Preflight fixture prerequisites before delegation, and score the requested action rather than a rule citation. The repair scorer also mistook an extra valid proof checkbox and absence of the word `retrospective` for failures. Read the actual task identities and resulting entry; automate exact byte/state/schema checks, not keyword proxies for semantic decisions. The approval continuation also matched a hooks-file digest against the main Codex config until rereading the recorded pair. Keep the source path and expected digest together when checking continuity; a valid hash attached to the wrong file reports false drift. Evidence: `workflow/skills/goat-review/references/examples.md` (search: `Pre-persistence Proof Envelope`) and `.goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md` (search: `Score application, not citation`).


**Verification boundary 2026-09-07:** The available M40 record lists eight case/arm results but explicitly identifies six evaluator sessions; counting its rows as independent runs would inflate the total. Tracked protocol: `.goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md` (search: `report only current-run counts`, `Before running trials`).


---

## Lesson: Naming the component that satisfies a rule is a claim about its code

**Status:** active | **Created:** 2026-09-07
**Decision changed:** Before writing that a named tool provides a guarantee, read that tool's implementation, including its failure paths, and claim only the property its code establishes.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Correcting an unreachable instruction usually means naming the component that really performs the work. That rewrite silently converts a requirement into an assertion about an implementation, so it needs the same evidence as any other claim: open the source, follow the success path and every rejection path, and describe only what you find. Never carry an adjective from the old requirement onto the new attribution. Describe outcome vocabularies in terms of end states an agent can observe, because a failure path that leaves a partial artifact will not match a state named after what the code intended to do.

**What happened:** In 1.17.0 M45 the goat-security Persist Gate was corrected to name the redactor as the component performing the parent traversal, and the phrase "race-safe" was carried over from the requirement being replaced. Three independent reviewers found the redactor's parent walk is a pathname `lstat` sequence, not a descriptor-anchored one, and that the claim contradicted a sibling reference in the same skill forbidding exactly that substitution. The same reviewers found the new outcome vocabulary said "no artifact created" while a real rejection path leaves a zero-byte file at the destination, so an agent would report the artifact as skipped.

**Root cause:** Attribution was treated as editorial phrasing rather than as a factual claim about code. Carrying an adjective across a rewrite is the specific move that hides the error, because the sentence still reads like the sentence that was approved. Evidence anchors: `src/cli/redact-command.ts` (search: `assertRedactDirectories`) walks parents with `lstatSync` by pathname, while `assertRedactAllocation` compares `fstatSync` against `lstatSync` before and after the write; `workflow/skills/goat-security/references/common-threats.md` (search: `MUST NOT emulate containment with a status check`) is the sibling rule the false claim contradicted.

---

## Lesson: Reused evidence expires the moment you edit what it depended on

**Status:** active | **Created:** 2026-09-07
**Decision changed:** After every source edit, re-check which retained results read the file you changed, and mark those results stale before reusing them.
**Trigger phase:** VERIFY
**Caught at:** VERIFY

**Prevention:** Reusing an earlier run to close a criterion is legitimate only while its inputs are unchanged, so record which files each reused run read. Before an evidence record is offered for approval, diff the session's writes against those input lists and re-run anything whose inputs moved. Treat a fix that broadens a rule as a candidate regression on every behaviour the narrow rule also protected, not only the one it targeted.

**What happened:** In 1.17.0 M26 a shipped template reference said "do not combine templates from different phases", which was overriding the skill and causing a Standard test-plan response to drop its risk map. The fix replaced it with a mode-level ban plus an explicit Standard exception. The old rule had been categorical and had also kept Audit's gap report separate from its post-gate plan, because that reference holds two Audit phases; the replacement forbade only cross-mode combination and left Audit unprotected at render time. The same record had already closed the Audit gate criterion by reusing two earlier runs, and those runs had read the pre-fix reference. The reuse was sound when written and was invalidated by the later edit. A self-audit caught both, the rule was rewritten to ban combining any gate report with the plan that follows it and to name Audit explicitly, and an extra isolated run confirmed the Audit gate still holds.

**Root cause:** Reuse was treated as a property of the earlier run rather than as a claim about the current tree. A narrow replacement for a broad rule silently drops whatever else the broad rule covered, and nothing in the change itself surfaces the loss. Recurrence is likeliest when one file governs several routes and a fix targets one of them. Evidence anchors: `workflow/skills/goat-qa/references/output-templates.md` (search: `never combine a gate report with the plan that follows it`), `test/contract/skill-hardening-skills-2.test.ts` (search: `lets an auto-released goat-qa gate carry both phases in one response`).

## Lesson: Calling text a duplicate is a claim that its rule survives elsewhere

**Status:** active | **Created:** 2026-09-08
**Decision changed:** Before cutting a sentence as redundant, name the exact surviving location, confirm every reader who needed the rule loads that location first, and add or re-point a contract assertion there before the cut.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Treat "already said elsewhere" as an evidence claim with three parts: where, reachable by whom, asserted how. A cut that cannot fill all three is not a cut. Measure the token delta per pair first; pipe-joined lists are nearly free under a whitespace cap, prose is not, and the cheapest-looking cut is often a single-owner rule.

**What happened:** In 1.17.0 M47 the goat-security root had one word of headroom and needed a posture field, a conclusion definition and a loading contract. Two cuts were justified as duplicates and were not: the Phase 6 requirement to verify referenced submodule content (search: `verify referenced content`), which no other line carried, and the Quick output clause excluding Full-only rows, whose loss let a trial evaluator add inventory-integrity rows to a Quick report. The contract suite caught the first; the paired-arm adjudicator caught the second. Both were restored and paid for by cuts whose survivor was named and asserted.

**Root cause:** A nearby sentence on the same topic was read as the same rule. Overlap in subject is not identity of obligation, and a reader who reaches one line need not reach the other.
