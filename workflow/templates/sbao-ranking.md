# Template: SBAO Ranking

> **What this is:** A template for running SBAO critique manually - useful when you want
> to orchestrate across separate AI sessions with different providers, or when you want
> full human control over the process.
>
> For most uses, `/goat-sbao` is easier - it handles sub-agent orchestration, ranking,
> cross-examination, and synthesis automatically within a single session.
>
> When to use this template instead:
> - You want to use multiple different AI providers (Claude + Gemini + ChatGPT)
> - You want full human control over what context each agent gets
> - You want to run critique across separate CLI sessions

Signal-Based Adaptive Orchestration: ask multiple agents for competing
critiques, then force comparison, cross-examination, and synthesis instead
of accepting the first plausible answer.

## Step 1: Generate competing critiques

Spawn 3 sub-agents (or open 3 sessions). Vary the context intentionally - informational diversity catches more than tonal diversity.

**Agent A (Risk Focus - full context):**
Give: the artifact + architecture.md + footguns + lessons.
Directive: "Focus on RISKS. What could go wrong? What's the cost/benefit? What's the fastest safe path forward? Propose specific improvements."

**Agent B (Alternatives Focus - full context):**
Give: the artifact + architecture.md + footguns + lessons.
Directive: "Focus on ALTERNATIVES. Generate 2-3 different approaches to the key decisions. For each, evaluate risk, evidence, and delivery speed. Propose specific improvements."

**Agent C (Fresh Eyes - NO project context):**
Give: the artifact ONLY. No architecture, no footguns, no lessons, no project history.
Directive: "Critique this as if you know nothing about the project. What's unclear? What assumptions aren't stated? What wouldn't make sense to a newcomer?"

Each agent must return:
- 3-7 findings with severity (CRITICAL/HIGH/MEDIUM/LOW), evidence, and confidence
- Overall assessment: STRONG / ADEQUATE / WEAK / FLAWED
- One thing the artifact gets RIGHT that should be preserved

## Step 2: Rank and compare

Build a comparison matrix:

| Finding | Agent A | Agent B | Agent C | Agreement |
|---------|---------|---------|---------|-----------|
| [finding] | [severity] | [severity or n/a] | [severity or n/a] | consensus / split / unique |

Score each critique on: grounding, specificity, actionability, coverage, calibration.

**Control group delta:** Review Agent C's unique findings:
- Identifies an unstated assumption → **CONTEXT DRIFT** (the others took it for granted)
- Identifies a clarity problem → **READABILITY GAP** (artifact assumes knowledge it doesn't provide)
- Clearly wrong due to missing context → **CONTEXT-LIMITED** (expected false positive, discard)

## Step 3: Cross-examine disagreements

For each split finding, ask one agent (or a fresh session):

```
Agent A says [X]. Agent B says [Y]. Which is correct given the actual
codebase? What specific evidence resolves this disagreement?
```

For unique HIGH/CRITICAL findings, verify:

```
Only one critique raised [finding] at [severity]. Is this a genuine blind
spot the others missed, or a false positive? Check the actual code.
```

Mark each: RESOLVED (with winner) / STILL DISPUTED / RETRACTED.

## Step 4: Clarify with the human

Before synthesising, present unresolved items:
- Still-disputed findings - which position to adopt?
- Material trade-offs - which path matters more?
- Context drift signals from Agent C - intentional or oversight?

**STOP and wait for answers.** Do not synthesise until the human has decided.

## Step 5: Create the prime critique

Synthesise using:
- Consensus findings (preserved as-is)
- Resolved split findings (with resolution rationale)
- Human-directed findings (from Step 4)
- Verified unique findings (survived cross-examination)
- Retracted findings (listed so user sees what was considered and dismissed)

**Decision Debt:** Tag any recommendation where evidence is INFERRED or cross-examination was inconclusive:
> **Decision Debt:** [recommendation] - Confidence: LOW/MEDIUM - Revisit when: [trigger]

Write to the tasks directory as `<feature-name>-critique-prime.md`.

## Completion Criteria

Step 5 is done when:
- All consensus findings appear in the prime critique
- All disputed findings have a resolution or are flagged as Decision Debt
- Agent C's context drift signals have human decisions
- "What Wasn't Critiqued" section identifies blind spots
- The comparison table is preserved alongside the prime critique

## Quality Bar

- Do not accept a critique just because it is longer
- Prefer critiques that tie findings to real evidence (file:line, artifact section references)
- Penalize critiques that are generic concerns without grounding
- If all three critiques are shallow, re-run with better context rather than synthesising garbage
- Preserve the comparison table so later work can see the reasoning
