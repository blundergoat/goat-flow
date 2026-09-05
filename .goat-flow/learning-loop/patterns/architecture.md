---
category: architecture
last_reviewed: 2026-09-05
---

## Pattern: UNSET sentinel + recursive merge for layered CLI overlays

**Context:** A CLI merges three or more configuration layers (defaults, project file, user file, flags) and some layers legitimately set falsy values such as `0`, `""`, or `false`. A `value || DEFAULT` merge drops those, and `undefined` cannot distinguish "unset" from "set to nothing".

**Approach:** Emit a dedicated `UNSET` sentinel for every option a layer does not set, never `undefined`, and have the merge skip `UNSET` keys so silence falls through to the layer below. The layer-side check must be `value === undefined ? UNSET : value` (or `value ?? UNSET`); `value || UNSET` reintroduces the bug. In TypeScript, `const UNSET = Symbol("UNSET")` is a strong sentinel. The related trap is `.goat-flow/learning-loop/footguns/config.md` (search: `Read scalar config values with`).

**Evidence (EXTERNAL_REFERENCE):** mini-swe-agent PR #684 (merged 2026-01-05) added `UNSET` and `recursive_merge` in `src/minisweagent/utils/serialize.py`; `src/minisweagent/run/mini.py` maps `--cost-limit` with `cost_limit if cost_limit is not None else UNSET` so `--cost-limit 0` survives.

**When not to use:** One or two layers with no falsy-value contracts; plain `??` is enough. No goat-flow code uses the sentinel yet.

## Pattern: Hot-import deferral for slow CLI dependencies

**Context:** Every top-level import of a CLI entry module loads on every invocation, including `--help` and fast subcommands, so a heavy dependency needed by one subcommand taxes all of them.

**Approach:** Import heavy modules inside the handler that needs them. Goat-flow already does this: `src/cli/cli.ts` keeps only lightweight parser, help, dispatch, error, and version imports at module scope, and `src/cli/cli-handlers.ts` loads audit, setup, and evidence code per command (search: `await import("./audit/audit.js")`). The same rule applies to hook launchers, because the Claude PreToolUse registration starts a Node process on every Bash tool call (`workflow/hooks/agent-config/claude.json`, search: `run-with-bash.mjs`). Time `node dist/cli/cli.js --help` before and after a deferral and keep only the ones that move the number; a sub-10ms import adds noise without payoff.

**Evidence (EXTERNAL_REFERENCE):** mini-swe-agent PR #749 (merged 2026-02-19) moved the `prompt_toolkit` import from module scope in `src/minisweagent/run/utilities/config.py` into the `prompt()` function, so only interactive subcommands pay its startup cost.

## Pattern: Use POSIX-shape paths for every user-visible string

**Context:** A `path.*` result is embedded in CLI output, prompts, audit findings, JSON payloads, dashboard rendering, log messages, or shell snippets the user or agent will run. Filesystem calls accept either separator; displayed strings must not vary by host.

**Approach:** Convert at the emission boundary with one small helper per surface, each doing `.replace(/\\/g, "/")`: `src/cli/audit/check-agent-deny-runtime.ts` (search: `export function evidencePath`), `src/cli/prompt/compose-setup.ts` (search: `function displayTemplatePath`), `src/cli/quality/skill-quality-content.ts` (search: `function relPosix`), `src/cli/install-invocation.ts` (search: `export function toBashPath`). Compose with `posix.join` when the sub-path is already a known POSIX string (`src/cli/managed-setup-preview.ts`, search: `posix.join`), because `resolve()` drive-prefixes POSIX input on Windows. Keep native `join`, `resolve`, and `relative` on the filesystem side. A grep for `\\\\` in test output assertions, or for `path.relative` and `path.resolve` next to a `lines.push(...)`, lists candidate sites.

## Pattern: Model cross-platform PTY launches as pure spawn specs

**Context:** Terminal or runner integrations that must work on native Windows and POSIX shells.

**Approach:** Keep shell, args, and env selection in a pure helper that takes an explicit platform, keep Windows runner-path ranking in its own helper, test both branches with synthetic `win32`, `linux`, and `darwin` inputs, then finish with one real spawn on the current host. Linux and macOS behaviour stays pinned even when the live bug only shows on Windows. Anchors: `src/cli/server/terminal-spawn.ts` (search: `platform: NodeJS.Platform`) and (search: `export function pickWindowsRunnerPath`).

## Pattern: Summary surfaces should use cheap evidence and reserve full proofs for drill-ins

**Context:** Dashboard home cards, aggregate setup summaries, or any overview route that only needs to answer "is this mechanism installed?" rather than "does the full runtime proof pass right now?"

**Approach:** Split validation by intent. Let summary surfaces use the cheapest evidence that answers the summary question (file presence, cached facts, a downgraded evidence level) and keep runtime probes, self-tests, and live enforcement checks on explicit deep paths such as per-agent audits and quality pages. Test both: one route-scoped test proving the summary path stays fast, one deep-path test proving the runtime check still exists. Anchor: `src/cli/audit/audit.ts` (search: `present-only`).

## Pattern: Split guardrails by operational decision

**Context:** A safety hook grows policy categories with different risk profiles and self-test corpora.

**Approach:** Keep one dispatcher and one registry entry, and put each operational decision in its own required policy module rather than another branch in the dispatcher. Destructive shell, secret-path access, and repository writes are distinct user decisions, so they live in `patterns-shell.sh`, `patterns-paths.sh`, and `patterns-writes.sh`, and the self-test installs and exercises all three. Anchors: `workflow/hooks/deny-dangerous.sh` (search: `GOAT_REQUIRED_HOOK_POLICY_FILES`), `src/cli/server/hooks-registry.ts` (search: `one PreToolUse dispatcher`), `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `patterns-writes.sh`).

## Pattern: Asymmetric trust - set state from output, clear state from input

**Context:** A state machine classifies streaming PTY, WebSocket, or SSE output from a third-party TUI to track "is the producer blocked on user input". Chunk boundaries, redraws, and decorative glyphs are outside your control, so output-driven clearing makes the badge flicker, never appear, or stick.

**Approach:** Set the waiting state from output but clear it only from input-side or lifecycle signals: user keystrokes, dashboard sends, session exit, explicit termination. Output can prove "the runner is asking"; it cannot prove "the user answered", because spinner and status chunks are unbounded across runner versions. If the UI runs unattended for hours and out-of-band answers are common, add an inactivity timeout rather than trying to recover symmetric classification.

**Evidence (ACTUAL_MEASURED):** `src/dashboard/dashboard-terminal-connect.ts` (search: `Round-6 design: the awaitingInput badge is NEVER cleared by output`) and `test/unit/dashboard-terminal-launch/launch-flow-05.test.ts` (search: `badge persists across arbitrary output volume`) pin the trade-off; the five-round incident is in `.goat-flow/learning-loop/footguns/dashboard-terminal.md` (search: `Round-6 design: the awaitingInput badge is NEVER cleared by output`).
