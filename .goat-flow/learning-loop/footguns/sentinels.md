---
category: sentinels
last_reviewed: 2026-09-05
---

## Footgun: Sentinel-position policy is invisible until the LM tries trailing output

**Status:** active | **Created:** 2026-05-25 | **Evidence:** EXTERNAL_REFERENCE

**Prevention:**
1. When the framework parses a marker out of agent output, record the position policy in an ADR at the same time as the parser, naming the rejected alternative so it survives a refactor. Search the codebase for the marker string; every parser that checks it must agree on position.
2. Anchor markers at the position the framework controls. "First non-empty line" is more reliable than "last non-empty line": the agent can be told to emit the marker first and then the payload, but it cannot prevent stderr drift, shell prompts, or TUI escapes from appending after a last-line marker.
3. Feed the parser output with junk appended after the marker in a regression test; if detection survives, position is robust.

**Symptoms:** Completion markers written at the end of stdout go undetected when anything prints afterwards: shell prompts, deprecation warnings, debug noise, a TUI terminal-reset escape, or an off-by-one trailing-newline normalization. First-line markers are unambiguous only when the framework ignores everything before them (`lstrip()` then check `lines[0]`).

**Why it happens:** Position is chosen silently in parser code with no test for an extra line after the marker, so neither the prompt that asks for the marker nor the parser that detects it records the trade-off, and the next refactor swaps the position and rediscovers the problem.

**Evidence:** External, mini-swe-agent: PR #683 (`b6984ac5`, 2026-01-05) moved `COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT` from first-line to last-line across 15 files, closing issue #659, which had listed both a position swap and an exit-status check; commit `1ce8e917` reverted it seven days later with no reason given, and the complementary `returncode == 0` gate shipped separately in PR #747 (`537aac0c`, 2026-02-19), so the current first-line-plus-rc-0 shape was assembled across three events over six weeks. Its public source file local.py (search: `_check_finished`) now does `lines = output.get("output", "").lstrip().splitlines(keepends=True)` and accepts only `lines[0].strip() == "COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT"` with `returncode == 0`. Local surface: goat-flow parses no submit sentinel out of agent output, but `src/cli/server/terminal-spawn.ts` (search: `export function looksLikePromptSend`) already pattern-matches dashboard terminal input, and `src/cli/server/terminal.ts` (search: `looksLikePromptSend(msg.data)`) branches on it mid-session over a PTY stream that carries prompts, redraws, and reset escapes exactly like the upstream case.

## Footgun: Common code-fence syntax collides with the agent's own work content

**Status:** active | **Created:** 2026-05-25 | **Evidence:** EXTERNAL_REFERENCE

**Prevention:** Namespace every sentinel (block markers, env vars, window globals, log prefixes) so a grep for it returns only goat-flow's own usage. Single-word generic names such as `bash`, `runner`, or `report` are forbidden, the namespace itself must be searchable (`goat-` is; `mw` is not), and before adding a sentinel check that the proposed string does not occur naturally in READMEs or docs the agent may process. Namespace at creation, because the migration cost later is real.

**Symptoms:** When the agent's action delimiter is generic syntax such as ` ```bash ` or `<command>`, any content it must read or write that contains the same syntax is mis-parsed as additional actions, so the agent cannot edit a README or tutorial that contains code fences.

**Why it happens:** Generic delimiters look natural in prompts but overlap with real document content, and by the time it shows, every example response and fixture uses the delimiter and the migration is large.

**Evidence:** External, mini-swe-agent PR #696 (`10dfc4ea`, 2026-01-08, +257/-221): "Previously we were using ```bash, but this had the problem that this is a sequence that can quite naturally appear in README files etc, causing the agent being unable to edit it/write such content because it would be interpreted as multiple actions"; the fix replaced it with ` ```mswea_bash_command ` across five configs plus tests. Local sentinels already namespaced, recorded so a later cleanup does not "simplify" the prefixes away: `src/cli/prompt/learning-loop-context.ts` (search: `<goat-learning-loop`), the block emitted into skill preambles; `src/cli/server/terminal-spawn.ts` (search: `GOAT_RUNNER`), the env var pointing a shell session at the local CLI; `src/dashboard/globals.d.ts` (search: `__GOAT_FLOW_REPORT__`), the window global exposed to dashboard JS.
