# SBAO Competitive Plans — @blundergoat/ai-workflow-goat

**Method:** Three independent plans generated, ranked against criteria, synthesised into prime.

---

## Inputs (from mob elaboration decisions)

- **Stack:** TypeScript, zero deps, npm publish as `@blundergoat/ai-workflow-goat`
- **M1 scope:** Scanner core, all checks, HTML report, anti-patterns, shape detection, agent detection, dual-agent side-by-side
- **M2 scope:** Dynamic prompt generator, basic testing
- **M3 scope:** Text, JSON, markdown output formats
- **M4 scope:** Prepare for open source and npm publish
- **M5 scope:** CI mode, more testing
- **M6 scope:** Promotion (awesome-claude-code, blog article, project page)
- **Scoring:** Always out of 100. No N/A skips. Libraries lose points for missing items.
- **Architecture:** Modular internals (src/checks/, src/formatters/, src/prompts/)
- **Prompt generator:** Plan files ship with auditor. Batched by phase. Self-contained prompts.
- **Dual-agent:** Two independent scores, shared files noted
- **Testing:** Unit + integration fixtures + regression against real repos + own AI workflow setup

---

## Plan A — "Scanner-First, Polish Later"

**Philosophy:** Get the scoring engine perfect first. Every check working, every point calibrated. HTML report is functional but minimal. Prompt generator and output formats are separate layers added after the core is proven.

### M1: The Scoring Engine (2 weekends)

**Goal:** Run against all 8 BlunderGOAT repos, produce correct scores.

- Project scaffolding: TypeScript, tsconfig, bin entry point, package.json with @blundergoat scope
- Core scanner architecture: `src/checks/` with one module per check category (1.1–3.5)
- Agent detection (CLAUDE.md, AGENTS.md, both, neither)
- Project shape detection (app/library/collection heuristic)
- All 50+ checks implemented with regex and file reads
- Anti-pattern deductions (all 9)
- Scoring engine: points, tiers, grade calculation
- Recommendation engine: priority mapping per check
- Dual-agent: run checks independently per agent, merge shared file results
- HTML report: single self-contained file, inline CSS, tier progress bars, check results table, recommendations list, anti-pattern warnings
- Lightweight markdown heading parser for section-level analysis
- Manual validation against 8 BlunderGOAT repos

**Exit criteria:** All 8 repos score correctly. HTML report renders. Zero false positive anti-pattern deductions on known-good setups.

**Risk:** 2 weekends is aggressive for 50+ checks + HTML template + dual-agent. Could easily be 3.

### M2: Prompt Generator + Testing Foundation (1-2 weekends)

**Goal:** Generate fix-it prompts. Prove the system works with tests.

- Plan files bundled in package (`plans/` directory)
- Prompt templates per phase (1a, 1b, 1c, 2)
- Stack detection from filesystem for prompt pre-fill
- Phase batching: group failures by phase, one prompt per phase
- PARTIAL handling: full prompt with "partially exists" warning
- Agent targeting: Claude Code vs Codex prompt variants
- `--prompts` flag wired up
- Unit tests for individual check functions
- Integration test fixtures: 4 synthetic projects (grade A, B, D, F)
- Regression snapshots from BlunderGOAT repos

**Exit criteria:** Prompt generator produces usable prompts for all failure types. Test suite passes. Fixture projects score correctly.

### M3: Output Formats (1 weekend)

**Goal:** Text, JSON, markdown formatters.

- Text formatter: coloured terminal output, score/grade/tier summary, top recommendations
- JSON formatter: full structured output matching the schema in the checklist doc
- Markdown formatter: workflow-score.md with tables and recommendation list
- Auto-detect terminal vs pipe for default format
- `--format` flag

**Exit criteria:** All 4 output formats produce correct, readable output.

### M4: Open Source Prep (1 weekend)

**Goal:** Ready for npm publish and public GitHub repo.

- README with usage, scoring rubric explanation, examples
- CONTRIBUTING.md
- LICENSE (MIT)
- CLAUDE.md and AI workflow setup for the auditor itself
- package.json metadata (description, keywords, repository, bin)
- npm publish dry-run
- First npm publish
- GitHub repo public

**Exit criteria:** `npx @blundergoat/ai-workflow-goat .` works from a fresh machine.

### M5: CI Mode + Hardening (1 weekend)

**Goal:** CI integration, expanded test coverage.

- `--min-score` exit code mode
- `--min-grade` alias
- One-line CI summary output
- Edge case testing: empty projects, massive CLAUDE.md, malformed files, Windows paths
- Performance check: confirm <3 second execution
- Error handling: graceful failures for unreadable files, permission issues

**Exit criteria:** CI mode works in GitHub Actions. No crashes on edge cases.

### M6: Launch & Promotion (1 weekend)

**Goal:** Public awareness.

- awesome-claude-code PR
- blundergoat.com blog article
- blundergoat.com /projects/ page entry
- Social sharing (if applicable)
- Monitor issues and feedback

**Exit criteria:** Listed in awesome-claude-code. Article published. Project page live.

**Total: 8-9 weekends**

---

## Plan B — "HTML Report as the Hero"

**Philosophy:** The HTML report IS the product. People share reports, not JSON. Build the visual experience first and let it drive what data the scanner needs to produce. The report design dictates the scanner architecture.

### M1: Report-Driven Scanner (2-3 weekends)

**Goal:** Beautiful HTML report that makes people want to share their score.

- Start with the HTML report template: design the layout, sections, visual hierarchy
- Score dashboard: large grade letter, score/100, tier breakdown with progress bars
- Per-check results: colour-coded rows (green/amber/red), expandable detail
- Anti-pattern section: warning badges with explanations
- Recommendation cards: priority-coded, with action text
- Dual-agent: side-by-side columns when both detected
- Project metadata header: shape, agents detected, scan date, rubric version
- THEN build the scanner to produce exactly the data the report needs
- All 50+ checks, anti-patterns, agent detection, shape detection
- `--format html` writes file (workflow-audit.html)
- Manual validation against 8 repos — focus on report clarity as much as score accuracy

**Exit criteria:** Report looks good enough to screenshot for a blog post. Scores are correct.

**Risk:** Design-first can lead to over-investing in visual polish before the scoring logic is proven. A beautiful report showing wrong scores is worse than an ugly report showing right scores.

### M2: Prompt Generator (1-2 weekends)

**Goal:** Close the loop — report shows what's wrong, prompts fix it.

- Plan files bundled
- Prompt templates per phase, batched
- Stack detection for pre-fill
- Agent-targeted prompts
- Prompts section in HTML report: expandable cards with copy button
- Basic test suite (unit + fixtures)

**Exit criteria:** Every recommendation in the report has a matching prompt. Copy button works.

### M3: Machine Formats (1 weekend)

- Text, JSON, markdown formatters
- `--format` flag, auto-detection

### M4: Open Source (1 weekend)

- README, LICENSE, CONTRIBUTING, CLAUDE.md
- npm publish
- GitHub public

### M5: CI + Hardening (1 weekend)

- `--min-score`, edge cases, performance

### M6: Launch (1 weekend)

- awesome-claude-code, blog, project page

**Total: 8-9 weekends**

---

## Plan C — "Ship Fast, Iterate in Public"

**Philosophy:** Get to npm publish as fast as possible. A working tool with rough edges is more valuable than a polished tool that doesn't exist yet. Ship M1-M4 as one sprint, iterate based on real usage.

### M1: Minimum Shippable Auditor (1 long weekend)

**Goal:** `npx @blundergoat/ai-workflow-goat .` works and produces useful output.

- Project scaffolding + npm package setup from day 1
- Scanner with Tier 1 checks only (Foundation — 40 points). Tiers 2-3 flagged as "not yet scored"
- Agent detection, shape detection (basic)
- HTML report: functional but spartan (no fancy CSS, no expandable sections)
- Anti-pattern deductions (top 5 only, not all 9)
- Text output to terminal
- npm publish (private or beta tag)

**Exit criteria:** Installable and runnable. Scores the foundation tier correctly. HTML report exists.

### M2: Complete the Rubric (1-2 weekends)

**Goal:** All 50+ checks, all anti-patterns.

- Tier 2 and Tier 3 checks
- Remaining anti-patterns
- Dual-agent support
- Recommendation engine
- HTML report visual improvements
- Test against all 8 repos

**Exit criteria:** Full rubric scored correctly across all repos.

### M3: Prompt Generator (1 weekend)

- Plan files, templates, stack detection, batching, agent targeting

### M4: Polish + Formats (1 weekend)

- JSON, markdown output
- HTML report visual polish
- README, LICENSE, CONTRIBUTING
- npm publish (public, stable)
- GitHub public

### M5: CI + Testing (1 weekend)

- `--min-score`, CI mode
- Unit tests, fixtures, regression
- CLAUDE.md for the auditor itself

### M6: Launch (1 weekend)

- awesome-claude-code, blog, project page

**Total: 6-8 weekends**

---

## Ranking Matrix

Criteria weighted by Matt's stated priorities: personally useful first, cut scope aggressively, ship working tools.

| Criterion | Weight | Plan A | Plan B | Plan C |
|-----------|--------|--------|--------|--------|
| **M1 produces something useful** | HIGH | ⭐⭐⭐ Full scanner, functional report | ⭐⭐⭐ Beautiful report, full scanner | ⭐⭐ Partial scanner, spartan report |
| **Time to personally useful** | HIGH | ⭐⭐ 2 weekends to usable | ⭐⭐ 2-3 weekends (design time) | ⭐⭐⭐ 1 weekend to something |
| **Score accuracy prioritised** | HIGH | ⭐⭐⭐ Scanner-first ensures correctness | ⭐⭐ Design-first risks polish over accuracy | ⭐⭐ Partial rubric means incomplete scores |
| **HTML report quality at M1** | MEDIUM | ⭐⭐ Functional, not beautiful | ⭐⭐⭐ Hero feature, designed first | ⭐ Spartan |
| **Scope creep resistance** | HIGH | ⭐⭐⭐ Clear boundaries per milestone | ⭐⭐ Design phase can expand | ⭐⭐⭐ Aggressive cuts keep scope tight |
| **Testing built in early** | MEDIUM | ⭐⭐ M2 for tests | ⭐⭐ M2 for tests | ⭐ M5 for tests (late) |
| **Prompt generator timing** | MEDIUM | ⭐⭐⭐ M2, after scanner proven | ⭐⭐⭐ M2, integrated into HTML | ⭐⭐ M3, after rubric complete |
| **Risk of wrong scores** | HIGH | ⭐⭐⭐ Low — all checks in M1, tested against 8 repos | ⭐⭐ Medium — design may distract from accuracy | ⭐ High — shipping partial rubric means incomplete picture |
| **Open source readiness path** | MEDIUM | ⭐⭐⭐ Clear M4 prep milestone | ⭐⭐⭐ Clear M4 prep milestone | ⭐⭐ Early publish means rough edges public |
| **Matches M1 scope decision** | HIGH | ⭐⭐⭐ Exact match | ⭐⭐⭐ Exact match (different order) | ⭐ Partial match — splits M1 scope across M1+M2 |

### Scores

| Plan | Total | Verdict |
|------|-------|---------|
| **Plan A** | 28/30 | Best overall. Scanner-first ensures correctness. HTML report functional in M1. Clean milestone boundaries. |
| **Plan B** | 25/30 | Strong visual-first approach but risks over-investing in design before scoring is proven. |
| **Plan C** | 20/30 | Fastest to "something exists" but shipping partial rubric violates the M1 scope decision. |

---

## Prime Plan (Synthesised)

**Take from Plan A:** Scanner-first architecture. All 50+ checks in M1. Correctness over beauty. Modular `src/checks/` structure. Clear testing in M2.

**Take from Plan B:** HTML report as a first-class output from M1, not an afterthought. Design the report layout early (even if simple) — it's the thing people see. Prompt generator integrated into the HTML report (copy buttons) in M2.

**Take from Plan C:** Nothing. The partial-rubric approach contradicts the M1 scope decision. The "ship fast" instinct is good but M1 already includes the full rubric.

**Reject from Plan B:** Don't design the report first and derive the scanner from it. Build the scanner, prove the scores are correct, THEN render them beautifully. A wrong score in a beautiful report is worse than a right score in a plain report.

**Reject from Plan C:** Don't ship partial rubric. A tool that says "not yet scored" on 60% of checks isn't useful for dogfooding against 8 repos.

### Prime Milestone Summary

| Milestone | Theme | Duration | Key Deliverables |
|-----------|-------|----------|-----------------|
| M1 | Prove It Works | 2-3 weekends | Full scanner (50+ checks), all anti-patterns, agent detection, shape detection, dual-agent, HTML report, recommendation engine. Validated against 8 repos. |
| M2 | Make It Prescriptive | 1-2 weekends | Prompt generator (batched by phase, agent-targeted, stack-detected), copy buttons in HTML report. Unit tests, integration fixtures, regression snapshots. |
| M3 | Make It Flexible | 1 weekend | Text, JSON, markdown output formats. `--format` flag. Auto-detection (terminal vs pipe). |
| M4 | Make It Public | 1 weekend | README, LICENSE, CONTRIBUTING, CLAUDE.md for the auditor. Package metadata. npm publish. GitHub repo public. |
| M5 | Make It Robust | 1 weekend | `--min-score` CI mode. Edge case testing. Performance validation (<3s). Error handling hardening. |
| M6 | Make It Known | 1 weekend | awesome-claude-code PR. Blog article. blundergoat.com project page. |

**Total: 8-10 weekends**

---

## Open Items for Milestone Planning (Step 04)

These decisions carry into the detailed milestone breakdown:

1. HTML report template approach: separate `.html` file compiled at build time (decision Q12 = b)
2. Plan files location in package: `plans/` directory at package root
3. npm org `@blundergoat` confirmed as existing
4. Fixture project structure: 4 directories (grade A, B, D, F) with synthetic CLAUDE.md and supporting files
5. Regression test approach: snapshots from real repos vs git submodules (snapshots preferred — repos change)
6. The auditor's own CLAUDE.md: created as part of M4 (open source prep) or M1 (dogfooding)?

Ready for step 04 — detailed milestone breakdown with exit criteria?
