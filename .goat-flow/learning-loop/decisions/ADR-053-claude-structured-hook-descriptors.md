# ADR-053: Provider-specific structured and Windows hook descriptors

**Status:** Implemented
**Date:** 2026-08-13
**Amended:** 2026-08-25
**Ticket/Context:** `.goat-flow/plans/1.17.0/windows-tasks/` (M01 evidence spike, M02 implementation); `.goat-flow/plans/1.17.0/M53-copilot-claude-hook-routing-decision.md`; `.goat-flow/plans/1.17.0/M54-copilot-claude-hook-routing-fix.md`

## Context

The hook writer serialized one 5,648-character `node -e` shell command for every provider. On Windows, all three transports mangled that command before Goat Flow's policy code could start: cmd.exe exited 255 on an unrecognized token, Windows PowerShell failed at the operand-tokenizer regex, and the `bash -c` argv round-trip collapsed `\\` and `\"` into a Node `[eval]:1` SyntaxError. A Bash file control ran the same bootstrap successfully, so the failure belonged to command transport, not policy behavior. Measured 2026-08-13 on Windows with Node v24.9.0 and Git Bash 5.3.15; reproduction: `.goat-flow/plans/1.17.0/windows-tasks/spawn-matrix.mjs`.

Provider handler contracts are not interchangeable. A live capture of Claude Code 2.1.229 on Windows loaded exec-form `command` plus `args` handlers, preserved an operand containing spaces, ampersands, parentheses, and a pipe, ran from the project root, and delivered an exit-2 denial to the active model. Disposable captures of Codex CLI 0.147.0, Copilot CLI 0.0.409, and Antigravity CLI 1.1.9 produced no handler start or delivered result, so ADR-052's evidence gate blocked an unsupported universal migration.

The 2026-08-22 amendment addresses Codex's documented descriptor instead of inventing a new handler shape. Codex CLI supports a Windows-only `commandWindows` override beside the existing `command`. Exact configured-command replay on Windows showed the unchanged command failing before policy startup, while a PowerShell-specific override preserved hostile cwd characters, returned safe status 0, propagated policy denial status 2, and rejected a fake secret canary. An initial disposable Codex CLI 0.149.0 exec capture did not load the project hooks and allowed the fake `.env` read, so that run is invalid evidence. A subsequent exec capture in this already-trusted project loaded the exact registration and delivered `Command blocked by PreToolUse hook: BLOCKED: Policy secret:` before shell execution. The dated PreToolUse proof remains `scenario-unverified`; it does not renew PostToolUse or Stop provider-delivery evidence, so those registry gates become stale under ADR-052.

The repository already ships `run-with-bash.mjs`, `hook-launch-runtime.mjs`, and `hook-provider-adapters.mjs` as stamped, manifest-owned launch assets. A second shared shim would duplicate that ownership.

The 2026-08-25 amendment addresses a second host reading Claude's project config. Copilot CLI 1.0.80 combines native `.github/hooks/*.json` registrations with `.claude/settings.json` hooks. In an isolated mixed-source capture, both sources fired for one session. With Goat Flow's structured Claude row, Copilot selected the bare `command: "node"` field without its `args` and rejected a safe `pwd` request before policy startup with a Node syntax error. A controlled row that changed only the host-specific shell fields to `exit 0` left Claude's exec tuple intact and stopped the cross-loaded row from competing with Copilot's native policy registration.

## Decision

Use provider-specific descriptors. Claude Code keeps its structured exec-form handler. Codex keeps its existing cross-platform `command` byte-for-byte and adds `commandWindows`; Copilot and Antigravity keep their current registrations until fresh exact-version evidence approves a change.

The writer emits this complete handler shape for every managed Claude hook:

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

`args` is an ordered tuple in exec form: the host passes each element without a shell, so no transport retokenizes the source or operands. The structured bootstrap keeps the legacy root contract - Git root first via `rev-parse --show-toplevel`, then real cwd ancestors, then `CLAUDE_PROJECT_DIR`, classifying absent, corrupt, and complete managed roots and rejecting symlinked, multiply linked, escaping, or incomplete files. Registration recognition reads structured `args` operands beside legacy command strings. After selecting a complete root, the bootstrap imports the shipped `run-with-bash.mjs` through a file URL, verifies `runHookWithBash` is callable, and invokes it with the selected root, hook path, and response mode; this replaces the former second Node process. Owners: `src/cli/server/agent-hook-command.ts` (search: `structuredHookLaunchBootstrap`, `buildAgentHookDescriptor`).

The field ownership is deliberate. Claude executes `command` plus `args`; local configured replay does the same and ignores the shell-routing fields. A Copilot process that also loads the Claude file selects `bash` or `powershell`, receives `exit 0`, and leaves policy enforcement to the one native row in `.github/hooks/hooks.json`. The two no-op fields are part of exact managed identity, so a missing or changed field is drift and `hooks sync` repairs it. Audit and runtime evidence still inspect the selected provider's own config path. The Claude no-op row never counts as Copilot protection. Copilot's Bash selection is live-measured; its PowerShell field is provider-documented but lacks a current live Windows mixed-source capture.

For Codex, `commandWindows` is a generated Windows PowerShell command. It restores `[Environment]::CurrentDirectory` with `Set-Location -LiteralPath`, decodes the trusted bootstrap from Base64 only after removing that transport operand from Node's argv, invokes `node.exe`, and exits with the native status. This avoids raw inline-source tokenization, Windows PowerShell's cwd reset for metacharacter-bearing paths, and its default collapse of native status 2 to hook-failure status 1. The descriptor's ordinary `command` remains the non-Windows contract. Owner: `src/cli/server/agent-hook-command.ts` (search: `codexWindowsHookCommand`).

One descriptor contract serves every consumer: the writer and migration (`agent-hook-command.ts`, `agent-hook-writer.ts`), the generated standalone installer authority (`workflow/hooks/agent-config/managed-hook-desired-state.json` via `scripts/generate-managed-hook-desired-state.mjs`, consumed by `install-goat-flow.sh`), identity and exact matching (`entryCarriesHandlerDescriptor`), audit and drift (`check-drift-hooks.ts`, `check-agent-deny-runtime.ts`), configured replay and runtime evidence (`hooks-configured-runtime-evidence.ts`, `hooks-runtime-evidence.ts`), and the shipped provider templates. Readers compare the complete descriptor, including Claude's no-op routing fields and Codex's `commandWindows` when present. Runtime replay selects only the executable contract for that provider without reconstructing one; `run-with-bash.mjs` stays excluded from per-hook identity.

Failure boundary: failures after Node starts - managed root missing or incomplete, registration mismatch, downstream launcher missing, corrupt, or API-invalid, Bash startup failure, invalid provider result, bounded timeout - become the provider's blocking or unavailable response. A host that cannot locate or start Node, rejects the handler before launch, or corrupts the inline source fails before the guarded bootstrap can respond; those stay explicit host prerequisites and are never described as fail closed. Windows verification environments must also preserve `PATH`/`Path` and `PATHEXT` so the child bootstrap can resolve native executables.

## Failure Mode Comparison

| Option | What fails | Why rejected or accepted |
| --- | --- | --- |
| One universal command string | cmd.exe, PowerShell, and Bash argv transport all break it before policy starts | Rejected: the measured incident |
| New checked-in shared shim | Duplicates three existing stamped launch assets and still cannot run before root discovery | Rejected |
| Direct `${CLAUDE_PROJECT_DIR}` file execution | Cannot report a stale or incomplete environment root as unavailable | Rejected |
| Claiming provider delivery after a registration change | Exact configured replay does not prove the provider fired or delivered the hook | Rejected by ADR-052; Codex gates are stale |
| Exec-form argv for the captured provider only | Nothing observed; live capture, spawn matrix, and degradation suites pass | Accepted |
| Register the real policy command in both Claude and native Copilot sources | Copilot combines the sources and can invoke the lifecycle twice | Rejected: Claude carries inert Copilot shell routes; native Copilot remains the sole policy source |
| Codex `commandWindows` beside unchanged `command` | Windows uses its documented override; other hosts keep their prior bytes | Accepted for configured runtime portability; no live-delivery upgrade |

## Consequences

- Claude handlers bypass host-shell tokenization while keeping root selection, trust checks, and provider responses; the live Windows capture delivered `BLOCKED: Policy destructive:` at exit 2 in a real session.
- Claude managed rows carry `bash: "exit 0"` and `powershell: "exit 0"`. These fields change only local project routing for hosts that combine config sources; they do not change Copilot cloud behavior or establish provider-delivery evidence.
- Codex handlers gain `commandWindows`; the pre-existing `command` remains byte-identical. Gruff and Stop provider evidence is explicitly stale until an exact current-registration capture proves execution and delivery.
- Native Copilot and Antigravity registrations receive no config-byte change; their contract fragments are byte-identical before and after regeneration.
- `hooks sync` and the standalone installer migrate historical inline rows to the descriptor and converge duplicate or mixed stale/current rows to one registration (`test/unit/hook-registrar.test.ts`, `test/integration/setup-install-agent-matrix.test.ts`).
- Windows CI runs the descriptor spawn matrix and catchable-failure contracts at the package-minimum Node (`.github/workflows/ci.yml`, search: `windows-hook-contracts`).

## Reversibility

Two-way door for the registration shape: `hooks sync` rewrites managed rows from the writer while preserving user-owned hook and permission siblings. Reverting the Claude descriptor or Codex `commandWindows`, regenerating the installer contract, and syncing restores the prior registrations. Removing Claude's no-op routing fields reintroduces Copilot's measured bare-Node failure; reverting the earlier argv or Windows override reintroduces the measured Windows startup failures. Native Copilot config is not part of this rollback. Revisit provider support when an exact current-version capture proves execution and delivery, or when a documented hook schema changes; renew the capture per ADR-052 before presenting the changed registration as effective.
