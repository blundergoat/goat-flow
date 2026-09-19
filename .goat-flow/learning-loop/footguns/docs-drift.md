---
category: docs-drift
last_reviewed: 2026-09-05
---

## Footgun: Cold-path docs drift while structural audit passes

**Status:** active | **Created:** 2026-04-15 | **Evidence:** ACTUAL_MEASURED

**Prevention:**
1. Never read a structural PASS as proof that a doc's claims are current. Before repeating a check description, count, path, or env var from a doc, open the code that owns it.
2. Do not cite gitignored paths (`.goat-flow/scratchpad/`, `.goat-flow/plans/`, `.goat-flow/logs/`) as evidence in committed files; a reader cloning the repo cannot follow them.
3. State third-party skills, vendors, and env vars provider-neutrally in goat-flow-owned surfaces (`<VENDOR>_API_KEY`, "a domain skill"), never by product name.
4. Format a basename as a path-like code span only when it resolves from the repo root; otherwise write it in prose or include its real parent directory.
5. Never hand-edit instruction-header dates. `scripts/bump-version.sh` (search: `RELEASE_DATE`) reads the release date from the CHANGELOG heading and rewrites both version and date, so a manual edit is overwritten on the next bump.
6. When editing an ADR, sweep its `(search: ...)` anchors by hand or run `goat-flow audit --check-content`; `stats --check` validates anchors in footguns, lessons, and patterns only.

**Symptoms:** The CLI audit reports PASS while cold-path documentation carries false claims, wrong check descriptions, dead paths, and glossary misdirection, so contributors who read docs instead of code form the wrong model.

**Why it happens:** The audit validates structure: files exist, paths resolve, versions match. Content automation is partial. `src/cli/audit/check-factual-claims.ts` catches count-claim drift across `PROSE_TARGETS` and `docs/*.md`; `src/cli/audit/check-content-quality.ts` scans instruction files, skill references, playbooks, public docs, ADRs, setup templates, and installed skills for generic wording and, as `stale-semantic-anchor` warnings, for `(search: ...)` needles that no longer resolve; `stats --check` enforces schema and anchors for footguns, lessons, and patterns. No check fact-checks arbitrary prose, so uncovered claims still drift as code changes.

**Evidence (6 rounds, 42 findings, all resolved; kept as pattern evidence, not an open defect list):**

| Round | Date | Findings | Surfaced by | Representative drift |
|---|---|---|---|---|
| 1 | 2026-04-15 | 7 | 8 independent critiques | dead check descriptions; "zero runtime dependencies" claim; glossary pointing at the wrong reference file |
| 2 | 2026-04-16 | 8 | 4-critique cross-review | wrong check counts (claimed 8/18, actual 16/16); `.js` paths surviving the dashboard TypeScript migration |
| 3 | 2026-04-24 | 3 | 3 independent Copilot quality reports | `docs/skills.md` describing a `/goat-plan` default that contradicted the shipped skill; hot-path listing omitting `.github/copilot-instructions.md` |
| 4 | 2026-05-11 | 15 | full documentation audit during the v1.6.0 wave | four instruction files carrying different Never tiers; header dates stamped from the wrong release; ADR status vocabulary violations |
| 5 | 2026-08-01 | 4 | external review against the live goat-review bundle | three anchors retained a retired automated-review label; one anchor named wording that never existed |
| 6 | 2026-08-15 | 5 | manual path/anchor sweep during the 48-to-24 ADR consolidation | ADR bodies cited a retired `feedback-recency` check, a `verify coverage` goat-qa trigger, the `GOAT_LINT_ENFORCE` env var, and two moved files |

Round 4 (2026-05-11) drove Prevention 2 to 4: committed docs cited evidence under gitignored `.goat-flow/scratchpad/` and leaked third-party skill names and a vendor env var (`.goat-flow/learning-loop/lessons/agent-evidence-claims.md`, search: `Agent cited gitignored content as evidence in committed docs`); `docs/skill-quality-config.md` formatted a bare skill-file basename as a code span and failed path-integrity in PR #36; and `scripts/check-instruction-parity.mjs` validated headings only, so four instruction files disagreed on the Never tier while parity passed. Prevention 5 closed on 2026-08-01, when `scripts/bump-version.sh` (search: `update_instruction_header`) started stamping both fields and all three headers read `v1.14.0 (2026-07-19)` against the CHANGELOG. Prevention 6 was measured on 2026-08-15: a probe anchor in an ADR naming an identifier that appears nowhere in the repo passed `stats --check` with zero findings, while the same construction in a footgun reports `stale-ref`.
