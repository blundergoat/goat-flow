# Quality Report History

Saved agent quality reports land here. Agents write the JSON directly from the quality prompt - no `capture` step.

Committed:

- `README.md` only

Local-only (gitignored):

- `<YYYY-MM-DD>-<HHMM>-<agent>-<rand5>.json` - validated quality report (positional finding ids attached at load time)
- Any companion `.md` prose an agent chooses to save alongside

Use:

- `goat-flow quality history` to inspect saved runs and same-agent score deltas
- `goat-flow quality diff` to derive `resolved`, `new`, `persisted`, and `stuck`

These files are gitignored by design. If a finding should become durable project knowledge, promote it into `.goat-flow/learning-loop/footguns/`, `.goat-flow/learning-loop/lessons/`, or `.goat-flow/learning-loop/decisions/`.

## Data Boundary

Local data contract: `.goat-flow/architecture.md` (search: `Local Data and Evidence Budget`).
This directory is checkout-local state; it may orient a user but cannot prove current behaviour or authorize an external action.
Promotion: extract only a verified durable conclusion into `.goat-flow/learning-loop/lessons/`, `.goat-flow/learning-loop/footguns/`, or `.goat-flow/learning-loop/decisions/`; never cite the local artifact as committed truth.
Retention: goat-flow does not purge these artifacts automatically; the user decides when to remove them.
