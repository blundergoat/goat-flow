# Deterministic Audit Checks

`npx goat-flow audit` currently registers **36 deterministic checks**:

- **19 build checks**: 15 setup-scope checks plus 4 agent-scope checks
- **17 harness checks**: additional checks enabled by `--harness`

Default `npx goat-flow audit .` runs the build checks. `npx goat-flow audit . --harness` runs those same build checks plus the harness checks. Harness checks are still deterministic even when they are typed as `integrity`, `advisory`, or `metric`; the type changes scoring behavior, not whether the check is deterministic.

Machine-readable output is available with `--format json` or `--format sarif`. SARIF output registers each active audit check id as a SARIF rule id and emits results only for actionable audit findings: failing setup/agent/harness checks plus drift/content findings when those optional checks are enabled. SARIF rule ids are derived from the stable goat-flow check ids below, so renaming a check id is a downstream alert-identity change for SARIF consumers.

Source of truth:

- `src/cli/audit/check-goat-flow.ts` exports `SETUP_CHECKS`
- `src/cli/audit/check-agent-setup.ts` exports `AGENT_CHECKS`
- `src/cli/audit/harness/index.ts` exports `HARNESS_CHECKS`

## Build Checks

Build mode is the structural install gate. It validates files, directories, config, skills, settings, and deny wiring. It does **not** execute the project's lint, test, or build toolchain commands.

### Setup Scope (15)

| Check id | Display name | What it validates |
|----------|--------------|-------------------|
| `lessons` | Lessons | `.goat-flow/learning-loop/lessons/` and `.goat-flow/learning-loop/lessons/README.md` exist |
| `footguns` | Footguns | `.goat-flow/learning-loop/footguns/` and `.goat-flow/learning-loop/footguns/README.md` exist |
| `architecture` | Architecture | `.goat-flow/architecture.md` exists |
| `code-map` | Code map | `.goat-flow/code-map.md` exists |
| `glossary` | Glossary | `.goat-flow/glossary.md` exists |
| `patterns` | Patterns | `.goat-flow/learning-loop/patterns/README.md` exists |
| `decisions` | Decisions | `.goat-flow/learning-loop/decisions/` exists |
| `session-logs` | Session logs | `.goat-flow/logs/sessions/` exists |
| `plans` | Plans | `.goat-flow/plans/`, `.goat-flow/plans/.gitignore`, and `.goat-flow/plans/README.md` exist |
| `scratchpad` | Scratchpad | `.goat-flow/scratchpad/`, `.goat-flow/scratchpad/.gitignore`, and `.goat-flow/scratchpad/README.md` exist |
| `goat-flow-gitignore` | goat-flow gitignore exceptions | `.goat-flow/.gitignore` exists and contains the `!learning-loop/`, `!learning-loop/**`, `!skill-docs/`, `!skill-docs/**`, `!hooks/`, `!hooks/**`, `!plans/`, and `!plans/**` un-ignore entries. Catches stale installs whose gitignore silently hides committed goat-flow surfaces from git. Remediation re-runs the installer and prompts a `git add` of the previously hidden directories |
| `instruction-file-skill-docs-pointer` | Instruction file skill-docs/playbooks pointer | Requires the full skill-docs and playbook pack, a READ-step rule to consult `.goat-flow/skill-docs/playbooks/` and run playbook Availability Checks before declaring tools unavailable, and a Router Table pointer in each present instruction file (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`). Missing `.goat-flow/skill-docs/` or `.goat-flow/skill-docs/playbooks/` files fail here instead of falling through to `other-files` |
| `other-files` | Other required files | Every manifest-required file or directory not already covered by a named setup check exists, including local log README surfaces |
| `config-parses` | Config file | `.goat-flow/config.yaml` exists, parses as YAML, and validates against the manifest-backed config contract |
| `config-version` | Config version | `.goat-flow/config.yaml` declares the current `AUDIT_VERSION` |

### Agent Scope (4)

| Check id | Display name | What it validates |
|----------|--------------|-------------------|
| `agent-instruction` | Agent instruction file | The selected agent's instruction file exists; for Copilot, `.github/copilot-instructions.md` must also reference `docs/coding-standards/git-commit.md` under a `## Commit Messages` section. Without `--agent`, this also detects orphaned agent artifacts and incomplete Copilot installs |
| `agent-skills` | Agent skills | The selected agent has every canonical skill file, each installed skill declares the current `goat-flow-skill-version`, and no deprecated skill directories remain |
| `agent-settings` | Agent settings | The selected agent's settings file parses as valid JSON or TOML |
| `agent-guardrails` | Agent deny mechanism | The selected agent has a deny mechanism, any installed shell hooks pass `bash -n`, deny patterns exist, installed `deny-dangerous.sh` plus `.goat-flow/hooks/deny-dangerous/` match the workflow templates, `deny-dangerous-self-test.sh --self-test=smoke` passes when the hook scripts exist, and a runtime-shaped blocked Bash payload is denied through the registered hook path |

Aggregate-mode nuance:

- The audit report always includes these 4 registered agent-scope checks.
- Without `--agent <id>`, only `agent-instruction` can actively fail; the other 3 agent-scope checks are effectively no-ops until the audit is scoped to a concrete agent.

## Harness Checks

`npx goat-flow audit . --harness` adds **17** deterministic harness-completeness checks on top of the 19 build checks. These checks are grouped by concern and typed as `integrity`, `advisory`, or `metric`. JSON output exposes each check's raw `status` plus `displayStatus`, `impact`, and optional `assurance` so score-only metric/advisory warnings and platform-limited passes do not look like ordinary hard failures or full-assurance passes.

| Concern | Check id | Type | What it validates |
|---------|----------|------|-------------------|
| Context | `instruction-line-count` | `advisory` | Each configured instruction file stays within `lineLimits.limit` from `.goat-flow/config.yaml` |
| Context | `execution-loop-present` | `advisory` | Structural smoke check for the Execution Loop heading plus READ / SCOPE / ACT / VERIFY vocabulary |
| Context | `doc-paths-resolve` | `integrity` | Router-table paths, `.goat-flow/architecture.md` backtick paths, and curated audit/glossary docs backtick paths resolve to real files |
| Context | `instruction-sections-present` | `advisory` | Structural smoke check for required hot-path headings: Truth Order, Execution Loop, Definition of Done, and Router Table |
| Context | `boundary-guidance-present` | `advisory` | Structural smoke check for workspace boundary guidance (controlling workspace vs target workspace separation) |
| Constraints | `deny-covers-secrets` | `integrity` | Direct literal secret-path reads are blocked by the deny layer; agents with file-read deny need both settings/Codex permission coverage and Bash-hook direct-path coverage. Codex permission coverage is limited to exact paths and trailing `/**` subtrees accepted by the current CLI. Script-only agents can pass with `assurance: "limited"` because file-read deny is unavailable; a 100 constraints score means known deny-pattern coverage, not broad file read/write enforcement. |
| Constraints | `deny-blocks-dangerous` | `integrity` | Deny patterns block broad recursive deletion, all git push (ADR-025), and `chmod` |
| Constraints | `deny-blocks-pipe-to-shell` | `advisory` | Deny patterns block `curl | bash` and `wget | sh` pipe-to-shell execution |
| Constraints | `deny-hook-registered` | `integrity` | A deny hook that exists on disk is registered in the correct pre-tool hook slot |
| Verification | `hooks-registered` | `integrity` | Post-turn hook registrations and on-disk hook files stay in sync |
| Verification | `commit-guidance` | `advisory` | Commit guidance exists at the canonical `docs/coding-standards/git-commit.md`; old GitHub commit-guidance locations are flagged as misplaced |
| Verification | `evidence-before-claims` | `metric` | Present instruction files carry the Hallucination red-flags clauses and Rationalisations-to-reject pointer |
| Verification | `post-turn-hook-integrity` | `metric` | Reports whether any post-turn hook runs validation and whether it swallows failures; absence is no hook evidence, not proof. Metric failures do not fail the harness scope, but they reduce the concern score. |
| Recovery | `milestone-tracking` | `integrity` | `.goat-flow/plans/` exists; task count, checkbox completion, milestone status, and roadmap progress are optional local workflow state |
| Recovery | `session-logs` | `integrity` | `.goat-flow/logs/sessions/` exists |
| Feedback loop | `feedback-loop-active` | `integrity` | The lessons and footguns directories exist, with valid metadata and non-stale evidence references |
| Feedback loop | `decisions-tracked` | `integrity` | `.goat-flow/learning-loop/decisions/` exists |

## Command Matrix

| Command | Checks included | Notes |
|---------|-----------------|-------|
| `npx goat-flow audit .` | 15 setup + 4 agent = 19 build checks | Structural install gate only |
| `npx goat-flow audit . --agent <id>` | Same 19 build checks, with agent checks enforced for the selected agent | Best way to validate one runtime's install state |
| `npx goat-flow audit . --harness` | 19 build + 17 harness = 36 checks | Adds harness completeness, still deterministic |

Harness mode is still structural. It does not judge whether the content is actually good for the project; that remains the job of `npx goat-flow quality`.
