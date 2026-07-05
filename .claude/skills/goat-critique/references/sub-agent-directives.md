---
goat-flow-reference-version: "1.13.1"
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

## Lens-finding floor

Agents A and B must surface at least one distinct finding per lens. If a lens cannot find an issue after analysing the artifact, the sub-agent must re-run that lens once with explicit instruction: "Look harder - what assumption is unproven, what evidence is thin, what shortcut exists?" Only after one documented re-run may a lens report `No findings - convergent with [other agents]`. The convergence claim must reference which other agents covered the same dimension. Convergence with the artifact itself is not valid.

Agent C must surface at least one unstated-assumption, readability-gap, or context-limited finding. If it cannot, re-run once with: "Read only the artifact and rubric. What would be unclear to a fresh maintainer with no project context?" After one documented re-run, C may report convergence rather than fabricate a finding.

**Anti-fabrication clause.** If the second pass also finds nothing genuine, the lens MUST report convergence rather than fabricate findings. Forced fabrication is a worse failure than a missed finding. Do not fabricate findings to meet the floor. Pedantic or non-existent issues surfaced solely to satisfy the floor are explicitly disallowed; any finding the orchestrator detects as fabrication-pattern (e.g. style nitpicks rated HIGH severity, content-free findings like "consider adding more tests") is auto-demoted to LOW confidence in Phase 2.

### BAD vs GOOD: satisfying the lens floor when a lens finds nothing

**BAD - fabrication-pattern (auto-demoted to LOW confidence in Phase 2):**

```markdown
## Finding: Consider adding more inline comments for readability
- **Severity:** HIGH | **Confidence:** HIGH
- **Evidence quality:** UNVERIFIED
- **SKEPTIC:** the file might be hard to read for someone someday
```

Why it fails: a style preference with no cited anchor, inflated to HIGH solely to fill the SKEPTIC lens. No worst-case, no evidence, content-free recommendation - exactly the pattern the orchestrator demotes.

**GOOD - honest convergence (the sanctioned escape valve):**

```markdown
## SKEPTIC lens (Agent B): No findings - convergent with Agent A (risk: SEC-01) and Agent C (unstated-assumption)
- Re-ran once with the "look harder - what assumption is unproven, what evidence is thin" prompt.
- The remaining worst-case surface was already raised by Agent A's SEC-01 and Agent C's unstated-assumption finding, so this lens reports convergence rather than inventing a distinct issue.
```

Why it passes: it names which agents covered the dimension, documents the mandatory re-run, and declines to fabricate. Convergence with other agents is valid; convergence with the artifact itself is not.
