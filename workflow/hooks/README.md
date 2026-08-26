# workflow/hooks/

Copyable hook scripts and agent-config templates for the GOAT Flow enforcement layer.

## Hook Scripts

| Script | Event | Required? | Purpose |
|--------|-------|-----------|---------|
| `run-with-bash.mjs` | Managed launcher | Required with registered hooks | Resolves the selected project, enforces the launcher deadline, and preserves direct legacy output or delivers a bounded result |
| `hook-launch-runtime.mjs` | Managed runtime | Required with registered hooks | Runs the child hook, caps output, enforces deadlines, and prepares provider-visible launcher failures |
| `hook-provider-adapters.mjs` | Provider response | Required with migrated result hooks | Validates the versioned result envelope and translates it into the active coding agent's documented response shape |
| `deny-dangerous.sh` | PreToolUse | Required | Single dispatcher that blocks destructive shell commands, direct secret-path access, `git commit` / `git push`, destructive git flags, and GitHub writes via `gh` |
| `deny-dangerous/*.sh` | Sourced policy store | Required with `deny-dangerous.sh` | Shared destructive-shell, secret-path, repository-write policy modules plus the central `deny-dangerous-self-test.sh` |
| `gruff-code-quality.sh` | PostToolUse | Optional | Checks each edited source file with its nearest package config and returns attributable line, symbol, file, and project findings through a bounded provider result |
| `post-turn-safety.sh` | Stop | Default for supported Stop agents | Scans changed text content for built-in safety hazards such as obvious secrets, private keys, credential assignments, and merge conflict markers |

## Agent Event Name Mapping

| Purpose | Claude Code | Codex CLI | Antigravity | Copilot CLI |
|---------|-------------|-----------|-------------|-------------|
| Block before tool runs | PreToolUse | PreToolUse in `.codex/hooks.json` with `deny-dangerous.sh` matched to `Bash` | PreToolUse in `.agents/hooks.json` with `deny-dangerous.sh` matched to `run_command` and secret-bearing file tools | `preToolUse` in `.github/hooks/hooks.json` with `deny-dangerous.sh` |
| Attributable Gruff quality | Registered PostToolUse for `Edit`, `Write`, and `Bash` containing `apply_patch`; no fresh 1.15.1 provider-delivery claim | Registered PostToolUse matched to `^apply_patch$`; provider delivery is stale after the Windows registration change | Disabled because PostToolUse did not deliver feedback to the active model | Registered `postToolUse`; no fresh 1.15.1 provider-delivery claim |
| Universal post-turn safety | Registered Stop with `post-turn-safety.sh`; no fresh 1.15.1 provider-delivery claim | Registered Stop; provider delivery is stale after the Windows registration change | Disabled because execution was not captured past the hook trust gate | Disabled because `agentStop` delivery and a Goat Flow registration adapter are unverified |
| Permission deny list | `.claude/settings.json` deny patterns | Filesystem permission profile in `.codex/config.toml`; command denies in the Bash hooks | Script-only guardrails; no provider-native file-read/file-write deny layer is claimed | Script-only guardrails; no provider-native file-read/file-write deny layer is claimed |
| Config format | JSON | TOML + JSON | JSON | JSON |

The previous Codex CLI 0.147.0 PostToolUse and Stop claim was invalidated when the registration gained a Windows-only command override. An initial disposable Codex CLI 0.149.0 exec capture on 2026-08-22 did not load the project hooks: the requested fake `.env` canary read completed, so that run is invalid evidence. A subsequent exec capture in this already-trusted project loaded the exact changed registration and delivered a PreToolUse block for the same fake canary before shell execution. That exact PreToolUse capture expires at 2026-09-21T02:17:08.834Z and remains `scenario-unverified` pending the separate fixed-scenario gate. On 2026-08-27, an approved disposable Codex CLI 0.149.1 `exec --dangerously-bypass-hook-trust` capture loaded the current generated PostToolUse registration, applied the requested patch, ran Gruff, and exposed an analyzer-only marker to the model. That proves delivery only for the exact bypass-trust exec fixture; it does not renew the generic trusted-session gate. Gruff and Stop provider evidence therefore stays stale. Exact configured-command replay on Windows is tracked separately and does not upgrade provider delivery by itself.

The capture becomes stale sooner when the provider version or mode, project-layer trust, event, adapter, or registration changes. Project-layer trust decides whether Codex loads project hooks; handler trust separately decides whether a loaded command may run. Passing either gate does not pass the other. Codex app-server, remote execution, and every other provider/mode/event combination have no fresh live-delivery claim in this release.

## Setup

1. Copy `run-with-bash.mjs`, `hook-launch-runtime.mjs`, `hook-provider-adapters.mjs`, `deny-dangerous.sh`, and `post-turn-safety.sh` to `.goat-flow/hooks/`, then copy `deny-dangerous/` to `.goat-flow/hooks/deny-dangerous/`. When Gruff is enabled, also copy `gruff-code-quality.sh`.
2. Copy the matching agent-config template(s) for your runtime:
   - Claude: `agent-config/claude.json` -> `.claude/settings.json`
   - Codex: `agent-config/codex.toml` -> `.codex/config.toml` and `agent-config/codex-hooks.json` -> `.codex/hooks.json`
   - Antigravity: `agent-config/antigravity-hooks.json` -> `.agents/hooks.json`
   - Copilot: `agent-config/copilot-hooks.json` -> `.github/hooks/hooks.json`
3. `gruff-code-quality.sh` is opt-in through `.goat-flow/config.yaml`, the dashboard Hooks page, or `goat-flow hooks enable gruff-code-quality`.

For a fresh Codex project, run `npx @blundergoat/goat-flow@latest install . --agent codex`. After a Goat Flow release containing the Codex Windows override is published, repair any affected Codex installation whose managed `.codex/hooks.json` lacks `commandWindows` (including 1.16.0) by running `npx @blundergoat/goat-flow@latest hooks sync .` from a normal terminal or unaffected shell, then start a fresh Codex session. Before publication, the checkout-local equivalent is `node --import tsx src/cli/cli.ts hooks sync <project-path>`.

Root-resolving commands prefer Git so linked worktrees and submodules select the correct checkout, then walk upward for a complete project-local Goat Flow installation. A candidate needs relevant registration plus a contained regular, non-symlinked, single-link launcher and requested script. Claude and Antigravity can also use `CLAUDE_PROJECT_DIR`; Codex has no host-root fallback, but a complete managed ancestor works without Git. A partial candidate or no usable root fails closed. Missing Gruff remains a visible non-blocking skip.

Registration shapes differ by provider (ADR-053). Claude registers an exec-form handler - `command: "node"` plus an ordered `args` tuple - so no host shell retokenizes the bootstrap or its operands. Each managed Claude row also carries `bash: "exit 0"` and `powershell: "exit 0"`. Claude ignores those routes and executes its argv tuple; a Copilot process that combines `.claude/settings.json` with repository hooks selects the inert route instead. The native `.github/hooks/hooks.json` row remains the sole Goat Flow policy registration for Copilot, and a missing native row is not covered by the Claude no-op. Codex retains that provider's existing `command` string for non-Windows hosts and adds the documented Windows-only `commandWindows` override. The override transports the generated bootstrap as Base64, starts `node.exe`, restores the operating-system cwd inside Windows PowerShell, and explicitly propagates the native exit status. Antigravity keeps its command-string registration until a fresh live capture approves a change. The standalone installer consumes the generated `agent-config/managed-hook-desired-state.json`, produced from the same TypeScript writer that setup and sync use. Once the handler's Node process starts, missing, corrupt, or API-invalid managed files return the provider's blocking or unavailable response; a host that cannot start Node, or that rejects the handler before launch, is a prerequisite failure the hooks cannot convert into a deny.

## Direct and Registered Results

Direct `.sh` use keeps each hook's existing stdout, stderr, exit status, `--check`, and self-test interface. Registered Gruff commands for Claude, Codex, and Copilot, plus the Codex Stop command, use the namespaced provider-result contract. Deny commands and other registered Stop commands retain their legacy result mode. A namespaced command records the provider, response kind, result protocol, lifecycle event, adapter version, and launcher deadline.

Self-test arguments are exact. Deny accepts `--self-test`, `--self-test=smoke`, and `--self-test=full`; Gruff accepts `--self-test` and `--self-test=smoke`; post-turn safety accepts only `--self-test`. Unsupported values and extra self-test arguments exit non-zero instead of starting normal hook execution.

The `goat-flow.hook-result.v1` path captures at most 10,000 combined stdout/stderr bytes, accepts one JSON object, caps findings at 20, and requires complete declared coverage before `pass`. Malformed, empty, partial, timed-out, or mismatched results become explicit unavailable outcomes. Provider adapters preserve blocking semantics; a host/event pair that cannot deliver the result remains unsupported instead of receiving weaker advice.

## Failure Modes / Runtime Contracts

- `.goat-flow/hooks/deny-dangerous/` must be present and tracked. If it is missing, `deny-dangerous.sh` denies with a clear policy-store message instead of reaching an undefined policy function or exiting 127.
- `deny-dangerous.sh` is a defense-in-depth classifier, not a shell interpreter or sandbox. It normalizes supported `xargs`, `find -exec`, `watch`, shell-c, and common GNU Parallel forms before applying the existing destructive, secret-path, and repository-write rules. Unknown wrapper grammar and variable-computed executable names remain outside its guarantees; agent permissions, filesystem isolation, and operating-system credentials remain the hard boundary.
- Known read-only download filters, local data passed to an explicit script file, literal `vendor` or `target` cleanup, and approved issue or pull-request comments remain allowed. Run an unclear command manually after inspection.
- Audit runs the exact configured handlers from `.claude/settings.json`, `.codex/hooks.json`, `.agents/hooks.json`, and `.github/hooks/hooks.json` only with `--trusted-target`; preflight exercises this repository's configured handlers. Claude's exec-form argv runs directly. Codex configured replay selects `commandWindows` through Windows PowerShell on Windows and the existing `command` through Bash elsewhere; other command-string providers retain their configured shell path. These checks catch stale paths, missing executable bits, and handler-shape failures before an agent session sees them.
- Copilot CLI combines native repository hooks with Claude's inline project hooks. Keep the real policy command only in `.github/hooks/hooks.json`; the managed Claude row's two `exit 0` fields prevent the cross-loaded copy from starting bare Node or duplicating policy. Exact identity includes both fields, and `goat-flow hooks sync` repairs an older or partial managed row without deleting user-owned siblings.
- After inspecting and trusting the checkout, use `goat-flow hooks verify . --agent <id> --scenario <deny-hook|post-turn-hook|gruff-hook|all> --trusted-target` to replay fixed offline inputs through one agent's exact configured command. `all` runs every group in sequence and reports each verdict; `audit` never runs these scenarios. Without the flag, the command returns unsupported evidence and does not start checkout hook code. A passing report proves only that local boundary; it does not prove the external provider fired the hook or showed the result to the model.
- Claude, Codex, and Antigravity support nested cwd inside a complete managed project with or without Git. Git remains first for worktree correctness; Claude and Antigravity may fall back to `$CLAUDE_PROJECT_DIR`, while Codex must find a complete managed ancestor. `gruff-code-quality.sh` fails soft.
- Policy evaluation works from a complete non-Git installation. At a non-Git controller, post-turn safety scans only the project-relative repositories named by `hooks.post-turn-safety.scan-roots`, in configured order. Registration requires every root to exist, remain physically contained, and equal its Git top level. Missing, invalid, or mixed root configuration leaves Stop unregistered; a stale registration retains bounded incomplete recovery. The hook never discovers child repositories automatically.
- Copilot uses direct project-local paths and therefore requires a repo-root working directory for the configured command. Nested-cwd execution is outside the current Copilot contract unless that runtime adds a portable project-root variable or root-resolving command support.
- Directly invoked `.sh` hooks must keep executable bits. Missing `bash` is a hard runtime prerequisite for all shipped guardrails.
- Every namespaced result command installs `hook-provider-adapters.mjs` and `hook-launch-runtime.mjs`. Missing or malformed pieces produce visible unavailable feedback.
- `post-turn-safety.sh` uses an optimized Bash 4+ scanner and a bounded compatibility scanner on stock macOS Bash 3.2. Both enforce the same findings and shared wall-clock limit. Tracked and staged text streams as added hunks regardless of full file size; binary changed paths and whole untracked text above `GOAT_FLOW_POST_TURN_SAFETY_MAX_BYTES` report incomplete and block. Non-Git controller fan-out invokes the same scanner once per validated configured repository, preserves configured order, prefixes finding targets with the root path, and validates each provider-neutral result instead of parsing terminal text. A valid Stop payload can end one exact repeated infrastructure failure loudly, including an unavailable Git root from a complete managed installation, while findings, coverage gaps, budget exhaustion, malformed payloads, and unverified launch roots keep blocking. The default scan budget is 60 seconds and the registered Stop timeout is 90 seconds, so the hook can print its own diagnostic before the runner intervenes. Run `bash .goat-flow/hooks/post-turn-safety.sh --self-test` after install or upgrade.

## Post-Turn Safety

goat-flow configures `post-turn-safety.sh` by default for Claude and Codex, but the current Codex registration has no fresh live-provider delivery evidence. Antigravity remains disabled because Stop execution was not captured past its trust gate, and Copilot remains disabled because `agentStop` delivery and a Goat Flow registration adapter are unverified. The hook scans changed text content for built-in safety hazards. It does not run builds, tests, linters, typecheckers, or formatters, and must not be treated as project validation.

A Git project uses its implicit `.` scan root. A non-Git controller must declare every repository explicitly:

```yaml
hooks:
  post-turn-safety:
    enabled: true
    scan-roots:
      - api
      - web
```

Every listed path must be a contained Git top level. One invalid sibling invalidates the whole list; unlisted and nested repositories are not discovered. Write the list out in full: a YAML anchor or alias in `scan-roots` is refused at registration because the hook's own parser cannot resolve it.

Tracked and staged text is scanned from added hunks, including files above the whole-file cap. Non-ignored untracked text above the cap and binary changed paths return explicit incomplete results. New content cannot authorize its own suppression: inline allow markers on a new finding still block. Move intentional scanner fixtures to split synthetic values, or leave a reviewed committed fixture unchanged.

For a valid Stop payload, the first incomplete command failure blocks and records only owner-local hashes. One exact active replay may end with an incomplete `bounded-reentry-ended` result so the user can regain control; it never becomes a pass or a clean scan. Controller aggregation ends only when every non-pass child reports that exact bounded result. Changed findings, incomplete content coverage, budget exhaustion, and malformed input always block. Run `bash .goat-flow/hooks/post-turn-safety.sh --self-test` to check clean, finding, incomplete, and Bash 3 outcomes; unknown options fail instead of scanning.

goat-flow does not ship a project-validation Stop hook or a plan-reminder Stop hook. Run project-specific build, test, lint, typecheck, format, and milestone accounting through explicit verification gates. The shipped `gruff-code-quality.sh` prefers payload-declared edit or patch targets, uses Git only when a runtime omits paths, and reports incomplete scope instead of clean work when Git fails.

## Codex Permissions

Codex does not read Claude's `settings.json` `permissions.allow` or `permissions.deny` syntax. The equivalent file-access layer is a TOML permission profile selected by `default_permissions` in `.codex/config.toml`; goat-flow's Codex template extends Codex's built-in `:workspace` profile and adds recursive `deny` rules for common secret-bearing project paths. Shell command patterns still belong in `.codex/hooks.json` through the Bash-matched `PreToolUse` `deny-dangerous.sh` dispatcher.

Deny rules take precedence over allow rules on BOTH agents, so a broad `Read(**/.env*)` deny cannot be re-opened for `.env.example` - the shipped Claude allow entries were dead config until this was corrected in 2026-07. Both templates therefore deny the real env variants individually (`**/.env`, `**/.envrc`, `**/.env.local`, `**/.env.development`, `**/.env.production`, `**/.env.staging`, `**/.env.test`, `**/.env.*.local`) for reads AND edits, so `.env.example` matches no deny and stays fully readable and writable - the same policy the Bash deny hook enforces, which allows `.env.example` reads and writes while blocking real `.env*` access in both directions. Nonstandard variants (e.g. `.env.backup`) are covered by the Bash hook's literal-path blocking for shell commands only, not by the file-read deny layer.
