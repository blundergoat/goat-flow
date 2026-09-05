---
category: verification-scanners
last_reviewed: 2026-09-05
---

**Scope:** Proving a guard, scanner, or parser actually guards - block-and-allow pairs, false-positive probes, parser-shape fixtures per claimed file family, and self-test fanout. What a test must assert generally is [verification-testing.md](verification-testing.md); Gruff specifics are [verification-gruff.md](verification-gruff.md); Markdown formatting reaching a shell argument is [verification-preflight.md](verification-preflight.md).

## Lesson: Hook fallback fixes must preserve the caller-visible failure signal

**Status:** active | **Created:** 2026-06-03
**Decision changed:** Verify fallback and optimized hook paths against the same adversarial repository configuration, not only the same payload.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 3 | **Latest occurrence:** 2026-08-03

**Prevention:** For hook fallback changes, add the exact regression probe first, then verify that helper return status or source-aware branching reaches the caller boundary. Force compatibility paths under adversarial user and repository configuration, assert parity with the optimized path, and pin any machine-readable Git output grammar at the command that produces it. Keep explicit payload scopes and git-discovered fallback scopes separate until focused tests prove both. Evidence anchors: `workflow/hooks/deny-dangerous.sh` (search: `extraction_status`), `workflow/hooks/gruff-code-quality.sh` (search: `payload_file_paths`), `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `top-level unsupported unicode escape`), `test/integration/gruff-code-quality-smoke.test.ts` (search: `uses staged hunks for pathless fallback files`).

**What happened:** During PR #47 follow-ups, the first deny-dangerous fallback patch set the unsafe JSON status inside helper functions called through command substitution, so Bash ran them in subshells and the caller never saw the updated variable; the focused self-test still failed its unicode regression. The first gruff staged-hunk patch had the mirror problem, adding cached diff ranges unconditionally and widening explicit payload scopes.

**Root cause:** Fallback behaviour changed without keeping the failure signal and input grammar at the boundary the caller observes: mutated shell state across `$(...)`, mixed payload and git-fallback paths, and repository Git configuration reaching only the fallback parser.

**Recurrence 2026-08-03:** The optimized `post-turn-safety` path pinned Git's diff prefixes while its Bash 3 fallback consumed the repository default; with `diff.mnemonicPrefix=true` the fallback stopped recognizing destination headers, skipped a changed credential file, and exited zero where the optimized path blocked. Pinning `core.quotepath`, mnemonic-prefix behaviour, and source and destination prefixes at the fallback's own `git diff` boundary restored parity. `workflow/hooks/post-turn-safety.sh` (search: `fallback_scan_diff`), `test/integration/post-turn-safety-hook-scanning.test.ts` (search: `pins mnemonic Git diff prefixes on both paths`).

---

## Lesson: Security parser fixes need focused parser proof

**Status:** active | **Created:** 2026-05-30

**Prevention:** For security changes that parse shell or agent-config command strings, run the focused parser and contract tests immediately, avoid dynamic regex construction when a literal token scan is enough, run `goat-flow stats --check` after renaming test anchors that learning-loop artifacts cite, and let current type and lint evidence override stale lesson text. Evidence anchors: `src/cli/audit/check-agent-deny-runtime.ts` (search: `extractConfiguredScriptPath`), `test/unit/audit-command/agent-deny-hooks.test.ts` (search: `hides the script path in shell text`).

**What happened:** Replacing dynamic `bash -lc` hook smoke execution with fixed-vector guard-script execution, the first parser used a dynamic RegExp and failed focused audit tests with `Invalid regular expression`, and typecheck caught `split(...)[0]` as possibly undefined. After switching to a literal `.sh` token scan the focused suites reported `# pass 153` / `# fail 0`, then `stats --check` caught two stale anchors referencing the old test name and preflight caught an unnecessary `String(...)` conversion copied from the old lesson.

**Root cause:** Shell-command parsing was treated as a small cleanup after removing the risky spawn path, although the safer behaviour changed the test contract and the first parser shape carried its own syntax hazard.

---

## Lesson: guardrail self-test needs no-space redirect and false-positive probes

**Status:** active | **Created:** 2026-04-24

**Prevention:** For shell-hook path regexes, test positive and negative examples together: canonical secret names, no-space redirect forms, and near-miss filenames differing by one character. Do not treat `--self-test` as sufficient evidence for shell parsing changes until it includes the exact reproduction strings that demonstrated the bug.

**What happened:** `deny-dangerous-self-test.sh --self-test=full` passed while live repros still showed a bypass for `echo foo>.env`, `echo foo>>.env`, `echo foo>|.env`, and `echo foo>.env.example`, because the hook treated `>` as a redirect only when followed by whitespace. The same pass left unescaped `.env` and `.env.example` regexes in place, so benign names such as `aenv`, `xenv.local`, and `aenv.example` were misclassified. The fix escaped the leading dots, detected redirect targets without requiring whitespace, and added self-test cases for each form.

**Root cause:** The existing self-test matrix was trusted too early: it covered spaced redirects and canonical `.env` names but not the no-space shell forms or the near-miss filenames that reveal wildcard-dot false positives.

---

## Lesson: Shell metacharacters in verification searches can corrupt source files

**Status:** active | **Created:** 2026-04-26
**Incident count:** 1 | **Latest occurrence:** 2026-04-26
**Merged:** 2026-09-05 - the four blocked-search recurrences (2026-06-14, 2026-07-17, 2026-07-19, 2026-08-23) moved to `.goat-flow/learning-loop/lessons/verification-preflight.md` (search: `Verification grep patterns must not carry Markdown backticks into Bash`), which owns Markdown formatting reaching a shell argument; this entry keeps the file-corruption case, where the guard did not stop the command.

**Prevention:** Quote every search pattern containing `<`, `>`, `|`, backticks, or quotes as a single shell argument, or pass it through a safer command form. After any complex shell search over generated or HTML-heavy files, run `git diff --stat` or `wc -l` on the touched files before continuing verification; an unquoted redirect operator is not blocked by the command guard, so the only evidence is the file itself.

**What happened:** During M05b verification, a malformed `rg` command left a literal `>` outside the quoted search pattern; the shell read it as output redirection and truncated `src/dashboard/views/home.html` to an empty file. `wc -l`, `git diff`, and the dashboard HTML regression caught it before final verification and the template was restored.

**Root cause:** The pattern contained a shell-significant character from the HTML text being searched and the command was assembled too casually, so a read-only verification command stopped being read-only before `rg` ever ran.

---

## Lesson: Temp cleanup must satisfy destructive-command hooks

**Status:** active | **Created:** 2026-05-08
**Incident count:** 5 | **Latest occurrence:** 2026-08-27

**Prevention:** For verification scratch space, prefer non-recursive cleanup (`rm -f` known files, then `rmdir`) or an explicit literal temp path that satisfies the hook. Do not combine validation and variable-scoped `rm -rf` in the same command, and do not place recursive removal in an `EXIT` trap inside the same shell program: the guard classifies the whole program before `mktemp` runs, so the validation never happens. Keeping a printed temp directory as disposable evidence is preferable to coupling proof to cleanup. Evidence anchor: `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `embedded variable recursive rm`).

**What happened:** Smoke-testing `scripts/install-browser-tools.sh` wrapper-guard behaviour, a temp-directory cleanup used `rm -rf "$tmpdir"` and the PreToolUse hook blocked the command with `BLOCKED: rm -r without safe scoping. Specify an explicit target path.`; the smoke test was rerun with `rm -f "$tmpdir/browser-use"; rmdir "$tmpdir"`.

**Root cause:** A `mktemp` path was treated as self-evidently safe, but the hook cannot prove variable-scoped recursive deletion is bounded.

**Recurrence 2026-08-03:** A packaged-release smoke again placed variable-scoped `rm -rf` in the same shell program as its validation; the hook rejected the complete command before `mktemp` ran, so no validation state was created, and the rerun retained its printed temp directory as disposable evidence.
**Recurrence 2026-08-10:** Cleanup of two known redaction directories used recursive removal despite literal paths; listing each file, deleting them in bounded groups, and removing the empty directories completed cleanup without weakening the guard.
**Recurrence 2026-08-27:** Regenerating the M41 learning-loop index through a temporary mirror, `rm -rf "$index_fixture_dir"` sat in an `EXIT` trap within the same program; the guard rejected it before `mktemp` ran, so neither temporary nor workspace files were created.

---

## Lesson: Hook regex edits need syntax probes before self-test fanout

**Status:** active | **Created:** 2026-04-27

**Prevention:** After changing Bash hook regexes, run `bash -n <hook>` before interpreting self-test failures, and prefer a named regex variable when the pattern contains `(`, `)`, `{`, or `}`. For command-wrapper deny rules, probe bare and option-bearing wrappers before mirror fanout: `command -p`, `env --`, `env -C`, `time -f`, and quoted time formats. For VM-loaded dashboard helper tests, compare scalar fields or normalize arrays into the host realm. Evidence anchors: `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `is_git_push`), `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `sudo git push`), `src/dashboard/views/quality.html` (search: `qualityHistoryRows.length`).

**What happened:** Hardening the git-mutation guardrail against quoted and wrapper-prefixed `git push` bypasses, the first focused self-test failed every safe case because a `[[ =~ ]]` expression with an inline `)` caused a parse error before the command checks ran. Later manual probes caught more wrapper-option misses after the self-test was green: `command -p git push`, `env -- git push`, and `/usr/bin/time -f %E git push` still returned exit 0 until option-bearing forms were added. The same pass repeated a known VM mistake, comparing a VM-created array with a host-realm array.

**Root cause:** A shell regex was edited directly inside `[[ ... =~ ... ]]` rather than moved to a variable, which is safer for metacharacters the Bash parser can see, and the existing cross-realm VM lesson was forgotten when adding a new classic-script helper test.

## Lesson: Scanner hardening must test block and allow cases together

**Status:** active | **Created:** 2026-06-14
**Incident count:** 4 | **Latest occurrence:** 2026-08-09

**Prevention:** For credential-scanner changes, run a matrix including must-block misses and must-allow placeholder assignments after each parser edit. Parse and normalize the assignment key first, classify it second, and expect a broader key match to require explicit placeholder allowlist proof. Capture regex matches into locals before calling helpers, because a helper can overwrite `BASH_REMATCH`. Compare normalized findings across the full block-and-allow corpus rather than treating a few equal exit codes as parity, and inventory every external command, redirection, and direct content read before treating named reproductions as completeness proof. Evidence anchors: `workflow/hooks/post-turn-safety.sh` (search: `scan_env_assignment`), `test/integration/post-turn-safety-hook.test.ts` (search: `blocks exported credential assignments`), `test/integration/post-turn-safety-hook.test.ts` (search: `allows safe placeholders in env examples`).

**What happened:** During M08 post-turn hardening, live probes showed three false negatives: bare `sk-...` tokens, `export API_KEY=...`, and quoted credential assignments containing `#`. The first parser patch still failed the new exported and quoted tests because key extraction tried to parse and classify sensitive keys in one POSIX ERE; splitting extraction from classification fixed those, and the next focused run failed existing placeholder tests because `API_KEY=your_api_key_here` had only ever been allowed by the old false negative.

**Root cause:** New must-block probes were tested before accounting for must-allow placeholders that the old false negative had accidentally protected.

**Recurrence 2026-08-02:** The PR #57 scanner-parity fix first lost the raw assignment key because a placeholder helper overwrote `BASH_REMATCH`, then broader forced-fallback fixtures exposed Docker space-form and multi-assignment drift, dotted config-reference drift, npm secondary-assignment drift, and quoted-password mismatches; only the complete native-versus-fallback finding-set comparison caught these after named examples agreed. `workflow/hooks/post-turn-safety.sh` (search: `scan_literal_credential_assignment`), `test/integration/post-turn-safety-hook.helpers.ts` (search: `hookFindingSignatures`).
**Recurrence 2026-08-02 (general rule, surfaced here):** PR #57 review found `plans time` rejecting `stop --discard-open` under the clock reversal whose own error names discard as the remedy; the suite had a discard case and a reversal case that never crossed. When an error names a recovery path, test that path under the condition raising it. `src/cli/plans-time.ts` (search: `if (transition.discardOpen) return;`), `test/unit/plans-time.test.ts` (search: `lets discard-open recover a span the clock reversed under`).
**Recurrence 2026-08-09:** M00's named failure cases went green before a complete command and read-boundary inventory found unchecked compatibility `tr` normalization and the selected-file open. `workflow/hooks/post-turn-safety.sh` (search: `fallback_lower`), `workflow/hooks/post-turn-safety.sh` (search: `fallback_open_scan_file`), `test/integration/post-turn-safety-hook-scanning.test.ts` (search: `blocks when selected content disappears after byte counting`).

---

## Lesson: Scanner scope gates need parser-shape fixtures for each claimed file family

**Status:** active | **Created:** 2026-06-14
**Incident count:** 2 | **Latest occurrence:** 2026-08-24

**Prevention:** When a scanner scope gate lists file families, add at least one block fixture for each family whose syntax differs from the default parser shape. For Dockerfiles, probe `ARG KEY=value` and `ENV KEY=value`, the space forms `ARG KEY value` and `ENV KEY value`, and multi-assignment `ENV SAFE=x API_TOKEN=...`; for config key classifiers, probe snake_case, uppercase, and camelCase or PascalCase credential names plus excluded suffixes such as `tokenCount`, `secretName`, and `clientSecretId`. When adding a token family, pair its positive examples with ambiguous shorthand sharing its punctuation. Evidence anchors: `workflow/hooks/post-turn-safety.sh` (search: `is_env_assignment_file`), `test/integration/post-turn-safety-hook.test.ts` (search: `blocks Dockerfile ARG and ENV credential assignments`).

**What happened:** Scoping `scan_env_assignment` to env and config-shaped files included Dockerfiles, but the first live matrix still allowed `ARG CLIENT_SECRET=LiteralDockerSecret123` because the parser recognized only bare `KEY=value` and `export KEY=value`. A follow-up review found two more parser-shape misses: camelCase config keys such as `clientSecret` normalized to `clientsecret` instead of `client_secret`, and Dockerfile multi-assignment inspected only one extracted pair.

**Root cause:** The path gate was verified broadly without pairing each newly claimed file family and naming convention with a syntax-shaped fixture, so the gate said "Dockerfile" while the parser understood only shell assignment syntax.

**Recurrence 2026-08-24:** M22's first code-spanned path matcher treated `n/a` as an internal file path; the focused block fixtures passed and only the archived-plan allow case exposed the false positive. The matcher now requires a known file extension, with `n/a` kept as a negative control. `test/unit/plans-check-structure.test.ts` (search: `slash shorthand such as \`n/a\` stays clean`).
