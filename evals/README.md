# Saved skill checks

Run a saved check after changing skill guidance or before a release. The kit uses native sub-agents from the maintainer's Codex or Claude session. Each live case costs three independent model runs plus collection and review. CI, preflight and `npm test` use deterministic checks only.

## Prepare a case

From this repository's root, with the development dependencies installed, prepare a run:

```bash
node evals/run.mjs prep --case critique-handback --harness codex
```

Use the case ID for the behavior you want to check.

| Behavior | Case IDs |
|---|---|
| Critique and planning intake | `critique-handback`, `intake-question-shape`, `existing-plan-check`, `interview-routing` |
| Existing tests | `qa-analysis-only`, `qa-required-failure` |
| Diagnosis and milestone gates | `debug-rounding-gate`, `plan-blocked-milestone` |
| Staged review and comment citations | `review-staged-authority`, `clarity-cited-comment` |
| Trusted security policy | `security-trusted-policy` |

For `security-trusted-policy`, commit `b5f111ce5643835e5f6cd9b687cef8dcb7147747` must
be available in the local checkout. Preparation imports the commit, its tree
metadata, and its policy blob into each synthetic project. The printed prompt
names the pinned authority for offline, read-only review.

## Run and score the samples

Keep the printed run ID. Launch a fresh native sub-agent with the complete contents of each printed prompt file. For Codex, launch each agent with `fork_turns: "none"` and retain the task handle returned by the host. Use the same model and settings for all three. Each prompt points to its own synthetic project and owner copies. Keep expected outcomes out of the prompts and agent memory. Finish collecting before editing the harness working tree.

For each completed agent, collect its own JSONL transcript. The Codex rollout lives in the Codex sessions directory. Its session record identifies the launched task by handle. Collection matches that handle and checks successful commands for the complete prepared skill and preamble. For cases without `"harness": "codex"` in `case.json`, you can prepare with `--harness claude` and collect the JSONL backing the agent's task output. Claude collection verifies the plain-text prompt and completed reads. Both preserve counts, fixture hashes, Git status and a redacted report.

```bash
node evals/run.mjs collect --run <id> --sample <n> --transcript <file> --agent <codex-handle>
node evals/run.mjs score --run <id>
```

Collect all three samples before scoring. The score report includes the result of each mechanical row and any rows for maintainer review. Exit 0 requires 3/3. A failed, missing, invalid or inconclusive sample keeps its place in the denominator. Collection errors leave the sample open for retry with the correct transcript. A changed harness status is inconclusive and needs investigation. Equal listings establish only that Git reported the same status.

The `--agent` argument is required for Codex collection. Find `run.json`, the per-sample evidence and `score.md` in gitignored `.goat-flow/logs/evals/<id>/`. The run records the harness, repository revision and owner-file hashes. Codex collection also retains available timing and token counts.
