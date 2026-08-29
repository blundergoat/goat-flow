---
category: hook-script-authoring
last_reviewed: 2026-08-29
---

**Scope:** The generated hook script and its helpers as code - ShellCheck on generated bodies, regex placement, template delimiters, helper dependencies, and PATH assumptions. Driving a hook with payloads is [hook-probe-testing.md](hook-probe-testing.md); coverage strategy is [hook-testing.md](hook-testing.md).

## Lesson: Bash case patterns need syntax proof for template delimiters

**Status:** active | **Created:** 2026-06-19
**Decision changed:** Treat Bash glob literals as shell syntax, not inert pattern text; run both parser and static-analysis checks before copying a hook edit into its mirrors.
**Incident count:** 2 | **Latest occurrence:** 2026-08-28

**Prevention:** Use parser-safe spellings for glob metacharacters, then run `bash -n` and the repository's exact ShellCheck command before mirror fanout or behavior tests. Evidence anchors: `workflow/hooks/post-turn-safety.sh` (search: `is_reference_or_interpolation`), `workflow/hooks/deny-dangerous.sh` (search: `Plain command words are already normalized`), and `workflow/hooks/deny-dangerous/patterns-paths.sh` (search: `Only backslash-rooted Windows operands`).

**What happened:** While adding `post-turn-safety` false-positive coverage for Twig/Jinja/ERB interpolation delimiters, the first Bash `case` pattern used unescaped `<`, `>`, `{`, and `}` tokens. The focused runtime tests then failed with `syntax error near unexpected token '<'` before scanner logic ran, and ShellCheck flagged the brace literals once I fixed the parse error.

**Recurrence 2026-08-28:** While reducing deny-hook process creation, I used `*'\'*` to detect a backslash inside `[[ ... ]]`. Bash accepted the expression, but the repository ShellCheck command raised SC1003 in the workflow and installed mirrors. Replacing it with the shell-native `*\\*` spelling preserved the predicate and passed static analysis before the policy corpus ran.

**Root cause:** I treated delimiter and backslash text as inert glob data. Bash parsing and ShellCheck both interpret the spelling, so a pattern can be parse-clean while still violating the repository's static-analysis contract.

## Lesson: Generated hook templates need template-safe ShellCheck annotations

**Status:** resolved | **Created:** 2026-06-11 | **Resolved:** 2026-06-12

**What happened:** ShellCheck failed on an unrendered generated-hook template with SC2317 because its helper was only called after install-time rendering inserted project commands between template markers.

**Root cause:** The template and generated installed script have different control-flow shapes. The function is intentionally unreachable in the fail-closed template but reachable in the installed copy, so checking both files with the same command needs a scoped annotation.

**Prevention:** Keep the unrendered template syntactically valid and fail-closed, and annotate template-only unreachable helpers with a narrow `shellcheck disable=SC2317` plus a comment naming the render-time call path. Regenerate installed output after changing a template before rerunning ShellCheck. This specific generated-hook path was removed before release; current replacement decision: `.goat-flow/learning-loop/decisions/ADR-037-separate-post-turn-safety-from-validation.md` (search: `does not ship a generated project-validation Stop hook`).

## Lesson: Generated hook bodies must expose literal validation commands

**Status:** resolved | **Created:** 2026-06-11 | **Resolved:** 2026-06-12

**What happened:** The verification-score spike proved that a post-turn hook whose body delegates to config at runtime remains invisible to `POST_TURN_VALIDATION_COMMAND_PATTERN`, so `post-turn-hook-integrity` correctly reports "no validation logic" even when a separate config file names real commands.

**Root cause:** The audit detector reads installed hook script content, not arbitrary config. A runtime config loader inside the hook collapses validation evidence into opaque indirection; the audit can see a runner, but not the commands whose failures need to propagate.

**Prevention:** If a future custom validation hook is intended to count toward Verification, keep auditable command lines visible in the installed script. Do not make a hook parse config at runtime and then claim deterministic validation evidence. goat-flow itself no longer ships this generated hook; current replacement decision: `.goat-flow/learning-loop/decisions/ADR-037-separate-post-turn-safety-from-validation.md` (search: `Ship one goat-flow post-turn hook`). Detector evidence anchor: `src/cli/facts/agent/hooks.ts` (search: `POST_TURN_VALIDATION_COMMAND_PATTERN`).

## Lesson: Keep generated Bash regexes out of inline conditionals

**Status:** active | **Created:** 2026-05-27
**Decision changed:** Treat every shell-quoted embedded program and its comments as part of the outer shell grammar; run syntax proof before mirror fanout.
**Incident count:** 4 | **Latest occurrence:** 2026-08-29

**What happened:** While regenerating the self-contained split hooks, inline Bash EREs lost escaping for `>`, `|`, `<<<`, and quote classes. `bash -n` caught parse failures, and the full deny-dangerous self-test caught `bash -c "echo ok; rm -rf /"` returning exit 0 because the inline quote regex captured only `r` instead of the inner command.

**Root cause:** I generated Bash through JavaScript strings and left complex regexes directly inside `[[ ... =~ ... ]]`, where shell parsing and string escaping both matter.

**Prevention:** In hook scripts, put EREs containing shell metacharacters or quote classes into named variables before matching. Run `bash -n` before mirror fanout, then run the central full self-test before treating behavior as restored. Evidence anchors: `workflow/hooks/deny-dangerous.sh` (search: `shell_c_re`), `workflow/hooks/deny-dangerous.sh` (search: `redirect_append_re`), and `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `bash -c chained rm`).

**Updated 2026-08-10:** An apostrophe in embedded Node broke Bash parsing; a template literal then raised SC2016. Keep embedded comments quote-neutral and run `bash -n` plus ShellCheck before mirror fanout. Structural audits must recognize embedded `//` comments before reporting a missing Bash comment. Evidence: `workflow/hooks/post-turn-safety.sh` (search: `read_stop_context`).

**Second update 2026-08-10:** Release ShellCheck flagged the provider-result Node program because its single quotes deliberately prevent shell expansion. A narrow SC2016 directive now records that invariant beside the command in both byte-identical mirrors. Evidence anchors: `workflow/hooks/post-turn-safety.sh` (search: `Literal JavaScript prevents shell expansion of user feedback`) and `.goat-flow/hooks/post-turn-safety.sh` (search: `Literal JavaScript prevents shell expansion of user feedback`).

**Third update 2026-08-16:** While making the Gruff contract filter span-aware, comments inside its Bash-single-quoted jq program used apostrophes. The edit hook immediately failed with `adapter-delivery-failed`, and `bash -n` located the prematurely terminated jq string before `.findings`. Rewriting those comments without single quotes restored syntax, after which the focused span regression passed. Embedded-program comments must remain neutral to the outer quote delimiter, and `bash -n` must run before treating a mirror edit as executable. Evidence anchors: `workflow/hooks/gruff-code-quality.sh` (search: `def attributable_line_or_span`) and `test/integration/gruff-code-quality-contract.test.ts` (search: `surfaces a symbol finding when its span overlaps`).

**Fourth update 2026-08-29:** The deny hook's substitution-opener test matches the literal openers `$(`, `<(` and `>(` inside `[[ ... ]]`, so its single quotes are load-bearing. ShellCheck read them as a failed expansion and raised SC2016 in both byte-identical mirrors, which made the aggregate shell-lint command in the instruction files exit 1 as published - the documented command was untrue for every agent that ran it. A narrow directive beside the test (`workflow/hooks/deny-dangerous.sh`, search: `_goat_subst_n=0`) restored exit 0 with no exclusions. The wider lesson is about the gate, not the literal: the `SC2016` exclusion that had been hiding this lived in CI and preflight, and preflight's hook scope comes from `manifest_eval hook-dirs`, which resolves to `.goat-flow/hooks` alone - one of the documented command's four hook globs. A regression in a `workflow/hooks/` mirror was invisible to preflight entirely, so the recurrence guard is now a contract that executes the published command (`test/contract/documented-shellcheck-command.test.ts`), not the exclusion list.

## Lesson: Dynamic hook helpers need explicit ShellCheck handling

**Status:** active | **Created:** 2026-05-27

**What happened:** After extracting `deny-dangerous.sh`, I expected `# shellcheck source=deny-dangerous.sh` above the runtime-computed source line to satisfy linting. The repo's hook lint command does not run ShellCheck with `-x`, so ShellCheck failed or warned with SC1091/SC1090 on every mirrored policy hook before any behavior checks could matter.

**Root cause:** I treated the source directive as enough without checking it against the exact lint invocation used by preflight and CI.

**Prevention:** For sourced hook helpers resolved through runtime variables, shellcheck the helper as its own input and suppress SC1090/SC1091 only on the dynamic `source` line in the dispatcher. Verify the workflow and installed mirrors with the same no-`-x` ShellCheck command used by preflight. Evidence anchors: `workflow/hooks/deny-dangerous.sh` (search: `source "$GOAT_HOOK_LIB_DIR/patterns-shell.sh"`) and `workflow/hooks/deny-dangerous.sh` (search: `shellcheck disable=SC1090,SC1091`).

**Updated 2026-08-07:** Release ShellCheck caught SC2016 because gruff guidance put Markdown backticks inside a single-quoted `printf` in both hook mirrors. Escape command backticks in a double-quoted string, then lint the full workflow and installed hook sets before treating the mirrors as ready. Evidence anchors: `workflow/hooks/gruff-code-quality.sh` (search: `structural findings are review cost`) and `.goat-flow/hooks/gruff-code-quality.sh` (search: `structural findings are review cost`).

**Updated 2026-05-27:** When git parsing moved into `deny-dangerous.sh`, ShellCheck still warned with SC2154 in thin hooks because helper-owned output variables (`__goat_git_rest`, `__goat_git_aliased_push`) were assigned dynamically in the sourced file. Initialize helper output variables in each thin hook before first reference so static analysis sees the contract. Evidence anchors: `workflow/hooks/deny-dangerous/patterns-writes.sh` (search: `__goat_git_aliased_push=0`) and `workflow/hooks/deny-dangerous/patterns-paths.sh` (search: `__goat_git_rest=""`).

## Lesson: Shared hook helpers need missing-dependency runtime tests

**Status:** active | **Created:** 2026-05-27

**What happened:** After splitting the guard hooks through `deny-dangerous.sh`, PreToolUse started reporting hook failures with exit code 127 when a thin policy hook could not load the shared helper. The script used `set -uo pipefail`, so a failed `source` did not stop execution; the hook then reached `main "$@"` before `main` existed.

**Root cause:** I tested normal installed mirrors but did not test the degraded install shape where a policy hook exists without its required shared helper. That missed the actual failure users see during partial installs, stale mirrors, or interrupted setup.

**Prevention:** Any Bash hook that sources a shared helper must guard the source path explicitly and include a self-test that runs the hook from a temp directory without the helper. The expected result is a fail-closed guardrail message, never exit 127. Evidence anchors: `workflow/hooks/deny-dangerous.sh` (search: `deny_dangerous_unavailable`) and `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `expect_missing_common_fails_closed`).

## Lesson: Restricted-PATH hook fixtures break helpers that shell out

**Status:** active | **Created:** 2026-07-03

**What happened:** The gruff-code-quality self-test isolates binary discovery with `PATH="$tmp/empty-bin"` so a system-installed `gruff-py` cannot leak into assertions. The new repo-owned config override (`hooks.gruff-code-quality.binaries.<lang>`) parses `.goat-flow/config.yaml` with `awk`. Under the restricted PATH, `awk` was not found; the command substitution's `2>/dev/null || true` swallowed the failure, the parser returned empty, and the config-override self-test failed with an empty value while the production code path was actually correct.

**Root cause:** Restricted-PATH fixtures constrain every external command in the function under test, not just the binary the fixture means to hide. A helper that shells out (`awk`, `sed`, `git`) silently degrades when the fixture PATH omits it, and fail-soft error handling converts the missing tool into a wrong answer instead of a visible error.

**Prevention:** When a hook self-test restricts PATH to hide one binary, first check which branch of the code under test can reach a PATH lookup for that binary. If the branch short-circuits earlier (env/config override present returns before the PATH search), append the real PATH - `PATH="$tmp/empty-bin:$PATH"` - so shell-out helpers keep working; keep the bare restricted PATH only for assertions that genuinely exercise PATH-based discovery. Evidence anchors: `workflow/hooks/gruff-code-quality.sh` (search: `they never reach the PATH binary search`), (search: `config_binary_override`).
