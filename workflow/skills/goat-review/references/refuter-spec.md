---
goat-flow-reference-version: "1.10.1"
---
# Cross-Model Refuter Specification

Reference for `/goat-review` Pass 3. The SKILL.md body contains the triggers, synthesis rules, and constraints. This file contains the detailed refuter prompt template and output schema.

## Refuter Prompt Template

```
You are a code review refuter. Your job is to independently verify or challenge each finding below using the live repository.

For each finding:
1. Re-read the cited file + semantic anchor in the current repo
2. Look for a guard, contract, upstream check, or framework mitigation that removes the risk
3. Mark each finding:
   - REFUTER-CONFIRMED: the risk is real and the finding holds
   - REFUTER-REFUTED: a specific guard/contract/check removes the risk (cite evidence)
   - REFUTER-UNRESOLVED: cannot confirm or refute with available context
4. Surface any possible missed issues as LEADS ONLY. Do not classify leads as findings; the host reviewer must verify them first.

FINDINGS TO VERIFY:
<findings_list>

Output as structured JSON matching the schema below.
```

## Refuter Output Schema

```json
{
  "findings": [
    {
      "original_title": "string",
      "original_location": "file + semantic anchor",
      "verdict": "REFUTER-CONFIRMED | REFUTER-REFUTED | REFUTER-UNRESOLVED",
      "evidence": "file + semantic anchor of guard/contract or reasoning",
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

| Refuter Verdict | Host Action |
|-----------------|-------------|
| REFUTER-CONFIRMED | Add `[CONFIRMED-CROSS-MODEL]` tag to finding |
| REFUTER-REFUTED | Move to `## Refuted by Refuter` section; preserve refuter reasoning verbatim; do not silently drop |
| REFUTER-UNRESOLVED | Keep original severity; add `cross-model-unresolved` to Review Integrity |
| LEAD | Run normal Pass 2 verification before promoting to finding; must satisfy Proof Capsule rules |

## Review Integrity Extension

When Pass 3 runs, add to Review Integrity:
- Refuter pass: yes | no | skipped
- Refuter confirmed: `<N>` | Refuted: `<M>` | Unresolved: `<K>`
- Refuter leads verified by host: `<N>`
- Refuter model: `<model-identifier>`

## Pre-flight Check

Before spawning the refuter, verify the target refuter runtime is both installed and authenticated. Host runtimes choose an external target: Claude Code usually targets Codex; Codex, Copilot, and Antigravity usually target Claude. If that target is unavailable, use another authenticated non-host runtime only when the review output names it; otherwise skip Pass 3 and log `cross-model-refuter-failed`.
```bash
# Before spawning Codex:
command -v codex && codex login status

# Before spawning Claude Code:
command -v claude && claude auth status
```

Version-only commands such as `claude --version`, `codex --version`, `copilot --version`, or `agy --version` prove installation only; they do not prove authentication. If the opposite runtime is not authenticated, skip Pass 3 and log `cross-model-refuter-failed` in Review Integrity. Do not attempt to authenticate during a review.
