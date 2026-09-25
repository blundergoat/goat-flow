---
category: deny-shell
last_reviewed: 2026-09-25
---

Command-grammar and parser traps in the deny hook: how a command string is split into segments, stages, substitutions, and heredoc bodies before any policy runs. A miss here silently un-guards every policy layered on top.

Sibling buckets: `deny-secrets.md`, `deny-writes.md`.

## Footgun: Command-segment splitter must track substitution depth, not just quotes

**Status:** active | **Created:** 2026-06-06 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 4 | **Latest occurrence:** 2026-09-24

**Prevention:**
1. A tokenizer splitting shell control operators respects `$(`/`<(`/`>(` boundaries; quotes alone are insufficient, and plain `(...)` subshells stay splittable so `(cmd && rm -rf /)` cannot hide.
2. "Write to X" detection checks the redirect target; `2>&1` and `2>/dev/null` are not writes.
3. When a finding blames a downstream catch-all, trace its input token to the tokenizer before relaxing it, and hold chain-count caps at every recursion depth.
4. Parser refactors grep learning-loop anchors before renaming comments, even when runtime behaviour is unchanged.
5. Splitting a plain subshell leaves its `(` on the first command and its `)` on the last word, so strip both before any policy reads the segment (search: `strip_subshell_parentheses`). Redirections can follow the closer; remove unmatched closers wherever they occur, preserving quoted and escaped parentheses. Otherwise `push)` and `.env)` miss every exact-word rule.

**Symptoms:** Benign reads denied as `Policy destructive: Complex command substitution` when an unquoted `$(...)` holds a control operator (`echo $(date; whoami)`, `$(grep x f || echo MISS)`) or arithmetic `$((1 + 2))`. Quoting it or dropping the operator passed, so it looked intermittent.

**Why it happens:** `split_command_segments_into` split on `&&`, `||`, `;`, and newlines while tracking quotes but not parenthesis depth, so an operator inside `$( ... )` split it across segments and left an orphan `$(` for the residual catch-all in `check_command_substitutions`. The catch-all was correct; the orphan was manufactured upstream, so the "catch-all too broad" lead was a symptom. Arithmetic was unrecognised by the `$( )`-only scanner.

**Evidence:** `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `Command/process substitution openers`) tracks `subst_depth` and enforces the cap at (search: `chain-count cap at nested depths`); `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` covers (search: `arithmetic expansion`), (search: `unquoted subst with || fallback`), and (search: `rm behind || inside subst`). Two sibling findings from the same 2026-06-06 release gate: path-prefixed `.env.example` redirect targets such as `> ./.env.example` and `> $HOME/proj/.env.example` exited 0 while the bare form blocked, fixed in the then-current `is_env_example_redirect_write` (removed 2026-07-18 with the whole `.env.example` read-only restriction, so those writes are now allowed); and a nesting-depth cap on `$( )` was added and then reverted after three release-gate agents found false positives on `echo $(dirname $(dirname $(dirname $(pwd))))` for zero security benefit, because dangerous content at any depth already blocks at its own segment. Revert guards: `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `count_substitution_openers`), `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `deep benign path nesting allowed`) and (search: `deeply nested arithmetic allowed`). **Recurrence 2026-07-12:** M31 rewrote the operator comment and removed the `Command/process substitution openers` anchor; runtime and tests passed, and `stats --check` failed `stale-ref` until the phrase was restored. **Recurrence 2026-09-23:** an adversarial review found `(git push)`, `(cd /tmp && git push)`, `(git reset --hard)` and `(cat .env)` exiting 0 on both hooks while the spaced `( git push )` blocked; `deny-dangerous-self-test.sh` now covers (search: `unspaced subshell publication`) and (search: `subshell secret read with a closer on the last command`).

**Recurrence 2026-09-24:** `(git push) >/dev/null`, `(git restore .) >/dev/null` and `(cat .env) >/dev/null` exited 0 because the closing-parenthesis scan ran only when `)` ended the segment. `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `has_unmatched_closing_parenthesis`) now returns the closer's position so normalization can remove it before redirections. `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` covers (search: `redirected subshell publication`), (search: `redirected subshell secret read`) and their harmless controls.

---

## Footgun: Nested hook checks must reuse the command segment splitter

**Status:** active | **Created:** 2026-04-27 | **Evidence:** ACTUAL_MEASURED

**Prevention:** Recursive hook paths call `check_command_segments`, not `check_segment`, unless the caller already split control operators. Every nested execution feature (`bash -c`, `$()`, `<()`) has at least one chained-danger self-test, and hook edits that touch read-only whitelisting or recursion run the self-test before syncing copies so failures point at the canonical template.

**Symptoms:** The hook blocked top-level `true; rm -rf /` while allowing `bash -c "true; rm -rf /"` and `echo "$(true; rm -rf /)"`.

**Why it happens:** Top-level input is split before each segment is checked, but a recursive path that calls the raw segment checker sees the nested string as one segment. If it starts with a read-only verb such as `echo`, the whitelist returns before the destructive segment is inspected.

**Evidence:** Pre-fix `--self-test=full` returned `FAIL [bash -c semicolon dangerous]: expected 2, got 0`, `FAIL [bash -c and-chain dangerous]: expected 2, got 0`, and `FAIL [bash -c semicolon git push]: expected 2, got 0`. `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `check_command_segments`) recurses through the splitter; `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `rm_has_recursive`) owns recursive deletion and shell-execution policy; `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `bash -c chained rm`), (search: `rm behind ; inside subst`), and (search: `rm -rf`) lock the blocks.

---

## Footgun: Heredoc masking can hide executable shell lines

**Status:** active | **Created:** 2026-05-25 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 7 | **Latest occurrence:** 2026-06-07

**Prevention:**
1. Decide "is the body inert?" with an allowlist of safe consumers, never a blocklist of shells. Mask a quoted heredoc body only when every command in the continuation-joined opener pipeline, including every `<(...)`/`>(...)` interior, is a known non-shell consumer (cat, grep, sed, awk, jq, python, php, node, psql, and similar). Shells, `xargs`/`parallel`, `source`/`.`, `read`/`mapfile`, control keywords, `ssh`, and unknown commands leave the body inspectable. A masking false positive is recoverable ("run manually"); a masking miss is a silent bypass.
2. Ask "what executes this body?", not "what is the first word?". A stdin dispatcher running a shell, or a shell anywhere downstream of a pipe or process substitution, makes the body shell. Never let the chain-count cap be the only thing blocking a hidden body.
3. Every masking edit tests both sides: inert report data is allowed, shell-fed bodies stay inspectable, and commands after `<<-` tab-indented delimiters are scanned. Self-test helpers exercise the same path as runtime, including the 50-segment cap.
4. Keep workflow, `scripts/`, and installed hook mirrors byte-identical after heredoc edits.

**Symptoms:** Masking quoted heredoc bodies fixes false positives on inert JSON and prose but bypasses policy whenever the masker's idea of "inert" is wrong. A `<<-` terminator not recognised left a later `rm -rf /` masked; a 60-line inert `python - <<'PY'` body counted as 60 segments and tripped `Command has more than 50 chained segments`; and `xargs -I{} bash -c '{}' <<'X'`, `while read l; do bash -c "$l"; done <<'X'`, `source /dev/stdin <<'X'`, a `cat <<'X' \` line continued into `| bash`, `b"ash"`, `read x <<'X' ... X; bash -c "$x"`, and `cat > >(bash) <<'X'` each masked a body holding `rm -rf /` at some point.

**Why it happens:** The guardrail parser is a policy parser, not Bash. It preserves the opener, ignores safe quoted bodies for chain counting, and resumes after the real delimiter, but it cannot decide statically whether a body written to a file is later executed, so opener analysis is the only lever, and every "is it a shell?" blocklist proved incomplete.

**Evidence:** `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `SAFE BY DEFAULT`) is `heredoc_body_is_inert`, the allowlist masker that replaced the blocklist on 2026-06-06. `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `Join bash line-continuations`), (search: `Collapse the whole inert body`), (search: `Process substitutions route the body`) joins split openers, emits one placeholder per inert body, and inspects process-substitution interiors before masking. `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `cannot fork-DoS the masker`), (search: `count_substitution_openers "$scan"`), (search: `policy-parser DoS`) caps pipeline segments at 64, counts substitution openers fork-free, and blocks above 32 openers before the recursive walk; `cat <(:) <(:) ...` with 300 substitutions had taken about 10s to SIGTERM. `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `Heredoc body must not inflate`), (search: `Stdin dispatchers`), (search: `Allowlist masker`), (search: `many heredoc process substitutions block fast`), (search: `parser-DoS cap`) covers these limits. Accepted scope limit, user decision 2026-06-06 per ADR-052: an allowlisted interpreter or client still runs the body as its own language, including shell escapes (`os.system`, `sed e`, awk `system()`, `psql` `\!`). deny-dangerous guards shell, not interpreter languages, and the self-test marks these `expect_allow` at `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `ACCEPTED scope`) so a future reviewer does not "fix" them and regress long SQL or sed scripts.

**Incident ledger (2026-05-25 to 2026-06-07):** the `<<-` terminator miss (05-25); an inert body inflating the chain cap (06-06); `xargs`/`parallel` dispatchers masked because only a direct shell first word or `| shell` counted as executing (06-06); a widened blocklist adding `source`, `.`, and command-position shells that review still bypassed with line continuations, quote reconstruction, `command`/`exec` wrappers, and `read`/`mapfile` handoff (06-06); the allowlist flip (06-06); process-substitution routing plus cap tuning, pipeline 32 to 64 and substitution 64 to 32 so worst-case allowed time bounds near 2.4s (06-06); and the process-substitution fork-DoS bound (06-07).

---

## Footgun: Dispatcher checks must inspect pipeline segments, not only the whole command

**Status:** active | **Created:** 2026-06-09 | **Evidence:** ACTUAL_MEASURED

**Prevention:** For every dispatcher or parser helper (`xargs`, `parallel`, `gh`, shell consumers), test direct, piped, option-bearing, and harmless literal forms. When the first command produces input for a later one, split the pipeline and run the dispatcher classifier on each executable segment, and keep a literal allow control such as `xargs echo rm -rf` so the fix never becomes a "text contains rm -rf" block.

**Symptoms:** Direct `xargs rm -rf < list.txt` blocked while `printf '%s\n' /tmp/build-old | xargs rm -rf` and `find . -type f | xargs -r rm -rf` returned exit 0.

**Why it happens:** `patterns-shell.sh` had an `xargs` payload parser, but `check_destructive_segment` applied it only to `CMD_NORMALIZED` for the whole segment, and pipeline scanning checked shell and interpreter consumers, not destructive dispatcher payloads.

**Evidence:** `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `check_pipeline_xargs_destructive_payloads`) scans every pipeline segment; `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `piped xargs recursive rm`) locks both block shapes and the allow control.

---

## Footgun: Shell substitution scanners must be quote-aware inside the substitution body

**Status:** active | **Created:** 2026-06-07 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 2 | **Latest occurrence:** 2026-08-18

**Prevention:**
1. Never parse substitutions with `[^()]` regexes. The matcher that finds the closing `)` tracks quotes, escapes, and nested parentheses inside the body, and single-quoted `$(` text is data that does not count toward DoS caps.
2. Never re-derive quote state a parser already computed. If a check needs an unquoted projection, build it in the same pass that tracks quotes, keep double-quoted content because backticks and `$(` execute inside double quotes, and expect a second stripper to disagree on newlines and the `'\''` idiom.
3. Every substitution-parser change carries bypass canaries (`git push` behind a quoted `)`) and false-positive canaries (single-quoted `$(` repeated past the DoS cap), with command and process substitution tests paired.

**Symptoms:** PR #48 review canaries showed `echo $(echo ")"; git push origin main)` and `cat <(echo ")"; git push origin main)` allowed because the scanner treated the quoted `)` as the close. **Recurrence 2026-08-18:** four false positives on backtick or `$(` text inside a single-quoted span crossing a newline or following `'\''`, with zero bypasses.

**Why it happens:** Substitutions have nested grammar, so a tokenizer that tracks quotes before entering `$(` is not enough. After the matching-paren scan was fixed, `check_command_substitutions` still re-derived quoting twice with a line-oriented `sed -E "s/'[^']*'//g"`, which cannot match a quoted span containing a newline and reads `'\''` as an empty span.

**Evidence:** `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `find_matching_shell_paren`) is the quote-aware scan used by `check_command_substitutions`, and the same file (search: `count_substitution_openers`) skips single-quoted substitution-looking text. The 2026-08-18 fix accumulates `residual_unquoted` inside the existing character walk with recursion-checked placeholders and deletes both `sed` derivations. Canaries: `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `quoted paren inside command subst`) and (search: `Quote-projection canaries`), 4 allow plus 4 block, corpus 434 to 442. The recorded remediation in `.goat-flow/learning-loop/lessons/verification-preflight.md` (search: `Verification grep patterns must not carry Markdown backticks into Bash`) advises single-quoting, which is exactly the shape that failed here.

---

## Footgun: Splitting a monolithic guardrail can drop parser coverage while preserving the headline checks

**Status:** active | **Created:** 2026-05-26 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Reports must use sibling-aware hook facts; a split hook's dispatcher can hide shipped denies.
**Trigger phase:** SCOPE
**Caught at:** VERIFY
**Incident count:** 15 | **Latest occurrence:** 2026-09-25

**Prevention:**
1. Treat a guardrail split as a parser migration: port the old normalization and false-positive corpus before deleting the monolith, and read a large drop in line or self-test count as a review smell until removed coverage maps to new tests.
2. Probe representative old cases across all split hooks: wrapper-prefixed pushes, global and inherited `gh` flags, read-only search literals with dangerous text, safe-scoped recursive deletion, split-quoted secret paths, and structured payloads for every registered agent.
3. Keep the central self-test broad enough to fail on both bypasses and false positives.
4. Startup failure handlers never read stdin before CLI mode is known; diagnostics and self-tests need deterministic fail-closed output on a TTY or delayed pipe.
5. Reports use sibling-aware `AgentFacts.hooks` policy and registration facts; dispatcher text is incomplete after a split. Git patterns must come from the Git entrypoint and complete runtime, and settings-layer denials cannot substitute for that hook.
6. A wrapper parser that abandons its unwrap on an unrecognised option fails open, because the caller then classifies the wrapper instead of the payload. Skip the unknown option, or treat an unparsed wrapper as unresolved rather than allowed. Every option table needs both spellings of each option and one self-test case for an option the table does not list.
7. Enumerate command-bearing keys from the local `git-config` and `git-submodule` manuals when changing Git config inspection, including IMAP tunnel and identity-qualified send-email commands. Apply Git's `!` rules for custom submodule updates and credential-helper prefix rules before scanning values. Pair destructive probes with harmless values; check temporary `-c` values and saved `git config` writes.
8. Inspect explicit `ext::` remote URLs and upload-pack command options on Git operations that use them. Skip option values such as branch names and sort keys, and pair each denial with a read-only or harmless control. Treat remote-ext's escaped argument spaces as unresolved unless their boundaries can be proved.
9. Check Git `!` shell aliases against the destructive policy independently of the repository policy. Strip the shell-alias marker before recursive inspection, preserve caller argument boundaries, and test temporary and saved aliases with harmless controls.
10. Refuse visible `GIT_CONFIG_*` prefixes and exports that the hook's alias lookup cannot inherit; check command-bearing `--config-env` keys even when their values come from an inherited variable.
11. Treat `git grep -O<pager>` and `--open-files-in-pager=<pager>` as hosted commands, and retain a matched-file operand when classifying their deletion risk.

**Symptoms:** `patterns-shell.sh`, `patterns-paths.sh`, and `patterns-writes.sh` each block `rm -rf /`, `cat .env`, and `git push`, while the pre-M10 monolith's parser coverage is gone. Pre-restoration probes wrongly allowed `git -C /tmp push`, `git -c core.sshCommand=foo push`, `/usr/bin/git push`, `gh --repo owner/repo issue comment`, `gh workflow run deploy.yml`, `rm -r src`, `cat .envrc`, `cat '.'env`, and `python3 -c 'print(open(".env").read())'`, and wrongly blocked `rm -rf ./node_modules`, `rg "&& rm -rf /" src/`, `bash -c "echo hello"`, and `python -c 'print(1)'`.

**Why it happens:** The monolith was 1,997 lines with a 629-line self-test; the first split shipped three guards totaling 393 lines with a 195-line self-test, a coverage cliff behind green smoke.

**Evidence:** `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `is_gh_write_operation`), `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `rm_has_recursive`), `workflow/hooks/deny-dangerous/patterns-paths.sh` (search: `is_secret_path_touch`), and `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `git -C push`) and (search: `quoted destructive search literal`).

**Incident ledger:**
- **Recurrence 2026-06-07 wrapper prefixes:** `normalize_command_candidate` stripped `command`, `builtin`, `time`, `nohup`, `nice`, `sudo`, and `env` but not `exec`, `timeout`, `setsid`, `stdbuf`, `ionice`, `taskset`, `chrt`, or `flock`. Conservative grammars now strip only command-bearing forms and leave `ionice -p`, `taskset -p`, `chrt -p`, and `exec 2>/dev/null` allowed: `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `Wrapper-prefix normalization`).
- **Recurrence 2026-06-07 startup hang:** `deny_dangerous_unavailable` read stdin before checking invocation mode, so a broken policy store plus `--self-test=full` could block on a TTY. Self-test, `--check`, and TTY invocations now skip the payload read: `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `self-test startup should not read stdin`).
- **Recurrence 2026-07-14 report drift:** M25 labelled Codex push `permissive` while the live audit found the block, because `src/cli/facts/agent/settings.ts` (`checkDenyPatterns`) saw only the dispatcher and `src/cli/facts/agent/hooks.ts` (`siblingGuardrailPaths`) saw the split policy; the report now uses `AgentFacts.hooks.denyBlocksGitPush`.
- **Recurrence 2026-08-11 option-table abandonment:** `strip_watch_payload_command` and `strip_parallel_payload_command` end their option loops with `-*) return 1`, and both tables carry short forms without long equivalents. At `9adf06be`, `watch git push origin main` and `parallel git push ::: a` exit 2 while `watch --beep git push origin main`, `watch --color git push origin main`, and `parallel --verbose git push ::: a` exit 0; the same commands also exit 0 at base `3db06657`, so the wrapper support narrows the gap rather than opening it. On Codex, Copilot, and Antigravity this hook is the only push block: `workflow/hooks/agent-config/codex.toml` (search: `Command deny policy still lives in those PreToolUse hooks`) records that permission profiles cover filesystem and network access, not command patterns, while Claude also keeps the settings glob `Bash(*git push*)`.
- **Recurrence 2026-09-23 Git global options:** `__goat_git_strip_globals` skipped `--attr-source` and `--shallow-file` as flags, so their value posed as the Git command and `git --attr-source HEAD push`, `... commit -m x` and `... reset --hard` exited 0 for every agent; the Claude settings glob misses that spelling too. Both options now take values, and an option the table does not list denies as unresolved: `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `attr-source value hides publication`) and (search: `unlisted global option`).

- **Recurrence 2026-09-25 Git-hosted commands:** Both policies allowed a blocked destructive payload under `git bisect run`, `submodule foreach`, `difftool --extcmd` and explicit pager/fsmonitor configuration. `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `check_git_hosted_commands`) now sends that command text through the selected policy, preserving caller arguments and using bounded nested inspection. Temporary and saved Git aliases retain raw argument boundaries (search: `__goat_git_raw_alias_expansions` in `workflow/hooks/deny-dangerous/patterns-writes.sh`); the first direct-form repair missed hosted aliases and the paired replay caught it. Regression cases (search: `Git alias retains quoted hosted body`, `Git submodule retains nested Git policy`, `ordinary Git config value is data`) pair denials with harmless hosted commands and inert configuration values. Existing trusted helpers and inherited environment-provided command bodies remain outside this explicit-command proof. Provider-shaped replay also caught the first nested runner appending a false unavailable message after an exit-2 denial. The runner now propagates that completed denial; corpus checks (search: `Git-hosted denial remains a policy decision`, `Git-hosted denial remains one JSON decision`) require one truthful provider response.

- **Recurrence 2026-09-25 Git command-bearing config keys:** `git_config_key_runs_command` recognized four `core.*` keys only. Direct `--check` probes denied `git -c core.pager='rm -rf ...' log` but allowed the same destructive body in `pager.log`, `diff.external`, `difftool.x.cmd` and `mergetool.x.cmd`. Git's local `git-config` manual identifies these values as commands. A second probe found `credential.helper='!rm -rf ...'` allowed; `gitcredentials` documents `!` as a shell snippet and ordinary helper names as `git credential-<name>`. `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `git_config_command_payload`) now applies those helper rules and classifies the other documented command-bearing families; `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `subcommand Git pager hosts destructive shell`, `Git credential shell snippet hosts destructive shell`) pairs direct and saved denials with harmless controls. This proves local classifier behavior, not provider-side hook delivery.

- **Recurrence 2026-09-25 IMAP and send-email command keys:** After that sweep, both installed hooks still returned exit 0 for destructive or publication bodies in `imap.tunnel` and `sendemail.{sendmailCmd,toCmd,ccCmd,headerCmd}`; the same bodies under `core.pager` returned exit 2 from their owning policies. The documented `sendemail.<identity>` subsection also allowed a command in `sendemail.ops.toCmd`. `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `git_config_key_runs_command`) now classifies those base and identity-qualified keys. The shared corpus (search: `Git IMAP tunnel hosts destructive shell`, `Git identity recipient command hosts publication`) covers temporary and saved settings with harmless controls. These are local classifier results; no destructive or publishing command was executed.

- **Recurrence 2026-09-25 command-key sweep:** A second pass through the local `git-config` and `git-submodule` manuals found executable values still allowed by `--check`: `core.alternateRefsCommand`, `gc.recentObjectsHook`, `gpg.ssh.defaultKeyCommand`, `browser.x.cmd`, `guitool.x.cmd`, `man.x.cmd`, `instaweb.httpd`, `uploadpack.packObjectsHook` and `submodule.x.update='!rm -rf ...'`. The hook now scans these command values; `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `git_config_command_payload`) strips the custom submodule update marker while leaving ordinary `checkout` mode as data. `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `Git alternate refs command hosts destructive shell`, `ordinary Git submodule update mode is data`) pairs new denials with harmless controls. These are local classifier results; no Git command value was executed.

- **Recurrence 2026-09-25 Git ext transport:** `git -c protocol.ext.allow=always ls-remote 'ext::rm -rf ...'` and a saved `remote.origin.url` with the same value returned 0 from the hook classifier. The local `git-remote-ext` manual defines `ext::` as an external command; a harmless live `ext::printf GOAT_EXT_PROBE` run returned Git's `fatal: protocol error: bad line length character: GOAT`, confirming execution without modifying the repository. `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `scan_ext_transport`) now inspects literal ext URLs in transport and remote setup operations, plus upload-pack command options and config values. Its first scan also denied `--branch`, `--depth`, `--sort` and `-t` values that merely resembled URLs; the option-value skip and `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `Git clone branch name is not a remote URL`) preserve those controls. Escaped argument spaces receive an explicit unresolved denial (search: `Git ext transport escaped argument boundary is unresolved`). No destructive payload was executed.

- **Recurrence 2026-09-25 Git shell aliases:** The destructive-policy classifier returned 0 for `git -c alias.r='!rm -rf ...' r` and for a shell alias running `git ls-remote` with a destructive `ext::` argument. The repository policy denied both because it rejects shell aliases as a class, but the policies have separate toggles. `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `Git passes the caller's remaining arguments to its shell alias command`) now strips `!` and recursively inspects the shell body with caller arguments. `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `Git shell alias hosts destructive body`, `saved Git shell alias harmless body`) covers temporary and saved aliases with safe controls. No shell alias was executed during the probes.

- **Recurrence 2026-09-25 IFS command words:** Unquoted `${IFS}` inside the executable word concealed `eval` carrying Git writes and recursive deletion. `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `normalize_leading_command_word`) now refuses that unresolved executable before dispatch. The corpus (search: `IFS`) keeps quoted evidence allowed beside the blocked payloads.
- **Recurrence 2026-09-25 visible Git config environment:** `GIT_CONFIG_COUNT` alias and `core.fsmonitor` prefixes passed both hooks while the matching `git -c` forms denied. `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `visible_git_config_environment_is_unresolved`) now refuses unresolved visible config prefixes, exports, and shell wrappers; (search: `git_config_key_may_host_command`) refuses command-bearing `--config-env` values. The corpus (search: `visible Git config alias publication`) includes zero-count and quoted-literal controls.
- **Recurrence 2026-09-25 Git grep pager:** `git grep -O'rm -rf docs' needle` and its long-option form passed the destructive hook. `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `Git passes each matching path to this explicit pager command`) now scans the pager value with a matched-file operand. The corpus (search: `Git grep pager hosts destructive shell`) retains a harmless `-Ocat` control.

---

## Footgun: Copilot preToolUse hooks must distinguish structured payloads from Bash calls

**Status:** active | **Created:** 2026-04-21 | **Evidence:** ACTUAL_MEASURED

**Prevention:** Read `toolName` before shell checks on any broad `preToolUse` hook, self-test every registered payload shape including non-Bash Copilot payloads and stringified `toolArgs`, and make allow tests assert no deny JSON rather than exit 0, because Copilot denies also exit 0.

**Symptoms:** The hook once treated every payload as Bash, so non-Bash `view`, `edit`, and `Task` events with no `command` were denied. On 2026-06-05, stringified Copilot `toolArgs.path` and `file_path` denied safe `view` and `edit` until `extract_path` normalized object and string forms.

**Why it happens:** Copilot `preToolUse` delivers Bash and non-Bash payloads through one hook, so Bash-only deny logic that ignores `toolName` either denies safe file tools or regexes structured payloads.

**Evidence:** `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `detect_output_mode`) and (search: `def extract_path(value)`); `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `stringified non-bash file read`).

---

## Footgun: One language-neutral primitive list misses each interpreter's own execution spellings

**Status:** active | **Created:** 2026-09-16 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** The inline interpreter guard keeps its shared dotted-primitive list and adds per-interpreter matching on the program with its string literals removed; the receiver-method and template-literal exemptions belong to JavaScript only.
**Trigger phase:** ACT
**hallucination-risk:** high
**Incident count:** 3 | **Latest occurrence:** 2026-09-18

**Prevention:**
1. When an interpreter gains an inline execution spelling, add it to that interpreter's own case in `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `inline_program_visible_code`) and pair it with a word-in-string control in `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `Perl qx brace`); never widen the shared list into a bare identifier ban.
2. Match paren-less calls and `qx`/`%x` delimiters on visible program text. Hide ordinary complete quoted strings, but retain quote-delimited execution operators, unfinished strings and possible executable interpolation. Keep the existing conservative raw process-module scans; printing `child_process` in Node or `subprocess` in Python still denies.
3. Keep one exemption per language, not per token: JavaScript's regex `.exec(` and template literals are ordinary code, while Ruby's `Kernel.exec(` and Perl, Ruby and PHP backticks execute.

**Symptoms:** On 2026-09-14 at `55233485`, Perl `qx` with brace or slash delimiters, paren-less Perl and Ruby `system` and `exec`, Ruby `spawn`, `Kernel.exec`, `Process.spawn` and `Open3`, Python `os.spawnl` and `pty.spawn`, PHP `passthru` and `proc_open`, a Perl pipe-open and `Deno.Command` all exited 0 under `deny-dangerous`, while a quoted `subprocess` word inside a Node expression exited 2.

**Why it happens:** `shell_primitive_re` was one list for six interpreters: it required parentheses, exempted every `.exec(` receiver because JavaScript regexes use that shape, and matched module names anywhere in the command, so Ruby's receiver calls slipped through the JavaScript exemption and a Node string literal tripped Python's module name. The resolved entry in `.goat-flow/learning-loop/footguns/deny-shell.md` (search: `Interpreter eval scan matches any identifier ending in the exec word`) records the earlier false positive on the same list.

**Evidence:** `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `inline_program_executes_commands`) holds the shared `shell_primitive_re` list and the per-interpreter cases, and `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `Ruby Kernel.exec receiver`) pins each denial beside its allow control; the RED run of that corpus against the pre-fix module failed exactly those nineteen assertions.

**Recurrence 2026-09-17:** A Ruby `system` call denied until an earlier printed apostrophe required adjacent shell-quote fragments; that shape returned 0.
Opposite quotes inside printed strings also hid a later call. Decode the complete shell argument, then track matching string quotes and escapes.
Evidence: `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `inline_interpreter_program`, `inline_program_visible_code`) and
`workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `Ruby command after shell-concatenated quotes`, `Ruby command between opposite-quote literals`).

**Recurrence 2026-09-18:** `perl -e 'print "qx{id}"'` and Ruby's printed `"%x(id)"` returned 2 because delimiter matching scanned raw program text. Ordinary quote masking allows those data strings; it retains `qx"id"`, `%x"id"` and possible executable interpolation so the repair does not hide commands. Evidence: `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `inline_program_visible_code`) and the corpus (search: `Perl printed qx operator text`, `Ruby percent-x in executable string interpolation`, `Node printed process-module name remains denied`). This bounded scanner is not a complete interpreter lexer.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: Interpreter eval scan matches any identifier ending in the exec word

**Status:** resolved | **Created:** 2026-08-22 | **Evidence:** ACTUAL_MEASURED

**Prevention:** Guardrail token lists need an explicit left boundary or a qualified receiver, never a bare substring that can also be a method name. When a rule names a language primitive, add an allow case for the same word as used by the language's own standard library, so identifier context stays covered alongside shell structure. Narrowing either pattern is a security-policy change: re-run the full self-test and confirm the child-process and os-prefixed forms still block. Sibling lesson: `.goat-flow/learning-loop/lessons/hook-testing.md` (search: `deny-dangerous self-test missed a whole false-positive class while green`).

**Symptoms:** A read-only Node `-e` one-liner is denied `Policy destructive: Interpreter -c/-e with shell-execution primitive` for calling `RegExp.prototype.exec`. Measured 2026-08-22: a payload whose only suspicious token is a regex `exec(` call returns status 2 and the identical payload using `test(` returns 0, blocking two benign log-analysis commands while `--self-test=full` stayed green at `executed=481, skipped=0`. This remained reproducible on 2026-09-13 before the correction below.

**Why it happens:** `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `shell_primitive_re`) previously listed `exec` followed by optional whitespace and `(` with no left boundary, so any identifier ending in that word matches. The genuine Node hazard already matches the `child_process` alternative and the Python hazard the `os.`-prefixed alternatives, so the bare entry mostly produces false positives on JavaScript's most common regex idiom.

**Related historical measurement (2026-08-22):** writing Markdown through a quoted heredoc was denied `Policy destructive: Backtick command substitution hides nested execution` because the prose held code spans. Preserve that incident without treating it as current policy: quoted-data coverage now includes `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `bounded redactor treats Markdown prose as data`), and ADR-052 owns the accepted interpreter limits.

**Resolution 2026-09-13:** Inline interpreter checks now distinguish standalone `exec(` from receiver methods such as Node regex `.exec()`, retain qualified shell APIs, and detect literal backticks in Perl/Ruby/PHP eval bodies. JavaScript template literals and the plain word `backtick` remain allowed. The regression corpus in `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `Perl eval backticks remain executable inside shell quotes`) classifies these strings without executing their contents. Interpreter heredoc limits remain governed by ADR-052; this repair does not claim general interpreter sandboxing.

- **Deny hook blocks read-only commands with dangerous string literals** (resolved 2026-07-12) - the read-only fast path failed when a quoted repository-policy alternation preceded a real top-level pipe, because `patterns-writes.sh` split raw text on every `|` and treated the second quoted branch as a stage. The shared scanner now preserves quoted, escaped, and substitution-contained data while `split_top_level_pipeline_stages_into` exposes only real stages; coverage in `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `single-quoted repository alternation in read-only pipeline`) and `test/unit/audit-command/agent-deny-hooks.test.ts` (search: `allows quoted repository evidence`).
