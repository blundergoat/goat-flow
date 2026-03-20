# AI Workflow Scanner — Checklist Structure

**Purpose:** Map every checkable item from the AI workflow plan to a detection method and score.
**Scanner output:** JSON (machine) + HTML report (human).

---

## Scoring Model

**Max score: 100 points.** Three tiers, weighted by impact.

| Tier | Points Available | What It Covers |
|------|-----------------|----------------|
| Foundation (Minimal) | 40 | The stuff that matters most — instruction file, execution loop, enforcement |
| Standard | 35 | Skills, hooks, local context, learning loop |
| Full | 25 | Evals, CI, profiles, hygiene |

Each check is PASS (full points), PARTIAL (half points), or FAIL (0).
Anti-pattern deductions subtract from the total (can't go below 0).

**Letter grades:**
- 90–100: A — Production-grade workflow
- 75–89: B — Solid, minor gaps
- 60–74: C — Functional but missing enforcement or learning loop
- 40–59: D — Basics present, significant gaps
- 0–39: F — No meaningful workflow system

---

## Agent Detection (first check)

Before scoring, detect which agent(s) the project uses. This determines which files to scan.

| Check | Detection | Result |
|-------|-----------|--------|
| Claude Code | `CLAUDE.md` exists at project root | `claude_code: true` |
| Codex | `AGENTS.md` exists at project root | `codex: true` |
| Both | Both files exist | `dual_agent: true` |
| Neither | Neither file exists | Score 0, report "No AI workflow detected" |

If dual-agent, score both independently and report side by side.

**Project shape detection** (heuristic, used for adaptive scoring):

| Signal | Shape |
|--------|-------|
| `src-tauri/`, `docker-compose.yml`, multiple language dirs | App |
| `composer.json` with `"type": "library"`, single `src/` | Library |
| `lib/` with subdirectories, bulk `.sh` files, no build system | Script Collection |
| Fallback | App (strictest defaults) |

---

## Tier 1 — Foundation (40 points)

### 1.1 Instruction File Exists and Is Sized Correctly (8 pts)

| Check | Detection | Points | Notes |
|-------|-----------|--------|-------|
| File exists | `test -f CLAUDE.md` or `test -f AGENTS.md` | 2 | Binary |
| Under line target | `wc -l < 120` (app) / `< 100` (lib/collection) | 3 | PASS if under target, PARTIAL if under 150, FAIL if 150+ |
| Has version header | `grep -qE '^(#|##).*v[0-9]' CLAUDE.md` or date pattern | 1 | Any versioning scheme counts |
| Has essential commands section | `grep -qiE '(essential commands|quick commands|commands)' CLAUDE.md` | 2 | Tools mentioned = 160x usage uplift |

### 1.2 Execution Loop Present (10 pts)

| Check | Detection | Points | Notes |
|-------|-----------|--------|-------|
| READ step | `grep -qiE '(read.*first|read.*before|never fabricate)' CLAUDE.md` | 2 | |
| CLASSIFY step | `grep -qiE '(classify|mode.*plan.*implement.*debug|question.*directive)' CLAUDE.md` | 2 | |
| ACT step | `grep -qiE '(act|mode.*behaviour|state.*declaration|anti.*planning.loop)' CLAUDE.md` | 2 | |
| VERIFY step | `grep -qiE '(verify|stop.the.line|test.*after|two.*correction)' CLAUDE.md` | 2 | |
| LOG step | `grep -qiE '(log|lessons\.md|footguns\.md)' CLAUDE.md` | 2 | |

### 1.3 Autonomy Tiers (8 pts)

| Check | Detection | Points | Notes |
|-------|-----------|--------|-------|
| Three tiers present | grep for Always/Ask First/Never (or equivalent) | 2 | |
| Ask First has project-specific boundaries | Check Ask First section length > 3 lines AND doesn't match generic template text | 3 | PARTIAL if present but generic |
| Never tier includes destructive guards | `grep -qiE '(delete test|\.env|secrets|push.*main|git commit)' CLAUDE.md` | 2 | |
| Micro-checklist present | `grep -qiE '(micro.checklist|boundary.*touched|rollback.*command)' CLAUDE.md` | 1 | |

### 1.4 Definition of Done (6 pts)

| Check | Detection | Points | Notes |
|-------|-----------|--------|-------|
| DoD section exists | `grep -qiE '(definition of done|done.*until|task.*not.*done)' CLAUDE.md` | 2 | |
| Has 4+ explicit gates | Count checkbox or numbered items in DoD section | 2 | PASS=6 gates, PARTIAL=4-5, FAIL=<4 |
| Grep-after-rename gate | `grep -qiE '(grep.*old.*pattern|grep.*rename|zero.*remaining)' CLAUDE.md` | 1 | The gate most often missing |
| Log-update gate | `grep -qiE '(lessons.*updated|footguns.*updated|logs.*updated)' CLAUDE.md` | 1 | |

### 1.5 Enforcement Baseline (8 pts)

| Check | Detection | Points | Notes |
|-------|-----------|--------|-------|
| Permissions deny list exists | Parse `.claude/settings.json`, check `permissions.deny` array exists | 3 | Strongest enforcement layer |
| git commit blocked | `*git commit*` in deny list | 2 | |
| git push blocked | `*git push*` in deny list | 1 | |
| deny-dangerous hook or script exists | `test -f .claude/hooks/deny-dangerous.sh` OR `test -f scripts/deny-dangerous.sh` | 2 | Claude Code or Codex path |

---

## Tier 2 — Standard (35 points)

### 2.1 Skills / Playbooks (8 pts)

| Check | Detection | Points | Notes |
|-------|-----------|--------|-------|
| Preflight skill exists | `test -f .claude/skills/goat-preflight/SKILL.md` OR `test -f docs/codex-playbooks/goat-preflight.md` | 2 | |
| Debug skill exists | Similar path check | 2 | |
| Audit skill exists | Similar path check | 2 | |
| Research skill exists | Similar path check | 1 | Optional for single-domain libs |
| Review skill exists | Similar path check | 1 | Optional for single-domain libs |

### 2.2 Hooks (Claude Code) or Verification Scripts (Codex) (7 pts)

| Check | Detection | Points | Notes |
|-------|-----------|--------|-------|
| Settings.json is valid JSON | `jq . .claude/settings.json > /dev/null 2>&1` | 1 | |
| Stop hook registered | Parse settings.json for Stop hook entry | 2 | |
| Stop hook exits 0 | `grep -q 'exit 0' .claude/hooks/stop-lint.sh` (last exit) | 1 | Non-zero = infinite loops |
| PostToolUse hook OR documented skip | Hook exists OR CLAUDE.md notes "no formatter" | 1 | Not every project needs this |
| Preflight script exists | `test -f scripts/preflight-checks.sh` OR composer/pnpm preflight | 1 | |
| Context validation script | `test -f scripts/context-validate.sh` OR CI workflow | 1 | |

### 2.3 Learning Loop Files (7 pts)

| Check | Detection | Points | Notes |
|-------|-----------|--------|-------|
| lessons.md exists | `test -f docs/lessons.md` | 1 | |
| lessons.md has format header | First 5 lines contain section structure | 1 | |
| footguns.md exists | `test -f docs/footguns.md` | 2 | Higher value — architectural knowledge |
| footguns have evidence | `grep -cE '(file:|line:|src/|lib/)' docs/footguns.md` > 0 | 2 | file:line refs = real, not invented |
| confusion-log.md exists (apps) | `test -f docs/confusion-log.md` | 1 | Skip for libraries |

### 2.4 Router Table (5 pts)

| Check | Detection | Points | Notes |
|-------|-----------|--------|-------|
| Router table section exists | `grep -qiE '(router|read when|context router)' CLAUDE.md` | 1 | |
| References resolve | Extract file paths from router table, `test -f` each | 3 | PARTIAL = some missing. FAIL = most missing |
| Skills referenced | Router mentions skill directories or playbook files | 1 | |

### 2.5 Architecture & Domain Docs (4 pts)

| Check | Detection | Points | Notes |
|-------|-----------|--------|-------|
| architecture.md exists | `test -f docs/architecture.md` | 2 | |
| architecture.md under 100 lines | `wc -l docs/architecture.md` | 1 | Over 100 = probably dumped, not curated |
| domain-reference.md exists (if Prompt B) | `test -f docs/domain-reference.md` | 1 | Only score if CLAUDE.md appears migrated |

### 2.6 Local Context (4 pts)

| Check | Detection | Points | Notes |
|-------|-----------|--------|-------|
| Local CLAUDE.md files where warranted | Find dirs with 2+ footgun mentions, check for local CLAUDE.md or scoped .github/instructions/ | 2 | PASS if covered, PARTIAL if some, N/A if flat structure |
| Local files under 20 lines | `wc -l` each local CLAUDE.md | 1 | |
| No duplicate project-wide rules | Diff local vs root CLAUDE.md for repeated blocks | 1 | |

---

## Tier 3 — Full (25 points)

### 3.1 Agent Evals (8 pts)

| Check | Detection | Points | Notes |
|-------|-----------|--------|-------|
| agent-evals/ or codex-evals/ directory exists | `test -d agent-evals` OR `test -d codex-evals` | 2 | |
| README.md in evals directory | `test -f agent-evals/README.md` | 1 | |
| 3+ eval files | `find agent-evals -name '*.md' ! -name 'README.md' \| wc -l` >= 3 | 2 | PARTIAL = 1-2 |
| Evals have replay prompts | grep each eval for prompt/replay section | 2 | |
| Evals reference real incidents | grep for git hash, issue number, or "real-history" origin | 1 | |

### 3.2 CI Validation (5 pts)

| Check | Detection | Points | Notes |
|-------|-----------|--------|-------|
| Context validation workflow exists | `test -f .github/workflows/context-validation.yml` | 2 | |
| Checks CLAUDE.md line count | grep workflow for `wc -l` or line count check | 1 | |
| Checks router references | grep workflow for reference validation | 1 | |
| Checks skill completeness | grep workflow for skills directory check | 1 | |

### 3.3 Permission Profiles (4 pts, apps only)

| Check | Detection | Points | Notes |
|-------|-----------|--------|-------|
| Profiles directory exists | `test -d .claude/profiles` | 1 | N/A for libraries |
| 2+ profile files | Count .json or .md files in profiles/ | 2 | |
| Profiles referenced in router | grep CLAUDE.md for profiles mention | 1 | |

### 3.4 Guidelines Ownership (5 pts)

| Check | Detection | Points | Notes |
|-------|-----------|--------|-------|
| No DoD overlap | Check guidelines file doesn't contain DoD/done section | 2 | |
| No execution loop overlap | Check guidelines file doesn't contain READ/CLASSIFY/ACT | 1 | |
| guidelines-ownership-split.md exists | `test -f docs/guidelines-ownership-split.md` | 1 | |
| Clean separation | No autonomy tier or stop-the-line content in guidelines | 1 | |

### 3.5 Hygiene (3 pts)

| Check | Detection | Points | Notes |
|-------|-----------|--------|-------|
| Handoff template exists | `test -f tasks/handoff-template.md` | 1 | |
| RFC 2119 language present | `grep -cE '\b(MUST|SHOULD|MAY|MUST NOT)\b' CLAUDE.md` > 3 | 1 | |
| Version/changelog in CLAUDE.md | grep for changelog or version history section | 1 | |

---

## Anti-Pattern Deductions

These subtract from the total score. Capped at -15.

| Anti-Pattern | Detection | Deduction | Notes |
|--------------|-----------|-----------|-------|
| CLAUDE.md over 150 lines | `wc -l` | -5 | Hard ceiling in the plan |
| Skill name conflicts with built-in | `{skills_dir}` contains a skill name that shadows a built-in agent command | -3 | Use goat- prefix for all skills |
| DoD in both CLAUDE.md and guidelines | DoD/done section in both files | -3 | Agent follows whichever read last |
| Footguns without evidence | footguns.md exists but zero file:line references | -3 | Likely fabricated |
| settings.json invalid JSON | `jq` parse failure | -3 | Hooks won't load |
| Stop hook exits non-zero on error | Last exit in stop hook isn't `exit 0` | -2 | Causes infinite fix loops |
| Local CLAUDE.md over 20 lines | `wc -l` any local file | -2 | Defeats the purpose |
| Autonomy tiers use generic examples | Ask First section matches known template text verbatim | -2 | Not adapted for the project |
| `settings.local.json` committed | `git ls-files .claude/settings.local.json` | -2 | Should be gitignored |

---

## Output Structure (JSON)

```json
{
  "scan_date": "2026-03-19T10:30:00Z",
  "project_path": "/home/user/my-project",
  "project_shape": "app",
  "agents_detected": ["claude_code"],
  "score": 72,
  "grade": "C",
  "tier_scores": {
    "foundation": { "earned": 34, "available": 40 },
    "standard": { "earned": 25, "available": 35 },
    "full": { "earned": 18, "available": 25 }
  },
  "deductions": -5,
  "checks": [
    {
      "id": "1.1.1",
      "tier": "foundation",
      "category": "Instruction File",
      "name": "CLAUDE.md exists",
      "status": "pass",
      "points_earned": 2,
      "points_available": 2,
      "detail": "CLAUDE.md found (114 lines)"
    },
    {
      "id": "1.1.2",
      "tier": "foundation",
      "category": "Instruction File",
      "name": "Under line target",
      "status": "pass",
      "points_earned": 3,
      "points_available": 3,
      "detail": "114 lines (target: 120 for app)"
    }
  ],
  "anti_patterns": [
    {
      "id": "ap.1",
      "name": "CLAUDE.md over 150 lines",
      "triggered": false,
      "deduction": 0
    }
  ],
  "recommendations": [
    {
      "priority": "high",
      "category": "Learning Loop",
      "message": "footguns.md exists but has no file:line evidence. Run the footgun seeding prompt to populate with real cross-domain coupling.",
      "tier": "standard"
    }
  ]
}
```

---

## Recommendation Engine

Each FAIL or PARTIAL check generates a recommendation. Priority based on:

| Priority | Criteria |
|----------|----------|
| **Critical** | Foundation check failed — the system won't work without this |
| **High** | Standard check failed — significant gap in enforcement or learning |
| **Medium** | Full tier check failed — polish and maturity |
| **Low** | Partial passes — improvement opportunity, not a gap |

Recommendations should reference the specific prompt or section from the plan that fixes the gap. Example:

> **Critical:** No execution loop detected in CLAUDE.md. Run Phase 1a (Prompt A) from `ai-workflow-implement-prompts-prime.md` to generate the foundation.

> **High:** Footguns file has no file:line evidence — entries may be fabricated. Re-run the footgun seeding step or manually verify each entry against the codebase.

> **Medium:** No agent evals found. Run Phase 2 to create regression tests from git history: `git log --oneline --all | grep -iE 'fix|revert|bug|broke|regression'`

---

## Similar Projects & Inspiration

Nothing does exactly what this scanner does — scoring AI workflow *design quality* rather than platform feature adoption. But these projects are worth studying for mechanics, UX patterns, and rubric design.

### Closest: Configuration Auditors

| Project | What It Does | What to Learn From It |
|---------|-------------|----------------------|
| **[audit-scan.sh](https://github.com/FlorianBruniaux/claude-code-ultimate-guide)** (Florian Bruniaux) | Bash script scanning Claude Code config. Detects stack (60+ integration patterns), checks CLAUDE.md at global/project levels, counts extensions (agents, commands, skills, hooks), flags quality patterns. Warns if CLAUDE.md >100 lines without `@` references. Terminal + `--json` output. | Best mechanical reference. Same "bash reads filesystem and scores" approach. Stack detection heuristics are solid. The >100 line refactoring warning is close to our line target check. Study the JSON output structure and the two-mode (human/machine) output pattern. |
| **[claude-health](https://github.com/tw93/claude-health)** | Claude Code skill auditing config across six layers: CLAUDE.md → rules → skills → hooks → subagents → verifiers. Auto-detects project tier (Simple/Standard/Complex) and calibrates checks. Security-focused (injection, exfiltration, destructive commands). | Tier-adaptive scoring is the same concept as our app/library/collection shape detection. Study how it calibrates expectations per tier — we do the same but for workflow maturity instead of config completeness. |
| **[claude-code-excellence-audit](https://lobehub.com/skills/romiluz13-claude-code-excellence-audit)** (Smithery/LobeHub) | 100-point rubric across memory, rules, settings, subagents, commands, hooks, MCP, skills. Visual report with per-category progress bars, strengths, gaps, prioritised remediation. | The visual report format (progress bars per category, prioritised action plan) is exactly the UX pattern we want for the HTML report. Study the rubric weighting and how recommendations are structured with code snippets. |

### Adjacent: Code & Security Auditors

| Project | What It Does | What to Learn From It |
|---------|-------------|----------------------|
| **[claude-code-security-review](https://github.com/anthropics/claude-code-security-review)** (Anthropic) | GitHub Action using Claude to analyse PR diffs for security vulnerabilities. Language-agnostic. False positive filtering. PR comments with inline findings. | The evals/ directory pattern for testing the auditor itself. False positive filtering logic. The severity tier system (Critical/High/Medium) and how findings are presented inline. |
| **[claude-code-skills](https://github.com/levnikolaevich/claude-code-skills)** (levnikolaevich) | 6 installable plugins: bootstrap, docs, codebase audits, agile pipeline, performance, community. Audit skills are language-aware. Multi-model cross-checking (Claude + Codex + Gemini). | The codebase audit suite (ln-6XX) has a multi-pass structure similar to our /audit skill. The quality gate concept (PASS/CONCERNS/REWORK/FAIL) maps to our PASS/PARTIAL/FAIL. Study how they make audits language-aware. |
| **[9 Parallel Subagents](https://hamy.xyz/blog/2026-02_code-reviews-claude-subagents)** (HAMY) | 9 parallel Claude Code subagents for code review: test runner, linter, code reviewer, security, quality/style, test quality, performance, dependency/deployment safety, simplification. | The parallel agent pattern and how each agent has a focused scope with structured output. The impact/effort ranking on findings. We could adopt parallel checks for speed if the scanner grows complex. |
| **[skill-review](https://tessl.io/skills/github/secondsky/claude-skills/skill-review)** (Tessl) | 15-phase audit methodology for Claude Code skills. 7 quick validation checks, 8 anti-pattern checks, severity-based findings (Critical/High/Medium/Low). Batch processing for multiple skills. | The anti-pattern detection checklist is close in spirit to our anti-pattern deductions. The phased audit approach (quick validation → deep analysis → fix → verify) is a good UX model for progressive disclosure in our report. |

### Broader Ecosystem

| Project | What It Does | What to Learn From It |
|---------|-------------|----------------------|
| **[awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code)** | Curated list of skills, hooks, commands, agents, and plugins for Claude Code. | Landscape awareness. Check periodically for new audit/scoring tools entering the space. Also a good distribution channel — get listed here. |
| **[AGENTS.md spec](https://agents.md/)** | Open format for guiding coding agents, used by 60k+ open-source projects. | The spec itself and the GitHub blog post analysing 2,500 repos. The finding that tools mentioned in AGENTS.md get 160x usage uplift validates our "essential commands" check. |
| **[Simone](https://github.com/hesreallyhim/awesome-claude-code)** (referenced in awesome-claude-code) | Project management workflow for Claude Code — documents, guidelines, processes for planning and execution. | Similar "structured workflow" philosophy to our execution loop. Different approach (project management vs agent behaviour) but the same insight: structure beats ad-hoc rules. |

### What None of Them Do (Our Gap)

- Score the *design quality* of instruction file content (execution loop, autonomy tiers, DoD gates)
- Validate enforcement matches claimed rules (permissions deny covers Never tier)
- Check learning loop quality (footguns with file:line evidence, not fabricated)
- Work across agents (CLAUDE.md + AGENTS.md, dual-agent detection)
- Tie recommendations to specific implementation prompts from a playbook
- Score as a standalone CLI with HTML report (existing tools are all Claude Code skills or GitHub Actions — they require the agent to run them)

---

## Implementation Notes

**Scanner core:** Bash. All checks are filesystem reads and pattern matching.

**Output formats:**
- `--json` → structured JSON to stdout
- `--html` → self-contained HTML report (single file, inline CSS/JS)
- `--text` → terminal-friendly summary with colour codes
- Default: `--text` when stdout is a terminal, `--json` when piped

**HTML report:** Static single file. Heredoc template or PHP renderer.
Same pattern as DevGoat AWS cost feature — bash scanner produces JSON,
rendering layer consumes it.

**Dashboard (future):** PHP frontend matching devgoat-bash-scripts dashboard
conventions. Calls scanner, renders results, stores history.
