# GOAT Flow -- Getting Started

**Version:** 1.5 | 2026-03-15
**Companion to:** `setup/` (agent setup guides) and `docs/system-spec.md` (plan)

---

## What This Is

A system that gives Claude Code a 6-step execution loop (READ -> CLASSIFY -> SCOPE -> ACT -> VERIFY -> LOG) instead of a wall of rules. Two files do the work -- a design doc (the system spec) and a set of prompts you feed to Claude Code. You run the prompts; Claude Code builds the system for your project.

## Reading Order

1. **This file** -- how to start
2. **The spec** (`docs/system-spec.md`) -- full reference for every design decision
3. **The setup** (`setup/setup-claude.md` or `setup/setup-codex.md`) -- what you run
4. **The rationale** (`docs/reference/design-rationale.md`) -- deep dives on why each section exists
5. **The examples** (`docs/reference/examples.md`) -- real implementation data from 7 projects

## Before You Start

1. **Copy the system spec and setup prompts into your project root.**
   - `docs/system-spec.md`
   - The setup guide from `setup/` -- use `setup-claude.md` for Claude Code or `setup-codex.md` for Codex

2. **Rename if needed.** The prompts reference the system spec by exact filename. If your copies have prefixes or version suffixes, rename them to match.

3. **Audit your existing guidelines file.** If you have an `ai-agent-guidelines.instructions.md` (or similar), open the prompts and read the "Before You Start: Guidelines Ownership Audit" section. Remove overlapping content from guidelines *manually* before running any prompts. This is the one step you do by hand. If your project uses domain-specific `.github/instructions/` files instead of a single shared file, skip this audit -- they don't overlap with CLAUDE.md.

4. **Know your project shape.** You'll need to fill in blanks in the prompts:
   - Is this an **APP**, **LIBRARY**, or **SCRIPT COLLECTION**?
   - Languages, build command (or "none"), test command, lint command, format command (or "none")

## Implementation Order

Run these in Claude Code. Copy each prompt from the runtime directory, fill in the bracketed placeholders, paste into Claude Code.

| Step | Prompt | What It Creates | Time |
|------|--------|-----------------|------|
| **Phase 0** | Phase 0 bootstrap | CLAUDE.md + deny-dangerous hook + settings.json | ~5 min |
| **Phase 1a** | Prompt A (new) or Prompt B (existing CLAUDE.md) | CLAUDE.md, docs seed files, architecture.md, local CLAUDE.md files, guidelines-ownership-split.md | ~15 min |
| **Phase 1b** | Phase 1b -- Skills | 7 skill files under `.claude/skills/` | ~10 min |
| **Phase 1c** | Phase 1c -- Enforcement | Hooks, CI workflow, gitignore additions | ~10 min |
| **Phase 2** | Phase 2 | Agent evals, RFC 2119 pass, permission profiles | ~15 min |

**Skip Phase 0** if you're running Phase 1 (Phase 0 is a minimal bootstrap for when you want just the basics).

**Phase 2 should run immediately after Phase 1** -- do not defer. When asked to implement GOAT Flow, coding agents should complete all phases (1a through 2) in the same session. Early-stage projects with a short git history can seed evals from common stack failure modes and replace with real incidents as they occur.

## Choosing Your Path

```
New project, no CLAUDE.md exists?
  -> Phase 0 (minimal) OR Phase 1a Prompt A (full)

Existing project with a CLAUDE.md full of domain content?
  -> Phase 1a Prompt B (migrates domain content to docs/domain-reference.md)

Just want the bare minimum to try it?
  -> Phase 0 only. Add skills and hooks later.
```

## What to Check After Each Phase

**After Phase 1a:**
- [ ] CLAUDE.md line count reported -- under 120?
- [ ] If Prompt B: open `docs/domain-reference.md` and verify nothing was silently dropped. Compare against the original CLAUDE.md
- [ ] `docs/footguns.md` contains real footguns with file:line evidence, not hypothetical ones
- [ ] `docs/guidelines-ownership-split.md` exists and documents the migration
- [ ] Budget a second pass -- agents aggressively cut content during compression. The anti-BDUF guard and sections (f)-(i) are commonly dropped then needed back

**After Phase 1b:**
- [ ] Router table in CLAUDE.md references all skill directories
- [ ] Preflight checks pass

**After Phase 1c:**
- [ ] `.claude/settings.json` is valid JSON
- [ ] Permissions deny list includes `*git commit*` and `*git push*`
- [ ] Test the deny-dangerous hook: ask Claude Code to run `git push --force origin main` -- it should be blocked by the deny-dangerous hook
- [ ] Stop hook exits 0 even when it finds issues (non-zero = infinite loops)
- [ ] If no formatter configured: PostToolUse hook was skipped (not created as a linter duplicate)

**After Phase 2:**
- [ ] CLAUDE.md still under line target after RFC 2119 pass
- [ ] Agent evals are from real incidents, not invented scenarios

## Adoption Tiers

You don't have to do everything. Pick your tier:

| Tier | What You Run | Good For |
|------|-------------|----------|
| **Minimal** | Phase 0 only | Trying it out, solo project |
| **Standard** | Phase 1a + 1b + 1c | Active development |
| **Full** | Phase 1 + Phase 2 | All projects (implement both phases together) |

**When to graduate:** Phase 0 is for experiments. Move to the full system when: first production user, first team contributor, first real incident, or first month of active development.

## Ongoing Maintenance

**Weekly:** Run Claude Code's `/insights` to review learning loop patterns (analyses your recent session history for recurring patterns). Look for friction that could become a new rule or footgun. For other agents: Gemini CLI uses `/memories`, Cursor users should review their rules periodically.

**When something breaks:** After Claude causes a bug, add it to `docs/lessons.md` (behavioural) or `docs/footguns.md` (architectural). If it's worth regression-testing, create an agent eval in `agent-evals/`.

**Quarterly:** Re-count CLAUDE.md lines. Check for stale rules. Ask: "if I removed this, would the model still do the right thing?" Archive lessons not triggered in 30+ days.

**When models improve:** The system is designed to shrink. Rules that compensated for model weaknesses become unnecessary. Delete them.

## Common Gotchas

- **Consider separate sessions per phase.** The prompts were split to stay within instruction budget. One session per phase is safest. If context budget allows (smaller codebases), running all phases sequentially in one session can work -- the medical scribe did this successfully.
- **The migration (Prompt B) drops content silently.** Sections that partially overlap with your guidelines file get cut without warning. Always diff.
  - Fix: Compare original CLAUDE.md + new CLAUDE.md + domain-reference.md against the original. Check nothing was silently dropped.
- **Prompt B can miss sections (f)-(i).** Sub-Agent Objectives and Communication When Blocked are easy to skip when Prompt B cross-references Prompt A by letter. The v1.5 prompts list them explicitly, but verify all sections exist after Phase 1a.
- **First-pass CLAUDE.md is usually over target.** Budget a compression pass. The plan has a cut priority list -- essential commands go first, execution loop never gets cut.
  - Fix: Apply the cut priority list from the system spec. Cut verbose examples first, then explanatory paragraphs, then duplicated content. Never cut execution loop, autonomy tiers, or DoD.
- **Hooks must use absolute paths.** All hook commands use `git rev-parse --show-toplevel`. Relative paths break when the working directory changes.
- **Stop hooks must exit 0.** Even when they find errors. Non-zero exit codes trap Claude in infinite fix loops.
  - Fix: Verify the hook exits 0 even on errors. Add the infinite loop guard: if [ "${STOP_HOOK_ACTIVE:-}" = "1" ]; then exit 0; fi
- **Secret scanning is manual.** The `gitleaks` setup requires `git config --global` which affects all repos. Do it yourself, don't let Claude Code do it. Document it in README, not CLAUDE.md.
- **Pre-existing footguns don't need replacement.** If docs/footguns.md already exists with real entries, the implementation should merge, not replace. Some projects need zero new footguns -- that's fine.
- **Pre-existing hooks need migration.** If .claude/settings.json already has inline hook commands, migrate them to external scripts under .claude/hooks/ during Phase 1c.
- **Skip PostToolUse if no formatter.** Shell scripts, for example, have no standard formatter. Don't create a format hook that re-runs the linter.
- **Dual-agent repos need coordination.** If you run both Claude Code and Codex implementations on the same project, they share docs/footguns.md and docs/lessons.md. Changes by one agent affect the other. Run Claude Code first (it creates the shared docs), then Codex (it merges with existing files).

## File Reference

After full implementation, your project will have:

```
CLAUDE.md                              <- Layer 1: the loop (~120 lines)
src/auth/CLAUDE.md (etc.)              <- Layer 2: local context (if qualifying dirs exist)
.claude/skills/goat-preflight/SKILL.md  <- Layer 3: skills
.claude/skills/goat-debug/SKILL.md
.claude/skills/goat-audit/SKILL.md
.claude/skills/goat-investigate/SKILL.md
.claude/skills/goat-review/SKILL.md
.claude/hooks/deny-dangerous.sh        <- enforcement
.claude/hooks/stop-lint.sh
.claude/hooks/format-file.sh           <- skip if no formatter configured
.claude/settings.json
docs/lessons.md                        <- learning loop
docs/footguns.md
docs/confusion-log.md
docs/architecture.md
docs/domain-reference.md               <- Prompt B path only
docs/guidelines-ownership-split.md     <- migration rationale
docs/decisions/
tasks/handoff-template.md
agent-evals/                           <- Phase 2
.github/workflows/context-validation.yml  <- Phase 2
```

## Implementation Evidence

**Implementation evidence:** GOAT Flow has been implemented across 7 projects: 1 fully public (devgoat-bash-scripts), 4 private (rampart, ambient-scribe, sus-form-detector, DevGoat Tauri app), and 2 in progress (strands-php-client, the-summit-chatroom).

**File paths:** All paths in this documentation use forward slashes from the repo root (e.g., `docs/system-spec.md`, `setup/setup-claude.md`). If a referenced file doesn't exist at the stated path, check that you have the latest version of the repo.

## Further Reading

- **The spec** (`docs/system-spec.md`) -- full system design, rationale for every section, hook design patterns, security hardening details
- **The rationale** (`docs/reference/design-rationale.md`) -- deep dives on why each section exists
- **Cross-agent comparison** (`docs/reference/cross-agent-comparison.md`) -- how this adapts across Claude Code and Codex
- **Real examples** (`docs/reference/examples.md`) -- implementation data from 7 projects
- **The playbook repo** ([ai-planning-playbook](https://github.com/blundergoat/ai-planning-playbook)) -- planning prompts (mob elaboration, SBAO ranking, milestone planning)
- **Scaffold prompts** (`workflow/runtime/`) -- project scaffolding prompts
- **Testing workflow** (`workflow/playbooks/testing/`) -- testing-related workflow files
