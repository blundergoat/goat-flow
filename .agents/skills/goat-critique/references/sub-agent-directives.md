---
goat-flow-reference-version: "1.14.0"
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

## Per-finding output spec

Every finding MUST include:

- **Proof attempt:** exact command/read executed in sub-agent's tool budget, or "N/A - purely structural"
- **Proof class:** `RUNTIME | CONTRACT-GREP | STATIC | NOT-REPRODUCED` - records *how* the claim was checked: the verification mechanism, or NOT-REPRODUCED when the attempt could not confirm it
- **Evidence quality:** OBSERVED / INFERRED / UNVERIFIED - records *confidence* in the result. The axes are independent: a STATIC read can still yield OBSERVED, while a RUNTIME attempt that fails to reproduce pairs NOT-REPRODUCED with UNVERIFIED
- Title, severity (CRITICAL/HIGH/MEDIUM/LOW), evidence (file + semantic anchor or artifact section reference), confidence (HIGH/MEDIUM/LOW)
- **SKEPTIC:** one line - what could go wrong, worst case (or "N/A - [reason]" if genuinely inapplicable)
- **ANALYST:** one line - what the evidence says, cost/benefit
- **STRATEGIST:** one line - fastest path, what to defer, highest-leverage action

For Agents A and B, the tension between lenses is the point. If all three agree, say so - forced disagreement is noise. Consensus across lenses is itself a valid finding; the mandate is that all three perspectives appear as labeled sub-fields, not that they must disagree. For Agent C, the labeled fields keep the schema uniform; `N/A - fresh-eyes scope` is acceptable when the fresh-eyes finding has no useful lens-specific angle.

## Clean-result attestation

Three to seven findings is the normal useful range, not a quota. A sub-agent that finds no supported defect after one documented second pass returns this schema instead of findings:

- **CLEAN RESULT:** no supported findings
- **Evidence reviewed:** exact artifact sections, files, commands, or `artifact-only` for isolated C
- **Rubric coverage:** each mandatory dimension and the evidence checked
- **Second-pass result:** prompt used and what was re-read
- **Residual uncertainty:** unread or untestable surface, or `none identified` with rationale
- **SKEPTIC / ANALYST / STRATEGIST:** what each lens checked; C may use `N/A - fresh-eyes scope` where appropriate
- **Proof class:** `RUNTIME | CONTRACT-GREP | STATIC | NOT-REPRODUCED`
- **Overall assessment:** STRONG / ADEQUATE / WEAK / FLAWED
- **Strength:** one concrete strength with an artifact anchor

This attestation satisfies the completeness gate only after the second pass is documented. Never invent a finding to meet the normal target.

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
