# AI Harness Audit

`npx goat-flow audit . --harness` adds 16 structural installation checks to the standard build audit. Each check answers an installation question - is the file present, is the registration in sync, is the deny pattern installed. Deterministic, no LLM involvement. Harness results contribute to the overall audit status. Not all checks can reach "installed" on every platform (e.g., Codex has no settings-based Read deny coverage; its deny layer is script-only), but install as much as possible.

| Mode | Command | Question |
|------|---------|----------|
| Build | `npx goat-flow audit .` | Is it installed correctly? |
| **Harness** | **`npx goat-flow audit . --harness`** | **Is each concern structurally installed?** |
| Quality | `npx goat-flow quality . --agent X` | Does this make sense to a fresh agent? |

Harness checks are grouped by the 5 concerns that every major source in the field agrees matter for agent effectiveness. The audit checks whether the structural wiring for each concern is in place. It does not judge content quality - that's what [quality](harness-quality.md) is for. See [harness-engineering.md](harness-engineering.md) for the sources behind the model.

## Check types

Each harness check carries a `type` tag that determines whether (and how) a failure affects the concern's status:

| Type | Meaning | Scored? | Opt-out |
|------|---------|---------|---------|
| **integrity** | Drift from install state (e.g., a router-table path that no longer resolves). Must be fixed. | Yes - fails concern. | No. |
| **advisory** | Best practice most projects should adopt (e.g., blocking pipe-to-shell). | Yes - fails concern unless acknowledged. | Yes, via `harness.acknowledge: [<check-id>]` in `.goat-flow/config.yaml`. Acknowledged advisory failures render as `acknowledged` and do not flip status. |
| **metric** | Workflow maturity signal (e.g., checkbox coverage on milestones). Count-only, never scored. | No. | N/A. |

### Scoring model

- A concern `status` is `pass` iff every `integrity` check passes AND every `advisory` check either passes or is acknowledged.
- `metric` checks never affect concern status; they are reported as counts.
- Overall harness `status` is `pass` iff every concern's `status` is `pass`.

### Acknowledging an advisory check

```yaml
# .goat-flow/config.yaml
harness:
  acknowledge:
    - deny-blocks-pipe-to-shell
```

Listing a check id silences that check. The finding still appears in audit output (so the project's opt-outs stay visible), but it is counted as `acknowledged` rather than `fail` and does not flip the concern's status.

Only `advisory`-typed checks can be acknowledged. Integrity checks have no opt-out; metrics are already un-scored.

## Check provenance

Every registered build and harness check now carries machine-readable `provenance` in `npx goat-flow audit . --format json`. The record includes `source_type`, `normative_level`, `verified_on`, and supporting `evidence_paths` / `source_urls`.

1.2.0 keeps provenance JSON-only on purpose. Terminal and markdown renderers stay focused on status + remediation; if you need the justification trail for a check, inspect the per-check `provenance` object in JSON output.

### The 16 checks by type

- **integrity (9):** `doc-paths-resolve`, `deny-covers-secrets`, `deny-blocks-dangerous`, `deny-hook-registered`, `hooks-registered`, `milestone-tracking`, `session-logs`, `feedback-loop-active`, `decisions-tracked`
- **advisory (5):** `instruction-line-count`, `execution-loop-present`, `instruction-sections-present`, `deny-blocks-pipe-to-shell`, `commit-guidance`
- **metric (2):** `test-runner-configured`, `post-turn-hook-integrity`

---

## 1. Context

**Question:** Is the agent's context structurally complete and pointing at real files?

The agent can only work with what it sees. Stale router paths, missing execution loops, and oversized instruction files all degrade performance. The audit checks structural wiring only; use `quality` to assess whether the content is actually useful for this project.

**Context checks (4):**

- `instruction-line-count` - each configured agent's instruction file is within the configured hard limit (`line-limits.limit` in `config.yaml`)
- `execution-loop-present` - instruction file contains at least 2 of the 4 READ / SCOPE / ACT / VERIFY keywords
- `doc-paths-resolve` - router-table paths, architecture.md backtick paths, and backtick paths in a small set of doc files (`CONTRIBUTING.md`, `.goat-flow/code-map.md`, `docs/cli.md`, `docs/audit-and-quality.md`) all resolve to real files on disk
- `instruction-sections-present` - instruction file carries the hot-path contract headings (Truth Order, Execution Loop, Definition of Done, Router Table); advisory - skeleton overlays that defer to a shared instruction file will fail this check

**Not checked here (belongs in quality):** whether instructions are specific to this project, whether footgun evidence is current, whether documentation content is accurate.


---

## 2. Constraints

**Question:** Do the deterministic safety rules cover the known-dangerous patterns?

Constraints are the cheapest, most reliable layer of the harness. They cost zero tokens, produce zero false positives when well-designed, and prevent entire failure categories without any LLM involvement.

**Constraints checks (4):**

- `deny-covers-secrets` - for agents with settings-based deny (Claude, Gemini), the deny configuration covers real `.env` files, credentials, `*.key`, `*.pem`, while allowing read-only `.env.example` inspection. Script-only agents (Codex, Copilot) rely entirely on the Bash deny hook, which is checked for the same coverage; the settings-based Read-deny check is skipped for them as a platform limitation, not a failure.
- `deny-blocks-dangerous` - each agent's deny configuration blocks `rm -rf`, force-push, and `chmod`
- `deny-blocks-pipe-to-shell` - each agent's deny configuration blocks `curl | bash` / `wget | sh` pipe-to-shell patterns
- `deny-hook-registered` - hook registrations and hook files are in sync (registered hooks exist on disk, existing hooks are registered)

**Not checked here:** Ask First boundary counts, linter registration cross-reference, static-analysis tool detection. Those were earlier designs that were dropped as either low signal or out-of-scope for a structural audit.



---

## 3. Verification

**Question:** Is the agent's verification wiring structurally in place?

Verification loops are consistently reported as the single highest-impact harness pattern. The audit checks that the wiring is present; it does not grade whether the verification is sufficient.

**Verification checks (4):**

- `test-runner-configured` - informational (always passes). Reports whether `toolchain.test` is set in `config.yaml`, or notes that project-local / instruction-file commands are the source of truth. Missing `toolchain.test` is explicitly treated as valid.
- `hooks-registered` - hook registrations and hook files are in sync (no registered-but-missing, no exists-but-unregistered) for each agent
- `commit-guidance` - commit guidance is present (instruction file contains commit conventions or a local git-commit guidance doc exists, such as `docs/coding-standards/git-commit.md`)
- `post-turn-hook-integrity` - informational (always passes). If a post-turn hook exists, reports whether it runs validation and whether it exits 0 unconditionally (advisory mode)

**Not checked here:** lint command presence (no longer required - treated as project-local), Ask First quality, verification effectiveness. goat-flow core does not ship a post-turn hook - the integrity check only reports on project-specific hooks if present.



---

## 4. Recovery

**Question:** Can the agent resume after crash, compaction, or interruption?

Agents that run for minutes or hours need durable state. Without recovery mechanisms, a crashed session means starting from scratch.

**Recovery checks (2):**

- `milestone-tracking` - `.goat-flow/tasks/` directory exists. Passes if directory exists (even if empty - valid for fresh installs). Reports checkbox coverage informationally.
- `session-logs` - `.goat-flow/logs/sessions/` directory exists. Does not count entries.

**Not checked here:** entry counts, recency, content quality of task or session files. A fresh install passes.



---

## 5. Feedback Loop

**Question:** Are the feedback-loop directories wired up?

A fresh install with zero footguns and zero lessons is a valid PASS. The audit only checks that the infrastructure exists; `quality` assesses whether the content is high-quality and actively maintained.

**Feedback Loop checks (2):**

- `feedback-loop-active` - `.goat-flow/footguns/` and `.goat-flow/lessons/` directories both exist. Entry count is reported but never used as a failure condition.
- `decisions-tracked` - `.goat-flow/decisions/` directory exists. Record count is reported informationally.

**Not checked here:** entry counts, recency (`**Created:**` dates), content accuracy, staleness of `file:line` references in footgun entries, whether active/resolved statuses are accurate. All of these are content-quality judgments that belong in `quality`.
