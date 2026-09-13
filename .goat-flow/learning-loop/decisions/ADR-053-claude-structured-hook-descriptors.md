# ADR-053: Provider-specific structured and Windows hook descriptors

**Status:** Implemented
**Date:** 2026-08-13
**Ticket/Context:** `.goat-flow/plans/1.17.0/M53-copilot-claude-hook-routing-decision.md`; `.goat-flow/plans/1.17.0/M54-copilot-claude-hook-routing-fix.md`
**Updated:** 2026-09-05 - condensed; the deleted local spawn-matrix reproduction is replaced by the CI job that runs it. The 2026-08-22 amendment added Codex `commandWindows`; the 2026-08-25 amendment added Claude's inert Copilot routing fields.

## Context

The hook writer serialized one 5,648-character `node -e` shell command for every provider. On Windows all three transports mangled it before goat-flow's policy code started: cmd.exe exited 255 on an unrecognized token, Windows PowerShell failed at its operand tokenizer, and the `bash -c` argv round-trip collapsed `\\` and `\"` into a Node `[eval]:1` SyntaxError. A Bash file control ran the same bootstrap, so the failure belonged to command transport, not policy. Measured 2026-08-13 with Node v24.9.0 and Git Bash 5.3.15; the spawn matrix now runs in CI (`.github/workflows/ci.yml`, search: `windows-hook-contracts`).

Provider handler contracts are not interchangeable. A live capture of Claude Code 2.1.229 on Windows loaded exec-form `command` plus `args`, preserved an operand containing spaces, ampersands, parentheses, and a pipe, ran from the project root, and delivered an exit-2 denial to the model. Disposable captures of Codex CLI 0.147.0, Copilot CLI 0.0.409, and Antigravity CLI 1.1.9 produced no handler start or delivered result, so ADR-052's gate blocked a universal migration.

Codex documents a Windows-only `commandWindows` override beside `command`. Exact replay on Windows showed the unchanged command failing before policy startup while a PowerShell override preserved hostile cwd characters, returned status 0, propagated denial status 2, and rejected a fake secret canary. A first Codex CLI 0.149.0 exec capture did not load the project hooks and is invalid evidence; a later capture in this already-trusted project loaded the registration and delivered `Command blocked by PreToolUse hook: BLOCKED: Policy secret:` before shell execution. That PreToolUse proof stays `scenario-unverified` and does not renew PostToolUse or Stop evidence.

Copilot CLI 1.0.80 combines native `.github/hooks/*.json` registrations with `.claude/settings.json` hooks. In a mixed-source capture both fired for one session; with the structured Claude row, Copilot selected the bare `command: "node"` without its `args` and rejected a safe `pwd` with a Node syntax error before policy startup. A controlled row that changed only the host-specific shell fields to `exit 0` left Claude's exec tuple intact and stopped the cross-loaded row from competing with Copilot's native registration.

The repository already ships `run-with-bash.mjs`, `hook-launch-runtime.mjs`, and `hook-provider-adapters.mjs` as stamped, manifest-owned launch assets.

## Decision

Use provider-specific descriptors: Claude keeps a structured exec-form handler with inert Copilot routing fields, Codex keeps its `command` byte-for-byte and adds `commandWindows`, and Copilot and Antigravity keep their registrations until fresh exact-version evidence approves a change.

The writer emits this complete shape for every managed Claude hook:

```text
type: "command"
command: "node"
args[0]: "-e"
args[1]: structuredHookLaunchBootstrap(hookLaunchMode)
args[2]: project-relative managed hook script path
args[3]: versioned or legacy hook launch mode
args[4]: "CLAUDE_PROJECT_DIR"
args[5]: ".claude/settings.json"
args[6]: project-relative ".goat-flow/hooks/run-with-bash.mjs"
bash: "exit 0"
powershell: "exit 0"
timeout: the existing hook-specific Claude timeout
```

`args` is an ordered tuple in exec form: the host passes each element without a shell, so no transport retokenizes the source or operands. The bootstrap keeps the legacy root contract (Git root via `rev-parse --show-toplevel`, then real cwd ancestors, then `CLAUDE_PROJECT_DIR`), classifies absent, corrupt, and complete managed roots, rejects symlinked, multiply linked, escaping, or incomplete files, imports the shipped `run-with-bash.mjs` through a file URL, verifies `runHookWithBash` is callable, and invokes it with root, hook path, and response mode, replacing the former second Node process. Owners: `src/cli/server/agent-hook-command.ts` (search: `structuredHookLaunchBootstrap`, `buildAgentHookDescriptor`).

Claude executes `command` plus `args` and ignores the shell-routing fields. A Copilot process that also loads the Claude file selects `bash` or `powershell`, receives `exit 0`, and leaves enforcement to the one native row in `.github/hooks/hooks.json`. The two no-op fields are part of exact managed identity, so a missing or changed field is drift that `hooks sync` repairs. The Claude no-op row never counts as Copilot protection. Copilot's Bash selection is live-measured; its PowerShell field is provider-documented only.

For Codex, `commandWindows` is a generated Windows PowerShell command that restores `[Environment]::CurrentDirectory` with `Set-Location -LiteralPath`, decodes the trusted bootstrap from Base64 after removing that operand from Node's argv, invokes `node.exe`, and exits with the native status. That avoids inline-source tokenization, PowerShell's cwd reset on metacharacter paths, and its collapse of status 2 to 1. Owner: `src/cli/server/agent-hook-command.ts` (search: `codexWindowsHookCommand`).

One descriptor contract serves the writer and migration (`agent-hook-command.ts`, `agent-hook-writer.ts`), the installer authority (`workflow/hooks/agent-config/managed-hook-desired-state.json` via `scripts/generate-managed-hook-desired-state.mjs`), identity matching (`entryCarriesHandlerDescriptor`), audit and drift (`check-drift-hooks.ts`, `check-agent-deny-runtime.ts`), configured replay and runtime evidence (`hooks-configured-runtime-evidence.ts`, `hooks-runtime-evidence.ts`), and the provider templates. Readers compare the complete descriptor; runtime replay selects only the executable contract for its provider, and `run-with-bash.mjs` stays outside per-hook identity.

Failure boundary: failures after Node starts (missing or incomplete root, registration mismatch, missing or corrupt launcher, Bash startup failure, invalid provider result, bounded timeout) become the provider's blocking or unavailable response. A host that cannot locate or start Node, rejects the handler before launch, or corrupts the inline source fails before the bootstrap can respond; those are explicit host prerequisites and are never described as fail closed. Windows verification environments must preserve `PATH`/`Path` and `PATHEXT`.

## Failure Mode Comparison

| Option | What fails | Verdict |
| --- | --- | --- |
| One universal command string | cmd.exe, PowerShell, and Bash argv transport all break it before policy starts | Rejected; the measured incident |
| New checked-in shared shim | Duplicates three stamped launch assets and still cannot run before root discovery | Rejected |
| Direct `${CLAUDE_PROJECT_DIR}` file execution | Cannot report a stale or incomplete environment root as unavailable | Rejected |
| Claim provider delivery after a registration change | Configured replay does not prove the provider fired or delivered | Rejected by ADR-052 |
| Register the real policy in both Claude and native Copilot sources | Copilot combines the sources and can invoke the lifecycle twice | Rejected; Claude carries inert routes and native Copilot is the sole policy source |
| Exec-form argv for the captured provider, `commandWindows` for Codex, no change elsewhere | Nothing observed failing; live capture, spawn matrix, and degradation suites pass | Accepted |

## Consequences

- Claude handlers bypass host-shell tokenization; the live Windows capture delivered `BLOCKED: Policy destructive:` at exit 2.
- Claude rows carry `bash: "exit 0"` and `powershell: "exit 0"`; they change local routing for hosts that combine config sources and establish no provider-delivery evidence.
- Codex gains `commandWindows` with `command` byte-identical; its gruff and Stop evidence is stale until an exact current-registration capture proves delivery.
- `hooks sync` and the standalone installer migrate historical inline rows and converge duplicate or mixed rows to one registration (`test/unit/hook-registrar.test.ts`, `test/integration/setup-install-agent-matrix.test.ts`).

## Reversibility

Two-way for the registration shape: `hooks sync` rewrites managed rows from the writer while preserving user-owned siblings. Reverting Claude's descriptor or Codex's `commandWindows`, regenerating the installer contract, and syncing restores the prior registrations; removing Claude's no-op fields reintroduces Copilot's measured bare-Node failure. Revisit provider support only with an exact current-version capture renewed per ADR-052.
