# AI Workflow Improvement Plan — Prime Edition

**Version:** Prime v1.5 (supersedes Prime v0.1–v1.4)
**Last updated:** 2026-03-15
**Implements:** 5-layer architecture with default execution loop

Based on review of BlunderGOAT articles (SBAO, SEO Scanner case study, Claude Code Insights, Plan Before You Prompt) cross-referenced against: awslabs/aidlc-workflows, Ömer Faruk Oruç's claude.md, HumanLayer's CLAUDE.md research, Microsoft AutoDev paper, Boris Tane's Claude Code workflow, GitHub's 2,500-repo agents.md analysis, Propel's codebase structuring guide, and Trail of Bits claude-code-config.

> **⚠️ This is the canonical version.** All implementation work should reference this file.

**Playbook source:** The planning playbook prompts (mob elaboration, SBAO ranking, milestone planning, etc.) live in the [ai-planning-playbook](https://github.com/blundergoat/ai-planning-playbook) repo. Phase 2 updates modify copies of those prompts within the target project.

---

## Changelog

| Version | Date       | Changes                                                                                                                                                                                                                                                                                                                                       |
| ------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1.5    | 2026-03-15 | Script collection project shape: three-column app/library/collection table. Skills: /research and /code-review optional for single-domain libraries (v1.4's blanket "all 5" qualified). PostToolUse hook skip guidance for projects without a formatter. Pre-existing hooks migration note. Secret scanning placement: README not CLAUDE.md. Stack definition: build made optional for interpreted languages. Prompt B: explicit section list replacing cross-reference. Footgun merge-with-existing path. Instruction files as local CLAUDE.md substitute. guidelines-ownership-split.md as standard output. Dual-agent footgun coordination warning. Codex prompt: v1.5 filename references, dirty worktree guidance, preflight wrapper pattern, state declaration SHOULD, omittable sections |
| v1.4    | 2026-03-15 | Added permissions deny list (`*git commit*`, `*git push*`) as strongest enforcement layer. Three-tier enforcement model: permissions deny → hooks → CLAUDE.md rules. All 5 skills now apply to both apps and libraries (removed apps-only restriction on /research and /code-review). Added /review naming conflict warning — use /code-review to avoid shadowing Claude Code built-in. Security hardening checklist updated. Autonomy tiers enforcement note added. Codex prompt updated with deny-list gap acknowledgement |
| v1.3    | 2026-03-14 | Fixed /rewind reference (not a real command). Fixed /compact percentage (not observable). Defined line count unit. Added rollback instructions to prompts. Added v0.2 to hook saga tables. Added ADRs to article tier table. Phase 2 timing made flexible. /insights explained in human instructions |
| v1.2    | 2026-03-13 | Cross-file terminology alignment. Phase 1a/1b/1c mapping added to plan. Layer 5 description standardised. Adoption tiers synchronised across plan and article. Stale "golden tasks" references removed from all files                                                                                                                         |
| v1.1    | 2026-03-13 | Renamed golden tasks to agent evals. Flat file structure (`agent-evals/*.md`). Added README.md requirement                                                                                                                                                                                                                                     |
| v1.0    | 2026-03-11 | Guidelines ownership split (CLAUDE.md vs ai-agent-guidelines). Agent evals introduced (restructured to flat files in v1.1). Project-agnostic examples with adaptation callouts. Library vs app guidance throughout. Secret scanning moved to manual setup. Filename references aligned. Phase 1a split guidance for existing vs new CLAUDE.md |
| v0.9    | 2026-03-09 | Local CLAUDE.md files for high-risk directories. Architecture Decision Records. Footgun propagation rule                                                                                                                                                                                                                                      |
| v0.8    | 2026-03-09 | Portability: stack definition block, adoption tiers, bootstrap prompt, question/directive disambiguation. Phase 1 split into 1a/1b/1c                                                                                                                                                                                                         |
| v0.7    | 2026-03-08 | Removed anti-rationalisation hook (see Appendix A). Added security hardening                                                                                                                                                                                                                                                                  |
| v0.6    | 2026-03-08 | Hook prompt refined: pasted content detection                                                                                                                                                                                                                                                                                                 |
| v0.5    | 2026-03-08 | Two-step hook prompt with JSON-only preamble                                                                                                                                                                                                                                                                                                  |
| v0.4    | 2026-03-08 | Response-pattern intent detection                                                                                                                                                                                                                                                                                                             |
| v0.3    | 2026-03-07 | Intent-aware hook prompt, hook structural limitations                                                                                                                                                                                                                                                                                         |
| v0.2    | 2026-03-06 | Hook design patterns, exit code strategy, infinite loop guard                                                                                                                                                                                                                                                                                 |
| v0.1    | 2026-03-06 | Initial Prime edition                                                                                                                                                                                                                                                                                                                         |

---

## System Architecture

Five layers. Only Layer 1 loads every session. Everything else loads on demand.

```
Layer 1 — Runtime (CLAUDE.md, ~100-120 lines)
    READ → CLASSIFY → ACT → VERIFY → LOG loop
    Autonomy tiers, stop-the-line, mode switch, definition of done
    Router table pointing to everything below

Layer 2 — Local Context (directory-level CLAUDE.md files)
    Auto-loaded when Claude works in that directory
    High-risk boundaries, module-specific gotchas, local conventions

Layer 3 — Skills (loaded via slash commands)
    /preflight, /debug-investigate, /audit, /research, /code-review

Layer 4 — Playbooks (planning tools, loaded on demand)
    Mob elaboration, SBAO planning, milestone planning

Layer 5 — Evaluation (quality infrastructure)
    Agent eval suite, CI context validation
```

**Implementation scope:** Phase 1 builds Layers 1–3. Phase 2 builds Layer 5 and enhances Layers 1–4.

### Guidelines Ownership Split

Most projects accumulate two instruction layers: a project-specific CLAUDE.md and a shared coding standards file (`.github/instructions/ai-agent-guidelines.instructions.md` or similar). These MUST NOT overlap. Duplication creates conflicting specifics and wastes instruction budget.

**CLAUDE.md owns** (project-specific, changes per project):

- Default execution loop (READ → CLASSIFY → ACT → VERIFY → LOG)
- Autonomy tiers (Always / Ask First / Never) — project-specific boundaries
- Definition of Done — project-specific gates
- Log file references (lessons.md, footguns.md, confusion-log.md)
- Router table
- Essential commands
- Working memory and handoff conventions

**ai-agent-guidelines owns** (shared, same across projects):

- Operating principles (correctness over cleverness, smallest change, etc.)
- Engineering best practices (API discipline, testing strategy, type safety)
- Communication style (concise, ask one question, verification story)
- Error handling patterns (triage checklist, safe fallbacks, rollback)
- Task management templates (plan template, bugfix template)
- Git and change hygiene

**The test:** if a rule would be identical across every project you work on, it belongs in guidelines. If it changes per project (different Ask First boundaries, different essential commands, different DoD gates), it belongs in CLAUDE.md.

**When adopting this system on a project with an existing guidelines file:** audit for overlap. Remove any execution loop, DoD, stop-the-line, working memory, or autonomy tier content from the guidelines file — those now live in CLAUDE.md. The guidelines file should shrink.

**Committed overlap report:** When applying the ownership split, create `docs/guidelines-ownership-split.md` documenting what was moved, what was removed, and why. This preserves the migration rationale in a committed file rather than losing it when the chat session ends.

### Layer 2: Local CLAUDE.md Files

_Why: footguns.md is a central index the agent must remember to load. A local CLAUDE.md is read automatically when Claude works in that directory. Put the guardrail where the danger is, not in a file the agent might skip._

Claude Code automatically reads any `CLAUDE.md` file in the directory it's working in, plus ancestors up to the project root. A file at `src/auth/CLAUDE.md` loads every time Claude touches auth code — no explicit loading required.

**What goes in a local CLAUDE.md:**

- Module-specific footguns (1-2 lines each)
- Local conventions that differ from the project default
- Cross-boundary warnings ("changes here affect X, Y, Z — read those too")
- Hard constraints specific to this module

**What does NOT go in a local CLAUDE.md:**

- Duplicated project-wide rules (those live in the root CLAUDE.md)
- Full architectural explanations (those live in docs/)
- Anything longer than ~20 lines

**Relationship to footguns.md:**

- `docs/footguns.md` remains the central cross-domain index
- Footgun entries that map to a specific directory are **propagated** (not moved) as one-line summaries
- The central file is the source of truth; local files are read-time copies for automatic loading

**When to create local CLAUDE.md files:**

- A module has appeared 2+ times in footguns.md or confusion-log.md
- A directory is an Ask First boundary (auth, billing, migrations, deployment)
- A module has conventions that differ from the project default

**When NOT to create them:**

- For every directory (creates maintenance burden without value)
- For simple modules with no cross-boundary impact
- For libraries with flat directory structures (a single `src/` with no deep module hierarchy rarely needs local files)
- For directories already covered by `.github/instructions/` files with `applyTo` scoping — the instruction file serves the same auto-loading purpose

### Project Shape: App vs Library vs Collection

This plan is portable across project shapes. Key adaptation points:

| Aspect                  | App (e.g., Tauri, Symfony full-stack)          | Library (e.g., PHP package, npm module)                      | Script Collection (e.g., domain-organised shell scripts)          |
| ----------------------- | ---------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------- |
| CLAUDE.md line target   | ~120 lines                                     | ~100 lines (less to route to)                                | ~100 lines (less to route to)                                     |
| Skills                  | 5 (all core skills)                            | 3–5 (skip /research and /code-review if single-domain)       | 4–5 (skip /code-review if single-domain; keep /research if multi-domain) |
| Ask First boundaries    | Auth, routing, deployment, API contracts, DB   | Public API signatures, dependency changes, config/data files | Shared sourced files, CONFIGURATION blocks, logging paradigm, new domains |
| Local CLAUDE.md files   | Likely needed for high-risk directories        | Rarely needed — flat structure                               | Rarely needed if .github/instructions/ files exist per domain. Create only for domains without instruction file coverage |
| confusion-log.md        | Yes — multi-domain confusion is common         | Optional — single domain, confusion signals are rarer        | Optional — domain boundaries are clear but cross-domain coupling may warrant it |
| Agent evals             | Real incidents from production/dev history      | Common failure modes for the stack if no incident history    | Real incidents (commit-message conventions like `fix:` make grep effective) |
| Permission profiles     | Useful (frontend/backend/infra lanes)          | Rarely needed — single language                              | Rarely needed — single language                                   |
| Cross-boundary concerns | Frontend ↔ backend, infra ↔ app, API contracts | Public API ↔ tests, data files ↔ encoding scripts            | Source chains (_common.sh), logging paradigm consistency, output contracts (shell → external parsers) |

### Skill Justification Test

A skill should only exist if it has at least one of:

- A **distinct artefact** (a file it produces)
- A **hard workflow gate** (human must review before proceeding)
- A **special failure mode** (LLMs are reliably bad at this without guardrails)
- A **repeatable structured output** (mechanical, same shape every time)

| Skill                | Justification                    | Projects |
| -------------------- | -------------------------------- | -------- |
| `/preflight`         | Repeatable structured output     | All      |
| `/debug-investigate` | Special failure mode + hard gate | All      |
| `/audit`             | Distinct artefact + hard gate    | All      |
| `/research`          | Distinct artefact + hard gate    | All (optional for single-domain libraries where READ suffices) |
| `/code-review`       | Repeatable structured output     | All (optional for single-domain libraries where Review mode suffices) |

**⚠️ Naming conflict:** Claude Code has a built-in `/review` command. Do NOT create a skill named `review` — it shadows the built-in. Use `/code-review` as the skill name. If `.claude/skills/review/` already exists in your project, rename it to `.claude/skills/code-review/` or delete it.

### What Was Downgraded and Where It Went

| Former Skill        | Now Lives                                | Why downgraded                               |
| ------------------- | ---------------------------------------- | -------------------------------------------- |
| `/annotation-cycle` | Section in mob elaboration playbook (02) | Planning refinement — no distinct artefact   |
| `/sbao-synthesis`   | Section in SBAO planning playbook (03)   | Template, not a workflow with gates          |
| `/review-triage`    | Review branch of the default ACT step    | Normal review behaviour, not a distinct mode |
| `/revert-rescope`   | Paragraph in VERIFY/stop-the-line        | Tactic, not a workflow                       |

---

## ⚠️ Instruction Budget Constraint (applies to ALL phases)

**Source:** HumanLayer; Philipp Schmid research; GitHub 2,500-repo analysis

Frontier thinking models reliably follow ~150-200 instructions. Claude Code's system prompt consumes ~50. That gives CLAUDE.md a budget of roughly **100-150 instructions** before performance degrades. Degradation is **uniform, not sequential** — too many instructions makes the model worse at following _all_ of them equally.

**Key data points:**

- Tools mentioned in AGENTS.md get used **160x more often** than unmentioned ones — essential commands are the highest-signal section.
- Auto-generated context files reduce success rates by ~3% while increasing inference cost by over 20%.
- **Code examples beat prose.** One ✅/❌ snippet communicates more per token than three paragraphs.

**Governance rules:**

```
1. CLAUDE.md MUST stay under 150 lines. Target 100 (libraries) to 120 (apps). Count after every change.
   Line count = wc -l CLAUDE.md. Blank lines, code fences, and table rows all count.
2. Every rule in CLAUDE.md MUST be universally applicable to every session.
   Situation-specific guidance belongs in skills, playbooks, or local CLAUDE.md files.
3. Weekly /insights review: surface recurring friction, act on it.
4. Quarterly audit: re-count, check for stale rules, ask "If I removed this,
   would the model still do the right thing?"
5. Prefer pointers over copies. CLAUDE.md references files, not inlines them.
6. Prefer ✅/❌ examples over prose. Higher signal per token.
7. Version your CLAUDE.md with a header and brief changelog.
8. Local CLAUDE.md files: under 20 lines each.
```

**CLAUDE.md cut priority** (what to trim first if over target):

1. Essential commands → move to separate referenced file
2. Structural debt trigger → compress to one line
3. Communication when blocked → compress to one line
4. Sub-agent objectives → compress to two lines
5. Working memory details → compress, keep handoff protocol

**Never cut:** The execution loop, autonomy tiers, or definition of done.

---

## Phase 1: The Default Loop

Build the runtime layer and core skills. **Create CLAUDE.md first** — skills reference its router table.

**Implementation prompt mapping:** The implementation prompts split Phase 1 into three steps: **1a** (Foundation: sections 1.1–1.9 + Files + Architecture + Local CLAUDE.md), **1b** (Skills), **1c** (Hooks + Permissions + Security + CI).

### 1.1 The Default Execution Loop

The organising principle for CLAUDE.md. Every task follows this:

**READ**

- Read the relevant files first
- For apps: read both sides for cross-boundary changes (auth, API contracts, routing, deployment)
- For libraries: read tests alongside implementation, read data files alongside the code that uses them
- For script collections: read source chains — which shared files are sourced and how
- Never fabricate codebase facts — if you haven't read it, say so

```
❌ "acme-client is a local path dependency" (fabricated without reading composer.json)
✅ Read composer.json first → "acme-client is installed via Packagist at ^1.3.0"
```

**CLASSIFY**

Complexity: Hotfix / Standard Feature / System Change / Infrastructure Change
Mode: Plan / Implement / Explain / Debug / Review

```
❌ User asked "explain the auth flow" → Claude edited auth_middleware.go
✅ User asked "explain the auth flow" → Claude wrote a clear walkthrough, no changes
```

Mode transitions must be stated explicitly. Never drift silently. If the intent is ambiguous, ask: "Do you want me to explain this or fix it?"

Question vs directive: if the message is a question ("what should...", "which approach...", "whats next?"), answer it. Do not infer an implementation action from a question. Only act when explicitly directed.

Anti-BDUF guard:

```
❌ "Created INotificationProvider interface" (only one implementation exists)
✅ "EmailNotifier handles notifications. Extract interface when second provider needed."
```

**Portability note:** Replace the examples above with incidents from your own codebase. The principles (read before modify, classify before act) are universal; the examples are illustrative.

**ACT**

| Mode      | Behaviour                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------ |
| Plan      | Produce artefact (research.md, plan doc). No application code. Exit when human says "LGTM" or "implement"          |
| Implement | Write code within 2-3 turns. If reading a 4th file without writing anything, stop exploring and start implementing |
| Explain   | Walkthrough only. No code changes unless explicitly asked                                                          |
| Debug     | Diagnosis first. Write findings with file:line evidence. No fixes until human reviews diagnosis                    |
| Review    | Investigate independently before agreeing or disagreeing. Never blindly apply external suggestions                 |

**State declaration (MUST):** At the start of each task, declare:

```
State: [MODE] | Goal: [one line] | Exit: [condition]
```

You MUST NOT take actions outside the declared state without explicitly stating "Switching to [NEW STATE] because [reason]."

**VERIFY**

Run relevant tests after each meaningful code change — not just at the end. The loop: implement → test → fix → repeat until green. For subtle changes where tests pass but behaviour may have shifted, compare baseline vs changed behaviour explicitly.

Stop-the-line escalation:

```
Level 1 — Stop and Note (isolated failures):
  Single unrelated test failure, flaky test, non-blocking lint warning.
  → Note in Working Notes. Confirm isolated. Continue with caution.

Level 2 — Stop and Escalate (cross-boundary or security failures):
  For apps: auth, routing, deployment, API contracts, database integrity.
  For libraries: public API changes, data file corruption, scoring threshold shifts.
  For script collections: shared source file breakage, cross-domain output contract changes.
  → Full stop. Preserve error output. Write diagnosis with file:line evidence.
    Wait for human review.
```

Revert-and-rescope tactic:

1. Esc to interrupt, then restate approach — cheapest
2. Git revert + rescope — when interrupting isn't enough
3. /clear and fresh session — when context is polluted, write handoff first

Two corrections on the same issue = cut your losses. This applies to _approach_, not to legitimate multi-step work. If the fix path keeps changing direction, rewind. If you're making steady progress through a complex change, continue.

**LOG**

After corrections or discoveries, append to the appropriate file:

| File                    | When                                    | Example                                                                 |
| ----------------------- | --------------------------------------- | ----------------------------------------------------------------------- |
| `docs/lessons.md`       | Behavioural mistake (agent did wrong)   | "Assumed API contract without reading frontend"                         |
| `docs/footguns.md`      | Architectural landmine (cross-domain)   | "Auth nonce spans 4 components; breaking any one silently breaks login" |
| `docs/confusion-log.md` | Structural confusion (hard to navigate) | "Unclear which module owns session validation"                          |

**For libraries:** `docs/confusion-log.md` is optional. Create it if confusion entries start appearing in lessons.md that are really about structure, not behaviour.

Log hygiene:

- Include `created_at` date on each entry
- lessons.md: max 15 active entries. When 3+ share a theme, promote to a named Pattern and archive individuals
- footguns.md: only cross-domain issues with real evidence
- Quarterly: entries not triggered in >30 days → propose archive / generalise / keep
- Contested entries: append `⚠️ CONTESTED` with evidence. Don't silently ignore, don't silently follow
- **Footgun propagation:** when adding a footgun that maps to a specific directory, propagate a one-line summary to that directory's local CLAUDE.md

**Log file location:** `docs/lessons.md` and `docs/footguns.md` are the canonical paths. If your project has an ai-agent-guidelines file that references `tasks/lessons.md`, update it to point to `docs/lessons.md`. Do not maintain two files for the same concept.

**Pre-existing footguns:** If `docs/footguns.md` already exists with real entries, merge with it — don't replace. Add new footguns discovered during implementation, keep existing entries intact. Some projects may already have comprehensive footguns that need zero additions.

**Dual-agent coordination:** If your project has both CLAUDE.md and AGENTS.md implementations sharing the same `docs/footguns.md`, changes by one agent affect the other. Codex may retitle or remove entries that Claude Code relies on. Define one agent as the footguns owner, or adopt a merge-and-flag protocol. Simplest rule: run Claude Code first (it creates the shared docs), then Codex (it merges with existing).

Context-based loading (not every session):

- Starting a feature/refactor → read lessons.md
- Touching Ask First boundaries → read footguns.md
- Quick hotfix with no boundary crossing → skip unless relevant
- Local CLAUDE.md files load automatically

### 1.2 Autonomy Tiers

Adapt these to your project. The structure is fixed; the boundaries are project-specific.

```
✅ Always do (no confirmation needed):
- Run tests, linting, formatting
- Read any file in the codebase
- Write to files within assigned scope
- Append to lessons.md, footguns.md, confusion-log.md

⚠️ Ask First (pause and confirm with human):
[APP EXAMPLES: auth, routing, deployment, API contracts, DB schemas, CI/CD,
 cross-boundary changes, new directories]
[LIBRARY EXAMPLES: public API signatures, dependency changes, data/config
 files, detection thresholds, encoding/binary files]
[COLLECTION EXAMPLES: shared source files (_common.sh), CONFIGURATION blocks,
 logging paradigm changes, new domains, output contracts consumed by external parsers]

Micro-checklist (MUST for all Ask First items):
- [ ] Boundary touched: [name it]
- [ ] Related code read: [yes/no — if no, read it first]
- [ ] Footgun entry checked: [relevant entry, or "none applicable"]
- [ ] Local CLAUDE.md checked: [warnings noted, or "no local file"]
- [ ] Rollback command: [exact command to undo if this fails]

🚫 Never do:
- Delete test files or remove failing tests to make builds pass
- Modify .env files or secrets
- Push to main/production branches
- Change file permissions or security configurations
- Make git commits unless explicitly asked
- Edit files outside the current project repository
```

**Enforcement:** The Never tier is enforced at three levels, strongest first:

| Layer | Mechanism | Scope | Bypass risk |
|-------|-----------|-------|-------------|
| 1. Permissions deny | `settings.json` tool-level block | `*git commit*` and `*git push*` blocked entirely — before hooks, before the shell | None — Claude Code refuses the tool call |
| 2. deny-dangerous.sh | PreToolUse hook pattern inspection | `--force`, `--no-verify`, pipe-to-shell, `rm -rf`, `.env` edits | Low — regex can miss edge cases |
| 3. CLAUDE.md rules | Behavioural guidance | Everything else in the Never tier | Medium — model compliance ~70% |

Match enforcement strength to consequence severity. Binary prohibitions (never commit, never push) get permissions deny. Pattern prohibitions (no force push, no unscoped rm -rf) get hooks. Judgement calls (don't delete tests to pass builds) get CLAUDE.md rules.

### 1.3 Definition of Done

```
A task is NOT done until ALL of these are true:
1. Relevant tests green (tests that cover the change, not just "no errors")
2. All MUST-level preflight items pass
3. No cross-boundary change made without Ask First justification
4. If you tripped: lessons.md / footguns.md updated
5. Working Notes in tasks/todo.md are current
6. After bulk renames/refactors: grep for old pattern, confirm ZERO remaining references

Do NOT say "task complete" until you can confirm all 6.
```

### 1.4 Working Memory and Handoffs

For tasks exceeding 5 turns: maintain Working Notes in tasks/todo.md.

Context window management — escalation ladder:

1. `/compact` after 15+ turns or when responses noticeably slow
2. Two compactions = task too large, split into sub-tasks
3. `/clear` between unrelated tasks
4. Worktrees for parallel or risky work

Session handoff: write to tasks/handoff.md before ending incomplete work. Read it first when resuming.

### 1.5 Sub-Agent Objectives

Give each sub-agent ONE focused objective with a concrete deliverable format. Required return: paths, evidence, confidence, next step. Tool call budget: 5 calls per sub-agent.

### 1.6 Communication When Blocked

Ask **exactly one** targeted question with a recommended default and what would change depending on the answer. If not blocked, make a reasonable decision and note the assumption.

### 1.7 Structural Debt Trigger

If implementing a standard feature requires adding >3 new context rules, flag as structural debt.

### 1.8 Stack Definition

Define your project's tooling once. Hooks, skills, and preflight reference these commands.

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
  build: composer analyse
  test: composer test
  lint: composer analyse
  format: composer cs:fix

# Example: Shell script collection (no build system)
stack:
  languages: [bash]
  build: # none — interpreted language, use lint for static checks
  test: bats tests/ --recursive
  lint: shellcheck
  format: # none — no formatter configured (skip PostToolUse hook)
```

### 1.9 Adoption Tiers

| Tier         | What you get                                               | When to use                              |
| ------------ | ---------------------------------------------------------- | ---------------------------------------- |
| **Minimal**  | CLAUDE.md + deny-dangerous hook + permissions deny         | Solo project, getting started            |
| **Standard** | + skills + stop/format hooks + local CLAUDE.md files       | Active development, team project         |
| **Full**     | + agent evals + CI validation + permission profiles + ADRs | Long-lived project with incident history |

---

## Phase 1 Skills

### /preflight

Mechanical build verification with RFC 2119 constraints:

- MUST: type-check + lint + compile for your stack
- SHOULD: full test suite, formatter check, mutation testing (if configured)
- MAY: skip formatter during active debugging
- MUST NOT: report task complete if any MUST item fails

### /debug-investigate

Diagnosis-first mode:

1. Read actual code paths, trace request flow end-to-end
2. Write findings with file:line evidence — no fixes yet
3. Only after human reviews diagnosis: propose fix

### /audit

Multi-pass codebase audit:

- Pass 1 Discovery: scan target area, log findings with file:line evidence
- Pass 2 Verification: re-read each finding, confirm real, remove false positives
- Pass 3 Prioritisation: rank by severity and blast radius
- Pass 4 Self-Check: "did I fabricate this?" — remove anything that fails

### /research

Before planning any non-trivial feature, deeply read the relevant codebase area and produce research.md. Hard gate: do NOT proceed to planning until human reviews. For apps, trace the request flow across layers. For libraries, trace public API surface, data flows, and test coverage boundaries. For script collections, trace source chains, domain boundaries, and output contracts.

Optional for single-domain libraries where the READ step is sufficient.

### /code-review

Structured code review with RFC 2119 constraints and autonomy tiers. **⚠️ Do NOT name this skill `review`** — it shadows Claude Code's built-in `/review` command. Always use `/code-review`.

Optional for single-domain libraries where the default Review mode is sufficient.

---

## Phase 1 Files

| File                        | Purpose                       | Seed Content                                                                            |
| --------------------------- | ----------------------------- | --------------------------------------------------------------------------------------- |
| `docs/domain-reference.md`  | Project domain knowledge      | Migrated from existing CLAUDE.md when adopting the workflow system (Prompt B path only) |
| `docs/lessons.md`           | Behavioural learning loop     | Format header + empty Entries/Patterns sections                                         |
| `docs/footguns.md`          | Architectural landmines       | Real footguns from the codebase — read actual code, don't invent. Merge with existing if file already exists |
| `docs/confusion-log.md`     | Structural confusion signals  | Format header (apps). Skip for libraries unless needed                                  |
| `docs/architecture.md`      | System overview for Claude    | Under 100 lines. What, why, how, constraints                                            |
| `docs/decisions/`           | Architecture Decision Records | ADR template + real decisions if discoverable                                           |
| `docs/guidelines-ownership-split.md` | Migration rationale  | What was moved, removed, and why during ownership split                                 |
| `tasks/handoff-template.md` | Session handoff               | Status, Current State, Decisions, Risks, Next Step                                      |

**For libraries:** `docs/architecture.md` may already exist as domain reference documentation. Don't create a second one — ensure the existing doc covers the "what does this system do" and "non-obvious constraints" questions. ADRs are optional for libraries with few architectural decisions.

### Architecture Documentation

**docs/architecture.md** — a short overview (under 100 lines) that answers:

- What does this system do? (one paragraph)
- What are the major components and how do they connect?
- What are the key data flows?
- What are the non-obvious constraints?
- What are the deliberate trade-offs?

**docs/decisions/** — Architecture Decision Records. One file per significant decision:

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

## Phase 1 Enforcement

### Permissions Deny List (settings.json)

The strongest enforcement layer. The `.claude/settings.json` permissions deny list blocks tool invocations at the Claude Code level — before the command runs, before hooks fire. Claude Code refuses the tool call entirely.

```json
"permissions": {
    "deny": [
        "Bash(*git commit*)",
        "Bash(*git push*)"
    ]
}
```

**Why both permissions deny AND hooks:**

Permissions deny handles binary prohibitions — actions that should NEVER happen regardless of context. `git commit` and `git push` are always human actions, full stop.

Hooks handle pattern prohibitions — actions that are dangerous in specific forms but legitimate in others. `rm` is fine; `rm -rf /` is not. The hook inspects the command to decide.

CLAUDE.md rules handle judgement calls — everything that needs context-aware reasoning.

**When to use permissions deny vs hooks:**

- **Permissions deny:** actions that should NEVER happen regardless of context. The deny list uses glob patterns (`Bash(*git commit*)`), not regex. It matches the entire command invocation, including chained commands.
- **Hooks:** actions that are dangerous in specific forms. The hook script uses regex/pattern matching to inspect command content and distinguish safe from unsafe variants.

**Project-specific additions:** add `Bash(terraform apply *)` for infrastructure projects, `Bash(docker push *)` for container projects, or any other command that should require human hands.

### Hooks

| Hook                       | Type    | Trigger               | Purpose                                                                              |
| -------------------------- | ------- | --------------------- | ------------------------------------------------------------------------------------ |
| Stop: build verification   | Command | Every Claude turn     | Stack-adaptive: detect modified file types via git diff, run relevant checks only    |
| PostToolUse: auto-format   | Command | After each Edit/Write | Format edited files by extension using the project's configured formatter            |
| PreToolUse: deny-dangerous | Command | Bash tool calls       | Block dangerous patterns: rm-rf, force push, pipe-to-shell, .env edits, hook bypass |

**Skip PostToolUse if no formatter is configured for your stack.** Shell scripts, for example, have no standard auto-formatter. Creating a format hook that re-runs the linter is redundant with the Stop hook. Only create PostToolUse when a real formatter exists (prettier, php-cs-fixer, rustfmt, gofmt, etc.).

**Migrating pre-existing hooks:** If your project already has hooks configured in `.claude/settings.json` (inline commands or references to scripts), migrate them to external scripts under `.claude/hooks/` before adding new hooks. Replace inline commands with `bash "$(git rev-parse --show-toplevel)/.claude/hooks/script-name.sh"` references. This consolidates all enforcement into inspectable, version-controlled scripts.

### Hook Design Patterns

**Exit code strategy for Stop command hooks:**

Stop command hooks MUST exit 0 even when they find errors. Non-zero exit forces Claude into infinite fix loops. Print errors to **stderr** (`>&2`). Guard against missing tools (`command -v` check).

```bash
# ✅ Correct: exit 0, errors to stderr, tool availability check
if ! command -v cargo &>/dev/null; then exit 0; fi
output=$(cargo fmt --check 2>&1) || {
  echo "Formatting issues found:" >&2
  echo "$output" >&2
}
exit 0
```

**Infinite loop prevention:**

```bash
if [ "${STOP_HOOK_ACTIVE:-}" = "1" ]; then exit 0; fi
export STOP_HOOK_ACTIVE=1
```

**Stack-adaptive stop hook:** Check `git diff` for modified file types, only run relevant checks:

| File types    | Check                       | Typical speed |
| ------------- | --------------------------- | ------------- |
| `.rs`         | `cargo fmt --check`         | <3s           |
| `.ts`, `.tsx` | `tsc --noEmit`, `pnpm lint` | <5s           |
| `.php`        | `php -l` (syntax check)     | <2s           |
| `.go`         | `go vet ./...`              | <3s           |
| `.py`         | `ruff check`                | <2s           |
| `.sh`         | `bash -n` + `shellcheck`    | <3s           |
| None          | Skip (exit 0)               | instant       |

**PostToolUse auto-format:** format based on file extension. Silence failures.

**Hook path resolution:** ALL hook commands MUST use `git rev-parse --show-toplevel`:

```
bash "$(git rev-parse --show-toplevel)/.claude/hooks/your-hook.sh"
```

### Hook Configuration Pitfalls

1. Use `git rev-parse --show-toplevel` for paths — relative paths break when cwd changes.
2. Put each Stop hook in its own array entry — combining command and prompt hooks causes double-firing.
3. Verify hooks exist at the project root — stale working directories create hooks in subdirectories.
4. Check `git diff` before running expensive checks.

---

## Phase 1 Security Hardening

### Deny Rules (PreToolUse hooks)

Block known-dangerous patterns at the tool level. An instruction in CLAUDE.md saying "never use rm -rf" works ~70% of the time. A PreToolUse hook that blocks it works 100%.

The deny script should block (exit 2 with error message):

- `rm -rf` without explicit path scoping
- Direct `git push` to main/master/production
- `git push --force` (suggest `--force-with-lease`)
- `chmod 777` or overly permissive file permissions
- Pipe-to-shell patterns (`curl | bash`, `wget | sh`)
- `.env` file modifications
- `git commit --no-verify` or `git commit -n`

**Note:** `git commit` and `git push` are blocked entirely by the permissions deny list in settings.json. The deny-dangerous hook handles the pattern-level variants (force push, no-verify) for cases where permissions deny alone isn't granular enough.

**Project-specific deny rules:** add blocks for files that must be modified through tooling, not direct edit. Examples: binary-encoded dictionaries (must use encoder script), generated files (must use generator), lock files (must use package manager), generated code maps (must use codegen script).

### Pre-Commit Secret Scanning (Manual Setup)

Set up gitleaks as a pre-commit hook. **This is a manual step — do not ask an AI agent to modify global git config.** Document the setup in README, not CLAUDE.md — the line budget is too tight.

```bash
# Install gitleaks for your platform
# Create ~/.git-hooks/pre-commit that runs: gitleaks git --staged --no-banner
# Set: git config --global core.hooksPath ~/.git-hooks
```

Note: `git config --global core.hooksPath` affects ALL repositories on the machine. Review the implications before applying.

### Security Hardening Checklist

| Layer            | What                                                       | When to add                    |
| ---------------- | ---------------------------------------------------------- | ------------------------------ |
| Permissions deny | `*git commit*`, `*git push*` blocked in settings.json   | Phase 0 / Phase 1c — always    |
| Deny rules       | PreToolUse hooks                                           | Phase 1 — with other hooks     |
| Secret scanning  | gitleaks pre-commit                                        | Phase 1 — manual setup         |
| Dependency audit | `npm audit` / `composer audit` / `cargo deny` in preflight | Phase 1 — in /preflight skill  |
| Git hygiene      | Block force-push, require feature branches                 | Phase 1 — deny rules           |

---

## Phase 2: Evaluation and Profiles

### 2.1 Agent Eval Regression Suite

Maintain an `agent-evals/` directory with known bugs/incidents as flat `.md` files (one file per eval, named after the incident). Each file contains: bug description, single replay prompt, expected outcome, known failure mode tested. Include a `README.md` explaining what evals are and how to use them.

**Start with real incidents only.** For new projects with no incident history, create 1-2 evals from common failure modes for your stack. Replace with real incidents as they occur.

Replay protocol: when you change CLAUDE.md or a skill, run the agent against each eval's replay prompt. If a previously-passing eval now fails → behavioural regression, revert.

### 2.2 Playbook Updates

If `docs/playbooks/02-mob-elaboration-prompt.md` and `03-sbao-ranking-prompt.md` exist, apply updates. If not, skip this section.

### 2.3 RFC 2119 Pass

Apply MUST/SHOULD/MAY to all existing CLAUDE.md rules. Compress prose in the same pass to stay within line budget.

### 2.4 Per-Role Permission Profiles

Native Claude Code scoping using the `--profile` flag. **For apps only** — libraries rarely need role-scoped permissions.

### 2.5 CI/CD Validation of Context Files

GitHub Actions workflow checking: CLAUDE.md line count, router table references, skills directory completeness.

---

## Appendix A: The Anti-Rationalisation Hook — A Failed Experiment

### The Idea

A prompt-type Stop hook that sends Claude's response to Haiku for independent assessment.

### What Happened (6 versions in one day)

| Version | Approach                              | What went wrong                                                |
| ------- | ------------------------------------- | -------------------------------------------------------------- |
| v0.1    | Single paragraph, no intent check     | False positives on every question                              |
| v0.2    | Hook infrastructure                   | Exit codes, infinite loop guard — no prompt iteration          |
| v0.3    | User-intent keyword matching          | Haiku can't see the user message                               |
| v0.4    | Response-pattern detection            | Haiku returned prose instead of JSON                           |
| v0.5    | Two-step flow with JSON-only preamble | Claude's own "Want me to fix?" offer triggered false match     |
| v0.6    | Pasted content detection              | Best version, but JSON schema fragile across reimplementations |

### The Structural Problem

Prompt-type Stop hooks only see the assistant's response. They cannot read the conversation. Intent detection is always inferred, never observed. Three false positives in a single day eroded trust faster than correct rejections built it.

### The Decision

Removed entirely in v0.7. Deterministic command hooks for mechanical enforcement. CLAUDE.md rules for behavioural guidance. Prompt hooks for semantic judgement are fragile.
