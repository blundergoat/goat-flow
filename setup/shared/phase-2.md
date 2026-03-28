# Phase 2 — Evals & Hygiene (shared across all agents)

Complete Phase 1 before starting Phase 2.

---

```
AGENT EVALS:
1. Create agent-evals/ directory with README.md if they don't exist.
   Read existing evals first — do NOT duplicate incidents already covered.

2. Search this project's git history for real incidents:
   git log --oneline -50 | grep -iE 'fix|revert|hotfix|bug|broke|rollback'

3. For each qualifying incident (up to 5), create agent-evals/[name].md:
   - **Origin:** real-incident
   - **Agents:** all | claude | codex | gemini
   - **Skill:** goat-debug | goat-review | goat-security | etc.
   - ## Replay Prompt (exact text to paste into a fresh agent session)
   - ## Expected Outcome (what the agent should produce)
   - ## Failure Mode (what went wrong originally)

   Only create evals for incidents that are genuinely useful for testing
   agent behaviour. Do NOT create evals just to hit a count target.
   If fewer than 5 real incidents exist, create fewer — quality over quantity.

RFC 2119 PASS:
4. Review the instruction file and apply MUST/SHOULD/MAY to every rule:
   - MUST: execution loop steps, autonomy tiers, definition of done
   - SHOULD: log hygiene, working memory, session handoffs
   - MAY: structural debt trigger, communication when blocked
   Compress prose in the SAME pass. Instruction file MUST stay under target.

HYGIENE:
5. Create tasks/handoff-template.md with sections:
   ## Status, ## Current State, ## Key Decisions, ## Known Risks, ## Next Step

6. Create tasks/.gitignore:
   *
   !.gitignore
   !handoff-template.md

7. Add .claude/settings.local.json to .gitignore (if not already there).

VERIFICATION:
- GATE: agent-evals/ has eval files with Origin and Replay Prompt sections.
- GATE: tasks/handoff-template.md has all 5 required sections.
- GATE: Count MUST/SHOULD/MAY in instruction file — need 10+.
- GATE: Instruction file is still under 120 lines after RFC 2119 pass.
```
