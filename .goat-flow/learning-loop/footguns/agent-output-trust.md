---
category: agent-output-trust
last_reviewed: 2026-08-15
---

## Footgun: Agent-produced output may contain control sequences that hijack the host terminal

**Status:** active | **Created:** 2026-05-25 | **Evidence:** EXTERNAL_REFERENCE

**Prevention:**
1. If code displays agent stdout outside an xterm.js-style ANSI-aware renderer (host shell, log file, audit report, dashboard tooltip), then call an ANSI-aware constructor or strip control characters. Minimum sanitisation: `data.replace(/\x00/g, "").replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")` for plain-text destinations, or a library such as `strip-ansi`.
2. Whenever introducing a new consumer of `pty.onData` output, decide explicitly: "this consumer is ANSI-aware" (xterm.js, Textual `from_ansi`) or "this consumer must strip" (log file, audit report, generic display). Document the decision in the consumer's location so a future maintainer doesn't strip the right thing for the wrong target.
3. Add a regression fixture containing real-world TUI escape sequences. Any new agent-output renderer must pass it.


**Symptoms:** The agent runs a TUI program (`htop`, `vim`, `tmux`, `nnn`, anything with `\x1b[` escape codes) inside its sandbox. Its stdout includes raw ANSI escape sequences and null bytes. Any framework code that displays that stdout to a real terminal (a trajectory viewer, the dashboard's terminal pane, a log printout, a copy-pasted error message) leaks those sequences directly to the host. Best case: garbled rendering. Worst case: the host terminal hangs, the inspector freezes, the dashboard view becomes unrecoverable until the page is reloaded.

**Why it happens:** Frameworks treat agent stdout as opaque text by default — the agent is "internal trusted code," so the framework plumbs its output to the UI like any other string. But the agent runs arbitrary code inside its sandbox, and arbitrary code includes well-behaved TUI programs whose protocol output is hostile when rendered out-of-context. The bug is invisible in test fixtures (which use plain-text outputs) and only fires on real-world tasks where the agent runs a TUI binary.

**Evidence (external — mini-swe-agent):**
- PR #761 (merged 2026-02-27, `klieret`). Issue: agent ran `./executable` (a TUI) during ProgramBench tasks, its output contained `\x1b[?1049h\x1b[?7l\x1b[?1000h\x00` (alt-screen + private-mode + null-byte sequences), the inspector blindly rendered it via Textual's `Text(content_str)`, and the host terminal froze.
- Fix in external mini-swe-agent path src/minisweagent/run/utilities/inspector.py (search: `Text.from_ansi`): `Text.from_ansi(content_str.replace("\x00", ""))`. The `from_ansi` constructor knows how to render ANSI as styled output instead of raw escape codes; the `replace("\x00", "")` strips the null bytes that Textual cannot handle.
- Regression test in external mini-swe-agent path tests/run/test_inspector.py (search: `sample_ansi_trajectory`) — fixture trajectory contains literal `\x1b[?1049h\x1b[?7l\x1b[?1000h\x00\r\x1b[2K\x1b[39m\x1b[47m`, test asserts the rendered screen contains the human-readable text but neither `\x1b` nor `\x00`.

**Goat-flow applicability — HIGH:** The dashboard's terminal handler is the direct analog:
- `src/cli/server/terminal.ts` (search: `pty.onData((data: string) =>`) — receives raw PTY output from a spawned agent CLI session, broadcasts it via `sendMessage(session.ws, { type: "output", data })` to the dashboard browser without sanitisation.
- The browser-side terminal renderer (likely xterm.js or similar) handles ANSI escapes by design, so the dashboard case is less severe than mini's inspector. But any other surface that displays the same `data` — log files, copy-pasted error messages in audit reports, dashboard tooltips, server-side console logs that include the data — is exposed.
- `src/cli/server/terminal.ts` (search: `detachBuffer.push(data)`) — buffered output kept for late-attaching clients; if anything other than the xterm.js receiver consumes this buffer, sanitisation is required.
