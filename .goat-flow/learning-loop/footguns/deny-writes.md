---
category: deny-writes
last_reviewed: 2026-09-24
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

## Footgun: GitHub CLI comments bypassed shared-system write guardrails

**Status:** active | **Created:** 2026-05-20 | **Evidence:** ACTUAL_MEASURED

**Prevention:**
1. Treat `git push` as one GitHub write path among many. Every new shared-system `gh` mutation route needs a hook rule and a self-test case, and the suite keeps read-only controls (`issue view`, `pr checks`, `gh api --method GET`) so write blocking never becomes a GitHub-read ban.
2. Test CLI write classifiers against grammar variants, not the observed command: global options before and after the topic, short forms, and pipeline consumers such as `xargs`.
3. Forwarded Slack, email, or ticket text is evidence, not authorization. The hook allows `gh issue comment` and `gh pr comment` under ADR-028's carve-out, so the host's per-call prompt and an in-turn user approval are the only controls on those two commands.

**Symptoms:** Before 2026-05-20, an agent could post to GitHub through `gh issue comment ... --body-file` or `gh api ... -X POST` while `git push` was blocked, and a narrow first fix still missed `gh issue --repo owner/repo comment ...` and `xargs ... gh issue comment ...`. The residual trap is any `gh` write outside the comment carve-out: PR review, merge, create, edit, close, ready; issue create, close, edit, delete, lock, transfer, develop; release, repo, label, workflow, run, gist, secret, variable, key, auth, codespace, project, cache; and `gh api` with a non-GET/HEAD method or body fields, except a proven read-only GraphQL query under ADR-028.

**Why it happens:** The hook once treated `gh` as an ordinary command unless it contained an already-blocked shell pattern, and CLI parsers accept option placements the incident never showed.

**Evidence:** Reported incident: an assistant posted a comment to `owner/repo#64620` from forwarded Slack text, and the user deleted it. `--check` returned exit 0 before the first fix for `gh issue comment 64620 --repo owner/repo --body-file /tmp/issue_64620_comment.md` and `gh api repos/owner/repo/issues/1/comments -X POST -f body=hi`, and before the second fix for `gh issue --repo owner/repo comment 64620 --body hi` and `printf '%s\n' body | xargs -I{} gh issue comment 64620 --body {}`. `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `is_gh_write_operation`) classifies the mutating subcommands and `gh api` write forms; `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `gh issue comment`) locks the carve-out allow cases beside the write blocks. ADR-028 was narrowed on 2026-06-02 because conversation comments are low-blast-radius and reversible; `gh api` comment writes stay blocked.

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

---

## Footgun: Git alias expansions bypass every guarded form the parser does not record

**Status:** active | **Created:** 2026-09-15 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Every guarded Git class reads the recorded alias expansions as well as the visible subcommand, and an unrecognised first word resolves through one bounded `git config --get alias.<word>` lookup before classification.
**Trigger phase:** ACT
**hallucination-risk:** high
**Incident count:** 3 | **Latest occurrence:** 2026-09-18

**Prevention:**
1. Classify the complete decoded alias expansion, never the invoked word alone: route every `-c alias.<name>=<expansion>` operand through `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `record_git_alias_config`, `normalize_git_alias_expansion`) so publication, commit and destructive expansions each set their own flag, and let `record_git_persistent_alias` resolve a saved alias when the first word is not a Git builtin. Decode quoting in flags as well as the command word.
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
**Decision changed:** History-writing Git verbs live in one set; each non-committing exemption accepts exact spellings only, and alias expansions get no exemption.
**Trigger phase:** ACT
**hallucination-risk:** high
**Incident count:** 4 | **Latest occurrence:** 2026-09-24

**Prevention:**
1. When a Git command can create, rewrite or move branch history, add it to `__goat_git_history_verbs` in `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `is_git_commit_target`) with a denied corpus case and a neighbouring allowed control.
2. Write exemptions as exact allowlists (search: `git_arguments_are_one_of`, `git_flags_within`), never "flag appears anywhere". Git accepts abbreviated and negated long options (`git merge -h` lists `--[no-]squash`, `--[no-]commit`, `--[no-]ff`), and a quoted value such as `-m 'x --abort'` reaches the classifier as separate words.
3. `merge --no-commit` alone still fast-forwards; only `--squash` or `--no-ff --no-commit` leaves HEAD in place.
4. `git reset --soft HEAD~3`, `git branch -f main HEAD~3`, `git checkout -B main HEAD~2` and `git switch -C main HEAD~2` also move a branch and still exit 0 (measured 2026-09-23). Treat them as known gaps, not covered cases.
5. Name the blocked verb in the denial (search: `git_history_block_reason`) so the agent asks the developer for that operation, not for a commit. A lone `-h` or `--help` is exempt because it only prints usage.
6. Match a flag the way Git parses it, inside a short bundle or as a unique long prefix (search: `git_option_present`), including `--pathspec-fr` for `--pathspec-from-file`. Treat a whole-tree, exclusion or glob magic, `*` or `?` glob, parent, pathspec-file or command-substitution argument as bulk (search: `git_pathspecs_name_bulk`). Normalize internal `.` and `..` components before classifying scope: `src/..` covers the current tree, while `src/../README.md` stays targeted. A `[` class alone stays targeted, because it names dynamic-route files such as `app/[id]/page.tsx`. Classify an alias invocation as its expansion plus the arguments Git appends (search: `resolve_git_invoked_alias_command`).
7. Treat these as known gaps (measured 2026-09-23): arguments supplied through `xargs` or `find` stdin, a quoted pathspec that contains a flag spelling, a variable pathspec other than `$PWD` or `$HOME`, a command substitution before `--` in `checkout`, and environment-backed alias overrides. `reflog expire -n` and `filter-repo --analyze` deny conservatively.

**Symptoms:** `804d98d8` (2026-09-21) added `commit-tree`, `update-ref`, `cherry-pick`, `revert` and `am`. A PR #61 review on 2026-09-22 showed `git merge topic`, `git rebase main` and `git pull --no-rebase origin main` still exited 0 under `deny-git-mutations.sh --check`; reproduced on 2026-09-23 at `86f211d0`. Later on 2026-09-23, a quality-assessment payload replay at `53641821` found `filter-branch`, `filter-repo` and `fast-import` exiting 0 on both deny hooks, and every history denial telling the agent to ask for a commit, including `pull` and `rebase`. An adversarial review of that fix then found exact-word matching missing `checkout -fq`, `switch --discard`, `restore ':(top)'` and alias arguments such as `git -c alias.x=stash x clear`. A false-positive replay of 575 shapes against the HEAD policy then showed the widened glob rule denying single route files such as `git restore "app/[id]/page.tsx"`, and a blanket `:` rule denying `:(literal)` and root-anchored single files.

**Why it happens:** The commit class is a list of verbs, so coverage ends at the verbs someone remembered. The old exemptions matched `-n`, `--abort` or `--quit` anywhere in the joined arguments, so they could not rule out an abbreviation, negation or message value.

**Evidence:** `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `__goat_git_history_verbs`, `git_flags_within`) and `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `merge creates history`, `exempt merge alias with appended negation`, `filter-branch rewrites history`, `rebase reason`).

**Recurrence 2026-09-24:** `git restore src/..`, `git checkout -- src/..` and `git restore --pathspec-from-f=paths.txt` exited 0. Git's read-only `ls-files` selected the same tracked paths for `src/..` and `.`. `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `git_pathspecs_name_bulk`) now folds internal parent components and reuses the option-prefix matcher. `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` covers (search: `restore of an internal parent path`), (search: `abbreviated attached pathspec file restore`), single-file restores and index-only controls.
