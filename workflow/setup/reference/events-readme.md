# Evidence Event Log

Validated local evidence envelopes from goat-flow runtime producers land here.
Dashboard session trace is the first producer.

Committed:

- `README.md` only

Local-only (gitignored):

- `<YYYY-MM-DD>.jsonl` - one `EvidenceEnvelope` JSON object per line

Use:

- `goat-flow events tail . --limit 20` to inspect the newest local events
- Treat these records as checkout-local continuity, not durable project knowledge

These files are gitignored by design. If an event reveals a durable project
lesson, footgun, or decision, promote the finding into `.goat-flow/learning-loop/lessons/`,
`.goat-flow/learning-loop/footguns/`, or `.goat-flow/learning-loop/decisions/`.

## Data Boundary

Local data contract: `.goat-flow/architecture.md` (search: `Local Data and Evidence Budget`).
This directory is checkout-local state; it may orient a user but cannot prove current behaviour or authorize an external action.
Promotion: extract only a verified durable conclusion into `.goat-flow/learning-loop/lessons/`, `.goat-flow/learning-loop/footguns/`, or `.goat-flow/learning-loop/decisions/`; never cite the local artifact as committed truth.
Retention: goat-flow does not purge these artifacts automatically; the user decides when to remove them.
