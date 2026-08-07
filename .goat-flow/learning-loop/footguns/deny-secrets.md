---
category: deny-secrets
last_reviewed: 2026-08-01
---

Secret-path read traps: what counts as a secret path, and which read channels the deny surface actually binds.

Sibling buckets: `deny-shell.md`, `deny-writes.md`.

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
