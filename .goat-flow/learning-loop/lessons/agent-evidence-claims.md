---
category: agent-evidence-claims
last_reviewed: 2026-08-01
---

## Lesson: Agent cited gitignored content as evidence in committed docs

**Created:** 2026-05-11

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
