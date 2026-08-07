---
category: docs-drift
last_reviewed: 2026-08-01
---

## Footgun: Cold-path docs drift while structural audit passes

**Status:** active | **Created:** 2026-04-15 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** The CLI audit reports PASS while cold-path documentation contains false claims, wrong check descriptions, dead paths, and glossary misdirections. Contributors reading docs instead of code form incorrect mental models of what the system does.

**Why it happens:** The audit validates structure (files exist, paths resolve, versions match). Partial content automation exists: `src/cli/audit/check-factual-claims.ts` catches count-claim drift across `PROSE_TARGETS` plus `docs/*.md`; `src/cli/audit/check-content-quality.ts` full-scans instruction files, skill references, every registered standalone playbook, public docs, ADRs, setup templates, and installed skills. It also discovers footgun, lesson, and pattern buckets dynamically, but scans those historical surfaces only for generic and non-actionable wording; `stats --check` separately enforces their schema and `(search: ...)` anchors. None of those checks fact-checks arbitrary prose, so uncovered factual claims can still drift as code changes.

**Evidence (5 rounds, 37 findings, all resolved - kept as pattern evidence, not an open defect list):**

| Round | Date | Findings | Surfaced by | Representative drift |
|---|---|---|---|---|
| 1 | 2026-04-15 | 7 | 8 independent critiques | dead check descriptions; "zero runtime dependencies" claim; glossary pointing at the wrong reference file |
| 2 | 2026-04-16 | 8 | 4-critique cross-review | wrong check counts (claimed 8/18, actual 16/16); `.js` paths surviving the dashboard TypeScript migration |
| 3 | 2026-04-24 | 3 | 3 independent Copilot quality reports | `docs/skills.md` describing a `/goat-plan` default that contradicted the shipped skill; hot-path listing omitting `.github/copilot-instructions.md` |
| 4 | 2026-05-11 | 15 | full documentation audit during the v1.6.0 wave | four instruction files carrying materially different Never tiers; header dates stamped from the wrong release; ADR status vocabulary violations |
| 5 | 2026-08-01 | 4 | external review re-verified against the live goat-review bundle | three anchors retained a retired automated-review label; one systemic-pattern anchor named wording that never existed |

Three findings from Round 4 (2026-05-11) drove Prevention 5-7 below and are the ones worth remembering in detail:

- Committed docs cited evidence under gitignored `.goat-flow/scratchpad/`, so a reader cloning the repo could not follow the reference. The same surfaces leaked third-party skill names and a vendor env var into goat-flow's own docs. Follow-up lesson: `.goat-flow/learning-loop/lessons/agent-evidence-claims.md` (search: `Agent cited gitignored content as evidence in committed docs`).
- `docs/skill-quality-config.md` formatted a bare skill-file basename as a code span; path-integrity read it as a repo path and failed the drift test in PR #36.
- `scripts/check-instruction-parity.mjs` validated section headings only, so four instruction files could disagree on the content of the Never tier while parity passed.

**Impact:** The framework demands "real evidence only" and "MUST maintain cross-file consistency" while its own cold-path surfaces violate both rules. Agents consulting docs for orientation get wrong information. The audit's PASS stamp creates false confidence. Round 4 also surfaced two new failure modes worth promoting to a preflight check (see Prevention #5 and #6 below).

**Prevention:**
1. Add content-drift checks to preflight: compare doc check descriptions against exported check names from code
2. Extend path-integrity checks to cover code-map, glossary canonical-file paths, and convention claims
3. Consider auto-generating audit docs from check code to prevent drift permanently
4. Change Step 01 early-stop rule (`workflow/setup/01-system-overview.md` (search: `## State check`)) to require content-drift checks, not just structural audit pass
5. **Block citations of gitignored paths from committed files** - add a preflight grep for `\.goat-flow/(scratchpad|plans|logs/sessions|logs/quality|logs/critiques|logs/security|logs/uploads)/` inside `*.md` and `*.ts` files (excluding the gitignored trees themselves and the documented "where to write artifacts" instructions). The `instruction-file-skill-docs-pointer` audit check already understands which paths are gitignored; reuse that classification here.
6. **Block competitor / third-party skill names in goat-flow-owned committed surfaces** - maintain a small denylist (`Valyu`, `MySQL skill`, `prime corpus`, `frontend-design skill`, `writing-skills`, plus any future external skill references discovered) and grep `*.md` / `*.ts` outside `node_modules`, `.claude/worktrees`, `.goat-flow/scratchpad`, `.goat-flow/plans`, `.goat-flow/logs`. Generic patterns must be stated provider-neutrally (`<VENDOR>_API_KEY`, `a domain skill`, `a vendor-SDK skill`).
7. **Do not format illustrative basenames as path-like code spans** unless they resolve from the repo root. If a filename is an example rather than an actual path, write it in prose or include a valid parent directory.
8. ~~**Instruction-header dates drift every release because `bump-version.sh` updates the version but not the date.**~~ (resolved 2026-08-01: `scripts/bump-version.sh` (search: `RELEASE_DATE`) now reads the release date from the CHANGELOG's `## v<version> - <date>` heading and `update_instruction_header` (search: `update_instruction_header`) seds both the version and the `({DATE})` field. Verified 2026-08-01: all three headers read `v1.14.0 (2026-07-19)` against CHANGELOG `## v1.14.0 - 2026-07-19`. Do NOT hand-edit these dates - the script owns them, and a manual edit will be overwritten on the next bump.)
9. Resolve every live `(search: ...)` citation against its named target in contract tests; exempt only explicitly labelled target-project placeholders.
