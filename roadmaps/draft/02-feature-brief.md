# Feature Brief — @blundergoat/ai-workflow-goat

**Author:** Matt Hansen
**Date:** 2026-03-19
**Status:** Draft

---

## What

A standalone CLI tool published on npm that audits the quality of AI coding agent workflow configurations in any project. It reads the filesystem (CLAUDE.md, AGENTS.md, .claude/settings.json, hooks, skills, playbooks, docs), scores the setup against a structured rubric derived from the AI Workflow Improvement Plan (v1.5), and produces a scored report with prioritised recommendations for improvement.

Run it with `npx @blundergoat/ai-workflow-goat .` — no install required.

## Why

The AI workflow system (READ → CLASSIFY → ACT → VERIFY → LOG) exists as a plan and a set of implementation prompts in the [ai-planning-playbook](https://github.com/blundergoat/ai-planning-playbook) repo. But after running those prompts, there's no way to verify the output is correct, complete, or hasn't drifted over time. You can't answer "how good is my setup?" without manually checking 50+ things across a dozen files.

Existing tools check for Claude Code *feature adoption* — "do you have hooks?" — not *workflow design quality* — "does your execution loop have all five steps? Are your Ask First boundaries project-specific? Do your footguns have file:line evidence?"

Nobody scores AGENTS.md setups. Nobody handles dual-agent projects. Nobody ties recommendations back to specific implementation prompts. Nobody runs standalone without an active agent session or API key.

## Who

**Primary user:** Matt (dogfooding — run after every AI workflow implementation across 8+ BlunderGOAT repos to verify completeness and detect drift).

**Secondary users:** Developers who've read the "Stop Writing Rules. Build a Workflow." article or cloned the ai-planning-playbook repo and want to verify their implementation. Open source contributors who want to check a project's AI workflow maturity before contributing.

## User Stories

1. As a developer who just ran the implementation prompts, I want to verify nothing was dropped or misconfigured, so I don't discover gaps during a real coding session.

2. As a developer maintaining a project over months, I want to detect drift — CLAUDE.md grew past the line target, router references broke, footguns went stale — before it degrades agent performance.

3. As a developer evaluating a new project, I want a quick read on how well its AI workflow is set up, so I know what I'm working with.

4. As a developer who hasn't implemented the workflow system yet, I want to see what's missing and get pointed to the exact prompts that fix each gap.

5. As a developer who just ran the auditor and sees failures, I want copy-paste-ready prompts I can drop straight into Claude Code or Codex to fix each gap, so I don't have to find the right section of the plan myself.

6. As a team lead reviewing a PR, I want an HTML report I can attach to the PR showing the project's workflow score, so the team can see where we stand.

---

## Technical Details

### Tech Stack

- **Language:** TypeScript (compiled to JavaScript, runs on Node.js 18+)
- **Runtime dependencies:** Zero. stdlib only (`fs`, `path`, `readline`, `util.parseArgs`)
- **Distribution:** npm package (`@blundergoat/ai-workflow-goat`), runnable via `npx`
- **Build:** `tsc` compiling to ESM. Single entry point `bin/goat.js`

### CLI Interface

```bash
# Run against current directory
npx @blundergoat/ai-workflow-goat .

# Run against a specific project
npx @blundergoat/ai-workflow-goat /path/to/project

# Output formats
npx @blundergoat/ai-workflow-goat . --format text      # default: coloured terminal
npx @blundergoat/ai-workflow-goat . --format json       # structured JSON to stdout
npx @blundergoat/ai-workflow-goat . --format markdown   # workflow-score.md report
npx @blundergoat/ai-workflow-goat . --format html       # self-contained HTML report

# Generate fix-it prompts for Claude Code or Codex
npx @blundergoat/ai-workflow-goat . --prompts           # generate prompts for all failures
npx @blundergoat/ai-workflow-goat . --prompts --agent codex  # Codex-specific prompts

# Override auto-detected project shape
npx @blundergoat/ai-workflow-goat . --shape library

# CI mode: exit code 1 if below threshold
npx @blundergoat/ai-workflow-goat . --min-score 60
```

### Agent Detection

First check before scoring. Determines which files to scan and which rubric columns to apply.

| Detection | Signal | Result |
|-----------|--------|--------|
| Claude Code | `CLAUDE.md` at project root | Score Claude Code checks |
| Codex | `AGENTS.md` at project root | Score Codex checks |
| Dual agent | Both files present | Score both independently, report side by side |
| Neither | No instruction file | Score 0, report "No AI workflow detected" with getting-started recommendation |

### Project Shape Detection

Heuristic-based, overridable with `--shape`. Affects line targets, optional checks, and which items are scored vs N/A.

| Signal | Detected Shape |
|--------|---------------|
| `src-tauri/`, `docker-compose.yml`, multiple language dirs, Dockerfile | App |
| `composer.json` with `"type": "library"`, single `src/`, `setup.py` with no app entry | Library |
| `lib/` with subdirectories of `.sh` files, no build system, no `src/` | Script Collection |
| Fallback when ambiguous | App (strictest defaults) |

### Scoring Model

**Max score: 100 points.** Three tiers weighted by impact on actual workflow quality.

| Tier | Points | What It Covers |
|------|--------|----------------|
| Foundation (Minimal) | 40 | Instruction file, execution loop, autonomy tiers, DoD, enforcement baseline |
| Standard | 35 | Skills/playbooks, hooks/verification scripts, learning loop, router table, architecture docs, local context |
| Full | 25 | Agent evals, CI validation, permission profiles, guidelines ownership, hygiene |

Each check: PASS (full points), PARTIAL (half points), or FAIL (0).
Anti-pattern deductions subtract from total (capped at -15, can't go below 0).

**Letter grades:**
- 90–100: A — Production-grade workflow
- 75–89: B — Solid, minor gaps
- 60–74: C — Functional but missing enforcement or learning loop
- 40–59: D — Basics present, significant gaps
- 0–39: F — No meaningful workflow system

### Check Categories (50+ individual checks)

**Tier 1 — Foundation (40 pts):**
- 1.1 Instruction file exists and sized correctly (8 pts) — file exists, under line target, version header, essential commands section
- 1.2 Execution loop present (10 pts) — READ step, CLASSIFY step, ACT step, VERIFY step, LOG step with appropriate patterns
- 1.3 Autonomy tiers (8 pts) — three tiers present, project-specific Ask First boundaries (not generic template), Never tier with destructive guards, micro-checklist
- 1.4 Definition of Done (6 pts) — DoD section exists, 4+ explicit gates, grep-after-rename gate, log-update gate
- 1.5 Enforcement baseline (8 pts) — permissions deny list in settings.json, git commit blocked, git push blocked, deny-dangerous hook/script exists

**Tier 2 — Standard (35 pts):**
- 2.1 Skills/playbooks (8 pts) — preflight, debug-investigate, audit, research (optional for single-domain libs), code-review (optional, not named "review")
- 2.2 Hooks or verification scripts (7 pts) — settings.json valid, stop hook registered and exits 0, PostToolUse hook or documented skip, preflight script, context validation
- 2.3 Learning loop files (7 pts) — lessons.md exists with format header, footguns.md exists with file:line evidence, confusion-log.md for apps
- 2.4 Router table (5 pts) — section exists, references resolve to real files, skills referenced
- 2.5 Architecture & domain docs (4 pts) — architecture.md exists and under 100 lines, domain-reference.md if migration path
- 2.6 Local context (4 pts) — local CLAUDE.md files where warranted, under 20 lines, no duplicated project-wide rules

**Tier 3 — Full (25 pts):**
- 3.1 Agent evals (8 pts) — directory exists, README, 3+ eval files, replay prompts, real incident references
- 3.2 CI validation (5 pts) — workflow exists, checks line count, checks router references, checks skill completeness
- 3.3 Permission profiles (4 pts, apps only) — directory exists, 2+ profiles, referenced in router
- 3.4 Guidelines ownership (5 pts) — no DoD overlap, no execution loop overlap, guidelines-ownership-split.md exists
- 3.5 Hygiene (3 pts) — handoff template exists, RFC 2119 language present, version/changelog in instruction file

**Anti-Pattern Deductions (max -15):**
- CLAUDE.md over 150 lines (-5)
- `/review` skill shadows built-in (-3)
- DoD in both instruction file and guidelines (-3)
- Footguns without file:line evidence (-3)
- settings.json invalid JSON (-3)
- Stop hook exits non-zero on error (-2)
- Local CLAUDE.md over 20 lines (-2)
- Generic Ask First boundaries (matches template verbatim) (-2)
- settings.local.json committed to git (-2)

### Recommendation Engine

Each FAIL or PARTIAL generates a recommendation with:
- **Priority:** Critical / High / Medium / Low
- **Category:** which tier and check category
- **Message:** what's wrong and how to fix it
- **Action:** specific prompt, phase, or section from the plan that addresses the gap

Example recommendations:
> **Critical:** No execution loop detected in CLAUDE.md. Run Phase 1a (Prompt A) from `ai-workflow-implement-prompts-prime.md` to generate the foundation.

> **High:** Footguns file has no file:line evidence — entries may be fabricated. Re-run the footgun seeding step or manually verify each entry against the codebase.

> **Medium:** No agent evals found. Run Phase 2 to create regression tests from git history: `git log --oneline --all | grep -iE 'fix|revert|bug|broke|regression'`

> **Low:** CLAUDE.md has no version header. Add `## v1.0 — YYYY-MM-DD` and a brief changelog.

### Output Formats

**Text (default when stdout is a terminal):**
Coloured terminal summary. Score, grade, tier breakdown, top 5 recommendations. Quick glance format.

**JSON (default when piped):**
Full structured output including every individual check, anti-pattern evaluation, and recommendation. For CI integration, DevGoat consumption, or any downstream tooling.

**Markdown:**
`workflow-score.md` formatted report. Renders in GitHub, Obsidian, VS Code preview. Contains score summary, tier breakdowns with individual check results, anti-pattern findings, and prioritised recommendation list. Readable raw in terminal via `cat`.

**HTML:**
Self-contained single-file HTML report with inline CSS and JS. No external dependencies, no server needed — open directly in a browser. Visual score dashboard with tier progress bars, colour-coded check results (green/amber/red), expandable recommendation cards, and anti-pattern warnings. Styled to match the BlunderGOAT brand. Shareable — drop it in a PR comment, attach to an issue, or host on a static site. Think Lighthouse report but for AI workflow quality.

### Prompt Generator

The killer feature that closes the loop. The auditor doesn't just tell you what's wrong — it generates ready-to-paste prompts that fix each gap using the exact implementation prompts from the ai-planning-playbook.

**How it works:**

1. Auditor runs, identifies all FAIL and PARTIAL checks
2. Each check maps to a specific phase/prompt from the plan (Phase 1a Prompt A, Phase 1b, Phase 1c, Phase 2, etc.)
3. `--prompts` flag generates a tailored prompt for each failure, pre-filled with:
   - The project's detected stack (languages, build/test/lint/format commands)
   - The project's detected shape (app/library/collection)
   - The specific gap to fix (not the whole phase — just the missing piece)
   - Agent-appropriate framing (CLAUDE.md instructions for Claude Code, AGENTS.md instructions for Codex)

**Agent targeting:**

`--agent claude` (default if CLAUDE.md detected): Generates prompts referencing CLAUDE.md, .claude/skills/, .claude/hooks/, .claude/settings.json.

`--agent codex`: Generates prompts referencing AGENTS.md, docs/codex-playbooks/, scripts/deny-dangerous.sh, scripts/preflight-checks.sh.

`--agent both` (default if dual-agent detected): Generates both sets.

**Output:**

Prompts are written to `workflow-fix-prompts.md` (or stdout with `--format text`). Each prompt is a fenced code block ready to copy-paste into Claude Code or Codex. Grouped by priority (Critical first, then High, Medium, Low).

**Example generated prompt:**

```markdown
## Fix: Missing execution loop (Critical)

Paste this into Claude Code:

‍```
Read ai-workflow-improvement-plan-prime.md. My CLAUDE.md is missing the
execution loop. This project is a LIBRARY. Stack:
- Languages: PHP
- Build: composer analyse
- Test: composer test
- Lint: composer analyse
- Format: composer cs:fix

Add the default execution loop (READ → CLASSIFY → ACT → VERIFY → LOG)
to CLAUDE.md. Include:
- READ with ❌/✅ example adapted for this PHP library
- CLASSIFY with complexity and mode table, question vs directive disambiguation
- ACT with behaviour-per-mode table, anti-planning-loop rule, anti-BDUF guard
- VERIFY with continuous test loop, two-level stop-the-line escalation
- LOG with docs/lessons.md and docs/footguns.md, context-based loading rules

Keep CLAUDE.md under 100 lines total. Use ❌/✅ examples not prose.
Count lines and report after.
‍```
```

**Why this matters:**

The existing tools say "CLAUDE.md is missing." The auditor says "CLAUDE.md is missing the execution loop. Here's the exact prompt to fix it, pre-filled with your stack details, ready to paste." That's the difference between a diagnostic and a prescription.

---

## Scope

### In Scope

- Filesystem-only analysis (reads files, never modifies them)
- Agent detection: Claude Code (CLAUDE.md), Codex (AGENTS.md), or both
- Project shape detection: app / library / script collection (heuristic, overridable)
- Three-tier scoring rubric: Foundation (40pts), Standard (35pts), Full (25pts)
- Anti-pattern deductions (max -15)
- Letter grade: A through F
- Output formats: text (terminal), JSON (machine), markdown (report), HTML (visual report)
- HTML report: self-contained single file, inline CSS/JS, visual dashboard with tier progress bars, BlunderGOAT branded
- Prompt generator: `--prompts` flag generates copy-paste-ready prompts for Claude Code or Codex that fix each identified gap, pre-filled with detected stack and shape
- Recommendations tied to specific plan sections / implementation prompts
- Published on npm as `@blundergoat/ai-workflow-goat`
- Zero runtime dependencies (Node.js stdlib only)
- CI integration via `--min-score` exit code
- Deterministic scoring (same project = same score every time)

### Out of Scope

- Modifying any files in the target project
- Requiring an AI agent session or API key to run
- *Executing* the generated prompts (the auditor generates them, the user pastes them — no agent orchestration)
- Auditing code quality, security, or test coverage (those are different tools)
- Supporting non-Claude-Code / non-Codex agent configurations (Cursor rules, Copilot instructions, Windsurf, etc.) — may revisit later
- Dashboard / web UI / history tracking (future, possibly DevGoat integration)
- Auto-fixing configuration (the auditor diagnoses, generates prompts, but the user decides what to run)
- Scoring projects that use completely different workflow systems (non-BlunderGOAT)

## Success Criteria

- Runs in under 3 seconds on any project
- Correctly scores all 8+ BlunderGOAT project repos (known-good setups, should score B or above)
- Produces actionable recommendations that point to exact prompts/sections
- `npx @blundergoat/ai-workflow-goat .` works without prior installation on macOS, Linux, and Windows (WSL)
- Zero false positives on anti-pattern deductions for known-good setups
- Zero runtime dependencies

## Constraints

- Zero runtime dependencies (stdlib only, no npm packages)
- Non-invasive (read-only filesystem access)
- Must work on macOS, Linux, and Windows (WSL and native)
- Score must be deterministic (same project = same score every time)
- The scoring rubric is derived from ai-workflow-improvement-plan-prime v1.5 — changes to the plan may require rubric updates
- Must support Node.js 18+ (for built-in `parseArgs`)

## Risks & Assumptions

| Risk/Assumption | Impact | Mitigation |
|----------------|--------|------------|
| Regex-based content analysis has false positives | Incorrect scores erode trust | Test against 8+ real repos with known-good setups. Anti-pattern checks need high confidence thresholds |
| Plan evolves (v1.6, v2.0) and rubric falls behind | Auditor scores outdated criteria | Version-tag the rubric. Include plan version in report output. Rubric version in package.json |
| "Zero deps" makes CLI argument parsing verbose | Slower development | Node's `parseArgs` (built-in since v18.3) handles basic flags |
| Project shape detection heuristic misclassifies | Wrong line targets, wrong optional checks scored | Allow `--shape app/library/collection` override. Report detected shape so user can correct |
| Adoption is near zero (niche tool for a niche workflow) | Wasted effort | Primary user is Matt. If it's useful for 8 repos, it's earned its place. Open source adoption is a bonus |
| TypeScript without bundler means users need Node 18+ | Some users on older Node | Node 18 is LTS and widely adopted. Document minimum version clearly |
| Content quality checks (e.g., "are Ask First boundaries specific?") are inherently heuristic | Borderline cases score wrong | Use conservative heuristics. Compare against known template text for "generic" detection. Allow user to acknowledge in config |
| Generated prompts reference plan file that user may not have | Prompt tells user to read a file that doesn't exist in their repo | Two strategies: self-contained prompts for users without the plan, plan-referencing prompts for users who have it. Default to self-contained |
| HTML report with inline CSS/JS adds significant template code | Maintenance burden, harder to iterate on design | Keep template simple for M1. Iterate on visual polish in later milestones. Template is just string interpolation over the same JSON |
| Prompt generator prompts may drift from the actual plan as the plan evolves | Generated prompts become stale or contradictory | Version-lock prompt templates to the rubric version. Update prompt templates whenever the plan version bumps |

## Open Questions

1. Should the markdown report be written to the project (e.g., `docs/workflow-audit.md`) or only to stdout? Writing to the project means it can be committed and tracked, but the auditor is "read-only."
2. Should it check for `.cursorrules`, `.github/copilot-instructions.md`, or other agent configs beyond Claude Code and Codex? Or is that scope creep for v1?
3. Should there be a `--strict` mode that treats PARTIAL as FAIL for CI gates?
4. How should the tool handle projects with no AI workflow at all? Score 0 with a "getting started" recommendation pointing to the article?
5. Should there be a `.goatrc` or `.workflow-audit.json` config file for per-project overrides (custom line targets, disabled checks, acknowledged anti-patterns)?
6. Should the rubric version be tied to the npm package version, or independently versioned?
7. Should the prompt generator output one combined prompt per phase (batching related failures) or one prompt per individual failure? Batching is more practical but individual prompts are more granular.
8. Should generated prompts reference the plan file by name (requires user to have it in their repo) or be fully self-contained with instructions inlined?

---

## Similar Projects & Competitive Landscape

Nothing does exactly what this auditor does — scoring AI workflow *design quality* rather than platform feature adoption. The landscape breaks into four categories: configuration auditors, security auditors, workflow frameworks, and ecosystem resources.

### Category 1: Configuration Auditors (Closest Competitors)

| Project | Stack | What It Does | Gap vs ai-workflow-goat |
|---------|-------|-------------|------------------------|
| **[audit-scan.sh](https://github.com/FlorianBruniaux/claude-code-ultimate-guide)** (Florian Bruniaux) | Bash. Zero deps (grep, find, wc, optional jq). ~2 second scan. | The most similar tool mechanically. Scans Claude Code config: detects stack (60+ integration patterns), checks CLAUDE.md at global/project levels, counts extensions (agents, commands, skills, hooks), flags quality patterns like security hooks and test frameworks. Warns if CLAUDE.md >100 lines without `@` references. Terminal + `--json` output. Part of the claude-code-ultimate-guide repo. | Scores feature *presence* not content *quality*. Doesn't check execution loop completeness, autonomy tier specificity, DoD gate count, or footgun evidence quality. Claude Code only — no AGENTS.md support. No scoring rubric or letter grade. No recommendations tied to implementation prompts. |
| **[claude-health](https://github.com/tw93/claude-health)** (tw93) | Claude Code skill (Markdown SKILL.md). Requires active Claude Code session. | Audits config health across six-layer framework: CLAUDE.md → rules → skills → hooks → subagents → verifiers. Auto-detects project tier (Simple/Standard/Complex) and calibrates checks. Checks signal-to-noise ratio, prose bloat, trigger clarity, frequency-based optimisation. Security checks for prompt injection, data exfiltration, destructive commands. | Requires Claude Code to run (burns API credits). Not standalone. Doesn't score workflow design quality. Doesn't check execution loop, autonomy tiers, DoD, or learning loop files. Claude Code only. No AGENTS.md support. |
| **[claude-code-excellence-audit](https://lobehub.com/skills/romiluz13-claude-code-excellence-audit)** (romiluz13) | Claude Code skill (Markdown). Available on Smithery and LobeHub. | 100-point rubric across memory, rules, settings, subagents, commands, hooks, MCP, skills. Visual report with per-category progress bars, strengths, gaps, prioritised remediation with code snippets. | Requires Claude Code session. Rubric measures feature adoption, not workflow quality. No execution loop, autonomy tier, or DoD checking. No AGENTS.md support. No standalone CLI. Good UX inspiration for report format. |
| **[ccboard](https://github.com/FlorianBruniaux/ccboard)** (Florian Bruniaux) | Rust binary. TUI + Web interface. SQLite cache. Published on crates.io. | Monitors Claude Code sessions, costs, config, hooks, agents, MCP servers. 11 tabs including config audit, security audit, analytics. Activity security audit: credential access detection, destructive command alerts. FTS5 search across sessions. | Session analytics and cost tracking tool, not workflow quality auditor. Different purpose entirely but polished UX worth studying. Shows Rust distribution pattern (Homebrew, cargo install, GitHub releases). |

### Category 2: Security Auditors

| Project | Stack | What It Does | Gap vs ai-workflow-goat |
|---------|-------|-------------|------------------------|
| **[claude-code-security-review](https://github.com/anthropics/claude-code-security-review)** (Anthropic) | Python. GitHub Action. Requires Anthropic API key. | AI-powered security review of PR diffs for vulnerabilities. Language-agnostic. False positive filtering. PR comments with inline findings. Has its own evals/ directory for testing the auditor. | Security-focused, not workflow-focused. Requires API key. GitHub Action, not standalone CLI. Different domain entirely, but the evals pattern and severity tiering are good references. |
| **[Claude-Code-Security-Auditor](https://github.com/danielrosehill/Claude-Code-Security-Auditor)** (Daniel Rosehill) | Bash scripts. SSH-based remote machine auditing. | Pattern for device-level security audits via Claude Code. Checks antivirus, rootkit detection, updates, file permissions, user accounts, SSH config. Generates timestamped reports per machine. | Completely different domain (system security, not AI workflow). Interesting for the bash report generation pattern and machine profile tracking. |

### Category 3: Workflow Frameworks & Skill Suites

| Project | Stack | What It Does | Gap vs ai-workflow-goat |
|---------|-------|-------------|------------------------|
| **[claude-code-skills](https://github.com/levnikolaevich/claude-code-skills)** (levnikolaevich) | Claude Code plugin suite (Markdown). 6 installable plugins. | Full delivery lifecycle: project bootstrap, documentation generation, codebase audits (security, quality, architecture, tests), agile pipeline with multi-model AI review and quality gates, performance optimisation, GitHub community workflows. Audit skills are language-aware. Multi-model cross-checking (Claude + Codex + Gemini). Quality gate concept (PASS/CONCERNS/REWORK/FAIL). | Plugin suite, not standalone tool. Codebase audits are code quality, not workflow configuration quality. Good reference for language-aware audit patterns and multi-pass structure. |
| **[skill-review](https://tessl.io/skills/github/secondsky/claude-skills/skill-review)** (Tessl/secondsky) | Claude Code skill. 15-phase audit methodology. | Systematic process for auditing skills in a Claude skills repo. 7 quick validation checks (name length, format, reserved words, description, SKILL.md lines, style). 8 anti-pattern checks. Severity-based findings (Critical/High/Medium/Low). Batch processing for multiple skills. Post-fix verification. | Audits *skills*, not *workflow configurations*. Different target. But the anti-pattern checklist, phased audit approach, and severity-based findings are directly applicable as UX patterns. |
| **[9 Parallel Subagents](https://hamy.xyz/blog/2026-02_code-reviews-claude-subagents)** (HAMY) | Claude Code subagent commands (Markdown). | 9 parallel Claude Code subagents for code review: test runner, linter, code reviewer, security, quality/style, test quality, performance, dependency/deployment safety, simplification. Each produces structured findings ranked by impact/effort. | Code review tool, not config auditor. Interesting parallel agent pattern and the impact/effort ranking on findings. |
| **[Simone](https://github.com/hesreallyhim/awesome-claude-code)** | Claude Code workflow framework. Documents + guidelines + processes. | Project management workflow for Claude Code. System of documents, guidelines, and processes for project planning and execution. | Similar "structured workflow" philosophy to the execution loop but focused on project management, not agent behaviour configuration. |
| **[BMad Method](https://github.com/hesreallyhim/awesome-claude-code)** | Claude Code commands (Markdown). .bmad-core/ directory structure. | Role-based multi-agent framework. Creates agent command files (Architect, Builder, Validator, Scribe). Agents coordinate through shared planning documents (PLAN.md, ISSUE.md). | Agent orchestration framework, not configuration auditor. Different purpose but shows another approach to structured AI workflows. |
| **[Ralph / ralph-claude-code](https://github.com/hesreallyhim/awesome-claude-code)** | Claude Code automation framework. | Autonomous AI development framework that runs Claude Code in automated loops until specifications are fulfilled. Exit detection, rate limiting, circuit breaker patterns, safety guardrails. | Automation framework, not auditor. Shows another pattern for agent workflow design. |

### Category 4: Ecosystem Resources & Standards

| Project | Stack | What It Does | Relevance |
|---------|-------|-------------|-----------|
| **[AGENTS.md spec](https://agents.md/)** | Open standard (Markdown format). | Open format for guiding coding agents. Used by 60k+ open-source projects. Backed by GitHub's analysis of 2,500 repos. Finding: tools mentioned get 160x usage uplift. | The spec the auditor validates against (alongside CLAUDE.md). The 160x finding validates the "essential commands" check in the rubric. |
| **[awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code)** | Curated list (Markdown). | Curated list of skills, hooks, commands, agents, and plugins for Claude Code. Regularly updated. | Landscape awareness. Check periodically for new audit/scoring tools. Good distribution channel — get listed here after launch. |
| **[claude-code-ultimate-guide](https://github.com/FlorianBruniaux/claude-code-ultimate-guide)** (Florian Bruniaux) | Documentation repo. Markdown + bash scripts + YAML machine-readable data. | Comprehensive Claude Code guide. 172 production-ready templates. 30 production hooks. Machine-readable reference.yaml. Threat intelligence database (24 CVEs, 655 malicious skills). Six-layer framework. 11 whitepapers. | The most comprehensive Claude Code documentation project. The audit-scan.sh script lives here. The six-layer framework is a different conceptual model from the five-step execution loop but covers similar ground. The guide's rubric for "quality patterns" informed several checks in our rubric. |
| **[GitHub's AGENTS.md analysis](https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/)** | Blog post / research. | Analysis of 2,500+ repositories using agents.md. Key findings: tool mentions get 160x usage uplift, structured formats work better than prose, essential commands are highest-signal section. | Research backing several scoring decisions in the rubric. Validates the heavy weighting on essential commands and router table checks. |
| **[Claude Code Best Practices](https://code.claude.com/docs/en/best-practices)** (Anthropic) | Official documentation. | Anthropic's official guidance on CLAUDE.md structure, hooks, skills, subagents, verification patterns. Includes Plan Mode workflow, subagent patterns, slash command creation. | Official source. The auditor's checks should be consistent with (but more opinionated than) official best practices. |

### What None of Them Do (Our Differentiation)

1. **Score workflow design quality** — not just "do you have hooks?" but "does your execution loop have all five steps with appropriate patterns?"
2. **Validate enforcement matches rules** — check that the permissions deny list actually covers what the Never tier claims
3. **Check learning loop quality** — footguns with real file:line evidence, not fabricated. Lessons file with format header. Propagation to local files
4. **Work across agents** — CLAUDE.md + AGENTS.md detection and scoring, dual-agent project support
5. **Generate fix-it prompts** — not just "this is missing" but "here's the exact prompt, pre-filled with your stack, ready to paste into Claude Code or Codex"
6. **Run standalone** — no agent session, no API key, no CI pipeline. `npx` and done
7. **Produce a visual HTML report** — self-contained single file, branded, shareable, attachable to PRs
8. **Score content quality** — detect generic/template Ask First boundaries, check DoD gate count, verify router references resolve
9. **Detect anti-patterns** — not just missing things, but actively harmful configurations (stop hook exiting non-zero, /review shadowing built-in, DoD overlap between files)

## Related

- [ai-planning-playbook](https://github.com/blundergoat/ai-planning-playbook) — the plan and prompts this auditor validates against
- [AI Workflow Scanner — Checklist Structure](./scanner-checklist.md) — the 50+ check rubric (already drafted)
- [blundergoat.com](https://blundergoat.com) — blog and portfolio home
- [Stop Writing Rules. Build a Workflow.](https://blundergoat.com) — the article explaining the workflow system
