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
