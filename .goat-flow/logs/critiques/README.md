# Critique Run History

Phase 3 snapshots from `/goat-critique` runs land here. Written automatically before the Phase 4 blocking gate so work survives session interruptions.

Committed:

- `README.md` only

Local-only (gitignored):

- `<YYYY-MM-DD>-<HHMM>-<artifact-slug>-<rand5>.md` - sub-agent summaries, comparison matrix, cross-examination outcomes, rubric coverage gaps (`HHMM` + random suffix prevent collisions across concurrent agents)

Use:

- Resume an interrupted critique by reading the snapshot and re-entering Phase 4
- Compare critique runs across sessions on the same artifact

These files are gitignored by design. If a finding should become durable project knowledge, promote it into `.goat-flow/learning-loop/footguns/`, `.goat-flow/learning-loop/lessons/`, or `.goat-flow/learning-loop/decisions/`.

## Data Boundary

Local data contract: `.goat-flow/architecture.md` (search: `Local Data and Evidence Budget`).
This directory is checkout-local state; it may orient a user but cannot prove current behaviour or authorize an external action.
Promotion: extract only a verified durable conclusion into `.goat-flow/learning-loop/lessons/`, `.goat-flow/learning-loop/footguns/`, or `.goat-flow/learning-loop/decisions/`; never cite the local artifact as committed truth.
Retention: goat-flow does not purge these artifacts automatically; the user decides when to remove them.
