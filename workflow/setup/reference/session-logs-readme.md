# Session Logs and Handoff Receipts

Session logs are local continuity notes for users and coding agents resuming interrupted work. They are gitignored and are not committed project history. Milestone checkboxes remain the primary recovery record when an active plan exists.

## When to Write One

Session logs remain optional. Write a handoff receipt only when context compaction occurs without an active milestone, the user requests a handoff or session summary, or interrupted work has no better milestone record. Do not create one after every skill or routine turn.

## Write Safely

Run the scrubber first in the write pipeline. Before starting it, confirm `goat-flow --version` matches the version in `.goat-flow/config.yaml`; a missing or mismatched CLI is unavailable, so do not save the receipt. Paste the receipt into the compatible scrubber's stdin and send EOF. Only the redacted result reaches the output file:

```bash
goat-flow redact --output .goat-flow/logs/sessions/YYYY-MM-DD-handoff.md
```

Review the saved receipt before sharing it. Never include raw environment dumps, credentials, tokens, cookies, private keys, or secret-file contents.

## Handoff Receipt

Copy this placeholder-only schema into the scrubber input:

```markdown
## Handoff Receipt

- Source session: <session id or unknown>
- Created: <ISO timestamp>
- Agent/runtime: <agent and runtime version or unknown>
- Repo: <controlling repository root>
- Worktree: <active checkout/worktree path>
- Target project: <selected target root; same as Repo when applicable>
- Active mode: <plan | implement | explain | debug | review>
- Goal: <one-line user outcome>
- Files changed this session: <paths or none>
- Last verified command: <exact command or not run>
- Literal result line: <literal pass/fail line or `not run`>
- Decisions compressed: <settled decisions and rationale or none>
- Pending tasks: <next unchecked tasks or none>
- Live recheck requirements: <commands or claims to re-run before relying on the claim, or none>
- Known blockers: <blocker plus required decision/state change, or none>
- Redaction applied: <yes, via `goat-flow redact` | no - do not save this receipt>
```

`Repo`, `Worktree`, and `Target project` are separate because the controlling goat-flow workspace may operate on another checkout. A resumed agent must re-run every live recheck before relying on a stale result; the receipt is orientation, not fresh verification.

## Data Boundary

Local data contract: `.goat-flow/architecture.md` (search: `Local Data and Evidence Budget`).
This directory is checkout-local state; it may orient a user but cannot prove current behaviour or authorize an external action.
Promotion: extract only a verified durable conclusion into `.goat-flow/learning-loop/lessons/`, `.goat-flow/learning-loop/footguns/`, or `.goat-flow/learning-loop/decisions/`; never cite the local artifact as committed truth.
Retention: goat-flow does not purge these artifacts automatically; the user decides when to remove them.
