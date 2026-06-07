---
category: deny-dangerous
last_reviewed: 2026-06-07
---

**Scope:** Traps in the `deny-dangerous` guardrail's shell-grammar policy parser - command/segment splitting, substitution and heredoc handling, secret-path and `git`/`gh` write classification, and structured-payload parsing. Hook install / launch / registration / config-drift plumbing lives in [hooks.md](hooks.md).

## Footgun: Command-segment splitter must track substitution depth, not just quotes

**Status:** active | **Created:** 2026-06-06 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Benign reads denied as `Policy destructive: Complex command substitution`: an unquoted `$(...)` holding a control operator (`echo $(date; whoami)`, `$(grep x f || echo MISS)`) and arithmetic `$((1 + 2))`; quoting it or dropping the operator passed, so it looked intermittent. Sibling: `.env.example` reads with any redirect (`ls .env.example 2>&1`) denied as writes.

**Why it happens:** `split_command_segments_into` split on `&&`/`||`/`;`/newline tracking quotes but not parenthesis depth, so an operator inside an unquoted `$( ... )` split it across segments, leaving an orphan `$(` that `check_command_substitutions`' residual catch-all blocked. The catch-all is correct; the orphan was manufactured upstream, so the reported "catch-all too broad" lead was a downstream symptom. Arithmetic `$(( ))` was unrecognised by the `$( )`-only scanner; for `.env.example`, any `HAS_REDIRECT` (incl. `2>&1`) counted as a write.

**Evidence:** `workflow/hooks/deny-dangerous.sh` (search: `Command/process substitution openers`) tracks `subst_depth` for `$(` `<(` `>(` (plain `(...)` stays splittable so `(cmd && rm -rf /)` cannot bypass); (search: `pure arithmetic; mask it`); (search: `chain-count cap at nested depths`). `workflow/hooks/deny-dangerous/patterns-paths.sh` (search: `is_env_example_redirect_write`). Self-test (search: `unquoted subst with || fallback`), (search: `rm behind || inside subst`).

**Prevention:**
1. A tokenizer splitting shell control operators MUST respect `$(`/`<(`/`>(` boundaries; quotes alone are insufficient, and plain `(...)` subshells must stay splittable (nothing recurses into them).
2. "Write to X" detection must check the redirect *target*; `2>&1`/`2>/dev/null` are not writes.
3. When a finding fingers a downstream guard (a catch-all), trace its input token to the tokenizer before relaxing it; chain-count caps must hold at every recursion depth.

**Release-gate recurrence (2026-06-06):** Pre-1.10.0 adversarial QA measured two remaining parser traps. Path-prefixed `.env.example` redirect targets (`echo x > ./.env.example`, `echo x > fixtures/.env.example`, `echo x > $HOME/proj/.env.example`, `echo x > /home/devgoat/projects/goat-flow/.env.example`) returned exit 0 even though bare `.env.example` writes blocked; root cause is `workflow/hooks/deny-dangerous/patterns-paths.sh` (search: `is_env_example_redirect_write`) matching only bare redirect targets while `check_secret_segment` (search: `env_example_read_only=1`) preserves read-only classification for `echo`/`cat`. Deep benign substitutions (`echo $(echo $(echo $(echo $(date))))`) also returned exit 0 despite the old depth guard; that guard was later removed because dangerous content at any depth is blocked by depth-independent policy checks, while a hard nesting cap false-positived legitimate shell idioms. Current anchors: `workflow/hooks/deny-dangerous.sh` (search: `find_matching_shell_paren`), `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `deep benign path nesting allowed`).

**Resolved 2026-06-06:** Finding 1 fixed; finding 2 reverted (won't-fix). (1) `is_env_example_redirect_write` now allows an optional path prefix before the `.env.example` basename (`(\>|\>\>|\>\|)[[:space:]]*['\"]?([^[:space:]>|'\"]*/)?\.env\.example`), so `> ./.env.example`, `> sub/.env.example`, and `> $HOME/x/.env.example` block while `2>&1` / `2>/dev/null` / redirect-to-other-file stay reads. Regression case: `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `.env.example subdir write`). (2) The depth-cap fix (a `command_subst_nesting_depth` helper enforcing `>3` nesting) was **reverted** after pre-1.10.0 release-gate QA (3 independent agents) found it added false positives - nested arithmetic `$(( $(( $(( $(( 1 )) )) )) ))` and legitimate idioms like `echo $(dirname $(dirname $(dirname $(pwd))))` - for **zero security benefit**: dangerous content at any depth already blocks at its own segment (4-deep `rm` via the rm check, 3-deep `git push` via the repository check - not the cap). Finding 2 is reclassified **by-design**: the cap not firing on nested `$()` is harmless because per-segment policy checks are depth-independent. Revert guards: `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `deep benign path nesting allowed`), (search: `deeply nested arithmetic allowed`), and `workflow/hooks/deny-dangerous.sh` (search: `count_substitution_openers`).

---

## Footgun: Nested hook checks must reuse the command segment splitter

**Status:** active | **Created:** 2026-04-27 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A hook can block top-level `true; rm -rf /` while allowing the same command nested inside `bash -c "true; rm -rf /"` or `echo "$(true; rm -rf /)"`.

**Why it happens:** Top-level input is split on `&&`, `||`, semicolons, and newlines before each segment is checked. Recursive paths for command substitution, process substitution, and `bash -c` can call the raw segment checker directly; if the nested string starts with a read-only verb (`echo`), the whitelist returns before the destructive segment is inspected.

**Evidence:**
- `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `rm_has_recursive`) - split destructive guardrail owns recursive deletion, shell execution, and destructive-command policy; `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `rm -rf`) - central self-test locks representative destructive-command blocking.
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
- **Collapse exposed an `xargs`/`parallel` dispatcher gap (found in review, fixed 2026-06-06):** collapsing the masked body to one token removed an *accidental* backstop. A long `xargs -I{} bash -c '{}' <<'X' ... X` (and the piped `cat <<'X' ... X | xargs bash -c` shape) used to be blocked only because its 50+ unmasked-but-then-masked lines tripped the chain-count cap; once the body collapsed to one segment that backstop vanished and the body (`rm -rf /`) was hidden - exit 0. Root cause was pre-existing and independent of the collapse: `heredoc_opener_executes_shell` (search: `xargs / parallel turn their stdin`) only classified a *direct* shell first-word or `| shell` pipe as shell-executing, so `xargs`/`parallel` dispatching to `bash -c`/`sh -c` was masked. The direct shell-here-doc check `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `shell_here_doc_re`) also misses it because the `'{}'` argument sits between `-c` and `<<`. Fix: treat a `dispatch_re` (`xargs`/`parallel`) + `shell_word_re` pairing on the opener line as shell-executing (`mask_body=0`), so the body stays inspectable; the short variant blocks on the `rm` check and the long variant on the cap. Plain `xargs rm` (dispatcher, no shell) and `grep bash` (shell word, no dispatcher) stay maskable - no new false positives. Regression cases: self-test (search: `Stdin dispatchers`).
- **Classifier was a blocklist; broader bypass class closed 2026-06-06:** the xargs fix prompted a wider sweep that found the masking classifier only recognised a few shell-execution shapes, so other command-position shells masked their body too: `while read l; do bash -c "$l"; done <<'X'` (and the piped `cat <<'X' ... X | while read ... bash`), and `source /dev/stdin <<'X'` / `. /dev/stdin`. All returned exit 0 (the short forms even at HEAD, pre-dating the collapse). Root principle recorded: ask "what executes this body?", not "is the first word a shell?". `heredoc_opener_executes_shell` now also treats (a) `source`/`.` first-word as executing, and (b) any shell interpreter in COMMAND position - right after `;`/`&`/`|`/`` ` ``/`(`/`{`/`&&`/`||` or a `do`/`then`/`else`/`elif` keyword (search: `cmd_shell_re`) - as executing. Quoted spans are stripped first (search: `stripping quoted spans needs a regex`) so a shell NAME used as data (`grep '|bash'`, `grep bash`, `jq '.a | .b'`) is NOT mistaken for a command and stays maskable. **This interim blocklist (`heredoc_opener_executes_shell` + `cmd_shell_re`) was SUPERSEDED 2026-06-06 - see next bullet - after review showed it was still bypassable.**
- **Masker flipped from blocklist to ALLOWLIST (definitive fix, 2026-06-06):** a second review proved the "is it a shell?" blocklist could never be complete - it missed bash line-continuations splitting the opener (`cat <<'X' \`<nl>`| bash`), quote/backslash reconstruction (`b"ash"`, `b\ash`), `command`/`exec` wrappers, and `read`/`mapfile` variable handoff (`read x <<'X' ... X; bash -c "$x"`). The deep reason: a heredoc body being *written to a file* (`cat <<'EOF' > x.sh ... rm -rf ... EOF`) is textually identical to one being *executed* - only "does anything run it?" distinguishes them, which static opener analysis can't decide. Fix: `heredoc_opener_executes_shell` was replaced by `heredoc_body_is_inert` (search: `SAFE BY DEFAULT`), which masks ONLY when EVERY command in the continuation-joined opener pipeline is on a small allowlist of non-shell consumers (cat/grep/sed/awk/jq/python/php/node/psql/...). Everything else - shells, `xargs`/`parallel`, `source`/`.`, `read`/`mapfile`, control keywords, `ssh`, or any unknown command - is NOT masked, so the body stays inspectable. Line-continuations are joined into one logical opener first (search: `Join bash line-continuations`). Trade-off accepted by the user (2026-06-06): a >50-line heredoc to an unrecognised or compound-wrapped consumer can trip the chain cap (safe FP, "run manually"), never a bypass. Verified: every reviewer bypass (line-continuation, quote-reconstruction, wrapper, variable-handoff, `ssh`) now blocks; python/php/cat/jq/psql/node/grep inert heredocs still allow. Regression cases: self-test (search: `Allowlist masker`). Two deliberate boundaries: (i) **ACCEPTED SCOPE LIMIT (product decision, 2026-06-06, confirmed after the third review pass):** an allowlisted interpreter/client still runs the body **as its own language, including shell escapes** - `python - <<'X'` runs Python (`os.system`), `sed e` / `sed -f /dev/stdin` run sed (`e` shells out), `awk` honours `system()`, and `psql`/`mysql`/`sqlite3`/`duckdb` honour `\!`/`.shell`. These bodies stay masked/allowed BY DESIGN: deny-dangerous guards SHELL, not interpreter languages - the same reason `python - <<X` is not inspected, and the price of not false-positiving on >50-line SQL migrations / sed-awk scripts. The reviewer offered "document or don't mask"; the user chose document. `python` also cannot be dropped without regressing the original chain-cap false positive. The self-test marks these `expect_allow` (search: `ACCEPTED scope`) so the decision is executable and a future reviewer does not silently "fix" it and break legitimate interpreter heredocs. (ii) `heredoc_body_is_inert` caps pipeline segments (search: `cannot fork-DoS the masker`) at 64 - more than that is never a simple inert pipeline and would fork two subshells per segment, so it refuses to mask.
- **Process-substitution routing + cap tuning (third review pass, 2026-06-06):** the per-pipeline-segment allowlist still masked `cat > >(bash) <<'X'` / `tee >(bash) <<'X'` - the `;&|` split never looks inside `>(...)`, so the body routed straight to a shell while `cat`/`tee` (inert) won the decision. First fix checked only the inner first word, which still allowed command lists like `>(printf ''; bash)`, `>(: && bash)`, brace groups, and `if ... then bash` where an inert first command left stdin for a later shell. Correct fix: `heredoc_body_is_inert` now extracts every `<(...)`/`>(...)` interior (search: `Process substitutions route the body`) and runs the full inner command list through the same inert-command allowlist; a non-inert command anywhere inside (`>(bash)`, `>(xargs bash -c)`, `>(printf ''; bash)`) blocks masking. Same pass tuned two caps: the pipeline-segment cap 32->64 (a 33-stage inert pipeline was a false positive) and the command-substitution cap 64->32 (64 substitutions took ~4.7s; the per-substitution cost is pre-existing fork overhead in the recursive walk, so the cap bounds worst-case allowed time to ~2.4s). Regression cases: self-test (search: `Process substitution routes the body`).
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

## Footgun: Splitting a monolithic guardrail can drop parser coverage while preserving the headline checks

**Status:** active | **Created:** 2026-05-26 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A hook split looks cleaner because `patterns-shell.sh`, `patterns-paths.sh`, and `patterns-writes.sh` each block the happy-path examples (`rm -rf /`, `cat .env`, `git push`). But the pre-M10 monolith carried much broader parser coverage - wrapper normalization, quoted read-only search literals, `git -C`/`git -c` push forms, global `gh --repo` grammar, split-quoted `.env`, `.envrc`, safe-scoped recursive deletion, structured Copilot/Antigravity payloads - so a small split passes smoke tests while re-opening old bypasses and false positives.

**Evidence:**
- Pre-split: monolithic guard 1,997 lines + 629-line self-test; first split replaced them with three guards totaling 393 lines + a 195-line self-test - a coverage cliff behind green smoke.
- Pre-restoration probes wrongly allowed `git -C /tmp push`, `git -c core.sshCommand=foo push`, `/usr/bin/git push`, `gh --repo owner/repo issue comment`, `gh workflow run deploy.yml`, `rm -r src`, `cat .envrc`, `cat '.'env`, `python3 -c 'print(open(".env").read())'`; and wrongly blocked `rm -rf ./node_modules`, `rg "&& rm -rf /" src/`, `bash -c "echo hello"`, `python -c 'print(1)'`.
- 2026-06-07 wrapper-prefix bypass: `normalize_command_candidate` stripped `command`/`builtin`/`time`/`nohup`/`nice`/`sudo`/`env`, but not `exec`, `timeout`, `setsid`, `stdbuf`, `ionice`, `taskset`, `chrt`, or `flock`, so first-word rules could miss wrapped `rm -rf`, `git push --force`, `git reset --hard`, `git clean -fdx`, and `find -delete`. Fix: add conservative wrapper grammars that strip only command-bearing forms and leave no-command forms like `ionice -p`, `taskset -p`, `chrt -p`, and `exec 2>/dev/null` allowed. Regression cases: self-test (search: `Wrapper-prefix normalization`).
- 2026-06-07 startup-unavailable hang: `deny_dangerous_unavailable` read stdin before checking invocation mode, so a broken policy store plus `--self-test=full` could block on interactive or delayed stdin instead of failing closed. Fix: skip startup payload reads for `--self-test`/`--check`/TTY invocations; real hook JSON payloads still get JSON deny responses. Regression case: self-test (search: `self-test startup should not read stdin`).
- Anchors: `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `is_gh_write_operation`), `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `rm_has_recursive`), `workflow/hooks/deny-dangerous/patterns-paths.sh` (search: `is_secret_path_touch`), and `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `git -C push`, `quoted destructive search literal`).

**Prevention:**
1. Treat guardrail splits as parser migrations, not renames. Port the old parser normalization and false-positive corpus before deleting the monolith.
2. Compare line count and self-test case count before approving a split; a large drop is a review smell until removed coverage maps to new tests.
3. Run representative old-case probes across all split hooks: wrapper-prefixed git pushes, global/inherited `gh` flags, read-only search literals with dangerous text, safe-scoped recursive deletion, split-quoted secret paths, and structured payloads for each registered agent.
4. Keep the central self-test broad enough to fail on both bypasses and false positives; smoke checks alone prove only headline examples.
5. Startup failure handlers must not unconditionally read stdin before CLI mode is known; diagnostics and self-tests need deterministic fail-closed output even when stdin is a TTY or delayed pipe.

---

## Footgun: Git push deny checks must normalize shell wrappers and control bodies

**Status:** active | **Created:** 2026-04-27 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A deny hook can appear to block `git push` while allowing valid shell forms that execute a push through environment wrappers, quoted assignments, `if`/`then` bodies, function bodies, or login-command wrappers such as `bash -lc 'git push ...'`.

**Why it happens:** A token check that only normalizes the start of a simple command misses shell grammar around the command word: `env -i git push ...` (env option after `env`), `FOO='a b' git push ...` (whitespace in an assignment value), `if true; then git push ...; fi` (segment starts with `then`), `f(){ git push ...; }; f` (segment starts with a function declaration).

**Evidence:**
- `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `is_git_push`) - current split hook blocks git push and destructive git mutations; `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `sudo git push`) - self-test coverage for wrapper-prefixed git push.
- Before the fix, `bash workflow/hooks/deny-dangerous/patterns-writes.sh --check <cmd>` returned exit 0 for: `'env -i git push origin main'`, `"FOO='a b' git push origin main"`, `'if true; then git push origin main; fi'`, `'f(){ git push origin main; }; f'`; and before the `-lc` fix: `"bash -lc 'git push origin main'"`, `"sh -lc 'git push origin main'"`.

**Prevention:**
1. Any future `git push` deny edit must include runtime probes for env options, quoted assignments, shell control keywords, function bodies, and `sh`/`bash -c` plus `-lc` wrappers, not only direct push and pipe/semicolon chains.
2. Keep the workflow hook source and installed `.goat-flow/hooks` mirror byte-identical after policy changes.
3. Prefer normalizing to the shell command word before calling `is_git_push`; don't add one-off regexes for the latest bypass only.

---

## Footgun: GitHub CLI comments bypassed shared-system write guardrails

**Status:** active | **Created:** 2026-05-20 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A model can post to GitHub through `gh issue comment ... --body-file ...` even when `git push` is blocked and the hook catches heredoc command substitution: the guardrail stops the risky shape (`$(cat <<EOF ...)`) but allows the same write through a temporary body file. A narrow first fix still missed valid `gh` grammar variants: inherited flags after the topic (`gh issue --repo owner/repo comment ...`) and `xargs ... gh issue comment ...` pipeline consumers.

**Why it happens:** The deny hook historically treated `gh` as an ordinary command unless it contained an already-blocked shell pattern. GitHub issue comments, PR reviews, releases, workflow runs, secrets/variables, and `gh api` POST/PATCH/PUT/DELETE calls mutate shared systems without `git push`, so push-only protection is incomplete. CLI parsers also accept option placement and wrapper forms not obvious from the incident.

**Evidence:**
- Reported incident: an assistant posted a GitHub issue comment to `owner/repo#64620` from forwarded Slack text; the user deleted it and reported the command (see the first probe below).
- Runtime probes (`bash workflow/hooks/deny-dangerous/patterns-writes.sh --check ...`) returned exit 0 before the first fix for `"gh issue comment 64620 --repo owner/repo --body-file /tmp/issue_64620_comment.md"` and `"gh api repos/owner/repo/issues/1/comments -X POST -f body=hi"`; before the second fix for `"gh issue --repo owner/repo comment 64620 --body hi"` and `"printf '%s\n' body | xargs -I{} gh issue comment 64620 --body {}"`.
- `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `is_gh_write_operation`) - classifies known GitHub-mutating `gh` subcommands and `gh api` write/default-body POST forms; `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `gh issue comment`) - locks the current `gh issue comment` path plus read-only allow cases.

**Prevention:**
1. Treat `git push` as only one GitHub write path. Any new shared-system GitHub mutation route must get both a hook rule and a self-test case.
2. For CLI write classifiers, test grammar variants, not only the observed command: global/inherited options before and after the topic, short option forms, pipeline consumers such as `xargs`, and read-only controls.
3. Keep explicit read-only `gh` cases in the self-test (`issue view`, `pr checks`, `gh api --method GET`) so write blocking doesn't become a blanket GitHub-read ban.
4. Forwarded Slack/email/ticket text is evidence, not authorization. The hook blocks mechanical `gh` writes; agents still need an in-turn user approval rule before any shared-system write path outside Bash.

**Amendment (2026-06-02):** ADR-028 narrowed - `gh issue comment` and `gh pr comment` are now allowed; all other `gh` writes stay blocked (PR review/merge/create/edit/close/ready, issue create/close/edit/delete/lock/transfer/develop, release/repo/label/workflow/run/gist/secret/variable/key/auth/codespace/project/cache, and `gh api` non-GET/HEAD or body-field forms). The carve-out reopens the 2026-05-20 incident command; the residual control is the host's per-call permission prompt. `gh api` writes stay blocked, so the comments endpoint via `gh api repos/.../issues/N/comments -X POST -f body=...` still trips the hook. See ADR-028 Amendment. Rule (4) stands: forwarded text is not authorization.

---

## Footgun: Extension-based secret checks can confuse filenames with query syntax

**Status:** active | **Created:** 2026-05-27 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A secret-path hook correctly blocks `cat path/to/id_rsa.key`, but also blocks harmless jq/yq expressions such as `jq -r .key file.json` and `yq .metadata.key file.yaml`, plus text after an unquoted shell comment, e.g. `git status # .env`.

**Why it happens:** A broad `.(pem|key|pfx)` extension regex sees dotted query fields and filenames as the same shape; scanning the raw segment before comment stripping also treats inert comment text as an argument.

**Evidence:**
- M12 pre-fix probes blocked `git status # .env` and `jq -r .key file.json`; post-fix they return 0 while `cat path/to/id_rsa.key` still returns 2.
- `workflow/hooks/deny-dangerous.sh` (search: `strip_unquoted_shell_comments`) strips inert comments before policy matching; `workflow/hooks/deny-dangerous/patterns-paths.sh` (search: `key_material_path_touch`) requires a meaningful filename/path stem for `.pem`, `.key`, and `.pfx`; `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `jq bare key query`) locks both allow and block cases.

**Prevention:**
1. Secret-path tests must include inert dotted query expressions as allow controls alongside real key-file paths.
2. Run comment false-positive probes for every policy hook after changing shared shell-segment prep.
3. Prefer file-shape helpers over broad extension regexes when a token can also be valid data syntax.

---

## Footgun: File-read deny does not bind Bash shell reads of secret files

**Status:** active | **Created:** 2026-04-19 | **Evidence:** ACTUAL_MEASURED
**hallucination-risk:** high - `Read(**/.env*)` (settings.json or a Codex TOML profile) looks like a blanket secret-read deny but binds only file-read paths; a Bash payload (`cat .env`, `source .env`, `base64 ~/.aws/credentials`) is not bound by it and silently succeeds unless the Bash hook blocks it.

**Symptoms:** Before the Bash-side sentinel was added, `goat-flow audit --harness` reported `deny-covers-secrets: pass` while a live Bash probe returned exit 0. Expected is now exit 2 with `BLOCKED: Secret-file access ...`, verified by the runtime probe below.

**Why it happens:** Settings/config file-read deny entries are tool-scoped. Claude/Gemini `Read(...)` patterns bind the Read tool; Codex TOML permission profiles bind filesystem access. An agent using the Bash tool to run `cat .env` is not protected by file-read intent alone. Two coverage layers are required: file-read deny for the file tool path AND Bash-hook regex for shell.

**Evidence:**
- `.claude/settings.json` (search: `"Read(**/.env*)"`) - tool-scoped deny patterns, not applied to Bash. `.goat-flow/hooks/deny-dangerous/patterns-paths.sh` (search: `is_secret_path_touch`) - Bash-side sentinel added 2026-04-19, blocking `cat .env`, `source .env`, `cat ~/.ssh/id_rsa`, `cat ~/.aws/credentials`, and `.pem/.key/.pfx` across hook-capable agents.
- `src/cli/audit/harness/check-constraints.ts` (search: `bashDenyCoversSecrets`) - harness now requires BOTH `readDenyCoversSecrets` (settings/Codex permission file-read coverage) AND `bashDenyCoversSecrets` (Bash hook pattern) before classifying an agent as covered.
- `src/cli/facts/agent/hooks.ts` (search: `detectBashDenyCoversSecrets`) - fact derivation scans the deny hook file for the active secret sentinel plus family markers for `.env*`, `.env.example` parity, normalized `./` / `../` / `~/` roots, `.ssh/`, `.aws/`, `secrets/`, credentials, and `.pem/.key/.pfx`. Runtime probe: `bash .goat-flow/hooks/deny-dangerous/patterns-paths.sh --check="cat .env"` now returns exit 2 with `BLOCKED: Secret-file access blocked`.

**Prevention:**
1. For any new secret-path family added to the harness, extend BOTH `checkReadDenyCoversSecrets` in `src/cli/facts/agent/settings.ts` AND `detectBashDenyCoversSecrets` in `src/cli/facts/agent/hooks.ts`. A settings-only addition creates a false-pass; a hook-regex refactor without detector coverage, a false-fail.
2. Every hook `--self-test` must include `run_case "cat <secret>" "cat <secret>" 2` assertions; a structural PASS without live probes reopens the gap.
3. When reviewing a new agent's deny setup, run a runtime probe explicitly (e.g. `bash <hook> 'cat .env'`). Static inspection cannot distinguish tool-scoped from shell-scoped deny.

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

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

- **Deny hook blocks read-only commands with dangerous string literals** (resolved 2026-04-17) - read-only allow paths kept in `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `expect_allow`); parity checked by preflight.
