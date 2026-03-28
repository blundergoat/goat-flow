# Rubric Reference

All checks scored by `goat-flow scan`. Organized by tier → category. Use this as a reference when interpreting scan output or planning setup work.

## Scoring Model

| Tier | Points | Purpose |
|------|--------|---------|
| Foundation | 47 | Must-have basics: instruction file, execution loop, enforcement |
| Standard | 69 | Reliable workflow: skills, hooks, learning loop, router |
| Full | 20 | Advanced quality: evals, CI, portfolio health |
| **Total** | **136** | |
| Anti-Patterns | −15 max | Deductions for actively harmful states |

Grade: A ≥ 90% · B ≥ 80% · C ≥ 70% · D ≥ 60% · F < 60%.
Confidence: **high** = file/pattern is deterministic · **medium** = heuristic · **low** = weak signal.

---

## Foundation Tier (47 pts)

The foundation tier checks that the agent has a valid instruction file and the structural conventions that prevent the most common failure modes: fabricating facts, taking irreversible actions without approval, and having no way to stop dangerous commands.

### 1.1 Instruction File (9 pts)

| ID | Check | Pts | Why |
|----|-------|-----|-----|
| 1.1.1 | Instruction file exists | 2 | Without it the agent has no persistent context. |
| 1.1.2 | Under line target (≤120, hard limit 150) | 3 | Bloated files fragment agent attention; agents start ignoring tail sections. |
| 1.1.3 | Version header | 1 | Lets agents know which revision of the rules they are reading. |
| 1.1.4 | Essential Commands section | 2 | Agents must know how to build/test/lint without asking every turn. |
| 1.1.5 | Concrete BAD/GOOD examples | 1 | Abstract rules are reinterpreted; examples anchor behaviour. |

### 1.2 Execution Loop (13 pts)

The six-step loop (READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG) is the core behavioural contract. Each step has a specific failure mode it prevents.

| ID | Check | Pts | Why |
|----|-------|-----|-----|
| 1.2.1 | READ step | 2 | Prevents fabricated file paths and guessed codebase facts. |
| 1.2.2 | CLASSIFY step | 2 | Forces complexity assessment before acting — hotfixes stay hotfixes. |
| 1.2.2a | CLASSIFY has turn/read budgets | 1 | Budgets are the forcing function; without numbers the step is decorative. |
| 1.2.3 | SCOPE step | 2 | Blast radius must be declared before acting, not discovered after. |
| 1.2.4 | ACT step with mode table | 2 | State/Goal/Exit declaration prevents mode-drift mid-task. |
| 1.2.5 | VERIFY step | 2 | Catches cross-reference breaks, lint failures, and scope overruns before handoff. |
| 1.2.6 | LOG step | 2 | Closes the learning loop — mistakes must be recorded or they repeat. |

### 1.3 Autonomy Tiers (10 pts)

| ID | Check | Pts | Why |
|----|-------|-----|-----|
| 1.3.1 | Three tiers (Always / Ask First / Never) | 2 | Binary allow/deny isn't granular enough for real work. |
| 1.3.2 | Ask First boundaries are project-specific | 3 | Template text means the agent defaults to template behaviour, not project behaviour. |
| 1.3.2a | Ask First paths resolve on disk | 2 | Broken paths make the boundary unenforceable. |
| 1.3.3 | Never tier has destructive guards | 2 | Delete, secrets, force push — must be explicit, not implicit. |
| 1.3.4 | Micro-checklist in Ask First | 1 | Five-item checklist (boundary, related code, footgun, local instruction, rollback) catches common pre-flight skips. |

### 1.4 Definition of Done (7 pts)

| ID | Check | Pts | Why |
|----|-------|-----|-----|
| 1.4.1 | DoD section exists | 2 | Without a DoD, "done" is whatever the agent decides it is. |
| 1.4.2 | 4+ explicit gates | 2 | Vague gates (e.g. "tests pass") are gamed; specificity is the point. |
| 1.4.3 | Grep-after-rename gate | 2 | Renames without grep checks leave dangling references — one of the most common post-merge bugs. |
| 1.4.4 | Log-update gate | 1 | Ensures lessons/footguns are updated before work is considered complete. |

### 1.5 Enforcement Baseline (8 pts)

| ID | Check | Pts | Why |
|----|-------|-----|-----|
| 1.5.1 | Deny mechanism exists | 3 | Without any deny mechanism, the agent can run arbitrary shell commands. |
| 1.5.2 | git commit blocked | 1 | Agents must not commit without human review. |
| 1.5.3 | git push blocked | 2 | Push is irreversible on shared branches. |
| 1.5.4 | Deny hook/script exists | 2 | Settings-only deny is per-agent; a script provides cross-agent coverage. |

---

## Standard Tier (69 pts)

Standard checks reward a fully functional workflow. A project can score A on foundation but still have no skills, broken hooks, or an empty learning loop.

### 2.1 Skills (25 pts)

Eight canonical skills exist because different task types need different interaction patterns. Each skill is 2 pts for existence, plus quality checks.

| ID | Check | Pts | Why |
|----|-------|-----|-----|
| 2.1.1–2.1.8 | goat-debug/investigate/plan/refactor/review/security/simplify/test | 2 each | Coverage of the eight core task types agents encounter. |
| 2.1.11 | All 8 present | 1 | Completeness bonus — partial skill sets leave gaps in the workflow. |
| 2.1.12 | Step 0 context gathering | 1 | Skills that act without gathering context produce wrong outputs. |
| 2.1.13 | Human gates | 1 | Agents should pause before irreversible phases, not complete end-to-end autonomously. |
| 2.1.14 | MUST/MUST NOT constraints | 1 | RFC 2119 constraints are unambiguous; soft suggestions are ignored. |
| 2.1.15 | Phased process | 1 | Phases prevent step-skipping; agents skip when no structure stops them. |
| 2.1.16 | Conversational flow | 1 | Skills that dump one-shot output miss follow-up depth; dialogue uncovers more. |
| 2.1.17 | Skill chaining | 1 | Related skills (debug → test → review) should be cross-linked. |
| 2.1.18 | Structured choices | 1 | (a)/(b)/(c) at transition points prevents yes/no gates that stall work. |
| 2.1.19 | Output format defined | 1 | Without a format spec, agents invent output shapes that vary per run. |
| 2.1.20 | Skill adaptation (not template copy) | 1 | Skills copied verbatim from the template serve the template project, not this one. |

### 2.2 Hooks (16 pts)

Hooks are the runtime enforcement layer. A missing or broken hook silently fails every time.

| ID | Check | Pts | Why |
|----|-------|-----|-----|
| 2.2.1 | settings.json valid JSON | 1 | Invalid JSON silently disables all settings-based configuration. |
| 2.2.2 | Post-turn hook registered | 2 | Without post-turn validation, every turn completes without verification. |
| 2.2.3 | Post-turn hook exits 0 | 1 | Non-zero exit causes infinite retry loops in Claude Code. |
| 2.2.4 | Post-tool hook or documented skip | 1 | Format-on-save keeps diffs clean; if skipped, must be intentional. |
| 2.2.4a | Deny hook has blocking logic | 1 | An empty deny hook that exits 0 blocks nothing. |
| 2.2.4b | Post-turn hook runs real validation | 1 | exit 0-only hooks are security theatre. |
| 2.2.4c | Compaction hook registered | 1 | After compaction, agents lose task context; the hook re-injects it. |
| 2.2.5a | Deny hook uses jq (not grep -P) | 1 | grep -P is unavailable on macOS, silently breaking the hook. |
| 2.2.5b | Deny hook splits chained commands | 1 | `safe-cmd && rm -rf /` bypasses a naive single-command check. |
| 2.2.5c | Deny hook blocks rm -rf | 1 | The single most dangerous shell command must be explicitly blocked. |
| 2.2.5d | Read-deny covers sensitive paths | 1 | Agents must not read .env, .ssh, credentials without a deny rule. |
| 2.2.5e | Deny hook blocks force push | 1 | Force push can destroy shared branch history irreversibly. |
| 2.2.5f | Deny hook blocks chmod 777 | 1 | World-writable permissions are a security vulnerability. |
| 2.2.5 | Preflight script exists | 1 | Provides a human-runnable gate before PR or release. |
| 2.2.6 | Context validation | 1 | Automated check that instruction files, router refs, and skills are consistent. |

### 2.3 Learning Loop (6 pts)

The learning loop (lessons + footguns) is the mechanism by which agent mistakes become permanent project knowledge.

| ID | Check | Pts | Why |
|----|-------|-----|-----|
| 2.3.1 | lessons.md exists | 1 | The file must exist before it can be maintained. |
| 2.3.2 | lessons.md has entries | 1 | An empty lessons file is decoration. |
| 2.3.2a | lessons.md has ≥1 entry | 1 | Target 3–5; 1 is the floor. No entries = no learning loop. |
| 2.3.3 | footguns.md exists | 2 | Cross-doc architectural traps need a dedicated home or they get forgotten. |
| 2.3.4 | Footguns have file:line evidence | 2 | Without evidence, entries are folklore; with it, agents can verify before acting. |
| 2.3.5a | Footguns have evidence labels | 1 | Labels (ACTUAL_MEASURED / DESIGN_TARGET / HYPOTHETICAL) signal how much to trust each entry. |
| 2.3.6 | Lessons file refs resolve | 1 | Stale paths mean the lesson no longer points to real code. |

### 2.4 Router Table (8 pts)

The router table is how agents navigate from a question to the right file. Without it, agents search by guessing.

| ID | Check | Pts | Why |
|----|-------|-----|-----|
| 2.4.1 | Router section exists | 1 | Required for any router checks to be meaningful. |
| 2.4.2 | Router references resolve (all=3, partial=1) | 3 | Dead links in the router are worse than no router — they misdirect. |
| 2.4.3 | Skills referenced in router | 1 | Skills not in the router are effectively hidden from the agent. |
| 2.4.4 | Learning loop in router | 1 | lessons.md and footguns.md must be reachable without searching. |
| 2.4.5 | Architecture in router | 1 | The architecture doc is the first read for system-change tasks. |
| 2.4.6 | Evals in router | 1 | Agents working on eval-related tasks need fast access. |
| 2.4.7 | Ask First paths in router | 1 | Boundary files not in the router will be missed before acting. |

### 2.5 Architecture (3 pts)

| ID | Check | Pts | Why |
|----|-------|-----|-----|
| 2.5.1 | architecture.md exists | 1 | System-level context that doesn't belong in the instruction file. |
| 2.5.2 | architecture.md ≤100 lines | 1 | Architecture docs over 100 lines contain implementation detail, not architecture. |
| 2.5.3 | decisions dir scaffolded | 1 | ADR scaffold exists for when the first real decision needs recording. |

### 2.6 Local Instructions (6 pts)

Local instruction files (ai/instructions/ or .github/instructions/) are cold-path references — not read every turn, but loaded when the agent enters that context.

| ID | Check | Pts | Why |
|----|-------|-----|-----|
| 2.6.1 | Instructions directory exists | 1 | Establishes the cold-path reference structure. |
| 2.6.2 | Router (ai/README.md) exists | 1 | Without a router, agents can't discover which instruction file to load. |
| 2.6.3 | conventions.md exists | 1 | Project-wide coding conventions in one place, not scattered in the instruction file. |
| 2.6.3a | conventions.md has real content | 1 | Template-only conventions don't encode project-specific rules. |
| 2.6.4 | code-review.md exists | 1 | Review checklist prevents agents from applying personal style as project standard. |
| 2.6.5 | git-commit.md exists | 1 | Commit format and PR workflow must be explicit or agents invent them. |
| 2.6.6 | .github/git-commit-instructions.md | 1 | Universal commit guidance visible to all agents regardless of agent runtime. |
| 2.6.7a | frontend.md (TS/JS projects) | 1 | Frontend patterns diverge from generic conventions; explicit file prevents inconsistency. |
| 2.6.7b | backend.md (backend projects) | 1 | Same reasoning as frontend.md, for backend languages. |

---

## Full Tier (20 pts)

Full-tier checks reward projects that have proven the workflow works: evals that catch regressions, CI that enforces quality automatically, and a clean overall structure.

### 3.1 Agent Evals (8 pts)

| ID | Check | Pts | Why |
|----|-------|-----|-----|
| 3.1.1 | agent-evals/ exists | 1 | Without evals, there is no way to catch skill regressions. |
| 3.1.3 | 5+ eval files | 2 | Coverage requires breadth; 1–2 evals test one happy path. |
| 3.1.4 | Evals have replay prompts | 2 | Without a Scenario section, evals can't be replayed to verify behaviour. |
| 3.1.5 | Evals have origin labels | 1 | Real-incident evals are higher-signal than synthetic seeds. |
| 3.1.5a | Evals have Agents labels | 1 | Agent-specific evals should only run against their target agent. |
| 3.1.6 | Evals cover all 8 canonical skills | 1 | Each skill needs at least one eval — uncovered skills accumulate silent regressions. |

### 3.2 CI Validation (6 pts)

| ID | Check | Pts | Why |
|----|-------|-----|-----|
| 3.2.1 | CI workflow exists | 2 | Manual validation degrades; automated checks run on every PR. |
| 3.2.2 | CI checks line count | 1 | Instruction file bloat creeps in; CI catches it before merge. |
| 3.2.3 | CI checks router refs | 1 | Renamed files break the router; CI detects it immediately. |
| 3.2.4 | CI checks skills | 1 | Skill version drift and missing skills are caught before deploy. |
| 3.2.5 | CI triggers on PRs | 1 | A CI workflow that only runs on push misses most regressions. |

### 3.3 Hygiene (5 pts)

| ID | Check | Pts | Why |
|----|-------|-----|-----|
| 3.3.1 | Handoff template exists | 1 | Without a template, handoffs vary in quality and are often skipped. |
| 3.3.1a | Handoff template has required sections | 1 | Status, Current State, Key Decisions, Known Risks, Next Step — all five needed for useful handoff. |
| 3.3.2 | RFC 2119 language | 1 | MUST/SHOULD/MAY eliminates ambiguity about what is enforced vs. preferred. |
| 3.3.4 | Execution loop consistent across agents | 2 | Diverged loops mean the same agent behaves differently depending on which runtime is used. |

### 3.4 Portfolio Quality (1 pt)

| ID | Check | Pts | Why |
|----|-------|-----|-----|
| 3.4.2 | Cold-path instructions within line budget | 1 | ai/instructions/ files over budget get ignored as context grows. |

---

## Anti-Patterns (max −15)

Anti-patterns are deducted after positive scoring. They represent actively harmful states — not missing features, but existing setups that mislead agents or silently break enforcement.

| ID | Name | Deduction | Why |
|----|------|-----------|-----|
| AP1 | Instruction file over 150 lines | −3 | Hard limit. Agents miss tail content at 150+. |
| AP2 | Skills without goat- prefix | −3 | Name conflicts with built-in slash commands. |
| AP3 | DoD in both instruction file and guidelines | −3 | Conflicting definitions — agents pick the wrong one. |
| AP4 | Footguns without file:line evidence | −5 | Entries without evidence are unverifiable folklore, not guardrails. |
| AP5 | settings.json invalid JSON | −5 | Silently disables all settings-based configuration. |
| AP6 | Post-turn hook exits non-zero | −5 | Causes infinite retry loops. |
| AP7 | Local instruction file over 20 lines | −2 | Per-directory local files should be pointers, not documentation. |
| AP8 | Generic Ask First boundaries | −2 | Template text means template behaviour — not project behaviour. |
| AP9 | settings.local.json not gitignored | −2 | Leaks personal config into the shared repo. |
| AP11 | Empty learning loop scaffolding | −2 | Misleads agents into assuming mistakes are documented when they are not. |
| AP12 | Stale refs in footguns.md | −3 | Dead file:line evidence means the guardrail no longer points to anything real. |
| AP13 | Stale code refs in instruction file | −3 | Broken paths in router tables misdirect agents on every lookup. |
| AP14 | Duplicate skill directories | −2 | Both old and new skill names installed causes ambiguous dispatch. |
| AP15 | Outdated skill versions | −2 per skill (max −10) | Old skills miss new quality checks and safety patterns. |
