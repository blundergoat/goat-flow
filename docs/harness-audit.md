# AI Harness Audit

`goat-flow audit . --harness` adds 16 structural installation checks to the standard build audit. Each check answers an installation question — is the file present, is the registration in sync, is the deny pattern installed. Deterministic, no LLM involvement. Harness results contribute to the overall audit status. Not all checks can reach "installed" on every platform (e.g., Codex lacks compaction hooks), but install as much as possible.

| Mode | Command | Question |
|------|---------|----------|
| Build | `goat-flow audit .` | Is it installed correctly? |
| **Harness** | **`goat-flow audit . --harness`** | **Is each concern structurally installed?** |
| Critique | `goat-flow critique . --agent X` | Does this make sense to a fresh agent? |

Harness checks are grouped by the 5 concerns that every major source in the field agrees matter for agent effectiveness. The audit checks whether the structural wiring for each concern is in place. It does not judge content quality - that's what [critique](harness-critique-quality.md) is for. See [harness-engineering.md](harness-engineering.md) for the sources behind the model.

---

## 1. Context

**Question:** Is the agent's context structurally complete and pointing at real files?

The agent can only work with what it sees. Stale router paths, missing execution loops, and oversized instruction files all degrade performance. The audit checks structural wiring only; use `critique` to assess whether the content is actually useful for this project.

**Checks (3):**

- `instruction-line-count` - each configured agent's instruction file is within the configured hard limit (`line-limits.limit` in `config.yaml`)
- `execution-loop-present` - instruction file contains at least 2 of the 4 READ / SCOPE / ACT / VERIFY keywords
- `doc-paths-resolve` - router-table paths, architecture.md backtick paths, and backtick paths in a small set of doc files (`CONTRIBUTING.md`, `.goat-flow/code-map.md`, `docs/cli.md`, `docs/audit-and-critique.md`) all resolve to real files on disk

**Not checked here (belongs in critique):** whether instructions are specific to this project, whether footgun evidence is current, whether documentation content is accurate.


---

## 2. Constraints

**Question:** Do the deterministic safety rules cover the known-dangerous patterns?

Constraints are the cheapest, most reliable layer of the harness. They cost zero tokens, produce zero false positives when well-designed, and prevent entire failure categories without any LLM involvement.

**Checks (4):**

- `deny-covers-secrets` - for agents with settings-based deny (Claude, Gemini), the deny configuration covers `.env`, credentials, `*.key`, `*.pem`. Script-only agents (Codex) are noted as a platform limitation, not a failure.
- `deny-blocks-dangerous` - each agent's deny configuration blocks `rm -rf`, force-push, and `chmod`
- `deny-blocks-pipe-to-shell` - each agent's deny configuration blocks `curl | bash` / `wget | sh` pipe-to-shell patterns
- `deny-hook-registered` - hook registrations and hook files are in sync (registered hooks exist on disk, existing hooks are registered)

**Not checked here:** Ask First boundary counts, linter registration cross-reference, static-analysis tool detection. Those were earlier designs that were dropped as either low signal or out-of-scope for a structural audit.



---

## 3. Verification

**Question:** Is the agent's verification wiring structurally in place?

Verification loops are consistently reported as the single highest-impact harness pattern. The audit checks that the wiring is present; it does not grade whether the verification is sufficient.

**Checks (4):**

- `test-runner-configured` - informational (always passes). Reports whether `toolchain.test` is set in `config.yaml`, or notes that project-local / instruction-file commands are the source of truth. Missing `toolchain.test` is explicitly treated as valid.
- `hooks-registered` - hook registrations and hook files are in sync (no registered-but-missing, no exists-but-unregistered) for each agent
- `commit-guidance` - commit guidance is present (instruction file contains commit conventions or `.github/instructions/git-commit.md` exists)
- `post-turn-hook-integrity` - informational (always passes). If a post-turn hook exists, reports whether it runs validation and whether it exits 0 unconditionally (advisory mode)

**Not checked here:** lint command presence (no longer required - treated as project-local), Ask First quality, verification effectiveness. goat-flow core does not ship a post-turn hook - the integrity check only reports on project-specific hooks if present.



---

## 4. Recovery

**Question:** Can the agent resume after crash, compaction, or interruption?

Agents that run for minutes or hours need durable state. Without recovery mechanisms, a crashed session means starting from scratch.

**Checks (3):**

- `milestone-tracking` - `.goat-flow/tasks/` directory exists. Passes if directory exists (even if empty - valid for fresh installs). Reports checkbox coverage informationally.
- `session-logs` - `.goat-flow/logs/sessions/` directory exists. Does not count entries.
- `compaction-hook` - compaction hook registered for each settings-capable agent (Claude, Gemini). Codex is noted as platform-unsupported, not a failure.

**Not checked here:** entry counts, recency, content quality of task or session files. A fresh install passes.



---

## 5. Feedback Loop

**Question:** Are the feedback-loop directories wired up?

A fresh install with zero footguns and zero lessons is a valid PASS. The audit only checks that the infrastructure exists; `critique` assesses whether the content is high-quality and actively maintained.

**Checks (2):**

- `feedback-loop-active` - `.goat-flow/footguns/` and `.goat-flow/lessons/` directories both exist. Entry count is reported but never used as a failure condition.
- `decisions-tracked` - `.goat-flow/decisions/` directory exists. Record count is reported informationally.

**Not checked here:** entry counts, recency (`**Created:**` dates), content accuracy, staleness of `file:line` references in footgun entries, whether active/resolved statuses are accurate. All of these are content-quality judgments that belong in `critique`.

