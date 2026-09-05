---
category: hook-testing
last_reviewed: 2026-09-05
---

**Scope:** Hook test coverage strategy and provider evidence - what a self-test actually exercises, which support layer a capture proves, matrices that interfere with the live guard, fixtures that must not carry real secrets, and splits that only look like coverage. The script under test is [hook-script-authoring.md](hook-script-authoring.md); driving it with payloads is [hook-probe-testing.md](hook-probe-testing.md).

## Lesson: Prove hook capability before marking an agent unsupported

**Status:** active | **Created:** 2026-05-26
**Decision changed:** Treat provider input, command execution, result delivery, and model visibility as separate support gates.
**Trigger phase:** VERIFY
**Incident count:** 9 | **Latest occurrence:** 2026-09-03
**Merged:** 2026-09-05 - moved here from `.goat-flow/learning-loop/lessons/dashboard-testing.md`, which owns dashboard build and route testing rather than provider hook evidence.

**Prevention:** Verify each hook layer separately before choosing a support label. A payload fixture proves input extraction, an installed script proves local availability, and neither proves the host returned feedback to the model. Keep provider expectations explicit, and use the first causal gap for the UI state and repair guidance. A capture must separate tool output from hook output and carry attributable trust, payload, result-delivery, model-visibility, and continuation evidence; a bypass-trust run is fixture-only and cannot renew a trusted gate. Evidence anchors: `test/integration/gruff-code-quality-smoke.test.ts` (search: `runs for Antigravity file-tool payloads without a file path`) is input-path proof only; `src/cli/server/hooks-registry.ts` (search: `effectiveSupportGate: "provider-capture-stale"`) holds the gate.

**What happened:** The Hooks dashboard used `not supported`, then `unavailable`, for Antigravity Gruff before the local command path had been tested. Antigravity had project-local config, file-tool matchers, and a changed-file fallback, so the agent-wide label was too broad, and that evidence proved local command feasibility rather than model-visible feedback.

**Root cause:** Missing payload evidence was collapsed into no hook capability, then local input handling was collapsed into delivered feedback; both let one layer stand in for the whole effective-state chain.

**Incident ledger:**

**Recurrence 2026-07-13:** A four-runner fixture asserted hard secret-file protection for every agent, and a source-less `hard` row survived dashboard decoding; per-runner expectations and source-required rendering fixed both collapses. `test/unit/enforcement-capability.test.ts` (search: `assertSecretFileStatusForAgent`), `src/cli/audit/enforcement.ts` (search: `secretFileReadCapability`), `src/dashboard/dashboard-readers.ts` (search: `hasVisibleEvidence`).
**Recurrence 2026-08-10 (result delivery):** A registrar test treated Antigravity's runnable PostToolUse command as usable Gruff support although its output could not reach the model; the corrected state is unregistered and `result-undelivered`. `src/cli/server/hooks-registry.ts` (search: `cannot deliver Gruff feedback to the active model`), `src/cli/server/hook-registrar.ts` (search: `doesProviderExclusionOwnState`), `test/unit/hook-registrar-surfaces.test.ts` (search: `keeps gruff-code-quality unregistered for Antigravity without result delivery`).
**Recurrence 2026-08-10 (stale fixtures):** Fresh Codex canaries used a nonexistent final status and left an unsupported-provider fixture naming Codex; the accepted gate was restored and the unsupported assertion moved to Antigravity. `src/cli/server/hooks-registry.ts` (search: `hook-provider-adapter.v1:codex:post-tool`), `test/integration/hook-effective-state.test.ts` (search: `antigravityState`).
**Recurrence 2026-08-10 (exclusion list):** The Hooks-view test required a Codex exclusion after live proof removed the last one; the assertion now covers the current Antigravity and Copilot exclusions with provider-named reasons. `test/unit/dashboard-hooks-view.test.ts` (search: `keeps current provider exclusions paired with reasons`), `src/cli/server/hooks-registry.ts` (search: `unsupportedAgents`).
**Recurrence 2026-08-10 (fresh install):** A fresh-install test expected Codex to omit Stop after live provider proof enabled it; the corrected test checks the installed event, script, timeout, and result protocol. `test/integration/setup-install.test.ts` (search: `Fresh Codex users receive the live-proven Stop feedback path`), `src/cli/server/hooks-registry.ts` (search: `hook-provider-adapter.v1:codex:turn-stop`).
**Recurrence 2026-08-22:** A Windows registration override invalidated earlier Gruff and Stop evidence: one disposable session skipped project hooks, and a trusted-project session delivered PreToolUse but no Gruff or Stop result, so registration stayed separate from provider proof. `test/integration/hook-effective-state.test.ts` (search: `replays Codex Stop results without upgrading stale provider proof`), `workflow/hooks/README.md` (search: `initial disposable Codex CLI 0.149.0`).
**Recurrence 2026-08-27:** A bypass-trust capture could not renew a trusted-provider gate, and a trusted Codex CLI 0.149.1 run then proved only PostToolUse, so Stop stayed stale. `src/cli/server/hooks-registry.ts` (search: `2026-09-25T20:17:22.830Z`), `test/integration/hook-effective-state.test.ts` (search: `expires exact Codex proof while keeping uncaptured Stop stale`), `workflow/hooks/README.md` (search: `without the bypass flag`).
**Recurrence 2026-09-03:** An approved Codex CLI 0.152.0 fixture exited 0 without proving an event: direct classifier output made PreToolUse attribution ambiguous, JSONL exposed no PostToolUse event, and Stop neither continued nor changed its marker fixture, so no expiry moved. `workflow/hooks/README.md` (search: `An approved Codex CLI 0.152.0 capture`).

---

## Lesson: Hook tests should inspect executable lines when checking failure masking

**Status:** active | **Created:** 2026-06-11

**Prevention:** When testing shell hook safety markers such as `|| true`, filter out blank and comment lines before matching, and keep separate assertions for operator-facing comments when the wording itself matters. Evidence anchors: `test/unit/audit-command/hook-facts.test.ts` (search: `detects validation commands that mask failure with || true`), `src/cli/facts/agent/hooks.ts` (search: `lineSwallowsValidationFailure`).

**What happened:** A focused post-turn hook test failed because it searched an entire shell script for `|| true`; the script correctly warned against adding `|| true` in a comment, while the production detector ignores comments and checks executable validation lines.

**Root cause:** The test asserted a policy token against raw file text instead of mirroring the runtime and audit parser boundary, which made a documentation warning look like executable failure masking.

## Lesson: Secret-scanner tests must not embed literal secret-shaped fixtures

**Status:** active | **Created:** 2026-06-12
**Incident count:** 2 | **Latest occurrence:** 2026-09-04

**Prevention:** In secret-scanner tests and shipped self-tests, build secret-shaped fixture values from split constants or helpers so the runtime fixture still exercises the scanner while the committed source holds no contiguous token or private-key pattern. Apply the same rule to harmless structural fixtures the repository scanner classifies as REVIEW, and never add a waiver that could hide a real credential. After adding or editing scanner fixtures, run the scanner against the current repo, not only temp repos. Evidence anchors: `test/integration/post-turn-safety-hook.test.ts` (search: `TEST_AWS_ACCESS_KEY`), `workflow/hooks/post-turn-safety.sh` (search: `synthetic_assignment_prefix`), `test/unit/plans-check-structure.test.ts` (search: `BANNED_IDENTIFIER_CASES`), `test/unit/redact-command.test.ts` (search: `TEST_BEARER_INPUT`).

**What happened:** After `post-turn-safety` became the default Stop hook, the Codex Stop command blocked this repo because the changed safety-hook test source embedded literal secret-shaped fixtures; the fixtures were fake, but the hook scans changed source text and cannot know a token-shaped string in a test file is harmless.

**Root cause:** The test generated dangerous fixture content by storing the exact dangerous strings in the source file, although it only needed that value inside a temporary repo at runtime.

**Recurrence 2026-09-04:** The mandatory pre-release source scan exited 1 with 17 REVIEW rows across two shipped-hook mirrors and three test files; inspection found synthetic scanner and redaction strings plus three harmless `token:` fields. Splitting only their source spelling preserved the runtime data, and the repeated scan reported no high-signal findings while the hook self-test and 102 focused tests passed. `scripts/maintenance/scan-secrets.sh` (search: `INVESTIGATION REQUIRED`).

## Lesson: Drift render helpers must apply every hook toggle

**Status:** active | **Created:** 2026-06-11

**Prevention:** When refactoring generated-state or drift-render code, separate "apply all mutations" from "did anything change?" helpers, and do not use short-circuiting array methods (`some`, `find`, `every`) when each item may mutate the rendered artifact. Add focused drift tests with at least two enabled optional hooks so skipped later entries fail visibly. Evidence anchors: `src/cli/audit/check-drift-hooks.ts` (search: `applyExplicitHookToggles`), `test/integration/audit-drift-checkdrift-hook-templates.test.ts` (search: `allows Copilot hook config entries for enabled optional hooks`).

**What happened:** Reducing ESLint complexity in `expectedHookConfig` replaced the Copilot hook-toggle loop with `Array.some`, so `npm run test:fast` failed the well-configured repo audit: `some` stopped after applying `deny-dangerous`, skipped the enabled `gruff-code-quality` toggle, and made `.github/hooks/hooks.json` look drifted.

**Root cause:** "Did any toggle change?" was treated as the only outcome, but the loop also had side effects that must run for every hook spec; short-circuiting preserved the boolean and lost later config entries.

## Lesson: deny-dangerous self-test missed a whole false-positive class while green

**Status:** active | **Created:** 2026-06-06

**Prevention:** For guardrail parsers, vary shell structure in the allow corpus rather than only verbs: substitutions with and without inner operators, quoted against unquoted, arithmetic expansion, process substitution, and redirects (`2>&1`, `2>/dev/null`, redirect-to-other-file) on allowlisted-readable files, each paired with its dangerous counterpart. A green smoke run proves only the cases present. When a report fingers a downstream catch-all rule, trace the token that rule sees back to the tokenizer before relaxing it. Evidence anchors: `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `unquoted subst with || fallback`), `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `arithmetic expansion`), `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `.env.example read with stderr dup`), `.goat-flow/learning-loop/footguns/deny-shell.md` (search: `track substitution depth`).

**What happened:** A downstream agent hit `Policy destructive: Complex command substitution` on benign `$()` inside a `for` loop while `deny-dangerous.sh --self-test=smoke` reported `executed=23, skipped=0` PASS. The corpus had no allow case for a substitution containing a control operator, nor for arithmetic `$(())`, nor for a `.env.example` read carrying `2>&1`, so three false-positive classes shipped behind a green suite. The catch-all was correct; the orphan `$(` was manufactured upstream by the segment splitter.

**Root cause:** The corpus over-indexed on dangerous block cases plus a few canonical allow cases, while parser regressions surface as false positives on benign but structurally varied input.

## Lesson: Exact hook-copy assertions must derive from owned policy text

**Status:** active | **Created:** 2026-08-24
**Decision changed:** Before adding an exact block-copy assertion, read the source-owned block reason or capture attributed classifier output; never infer the expected fragment from the command.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Before writing an `expect_block_message` case, locate the owning block reason or capture the hook's attributed output, then reuse a stable source-owned fragment. Run the full central self-test after the RED fixture and after implementation; a verdict-only integration pass is not copy proof. Evidence anchors: `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `dangerous nested command substitution`), `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `Destructive git operation`).

**What happened:** M33 added exact-copy self-test cases for nested deletion and a background hard reset, expecting "Recursive deletion" where the runtime says "rm -r without safe scoping", then "git reset --hard" where the policy says only "reset --hard"; the full self-test failed two verification iterations although the verdict-only matrix was green.

**Root cause:** Expected copy was derived from each fixture's intent and command text instead of the block reason owned by the policy module, and a scope-only integration assertion cannot catch that mismatch.

---

## Lesson: Manual hook matrices must avoid live-guard self-interference

**Status:** active | **Created:** 2026-06-03
**Decision changed:** Split all-in-one shell verification into bounded direct commands, and feed hook payloads from a temporary file when the live shell guard inspects the outer command.
**Trigger phase:** VERIFY
**Incident count:** 5 | **Latest occurrence:** 2026-08-15

**Prevention:** For manual guardrail matrices, run one direct case at a time or create a temporary harness file with a plain invocation command. Construct secret-path payloads from variables when the outer live guard would otherwise see them, prefer here-strings or file redirection over `printf | bash hook`, and record temp roots in the parent shell before using command substitution. Use the interpreter returned by `command -v python3 || command -v python` rather than assuming a `python` shim. Evidence anchors: `workflow/hooks/deny-dangerous.sh` (search: `Command has more than 50 chained segments`), `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `Pipe to shell`), `.goat-flow/learning-loop/lessons/verification-scanners.md` (search: `Temp cleanup must satisfy destructive-command hooks`).

**What happened:** During a manual pass over the canonical deny and Gruff hooks, the first all-in-one harness was blocked by the active PreToolUse guard for having more than 50 chained segments. Smaller batches then tripped the same guard with command substitution, a fixed `printf | bash hook` payload replay, and literal `.env.example` strings in the outer command, while a temporary Gruff harness leaked temp directories because root creation happened inside command substitutions.

**Root cause:** The verification shell was treated as neutral while testing the guardrail family that inspects shell text, so payload-replay shapes that are safe inside a harness were blocked before the hook under test ran.

**Recurrence 2026-07-14:** A disposable-target walkthrough repeated the failure when an all-in-one validation command was blocked before setup; a short temporary harness kept each reviewed step visible and unblocked.
**Recurrence 2026-08-03:** PR-thread verification piped a bundled comment snapshot into an inline Node parser, so the guard rejected the outer command before the read-only parser ran; persisting the snapshot in a temporary file and reading it through stdin redirection preserved the workflow.
**Recurrence 2026-08-10:** A focused Gruff verification piped generated JSON into a shell hook and was blocked; writing the payload to a securely created temporary file and redirecting the hook's stdin kept the outer command reviewable.

---

## Lesson: Restoring coverage by cloning a monolith is not a real split

**Status:** active | **Created:** 2026-05-27

**Prevention:** When splitting a safety hook, define the ownership boundary before porting code. If the hooks must stay self-contained, generate or review each file from explicit function sets: common payload parsing may be shared, but secret, repository, and destructive policy helpers must not cross guard boundaries. A line-count spike across every split file is a review blocker until the duplication is explained or removed. Evidence anchors: `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `rm_has_recursive`), `workflow/hooks/deny-dangerous/patterns-paths.sh` (search: `is_secret_path_touch`), `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `is_gh_write_operation`), `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `npm token delete/revoke`).

**What happened:** Restoring lost guardrail coverage copied one parser and checker into all three scoped hooks; runtime filters separated outcomes, but every hook still carried unrelated secret, write, and destructive-command logic.

**Root cause:** The work optimized for recovering behaviour quickly after finding dropped coverage and skipped the design step that should have extracted shared parsing into one source or generated the three guards from one policy table.

## Lesson: Codex hook commands must use the git-root wrapper shape

**Status:** active | **Created:** 2026-05-27
**Incident count:** 3 | **Latest occurrence:** 2026-08-22

**Prevention:** Generate Codex hook commands through the root-resolving Node bootstrap: it resolves the active git root, loads `run-with-bash.mjs`, passes the selected hook as an argument, and starts the launcher with that root as cwd. Codex deliberately receives no `CLAUDE_PROJECT_DIR` fallback. On Windows, wrap the same bootstrap in the provider's `commandWindows` override: transport the generated source as Base64, restore `[Environment]::CurrentDirectory` with `Set-Location -LiteralPath`, invoke `node.exe`, propagate `$LASTEXITCODE`, and preserve `Path` and `PATHEXT` in minimal replay environments. Test the exact generated override from a hostile-named path with safe, blocked, and canary inputs. Which events that registration actually delivers is a separate question owned by `.goat-flow/learning-loop/lessons/hook-testing.md` (search: `Prove hook capability before marking an agent unsupported`). Evidence anchors: `workflow/hooks/agent-config/codex-hooks.json` (search: `run-with-bash.mjs`), `.codex/hooks.json` (search: `run-with-bash.mjs`), `src/cli/server/agent-hook-command.ts` (search: `codexWindowsHookCommand`), `test/integration/hook-command-spawn-matrix.test.ts` (search: `Windows override`).

**What happened:** The live Codex hook config reported three PreToolUse failures with exit 127 even after the scripts themselves passed. The registered commands were `bash "$(git rev-parse --show-toplevel)/.codex/hooks/..."`, so Codex could fail before the guard script started when command substitution was not resolved in the hook runner context.

**Root cause:** The Claude-style hook command string was assumed safe for Codex too; the audit parser only needed to see the hook script path, while the runtime needed a command shape Codex can execute directly.

**Recurrence 2026-08-06:** The rule is narrowed, not a blanket ban on shell substitution: Codex hook commands run with the session cwd, so bare `.goat-flow/hooks/...` paths fail from nested directories, and the Node bootstrap is the current safe shape. `test/unit/hook-registrar.test.ts` (search: `generated Codex launchers resolve the active root`).
**Recurrence 2026-08-22:** Windows required the `commandWindows` override around that bootstrap, because Windows PowerShell can parse hostile cwd characters incorrectly or turn policy exit 2 into hook-failure exit 1. `src/cli/server/hooks-registry.ts` (search: `provider-capture-stale`).
