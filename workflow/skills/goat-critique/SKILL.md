---
name: goat-critique
description: "Use when a decision or analysis needs multi-lens critique to surface blind spots before shipping."
goat-flow-skill-version: "1.17.0"
---
# /goat-critique

## Shared Conventions

Read `.goat-flow/skill-docs/skill-preamble.md` and `.goat-flow/skill-docs/skill-conventions.md`.

## When to Use

Use for multi-perspective critique of a plan, security assessment, debug hypotheses, review, test strategy, architecture, or refactor.

## Boundary Commands

- **NEVER:** Replace delegation with inline role-play, skip phases, or auto-apply recommendations.
- **ALWAYS:** Treat explicit invocation as consent for the full delegated protocol on a concrete artifact.
- **DEFER TO:** Before invocation, create missing artifacts, answer simple facts, or use `/goat-review` for trivial work; explicit `/goat-critique` runs fully.

| Excuse | Reality |
|--------|---------|
| "The artifact is trivial - a quick critique would cover it" | Quick mode was removed: one context under three lens labels is not independent critique. |
| "All three agents agree so it must be right" | Consensus without orchestrator verification is unverified. Verify claims; do not count votes. |
| "Inline role-play is faster than spawning agents" | Inline lenses correlate; isolated contexts create independent findings. |
| "Closing checks happen after the main answer - skip them" | Phase 5.5 and outcome capture exist because agents skip closing work. |

**Direct invocation is binding.** Raise scope concerns after synthesis.

**Report-only by default.** `$goat-critique make X shorter` critiques; `then apply it` permits application after the gate. Constraints own mutation.

## Step 0 - Intake

goat-critique runs only full delegated mode: Phases 1-5, 5.5 meta-audit, 5.6 outcome capture, three critique sub-agents, one meta-agent.

**Intake checklist:**
- Require a concrete artifact, not a vague idea.
- Select its Critique Rubric; ask if unclear.
- Run preamble retrieval for artifact/risk terms; record misses without broad-loading buckets.
- **Host ownership:** The host/root context owns Phases 1-5.6. A forked sub-agent returns control before Phase 1 and does not apply the shared sub-agent gate conversion. The host spawns agents, presents gates, and resumes Phase 5.6 after the response. Direct/chained host entry needs no delegation prompt; chained entry skips only intake confirmation.
- **Resume:** For saved work, apply **Saved records and recovery** in `references/rubric-examples.md` before generating critics.
- **Differential mode detection:** For matching artifact identity within 30 days, apply **Differential baselines** in `references/rubric-examples.md`: offer prior findings and available diff to A/B; C stays cold. Phase 5 links the baseline record and reports deltas.
- **Read context map:** Read only the selected rubric's `###` map under Rubric Context Maps in `references/rubric-examples.md`. Merge the selected rubric map into the fixed A/B/C split; never replace baseline context. Other reference sections load at the phase that names them.

## Phase 1 - Generate Competing Critiques

Spawn all three sub-agents in parallel using the host's real delegation mechanism.

Before spawning C, build its payload and initialize state using **Fresh-eyes boundary and recovery** in `references/sub-agent-directives.md`.

### The Core Trio Lens

Agents A and B each use the combined SKEPTIC/ANALYST/STRATEGIST lens; never split its perspectives across agents:

- **SKEPTIC** - "What could go wrong? What assumptions are unproven? What's the worst-case scenario?"
- **ANALYST** - "What does the evidence actually say? What's the cost/benefit? What do the numbers and code paths tell us?"
- **STRATEGIST** - "What's the fastest path to shipping? What can we defer? What's the highest-leverage change?"

C has no lens quota; use `N/A - fresh-eyes scope` when a lens adds nothing.

**Context split:**

| Agent | Reads | Does NOT read |
|---|---|---|
| A (Risk) | artifact + architecture.md + targeted INDEX-first footgun/lesson hits + rubric | git history, config.yaml |
| B (Alternatives) | artifact + architecture.md + `git log --oneline -20` + config.yaml + rubric | footguns, lessons |
| C (Fresh Eyes) | supplied artifact + selected rubric payload ONLY | other project evidence; disclose harness context |

### Sub-Agent Definitions

Full directives: `references/sub-agent-directives.md`.

- **A (Risk):** Risks, 2nd-order impacts, fastest safe path; cite downstream files by name.
- **B (Alternatives):** At least one alternative, ranked by implementation friction.
- **C (Fresh Eyes):** Assumptions/readability within the reference's ISOLATION RULE.

Each sub-agent normally returns the reference's Result envelope and Per-finding output spec, including Proof class. Constraints govern clean returns; Phase 2 checks completeness.

**Lens coverage:** A/B analyse every lens; C probes assumptions/readability. See Lens-finding floor.

## Phase 2 - Rank and Compare

Execute in this order:

**1. Context leak scan.** Apply **Fresh-eyes boundary and recovery** first: scan C through stdin, trace matches to its permitted payload, and inspect available activity. Textual absence never proves isolation; discard leaks and use the shared replacement allowance.

**1b. Completeness gate.** Verify every applicable Result-envelope field (`Evidence reviewed:` through `Residual uncertainty:`, strength, coverage ledger and B's ranked alternative). A/B each get one completeness replacement; C uses the same run-wide allowance as leaks. Unresolved omissions produce `sub-agent completeness limited`; honest unassessed rows are complete.

**2. Classify each finding:** **Consensus** (≥2 agents, severity within ±1), **Split** (≥2 agents, severity differs ≥2 levels or explicit reject vs blocking), **Unique** (one agent only). Silence is not a dismiss; treat as Unique.

**3. Rank each sub-agent's critique** using the reference pack's Ranking criteria: Grounding, Specificity, Actionability, Coverage and Calibration; strong, adequate or limited with evidence, never summed.

**4. Verify sub-agent dimension coverage.** Verify each Coverage-ledger scope against its named evidence for clean and non-clean returns. Demote unsubstantiated claims before the union in step 5.

**5. Union the coverage ledgers.** Merge the agents' rows into one host ledger per selected dimension - `finding`, `checked-clean` or `unassessed` - by the reference pack's union rule. Unassessed coverage never generates a HIGH or MEDIUM artifact finding.

**6. Spot-check OBSERVED claims.** For each finding marked OBSERVED, re-read the cited file + semantic anchor or proof artifact. Findings that fail spot-check get tagged `[evidence-gap: spot-check failed]`; Phase 3 decides retract or upgrade.

**7. Label control group deltas.** For fresh-eyes-only findings, orchestrator assigns: **CONTEXT DRIFT** (wrong due to missing context), **READABILITY GAP** (valid for any reader), or **CONTEXT-LIMITED** (may be valid, cannot fully evaluate).

## Phase 3 - Cross-Examine

**Early exit:** If Phase 2 yields zero split findings and zero unique HIGH/CRITICAL findings, skip Phase 3. Note `No findings require cross-examination` in output and proceed to Phase 4; unique MEDIUM and LOW findings survive the exit.

If splits + unique HIGH/CRITICAL exceed the cross-examination budget (see Constraints), batch multiple disputes into a single agent prompt. Triage by severity - CRITICAL and HIGH first.

For each split finding, spawn a cross-exam agent: "Agent A says [X], Agent B says [Y]. Which is correct given the actual codebase?"

For unique HIGH/CRITICAL findings, spawn verification: "Only one critique raised [finding]. Genuine blind spot or false positive?"

Mark each: RESOLVED (with winner) / STILL DISPUTED / RETRACTED (false positive confirmed).

## Phase 4 - Clarify

**Persist before gate:** Keep the Phase 1-3 draft in memory; save a fresh `pre-clarification` record through **Saved records and recovery** in `references/rubric-examples.md`. Do this after Phase 3 early exit too; save failures continue to the human gate.

Present unresolved items with decision count/titles. Ask each as `Q[N]: [decision]? (A) [option] (B) [option] Default: [A/B]. Background: [one sentence]`. For 3+, use `| # | Decision | Option A (default) | Option B | Why |`, then request numbered overrides or default approval. Cover disputes, trade-offs, and intentional context drift.

**Questions:** BLOCKING GATE - STOP for the human.
**None:** CHECKPOINT - record "no disputes - proceeding to synthesis" and continue.

## Phase 5 - Synthesise

Before drafting, apply Final-finding schema and Audit payload identity from `references/rubric-examples.md`. Lead with a **Verdict** block:
- **Gate: BLOCK | CONCERNS | CLEAN** - derived from surviving findings: any CRITICAL → BLOCK, any HIGH (no CRITICAL) → CONCERNS, else CLEAN. CLEAN coexists with lower-severity findings and with limited coverage; show coverage status beside it.
- Assessment: STRONG / ADEQUATE / WEAK / FLAWED, using the reference pack's overall-assessment bands and synthesising sub-agent assessments with cross-examination outcomes
- Risk level: the highest surviving evidenced artifact severity, floored at LOW and labelled `no evidenced defect` when none survives - a floor, not a clearance
- Top 1-3 blockers (if any) - one line each, linked to findings below
- If differential mode: append the **Differential baselines** delta block, including unassessed/unmapped prior findings.

**Explain once:** Validated Findings holds each surviving finding once, grouped consensus, resolved splits, Phase 4 human-directed, verified unique, with its Final-finding schema fields. Later sections cite the finding ID and add only what they own; the Comparison Matrix owns comparison and Rankings own order and criterion scores.

**Open questions:** Items with INFERRED-only evidence, inconclusive single-agent findings, or unvalidated assumptions go here - not as recommendations. Each open question states: confidence, evidence needed to resolve, revisit trigger.

**Blind spot check:** List unaddressed artifact sections, unmapped rubric aspects, and unread referenced files as "What Wasn't Critiqued." Name actual limits, or a supported `none identified` statement within a declared scope; never invent one.

**Phase 5.5 - Meta-audit.** Give the 2-call meta-agent a self-contained packet: frozen draft with `report_revision`, selected dimensions, and the reference pack's complete Meta-audit rubric (including Packet vocabulary), Final-finding schema, and Audit payload identity. It grades only that packet. Score each 0 or 10; their sum is `Meta-score`; no partial credit. `## Auto-Detected Issues` contains failures; at 100/100 write exactly `No failed meta-audit checks.` Never invent issues. Put `Meta-score: N/100` in Verdict; corrections edit the report only.

**Persist final:** Before this gate, save the audited report as a fresh `finalized` record through **Saved records and recovery**.

**BLOCKING GATE:** Present the synthesised critique (including Meta-score if 5.5 produced one). "Options: (A) apply, (B) dig deeper, (C) re-run, (D) close. Default: D." Picking (A) is the explicit apply instruction Constraints require, authorizing only the surviving Recommended Changes. After plan critique, suggest `/goat-plan`.

**Phase 5.6 - Outcome capture.** After the host receives the human's A/B/C/D pick, save a fresh linked `outcomes` record using **Saved records and recovery**. A → accepted; D → deferred; B/C preserve the request with unspecified dispositions pending.

## Critique Rubrics

The rubric determines what sub-agents evaluate. Match to artifact type. Dimensions marked **[M]** are mandatory and **[O]** optional; an unaddressed dimension is an `unassessed` ledger row, never a finding. Step 0 reads only the selected rubric's map in `references/rubric-examples.md`.

**Plan:** correctness against codebase [M], integration safety [M], sequencing quality [M], validation coverage [O], task specificity [O]
**Security assessment:** threat model completeness [M], exploitability calibration [M], attack surface coverage [M], framework mitigation accuracy [O], data flow quality [O]
**Debug hypotheses:** hypothesis diversity [M], evidence quality (OBSERVED vs INFERRED) [M], elimination rigour [M], confidence calibration [O], reproduction completeness [O]
**Review findings:** severity calibration [M], diff coverage [M], pre-existing separation [M], false positive rate [O], cross-reference impact [O]
**Test strategy:** coverage gaps [M], risk-proportionate depth [M], doer-verifier separation [O], manual test specificity [O], mock awareness [O]
**Architecture/refactor:** blast radius accuracy [M], migration safety [M], backward compatibility [M], dependency impact [O], rollback feasibility [O]
**Generic (fallback):** internal consistency [M], evidence grounding [M], scope completeness [M], feasibility [M], risk identification [M]. All dimensions mandatory for the fallback rubric. If using the generic rubric, state why no specific rubric matched and which was closest.

## Constraints

- MUST run in one mode: full delegated, Phases 1-5 plus 5.5/5.6, three critique sub-agents plus one meta-agent.
- Explicit `$goat-critique` or `/goat-critique` invocation IS consent to spawn sub-agents and the full protocol. Do NOT ask again.
- Report-only by default. Do not mutate the target artifact or committed files unless the user separately says to apply, edit, update, fix, or otherwise implement. If interrupted, freeze writes.
- MUST Spawn all three sub-agents in a single parallel batch. Preserve separate input payloads and no result sharing; timing alone does not prove independence.
- MUST set max 5 tool-call budget per critique sub-agent; log calls/limit when exposed, otherwise unavailable markers. Do not claim mechanical enforcement when counts are unavailable.
- MUST log per spawned critique/cross-exam/meta agent: id/handle if exposed, calls/limit, or unavailable markers.
- MUST Scan Agent C output before other Phase 2 work using **Fresh-eyes boundary and recovery**, including its permitted payload and shared replacement counter.
- MUST Check sub-agent completeness against `references/sub-agent-directives.md`, including a clean-result attestation after one documented second pass. Phase 2 owns the bounded repair; never reset C's allowance.
- MUST enforce cross-examination budget: Max 3 cross-examination agents total, max 3 tool calls per agent.
- Recommendations are never auto-applied. After synthesis, stop. Do not enter implementation mode unless the user explicitly asks to apply changes.
- MUST apply the preamble Proof Gate to every synthesised finding and keep one proof class (`RUNTIME | CONTRACT-GREP | STATIC | NOT-REPRODUCED`). Sub-agent reports are inputs, not laundered evidence. Re-read Phase 5 survivors (typically 3-7), not every Phase 1 lead.
- MUST NOT fabricate findings. The 3-7 range is a normal target, never a quota; accept a complete clean-result attestation after the required second pass.
- Universal constraints from skill-preamble.md apply.

## Output Format

**Terse-first directive:** Sub-Agent Comparison Matrix, Retracted Findings, and What Wasn't Critiqued default to one sentence per bullet, no qualifiers or closing offers. Gates and evidence-tagged findings retain full detail.

Use this for the Phase 5 gate response. Omit `## Outcomes` until Phase 5.6. Empty sections collapse to `none`.

```markdown
## Verdict  <!-- includes Gate: BLOCK|CONCERNS|CLEAN + Meta-score -->
## Delegation Evidence  <!-- ids/handles + tool-call counts or unavailable markers -->
## Critique Rubric
## Sub-Agent Comparison Matrix
## Sub-Agent Rankings  <!-- order + criterion scores only -->
## Rubric Coverage  <!-- one ledger row per selected dimension -->
## Control Group Delta
## Validated Findings  <!-- source pool for Recommended Changes; every finding includes proof class -->
## Cross-Examination Results  <!-- finding ID, outcome, winner -->
## Auto-Detected Issues  <!-- failures or exact clean attestation; always present -->
## Retracted Findings  <!-- finding ID + reason -->
## Human Decisions  <!-- finding ID + Phase 4 answer -->
## Strengths
## Recommended Changes  <!-- finding IDs from Validated Findings, by severity; concrete action and proof class; no restatement -->
## Open Questions
## Integration Hooks  <!-- for-goat-plan, for-goat-debug, for-implementation; finding ID + action -->
## What Wasn't Critiqued
<!-- Phase 5.6: fresh linked outcomes record; use Saved records and recovery -->
```
