---
category: deny-writes
last_reviewed: 2026-09-26
---

External-write traps: pushes, GitHub mutations, and other side effects that leave the machine. They bypass local file guards, so the deny surface is the only control.

Sibling buckets: `deny-shell.md`, `deny-secrets.md`.

## Footgun: Git push deny checks must normalize shell wrappers and control bodies

**Status:** active | **Created:** 2026-04-27 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 4 | **Latest occurrence:** 2026-09-20

**Prevention:**
1. Normalize to the command word before calling `is_git_push`, and read "command word" as every unquoting layer the target program applies, not only the shell's. Do not add one-off regexes for the latest bypass.
2. Probe every push-deny edit at runtime with env options, quoted assignments, `if`/`then` bodies, function bodies, `sh`/`bash -c` and `-lc` wrappers, and Git alias values.
3. Keep the workflow hook source and the installed `.goat-flow/hooks` mirror byte-identical after policy changes.
4. Fail closed when wrapper option arity is unknown, and apply the full policy to each pipeline stage. Preserve `xargs` context: its input can supply recursive-delete targets absent from the visible payload.
5. Parse the entire provider response as one JSON object. A nested denial must terminate the parent even when the provider requires exit 0; finding a deny substring does not exclude a later allow.

**Symptoms:** The hook blocks a direct `git push` and allows the same push through `env -i`, a quoted assignment such as `FOO='a b'`, an `if true; then ... fi` body, a function body, `bash -lc '...'`, or a Git alias whose value carries a second quoting layer.

**Why it happens:** A token check that normalizes only the start of a simple command misses shell grammar around the command word. Git also runs an alias through its own `split_cmdline`, which removes a second layer of quotes, so `git -c 'alias.publish="push"' publish` reached the guard as the unrecognised word `"push"` while the unquoted form denied.

**Evidence:** `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `is_git_push`) blocks push and destructive Git mutations, and (search: `normalize_git_alias_expansion`) decodes the complete alias, including quoted flags, while read-only aliases remain allowed; `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `sudo git push`) covers wrapper prefixes. Before the 2026-04-27 fix, `--check` returned exit 0 for `env -i git push origin main`, `FOO='a b' git push origin main`, `if true; then git push origin main; fi`, `f(){ git push origin main; }; f`, and the `-lc` wrappers. On 2026-08-19 at `81636441`, alias values `"push"`, `'push'`, `"send-pack"`, `pu"sh"`, and `"!git push origin main"` all returned exit 0 before the alias fix.

**Recurrence 2026-09-20:** Attached nice options and accepted long-option abbreviations in timeout, stdbuf, setsid, ionice, taskset and xargs reached a harmless printf payload but hid denied commands from the classifier. `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `normalize_command_candidate`), (search: `prepare_segment_context`) now propagates uncertain arity and checks complete pipeline-stage policy. VERIFY caught two incomplete repairs: peeling xargs lost stdin-supplied recursive-delete targets, and checking only downstream uncertainty missed supported nice options. Retain the outer xargs candidate while inspecting nested wrappers, and run both full policy corpora after each change. `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `additional wrapper Git write payload`), (search: `additional downstream wrapper destructive payload`) pins the new denials beside read-only controls.

**Recurrence 2026-09-20:** The pipeline subshell contained provider denial's successful exit, so Antigravity received deny followed by allow and Git pipeline probes produced duplicate deny objects. Both full self-tests still passed because they searched for a deny substring. Retaining the original xargs payload also left `xargs nice -n1 git commit -m fix` and `xargs timeout --signal=TERM 5 git commit -m fix` allowed. `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `wrapper_pipeline_output`) forwards the nested decision and exits the parent; (search: `xargs_prefix`) retains xargs options and stdin-target semantics around the normalized child. `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `provider_json_matches`), (search: `nested xargs stdin deletion targets`) pins whole-response parsing, the reproduced denials and harmless literal controls. The new assertions failed seven cases before the runtime repair and passed afterwards.

---

## Footgun: Git publication policy omitted the http-push verb

**Status:** active | **Created:** 2026-09-25 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Check lower-level remote-ref writers against `is_git_publication_target` when changing the publication guard; test direct and alias forms beside a read-only Git control.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 2 | **Latest occurrence:** 2026-09-25

**Prevention:** Keep the publication verb set aligned with Git commands that update remote refs. For each newly covered verb, classify a direct write, an alias expansion and an adjacent read-only control with both the canonical and installed hook suites.

**Symptoms:** Both installed hooks returned exit 0 for `git http-push --force https://example.invalid/repo.git main`, and the Git policy also allowed an alias expanding to that command. The same policy denied `git send-pack origin main` with exit 2. Git 2.43's `git-http-push` manual says the command updates a remote branch and `--force` disables its fast-forward check; the executable is installed in this workspace. No remote command was executed during classification.

**Why it happens:** `is_git_publication_target` listed `push`, `send-pack` and shell aliases as publication targets, so a third installed Git ref publisher missed the hook's developer-only publication rule.

**Evidence:** `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `is_git_publication_target`) now includes `http-push`; `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `git http-push publication`) pins the direct write beside alias and read-only controls. The [Git 2.43 manual](https://git-scm.com/docs/git-http-push/2.43.0.html) describes the remote-ref write.

**Recurrence 2026-09-25:** The same classifier still allowed `git svn dcommit` and `git p4 submit`, which publish through optional Git bridges. `is_git_publication_target` now names both, and the corpus (search: `Git SVN publication`) tests direct and alias forms beside `svn fetch` and `p4 sync` controls. The local hook verdict was measured; bridge execution was not available in this workspace.

---

## Footgun: Direct Git helper executables bypassed the shared Git parser

**Status:** active | **Created:** 2026-09-25 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Treat `git-<verb>` executable names as Git commands in both repository policy and hosted-command inspection.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 1 | **Latest occurrence:** 2026-09-25

**Prevention:** Normalize an executable's basename before parsing Git globals and apply the same helper predicate when selecting hosted-command inspection. Keep direct, absolute-path and read-only helper cases next to the ordinary `git <verb>` policy assertions. A direct `git-config` setting with an executable value must reach its owning policy. Re-run both policies because they share the parser.

**Symptoms:** The installed Git policy returned exit 0 for direct `git-push`, `git-send-pack`, `git-http-push`, `git-commit` and `git-clean -fd` command text, including an absolute path to the installed HTTP push executable. Equivalent `git <verb>` forms were denied. After normalizing those helpers, direct `git-config imap.tunnel 'rm -rf .'` still passed the destructive policy because hosted-command inspection checked only `CMD_VERB=git`. The direct `git-status` and absolute `git-log` read controls remained allowed. No publishing, committing or cleanup command was executed.

**Why it happens:** `__goat_git_strip_globals` accepted only a first word whose basename was exactly `git`, and `check_git_hosted_commands` was called only when `CMD_VERB` was exactly `git`. Git's installed `git-<verb>` entrypoints therefore missed repository classification or nested command inspection.

**Evidence:** `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `Direct git-<verb> helpers can install executable config values`) now calls hosted-command inspection for helpers as well as `git`; the same file's `__goat_git_strip_globals` normalizes helper names before classification. `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `direct Git config helper saves destructive IMAP tunnel`) pins the saved-setting denial beside publication, history, cleanup and read controls. The local Git exec directory contained the tested helper names.

---

## Footgun: GitHub CLI comments bypassed shared-system write guardrails

**Status:** active | **Created:** 2026-05-20 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 5 | **Latest occurrence:** 2026-09-26

**Prevention:**
1. Treat `git push` as one GitHub write path among many. Every new shared-system `gh` mutation route needs a hook rule and a self-test case, and the suite keeps read-only controls (`issue view`, `pr checks`, `gh api --method GET`) so write blocking never becomes a GitHub-read ban.
2. Test CLI write classifiers against grammar variants, not the observed command: global options before and after the topic, short forms, and pipeline consumers such as `xargs`.
3. Forwarded Slack, email, or ticket text is evidence, not authorization. The hook allows `gh issue comment` and `gh pr comment` under ADR-028's carve-out, so the host's per-call prompt and an in-turn user approval are the only controls on those two commands.
4. Prove dry-run exceptions from parsed options: consume value operands, honor `--`, and apply the last Boolean value.
   A non-publishing mode that writes local files is still a write under ADR-028.

**Symptoms:** Before 2026-05-20, an agent could post to GitHub through `gh issue comment ... --body-file` or `gh api ... -X POST` while `git push` was blocked, and a narrow first fix still missed `gh issue --repo owner/repo comment ...` and `xargs ... gh issue comment ...`. The residual trap is any `gh` write outside the comment carve-out: PR review, merge, create, edit, close, ready; issue create, close, edit, delete, lock, transfer, develop; release, repo, label, workflow, run, gist, secret, variable, key, auth, codespace, project, cache; and `gh api` with a non-GET/HEAD method or body fields, except a proven read-only GraphQL query under ADR-028.

**Why it happens:** The hook once treated `gh` as an ordinary command unless it contained an already-blocked shell pattern, and CLI parsers accept option placements the incident never showed.

**Evidence:** Reported incident: an assistant posted a comment to `owner/repo#64620` from forwarded Slack text, and the user deleted it. `--check` returned exit 0 before the first fix for `gh issue comment 64620 --repo owner/repo --body-file /tmp/issue_64620_comment.md` and `gh api repos/owner/repo/issues/1/comments -X POST -f body=hi`, and before the second fix for `gh issue --repo owner/repo comment 64620 --body hi` and `printf '%s\n' body | xargs -I{} gh issue comment 64620 --body {}`. `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `is_gh_write_operation`) classifies the mutating subcommands and `gh api` write forms; `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `gh issue comment`) locks the carve-out allow cases beside the write blocks. ADR-028 was narrowed on 2026-06-02 because conversation comments are low-blast-radius and reversible; `gh api` comment writes stay blocked.

**Recurrence 2026-09-25:** Local classifier probes allowed `gh discussion comment` and `gh agent-task create`, including `agent` and `agents` aliases. These are outside ADR-028's issue/PR comment exception. The write table now covers them while their view/list controls remain allowed: `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `discussion:comment`, `agent-task:create`) and the shared corpus (search: `gh agent-task create`). No remote mutation was executed.

**Recurrence 2026-09-25:** The classifier also allowed gist renames, codespace rebuilds, port visibility changes and skill publishing.

- `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `gh_skill_publish_is_dry_run`) now proves validation-only flags before allowing publish.
- `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `expect_notes_and_github_write_modes`) pairs writes with reads and flag controls.
- All new denial cases failed before repair and passed afterward; no remote writes ran. Skill `--fix` remains a local write, not a read exception.
- A follow-up probe found the same gap through GitHub's `cs` alias; alias reads and writes now share the codespace cases.

**Recurrence 2026-09-25 (Codespace filesystem):** `gh codespace cp README.md remote:/tmp/review-write` and `gh codespace ssh -- touch /tmp/review-write`, including the `cs` alias, passed both installed hooks. Local `gh codespace cp --help` says copies can target the remote filesystem, and `ssh --help` accepts a remote command. `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `gh_codespace_ssh_is_config_only`) now blocks copies and interactive or command-bearing SSH. `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `codespace remote shell command`) keeps configuration output and usage available. No Codespace command was executed.

**Recurrence 2026-09-26 (aliases, settings, and unknown topics):** The write table was a denylist that ended in "allow", so `gh alias set`/`import`/`delete`, `gh config set`, `gh auth switch`, `gh repo autolink create`/`delete`, built-in spellings (`issue`/`pr`/`repo`/`gist`/`release new`, `variable remove`, `ext`/`skills`/`agent-tasks` shorthands, `extension exec`), and any unrecognised first word (a saved alias or extension, or a case-changed topic) all passed. gh runs a saved alias or installed extension for any non-built-in word and cannot show the hook what it will run. `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `is_gh_builtin_topic`) now fails closed on any first word outside the gh manual's command set, normalises the built-in shorthands, and adds the alias/config/auth-switch/autolink write cases; the built-in list is the enumerated surface to extend when gh ships a new command. `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `saved gh alias invocation`) pairs each block with its read-only control (`alias list`, `config get`, `auth status`, `ext list`). No remote mutation ran.

---

## Footgun: HTTP method alone cannot classify GraphQL reads and writes

**Status:** active | **Created:** 2026-09-20 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Prove the literal GraphQL operation before applying the REST method rule, and verify the saved installed launcher as well as the classifier.
**Trigger phase:** ACT
**hallucination-risk:** high

**Prevention:** Parse the complete literal document with the bundled standard parser. Permit exactly one query operation with resolved, acyclic fragments; reject mutations, subscriptions, mixed operations, malformed documents and unresolved input. GET/HEAD does not prove a GraphQL read. Keep allowed Discussions reads beside denied mutations in both classifier tests and registered-launcher replay. Installed replay is not evidence that a provider delivered a live tool call to the hook.

**Symptoms:** The original `gh api graphql -f query=...` Discussions read exited 2 with `GitHub write via gh is blocked`, while `gh issue list` exited 0. This prevented access to discussion bodies and comments even though the operation was read-only.

**Why it happens:** `gh api` uses POST when given body fields. The REST classifier treated those fields as a write without inspecting the GraphQL operation. Allowing GraphQL solely because the caller selects GET would make the opposite mistake.

**Evidence:** `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `is_gh_api_write`) delegates GraphQL classification before its REST rules; `workflow/hooks/gh-graphql-read.cjs` (search: `isReadDocument`) proves the query. `test/integration/deny-git-graphql.test.ts` and `test/unit/gh-graphql-read.test.ts` pin the operation boundary. `test/unit/audit-command/agent-deny-hooks.test.ts` (search: `allows quoted repository evidence while the registered hook still blocks repository writes`) replays the saved Codex launcher without sending the mutation to GitHub. `.goat-flow/learning-loop/decisions/ADR-028-github-cli-mostly-read-only-except-comments.md` owns the policy exception.

**Recurrence 2026-09-25:** Saving an allowed API read with shell redirection made the filename look like a request operand and caused a deny. Separate unquoted redirections before classifying the request; retain quoted operators as data and refuse unresolved redirect syntax. Evidence: `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `strip_shell_redirections`) and `test/integration/deny-git-graphql.test.ts` (search: `bodies.txt`). REST and GraphQL read controls stay allowed, while redirected mutations remain denied.

---

## Footgun: Git alias expansions bypass every guarded form the parser does not record

**Status:** active | **Created:** 2026-09-15 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Every guarded Git class reads the recorded alias expansions as well as the visible subcommand, and an unrecognised first word resolves through one bounded `git config --get alias.<word>` lookup before classification.
**Trigger phase:** ACT
**hallucination-risk:** high
**Incident count:** 8 | **Latest occurrence:** 2026-09-26

**Prevention:**
1. Classify the complete decoded alias expansion, never the invoked word alone: route every `-c alias.<name>=<expansion>` operand through `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `record_git_alias_config`, `normalize_git_alias_expansion`) so publication, commit and destructive expansions each set their own flag, and let `record_git_persistent_alias` resolve a saved alias when the first word is not a Git builtin. Decode quoting in flags as well as the command word.
4. Cover every builtin that relocates git's config source or hosts a git command, not only the forms already listed: treat `declare`/`typeset`/`readonly`/`local`/`for`/`+=` targeting an ambiently-exported config-source name as unresolved, accept `+=` in the assignment-prefix regexes, and inspect each command-hosting Git environment variable value with the same policy as its `-c` config key.
2. Add a denied alias case and a neighbouring benign alias control for each guarded class in `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `git alias commit`), and give saved-alias fixtures their own `GIT_CONFIG_GLOBAL` file so no result depends on the host's aliases.
3. Keep the canonical modules and the installed `.goat-flow/hooks/deny-dangerous` mirror byte-identical, and list every new parser helper in the runtime's required-function check so a partially installed store fails closed instead of allowing.

**Symptoms:** On 2026-09-14 at `55233485`, `git -c alias.c=commit c -m x`, `git -c alias.nuke='reset --hard' nuke`, `git -c 'alias.wipe=clean -fdx' wipe` and a saved `record = commit` alias all exited 0 under `deny-git-mutations` while the direct commands exited 2; push aliases already denied.

**Why it happens:** `__goat_git_strip_globals` recorded only publication expansions in `__goat_git_aliased_push`, so `is_git_commit` and `is_git_destructive` compared the invoked word alone, and nothing read aliases saved in Git config. Git ignores an alias that shadows a builtin, so the lookup skips builtins; shell-form `!` aliases keep the existing publication denial, including benign ones.

**Evidence:** `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `record_git_persistent_alias`) and `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `is_git_commit_target`) hold the repair; `test/integration/deny-dangerous-policy.test.ts` (search: `persistent Git aliases`) and the corpus cases above pin both the denials and the allow controls.

**Recurrence 2026-09-17:** A saved commit alias denied in its own repository but allowed when the command selected it with `git -C` or `--git-dir`.
The lookup discarded the selected repository and temporary config. Retain those options for the read-only lookup and pair denied aliases with reads.
Evidence: `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `alias_config_options`) and
`workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `selected repository commit alias`, `temporary config overrides saved alias`).

**Recurrence 2026-09-18:** `git -c 'alias.nuke=reset "--hard"' nuke` and `clean "-fdx"` aliases returned 0 while their unquoted controls returned 2. The helper stripped quotes only from the first word. Complete inert word decoding now denies both forms and retains quoted `status "--short"` inspection. Evidence: `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `normalize_git_alias_expansion`) and the corpus (search: `git alias quoted hard-reset argument`, `saved alias quoted forced-clean argument`).
**Recurrence 2026-09-25:** An alias that expands to another Git global-option sequence concealed commit and push aliases. Replay each expansion as a complete Git command, retaining the selected repository, temporary config and arguments, with the existing recursion bound. `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `__goat_git_global_words`, `expanded_alias`) owns the reconstruction; `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `nested alias commits`, `nested alias reads`) pairs the denied writes with a status control.
**Recurrence 2026-09-26:** Both installed hooks allowed a saved publication alias selected by visible `HOME`, `XDG_CONFIG_HOME`, or `GIT_DIR` assignments; the Git hook also allowed it after `cd` into the alias-owning repository. The lookup used the hook's environment and cwd instead of the proposed command's. `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `record_git_persistent_alias "$__goat_git_rest" -C`) now uses the tracked literal shell directory, refuses an unresolved dynamic directory for an unknown Git word, and refuses the tested config-source selectors; the corpus (search: `HOME-selected saved publication alias`, `saved read alias after shell cd`) pairs denials with ordinary commands and a read alias.
**Recurrence 2026-09-26 (config-source tracker and denial label):** Beyond that saved-alias selector fix, a separate cross-segment route stayed open: `GIT_COMMON_DIR`, `local -x GIT_CONFIG_*`, bare `HOME=x; git`, split `GIT_DIR=…; export GIT_DIR; git`, `read`/`printf -v` into a config variable, and `{ … }` or subshell forms each reached git with relocated config, and a git-alias-after-`cd` denial in `deny-dangerous` mislabelled `Policy secret`. `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `track_git_config_environment`) now flags config-source assignments across chained and grouped segments, riding the subshell push/pop stack `track_git_shell_directory` already maintains so an isolated `(HOME=x); git` stays allowed while `(HOME=x; git)` is denied; the alias-after-cd and nesting-depth denials reset scope to destructive. `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `bare HOME reassignment relocates config`, `isolated subshell HOME assignment`) pairs each block with a prefix and isolated-subshell allow control. Local classifier results; no Git command ran.
**Recurrence 2026-09-26 (builtin config-source forms and command-hosting env vars):** Two sibling routes survived the tracker fix above. First, `declare`/`typeset`/`readonly HOME=x`, `for HOME in …; do git`, and `HOME+=x` (chained and prefix) kept HOME exported and relocated config while the tracker recorded only bare, `export`, `read` and `printf -v` forms. Second, command-hosting Git environment variables (`GIT_EXTERNAL_DIFF`, `GIT_PAGER`/`PAGER`, `GIT_SSH_COMMAND`, `GIT_EDITOR`, `GIT_SEQUENCE_EDITOR`, `GIT_PROXY_COMMAND`, `GIT_ASKPASS`) ran a commit or publication value uninspected though the matching `-c core.pager`/`diff.external` keys already denied. `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `git_config_source_variable_is_ambiently_exported`, `check_git_command_environment`) now flags the exported builtin forms and inspects each env value like its `-c` config key, and `strip_one_assignment_prefix` accepts `+=`; the corpus (search: `declared HOME reassignment keeps an exported target`, `external diff environment variable hosts destructive shell`) pairs each denial with an unexported-declare and safe-value allow control, and `git-mutations-hook` gains a `repository-environment-command` scenario (`src/cli/hooks-runtime-evidence.ts`). Local classifier results; no Git command ran.


## Footgun: Ordinary hook persistence can inherit an off choice from a different policy

**Status:** active | **Created:** 2026-09-18 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Ordinary hook writes preserve a missing policy's default; only explicit upgrade migration records inherited choices.
**Trigger phase:** ACT
**hallucination-risk:** high

**Prevention:** Keep inheritance in explicit migration and installer upgrade preparation. Generic `setHookEnabled` and `prepareHookConfig` must preserve missing/default-on and explicit Git choices, even when another policy is off. Verify current-installed Sync and an unrelated toggle with the Git key absent; an ownership-byte review is not a substitute for this persistence check.

**What happened:** With current trusted policy files, `deny-dangerous: {enabled: false}` and no Git choice, reads reported Git protection on. An unrelated toggle and Sync saved `deny-git-mutations: {enabled: false}` and disabled protection without a policy review. The preparation code inherited the sibling's off choice; unchanged ownership bytes bypassed upgrade review.

**Evidence:** `src/cli/config/writer.ts` (search: `setHookEnabled`, `prepareHookConfig`, `migrateGitHookChoice`), `workflow/install-goat-flow.sh` (search: `configuredHookEnabled`, `insertHookEntry`) and `test/integration/hook-effective-state.test.ts` (search: `preserves a missing Git choice during current-installed`). The five fresh persistence regressions failed before inheritance was removed from generic actions and passed afterward; explicit migration and later independent toggles remain covered in `test/unit/config-writer.test.ts` (search: `inherits the Git choice once`).

## Footgun: The Git commit guard lists verbs by name, so an unlisted history writer passes

**Status:** active | **Created:** 2026-09-23 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Classify history writers in one set; grant exact non-writing modes only after checking the alias expansion and appended arguments.
**Trigger phase:** ACT
**hallucination-risk:** high
**Incident count:** 11 | **Latest occurrence:** 2026-09-25

**Prevention:**
1. When a Git command can create, rewrite or move history, including notes refs, add it to `__goat_git_history_verbs` in `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `is_git_commit_target`) with a denied corpus case and a neighbouring allowed control.
2. Write exemptions as exact allowlists (search: `git_arguments_are_one_of`, `git_flags_within`), never "flag appears anywhere". Git accepts abbreviated and negated long options (`git merge -h` lists `--[no-]squash`, `--[no-]commit`, `--[no-]ff`), and a quoted value such as `-m 'x --abort'` reaches the classifier as separate words.
3. `merge --no-commit` alone still fast-forwards; only `--squash` or `--no-ff --no-commit` leaves HEAD in place.
4. `git reset --soft HEAD~3`, `git branch -f main HEAD~3`, `git checkout -B main HEAD~2`, `git switch -C main HEAD~2` and fetch refspecs or refmaps targeting local branches all move refs. Classify those forms beside other history writers; stdin-fed fetch refspecs cannot be inspected. Preserve index-only resets and ordinary fetches.
5. Name the blocked verb in the denial (search: `git_history_block_reason`) so the agent asks the developer for that operation, not for a commit. A lone `-h` or `--help` is exempt because it only prints usage.
6. Match a flag the way Git parses it, inside a short bundle or as a unique long prefix (search: `git_option_present`), including `--pathspec-fr` for `--pathspec-from-file`. Treat a whole-tree, directory, exclusion or glob magic, `*` or `?` glob, parent, pathspec-file or command-substitution argument as bulk (search: `git_pathspecs_name_bulk`). Carry literal `cd` and `git -C` paths into directory checks; unresolved directory changes require a refusal for `restore` and `checkout --` pathspecs (search: `track_git_shell_directory`). Normalize internal `.` and `..` components before classifying scope: `src/..` covers the current tree, while `src/../README.md` stays targeted. A `[` class alone stays targeted, because it names dynamic-route files such as `app/[id]/page.tsx`. Classify an alias invocation as its expansion plus the arguments Git appends (search: `resolve_git_invoked_alias_command`).
7. Treat these as known gaps (measured 2026-09-23): arguments supplied through `xargs` or `find` stdin, a quoted pathspec that contains a flag spelling, a variable pathspec other than `$PWD` or `$HOME`, a command substitution before `--` in `checkout`, and environment-backed alias overrides. `reflog expire -n` and `filter-repo --analyze` deny conservatively.

**Symptoms:** `804d98d8` (2026-09-21) added `commit-tree`, `update-ref`, `cherry-pick`, `revert` and `am`. A PR #61 review on 2026-09-22 showed `git merge topic`, `git rebase main` and `git pull --no-rebase origin main` still exited 0 under `deny-git-mutations.sh --check`; reproduced on 2026-09-23 at `86f211d0`. Later on 2026-09-23, a quality-assessment payload replay at `53641821` found `filter-branch`, `filter-repo` and `fast-import` exiting 0 on both deny hooks, and every history denial telling the agent to ask for a commit, including `pull` and `rebase`. An adversarial review of that fix then found exact-word matching missing `checkout -fq`, `switch --discard`, `restore ':(top)'` and alias arguments such as `git -c alias.x=stash x clear`. A false-positive replay of 575 shapes against the HEAD policy then showed the widened glob rule denying single route files such as `git restore "app/[id]/page.tsx"`, and a blanket `:` rule denying `:(literal)` and root-anchored single files.

**Why it happens:** The commit class is a list of verbs, so coverage ends at the verbs someone remembered. The old exemptions matched `-n`, `--abort` or `--quit` anywhere in the joined arguments, so they could not rule out an abbreviation, negation or message value.

**Evidence:** `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `__goat_git_history_verbs`, `git_flags_within`) and `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `merge creates history`, `exempt merge alias with appended negation`, `filter-branch rewrites history`, `rebase reason`).

**Recurrence 2026-09-24:** `git restore src/..`, `git checkout -- src/..` and `git restore --pathspec-from-f=paths.txt` exited 0. Git's read-only `ls-files` selected the same tracked paths for `src/..` and `.`. `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `git_pathspecs_name_bulk`) now folds internal parent components and reuses the option-prefix matcher. `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` covers (search: `restore of an internal parent path`), (search: `abbreviated attached pathspec file restore`), single-file restores and index-only controls.

**Recurrence 2026-09-25:** The installed classifier returned exit 0 for the four branch-moving commands in Prevention 4, `git fetch origin +main:main`, `git rm -rf .`, `git restore src`, `git checkout -- src`, `git checkout-index -a -f`, `git read-tree -u --reset HEAD` and `git worktree remove --force ../other`. Eleven new full-corpus assertions failed before repair; three more failed for directory paths after `git -C src`. `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `git_fetch_moves_local_ref`, `git_pathspecs_name_bulk`, `is_git_destructive_target`) and `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `__goat_git_selected_directory`) now guard the measured forms and appended alias arguments. `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `soft reset moves branch history`, `directory restore after Git changes directory`) pairs denials with index-only, dry-run, ordinary fetch, branch-switch and single-file controls. The expanded Git corpus then passed all 414 executed checks.

**Recurrence 2026-09-25:** Review of that repair found `git fetch --refmap +refs/heads/main:refs/heads/probe-branch origin main` and `git fetch --stdin origin` exiting 0, while `git fetch --depth 1` with an SSH remote and `git fetch --multiple` with two remotes were falsely denied. Git's `fetch --dry-run` printed `[new branch] main -> probe-branch` for the separated refmap. Five paired assertions failed before `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `git_fetch_moves_local_ref`, `git_fetch_refspec_moves_local_ref`) began consuming separated option values and refusing uninspectable stdin refspecs. Abbreviated `--refm` and `--std` forms joined the corpus after Git accepted them locally.

**Recurrence 2026-09-25:** The directory guard also allowed `cd workflow && git restore hooks`, an absolute directory pathspec after `git -C workflow`, and `TARGET=workflow; cd "$TARGET" && git restore hooks`; a backgrounded `cd` made the first tracking repair incorrectly allow a later root-level directory restore. Its raw ampersand check then falsely denied a single-file restore followed by quoted `&`. `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `track_git_shell_directory`, `__goat_git_chain_directory_ambiguous`) now carries literal directory changes and uses the quote-aware splitter to mark real background operators. `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `__goat_git_pathspec_unknown_directory`) refuses uncertain restore and `checkout --` pathspecs with a specific reason. The same review found `git reset HEAD`, `git reset --mixed HEAD` and `git reset HEAD src/app.ts` falsely denied; the reset branch now uses (search: `git_reset_is_index_only`). `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` pairs the denials with single-file, index-only and read-only controls (search: `quoted ampersand after shell cd`, `resetting the index to the current HEAD`); the Git corpus passed 452 executed checks afterward.

**Recurrence 2026-09-25 (quality report recheck):** The installed guard allowed `git branch -C previous main`, `git reset HEAD~3 --`, symbolic-ref writes, replacement refs, forced tag changes, forced submodule update/deinit and remote removal. Paired controls showed the long forced-copy spelling and reset without an empty separator already denied. `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `git_reset_is_index_only`, `git_symbolic_ref_is_read_only`, `is_git_destructive_target`) now requires an actual pathspec for that reset exemption and classifies the measured ref/worktree writers. The corpus (search: `empty reset pathspec still moves branch history`, `forced branch copy overwrites a ref`, `replacement graph rewrites visible history`) preserves read-only forms, index-only resets, new tags and non-forced branch copies/renames. A non-forced branch rename preserves history and remains allowed.

**Recurrence 2026-09-25:** Every tested mutating `git notes` mode passed the old classifier, including aliases and explicit notes refs.

- `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `git_notes_preserves_history`) distinguishes notes reads, previews and merge recovery.
- `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `expect_notes_and_github_write_modes`) covers writes and appended negations.
- The new denial cases failed before repair and passed afterward. Probes classified command text; no notes commits were created.

**Recurrence 2026-09-25 (worktree reset):** The installed `--check` classifier returned exit 0 for `git worktree add -B main ../other HEAD~3`, its bundled `-qBmain` spelling, and an alias to `worktree`; `git worktree add -h` defines `-B` as creating or resetting a branch. A first matcher also denied a quoted `--reason 'branch -B'` value; a disposable worktree confirmed Git treats `-B` after `--reason` as lock text. `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `git_worktree_add_resets_branch`) now reads argument boundaries before classifying the branch reset. `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `worktree add resets an existing branch`) pairs the denial with `-b`, lock-reason, `list`, and help controls. Classifier probes never ran the branch reset; the disposable worktree did not change this project's branches.

**Recurrence 2026-09-25 (stash history):** `git stash push`, `save`, `create`, `store`, `pop` and `branch` all passed the installed classifier. `git stash -h` identifies their commit, ref or branch effects; `pop` also removes a stash entry. `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `git_stash_preserves_history`) now guards those modes, including the default push and aliases, while retaining `list`, `show`, `apply` and usage. The shared corpus (search: `stash history mode`) failed on the write forms before repair and passed afterward. No stash command was executed.
