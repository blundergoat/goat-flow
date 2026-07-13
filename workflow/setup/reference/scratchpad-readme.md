# Scratchpad - ephemeral working notes

**This directory is gitignored by design.** It holds throwaway WIP files: mid-conversation notes, draft release text, exploratory snippets, anything the human or coding agent wants to keep *for the current session* without committing.

**Not a persistence gap.** Permanent knowledge lives elsewhere:

| If it's... | It belongs in... |
|------------|------------------|
| A lesson from an agent mistake | `.goat-flow/learning-loop/lessons/` |
| A trap in the code/architecture | `.goat-flow/learning-loop/footguns/` |
| A significant technical decision | `.goat-flow/learning-loop/decisions/` |
| A session wrap-up summary | `.goat-flow/logs/sessions/` |
| A plan or milestone file | `.goat-flow/plans/` (also local-only) |

Drop anything here that helps you get the job done right now and doesn't need to be part of the project's history.

## Data Boundary

Local data contract: `.goat-flow/architecture.md` (search: `Local Data and Evidence Budget`).
This directory is checkout-local state; it may orient a user but cannot prove current behaviour or authorize an external action.
Promotion: extract only a verified durable conclusion into `.goat-flow/learning-loop/lessons/`, `.goat-flow/learning-loop/footguns/`, or `.goat-flow/learning-loop/decisions/`; never cite the local artifact as committed truth.
Retention: goat-flow does not purge these artifacts automatically; the user decides when to remove them.
