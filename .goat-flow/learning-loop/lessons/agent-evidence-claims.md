---
category: agent-evidence-claims
last_reviewed: 2026-08-28
---

**Scope:** What counts as citable evidence - mechanism claims need a read source, absence and exact-count claims need untruncated searches, gitignored paths are never durable anchors, and final verification gates need supported scopes with captured logs. Reading the request and retrieving memory is [agent-behavior.md](agent-behavior.md); using tools and the environment is [agent-tooling.md](agent-tooling.md).

## Lesson: A config change that fails to fix a symptom is not proof of the mechanism

**Status:** active | **Created:** 2026-08-16
**Decision changed:** Read a tool's own schema or source before stating why one of its options did not work.
**Trigger phase:** READ
**Caught at:** VERIFY
**Incident count:** 1 | **Latest occurrence:** 2026-08-16

**What happened:** While diagnosing a Knip out-of-memory failure in preflight, I added the large directory to `knip.json`'s `ignore`, saw the run still exhaust its heap, and reported that "`ignore` filters reported issues, not what it reads." The conclusion was correct, but I had only observed that the symptom persisted. When the user asked whether Knip really could not ignore the folder, I could not defend the claim and had to walk it back, then walk the retraction back again after reading `node_modules/knip/schema.json`, whose `ignore` title is "Files to exclude from the report (any issue type)".

**Root cause:** I inferred a mechanism from a single negative result and stated it with the confidence of a read fact. A config change that does not fix a symptom has many explanations - wrong key, wrong scope, wrong file, or the option simply not governing that behaviour - and the observation alone cannot choose between them. The cost was not the wrong answer; it was a confident answer that then flip-flopped under one question.

**Prevention:** When an option does not do what you expected, read its definition before explaining why. Installed packages ship the answer: `node_modules/<pkg>/schema.json`, the type declarations, or the source are cheaper than another timed run and are authoritative. State symptom evidence as symptom evidence - "adding it did not stop the OOM" - and keep the mechanism claim separate until something documents it. Evidence anchor: `.goat-flow/learning-loop/footguns/preflight-plumbing.md` (search: `Knip's `ignore` cannot shrink what preflight`).

## Lesson: Agent cited gitignored content as evidence in committed docs

**Created:** 2026-05-11
**Decision changed:** Before citing a local file as durable evidence, verify that Git tracks it or cite the committed detector/source that supports the claim.

**What happened:** A 2026-05-11 documentation audit found four committed surfaces citing paths under `.goat-flow/scratchpad/` (gitignored by design) as authoritative evidence:

- `docs/dashboard.md` (Design ethos) cited `.goat-flow/scratchpad/skills-example-prime/frontend-design/SKILL.md` as the source of the anti-convergence checklist.
- `.goat-flow/skill-docs/skill-quality-testing/README.md` cited `.goat-flow/scratchpad/skills-example-prime/mysql/SKILL.md` and `.goat-flow/scratchpad/skills-example-prime/valyu/SKILL.md` for two authoring patterns; its verification-claim table credited "the prime corpus's verification-before-completion checklist."
- `.goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md` cited `.goat-flow/scratchpad/skills-example-prime/writing-skills/SKILL.md` as "Empirical evidence (sourced verbatim from ...)" with a `(search: ...)` anchor.
- `workflow/skills/reference/skill-preamble.md` allowed Excuse/Reality table additions to derive from "this repo or the prime corpus".

The same surfaces also leaked third-party / competitor skill names (MySQL, Valyu, the writing-skills prime pack, an external frontend-design skill) into goat-flow's committed docs plus an env-var example (`VALYU_API_KEY`).

**Root cause:** When seeding pattern docs from external material temporarily staged under `.goat-flow/scratchpad/`, the authoring agent kept the verbatim citations instead of (a) committing the source material first, (b) restating the principle without the citation, or (c) marking the section guidance-only. It treated the scratchpad path as citable because it lives inside `.goat-flow/`, missing that the whole `scratchpad/` subtree is gitignored. Naming the external skills (MySQL, Valyu, frontend-design) compounded it: the agent imported provider vocabulary with the structural pattern.

**Why it matters:** (1) **Broken evidence chain.** A cloned checkout cannot follow the cited path or its `(search: "...")` anchor; the Evidence Standard (`workflow/skills/reference/skill-preamble.md`, search: `re-read every cited file`) requires citations anyone can re-read. (2) **Competitor/third-party leakage.** Naming external skills in committed docs implies goat-flow ships, endorses, or derives from those vendors' work, and pins generic patterns to one provider.

**Prevention:**
1. **Never cite a `.goat-flow/scratchpad/`, `.goat-flow/plans/`, `.goat-flow/logs/sessions/`, `.goat-flow/logs/quality/`, or `.goat-flow/logs/critiques/` path from a committed file** - those subtrees are gitignored except anchor files (`README.md`, `.gitignore`, `.gitkeep`). Promote source material to a committed location (`lessons/`, `footguns/`, `decisions/`, or a `workflow/` file) before citing it.
2. **Strip third-party / competitor skill or vendor names** from generic guidance. State the pattern provider-neutrally ("a domain skill", "a vendor-SDK skill", "an external frontend-design reference") and use placeholders (`<VENDOR>_API_KEY`, not `VALYU_API_KEY`).
3. **Apply the same rule to test files and code comments** - fixtures and inline comments shape contributor authoring habits.
4. **When auditing docs, grep both classes:** `rg -n "\.goat-flow/(scratchpad|tasks|logs)/" --glob '*.md' --glob '*.ts'` for gitignored citations, plus a project-specific list of competitor names for vendor leakage. Add to `docs-and-crossrefs` footgun resolution rounds when found.

Round 4 entries in `.goat-flow/learning-loop/footguns/docs-drift.md` (search: `Round 4 (2026-05-11`) record the surfaces fixed.

**Recurrence (2026-07-16):** Pre-1.14.0 quality report `2026-07-16-1018-codex-vwcaf` found five new `.goat-flow/scratchpad/related/` citations in `lessons/coordination.md`, `patterns/external-lessons.md`, and `patterns/refactoring.md`. Fix: cite upstream provenance (repo + PR + path + search anchor), writing the upstream path as plain prose - the stale-ref scanner (`src/cli/facts/shared/learning-loop-common.ts`, search: `isCheckableForStaleness`) resolves backticked slash-containing paths locally and fails `feedback-loop-active` when unresolved.

**Recurrence update (2026-07-17):** `.goat-flow/plans/**` and one quality-report path were cited as durable evidence in seven lessons and four footguns; three anchored plan files were already deleted. All replaced with committed anchors or plain prose. The prevention is now structural: `src/cli/facts/shared/learning-loop-common.ts` (search: `gitignored path used as durable evidence anchor`) fails evidence-grammar refs to gitignored paths; committed anchor files (README.md, .gitignore, .gitkeep) exempt.

**Recurrence update (2026-08-06):** While recording an ignored-search failure from a roadmap shift, the new recurrence cited the renamed gitignored milestone as durable evidence. `stats --check` failed with `stale-ref` and the diagnostic `gitignored path used as durable evidence anchor`. The fix removed the local-plan citation and kept committed anchors for the ignore rule and detector. Evidence: `src/cli/facts/shared/learning-loop-common.ts` (search: `gitignored path used as durable evidence anchor`).

---

## Lesson: Structural audit pass does not mean the project is correct

**Created:** 2026-03-31

**What happened:** goat-flow once scored 100% on its own scanner system (removed per ADR-013) while `preflight-checks.sh` failed with 8 errors. The scanner checked structural presence (files exist, have the right headings); preflight checked functional correctness (commands work, paths resolve, versions match).

**Prevention:** Don't treat a structural audit/check pass as a quality gate for the whole project. Use structural checks for what they cover and preflight/targeted verification for functional correctness; when they disagree, investigate.

---

## Lesson: Single-source-of-truth claims need a cold-path review pass

**Created:** 2026-04-18

**What happened:** M12 moved agent support metadata into `workflow/manifest.json`, but a follow-up code review still found residual parallel authority surfaces: Codex got a fictional `post_turn: "Stop"` event in the manifest, the dashboard frontend narrowed injected agent ids back to `claude | codex | gemini`, and unknown `.goat-flow/config.yaml` `agents:` ids only warned so audit status stayed green.

**Prevention:** When claiming "single writable authority", run a cold-path pass searching for hardcoded enums, literal allowlists, and docs/templates restating the same contract. The migration is not complete until manifest, installer, config validation, audit failures, and frontend payload readers all agree on one authority.

---

## Lesson: Verify agent capabilities against official docs, not assumptions

**Status:** active | **Created:** 2026-04-15 | **Merged during:** M11 learning-loop consolidation

**What happened:** Codex was assumed to lack PreToolUse hook support, so its profile left the hook field empty and a parallel Starlark execpolicy workaround was built. Later doc/runtime checks showed Codex did support hooks, making copied guardrail scripts dead code until registration was fixed.

**Root cause:** A stale platform assumption propagated through templates, install scripts, fact extraction, and setup guides without re-checking against primary docs or the binary.

**Prevention:** When a profile field says an agent "can't" do something, verify against current product docs and runtime evidence before building workarounds. For Codex permission grammar, anchors are `workflow/hooks/agent-config/codex.toml` (search: `hooks = true`), `.goat-flow/hooks/deny-dangerous/patterns-paths.sh` (search: `is_secret_path_touch`), and `src/cli/facts/agent/settings.ts` (search: `collectCodexWorkspaceRootEntries`).

---

## Lesson: Absence claims need untruncated searches

**Status:** active | **Created:** 2026-07-03 | **Incident count:** 3 | **Latest occurrence:** 2026-08-16

**What happened:** While assessing loop coverage, `grep -n "stats\|quality\|audit\|index" scripts/preflight-checks.sh | head -20` showed no `stats` hit, and the analysis claimed `stats --check` ran in no local gate. The `head -20` had truncated the match list; preflight's Learning-Loop Schema section already ran `node dist/cli/cli.js stats . --check`. The user's "double check" instruction exposed the false absence claim before it shaped the fix.

**Root cause:** A multi-pattern grep piped through `head` answers "what appears early", not "does X appear at all". The absence conclusion was drawn from a presence-oriented, truncated probe.

**Prevention:** Before claiming a pattern is absent from a file or repo, rerun the exact single pattern with no `head`/`tail` truncation (or `grep -c`). For an exact path claim, use `test -e` on that path or an exact tracked-file query; a filename filter designed for neighbouring names is only a sample. Treat any truncated or indirect filter output as presence-oriented evidence, never evidence of absence. Evidence anchor: `scripts/preflight-checks.sh` (search: `Learning-Loop Schema`).

**Recurrence (2026-08-12):** A `5-call` contract-surface census scoped to six hand-picked directories returned seven paths, and the count was about to ship as an exact-count expectation inside a milestone stop condition. `git grep -ln "5-call"` over the tracked tree returned eight: `.goat-flow/learning-loop/decisions/ADR-042-cross-harness-invocation-ask-first.md` (search: `5-call`) sat outside every scanned directory, so the honest wider census would have false-fired the stop rule on its first run. Exact-count claims follow the same rule as absence claims: derive them from the widest search the claim implies - `git grep` over the tracked tree, not a hand-picked directory list - before pinning the count into a stop condition or expected-result cell.

**Recurrence (2026-08-16):** An M04 path audit filtered filenames with a pattern containing contiguous `hooks-runtime`, then incorrectly reported that `hooks-configured-runtime-evidence.ts` did not exist. An exact `test -e` immediately disproved the claim: the filter was built for a neighbouring filename and never searched the configured-runtime spelling. Evidence anchor: `src/cli/hooks-configured-runtime-evidence.ts` (search: `readManagedConfiguredHookState`).

---

## Lesson: A learning-loop entry's evidence lines are claims, not proof

**Status:** active | **Created:** 2026-08-07
**Decision changed:** Re-read cited call sites when reusing a claim, and update the learning entry when later code changes invalidate it.
**Trigger phase:** READ

**What happened:** While prioritising work, I cited `footguns/auditor.md` to assert that `goat-flow audit` executes an untrusted checkout's hook launcher by default, and that the dashboard was already safe on `"static"`. A cross-harness review disputed both. Re-verification showed that the CLI claim needed the `--agent` qualifier and that `buildDashboardAuditReport` then requested `"full"`; commit `9007a9e` corrected the learning entry at 07:09 on 2026-08-07. Commit `19046c08` changed the dashboard branch to `"static"` at 17:06 but did not update this lesson or the footgun. Current `test/integration/dashboard-audit-api.test.ts` (search: `does not execute selected-project hook launcher in /api/audit`) proves the selected-agent endpoint does not run the configured launcher.

**Root cause:** I treated a bucket entry as verified truth because it was tagged `ACTUAL_MEASURED`. That tag records what the author believed they measured, not a re-run. Three failures followed: I dropped the source's `--agent` qualifier, forwarded a claim about a dashboard call site I had not opened, and later code changed the corrected behavior without refreshing the learning entries that described it.

**Prevention:**
1. Before restating a learning-loop claim in a plan, report, or recommendation, open the cited call site. The entry gives you the anchor to check, not the answer.
2. Prove *reach* by running the command, not by reading the gate. `audit .` reports `Agent deny mechanism: skipped`; `audit . --agent claude` reports `pass`. One command settled what two code-reading passes got wrong.
3. Never widen a source's qualifier. If the entry says `--agent <id>`, the restatement says `--agent <id>`.
4. When an entry is found wrong, correct the entry in place with the dating evidence, and grep for what inherited it - a wrong fact in the loop tends to be copied into the milestone that cites it.
5. `ACTUAL_MEASURED` means "the author measured something once". Date it against the code: `git log -L <lines>:<file>` showed the disputed line predated the entry by two weeks, which is what proved it wrong-on-arrival rather than a regression.
6. When behavior changes at a cited call site, search the learning-loop indexes for that file or symbol and update affected entries in the same change. Index freshness cannot detect a semantically obsolete claim.

---

## Lesson: Final verification gates need supported scopes and captured logs

**Status:** active | **Created:** 2026-05-19 | **Incident count:** 24 | **Latest occurrence:** 2026-08-28

**Decision changed:** Use repository-owned package scripts for supported gates; baseline bespoke checks and scope them to the claim they prove. | **Trigger phase:** VERIFY

**Prevention:** Run supported format, lint, Knip, and test gates with captured output.
A predecessor may exempt one named RED fixture only when a blocked dependent owns it.
Preserve the full failure receipt, run every other test, and keep the green gate downstream.
Any extra failure stops.
Evidence anchors: `test/integration/setup-install-agent-matrix.test.ts` (search: `must have one exact registration`),
`package.json` (search: `test:fast`), and `knip.json` (search: `ignoreDependencies`).

**What happened:** Several closeouts sent ignored tests or workflow `.mjs` files to TypeScript-only ESLint. One also ran `npm test` beside expensive checks and lost the failing block; a captured rerun passed (`# tests 881`, `# pass 881`, `# fail 0`).

**Root cause:** I mixed repo-supported verification scopes with improvised paths and treated parallel final gates as interchangeable with a clean final evidence run. That made the first failure ambiguous and forced a rerun to recover the actual evidence.

### Incident Ledger

**Recurrence 2026-08-28 (unbounded export capture crossed hook policy):** M46's full plan export exited 0, but the tool truncated its 10,093 JSON lines before they could be parsed. A retry piped the export into inline `node -e`; PreToolUse blocked it as `Pipe to interpreter`. A bounded `jq` selector over the same export then exited 0 and exposed only M46's required fields. When verification output exceeds the capture budget, select the needed data with a policy-compatible processor instead of piping it into a general interpreter, and preserve the producer and selector exits separately. Evidence anchors: `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `Known language runtimes may consume local data only when their program is explicit`) and `src/cli/plans-export.ts` (search: `No output path is the safe preview mode`).

**Recurrence 2026-08-28 (proof scope outran claim):** M46's midpoint line-budget command scanned every physical line in eight instruction files even though C1 claims only ACT-local reminder readability. It exited 1 on a 1,677-character READ line measured before the M46 edit; the recorded diff touched only ACT. Baseline bespoke proof commands before editing, then scope them to the named claim while retaining separate whole-file line-limit evidence. Evidence anchors: `workflow/setup/reference/execution-loop.md` (search: `MUST read relevant files before changes`) and `test/contract/command-phrases.test.ts` (search: `assertMilestoneReminder`).

**Recurrence 2026-08-27 (unsupported formatter scope):** M41 Task 6 explicitly passed `workflow/install-goat-flow.sh` to `npx prettier --check` beside supported Markdown and TypeScript paths. Prettier exited 2 because it has no parser for that shell file, even though ShellCheck and `bash -n` had already exited cleanly. Use the repository-owned `npm run format:check` scope and keep shell proof in the shell gates; a mixed command that targets an unsupported file is not formatting evidence. Evidence anchor: `package.json` (search: `"format:check"`).

**Recurrence 2026-08-27 (Knip heap contract):** M41 Task 5 ran ad-hoc `npx knip`; its ignored-tree walk reached Node's default 4 GiB heap and aborted with exit 134 before producing findings. The repository-owned command then exited zero: `node --max-old-space-size=5120 node_modules/knip/bin/knip.js --no-progress --no-gitignore`. Read the owning preflight block before invoking a heavyweight gate; an analyzer crash is neither a finding nor a clean report. Evidence anchor: `scripts/preflight-checks.sh` (search: `The project graph exceeds`).

**Recurrence 2026-08-27 (yielded test handle):** M41 Task 5 ran three verification commands in one orchestrated call. The long install matrix yielded with a live session identifier after only `TAP version 13`, but the combined renderer retained neither that identifier nor a terminal status, so the still-running process could not supply attributable proof. Task 6 repeated the mistake with `Promise.all`: rendering only each result's exit and output discarded the shared-state suite's session identifier and left that exact process alive. The process was terminated by its resolved PID and the suite was rerun serially to `# tests 13`, `# pass 13`, and `# fail 0`. Preserve and surface every yielded command handle before combining results; an undefined exit beside partial output is not evidence. Evidence anchor: `AGENTS.md` (search: `literal pass/fail line copied verbatim`).

**Recurrence 2026-08-27 (plan command shape):** After stopping M41 timing with its milestone-file path, I passed the same file to `plans check --strict`; the checker rejected it with `ENOTDIR` because `plans check` consumes the version directory while `plans time` consumes one milestone file. A failed invocation is not strict-plan evidence even when the corrected command follows immediately. Use the literal help example, capture each exit separately, and label only the directory-scoped run. Evidence anchors: `src/cli/help.ts` (search: `goat-flow plans check .goat-flow/plans/1.17.0 --strict`) and `src/cli/plans-export.ts` (search: `Cannot read plan directory`).

**Recurrence 2026-08-27:** M41 ran `npx eslint test/integration/preflight-progress.test.ts` and appended a PASS label because the command exited zero, even though ESLint's only diagnostic said the file was ignored. `eslint.config.mjs` (search: `"test/**"`) puts that path outside the repository's ESLint scope. An ignored-file warning is not lint evidence: keep the repository-owned source lint scope, and cover ignored tests with typecheck, Prettier, and their runtime suite instead of forcing `--no-ignore`.

**Recurrence 2026-08-14:** M03 ran `scripts/generate-managed-hook-desired-state.mjs` with plain Node.
Plain Node could not resolve `registry.ts`'s `.js` import of the TypeScript manifest.
The `check:managed-hook-contract` package script supplied `--import tsx` and the same artifact check exited zero.
Use the package script instead of rebuilding its loader.
Evidence anchors: `package.json` (search: `check:managed-hook-contract`), `src/cli/agents/registry.ts` (search: `loadManifest`), and
`scripts/generate-managed-hook-desired-state.mjs` (search: `managed-hook contract current`).

**Recurrence 2026-08-15:** Four PR-backed skill RED attempts spent their bounded implementation calls reproducing fixture seals.
The failed approaches used unavailable JavaScript-isolate hashing, exceeded the segment limit, or displaced final-state verification with cleanup.
All four runs were excluded.
Independent host preflight now acquires and seals fixtures.
Evaluators consume the verified fixture and reserve the last call for checkout state and actual-diff proof.
Evidence anchors: `workflow/hooks/deny-dangerous.sh` (search: `Command has more than 50 chained segments`),
`workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `rm -r without safe scoping`), and
`.goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md` (search: `Each phase is one isolated evaluator run`).

**Recurrence 2026-08-15:** A later exact-owner comparison repeated the over-50-segment failure.
The command was blocked before execution, so it proved nothing about the authority files.
The corrected transport uses one bounded read result per owner with immediate completion evidence.
Exact-set comparison stays a separate root-verifier operation.
Evidence anchors: `workflow/hooks/deny-dangerous.sh` (search: `Command has more than 50 chained segments`) and
`AGENTS.md` (search: `Sub-agents: ONE objective`).

**Recurrence 2026-08-15:** A fresh skill evaluator hit orchestration guards.
It then used the verification-only fifth call to finish unread evidence, write four files, and run checks.
Unchanged path scope did not satisfy the phase contract, so the run was invalid despite its contained diff.
Reserve the final call by behaviour, not only number; an earlier guard failure cannot borrow it for mutation.
Evidence anchors: `.goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md` (search: `Each phase is one isolated evaluator run`) and
`AGENTS.md` (search: `Fix verification`).

**Recurrence 2026-08-14:** Full preflight rejected the slash-joined “workflow” and “job permissions” phrase
in all three installed goat-security mirrors.
Path integrity read it as a framework-local path, and the canonical committed reference had the same phrase.
Use “workflow and job permissions” and run path integrity after skill-reference edits.
The generic skill-creator validator also rejected goat-flow's required `goat-flow-skill-version`.
Keep repository metadata and use `npm run check-versions` plus full preflight.
Backticking the slash phrase while recording the incident triggered `stale-ref`, so non-path slash prose must not use a path-shaped code span.
Evidence anchors: `scripts/check-path-integrity.sh` (search: `framework-local`), `scripts/check-versions.mjs` (search: `goat-flow-skill-version`),
`src/cli/facts/shared/reference-paths.ts` (search: `export function isFileRef`), and
`workflow/skills/goat-security/references/supply-chain-and-cicd.md` (search: `workflow and job permissions`).

**Recurrence 2026-08-09:** A runtime-adapter check again sent workflow `.mjs` to TypeScript-only ESLint.
Workflow modules use `node --check`, Prettier, targeted Gruff, runtime fixtures, and preflight instead.
Evidence anchors: `workflow/hooks/hook-provider-adapters.mjs` (search: `Decodes bounded provider-neutral hook results`) and
`scripts/preflight-checks.sh` (search: `lint_targets[@]`).

**Recurrence 2026-05-19:** A dashboard Markdown performance test used a newline-heavy 500KB fixture.
Focused runs passed, but preflight's concurrent fast suite exceeded the 100ms budget.
The fixture still needed to be 500KB, but it needed to measure plain Markdown throughput rather than line-break parsing stress.

**Recurrence 2026-05-26 and 2026-06-14:** The dashboard Markdown test was later removed with the 1.13.0 viewer.
Its former path was `test/unit/dashboard-markdown.test.ts`.
It passed alone and in `npm test` but failed under `npm run test:coverage`.
Coverage and full-suite concurrency pushed the 500KB render past hard 100ms and 250ms budgets.
The failures reported `expected <100ms, got 115ms` and later `159ms`.
Preflight still needed its 250ms retry.
A later 750ms ceiling remained machine-sensitive, so the test compared the 500KB render with a same-process 100KB baseline and a generous floor.

**Recurrence 2026-05-19 and 2026-08-08:** Commit-guidance helpers passed focused tests, but full preflight reported `Knip: 2 unused exports/types`.
Making internal types private fixed it.
Later, removing the history detector also removed the cited `CommitGuidanceStatus`, so audit failed on a stale learning-loop anchor.
Keeping that type as the template-copy result status repaired the reference.
Run `goat-flow stats --check` before deleting cited symbols.
Evidence anchor: `src/cli/prompt/commit-guidance.ts` (search: `type CommitGuidanceStatus`).

**Recurrence 2026-07-03:** Every 1.13.0 milestone passed its scoped gate, but `npm run publish:check` found three full-tree failures.
First, `test/integration/dashboard-server.test.ts` still matched `alpinejs@3` after the asset was vendored at `/assets/alpine.js`.
Second, `appendQualityReportContract` shipped at complexity 21 because scoped ESLint checked only the file's diff, not the full `src/cli` tree.
This repeated the M01 recurrence above.
That function's branchy `full ? a : b` and `if (full)` lines needed small `pushVariant` and `pushFull` helpers.
Third, deleting `coming-soon` left its name in `.goat-flow/code-map.md`, `docs/dashboard.md`, and `.goat-flow/architecture.md`.
It also left seven backticked learning-loop references.
Those references tripped the round-trip fixture's embedded preflight.
Run publish-check last after deleting files, moving symbols, or swapping served assets.
Fast tests and scoped ESLint do not cover full-tree complexity, cold-path docs, or learning-loop references.

**Recurrence 2026-07-12 and 2026-08-09:** Two hook-contract batches aimed ESLint at ignored tests.
`--no-ignore` then failed outside the parser project, and one batch omitted Gruff's `analyse` subcommand.
Supported Node tests, typecheck, Prettier, and `gruff-ts analyse <file>` produced valid evidence.
Anchors: `test/contract/command-phrases.test.ts` (search: `agent mutation and external-write authority`) and
`test/unit/playbook-contract.test.ts` (search: `assertRegistrationCommandForEachPlaybook`).

**Recurrence 2026-07-12:** A later gate listed ignored unit and integration files in `npx eslint --max-warnings 0`.
The corrected gate linted only changed `src/cli/audit/` files; TypeScript, Prettier, and focused Node tests covered the ignored tests.
Evidence anchor: `eslint.config.mjs` (search: `"test/**"`).

**Recurrence 2026-07-13:** A context-report gate hit Prettier on three files, ESLint on out-of-project tests, and Knip on four internal exports.
Formatting, scoped source lint and tests, and private types cleared it.
Evidence: `test/unit/context-report.test.ts` (search: `static context report`).

**Recurrence 2026-07-31:** Two audit batches caught ESLint complexity, a Node directory target, a probe without `PATH`,
and stale terminal-environment smoke expectations.
The fixes extracted a helper, targeted `*.test.ts` (91/91), reused `process.env`, and aligned the smoke contract (20/20).
Evidence: `src/cli/audit/check-factual-claims.ts` and
`test/smoke/dashboard-endpoints.test.ts` (search: `GOAT_CLAUDE_REPORTING_SETTINGS`).

**Recurrence 2026-08-07:** An EXIT-trap cleanup made the executor reject M05's `test:fast` wrapper before npm ran.
Retaining the printed `mktemp` log produced `1580` passes and `0` failures.
Gate wrappers no longer bundle destructive cleanup.

---
