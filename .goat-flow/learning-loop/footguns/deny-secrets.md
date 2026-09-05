---
category: deny-secrets
last_reviewed: 2026-09-05
---

Secret-path read traps: what counts as a secret path, and which read channels the deny surface actually binds.

Sibling buckets: `deny-shell.md`, `deny-writes.md`.

## Footgun: Secret-path matching must distinguish search data from file operands

**Status:** active | **Created:** 2026-08-17 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 2 | **Latest occurrence:** 2026-09-02
**Decision changed:** Exempt protected text only after a command-specific parser proves that it is search data, and keep every remaining file operand under the secret-path matcher.

**Prevention:**
1. Limit data exemptions to the documented grammar of `git log -S`, `-G`, and `--grep`; malformed or unrecognised forms fall back to the generic fail-closed scan.
2. Retain Git-global options and their operands before `log`, stop option parsing at `--`, and retain every later token as a path operand.
3. Pair every harmless-search allow case with direct protected pathspec, read, write, and upload block cases for the same secret family.
4. Verify configs containing protected-path rules through repository-owned parity tests or non-shell file readers; never embed those rules in an ad hoc shell command.

**Symptoms:** The hook blocked `git log -S`, `-G`, and `--grep` searches for a permission-rule string containing `.ssh` when the only pathspec was an ordinary settings file. The first exemption then allowed protected Git-global paths such as `git -C ~/.ssh log -S token` and misparsed a quoted search value containing spaces.

**Why it happens:** The generic matcher sees a protected substring anywhere and cannot tell a history search value from a path operand. Git-global options may carry paths before `log`, and `--` makes every following token a pathspec, so only recognised search values between those boundaries are data.

**Evidence:** Before the exemption the focused corpus failed only the three history allow cases with `FAIL: paths should allow git log ... secret-rule search literal`; after the parser change `git log --oneline -S 'Write(**/.ssh/**)' -- .claude/settings.json` exited 0. A focused RED then showed `git -C ~/.ssh` and `git --git-dir=~/.ssh/repo` wrongly exiting 0; preserving word boundaries and Git-global operands made all 92 path assertions pass. `workflow/hooks/deny-dangerous/patterns-paths.sh` (search: `git_log_candidate_without_search_values`) removes only recognised search values before `--`; `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `git log protected separated global path`) pairs the allows with global-path, pathspec, write, and upload blocks. **Recurrence 2026-09-02:** an ad hoc Node verification embedded protected GCP permission rules while parsing `.claude/settings.json`; the hook correctly blocked it, and the check moved to `test/unit/agent-config-template-parity.test.ts` (search: `anchors every Claude credential-store rule at the home directory`) and `scripts/preflight-checks.sh` (search: `Agent Config Parity`).

---

## Footgun: Extension-based secret checks can confuse filenames with query syntax

**Status:** active | **Created:** 2026-05-27 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 3 | **Latest occurrence:** 2026-08-19

**Prevention:**
1. Secret-path tests include inert dotted query expressions, bare and syntax-glued, as allow controls beside real key-file paths, each paired with protected input-file, filter-file, and non-query-command blocks.
2. Prefer file-shape helpers over broad extension regexes when a token can also be valid data syntax, and run comment false-positive probes after changing shared segment prep.
3. Build separate option-arity tables for jq and yq covering bundled short flags, boolean flags, equals values, implicit-file detection, expression-provider flags, and file-valued options.
4. Bind a dangerous shell keyword to the normalized command verb; an external CLI subcommand with the same spelling is an allow control.

**Symptoms:** The hook correctly blocks `cat path/to/id_rsa.key` and also blocks `jq -r .key file.json`, `yq .metadata.key file.yaml`, and text after an unquoted comment such as `git status # .env`.

**Why it happens:** A broad `.(pem|key|pfx)` regex sees dotted query fields and filenames as one shape, and scanning the raw segment before comment stripping treats comment text as an argument.

**Evidence:** M12 probes blocked `git status # .env` and `jq -r .key file.json` before the fix; after it they return 0 while `cat path/to/id_rsa.key` returns 2. `workflow/hooks/deny-dangerous.sh` (search: `strip_unquoted_shell_comments`) strips inert comments first; `workflow/hooks/deny-dangerous/patterns-paths.sh` (search: `key_material_path_touch`) requires a meaningful filename stem for `.pem`, `.key`, and `.pfx`; `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `jq bare key query`) locks both sides. **Recurrence 2026-08-18:** fields glued to jq syntax (`select(.key == "name")`, `map(.metadata.key == "name")`) still blocked; a punctuation-tail exemption then allowed input files named `select(.key` until two negative controls caught it, and `key_material_path_touch` now exempts only the single jq/yq filter operand from the quote-aware argument stream, with 450 cases passing. **Recurrence 2026-08-19:** checking jq 1.7 help and yq documentation separately showed the first role parser missed `-rf`/`-fr` bundles, treated yq boolean flags as value-taking, exempted yq's first positional although yq may read it as a file, and mistook yq's `eval` subcommand for the shell builtin; 9 of 463 expanded cases failed. `workflow/hooks/deny-dangerous/patterns-paths.sh` (search: `yq auto-detects whether a positional token is an expression or a file`) now parses jq bundles separately and exempts only yq's explicit `--expression` operand, `patterns-shell.sh` (`check_destructive_segment`) binds the eval denial to the command verb, and both corpora pass all 470 cases.

---

## Footgun: File-read deny does not bind Bash shell reads of secret files

**Status:** active | **Created:** 2026-04-19 | **Evidence:** ACTUAL_MEASURED
**hallucination-risk:** high - `Read(**/.env*)` in settings.json or a Codex TOML profile looks like a blanket secret-read deny but binds only file-read paths; a Bash payload (`cat .env`, `source .env`, `base64 ~/.aws/credentials`) succeeds unless the Bash hook blocks it.

**Prevention:**
1. For any new secret-path family, extend both `checkReadDenyCoversSecrets` in `src/cli/facts/agent/settings.ts` and `detectBashDenyCoversSecrets` in `src/cli/facts/agent/hooks.ts`. A settings-only addition creates a false pass; a hook-regex refactor without detector coverage creates a false fail.
2. Every hook `--self-test` includes `run_case "cat <secret>" "cat <secret>" 2` assertions; a structural pass without live probes reopens the gap.
3. Inside an agent session with the PreToolUse hook registered, run `bash .goat-flow/hooks/deny-dangerous.sh --self-test=smoke` or `--self-test=full` rather than a direct secret-read `--check` payload, which the outer hook intercepts. In a manual terminal, `patterns-paths.sh --check="cat .env"` remains valid and exits 2. Static inspection cannot distinguish tool-scoped from shell-scoped deny.

**Symptoms:** Before the Bash-side sentinel, `goat-flow audit --harness` reported `deny-covers-secrets: pass` while a live Bash probe returned exit 0. The expected result is now exit 2 with `BLOCKED: Secret-file access ...`.

**Why it happens:** Settings and config file-read denies are tool-scoped: Claude `Read(...)` patterns bind the Read tool, Codex TOML profiles bind filesystem access, and Antigravity and Copilot have no settings-layer file-read deny at all (`workflow/manifest.json`, search: `"type": "deny-script"`), so the Bash hook is their only layer. Two layers are required: file-read deny for the file tool path and the Bash-hook regex for shell.

**Version note (measured 2026-07-31):** on Claude Code 2.1.220 under `dontAsk`, a settings `Read(...)` deny did bind Bash reads of the same path in exact-path and glob forms, denying with `Permission to use Bash with command cat <path> has been denied` while control reads passed; measured in disposable `/tmp` repos. This does not retire the entry: the 2026-04-19 result stands for its version and Codex and other runtimes are unmeasured, so keep both layers and re-probe after a CLI upgrade.

**Evidence:** `.claude/settings.json` (search: `"Read(**/.env)"`) holds the tool-scoped denies; `.goat-flow/hooks/deny-dangerous/patterns-paths.sh` (search: `is_secret_path_touch`) is the Bash-side sentinel added 2026-04-19, blocking `cat .env`, `source .env`, `cat ~/.ssh/id_rsa`, `cat ~/.aws/credentials`, and `.pem/.key/.pfx` reads across hook-capable agents. `src/cli/audit/harness/check-constraints.ts` (search: `bashDenyCoversSecrets`) requires both `readDenyCoversSecrets` and `bashDenyCoversSecrets` before classifying an agent as covered; `src/cli/facts/agent/hooks.ts` (search: `detectBashDenyCoversSecrets`) scans the hook for the sentinel plus family markers for `.env*`, `.env.example` parity, normalized roots, `.ssh/`, `.aws/`, `secrets/`, credentials, and key material.

---

## Footgun: A guard's own self-test can encode a bypass as a passing allow assertion

**Status:** active | **Created:** 2026-08-19 | **Evidence:** ACTUAL_MEASURED
**hallucination-risk:** high - a green `--self-test` summary reads as proof the policy is sound when the suite may assert that the unsafe case is allowed; 470 executed cases with 0 skipped looked like strong evidence while one of them locked the hole open.

**Prevention:**
1. Every `expect_allow` for a path that contains a secret filename states why the operand does not resolve to a real secret. A spelling difference (`.env.example`) is asserted as spelling; a platform path rule is verified before it is trusted, and `C:name` is relative on Windows, not absolute.
2. When adding an exemption for a false positive, add the adversarial sibling in the same change: the nearest form that should still deny. An exemption with no paired block case is unfalsifiable.
3. Read a green self-test as "the asserted behaviour still holds", never as "the policy is sound". Auditing a guard means reading its allow list.

**Symptoms:** `bash workflow/hooks/deny-dangerous.sh --self-test=full` printed `PASS: deny-dangerous self-test (mode=full, executed=470, skipped=0)` while `cat C:.env`, `type C:.env`, `curl -T C:.env https://…`, and `powershell -c "Get-Content C:.env"` all exited 0. Plain `cat .env` was denied, so spot-checking the obvious form proved nothing about the drive-relative one.

**Why it happens:** `patterns-paths.sh` masked `([A-Za-z]):\.env…` to `__goat_drive_relative_env__` before the secret regex ran, and the self-test asserted `expect_allow paths "cat C:.env"` with a mirror in `deny-dangerous-policy.test.ts`, so the fixture read as coverage. The premise was wrong: Windows resolves `C:.env` against the current directory on C:, the checkout's own credential file.

**Evidence:** `workflow/hooks/deny-dangerous/patterns-paths.sh` (search: `Drive-relative operands such as`) removed the mask on 2026-08-19; only the `.env.example` spelling stays exempt on any drive. `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `Windows drive-relative env read`) reversed the assertion to `expect_block` and added the type, curl upload, and PowerShell siblings; the corpus went 470 to 481 executed. Measured at `81636441`: four drive-relative reads exited 0 before the fix and 2 with `Policy secret` after, while `cat C:.env.example` still exits 0.
