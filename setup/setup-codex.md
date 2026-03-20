# Setup - Codex

Set up GOAT Flow for a project using Codex (OpenAI).

**Before you start:** Read [shared/guidelines-audit.md](shared/guidelines-audit.md) and do the audit if applicable.

Prefer a single session. If the repo is too large for one clean pass, finish the foundation first and report the split explicitly.

---

## Context Prompt

Paste this first:

```text
I have the GOAT Flow system - a 6-step execution loop (READ → CLASSIFY →
SCOPE → ACT → VERIFY → LOG) with autonomy tiers, a definition of done,
and a learning loop. I want to set it up for Codex.

Read this file for the full system design:
- docs/system-spec.md

Now adapt this system for Codex. NOT a copy - a Codex-native implementation
that respects how Codex actually works.

CODEX MECHANICS (respect these):
- AGENTS.md is the root instruction file (not CLAUDE.md)
- No slash commands - use playbook .md files in docs/codex-playbooks/
- No hooks system - use AGENTS.md rules + verification scripts
- apply_patch for edits (not Edit/Write tool)
- Codex may run in cloud sandboxes or local constrained shells
- No /compact, no /clear, no /insights - context is per-task
- No .claude/ directory structure, no settings.json, no profiles
- No permissions deny list (this is the biggest enforcement gap vs
  Claude Code - document it honestly, don't pretend it's equivalent)

REPO STATE:
- If this project already has a Claude Code implementation (.claude/,
  CLAUDE.md, agent-evals/), leave those files untouched. Create Codex
  equivalents alongside them.
- If workflow docs already exist (docs/lessons.md, docs/architecture.md),
  treat as pre-existing: read, merge with, or rewrite in place.
- If docs/footguns.md is shared, merge carefully. Do not remove entries
  that Claude Code may depend on without flagging the removal.

WHAT TO BUILD (in this order):

1. AGENTS.md - Root instruction file with the sections listed in
   setup/shared/execution-loop.md. Adapt for Codex: use LOG (not RECORD),
   reference playbook files instead of slash commands.
   Target: under 135 lines (Codex files run ~35% larger than Claude Code
   because enforcement can't be offloaded to hooks).
   Do NOT skip sections (f)–(i) - they are small but required.
   The loop MUST be: READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG.
   CLASSIFY MUST include read/turn budgets per complexity tier.

   MUST include these exact rules (agents skip them without reinforcement):
   - ACT: state declaration "State: [MODE] | Goal: [one line] | Exit: [condition]"
     AND mode-transition rule "Switching to [NEW STATE] because [reason]."
   - ACT Debug mode: "No fixes until human reviews diagnosis" (not just
     "until diagnosis exists")
   - LOG: mechanical trigger (VERIFY failure or course correction →
     lessons.md entry required before DoD)
   - LOG: human correction trigger (MUST log immediately)
   - LOG: footgun propagation rule (propagate to nearest routed
     domain/instruction doc for Codex, local CLAUDE.md for Claude)
   - LOG: dual-agent coordination (read shared files before appending)
   - Ask First: use the explicit 5-item micro-checklist from the spec
     (item 4 = relevant local instruction checked: .github/instructions/<file> / CLAUDE.md / none)

   DUAL-AGENT REPOS: Do not create Codex assets under .claude/, but
   AGENTS.md MUST reference existing Claude assets (CLAUDE.md, agent-evals/)
   in the router table and SHOULD align shared semantics (loop, budgets,
   LOG triggers, Ask First checklist shape) unless a Codex mechanic
   requires divergence.

2. Docs seed files - Create the files listed in setup/shared/docs-seed.md.

3. Codex playbooks - docs/codex-playbooks/:
   - goat-preflight.md - RFC 2119 constraints for build verification
   - goat-research.md - Deep-read template with hard gate
   - goat-debug.md - Diagnosis-first with file:line evidence
   - goat-audit.md - 4-pass with fabrication self-check
   - goat-review.md - Structured review with RFC 2119 severity

4. Verification scripts - scripts/:
   - scripts/preflight-checks.sh - Build, lint, test for the stack.
     Wrap existing preflight if one exists, don't replace it.
   - scripts/context-validate.sh - Instruction file line count, router
     references resolve, playbook files exist.
   - scripts/deny-dangerous.sh - Policy documentation + verification.
     Include --self-test flag. Acknowledge this is NOT runtime blocking
     like Claude Code's PreToolUse hook - it's a policy doc and
     verification script.

5. Agent evals - add Codex-specific evals to agent-evals/ (single
   shared directory for all agents). Read existing evals first — do NOT
   duplicate incidents already covered.
   At least 1-2 evals MUST test Codex-specific mechanics: deny-dangerous
   is policy not runtime blocking, no slash commands (use playbooks),
   no /compact or /clear, preserve Claude files in dual-agent repos,
   or AGENTS.md/CLAUDE.md alignment drift.
   Each eval MUST declare Origin: real-incident | synthetic-seed.
   Each eval MUST declare Agents: all | codex | claude.

VERIFICATION:
- AGENTS.md is concise and under 135 lines
- All seed files exist
- Playbooks exist with required sections
- Verification scripts are executable
- Footguns are real with file:line evidence
- Router table references resolve
```

---

## After Codex Runs - Human Checklist

- [ ] AGENTS.md has 6-step loop (with SCOPE), autonomy tiers, DoD, router table
- [ ] AGENTS.md ACT has state declaration AND mode-transition rule
- [ ] AGENTS.md LOG has mechanical trigger, human correction trigger, footgun propagation
- [ ] AGENTS.md Ask First has explicit 5-item micro-checklist (not compressed prose)
- [ ] AGENTS.md uses LOG (not RECORD)
- [ ] docs/footguns.md entries have file:line evidence (not fabricated)
- [ ] docs/guidelines-ownership-split.md exists (if guidelines were trimmed)
- [ ] All 5 playbooks exist in docs/codex-playbooks/ with goat-* prefix
- [ ] scripts/deny-dangerous.sh --self-test passes
- [ ] scripts/context-validate.sh runs cleanly
- [ ] Router table references all resolve to real files
- [ ] Ask First boundaries are project-specific (not generic template)
- [ ] agent-evals/ has at least 1-2 Codex-mechanics evals (Agents: codex)
- [ ] If dual-agent: no Claude Code files were modified or removed
- [ ] If dual-agent: no duplicate evals in agent-evals/
- [ ] If dual-agent: compare AGENTS.md vs CLAUDE.md for same loop, budgets, LOG triggers, Ask First shape, DoD gates
- [ ] Test deny-dangerous by asking Codex to run `git push --force origin main`

---

## What This Intentionally Does Not Include

| Claude Code Feature | Why Codex Skips It |
|--------------------|--------------------|
| PreToolUse hooks | Codex has no hook system. deny-dangerous.sh is policy doc, not runtime blocker. |
| Permission profiles | Codex has no native profile support. Document roles in AGENTS.md if needed. |
| Local CLAUDE.md files | Codex doesn't auto-load per-directory. Use .github/instructions/ with applyTo instead. |
| Slash commands | Codex uses playbook .md files. Same content, different invocation. |
| Strict line target | AGENTS.md runs ~35% larger. No hard ceiling - aim for concise but don't sacrifice clarity. |
| Permissions deny list | No equivalent in Codex. Behavioural guidance only (~30% compliance vs ~100% mechanical). |

---

## Phase 2

**Implement immediately after Phase 1.** Do not defer.

See [shared/phase-2.md](shared/phase-2.md) for the full prompt.
