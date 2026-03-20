# Scoring Rubric — @blundergoat/goat-flow

**Rubric version:** ai-workflow-improvement-plan-prime v1.5
**Total checks:** 65 sub-checks + 11 anti-patterns

---

## Scoring Model

### Tiers

| Tier | Points | Coverage |
|------|--------|----------|
| Foundation | 40 | Instruction file, execution loop, autonomy tiers, definition of done, enforcement |
| Standard | 35 | Skills, hooks, learning loop, router table, architecture docs, local context |
| Full | 25 | Agent evals, CI validation, permission profiles, guidelines ownership, hygiene |

### Check Results

| Result | Points | When |
|--------|--------|------|
| PASS | Full | Condition fully met |
| PARTIAL | Half (rounded down) | Condition partially met |
| FAIL | 0 | Condition not met |
| N/A | Excluded from denominator | Check not applicable to project shape |

### Grading

Scoring is **percentage-based**. N/A checks reduce the denominator so libraries and script collections are not penalised for checks that don't apply to them. A perfect library and a perfect app can both score 100%.

```
percentage = (points_earned - deductions) / points_available × 100
percentage = max(0, percentage)
```

| Grade | Range | Meaning |
|-------|-------|---------|
| A | 90–100% | Production-grade workflow |
| B | 75–89% | Solid, minor gaps |
| C | 60–74% | Functional but missing enforcement or learning loop |
| D | 40–59% | Basics present, significant gaps |
| F | 0–39% | No meaningful workflow system |

---

## Agent Detection

Run first. Determines which files to scan and which path mappings to use.

| Signal | Agent | Scoring |
|--------|-------|---------|
| `CLAUDE.md` at root | `claude_code` | Score Claude Code checks |
| `AGENTS.md` at root | `codex` | Score Codex checks |
| Both present | `dual` | Score independently, report side-by-side |
| Neither present | `none` | Score 0, recommend getting started |

### Agent File Mapping

All checks reference these abstractions. No check hardcodes `CLAUDE.md`.

| Concept | Claude Code | Codex |
|---------|------------|-------|
| Instruction file | `CLAUDE.md` | `AGENTS.md` |
| Settings file | `.claude/settings.json` | N/A |
| Skills directory | `.claude/skills/{name}/SKILL.md` | `docs/codex-playbooks/{name}.md` |
| Hooks directory | `.claude/hooks/` | `scripts/` |
| Deny mechanism | `permissions.deny` array in settings.json | Content of `scripts/deny-dangerous.sh` |
| Local instruction files | `*/CLAUDE.md` | `.github/instructions/*.md` |

When a check references `{instruction_file}`, `{skills_dir}`, `{hooks_dir}`, or `{deny_mechanism}`, substitute the concrete path from this mapping based on detected agent.

---

## Shape Detection

Heuristic-based, overridable with `--shape`.

| Signal | Shape | Instruction File Line Target |
|--------|-------|------------------------------|
| `src-tauri/`, `docker-compose.yml`, multiple language dirs, `Dockerfile` | App | 120 |
| `composer.json` type=library, single `src/`, `setup.py` without app entry | Library | 100 |
| `lib/` with `.sh` subdirs, no build system, no `src/` | Collection | 80 |
| Ambiguous / fallback | App | 120 |

### N/A Checks by Shape

| Check | App | Library | Collection |
|-------|-----|---------|------------|
| 2.1.4 /research skill | Required | N/A | N/A |
| 2.1.5 /code-review skill | Required | N/A | N/A |
| 2.3.5 confusion-log.md | Required | N/A | N/A |
| 3.1 Agent evals (all) | Required | Required | N/A |
| 3.3 Permission profiles (all) | Required | N/A | N/A |

---

## Tier 1 — Foundation (40 points)

### 1.1 Instruction File (8 pts)

| ID | Check | Pts | Detection | Thresholds |
|----|-------|-----|-----------|------------|
| 1.1.1 | File exists | 2 | `test -f {instruction_file}` | Binary |
| 1.1.2 | Under line target | 3 | `wc -l {instruction_file}` | PASS: under shape target. PARTIAL: under 150. FAIL: 150+ |
| 1.1.3 | Version header | 1 | Grep instruction file for `^(#|##).*v[0-9]` or date pattern | Binary |
| 1.1.4 | Essential commands section | 2 | Grep instruction file for `essential commands|quick commands|commands` | Binary |

### 1.2 Execution Loop (10 pts)

All checks search instruction file content.

| ID | Check | Pts | Detection Pattern | Thresholds |
|----|-------|-----|-------------------|------------|
| 1.2.1 | READ step | 2 | `read.*first|read.*before|never fabricate` | Binary |
| 1.2.2 | CLASSIFY step | 2 | `classify|mode.*(plan|implement|debug)|question.*directive` | Binary |
| 1.2.3 | ACT step | 2 | `act|mode.*behaviour|state.*declaration|anti.*planning.loop` | Binary |
| 1.2.4 | VERIFY step | 2 | `verify|stop.the.line|test.*after|two.*correction` | Binary |
| 1.2.5 | LOG step | 2 | `log|lessons\.md|footguns\.md` | Binary |

### 1.3 Autonomy Tiers (8 pts)

All checks search instruction file content.

| ID | Check | Pts | Detection | Thresholds |
|----|-------|-----|-----------|------------|
| 1.3.1 | Three tiers present | 2 | Grep for Always + Ask First + Never (or equivalents) | Binary: all three found |
| 1.3.2 | Ask First project-specific | 3 | Ask First section > 5 lines AND contains a filename, class name, or technology name | PASS: specific. PARTIAL: present but generic. FAIL: missing |
| 1.3.3 | Never tier destructive guards | 2 | `delete test|\.env|secrets|push.*main|git commit` | Binary |
| 1.3.4 | Micro-checklist present | 1 | `micro.checklist|boundary.*touched|rollback.*command` | Binary |

### 1.4 Definition of Done (6 pts)

All checks search instruction file content.

| ID | Check | Pts | Detection | Thresholds |
|----|-------|-----|-----------|------------|
| 1.4.1 | DoD section exists | 2 | `definition of done|done.*until|task.*not.*done` | Binary |
| 1.4.2 | 4+ explicit gates | 2 | Count checkbox or numbered items in DoD section | PASS: 6+. PARTIAL: 4-5. FAIL: <4 |
| 1.4.3 | Grep-after-rename gate | 1 | `grep.*old.*pattern|grep.*rename|zero.*remaining` | Binary |
| 1.4.4 | Log-update gate | 1 | `lessons.*updated|footguns.*updated|logs.*updated` | Binary |

### 1.5 Enforcement Baseline (8 pts)

Agent-specific detection paths. See agent file mapping above.

| ID | Check | Pts | Claude Code | Codex | Thresholds |
|----|-------|-----|-------------|-------|------------|
| 1.5.1 | Deny mechanism exists | 3 | `permissions.deny` array in settings.json | `scripts/deny-dangerous.sh` exists | Binary |
| 1.5.2 | git commit blocked | 2 | `*git commit*` in deny array | `git commit` pattern in deny script | Binary |
| 1.5.3 | git push blocked | 1 | `*git push*` in deny array | `git push` pattern in deny script | Binary |
| 1.5.4 | Deny hook/script exists | 2 | `.claude/hooks/deny-dangerous.sh` | `scripts/deny-dangerous.sh` | Binary |

---

## Tier 2 — Standard (35 points)

### 2.1 Skills / Playbooks (8 pts)

| ID | Check | Pts | Claude Code Path | Codex Path | Shape N/A |
|----|-------|-----|-----------------|------------|-----------|
| 2.1.1 | Preflight | 2 | `.claude/skills/goat-preflight/SKILL.md` | `docs/codex-playbooks/goat-preflight.md` | — |
| 2.1.2 | Debug | 2 | `.claude/skills/goat-debug/SKILL.md` | `docs/codex-playbooks/goat-debug.md` | — |
| 2.1.3 | Audit | 2 | `.claude/skills/goat-audit/SKILL.md` | `docs/codex-playbooks/goat-audit.md` | — |
| 2.1.4 | Research | 1 | `.claude/skills/goat-research/SKILL.md` | `docs/codex-playbooks/goat-research.md` | Library, Collection |
| 2.1.5 | Review | 1 | `.claude/skills/goat-review/SKILL.md` | `docs/codex-playbooks/goat-review.md` | Library, Collection |

### 2.2 Hooks / Verification Scripts (7 pts)

| ID | Check | Pts | Claude Code | Codex | Thresholds |
|----|-------|-----|-------------|-------|------------|
| 2.2.1 | Settings/config valid | 1 | `JSON.parse(settings.json)` succeeds | Auto-pass (no settings file) | Binary |
| 2.2.2 | Stop hook registered | 2 | Stop hook entry in settings.json | `scripts/stop-lint.sh` exists | Binary |
| 2.2.3 | Stop hook exits 0 | 1 | Last exit in stop hook is `exit 0` | Same | Binary |
| 2.2.4 | PostToolUse or documented skip | 1 | Hook exists OR instruction file notes "no formatter" | Script exists OR documented | Binary |
| 2.2.5 | Preflight script | 1 | `scripts/preflight-checks.sh` or package.json preflight | Same | Binary |
| 2.2.6 | Context validation | 1 | `scripts/context-validate.sh` or CI workflow | Same | Binary |

### 2.3 Learning Loop (7 pts)

Shared files — same detection for all agents.

| ID | Check | Pts | Detection | Shape N/A | Thresholds |
|----|-------|-----|-----------|-----------|------------|
| 2.3.1 | lessons.md exists | 1 | `test -f docs/lessons.md` | — | Binary |
| 2.3.2 | lessons.md has format | 1 | First 5 lines contain section structure | — | Binary |
| 2.3.3 | footguns.md exists | 2 | `test -f docs/footguns.md` | — | Binary |
| 2.3.4 | Footguns have evidence | 2 | `grep -cE '(file:|line:|src/|lib/)' docs/footguns.md` > 0 | — | Binary |
| 2.3.5 | confusion-log.md | 1 | `test -f docs/confusion-log.md` | Library, Collection | Binary |

### 2.4 Router Table (5 pts)

Searches instruction file content.

| ID | Check | Pts | Detection | Thresholds |
|----|-------|-----|-----------|------------|
| 2.4.1 | Router section exists | 1 | `router|read when|context router` in instruction file | Binary |
| 2.4.2 | References resolve | 3 | Extract file paths, `test -f` each | PASS: all. PARTIAL: some missing. FAIL: most missing |
| 2.4.3 | Skills referenced | 1 | Router mentions skill/playbook directories | Binary |

### 2.5 Architecture Docs (4 pts)

Shared files.

| ID | Check | Pts | Detection | Thresholds |
|----|-------|-----|-----------|------------|
| 2.5.1 | architecture.md exists | 2 | `test -f docs/architecture.md` | Binary |
| 2.5.2 | Under 100 lines | 1 | `wc -l docs/architecture.md` < 100 | Binary |
| 2.5.3 | domain-reference.md | 1 | `test -f docs/domain-reference.md` | N/A if no migration path detected |

### 2.6 Local Context (4 pts)

| ID | Check | Pts | Detection | Thresholds |
|----|-------|-----|-----------|------------|
| 2.6.1 | Local files where warranted | 2 | Dirs with 2+ footgun mentions have local instruction file | PASS: covered. PARTIAL: some. N/A: flat structure |
| 2.6.2 | Local files under 20 lines | 1 | `wc -l` each local instruction file | Binary |
| 2.6.3 | No duplicate root rules | 1 | Diff local vs root instruction file for repeated blocks | Binary |

---

## Tier 3 — Full (25 points)

### 3.1 Agent Evals (8 pts)

| ID | Check | Pts | Detection | Shape N/A | Thresholds |
|----|-------|-----|-----------|-----------|------------|
| 3.1.1 | Evals directory exists | 2 | `test -d agent-evals` or `test -d codex-evals` | Collection | Binary |
| 3.1.2 | README in evals | 1 | `test -f agent-evals/README.md` | Collection | Binary |
| 3.1.3 | 3+ eval files | 2 | Count `.md` files excluding README | Collection | PASS: 3+. PARTIAL: 1-2. FAIL: 0 |
| 3.1.4 | Replay prompts | 2 | Grep evals for prompt/replay section | Collection | PASS: all. PARTIAL: some |
| 3.1.5 | Real incident references | 1 | Grep for git hash, issue number | Collection | Binary |

### 3.2 CI Validation (5 pts)

| ID | Check | Pts | Detection | Thresholds |
|----|-------|-----|-----------|------------|
| 3.2.1 | Workflow exists | 2 | `test -f .github/workflows/context-validation.yml` | Binary |
| 3.2.2 | Checks line count | 1 | Grep workflow for `wc -l` or line count logic | Binary |
| 3.2.3 | Checks router refs | 1 | Grep workflow for reference validation | Binary |
| 3.2.4 | Checks skills | 1 | Grep workflow for skills directory check | Binary |

### 3.3 Permission Profiles (4 pts)

| ID | Check | Pts | Detection | Shape N/A | Thresholds |
|----|-------|-----|-----------|-----------|------------|
| 3.3.1 | Profiles directory | 1 | `test -d .claude/profiles` | Library, Collection | Binary |
| 3.3.2 | 2+ profile files | 2 | Count files in profiles/ | Library, Collection | PASS: 2+. PARTIAL: 1 |
| 3.3.3 | Referenced in router | 1 | Grep instruction file for profiles mention | Library, Collection | Binary |

### 3.4 Guidelines Ownership (5 pts)

| ID | Check | Pts | Detection | Thresholds |
|----|-------|-----|-----------|------------|
| 3.4.1 | No DoD overlap | 2 | Guidelines file lacks DoD/done section | Binary |
| 3.4.2 | No execution loop overlap | 1 | Guidelines file lacks READ/CLASSIFY/ACT patterns | Binary |
| 3.4.3 | Ownership split doc | 1 | `test -f docs/guidelines-ownership-split.md` | Binary |
| 3.4.4 | Clean separation | 1 | No autonomy/stop-the-line content in guidelines | Binary |

### 3.5 Hygiene (3 pts)

| ID | Check | Pts | Detection | Thresholds |
|----|-------|-----|-----------|------------|
| 3.5.1 | Handoff template | 1 | `test -f tasks/handoff-template.md` | Binary |
| 3.5.2 | RFC 2119 language | 1 | Count of `MUST|SHOULD|MAY|MUST NOT` in instruction file > 3 | Binary |
| 3.5.3 | Version/changelog | 1 | Grep instruction file for changelog or version history section | Binary |

---

## Anti-Pattern Deductions

Max -15 total. Applied after tier scoring. Final score cannot drop below 0.

| ID | Anti-Pattern | Detection | Deduction | Agent Scope |
|----|-------------|-----------|-----------|-------------|
| AP1 | Instruction file over 150 lines | `wc -l {instruction_file}` > 150 | -3 | All |
| AP2 | Skill name conflicts with built-in | `{skills_dir}` contains a skill name that shadows a built-in agent command | -3 | All |
| AP3 | DoD in both instruction file and guidelines | DoD section found in both files | -3 | All |
| AP4 | Footguns without evidence | `docs/footguns.md` exists but zero `file:|line:` references | -5 | All |
| AP5 | Settings.json invalid JSON | `JSON.parse()` throws | -5 | Claude Code only |
| AP6 | Stop hook exits non-zero | Last exit in stop hook is not `exit 0` | -5 | All |
| AP7 | Local instruction file over 20 lines | Any local file `wc -l` > 20 | -2 | All |
| AP8 | Generic Ask First boundaries | Ask First section matches known template text verbatim | -2 | All |
| AP9 | settings.local.json committed | `git ls-files .claude/settings.local.json` returns match | -2 | Claude Code, git repos only |
| AP10 | Incident without footgun/lesson entry | Real incident occurred but no corresponding entry added to learning loop | -2 | All |
| AP11 | Mandatory-but-dead artifacts | Required file exists but empty after 6+ months of active development | -2 | All |

---

## Recommendation Engine

Each FAIL or PARTIAL generates a recommendation with priority based on tier.

| Check Tier | Priority |
|-----------|----------|
| Foundation FAIL | Critical |
| Standard FAIL | High |
| Full FAIL | Medium |
| Any PARTIAL | Low |

Each recommendation includes: category, message (what's wrong), and action (specific phase/prompt from the plan that fixes the gap).
