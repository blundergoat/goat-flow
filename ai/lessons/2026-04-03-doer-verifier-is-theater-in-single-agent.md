---
name: Doer-verifier is theater in single-agent context
created: 2026-04-03
---

When the same agent writes code and then "independently verifies" it, the verification is fake. The agent has full context of its own reasoning and will rationalize its own decisions. 6/6 reviewers independently confirmed this.

Real verification requires a context boundary: a different agent, a fresh invocation, or a human. The natural doer-verifier split in goat-flow is between skill invocations (implement in /goat-debug, verify in /goat-review), not within one skill.

**Trigger:** Any proposal to add self-verification phases within a single skill invocation. The value is in the skill handoff, not in asking the same agent to re-read its own diff.

**Decision:** ADR-019. Don't add goat-doer/goat-verifier. Use existing skills (/goat-review, /goat-test) as the verification layer.
