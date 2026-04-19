---
name: goat-critique
description: "Use when a decision or analysis needs multi-lens critique to surface blind spots before shipping."
goat-flow-skill-version: "1.2.0"
---
# /goat-critique

## Shared Conventions

Read `.goat-flow/skill-reference/skill-preamble.md` for shared conventions.
On full-depth, also read `.goat-flow/skill-reference/skill-conventions.md`.

## When to Use

Use when a concrete artifact deserves multi-perspective critique before shipping. Takes ANY input artifact: a plan, security assessment, debug hypothesis set, review findings, test strategy, architecture proposal, or refactor approach.

**Use when:**
- The stakes justify structured critique before shipping
- You have a concrete artifact to critique (not vague ideas)
- You want competing perspectives, not just validation
- Called by another goat-* skill or directly by the user

**NOT this skill:**
- No artifact exists yet → create one first (goat-review, goat-debug, etc.)
- Simple factual question → answer directly
- Trivial artifact (hotfix, single-file change) → use goat-review instead. If it is not worth 3 agents and 5 phases, do not use goat-critique.
- Delegated sub-agents unavailable in this session → the skill cannot run. Redirect the user to `/goat-review`; do not run inline role-play as a substitute.

## Step 0 - Intake

goat-critique runs in one mode: full delegated, 5 phases, 2-3 sub-agents. There is no quick/inline fallback — if the work does not justify sub-agent delegation, use `/goat-review` instead. See `.goat-flow/decisions/ADR-021-goat-critique-full-mode-only.md` for the rationale.

**Intake checklist:**
- Confirm the artifact exists and is concrete (a file, a plan document, a specific set of findings — not a vague idea).
- Confirm sub-agent delegation is available in this session. If it is not, stop and redirect the user to `/goat-review`.
- Use the preamble's grep-first learning-loop retrieval on relevant `.goat-flow/footguns/` and `.goat-flow/lessons/`; record explicit misses instead of broad-loading buckets.
- Skill-chained entry: skip intake confirmation, use caller context, start at Phase 1. Skill-chaining does not unlock a quick variant — all 5 phases still run.

## Phase 1 - Generate Competing Critiques

Spawn 2-3 sub-agents via the Agent tool. MUST NOT inline role-play as a substitute.

Context varies intentionally — informational diversity catches more than tonal diversity.

### The Core Trio Lens

Agents A and B both use the SKEPTIC/ANALYST/STRATEGIST combined lens. These three perspectives work as a unit — never split them into separate agents:

- **SKEPTIC** — "What could go wrong? What assumptions are unproven? What's the worst-case scenario?"
- **ANALYST** — "What does the evidence actually say? What's the cost/benefit? What do the numbers and code paths tell us?"
- **STRATEGIST** — "What's the fastest path to shipping? What can we defer? What's the highest-leverage change?"

All three perspectives must appear in every critique from Agents A and B. The tension between them is the point.

### Sub-Agent Definitions

**Sub-agent A (Risk Focus — backward-looking context):**
Gets: artifact + architecture.md + footguns + lessons + critique rubric.
Directive: "Apply SKEPTIC/ANALYST/STRATEGIST. Focus on RISKS: what could go wrong, what the evidence says about cost/benefit, what the fastest safe path looks like. Your context includes past mistakes (footguns, lessons) — use them."

**Sub-agent B (Alternatives Focus — current-state context):**
Gets: artifact + architecture.md + recent git history (`git log --oneline -20`) + config.yaml + critique rubric.
Directive: "Apply SKEPTIC/ANALYST/STRATEGIST. Focus on ALTERNATIVES: generate 2-3 different approaches to the key decisions. Your context includes how the project actually works right now (git history, config) — ground alternatives in real project patterns, not theory."

**Sub-agent C (Fresh Eyes — NO project context):**
Gets: artifact + critique rubric ONLY. No architecture, footguns, lessons, git, or config.
Directive: "Critique this artifact as if you know nothing about the project. Flag every assumption the artifact makes without stating explicitly. If you find nothing confusing, note whether that is because the artifact is exceptionally clear or because you didn't probe hard enough. Your findings that overlap with other agents are convergent evidence, not redundancy."

Each sub-agent MUST return:
- 3-7 findings: title, severity (CRITICAL/HIGH/MEDIUM/LOW), evidence (file:line or artifact section reference), confidence (HIGH/MEDIUM/LOW), one-sentence rationale
- Overall assessment: STRONG / ADEQUATE / WEAK / FLAWED
- One thing the artifact gets RIGHT that should be preserved

## Phase 2 - Rank and Compare

Build a quick matrix and score by grounding/specificity/actionability/coverage/calibration.
Label each finding as consensus / split / unique.

**Control group delta:** For fresh-eyes-only findings, mark each as CONTEXT DRIFT / READABILITY GAP / CONTEXT-LIMITED.

## Phase 3 - Cross-Examine

For each split finding, spawn one more sub-agent: "Agent A says [X], Agent B says [Y]. Which is correct given the actual codebase?"

For unique HIGH/CRITICAL findings, spawn verification: "Only one critique raised [finding]. Genuine blind spot or false positive?"

Mark each: RESOLVED (with winner) / STILL DISPUTED / RETRACTED (false positive confirmed).

## Phase 4 - Clarify

Before synthesising, present the unresolved items to the human:

1. **Still-disputed findings** from Phase 3 — present both positions, ask which to adopt
2. **Material trade-offs** — where two valid approaches exist, present the fork and ask which path
3. **Context drift signals** — any CONTEXT DRIFT findings from Phase 2 that challenge the artifact's assumptions

Format:
> **Dispute [N]:** Agent A says [X], Agent B says [Y]. Cross-examination was inconclusive. Which position should the synthesis adopt?
> **Trade-off [N]:** [Option A] prioritises [X] at the cost of [Y]. [Option B] does the reverse. Which matters more here?
> **Context drift [N]:** Fresh eyes found [assumption]. Is this intentional or an oversight?

**If disputes exist or Decision Debt items need resolution:** BLOCKING GATE — STOP and present disputes for human resolution.
**If all agents agree (no disputes):** CHECKPOINT — note consensus and proceed to synthesis.

## Phase 5 - Synthesise

Produce the prime critique:
- Consensus findings (preserved as-is)
- Resolved split findings (with resolution rationale)
- Human-directed findings (from Phase 4 clarification responses)
- Verified unique findings (survived cross-examination)
- Retracted findings (listed so user sees what was considered and dismissed)

**Decision Debt:** Tag as Decision Debt when any of these apply: supporting evidence is INFERRED (not OBSERVED); only one agent raised it and cross-examination was inconclusive; or the recommendation depends on an unvalidated assumption:

> **Decision Debt:** [recommendation]
> - Confidence: LOW/MEDIUM
> - Evidence needed to resolve: [what specific evidence would settle this]
> - Revisit when: [concrete trigger — next milestone, specific file change, before deploy]

**Blind spot check:** Before presenting, identify:
- Sections of the artifact that no sub-agent addressed
- Aspects of the critique rubric that no finding maps to
- Files or systems referenced by the artifact that were not read by any sub-agent

List these as "What Wasn't Critiqued." This section must never be empty — if everything was covered, state that explicitly.

**BLOCKING GATE:** Present the synthesised critique. Human decides: apply recommendations, dig deeper, re-run with different framing, or close. After critique of a plan, suggest `/goat-plan` to update milestones based on recommendations.

**Proof Gate:** Apply the Proof Gate from `skill-preamble.md` to every synthesised finding — sub-agent reports are inputs to verify, not evidence to launder. Re-read each surviving finding's `file:line` in this session before inclusion.

## Critique Rubrics

The rubric determines what sub-agents evaluate. Match to artifact type:

**Plan:** correctness against codebase, integration safety, sequencing quality, validation coverage, task specificity
**Security assessment:** threat model completeness, framework mitigation accuracy, exploitability calibration, data flow quality, attack surface coverage
**Debug hypotheses:** hypothesis diversity, evidence quality (OBSERVED vs INFERRED), elimination rigour, confidence calibration, reproduction completeness
**Review findings:** severity calibration, false positive rate, pre-existing separation, cross-reference impact, diff coverage
**Test strategy:** coverage gaps, doer-verifier separation, manual test specificity, mock awareness, risk-proportionate depth
**Architecture/refactor:** blast radius accuracy, migration safety, backward compatibility, dependency impact, rollback feasibility
**Generic (fallback):** internal consistency, evidence grounding, scope completeness, feasibility, risk identification. If using the generic rubric, state why no specific rubric matched and which was closest.

## Constraints

- Full delegated mode is the only mode. 2-3 sub-agents, 5 phases. No quick/inline fallback. If delegation is unavailable, stop and redirect to `/goat-review`.
- MUST use Agent tool calls for sub-agents, not inline role-play
- MUST isolate Phase 1 contexts per sub-agent
- Fresh-eyes analysis MUST be restricted to artifact + rubric only
- MUST use SKEPTIC/ANALYST/STRATEGIST as a combined lens per agent — never split into separate roles
- MUST differentiate Agent A (risk) from Agent B (alternatives) by instructions
- MUST flag control group delta: CONTEXT DRIFT / READABILITY GAP / CONTEXT-LIMITED for each unique fresh-eyes finding
- MUST include critique rubric appropriate to artifact type
- MUST present consensus/split/unique classification for every finding
- MUST cross-examine split findings and unique HIGH/CRITICAL findings (Phase 3)
- MUST gate on unresolved disputes before synthesis (Phase 4)
- MUST tag low-confidence recommendations as Decision Debt
- MUST always include "What Wasn't Critiqued"
- Universal constraints from skill-preamble.md apply.
- MUST NOT auto-apply recommendations — human gate required
- Sub-agent budget: max 5 tool calls per sub-agent in Phase 1, max 3 in cross-examination
- Skill-chained: skip confirmation, still run footgun/lesson checks and rubric selection; still run all 5 phases

## Output Format

```markdown
## TL;DR
## Critique Rubric  <!-- which rubric and why -->
## Sub-Agent Comparison Matrix  <!-- finding x agent grid -->
## Sub-Agent Rankings  <!-- grounding, specificity, actionability, coverage, calibration -->
## Control Group Delta  <!-- Agent C unique findings: context drift / readability gap / context-limited -->
## Consensus Findings  <!-- highest confidence -->
## Cross-Examination Results
## Verified Unique Findings
## Retracted Findings
## Clarification Responses
## Strengths  <!-- what to preserve -->
## Recommended Changes  <!-- ordered by severity, each with concrete action -->
## Decision Debt  <!-- decisions with incomplete evidence, confidence, revisit trigger -->
## Open Questions  <!-- genuine unknowns that block progress -->
## What Wasn't Critiqued  <!-- blind spot check output -->
```
