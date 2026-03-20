# AI Workflow System Specification

**Version:** v0.7 | Based on ai-workflow-improvement-plan-prime v1.5

**Implements:** 5-layer architecture with default execution loop

---

## System Architecture

Five layers. Only Layer 1 loads every session. Everything else loads on demand.

```
Layer 1 -- Runtime (CLAUDE.md, ~100-120 lines)
    READ -> CLASSIFY -> ACT -> VERIFY -> LOG loop
    Autonomy tiers, stop-the-line, mode switch, definition of done
    Router table pointing to everything below

Layer 2 -- Local Context (directory-level CLAUDE.md files)
    Auto-loaded when Claude works in that directory
    High-risk boundaries, module-specific gotchas, local conventions

Layer 3 -- Skills (loaded via slash commands)
    /goat-preflight, /goat-debug, /goat-audit, /goat-research, /goat-review

Layer 4 -- Playbooks (planning tools, loaded on demand)
    Mob elaboration, SBAO planning, milestone planning

Layer 5 -- Evaluation (quality infrastructure)
    Agent eval suite, CI context validation
```

**Implementation scope:** Phase 1 builds Layers 1-3. Phase 2 builds Layer 5 and enhances Layers 1-4.

### Guidelines Ownership Split

CLAUDE.md and shared coding standards (`.github/instructions/ai-agent-guidelines.instructions.md` or similar) MUST NOT overlap. Duplication creates conflicting specifics and wastes instruction budget.

**CLAUDE.md owns** (project-specific): execution loop, autonomy tiers, Definition of Done, log file references, router table, essential commands, working memory/handoff conventions.

**ai-agent-guidelines owns** (shared across projects): operating principles, engineering best practices, communication style, error handling patterns, task management templates, git/change hygiene.

**The test:** if a rule would be identical across every project, it belongs in guidelines. If it changes per project, it belongs in CLAUDE.md.

**When adopting with existing guidelines:** audit for overlap. Remove execution loop, DoD, stop-the-line, working memory, or autonomy tier content from the guidelines file. Create `docs/guidelines-ownership-split.md` documenting what was moved and why.

**Sharpening the boundary for fuzzy cases:** Some rules sit at the boundary (e.g., "git hygiene: one logical change per commit"). Apply this test: does the rule change HOW THE AGENT BEHAVES (workflow -> CLAUDE.md) or does it define WHAT GOOD CODE LOOKS LIKE (engineering -> guidelines)? "One logical change per commit" defines good code practices -> guidelines. "Always run tests before declaring done" defines agent behaviour -> CLAUDE.md.

### Layer 2: Local CLAUDE.md Files

Claude Code auto-reads `CLAUDE.md` in the working directory plus ancestors up to the project root. A file at `src/auth/CLAUDE.md` loads every time Claude touches auth code.

**Include:** module-specific footguns (1-2 lines each), local convention differences, cross-boundary warnings, module-specific hard constraints. **Max ~20 lines.**

**Exclude:** duplicated project-wide rules, full architectural explanations, anything already covered by `.github/instructions/` files with `applyTo` scoping.

**Relationship to footguns.md:** `docs/footguns.md` remains the central index. Footgun entries mapping to a specific directory are **propagated** (not moved) as one-line summaries. The central file is the source of truth.

**Create when:** a module has 2+ footgun/confusion-log entries, is an Ask First boundary, or has conventions differing from default. **Do not create** for every directory, simple modules, flat-structure libraries, or directories already covered by instruction files.

### Project Shape: App vs Library vs Collection

| Aspect                  | App (e.g., Tauri, Symfony)             | Library (e.g., PHP package, npm module)                | Script Collection (e.g., domain-organised shell scripts) |
| ----------------------- | -------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| CLAUDE.md line target   | ~120 lines                             | ~100 lines                                             | ~100 lines                                               |
| Skills                  | 5 (all core)                           | 5 (all core)                                           | 5 (all core)                                             |
| Ask First boundaries    | Auth, routing, deployment, API, DB     | Public API, dependencies, config/data files            | Shared sourced files, CONFIGURATION blocks, new domains  |
| Local CLAUDE.md files   | Likely needed for high-risk dirs       | Create where needed                                    | Create where needed                                      |
| confusion-log.md        | Yes                                    | Yes                                                    | Yes                                                      |
| Agent evals             | Real incidents                         | Common stack failure modes                             | Real incidents (grep `fix:` in commit history)           |
| Permission profiles     | Useful (frontend/backend/infra lanes)  | Useful                                                 | Useful                                                   |

### Skill Justification Test

A skill must have at least one of: a **distinct artefact**, a **hard workflow gate**, a **special failure mode**, or a **repeatable structured output**.

| Skill                | Justification                    | Projects |
| -------------------- | -------------------------------- | -------- |
| `/goat-preflight` | Repeatable structured output     | All      |
| `/goat-debug`     | Special failure mode + hard gate | All      |
| `/goat-audit`     | Distinct artefact + hard gate    | All      |
| `/goat-research`  | Distinct artefact + hard gate    | All      |
| `/goat-review`    | Repeatable structured output     | All      |

| Former Skill        | Now Lives                                | Why downgraded                               |
| ------------------- | ---------------------------------------- | -------------------------------------------- |
| `/annotation-cycle` | Section in mob elaboration playbook (02) | Planning refinement -- no distinct artefact   |
| `/sbao-synthesis`   | Section in SBAO planning playbook (03)   | Template, not a workflow with gates          |
| `/review-triage`    | Review branch of the default ACT step    | Normal review behaviour, not a distinct mode |
| `/revert-rescope`   | Paragraph in VERIFY/stop-the-line        | Tactic, not a workflow                       |

---

## Instruction Budget Constraint

Frontier models follow ~150-200 instructions. Claude Code's system prompt consumes ~50. CLAUDE.md budget: roughly **100-150 instructions**. Degradation is **uniform, not sequential** -- too many instructions makes the model worse at _all_ of them equally.

- Tools mentioned in AGENTS.md get used **160x more often** than unmentioned ones (GitHub 2,500-repo analysis)
- Auto-generated context files reduce success by ~3%, increase inference cost by 20%+ (HumanLayer)
- Code examples beat prose -- higher signal per token

**Governance:**

1. CLAUDE.md MUST stay under 150 lines. Target 100 (libraries) to 120 (apps). Count: `wc -l CLAUDE.md`.
2. Every rule MUST apply to every session. Situation-specific guidance belongs in skills/playbooks/local files.
3. Weekly /insights review. Quarterly audit: re-count, check for stale rules.
4. Prefer pointers over copies. Prefer code examples over prose.
5. Local CLAUDE.md files: under 20 lines each.

**Cut priority** (what to trim first if over target):

1. Essential commands -> move to separate referenced file
2. Structural debt trigger -> compress to one line
3. Communication when blocked -> compress to one line
4. Sub-agent objectives -> compress to two lines
5. Working memory details -> compress, keep handoff protocol

**Never cut:** The execution loop, autonomy tiers, or definition of done.

**Router table placement:** The router table should be positioned at the END of the instruction file. Research shows the beginning and end of the context window receive higher attention than the middle. The router table is the highest-leverage section (160x usage uplift) -- placing it at the end exploits the end-of-context attention zone.

---

## The Default Execution Loop

Every task follows: READ -> CLASSIFY -> ACT -> VERIFY -> LOG

### READ

**Problem:** Agent fabricates codebase facts without reading files.

- Read the relevant files first. Never fabricate codebase facts.
- Apps: read both sides for cross-boundary changes
- Libraries: read tests alongside implementation, data files alongside code
- Script collections: read source chains (which shared files are sourced and how)

```
BAD:  "acme-client is a local path dependency" (fabricated without reading composer.json)
GOOD: Read composer.json first -> "acme-client is installed via Packagist at ^1.3.0"
```

### CLASSIFY

**Problem:** Agent confuses questions with directives and drifts between modes silently.

Complexity: Hotfix / Standard Feature / System Change / Infrastructure Change
Mode: Plan / Implement / Explain / Debug / Review

```
BAD:  User asked "explain the auth flow" -> Claude edited auth_middleware.go
GOOD: User asked "explain the auth flow" -> Claude wrote a clear walkthrough, no changes
```

Mode transitions must be stated explicitly. If ambiguous: "Do you want me to explain this or fix it?"

Questions vs directives: if the message is a question, answer it. Do not infer an implementation action.

Anti-BDUF guard:

```
BAD:  "Created INotificationProvider interface" (only one implementation exists)
GOOD: "EmailNotifier handles notifications. Extract interface when second provider needed."
```

After classifying, declare SCOPE before acting: files allowed to change, systems allowed to change, explicit non-goals, max blast radius before escalation. See FIVE_STEP_LOOP.md for full detail.

### ACT

**Problem:** Planning loops (reads 8-12 files, produces nothing) and premature fixes.

| Mode      | Behaviour                                                                                 |
| --------- | ----------------------------------------------------------------------------------------- |
| Plan      | Produce artefact. No application code. Exit on "LGTM" or "implement"                     |
| Implement | Write code within 2-3 turns. 4th file read without writing = stop exploring, start coding |
| Explain   | Walkthrough only. No code changes unless explicitly asked                                 |
| Debug     | Diagnosis first with file:line evidence. No fixes until human reviews                     |
| Review    | Investigate independently. Never blindly apply external suggestions                       |

**State declaration (MUST):**

```
State: [MODE] | Goal: [one line] | Exit: [condition]
```

No actions outside the declared state without "Switching to [NEW STATE] because [reason]."

### VERIFY

**Problem:** Agent declares victory early -- tests pass but old patterns remain.

Run tests after each meaningful code change, not just at the end.

```
Level 1 -- Stop and Note (isolated failures):
  Flaky test, unrelated failure, non-blocking lint warning.
  -> Note in Working Notes. Continue with caution.

Level 2 -- Stop and Escalate (cross-boundary or security):
  Apps: auth, routing, deployment, API contracts, DB integrity.
  Libraries: public API changes, data file corruption, thresholds.
  Collections: shared source file breakage, cross-domain output contracts.
  -> Full stop. Preserve error output. Write diagnosis with file:line. Wait for human.
```

These are examples. Adapt to your project's actual risk boundaries during Phase 1a setup.

Revert-and-rescope: (1) Esc + restate approach, (2) git revert + rescope, (3) /clear + handoff. Two corrections on the same issue = cut your losses (applies to _approach_, not legitimate multi-step work).

### LOG

**Problem:** Agent repeats the same mistakes across sessions.

| File                    | When                                    | Example                                                                 |
| ----------------------- | --------------------------------------- | ----------------------------------------------------------------------- |
| `docs/lessons.md`       | Behavioural mistake (agent did wrong)   | "Assumed API contract without reading frontend"                         |
| `docs/footguns.md`      | Architectural landmine (cross-domain)   | "Auth nonce spans 4 components; breaking any one silently breaks login" |
| `docs/confusion-log.md` | Structural confusion (hard to navigate) | "Unclear which module owns session validation"                          |

Log hygiene: `created_at` date on each entry. lessons.md max 15 active entries (3+ shared theme -> promote to Pattern). footguns.md: cross-domain only with real evidence. Quarterly: entries not triggered in >30 days -> propose archive. Contested entries: append `CONTESTED` with evidence. Footgun propagation: one-line summary to relevant local CLAUDE.md.

**Dual-agent coordination:** If both CLAUDE.md and AGENTS.md share `docs/footguns.md`, define one agent as owner or adopt merge-and-flag. Simplest: run Claude Code first (creates docs), then Codex (merges with existing).

---

## Autonomy Tiers

Structure is fixed; boundaries are project-specific.

```
Always do (no confirmation needed):
- Run tests, linting, formatting
- Read any file in the codebase
- Write to files within assigned scope
- Append to lessons.md, footguns.md, confusion-log.md

Ask First (pause and confirm with human):
  Apps: auth, routing, deployment, API contracts, DB schemas, CI/CD, cross-boundary, new dirs
  Libraries: public API signatures, dependencies, config/data files, thresholds, binary files
  Collections: shared source files, CONFIGURATION blocks, logging paradigm, new domains

  Micro-checklist (MUST for all Ask First items):
  - [ ] Boundary touched: [name it]
  - [ ] Related code read: [yes/no]
  - [ ] Footgun entry checked: [relevant entry, or "none"]
  - [ ] Local CLAUDE.md checked: [warnings, or "no local file"]
  - [ ] Rollback command: [exact command]

Never do:
- Delete test files or remove failing tests to make builds pass
- Modify .env files or secrets
- Push to main/production branches
- Change file permissions or security configurations
- Make git commits unless explicitly asked
- Edit files outside the current project repository
- Modify lockfiles (package-lock.json, pnpm-lock.yaml, composer.lock, Cargo.lock)
- Modify generated code, migration files, or compiled artifacts

Lockfile/generated rationale: agents hallucinate dependency version bumps to fix type errors.
```

**Enforcement (strongest first):**

| Layer | Mechanism | Scope | Bypass risk |
|-------|-----------|-------|-------------|
| 1. Permissions deny | `settings.json` tool-level block | `*git commit*`, `*git push*` blocked entirely | None |
| 2. deny-dangerous.sh | PreToolUse hook pattern inspection | `--force`, `--no-verify`, `rm -rf`, `.env` edits | Low |
| 3. CLAUDE.md rules | Behavioural guidance | Everything else in the Never tier | Medium (~70%) |

Binary prohibitions -> permissions deny. Pattern prohibitions -> hooks. Judgement calls -> CLAUDE.md rules.

## Definition of Done

```
A task is NOT done until ALL are true:
1. Relevant tests green (tests covering the change, not just "no errors")
2. All MUST-level preflight items pass
3. No cross-boundary change without Ask First justification
4. If you tripped: lessons.md / footguns.md updated
5. Working Notes in tasks/todo.md are current
6. After bulk renames/refactors: grep for old pattern, confirm ZERO remaining references
```

## Anti-Pattern Deductions

Max -15 total. Applied after tier scoring. Final score cannot drop below 0.

| ID | Anti-Pattern | Detection | Deduction |
|----|-------------|-----------|-----------|
| AP1 | Instruction file over 150 lines | `wc -l {instruction_file}` > 150 | -3 |
| AP2 | Skill name conflicts with built-in | `{skills_dir}` contains a skill name that shadows a built-in agent command | -3 |
| AP3 | DoD in both instruction file and guidelines | DoD section found in both files | -3 |
| AP4 | Footguns without evidence | `docs/footguns.md` exists but zero `file:|line:` references | -5 |
| AP5 | Settings.json invalid JSON | `JSON.parse()` throws | -5 |
| AP6 | Stop hook exits non-zero | Last exit in stop hook is not `exit 0` | -5 |
| AP7 | Local instruction file over 20 lines | Any local file `wc -l` > 20 | -2 |
| AP8 | Generic Ask First boundaries | Ask First section matches known template text verbatim | -2 |
| AP9 | settings.local.json committed | `git ls-files .claude/settings.local.json` returns match | -2 |
| AP10 | Incident without footgun/lesson entry | Incident occurred but no corresponding entry in learning loop | -2 |
| AP11 | Mandatory-but-dead artifacts | Required file empty after 6+ months of active development | -2 |

## Working Memory and Handoffs

For tasks exceeding 5 turns: maintain Working Notes in tasks/todo.md. Context escalation: `/compact` after 15+ turns -> two compactions = split sub-tasks -> `/clear` between unrelated tasks -> worktrees for parallel work. Handoff: write tasks/handoff.md before ending incomplete work.

For within-session state persistence, use `.claude/tasks/session-current.md`. This complements the escalation ladder (scratchpad -> handoff -> ask human) by providing a file the agent can read and write during the session that persists across tool calls.

**Multi-agent contention:** When multiple developers have agents running against the same codebase concurrently:
- Learning loop files (footguns.md, lessons.md) may have merge conflicts. Use git's merge resolution - entries are append-only, so conflicts are additive.
- Avoid concurrent edits to the same files. Use git worktrees for isolation when possible.
- If two agents edit docs/footguns.md simultaneously, both sets of entries should be kept. Review for duplicates after merge.

## Sub-Agent Objectives

One focused objective per sub-agent with concrete deliverable format. Required return: paths, evidence, confidence, next step. Tool call budget: 5 per sub-agent.

**Sub-agent patterns:** Fresh-context (recommended default), parallel teams (independent tasks), role-based delegation (SDLC phases). See docs/five-layers.md for full strategy.

## Stack Definition

```yaml
# Example: Tauri app (React + Rust)
stack:
  languages: [typescript, rust]
  build: cargo build --manifest-path src-tauri/Cargo.toml
  test: pnpm test && cargo test --manifest-path src-tauri/Cargo.toml
  lint: pnpm lint
  format: npx prettier --write {file}

# Example: PHP library
stack:
  languages: [php]
  test: composer test
  lint: composer analyse
  format: composer cs:fix

# Example: Shell script collection
stack:
  languages: [bash]
  test: bats tests/ --recursive
  lint: shellcheck
  format: # none (skip PostToolUse hook)
```

## Adoption Tiers

| Tier         | What you get                                               | When to use                              |
| ------------ | ---------------------------------------------------------- | ---------------------------------------- |
| **Minimal**  | CLAUDE.md + deny-dangerous hook + permissions deny         | Solo project, getting started            |
| **Standard** | + skills + stop/format hooks + local CLAUDE.md files       | Active development, team project         |
| **Full**     | + agent evals + CI validation + permission profiles + ADRs | Long-lived project with incident history |

---

## Phase 1 Skills

**`/goat-preflight`** -- Mechanical build verification. MUST: type-check + lint + compile. SHOULD: full test suite, formatter check. MAY: skip formatter during debugging. MUST NOT: report complete if any MUST item fails.

**`/goat-debug`** -- Diagnosis-first mode. (1) Read actual code paths, trace end-to-end. (2) Write findings with file:line evidence -- no fixes yet. (3) Only after human reviews: propose fix.

**`/goat-audit`** -- Multi-pass codebase audit. Pass 1: scan, log with file:line evidence. Pass 2: re-read each finding, remove false positives. Pass 3: rank by severity/blast radius. Pass 4: self-check -- "did I fabricate this?"

**`/goat-research`** -- Deep codebase read producing research.md. Hard gate: no planning until human reviews.

**`/goat-review`** -- Structured review with RFC 2119 constraints and autonomy tiers.

---

## Phase 1 Files

| File                                  | Purpose                      | Seed Content                                        |
| ------------------------------------- | ---------------------------- | --------------------------------------------------- |
| `docs/domain-reference.md`            | Project domain knowledge     | Migrated from existing CLAUDE.md (Prompt B only)    |
| `docs/lessons.md`                     | Behavioural learning loop    | Format header + empty Entries/Patterns              |
| `docs/footguns.md`                    | Architectural landmines      | Real footguns from codebase. Merge if file exists   |
| `docs/confusion-log.md`              | Structural confusion signals | Format header                                       |
| `docs/architecture.md`               | System overview              | Under 100 lines. What, why, how, constraints        |
| `docs/decisions/`                     | Architecture Decision Records | ADR template + real decisions if discoverable (see template below) |
| `docs/guidelines-ownership-split.md` | Migration rationale          | What was moved, removed, and why                    |
| `tasks/handoff-template.md`          | Session handoff              | Status, Current State, Decisions, Risks, Next Step  |

### ADR Template

```markdown
# ADR-NNN: [Title]

**Date:** YYYY-MM-DD
**Status:** Accepted / Superseded by ADR-NNN / Deprecated

## Context

What is the issue motivating this decision?

## Decision

What is the change being made?

## Consequences

What becomes easier or more difficult?
```

ADRs are immutable after acceptance. If a decision changes, write a new ADR that supersedes the old one.

---

## Enforcement and Security

### Permissions Deny List

```json
"permissions": {
    "deny": [
        "Bash(*git commit*)",
        "Bash(*git push*)"
    ]
}
```

Blocks tool invocations before commands run, before hooks fire. Add `Bash(terraform apply *)`, `Bash(docker push *)` etc. for infrastructure projects.

### Hooks

| Hook                       | Type    | Trigger               | Purpose                                                        |
| -------------------------- | ------- | --------------------- | -------------------------------------------------------------- |
| Stop: build verification   | Command | Every Claude turn     | Stack-adaptive: git diff for modified types, run relevant checks |
| PostToolUse: auto-format   | Command | After each Edit/Write | Format by extension. Skip if no formatter configured           |
| PreToolUse: deny-dangerous | Command | Bash tool calls       | Block rm-rf, force push, pipe-to-shell, .env edits, hook bypass |

### Hook Design Patterns

**Exit code:** Stop hooks MUST exit 0 even on errors (non-zero causes infinite loops). Errors to stderr. Guard missing tools with `command -v`.

**Infinite loop prevention:** `if [ "${STOP_HOOK_ACTIVE:-}" = "1" ]; then exit 0; fi; export STOP_HOOK_ACTIVE=1`

**Stack-adaptive:** Check `git diff` for modified file types, run only relevant checks:

| File types | Check | Typical speed |
|------------|-------|---------------|
| `.rs` | `cargo fmt --check` | <3s |
| `.ts`, `.tsx` | `tsc --noEmit`, `pnpm lint` | <5s |
| `.php` | `php -l` (syntax check) | <2s |
| `.go` | `go vet ./...` | <3s |
| `.py` | `ruff check` | <2s |
| `.sh` | `bash -n` + `shellcheck` | <3s |
| None changed | Skip (exit 0) | instant |

**Path resolution:** ALL hooks MUST use `bash "$(git rev-parse --show-toplevel)/.claude/hooks/your-hook.sh"`

### Deny Rules

The deny script should block (exit 2 with message): `rm -rf` without scoping, direct push to main/master, `git push --force`, `chmod 777`, pipe-to-shell (`curl | bash`), `.env` edits, `git commit --no-verify`. Add project-specific blocks for files requiring tooling (binary dictionaries, generated code, lock files).

### Agent Ignore Files

Prevent agents from READING sensitive files. The deny-dangerous hook blocks writes to .env but agents can still read secrets and leak them into context.

| Agent | Ignore File |
|-------|------------|
| Claude Code | `permissions.deny` Read patterns in settings.json |
| GitHub Copilot | `.copilotignore` |
| Cursor | `.cursorignore` |

Standard patterns: `.env*`, `**/secrets/`, `**/*.pem`, `**/*.key`, `**/credentials*`, `**/.git/`

### Content-Preserving Write Guard

PreToolUse hook: block any Write operation that would reduce a file's size by more than 80%. Catches agents emptying files during refactors.

### Secret Scanning

Gitleaks pre-commit hook. **Manual setup only** -- do not ask an AI agent to modify global git config. Document in README.

### Security Checklist

| Layer            | What                                    | When              |
| ---------------- | --------------------------------------- | ----------------- |
| Permissions deny | `*git commit*`, `*git push*`          | Always            |
| Deny rules       | PreToolUse hooks                        | Phase 1           |
| Secret scanning  | gitleaks pre-commit                     | Phase 1 (manual)  |
| Dependency audit | npm/composer/cargo audit in /goat-preflight  | Phase 1           |
| Git hygiene      | Block force-push, feature branches      | Phase 1           |

---

## Phase 2 Overview

**2.1 Agent Evals** -- `agent-evals/` directory with flat .md files per incident. Replay when CLAUDE.md or skills change. Start with real incidents; seed from stack failure modes if no history.

**2.2 RFC 2119 Pass** -- Apply MUST/SHOULD/MAY to all CLAUDE.md rules. Compress prose in the same pass.

**2.3 Permission Profiles** -- Native `--profile` flag scoping.

**2.4 CI Validation** -- GitHub Actions checking: CLAUDE.md line count, router table references, skills completeness.

---

## Governance

**Cut priority:** (1) essential commands -> referenced file, (2) structural debt -> one line, (3) communication when blocked -> one line, (4) sub-agent objectives -> two lines, (5) working memory -> compress. **Never cut:** execution loop, autonomy tiers, definition of done.

**Quarterly audit:** re-count, check for stale rules, ask "if I removed this, would the model still do the right thing?" The system is designed to get smaller over time, not larger.

**Model-version gating:** Before removing any rule, run the agent eval suite on the current model version. Process: (1) run evals, (2) if all pass, identify removal candidates, (3) remove, (4) re-run evals to confirm, (5) maintain rollback plan. Shrink based on tooling improvements (better linters, better hooks, better CI) and rules never triggered in 90+ days -- not assumptions about model capability.

**Model version transitions:** When upgrading the model (e.g., Claude 3.5 -> Claude 4), before using the new version on real work: (1) re-run the full agent eval suite, (2) check for behavioural regressions on known failure modes, (3) adjust instruction file language if the new model handles certain patterns differently, (4) verify enforcement hooks still work correctly with the new model's tool-calling behaviour.

**AGENTS.md compatibility:** GOAT Flow's instruction file format is compatible with the AGENTS.md open standard (used by 60k+ repos). GOAT Flow extends beyond the spec with: the 5-step execution loop, autonomy tiers with micro-checklist, 6-gate Definition of Done, enforcement gradient, and learning loop files. Projects using GOAT Flow can also create a standard AGENTS.md for interoperability with tools that don't support the full framework.
