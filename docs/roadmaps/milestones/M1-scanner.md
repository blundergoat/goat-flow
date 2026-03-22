# Milestone 1: Scanner + Scoring Engine

**Archetype:** Prove It Works — validate the rubric-as-data architecture, 6 evaluators, fact model. No prompt generation, no dashboard, no npm publish.

## Objective

`npx @blundergoat/goat-flow scan .` outputs structured JSON with every check result, a score per tier, a letter grade, and prioritised recommendations. Self-scan against goat-flow scores B+.

## Assumptions to Validate

- [x] Rubric-as-typed-data with 6 evaluators handles 90%+ of checks without `custom` escape hatch — **confirmed**: 62 checks + 9 anti-patterns, generic evaluators cover the vast majority
- [x] Fact model extracts enough signal from a single filesystem pass to evaluate all checks — **confirmed**: facts/extract.ts + shared.ts + agent.ts handle full extraction
- [ ] Section-scoped regex is reliable enough to detect execution loop steps, autonomy tiers, DoD gates across diverse instruction files — **partially validated**: works on goat-flow's 3 files, untested on diverse repos
- [x] Shape detection from package manifests works for the common cases without full TOML/YAML parsing — **confirmed**: package.json/composer.json/Cargo.toml/go.mod all working
- [x] `node:test` + `tsx` as sole dev deps produces a workable test experience on Node 22 — **confirmed**: 13 tests passing

## Tasks

### Phase A: Skeleton (1-2 sessions)
1. [x] `package.json`, `tsconfig.json`, directory structure
2. [x] `types.ts` — CheckDef, Detection, ProjectFacts, AgentProfile, CheckResult, ScanReport
3. [x] `facts/fs.ts` — ReadonlyFS (exists, readFile, lineCount, readJson, glob, isExecutable)
4. [x] `test/helpers/` — MockFs, TestProject builder, presets
5. [x] `cli.ts` — parseArgs (`scan`, `--format`, `--agent`, `--verbose`, `--help`)

### Phase B: Detection + Facts (1-2 sessions)
6. [x] `detect/agents.ts` — find CLAUDE.md/AGENTS.md/GEMINI.md → AgentProfile[]
7. [x] `detect/shape.ts` — removed in v0.4.0 (see ADR-002)
8. [x] `detect/stack.ts` — languages, build/test/lint/format from manifests
9. [x] `facts/extract.ts` + `facts/shared.ts` + `facts/agent.ts` — full fact extraction
10. [x] Tests for detection and fact extraction (13 tests, all pass)

### Phase C: Rubric + Evaluators (2-3 sessions)
11. [x] `evaluate/evaluators.ts` — 6 generic evaluators (file_exists, dir_exists, line_count, grep, grep_count, json_valid/json_contains, count_items, composite, custom)
12. [x] `rubric/foundation.ts` — Tier 1: 22 checks (42 points)
13. [x] `rubric/standard.ts` — Tier 2: 21 checks (32 points)
14. [x] `rubric/full.ts` — Tier 3: 19 checks (20 points)
15. [x] `rubric/anti-patterns.ts` — AP1-AP9 (9 anti-patterns, max -15 deduction)
16. [x] Custom evaluators inline (router, local context, deny, skills completeness)
17. [~] Evaluator unit tests — deferred; covered by Phase E integration tests

### Phase D: Scoring + Output (1-2 sessions)
18. [x] `scoring/engine.ts` — percentages, grades (A-F), N/A handling, inflation guard (<10% applicable = insufficient-data)
19. [x] `scoring/recommendations.ts` — priority-sorted (critical→high→medium→low) with stable keys for M2
20. [x] `render/json.ts` — canonical JSON output
21. [x] `render/text.ts` — text output with progress bars + `--verbose` per-check details
22. [~] Scoring math tests — covered by integration tests and self-scan

### Phase E: Integration + Validation (1-2 sessions)
23. [x] `evaluate/runner.ts` — wire pipeline: detect → facts → evaluate → score → render
24. [x] 10 fixture manifests (empty, minimal-claude, minimal-codex, full-claude, full-multi-agent, library-shape, anti-patterns, partial-setup, allowed-missing, self-goat-flow) — 40 tests, all pass
25. [x] Self-scan test against goat-flow — scores B (Claude 87%, Codex 86%, Gemini 89%)
26. [x] Score snapshot tests for all fixtures — grade ranges, anti-pattern triggers, N/A handling, recommendation keys verified

## Exit Criteria

- [x] `npx @blundergoat/goat-flow scan .` outputs valid JSON for any project
- [x] `npx @blundergoat/goat-flow scan --format text` prints grade + tier breakdown
- [x] `--verbose` shows per-check details with evidence
- [x] Self-scan of goat-flow scores B (87-89% across agents)
- [x] 10 fixture manifests pass with pinned expected scores (40 tests)
- [x] Zero false positives on anti-pattern deductions against known-good setups
- [x] `--agent` filter works
- [x] Each check result includes confidence field (high/medium/low)
- [x] Recommendation keys are stable (documented, tested, used as M2 join key)

## Gotchas & Fallbacks

| Risk | Fallback |
|------|----------|
| >10% of checks need `custom` evaluator (rubric-as-data doesn't scale) | Split complex checks into sub-checks that fit generic evaluators. Accept `custom` for router resolution and local context — those are genuinely structural. |
| Section-scoped regex fails on instruction files with non-standard headings | Fall back to whole-file grep with narrower patterns. Accept lower confidence score on those checks. |
| Shape detection wrong for Go projects (no `type` field in go.mod) | Removed — shape no longer affects scoring. |
| Self-scan doesn't score B+ because the rubric is too strict against this repo | Tune the rubric, not the repo. The rubric is code — adjust point values or thresholds. |
| `node:test` flaky on Node 22 for some edge case | Use `tsx --test` which wraps it. If still flaky, bump to Node 24. |

## Key Decisions

| Decision | Why |
|----------|-----|
| Rubric as typed data, not parsed from markdown | One source of truth in code. No parser to maintain. Adding a check = one object. |
| Fact model (scan once, score against facts) | Reads each file once. Facts are reusable by M2. Deterministic. |
| 6 generic evaluators + `custom` escape hatch | Covers 90%+ of checks without per-check functions. `custom` handles the 3-4 genuinely complex checks. |
| `confidence` field on every check | Heuristic checks (1.3.2, 2.6.1) score with `medium` confidence. Users know which scores to trust. |
| Stable recommendation keys | M2 maps failed checks to fix fragments via these keys. Changing a key is a breaking change. |
| Text renderer in M1, not deferred to M4 | `--verbose` is essential for debugging scores during development. Trivial to add with the renderer architecture. |

---

## Human Testing Gate

Before M1 is complete, the user MUST verify:

- [ ] Run `npx @blundergoat/goat-flow scan .` on the goat-flow repo — confirm it produces valid JSON with a B+ grade
- [ ] Run `npx @blundergoat/goat-flow scan --format text --verbose` — confirm the output is readable and every check shows evidence
- [ ] Run on a project with NO goat-flow setup — confirm it reports F / no score, not an error
- [ ] Run on a project with partial setup — confirm partial scores make sense (not inflated, not zero)
- [ ] Check 2-3 individual check results for accuracy — does the evidence match what's actually in the files?
- [ ] Confirm `--agent` filter shows only the selected agent

M1 is NOT complete until the user has run these checks and confirmed they pass.

---

## What M1 Does NOT Build

- Prompt generation (M2)
- HTML dashboard (M3)
- Markdown renderer, CI gate mode, npm publish (M4)
- Monorepos, AP10/AP11, dynamic rubric (v2)
