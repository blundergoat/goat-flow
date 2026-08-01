---
goat-flow-reference-version: "1.14.0"
---
# Cross-Model Refuter Specification

Reference for `/goat-review` Pass 3. The SKILL.md body contains the triggers, synthesis rules, and constraints. This file contains the detailed refuter prompt template and output schema.

## Refuter Prompt Template

```
You are a code review refuter. Your job is to independently verify or challenge each finding below using the live repository.

For each R-ID finding:
1. Re-read the cited file + semantic anchor in the current repo
2. Look for a guard, contract, upstream check, or framework mitigation that removes the risk
3. Mark each finding:
   - REFUTER-CONFIRMED: the risk is real and the finding holds
   - REFUTER-REFUTED: a specific guard/contract/check removes the risk (cite `file + semantic anchor`)
   - REFUTER-UNRESOLVED: cannot confirm or refute with available context
4. Treat external library/framework behaviour as UNRESOLVED unless source or official docs are cited.
5. Surface possible missed issues as LEADS ONLY. The host reviewer verifies them first.

FINDINGS TO VERIFY:
<findings_list>

Output as structured JSON matching the schema below.
```

## Refuter Output Schema

```json
{
  "findings": [
    {
      "finding_id": "R-001",
      "original_title": "string",
      "original_location": "file + semantic anchor",
      "verdict": "REFUTER-CONFIRMED | REFUTER-REFUTED | REFUTER-UNRESOLVED",
      "evidence": "file + semantic anchor of guard/contract; required for REFUTER-REFUTED",
      "rationale": "one sentence explaining the verdict"
    }
  ],
  "leads": [
    {
      "title": "string",
      "location": "file + semantic anchor",
      "description": "what the host reviewer should investigate"
    }
  ],
  "model": "string (refuter model identifier)"
}
```

Output to: `.goat-flow/logs/review/goat-review-refuter.<random>.json`

## Synthesis Rules

The host reviewer applies these rules to the refuter output:

- Empty, broad, or unresolvable refutation evidence cannot remove a finding; it may demote severity one rung and is recorded.
- Before accepting any MUST refutation, re-read the cited guard. Failure keeps the MUST unresolved and adds `refuter-citation-unverified`; only verified evidence can change Ship Verdict.
- Preserve the original R-ID through synthesis.

| Refuter Verdict | Host Action |
|-----------------|-------------|
| REFUTER-CONFIRMED | Add `[CONFIRMED-CROSS-MODEL]` tag to finding |
| REFUTER-REFUTED | After the evidence bar, move to `## Refuted by Refuter`; preserve reasoning; do not silently drop |
| REFUTER-UNRESOLVED | Keep original severity; add `cross-model-unresolved` to Review Integrity |
| LEAD | Run normal Pass 2 verification before promoting to finding; must satisfy Proof Capsule rules |

## Review Integrity Extension

When Pass 3 runs, add to Review Integrity:

```
- Refuter pass: yes | no | skipped; confirmed=<N>, refuted=<M>, unresolved=<K>, leads-verified=<N>, model=<model-identifier|n/a>
```

Use `skipped` when Pass 3 was triggered but no authenticated external refuter was available. Use `n/a` for the model when no refuter actually ran.

## Pre-flight Check

Before spawning the refuter, verify the target refuter runtime is both installed and authenticated. Host runtimes choose an external target: Claude Code usually targets Codex; Codex, Copilot, and Antigravity usually target Claude. If that target is unavailable, use another authenticated non-host runtime only when the review output names it; otherwise skip Pass 3 and log `cross-model-refuter-failed`.
```bash
# Before spawning Codex:
command -v codex && codex login status

# Before spawning Claude Code:
command -v claude && claude auth status
```

Version-only commands such as `claude --version`, `codex --version`, `copilot --version`, or `agy --version` prove installation only; they do not prove authentication. If the opposite runtime is not authenticated, skip Pass 3 and log `cross-model-refuter-failed` in Review Integrity. Do not attempt to authenticate during a review.
