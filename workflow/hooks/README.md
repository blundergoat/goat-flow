# workflow/hooks/

Copyable hook scripts and agent-config templates for the GOAT Flow enforcement layer.

## Hook Scripts

| Script | Event | Required? | Purpose |
|--------|-------|-----------|---------|
| `run-with-bash.mjs` | Managed launcher | Required with registered hooks | Resolves the selected project, enforces the launcher deadline, and preserves direct legacy output or delivers a bounded result |
| `hook-launch-runtime.mjs` | Managed runtime | Required with registered hooks | Runs the child hook, caps output, enforces deadlines, and prepares provider-visible launcher failures |
| `hook-provider-adapters.mjs` | Provider response | Required with migrated result hooks | Validates the versioned result envelope and translates it into the active coding agent's documented response shape |
| `deny-dangerous.sh` | PreToolUse | Default on | Blocks destructive shell commands and direct secret-path access |
| `deny-git-mutations.sh` | PreToolUse | Default on | Blocks Git commits, publication, remote lock changes, destructive Git operations, and GitHub writes; permits GitHub reads and issue/PR comments |
| `deny-dangerous/*.sh` | Shared policy runtime | Required with either policy hook | `guard-runtime.sh` owns parsing and responses; three policy modules and the central `deny-dangerous-self-test.sh` retain the combined corpus |
| `gruff-code-quality.sh` | PostToolUse | Optional | Checks each edited source file with its nearest package config and returns attributable line, symbol, file, and project findings through a bounded provider result |
| `post-turn-safety.sh` | Stop | Default for supported Stop agents | Scans changed text content for built-in safety hazards such as obvious secrets, private keys, credential assignments, and merge conflict markers |

GitHub write checks now belong to **Deny Git and GitHub writes** (saved ID: `deny-git-mutations`). If either the current or requested switch pair has one policy on and the other off, changing an existing installation’s ownership files requires review on the newer dashboard Hooks page. Review the selected project, both sets of choices, affected files and GitHub protection before accepting. Policy consent and replacement of local edits have separate checkboxes; Cancel changes nothing. CLI Sync, install and force options cannot provide policy consent. Once the ownership files match the bundle, ordinary Sync needs no repeated policy review.

## Agent Event Name Mapping

| Purpose | Claude Code | Codex CLI | Antigravity | Copilot CLI |
|---------|-------------|-----------|-------------|-------------|
| Block before tool runs | Separate PreToolUse registrations for both policy hooks | Separate PreToolUse registrations matched to `Bash`; host-specific delivery is recorded below | Separate PreToolUse registrations in `.agents/hooks.json`; Git matches `run_command`, while dangerous also matches secret-bearing file tools | Separate `preToolUse` registrations for both policies in `.github/hooks/hooks.json` |
| Attributable Gruff quality | Registered PostToolUse for `Edit`, `Write`, and `Bash` containing `apply_patch`; host-specific delivery is recorded below | Registered PostToolUse matched to `^apply_patch$`; host-specific delivery is recorded below | Disabled because PostToolUse did not deliver feedback to the active model | Registered `postToolUse`; host-specific delivery is recorded below |
| Universal post-turn safety | Registered Stop with `post-turn-safety.mjs`; host-specific delivery is recorded below | Registered Stop; host-specific delivery is recorded below | Disabled because execution was not captured past the hook trust gate | Disabled because `agentStop` delivery and a Goat Flow registration adapter are unverified |
| Permission deny list | `.claude/settings.json` deny patterns | Filesystem permission profile in `.codex/config.toml`; command denies in the Bash hooks | Script-only guardrails; no provider-native file-read/file-write deny layer is claimed | Script-only guardrails; no provider-native file-read/file-write deny layer is claimed |
| Config format | JSON | TOML + JSON | JSON | JSON |

### Windows and WSL delivery captures

Native `powershell` requests are inspected with PowerShell command context. Literal commands can reach their owning policies; unresolved dynamic execution, interpolation and session-state changes are refused. This is bounded command inspection, not a full PowerShell interpreter.

The native PowerShell policy change requires fresh evidence for all 18 Windows/WSL delivery rows. Sixteen earlier verified captures are historical. C1-C8 and C10-C18 are verified on the current runtime, and C9 remains on security hold. Captures apply only to their recorded provider version, mode, host, trust and runtime bytes and do not activate support gates.

| Provider | Host | Version and mode | PreToolUse | PostToolUse | Stop |
|---|---|---|---|---|---|
| Claude Code | Windows | 2.1.312, interactive/manual | C1 verified | C2 verified | C3 verified |
| Codex CLI | Windows | 0.164.0, exec/JSON | C4 verified | C5 verified | C6 verified |
| Copilot CLI | Windows | 1.0.103, prompt/JSON | C7 verified | C8 verified | No delivery claim |
| Antigravity | Windows | No current complete capture | C9 security hold | No delivery claim | No delivery claim |
| Claude Code | WSL | 2.1.314, interactive/manual | C10 verified | C11 verified | C12 verified |
| Codex CLI | WSL | 0.165.0, exec/JSON | C13 verified | C14 verified | C15 verified |
| Copilot CLI | WSL | 1.0.91, interactive/manual | C16 verified | C17 verified | No delivery claim |
| Antigravity | WSL | 1.4.12, interactive/Request Review | C18 verified | No delivery claim | No delivery claim |

A verified PreToolUse row delivers both independent policy reasons and allows its harmless controls; a verified PostToolUse row delivers Gruff findings to the model; a verified Stop row blocks a conflict marker, allows its repair and completes a clean reentry. C1-C8 meet those criteria on Windows with Node 24.21.0, and C10-C18 on WSL with Node 22.22.1. The C1 and C3 captures ended on their controller timeout after every required record was in the transcript, and the user accepted that variance. A Remote Control bridge was active in the C10-C12 sessions, so their tool approvals are attributed to the operator by timing; the record names no channel. In the C16 and C17 sessions Copilot recorded `remoteSteerable` as false and each approval as a human response. Its hook records name no owner, so C16's policy attribution rests on the pinned code, the rehearsal and exact matches on the reason text. A `gpt-4o-mini` side call also received each prompt, and the package file beside the pinned executable reads 1.0.2 while the client reports 1.0.91. The C18 session ran a private read-only copy of the installed binary, whose hash equals the install's, because the client's updater replaced the binary during an earlier readiness check. Its record names no approval channel, so its tool approvals are attributed to the operator by timing, and its log reports remote control off. Its hook decisions name no owner, allowed calls record one more decision than there are handlers, and the final response quotes the GitHub reason without its `Policy repository:` label, which is in the error text. Its model identity is limited to the native display and a consistent opaque enum. In the Codex sessions the `codex exec --json` stream carried no hook event, so C4-C6 and C13-C15 delivery was read from Codex's own session record, with the C4 and C13 denials also in its native stderr. Codex recorded no Stop re-run for C6 or C15, so their clean reentry is inferred from the completed turn and matching final files. Raw hook stdin and forced-timeout behavior are not claimed by any capture, and the historical WSL captures used Node 22.22.1.

In the historical captures, the earlier C1 changed from Opus 5.5 to Opus 4.8 after its initial controls. The earlier C16 included an accepted Sonnet 5.5 to Sonnet 5 fallback, conflicting native model labels and two batched file views.

C9 remains under a Windows security hold after launcher quarantine.

The committed current-state [capture records](../../src/cli/hook-provider-captures.ts) keep incomplete rows separate from live support. Historical capture metadata, digests and the 41 runtime-file hashes remain preserved in the local evidence history. C1-C8 and C10-C18 supply those fields again; each later recapture must do the same. The registry attaches those observations to the relevant provider/event without changing its existing support gate. Audit does not yet compare the installed provider version, host or runtime hashes with these records; applicability still requires review.

### Linux/macOS compatibility and live delivery

The native CI matrix checks consumer Node 20.12.0 and 24.21.0 against artifacts built with Node 24.21.0. Its coverage includes Claude and Codex PreToolUse, PostToolUse and Stop; Copilot CLI PreToolUse and PostToolUse; and Antigravity PreToolUse. Both independent deny policies are covered for PreToolUse. Native launcher, configured-command replay, evaluator and response-adapter checks establish compatibility at those boundaries.

Live delivery through the current native hooks remains unverified on Linux and macOS. CI does not prove that an authenticated provider fired a hook, showed its result to the model or continued after Stop. The historical Linux captures below describe their tested registrations and runtime bytes; they do not renew delivery evidence for the native runtime. Compatibility checks do not activate provider support gates.

The previous Codex CLI 0.147.0 PostToolUse and Stop claim was invalidated when the registration gained a Windows-only command override. An initial disposable Codex CLI 0.149.0 exec capture on 2026-08-22 did not load the project hooks: the requested fake `.env` canary read completed, so that run is invalid evidence. A subsequent exec capture in this already-trusted project loaded the exact changed registration and delivered a PreToolUse block for the same fake canary before shell execution. The reviewed 0.155.1 capture below supersedes that PreToolUse capture.

On 2026-08-27, an approved disposable Codex CLI 0.149.1 `exec --dangerously-bypass-hook-trust` capture first proved PostToolUse delivery for the generated fixture only. A second 0.149.1 `exec --ephemeral --json --approve-for-me` capture then ran from this trusted project without the bypass flag. It loaded the hash-trusted project handler, completed `apply_patch`, exited 0 with empty stderr, ran Gruff's capability and analysis exchanges, and delivered an analyzer-only marker to the model. The Codex Gruff gate is therefore `scenario-unverified`; its fixed local scenario must pass before the hook is effective. Exact configured-command replay on Windows is tracked separately and does not upgrade provider delivery by itself.

An approved Codex CLI 0.152.0 capture on 2026-09-03 attempted PreToolUse, PostToolUse, and Stop in one trusted-project `exec --ephemeral --json --approve-for-me` session with user config ignored. The process exited 0, but the fixture directly invoked the deny classifier, so its exit-2 policy message could not be attributed to provider-side PreToolUse delivery. The model reported `{}` for PostToolUse, while the JSONL exposed no hook event, payload, response, timeout, or result-delivery record. Stop produced no continuation, and the conflict-marker fixture remained unchanged. The receipt also omitted the model identifier and handler-review decision. This capture is inconclusive and establishes no event delivery. The release owner should retry only when Codex exposes attributable hook-event receipts for non-interactive `exec`, or another supported mode can prove handler trust, payload and result delivery, model visibility, and Stop continuation. A future fixture must not use direct classifier output as its PreToolUse signal.

On 2026-09-18, an approved interactive Linux Codex CLI 0.154.0 capture with reviewed project configuration superseded that stale Stop state. The registered Stop hook delivered conflict feedback, the model repaired the fixture during one automatic continuation, a clean Stop completed, and the session exited zero. This capture sets the registry gate to `scenario-unverified`; the fixed local scenario must still pass before the effective state becomes green. It proves only this provider version, interactive mode, platform, configuration, and ordinary completion path.

On 2026-09-21, interactive Linux Codex CLI 0.155.1 with gpt-6-astra (low reasoning) delivered separate registered PreToolUse denials from both deny hooks. Native project and handler review trusted the fixture; an output-preserving recorder retained field names and hook results, with six local controls confirming unchanged output and exits. A nonexistent secret-shaped path and cleanup of an empty Git fixture were blocked before their marker writes; harmless commands succeeded before and after, and the model reported both denial reasons. The session exited zero. Both registry rows retain `scenario-unverified` until their local groups pass. This capture covers the reviewed 1.17.0 runtime and ordinary completion in this Linux interactive mode; it renews neither Gruff nor Stop and does not test forced timeouts.

Documentation and captures have no calendar expiry. Revalidate each capture when the provider version or mode, project-layer trust, event, adapter, or registration changes. Project-layer trust decides whether Codex loads project hooks; handler trust separately decides whether a loaded command may run. Passing either gate does not pass the other. Codex app-server, remote execution, and combinations absent from the host-specific matrix have no fresh live-delivery claim in this release.

To revalidate a Codex provider row after a relevant change, repeat the exact event in a supported mode and record the provider version, configuration source, project and handler trust, payload shape, result delivery, model visibility, timeout, and continuation outcome. Update the registry gate, hook table, CLI guide, changelog, and relevant provider contract in one reviewed change; `hooks verify` supplies the separate fixed local scenario and cannot establish live delivery by itself.

The registry's `providerEvidence` rows retain host-specific capture metadata alongside identity and gate. Audit still does not detect provider-version drift automatically; compare the installed provider version, mode, host and runtime bytes with the applicable capture before using it as evidence.

## Setup

1. Preview the selected target with `goat-flow install <project-path> --agent <id> --dry-run` and inspect the listed changes.
2. Apply with `goat-flow install <project-path> --agent <id>`. The installer preserves explicit hook choices and unrelated provider settings. For an enabled legacy policy, it registers the Git guard in existing provider configs before narrowing the dangerous hook. Use `goat-flow hooks sync <project-path>` to repair an existing hook installation.
3. `gruff-code-quality.sh` is opt-in through `.goat-flow/config.yaml`, the dashboard Hooks page, or `goat-flow hooks enable gruff-code-quality`.

For a fresh Codex project, run `npx @blundergoat/goat-flow@latest install . --agent codex`. After a Goat Flow release containing the Codex Windows override is published, repair any affected Codex installation whose managed `.codex/hooks.json` lacks `commandWindows` (including 1.16.0) by running `npx @blundergoat/goat-flow@latest hooks sync .` from a normal terminal or unaffected shell, then start a fresh Codex session. Before publication, the checkout-local equivalent is `node --import tsx src/cli/cli.ts hooks sync <project-path>`.

Root-resolving commands prefer Git so linked worktrees and submodules select the correct checkout, then walk upward for a complete project-local Goat Flow installation. A candidate needs relevant registration plus a contained regular, non-symlinked, single-link launcher and requested script. Claude and Antigravity can also use `CLAUDE_PROJECT_DIR`; Codex has no host-root fallback, but a complete managed ancestor works without Git. A partial candidate or no usable root fails closed. Missing Gruff remains a visible non-blocking skip.

Registration shapes differ by provider (ADR-053). Claude registers an exec-form handler - `command: "node"` plus an ordered `args` tuple - so no host shell retokenizes the bootstrap or its operands. Each managed Claude row also carries `bash: "exit 0"` and `powershell: "exit 0"`. Claude ignores those routes and executes its argv tuple; a Copilot process that combines `.claude/settings.json` with repository hooks selects the inert route instead. The native `.github/hooks/hooks.json` row remains the sole Goat Flow policy registration for Copilot, and a missing native row is not covered by the Claude no-op. Codex retains that provider's existing `command` string for non-Windows hosts and adds the documented Windows-only `commandWindows` override. The override transports the generated bootstrap as Base64, starts `node.exe`, restores the operating-system cwd inside Windows PowerShell, and explicitly propagates the native exit status. Copilot keeps its Bash command and uses a separate powershell field on Windows, with the same Base64 transport and native status propagation. Antigravity registers node ../.goat-flow/hooks/antigravity-hook-bootstrap.cjs followed by its operands. It starts from .agents through cmd /c on Windows or sh -c elsewhere; the managed file preserves the existing root-discovery and failure-response code. The managed-contract generator checks the bootstrap and both runtime copies together. Windows Antigravity 1.4.7 live delivery approved this file-based transport; deny-dangerous now covers read_file and its Path field. Live delivery still requires evidence for the installed runtime. The standalone installer consumes the generated `agent-config/managed-hook-desired-state.json`, produced from the same TypeScript writer that setup and sync use. Each Claude policy row also carries `onFailure: "block"`, so Claude Code 2.1.295 or later refuses the tool call itself when the handler cannot start, reaches the 30-second host timeout, or exits with a status other than 0 or 2; the Gruff row omits the field because unavailable feedback is a visible skip, and the Stop row omits it because Claude Code documents the field as having no effect on Stop. Once the handler's Node process starts, missing, corrupt, or API-invalid managed files return the provider's blocking or unavailable response; for Claude Code before 2.1.295 and for every other provider, a host that cannot start Node, or that rejects the handler before launch, is a prerequisite failure the hooks cannot convert into a deny.

Both policies default on for fresh installs. An upgrade preserves an explicit deny-git-mutations.enabled choice; otherwise migration records the previous dangerous-hook choice before either toggle changes it. A runtime read with no Git choice defaults on.

Claude's two policy registrations match `Bash|PowerShell`. An enabled policy blocks the native `PowerShell` tool with a message directing the agent
to Bash because the shared parser does not support the full PowerShell language. Refresh existing registrations with `goat-flow hooks sync .`, review
any local modifications before replacing them, and start a fresh Claude session. Literal `cmd /c`, Git Bash's `cmd //c`, `powershell -Command`,
`pwsh -Command`, `wsl -e` and plain `wsl` commands submitted through Bash receive nested policy checks, including when `xargs` launches the host;
this is not a claim of general PowerShell parsing.
Native executable paths accept both slash styles. PowerShell command and profile abbreviations and its implicit command form receive the same checks.
Each body is split with its host's own escapes and quotes. cmd's `@`, `call`, `start` and `for` (including a `for /f` command set), and PowerShell's
dot operator and positional `Start-Process`, expose the command they launch. Unquoted Windows paths and module-qualified cmdlet names keep their verb.
Encoded or stdin-fed code, `Invoke-Expression`, named `Start-Process` parameters and unrecognized cmd, PowerShell or WSL options receive a recovery
denial, including WSL administration such as `wsl --shutdown`; use literal commands with supported options.
Ordinary `-File <path>` calls retain their existing policy.
Printing a command remains distinct from executing it, including the Gruff M50 quoted-pipeline controls in the central self-test.

On Windows, local verification preserves registered Bash source outside the argv conversion boundary for legacy Bash handlers.
Antigravity replay uses its provider launch from `.agents`: `cmd /c` on Windows and `sh -c` elsewhere. Local replay verifies that launch and the hook response; live provider delivery requires a separate capture.

Disabling either policy retains its owned registration so a cached bootstrap can still reach the launcher. The launcher checks script shape and physical-root containment, then reads .goat-flow/config.yaml with the shipped locked YAML parser. Only an unambiguous boolean false skips that policy, before Bash discovery or policy execution. Missing settings default on; malformed YAML, conflicting legacy choices, unsafe config paths and missing launch dependencies remain unavailable. Explicit off does not create scan-verification evidence.

If installed launch dependencies differ from the current bundle, disable refuses before saving. Sync on the Hooks page refreshes pristine launch dependencies and requests review before replacing diverged files. Once those dependencies are current, disabled policy-only files remain inert and preserved. Shared repairs refresh every affected hook row and invalidate retained proof. A saved choice does not establish provider reload or recovery of an existing live session. Disabling Git enforcement never grants an agent permission to commit or push (ADR-025).

The complete v1.16.0 Codex upgrade and exact saved general-handler replay are fixture-verified on a non-Windows host.
The separate Git handler is captured after upgrade; these fixtures prove independent choices and repeated Sync, not provider hot reload.
If mixed-policy review and legacy-state admission block each other, stop and upgrade every writer, then run
`goat-flow install <project-path> --agent <id> --migrate-state-only` before requesting a fresh dashboard review.
This moves bookkeeping without changing hooks or choices; outstanding claims and unsafe state still require repair.
Complete ordinary install and any separate named file-replacement review afterward.
Follow the [CLI recovery steps](../../docs/cli.md#recovering-an-older-policy-installation); existing-session recovery and native Windows remain unverified here.

## Direct and Registered Results

Direct `.sh` use keeps each hook's existing stdout, stderr, exit status, `--check`, and self-test interface. Registered Gruff commands for Claude, Codex, and Copilot, plus the Codex Stop command, use the namespaced provider-result contract. Deny commands and other registered Stop commands retain their legacy result mode. A namespaced command records the provider, response kind, result protocol, lifecycle event, adapter version, and launcher deadline.

Self-test arguments are exact. Both policy hooks accept `--self-test`, `--self-test=smoke`, and `--self-test=full`; Gruff accepts `--self-test` and `--self-test=smoke`; post-turn safety accepts only `--self-test`. Unsupported values and extra self-test arguments exit non-zero instead of starting normal hook execution.

The `goat-flow.hook-result.v1` path accepts one JSON object within a 65,536-byte envelope and keeps diagnostic retention separate.
It caps displayed findings at 20, tracks omitted findings and requires complete declared coverage before `pass`.
Malformed, empty, timed-out or mismatched results become explicit unavailable outcomes; partial coverage cannot pass.
Provider adapters preserve blocking decisions within a 10,000-byte serialized reply. Unsupported host/event pairs stay unsupported.

## Failure Modes / Runtime Contracts

- When enabled, both policy entrypoints require the complete, tracked `.goat-flow/hooks/deny-dangerous/` runtime. A missing helper or module, or a pre-split module API, denies as unavailable. Bootstrap and launcher failures name the affected entrypoint, including failures before its parser starts.
- Both policy hooks use one shared defense-in-depth classifier, not a shell interpreter or sandbox. It normalizes supported `xargs`, `find -exec`, `watch`, shell-c, and common GNU Parallel forms before applying the existing destructive, secret-path, and repository-write rules. Unknown wrapper grammar and variable-computed executable names remain outside its guarantees; agent permissions, filesystem isolation, and operating-system credentials remain the hard boundary.
- Known read-only download filters, local data passed to an explicit script file, literal `vendor` or `target` cleanup, and approved issue or pull-request comments remain allowed. Run an unclear command manually after inspection.
- Audit runs the exact configured handlers from `.claude/settings.json`, `.codex/hooks.json`, `.agents/hooks.json`, and `.github/hooks/hooks.json` only with `--trusted-target`; preflight exercises this repository's configured handlers. Claude's exec-form argv runs directly. Codex selects `commandWindows` on Windows; Copilot selects `powershell` on Windows and `bash` elsewhere. Antigravity runs from `.agents`, through `cmd /c` on Windows and `sh -c` elsewhere. These checks catch stale paths, missing executable bits, and handler-shape failures before an agent session sees them.
- Copilot CLI combines native repository hooks with Claude's inline project hooks. Keep the real policy command only in `.github/hooks/hooks.json`; the managed Claude row's two `exit 0` fields prevent the cross-loaded copy from starting bare Node or duplicating policy. Exact identity includes both fields and the policy rows' `onFailure: "block"`, and `goat-flow hooks sync` repairs an older or partial managed row without deleting user-owned siblings.
- After inspecting and trusting the checkout, use `goat-flow hooks verify . --agent <id> --scenario <deny-hook|git-mutations-hook|post-turn-hook|gruff-hook|all> --trusted-target` to replay fixed offline inputs through one agent's exact configured command. `deny-hook` covers shell secrets and pipe-to-shell; `git-mutations-hook` covers native Git and GitHub writes. `all` runs every group in sequence and reports each verdict; `audit` never runs these scenarios. Without the flag, the command returns unsupported evidence and does not start checkout hook code. A passing report proves only that local boundary; it does not prove the external provider fired the hook or showed the result to the model.
- Claude and Codex support nested cwd inside a complete managed project with or without Git. Antigravity starts its project hooks from `.agents`. Git remains first for worktree correctness; Claude and Antigravity may fall back to `$CLAUDE_PROJECT_DIR`, while Codex must find a complete managed ancestor. `gruff-code-quality.sh` fails soft.
- Policy evaluation works from a complete non-Git installation. At a non-Git controller, post-turn safety scans only the project-relative repositories named by `hooks.post-turn-safety.scan-roots`, in configured order. Registration requires every root to exist, remain physically contained, and equal its Git top level. Missing, invalid, or mixed root configuration leaves Stop unregistered; a stale registration retains bounded incomplete recovery. The hook never discovers child repositories automatically.
- Copilot uses direct project-local paths and therefore requires a repo-root working directory for the configured command. Nested-cwd execution is outside the current Copilot contract unless that runtime adds a portable project-root variable or root-resolving command support.
- Directly invoked `.sh` hooks must keep executable bits. Bash is required to execute an enabled shell hook; a valid explicit-off policy decision completes before Bash discovery.
- Every namespaced result command installs `hook-provider-adapters.mjs` and `hook-launch-runtime.mjs`. Missing or malformed pieces produce visible unavailable feedback.
- `post-turn-safety.sh` uses a Bash 4+ scanner and a compatibility scanner on stock macOS Bash 3.2, with the same findings and wall-clock limit.
  Tracked and staged text streams as added hunks; binary changes and oversized untracked text leave coverage incomplete and block.
  Non-Git controllers scan each declared repository in order, prefix finding targets with its root and validate structured results.
  Infrastructure recovery depends on the registered mode; see [Post-Turn Safety](#post-turn-safety) for retry and warning rules.
  Findings, declared coverage gaps and malformed payloads remain blocking. The default scan budget is 60 seconds.
  The registered Stop timeout is 90 seconds, with a 75-second launcher ceiling. Run `bash .goat-flow/hooks/post-turn-safety.sh --self-test` after refresh.

## Post-Turn Safety

goat-flow configures `post-turn-safety.sh` by default for Claude and Codex. The Linux CLI 0.154.0 capture above describes its historical runtime bytes.
Shared launcher changes require fresh delivery evidence; that capture does not prove the current recovery behavior.
Antigravity remains disabled because Stop execution was not captured past its trust gate.
Copilot remains disabled because `agentStop` delivery and a Goat Flow registration adapter are unverified.

The hook scans changed text for built-in safety hazards. It does not run builds, tests, linters, typecheckers or formatters.
Use project validation separately from the hook's content scan.

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

The managed Codex Stop mode validates bounded input once and forwards its original bytes to the scanner. It keys one infrastructure retry by provider, selected project, session and explicit turn, with separate hashes for the failure. A new explicit turn receives a new allowance even when its prompt text is unchanged. Changed faults, clean rescans and duplicate deliveries cannot renew a spent allowance.

After that retry, infrastructure ends with a visible warning and incomplete `bounded-reentry-ended` coverage. Unsafe or inaccessible state warns as unavailable without claiming exhaustion. The warning has no `continue: false` override, so another matching hook can still block. Every fresh delivery rescans content; known hazards, declared coverage gaps and malformed context remain blocking. Other modes retain their previous scanner-owned exact-repeat contract.

Managed capture allows 65,536 stdout bytes, retains 4,096 stderr bytes while draining excess, and stops a stderr flood above 1,048,576 bytes. Only a normally completed, zero-status child with one valid UTF-8 envelope can supply a result. Final serialized provider replies, including JSON escaping and newline, stay within 10,000 bytes by condensing structured details while preserving the decision, coverage and separate omission counts. Legacy policy capture keeps its existing shared limit.

Refresh all shared runtime files with `goat-flow hooks sync .`, review any replacement requests and start a fresh agent session. Earlier captures become stale when these bytes change; lifecycle discovery alone does not prove final delivery, model visibility or native Windows behavior. Run `bash .goat-flow/hooks/post-turn-safety.sh --self-test` after refresh.

goat-flow does not ship a project-validation Stop hook or a plan-reminder Stop hook. Run project-specific build, test, lint, typecheck, format, and milestone accounting through explicit verification gates. The shipped `gruff-code-quality.sh` prefers payload-declared edit or patch targets, uses Git only when a runtime omits paths, and reports incomplete scope instead of clean work when Git fails.

Launcher recovery records contain hashes and fixed metadata in the selected project's ignored scratchpad. The verified owner must be a regular,
single-link file with mode `0600`, beneath owned directories without symlinks or shared write access. Unreadable, corrupt or substituted records are
left intact, and owned records older than seven days are removed when a new allowance is recorded. Native Windows has no POSIX owner or mode bits,
so its records keep the shape, link and content checks and rely on workspace ACLs, the limitation other modes already accept. Any other host
without an OS ownership check warns as unavailable.

## Codex Permissions

Codex does not read Claude's `settings.json` `permissions.allow` or `permissions.deny` syntax. The equivalent file-access layer is a TOML permission profile selected by `default_permissions` in `.codex/config.toml`; goat-flow's Codex template extends Codex's built-in `:workspace` profile and adds recursive `deny` rules for common secret-bearing project paths. Shell command patterns still belong in `.codex/hooks.json` through both Bash-matched `PreToolUse` policy hooks.

Deny rules take precedence over allow rules on BOTH agents, so a broad `Read(**/.env*)` deny cannot be re-opened for `.env.example` - the shipped Claude allow entries were dead config until this was corrected in 2026-07. Both templates therefore deny the real env variants individually (`**/.env`, `**/.envrc`, `**/.env.local`, `**/.env.development`, `**/.env.production`, `**/.env.staging`, `**/.env.test`, `**/.env.*.local`) for reads AND edits, so `.env.example` matches no deny and stays fully readable and writable - the same policy the Bash deny hook enforces, which allows `.env.example` reads and writes while blocking real `.env*` access in both directions. Nonstandard variants (e.g. `.env.backup`) are covered by the Bash hook's literal-path blocking for shell commands only, not by the file-read deny layer.

## Deny Rule Policy and Upgrades

Shipped deny rules match secret content shapes and credential stores, with an explicit exception for the exact `credentials.json` filename. The Claude template denies it through `Read(**/credentials.json)` and `Edit(**/credentials.json)` within the working directory and its descendants, leaving `credentials.ts`, ordinary `credentials/` folders and `credentials.json.example` usable. The `.env` variants and the `pem`, `key`, and `pfx` extensions are denied anywhere in the project. Credential stores (`.ssh`, `.aws`, `.gnupg`, `.config/gcloud`, `.docker`, `.kube`, `.npmrc`, `.pypirc`, `.netrc`, `.git-credentials`, `.config/gh/hosts.yml`, `.pgpass`) are denied at both `~/` and `**/` in the Claude template, protecting home stores and project copies; Codex workspace-root grammar cannot express home paths, so its template keeps the workspace-relative forms and the Bash hook covers shell access for every agent. The earlier `**/secrets/**` and `**/credentials*` rules were retired in 1.17.0 because they blocked ordinary application code such as a secrets route or a `credentials.ts` auth provider, and no allow rule can reopen a deny. The settings-layer Bash denies are limited to the ADR-025 commit and push rules; `sudo`, `mkfs`, and `dd` belong to `deny-dangerous.sh`, while `git reset --hard` belongs to `deny-git-mutations.sh`. Their shared parser distinguishes commands from read-only text that merely quotes them.

`goat-flow install` migrates denies in both Claude settings files while preserving allow and ask arrays verbatim. It removes `MultiEdit` denies, normalizes `Write`/`NotebookEdit` to `Edit` and `Glob` to `Read`, then applies retirement, environment expansion and home/project credential pairing to those normalized rules. One install reaches the stable result. The Codex migration refreshes legacy or incomplete active profiles while preserving project-added denies.

Both providers print each actual permission removal and addition; rewrites show the removed and added forms. Codex also names access-mode, root-anchor and inheritance changes. Existing rules are not reported as additions. Missing Claude rules outside these narrow migrations require reviewed setup reconciliation. Inert allow/ask spellings remain for the project owner to review because activating them changes their meaning.

Current-project setup names missing required Claude home Read denies for `.netrc`, `.git-credentials`, `.config/gh/hosts.yml` and `.pgpass`, then reaches reviewed settings reconciliation. Compare the shipped template, show the diff and obtain approval before adding missing denies; preserve allow/ask and unrelated rules. Existing Claude settings that lack the exact `credentials.json` pair also need review. When a broad `credentials*` deny is retired and the exact pair is incomplete, install names both reviewed replacements without adding them.
