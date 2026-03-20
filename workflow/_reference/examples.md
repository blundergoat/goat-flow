# Real-World Implementations — GOAT Flow

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

## ambient-scribe — Full Tier, Dual Agent

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

## devgoat — Standard Tier, Dual Agent

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

**What makes this notable:** Largest footguns.md (202 lines) — reflects the cross-domain complexity of a Tauri app (TypeScript frontend + Rust backend). Most active lessons.md (47 lines). The Tauri app referenced in the design rationale as the project where dual DoD files caused unpredictable agent behaviour.

---

## devgoat-bash-scripts — Full Tier, Dual Agent

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

**What makes this notable:** AGENTS.md is 135 lines vs CLAUDE.md at 100 — confirms the 35% increase documented in the cross-agent comparison (Codex has no hook offloading). Full tier despite being a script collection. The bash collection referenced in the article as the project where the line count trade-off was measured.

---

## sus-form-detector — Standard Tier, Dual Agent

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
| **Skills** | .claude/skills/ | 3 files | Missing /research, /code-review |
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

**What makes this notable:** Only 3 skills currently installed — /research and /code-review should be added to reach the full 5-skill set. AGENTS.md is minimal (43 lines) compared to CLAUDE.md (107 lines) — opposite ratio from the bash collection.

---

## blundergoat-platform — Minimal Tier, Claude Code Only

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

## the-summit-chatroom — Minimal Tier, Dual Agent

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

**What makes this notable:** CLAUDE.md at 152 lines triggers anti-pattern AP1 (-5 deduction). Good example of a project that needs the framework's governance — has skills and domain instructions but no learning loop or enforcement. Would benefit from running Phase 1a to restructure the instruction file.

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
