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
