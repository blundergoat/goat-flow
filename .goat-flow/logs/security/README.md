# Security Review History

Findings from `/goat-security` Persist Gate land here. Written when the user approves persistence after the Phase 6 closing gate.

Committed:

- `README.md` only

Local-only (gitignored):

- `<YYYY-MM-DD>-<artifact-slug>.md` - confirmed and probable findings with severity, asset, entry→sink, trust boundary, preconditions, blast radius, and proof-of-fix pointers

Use:

- Reference prior security reviews when assessing the same area again
- Feed S-NN finding codes into downstream artifacts (milestones, critique hooks, implementation tasks)
- Compare security posture across review runs on the same surface

These files are gitignored by design. If a finding should become durable project knowledge, promote it into `.goat-flow/footguns/`, `.goat-flow/lessons/`, or `.goat-flow/decisions/`.
