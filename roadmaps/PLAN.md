# Implementation Plan - @blundergoat/goat-flow

**Package:** `@blundergoat/goat-flow`
**Rubric:** ai-workflow-improvement-plan-prime v1.5
**Scoring reference:** [RUBRIC.md](./RUBRIC.md)
**Working documents:** [draft/](./draft/)

---

## Product

A standalone CLI tool published on npm that audits the quality of AI coding agent workflow configurations. It reads the filesystem - instruction files, settings, hooks, skills, playbooks, docs - scores the setup against a structured rubric, and produces a report with prioritised recommendations and copy-paste-ready fix prompts.

```bash
npx @blundergoat/goat-flow .
```

No install required. No API key. No agent session. Zero runtime dependencies.

### Why

Existing tools check for feature *adoption* ("do you have hooks?"). This tool checks workflow *design quality* ("does your execution loop have all five steps? Are your Ask First boundaries project-specific? Do your footguns have file:line evidence?").

Nothing scores AGENTS.md setups. Nothing handles dual-agent projects. Nothing generates fix prompts pre-filled with your stack details. Nothing runs standalone without an active agent session.

### Users

**Primary:** Matt Hansen - dogfooding across 8+ BlunderGOAT repos after every AI workflow implementation to verify completeness and detect drift.

**Secondary:** Developers who've read "Stop Writing Rules. Build a Workflow." or cloned the ai-planning-playbook repo and want to verify their implementation.

### Success Criteria

- Runs in under 3 seconds on any project
- Correctly scores all 8+ BlunderGOAT repos (known-good setups score B or above)
- Zero false positives on anti-pattern deductions for known-good setups
- Produces actionable recommendations pointing to exact fix prompts
- `npx @blundergoat/goat-flow .` works without prior installation on macOS, Linux, Windows (WSL)
- Zero runtime dependencies
- Deterministic scoring (same project = same score every time)

### Constraints

- TypeScript compiled to ESM, Node.js 18+ (`util.parseArgs`)
- Zero runtime npm dependencies (stdlib only)
- Read-only filesystem access (never modifies target project)
- Rubric version-locked to plan v1.5
- v1 scores the BlunderGOAT workflow system only - explicit in README

---

## Architecture

### Repo Structure

```
goat-flow/
├── planning/                          ← Methodology templates (01-09)
├── workflow/                          ← AI workflow system docs
├── auditor/                           ← TypeScript CLI
│   ├── src/
│   │   ├── scanner.ts                 - Orchestrator
│   │   ├── types.ts                   - CheckResult, AuditReport, Recommendation
│   │   ├── checks/                    - One module per check category (1.1–3.5 + anti-patterns)
│   │   ├── detection/                 - agent.ts + shape.ts
│   │   ├── formatters/                - text.ts, json.ts, markdown.ts, html.ts
│   │   ├── prompts/                   - generator.ts, stack-detector.ts, templates/
│   │   ├── utils/                     - file-reader.ts, section-parser.ts, scoring.ts
│   │   └── templates/report.html      - HTML template (embedded at build)
│   ├── bin/goat.js                    - CLI entry point
│   ├── tests/
│   │   ├── checks/                    - Unit tests per check module
│   │   ├── fixtures/                  - Grade A/B/D/F synthetic projects
│   │   └── snapshots/                 - Real repo regression snapshots
│   ├── package.json
│   └── tsconfig.json
├── roadmaps/                          ← This plan + rubric + working drafts
├── CLAUDE.md                          ← Dogfooded workflow setup
├── README.md
└── LICENSE
```

### npm Packaging

The `workflow/` directory contains plan files referenced by the prompt generator. Since `npm pack` cannot include parent-directory paths, the build step copies `workflow/` into `auditor/dist/workflow/`.

```
Build:   tsc → dist/  &&  cp -r ../workflow dist/workflow
Publish: npm publish from auditor/ with "files": ["dist/"]
Runtime: prompts resolve plan files via path.join(__dirname, 'workflow/...')
```

### CLI Interface

```bash
npx @blundergoat/goat-flow [project-path] [flags]
```

| Flag | Values | Default | Effect |
|------|--------|---------|--------|
| `[project-path]` | directory | `.` | Target project to audit |
| `--format` | `text` `json` `markdown` `html` | Auto: `text` if terminal, `json` if piped | Output format |
| `--output` | file path | stdout for text/json; file in cwd for html/markdown | Write to file |
| `--shape` | `app` `library` `collection` | Auto-detect | Override project shape |
| `--agent` | `claude` `codex` `both` | Auto-detect | Override agent targeting for prompts |
| `--prompts` | boolean flag | off | Generate fix prompts for all failures |
| `--min-score` | 0–100 | - | CI gate: exit 1 if below threshold |
| `--min-grade` | `A` `B` `C` `D` | - | CI gate alias (A=90, B=75, C=60, D=40) |
| `--help` | - | - | Usage information |
| `--version` | - | - | Auditor version + rubric version |

**Exit codes:** `0` success or score >= threshold. `1` score below threshold or runtime error. `2` invalid arguments or missing directory.

**Defaults summary:**

| Invocation | Output |
|-----------|--------|
| `npx @blundergoat/goat-flow .` | Coloured text to terminal |
| `npx @blundergoat/goat-flow . \| jq` | JSON to stdout (auto-detect) |
| `npx @blundergoat/goat-flow . --format html` | `workflow-audit.html` in cwd |
| `npx @blundergoat/goat-flow . --min-score 75` | Text output + exit 0 or 1 |

### Prompt Generator

Generates copy-paste-ready prompts that fix identified gaps. One prompt per plan phase, batching related failures.

**Stack detection:** Reads `package.json`, `composer.json`, `Cargo.toml`, `pyproject.toml` to detect languages and build/test/lint/format commands. Pre-fills prompts.

**Agent targeting:** Prompts reference agent-appropriate files. Claude Code prompts reference CLAUDE.md, `.claude/skills/`, `.claude/hooks/`. Codex prompts reference AGENTS.md, `docs/codex-playbooks/`, `scripts/`.

**Plan file handling:** Adaptive. If `workflow/ai-workflow-improvement-plan-prime.md` exists in the target project, prompts reference it (shorter, always current). If not, prompts are self-contained (full instructions inlined).

**PARTIAL handling:** Full phase prompt with warning: "These sections partially exist - review before running."

**Templates:**

| Phase | Triggers | Content |
|-------|----------|---------|
| 1a (new) | No instruction file at all | Complete workflow setup from scratch |
| 1a (existing) | Instruction file exists but loop/tiers/DoD missing | Gap-specific additions |
| 1b | Skills/playbooks missing | Add preflight, debug, audit, research, code-review |
| 1c | Hooks/scripts missing or enforcement gaps | Add hooks, enforce deny list |
| 2 | Full/Standard tier items missing | Add evals, CI, profiles, docs |
| Getting started | No workflow detected (score 0) | Link to article, explain methodology |

---

## Resolved Decisions

These resolve all contradictions identified during planning review (by Claude and Codex).

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Scoring is percentage-based.** N/A checks reduce the denominator. A library with 70/85 (82%) gets a B. An app with 70/100 (70%) gets a C. | Libraries and collections should not be penalised for checks that don't apply. A perfect library and a perfect app both score 100%. Resolves the contradiction between the brief (N/A reduces denominator) and SBAO ("always out of 100"). |
| D2 | **Default output is `text` for terminal, `json` for piped.** HTML and markdown require explicit `--format`. | Matches UNIX convention. Resolves the contradiction between draft M1 (HTML default) and draft M3 (text/json auto-detect). Text is the right interactive default. |
| D3 | **Workflow files are copied into `dist/workflow/` at build time.** Prompts resolve plan files via `__dirname`. | `npm pack` cannot traverse parent directories (`../workflow/` fails - verified with `npm pack --dry-run`). Resolves the broken publish strategy in the draft milestones. |
| D4 | **All checks are agent-aware.** Detection determines the instruction file, settings, skills, and hooks paths. Checks use these abstractions, not hardcoded `CLAUDE.md`. | Draft hardcoded CLAUDE.md in grep patterns. A Codex-only repo would be detected then unfairly scored against CLAUDE.md patterns. See [RUBRIC.md agent file mapping](./RUBRIC.md#agent-file-mapping). |
| D5 | **Fixture projects with pinned expected scores are created before implementing checks.** Part of M1 Phase A. | "Scores correctly" is unmeasurable without baselines. Fixtures define what correct means and catch scoring bugs immediately. Resolves the "no golden baseline" concern. |
| D6 | **Modular internals** (`src/checks/`, `src/formatters/`, `src/prompts/`), single compiled entry point. | Testable per check. One file per check category. |
| D7 | **Lightweight markdown heading parser** (split by `##`, regex within sections). | Zero-dep constraint. Sufficient for section-level analysis (DoD gate counting, autonomy tier extraction). |
| D8 | **Strict `JSON.parse()`** for settings.json. Malformed = anti-pattern deduction. | If settings.json has comments, it's already broken for Claude Code. The deduction is correct. |
| D9 | **Dual-agent = two independent scores**, not averaged. Shared files (footguns, lessons, architecture) credited to both. | Users care about each agent's setup independently. |
| D10 | **Ask First specificity via length heuristic** (section > 5 lines + at least one project-specific term like a filename or technology). | Template-matching produces false positives on projects that legitimately use the same boundary names as the plan examples. |
| D11 | **Prompts are adaptive.** Plan-referencing if plan file exists in target project, self-contained if not. Batched by phase (one prompt per phase). | Covers both power users (have the plan) and new users (don't have it). Fewer total prompts to paste than per-failure granularity. |
| D12 | **v1 scores the BlunderGOAT workflow system only.** Explicit in README. | The tool is opinionated by design. Pluggable rubrics are a v2 conversation. |

---

## Milestones

No time estimates. Each milestone has a theme, scope, and measurable exit criteria.

### M1 - Prove It Works

**Theme:** Full scoring engine + HTML report. Validated against fixture baselines and real repos.

#### Phase A: Project Setup

- [ ] Init repo structure: `planning/`, `workflow/`, `auditor/`, `docs/`, `roadmaps/`
- [ ] Migrate files from `ai-planning-playbook`: planning prompts → `planning/`, workflow docs → `workflow/`
- [ ] Update cross-references between migrated files
- [ ] Deprecate `ai-planning-playbook`: update README with redirect, archive
- [ ] Update blundergoat.com article links to new repo
- [ ] TypeScript auditor scaffold: `tsconfig.json` (ESM, strict), `package.json` (`@blundergoat/goat-flow`), `bin/goat.js`
- [ ] Agent detection module: `{instruction_file}` path resolution per agent type
- [ ] Shape detection module: app / library / collection heuristics
- [ ] Section parser: split markdown by `##` headings, return `Map<string, string>`
- [ ] Scoring engine: percentage-based calculation, N/A handling, grade assignment
- [ ] **Golden baseline fixtures:**
  - [ ] `tests/fixtures/grade-a/` - full workflow setup, expected: 90–100%
  - [ ] `tests/fixtures/grade-b/` - good setup, missing evals + CI, expected: 75–89%
  - [ ] `tests/fixtures/grade-d/` - basic instruction file, little else, expected: 40–59%
  - [ ] `tests/fixtures/grade-f/` - empty or no workflow, expected: 0–39%
- [ ] CLAUDE.md for the framework repo itself (dogfood from day one)

**Exit criteria:**
- Repo structure in place with migrated files
- `ai-planning-playbook` deprecated with redirect
- Fixtures created with documented expected score ranges
- Agent and shape detection work on 3+ repos
- Scoring engine calculates percentage-based grades correctly

#### Phase B: Scoring Engine

- [ ] Implement all Tier 1 checks (Foundation - 40 pts, 21 sub-checks per [RUBRIC.md](./RUBRIC.md#tier-1--foundation-40-points))
- [ ] Implement all Tier 2 checks (Standard - 35 pts, 25 sub-checks)
- [ ] Implement all Tier 3 checks (Full - 25 pts, 19 sub-checks)
- [ ] Implement all 9 anti-pattern deductions (max -15)
- [ ] Recommendation engine: map FAIL/PARTIAL → priority + message + action reference
- [ ] Dual-agent support: run checks independently per agent, merge shared file checks, report side-by-side
- [ ] Validate: all 4 fixture projects score within expected grade bands
- [ ] Manual validation against all 8 BlunderGOAT repos

**Exit criteria:**
- Full rubric (65 sub-checks + 9 anti-patterns) implemented
- All 4 fixtures score within expected bands
- Known-good repos score B or above
- Zero false positive anti-pattern deductions on known-good setups
- Dual-agent scoring works on projects with both CLAUDE.md and AGENTS.md

#### Phase C: HTML Report

- [ ] HTML template (`src/templates/report.html`):
  - [ ] Score dashboard: grade letter, percentage, tier progress bars
  - [ ] Per-check results: green/amber/red with detail message
  - [ ] Anti-pattern warnings with deduction amounts
  - [ ] Recommendation cards: priority-coded, category, message, action
  - [ ] Dual-agent side-by-side layout
  - [ ] Project metadata: path, shape, agents detected, scan date, rubric version
  - [ ] Inline CSS (BlunderGOAT brand, dark theme, responsive)
  - [ ] Inline JS (collapsible sections, no external deps)
- [ ] Template compiled into JS at build time
- [ ] `--format html` flag
- [ ] CLI argument parsing: `util.parseArgs` for path, `--format`, `--shape`
- [ ] Build pipeline: `tsc` → `dist/`, template embedded, `workflow/` copied to `dist/workflow/`

**Exit criteria:**
- `--format html` produces self-contained HTML report
- Report renders correctly in Chrome, Firefox, Safari
- All 8 repos produce accurate, readable reports

**M1 overall exit criteria:**
- All Phase A + B + C exit criteria met
- HTML report scores match fixture baselines
- Framework repo has its own dogfooded CLAUDE.md

---

### M2 - Make It Prescriptive

**Theme:** Prompt generator + testing foundation.

- [ ] Prompt template system: `src/prompts/templates/` (6 templates per plan phase)
- [ ] Stack detection from filesystem (Node, PHP, Rust, Python, bash)
- [ ] Phase batching: group failures by phase, one prompt per phase
- [ ] Agent targeting: Claude Code vs Codex prompt variants
- [ ] Adaptive plan-file detection: self-contained if plan missing, referencing if present
- [ ] `--prompts` flag → `workflow-fix-prompts.md` or stdout
- [ ] HTML report "Fix It" section with copy-to-clipboard buttons
- [ ] Unit tests for all check modules (`tests/checks/`)
- [ ] Integration tests against 4 fixture projects
- [ ] Regression snapshots from 3-4 BlunderGOAT repos
- [ ] Test runner: vitest (dev dependency only)

**Exit criteria:**
- `--prompts` generates usable prompts for every failure pattern
- Prompts correctly targeted per agent
- Stack detection works for 5 ecosystems
- Unit test coverage for all check modules
- All fixtures score within expected bands in automated tests
- Regression snapshots produce stable scores

---

### M3 - Make It Flexible

**Theme:** Text, JSON, markdown output formats.

- [ ] Text formatter: ANSI colours, score/grade header, tier breakdown, top 5 recommendations
- [ ] JSON formatter: full AuditReport schema, 2-space indent
- [ ] Markdown formatter: tables, check results, recommendations with priority badges
- [ ] `--format` flag: text / json / markdown / html
- [ ] Auto-detect: `text` for terminal, `json` for piped
- [ ] `--output` flag for file writing
- [ ] Graceful colour degradation when ANSI not supported

**Exit criteria:**
- All 4 formats produce correct, readable output for the same project
- `--format json | jq .score` works
- Markdown renders correctly in GitHub preview
- Auto-detection works (terminal vs pipe)
- Text output readable without colour support

---

### M4 - Make It Public

**Theme:** Open source preparation + npm publish.

- [ ] Top-level README: framework overview, three-section navigation, quick start
- [ ] Auditor README: usage, rubric overview, CLI reference, HTML report screenshot
- [ ] CONTRIBUTING.md: how to add checks, run tests, update rubric
- [ ] LICENSE (MIT)
- [ ] package.json metadata: description, keywords, repository, homepage, engines `>=18.3.0`
- [ ] Build step includes `cp -r ../workflow dist/workflow`
- [ ] `npm publish --dry-run` - verify package contents include `dist/` with `workflow/`
- [ ] `npm publish` - first public release
- [ ] Verify `npx @blundergoat/goat-flow .` on fresh machine

**Exit criteria:**
- Package published on npm and installable
- `npx` works on macOS, Linux, Windows (WSL)
- README is comprehensive with screenshot
- `dist/workflow/` included in published package

---

### M5 - Make It Robust

**Theme:** CI mode + edge cases + hardening.

- [ ] `--min-score N` and `--min-grade X` with exit codes
- [ ] Edge case testing: empty project, 0-line files, 500+ line files, malformed JSON, binary files, symlinks, Windows paths, deep directories, permission denied, non-UTF8
- [ ] Performance: confirm <3 seconds on largest repo
- [ ] Error handling: graceful failures for unreadable files, clear messages, `--help`, `--version`
- [ ] CI workflow for the auditor itself (`npm test` on PR)

**Exit criteria:**
- `--min-score 75` exits 1 on D-grade project, exits 0 on B-grade project
- No crashes on any edge case input
- Execution under 3 seconds on all tested projects
- `--help` and `--version` work
- Auditor's own CI passes

---

### M6 - Make It Known

**Theme:** Promotion + distribution.

- [ ] awesome-claude-code PR
- [ ] blundergoat.com blog article (HTML report screenshots, before/after, `npx` one-liner)
- [ ] blundergoat.com /projects/ page entry
- [ ] First-week monitoring: GitHub issues, npm stats, feedback

**Exit criteria:**
- awesome-claude-code PR submitted
- Blog article published
- Project page live

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Regex patterns produce false positives on diverse instruction file styles | Score trust erosion | Conservative patterns. Test against 8+ real repos. Log unexpected matches |
| HTML template embedding adds build complexity | Build friction | Fallback: read template from filesystem at runtime |
| Plan v1.6 drops before auditor ships | Rubric drift | Version-lock to v1.5. Update as separate post-ship task |
| Adoption is near-zero | None - personally useful first | Design for dogfooding. Open source adoption is bonus |
| Repo consolidation breaks existing links | Broken references | Update articles in M1 Phase A. Deprecate old repo with redirect |

## Assumptions

| # | Assumption | Validated by |
|---|-----------|-------------|
| A1 | 65 regex checks run in <3 seconds | M5 performance test |
| A2 | Heading splitter (`##`) is sufficient for section analysis | M1 Phase B |
| A3 | Known-good repos score B or above | M1 Phase B fixture validation |
| A4 | Length heuristic for Ask First specificity avoids false positives | M1 Phase B against 8 repos |
| A5 | Stack detection covers Node, PHP, Rust, Python, bash | M2 testing |
| A6 | HTML template embeds at build time without bundler | M1 Phase C |
| A7 | `util.parseArgs` handles all CLI flags | M1 Phase C |
| A8 | Build-time copy of `workflow/` to `dist/workflow/` resolves npm pack | M4 dry-run |
