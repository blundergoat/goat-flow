# ADR-053: Provider-specific structured and Windows hook descriptors

**Status:** Accepted
**Date:** 2026-08-13
**Updated:** 2026-10-18 - both Claude policy rows add `onFailure: "block"` after Claude Code 2.1.295 introduced the field; see Decision and Failure boundary. 2026-10-11 - the descriptor field list now lives in code, and the retired Implemented status became Accepted. ADR-066 (2026-09-19) changes root selection for the Gruff edit hook only; policy and Stop hooks keep this contract.

## Context

The hook writer serialized one 5,648-character `node -e` shell command for every provider. On Windows all three transports mangled it before goat-flow's policy code started: cmd.exe exited 255 on an unrecognized token, Windows PowerShell failed at its operand tokenizer, and the `bash -c` argv round-trip collapsed `\\` and `\"` into a Node `[eval]:1` SyntaxError. A Bash file control ran the same bootstrap, so the failure belonged to command transport, not policy. Measured 2026-08-13 with Node v24.9.0 and Git Bash 5.3.15; the spawn matrix now runs in CI (`.github/workflows/ci.yml`, search: `windows-hook-contracts`).

Provider handler contracts are not interchangeable. A live capture of Claude Code 2.1.229 on Windows loaded exec-form `command` plus `args`, preserved an operand containing spaces, ampersands, parentheses, and a pipe, ran from the project root, and delivered an exit-2 denial to the model. Disposable captures of Codex CLI 0.147.0, Copilot CLI 0.0.409, and Antigravity CLI 1.1.9 produced no handler start or delivered result, so the requirement for captured provider delivery blocked a universal migration.

Codex documents a Windows-only `commandWindows` override beside `command`. Exact replay on Windows showed the unchanged command failing before policy startup while a PowerShell override preserved hostile cwd characters, returned status 0, propagated denial status 2, and rejected a fake secret canary. A first Codex CLI 0.149.0 exec capture did not load the project hooks and is invalid evidence; a later capture in this already-trusted project loaded the registration and delivered `Command blocked by PreToolUse hook: BLOCKED: Policy secret:` before shell execution. That PreToolUse proof stays `scenario-unverified` and does not renew PostToolUse or Stop evidence.

Copilot CLI 1.0.80 combines native `.github/hooks/*.json` registrations with `.claude/settings.json` hooks. In a mixed-source capture both fired for one session; with the structured Claude row, Copilot selected the bare `command: "node"` without its `args` and rejected a safe `pwd` with a Node syntax error before policy startup. A controlled row that changed only the host-specific shell fields to `exit 0` left Claude's exec tuple intact and stopped the cross-loaded row from competing with Copilot's native registration.

The repository already ships `run-with-bash.mjs`, `hook-launch-runtime.mjs`, and `hook-provider-adapters.mjs` as stamped, manifest-owned launch assets.

## Decision

Use provider-specific descriptors: Claude keeps a structured exec-form handler with inert Copilot routing fields, Codex keeps its non-Windows `command` byte-for-byte and adds `commandWindows`, Copilot uses separate `bash` and `powershell` fields, and Antigravity starts a managed bootstrap file. The dated evidence below approves Antigravity's change; future transport changes still require applicable exact-version evidence.

For every managed Claude hook the writer emits `type: "command"`, `command: "node"`, an ordered `args` tuple (the `-e` bootstrap source, the project-relative hook script path, the launch mode, the project-directory variable name, the settings path, and the project-relative `run-hook.mjs` path), the inert `bash: "exit 0"` and `powershell: "exit 0"` fields, and the hook's existing Claude timeout. The two policy rows (`deny-dangerous`, `deny-git-mutations`) also carry `onFailure: "block"`, added 2026-10-18 for Claude Code 2.1.295 or later: the host then blocks the tool call when the handler cannot start, reaches its timeout, or exits with a status other than 0 or 2. The Gruff row omits the field because unavailable feedback is a visible skip, and the Stop row omits it because Claude Code documents the field as having no effect on Stop. The exact tuple is owned by `src/cli/server/agent-hook-command.ts` (search: `buildAgentHookDescriptor`).

`args` is an ordered tuple in exec form: the host passes each element without a shell, so no transport retokenizes the source or operands. The bootstrap (`src/cli/server/agent-hook-command.ts`, search: `structuredHookLaunchBootstrap`) keeps the legacy root contract (Git root via `rev-parse --show-toplevel`, then real cwd ancestors, then `CLAUDE_PROJECT_DIR`), classifies absent, corrupt, and complete managed roots, rejects symlinked, multiply linked, escaping, or incomplete files, imports the shipped `run-hook.mjs` through a file URL, and invokes `runHookNative` with the hook path, response mode, and resolved root, replacing the former second Node process.

Claude executes `command` plus `args` and ignores the shell-routing fields. A Copilot process that also loads the Claude file selects `bash` or `powershell`, receives `exit 0`, and leaves enforcement to the one native row in `.github/hooks/hooks.json`. The two no-op fields are part of exact managed identity, so a missing or changed field is drift that `hooks sync` repairs. The Claude no-op row never counts as Copilot protection. Copilot's Bash selection is live-measured; its PowerShell field is provider-documented only.

For Codex, `commandWindows` is a generated Windows PowerShell command that restores `[Environment]::CurrentDirectory` with `Set-Location -LiteralPath`, decodes the trusted bootstrap from Base64 after removing that operand from Node's argv, invokes `node.exe`, and exits with the native status. That avoids inline-source tokenization, PowerShell's cwd reset on metacharacter paths, and its collapse of status 2 to 1. Owner: `src/cli/server/agent-hook-command.ts` (search: `windowsPowerShellHookCommand`).

One descriptor contract serves the writer and migration (`agent-hook-command.ts`, `agent-hook-writer.ts`), the installer authority (`workflow/hooks/agent-config/managed-hook-desired-state.json` via `scripts/generate-managed-hook-desired-state.mjs`), identity matching (`entryCarriesHandlerDescriptor`), audit and drift (`check-drift-hooks.ts`, `check-agent-deny-runtime.ts`), configured replay and runtime evidence (`hooks-configured-runtime-evidence.ts`, `hooks-runtime-evidence.ts`), and the provider templates. Readers compare the complete descriptor; runtime replay selects only the executable contract for its provider, and `run-with-bash.mjs` stays outside per-hook identity.

Failure boundary: failures after Node starts (missing or incomplete root, registration mismatch, missing or corrupt launcher, Bash startup failure, invalid provider result, bounded timeout) become the provider's blocking or unavailable response. A host that cannot locate or start Node, rejects the handler before launch, or corrupts the inline source fails before the bootstrap can respond; those are explicit host prerequisites and are never described as fail closed, with one exception: the Claude policy rows' `onFailure: "block"` (2026-10-18) makes Claude Code 2.1.295 or later refuse the call at that boundary. Measured 2026-10-18 on Claude Code 2.1.302 (`claude -p`, model claude-haiku-5-5, disposable scratch root carrying the exact two rows): with `node` absent from `PATH`, and separately with a launcher stub returning status 1, the host reported `failed; blocking because onFailure is "block"` with an error tool result and the requested `touch` marker was never created; the same two faults with the field removed let the command run and create the marker. The control run in the same root let `touch` through and denied `cat .env` with the policy's exit-2 message, and the untrusted-workspace notice named only `permissions.allow`, not the new field. Claude Code before 2.1.295 does not implement the field, and Copilot's handling of it on the cross-loaded row is unverified. Windows verification environments must preserve `PATH`/`Path` and `PATHEXT`.

## Failure Mode Comparison

### Antigravity transport decision, 2026-10-26

Windows Antigravity 1.4.7 starts hooks with Go's `exec.CommandContext(ctx, "cmd", "/c", command)` from the folder holding `hooks.json`, which is `.agents` for project hooks. Linux uses `sh -c`. The inline bootstrap fails under cmd.exe with exit 255. A Windows live capture of the file-based prototype delivered the Git-publication denial to the model; a separate capture showed the original launch failure blocking the tool call. This observed failure does not establish how every startup fault behaves.

Register `node ../.goat-flow/hooks/antigravity-hook-bootstrap.cjs <operands>`. The managed file holds the existing Antigravity bootstrap with `process.argv.splice(1,1);` prepended; its root discovery, legacy registration recognizer and failure responses stay unchanged. `scripts/generate-managed-hook-desired-state.mjs` generates and checks both copies together with the installer contract. This is a bounded exception to the earlier shared-shim rejection: the provider supplies no argv or per-OS handler field, and its hook directory makes the managed file reachable before root discovery. A missing file or Node executable still fails before that bootstrap can respond.

The regression in `test/integration/hook-command-spawn-matrix.test.ts` (search: `registerAntigravityWindowsArgvTests`) reproduces Go's argument quoting and records the argv Node receives from `.agents`. Configured verification and audit use the same provider shell and directory. The live captures also exposed a separate `read_file`/`Path` policy-coverage gap; the accompanying policy-input and matcher changes close that gap.

| Option | What fails | Verdict |
| --- | --- | --- |
| One universal command string | cmd.exe, PowerShell, and Bash argv transport all break it before policy starts | Rejected; the measured incident |
| New checked-in shared shim | Duplicates three stamped launch assets and still cannot run before root discovery | Rejected |
| Direct `${CLAUDE_PROJECT_DIR}` file execution | Cannot report a stale or incomplete environment root as unavailable | Rejected |
| Claim provider delivery after a registration change | Configured replay does not prove the provider fired or delivered | Rejected; registration replay cannot establish live delivery |
| Register the real policy in both Claude and native Copilot sources | Copilot combines the sources and can invoke the lifecycle twice | Rejected; Claude carries inert routes and native Copilot is the sole policy source |
| Exec-form argv for Claude, Windows PowerShell commands for Codex and Copilot, managed bootstrap file for Antigravity | Separate transports preserve each provider's launch contract; replay and live delivery retain distinct evidence requirements | Accepted |

## Consequences

- Claude handlers bypass host-shell tokenization; the live Windows capture delivered `BLOCKED: Policy destructive:` at exit 2.
- Claude rows carry `bash: "exit 0"` and `powershell: "exit 0"`; they change local routing for hosts that combine config sources and establish no provider-delivery evidence.
- Claude policy rows carry `onFailure: "block"`; a Claude policy row that lacks it is drift that `hooks sync` repairs, and the field is never written for Codex, Copilot, or Antigravity.
- Codex gains `commandWindows` with `command` byte-identical. Later applicable captures and remaining scenario gates are recorded in `workflow/hooks/README.md` (search: `The Codex Gruff gate is therefore`) and `src/cli/server/hooks-registry.ts` (search: `hook-provider-adapter.v1:codex:turn-stop`).
- `hooks sync` and the standalone installer migrate historical inline rows and converge duplicate or mixed rows to one registration (`test/unit/hook-registrar.test.ts`, `test/integration/setup-install-agent-matrix.test.ts`).

## Reversibility

Two-way for the registration shape: `hooks sync` rewrites managed rows from the writer while preserving user-owned siblings. Reverting Claude's descriptor or Codex's `commandWindows`, regenerating the installer contract, and syncing restores the prior registrations; removing Claude's no-op fields reintroduces Copilot's measured bare-Node failure. Revisit provider support only with a trusted capture applicable to the exact provider version, mode and registration, as required by `.goat-flow/architecture.md` (search: `Documentation and capture records have no calendar expiry`).
