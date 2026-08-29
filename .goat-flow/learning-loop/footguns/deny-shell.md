---
category: deny-shell
last_reviewed: 2026-08-23
---

Command-grammar and parser traps in the deny hook: how a command string is split into segments, stages, substitutions, and heredoc bodies before any policy runs. A miss here silently un-guards every policy layered on top.

Sibling buckets: `deny-secrets.md`, `deny-writes.md`.

## Footgun: Command-segment splitter must track substitution depth, not just quotes

**Status:** active | **Created:** 2026-06-06 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Benign reads denied as `Policy destructive: Complex command substitution`: an unquoted `$(...)` holding a control operator (`echo $(date; whoami)`, `$(grep x f || echo MISS)`) and arithmetic `$((1 + 2))`; quoting it or dropping the operator passed, so it looked intermittent. Sibling: `.env.example` reads with any redirect (`ls .env.example 2>&1`) denied as writes.

**Why it happens:** `split_command_segments_into` split on `&&`/`||`/`;`/newline tracking quotes but not parenthesis depth, so an operator inside an unquoted `$( ... )` split it across segments, leaving an orphan `$(` that `check_command_substitutions`' residual catch-all blocked. The catch-all is correct; the orphan was manufactured upstream, so the reported "catch-all too broad" lead was a downstream symptom. Arithmetic `$(( ))` was unrecognised by the `$( )`-only scanner; for `.env.example`, any `HAS_REDIRECT` (incl. `2>&1`) counted as a write.

**Evidence:** `workflow/hooks/deny-dangerous.sh` (search: `Command/process substitution openers`) tracks `subst_depth` for `$(` `<(` `>(` (plain `(...)` stays splittable so `(cmd && rm -rf /)` cannot bypass) and enforces the chain-count cap (search: `chain-count cap at nested depths`). `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `arithmetic expansion`) covers `$(( ))`. `workflow/hooks/deny-dangerous/patterns-paths.sh` (search: `is_secret_path_touch`). The self-test also covers `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `unquoted subst with || fallback`) and (search: `rm behind || inside subst`). (That redirect-write matcher was removed 2026-07-18; `.env.example` writes are now allowed.)

**Prevention:**
1. A tokenizer splitting shell control operators MUST respect `$(`/`<(`/`>(` boundaries; quotes alone are insufficient, and plain `(...)` subshells must stay splittable (nothing recurses into them).
2. "Write to X" detection must check the redirect *target*; `2>&1`/`2>/dev/null` are not writes.
3. When a finding fingers a downstream guard (a catch-all), trace its input token to the tokenizer before relaxing it; chain-count caps must hold at every recursion depth.

**Recurrence update (2026-07-12):** M31 rewrote the scanner's operator-facing comment and accidentally removed the semantic anchor `Command/process substitution openers`. The parser and focused tests passed, but `node --import tsx src/cli/cli.ts stats . --check` failed `stale-ref` against this entry. The fix restored that durable phrase in `split_command_segments_into`; parser refactors must grep learning-loop anchors before renaming comments, even when runtime behavior is unchanged.

**Release-gate recurrence (2026-06-06):** Pre-1.10.0 adversarial QA measured two remaining parser traps. Path-prefixed `.env.example` redirect targets (`echo x > ./.env.example`, `echo x > fixtures/.env.example`, `echo x > $HOME/proj/.env.example`, `echo x > /home/devgoat/projects/goat-flow/.env.example`) returned exit 0 even though bare `.env.example` writes blocked; root cause was the hook's then-current redirect-write matcher (`is_env_example_redirect_write`, removed 2026-07-18 with the whole read-only restriction) matching only bare redirect targets while `echo`/`cat` kept read-only classification. Deep benign substitutions (`echo $(echo $(echo $(echo $(date))))`) also returned exit 0 despite the old depth guard; that guard was later removed because dangerous content at any depth is blocked by depth-independent policy checks, while a hard nesting cap false-positived legitimate shell idioms. Current anchors: `workflow/hooks/deny-dangerous.sh` (search: `find_matching_shell_paren`), `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `deep benign path nesting allowed`).

**Resolved 2026-06-06:** Finding 1 fixed; finding 2 reverted (won't-fix). (1) `is_env_example_redirect_write` gained an optional path prefix before the `.env.example` basename, so `> ./.env.example`, `> sub/.env.example`, and `> $HOME/x/.env.example` blocked while `2>&1` / `2>/dev/null` / redirect-to-other-file stayed reads (helper removed 2026-07-18). Regression case: self-test (search: `.env.example subdir write`). (2) The depth-cap fix (`command_subst_nesting_depth` enforcing `>3` nesting) was **reverted** after pre-1.10.0 release-gate QA (3 independent agents) found false positives - nested arithmetic and `echo $(dirname $(dirname $(dirname $(pwd))))` - for **zero security benefit**: dangerous content at any depth already blocks at its own segment (4-deep `rm` via the rm check, 3-deep `git push` via the repository check). Reclassified **by-design**: per-segment policy checks are depth-independent. Revert guards: `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `deep benign path nesting allowed`), (search: `deeply nested arithmetic allowed`), and `workflow/hooks/deny-dangerous.sh` (search: `count_substitution_openers`).

---

## Footgun: Nested hook checks must reuse the command segment splitter

**Status:** active | **Created:** 2026-04-27 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Pre-fix, the hook blocked top-level `true; rm -rf /` while allowing the same command nested inside `bash -c "true; rm -rf /"` or `echo "$(true; rm -rf /)"`. Current self-tests lock these as blocked; the active trap is that recursive execution paths can regress if they call `check_segment` directly instead of `check_command_segments`.

**Why it happens:** Top-level input is split on `&&`, `||`, semicolons, and newlines before each segment is checked. A regression can reappear if recursive paths for command substitution, process substitution, and `bash -c` call the raw segment checker directly; if the nested string starts with a read-only verb (`echo`), the whitelist returns before the destructive segment is inspected.

**Evidence:**
- `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `rm_has_recursive`) - split destructive guardrail owns recursive deletion, shell execution, and destructive-command policy; `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `rm -rf`) - central self-test locks representative destructive-command blocking.
- Current regression anchors: `workflow/hooks/deny-dangerous.sh` (search: `check_command_segments`) recurses through the command segment splitter; `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `bash -c chained rm`; `rm behind ; inside subst`) locks nested chained destructive commands as blocked.
- Runtime proof before the fix: `bash workflow/hooks/deny-dangerous.sh --self-test=full` returned `FAIL [bash -c semicolon dangerous]: expected 2, got 0`, `FAIL [bash -c and-chain dangerous]: expected 2, got 0`, `FAIL [bash -c semicolon git push]: expected 2, got 0`.

**Prevention:**
1. Recursive hook paths MUST call `check_command_segments`, not `check_segment`, unless the caller already split shell control operators.
2. Every nested execution feature (`bash -c`, `$()`, `<()`) needs at least one chained-danger self-test, not only a single-danger body.
3. When a hook edit touches read-only whitelisting or recursive parsing, run the self-test before syncing copies so failures point at the canonical template.

---

## Footgun: Heredoc masking can hide executable shell lines

**Status:** active | **Created:** 2026-05-25 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Masking quoted heredoc bodies fixes false positives on inert report JSON/prose, but is unsafe if the masker doesn't exactly mirror Bash delimiter semantics: one that misses `<<-` tab-indented terminators keeps treating later shell lines as heredoc data, while a too-broad masker lets inert JSON/prose trip the chain-count cap.

**Why it happens:** The guardrail shell parser is a policy parser, not Bash: it preserves the heredoc opener, ignores safe quoted bodies for chain-counting, keeps shell-fed heredocs (`bash <<'EOF'`) inspectable, and resumes scanning right after the real delimiter - so false-positive and bypass fixes share one coupled boundary.

**Evidence:**
- Runtime probe before the 2026-05-25 fix returned exit 0 for a `cat <<-'EOF' ... EOF` followed by `rm -rf /`, because the tab-indented delimiter was not recognized and the later `rm` line was masked as body data.
- **Chain-count side confirmed + fixed 2026-06-06:** the "inert body trips the chain-count cap" risk this footgun warned about was present in the unreleased pre-1.10.0 candidate. `mask_safe_quoted_heredoc_bodies` emitted one `__goat_quoted_heredoc_body__` token per masked body line, and `split_command_segments_into` splits on newlines, so a benign 60-line `python - <<'PY' ... PY` (and `php <<'PHP'`) produced >50 segments and was blocked with `Command has more than 50 chained segments` - a false positive on ordinary read-only smoke scripts. Fix: a `body_masked` flag (search: `Collapse the whole inert body`) emits exactly ONE placeholder per masked body, so an inert interpreter heredoc is a single segment. Shell-fed heredocs (`bash <<'SH'`) keep `mask_body=0`, stay line-by-line inspectable, and still trip the cap at >50 real statements. Regression cases now lock both sides: `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `Heredoc body must not inflate`).
- **Collapse exposed an `xargs`/`parallel` dispatcher gap (found in review, fixed 2026-06-06):** collapsing the masked body to one token removed an *accidental* backstop. A long `xargs -I{} bash -c '{}' <<'X' ... X` (and the piped `cat <<'X' ... X | xargs bash -c` shape) used to be blocked only because its 50+ unmasked-but-then-masked lines tripped the chain-count cap; once the body collapsed to one segment that backstop vanished and the body (`rm -rf /`) was hidden - exit 0. Root cause was pre-existing and independent of the collapse: `heredoc_opener_executes_shell` (search: `xargs / parallel turn their stdin`) only classified a *direct* shell first-word or `| shell` pipe as shell-executing, so `xargs`/`parallel` dispatching to `bash -c`/`sh -c` was masked. The direct check `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `shell_here_doc_re`) also misses it because `'{}'` sits between `-c` and `<<`. Fix: treat a `dispatch_re` (`xargs`/`parallel`) + `shell_word_re` pairing on the opener as shell-executing (`mask_body=0`); the short variant then blocks on the `rm` check, the long on the cap. Plain `xargs rm` and `grep bash` stay maskable - no new false positives. Regression cases: self-test (search: `Stdin dispatchers`).
- **Classifier was a blocklist; broader bypass class closed 2026-06-06:** the xargs fix prompted a sweep finding the classifier recognised only a few shell-execution shapes, so other command-position shells masked their body too: `while read l; do bash -c "$l"; done <<'X'` (and its piped form) and `source /dev/stdin <<'X'` / `. /dev/stdin`. All returned exit 0 (short forms even at HEAD, pre-dating the collapse). Root principle: ask "what executes this body?", not "is the first word a shell?". `heredoc_opener_executes_shell` now also treats (a) `source`/`.` first-word as executing, and (b) any shell interpreter in COMMAND position - right after `;`/`&`/`|`/`` ` ``/`(`/`{`/`&&`/`||` or a `do`/`then`/`else`/`elif` keyword (search: `cmd_shell_re`) - as executing. Quoted spans are stripped first (search: `stripping quoted spans needs a regex`) so a shell NAME used as data (`grep '|bash'`, `grep bash`, `jq '.a | .b'`) is NOT mistaken for a command and stays maskable. **This interim blocklist (`heredoc_opener_executes_shell` + `cmd_shell_re`) was SUPERSEDED 2026-06-06 - see next bullet - after review showed it was still bypassable.**
- **Masker flipped from blocklist to ALLOWLIST (definitive fix, 2026-06-06):** a second review proved the "is it a shell?" blocklist could never be complete - it missed bash line-continuations splitting the opener (`cat <<'X' \`<nl>`| bash`), quote/backslash reconstruction (`b"ash"`, `b\ash`), `command`/`exec` wrappers, and `read`/`mapfile` variable handoff (`read x <<'X' ... X; bash -c "$x"`). The deep reason: a heredoc body *written to a file* (`cat <<'EOF' > x.sh ... rm -rf ... EOF`) is textually identical to one being *executed* - only "does anything run it?" distinguishes them, which static opener analysis can't decide. Fix: `heredoc_opener_executes_shell` was replaced by `heredoc_body_is_inert` (search: `SAFE BY DEFAULT`), masking ONLY when EVERY command in the continuation-joined opener pipeline is on a small allowlist of non-shell consumers (cat/grep/sed/awk/jq/python/php/node/psql/...). Everything else - shells, `xargs`/`parallel`, `source`/`.`, `read`/`mapfile`, control keywords, `ssh`, unknown commands - is NOT masked, so the body stays inspectable. Line-continuations are joined into one logical opener first (search: `Join bash line-continuations`). Trade-off accepted by the user (2026-06-06): a >50-line heredoc to an unrecognised or compound-wrapped consumer can trip the chain cap (safe FP, "run manually"), never a bypass. Verified: every reviewer bypass (line-continuation, quote-reconstruction, wrapper, variable-handoff, `ssh`) now blocks; python/php/cat/jq/psql/node/grep inert heredocs still allow. Regression cases: self-test (search: `Allowlist masker`). Two deliberate boundaries: (i) **ACCEPTED SCOPE LIMIT (product decision, 2026-06-06, confirmed on the third review pass):** an allowlisted interpreter/client still runs the body **as its own language, including shell escapes** - `python - <<'X'` runs Python (`os.system`), `sed e` / `sed -f /dev/stdin` shell out, `awk` honours `system()`, `psql`/`mysql`/`sqlite3`/`duckdb` honour `\!`/`.shell`. Masked BY DESIGN: deny-dangerous guards SHELL, not interpreter languages, and that is the price of not false-positiving on long SQL migrations / sed-awk scripts. The reviewer offered "document or don't mask"; the user chose document. `python` also cannot be dropped without regressing the original chain-cap false positive. The self-test marks these `expect_allow` (search: `ACCEPTED scope`) so a future reviewer does not silently "fix" it and break legitimate interpreter heredocs. See ADR-052. (ii) `heredoc_body_is_inert` caps pipeline segments (search: `cannot fork-DoS the masker`) at 64 - more is never a simple inert pipeline and would fork two subshells per segment, so it refuses to mask.
- **Process-substitution routing + cap tuning (third review pass, 2026-06-06):** the per-pipeline-segment allowlist still masked `cat > >(bash) <<'X'` / `tee >(bash) <<'X'` - the `;&|` split never looks inside `>(...)`, so the body routed straight to a shell while `cat`/`tee` (inert) won the decision. A first fix checked only the inner first word, still allowing command lists (`>(printf ''; bash)`, `>(: && bash)`), brace groups, and `if ... then bash` where an inert first command left stdin for a later shell. Correct fix: `heredoc_body_is_inert` extracts every `<(...)`/`>(...)` interior (search: `Process substitutions route the body`) and runs the full inner command list through the same allowlist; a non-inert command anywhere inside blocks masking. Same pass tuned two caps: pipeline-segment 32->64 (a 33-stage inert pipeline was a false positive) and command-substitution 64->32 (64 substitutions took ~4.7s of pre-existing fork overhead, so the cap bounds worst-case allowed time to ~2.4s). Regression cases: self-test (search: `Process substitution routes the body`).
- **Heredoc process-substitution fork-DoS bound (2026-06-07):** the process-substitution classifier loop inside `heredoc_command_list_is_inert` ran before the later segment/substitution caps, so a quoted heredoc opener with many `>(...)` targets could force repeated recursive scans before the policy decided whether to mask the body. Fix: count substitution openers fork-free before the loop (search: `count_substitution_openers "$scan"`), refuse to mask above the cap, and keep an iteration counter as a backstop. Regression case: self-test (search: `many heredoc process substitutions block fast`).
- **Substitution-opener DoS cap (2026-06-06):** review measured `cat <(:) <(:) ... <(:)` (300 process substitutions) taking ~10s -> SIGTERM, because each `$(`/`<(`/`>(` triggers a recursive re-scan in `check_command_substitutions`. `main` now does a flat O(len) count of substitution openers (search: `policy-parser DoS`) and blocks above 32 before the recursive walk. Benign nested substitutions (`echo $(dirname $(dirname $(pwd)))`) stay allowed. Regression case: self-test (search: `parser-DoS cap`).
- `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `rm_has_recursive`) - split destructive guardrail owns shell execution and destructive-command checks after the M10 hook split; `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `rm -rf`) - central self-test locks representative destructive-command blocking.

**Prevention:**
1. Any heredoc masking edit must test both sides of the boundary: safe quoted report data is allowed, shell-fed heredoc bodies stay inspectable, and commands after `<<-` tab-indented delimiters are scanned.
2. Self-test helpers must exercise the same policy path as runtime, including the 50-segment cap; testing only `check_command_segments` misses chain-cap false-positives.
3. Keep workflow, `scripts/`, and installed agent hook mirrors byte-identical after heredoc edits.
4. Before masking a heredoc body, ask "what executes this body?" - not just the first word. A stdin dispatcher (`xargs`/`parallel`) running a shell, or a shell anywhere downstream of a pipe, makes the body shell. Never let the chain-count cap be the only thing blocking a hidden shell body; the masking classifier must be correct on its own.
5. Decide "is the body inert?" with an ALLOWLIST of safe consumers, never a blocklist of shells. A blocklist is a losing game (line continuations, `b"ash"`/`b\ash` quote tricks, `command`/`exec` wrappers, `read`/`mapfile` variable handoff, `ssh`). Default to "inspect"; mask only when every command in the (continuation-joined) opener pipeline is a known non-shell consumer. A masking false positive is recoverable ("run manually"); a masking miss is a silent bypass.

---

## Footgun: Dispatcher checks must inspect pipeline segments, not only the whole command

**Status:** active | **Created:** 2026-06-09 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Pre-fix, direct `xargs rm -rf < list.txt` blocked, but equivalent pipelines such as `printf '%s\n' /tmp/build-old | xargs rm -rf` or `find . -type f | xargs -r rm -rf` returned exit 0. Current self-tests lock these as blocked; the active trap is that dispatcher parsers must run on each pipeline segment, not only the whole command.

**Why it happens:** `patterns-shell.sh` already had an `xargs` payload parser, but the pre-fix `check_destructive_segment` applied it only to `CMD_NORMALIZED` for the full segment. Existing pipeline scanning checked shell/interpreter consumers, not destructive dispatcher payloads. Any policy that unwraps a dispatcher must decide whether it applies to the whole segment, each pipeline command, or both.

**Evidence:**
- Pre-fix runtime probes returned exit 0 with no block output for `printf '%s\n' /tmp/build-old | xargs rm -rf` and `find . -type f | xargs -r rm -rf`; direct controls `rm -rf /` and `xargs rm -rf < list.txt` still returned exit 2.
- Fix anchors: `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `check_pipeline_xargs_destructive_payloads`) scans every pipeline segment; self-test cases in `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `piped xargs recursive rm`) lock both block shapes and the allow control `xargs echo rm -rf`.

**Prevention:**
1. For every dispatcher/parser helper (`xargs`, `parallel`, `gh`, shell consumers), test direct, piped, option-bearing, and harmless literal forms.
2. Whole-segment checks are not enough when the first command produces input for a later command; split the pipeline and run the dispatcher classifier on each executable segment.
3. Always include a literal allow control so the fix does not become a broad "text contains rm -rf" block.

---

## Footgun: Shell substitution scanners must be quote-aware inside the substitution body

**Status:** active | **Created:** 2026-06-07 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A regex-only `$()` / `<()` scanner can stop at a `)` that appears inside a quoted string within the substitution body. PR #48 review canaries showed `echo $(echo ")"; git push origin main)` and `cat <(echo ")"; git push origin main)` were allowed because the parser treated the quoted `)` as the substitution close and left the dangerous command outside the recursive policy walk.

**Why it happens:** The shell has nested grammar inside command and process substitutions. A top-level tokenizer that tracks quotes before entering `$(` is not enough; the matcher that finds the closing `)` must also track quotes, escapes, and nested parentheses inside the substitution body. The same area also needs a literal-text distinction: single-quoted `$(` strings are data and must not count toward parser DoS caps.

**Evidence:**
- `workflow/hooks/deny-dangerous.sh` (search: `find_matching_shell_paren`) - quote-aware matching-paren scan used by `check_command_substitutions`.
- `workflow/hooks/deny-dangerous.sh` (search: `count_substitution_openers`) - skips single-quoted substitution-looking text while still counting executable substitution openers.
- `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `quoted paren inside command subst`) - locks the command/process substitution bypass canaries and the single-quoted false-positive allow case.

**Prevention:**
1. Never parse shell substitutions with `[^()]` regexes alone; quoted delimiters inside the body are still body text, not the close delimiter.
2. Every substitution-parser change needs both bypass canaries (`git push` behind a quoted `)`) and false-positive canaries (single-quoted `$(` repeated past the DoS cap).
3. Keep command substitution and process substitution tests paired; they share the matching-paren risk but route through different shell execution paths.

**Recurrence 2026-08-18 (post-walk projection, same family):** the matching-paren scan was correct, but `check_command_substitutions` then discarded its own quote state and re-derived quoting twice with a line-oriented `sed -E "s/'[^']*'//g"` — once for the Complex-substitution check and once for the Backtick check, the latter over the raw input. `sed` cannot match a single-quoted span containing a newline, and naive left-to-right pairing reads the `'\''` escape idiom as an empty quoted span, exposing the characters after it. Measured: 4 false positives (backtick or `$(` text inside a quoted span crossing a newline; the same after `'\''`), 0 bypasses — strictly fail-closed. Worse, the recorded remediation in `.goat-flow/learning-loop/lessons/verification-preflight.md` (search: `Verification grep patterns must not carry Markdown backticks into Bash`) advises single-quoting, which is exactly what fails in these shapes. Fixed by accumulating `residual_unquoted` inside the existing character walk (append only when `in_single` is 0; append the `__goat_subst__`/`__goat_arith__`/`__goat_proc_subst__` placeholders whose bodies recursion already checked) and deleting both `sed` derivations. Canaries: `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `Quote-projection canaries`) — 4 allow plus 4 block, corpus 434 -> 442.

**Prevention (extends rule 1):** never re-derive quote state a parser already computed. If a check needs an unquoted projection, build it in the same pass that tracks the quotes; a second, simpler stripper will disagree with the first on newlines and escape idioms. Keep double-quoted content in the projection — backticks and `$(` execute inside double quotes.

---

## Footgun: Splitting a monolithic guardrail can drop parser coverage while preserving the headline checks

**Status:** active | **Created:** 2026-05-26 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Reports must use sibling-aware hook facts; a split hook's dispatcher can hide shipped denies.
**Trigger phase:** SCOPE
**Caught at:** VERIFY

**Symptoms:** A hook split looks cleaner because `patterns-shell.sh`, `patterns-paths.sh`, and `patterns-writes.sh` each block the happy-path examples (`rm -rf /`, `cat .env`, `git push`). But the pre-M10 monolith carried much broader parser coverage - wrapper normalization, quoted read-only search literals, `git -C`/`git -c` push forms, global `gh --repo` grammar, split-quoted `.env`, `.envrc`, safe-scoped recursive deletion, structured Copilot/Antigravity payloads - so a small split passes smoke tests while re-opening old bypasses and false positives.

**Evidence:**
- Pre-split: monolithic guard 1,997 lines + 629-line self-test; first split replaced them with three guards totaling 393 lines + a 195-line self-test - a coverage cliff behind green smoke.
- Pre-restoration probes wrongly allowed `git -C /tmp push`, `git -c core.sshCommand=foo push`, `/usr/bin/git push`, `gh --repo owner/repo issue comment`, `gh workflow run deploy.yml`, `rm -r src`, `cat .envrc`, `cat '.'env`, `python3 -c 'print(open(".env").read())'`; and wrongly blocked `rm -rf ./node_modules`, `rg "&& rm -rf /" src/`, `bash -c "echo hello"`, `python -c 'print(1)'`.
- 2026-06-07 wrapper-prefix bypass: `normalize_command_candidate` stripped `command`/`builtin`/`time`/`nohup`/`nice`/`sudo`/`env`, but not `exec`, `timeout`, `setsid`, `stdbuf`, `ionice`, `taskset`, `chrt`, or `flock`, so first-word rules could miss wrapped `rm -rf`, `git push --force`, `git reset --hard`, `git clean -fdx`, and `find -delete`. Fix: add conservative wrapper grammars that strip only command-bearing forms and leave no-command forms like `ionice -p`, `taskset -p`, `chrt -p`, and `exec 2>/dev/null` allowed. Regression cases: self-test (search: `Wrapper-prefix normalization`).
- 2026-06-07 startup-unavailable hang: `deny_dangerous_unavailable` read stdin before checking invocation mode, so a broken policy store plus `--self-test=full` could block on interactive or delayed stdin instead of failing closed. Fix: skip startup payload reads for `--self-test`/`--check`/TTY invocations; real hook JSON payloads still get JSON deny responses. Regression case: self-test (search: `self-test startup should not read stdin`).
- **2026-08-11 option-table abandonment:** `strip_watch_payload_command` and `strip_parallel_payload_command` end their option loops with `-*) return 1`, so an option outside the table abandons the unwrap and `normalize_command_candidate` keeps the wrapper text. Both tables carry short forms without their long equivalents (`-b` without `--beep`, `-c` without `--color`). Measured against branch `dev` at `9adf06be`: `watch git push origin main`, `watch -b …`, `watch -n 2 …`, and `parallel git push ::: a` all exit 2, while `watch --beep git push origin main`, `watch --color git push origin main`, and `parallel --verbose git push ::: a` exit 0. The same commands also exit 0 at base `3db06657`, so the new wrapper support narrows the gap rather than opening it. On Codex, Copilot, and Antigravity this hook is the only layer that blocks a push: `workflow/hooks/agent-config/codex.toml` (search: `Command deny policy still lives in those PreToolUse hooks`) records that permission profiles cover filesystem and network access, not command patterns. Claude retains the settings glob `Bash(*git push*)`.
- **Recurrence update (2026-07-14):** M25 labeled Codex push `permissive` while the live audit found the block. `src/cli/facts/agent/settings.ts` (`checkDenyPatterns`) saw only the dispatcher; `src/cli/facts/agent/hooks.ts` (`siblingGuardrailPaths`) saw the split policy. The report now uses `AgentFacts.hooks.denyBlocksGitPush`; its regression test keeps the legacy summary false and expects restricted push.
- Anchors: `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `is_gh_write_operation`), `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `rm_has_recursive`), `workflow/hooks/deny-dangerous/patterns-paths.sh` (search: `is_secret_path_touch`), and `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `git -C push`, `quoted destructive search literal`).

**Prevention:**
1. Treat guardrail splits as parser migrations, not renames. Port the old parser normalization and false-positive corpus before deleting the monolith.
2. Compare line count and self-test case count before approving a split; a large drop is a review smell until removed coverage maps to new tests.
3. Run representative old-case probes across all split hooks: wrapper-prefixed git pushes, global/inherited `gh` flags, read-only search literals with dangerous text, safe-scoped recursive deletion, split-quoted secret paths, and structured payloads for each registered agent.
4. Keep the central self-test broad enough to fail on both bypasses and false positives; smoke checks alone prove only headline examples.
5. Startup failure handlers must not unconditionally read stdin before CLI mode is known; diagnostics and self-tests need deterministic fail-closed output even when stdin is a TTY or delayed pipe.
6. Reports must use `AgentFacts.hooks.denyBlocks*`; dispatcher text is incomplete after a policy split.
7. A wrapper parser that abandons its unwrap on an unrecognised option fails open, because the caller then classifies the wrapper instead of the payload. Prefer skipping the unknown option to returning; if the parser must bail, the caller has to treat an unparsed wrapper as unresolved rather than allowed.
8. Every option table needs both spellings of each option, and the self-test needs one case for an option the table does not list. A corpus drawn from the table can only prove the table, so `watch -n 1 git push` and `parallel --halt soon,fail=1 git push` passed while the long-form spellings went unblocked.

---

## Footgun: Copilot preToolUse hooks must distinguish structured payloads from Bash calls

**Status:** active | **Created:** 2026-04-21 | **Evidence:** ACTUAL_MEASURED

**Active trap:** Copilot `preToolUse` can receive Bash and non-Bash payloads through the same hook. Bash-only deny logic that ignores `toolName` can deny safe file tools or regex structured payloads.

**Original failure:** The hook once treated every payload as Bash; non-Bash `view` / `edit` / `Task` events had no `command`, so they were denied. It now checks `toolName`, allows safe file tools silently, and still denies protected paths.

**Prevention:**
1. Read `toolName` before shell checks on any broad `preToolUse` hook.
2. Self-test every registered payload shape, including non-Bash Copilot payloads and stringified `toolArgs`.
3. Allow tests must assert no deny JSON, not just exit 0; Copilot denies also exit 0.

**Evidence:**
- `workflow/hooks/deny-dangerous.sh` (search: `detect_output_mode`; `def extract_path(value)`).
- `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `stringified non-bash file read`).
- 2026-06-05 recurrence: stringified Copilot `toolArgs.path` / `file_path` denied safe `view` / `edit` until `extract_path` normalized object and string forms.

---

## Footgun: Interpreter eval scan matches any identifier ending in the exec word

**Status:** active | **Created:** 2026-08-22 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A read-only Node `-e` one-liner is denied `Policy destructive: Interpreter -c/-e with shell-execution primitive` purely for calling `RegExp.prototype.exec`. Measured 2026-08-22 against the installed hook with a two-case probe: a payload whose only suspicious token is a regex match call returns status 2, while the identical payload using the `test` method returns 0 - the method name is the only difference. This blocked two benign log-analysis commands in one session while `--self-test=full` stayed green (`executed=481, skipped=0`), so the corpus never saw the case.

**Why it happens:** `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `shell_primitive_re`) lists that word followed by optional whitespace and an open parenthesis with no left boundary, so any identifier whose tail is that word matches - a regex match call, a property access on any object, or a locally named helper. The genuine Node hazard already matches the sibling child-process alternative and the Python hazard already matches the os-prefixed alternatives, so the unqualified entry contributes mostly false positives on the most common regex idiom in JavaScript.

**Related measurement (same session, needs a policy decision):** writing a Markdown file through a *quoted* heredoc was denied `Policy destructive: Backtick command substitution hides nested execution` because the prose contained Markdown code spans. A quoted heredoc delimiter suppresses all shell substitution, so that body is inert text; the scanner does not distinguish quoted from unquoted delimiters. Whether to narrow this is a deliberate call - the existing heredoc-masking footgun in this bucket documents why bodies are scanned at all.

**Prevention:** Guardrail token lists need an explicit left boundary or a qualified receiver, never a bare substring that can also be a method name. When a rule names a language primitive, add an allow case for that same word as used by the language's own standard library: the deny corpus varies shell *structure* but never varies identifier context. Narrowing either pattern is a security-policy change - re-run the full self-test and confirm the child-process and os-prefixed forms still block before shipping. Sibling lesson: `.goat-flow/learning-loop/lessons/hook-testing.md` (search: `deny-dangerous self-test missed a whole false-positive class while green`).

## Resolved Entries

> Historical record. These entries are no longer active traps.

- **Deny hook blocks read-only commands with dangerous string literals** (resolved 2026-07-12) - the original read-only fast path was insufficient when a quoted repository-policy alternation appeared before a real top-level pipe: `patterns-writes.sh` split raw text on every `|` and treated the second quoted branch as an executable stage. The shared scanner now preserves quoted, escaped, and substitution-contained data while `split_top_level_pipeline_stages_into` exposes only real stages; paired allow/block coverage lives in `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `single-quoted repository alternation in read-only pipeline`) and the configured-launcher check lives in `test/unit/audit-command/agent-deny-hooks.test.ts` (search: `allows quoted repository evidence`).
