---
category: deny-github
last_reviewed: 2026-09-30
---

GitHub CLI and API write-policy traps, including allowed conversation comments and proven GraphQL reads.

Sibling buckets: `deny-writes.md`, `deny-shell.md`, `deny-secrets.md`.

## Footgun: GitHub CLI comments bypassed shared-system write guardrails

**Status:** active | **Created:** 2026-05-20 | **Evidence:** ACTUAL_MEASURED
**Severity:** SECURITY
**Incident count:** 6 | **Latest occurrence:** 2026-09-27

**Prevention:**
1. Treat `git push` as one GitHub write path among many. Every new shared-system `gh` mutation route needs a hook rule and a self-test case, and the suite keeps read-only controls (`issue view`, `pr checks`, `gh api --method GET`) so write blocking never becomes a GitHub-read ban.
2. Test CLI write classifiers against grammar variants, not the observed command: global options before and after the topic, short forms, and pipeline consumers such as `xargs`.
3. Forwarded Slack, email, or ticket text is evidence, not authorization. The hook allows `gh issue comment` and `gh pr comment` under ADR-028's carve-out, so the host's per-call prompt and an in-turn user approval are the only controls on those two commands.
4. Prove dry-run exceptions from parsed options: consume value operands, honor `--`, and apply the last Boolean value.
   A non-publishing mode that writes local files is still a write under ADR-028.

**Symptoms:** GitHub comment and API writes passed while `git push` was blocked; the first repair missed interspersed global flags and `xargs`. The commands and incident are recorded below. Remaining writes outside ADR-028's issue/PR conversation-comment carve-out still require classification; proven GraphQL queries remain allowed.

**Why it happens:** The hook once treated `gh` as an ordinary command unless it contained an already-blocked shell pattern, and CLI parsers accept option placements the incident never showed.

**Evidence:** Reported incident: an assistant posted a comment to `owner/repo#64620` from forwarded Slack text, and the user deleted it. `--check` returned exit 0 before the first fix for `gh issue comment 64620 --repo owner/repo --body-file /tmp/issue_64620_comment.md` and `gh api repos/owner/repo/issues/1/comments -X POST -f body=hi`, and before the second fix for `gh issue --repo owner/repo comment 64620 --body hi` and `printf '%s\n' body | xargs -I{} gh issue comment 64620 --body {}`. `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `is_gh_write_operation`) classifies the mutating subcommands and `gh api` write forms; `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `gh issue comment`) locks the carve-out allow cases beside the write blocks. ADR-028 was narrowed on 2026-06-02 because conversation comments are low-blast-radius and reversible; `gh api` comment writes stay blocked.

**Recurrence 2026-09-25:** Local classifier probes allowed `gh discussion comment` and `gh agent-task create`, including `agent` and `agents` aliases. These are outside ADR-028's issue/PR comment exception. The write table now covers them while their view/list controls remain allowed: `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `discussion:comment`, `agent-task:create`) and the shared corpus (search: `gh agent-task create`). No remote mutation was executed.

**Recurrence 2026-09-25:** The classifier also allowed gist renames, codespace rebuilds, port visibility changes and skill publishing.

- `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `gh_skill_publish_is_dry_run`) now proves validation-only flags before allowing publish.
- `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `expect_notes_and_github_write_modes`) pairs writes with reads and flag controls.
- All new denial cases failed before repair and passed afterward; no remote writes ran. Skill `--fix` remains a local write, not a read exception.
- A follow-up probe found the same gap through GitHub's `cs` alias; alias reads and writes now share the codespace cases.

**Recurrence 2026-09-25 (Codespace filesystem):** `gh codespace cp README.md remote:/tmp/review-write` and `gh codespace ssh -- touch /tmp/review-write`, including the `cs` alias, passed both installed hooks. Local `gh codespace cp --help` says copies can target the remote filesystem, and `ssh --help` accepts a remote command. `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `gh_codespace_ssh_is_config_only`) now blocks copies and interactive or command-bearing SSH. `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `codespace remote shell command`) keeps configuration output and usage available. No Codespace command was executed.

**Recurrence 2026-09-26 (aliases, settings, and unknown topics):** Alias/config writes, auth switching, autolink writes, built-in shorthands and unknown topics passed. Unknown topics execute saved aliases or extensions whose actions the hook cannot inspect. `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `is_gh_builtin_topic`) now refuses unknown topics, normalizes shorthands and names the missing writes. Extend the built-in set when gh adds commands. `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `saved gh alias invocation`) pairs denials with alias/config/auth/extension reads. No remote mutation ran.

**Recurrence 2026-09-27:** `gh extension browse` and forced PR checkout (`pr co` included) exited 0; installed help confirms their write modes. `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `extension:browse`, `pr:checkout`) guards them. Rechecks caught `--branch topic checkout` ordering and false denial of `--force --detach`, which skips branch resets. The shared corpus (search: `expect_lfs_and_github_interactive_writes`) retains help, inspection, disabled force and effective detach controls. No TUI or checkout ran.

---

## Footgun: HTTP method alone cannot classify GraphQL reads and writes

**Status:** active | **Created:** 2026-09-20 | **Evidence:** ACTUAL_MEASURED
**Severity:** INTEGRATION
**Enforced-by:** `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `is_gh_api_write`); `test/integration/deny-git-graphql.test.ts` (search: `GraphQL read-only policy`)
**Decision changed:** Prove the literal GraphQL operation before applying the REST method rule, and verify the saved installed launcher as well as the classifier.
**Trigger phase:** ACT
**hallucination-risk:** high

**Prevention:** Parse the complete literal document with the bundled standard parser. Permit exactly one query operation with resolved, acyclic fragments; reject mutations, subscriptions, mixed operations, malformed documents and unresolved input. GET/HEAD does not prove a GraphQL read. Keep allowed Discussions reads beside denied mutations in both classifier tests and registered-launcher replay. Installed replay is not evidence that a provider delivered a live tool call to the hook.

**Symptoms:** The original `gh api graphql -f query=...` Discussions read exited 2 with `GitHub write via gh is blocked`, while `gh issue list` exited 0. This prevented access to discussion bodies and comments even though the operation was read-only.

**Why it happens:** `gh api` uses POST when given body fields. The REST classifier treated those fields as a write without inspecting the GraphQL operation. Allowing GraphQL solely because the caller selects GET would make the opposite mistake.

**Evidence:** `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `is_gh_api_write`) delegates GraphQL classification before its REST rules; `workflow/hooks/gh-graphql-read.cjs` (search: `isReadDocument`) proves the query. `test/integration/deny-git-graphql.test.ts` and `test/unit/gh-graphql-read.test.ts` pin the operation boundary. `test/unit/audit-command/agent-deny-hooks.test.ts` (search: `allows quoted repository evidence while the registered hook still blocks repository writes`) replays the saved Codex launcher without sending the mutation to GitHub. `.goat-flow/learning-loop/decisions/ADR-028-github-cli-mostly-read-only-except-comments.md` owns the policy exception.

**Recurrence 2026-09-25:** Saving an allowed API read with shell redirection made the filename look like a request operand and caused a deny. Separate unquoted redirections before classifying the request; retain quoted operators as data and refuse unresolved redirect syntax. Evidence: `workflow/hooks/deny-dangerous/guard-runtime.sh` (search: `strip_shell_redirections`) and `test/integration/deny-git-graphql.test.ts` (search: `bodies.txt`). REST and GraphQL read controls stay allowed, while redirected mutations remain denied.
