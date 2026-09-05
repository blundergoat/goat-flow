---
category: agent-output-trust
last_reviewed: 2026-09-05
---

## Footgun: Agent-produced output may contain control sequences that hijack the host terminal

**Status:** active | **Created:** 2026-05-25 | **Evidence:** EXTERNAL_REFERENCE

**Prevention:**
1. When code displays agent stdout anywhere other than an ANSI-aware renderer (host shell, log file, audit report, dashboard tooltip), strip control characters first: at minimum `data.replace(/\x00/g, "").replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")`, or a library such as `strip-ansi`.
2. Every new consumer of `pty.onData` output states, at the consumer, whether it is ANSI-aware (xterm.js, Textual `from_ansi`) or must strip, so a maintainer does not strip the right thing for the wrong target.
3. Any new agent-output renderer passes a fixture containing real TUI escape sequences before it ships.

**Symptoms:** The agent runs a TUI program (`htop`, `vim`, `tmux`, `nnn`) in its sandbox and its stdout carries raw escape sequences and null bytes. Framework code that shows that stdout on a real terminal, in a log, or in a copied error message leaks them to the host: garbled rendering at best, a hung terminal or an unrecoverable dashboard view at worst.

**Why it happens:** Frameworks treat agent stdout as opaque trusted text and plumb it to the UI like any string, but the agent runs arbitrary code whose protocol output is hostile out of context. Test fixtures use plain text, so the bug fires only on real tasks.

**Evidence:** External, mini-swe-agent PR #761 (merged 2026-02-27): a TUI executable emitted `\x1b[?1049h\x1b[?7l\x1b[?1000h\x00`, the inspector rendered it through Textual's `Text(content_str)`, and the host terminal froze. The fix in the external file src/minisweagent/run/utilities/inspector.py (search: `Text.from_ansi`) renders ANSI as styled output after stripping null bytes, and the external regression in tests/run/test_inspector.py (search: `sample_ansi_trajectory`) asserts neither `\x1b` nor `\x00` reaches the screen. Local analog: `src/cli/server/terminal.ts` (search: `pty.onData((data: string) =>`) broadcasts raw PTY output to the dashboard, whose xterm.js pane handles ANSI by design, and the same file (search: `detachBuffer.push(data)`) buffers it for late-attaching clients; any other consumer of that buffer, such as a log or audit report, must sanitise.
