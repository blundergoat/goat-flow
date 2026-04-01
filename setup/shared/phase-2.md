# Phase 2 - Evals & Hygiene (shared across all agents)

Complete Phase 1 before starting Phase 2.

---

```
AGENT EVALS:
1. Create ai/evals/ directory with README.md if they don't exist.
   Read existing evals first - do NOT duplicate incidents already covered.

2. Search this project's git history for real incidents:
   git log --oneline -50 | grep -iE 'fix|revert|hotfix|bug|broke|rollback'

3. For each qualifying incident (up to 5), create ai/evals/[name].md
   with YAML frontmatter and markdown body:

   ---
   name: [kebab-case-name]
   description: "[one-line description]"
   origin: real-incident
   agents: all | claude | codex | gemini
   skill: goat-debug | goat-review | goat-security | etc.
   ---
   ## Replay Prompt (exact text to paste into a fresh agent session)
   ## Expected Outcome (what the agent should produce)
   ## Failure Mode (what went wrong originally)

   Only create evals for incidents that are genuinely useful for testing
   agent behaviour. Do NOT create evals just to hit a count target.
   If fewer than 5 real incidents exist, create fewer - quality over quantity.

RFC 2119 PASS:
4. Review the instruction file and apply MUST/SHOULD/MAY to every rule:
   - MUST: execution loop steps, autonomy tiers, definition of done
   - SHOULD: log hygiene, working memory, session handoffs
   - MAY: structural debt trigger, communication when blocked
   Compress prose in the SAME pass. Instruction file MUST stay under target.

HYGIENE:
5. Create .goat-flow/tasks/handoff-template.md with usage guidance at the top
   (when to create, when to read) and these sections:
   ## Date, ## Status, ## Current State, ## Key Decisions Made,
   ## Known Risks, ## Next Step

6. Create tasks/.gitignore:
   *
   !.gitignore
   !handoff-template.md

7. Add agent-local settings to .gitignore if not already there
   (e.g., .claude/settings.local.json for Claude Code).

VERIFICATION:
- GATE: ai/evals/ has eval files with YAML frontmatter and Replay Prompt sections.
- GATE: .goat-flow/tasks/handoff-template.md has all 6 required sections (Date through Next Step).
- GATE: Count MUST/SHOULD/MAY in instruction file - need 10+.
- GATE: Instruction file is still under 120 lines after RFC 2119 pass.
```
