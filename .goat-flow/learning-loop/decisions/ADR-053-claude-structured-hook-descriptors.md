# ADR-053: Claude registers structured exec-form hook descriptors

**Status:** Implemented
**Date:** 2026-08-13
**Ticket/Context:** `.goat-flow/plans/hook-command-portability/` (M01 evidence spike, M02 implementation)

## Context

The hook writer serialized one 5,648-character `node -e` shell command for every provider. On Windows, all three transports mangled that command before Goat Flow's policy code could start: cmd.exe exited 255 on an unrecognized token, Windows PowerShell failed at the operand-tokenizer regex, and the `bash -c` argv round-trip collapsed `\\` and `\"` into a Node `[eval]:1` SyntaxError. A Bash file control ran the same bootstrap successfully, so the failure belonged to command transport, not policy behavior. Measured 2026-08-13 on Windows with Node v24.9.0 and Git Bash 5.3.15; reproduction: `.goat-flow/plans/hook-command-portability/spawn-matrix.mjs`.

Provider handler contracts are not interchangeable. A live capture of Claude Code 2.1.229 on Windows loaded exec-form `command` plus `args` handlers, preserved an operand containing spaces, ampersands, parentheses, and a pipe, ran from the project root, and delivered an exit-2 denial to the active model. Disposable captures of Codex CLI 0.147.0, Copilot CLI 0.0.409, and Antigravity CLI 1.1.9 produced no handler start or delivered result, so ADR-052's evidence gate blocks their migration.

The repository already ships `run-with-bash.mjs`, `hook-launch-runtime.mjs`, and `hook-provider-adapters.mjs` as stamped, manifest-owned launch assets. A second shared shim would duplicate that ownership.

## Decision

Migrate Claude Code only. Codex, Copilot, and Antigravity keep their current registrations byte-for-byte until a fresh exact-version capture approves each one.

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
timeout: the existing hook-specific Claude timeout
```

`args` is an ordered tuple in exec form: the host passes each element without a shell, so no transport retokenizes the source or operands. The structured bootstrap keeps the legacy root contract - Git root first via `rev-parse --show-toplevel`, then real cwd ancestors, then `CLAUDE_PROJECT_DIR`, classifying absent, corrupt, and complete managed roots and rejecting symlinked, multiply linked, escaping, or incomplete files. Registration recognition reads structured `args` operands beside legacy command strings. After selecting a complete root, the bootstrap imports the shipped `run-with-bash.mjs` through a file URL, verifies `runHookWithBash` is callable, and invokes it with the selected root, hook path, and response mode; this replaces the former second Node process. Owners: `src/cli/server/agent-hook-command.ts` (search: `structuredHookLaunchBootstrap`, `buildAgentHookDescriptor`).

One descriptor contract serves every consumer: the writer and migration (`agent-hook-command.ts`, `agent-hook-writer.ts`), the generated standalone installer authority (`workflow/hooks/agent-config/managed-hook-desired-state.json` via `scripts/generate-managed-hook-desired-state.mjs`, consumed by `install-goat-flow.sh`), identity and exact matching (`entryCarriesHandlerDescriptor`), audit and drift (`check-drift-hooks.ts`, `check-agent-deny-runtime.ts`), configured replay and runtime evidence (`hooks-configured-runtime-evidence.ts`, `hooks-runtime-evidence.ts`), and the shipped provider templates. Readers compare the complete selected descriptor and never reconstruct a universal command string; `run-with-bash.mjs` stays excluded from per-hook identity.

Failure boundary: failures after Node starts - managed root missing or incomplete, registration mismatch, downstream launcher missing, corrupt, or API-invalid, Bash startup failure, invalid provider result, bounded timeout - become the provider's blocking or unavailable response. A host that cannot locate or start `node`, rejects the handler before launch, or corrupts the inline `-e` source fails before the guarded bootstrap can respond; those stay explicit host prerequisites and are never described as fail closed.

## Failure Mode Comparison

| Option | What fails | Why rejected or accepted |
| --- | --- | --- |
| One universal command string | cmd.exe, PowerShell, and Bash argv transport all break it before policy starts | Rejected: the measured incident |
| New checked-in shared shim | Duplicates three existing stamped launch assets and still cannot run before root discovery | Rejected |
| Direct `${CLAUDE_PROJECT_DIR}` file execution | Cannot report a stale or incomplete environment root as unavailable | Rejected |
| Migrating documented but uncaptured providers | Registration changes without execution and delivery evidence | Rejected by ADR-052 |
| Exec-form argv for the captured provider only | Nothing observed; live capture, spawn matrix, and degradation suites pass | Accepted |

## Consequences

- Claude handlers bypass host-shell tokenization while keeping root selection, trust checks, and provider responses; the live Windows capture delivered `BLOCKED: Policy destructive:` at exit 2 in a real session.
- Deferred providers receive no config-byte change; their contract fragments are byte-identical before and after regeneration.
- `hooks sync` and the standalone installer migrate historical inline rows to the descriptor and converge duplicate or mixed stale/current rows to one registration (`test/unit/hook-registrar.test.ts`, `test/integration/setup-install-agent-matrix.test.ts`).
- Windows CI runs the descriptor spawn matrix and catchable-failure contracts at the package-minimum Node (`.github/workflows/ci.yml`, search: `windows-hook-contracts`).

## Reversibility

Two-way door for the registration shape: `hooks sync` rewrites managed Claude rows from the writer, so reverting the writer and regenerating the installer contract restores inline commands - and reintroduces the measured Windows startup failure. Revisit when a deferred provider produces a fresh exact-version capture (extend the descriptor per provider) or when Claude's documented hook schema changes (renew the capture per ADR-052 before reshaping).
