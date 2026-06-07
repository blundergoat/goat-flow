---
category: agent-output-trust
last_reviewed: 2026-05-25
---

## Footgun: Agent-produced output may contain control sequences that hijack the host terminal

**Status:** active | **Created:** 2026-05-25 | **Evidence:** EXTERNAL_REFERENCE

**Symptoms:** The agent runs a TUI program (`htop`, `vim`, `tmux`, `nnn`, anything with `\x1b[` escape codes) inside its sandbox. Its stdout includes raw ANSI escape sequences and null bytes. Any framework code that displays that stdout to a real terminal (a trajectory viewer, the dashboard's terminal pane, a log printout, a copy-pasted error message) leaks those sequences directly to the host. Best case: garbled rendering. Worst case: the host terminal hangs, the inspector freezes, the dashboard view becomes unrecoverable until the page is reloaded.

**Why it happens:** Frameworks treat agent stdout as opaque text by default — the agent is "internal trusted code," and we plumb its output to the UI like any other string. But the agent runs arbitrary code inside its sandbox, and arbitrary code includes well-behaved TUI programs whose protocol output is hostile when rendered out-of-context. The bug is invisible in test fixtures (which use plain-text outputs) and only fires on real-world tasks where the agent runs a TUI binary.

**Evidence (external — mini-swe-agent):**
- PR #761 (merged 2026-02-27, `klieret`). Issue: agent ran `./executable` (a TUI) during ProgramBench tasks, its output contained `\x1b[?1049h\x1b[?7l\x1b[?1000h\x00` (alt-screen + private-mode + null-byte sequences), the inspector blindly rendered it via Textual's `Text(content_str)`, and the host terminal froze.
- Fix in external mini-swe-agent path src/minisweagent/run/utilities/inspector.py (search: `Text.from_ansi`): `Text.from_ansi(content_str.replace("\x00", ""))`. The `from_ansi` constructor knows how to render ANSI as styled output instead of raw escape codes; the `replace("\x00", "")` strips the null bytes that Textual cannot handle.
- Regression test in external mini-swe-agent path tests/run/test_inspector.py (search: `sample_ansi_trajectory`) — fixture trajectory contains literal `\x1b[?1049h\x1b[?7l\x1b[?1000h\x00\r\x1b[2K\x1b[39m\x1b[47m`, test asserts the rendered screen contains the human-readable text but neither `\x1b` nor `\x00`.

**Goat-flow applicability — HIGH:** The dashboard's terminal handler is the direct analog:
- `src/cli/server/terminal.ts` (search: `pty.onData((data: string) =>`) — receives raw PTY output from a spawned agent CLI session, broadcasts it via `sendMessage(session.ws, { type: "output", data })` to the dashboard browser without sanitisation.
- The browser-side terminal renderer (likely xterm.js or similar) handles ANSI escapes by design, so the dashboard case is less severe than mini's inspector. But any other surface that displays the same `data` — log files, copy-pasted error messages in audit reports, dashboard tooltips, server-side console logs that include the data — is exposed.
- `src/cli/server/terminal.ts` (search: `detachBuffer.push(data)`) — buffered output kept for late-attaching clients; if anything other than the xterm.js receiver consumes this buffer, sanitisation is required.

**Prevention:**
1. Any code that displays agent stdout to a real terminal (host shell, log file, audit report, dashboard tooltip — anywhere outside an xterm.js-style ANSI-aware renderer) must call an ANSI-aware constructor or strip control characters. Minimum sanitisation: `data.replace(/\x00/g, "").replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")` for plain-text destinations, or use a library like `strip-ansi`.
2. Whenever introducing a new consumer of `pty.onData` output, decide explicitly: "this consumer is ANSI-aware" (xterm.js, Textual `from_ansi`) or "this consumer must strip" (log file, audit report, generic display). Document the decision in the consumer's location so a future maintainer doesn't strip the right thing for the wrong target.
3. Add a regression fixture containing real-world TUI escape sequences. Any new agent-output renderer must pass it.

## Footgun: Provider message shapes have hard constraints that crash on naive slicing

**Status:** active | **Created:** 2026-05-25 | **Evidence:** EXTERNAL_REFERENCE

**Symptoms:** Code that wraps LM-provider responses crashes on edge cases the test fixtures didn't cover. `len(content)` raises because `content` is `None` instead of `""`. Anthropic API rejects a request because the last block in an assistant message is a `thinking` block. A tool-result block has its `content` extracted as if it were a `text` block. The shape contracts are documented somewhere in the provider's SDK but easy to violate when slicing/filtering messages defensively.

**Why it happens:** Provider message shapes are union types in the wild (`content: string | list[Block] | None`), and each provider has its own hard constraints (Anthropic's thinking-block ordering, OpenAI's Responses API stateless flattening, Claude's None-content for tool-use-only turns). Defensive code that assumes a single shape — `for item in msg["content"]:`, `if len(msg["content"]) > 0:`, `text = msg["content"][0]` — works on the happy-path fixture and crashes on the real-world variant.

**Evidence (external — mini-swe-agent), three PRs in two months:**
- **PR #708** (merged 2026-01-21, `aorwall`): Anthropic API requires `thinking` and `redacted_thinking` blocks to NOT be the final block in assistant content. Mini's fix in external mini-swe-agent path src/minisweagent/models/utils/anthropic_utils.py (search: `_reorder_anthropic_thinking_blocks`) re-orders blocks so thinking comes first, and adds an empty `text` block after if only thinking blocks exist.
- **PR #704** (merged 2026-01-19, `aorwall`): Anthropic assistant turns with only `tool_use` have `content=None`, not `content=""`. `_set_cache_control` did `entry["content"][0]["cache_control"] = ...` which crashed on None. Fix in external mini-swe-agent path src/minisweagent/models/utils/cache_control.py (search: `Handle None content`) adds explicit `if entry["content"] is None:` checks at every access point.
- **PR #783** (merged 2026-03-21, `klieret`): `get_content_string` in external mini-swe-agent path src/minisweagent/models/utils/content_string.py (search: `Anthropic tool use`) needed separate handling for `tool_use` (extract `input`), `tool_result` (extract `content`), and text blocks. The original implementation just joined `item.get("text", "")` for every list item, returning empty strings for tool_use/tool_result blocks.

**Goat-flow applicability — LOW today, MEDIUM future:** Goat-flow does not directly wrap LM providers. But several surfaces will grow this exposure:
- The proposed evidence envelope (per `improvement-ideas-codex.md`'s top recommendation) will carry provider-shaped messages across surfaces. Each surface that reads them needs the same defensive shape probes mini learned.
- AG-UI dashboard integration receives structured message events from agent runners; any code that consumes `message.content` must distinguish string vs list vs None.
- Trajectory replay (per `.goat-flow/plans/related-improvement-ideas/M03-deterministic-skill-replay.md`) replays recorded provider messages; the replay harness needs to handle the same shape variants mini does.

**Prevention:**
1. When wrapping any LM provider message shape, never assume the content field is non-null. Always: `if content is None:` BEFORE `len(content)` BEFORE `content[0]`.
2. When the provider has documented ordering constraints (Anthropic's thinking-block rule, response-API's function_call_output keying), add a normalisation step at the boundary that enforces those constraints regardless of how the rest of the code touched the message. mini's `_reorder_anthropic_thinking_blocks` runs unconditionally before every API call.
3. For union types, write the test fixture for *each* shape variant. A `string | list[Block] | None` content field needs at least three fixtures, plus one for the empty-list edge case.
4. Treat each provider's edge-case discoveries as feed-back into a shared sanitiser. If goat-flow ever ships an evidence envelope that carries provider-shaped messages, port mini's `_prepare_messages_for_api`, `_get_content_text`, and `get_content_string` shapes wholesale rather than re-deriving them.
