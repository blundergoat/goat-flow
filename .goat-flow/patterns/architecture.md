---
category: architecture
last_reviewed: 2026-05-22
---

## Pattern: Use POSIX-shape paths for every user-visible string
**Context:** Anywhere a `path.*` result is embedded in CLI output, prompts, audit findings, JSON payloads, dashboard rendering, log messages, or shell snippets the user/agent will execute. Distinct from `fs` operations, which accept either separator.
**Approach:** Centralise the "host -> display" conversion at the emission boundary. Local helpers like `evidencePath`, `displayTemplatePath`, `relPosix`, `toBashPath`, `toShellProjectPath` all do `.replace(/\\/g, "/")` (and use `path.posix.join` when composing with a known POSIX sub-path, to avoid `resolve()` drive-prefixing POSIX inputs on Windows). The fs side keeps using native `join`/`resolve`/`relative`. A single repo grep for `\\\\` in test output assertions or for `path.relative` / `path.resolve` adjacent to a `lines.push(...)` flags candidate sites.

## Pattern: Model cross-platform PTY launches as pure spawn specs
**Context:** Terminal or runner integrations that must work on native Windows and POSIX shells.
**Approach:** Keep shell/args/env selection in a pure helper that accepts an explicit platform, keep Windows runner-path ranking in its own helper, test both branches directly with synthetic `win32` / `linux` / `darwin` inputs, then finish with one host-local real spawn repro for the current OS. This keeps Linux/macOS behavior pinned even when the live bug only shows up on Windows.

## Pattern: Summary surfaces should use cheap evidence and reserve full proofs for drill-ins
**Context:** Dashboard home cards, aggregate setup summaries, or any overview route that only needs to answer "is this mechanism installed?" rather than "does the full runtime proof pass right now?"
**Approach:** Split expensive validation by intent. Let summary surfaces use the cheapest evidence that still answers the summary question, such as file presence, cached facts, or a downgraded evidence level. Keep full runtime probes, self-tests, and live enforcement checks on explicit deep paths like per-agent audits, quality pages, or dedicated verification commands. Verify both paths separately: one route-scoped test that proves the summary path stays fast, and one deeper-path test that proves the runtime check still exists where it matters.

## Pattern: Asymmetric trust - set state from output, clear state from input
**Context:** Any state machine that classifies streaming PTY / WebSocket / SSE output to track "is the producer blocked on user input." The producer is a third-party TUI (coding agent, language REPL, build tool) whose chunk boundaries, redraw patterns, and decorative glyphs are not under your control. Symptom of the antipattern: badge flickers, never appears, or stays stuck because output chunks the classifier doesn't recognize keep flipping the state.
**Approach:** Treat positive ("entered blocked state") and negative ("left blocked state") signals asymmetrically. Read positive signals from output - there is no other source. Refuse to read negative signals from output at all - runners emit continuous spinner / OSC / redraw / status cycles whose bytes look identical to "moved on" bytes, and the input space of redraw patterns is unbounded by design. Use input-side authoritative signals for clearing:

1. **Set the state from output:** when a chunk matches an "awaiting" pattern (question phrase, numbered choices, confirm footer, OSC title broadcast), set the state - optionally via a short reveal-debounce timer to suppress flicker on multi-chunk prompt rendering.
2. **NEVER clear the state from output.** No matter what the next output chunk looks like - spinner, redraw, tool execution preamble, "Continuing…", new OSC title - do not clear. The output side cannot be trusted to distinguish "moved on" from "still waiting, just rendering".
3. **Clear the state ONLY from input-side signals:** user typed in the local widget (`term.onData` for an xterm), programmatic input sent through the dashboard (`sendToTerminalSession`), or session lifecycle (`exit`, terminating error, refresh proves gone). These are the only signals that unambiguously mean the user took action.

Why asymmetric trust beats symmetric chunk-based classification: classifying an arbitrary stream of TUI bytes for "the user just answered" is structurally impossible without enumerating every redraw pattern of every runner version. Five rounds of trying - glyph allowlists for `●`, `◦`, braille; tail-end heuristics; raw-vs-normalized slicing; OSC-title preservation - each failed against output the next runner version emitted. Input-side signals don't have this problem: a keystroke is a keystroke. The trade-off is explicit: if a runner is answered out-of-band (e.g. via Claude's remote-control web URL while the dashboard is open), the badge stays on until session exit. That stickiness is dramatically less harmful than a badge that never fires.

Evidence: `src/dashboard/dashboard-terminal.ts` (search: `Round-6 design: the awaitingInput badge is NEVER cleared by output`) for the workspace waiting-status state machine - five rounds of output-driven clearing strategies (per-runner spinner-glyph allowlists, tail-end heuristics with raw-byte and plain-text slices, OSC-title preservation) were replaced with the input-driven clear. Pinned by `test/unit/dashboard-terminal-launch.test.ts` (search: `badge persists across arbitrary output volume`) and (search: `badge clears when the user types in the dashboard xterm`).
**When the trade-off is unacceptable:** if your UI runs unattended for hours and out-of-band answers are common, you need an explicit "session inactivity" timeout to clear stale awaiting state. Don't try to recover symmetric output classification.
