---
category: architecture
last_reviewed: 2026-05-27
---

## Pattern: UNSET sentinel + recursive merge for layered CLI overlays

**Context:** A CLI exposes options that override values in N configuration layers (default config file, project config file, user config file, command-line flags). Each layer's "I didn't set this" must yield to the next layer's value, but layers that DO set a value — including legitimate falsy values like `0`, `""`, `false` — must not be dropped by the merge.

**Approach:** Define an `UNSET` sentinel object that survives type checks (`typeof UNSET === "object"` so it's distinguishable from `null`/`undefined`). At each layer, emit either the user-supplied value or `UNSET`, never `undefined` for absent. The merge function walks the resulting layered dicts and skips `UNSET` entries entirely, so layer N's silence falls back to layer N-1's value without ambiguity. Compare with [footguns/config.md](../footguns/config.md) (search: `value || DEFAULT silently drops`) — the alternative `value || DEFAULT` shape silently overrides explicit falsy intent.

**Evidence (external — mini-swe-agent):** PR #684 (merged 2026-01-05, `klieret`) introduced this across all v2 CLI scripts. In `src/minisweagent/utils/serialize.py` (search: `recursive_merge`), the merge function skips `UNSET` values:

```python
UNSET = object()

def recursive_merge(*dictionaries: dict | None) -> dict:
    result: dict[str, Any] = {}
    for d in dictionaries:
        if d is None: continue
        for key, value in d.items():
            if value is UNSET: continue
            # ... recurse for nested dicts, otherwise overwrite ...
    return result
```

CLI shape in `src/minisweagent/run/mini.py` (search: `cost_limit if cost_limit is not None else UNSET`):

```python
configs.append({
    "agent": {
        "cost_limit": cost_limit if cost_limit is not None else UNSET,
        # ...
    },
})
config = recursive_merge(*configs)
```

The explicit `is not None` check is load-bearing — using `cost_limit or UNSET` would drop `--cost-limit 0` (see footguns/config.md).

**Goat-flow application:**
- TypeScript port: `const UNSET = Symbol("UNSET")` for a strong sentinel. Merge function skips any key whose value is `UNSET`.
- Use for any future option layering where current `||` / `??` patterns get awkward (Zod default merging, audit option overrides, hook config layering).
- The explicit form must be `value === undefined ? UNSET : value` (or `value ?? UNSET`), never `value || UNSET`.

**When NOT to use:** If there are only 1-2 config layers and no falsy-value contracts, plain `??` is enough. The UNSET sentinel earns its complexity when there are 3+ layers AND falsy values are legitimate intents.

## Pattern: Hot-import deferral for slow CLI dependencies

**Context:** A CLI invocation pays for every top-level `import`/`require` of every module it loads, even when the user only runs `--help` or a fast subcommand. Heavy dependencies (TUI libraries, ML frameworks, large parsers) impose hundreds of milliseconds of startup latency that the user sees on every invocation, regardless of whether the heavy code path actually runs.

**Approach:** Move heavy imports OUT of module scope and INTO function scope, so they only load when the function that needs them is called. The pattern is a trivial-looking refactor with outsized impact on CLI feel.

**Evidence (external — mini-swe-agent):** PR #749 (merged 2026-02-19, `klieret`, "Enh: Improve startup time of mini"). Moved `from prompt_toolkit import prompt` out of `src/minisweagent/run/utilities/config.py` module scope and into a function:

```python
def prompt(*args, **kwargs):
    # Defer import to avoid slow import module
    from prompt_toolkit.shortcuts.prompt import prompt as _prompt
    return _prompt(*args, **kwargs)
```

`prompt_toolkit` is a large dependency; loading it at module scope meant every `mini-extra <any-subcommand>` invocation paid its import cost. Now only subcommands that actually call `prompt()` (interactive setup) pay it. The PR also extracted multiline-prompt logic into `src/minisweagent/agents/utils/prompt_user.py` so the interactive agent doesn't drag `prompt_toolkit` into module imports of non-interactive code paths.

**Goat-flow application:**
- `npx @blundergoat/goat-flow@<version>` startup is user-visible. Audit `src/cli/cli.ts` and top-level imports — anything CLI-only that's only needed for specific subcommands (the dashboard server, AG-UI, large parsers, image processors) belongs behind a lazy `await import("./heavy-module.js")` inside the subcommand handler, not at the top of `cli.ts`.
- Same pattern for hook scripts in `workflow/hooks/`: any `node` hook that imports heavy modules at top should defer them, since hooks may fire on every tool call.
- Measurement: run `node --prof dist/cli/cli.js --help`, compare baseline vs after-deferral. If `--help` startup gets faster, the deferral was worthwhile.

**When NOT to use:** For modules whose import cost is genuinely small (< 10ms), the deferral adds noise without payoff. Save it for modules that contribute measurably to startup latency.

---

## Pattern: Use POSIX-shape paths for every user-visible string
**Context:** Anywhere a `path.*` result is embedded in CLI output, prompts, audit findings, JSON payloads, dashboard rendering, log messages, or shell snippets the user/agent will execute. Distinct from `fs` operations, which accept either separator.
**Approach:** Centralise the "host -> display" conversion at the emission boundary. Local helpers like `evidencePath`, `displayTemplatePath`, `relPosix`, `toBashPath`, and `toShellProjectPath` all do `.replace(/\\/g, "/")` (and use `path.posix.join` when composing with a known POSIX sub-path, to avoid `resolve()` drive-prefixing POSIX inputs on Windows). The fs side keeps using native `join`/`resolve`/`relative`. A single repo grep for `\\\\` in test output assertions or for `path.relative` / `path.resolve` adjacent to a `lines.push(...)` flags candidate sites. (search: `function evidencePath`)

## Pattern: Model cross-platform PTY launches as pure spawn specs
**Context:** Terminal or runner integrations that must work on native Windows and POSIX shells.
**Approach:** Keep shell/args/env selection in a pure helper that accepts an explicit platform, keep Windows runner-path ranking in its own helper, test both branches directly with synthetic `win32` / `linux` / `darwin` inputs, then finish with one host-local real spawn repro for the current OS. This keeps Linux/macOS behavior pinned even when the live bug only shows up on Windows. (search: `platform: NodeJS.Platform`)

## Pattern: Summary surfaces should use cheap evidence and reserve full proofs for drill-ins
**Context:** Dashboard home cards, aggregate setup summaries, or any overview route that only needs to answer "is this mechanism installed?" rather than "does the full runtime proof pass right now?"
**Approach:** Split expensive validation by intent. Let summary surfaces use the cheapest evidence that still answers the summary question, such as file presence, cached facts, or a downgraded evidence level. Keep full runtime probes, self-tests, and live enforcement checks on explicit deep paths like per-agent audits, quality pages, or dedicated verification commands. Verify both paths separately: one route-scoped test that proves the summary path stays fast, and one deeper-path test that proves the runtime check still exists where it matters. (search: `present-only`)

## Pattern: Split guardrails by operational decision
**Context:** A safety hook grows multiple policy categories with different risk profiles, self-test corpora, default states, or dashboard toggle needs.
**Approach:** Make each operational decision a separate registry entry and script instead of adding another branch to a monolithic hook. Destructive shell, secret-path access, and repository writes are distinct user decisions, so they belong in `patterns-shell.sh`, `patterns-paths.sh`, and `patterns-writes.sh`. Evidence anchors: `src/cli/server/hooks-registry.ts` (search: `deny-dangerous`) and `workflow/hooks/hook-lib/deny-dangerous-self-test.sh` (search: `deny-dangerous`).

## Pattern: Asymmetric trust - set state from output, clear state from input
**Context:** Any state machine that classifies streaming PTY / WebSocket / SSE output to track "is the producer blocked on user input." The producer is a third-party TUI (coding agent, language REPL, build tool) whose chunk boundaries, redraw patterns, and decorative glyphs are not under your control. Symptom of the antipattern: badge flickers, never appears, or stays stuck because output chunks the classifier doesn't recognize keep flipping the state.
**Approach:** Set waiting state from output, but clear it only from input-side or lifecycle signals. Output can prove "the runner is asking"; it cannot prove "the user answered" because spinner/redraw/status chunks are unbounded across runner versions. User keystrokes, dashboard sends, session exit, and explicit termination are the authoritative clear signals.

Evidence: `src/dashboard/dashboard-terminal.ts` (search: `Round-6 design: the awaitingInput badge is NEVER cleared by output`) and `test/unit/dashboard-terminal-launch.test.ts` (search: `badge persists across arbitrary output volume`) pin the trade-off. The detailed five-round incident remains in `.goat-flow/footguns/dashboard.md` (search: `Awaiting-input state needs asymmetric trust`).
**When the trade-off is unacceptable:** if your UI runs unattended for hours and out-of-band answers are common, you need an explicit "session inactivity" timeout to clear stale awaiting state. Don't try to recover symmetric output classification.
