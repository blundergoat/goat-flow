---
category: hook-support-evidence
last_reviewed: 2026-10-30
---

**Scope:** What a hook run proves about a provider - separating payload extraction, local availability, result delivery and model visibility before choosing a support label, keeping manual matrices clear of the live guard that inspects them, and the command shape a provider can execute. Test coverage strategy for hook changes is [hook-testing.md](hook-testing.md); driving a hook with payloads is [hook-probe-testing.md](hook-probe-testing.md).

## Lesson: Prove hook capability before marking an agent unsupported

**Status:** active | **Created:** 2026-05-26
**Severity:** INTEGRATION
**Decision changed:** Treat provider input, command execution, result delivery, and model visibility as separate support gates.
**Trigger phase:** VERIFY
**Incident count:** 11 | **Latest occurrence:** 2026-10-10
**Merged:** 2026-09-05 - moved here from `.goat-flow/learning-loop/lessons/dashboard-testing.md`, which owns dashboard build and route testing rather than provider hook evidence; moved again on 2026-10-30 from `.goat-flow/learning-loop/lessons/hook-testing.md` when that bucket was split along its provider-evidence seam.

**Prevention:** Verify each hook layer separately before choosing a support label. A payload fixture proves input extraction, an installed script proves local availability, and neither proves the host returned feedback to the model. Keep provider expectations explicit, and use the first causal gap for the UI state and repair guidance. A capture must separate tool output from hook output and carry attributable trust, payload, result-delivery, model-visibility, and continuation evidence; a bypass-trust run is fixture-only and cannot renew a trusted gate. Evidence anchors: `test/integration/gruff-code-quality-smoke.test.ts` (search: `runs for Antigravity file-tool payloads without a file path`) is input-path proof only; `src/cli/server/hooks-registry.ts` (search: `hook-provider-adapter.v1:codex:turn-stop`) holds the Codex Stop gate. Use the provider/event identity as the anchor when refreshing its evidence state. Before publishing a renewal, run the registrar and effective-state owners, including slow cases; exercise valid, invalid, future, and old observation dates, and preserve registration, trust, and delivery assertions. Check the test file’s substantive-line headroom before adding fixture setup.

**What happened:** The Hooks dashboard used `not supported`, then `unavailable`, for Antigravity Gruff before the local command path had been tested. Antigravity had project-local config, file-tool matchers, and a changed-file fallback, so the agent-wide label was too broad, and that evidence proved local command feasibility rather than model-visible feedback.

**Root cause:** Missing payload evidence was collapsed into no hook capability, then local input handling was collapsed into delivered feedback; both let one layer stand in for the whole effective-state chain.

**Incident ledger:**

**Recurrence 2026-07-13:** A four-runner fixture asserted hard secret-file protection for every agent, and a source-less `hard` row survived dashboard decoding; per-runner expectations and source-required rendering fixed both collapses. `test/unit/enforcement-capability.test.ts` (search: `assertSecretFileStatusForAgent`), `src/cli/audit/enforcement.ts` (search: `secretFileReadCapability`), `src/dashboard/dashboard-readers.ts` (search: `hasVisibleEvidence`).
**Recurrence 2026-08-10 (result delivery):** A registrar test treated Antigravity's runnable PostToolUse command as usable Gruff support although its output could not reach the model; the corrected state is unregistered and `result-undelivered`. `src/cli/server/hooks-registry.ts` (search: `cannot deliver Gruff feedback to the active model`), `src/cli/server/hook-registrar.ts` (search: `doesProviderExclusionOwnState`), `test/unit/hook-registrar-surfaces.test.ts` (search: `keeps gruff-code-quality unregistered for Antigravity without result delivery`).
**Recurrence 2026-08-10 (stale fixtures):** Fresh Codex canaries used a nonexistent final status and left an unsupported-provider fixture naming Codex; the accepted gate was restored and the unsupported assertion moved to Antigravity. `src/cli/server/hooks-registry.ts` (search: `hook-provider-adapter.v1:codex:post-tool`), `test/integration/hook-effective-state.test.ts` (search: `antigravityState`).
**Recurrence 2026-08-10 (exclusion list):** The Hooks-view test required a Codex exclusion after live proof removed the last one; the assertion now covers the current Antigravity and Copilot exclusions with provider-named reasons. `test/unit/dashboard-hooks-view.test.ts` (search: `keeps current provider exclusions paired with reasons`), `src/cli/server/hooks-registry.ts` (search: `unsupportedAgents`).
**Recurrence 2026-08-10 (fresh install):** A fresh-install test expected Codex to omit Stop after live provider proof enabled it; the corrected test checks the installed event, script, timeout, and result protocol. `test/integration/setup-install.test.ts` (search: `Fresh Codex users receive the live-proven Stop feedback path`), `src/cli/server/hooks-registry.ts` (search: `hook-provider-adapter.v1:codex:turn-stop`).
**Recurrence 2026-08-22:** A Windows registration override invalidated earlier Gruff and Stop evidence: one disposable session skipped project hooks, and a trusted-project session delivered PreToolUse but no Gruff or Stop result, so registration stayed separate from provider proof. `test/integration/hook-effective-state.test.ts` (search: `replays Codex Stop results without expiring provider proof`), `workflow/hooks/README.md` (search: `initial disposable Codex CLI 0.149.0`).
**Recurrence 2026-08-27:** A bypass-trust capture could not renew a trusted-provider gate, and a trusted Codex CLI 0.149.1 run then proved only PostToolUse, so Stop stayed stale. `src/cli/server/hooks-registry.ts` (search: `hook-provider-adapter.v1:codex:post-tool`), `test/integration/hook-effective-state.test.ts` (search: `currentHookProviderSupportGate`), `workflow/hooks/README.md` (search: `without the bypass flag`).
**Recurrence 2026-09-03:** An approved Codex CLI 0.152.0 fixture exited 0 without proving an event: direct classifier output made PreToolUse attribution ambiguous, JSONL exposed no PostToolUse event, and Stop neither continued nor changed its marker fixture, so no expiry moved. `workflow/hooks/README.md` (search: `An approved Codex CLI 0.152.0 capture`).

**Recurrence 2026-09-18:** The combined preflight and exact coverage rerun found nine registrar cases still expecting stale Codex Stop proof after its renewal. The related slow effective-state test also expected no expiry; publication had checked narrower provider contracts without these owners. The registrar reported the underlying unregistered state while the renewed capture remained current. Evidence: `test/unit/hook-registrar-surfaces.test.ts` (search: `non-Git root state wholly unregistered`), `test/integration/hook-effective-state.test.ts` (search: `currentHookProviderSupportGate`), `src/cli/server/hooks-registry.ts` (search: `hook-provider-adapter.v1:codex:turn-stop`).
 Scoped Gruff then measured 1008 substantive lines against the 1000-line limit in the registrar file. Reusing local clock values and Codex state references kept every case and assertion while clearing the size error; the complete registrar rerun passed.

**Recurrence 2026-10-10:** Removing calendar expiry left a registry-state citation pointing at removed code; `stats --check` caught it. Anchor capture history to the provider/event identity, not a deadline or transient gate value. `src/cli/server/hooks-registry.ts` (search: `hook-provider-adapter.v1:codex:post-tool`).

---

## Lesson: Manual hook matrices must avoid live-guard self-interference

**Status:** active | **Created:** 2026-06-03
**Severity:** INTEGRATION
**Decision changed:** Split all-in-one shell verification into bounded direct commands, and feed hook payloads from a temporary file when the live shell guard inspects the outer command.
**Trigger phase:** VERIFY
**Incident count:** 15 | **Latest occurrence:** 2026-10-17
**Merged:** 2026-10-30 - moved here from `.goat-flow/learning-loop/lessons/hook-testing.md` when that bucket was split along its provider-evidence seam.

**Prevention:** For manual guardrail matrices, run one direct case at a time or create a temporary harness file with a plain invocation command. Construct secret-path payloads from variables when the outer live guard would otherwise see them, prefer here-strings or file redirection over `printf | bash hook`, and record temp roots in the parent shell before using command substitution. Use the interpreter returned by `command -v python3 || command -v python` rather than assuming a `python` shim. Keep large captured output out of executable command text; capture and parse it locally as data, and use stdin when data exceeds the hook command-size ceiling or the operating system’s argument limit. Evidence anchors: `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `Command has more than 50 chained segments`), `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `Pipe to shell`), `.goat-flow/learning-loop/lessons/verification-scanners.md` (search: `Temp cleanup must satisfy destructive-command hooks`).

For large drafts, send data directly to the matched CLI's stdin. An inline interpreter that starts that CLI is still subject to shell-execution checks; after two rejected wrappers, return to the documented direct interface.

**What happened:** During a manual pass over the canonical deny and Gruff hooks, the first all-in-one harness was blocked by the active PreToolUse guard for having more than 50 chained segments. Smaller batches then tripped the same guard with command substitution, a fixed `printf | bash hook` payload replay, and literal `.env.example` strings in the outer command, while a temporary Gruff harness leaked temp directories because root creation happened inside command substitutions.

**Root cause:** The verification shell was treated as neutral while testing the guardrail family that inspects shell text, so payload-replay shapes that are safe inside a harness were blocked before the hook under test ran.

**Incident ledger:**

**Recurrence 2026-07-14:** A disposable-target walkthrough repeated the failure when an all-in-one validation command was blocked before setup; a short temporary harness kept each reviewed step visible and unblocked.
**Recurrence 2026-08-03:** PR-thread verification piped a bundled comment snapshot into an inline Node parser, so the guard rejected the outer command before the read-only parser ran; persisting the snapshot in a temporary file and reading it through stdin redirection preserved the workflow.
**Recurrence 2026-08-10:** A focused Gruff verification piped generated JSON into a shell hook and was blocked; writing the payload to a securely created temporary file and redirecting the hook's stdin kept the outer command reviewable.
**Recurrence 2026-09-10:** Milestone evidence maintenance hit two live guards: a local generator-to-redactor pipe was rejected, then a whole-file heredoc exceeded the command-size limit. Neither command wrote files. Separate the generator read from redaction and apply only bounded, already-scrubbed replacement sections; never change hook policy to admit the wrapper. Evidence: `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `Pipe to interpreter`) and `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `large_quality_save_heredoc_is_bounded_data`).
**Recurrence 2026-09-11:** Saving critique records from in-memory heredocs into the redactor tripped the 50-segment guard three times: semicolons and pipe characters inside the heredoc body count as chained segments, and a 13 KB body trips the count even without them while a 7 KB body passes. Scrubbing each half into the project scratchpad with the redactor and then concatenating the scrubbed halves through the redactor into the create-only record kept every raw draft off disk and preserved the record schema. Evidence: workflow/hooks/deny-dangerous/guard-runtime.sh (search: chained segments).

**Recurrence 2026-09-12:** Evidence persistence embedded a complete test transcript in a Python heredoc and exceeded the live guard’s command-size ceiling before execution. Capturing subprocess output locally kept the outer command bounded. A later classifier probe exceeded the OS argument-size limit; structured stdin reached both policies and established unchanged allow/block boundaries. The user approved clearer rejection wording, with all parser limits retained. Evidence: `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `large_quality_save_heredoc_is_bounded_data`, `Command is too large for policy inspection`).


**Recurrence 2026-10-02:** Protocol persistence embedded a 15,750-character draft in an executable Python heredoc and was rejected before execution.
The rejection directed file or stdin input; sending the same in-memory draft directly to the matched redactor's stdin saved the protocol.
No raw staging file or hook-limit change was used. An inline Python comparison wrapper was separately rejected for its shell-execution primitive.

A reviewed fixture entry with JSON stdin completed the six direct/observer stream and exit comparisons before the live session.
The final live control then included `test ! -e` for a protected secret-shaped path, so the existing generic secret scan denied the entire request.
Keep allowed controls free of protected operands; inspect fixture absence independently rather than treating metadata checks as policy-exempt.
The missing valid allowed-after control left this capture inconclusive; current-runtime support remains unverified.

Evidence: `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `Command is too large for policy inspection`);
`workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `Interpreter -c/-e with shell-execution primitive`);
`workflow/hooks/deny-dangerous/patterns-paths.sh` (search: `check_secret_segment`).

**Recurrence 2026-10-02:** The observer preparation duplicated its source in a hashing literal, producing a 20,254-character command.
The live guard rejected it before execution. Removing the duplicate reduced the command to 11,669 characters; both synthetic identity controls ran.

Keep command-size checks before invocation and avoid duplicating source or captured data in executable command text.
No fixture, provider session, parser-limit change or permission change was used.
Evidence: `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `Command is too large for policy inspection`).

**Recurrence 2026-10-03:** An inline Node `-e` wrapper used a child-process call for a read-only Git byte count and was rejected before execution.
Running `git show` directly into `wc -c` preserved the policy and supplied the measurement.
Evidence: `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `Interpreter -c/-e with shell-execution primitive`).

**Recurrence 2026-10-03 (review receipts):** A heredoc carrying pipe-delimited refutation records was rejected as more than 50 chained segments, and `git diff` piped into the redact CLI was rejected as a pipe to an interpreter.
Write pipe-bearing receipt text with the file tool and redirect it into the redactor; stream a diff through a small script that pipes the Git child into the CLI in-process so raw bytes never reach disk.
Evidence: `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `Command has more than 50 chained segments`); `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `Pipe to interpreter`).

**Recurrence 2026-10-03 (renewal preparation):** The large protocol heredoc exceeded the command-inspection limit; an inline Python subprocess wrapper for stdin was then rejected as a shell-execution primitive. Both stopped before execution. The direct matched redactor accepted stdin without a raw staging file or policy change; PTY CRLF normalization preserved the exact frozen source.
Send large drafts directly to the matched CLI's stdin rather than wrapping that CLI in an inline interpreter. After two rejected wrappers, return to the documented direct interface.
The strict plan checker also caught open approved preparation tasks in testing-gate; restore the requested-change implementation state before those writes and return to testing-gate after the tasks close.
The local matrix then selected a clean assertion using only `stop-competing-repair`; the primary shares that phase and must still warn. Selecting by role and phase made all eighteen direct/observer pairs agree; production and observer bytes stayed unchanged. The single native renewal later recorded every intended callback but returned exit 124: individual hook trust review used most of the 295-second deadline before the prompt ran. Its proof remains inconclusive. Check each role's expected result and the remaining deadline before prompt submission; reach graceful native exit before the independent deadline.
The first preservation probe also resolved producer basenames at repository root and failed on `deny-dangerous.sh`; the second compared a heading-inclusive Requirements hash against a different hash carried in the summary. After two corrections, reading the saved checkpoint's exact region definition resolved the mismatch. Resolve manifest names under `workflow/hooks/` and compare the same byte region recorded by the checkpoint; source hashes, historical receipt fields and Requirements were preserved.
Evidence: `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `Command is too large for policy inspection`); `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `Interpreter -c/-e with shell-execution primitive`); `src/cli/plans-check.ts` (search: `open implementation tasks`).

**Recurrence 2026-10-11:** A plan generator embedded its whole source in an oversized terminal heredoc. The live policy rejected the command before it created any file. Writing the reviewed generator through the file-edit tool and invoking the file with a short command followed the rejection's file-input route; the same bounded plan writes then completed with the policy unchanged. Evidence: `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `Command is too large for policy inspection`).

**Recurrence 2026-10-17:** A large inline JSON receipt timed out guard inspection; a native file edit preserved the controls. Evidence: `workflow/hooks/run-with-bash.mjs` (`reportLauncherUnavailable`).

---

## Lesson: Codex hook commands must use the git-root wrapper shape

**Status:** active | **Created:** 2026-05-27
**Severity:** INTEGRATION
**Incident count:** 3 | **Latest occurrence:** 2026-08-22
**Merged:** 2026-10-30 - moved here from `.goat-flow/learning-loop/lessons/hook-testing.md` when that bucket was split along its provider-evidence seam.

**Prevention:** Generate Codex hook commands through the root-resolving Node bootstrap: it resolves the active git root, loads `run-hook.mjs`, passes the selected hook as an argument, and starts the launcher with that root as cwd. Codex deliberately receives no `CLAUDE_PROJECT_DIR` fallback. On Windows, wrap the same bootstrap in the provider's `commandWindows` override: transport the generated source as Base64, restore `[Environment]::CurrentDirectory` with `Set-Location -LiteralPath`, invoke `node.exe`, propagate `$LASTEXITCODE`, and preserve `Path` and `PATHEXT` in minimal replay environments. Test the exact generated override from a hostile-named path with safe, blocked, and canary inputs. Which events that registration actually delivers is a separate question owned by `.goat-flow/learning-loop/lessons/hook-support-evidence.md` (search: `Prove hook capability before marking an agent unsupported`). Evidence anchors: `workflow/hooks/agent-config/codex-hooks.json` (search: `run-hook.mjs`), `.codex/hooks.json` (search: `run-hook.mjs`), `src/cli/server/agent-hook-command.ts` (search: `windowsPowerShellHookCommand`), `test/integration/hook-command-spawn-matrix.test.ts` (search: `Windows override`).

**What happened:** The live Codex hook config reported three PreToolUse failures with exit 127 even after the scripts themselves passed. The registered commands were `bash "$(git rev-parse --show-toplevel)/.codex/hooks/..."`, so Codex could fail before the guard script started when command substitution was not resolved in the hook runner context.

**Root cause:** The Claude-style hook command string was assumed safe for Codex too; the audit parser only needed to see the hook script path, while the runtime needed a command shape Codex can execute directly.

**Recurrence 2026-08-06:** The rule is narrowed, not a blanket ban on shell substitution: Codex hook commands run with the session cwd, so bare `.goat-flow/hooks/...` paths fail from nested directories, and the Node bootstrap is the current safe shape. `test/unit/hook-registrar.test.ts` (search: `generated Codex launchers resolve the active root`).
**Recurrence 2026-08-22:** Windows required the `commandWindows` override around that bootstrap, because Windows PowerShell can parse hostile cwd characters incorrectly or turn policy exit 2 into hook-failure exit 1. `src/cli/server/hooks-registry.ts` (search: `hook-provider-adapter.v1:codex:post-tool`).
