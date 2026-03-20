# AI Workflow Framework — Complete System Summary

This document describes the complete AI Workflow Framework system for reviewers who do not have access to the source files. It is intended to be self-contained — you should be able to understand, critique, and suggest improvements to the system from this summary alone.

**Repository:** `ai-workflow-framework`
**Author:** Matt Hansen (BlunderGOAT)
**Version:** v1.5 (2026-03-15)
**Agents supported:** Claude Code (Anthropic), Codex (OpenAI)
**Total files:** 35 polished documents across 9 directories + 4 reference files + 8 archived drafts

---

## What This System Is

A structured methodology for configuring AI coding agents (Claude Code, Codex) to work reliably on real codebases. Instead of writing a wall of rules the agent eventually ignores, the system imposes a behavioural loop, layered architecture, enforcement mechanisms, and a learning feedback loop.

The system is:
- **Evidence-based** — every design decision traces to a real incident or published research
- **Battle-tested** — deployed across 6 real projects (Tauri desktop app, PHP library, medical scribe, shell script collection, form detector, chat platform)
- **Agent-agnostic at the core** — the execution loop and autonomy tiers work on both Claude Code and Codex; enforcement mechanisms differ per agent
- **Designed to get smaller over time** — quarterly audits remove rules that models have learned to follow without instruction

The system is NOT:
- A generic "best practices" guide
- Agent-agnostic in enforcement (Claude Code has hooks; Codex has behavioural guidance only)
- A replacement for testing or code review (it structures the agent's work, not the human's judgment)

---

## The 5-Layer Architecture

The system organises everything an agent needs into five layers. Only Layer 1 loads every session. Everything else loads on demand, keeping the always-loaded instruction budget lean.

### Layer 1 — Runtime (always loaded)

The root instruction file: `CLAUDE.md` for Claude Code, `AGENTS.md` for Codex. Target: ~100 lines for libraries, ~120 for apps, hard ceiling at 150.

**Why the line budget matters:** Research shows auto-generated context beyond ~150 instructions reduces agent success rates by ~3% and increases cost by 20%+ (HumanLayer). Tools mentioned in the instruction file are used 160x more often than unmentioned ones (GitHub 2,500-repo analysis of agents.md files). Every line must earn its place.

**What Layer 1 contains:**

The instruction file has these sections:

1. **Execution Loop** (READ → CLASSIFY → ACT → VERIFY → LOG) — the 5-step behavioural loop described in detail below
2. **Autonomy Tiers** (Always / Ask First / Never) — permission boundaries mapped to risk
3. **Definition of Done** — 6 explicit gates that must all pass before a task is complete
4. **Router Table** — index pointing to everything in Layers 2-5 (skills, docs, playbooks, evals)
5. **Stack Definition** — build, test, lint, format commands for the project
6. **Working Memory** — escalation ladder for long tasks (scratchpad → handoff file → ask human)

**Enforcement (3 layers protecting Layer 1 rules):**

| Layer | Mechanism | Bypass Risk |
|-------|-----------|-------------|
| Permissions deny list | `.claude/settings.json` blocks commands before they run | ~0% — hardest enforcement |
| Hooks | `.claude/hooks/` scripts run on tool use events | ~5% — deterministic but can be misconfigured |
| Instruction file rules | Behavioural guidance the agent follows | ~30% — softest layer, compliance varies |

Claude Code has all three enforcement layers. Codex has only the instruction file rules — no hooks, no permissions deny. This is the fundamental enforcement gap between agents.

### Layer 2 — Local Context (auto-loaded per directory)

Directory-level instruction files that auto-load when the agent works in that area. A file at `src/auth/CLAUDE.md` loads every time the agent touches auth code.

**When to create:** Only when a directory has 2+ footgun entries, is an Ask First boundary, or has conventions differing from the project default. Max ~20 lines each.

**File locations:**
- Claude Code: `*/CLAUDE.md` (auto-loaded by directory ancestry)
- Codex: `.github/instructions/*.md` (with `applyTo` frontmatter glob matching)

**Relationship to footguns.md:** `docs/footguns.md` is the central index and source of truth. Footguns mapped to a specific directory are propagated (not moved) as one-line summaries into local instruction files.

### Layer 3 — Skills (loaded via slash commands)

Five focused capabilities invoked on demand. Each skill has a distinct artifact, a hard quality gate, and a repeatable output. Skills don't load unless invoked — they stay out of the instruction budget.

| Skill | Problem It Solves | Key Constraint |
|-------|-------------------|----------------|
| `/preflight` | Agent says "done" without running full checks. Individual checks miss what the pipeline catches. | MUST items (type-check, lint, compile) cannot be skipped. Produces structured pass/fail report. |
| `/debug-investigate` | Agent guesses fixes before understanding the bug. Works ~30% of the time, creates confusing diffs the other 70%. | Hard gate: diagnosis with file:line evidence first. Fixes only after human reviews findings. |
| `/audit` | LLMs fabricate audit findings — plausible-sounding issues they invented. False positives erode trust. | 4-pass structure: Discovery → Verification → Prioritisation → Self-Check ("did I fabricate this?"). |
| `/research` | Agent plans based on assumptions about the code, discovers midway that assumptions were wrong. | Hard gate: produce research.md with evidence. No planning until human reviews. |
| `/code-review` | Without structure, the agent rubber-stamps ("looks good") or lists trivial style issues while missing architectural concerns. | RFC 2119 severity (MUST/SHOULD/MAY). Never blindly applies external suggestions. |

**Skill justification test:** A skill earns its place only if it has at least one of: a distinct artifact, a hard workflow gate, a special failure mode, or a repeatable structured output. Four former skills failed this test and were downgraded to inline instructions: `/annotation-cycle`, `/sbao-synthesis`, `/review-triage`, `/revert-rescope`.

**File locations:**
- Claude Code: `.claude/skills/{name}/SKILL.md`
- Codex: `docs/codex-playbooks/{name}.md`

### Layer 4 — Playbooks (loaded on demand)

Methodology templates humans follow when planning or testing. Not agent runtime files — these structure human thinking before giving the agent a task.

**Planning playbooks (run in order):**

| Step | Playbook | Output |
|------|----------|--------|
| 1 | Feature Brief | Product definition: what, why, who, scope, risks, open questions |
| 2 | Mob Elaboration | Clarifying questions from multiple perspectives with recommendations |
| 3 | SBAO Ranking | 3 competing plans ranked against criteria, synthesised into prime plan |
| 4 | Milestone Planning | Phased implementation plan with tasks, exit criteria, assumptions, risks |

**Testing playbook (doer-verifier pattern):**

The coding agent is the doer. Testing uses independent verifiers — automated suites, separate AI agents, and the developer. Never trust the coding agent's self-assessment.

Three parallel verification tracks after every milestone or 30-60 minutes of coding:

| Track | Who | What It Catches | What It Misses |
|-------|-----|----------------|----------------|
| Track 1: Automated Tests | Test suite, linter, preflight | Regressions, type errors, broken contracts | UX issues, logic errors not covered by tests |
| Track 2: AI Verification | Separate fresh AI agent (not the coding agent) | Logic gaps, architectural issues, security problems | Visual/UX issues, performance under load |
| Track 3: Human Testing | Developer | Visual bugs, UX flow, domain edge cases | Regressions in areas not manually checked |

Cadence ratio is 1:1 — for every unit of coding agent work, spend an equal unit verifying it.

### Layer 5 — Evaluation (quality infrastructure)

Quality infrastructure installed in the project that catches drift over time.

| Component | What It Does | When It Runs |
|-----------|-------------|-------------|
| Agent evals | Regression tests from real incidents — replay prompts that verify the agent handles known failure modes | After CLAUDE.md changes, on demand |
| CI context validation | Automated checks: instruction file line count, router reference resolution, skill completeness | Every PR |
| Learning loop files | `docs/footguns.md` (architectural landmines with file:line evidence), `docs/lessons.md` (agent behavioural mistakes), `docs/confusion-log.md` (structural navigation confusion) | Updated after every task |
| Handoff template | Session handoff: status, current state, key decisions, known risks, next step | End of every session that stops mid-task |

---

## The 5-Step Execution Loop

Every task follows: **READ → CLASSIFY → ACT → VERIFY → LOG**

Each step exists because a specific failure mode kept occurring without it. The loop lives in Layer 1 and loads every session.

### Step 1: READ

**Failure mode prevented:** Agent fabricates codebase facts — guesses file contents, dependency versions, API contracts without reading the actual files. Guesses are confident and often plausible.

**Rule:** Read the relevant files first. Never fabricate codebase facts.
- Apps: read both sides of cross-boundary changes (frontend + backend)
- Libraries: read tests alongside implementation, data files alongside code
- Script collections: read source chains (which shared files are sourced and how)

**Example:**
```
BAD:  "acme-client is a local path dependency" (fabricated without reading composer.json)
GOOD: Read composer.json first → "acme-client is installed via Packagist at ^1.3.0"
```

### Step 2: CLASSIFY

**Failure modes prevented:**
1. Agent can't distinguish questions from directives — "did you also improve X?" gets treated as "improve X"
2. Agent drifts between modes silently (starts explaining, ends up implementing)

**Rule:** Classify the task on two axes before acting.

Complexity: Hotfix / Standard Feature / System Change / Infrastructure Change

Mode: Plan / Implement / Explain / Debug / Review

If the message is a question, answer it. Do not infer an implementation action. If ambiguous: "Do you want me to explain this or fix it?"

Mode transitions must be explicit: "Switching to [NEW MODE] because [reason]."

**Anti-BDUF guard:** Don't over-engineer. Extract an interface when the second provider is needed, not before.

### Step 3: ACT

**Failure mode prevented:** Planning loops (agent reads 8-12 files without producing anything) and premature fixes (agent starts fixing before understanding the bug).

**Rule:** Each mode has explicit behaviour constraints.

| Mode | Behaviour | Exit Condition |
|------|-----------|----------------|
| Plan | Produce artifact. No application code. | "LGTM" or "implement" from human |
| Implement | Write code within 2-3 turns. 4th file read without writing = stop exploring, start coding. | Task complete, tests pass |
| Explain | Walkthrough only. No code changes unless explicitly asked. | Explanation delivered |
| Debug | Diagnosis first with file:line evidence. No fixes until human reviews. | Human approves fix plan |
| Review | Investigate independently. Never blindly apply external suggestions. | Findings delivered |

**State declaration (required before acting):**
```
State: [MODE] | Goal: [one line] | Exit: [condition]
```

### Step 4: VERIFY

**Failure mode prevented:** Agent declares victory early. Tests pass, but the old function name still appears in three files because nobody grepped after the rename.

**Rule:** Run tests after each meaningful code change, not just at the end.

**Two-level escalation (borrowed from Toyota's "stop the line" principle):**

Level 1 — Stop and Note (isolated failures): Flaky test, unrelated failure, non-blocking lint warning. Note it, continue with caution.

Level 2 — Stop and Escalate (cross-boundary or security): Auth, routing, deployment, API contracts, DB integrity, public API changes, shared source file breakage. Full stop. Preserve error output. Write diagnosis with file:line. Wait for human.

**Revert-and-rescope:** (1) Escape + restate approach, (2) git revert + rescope, (3) /clear + handoff. Two corrections on the same approach = cut your losses.

### Step 5: LOG

**Failure mode prevented:** Agent repeats the same mistakes across sessions. Without a learning loop, every conversation starts from zero.

**Rule:** After each task, update the appropriate learning loop file.

| File | When | Example |
|------|------|---------|
| `docs/lessons.md` | Agent behavioural mistake | "Assumed API contract without reading frontend" |
| `docs/footguns.md` | Architectural landmine (cross-domain) | "Auth nonce spans 4 components; breaking any one silently breaks login" |
| `docs/confusion-log.md` | Structural confusion | "Unclear which module owns session validation" |

**Critical rule:** Every footgun entry MUST include file:line references to real code. Footguns without evidence are treated as fabricated.

### Why 5 Steps, Not 3 or 7

The loop started as READ → ACT → VERIFY (3 steps). Two were added after real failures:
- CLASSIFY was added because ~30% of tasks had mode drift without it
- LOG was added because the same mistakes recurred 3-4 times before being written down

No step has been added since v1.2.

---

## Autonomy Tiers

Three permission levels mapped to risk:

| Tier | Scope | Examples |
|------|-------|---------|
| **Always** | Safe, reversible, within scope | Run tests, lint, read files, write code within declared scope |
| **Ask First** | Boundary-crossing, project-specific risk areas | Auth changes, routing changes, deployment config, API contracts, DB schema changes |
| **Never** | Destructive, irreversible | Delete test files, modify .env/secrets, push to main, git commit --no-verify |

**Ask First micro-checklist (required before proceeding):**
The agent must prove it has:
1. Read the related code
2. Checked docs/footguns.md for known landmines in this area
3. Identified the rollback command if the change fails

This front-loads investigation to the agent, making the human's approval informed rather than a rubber stamp.

**Enforcement mapping:**
- Always tier: no enforcement needed (agent acts freely)
- Ask First tier: instruction file rules (~70% compliance)
- Never tier: permissions deny list + hooks (~95-100% enforcement on Claude Code; behavioural guidance only on Codex)

---

## Definition of Done

Six explicit gates. ALL must pass.

1. Code compiles and passes linting
2. All existing tests pass (no regressions)
3. New tests cover the change
4. Preflight checks pass (`/preflight` or `preflight-checks.sh`)
5. Learning loop files updated (if applicable)
6. After bulk renames/refactors: grep for old pattern, zero remaining

Gates 5 and 6 are the ones most often skipped. Gate 6 exists because of a specific incident where "tests pass" was treated as done while three files still referenced an old function name.

---

## Project Shape Adaptation

The system adapts to three project shapes. The layers stay the same — only content and budgets change.

| Aspect | App | Library | Script Collection |
|--------|-----|---------|-------------------|
| Layer 1 line target | ~120 | ~100 | ~100 |
| Layer 2 local files | Likely needed | Create where needed | Create where needed |
| Layer 3 skills | All 5 | All 5 | All 5 |
| Layer 5 confusion-log | Yes | Yes | Yes |
| Layer 5 permission profiles | Useful | Useful | Useful |
| Ask First boundaries | Auth, routing, deployment, API, DB | Public API, dependencies, config/data files | Shared sourced files, CONFIGURATION blocks, new domains |
| Agent evals | Real incidents | Common stack failure modes | Real incidents |

**Evidence from real implementations:**

| Project | Shape | CLAUDE.md Lines | Skills | Footguns | Guidelines Reduction |
|---------|-------|----------------|--------|----------|---------------------|
| Tauri desktop app | App | 121 | 6 | 14 | — |
| PHP library | Library | 99 | 3 | 6 | 47→39 lines (17%) |
| Medical scribe | App | 118 | 5 | 8 | 95→51 lines (46%) |
| Shell script collection | Collection | 96 | 4 | 8 (pre-existing) | — |

The shell script collection exposed that the app/library binary was insufficient — a multi-domain collection needs app-level Ask First boundaries but library-level line targets. This led to the three-shape model.

---

## Claude Code vs Codex

The core system (execution loop, autonomy tiers, definition of done, learning loop) is **agent-agnostic**. It works on both. The enforcement layer is where they diverge.

### What Maps Cleanly

| Claude Code | Codex Equivalent |
|------------|------------------|
| CLAUDE.md | AGENTS.md |
| .claude/skills/ | docs/codex-playbooks/ |
| docs/footguns.md | docs/footguns.md (shared) |
| docs/lessons.md | docs/lessons.md (shared) |
| agent-evals/ | codex-evals/ |
| scripts/preflight-checks.sh | scripts/preflight-checks.sh (shared) |

### What Has No Equivalent in Codex

| Claude Code Feature | Codex Gap | Consequence |
|-------------------|-----------|-------------|
| PreToolUse hooks (deny-dangerous) | No runtime blocking | If Codex runs `rm -rf /`, nothing stops it |
| Stop hooks (stop-lint) | No automatic stop-the-line | Agent doesn't get feedback between turns |
| PostToolUse hooks (format-file) | No auto-formatting | Manual formatting required |
| Local CLAUDE.md auto-loading | No directory-level auto-loading | Must manually reference domain docs |
| Permissions deny list | No command blocking | Behavioural guidance only |
| Permission profiles | No role-scoped access | Full access regardless of task |

### What's Better Without Hooks (Codex advantages)

- No false positives (no enforcement mechanism means no false positive enforcement)
- Inspectable policy (`scripts/deny-dangerous.sh` is a plain shell script with `--self-test`)
- Reused existing infrastructure (wraps project's existing preflight instead of parallel machinery)
- Deterministic validation (scripts run anytime, no CI pipeline needed)

### Line Count Trade-off

AGENTS.md runs ~35% larger than CLAUDE.md for the same project (measured: 135 vs 100 lines on the shell script collection). Codex can't offload to hooks, so more guidance must live in the instruction file.

### Dual-Agent Coordination

When both agents share `docs/footguns.md` and `docs/lessons.md`, changes by one agent affect the other. On the shell script collection, Codex retitled 5 entries and removed 3 that Claude Code's implementation depended on.

**Rule:** Run Claude Code first (it creates the shared docs), then Codex (it merges with existing). Review Codex's changes to shared files before committing.

**Key finding:** The footgun-seeding and eval-seeding approaches are agent-agnostic — the git history is the source of truth, not the agent. Both agents found the same qualifying incidents from the same grep pattern.

---

## Implementation Phases

| Phase | What It Creates | Layers Built |
|-------|----------------|-------------|
| Phase 0 (bootstrap) | Minimal CLAUDE.md + deny-dangerous hook + settings.json | Layer 1 (minimal) |
| Phase 1a (foundation) | Full instruction file with execution loop, autonomy tiers, DoD, router, stack definition. Docs seed files (lessons, footguns, confusion-log, handoff template, architecture, ADRs, guidelines-ownership-split). Local CLAUDE.md files where needed. | Layer 1 + Layer 2 |
| Phase 1b (skills) | 5 skill files with RFC 2119 constraints, output templates, hard gates | Layer 3 |
| Phase 1c (enforcement) | Hooks (deny-dangerous, stop-lint, format-file), permissions deny list, CI validation, .gitignore additions | Layer 1 enforcement |
| Phase 2 (evaluation) | Agent eval suite from real incidents, RFC 2119 pass on CLAUDE.md, permission profiles, CI context validation | Layer 5, enhances Layers 1-4 |

**Two paths for Phase 1a:**
- Prompt A: new project with no existing CLAUDE.md (create from scratch)
- Prompt B: existing CLAUDE.md with domain content (migrate domain content to docs/domain-reference.md first, then build the workflow instruction file)

Prompt B exists because most developers aren't starting from scratch — they have existing CLAUDE.md files full of domain knowledge. The prompt harvests that knowledge into a reference doc while installing the execution loop.

**Adoption tiers:**

| Tier | What You Get | When to Use |
|------|-------------|-------------|
| Minimal | CLAUDE.md + deny-dangerous hook + permissions deny | Getting started, solo projects |
| Standard | + skills + hooks + local context + learning loop | Active development |
| Full | + agent evals + CI validation + permission profiles | Long-lived projects with incident history |

---

## The Hook Saga (Why Prompt Hooks Don't Work)

Six versions of an anti-rationalisation hook were attempted in one day. The hook tried to detect when the agent was declaring victory without completing work. Every version failed.

| Version | Approach | What Went Wrong |
|---------|----------|----------------|
| v0.1 | Single paragraph, no intent check | False positives on every question |
| v0.2 | Hook infrastructure | Exit codes, infinite loop guard — no prompt iteration |
| v0.3 | User-intent keyword matching | Haiku (the hook model) can't see the user message |
| v0.4 | Response-pattern detection | Haiku returned prose instead of JSON |
| v0.5 | Two-step flow with JSON-only preamble | Claude's own "Want me to fix?" offer triggered false match |
| v0.6 | Pasted content detection | Best version, but JSON schema fragile across reimplementations |

**The moment that killed it:** v0.5 produced the same wrong rejection three times — different phrasing, same false positive. One false positive displayed as emphatic consensus.

**Conclusion:** Prompt-type hooks only see the assistant's response. They cannot read the conversation. Intent detection is always inferred, never observed. The false positive rate (~30%) eroded trust faster than the success rate (~70%) built it. Deterministic command hooks for mechanical enforcement; instruction file rules for behavioural guidance. Prompt hooks for semantic judgment are structurally unsound with current hook architecture.

---

## Enforcement Detail

### Permissions Deny List

```json
"permissions": {
    "deny": [
        "Bash(*git commit*)",
        "Bash(*git push*)"
    ]
}
```

Blocks commands before execution. Hardest enforcement — the agent cannot bypass this.

### Hooks

Three hooks, each serving a different purpose:

**PreToolUse: deny-dangerous.sh** — Blocks dangerous commands with exit 2 and an error message telling the agent what to do instead. Blocks: rm -rf without path scoping, git push to main/production, git push --force, chmod 777, pipe-to-shell (curl | bash), .env modifications, git commit --no-verify.

**Stop: stop-lint.sh** — Stack-adaptive: checks git diff for modified file types, runs relevant lint/type checks only. MUST exit 0 even on errors (non-zero causes infinite fix loops — a hard-won lesson). Includes infinite loop guard and missing tool checks.

| File Types | Check | Speed |
|------------|-------|-------|
| `.rs` | `cargo fmt --check` | <3s |
| `.ts`, `.tsx` | `tsc --noEmit`, `pnpm lint` | <5s |
| `.php` | `php -l` (syntax check) | <2s |
| `.go` | `go vet ./...` | <3s |
| `.py` | `ruff check` | <2s |
| `.sh` | `bash -n` + `shellcheck` | <3s |

**PostToolUse: format-file.sh** — Formats based on file extension using the project's formatter. Silences failures. Skip entirely if no formatter is configured (do NOT create a format hook that re-runs the linter).

**Hook configuration pitfalls:**
1. Use `$(git rev-parse --show-toplevel)` for ALL paths — relative paths break when cwd changes
2. Put each Stop hook in its own array entry — combining command and prompt hooks causes double-firing
3. Verify hooks exist at the project root — stale working directories create hooks in subdirectories
4. Check git diff before running expensive checks

### CI Context Validation

GitHub Actions workflow that catches drift on every PR:
- Instruction file line count (warn if over target, error if over 150)
- Router table references resolve to real files
- Skill directories have SKILL.md files
- Local instruction files are under 20 lines
- Footguns have file:line evidence

---

## Guidelines Ownership Split

**Problem:** Projects with both an instruction file and a shared guidelines file end up with overlapping rules — two DoDs, two testing strategies. The agent follows whichever it reads last, creating inconsistent behaviour.

**Incident:** On a Tauri app, CLAUDE.md had a DoD ("tests green, preflight passes, logs updated") and the guidelines file had a different DoD ("tests pass, rollback strategy exists, verification story"). The agent alternated unpredictably.

**Solution:** Clean ownership boundary:
- CLAUDE.md owns: execution loop, autonomy tiers, DoD, working memory, log references
- Guidelines owns: engineering practices, coding patterns, communication style, error handling, git hygiene

**Test:** If a rule would be identical across every project, it belongs in guidelines. If it changes per project, it belongs in CLAUDE.md.

**Evidence:** PHP library reduced from 47→39 lines (17%). Medical scribe reduced from 95→51 lines (46%).

---

## Learning Loop Files

### docs/footguns.md

Architectural landmines — cross-domain coupling points where changing one thing silently breaks another. Every entry MUST include file:line evidence.

**Three paths:**
1. New project: seed from reading the codebase
2. No history: seed from common stack failure modes, replace with real incidents later
3. Pre-existing: merge with existing entries (never replace)

**Real seeding data:**
- PHP library: 6 footguns (normalisation pipeline order, binary dict cache, regex error suppression, etc.)
- Medical scribe: 8 footguns (early cross-layer boundaries create coupling)
- Shell script collection: 8 pre-existing footguns, 0 additions needed

### docs/lessons.md

Agent behavioural mistakes. Format: date, category, lesson, evidence. Categories: fabrication, mode-drift, premature-fix, scope-creep, missed-read.

### docs/confusion-log.md

Structural confusion — areas where the agent or human got lost. When 3+ entries point to the same area, that area needs better docs or refactoring.

### tasks/handoff-template.md

Session handoff: Status, Current State, Key Decisions, Known Risks, Next Step, Context Files to Read. Copied for each handoff, template stays reusable.

---

## Instruction Budget Management

**Cut priority (when over line target):**
1. Cut first: verbose examples (keep one BAD/GOOD per section)
2. Cut next: explanatory paragraphs (replace with terse rules)
3. Cut next: content that duplicates other docs
4. Never cut: execution loop, autonomy tiers, definition of done

**Compression data from real projects:**
- PHP library: first pass 127 lines → compressed to 99 (two passes)
- Shell script collection: 89 → grew to 101 → compressed to 96 after RFC 2119 pass

**RFC 2119 priority language:**
- MUST: execution loop steps, autonomy tier boundaries, DoD gates, state declaration, Level 2 escalation
- SHOULD: log hygiene, working memory, session handoffs, footgun propagation, anti-BDUF
- MAY: structural debt trigger, communication when blocked, sub-agent 5-call budget

---

## Real-World Implementation Data

Scanned across 6 BlunderGOAT projects:

| Project | Shape | Stack | Agent | Tier | CLAUDE.md | AGENTS.md | Footguns | Skills | Evals |
|---------|-------|-------|-------|------|-----------|-----------|----------|--------|-------|
| ambient-scribe | App | PHP, TS, Python, Docker | Dual | Full | 53 | 119 | 63 | 5 | 14 (6+8) |
| devgoat | App (Tauri) | TypeScript, Rust | Dual | Standard | 121 | 153 | 202 | 5 | 6 |
| devgoat-bash-scripts | Collection | Bash, PHP | Dual | Full | 100 | 135 | 85 | 5 | 12 (6+6) |
| sus-form-detector | Library | PHP, Python | Dual | Standard | 107 | 43 | 82 | 3 | 6 |
| blundergoat-platform | App | TypeScript, Docker | Claude only | Minimal | 62 | — | 73 | 0 | 0 |
| the-summit-chatroom | App | PHP, Python, Docker | Dual | Minimal | 152 | 37 | 0 | 3 | 0 |

**Patterns observed:**
- Full tier projects have both agent-evals/ and codex-evals/, all enforcement layers, CI validation, and codex-playbooks
- AGENTS.md runs 35% larger than CLAUDE.md on the same project (135 vs 100 on bash-scripts)
- Largest footguns.md is 202 lines on the Tauri app (cross-domain TypeScript + Rust complexity)
- the-summit-chatroom's CLAUDE.md at 152 lines triggers anti-pattern AP1 (-5 deduction)

---

## Anti-Patterns (Scoring Deductions)

These are actively harmful configurations the system penalises:

| Anti-Pattern | Deduction | Why It's Harmful |
|-------------|-----------|-----------------|
| Instruction file over 150 lines | -5 | Degrades compliance on ALL rules uniformly |
| `/review` skill shadows built-in | -3 | Naming conflict causes unpredictable skill invocation |
| DoD in both instruction file and guidelines | -3 | Agent follows whichever read last — inconsistent behaviour |
| Footguns without file:line evidence | -3 | Likely fabricated — no way to verify or maintain |
| settings.json invalid JSON | -3 | Hooks won't load — enforcement silently disabled |
| Stop hook exits non-zero | -2 | Causes infinite fix loops (agent tries to fix the "error" forever) |
| Local instruction file over 20 lines | -2 | Defeats the purpose of lightweight local context |
| Generic Ask First boundaries | -2 | Copy-pasted from template without adapting to the project |
| settings.local.json committed to git | -2 | Should be gitignored — may contain secrets or local overrides |

Maximum deduction: -15. Score cannot drop below 0.

---

## Repository Structure

```
workflow/
├── FIVE_LAYER_SYSTEM.md              — Architecture overview (the document you're reading a summary of)
├── FIVE_STEP_LOOP.md                 — Execution loop deep dive
├── getting-started.md                — Entry point, reading order, gotchas
├── system-summary-for-external-review.md — This document
│
├── runtime/                          — Layer 1: instruction file setup
│   ├── claude-code-prompts.md           Phase 0/1a/1b/1c/2 for Claude Code (457 lines)
│   ├── codex-prompts.md                 Codex equivalent (239 lines)
│   ├── enforcement-prompt.md            Hooks, settings, permissions setup
│   ├── guidelines-split-prompt.md       Guidelines ownership audit
│   ├── permission-profiles-prompt.md    Per-role permission files
│   ├── rfc2119-pass-prompt.md           MUST/SHOULD/MAY compression pass
│   ├── 05-code-map-prompt.md            Generate project code map
│   ├── 06-system-architecture-prompt.md Generate architecture doc
│   └── 08-claude-md-hot-path-prompt.md  Generate instruction file structure
│
├── local-context/                    — Layer 2: directory-level instruction files
│   └── 07-domain-instruction-files-prompt.md
│
├── skills/                           — Layer 3: skill reference + creation prompts
│   ├── README.md                        Skill catalogue, justification test, rationale
│   ├── preflight-prompt.md
│   ├── debug-investigate-prompt.md
│   ├── audit-prompt.md
│   ├── research-prompt.md
│   └── code-review-prompt.md
│
├── playbooks/                        — Layer 4: methodology playbooks
│   ├── planning/                        Feature brief → SBAO → milestones
│   └── testing/                         Doer-verifier testing workflow
│
├── evaluation/                       — Layer 5: quality infrastructure prompts
│   ├── agent-evals-prompt.md            Regression test suite from real incidents
│   ├── ci-validation-prompt.md          GitHub Actions context validation
│   ├── footguns-prompt.md               Architectural landmine seeding
│   ├── lessons-prompt.md                Behavioural learning loop
│   ├── confusion-log-prompt.md          Structural confusion tracking
│   └── handoff-template-prompt.md       Session handoff template
│
├── _reference/                       — System specification and rationale
│   ├── system-spec.md                   Full technical specification (438 lines)
│   ├── design-rationale.md              Why behind every decision (328 lines)
│   ├── cross-agent-comparison.md        Claude Code vs Codex analysis
│   └── examples.md                      Real project implementation data
│
└── _draft/                           — Archived source files (8 files, preserved)
```

---

## Design Principles

1. **Behaviour engineering over rule lists.** A structural loop that prevents failure modes is more reliable than a wall of "don't do X" rules the agent eventually ignores.

2. **Evidence over aspiration.** Every design decision traces to a real incident, published research, or implementation data. No hypothetical "best practices."

3. **Budget awareness.** The instruction file is a constrained resource (~100-150 lines). Every line competes for attention. The system offloads to layers 2-5 to keep Layer 1 high-signal.

4. **Enforcement in depth.** Three layers (permissions deny → hooks → instruction rules) with decreasing bypass risk. The Never tier is mechanically enforced, not just requested.

5. **Independent verification.** The agent that did the work cannot verify it. Testing requires separate verifiers (automated, AI, human) running in parallel.

6. **Designed to shrink.** Quarterly audits remove rules that models have learned to follow without instruction. The system gets smaller as models improve, not larger.

7. **Honest about limitations.** The Codex enforcement gap is documented, not hidden. The hook saga failure is preserved as a cautionary tale. The system says what it can't do, not just what it can.

---

## Questions for Reviewers

1. Does the 5-layer architecture with loading-time semantics (always / auto / on-demand / CI) make sense as an organising principle? Would you structure it differently?

2. Is the execution loop (READ → CLASSIFY → ACT → VERIFY → LOG) missing any steps? Are any steps unnecessary?

3. The instruction budget constraint (~100-150 lines) is based on limited research. Do you have evidence that supports or contradicts this target?

4. The enforcement gap between Claude Code (3 layers) and Codex (instruction rules only) is acknowledged but not solved. Is there a better approach for agents without hook support?

5. The anti-pattern scoring model treats all deductions equally within their tier. Should some anti-patterns be weighted more heavily?

6. The skill justification test (distinct artifact, hard gate, special failure mode, repeatable output) rejected 4 former skills. Is this test too strict or too lenient?

7. The doer-verifier testing model assumes a 1:1 coding-to-testing ratio. Is this realistic for production use? Too cautious? Not cautious enough?

8. The guidelines ownership split (CLAUDE.md owns workflow, guidelines owns engineering) resolved overlapping DoDs on real projects. Does this boundary hold for all project types?

9. The quarterly shrink principle assumes models will improve and rules will become unnecessary. Is this assumption safe? What if models regress on specific behaviours?

10. What's the weakest part of this system? What would you change first?
