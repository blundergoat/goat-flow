# Review Run Artifacts

Temporary artifacts from `/goat-review` runs land here: refutation ledgers, cross-model refuter JSON, redacted diff bundles, chunk receipts, and other review-only evidence files.

Committed:

- `README.md` only

Local-only (gitignored):

- `goat-review-refutations.<random>.txt` - Pass 2 suspicions that were disproved, with evidence and rationale
- `goat-review-refuter.<random>.json` - Pass 3 cross-model refuter output
- `goat-review-bundle.<random>.diff` - redacted frozen bundle of the reviewed diff; a durable receipt of what was reviewed, never the byte authority
- `goat-review-chunks.<random>.md` - cross-invocation chunk receipt for oversized reviews: scope snapshot, bound authority, chunks completed and remaining, findings, and ledger
- `goat-review-<artifact>.<random>.txt` - other review-only temporary artifacts when the skill needs an audit trail

Use:

- Preserve `/goat-review` integrity evidence across session interruptions
- Keep review-only generated files separate from generic `.goat-flow/scratchpad/` working notes

These files are gitignored by design. If a finding should become durable project knowledge, promote it into `.goat-flow/learning-loop/footguns/`, `.goat-flow/learning-loop/lessons/`, or `.goat-flow/learning-loop/decisions/`.

## Data Boundary

Local data contract: `.goat-flow/architecture.md` (search: `Local Data and Evidence Budget`).
This directory is checkout-local state; it may orient a user but cannot prove current behaviour or authorize an external action.
Promotion: extract only a verified durable conclusion into `.goat-flow/learning-loop/lessons/`, `.goat-flow/learning-loop/footguns/`, or `.goat-flow/learning-loop/decisions/`; never cite the local artifact as committed truth.
Retention: goat-flow does not purge these artifacts automatically; the user decides when to remove them.
