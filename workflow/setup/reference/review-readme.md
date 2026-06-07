# Review Run Artifacts

Temporary artifacts from `/goat-review` runs land here: refutation ledgers, cross-model refuter JSON, and other review-only evidence files.

Committed:

- `README.md` only

Local-only (gitignored):

- `goat-review-refutations.<random>.txt` - Pass 2 suspicions that were disproved, with evidence and rationale
- `goat-review-refuter.<random>.json` - Pass 3 cross-model refuter output
- `goat-review-<artifact>.<random>.txt` - other review-only temporary artifacts when the skill needs an audit trail

Use:

- Preserve `/goat-review` integrity evidence across session interruptions
- Keep review-only generated files separate from generic `.goat-flow/scratchpad/` working notes

These files are gitignored by design. If a finding should become durable project knowledge, promote it into `.goat-flow/learning-loop/footguns/`, `.goat-flow/learning-loop/lessons/`, or `.goat-flow/learning-loop/decisions/`.
