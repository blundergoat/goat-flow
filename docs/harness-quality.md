# AI Harness Quality Assessment

`npx @blundergoat/goat-flow@latest quality . --agent claude --mode harness` generates a structured prompt for a coding agent to evaluate the harness. Where the audit runs deterministic pass/fail checks (see [harness-audit.md](harness-audit.md)), the quality assessment asks an agent to inspect project evidence and judge whether the harness is useful in this codebase.

| Mode | Command | Question |
|------|---------|----------|
| Build | `npx @blundergoat/goat-flow@latest audit .` | Is it installed correctly? |
| Harness | `npx @blundergoat/goat-flow@latest audit . --harness` | Is the harness structurally complete? |
| **Quality** | **`npx @blundergoat/goat-flow@latest quality . --agent X --mode harness`** | **Does this make sense to a fresh agent?** |

The generated prompt asks an agent to judge whether the harness is usable, not just structurally present. The evaluation covers:

1. **Ground yourself** - run the project's validation commands (`audit --harness`, `stats --check`), save the output
2. **Concern-by-concern analysis** - for each of the 5 harness concerns (Context, Constraints, Verification, Recovery, Feedback Loop), assess what works, what fails or is weak, and provide file or semantic-anchor evidence
3. **False positive and false negative risks** - identify where a structural PASS hides a real gap, and where a FAIL is misleading
4. **Refuted candidates** - preserve suspected findings the assessor tested and ruled out, with the reason and source or command evidence
5. **Top 5 improvements** - prioritize actionable fixes with evidence and verification commands

Findings are severity-ranked (BLOCKER / MAJOR / MINOR) with evidence quality marked (OBSERVED vs INFERRED). The prompt embeds the current audit results so the agent knows what's already passing or failing.

**Time and cost:** Expect 15-60 minutes depending on depth, with moderate token usage.

## Persisting quality reports

The CLI prompt keeps the completed JSON in memory and sends it to the exact-version `quality save` command. The saver redacts accepted strings, validates the report, chooses the filename, and persists the final JSON under the selected project's gitignored `.goat-flow/logs/quality/` directory. Dashboard-launched enforced Claude sessions use the dashboard staging contract described in the [CLI reference](cli.md#goat-flow-quality-path---agent-id---mode-mode).

```bash
npx @blundergoat/goat-flow@latest quality . --agent claude --mode harness
npx @blundergoat/goat-flow@latest quality history --agent claude
npx @blundergoat/goat-flow@latest quality diff --agent claude
```

Saved reports live locally under `.goat-flow/logs/quality/` as validated JSON. New reports record run provenance under `assessment_context` and require a `refuted_candidates` array, which may be empty. Each refuted row explains what claim was excluded and the source or command evidence that disproved it, keeping it separate from actionable findings. `history` and `diff` keep older reports loadable when either field predates their schema; a missing legacy ledger is read as `[]`.

---

## What the quality assessment evaluates beyond audit

The audit checks whether files exist, paths resolve, and patterns are registered. The quality assessment goes deeper into the same 5 concerns by assessing content quality - things that require reading comprehension, not just file checks.

### 1. Context

**Audit checks:** instruction file within line limit, execution loop keywords present, doc paths resolve.

**Quality evaluates:**
- Is the instruction file specific to this project's stack and domain, or generic boilerplate?
- Are the BAD/GOOD examples drawn from real project incidents or template fill?
- Does the architecture doc describe the current system accurately? Numeric claims (check counts, file counts, skill counts) are the most common drift.
- Do footgun entries cite semantic-anchor evidence (function name, unique string, `(search: "pattern")`) that still resolves in the current code?
- Does the architecture doc have substantive content, not just headings?

### 2. Constraints

**Audit checks:** deny blocks direct literal secret paths, deny blocks dangerous commands, deny blocks pipe-to-shell, deny hook registered in agent settings.

**Quality evaluates:**
- Are Ask First boundaries specific to real risk areas in this codebase, or generic placeholders?
- Does the deny-dangerous hook pass its self-test (`deny-dangerous.sh --self-test`)?
- Does `.goat-flow/config.yaml` stay lean and accurate for this project? Optional project-calibration fields such as `toolchain` are valid only when they reflect real commands; their absence is not a setup gap.
- Are there static analysis tools in the project's package manifest that aren't registered as constraints?

### 3. Verification

**Audit checks:** hooks in sync, commit guidance present, evidence-before-claims rule present, post-turn hook integrity (score-only metric for runtimes with a post-turn event; skipped where the runtime has no such event).

**Quality evaluates:**
- Do the configured validation commands actually run and produce meaningful output?
- Does the generated post-turn hook run literal validation commands (lint, typecheck, shellcheck), or just exit 0?
- Does the hook report failures honestly, or swallow them with `|| true`?

### 4. Recovery

**Audit checks:** plans directory exists, session logs directory exists.

**Quality evaluates:**
- Are recovery instructions clear about optional task files versus session logs?
- Do skills handle missing or stale `.goat-flow/plans/.active` markers without treating local task state as a setup defect?
- Do recovery docs avoid stale references to removed handoff or task-state files?

### 5. Feedback Loop

**Audit checks:** footgun and lesson directories exist, decisions directory exists.

**Quality evaluates:**
- Are footgun and lesson entries from real incidents, or synthetic?
- Do recent incidents appear in the learning loop, or are recurring failures missing from the record?
- Are active/resolved statuses accurate? An "active" footgun describing fixed behavior is stale.
- Do semantic-anchor references in entries still resolve in the current code?

---

## When to use quality

[Audit & Quality](audit-and-quality.md#when-to-use-quality) owns the routing rules for both commands. The harness-specific case: reach for `--mode harness` when `audit --harness` passes and you still suspect the concerns are wired but not useful.
