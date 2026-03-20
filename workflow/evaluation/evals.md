# Prompt: Create Agent Eval Regression Suite

Paste this into your coding agent to create the agent eval suite for your project.

---

## The Prompt

```
Create an agent eval regression suite for this project. Agent evals are
replay tests — each one recreates a real incident and verifies the agent
handles it correctly. They catch regressions when CLAUDE.md changes.

This project is a [APP / LIBRARY / SCRIPT COLLECTION].

1. Create the agent-evals/ directory

2. Create agent-evals/README.md explaining:
   - What agent evals are (replay tests for agent behaviour)
   - How to use them (paste the replay prompt, verify expected outcome)
   - How to add new ones (after every real incident)
   - Format: bug description, replay prompt, expected outcome, failure mode

3. Search this project's git history and issues for real incidents:

   git log --oneline --all | grep -iE 'fix|revert|bug|broke|regression'

   For each qualifying incident, create agent-evals/[incident-name].md:

   # [Incident Title]

   ## Bug Description
   [What went wrong, with file:line references to the code involved]

   ## Replay Prompt
   ```
   [The exact prompt to paste into a fresh agent session that recreates
   the scenario. Should be self-contained — the agent should be able to
   encounter the same failure mode from this prompt alone.]
   ```

   ## Expected Outcome
   [What the agent should do correctly — specific, verifiable actions]

   ## Known Failure Mode
   [What the agent did wrong originally, so you know what to watch for]

   ## Origin
   [git hash, issue number, or "real-history" — proves this is from
   a real incident, not fabricated]

4. If the project has fewer than 3 qualifying incidents in git history,
   create evals from common failure modes for the project's stack:
   - [For web apps] Auth bypass, silent API contract change, migration
     that passes tests but breaks production
   - [For libraries] Public API breaking change, dependency version
     conflict, test that passes but doesn't test what it claims
   - [For scripts] Shared source file change breaking downstream,
     environment variable dependency, path assumption failure

   Mark these as "synthetic-seed" origin. Replace with real incidents
   as they occur.

VERIFICATION:
- Verify agent-evals/ directory exists
- Verify agent-evals/README.md exists
- Count eval files (target: 3-5 minimum)
- Verify each eval has all 5 sections (description, replay prompt,
  expected outcome, failure mode, origin)
- Verify at least some evals reference real git hashes or issues
- Report: number of evals created, how many from real incidents vs
  synthetic seeds
```
