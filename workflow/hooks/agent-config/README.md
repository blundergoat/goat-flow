# Claude Code Permission Denies

`claude.json` intentionally keeps the path operands of its `Read(...)` and `Edit(...)` deny rules identical. Claude Code states: “Edit rules apply to all built-in tools that edit files.” This means an `Edit(path)` deny gates `Edit`, `Write`, and `NotebookEdit` for that path. A `Read(path)` deny also blocks `Edit` and `Write`, but does not cover `NotebookEdit`, so both path sets remain necessary.

Do not add scoped `Write(path)` duplicates. Claude Code accepts that spelling but does not consult it during permission checks and warns about it at startup. A bare `Write` rule is different: it matches the tool globally rather than one path.

Source: [Claude Code permissions: Read and edit](https://code.claude.com/docs/en/permissions#read-and-edit), fetched 2026-08-16. The parity regression lives in `test/unit/audit-command/agent-deny-hooks-drift.test.ts`.
