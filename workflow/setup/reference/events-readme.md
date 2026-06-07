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
