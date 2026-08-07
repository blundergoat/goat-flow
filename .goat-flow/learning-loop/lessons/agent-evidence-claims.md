---
category: agent-evidence-claims
last_reviewed: 2026-08-07
---

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
