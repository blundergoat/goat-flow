# Real-World Implementations - GOAT Flow

Seven projects scanned for workflow framework adoption. These serve as reference implementations showing how the system adapts across project shapes and stacks.

---

## Summary

| Project | Shape | Stack | Agent | CLAUDE.md | AGENTS.md | Tier |
|---------|-------|-------|-------|-----------|-----------|------|
| **rampart** | App (Tauri 2) | TypeScript, Rust, Python, Docker | Dual | 120 | 123 | Full |
| **ambient-scribe** | App | PHP, TypeScript, Python, Docker | Dual | 119 | 124 | Full |
| **sus-form-detector** | Library | PHP, Python | Dual | 109 | 111 | Full |
| **devgoat-bash-scripts** | Collection | Bash, PHP | Dual | 119 | 133 | Full |
| **blundergoat-platform** | App | Go, TypeScript | Dual | 116 | 125 | Full |
| **goat-flow** | Library | Markdown, Bash | Dual | 120 | 108 | Full |
| **the-summit-chatroom** | App | PHP, Python, Docker | Dual | 152 | 37 | Minimal |

---

## rampart - Full Tier, Claude Code Only

**Shape:** App (Tauri 2 desktop app, React 19 + Rust + Python FastAPI agents in Docker)
**Agents:** Claude Code only

The most complete single-agent implementation. First project where GOAT Flow was set up by an agent using the setup prompts, then audited and gaps fixed. The retrospective produced the bug-to-loop-step mapping that led to adding SCOPE as an explicit step and complexity budgets to CLASSIFY.

### Artifacts Found

| Category | Artifact | Lines | Notes |
|----------|----------|-------|-------|
| **Layer 1** | CLAUDE.md | 118 | Under 120-line app target (post-fix) |
| **Enforcement** | .claude/settings.json | 43 | Permissions deny + 3 hooks |
| **Enforcement** | .claude/hooks/ | 3 files | deny-dangerous, stop-lint, format-file |
| **Skills** | .claude/skills/ | 5 files | Full skill set |
| **Learning Loop** | docs/footguns.md | 60 | 4 entries with file:line evidence |
| **Learning Loop** | docs/lessons.md | 12 | Empty template (new project) |
| **Learning Loop** | docs/confusion-log.md | 12 | 1 real entry (plugin API) |
| **Docs** | docs/architecture.md | 51 | Component diagram + data flow |
| **Docs** | docs/decisions/ | 3 ADRs | Agent-first UI, Tauri+Docker hybrid, run-scoped streaming |
| **Local Context** | agents/CLAUDE.md | 9 | Python-specific, references ADR-012 |
| **Local Context** | src-tauri/src/strands/CLAUDE.md | 8 | Rust-specific, references ADR-013 |
| **Evals** | agent-evals/ | 4 files | All from real incidents |
| **Profiles** | .claude/profiles/ | 3 files | frontend, backend, agents |
| **CI** | .github/workflows/context-validation.yml | 87 | Full validation suite |
| **Ignore** | .copilotignore + .cursorignore | 6 each | Standard secret patterns |

**What makes this notable:** First implementation where the setup prompts were used end-to-end, then audited against the spec. The audit found 4 gaps (missing SCOPE, no complexity budgets, LOG severity wrong, router table incomplete) — all traced to instruction template gaps, not agent errors. The fixes were applied back to `setup/shared/execution-loop.md`, improving the instructions for all future implementations. The retrospective mapping 6 real bugs to execution loop steps is now in this document.

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
| **Layer 1** | CLAUDE.md | 100 | Under 120-line target |
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
| **Layer 1** | CLAUDE.md | 107 | Under 120-line target |
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

### Adoption Tier Distribution (post v0.2)

| Tier | Projects | Common Pattern |
|------|----------|----------------|
| **Full** | rampart, ambient-scribe, sus-form-detector, devgoat-bash-scripts, blundergoat-platform, goat-flow | Dual-agent (CLAUDE.md + AGENTS.md), all enforcement layers, shared agent-evals/, codex-playbooks, CI validation |
| **Minimal** | the-summit-chatroom | CLAUDE.md exists but predates GOAT Flow v0.2, no enforcement |

### What Full Tier Projects Have

1. agent-evals/ with Origin + Agents labels (single shared directory)
2. scripts/deny-dangerous.sh + scripts/context-validate.sh + scripts/preflight-checks.sh
3. docs/guidelines-ownership-split.md
4. docs/codex-playbooks/ (5 goat-* files)
5. Complete .claude/hooks/ set (deny-dangerous, stop-lint, format-file where applicable)
6. CI context-validation workflow
7. .copilotignore + .cursorignore
8. settings.json with Read deny patterns
9. Both CLAUDE.md and AGENTS.md with 6-step loop, SCOPE, budgets, 5-item Ask First checklist

### Anti-Patterns Observed

| Anti-Pattern | Project | Detail |
|-------------|---------|--------|
| AP1: Instruction file over 150 lines | the-summit-chatroom | CLAUDE.md at 152 lines (not yet updated to v0.2) |

---

## Retrospective: Would GOAT Flow Have Prevented These Bugs?

Real bugs from the Rampart project (Tauri 2 + React 19 + Python FastAPI, App shape) mapped to which execution loop step would have caught them. GOAT Flow was set up after implementation, so these are honest "would-have" assessments, not hindsight rewrites.

| Bug | Root Cause | Loop Step | Would it have helped? |
|-----|-----------|-----------|----------------------|
| **Blank screen (circular dep)** | `agentStore.ts` imports `agentBridge.ts` imports `agentStore.ts` | **SCOPE** | Yes. Declaring the dependency graph before writing would have surfaced the cycle. Now documented as a footgun with `file:line` evidence. |
| **OpenSSL build failure** | `setup-initial.sh` didn't install system libs for Tauri on Linux | **READ** | Yes. "MUST read relevant files first" — reading Tauri's Linux prerequisites docs before writing the setup script would have caught this. |
| **AppHandle generic** | Used bare `AppHandle` not `AppHandle<tauri::Wry>` in Tauri 2 | None | No. Knowledge gap about Tauri 2 API changes. Footgun + agent eval prevent recurrence but couldn't have prevented the first hit. |
| **sqlx vs tauri-plugin-sql** | Tried raw sqlx queries against plugin internals | **READ** | Yes. Reading the plugin's source before writing 50 lines of sqlx commands would have revealed the API is JS-first. |
| **setup-verify.sh missing** | Script printed "run setup-verify.sh" without creating it | **VERIFY** | Yes. "MUST run tests after each meaningful change" — running the referenced script would have caught it instantly. |
| **Pre-commit hooks (unwanted)** | Built a feature nobody asked for | **SCOPE** | Yes. "non-goals" declaration would have surfaced this. Also an Ask First boundary violation (new feature without approval). |

**Takeaway:** 4 of 6 bugs were preventable by existing loop steps (READ, SCOPE, VERIFY). 1 was a knowledge gap (not preventable by process). 1 was an autonomy tier violation (SCOPE + Ask First). The execution loop doesn't eliminate bugs — it eliminates *categories* of bugs that stem from skipping investigation.

**What the system provided after the fact:**
- 4 footgun entries with `file:line` evidence → next agent won't hit the same traps
- 4 agent evals → regression tests replay known failure modes after CLAUDE.md changes
- 3 permission profiles (frontend/backend/agents) → scope future agents to one stack
- deny-dangerous.sh → mechanically blocks destructive commands before execution

---

## Real Example Artifacts

### Example CLAUDE.md (goat-flow, 120 lines — current v0.2 spec)

This is the complete CLAUDE.md from the goat-flow project itself. It demonstrates the full v0.2 spec: 6-step loop with SCOPE, complexity budgets, 5-item Ask First checklist, mechanical LOG trigger, human correction trigger, footgun propagation, dual-agent router references, and all required sections (a)-(i).

See the actual file at the project root for the live version.

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
