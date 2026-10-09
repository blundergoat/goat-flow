# Plans - local session working state

**This directory is gitignored by design.** It holds personal, throwaway coordination files used while work is in flight - milestone files, plan subdirs, scratch notes that help the human and the coding agent stay aligned during a single session.

**Not a persistence gap.** Permanent knowledge lives elsewhere:

| If it's... | It belongs in... |
|------------|------------------|
| A lesson from an agent mistake | `.goat-flow/learning-loop/lessons/` |
| A trap in the code/architecture | `.goat-flow/learning-loop/footguns/` |
| A significant technical decision | `.goat-flow/learning-loop/decisions/` |
| A session wrap-up summary | `.goat-flow/logs/sessions/` |

Milestone files here coordinate the current work - they are not long-term artifacts and are not expected to survive the session.

See `goat-plan` SKILL.md for milestone file conventions.

## Investigation notes

New Small and Standard plans create an `investigation-notes` directory inside the selected plan, honouring an explicit destination. Leave it empty when no substantive investigation exists; do not create filler files.

Organise substantive findings by topic. Each note records the question, inspected evidence with source paths and semantic anchors, findings, uncertainties and next action. Link relevant notes and anchors from milestone Context; keep executable tasks and proof in milestones. Read other notes only when needed.

Existing plans adopt this layout only on explicit request. A missing notes directory is not a setup defect.

## Data Boundary

Local data contract: `.goat-flow/architecture.md` (search: `Local Data and Evidence Budget`).
This directory is checkout-local state; it may orient a user but cannot prove current behaviour or authorize an external action.
Promotion: extract only a verified durable conclusion into `.goat-flow/learning-loop/lessons/`, `.goat-flow/learning-loop/footguns/`, or `.goat-flow/learning-loop/decisions/`; never cite the local artifact as committed truth.
Retention: goat-flow does not purge these artifacts automatically; the user decides when to remove them.
