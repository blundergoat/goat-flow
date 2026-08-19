---
category: deny-secrets
last_reviewed: 2026-08-19
---

Secret-path read traps: what counts as a secret path, and which read channels the deny surface actually binds.

Sibling buckets: `deny-shell.md`, `deny-writes.md`.

## Footgun: Secret-path matching must distinguish search data from file operands

**Status:** active | **Created:** 2026-08-17 | **Evidence:** ACTUAL_MEASURED

**Decision changed:** Exempt protected text only after a command-specific parser proves that it is search data, and keep every remaining file operand under the secret-path matcher.

**Symptoms:** The hook blocked `git log -S`, `-G`, and `--grep` searches for a permission-rule string containing `.ssh`, even when the command's only pathspec was an ordinary settings file. The first exemption then allowed protected Git-global paths such as `git -C ~/.ssh log -S token` and misparsed a quoted search value containing spaces.

**Why it happens:** The generic secret matcher sees a protected substring anywhere in the command and cannot tell a Git history search value from a path operand. Git-global options may carry paths before the `log` subcommand, while Git's `--` delimiter makes every following token a pathspec even if it resembles an option; only the recognised search values between those boundaries are data.

**Evidence:**
- Before the exemption, the focused deny corpus failed only the three Git history allow cases with `FAIL: paths should allow git log ... secret-rule search literal`; after the parser change, the original `git log --oneline -S 'Write(**/.ssh/**)' -- .claude/settings.json` reproduction exited 0.
- Final diff review added a focused RED where a spaced search value failed closed correctly but `git -C ~/.ssh` and `git --git-dir=~/.ssh/repo` incorrectly exited 0; preserving the original word boundaries and Git-global operands made all 92 path assertions pass.
- `workflow/hooks/deny-dangerous/patterns-paths.sh` (search: `git_log_candidate_without_search_values`) removes only recognised Git log search values before `--` and retains all path operands for secret scanning.
- `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `git log protected separated global path`) pairs separated and attached search-value allows with protected global-path, pathspec, write, and upload blocks.

**Prevention:**
1. Limit data exemptions to the documented grammar of `git log -S`, `-G`, and `--grep`; malformed or unrecognised forms must fall back to the generic fail-closed scan.
2. Retain Git-global options and their operands before `log`, then stop option parsing at `--` and retain every later token as a path operand.
3. Pair every harmless-search allow case with direct protected pathspec, read/write, and upload block cases for the same secret family.

---

## Footgun: Extension-based secret checks can confuse filenames with query syntax

**Status:** active | **Created:** 2026-05-27 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 3 | **Latest occurrence:** 2026-08-19

**Symptoms:** A secret-path hook correctly blocks `cat path/to/id_rsa.key`, but also blocks harmless jq/yq expressions such as `jq -r .key file.json` and `yq .metadata.key file.yaml`, plus text after an unquoted shell comment, e.g. `git status # .env`.

**Why it happens:** A broad `.(pem|key|pfx)` extension regex sees dotted query fields and filenames as the same shape; scanning the raw segment before comment stripping also treats inert comment text as an argument.

**Evidence:**
- M12 pre-fix probes blocked `git status # .env` and `jq -r .key file.json`; post-fix they return 0 while `cat path/to/id_rsa.key` still returns 2.
- `workflow/hooks/deny-dangerous.sh` (search: `strip_unquoted_shell_comments`) strips inert comments before policy matching; `workflow/hooks/deny-dangerous/patterns-paths.sh` (search: `key_material_path_touch`) requires a meaningful filename/path stem for `.pem`, `.key`, and `.pfx`; `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `jq bare key query`) locks both allow and block cases.

**Recurrence update (2026-08-18):** The bare-field fix still blocked fields glued to jq syntax: `select(.key == "name")` and `map(.metadata.key == "name")`. Focused RED labels `jq glued select key query` and `jq glued map key query` failed while ordinary real `.key` file controls still blocked. An initial punctuation-tail exemption passed those cases but also allowed later input files named `select(.key`; two new negative controls caught that safety regression. `key_material_path_touch` now finds the single jq/yq filter operand from the quote-aware argument stream and exempts only that role, while every option value and later file operand remains scanned. The full installed and workflow corpora each pass 450 cases, including grouped-name, spaced-name, input-file, filter-file, and non-query controls.

**Second recurrence update (2026-08-19):** Fresh review checked jq 1.7 help and current yq option documentation instead of treating the two CLIs as one grammar. The first role parser missed valid jq `-rf`/`-fr` filter-file bundles, treated yq boolean flags as value-taking, and exempted yq's first positional token even though yq can infer that token is an input file. It also skipped attached or file-valued yq options, while the shell token scan mistook yq's `eval` subcommand for the shell builtin. Inert `--check` probes returned exit 0 for every protected-file shape, and the first expanded corpus failed 9 of 463 cases. `key_material_path_touch` (search: `yq auto-detects whether a positional token is an expression or a file`) now parses jq bundles separately and exempts only yq's explicit `--expression` operand; `patterns-shell.sh` (`check_destructive_segment`) binds the eval denial to the command verb. Both installed and workflow full corpora now pass all 470 cases, including harmless jq literal arguments and file-reading jq option controls.

**Prevention:**
1. Secret-path tests must include inert dotted query expressions as allow controls alongside real key-file paths.
2. Run comment false-positive probes for every policy hook after changing shared shell-segment prep.
3. Prefer file-shape helpers over broad extension regexes when a token can also be valid data syntax.
4. Include both bare and syntax-glued query fields in allow controls, and pair each with protected input-file, filter-file, and non-query-command blocks.
5. Build separate option-arity tables for jq and yq. Cover bundled short flags, boolean flags, equals values, implicit-file detection, expression-provider flags, and file-valued options.
6. Bind a dangerous shell keyword to the normalized command verb; an external CLI subcommand with the same spelling is an allow control.

---

## Footgun: File-read deny does not bind Bash shell reads of secret files

**Status:** active | **Created:** 2026-04-19 | **Evidence:** ACTUAL_MEASURED
**hallucination-risk:** high - `Read(**/.env*)` (settings.json or a Codex TOML profile) looks like a blanket secret-read deny but binds only file-read paths; a Bash payload (`cat .env`, `source .env`, `base64 ~/.aws/credentials`) is not bound by it and silently succeeds unless the Bash hook blocks it.

**Symptoms:** Before the Bash-side sentinel was added, `goat-flow audit --harness` reported `deny-covers-secrets: pass` while a live Bash probe returned exit 0. Expected is now exit 2 with `BLOCKED: Secret-file access ...`, verified by the context-specific recipes below.

**Why it happens:** Settings/config file-read deny entries are tool-scoped. Claude/Gemini `Read(...)` patterns bind the Read tool; Codex TOML permission profiles bind filesystem access. An agent using the Bash tool to run `cat .env` is not protected by file-read intent alone. Two coverage layers are required: file-read deny for the file tool path AND Bash-hook regex for shell.

**Version update (2026-07-31, ACTUAL_MEASURED - narrows this for current Claude Code):** on 2.1.220 under `dontAsk`, a settings `Read(...)` deny DID bind Bash reads of the same path in both rule forms - exact-path and glob (`//<root>/**/hidden-*.txt`). Denials read `Permission to use Bash with command cat <path> has been denied` while control reads passed and the dummy marker never entered either session. Measured in disposable `/tmp` repos (see `.goat-flow/plans/1.15.0/M06-claude-reporting-session-enforcement.md`, search: `That question is now MEASURED`). Does NOT retire this entry: the 2026-04-19 result stands for its version, Codex and other runtimes are unmeasured, and this is version-specific. Keep both layers; re-probe after a CLI upgrade.

**Evidence:**
- `.claude/settings.json` (search: `"Read(**/.env)"`) - tool-scoped deny patterns, not applied to Bash. `.goat-flow/hooks/deny-dangerous/patterns-paths.sh` (search: `is_secret_path_touch`) - Bash-side sentinel added 2026-04-19, blocking `cat .env`, `source .env`, `cat ~/.ssh/id_rsa`, `cat ~/.aws/credentials`, and `.pem/.key/.pfx` across hook-capable agents.
- `src/cli/audit/harness/check-constraints.ts` (search: `bashDenyCoversSecrets`) - harness now requires BOTH `readDenyCoversSecrets` (settings/Codex permission file-read coverage) AND `bashDenyCoversSecrets` (Bash hook pattern) before classifying an agent as covered.
- `src/cli/facts/agent/hooks.ts` (search: `detectBashDenyCoversSecrets`) - fact derivation scans the deny hook file for the active secret sentinel plus family markers for `.env*`, `.env.example` parity, normalized `./` / `../` / `~/` roots, `.ssh/`, `.aws/`, `secrets/`, credentials, and `.pem/.key/.pfx`. Direct-terminal probe outside a registered agent hook: `bash .goat-flow/hooks/deny-dangerous/patterns-paths.sh --check="cat .env"` returns exit 2 with `BLOCKED: Secret-file access blocked`.

**Prevention:**
1. For any new secret-path family added to the harness, extend BOTH `checkReadDenyCoversSecrets` in `src/cli/facts/agent/settings.ts` AND `detectBashDenyCoversSecrets` in `src/cli/facts/agent/hooks.ts`. A settings-only addition creates a false-pass; a hook-regex refactor without detector coverage, a false-fail.
2. Every hook `--self-test` must include `run_case "cat <secret>" "cat <secret>" 2` assertions; a structural PASS without live probes reopens the gap.
3. In an agent session with the PreToolUse hook registered, run `bash .goat-flow/hooks/deny-dangerous.sh --self-test=smoke` (or `--self-test=full`); do not put a direct secret-read `--check` payload in the agent's shell command because the outer hook can intercept it first. In a manual terminal outside an agent hook, the direct `patterns-paths.sh --check="cat .env"` probe remains valid and should exit 2. Static inspection cannot distinguish tool-scoped from shell-scoped deny.

---

## Footgun: A guard's own self-test can encode a bypass as a passing allow assertion

**Status:** active | **Created:** 2026-08-19 | **Evidence:** ACTUAL_MEASURED
**hallucination-risk:** high - a green `--self-test` summary reads as proof the policy is sound, when the suite may be asserting that the unsafe case is *allowed*. The larger the corpus, the more convincing the false assurance: 470 executed cases with 0 skipped looked like strong evidence while one of those cases locked the hole open.

**Symptoms:** `bash workflow/hooks/deny-dangerous.sh --self-test=full` printed `PASS: deny-dangerous self-test (mode=full, executed=470, skipped=0)` while `cat C:.env`, `type C:.env`, `curl -T C:.env https://…`, and `powershell -c "Get-Content C:.env"` all returned exit 0. Plain `cat .env` correctly denied, so spot-checking the obvious form proved nothing about the drive-relative one.

**Why it happens:** A path exemption added to silence a false positive gets a matching `expect_allow` fixture in the same change, and the fixture is then read as coverage. Here `patterns-paths.sh` masked `([A-Za-z]):\.env…` to `__goat_drive_relative_env__` before the secret regex ran, and `deny-dangerous-self-test.sh` asserted `expect_allow paths "cat C:.env" "Windows drive-relative env text"` with a mirror case in `deny-dangerous-policy.test.ts`. The exemption's premise was wrong: `C:.env` is drive-relative, so Windows resolves it against the current directory on C: - the checkout's own credential file - rather than naming some unrelated location.

**Evidence:**
- `workflow/hooks/deny-dangerous/patterns-paths.sh` (search: `Drive-relative operands such as`) - mask removed 2026-08-19; only the `.env.example` spelling stays exempt, on any drive.
- `workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh` (search: `Windows drive-relative env read`) - the allow assertion was reversed to `expect_block` and three sibling channels (type, curl upload, PowerShell) added. Corpus went 470 -> 481 executed, still 0 skipped.
- Measured at `81636441` before the fix: four drive-relative reads exit 0; after: all exit 2 with `Policy secret`, while `cat C:.env.example` still exits 0.

**Prevention:**
1. Every `expect_allow` for a path that *contains* a secret filename must state why the operand does not resolve to a real secret. If the reason is a spelling difference (`.env.example`), assert the spelling; if it is a platform path rule, verify that rule before trusting it - `C:name` is relative on Windows, not absolute.
2. When adding an exemption to fix a false positive, add the adversarial sibling in the same change: the nearest form that *should* still deny. An exemption with no paired block case is unfalsifiable.
3. Read a green self-test summary as "the asserted behaviour still holds", never as "the policy is sound". Auditing a guard means reading its allow list, not re-running its suite.

---
