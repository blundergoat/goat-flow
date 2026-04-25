# AI Harness Quality Assessment

`npx goat-flow quality . --agent claude --mode harness` generates a structured prompt for a coding agent to evaluate the harness. Where the audit runs deterministic pass/fail checks (see [harness-audit.md](harness-audit.md)), the quality assessment asks an LLM to try the system on real code and judge whether the content is actually useful for this project.

| Mode | Command | Question |
|------|---------|----------|
| Build | `npx goat-flow audit .` | Is it installed correctly? |
| Harness | `npx goat-flow audit . --harness` | Is the harness structurally complete? |
| **Quality** | **`npx goat-flow quality . --agent X --mode harness`** | **Does this make sense to a fresh agent?** |

Quality is not automated checks. It generates a prompt that walks an agent through a 7-part evaluation:

1. **Ground yourself** - run the project's validation commands, save the output
2. **Pre-check** - structural pass/fail on skills, instruction file, router table
3. **Setup quality** - was the harness adapted to this project or left as boilerplate?
4. **Skill assessment** - evaluate each skill's structure and coherence; live invocation if context allows
5. **System assessment** - is the execution loop useful or ceremony? Are 7 skills the right number? Is the dispatcher worth the routing step?
6. **Contradictions and false paths** - find stale references, dead concepts, conflicting docs
7. **Skill template integrity** - version tags, truncation detection, depth coherence

Findings are severity-ranked (BLOCKER / MAJOR / MINOR) with evidence quality marked (OBSERVED vs INFERRED). The prompt embeds the current audit results so the agent knows what's already passing or failing.

**Time and cost:** A full assessment evaluates all 7 skills (file analysis by default; live invocation when context allows). Expect 15-60 minutes depending on depth, with moderate token usage.

## Persisting quality reports

`npx goat-flow quality . --agent X --mode harness` composes a prompt that instructs the agent to save its final JSON report directly to `.goat-flow/logs/quality/` - a gitignored path. No separate capture step: the agent owns the write, and `history` / `diff` read whatever the agent saved.

```bash
npx goat-flow quality . --agent claude --mode harness
npx goat-flow quality history --agent claude
npx goat-flow quality diff --agent claude
```

Saved reports live locally under `.goat-flow/logs/quality/` as validated `.json` files (with any companion `.md` prose the agent chooses). `history` and `diff` only operate on saved reports.

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

**Audit checks:** deny covers secrets, deny blocks dangerous commands, deny blocks pipe-to-shell.

**Quality evaluates:**
- Are Ask First boundaries specific to real risk areas in this codebase, or generic placeholders?
- Does the deny hook pass its self-test (`deny-dangerous.sh --self-test`)?
- Does config.yaml's toolchain section reflect real project commands? If a command is scoped narrower than the full tool, is that intentional?
- Are there static analysis tools in the project's package manifest that aren't registered as constraints?

### 3. Verification

**Audit checks:** test runner configured (informational), hooks in sync, commit guidance present, post-turn hook integrity (informational).

**Quality evaluates:**
- Do the configured validation commands actually run and produce meaningful output?
- Does the post-turn hook run real validation (lint, typecheck, shellcheck), or just exit 0?
- Does the hook report failures honestly, or swallow them with `|| true`?
- Are testing gates in milestone files practical or checkbox theater?

### 4. Recovery

**Audit checks:** tasks directory exists, session logs directory exists.

**Quality evaluates:**
- Do milestone files have trackable checkbox items with clear completion criteria?
- Are session logs current or abandoned?
- Would a fresh agent, after context compaction, have enough state to resume the current task?

### 5. Feedback Loop

**Audit checks:** footgun and lesson directories exist, decisions directory exists.

**Quality evaluates:**
- Are footgun and lesson entries from real incidents, or synthetic?
- Are entries recent? A project with no entries in the last 90 days has a feedback loop problem.
- Are active/resolved statuses accurate? An "active" footgun describing fixed behavior is stale.
- Do semantic-anchor references in entries still resolve in the current code?

---

## When to use quality

- After setup is complete and audit passes - "is this actually good?"
- After significant changes - "did we break anything the auditor can't see?"
- Periodically - "has the harness drifted?"
- When onboarding - "does this make sense to a fresh agent?"

## When NOT to use quality

- As a setup gate (use `audit`)
- As a CI check (use `audit`)
- As a replacement for `audit --harness` (quality is subjective; audit is deterministic)
