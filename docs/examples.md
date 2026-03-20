# Real-World Implementations - GOAT Flow

Six BlunderGOAT projects scanned for workflow framework adoption. These serve as reference implementations showing how the system adapts across project shapes and stacks.

---

## Summary

| Project | Shape | Stack | Agent | CLAUDE.md | AGENTS.md | Adoption Tier |
|---------|-------|-------|-------|-----------|-----------|---------------|
| **ambient-scribe** | App | PHP, TypeScript, Python, Docker | Dual | 53 lines | 119 lines | Full |
| **devgoat** | App (Tauri) | TypeScript, Rust | Dual | 121 lines | 153 lines | Standard |
| **devgoat-bash-scripts** | Collection | Bash, PHP | Dual | 100 lines | 135 lines | Full |
| **sus-form-detector** | Library | PHP, Python | Dual | 107 lines | 43 lines | Standard |
| **blundergoat-platform** | App | TypeScript, Docker | Claude Code only | 62 lines | -- | Minimal |
| **the-summit-chatroom** | App | PHP, Python, Docker | Dual | 152 lines | 37 lines | Minimal |

---

## ambient-scribe - Full Tier, Dual Agent

**Shape:** App (PHP + TypeScript + Python + NeMo GPU + Mercure, Docker Compose)
**Agents:** Claude Code + Codex

The most complete implementation. Has every artifact the framework defines.

### Artifacts Found

| Category | Artifact | Lines | Notes |
|----------|----------|-------|-------|
| **Layer 1** | CLAUDE.md | 53 | Under 120-line app target |
| **Layer 1** | AGENTS.md | 119 | Codex instruction file |
| **Enforcement** | .claude/settings.json | 35 | Permissions deny list |
| **Enforcement** | .claude/hooks/ | 3 files | Stop, deny-dangerous, format hooks |
| **Enforcement** | scripts/deny-dangerous.sh | 101 | Codex deny script |
| **Enforcement** | scripts/preflight-checks.sh | 456 | Comprehensive preflight |
| **Enforcement** | scripts/context-validate.sh | 89 | Context validation |
| **Skills** | .claude/skills/ | 5 files | Full skill set |
| **Playbooks** | docs/codex-playbooks/ | 5 files | Full Codex playbook set |
| **Learning Loop** | docs/lessons.md | 20 | Active |
| **Learning Loop** | docs/footguns.md | 63 | With evidence |
| **Learning Loop** | docs/confusion-log.md | 11 | App-specific |
| **Docs** | docs/architecture.md | 38 | Under 100-line target |
| **Docs** | docs/guidelines-ownership-split.md | 43 | Clean split |
| **Local Context** | .github/instructions/ | 7 files | Domain-scoped |
| **Evals** | agent-evals/ | 6 files | Claude Code evals |
| **Evals** | codex-evals/ | 8 files | Codex evals |
| **CI** | .github/workflows/context-validation.yml | 67 | Automated checks |
| **Handoff** | tasks/handoff-template.md | 16 | Template present |

**What makes this notable:** Only project with both agent-evals/ AND codex-evals/. Full dual-agent implementation with all enforcement layers. Good example of a complex multi-language app with complete framework coverage.

---

## devgoat - Standard Tier, Dual Agent

**Shape:** App (Tauri desktop app, TypeScript + Rust)
**Agents:** Claude Code + Codex

### Artifacts Found

| Category | Artifact | Lines | Notes |
|----------|----------|-------|-------|
| **Layer 1** | CLAUDE.md | 121 | Just over 120-line app target |
| **Layer 1** | AGENTS.md | 153 | Codex instruction file |
| **Enforcement** | .claude/settings.json | 36 | Permissions deny list |
| **Enforcement** | .claude/hooks/ | 3 files | Hooks present |
| **Enforcement** | scripts/preflight-checks.sh | 970 | Large preflight script |
| **Skills** | .claude/skills/ | 5 files | Full skill set |
| **Learning Loop** | docs/lessons.md | 47 | Most active lessons file |
| **Learning Loop** | docs/footguns.md | 202 | Largest footguns file (cross-domain Tauri complexity) |
| **Learning Loop** | docs/confusion-log.md | 12 | App-specific |
| **Local Context** | .github/instructions/ | 6 files | Domain-scoped |
| **Evals** | agent-evals/ | 6 files | Claude Code evals |
| **CI** | .github/workflows/context-validation.yml | 75 | Automated checks |
| **Handoff** | tasks/handoff-template.md | 21 | Template present |

### Missing from Full Tier
- No docs/architecture.md
- No docs/guidelines-ownership-split.md
- No codex-evals/
- No scripts/deny-dangerous.sh or scripts/context-validate.sh
- No docs/codex-playbooks/

**What makes this notable:** Largest footguns.md (202 lines) - reflects the cross-domain complexity of a Tauri app (TypeScript frontend + Rust backend). Most active lessons.md (47 lines). The Tauri app referenced in the design rationale as the project where dual DoD files caused unpredictable agent behaviour.

---

## devgoat-bash-scripts - Full Tier, Dual Agent

**Shape:** Script Collection (Bash + PHP utilities)
**Agents:** Claude Code + Codex

### Artifacts Found

| Category | Artifact | Lines | Notes |
|----------|----------|-------|-------|
| **Layer 1** | CLAUDE.md | 100 | Exactly at 100-line library/collection target |
| **Layer 1** | AGENTS.md | 135 | Codex (35% larger than CLAUDE.md, as expected) |
| **Enforcement** | .claude/settings.json | 31 | Permissions deny list |
| **Enforcement** | .claude/hooks/ | 2 files | Hooks present |
| **Enforcement** | scripts/deny-dangerous.sh | 207 | Largest deny script |
| **Enforcement** | scripts/preflight-checks.sh | 124 | Preflight |
| **Enforcement** | scripts/context-validate.sh | 252 | Context validation |
| **Skills** | .claude/skills/ | 5 files | Full skill set |
| **Playbooks** | docs/codex-playbooks/ | 5 files | Full Codex playbook set |
| **Learning Loop** | docs/lessons.md | 18 | Active |
| **Learning Loop** | docs/footguns.md | 85 | With evidence |
| **Docs** | docs/architecture.md | 47 | Under 100-line target |
| **Docs** | docs/guidelines-ownership-split.md | 25 | Clean split |
| **Local Context** | .github/instructions/ | 5 files | Domain-scoped |
| **Evals** | agent-evals/ | 6 files | Claude Code evals |
| **Evals** | codex-evals/ | 6 files | Codex evals |
| **CI** | .github/workflows/context-validation.yml | 60 | Automated checks |
| **Handoff** | tasks/handoff-template.md | 24 | Template present |

**What makes this notable:** AGENTS.md is 135 lines vs CLAUDE.md at 100 - confirms the 35% increase documented in the cross-agent comparison (Codex has no hook offloading). Full tier despite being a script collection. The bash collection referenced in the article as the project where the line count trade-off was measured.

---

## sus-form-detector - Standard Tier, Dual Agent

**Shape:** Library (PHP + Python)
**Agents:** Claude Code + Codex

### Artifacts Found

| Category | Artifact | Lines | Notes |
|----------|----------|-------|-------|
| **Layer 1** | CLAUDE.md | 107 | Over 100-line library target |
| **Layer 1** | AGENTS.md | 43 | Minimal Codex file |
| **Enforcement** | .claude/settings.json | 42 | Permissions deny list |
| **Enforcement** | .claude/hooks/ | 3 files | Hooks present |
| **Enforcement** | scripts/preflight-checks.sh | 482 | Preflight |
| **Skills** | .claude/skills/ | 3 files | Missing /goat-research, /goat-review |
| **Learning Loop** | docs/lessons.md | 16 | Active |
| **Learning Loop** | docs/footguns.md | 82 | With evidence |
| **Local Context** | .github/instructions/ | 2 files | Minimal domain files |
| **Evals** | agent-evals/ | 6 files | Claude Code evals |
| **CI** | .github/workflows/context-validation.yml | 66 | Automated checks |
| **Handoff** | tasks/handoff-template.md | 16 | Template present |

### Missing from Full Tier
- No docs/architecture.md
- No docs/confusion-log.md
- No docs/guidelines-ownership-split.md
- No codex-evals/
- No scripts/deny-dangerous.sh or scripts/context-validate.sh
- No docs/codex-playbooks/

**What makes this notable:** Only 3 skills currently installed - /goat-research and /goat-review should be added to reach the full 5-skill set. AGENTS.md is minimal (43 lines) compared to CLAUDE.md (107 lines) - opposite ratio from the bash collection.

---

## blundergoat-platform - Minimal Tier, Claude Code Only

**Shape:** App (TypeScript, Docker Compose)
**Agents:** Claude Code only

### Artifacts Found

| Category | Artifact | Lines | Notes |
|----------|----------|-------|-------|
| **Layer 1** | CLAUDE.md | 62 | Well under target |
| **Learning Loop** | docs/footguns.md | 73 | With evidence |
| **Docs** | docs/architecture.md | 148 | Over 100-line target |
| **Enforcement** | scripts/preflight-checks.sh | 1540 | Largest preflight (platform complexity) |
| **Local Context** | .github/instructions/ | 7 files | Domain-scoped |

### Missing
- No AGENTS.md, no .claude/settings.json, no .claude/hooks/
- No docs/lessons.md, no docs/confusion-log.md
- No skills, no evals, no CI validation, no handoff template
- No enforcement deny list

**What makes this notable:** Minimal tier but with the largest preflight script (1540 lines) and most domain instruction files (7). Shows that preflight complexity doesn't correlate with framework adoption tier. The architecture.md at 148 lines exceeds the 100-line recommendation.

---

## the-summit-chatroom - Minimal Tier, Dual Agent

**Shape:** App (PHP + Python, Docker Compose)
**Agents:** Claude Code + Codex (minimal)

### Artifacts Found

| Category | Artifact | Lines | Notes |
|----------|----------|-------|-------|
| **Layer 1** | CLAUDE.md | 152 | Over 150-line limit (anti-pattern AP1) |
| **Layer 1** | AGENTS.md | 37 | Minimal Codex file |
| **Enforcement** | .claude/settings.json | 25 | Settings present |
| **Enforcement** | scripts/preflight-checks.sh | 446 | Preflight |
| **Skills** | .claude/skills/ | 3 files | Partial skill set |
| **Local Context** | .github/instructions/ | 7 files | Domain-scoped |

### Missing
- No docs/ learning loop files (lessons, footguns, confusion-log)
- No docs/architecture.md
- No .claude/hooks/
- No agent-evals/ or codex-evals/
- No CI validation workflow
- No handoff template
- No deny-dangerous script

**What makes this notable:** CLAUDE.md at 152 lines triggers anti-pattern AP1 (-5 deduction). Good example of a project that needs the framework's governance - has skills and domain instructions but no learning loop or enforcement. Would benefit from running Phase 1a to restructure the instruction file.

---

## Patterns Across Projects

### Line Count Data

| Project | Shape | CLAUDE.md | Target | AGENTS.md | Ratio |
|---------|-------|-----------|--------|-----------|-------|
| ambient-scribe | App | 53 | 120 | 119 | 2.2x |
| devgoat | App | 121 | 120 | 153 | 1.3x |
| devgoat-bash-scripts | Collection | 100 | 80 | 135 | 1.35x |
| sus-form-detector | Library | 107 | 100 | 43 | 0.4x |
| blundergoat-platform | App | 62 | 120 | -- | -- |
| the-summit-chatroom | App | 152 | 120 | 37 | 0.2x |

### Adoption Tier Distribution

| Tier | Projects | Common Pattern |
|------|----------|----------------|
| **Full** | ambient-scribe, devgoat-bash-scripts | Both are dual-agent with all enforcement layers, evals, CI, codex-playbooks |
| **Standard** | devgoat, sus-form-detector | Have skills, hooks, learning loop, evals, but missing some docs and codex coverage |
| **Minimal** | blundergoat-platform, the-summit-chatroom | CLAUDE.md + some supporting files, no enforcement deny list, no learning loop |

### What Full Tier Projects Have That Others Don't

1. Both agent-evals/ AND codex-evals/
2. scripts/deny-dangerous.sh + scripts/context-validate.sh
3. docs/guidelines-ownership-split.md
4. docs/codex-playbooks/ (5 files)
5. Complete .claude/hooks/ set
6. CI context-validation workflow

### Anti-Patterns Observed

| Anti-Pattern | Project | Detail |
|-------------|---------|--------|
| AP1: Instruction file over 150 lines | the-summit-chatroom | CLAUDE.md at 152 lines |
| Architecture doc over 100 lines | blundergoat-platform | docs/architecture.md at 148 lines |
| CLAUDE.md over line target | devgoat | 121 lines (target: 120 for app) |
| CLAUDE.md over line target | sus-form-detector | 107 lines (target: 100 for library) |

---

## Real Example Artifacts

### Example CLAUDE.md (devgoat-bash-scripts, 100 lines)

This is the complete CLAUDE.md from a real Script Collection project implementing the full GOAT Flow system. It scores 100 on the line target and contains all Layer 1 sections: execution loop, autonomy tiers, DoD, router table, stack definition, and working memory.

```markdown
# CLAUDE.md - v1.0 (2026-03-15)

Shell script library. Drop-in or template scripts under `lib/`. Bats test suite under `tests/`.

## Essential Commands

```bash
bash -n path/to/script.sh            # Syntax-check
shellcheck path/to/script.sh         # Lint
bats tests/ --recursive              # Run test suite
./preflight-checks.sh                # Quality gate
```

## Execution Loop: READ → CLASSIFY → ACT → VERIFY → LOG

**READ** - MUST read relevant files before changes. Cross-domain: MUST read both sides.
```
❌ "The _common.sh uses parent traversal" (guessed)
✅ Read lib/stacks/_common.sh → confirmed: source "../_common.sh"
```

**CLASSIFY** - MUST declare mode (Plan/Implement/Explain/Debug/Review) before acting. Question = answer it; directive = act on it. MUST NOT infer implementation from a question.

**ACT** - MUST declare: `State: [MODE] | Goal: [one line] | Exit: [condition]`

| Mode | Behaviour |
|------|-----------|
| Plan | Produce artefact only. No app code. Exit on LGTM |
| Implement | Code in 2-3 turns. 4th read without writing = stop |
| Explain | Walkthrough only. No code changes unless asked |
| Debug | Diagnosis with file:line first. Fixes after human reviews |
| Review | Investigate first. Never blindly apply suggestions |

```
❌ Created abstract logging base class (one implementation)
✅ Inline functions. Extract when second consumer appears
```

**VERIFY** - MUST run after each change: `bash -n` → `shellcheck` → `bats tests/ --recursive`
- Level 1 (isolated failure): note, continue
- Level 2 (cross-domain/security): MUST full stop, diagnosis with file:line, wait for human
- Two corrections on same approach = MUST rewind

**LOG** - SHOULD append to `docs/lessons.md` (behavioural mistakes) or `docs/footguns.md` (cross-domain traps with file:line evidence). SHOULD load footguns.md when touching Ask First boundaries.

## Autonomy Tiers

**Always:** Run tests/lint, read any file, write scripts, append to log files

**Ask First** (MUST complete micro-checklist: boundary, related code read, footgun checked, rollback command):
- `_common.sh` / `_aws-common.sh` changes (sourced by many scripts)
- CONFIGURATION block interface changes (adding/removing variables)
- Scripts in `lib/ai-cli/` that sanitise WSL PATH
- Adding new domains/directories under `lib/`
- Changing a script's logging paradigm (must match siblings)
- Editing `.github/instructions/` files
- Cross-domain changes. Strict mode exception changes

**Never:** Delete tests to pass builds. Modify .env/secrets. Push to main. Force push. Change CONFIGURATION block values. Commit unless asked

## Definition of Done

MUST confirm ALL: (1) `bash -n` + `shellcheck` pass (2) `bats tests/` green (3) no unapproved boundary changes (4) logs updated if tripped (5) working notes current (6) grep old pattern after renames

## Hard Rules

- MUST use `#!/usr/bin/env bash` + `set -euo pipefail` (exceptions: `docs/footguns.md`)
- MUST match sibling logging paradigm (`docs/domain-reference.md`). `_common.sh` patterns are not interchangeable
- MUST use short imperative commits. One per script. Never commit credentials
- MUST append cross-domain bugs to `docs/footguns.md` before closing

Sub-agents: ONE focused objective, structured return (paths, evidence, confidence, next step), 5-call budget.
When blocked: ask exactly one question with a recommended default. If not blocked, decide and note assumption.

## Working Memory

SHOULD use `tasks/todo.md` for 5+ turn tasks. SHOULD write `tasks/handoff.md` before ending incomplete work. Context escalation: `/compact` after 15+ turns → split if two compactions → `/clear` between unrelated tasks.

## Router Table

| Resource | Path |
|----------|------|
| Domain reference | `docs/domain-reference.md` |
| Architecture | `docs/architecture.md` |
| Code map | `docs/code-map.md` |
| Footguns | `docs/footguns.md` |
| Lessons | `docs/lessons.md` |
| Bats guide | `docs/bats-core.md` |
| Shell conventions | `.github/instructions/shell-conventions.instructions.md` |
| ai-cli domain | `.github/instructions/ai-cli.instructions.md` |
| AWS domain | `.github/instructions/aws.instructions.md` |
| Stacks domain | `.github/instructions/stacks.instructions.md` |
| Standalone domains | `.github/instructions/dev.instructions.md` |
| Preflight skill | `.claude/skills/goat-preflight/` |
| Code review skill | `.claude/skills/goat-review/` |
| Debug skill | `.claude/skills/goat-debug/` |
| Audit skill | `.claude/skills/goat-audit/` |
| Research skill | `.claude/skills/goat-research/` |
| Agent evals | `agent-evals/` |
| Handoff template | `tasks/handoff-template.md` |
```

### Example footguns.md (first 5 entries from devgoat-bash-scripts)

Real footgun entries with file:line evidence. Every entry references actual code -- no hypothetical examples.

```markdown
# Footguns

Cross-domain gotchas confirmed in this codebase. Add entries only when the repo itself demonstrates the behaviour.

## Footgun: Helper sourcing is directory-specific

**Symptoms:** A copied script cannot find its helper library, or it sources the wrong shared file after being moved.

**Why it happens:** `ai-cli`, `stacks`, and `aws` each resolve shared helpers differently, and the patterns are tied to the directory layout.

**Evidence:**
- `lib/ai-cli/install-claude.sh:11`
- `lib/stacks/node/setup.sh:17`
- `lib/aws/aws-cli.sh:13`

**Prevention:** Match the helper source pattern used by sibling files in the same domain. Do not swap `SCRIPT_DIR/_common.sh` and `../_common.sh`.

## Footgun: Only ai-cli sanitises WSL PATH

**Symptoms:** A script resolves Windows binaries from `/mnt/*` inside WSL and then fails in confusing ways.

**Why it happens:** `ai-cli/_common.sh` rejects `/mnt/*` binaries and strips those PATH entries before Node/npm checks. Other domains rely on plain `command -v`.

**Evidence:**
- `lib/ai-cli/_common.sh:54`
- `lib/ai-cli/_common.sh:65`
- `lib/aws/_aws-common.sh:101`
- `lib/workflow/git-status.sh:44`

**Prevention:** If a non-ai-cli script must be WSL-safe, add an explicit native-binary check or document the assumption instead of assuming shared sanitisation exists.

## Footgun: Strict-mode exceptions are intentional

**Symptoms:** Adding `set -e` to a verify or preflight script causes it to abort before reporting the full failure summary.

**Why it happens:** Some scripts intentionally use `set -uo pipefail` so they can accumulate failures. The root preflight script hard-codes these exceptions.

**Evidence:**
- `lib/stacks/php/verify.sh:12`
- `lib/stacks/node/preflight-checks.sh:8`
- `lib/health/check-gpu.sh:21`
- `preflight-checks.sh:251`

**Prevention:** Before changing strict mode, check whether the script is expected to keep running after a failed check and whether `preflight-checks.sh` already treats it as an exception.

## Footgun: Logging style is domain-scoped

**Symptoms:** A new script looks out of place because the log format, colours, or helper names do not match its neighbours.

**Why it happens:** The repo uses at least three logging styles: ai-cli colour output, stacks `step`/`pass` helpers, and standalone inline log functions.

**Evidence:**
- `lib/ai-cli/install-claude.sh:16`
- `lib/stacks/node/setup.sh:45`
- `lib/aws/cloudfront-invalidate.sh:56`
- `lib/maintenance/git-cleanup.sh:8`

**Prevention:** Read one sibling script in the touched directory before introducing a new logging helper or output style.

## Footgun: Root preflight only scans lib scripts

**Symptoms:** A root shell entrypoint, dashboard launcher, or workflow helper passes unnoticed even though it has syntax or lint issues.

**Why it happens:** `preflight-checks.sh` discovers scripts only under `lib/`, while valid shell entrypoints also exist at the repo root and under `dashboard/`.

**Evidence:**
- `preflight-checks.sh:242`
- `help.sh:1`
- `dashboard/start-dev.sh:1`

**Prevention:** When changing shell files outside `lib/`, run explicit `bash -n` and `shellcheck` on them or use `scripts/preflight-checks.sh`.
```
