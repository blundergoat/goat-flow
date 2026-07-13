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

These files are gitignored by design. If a finding should become durable project knowledge, promote it into `.goat-flow/learning-loop/footguns/`, `.goat-flow/learning-loop/lessons/`, or `.goat-flow/learning-loop/decisions/`.

## Data Boundary

Local data contract: `.goat-flow/architecture.md` (search: `Local Data and Evidence Budget`).
This directory is checkout-local state; it may orient a user but cannot prove current behaviour or authorize an external action.
Promotion: extract only a verified durable conclusion into `.goat-flow/learning-loop/lessons/`, `.goat-flow/learning-loop/footguns/`, or `.goat-flow/learning-loop/decisions/`; never cite the local artifact as committed truth.
Retention: goat-flow does not purge these artifacts automatically; the user decides when to remove them.
