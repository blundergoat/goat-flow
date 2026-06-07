---
category: sentinels
last_reviewed: 2026-05-27
---

## Footgun: Sentinel-position policy is invisible until the LM tries trailing output

**Status:** active | **Created:** 2026-05-25 | **Evidence:** EXTERNAL_REFERENCE

**Symptoms:** Submit/completion markers written by an agent at the END of stdout fail to detect when anything prints afterwards — shell prompts, deprecation warnings, debug noise, a TUI program's terminal-reset escape sequence, or even a trailing newline normalization that's "off by one." Conversely, FIRST-line markers are unambiguous but only if the framework ignores everything before them (`lstrip()` then check `lines[0]`).

**Why it happens:** Sentinel position is a design choice made silently in env/parse code. There is no test that exercises "what if the model puts an extra line after the marker." The decision is invisible to maintainers reading either side of the contract (the prompt that asks the agent to emit the marker, and the parser that detects it). Without an ADR or a comment naming the trade-off, the next refactor swaps the position and rediscovers the problem.

**Evidence (external — mini-swe-agent):**
- mini-swe-agent PR #683 (`b6984ac5`, 2026-01-05) moved the `COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT` marker from first-line to last-line, claiming "Only allow submission for successful command." Touched 15 files (all envs, configs, tests). Closed issue #659 which had explicitly listed BOTH options: position swap *or* exit-status check.
- Reverted 7 days later by direct commit `1ce8e917` ("Revert back to COMPLETE_TASK_.. preceding final submission"). The commit message gives no reason. The verifiable lesson is narrower than any specific theory about *why*: a team tried the alternative and reverted within a week, leaving no explainer.
- The complementary fix (explicit `returncode == 0` gate, which was option 2 in issue #659) shipped separately in PR #747 (commit `537aac0c`, 2026-02-19) inside an unrelated SwerexModalEnvironment v2-protocol port — `git log -S 'returncode"] == 0'` confirms it. The current "first-line + rc=0" combo was assembled across three events over six weeks, not designed as a unit.
- Current upstream state in mini-swe-agent's public source file `local.py` (search: `_check_finished`):

  ```python
  lines = output.get("output", "").lstrip().splitlines(keepends=True)
  if lines and lines[0].strip() == "COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT" and output["returncode"] == 0:
      submission = "".join(lines[1:])
  ```

**Goat-flow applicability:** Goat-flow doesn't currently parse a magic-string submit signal, but any future signal it consumes from agent output is exposed to the same trap. Candidate surfaces:
- Hook stderr emission from a session-state hook (per `.goat-flow/plans/related-improvement-ideas/M01-session-state-hooks.md`) — when the hook emits `<budget-pressure>...</budget-pressure>` and the agent reads it in its next observation, the block markers' position relative to other hook output matters.
- Dashboard terminal traces that look for protocol markers in PTY output (`src/cli/server/terminal.ts` search: `looksLikePromptSend`).
- Any future evidence-envelope sentinels.

**Prevention:**
1. When introducing a marker the framework parses out of agent output, document the position policy as an ADR at the same time you write the parser. The ADR must name the rejected alternative explicitly so it survives a refactor.
2. Treat position as a contract — `rg` the codebase for the marker string; if more than one parser checks it, they must agree on position.
3. Anchor markers at the position the framework controls. The framework controls "first non-empty line of output" more reliably than "last non-empty line" because the agent can be told to emit the marker first and then any payload, but the agent cannot prevent stderr drift, shell prompts, or TUI escapes from appending after a last-line marker.
4. Add a regression test that feeds the parser output with junk appended after the marker. If the parser still detects it, position is robust. If not, the test name says exactly what scenario will break in production.

## Footgun: Common code-fence syntax collides with the agent's own work content

**Status:** active | **Created:** 2026-05-25 | **Evidence:** EXTERNAL_REFERENCE

**Symptoms:** When the agent's action delimiter is a generic syntax (e.g. ` ```bash `, ` ```python `, ` <command> `), any content the agent must read or write that legitimately contains the same syntax gets mis-parsed as additional agent actions. The most painful case: the agent cannot edit any README or technical doc that contains code fences, because the delimiter parser splits the file content into "multiple actions."

**Why it happens:** Generic delimiters are convenient and look natural in prompts, but they overlap with real document content. The trap only fires when the agent works on documentation, code repositories, or tutorial material — exactly the cases where it's most useful. By the time you notice, every example response and every test fixture uses the generic delimiter and the migration is large.

**Evidence (external — mini-swe-agent):**
- mini-swe-agent PR #696 (`10dfc4ea`, 2026-01-08, +257/-221 lines). PR body: "Previously we were using ```bash, but this had the problem that this is a sequence that can quite naturally appear in README files etc, causing the agent being unable to edit it/write such content because it would be interpreted as multiple actions."
- Closed issue #651. Migration touched all five default/swebench/swebench_xml/swebench_roulette configs plus tests plus example_response sections.
- Replaced with namespaced delimiter ` ```mswea_bash_command ` (4-character `mswea_` prefix is the namespace).

**Goat-flow applicability:** Goat-flow already uses a namespace prefix on its sentinels (`goat-`, `GOAT_`, `__GOAT_FLOW_`). This footgun is recorded so a future cleanup does not "simplify" the prefixes away without understanding why they exist.
- `src/cli/prompt/learning-loop-context.ts` (search: `<goat-learning-loop`) — block emitted to skill preambles; the `goat-` prefix prevents the agent's own observation of the learning-loop block from being re-interpreted as an injection target.
- `src/cli/server/terminal.ts` (search: `GOAT_RUNNER`) — env var the dashboard uses to point a shell session at the local CLI; the `GOAT_` prefix prevents collision with `RUNNER` or other generic env vars an agent might inspect.
- `src/dashboard/globals.d.ts` (search: `__GOAT_FLOW_REPORT__`) — window globals exposed to dashboard JS; the double-underscore + `GOAT_FLOW_` prefix avoids collision with anything the surrounding page may inject.

**Prevention:**
1. Any new sentinel — block markers, env vars, window globals, log prefixes — must be namespaced enough that grepping for it returns only goat-flow's own usage. Single-word generic names (`bash`, `runner`, `report`) are forbidden.
2. The namespace itself must be searchable. `goat-` is good (returns only goat-flow hits). `mw` would not be (collides with many things). Pick a unique 4+ character namespace and use it consistently across every sentinel surface.
3. Before adding a sentinel, grep the broader ecosystem (popular READMEs, common docs) for the proposed string. If it appears naturally in content the agent might process, namespace it harder.
4. Migration cost is real (mini's swap touched ~250 lines across configs and tests). Better to namespace at creation than to migrate later.
