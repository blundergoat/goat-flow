# Deterministic Audit Checks

`npx goat-flow audit` currently registers **34 deterministic checks**:

- **17 build checks**: 13 setup-scope checks plus 4 agent-scope checks
- **17 harness checks**: additional checks enabled by `--harness`

Default `npx goat-flow audit .` runs the build checks. `npx goat-flow audit . --harness` runs those same build checks plus the harness checks. Harness checks are still deterministic even when they are typed as `integrity`, `advisory`, or `metric`; the type changes scoring behavior, not whether the check is deterministic.

Source of truth:

- `src/cli/audit/check-goat-flow.ts` exports `SETUP_CHECKS`
- `src/cli/audit/check-agent-setup.ts` exports `AGENT_CHECKS`
- `src/cli/audit/harness/index.ts` exports `HARNESS_CHECKS`

## Build Checks

Build mode is the structural install gate. It validates files, directories, config, skills, settings, and deny wiring. It does **not** execute the project's lint, test, or build toolchain commands.

### Setup Scope (13)

| Check id | Display name | What it validates |
|----------|--------------|-------------------|
| `lessons` | Lessons | `.goat-flow/lessons/` and `.goat-flow/lessons/README.md` exist |
| `footguns` | Footguns | `.goat-flow/footguns/` and `.goat-flow/footguns/README.md` exist |
| `architecture` | Architecture | `.goat-flow/architecture.md` exists |
| `code-map` | Code map | `.goat-flow/code-map.md` exists |
| `glossary` | Glossary | `.goat-flow/glossary.md` exists |
| `patterns` | Patterns | `.goat-flow/patterns/README.md` exists |
| `decisions` | Decisions | `.goat-flow/decisions/` exists |
| `session-logs` | Session logs | `.goat-flow/logs/sessions/` exists |
| `tasks` | Tasks | `.goat-flow/tasks/`, `.goat-flow/tasks/.gitignore`, and `.goat-flow/tasks/README.md` exist |
| `scratchpad` | Scratchpad | `.goat-flow/scratchpad/`, `.goat-flow/scratchpad/.gitignore`, and `.goat-flow/scratchpad/README.md` exist |
| `other-files` | Other required files | Every manifest-required file or directory not already covered by a named setup check exists, including the shared skill-reference and quality-log surfaces |
| `config-parses` | Config file | `.goat-flow/config.yaml` exists, parses as YAML, and validates against the manifest-backed config contract |
| `config-version` | Config version | `.goat-flow/config.yaml` declares the current `AUDIT_VERSION` |

### Agent Scope (4)

| Check id | Display name | What it validates |
|----------|--------------|-------------------|
| `agent-instruction` | Agent instruction file | The selected agent's instruction file exists; Copilot additionally requires `.github/git-commit-instructions.md` when `.github/` exists. Without `--agent`, this also detects orphaned agent artifacts and incomplete Copilot installs |
| `agent-skills` | Agent skills | The selected agent has every canonical skill file, each installed skill declares the current `goat-flow-skill-version`, and no deprecated skill directories remain |
| `agent-settings` | Agent settings | The selected agent's settings file parses as valid JSON or TOML |
| `agent-deny-dangerous` | Agent deny mechanism | The selected agent has a deny mechanism, any installed shell hooks pass `bash -n`, deny patterns exist, and `deny-dangerous.sh --self-test` passes when the hook script exists |

Aggregate-mode nuance:

- The audit report always includes these 4 registered agent-scope checks.
- Without `--agent <id>`, only `agent-instruction` can actively fail; the other 3 agent-scope checks are effectively no-ops until the audit is scoped to a concrete agent.

## Harness Checks

`npx goat-flow audit . --harness` adds **17** deterministic harness-completeness checks on top of the 17 build checks. These checks are grouped by concern and typed as `integrity`, `advisory`, or `metric`.

| Concern | Check id | Type | What it validates |
|---------|----------|------|-------------------|
| Context | `instruction-line-count` | `advisory` | Each configured instruction file stays within `lineLimits.limit` from `.goat-flow/config.yaml` |
| Context | `execution-loop-present` | `advisory` | Each instruction file contains the READ / SCOPE / ACT / VERIFY execution-loop vocabulary |
| Context | `doc-paths-resolve` | `integrity` | Router-table paths, `.goat-flow/architecture.md` backtick paths, and curated audit docs backtick paths resolve to real files |
| Context | `instruction-sections-present` | `advisory` | Each instruction file contains the required hot-path headings: Truth Order, Execution Loop, Definition of Done, and Router Table |
| Context | `boundary-guidance-present` | `advisory` | Each instruction file contains workspace boundary guidance (controlling workspace vs target workspace separation) |
| Constraints | `deny-covers-secrets` | `integrity` | Secret-bearing file reads are covered by the deny layer; settings-based agents need both settings `Read` deny coverage and Bash-hook coverage |
| Constraints | `deny-blocks-dangerous` | `integrity` | Deny patterns block `rm -rf`, all git push (ADR-025), and `chmod` |
| Constraints | `deny-blocks-pipe-to-shell` | `advisory` | Deny patterns block `curl | bash` and `wget | sh` pipe-to-shell execution |
| Constraints | `deny-hook-registered` | `integrity` | A deny hook that exists on disk is registered in the correct pre-tool hook slot |
| Verification | `test-runner-configured` | `metric` | Reports whether `toolchain.test` is configured; missing structured test config is still a pass |
| Verification | `hooks-registered` | `integrity` | Post-turn hook registrations and on-disk hook files stay in sync |
| Verification | `commit-guidance` | `advisory` | Commit guidance exists at `.github/git-commit-instructions.md` when `.github/` exists, or in a supporting commit-guidance document otherwise |
| Verification | `post-turn-hook-integrity` | `metric` | Reports whether any post-turn hook runs validation and whether it swallows failures |
| Recovery | `milestone-tracking` | `integrity` | `.goat-flow/tasks/` exists and milestone files can report checkbox coverage |
| Recovery | `session-logs` | `integrity` | `.goat-flow/logs/sessions/` exists |
| Feedback loop | `feedback-loop-active` | `integrity` | The lessons and footguns directories exist; stale references are informational only |
| Feedback loop | `decisions-tracked` | `integrity` | `.goat-flow/decisions/` exists |

## Command Matrix

| Command | Checks included | Notes |
|---------|-----------------|-------|
| `npx goat-flow audit .` | 13 setup + 4 agent = 17 build checks | Structural install gate only |
| `npx goat-flow audit . --agent <id>` | Same 17 build checks, with agent checks enforced for the selected agent | Best way to validate one runtime's install state |
| `npx goat-flow audit . --harness` | 17 build + 17 harness = 34 checks | Adds harness completeness, still deterministic |

Harness mode is still structural. It does not judge whether the content is actually good for the project; that remains the job of `npx goat-flow quality`.
