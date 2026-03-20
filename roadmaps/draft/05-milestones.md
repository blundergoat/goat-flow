# Milestone Plan - @blundergoat/ai-workflow-goat

**Repo:** `blundergoat/ai-workflow-framework` (consolidated: planning methodology + workflow system + auditor CLI)
**npm package:** `@blundergoat/ai-workflow-goat` (publishes from `auditor/`)
**Source:** SBAO Prime Plan (Plan A synthesis)
**Rubric version:** ai-workflow-improvement-plan-prime v1.5
**Total estimate:** 8-10 weekends

---

## Repo Structure

```
ai-workflow-framework/
  planning/                            ← planning methodology (from ai-planning-playbook)
    01-feature-brief-template.md
    02-mob-elaboration-prompt.md
    03-sbao-ranking-prompt.md
    04-milestone-planning-prompt.md
    05-code-map-prompt.md
    06-architecture-diagram-prompt.md
    07-instruction-files-prompt.md
    08-router-file-prompt.md
    09-footguns-prompt.md
  workflow/                            ← the AI workflow system
    ai-workflow-improvement-plan-prime.md
    ai-workflow-implement-prompts-prime.md
    ai-workflow-codex-implement-prompt.md
    ai-workflow-ARTICLE-prime.md
    ai-workflow-cross-agent-section.md
    ai-workflow-design-rationale-prime.md
    ai-workflow-human-instructions.md
  auditor/                             ← the TypeScript CLI (@blundergoat/ai-workflow-goat)
    src/
    bin/
    tests/
    package.json
    tsconfig.json
  docs/                                ← project docs (architecture, rubric spec, etc.)
  README.md                            ← framework overview + links to all three areas
  CLAUDE.md                            ← AI workflow setup for this repo (dogfooded)
```

---

## M1 - Prove It Works (2-3 weekends)

**Theme:** Full scoring engine + HTML report. Validated against real repos. Dogfooded from day one.

### Weekend 1: Scaffolding + Foundation Checks

**Tasks:**

- [ ] Init repo `blundergoat/ai-workflow-framework`
- [ ] Top-level structure: `planning/`, `workflow/`, `auditor/`, `docs/`, `README.md`, `CLAUDE.md`
- [ ] Migrate files from `ai-planning-playbook`:
  - [ ] Planning prompts (01-09) → `planning/`
  - [ ] Workflow system files → `workflow/`
  - [ ] Update internal cross-references between files (relative links)
- [ ] Deprecate `ai-planning-playbook` repo: update README to point to `ai-workflow-framework`, archive
- [ ] Update blundergoat.com articles to link to new repo
- [ ] TypeScript auditor setup in `auditor/`: `tsconfig.json` (ESM, strict), `package.json` with `@blundergoat/ai-workflow-goat` scope, `bin/goat.js` entry point
- [ ] Auditor project structure:
  ```
  auditor/
    src/
      scanner.ts          - orchestrator: detect agent, detect shape, run checks, score
      types.ts            - CheckResult, TierScore, AuditReport, Recommendation interfaces
      checks/
        instruction-file.ts   - 1.1 (exists, line count, version header, commands)
        execution-loop.ts     - 1.2 (READ, CLASSIFY, ACT, VERIFY, LOG)
        autonomy-tiers.ts     - 1.3 (three tiers, specificity heuristic, guards, micro-checklist)
        definition-of-done.ts - 1.4 (section exists, gate count, grep gate, log gate)
        enforcement.ts        - 1.5 (settings.json, deny list, git blocks, deny-dangerous)
      detection/
        agent.ts              - CLAUDE.md / AGENTS.md / both / neither
        shape.ts              - app / library / collection heuristic
      utils/
        file-reader.ts        - read file, check exists, count lines
        section-parser.ts     - split markdown by ## headings, extract section content
        scoring.ts            - points calculation, grade assignment
    bin/
      goat.js               - CLI entry point
    tests/
    package.json
    tsconfig.json
  ```
- [ ] Agent detection: check target project root for CLAUDE.md, AGENTS.md, classify as claude_code / codex / dual / none
- [ ] Shape detection: filesystem heuristics (src-tauri, docker-compose, composer.json type, lib/*.sh, etc.)
- [ ] Lightweight section parser: split markdown file by `##` headings, return `Map<string, string>`
- [ ] Implement Tier 1 checks (1.1–1.5, 40 points):
  - [ ] 1.1 Instruction file (4 sub-checks, 8 pts)
  - [ ] 1.2 Execution loop (5 sub-checks, 10 pts)
  - [ ] 1.3 Autonomy tiers (4 sub-checks, 8 pts) - including length heuristic for specificity
  - [ ] 1.4 Definition of Done (4 sub-checks, 6 pts)
  - [ ] 1.5 Enforcement baseline (4 sub-checks, 8 pts)
- [ ] Scoring engine: sum points per tier, calculate grade, assemble AuditReport object
- [ ] Basic terminal output: score, grade, tier breakdown (console.log, no formatting yet)
- [ ] CLAUDE.md for the framework repo itself (dogfood - own AI workflow setup)
- [ ] Manual test: run against 2-3 BlunderGOAT repos, verify Foundation tier scores make sense

**Exit criteria:**
- [ ] Repo structure in place with all migrated files
- [ ] `ai-planning-playbook` deprecated with redirect
- [ ] `npx ts-node auditor/src/scanner.ts /path/to/project` outputs Foundation tier score
- [ ] Agent and shape detection work on 3+ repos
- [ ] All 21 Tier 1 sub-checks produce correct results on known-good setups

### Weekend 2: Standard + Full Checks + Anti-Patterns

**Tasks:**

- [ ] Implement Tier 2 checks (2.1–2.6, 35 points):
  - [ ] 2.1 Skills/playbooks (5 sub-checks, 8 pts) - Claude Code paths + Codex paths
  - [ ] 2.2 Hooks/verification scripts (6 sub-checks, 7 pts) - settings.json parse, stop hook exit analysis
  - [ ] 2.3 Learning loop files (5 sub-checks, 7 pts) - footgun evidence detection (file:line regex)
  - [ ] 2.4 Router table (3 sub-checks, 5 pts) - extract references, resolve each to filesystem
  - [ ] 2.5 Architecture docs (3 sub-checks, 4 pts)
  - [ ] 2.6 Local context (3 sub-checks, 4 pts) - find local CLAUDE.md files, check sizes, detect duplication
- [ ] Implement Tier 3 checks (3.1–3.5, 25 points):
  - [ ] 3.1 Agent evals (5 sub-checks, 8 pts)
  - [ ] 3.2 CI validation (4 sub-checks, 5 pts)
  - [ ] 3.3 Permission profiles (3 sub-checks, 4 pts)
  - [ ] 3.4 Guidelines ownership (4 sub-checks, 5 pts) - cross-file overlap detection
  - [ ] 3.5 Hygiene (3 sub-checks, 3 pts)
- [ ] Anti-pattern deductions (all 9, max -15):
  - [ ] CLAUDE.md over 150 lines (-5)
  - [ ] Skill name conflicts with built-in (-3)
  - [ ] DoD in both instruction file and guidelines (-3)
  - [ ] Footguns without evidence (-3)
  - [ ] settings.json invalid JSON (-3)
  - [ ] Stop hook exits non-zero (-2)
  - [ ] Local CLAUDE.md over 20 lines (-2)
  - [ ] Generic Ask First boundaries (-2)
  - [ ] settings.local.json committed (-2) - requires `git ls-files` check
- [ ] Recommendation engine: map each FAIL/PARTIAL to priority (Critical/High/Medium/Low) + message + action reference
- [ ] Dual-agent support: when both detected, run full check suite independently per agent, merge shared file checks (footguns, lessons, architecture), report side by side
- [ ] Manual validation against all 8 BlunderGOAT repos

**Exit criteria:**
- [ ] Full 100-point rubric scored correctly across 8 repos
- [ ] Anti-pattern deductions produce zero false positives on known-good setups
- [ ] Dual-agent scoring works on any repo with both CLAUDE.md and AGENTS.md
- [ ] Recommendations are generated for every FAIL and PARTIAL

### Weekend 3: HTML Report + CLI Polish

**Tasks:**

- [ ] HTML report template (`auditor/src/templates/report.html`):
  - [ ] Project metadata header: project path, shape, agents detected, scan date, rubric version
  - [ ] Score dashboard: large grade letter, score/100, tier breakdown with progress bars
  - [ ] Tier sections: collapsible, each showing per-check results (green ✓ / amber ◐ / red ✗)
  - [ ] Check detail: name, status, points earned/available, detail message
  - [ ] Anti-pattern section: warning badges with explanations and deduction amounts
  - [ ] Recommendation cards: priority-coded (Critical=red, High=orange, Medium=yellow, Low=blue), category, message, action
  - [ ] Dual-agent layout: side-by-side columns when both agents detected, shared files section between columns
  - [ ] Footer: rubric version, auditor version, link to ai-planning-playbook
  - [ ] Inline CSS: BlunderGOAT brand styling, dark theme default, responsive
  - [ ] Inline JS: collapsible sections, no external dependencies
- [ ] Template compilation: read .html at build time, embed as string in output JS
- [ ] `--format html` flag: writes `workflow-audit.html` to current directory (not project directory - read-only principle for the target)
- [ ] CLI argument parsing: `util.parseArgs` for path, --format, --shape
- [ ] Default behaviour: `npx @blundergoat/ai-workflow-goat .` runs with HTML output
- [ ] Build pipeline: `tsc` → compiled JS in `dist/`, HTML template embedded
- [ ] Test: generate reports for 3-4 repos, open in browser, verify rendering

**Exit criteria:**
- [ ] `npx @blundergoat/ai-workflow-goat /path/to/project` produces `workflow-audit.html`
- [ ] HTML report renders correctly in Chrome, Firefox, Safari
- [ ] All 8 BlunderGOAT repos produce accurate, readable reports
- [ ] Dual-agent report shows side-by-side layout
- [ ] Zero false positive anti-pattern deductions

**M1 overall exit criteria:**
- [ ] Consolidated repo structure in place: `planning/`, `workflow/`, `auditor/`, `docs/`
- [ ] All files migrated from `ai-planning-playbook`, cross-references updated
- [ ] `ai-planning-playbook` deprecated with redirect
- [ ] Full 50+ check rubric implemented and scoring correctly
- [ ] HTML report is the primary output, visually clear and accurate
- [ ] Agent detection, shape detection, dual-agent all working
- [ ] Anti-pattern deductions working with zero false positives on known-good setups
- [ ] Framework repo has its own CLAUDE.md (dogfooded)
- [ ] Manual validation against all 8+ BlunderGOAT repos - known-good setups score B or above

---

## M2 - Make It Prescriptive (1-2 weekends)

**Theme:** Prompt generator + testing foundation. The auditor doesn't just diagnose - it prescribes.

### Tasks

**Prompt Generator:**

- [ ] Prompt template system:
  ```
  auditor/src/prompts/
    templates/
      phase-1a-new.ts       - missing execution loop, autonomy, DoD (no existing CLAUDE.md)
      phase-1a-existing.ts  - gaps in existing CLAUDE.md (partial failures)
      phase-1b-skills.ts    - missing skills
      phase-1c-hooks.ts     - missing hooks, enforcement gaps
      phase-2.ts            - missing evals, CI, profiles, RFC 2119
      getting-started.ts    - no AI workflow detected at all
    generator.ts            - maps failures to templates, batches by phase
    stack-detector.ts       - detect languages/build/test/lint/format from filesystem
  ```
- [ ] Prompts reference workflow files from `workflow/` directory (same repo - no bundling needed, prompts can say "Read workflow/ai-workflow-improvement-plan-prime.md")
- [ ] Stack detection from filesystem:
  - [ ] package.json → Node/TypeScript, extract scripts (test, lint, build, format)
  - [ ] composer.json → PHP, extract scripts
  - [ ] Cargo.toml → Rust
  - [ ] pyproject.toml / setup.py → Python
  - [ ] Presence of .sh files + no build system → bash/shell
  - [ ] Fallback: list detected languages, leave commands as `[your command]`
- [ ] Phase batching: group all failures by which plan phase fixes them, generate one prompt per phase
- [ ] Agent targeting:
  - [ ] Claude Code prompts: reference CLAUDE.md, .claude/skills/, .claude/hooks/, .claude/settings.json
  - [ ] Codex prompts: reference AGENTS.md, docs/codex-playbooks/, scripts/
  - [ ] Auto-select based on detected agent, overridable with `--agent`
- [ ] PARTIAL handling: full phase prompt with warning "These sections partially exist - review what's already there before running"
- [ ] Prompt includes: detected stack pre-filled, detected shape, specific gaps, agent-appropriate file references
- [ ] `--prompts` flag: generates `workflow-fix-prompts.md` with fenced code blocks per phase
- [ ] HTML report integration: "Fix It" section with prompt cards, copy-to-clipboard button (inline JS)

**Testing:**

- [ ] Unit tests for check functions:
  - [ ] Each check module gets a test file (`auditor/tests/checks/`)
  - [ ] Test with mock file contents: known-good, known-bad, edge cases
  - [ ] Test section parser: heading splits, nested headings, empty sections
  - [ ] Test scoring engine: point calculation, grade boundaries, deduction caps
- [ ] Integration test fixtures:
  - [ ] `auditor/tests/fixtures/grade-a/` - full workflow setup, should score 90+
  - [ ] `auditor/tests/fixtures/grade-b/` - good setup, missing evals and CI, should score 75-89
  - [ ] `auditor/tests/fixtures/grade-d/` - CLAUDE.md exists with basic content, little else, should score 40-59
  - [ ] `auditor/tests/fixtures/grade-f/` - empty project or CLAUDE.md with no workflow structure, should score 0-39
- [ ] Regression snapshots: copy current CLAUDE.md + supporting files from 3-4 BlunderGOAT repos into `auditor/tests/snapshots/`
- [ ] Test runner: vitest (dev dependency only - doesn't affect zero runtime deps)

**Exit criteria:**
- [ ] `--prompts` generates usable prompts for every failure pattern
- [ ] Prompts are correctly targeted per agent (Claude Code vs Codex)
- [ ] Stack detection works for PHP, TypeScript, Rust, Python, bash projects
- [ ] HTML report "Fix It" section renders with copy buttons
- [ ] Unit test coverage for all check modules
- [ ] All 4 fixture projects score within expected grade band
- [ ] Regression snapshots produce stable scores

---

## M3 - Make It Flexible (1 weekend)

**Theme:** Text, JSON, markdown output formats. The auditor speaks every format.

### Tasks

- [ ] Text formatter (`auditor/src/formatters/text.ts`):
  - [ ] Coloured terminal output (ANSI codes, no deps)
  - [ ] Score/grade header with colour (A=green, B=blue, C=yellow, D=orange, F=red)
  - [ ] Tier breakdown: earned/available per tier
  - [ ] Top 5 recommendations by priority
  - [ ] Anti-pattern warnings if any triggered
  - [ ] Footer: rubric version, project path
- [ ] JSON formatter (`auditor/src/formatters/json.ts`):
  - [ ] Full AuditReport object serialised
  - [ ] Matches the JSON schema from the checklist doc
  - [ ] Pretty-printed with 2-space indent
- [ ] Markdown formatter (`auditor/src/formatters/markdown.ts`):
  - [ ] `workflow-score.md` structure
  - [ ] Score summary table
  - [ ] Per-tier tables with check results
  - [ ] Anti-pattern section
  - [ ] Recommendation list with priority badges
  - [ ] Renders cleanly in GitHub, Obsidian, VS Code
- [ ] `--format` flag: `text`, `json`, `markdown`, `html` (already exists)
- [ ] Default auto-detection: `text` when stdout is a terminal, `json` when piped
- [ ] `--output` flag for markdown and HTML: specify output file path (default: stdout for text/json, file for html/markdown)

**Exit criteria:**
- [ ] All 4 formats produce correct, readable output for the same project
- [ ] `npx @blundergoat/ai-workflow-goat . --format json | jq .score` works
- [ ] Markdown renders correctly in GitHub preview
- [ ] Auto-detection works (terminal vs pipe)
- [ ] Text output is readable without colour support (graceful degradation)

---

## M4 - Make It Public (1 weekend)

**Theme:** Open source preparation. README, docs, metadata, first publish. The repo is already public (it holds the planning and workflow docs that articles link to) - this milestone is about the auditor being ready for public use.

### Tasks

- [ ] Top-level README.md (framework overview):
  - [ ] One-line description of the whole framework: planning methodology + workflow system + auditor
  - [ ] Three-section navigation: Planning (planning/), Workflow System (workflow/), Auditor (auditor/)
  - [ ] Quick start for each section
  - [ ] Link to the "Stop Writing Rules" article
  - [ ] "What this is" / "What this isn't" section
  - [ ] Similar projects table (brief, linking to the full competitive analysis in docs/)
  - [ ] License
- [ ] Auditor README (auditor/README.md):
  - [ ] One-line description + what it does
  - [ ] Quick start: `npx @blundergoat/ai-workflow-goat .`
  - [ ] Screenshot of HTML report
  - [ ] Scoring rubric overview (tiers, grades, what each tier covers)
  - [ ] CLI reference (all flags and options)
  - [ ] "What this scores" section - explicit that it's the BlunderGOAT workflow methodology
  - [ ] "What this doesn't do" section
- [ ] CONTRIBUTING.md: how to add checks, how to run tests, how to update rubric
- [ ] LICENSE: MIT (top-level, covers everything)
- [ ] CLAUDE.md: review and polish (already exists from M1)
- [ ] auditor/package.json metadata:
  - [ ] `description`, `keywords`, `repository`, `homepage`, `bugs`
  - [ ] `bin` field pointing to compiled entry point
  - [ ] `files` field: ship dist/ and workflow/ (prompt generator references plan files)
  - [ ] `engines`: `"node": ">=18.3.0"`
- [ ] .npmignore or package.json `files`: exclude tests, fixtures, snapshots, src/, planning/
- [ ] `npm publish --dry-run` from `auditor/` - verify package contents
- [ ] `npm publish` from `auditor/` - first public release
- [ ] Verify: `npx @blundergoat/ai-workflow-goat .` works from a fresh machine with no prior install
- [ ] Deprecate `ai-planning-playbook` if not already done: archive repo, README redirect to `ai-workflow-framework`

**Exit criteria:**
- [ ] Package published on npm and installable
- [ ] `npx @blundergoat/ai-workflow-goat .` works on macOS, Linux, and Windows (WSL)
- [ ] README is comprehensive and includes screenshot
- [ ] Repo is public with appropriate metadata

---

## M5 - Make It Robust (1 weekend)

**Theme:** CI mode, edge cases, hardening.

### Tasks

- [ ] CI mode:
  - [ ] `--min-score N` flag: exit code 0 if score >= N, exit code 1 if below
  - [ ] `--min-grade X` alias: convert grade to score threshold (A=90, B=75, C=60, D=40)
  - [ ] CI-friendly output: one-line summary + exit code (combines with `--format text`)
  - [ ] Example GitHub Actions workflow in README
- [ ] Edge case testing:
  - [ ] Empty project (no files at all)
  - [ ] CLAUDE.md with 0 lines
  - [ ] CLAUDE.md with 500+ lines
  - [ ] Malformed settings.json (syntax errors, missing fields)
  - [ ] Binary files where text expected
  - [ ] Symlinks
  - [ ] Windows path separators (backslash handling)
  - [ ] Very deep directory structures
  - [ ] Permission denied on files
  - [ ] Non-UTF8 file contents
- [ ] Performance validation:
  - [ ] Time execution against largest BlunderGOAT repo
  - [ ] Confirm <3 seconds
  - [ ] Profile if slow - likely culprit is router table reference resolution or local CLAUDE.md scanning
- [ ] Error handling:
  - [ ] Graceful failure for unreadable files (warn, don't crash)
  - [ ] Clear error message for missing project path argument
  - [ ] Clear error message for non-existent directory
  - [ ] `--help` flag with usage information
  - [ ] `--version` flag
- [ ] Expanded test coverage:
  - [ ] Edge case fixtures added to test suite
  - [ ] CI workflow for the auditor itself: `npm test` on PR

**Exit criteria:**
- [ ] `--min-score 75` exits 1 on a D-grade project, exits 0 on a B-grade project
- [ ] No crashes on any edge case input
- [ ] Execution under 3 seconds on all tested projects
- [ ] `--help` and `--version` work
- [ ] Auditor's own CI passes

---

## M6 - Make It Known (1 weekend)

**Theme:** Promotion and distribution.

### Tasks

- [ ] awesome-claude-code PR:
  - [ ] Write entry matching the repo's format
  - [ ] Position in the appropriate category (audit/config tools)
  - [ ] Submit PR
- [ ] blundergoat.com blog article:
  - [ ] "I Built a Tool That Scores Your AI Workflow Setup" (working title)
  - [ ] Include HTML report screenshots
  - [ ] Show before/after: project with gaps → run auditor → run generated prompts → re-audit with improved score
  - [ ] Link to the "Stop Writing Rules" article as context
  - [ ] Explain the consolidated framework: planning + workflow system + auditor
  - [ ] Explain the scoring rubric at a high level
  - [ ] Include `npx` one-liner prominently
- [ ] blundergoat.com /projects/ page:
  - [ ] Add ai-workflow-framework to the projects listing (replaces ai-planning-playbook entry if it existed)
  - [ ] Description, screenshot, link to repo and npm
- [ ] Social distribution:
  - [ ] Share article
  - [ ] Post in relevant communities (if applicable)
- [ ] Monitor:
  - [ ] Watch GitHub issues for first week
  - [ ] Check npm download stats
  - [ ] Respond to any feedback

**Exit criteria:**
- [ ] awesome-claude-code PR submitted (merged is out of your control)
- [ ] Blog article published on blundergoat.com
- [ ] Project page live on blundergoat.com/projects/
- [ ] Tool discoverable via npm search and GitHub

---

## Assumptions Tracked

| # | Assumption | Validated by |
|---|-----------|-------------|
| A1 | 50+ regex checks can run in under 3 seconds | M5 performance test |
| A2 | Section parser (split by ##) is sufficient for content analysis | M1 Weekend 1 - if not, upgrade to more sophisticated parser |
| A3 | Known-good repos score B or above | M1 Weekend 2 manual validation |
| A4 | Length heuristic for Ask First specificity avoids false positives | M1 Weekend 2 manual validation against 8 repos |
| A5 | Stack detection covers the 5 main ecosystems (Node, PHP, Rust, Python, bash) | M2 testing |
| A6 | HTML template can be embedded at build time without a bundler | M1 Weekend 3 build pipeline |
| A7 | `util.parseArgs` handles all needed CLI flags | M1 Weekend 3 CLI polish |
| A8 | vitest as dev-only dependency doesn't affect zero runtime deps claim | M2 testing setup |
| A9 | npm publish from `auditor/` subdirectory works cleanly (package.json `files` includes `../workflow/`) | M4 dry-run |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation | Milestone |
|------|-----------|--------|-----------|-----------|
| M1 takes 4 weekends instead of 3 | Medium | Schedule slip | Cut HTML report polish to M3, ship with basic styling | M1 |
| Regex checks produce false positives on unforeseen CLAUDE.md styles | Medium | Score trust erosion | Conservative patterns, test against diverse real repos, log unexpected patterns | M1-M2 |
| Template embedding at build time adds complexity | Low | Build friction | Fallback: read template from filesystem at runtime (slightly slower, simpler build) | M1 |
| Plan v1.6 drops before auditor ships | Low | Rubric drift | Version-lock rubric, update as separate task post-ship | Any |
| npm publish from monorepo subdirectory has path issues | Medium | Distribution blocked | Dry-run in M4. The `files` field in package.json needs to include `../workflow/` for prompt generator. Test that npm pack resolves correctly. Fallback: copy workflow files into auditor/dist/ at build time | M4 |
| Nobody besides Matt uses it | Expected | None - personally useful first | Design for dogfooding. Open source adoption is a bonus | M6 |
| Consolidation breaks existing links to ai-planning-playbook | Medium | Broken links in articles, other repos | Update articles in M1 Weekend 1. Deprecate old repo with clear redirect. Search for references across BlunderGOAT repos | M1 |
