---
name: goat-sbao
description: "Multi-perspective critique using sub-agent orchestration. Generates competing analyses, ranks them, cross-examines disagreements, and synthesises a prime output."
goat-flow-skill-version: "1.1.0"
---
# /goat-sbao

## Shared Conventions

Read `.goat-flow/skill-preamble.md` for shared conventions.
On full-depth, also read `.goat-flow/skill-conventions.md`.
If unavailable, use these essentials:
- Severity: SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- Evidence: every finding MUST include file or file:line, tag OBSERVED vs INFERRED
- Learning loop: check .goat-flow/lessons/ and .goat-flow/footguns/ after completion
- Gates: BLOCKING GATE = stop and wait. CHECKPOINT = continue unless interrupted.

## When to Use

Use when a concrete artifact deserves multi-perspective critique before shipping. Takes ANY input artifact: a plan, security assessment, debug hypothesis set, review findings, test strategy, architecture proposal, or refactor approach.

**Use when:**
- The stakes justify spawning 3 sub-agents and 5 phases
- You have a concrete artifact to critique (not vague ideas)
- You want competing perspectives, not just validation
- Called by another goat-* skill or directly by the user

**NOT this skill:**
- No artifact exists yet → create one first (goat-review, goat-debug, etc.)
- Simple factual question → answer directly
- Trivial artifact (hotfix, single-file change) → use goat-review instead. If it's not worth 3 agents and 5 phases, don't use goat-sbao.

## Step 0 — Intake

Two intake modes:

**Standalone** (`/goat-sbao` or routed from `/goat`): Ask what artifact to critique. Confirm scope: "Critiquing [artifact]. SBAO will spawn 3 sub-agents, rank and cross-examine findings, then ask you to resolve disputes before synthesis. Proceed?"

**Skill-chained** (called from another goat-* skill): The calling skill passes the artifact and context. Skip the confirmation — go straight to footgun/lesson checks below, then Phase 1.

For both modes:
- Read `.goat-flow/footguns/` for entries relevant to the artifact's domain
- Read `.goat-flow/lessons/` for past critique outcomes in this area
- Identify the artifact type (plan, security assessment, hypothesis set, review findings, test strategy, architecture doc, other) — this determines the critique rubric

## Phase 1 — Generate Competing Critiques

Always spawn 3 sub-agents. Always run all 5 phases. Context varies intentionally — informational diversity catches more than tonal diversity.

### The Core Trio Lens

Agents A and B both use the SKEPTIC/ANALYST/STRATEGIST combined lens. These three perspectives work as a unit — never split them into separate agents:

- **SKEPTIC** — "What could go wrong? What assumptions are unproven? What's the worst-case scenario?"
- **ANALYST** — "What does the evidence actually say? What's the cost/benefit? What do the numbers and code paths tell us?"
- **STRATEGIST** — "What's the fastest path to shipping? What can we defer? What's the highest-leverage change?"

All three perspectives must appear in every critique from Agents A and B. The tension between them is the point.

### Sub-Agent Definitions

**Sub-agent A (Risk Focus — full project context):**
Gets: artifact + architecture.md + footguns + lessons + critique rubric.
Directive: "Apply the SKEPTIC/ANALYST/STRATEGIST lens. Focus on RISKS: what could go wrong, what the evidence says about cost/benefit, and what the fastest safe path forward looks like. Propose specific improvements."

**Sub-agent B (Alternatives Focus — full project context):**
Gets: artifact + architecture.md + footguns + lessons + critique rubric.
Directive: "Apply the SKEPTIC/ANALYST/STRATEGIST lens. Focus on ALTERNATIVES: generate 2-3 different approaches to the key decisions. For each, evaluate risk (SKEPTIC), evidence (ANALYST), and delivery speed (STRATEGIST). Propose specific improvements."

**Sub-agent C (Fresh Eyes — NO project context):**
Gets: artifact + critique rubric ONLY. No architecture.md, no footguns, no lessons, no project history.
Directive: "Critique this artifact as if you know nothing about the project. What's unclear? What assumptions aren't stated? What wouldn't make sense to a newcomer? What would you do differently?"

Each sub-agent MUST return:
- 3-7 findings: title, severity (CRITICAL/HIGH/MEDIUM/LOW), evidence (file:line or artifact section reference), confidence (HIGH/MEDIUM/LOW), one-sentence rationale
- Overall assessment: STRONG / ADEQUATE / WEAK / FLAWED
- One thing the artifact gets RIGHT that should be preserved

MUST use Agent tool calls, not inline role-play. Sub-agents run in isolated context.

## Phase 2 — Rank and Compare

Build a comparison matrix:

| Finding | Agent A | Agent B | Agent C | Agreement |
|---------|---------|---------|---------|-----------|
| [finding] | [severity] | [severity or n/a] | [severity or n/a] | consensus / split / unique |

Score each critique on: grounding, specificity, actionability, coverage, calibration.

Highlight:
- **Consensus** (2+ agents agree) — highest confidence
- **Split** (agents disagree on severity/existence) — needs cross-examination
- **Unique** (only one agent raised it) — may be insight or noise

**Control group delta check:**
Review Agent C's findings against Agents A and B. For each Agent C finding that no other agent raised:
- If it identifies an unstated assumption → flag as **CONTEXT DRIFT** — the context-aware agents took this for granted
- If it identifies a clarity problem → flag as **READABILITY GAP** — the artifact assumes knowledge it doesn't provide
- If it's clearly wrong due to missing context → mark as **CONTEXT-LIMITED** — expected false positive, discard

Present the delta: "Fresh eyes found [N] unique findings. [X] are context drift signals, [Y] are readability gaps, [Z] are context-limited false positives."

## Phase 3 — Cross-Examine

For each split finding, spawn one more sub-agent: "Agent A says [X], Agent B says [Y]. Which is correct given the actual codebase?"

For unique HIGH/CRITICAL findings, spawn verification: "Only one critique raised [finding]. Genuine blind spot or false positive?"

Mark each: RESOLVED (with winner) / STILL DISPUTED / RETRACTED (false positive confirmed).

## Phase 4 — Clarify

Before synthesising, present the unresolved items to the human:

1. **Still-disputed findings** from Phase 3 — present both positions, ask which to adopt
2. **Material trade-offs** — where two valid approaches exist, present the fork and ask which path
3. **Context drift signals** — any CONTEXT DRIFT findings from Phase 2 that challenge the artifact's assumptions

Format:
> **Dispute [N]:** Agent A says [X], Agent B says [Y]. Cross-examination was inconclusive. Which position should the synthesis adopt?
> **Trade-off [N]:** [Option A] prioritises [X] at the cost of [Y]. [Option B] does the reverse. Which matters more here?
> **Context drift [N]:** Fresh eyes found [assumption]. Is this intentional or an oversight?

**BLOCKING GATE:** STOP and wait for answers. Do NOT synthesise until the human has resolved these.

## Phase 5 — Synthesise

Produce the prime critique:
- Consensus findings (preserved as-is)
- Resolved split findings (with resolution rationale)
- Human-directed findings (from Phase 4 clarification responses)
- Verified unique findings (survived cross-examination)
- Retracted findings (listed so user sees what was considered and dismissed)

**Decision Debt scan:** Review every recommendation. For any where:
- The supporting evidence is tagged INFERRED, not OBSERVED
- Only one sub-agent raised it and cross-examination was inconclusive
- The recommendation depends on an unvalidated assumption

Tag as Decision Debt:
> **Decision Debt:** [recommendation] — Confidence: LOW/MEDIUM — Revisit when: [trigger condition]

Decision Debt ships with the current work but must be revisited at a stated trigger. It is not the same as Open Questions (which block progress).

**Blind spot check:** Before presenting, identify:
- Sections of the artifact that no sub-agent addressed
- Aspects of the critique rubric that no finding maps to
- Files or systems referenced by the artifact that were not read by any sub-agent

List these as "What Wasn't Critiqued." This section must never be empty — if everything was covered, state that explicitly.

**BLOCKING GATE:** Present the synthesised critique. Human decides: apply recommendations, dig deeper, re-run with different framing, or close. After critique of a plan, suggest `/goat-plan` to update milestones based on recommendations.

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

- MUST always spawn 3 sub-agents — Agent A (risk), Agent B (alternatives), Agent C (fresh eyes)
- MUST always run all 5 phases — no quick/full distinction
- MUST use Agent tool calls for sub-agents, not inline role-play
- MUST spawn sub-agents with isolated context (they cannot see each other's Phase 1 output)
- MUST restrict Agent C (Fresh Eyes) to artifact + rubric only — no architecture.md, footguns, or lessons
- MUST use SKEPTIC/ANALYST/STRATEGIST as a combined lens per agent — never split into separate roles
- MUST differentiate Agent A (risk focus) from Agent B (alternatives focus) by question, not just tone
- MUST flag control group delta: CONTEXT DRIFT / READABILITY GAP / CONTEXT-LIMITED for each unique Agent C finding
- MUST include critique rubric appropriate to artifact type
- MUST present consensus/split/unique classification for every finding
- MUST cross-examine split findings and unique HIGH/CRITICAL findings (Phase 3)
- MUST stop and ask human to resolve disputes and trade-offs before synthesising (Phase 4)
- MUST tag low-confidence recommendations as Decision Debt with revisit triggers
- MUST populate "What Wasn't Critiqued" with blind spot check — never leave empty
- MUST preserve "what the artifact gets right" — this is not a negativity engine
- Universal constraints from skill-preamble.md apply.
- MUST NOT auto-apply recommendations — human gate required
- Sub-agent budget: max 5 tool calls per sub-agent in Phase 1, max 3 per cross-examination in Phase 3
- Skill-chained: skip confirmation, still run footgun/lesson checks and rubric selection

## Output Format

```markdown
## TL;DR
## Critique Rubric  <!-- which rubric and why -->
## Sub-Agent Comparison Matrix  <!-- finding x agent grid -->
## Sub-Agent Rankings  <!-- grounding, specificity, actionability, coverage, calibration -->
## Control Group Delta  <!-- Agent C unique findings: context drift / readability gap / context-limited -->
## Consensus Findings  <!-- highest confidence -->
## Cross-Examination Results  <!-- split findings with resolution -->
## Verified Unique Findings  <!-- survived cross-examination -->
## Retracted Findings  <!-- considered and dismissed -->
## Clarification Responses  <!-- human decisions on disputes and trade-offs -->
## Strengths  <!-- what to preserve -->
## Recommended Changes  <!-- ordered by severity, each with concrete action -->
## Decision Debt  <!-- decisions with incomplete evidence, confidence, revisit trigger -->
## Open Questions  <!-- genuine unknowns that block progress -->
## What Wasn't Critiqued  <!-- blind spot check output -->
```
