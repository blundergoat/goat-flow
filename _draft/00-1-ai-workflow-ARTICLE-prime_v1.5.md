# Stop Writing Rules. Build a Workflow.

**How I taught Claude Code to stop guessing and start following a loop.**

---

Every task follows five steps: **READ → CLASSIFY → ACT → VERIFY → LOG.** That's the entire system. The rest of this article explains why each step exists, what broke before it did, and how to set it up for your project in under an hour.

Most public CLAUDE.md files are a wall of rules: "never do X, always do Y, don't forget Z." That's a list, not a workflow. And the research backs this up — frontier models reliably follow 150-200 instructions before performance degrades uniformly. More rules doesn't mean better compliance. It means worse compliance across the board.

So instead of more rules, I built a loop.

---

## What Keeps Going Wrong

I've been using Claude Code daily for six months across projects ranging from a multi-stack Tauri desktop app (TypeScript + Rust) to an ambient medical scribe (PHP + Python + NeMo GPU + Mercure) to a single-language PHP library to a multi-domain shell script collection. The failure modes are identical regardless of stack:

**Claude fabricates codebase facts.** I asked about a dependency. Claude confidently told me it was a local path dependency. I checked the package manifest — it was installed from a registry. Claude never read the file. It guessed, and it guessed wrong. → **READ forces the agent to look at the code before talking about it.**

**Claude can't tell questions from instructions.** I asked "did you also improve the Claude Code setup in this project?" Claude answered "No" — then a validation hook rejected the response for "asking permission instead of implementing." Nobody asked it to implement anything. → **CLASSIFY makes the agent declare its mode before acting. Questions get answers, not implementations.**

**Claude declares victory early.** Tests pass, but the old function name still appears in three files because nobody grepped for it after the rename. → **VERIFY runs checks after every meaningful change, and the Definition of Done has six explicit gates — not just "tests green."**

**Claude drifts between modes silently.** You ask it to explain something. Halfway through, it starts editing files. You ask it to plan. It reads four files, reads four more, reads four more — planning loop, zero output. → **ACT defines what each mode means and requires explicit state transitions.**

None of these are model failures. They're workflow failures. Claude is capable of doing all of this correctly — it just needs structure that makes the right behaviour the default behaviour.

---

## The Five-Step Loop

**READ** forces the agent to look at the code before talking about it. For multi-layer apps, read both sides of a boundary before changing either. For libraries, read tests alongside implementation. For script collections, read source chains — which `_common.sh` files are sourced and how. Never fabricate — if you haven't read it, say so.

**CLASSIFY** makes the agent declare what mode it's in (Plan, Implement, Explain, Debug, Review) and what complexity level it's dealing with — before it touches anything. Mode transitions must be explicit: "Switching to Implement mode because the plan is approved." Silent drift is the #1 source of planning loops and premature fixes.

**ACT** defines what each mode actually means. Implement = write code within 2-3 turns. Explain = no code changes unless asked. Debug = diagnosis with file:line evidence first, fixes only after human reviews findings. If you catch the agent reading a 4th file without writing anything in Implement mode, something's wrong.

**VERIFY** runs tests after every meaningful change, not just at the end. Two-level stop-the-line escalation: isolated failures get noted and continued past; cross-boundary or security failures get a full stop with diagnosis. Two corrections on the same approach = cut your losses and rewind.

**LOG** captures what went wrong in two complementary files: `docs/lessons.md` for behavioural mistakes ("assumed API contract without reading frontend") and `docs/footguns.md` for architectural landmines ("auth nonce spans 4 components; breaking any one silently breaks login"). These are loaded contextually, not every session.

The footguns file seeds itself during setup. The implementation prompt tells Claude Code to read the actual codebase and find real cross-domain coupling — not invent hypothetical ones. On the PHP library, it found six: normalization pipeline order dependencies, binary dictionary cache version coupling, regex error suppression in the XSS scorer, and three more — all with file:line evidence. On the medical scribe, it found eight — despite the project being at milestone 1. Multi-stack projects create coupling early; most of the scribe's footguns came from unvalidated cross-layer contracts and in-memory state management, not feature complexity. These aren't boilerplate warnings. They're the sharp edges a new contributor would hit on day two.

Not every project needs footgun seeding. The shell script collection already had eight well-structured footgun entries with Symptoms/Why/Prevention format and commit evidence. The implementation prompt added zero — the existing entries already covered all discoverable cross-domain coupling. That's a third path the prompts now handle: "seed from reading the codebase" for new projects, "seed from common failure modes" for projects with no history, and "merge with existing" for projects that already track their sharp edges.

The footguns file also feeds a second mechanism: **local CLAUDE.md files.** A file at `src/auth/CLAUDE.md` is automatically loaded whenever Claude works in that directory — no explicit loading required. When a footgun maps to a specific directory, a one-line summary is propagated to that directory's local CLAUDE.md. Put the guardrail where the danger is, not in a file the agent might skip.

A related finding from the shell script collection: `.github/instructions/` files with `applyTo` frontmatter can serve the same purpose as local CLAUDE.md files. The project had `stacks.instructions.md` scoped to `lib/stacks/` — it auto-loads when Claude touches that directory, just like a local CLAUDE.md would. Only `lib/ai-cli/` needed a local CLAUDE.md because it was the only domain without instruction file coverage. If your project already uses scoped instruction files, audit whether they make local CLAUDE.md files redundant before creating them.

One limitation: not every footgun maps cleanly to a directory. The medical scribe had a WebSocket URL mismatch spanning `.env`, `docker-compose.yml`, and a Twig template — three root-level files across three layers. No single subdirectory qualifies for a local CLAUDE.md. Some footguns are cross-cutting configuration, not module-specific. The central footguns.md catches these; the propagation rule doesn't.

---

## Where It Lives

The loop sits in a layered system where only the first layer loads every session:

```
Layer 1 — Runtime (CLAUDE.md, ~100-120 lines)       ← loads every session
Layer 2 — Local Context (directory-level CLAUDE.md)  ← auto-loads per directory
Layer 3 — Skills (3-5 focused slash commands)        ← loads on demand
Layer 4 — Playbooks (planning workflows)             ← loads on demand
Layer 5 — Evaluation (agent evals, CI validation)     ← loads on demand
```

100-120 lines. That's the entire always-loaded instruction set. Everything else loads when needed. This matters because auto-generated context files reduce success rates by ~3% while increasing inference cost by over 20%. The system prompt consumes ~50 of the model's ~150-200 instruction budget — so CLAUDE.md gets roughly 100-150 effective instructions. Spend them wisely.

### The Guidelines Split

Most projects accumulate two instruction files: a project-specific CLAUDE.md and a shared coding standards file (often `.github/instructions/ai-agent-guidelines.instructions.md`). These MUST NOT overlap. I learned this the hard way — my Tauri app had a Definition of Done in CLAUDE.md _and_ in the guidelines file, with subtly different gates. The agent followed whichever it read last.

The clean split: **CLAUDE.md owns workflow** (the execution loop, autonomy tiers, DoD, log files, router table). **The guidelines file owns engineering practices** (coding patterns, communication style, testing strategy, error handling templates). If a rule would be identical across every project, it belongs in guidelines. If it changes per project, it belongs in CLAUDE.md.

```
❌ Overlap — agent follows whichever it reads last:
   CLAUDE.md DoD: "tests green, preflight passes, logs updated"
   Guidelines DoD: "tests pass, rollback strategy exists, verification story"

✅ Clean split:
   CLAUDE.md DoD: 6 project-specific gates (tests, preflight, Ask First, logs, notes, grep)
   Guidelines: testing *strategy* (unit for logic, integration for boundaries) — not DoD gates
```

The reduction varies by how much overlap existed. The PHP library's guidelines went from 47 to 39 lines — a modest 17% trim where only the DoD section overlapped. The medical scribe's guidelines went from 95 to 51 lines — a 46% reduction — because the file had a full architecture section, a 7-point cross-layer checklist, stop-the-line rules, and core workflow rules that all belonged in CLAUDE.md. The bigger your existing guidelines file, the more overlap you'll find.

When applying the split, create `docs/guidelines-ownership-split.md` documenting what was moved, what was removed, and why. Both Claude Code and Codex implementations have produced this independently — it preserves the migration rationale in a committed file rather than losing it when the chat session ends.

### Conditional Loading

Claude Code supports `.github/instructions/` files with `applyTo` frontmatter that controls when they load. A file with `applyTo: "**/*.ts"` only loads when Claude touches TypeScript files. Rust conventions only load for `.rs` files. In practice this means a multi-stack project doesn't burn instruction budget on irrelevant language rules:

```yaml
# .github/instructions/rust.instructions.md
---
applyTo: "**/*.rs"
---
# Rust conventions for this project
- Use parking_lot for mutexes, tokio for async
- Never .unwrap() in Tauri commands — propagate errors with context
```

That file is invisible when you're working on TypeScript. Free context savings.

---

## The Hook Saga (or: How I Wasted a Day on Prompt Engineering)

The most interesting failure in this system was the anti-rationalisation hook. The idea was simple: after every Claude response, send it to Haiku for independent assessment. Does the response actually complete the work, or is it rationalising — calling things "pre-existing," deferring to follow-ups nobody asked for, listing problems without fixing them?

Six versions. One day.

| Version | What I Tried                      | What Broke                                                     |
| ------- | --------------------------------- | -------------------------------------------------------------- |
| v0.1    | Single paragraph, no intent check | False positives on every question                              |
| v0.2    | Hook infrastructure                | Exit codes, infinite loop guard — no prompt iteration          |
| v0.3    | Keyword matching for user intent  | Haiku can't see the user message — it only gets the response   |
| v0.4    | Response-pattern detection        | Haiku returned prose instead of JSON                           |
| v0.5    | Two-step flow with JSON preamble  | Claude's own "Want me to fix?" offer triggered false match     |
| v0.6    | Pasted content detection          | Best version, but JSON schema fragile across reimplementations |

The fundamental problem: **prompt-type Stop hooks only see the assistant's response.** They can't read the conversation. They can't see what the user asked. Intent detection is always inferred, never observed.

The moment that killed it: I asked "did you also improve the Claude Code setup in this project?" Claude correctly answered "No — want me to?" The hook rejected this as "asking permission instead of implementing." The terminal showed the same wrong rejection three times — once as the hook output, once as a framework echo, once in the summary wrapper. One false positive, displayed as emphatic consensus.

The conclusion: **deterministic command hooks for mechanical enforcement, CLAUDE.md rules for behavioural guidance.** A `deny-dangerous.sh` PreToolUse hook that blocks `rm -rf`, force pushes, and pipe-to-shell patterns works 100% of the time. A prompt hook trying to judge whether work is complete works maybe 70% of the time — and the 30% failure rate erodes trust faster than the 70% success rate builds it.

One hook doesn't apply universally: the PostToolUse format hook requires a configured formatter. Shell scripts have no standard auto-formatter. The bash script collection skipped this hook entirely — creating one that re-runs shellcheck would duplicate the stop hook. If your stack doesn't have a formatter (prettier, php-cs-fixer, rustfmt, gofmt), skip PostToolUse rather than inventing busywork for it.

This is worth knowing because if you're building agent workflows, you will be tempted to build this exact hook. Save yourself the day.

---

## What You Get

The system breaks down into three adoption tiers:

| Tier         | What                                                     | When                                     |
| ------------ | -------------------------------------------------------- | ---------------------------------------- |
| **Minimal**  | CLAUDE.md + deny-dangerous hook                          | Getting started, solo project            |
| **Standard** | + 3-5 skills + stop/format hooks + local CLAUDE.md files | Active development, team project         |
| **Full**     | + agent evals + CI validation + permission profiles + ADRs | Long-lived project with incident history |

The key pieces:

**Autonomy tiers** — not everything needs permission, not everything is free. Tests and linting? Always run. Public API changes, database migrations, dependency additions? Stop and ask first, with a micro-checklist (which boundary, did you read the related code, what's the rollback command). Delete test files to make builds pass? Never.

Note: the autonomy tiers in CLAUDE.md are behavioural guidance. The actual tool-level permissions live in `.claude/settings.local.json` — you'll build this allowlist over time as you approve commands repeatedly. Start empty, grow organically.

**Definition of Done** — six explicit gates. Tests green, preflight passes, no unapproved boundary changes, logs updated if you tripped, working notes current, old patterns grepped after renames. The agent can't say "task complete" until all six are true.

**Stack-adaptive hooks** — define your stack once, hooks adapt. The build verification hook checks `git diff` for modified file types and only runs relevant checks. A Rust change runs `cargo fmt --check`. A PHP change runs `php -l`. A TypeScript change runs `tsc --noEmit`. A shell script change runs `bash -n` + `shellcheck`. No changes, no checks.

**Project-specific deny rules** — beyond the universal blocks (rm-rf, force push), add blocks for files that must be modified through tooling. A PHP library with binary-encoded dictionaries? Block direct edits to `.bin` files — the encoder script is the only safe path. Generated code? Block direct edits — the generator is the source of truth. A shell script collection with generated `docs/code-map.md`? Block direct edits — the codegen script is the source of truth. GPU model files too large for direct edit? Block `.nemo` files. Infrastructure changes without a plan? Block `terraform apply` without a preceding `terraform plan`. The categories expand with the project.

---

## Adapting to Your Project

The system adapts to project shape. I've run it on four projects: a multi-stack Tauri desktop app (TypeScript + Rust), a zero-dependency PHP library, a four-layer medical scribe (PHP + Python + NeMo GPU + Mercure + Terraform), and a multi-domain shell script collection (bash + PHP dashboard). Same plan, same prompts, different outputs. Two of these — the medical scribe and the shell script collection — also have Codex implementations. The Codex versions produced similar footgun counts and identical eval sets from the same git history. See "Same Project, Different Agent" for the full comparison.

The adaptation is real, not cosmetic. The PHP library's Ask First boundaries name specific classes (`SusFormDetector`, `SusAssessment`, `SusFactor`), specific data files (`profanity_words.bin`, `safe_names.json`), and the binary encoding pipeline. The Tauri app's boundaries name auth, routing, deployment, and cross-layer changes. The medical scribe's boundaries name eight items including PHP↔Python API contracts, the NeMo GPU singleton, Mercure topics, and Strands agent model provider switching. The shell script collection's boundaries name shared `_common.sh` files, CONFIGURATION template blocks, WSL PATH sanitisation, logging paradigm consistency, and scoped instruction files. The structure is identical; every detail is project-specific.

The deny-dangerous hook adapts too. All four projects block the universal patterns (rm-rf, force push, pipe-to-shell). The PHP library adds blocks for binary dictionary files. The Tauri app adds blocks for .env modifications. The medical scribe adds blocks for `.nemo` model files and `terraform apply` without a plan. The shell script collection adds blocks for CONFIGURATION block edits via sed/awk and for the generated `docs/code-map.md`.

The shell script collection exposed a gap in the app/library binary. This project has 10+ domains under `lib/`, three different source-chain patterns, three logging paradigms, and a cross-domain coupling where shell output is parsed by an external PHP dashboard. The Ask First boundaries look more like an app's than a library's — shared source files, logging paradigm consistency, and template configuration blocks are all boundary-crossing concerns. But it has no build system, no single entry point, and a flat-ish structure. The plan's library column mostly applied (100-line target, no permission profiles, optional confusion-log), but the skill count and Ask First boundaries needed app-level attention. If your project doesn't fit cleanly into "app" or "library," read both columns and pick the stricter guidance for each row.

Getting CLAUDE.md under the line target depends on the starting point. The PHP library (Prompt A — new file) took 127 lines on first pass and required two compression passes. The medical scribe (Prompt B — existing CLAUDE.md migration) landed at 114 lines on first pass, well under the 120 target. The shell script collection (Prompt B) landed at 89 lines on first pass, well under the 100 target — then grew to 101 when missing sections were added, and compressed to 96 after the RFC 2119 pass. The difference: Prompt B migrates domain content to `docs/domain-reference.md` first, which clears the canvas. The entire line budget goes to the execution loop instead of fighting existing content for space. If your project has a content-heavy CLAUDE.md, Prompt B may be the easier path.

| Aspect                  | App (Tauri)                                   | Library (PHP)                               | App (Medical Scribe)                                              | Collection (Bash Scripts)                                              |
| ----------------------- | --------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| CLAUDE.md               | 121 lines                                     | 99 lines                                    | 118 lines                                                         | 96 lines                                                               |
| Skills                  | 6 (core + /research, /code-review, /review)   | 3 (core only)                               | 5 (2 updated, 3 new)                                             | 4 (3 new + 1 pre-existing)                                            |
| Footguns seeded         | 14                                            | 6                                           | 8                                                                 | 8 (all pre-existing, 0 new needed)                                     |
| Agent evals             | 5 (from real incidents)                       | 5 (from git history)                        | 5 (3 real incidents, 2 common modes)                             | 5 (all real git history)                                               |
| Ask First boundaries    | Auth, routing, deployment, API contracts, DB  | Public API, dependencies, data/config files | 8 (PHP↔Python contracts, NeMo, Mercure, Docker, env, Terraform) | 6 (CONFIGURATION blocks, _common.sh, WSL PATH, new domains, logging, instructions files) |
| Local CLAUDE.md files   | Planned (14 footguns suggest qualifying dirs) | None needed (flat structure)                | 2 (strands_agents/, infra/)                                      | 1 (lib/ai-cli/ — only domain without instruction file coverage)         |
| Permission profiles     | 3 (frontend/backend/infra)                    | None (single language)                      | 3 (php-backend/python-agent/infrastructure)                      | None (single language)                                                  |
| Guidelines file         | 258 lines (ownership split pending)           | 47 → 39 lines (17% reduction)               | 95 → 51 lines (46% reduction)                                    | None (domain-specific .github/instructions/ files instead)              |
| Prompt path             | N/A (pre-dates prompts)                       | A (new file)                                | B (existing migration)                                            | B (existing migration)                                                  |
| Compression struggle    | Yes                                           | Yes (127 → 99)                              | No (114 first pass)                                               | No (89 first pass, grew to 101, compressed to 96)                      |
| Format hook             | Yes                                           | Yes                                         | Yes                                                               | Skipped (no formatter)                                                  |
| Implementation sessions | Built over weeks                              | 2 sessions (generate + fix)                 | 1 session (all phases)                                            | 1 session (all phases + corrections)                                    |

Libraries can skip `/research` and `/code-review` when single-domain — the default READ step and Review mode are sufficient. Multi-domain libraries or script collections may need them. Don't create skills that won't earn their place — the skill justification test in the plan requires each skill to have a distinct artefact, a hard workflow gate, a special failure mode, or a repeatable structured output.

The medical scribe revealed a gap in the prompts: it already had three skills and two hooks before implementation. Phase 1b was update-and-extend rather than create-from-scratch. Phase 1c replaced inline hook commands with external scripts. Prompt B handles CLAUDE.md migration, but the prompts don't explicitly address pre-existing skills and hooks. If your project has partial tooling already, expect Phase 1b/1c to adapt rather than create.

Another finding from the scribe: even at milestone 1 with only 11 commits, three of five agent evals came from real git history — an EventSource ordering bug, a Docker volume mount mismatch, and an audio format assumption. The plan expected new projects to lean on common failure modes for seeding evals. Multi-stack projects generate qualifying incidents early because the cross-layer boundaries create failure opportunities before the features do.

---

## How to Set It Up

Two files do all the work. Give them to Claude Code and it builds the system for your project.

### Step 1: Audit your existing files

If you have an `ai-agent-guidelines.instructions.md` or similar shared standards file, remove any execution loop, DoD, stop-the-line, or working memory content. Those now live in CLAUDE.md. Keep engineering practices, communication style, and templates.

### Step 2: Add the plan files

Copy these two files into your project:

- `ai-workflow-improvement-plan-prime.md` — the full system design
- `ai-workflow-implement-prompts-prime.md` — the implementation prompts

Both files are available in the [ai-planning-playbook](https://github.com/blundergoat/ai-planning-playbook) repo.

For Codex adaptation, a separate implementation prompt exists in the same repo (`codex-workflow-implement-prompt.md`). It produces AGENTS.md instead of CLAUDE.md, playbook files instead of slash commands, and validation scripts instead of hooks. If your project will have both agents, run Claude Code first — the Codex prompt handles pre-existing Claude infrastructure gracefully.

### Step 3: Choose your starting point

**New project (no existing CLAUDE.md):** Open the implementation prompts file. Copy the Phase 0 prompt. Edit the stack definition. Run it. You'll get a CLAUDE.md, a deny-dangerous hook, and a settings.json — the Minimal tier.

**Existing project:** Skip Phase 0. The prompts have two variants for Phase 1a — one for new files, one that migrates existing CLAUDE.md domain content to a reference doc before building the workflow system on top. Note: the migration may be incomplete on the first pass. On the PHP library, Code Style and PHP Requirements sections were silently dropped because they partially overlapped with content in the guidelines file. Audit the migration output against the original before continuing.

### Step 4: Iterate

Run Phase 1a, 1b, 1c in order. Each creates a focused set of files. Don't run them all at once — the whole point of splitting them was to stay within the instruction budget. Budget a second pass after Phase 1a to verify nothing was dropped during compression — though Prompt B projects may not need it if the domain content migration frees up enough budget.

Run Phase 2 for the Full tier: agent eval regression tests, RFC 2119 priority markers, CI validation. You can run it immediately after Phase 1 — the medical scribe ran all phases in a single session — though waiting gives you more real incidents to seed evals from. On the PHP library, Phase 2 found five agent evals from real git history — safe-name false positives, evasion patterns, threshold calibration drift. Even a library with no "production incidents" has a git history worth mining.

---

## What's Deliberately Left Out

**Prompt hooks for semantic judgement.** I tried. Six versions. It doesn't work. See the hook saga above.

**Rigid enforcement of every rule.** The plan uses RFC 2119 language (MUST/SHOULD/MAY) to make priority visible. The execution loop, autonomy tiers, and definition of done are MUST. Log hygiene is SHOULD. The structural debt trigger is MAY. Not everything is equally important.

**Global git config changes.** The plan recommends gitleaks for pre-commit secret scanning, but installing it requires `git config --global core.hooksPath` which affects every repo on your machine. That's a manual step documented in README, not something an AI agent should do.

**My project's specific examples.** The plan's examples are illustrative. Replace them with incidents from your own codebase. The principles are universal; the examples are mine.

---

## The Quarterly Shrink

The system is designed to get smaller over time, not larger. The plan includes a quarterly audit: re-count CLAUDE.md lines, check for stale rules, ask "if I removed this, would the model still do the right thing?" Rules that once helped become constraints as models improve.

The learning loop files (lessons.md, footguns.md) have their own hygiene: max 15 active lessons, pattern promotion when 3+ share a theme, entries archived after 30 days untriggered. The goal is a system that teaches itself out of needing individual entries.

---

## TL;DR

Build a five-step loop, enforce it with deterministic hooks, keep it under 120 lines.

---

_Written with AI-assisted cognitive framework ([GOAT System](https://blundergoat.com)). The ideas are mine; the AI helps me articulate them clearly._

_The implementation files are available in the [ai-planning-playbook](https://github.com/blundergoat/ai-planning-playbook) repo._
