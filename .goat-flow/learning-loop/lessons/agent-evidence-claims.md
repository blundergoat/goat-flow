---
category: agent-evidence-claims
last_reviewed: 2026-08-16
---

## Lesson: A config change that fails to fix a symptom is not proof of the mechanism

**Status:** active | **Created:** 2026-08-16
**Decision changed:** Read a tool's own schema or source before stating why one of its options did not work.
**Trigger phase:** VERIFY
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

**Root cause:** When seeding pattern docs from external material temporarily staged under `.goat-flow/scratchpad/`, the authoring agent kept the verbatim citations instead of (a) committing the source material first, (b) restating the principle without the citation, or (c) marking the section guidance-only. It treated the scratchpad path as cite-able because it lives inside `.goat-flow/`, missing that the whole `scratchpad/` subtree is gitignored. Naming the external skills (MySQL, Valyu, frontend-design) compounded it: the agent imported provider vocabulary with the structural pattern.

**Why it matters:** (1) **Broken evidence chain.** A cloned checkout cannot follow the cited path or its `(search: "...")` anchor; the Evidence Standard (`workflow/skills/reference/skill-preamble.md`, search: `Re-read each cited file`) requires citations anyone can re-read. (2) **Competitor/third-party leakage.** Naming external skills in committed docs implies goat-flow ships, endorses, or derives from those vendors' work, and pins generic patterns to one provider.

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

**What happened:** goat-flow once scored 100% on its own scanner system (removed per ADR-013) while `preflight-checks.sh` failed with 8 errors. The scanner checked structural presence (files exist, have right headings); preflight checked functional correctness (commands work, paths resolve, versions match).

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

**Created:** 2026-07-03

**What happened:** While assessing loop coverage, `grep -n "stats\|quality\|audit\|index" scripts/preflight-checks.sh | head -20` showed no `stats` hit, and the analysis claimed `stats --check` ran in no local gate. The `head -20` had truncated the match list; preflight's Learning-Loop Schema section already ran `node dist/cli/cli.js stats . --check`. The user's "double check" instruction exposed the false absence claim before it shaped the fix.

**Root cause:** A multi-pattern grep piped through `head` answers "what appears early", not "does X appear at all". The absence conclusion was drawn from a presence-oriented, truncated probe.

**Prevention:** Before claiming a pattern is absent from a file or repo, rerun the exact single pattern with no `head`/`tail` truncation (or `grep -c`). Treat any `| head` output as a sample, never as evidence of absence. Evidence anchor: `scripts/preflight-checks.sh` (search: `Learning-Loop Schema`).

**Recurrence (2026-08-12):** A `5-call` contract-surface census scoped to six hand-picked directories returned seven paths, and the count was about to ship as an exact-count expectation inside a milestone stop condition. `git grep -ln "5-call"` over the tracked tree returned eight: `.goat-flow/learning-loop/decisions/ADR-042-cross-harness-invocation-ask-first.md` (search: `5-call`) sat outside every scanned directory, so the honest wider census would have false-fired the stop rule on its first run. Exact-count claims follow the same rule as absence claims: derive them from the widest search the claim implies - `git grep` over the tracked tree, not a hand-picked directory list - before pinning the count into a stop condition or expected-result cell.

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

**Status:** active | **Created:** 2026-05-19 | **Incident count:** 9 | **Latest occurrence:** 2026-08-15

**Decision changed:** Use repository-owned package scripts when a verification target loads TypeScript. | **Trigger phase:** VERIFY

**What happened:** Several closeouts sent ignored tests or workflow `.mjs` files to TypeScript-only ESLint. One also ran `npm test` beside expensive checks and lost the failing block; a captured rerun passed (`# tests 881`, `# pass 881`, `# fail 0`).

**Root cause:** I mixed repo-supported verification scopes with improvised paths and treated parallel final gates as interchangeable with a clean final evidence run. That made the first failure ambiguous and forced a rerun to recover the actual evidence.

**Recurrence update (2026-08-14):** The M03 generator-inventory gate invoked `scripts/generate-managed-hook-desired-state.mjs` with plain Node, which failed to resolve `registry.ts`'s `.js` import of the TypeScript manifest. `package.json`'s `check:managed-hook-contract` script includes `--import tsx`, and the same artifact check exited zero. Use the package script instead of reconstructing its runtime loader. Evidence anchors: `package.json` (search: `check:managed-hook-contract`), `src/cli/agents/registry.ts` (search: `loadManifest`), and `scripts/generate-managed-hook-desired-state.mjs` (search: `managed-hook contract current`).

**Recurrence update (2026-08-15):** Four PR-backed skill RED attempts spent their bounded implementation calls reproducing fixture seals. One tried unavailable JavaScript-isolate hashing, another exceeded the command-chain safety limit, and a cleanup attempt displaced final state verification. All four runs were excluded rather than scored. Fixture acquisition and canonical sealing now belong to the independent host preflight; evaluator evidence calls consume the already-verified fixture, and the last call stays reserved for checkout state and actual-diff proof. Evidence anchors: `workflow/hooks/deny-dangerous.sh` (search: `Command has more than 50 chained segments`), `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `rm -r without safe scoping`), and `.goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md` (search: `Each phase is one isolated evaluator run`).

**Recurrence update (2026-08-15, exact-owner comparison):** A later fixture pass repeated the more-than-50-segment failure while comparing complete authority sets. The command was blocked before execution, so it proved nothing about those files. The corrected transport uses one bounded read result per owner with immediate completion evidence; exact-set comparison remains a separate root-verifier operation. Evidence anchors: `workflow/hooks/deny-dangerous.sh` (search: `Command has more than 50 chained segments`) and `AGENTS.md` (search: `Sub-agents: ONE objective`).

**Recurrence update (2026-08-15, reserved final call):** A fresh skill evaluator hit orchestration guards in its evidence and mutation calls, then used the verification-only fifth call to finish unread evidence, write four files, and run checks. It defended the deviation with unchanged scope, but path containment does not satisfy a phase contract: the run was invalid even though the final diff stayed inside the write set. Reserve the final call behaviorally, not just numerically; an earlier guard failure cannot borrow it for mutation. Evidence anchors: `.goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md` (search: `Each phase is one isolated evaluator run`) and `AGENTS.md` (search: `Fix verification`).

**Recurrence update (2026-08-14):** Full preflight rejected the prose phrase joining “workflow” and “job permissions” with a slash in all three installed goat-security mirrors because `scripts/check-path-integrity.sh` treats every installed-skill occurrence of that path-shaped token as a framework-local path. The canonical reference contained the same committed phrase. Use “workflow and job permissions” when the text names two permission layers rather than a path, and run path integrity after skill-reference edits. The generic skill-creator validator then rejected goat-flow’s required `goat-flow-skill-version` field. Do not remove repository-owned metadata to satisfy a generic validator; use `npm run check-versions` and full preflight for this repository. While recording this recurrence, backticking the slash-joined phrase triggered `stale-ref`; describe non-path slash prose without a path-shaped code span. Evidence anchors: `scripts/check-path-integrity.sh` (search: `framework-local`), `scripts/check-versions.mjs` (search: `goat-flow-skill-version`), `src/cli/facts/shared/reference-paths.ts` (search: `export function isFileRef`), and `workflow/skills/goat-security/references/supply-chain-and-cicd.md` (search: `workflow and job permissions`).

**Recurrence update (2026-08-09):** A runtime-adapter check again sent workflow `.mjs` to TypeScript-only ESLint. Workflow modules instead use `node --check`, Prettier, targeted Gruff, runtime fixtures, and preflight. Evidence anchors: `workflow/hooks/hook-provider-adapters.mjs` (search: `Decodes bounded provider-neutral hook results`) and `scripts/preflight-checks.sh` (search: `lint_targets[@]`).

**Recurrence update (2026-05-19):** The same closeout also added a dashboard markdown performance sanity test whose 500KB fixture was newline-heavy. Focused runs passed, but preflight's concurrent fast-suite runner exceeded the 100ms budget. The fixture still needed to be 500KB, but it needed to measure plain markdown throughput rather than line-break parsing stress.

**Recurrence update (2026-05-26, 2026-06-14):** The same dashboard markdown performance sanity test (test/unit/dashboard-markdown.test.ts, since removed in 1.13.0 with the markdown viewer) passed standalone and in `npm test`, but failed under preflight's `npm run test:coverage` because Node's coverage instrumentation and full-suite concurrency pushed the 500KB render over hard 100ms/250ms budgets (`expected <100ms, got 115ms` and later `159ms`; the full preflight still needed the retry path at 250ms). A later fixed `750ms` ceiling was still machine-sensitive, so the test now compares the 500KB render against a same-process 100KB baseline with a generous floor.

**Recurrence updates (2026-05-19, 2026-08-08):** Commit-guidance helpers passed focused tests but failed full preflight with `Knip: 2 unused exports/types`; making internal types private fixed it. Later, removing the history detector removed the cited `CommitGuidanceStatus`, so the audit suite failed on a stale learning-loop anchor. Keeping that type as the template-copy result status fixed the reference. Run `goat-flow stats --check` before deleting cited symbols. Evidence anchor: `src/cli/prompt/commit-guidance.ts` (search: `type CommitGuidanceStatus`).

**Recurrence update (2026-07-03):** 1.13.0 milestones each passed their per-file scoped gates, yet the closing `npm run publish:check` failed three ways only a full-tree run surfaces: (1) an integration assertion still matched a CDN string after an asset was vendored locally (`test/integration/dashboard-server.test.ts`, `alpinejs@3` → `/assets/alpine.js`); (2) `appendQualityReportContract` shipped at complexity 21 because scoped eslint had only run the file's own diff, never the whole `src/cli` tree - as in the M01 recurrence above, route branchy `full ? a : b` / `if (full)` lines through small `pushVariant`/`pushFull` helpers so each decision sits in the helper's scope; (3) deleting the `coming-soon` dashboard view left its name in three prose lists (`.goat-flow/code-map.md`, `docs/dashboard.md`, `.goat-flow/architecture.md`) and orphaned 7 backticked learning-loop refs, tripping the round-trip fixture's embedded preflight. Prevention: when a milestone deletes files, moves symbols between modules, or swaps a served asset, run `npm run publish:check` as the FINAL gate - the fast suite and scoped eslint do not exercise full-tree complexity, cold-path doc drift, or learning-loop ref integrity.

**Recurrences (2026-07-12, 2026-08-09):** Two hook-contract batches aimed ESLint at ignored tests; `--no-ignore` then failed outside the parser project. One also omitted Gruff's `analyse` subcommand. Supported Node tests, typecheck, Prettier, and `gruff-ts analyse <file>` produced valid evidence. Anchors: `test/contract/command-phrases.test.ts` (search: `agent mutation and external-write authority`); `test/unit/playbook-contract.test.ts` (search: `assertRegistrationCommandForEachPlaybook`).

**Recurrence update (2026-07-12):** A later testing gate listed ignored unit and integration files in `npx eslint --max-warnings 0`. The corrected gate linted only the changed `src/cli/audit/` files; TypeScript, Prettier, and focused Node tests cover ignored tests. Evidence anchor: `eslint.config.mjs` (search: `"test/**"`).

**Recurrence update (2026-07-13):** A context-report gate hit Prettier on three files, ESLint on out-of-project tests, and Knip on four internal exports. Formatting, scoped source lint/tests, and private types cleared it. Evidence: `test/unit/context-report.test.ts` (search: `static context report`).

**Recurrence update (2026-07-31):** Two audit batches caught ESLint complexity, a Node directory target, a probe without `PATH`, and stale terminal-env smoke expectations. Fixes extracted a helper, targeted `*.test.ts` (91/91), reused `process.env`, and aligned the smoke contract (20/20). Evidence: `src/cli/audit/check-factual-claims.ts` and `test/smoke/dashboard-endpoints.test.ts` (search: `GOAT_CLAUDE_REPORTING_SETTINGS`).

**Recurrence update (2026-08-07):** An EXIT-trap cleanup made the executor reject M05's `test:fast` wrapper before npm ran. Retaining the printed `mktemp` log produced `1580` pass / `0` fail. Gate wrappers no longer bundle destructive cleanup.

**Prevention:** Run supported format, lint, Knip, and test gates with captured output. A predecessor may exempt one named RED fixture only when a blocked dependent owns it: preserve the full failure receipt, run every other test, and keep the green gate downstream. Any extra failure stops. Evidence anchors: `test/integration/setup-install-agent-matrix.test.ts` (search: `must have one exact registration`), `package.json` (search: `test:fast`), and `knip.json` (search: `ignoreDependencies`).

---
