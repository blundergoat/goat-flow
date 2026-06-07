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
