---
category: design-decisions
---

## Lesson: Doer-verifier is theater in single-agent context

**Created:** 2026-04-03

When the same agent writes code and then "independently verifies" it, the verification is fake. The agent has full context of its own reasoning and will rationalize its own decisions. 6/6 reviewers independently confirmed this.

Real verification requires a context boundary: a different agent, a fresh invocation, or a human. The natural doer-verifier split in goat-flow is between skill invocations (implement in /goat-debug, verify in /goat-review), not within one skill.

**Trigger:** Any proposal to add self-verification phases within a single skill invocation. The value is in the skill handoff, not in asking the same agent to re-read its own diff.

**Decision:** ADR-019. Don't add goat-doer/goat-verifier. Use existing skills (/goat-review, /goat-test) as the verification layer.

---

## Lesson: Agent critiques are input, not a spec - validate before implementing

**Created:** 2026-04-03

5 Codex critiques across 5 projects generated 589 pending tasks. That's a rewrite, not an improvement. The critiques are optimized for "what annoyed me in one session" not "what improves outcomes over time."

Risks of blindly implementing critique feedback:
- Removing safety nets (BLOCKING GATEs) that feel like ceremony but prevent mistakes for less experienced users
- Over-correcting on signal from one context (Codex doing setup, single-session perspective)
- No outcome data - nobody measured whether projects WITH the gates produce better code than projects WITHOUT
- 589 tasks shipped at once guarantees breaking things we don't understand yet

**Pattern:** Ship UI/dashboard changes (low risk) separately from framework/skill changes (high risk). Validate each framework change on one real project before applying to templates. Keep a "before" snapshot and diff after each milestone.

**Trigger:** Any batch of changes driven by external critique. Test one change at a time against real outcomes, not against the critic's score.

---

## Lesson: Milestone planning needs cold-start detail and natural scope boundaries

**Created:** 2026-04-13

**What happened:** A 7-agent critique of goat-flow v1.1.0 produced ~35 verified findings. The initial milestone (M25) combined all of them - doc fixes, code bugs, dashboard cleanup, Copilot removal, and scanner system removal - into one file. It took 3 rounds of expansion and eventually split into 3 milestones (M25 docs, M26 code, M27 scanner removal). The first drafts had task descriptions but no file:line references, no current content, no replacement text, and no verification commands. A fresh agent would have had to re-discover everything.

Five specific patterns emerged:

1. **Milestones that mix docs + code + structural changes are too large.** The natural fault line is: docs-only (safe, no dependencies) → code fixes (within existing architecture) → structural overhaul (rewrites). A 35-item milestone is System-scale. goat-plan's own complexity routing should catch this.

2. **"npm test passes" is not a verification step.** The most useful verification tasks are specific grep commands and bash test scripts that prove the intended change landed. Every task needs a verification command for the specific fix, not just a green build.

3. **No validator catches doc/code drift.** architecture.md had wrong counts for weeks. CONTRIBUTING.md pointed to the wrong subsystem. Dashboard docs listed wrong view names. The audit validates structural setup but not content truthfulness. Quality checks should validate numeric claims in architecture.md against code.

4. **Footgun/lesson entries should be written when the issue is introduced, not when a review catches it.** Five footguns and two lessons were missing at critique time. The VERIFY step's learning-loop gate needs a stronger trigger - if you changed something that could surprise a future reader, document it now.

5. **Milestone files need cold-start detail.** The bar is "can a fresh agent session execute this without re-discovering context?" That means: file:line references, current content quoted, replacement text specified, verification commands you can copy-paste, read-first file lists, execution order guidance.

**Prevention:**
- Split milestones at the docs/code/structural boundary during planning, not after the first draft is too big.
- Every task gets a verification command that proves the specific change, not just that the build passes.
- After any milestone that changes code, grep architecture.md and code-map.md for stale claims.
- Write footgun entries during the milestone that introduces the trap, not during the critique that discovers it.
- Test milestone files by asking "could I hand this to a different agent with no prior context?"

