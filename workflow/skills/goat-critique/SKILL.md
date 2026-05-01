---
name: goat-critique
description: "Use when a decision or analysis needs multi-lens critique to surface blind spots before shipping."
goat-flow-skill-version: "1.3.3"
---
# /goat-critique

## Shared Conventions

Read `.goat-flow/skill-reference/skill-preamble.md` and `.goat-flow/skill-reference/skill-conventions.md` for shared conventions before proceeding.

## When to Use

Use when a concrete artifact deserves multi-perspective critique before shipping. Takes ANY input artifact: a plan, security assessment, debug hypothesis set, review findings, test strategy, architecture proposal, or refactor approach.

**Use when:**
- The stakes justify structured critique before shipping
- You have a concrete artifact to critique (not vague ideas)
- You want competing perspectives, not just validation
- Called by another goat-* skill or directly by the user

**NOT this skill (pre-invocation routing):** Use when deciding which skill to invoke, not after explicit invocation.
- No artifact exists yet → create one first (goat-review, goat-debug, etc.)
- Simple factual question → answer directly
- Trivial artifact (hotfix, single-file change) → consider goat-review instead

**Direct invocation is binding.** `$goat-critique` or `/goat-critique` runs all 5 phases and is consent to the full protocol and delegated sub-agents. Do NOT ask again. Dispatcher ambiguity rules do not override direct invocation; raise scope concerns after synthesis.

**Report-only by default.** `$goat-critique make X shorter` means critique/plan only; `make X shorter` means implementation; `$goat-critique ... then apply it` means critique first, apply only after the Phase 5 gate. Do not mutate the target artifact or committed files unless the user separately says to apply, edit, update, fix, or otherwise implement. If interrupted or told no changes, freeze writes; use only read-only status/diff checks until the user explicitly asks for cleanup, revert, or apply.

## Step 0 - Intake

goat-critique runs in one mode: full delegated, 5 phases, three sub-agents. Quick/lite modes were tried and removed — a single reviewer running lens passes in one context is self-talk under three labels, not multi-perspective critique. If an agent suggests adding a lighter mode, that suggestion is the failure this design prevents.

**Intake checklist:**
- Confirm the artifact exists and is concrete (a file, a plan document, a specific set of findings - not a vague idea).
- Select the critique rubric for the artifact type (see Critique Rubrics below). If unclear, ask the user.
- Use the preamble's grep-first learning-loop retrieval on relevant `.goat-flow/footguns/` and `.goat-flow/lessons/`; record explicit misses instead of broad-loading buckets.
- Delegation consent: explicit `$goat-critique` or `/goat-critique` invocation is consent to spawn sub-agents. Do NOT ask again. Proceed directly to Phase 1 after intake checklist items (artifact confirmation, rubric selection, footgun/lesson retrieval). If the skill is chained from another goat-* skill, follow the active runtime's local delegation rule before spawning.
- Skill-chained entry: skip intake confirmation, use caller context, then satisfy the delegation consent rule above before Phase 1 - still run footgun/lesson retrieval and rubric selection. Skill-chaining does not unlock a quick variant; all 5 phases still run.
- **Differential mode detection:** Check `.goat-flow/logs/critiques/` for prior critiques of the same artifact slug within 30 days. If found, offer differential mode: sub-agents A and B receive the prior critique log + artifact diff; Agent C stays cold. Phase 5 Verdict adds a delta block (Resolved/Regressed/New/Unchanged counts). Tag log as `[diff-of: <prior-uuid>]`.
- **Read context map:** Read the selected rubric's context map (see `critique-rubric-examples.md`) and pass to each sub-agent's spawn directive.

## Phase 1 - Generate Competing Critiques

Spawn all three sub-agents in a single parallel batch via the Agent tool.

Context varies intentionally - informational diversity catches more than tonal diversity.

### The Core Trio Lens

Agents A and B both use the SKEPTIC/ANALYST/STRATEGIST combined lens. These three perspectives work as a unit - never split them into separate agents:

- **SKEPTIC** - "What could go wrong? What assumptions are unproven? What's the worst-case scenario?"
- **ANALYST** - "What does the evidence actually say? What's the cost/benefit? What do the numbers and code paths tell us?"
- **STRATEGIST** - "What's the fastest path to shipping? What can we defer? What's the highest-leverage change?"

All three perspectives must appear in every critique from Agents A and B. The tension between them is the point.

**Context split:**

| Agent | Reads | Does NOT read |
|---|---|---|
| A (Risk) | artifact + architecture.md + footguns + lessons + rubric | git history, config.yaml |
| B (Alternatives) | artifact + architecture.md + `git log --oneline -20` + config.yaml + rubric | footguns, lessons |
| C (Fresh Eyes) | artifact + rubric ONLY | everything else (isolation enforced) |

### Sub-Agent Definitions

Full directives: `.goat-flow/skill-reference/critique-sub-agent-directives.md`.

- **A (Risk):** SKEPTIC/ANALYST/STRATEGIST on risks, 2nd-order impacts, fastest safe path. Must cite downstream files by name.
- **B (Alternatives):** SKEPTIC/ANALYST/STRATEGIST on alternatives, ranked by implementation friction. Must surface at least one alternative.
- **C (Fresh Eyes):** No project context. Flags unstated assumptions. ISOLATION RULE enforced.

Each sub-agent MUST return 3-7 findings, each with: title, severity, evidence (file:line), confidence, Proof attempt, Evidence quality (OBSERVED/INFERRED/UNVERIFIED), SKEPTIC/ANALYST/STRATEGIST lines, and rubric dimensions covered. Plus: overall assessment (STRONG/ADEQUATE/WEAK/FLAWED) and one thing the artifact gets RIGHT.

**Lens-finding floor:** each lens must surface >= 1 finding per sub-agent or re-run once; convergence allowed after one re-run. Do not fabricate findings to meet the floor. Full floor spec and anti-fabrication clause in the sub-agent directives reference pack.

**Phase 1 tool budget:** max 5 tool calls per sub-agent.

## Phase 2 - Rank and Compare

Execute in this order:

**1. Scan Agent C output for context leaks.** Before any other Phase 2 work, grep Agent C's output for `.goat-flow/`, `goat-*`, `architecture.md`, `config.yaml`, or project-specific namespace references. Any match = CONTEXT LEAK; discard Agent C's findings and re-spawn with stricter isolation.

**1b. Check sub-agent completeness.** Verify each sub-agent returned 3-7 findings with all required fields. Incomplete → re-spawn once; if still incomplete, record `sub-agent completeness limited`.

**2. Classify each finding:** **Consensus** (≥2 agents, severity within ±1), **Split** (≥2 agents, severity differs ≥2 levels or explicit reject vs blocking), **Unique** (one agent only). Silence is not a dismiss; treat as Unique.

**3. Score each sub-agent's critique** on five axes: Grounding (file:line evidence?), Specificity (concrete?), Actionability (clear next step?), Coverage (rubric dimensions addressed?), Calibration (severity matches evidence?).

**4. Verify sub-agent dimension coverage.** For each agent, verify their full claimed dimension set: skim all findings from that agent and confirm each claimed dimension has at least one finding whose content substantively addresses it. Demote any dimension where no finding's content matches the claim. Use orchestrator-verified dimensions (not raw self-declarations) as input to step 5. Sub-agent dimension tags are inputs to verify, not trusted evidence.

**5. Compute rubric coverage gates.** `unaddressed = rubric dimensions \ union(dimensions covered across all agents)`. For each unaddressed mandatory dimension (see Critique Rubrics below), auto-generate a HIGH coverage-gap finding: "No sub-agent addressed [dimension]. This is a blind spot." For each unaddressed optional dimension, auto-generate a MEDIUM coverage-gap finding.

**6. Spot-check OBSERVED claims.** For each finding marked OBSERVED, re-read the cited file:line or proof artifact. Findings that fail spot-check get tagged `[evidence-gap: spot-check failed]`; Phase 3 decides retract or upgrade.

**7. Label control group deltas.** For fresh-eyes-only findings, the orchestrator (not Agent C) assigns one of these labels based on re-reading the artifact's cited reference:
- **CONTEXT DRIFT** - concern is wrong because C lacks project context that would resolve it
- **READABILITY GAP** - concern is valid for any reader regardless of project context
- **CONTEXT-LIMITED** - concern may be valid but C cannot fully evaluate without project context

## Phase 3 - Cross-Examine

**Early exit:** If Phase 2 yields zero split findings and zero unique HIGH/CRITICAL findings, skip Phase 3. Note "no disputes - full consensus" in output and proceed to Phase 4.

**Cross-examination budget:** Max 3 cross-examination agents total, max 3 tool calls per agent. If splits + unique HIGH/CRITICAL exceed 3, batch multiple disputes into a single agent prompt. Triage by severity - CRITICAL and HIGH first.

For each split finding, spawn a cross-exam agent: "Agent A says [X], Agent B says [Y]. Which is correct given the actual codebase?"

For unique HIGH/CRITICAL findings, spawn verification: "Only one critique raised [finding]. Genuine blind spot or false positive?"

Mark each: RESOLVED (with winner) / STILL DISPUTED / RETRACTED (false positive confirmed).

## Phase 4 - Clarify

**Persist before gate:** Before evaluating clarification questions, write Phase 1-3 results to `.goat-flow/logs/critiques/<YYYY-MM-DD>-<HHMM>-<artifact-slug>-<rand5>.md` - sub-agent summaries, comparison matrix, cross-examination outcomes. This runs regardless of whether Phase 3 took the early-exit branch.

Before synthesising, present the unresolved items to the human conversationally.

**Opener:** Lead with a one-line summary of how many decisions are needed and their titles. Example: "3 decisions before synthesis: (1) SEC-01 severity, (2) remediation path, (3) attacker model scope."

**Per-question format - question first, options as one-liners, explicit default:**

> **Q[N]: [Short question phrased as a decision]?**
> - (A) [one-line summary] - [what it costs or trades away]
> - (B) [one-line summary] - [what it costs or trades away]
> - Default: [A or B] if you skip. [One sentence explaining why this is the default.]
> - Background: [One sentence max - demoted context, not the main event.]

**Compact table (3+ questions):** When there are 3 or more questions, present as a decision table: `| # | Decision | Option A (default) | Option B | Why |`. Follow with: "Reply with numbers to override defaults; or approve to proceed." Full analysis stays in the persisted critique log.

Question types that use this format:
1. **Disputes** - still-disputed findings from Phase 3. Present both positions as options.
2. **Trade-offs** - where two valid approaches exist. Present the fork as options.
3. **Context drift** - CONTEXT DRIFT findings from Phase 2 that challenge the artifact's assumptions. Options: intentional vs oversight.

**Closer:** After all questions, end with: "Reply with your picks (e.g. 'A, B, go with defaults on the rest') or push back on any framing."

**If questions exist:** BLOCKING GATE - STOP and wait for human response.
**If no questions (full consensus, no trade-offs, no context drift):** CHECKPOINT - note "no disputes - proceeding to synthesis" and continue.

## Phase 5 - Synthesise

Produce the prime critique. Lead with a **Verdict** block:
- **Gate: BLOCK | CONCERNS | CLEAN** — derived from surviving findings: any CRITICAL → BLOCK, any HIGH (no CRITICAL) → CONCERNS, else CLEAN
- Assessment: STRONG / ADEQUATE / WEAK / FLAWED (synthesised from sub-agent assessments and cross-examination outcomes)
- Risk level: LOW / MEDIUM / HIGH / CRITICAL
- Top 1-3 blockers (if any) - one line each, linked to findings below
- If differential mode: append delta block (`Resolved: N | Regressed: M | New: K | Unchanged: J` vs prior critique)

Then the full critique:
- Consensus findings (preserved as-is)
- Resolved split findings (with resolution rationale)
- Human-directed findings (from Phase 4 clarification responses)
- Verified unique findings (survived cross-examination)
- Retracted findings (listed so user sees what was considered and dismissed)

**Open questions:** Do not present low-confidence or inferred-only items as recommendations. Put them under Open Questions when any of these apply: supporting evidence is INFERRED (not OBSERVED); only one agent raised it and cross-examination was inconclusive; or the recommendation depends on an unvalidated assumption:

> **Open Question:** [unresolved question or recommendation candidate]
> - Confidence: LOW/MEDIUM
> - Evidence needed to resolve: [what specific evidence would settle this]
> - Revisit when: [concrete trigger - next milestone, specific file change, before deploy]

**Blind spot check:** Before presenting, identify:
- Sections of the artifact that no sub-agent addressed
- Aspects of the critique rubric that no finding maps to
- Files or systems referenced by the artifact that were not read by any sub-agent

List these as "What Wasn't Critiqued." This section must never be empty - if everything was covered, state that explicitly.

**BLOCKING GATE:** Present the synthesised critique with a conversational close:
"Done. Options: (A) apply recommendations to the artifact, (B) dig deeper into [name top unresolved area], (C) re-run with different framing, (D) close - you apply manually. Default: D."
After critique of a plan, suggest `/goat-plan` to update milestones based on recommendations.

Recommendations are never auto-applied. After synthesis, stop. Do not enter implementation mode unless the user explicitly asks to apply changes. The human gate is the default close.

**Proof Gate:** Apply the Proof Gate from `skill-preamble.md` to every synthesised finding - sub-agent reports are inputs to verify, not evidence to launder. Re-read each surviving finding's `file:line` or artifact section reference in this session before inclusion. Re-read applies to findings surviving to Phase 5 (typically 3-7 after Phase 3/4 filtering), not to all findings raised in Phase 1.

**Phase 5.5 - Meta-audit.** Spawn a lightweight meta-agent (budget: 2 tool calls, no context beyond the draft Phase 5 output). Audit the critique for internal consistency against the 10-point rubric in `critique-rubric-examples.md`. If issues found, insert an `## Auto-Detected Issues` block before the human gate. Verdict block updated with `Meta-score: N/100`.

**Phase 5.6 - Outcome capture.** After the human picks A/B/C/D, tag each surviving finding: `accepted | rejected | deferred | partial`. Default: option (A) → all `accepted`; option (D) → all `deferred`. Persisted to the critique log under `## Outcomes`.

**Integration hooks.** Populate from surviving findings when applicable:
- `for-goat-plan` — milestone updates, reordering
- `for-goat-debug` — hypothesis seeds, evidence to capture
- `for-implementation` — immediate fixes, deferred items

Empty sections collapsed to `none`.

## Critique Rubrics

The rubric determines what sub-agents evaluate. Match to artifact type. Dimensions marked **[M]** are mandatory (unaddressed → auto-HIGH coverage-gap finding); dimensions marked **[O]** are optional (unaddressed → auto-MEDIUM). Each rubric has a context map (A/B/C file assignments) in `critique-rubric-examples.md`; Step 0 reads the selected map.

**Plan:** correctness against codebase [M], integration safety [M], sequencing quality [M], validation coverage [O], task specificity [O]
**Security assessment:** threat model completeness [M], exploitability calibration [M], attack surface coverage [M], framework mitigation accuracy [O], data flow quality [O]
**Debug hypotheses:** hypothesis diversity [M], evidence quality (OBSERVED vs INFERRED) [M], elimination rigour [M], confidence calibration [O], reproduction completeness [O]
**Review findings:** severity calibration [M], diff coverage [M], pre-existing separation [M], false positive rate [O], cross-reference impact [O]
**Test strategy:** coverage gaps [M], risk-proportionate depth [M], doer-verifier separation [O], manual test specificity [O], mock awareness [O]
**Architecture/refactor:** blast radius accuracy [M], migration safety [M], backward compatibility [M], dependency impact [O], rollback feasibility [O]
**Generic (fallback):** internal consistency [M], evidence grounding [M], scope completeness [M], feasibility [M], risk identification [M]. All dimensions mandatory for the fallback rubric. If using the generic rubric, state why no specific rubric matched and which was closest.

## Output Format

**Terse-first directive:** Informational sections (Sub-Agent Comparison Matrix, Retracted Findings, What Wasn't Critiqued) default to terse: one sentence per bullet, no qualifiers, no closing offers. Gate prompts and evidence-tagged findings retain full detail.

```markdown
## Verdict  <!-- includes Gate: BLOCK|CONCERNS|CLEAN + Meta-score -->
## Critique Rubric
## Sub-Agent Comparison Matrix
## Sub-Agent Rankings
## Rubric Coverage Gaps
## Control Group Delta
## Validated Findings  <!-- source pool for Recommended Changes -->
## Cross-Examination Results
## Auto-Detected Issues  <!-- from Phase 5.5 meta-audit, if any -->
## Retracted Findings
## Human Decisions
## Strengths
## Recommended Changes  <!-- subset of Validated Findings; ordered by severity; each with concrete action -->
## Open Questions
## Integration Hooks  <!-- for-goat-plan, for-goat-debug, for-implementation -->
## What Wasn't Critiqued
## Outcomes  <!-- Phase 5.6: per-finding accepted|rejected|deferred|partial -->
```
