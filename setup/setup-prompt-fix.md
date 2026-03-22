# Prompt: Fix GOAT Flow Implementation

Paste into any AI coding agent (Claude Code, Codex, or Gemini CLI) in any project with an existing GOAT Flow implementation to update it to the current spec.

---

## The Prompt

```
Read CLAUDE.md, AGENTS.md, and GEMINI.md (whichever exist in this project).

Read the CURRENT GOAT Flow spec:
- [goat-flow repo]/setup/shared/execution-loop.md
- [goat-flow repo]/docs/system-spec.md

Fix every gap in this project's instruction file(s) against the current
spec. Check ALL of these:

SKILL RENAME + NEW SKILLS:
- goat-research is now goat-investigate. Rename if old name exists.
- 7 skills must exist: goat-security, goat-debug, goat-audit,
  goat-investigate, goat-review, goat-plan, goat-test
- Create any missing skills. goat-plan = 4-phase planning with human
  gates and Triangular Tension Pass. goat-test = 3-track testing
  (automated, AI verification, human testing) based on doer-verifier.

EXECUTION LOOP:
- Loop MUST be 6 steps: READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG
- CLASSIFY: 3 signals (intent, complexity with budgets, mode)
- ACT: state declaration, mode-transition rule, Debug "human reviews diagnosis"
- VERIFY: two-level escalation, revert-and-rescope, recovery protocols
  (2-3 common failure patterns with fixes)
- LOG: MUST-when-tripped, mechanical trigger, human correction trigger,
  footgun propagation, references 3 files (lessons, footguns, decisions/),
  dual-agent coordination if applicable

WORKING MEMORY:
- Context health: compact at 60% utilization (not 90%). Noise pruning.
  Fresh context between unrelated tasks.

TRUTH ORDER (add if missing):
1. User's explicit instruction (this session)
2. Instruction file (CLAUDE.md / AGENTS.md / GEMINI.md)
3. Shared setup templates
4. System spec (canonical reference)
5. Skills / playbooks (on-demand context)

ASK FIRST:
- MUST have explicit 5-item micro-checklist:
  1. Boundary touched: [name]
  2. Related code read: [yes/no]
  3. Footgun entry checked: [relevant entry, or "none"]
  4. Local instruction checked: [local instruction file / .github/instructions/ / none]
  5. Rollback command: [exact command]

SECTIONS:
- (f) Sub-Agent Objectives and (g) Communication When Blocked MUST exist
- Router MUST include all 7 skill/playbook entries, learning loop files,
  architecture, handoff template, agent evals
- Multi-agent: router MUST include other agents' instruction files

ENFORCEMENT:
- Settings/config MUST have Read deny patterns for secrets if applicable

COLD PATH (ai/instructions/):
- Check if `ai/instructions/` exists with base.md, code-review.md, git-commit.md
- Check if `.github/git-commit-instructions.md` exists
- If `.github/instructions/` exists without `ai/instructions/`, recommend migration
  (group language files into domain files: php.md + python.md → backend.md)
- Check if instruction file router table has `ai/README.md` entry

AGENT EVALS:
- Each eval MUST have Origin: real-incident | synthetic-seed
- Each eval MUST have Agents: all | codex | claude | gemini

CONSTRAINTS:
- Instruction files MUST stay at or under 120 lines — compress if needed
- AGENTS.md MUST stay at or under 135 lines
- If you must weaken a MUST to meet the line target, the target is wrong —
  raise it, don't weaken the rule
- Do NOT change Ask First boundaries, DoD gates, or Essential Commands
- Only fix YOUR agent's instruction file — do not modify other agents' files
- After editing, count lines and report totals
- Report what you fixed and what was already compliant
```
