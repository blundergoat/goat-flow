---
category: verification-scanners
last_reviewed: 2026-08-23
---

**Scope:** Proving a guard, scanner, or parser actually guards - block-and-allow pairs, false-positive probes, parser-shape fixtures per claimed file family, and self-test fanout. What a test must assert generally is [verification-testing.md](verification-testing.md); Gruff specifics are [verification-gruff.md](verification-gruff.md).

## Lesson: Hook fallback fixes must preserve the caller-visible failure signal

**Status:** active | **Created:** 2026-06-03
**Decision changed:** Verify fallback and optimized hook paths against the same adversarial repository configuration, not only the same payload.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 3 | **Latest occurrence:** 2026-08-03

**What happened:** During PR #47 follow-up fixes, the first deny-dangerous fallback patch set the unsafe JSON status inside helper functions called through command substitution. The focused full self-test still failed the top-level unsupported unicode regression because Bash ran the helpers in subshells and the caller never saw the updated variable. The first gruff staged-hunk patch had a similar over-broad shape: adding cached diff ranges unconditionally widened explicit payload scopes and broke existing changed-range tests before the fallback-only test could be trusted.

**Recurrence 2026-08-03:** The optimized `post-turn-safety` path pinned Git's diff prefixes, but its Bash 3 fallback consumed the repository's default diff format. With `diff.mnemonicPrefix=true`, the fallback stopped recognizing destination headers, skipped a changed credential file, and exited zero while the optimized path blocked it. Pinning `core.quotepath`, mnemonic-prefix behavior, and source/destination prefixes at the fallback's own `git diff` boundary restored parity. Evidence anchors: `workflow/hooks/post-turn-safety.sh` (search: `fallback_scan_diff`) and `test/integration/post-turn-safety-hook-scanning.test.ts` (search: `pins mnemonic Git diff prefixes on both paths`).

**Root cause:** I changed fallback behavior without keeping the failure signal and input grammar at the same boundary the caller observes. For deny-dangerous that meant relying on mutated shell state across `$(...)`; for gruff that meant mixing explicit payload paths and pathless git fallback paths before proving their different contracts; for post-turn-safety it meant allowing repository Git configuration to change only the fallback parser's input shape.

**Prevention:** For hook fallback changes, add the exact regression probe first, then verify that helper return status or source-aware branching reaches the caller boundary. Force compatibility paths under adversarial user and repository configuration, assert parity with the optimized path, and pin any machine-readable Git output grammar at the command that produces it. Keep explicit payload scopes and git-discovered fallback scopes separate until focused tests prove both paths. Evidence anchors: `workflow/hooks/deny-dangerous.sh` (search: `extraction_status`), `workflow/hooks/gruff-code-quality.sh` (search: `payload_file_paths`), `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `top-level unsupported unicode escape`), and `test/integration/gruff-code-quality-smoke.test.ts` (search: `uses staged hunks for pathless fallback files`).

---

## Lesson: Security parser fixes need focused parser proof

**Status:** active | **Created:** 2026-05-30

**What happened:** During the M00 security cleanup, I replaced dynamic `bash -lc` hook smoke execution with fixed-vector guard-script execution. The first parser used a dynamic RegExp and failed focused audit tests with `Invalid regular expression`; typecheck also caught `split(...)[0]` as possibly undefined. After switching to a literal `.sh` token scan and updating the stale assertion, the focused audit/install tests reported `# pass 153` / `# fail 0`. The learning-loop stats check then caught two stale anchors that still referenced the old test name, and full preflight caught an unnecessary `String(...)` conversion copied forward from the old hook-testing lesson.

**Root cause:** I treated shell-command parsing as a small cleanup after removing the risky spawn path. The safer behavior changed the test contract, and the first parser shape had its own syntax hazard.

**Prevention:** For security changes that parse shell or agent-config command strings, run the focused parser/contract tests immediately, avoid dynamic regex construction when a literal token scan is enough, run `goat-flow stats --check` after renaming test anchors that learning-loop artifacts cite, and let current type/lint evidence override stale lesson text. Evidence anchors: `src/cli/audit/check-agent-deny-runtime.ts` (search: `extractConfiguredScriptPath`), `test/unit/audit-command/agent-deny-hooks.test.ts` (search: `hides the script path in shell text`).

---

## Lesson: guardrail self-test needs no-space redirect and false-positive probes

**Status:** active | **Created:** 2026-04-24

**What happened:** `bash .claude/hooks/deny-dangerous-self-test.sh --self-test=full` passed, but live repros still showed a bypass for `echo foo>.env`, `echo foo>>.env`, `echo foo>|.env`, and `echo foo>.env.example` because the hook only treated `>` as a redirect when followed by whitespace. The same pass also left unescaped `.env` / `.env.example` regexes in place, so benign names like `aenv`, `xenv.local`, and `aenv.example` were misclassified as secret or sample-env paths.

**Root cause:** I trusted the existing self-test matrix too early. It covered spaced redirects (`> .env`, `>| .env.example`) and canonical `.env` names, but not the no-space shell forms or near-miss filenames that reveal wildcard-dot false positives.

**Fix:** Escape the leading dots in the `.env` / `.env.example` regexes, detect redirect targets without requiring whitespace, and add self-test cases for `>.env`, `>>.env`, `>|.env.example`, `aenv`, `xenv.local`, and `aenv.example`.

**Prevention:**
1. For shell-hook path regexes, test both positive and negative examples: canonical secret names, no-space redirect forms, and near-miss filenames that differ by one character.
2. Do not treat `--self-test` as sufficient evidence for shell parsing changes until it includes the exact reproduction strings that originally demonstrated the bug.

---

## Lesson: Shell metacharacters in verification searches can corrupt source files

**Status:** active | **Created:** 2026-04-26
**Incident count:** 5 | **Latest occurrence:** 2026-08-23

**What happened:** During M05b verification, a malformed `rg` command accidentally left a literal `>` outside the quoted search pattern. The shell interpreted it as output redirection and truncated `src/dashboard/views/home.html` to an empty file. The mistake was caught by `wc -l`, `git diff`, and the dashboard HTML regression before final verification, then the Home template was restored.

**Recurrence 2026-06-14:** While verifying a `goat-qa` skill-doc edit, an `rg` pattern included Markdown backticks around `initialInput`. The deny-dangerous hook blocked it as command substitution before execution. No files were changed by the blocked command, but the verification pass still had to be rerun with a safer pattern. Evidence anchors: `workflow/skills/goat-qa/SKILL.md` (search: `safe to skip more PTY timing tests`) and `.goat-flow/learning-loop/lessons/verification-scanners.md` (search: `Shell metacharacters in verification searches can corrupt source files`).

**Recurrences 2026-07-17 and 2026-07-19:** Double-quoted `rg` patterns containing Markdown backticks were blocked before execution. Single-quoting the whole pattern fixed both searches without changing files. Evidence: `workflow/hooks/deny-dangerous.sh` (search: `Backtick command substitution hides nested execution`).

**Recurrence 2026-08-23:** While checking whether revised source comments were cited by learning-loop entries, an `rg` pattern put Markdown backticks inside double-quoted shell text. The deny hook stopped the command before execution, so no files changed. Removing the syntax-significant quoting produced the intended read-only search. Evidence anchor: `workflow/hooks/deny-dangerous.sh` (search: `Backtick command substitution hides nested execution`).

**Root cause:** The search pattern contained shell-significant characters (`>` in HTML text, later backticks in Markdown text) and the command was assembled too casually. A read-only verification command stopped being read-only because the shell parsed the pattern before `rg` ever ran.

**Prevention:** Quote every search pattern containing `<`, `>`, `|`, backticks, or quotes as a single shell argument, or pass it via a safer command form. After any complex shell search over generated/HTML-heavy files, run `git diff --stat` or `wc -l` on touched files before continuing verification.

---

## Lesson: Temp cleanup must satisfy destructive-command hooks

**Status:** active | **Created:** 2026-05-08
**Incident count:** 4 | **Latest occurrence:** 2026-08-12

**What happened:** While smoke-testing `scripts/install-browser-tools.sh` wrapper-guard behavior, a temp-directory cleanup command used `rm -rf "$tmpdir"`. The PreToolUse hook blocked the command with `BLOCKED: rm -r without safe scoping. Specify an explicit target path.` The smoke test had to be rerun with non-recursive cleanup: `rm -f "$tmpdir/browser-use"; rmdir "$tmpdir"`.

**Recurrence 2026-08-03:** A packaged-release smoke again placed variable-scoped `rm -rf` in the same shell program as the validation. The hook rejected the complete command before `mktemp` ran, so no validation state was created. The rerun omitted destructive cleanup and retained its printed `/tmp/goat-flow-release-check.*` directory as disposable local evidence.

**Recurrence 2026-08-10:** Cleanup of two known redaction directories still used recursive removal, so the safety hook rejected it despite literal paths. Listing each file, deleting the exact files in bounded groups, and removing the empty directories completed cleanup without weakening the guard.

**Root cause:** Treated a `mktemp` path as self-evidently safe, but the hook cannot prove variable-scoped recursive deletion is bounded.

**Prevention:** For verification scratch space, prefer non-recursive cleanup (`rm -f` known files, then `rmdir`) or an explicit literal temp path pattern that satisfies the hook. Do not combine validation and variable-scoped `rm -rf` in the same command.

---

## Lesson: Hook regex edits need syntax probes before self-test fanout

**Status:** active | **Created:** 2026-04-27

**What happened:** While hardening the git-mutation guardrail against quoted and wrapper-prefixed `git push` bypasses, the first focused self-test failed every safe case because a Bash `[[ =~ ]]` expression with an inline `)` regex caused a parse error before the command checks could run. Later manual probes caught more wrapper-option misses after the self-test was green: `command -p git push`, `env -- git push`, and `/usr/bin/time -f %E git push` still returned exit 0 until option-bearing wrapper forms were added. The same verification pass caught a repeated VM-test mistake: `assert.deepEqual` compared a VM-created array with a host-realm array and failed despite matching printed structure.

**Root cause:** I edited a shell regex directly inside `[[ ... =~ ... ]]` instead of moving the pattern to a variable, which is safer for regex metacharacters that the Bash parser can see. I also forgot the existing VM cross-realm lesson when adding a new classic-script helper test.

**Prevention:** After changing Bash hook regexes, run `bash -n <hook>` before interpreting self-test failures; if the regex contains `(`, `)`, `{`, or `}`, prefer a named regex variable. For command wrapper deny rules, probe both bare wrappers and option-bearing wrappers before mirror fanout (`command -p`, `env --`, `env -C`, `time -f`, quoted time formats). For VM-loaded dashboard helper tests, compare scalar fields/lengths or normalize arrays into the host realm. Evidence anchors: `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `is_git_push`), `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `sudo git push`), `src/dashboard/views/quality.html` (search: `qualityHistoryRows.length`).
---

## Lesson: Scanner hardening must test block and allow cases together

**Status:** active | **Created:** 2026-06-14

**What happened:** During M08 post-turn safety hardening, live probes showed three false negatives: bare `sk-...` tokens, `export API_KEY=...`, and quoted credential assignments containing `#`. The first parser patch still failed the new exported/quoted tests because key extraction tried to parse and classify sensitive keys in one POSIX ERE. Splitting key extraction from keyword classification fixed those cases, but the next focused run failed existing placeholder tests because `API_KEY=your_api_key_here` had only been allowed when the old key parser missed `API_KEY` entirely.

**Root cause:** I tested new must-block probes before accounting for must-allow placeholders that were accidentally protected by the old false negative.

**Prevention:** For credential-scanner changes, run a matrix that includes must-block misses and must-allow placeholder assignments after each parser edit. Parse/normalize the assignment key first, classify it second, and expect a broader key match to require explicit placeholder allowlist proof. Evidence anchors: `workflow/hooks/post-turn-safety.sh` (search: `scan_env_assignment`), `test/integration/post-turn-safety-hook.test.ts` (search: `blocks exported credential assignments`), and `test/integration/post-turn-safety-hook.test.ts` (search: `allows safe placeholders in env examples`).

**Recurrence 2026-08-02:** The PR #57 scanner-parity fix first lost the raw assignment key because a placeholder helper overwrote Bash's global `BASH_REMATCH`, then broader forced-fallback fixtures exposed Docker space-form and multi-assignment drift, dotted config-reference drift, npm secondary-assignment drift, and quoted-password mismatches. The complete native-versus-fallback finding-set comparison caught these after the initial named examples agreed. Capture regex matches before calling helpers, and compare normalized findings across the full existing block-and-allow corpus rather than treating a few equal exit codes as parity. Evidence anchors: `workflow/hooks/post-turn-safety.sh` (search: `scan_literal_credential_assignment`), and `test/integration/post-turn-safety-hook.helpers.ts` (search: `hookFindingSignatures`).

**Recurrence 2026-08-02:** PR #57 review found `plans time` rejecting `stop --discard-open` under the clock reversal whose own error names discard as the remedy. The suite had a discard case and a reversal case; neither crossed. Rule: when an error names a recovery path, test that path under the condition raising it. Evidence: `src/cli/plans-time.ts` (search: `if (transition.discardOpen) return;`), `test/unit/plans-time.test.ts` (search: `lets discard-open recover a span the clock reversed under`).

**Recurrence 2026-08-09:** M00's named failure cases went green before a complete command/read-boundary inventory found unchecked compatibility `tr` normalization and the selected-file open. Inventory every external command, redirection, and direct content read before treating named reproductions as completeness proof. Evidence anchors: `workflow/hooks/post-turn-safety.sh` (search: `fallback_lower`), `workflow/hooks/post-turn-safety.sh` (search: `fallback_open_scan_file`), and `test/integration/post-turn-safety-hook-scanning.test.ts` (search: `blocks when selected content disappears after byte counting`).

---

## Lesson: Scanner scope gates need parser-shape fixtures for each claimed file family

**Status:** active | **Created:** 2026-06-14

**What happened:** While reducing `post-turn-safety` generic credential-assignment false positives, I scoped `scan_env_assignment` to env/config-shaped files and included Dockerfiles in that scope. The first live matrix still allowed `ARG CLIENT_SECRET=LiteralDockerSecret123` because the parser only recognized bare `KEY=value` and `export KEY=value`, not Dockerfile `ARG`/`ENV` prefixes. A follow-up review then found two more parser-shape misses: camelCase config keys such as `clientSecret` normalized to `clientsecret` instead of `client_secret`, and Dockerfile multi-assignment `ENV SAFE=x API_TOKEN=...` inspected only one extracted key/value shape.

**Root cause:** I verified the path gate broadly but did not pair every newly claimed file family and naming convention with a syntax-shaped fixture. The gate said "Dockerfile" while the parser still only understood shell/env assignment syntax, and the key classifier said "credential-shaped keys" without proving common config casing.

**Prevention:** When a scanner scope gate lists file families, add at least one block fixture for each family whose syntax differs from the default parser shape. For Dockerfiles, probe both `ARG KEY=value` / `ENV KEY=value`, `ARG KEY value` / `ENV KEY value`, and multi-assignment `ENV SAFE=x API_TOKEN=...`; for config key classifiers, probe snake_case, uppercase, and camelCase/PascalCase credential names plus excluded suffixes such as `tokenCount`, `secretName`, and `clientSecretId`. Evidence anchors: `workflow/hooks/post-turn-safety.sh` (search: `is_env_assignment_file`), `workflow/hooks/post-turn-safety.sh` (search: `scan_env_assignment`), and `test/integration/post-turn-safety-hook.test.ts` (search: `blocks Dockerfile ARG and ENV credential assignments`).

---
