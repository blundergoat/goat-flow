---
goat-flow-reference-version: "1.17.0"
---
# Critique Sub-Agent Directives (Reference Pack)

*Extracted from the goat-critique SKILL.md to stay within the 2500-word skill cap. Canonical detail lives here; SKILL.md retains concise summaries.*

## Sub-agent A (Risk Focus - backward-looking context)

**Directive:** "Apply SKEPTIC/ANALYST/STRATEGIST. Focus on RISKS: what could go wrong, what the evidence says about cost/benefit, what the 2nd-order systemic impacts are (local fix → global break patterns), and what the fastest safe path looks like. For any 2nd-order claim, you MUST cite the downstream file or system by name - speculation without a named target gets retracted in Phase 3. Your context includes targeted INDEX-first past-mistake hits - use them."

**Context reads:** artifact + architecture.md + targeted INDEX-first footgun/lesson hits + rubric
**Does NOT read:** git history, config.yaml

## Sub-agent B (Alternatives Focus - current-state context)

**Directive:** "Apply SKEPTIC/ANALYST/STRATEGIST. Focus on ALTERNATIVES: generate 2-3 mutually distinct approaches to the key decisions, ranked by implementation friction (easiest-to-ship first). You MUST recommend at least one alternative even if the artifact is mostly fine - if you can't find a better approach, surface a meaningfully different one and explain why the artifact's choice wins. Your context includes how the project actually works right now (git history, config) - ground alternatives in real project patterns, not theory."

**Context reads:** artifact + architecture.md + `git log --oneline -20` + config.yaml + rubric
**Does NOT read:** footguns, lessons

## Sub-agent C (Fresh Eyes - NO project context)

**Directive:** "Critique this artifact as if you know nothing about the project. Flag every assumption the artifact makes without stating explicitly. If you find nothing confusing, note whether that is because the artifact is exceptionally clear or because you didn't probe hard enough. Your findings that overlap with other agents are convergent evidence, not redundancy. ISOLATION RULE: Do not read .goat-flow/*, architecture.md, config.yaml, or git history. If you open any of these files, label your output 'CONTEXT LEAK' and restart your analysis without that context."

**Context reads:** artifact + rubric ONLY
**Does NOT read:** everything else (isolation enforced)

## Result envelope

Every sub-agent returns the same envelope whether or not it found a defect. A clean result is this envelope with an empty finding list, not a different schema, so one reader grades both.

- **Agent identity:** `A` (Risk), `B` (Alternatives) or `C` (Fresh Eyes). Every downstream rule that attributes a scope, a limitation or the alternatives mandate reads this field, so a return without it cannot be reconciled with the others.
- **Overall assessment:** STRONG / ADEQUATE / WEAK / FLAWED
- **Strength:** one concrete strength with an artifact anchor
- **Evidence reviewed:** exact artifact sections, files, commands, or `artifact-only` for isolated C
- **Coverage ledger:** one row per selected rubric dimension, defined below
- **Residual uncertainty:** unread or untestable surface, or `none identified` with rationale
- **Lens dispositions:** what SKEPTIC, ANALYST and STRATEGIST each checked. A lens with nothing to report uses `No supported finding` after the documented re-run; C may use `N/A - fresh-eyes scope`.
- **Second-pass result:** prompt used and what was re-read. Required whenever any lens or the whole return is clean.
- **Alternatives (Agent B only):** at least one ranked, meaningfully different approach and why the artifact's choice wins. The mandate is unconditional and a clean result does not waive it. Ranked alternatives are informational comparisons, never a recommendation to change an artifact that has no finding against it. A and C omit this field.
- **Findings:** zero or more, each carrying every field in the next section

### Coverage ledger

One row per selected dimension, none omitted. Each row names the full declared scope and one overall disposition:

`dimension [M|O] | disposition | declared scope | inspected scopes and evidence or finding IDs | unassessed scopes, reasons and next evidence needed`

Any supported defect makes the disposition `finding`, citing its finding IDs. With no supported defect, `checked-clean` requires verified inspection of the full declared scope; otherwise use `unassessed`. An unassessed scope states why and what evidence would settle it; it never creates an artifact defect.

Keep partial inspection within the same row: name the checked-clean inspected scopes and the unassessed remainder with its reasons and next evidence. A `finding` row also retains any unassessed remainder; a defect does not imply complete inspection.

**How the host unions these rows.** The host unions verified inspected scopes, not agent declarations, then applies the same disposition rule to the full declared scope. Verified A/B coverage can earn `checked-clean` despite C's missing inspection only when that union covers the full scope without a supported defect. Preserve each agent's limitations separately, including gaps covered by another agent.

## Per-finding output spec

Every finding MUST include:

- **Finding ID:** a stable run-local identifier, unique within this run. Hooks, retractions, recommendations, top blockers and coverage rows cite the ID instead of repeating the finding.
- **Proof attempt:** exact command/read executed in sub-agent's tool budget, or "N/A - purely structural"
- **Proof class:** `RUNTIME | CONTRACT-GREP | STATIC | NOT-REPRODUCED` - records *how* the claim was checked: the verification mechanism, or NOT-REPRODUCED when the attempt could not confirm it
- **Evidence quality:** OBSERVED / INFERRED / UNVERIFIED / HUMAN-PENDING - records the claim's evidential support, independently of proof class and the separate HIGH/MEDIUM/LOW confidence judgment. A STATIC read can yield OBSERVED; an unsuccessful reproduction does not verify the claim.
- Title, severity (CRITICAL/HIGH/MEDIUM/LOW), evidence (file + semantic anchor or artifact section reference), confidence (HIGH/MEDIUM/LOW)
- **Rubric dimensions:** the selected dimensions this finding evidences, each with its [M] or [O] mark, so the coverage ledger and the finding agree by construction
- **SKEPTIC:** one line - what could go wrong, worst case (or "N/A - [reason]" if genuinely inapplicable)
- **ANALYST:** one line - what the evidence says, cost/benefit
- **STRATEGIST:** one line - fastest path, what to defer, highest-leverage action

For Agents A and B, the tension between lenses is the point. If all three agree, say so - forced disagreement is noise. Consensus across lenses is itself a valid finding; the mandate is that all three perspectives appear as labeled sub-fields, not that they must disagree. For Agent C, the labeled fields keep the schema uniform; `N/A - fresh-eyes scope` is acceptable when the fresh-eyes finding has no useful lens-specific angle.

## Ranking criteria

The host rates each critique on these criteria using its verified output:

| Criterion | What it assesses |
|---|---|
| Grounding | Whether evidence supports the claims and their anchors resolve |
| Specificity | Whether claims name the affected scope, condition and concrete consequence |
| Actionability | Whether a supported defect has a usable next step, or a clean result justifies leaving the artifact alone |
| Coverage | Verified inspection of the declared scope and honest accounting for its limits |
| Calibration | Whether severity and confidence fit the demonstrated effects and evidential limits |

Use **strong** for a clearly supported criterion, **adequate** for a usable result with bounded gaps, and **limited** for a material unsupported or missing part. Explain each rating from evidence. Never sum these labels or invent numerical scores; finding count alone earns no rating.

## Clean-result attestation

Three to seven findings is the normal useful range, not a quota. A sub-agent that finds no supported defect after one documented second pass returns the Result envelope with an empty finding list, marked `CLEAN RESULT:` no supported findings. Every envelope field still applies: agent identity, overall assessment, strength, evidence reviewed, the complete coverage ledger, residual uncertainty, lens dispositions, the second-pass result, and B's unconditional alternatives.

A clean return satisfies the completeness gate only after the second pass is documented. Never invent a finding to meet the normal target.

## Lens-finding floor

Agents A and B must analyse every lens. If a lens cannot find an issue after analysing the artifact, the sub-agent must re-run that lens once with explicit instruction: "Look harder - what assumption is unproven, what evidence is thin, what shortcut exists?" Only after one documented re-run may a lens report `No supported finding`, naming the evidence re-read and any convergence with other agents.

Agent C must probe for unstated assumptions, readability gaps, and context-limited risks. If it finds none, re-run once with: "Read only the artifact and rubric. What would be unclear to a fresh maintainer with no project context?" After one documented re-run, C may return the clean-result attestation.

**Anti-fabrication clause.** If the second pass also finds nothing genuine, the lens MUST report `No supported finding` and the agent may return a clean-result attestation. Forced fabrication is a worse failure than a missed finding. Do not fabricate findings to meet the normal target. Pedantic or non-existent issues surfaced solely to fill a quota are explicitly disallowed; any finding the orchestrator detects as fabrication-pattern (e.g. style nitpicks rated HIGH severity, content-free findings like "consider adding more tests") is auto-demoted to LOW confidence in Phase 2.

### BAD vs GOOD: satisfying the lens floor when a lens finds nothing

**BAD - fabrication-pattern (auto-demoted to LOW confidence in Phase 2):**

```markdown
## Finding: Consider adding more inline comments for readability
- **Severity:** HIGH | **Confidence:** HIGH
- **Evidence quality:** UNVERIFIED
- **SKEPTIC:** the file might be hard to read for someone someday
```

Why it fails: a style preference with no cited anchor, inflated to HIGH solely to fill the SKEPTIC lens. No worst-case, no evidence, content-free recommendation - exactly the pattern the orchestrator demotes.

**GOOD - honest clean lens (the sanctioned escape valve):**

```markdown
## SKEPTIC lens (Agent B): No supported finding
- Re-ran once with the "look harder - what assumption is unproven, what evidence is thin" prompt.
- Re-read the threat-boundary and rollback sections; both state owners, failure modes, and verification evidence.
- Residual uncertainty: runtime behaviour was outside this artifact-only critique.
```

Why it passes: it documents the mandatory re-run, names evidence and residual uncertainty, and declines to fabricate. If every lens is clean, use the complete clean-result attestation above.
