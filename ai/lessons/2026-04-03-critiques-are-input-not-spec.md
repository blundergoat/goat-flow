---
name: Agent critiques are input, not a spec — validate before implementing
created: 2026-04-03
---

5 Codex critiques across 5 projects generated 589 pending tasks. That's a rewrite, not an improvement. The critiques are optimized for "what annoyed me in one session" not "what improves outcomes over time."

Risks of blindly implementing critique feedback:
- Removing safety nets (BLOCKING GATEs) that feel like ceremony but prevent mistakes for less experienced users
- Over-correcting on signal from one context (Codex doing setup, single-session perspective)
- No outcome data — nobody measured whether projects WITH the gates produce better code than projects WITHOUT
- 589 tasks shipped at once guarantees breaking things we don't understand yet

**Pattern:** Ship UI/dashboard changes (low risk) separately from framework/skill changes (high risk). Validate each framework change on one real project before applying to templates. Keep a "before" snapshot and diff after each milestone.

**Trigger:** Any batch of changes driven by external critique. Test one change at a time against real outcomes, not against the critic's score.
