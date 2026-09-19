# Guardrails

Guardrails are goat-flow's runtime command-safety hooks. Each agent registers `deny-dangerous.sh` and `deny-git-mutations.sh` separately. Both use the parser and policy modules in `.goat-flow/hooks/deny-dangerous/`.

## Surfaces

| Surface | Path | Role |
| --- | --- | --- |
| Dangerous policy | `workflow/hooks/deny-dangerous.sh` | Blocks recursive force deletion, privileged package-manager mutation, and secret-path access |
| Git and GitHub policy | `workflow/hooks/deny-git-mutations.sh` | Blocks Git commits, publication, destructive Git operations, and GitHub writes; permits GitHub reads and issue/PR comments |
| Policy store | `.goat-flow/hooks/deny-dangerous/` | Shared `guard-runtime.sh` parser and response implementation plus three policy modules |
| Self-test | `.goat-flow/hooks/deny-dangerous/deny-dangerous-self-test.sh` | Routes smoke/full cases to each owning policy; preflight invokes both entrypoints |

GitHub write checks now belong to **Deny Git and GitHub writes** (saved ID: `deny-git-mutations`). If either the current or requested switch pair has one policy on and the other off, changing an existing installation’s ownership files requires review on the newer dashboard Hooks page. Review the selected project, both sets of choices, affected files and GitHub protection before accepting. Policy consent and replacement of local edits have separate checkboxes; Cancel changes nothing. CLI Sync, install and force options cannot provide policy consent. Once the ownership files match the bundle, ordinary Sync needs no repeated policy review.

## Agent Mapping

| Agent | Runtime mechanism | Primary locations |
| --- | --- | --- |
| Claude Code | `PreToolUse` config entries invoking central hooks plus settings deny patterns | `.claude/settings.json`, `.goat-flow/hooks/` |
| Codex | `PreToolUse` config entries invoking central hooks plus config TOML permission profile | `.codex/hooks.json`, `.codex/config.toml`, `.goat-flow/hooks/` |
| Copilot CLI | `preToolUse` hooks registered in `.github/hooks/hooks.json` and invoking central hooks | `.github/hooks/hooks.json`, `.goat-flow/hooks/` |
| Antigravity | `PreToolUse` hooks registered in `.agents/hooks.json` and invoking central hooks | `.agents/hooks.json`, `.goat-flow/hooks/` |

## Verification

- `bash .goat-flow/hooks/deny-dangerous.sh --self-test=smoke`
- `bash .goat-flow/hooks/deny-dangerous.sh --self-test=full`
- `bash .goat-flow/hooks/deny-git-mutations.sh --self-test=smoke`
- `bash .goat-flow/hooks/deny-git-mutations.sh --self-test=full`
- `goat-flow hooks list --json`
- After trusting the selected checkout: `goat-flow hooks verify . --agent <id> --scenario all --trusted-target`

Both policies default on. Explicit upgrade migration preserves a saved Git-hook choice or inherits the previous dangerous-hook choice once. Ordinary toggles and `hooks sync` preserve saved choices and keep a missing Git choice on. Shared-file repairs can stale both proof records. `hooks sync` repairs installation, and each policy's verification group supplies fresh proof. Agents still never commit or push, regardless of toggle state.

## Troubleshooting a blocked check

A policy denial means the hook rejected the proposed command. An unavailable policy check also blocks the pending tool, but its diagnostic describes an execution problem rather than a finding about the command.

| Diagnostic | Meaning and next step |
| --- | --- |
| A named policy or command-syntax denial | Review the proposed command against the named rule. Retrying after a delay does not change the rule. |
| `Policy hook unavailable` | Read the named hook and reason. Check Bash availability and the installed entrypoint and shared policy store; repair an incomplete installation before retrying. |
| `exceeded its deadline; process-tree termination was requested` | The launcher reached its deadline. Let other verification work finish, then retry the same check once on its own. If it times out again, retain the diagnostic and investigate the named hook. A successful sequential retry does not establish what caused the original timeout. |
| `hook timeout configuration is invalid` | Remove or correct `GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS`. An unset or empty value uses the registered deadline; a supplied value must be a positive whole number of milliseconds. Values above the registered ceiling are capped at that ceiling. |

The launcher can report these failures only after Node starts. A host that cannot start Node or rejects the handler before launch has a host-prerequisite failure; the hook cannot guarantee a blocking response at that earlier boundary.

For shell-context problems, distinguish the hook's launcher from the command being inspected. A PowerShell registration describes how the hook starts, not which shell will interpret the proposed command. Use the provider's captured command fields and established tool-shell context when diagnosing grammar. Missing context leaves the case unresolved; it does not justify stripping escapes or relaxing a denial.

## Recovering an older installation

On the newer dashboard's Hooks page, select the affected project and use **Sync official hooks** before changing an incompatible policy installation.
Approve policy ownership and local-file replacement separately.
Before approving a replacement, compare each local policy file with the official one; `goat-flow install <project-path> --agent <id> --dry-run` lists locally edited files as `both-changed`.
Replacement discards local edits, including a protection the official policy does not have.
If legacy state blocks Sync, stop and upgrade every writer, then run
`goat-flow install <project-path> --agent <id> --migrate-state-only` from a normal terminal before requesting a fresh review.
The action moves bookkeeping only; it keeps hook files and policy choices unchanged and refuses unsafe state or outstanding claims.
Complete any remaining install-file review separately, then change only the affected switch and retry a benign request.

Disabled policies retain their registrations so saved handlers can read the current off choice; other hooks keep their existing registration rules.
Complete v1.16.0 Codex upgrade and saved-handler recovery are fixture-verified on a non-Windows host.
Provider reload in an existing session is unverified; test a fresh session separately and do not treat it as recovery of the old one.
See the [CLI recovery steps](cli.md#recovering-an-older-policy-installation) for the verified sequence and evidence limits.

## Limitations

The shared parser is a defense-in-depth check for proposed command text. It applies the existing Git and GitHub write rules to commands wrapped in supported `xargs`, `find -exec`, `watch`, shell-c, and common GNU Parallel forms. It also blocks exact credential directories, protected curl file operands, and downloaded bytes passed to executable or unknown pipeline consumers. Known read-only download filters, local data passed to an explicit script file, and literal `vendor` or `target` cleanup remain available.

The hooks do not interpret arbitrary shell state or replace runtime permissions. Variable-computed executable names, shell aliases the policy cannot resolve, arbitrary interpreter bodies, and unsupported wrapper grammar may remain outside classification. Keep provider deny lists, filesystem permissions, process sandboxing, and operating-system credentials as the hard boundary. Inspect and run an unclear command manually.
