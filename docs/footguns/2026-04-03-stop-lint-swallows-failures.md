---
name: stop-lint.sh swallows failures with || true
status: open
created: 2026-04-03
evidence_type: ACTUAL_MEASURED
---

Hook template `workflow/hooks/stop-lint.sh` uses `|| true` after lint/type-check commands. This means the hook NEVER exits non-zero, even when lint fails. CLAUDE.md claims PHPStan level 10 enforcement — the hook doesn't enforce it.

**Evidence:** Found independently by Codex critiques on the-summit-chatroom (`.claude/hooks/stop-lint.sh:22`, `:29`, `:37` all swallow failure) and blundergoat-platform.

**Related:** `format-file.sh` reads `.tool_input.file_path` but PostToolUse uses top-level `.file_path` per `workflow/runtime/enforcement.md:125`. `deny-dangerous.sh` parses `.command // .input` but template says `.tool_input.command` per `workflow/runtime/enforcement.md:69`.

**Impact:** The entire hook enforcement layer is dishonest. Projects pass the scanner's enforcement check while hooks never actually block anything.

**Fix:** M19 in `.goat-flow/tasks/0.10.0/M19-setup-reliability.md`. Remove `|| true`, fix JSON key mismatches, add smoke-test to setup completion.
