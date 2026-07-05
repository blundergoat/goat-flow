---
goat-flow-reference-version: "1.13.1"
---
# Critique Rubric Examples (Reference Pack)

*Extracted from the goat-critique SKILL.md to stay within the 2500-word skill cap. Canonical rubric definitions remain in SKILL.md; worked examples and context-map details live here.*

## Rubric Context Maps

Each rubric has a context map that Step 0 reads and passes to sub-agent spawn directives. Footgun/lesson entries mean targeted INDEX-first hits from those buckets, not whole-directory reads. Agent C's isolation enforcement (Phase 2 step 1 grep check) is unchanged regardless of context map. Generic fallback uses the default split.

### Plan
- **A:** targeted INDEX-first footgun/lesson hits, `.goat-flow/learning-loop/decisions/`
- **B:** `.goat-flow/plans/.active`, `git log --oneline -20`, milestone logs
- **C:** [] (isolation enforced)

### Security assessment
- **A:** targeted INDEX-first footgun/lesson hits, threat-model docs, `.goat-flow/learning-loop/decisions/`
- **B:** `git log --oneline -20`, config.yaml, dependency manifests
- **C:** [] (isolation enforced)

### Debug hypotheses
- **A:** targeted INDEX-first footgun/lesson hits, `.goat-flow/logs/sessions/`
- **B:** `git log --oneline -20`, config.yaml, test output
- **C:** [] (isolation enforced)

### Review findings
- **A:** targeted INDEX-first footgun/lesson hits, `.goat-flow/learning-loop/decisions/`
- **B:** `git log --oneline -20`, config.yaml, CI logs
- **C:** [] (isolation enforced)

### Test strategy
- **A:** targeted INDEX-first footgun/lesson hits, `.goat-flow/learning-loop/decisions/`
- **B:** `git log --oneline -20`, config.yaml, test manifests
- **C:** [] (isolation enforced)

### Architecture/refactor
- **A:** targeted INDEX-first footgun/lesson hits, `.goat-flow/learning-loop/decisions/`, dependency maps
- **B:** `git log --oneline -20`, config.yaml, module boundaries
- **C:** [] (isolation enforced)

### Generic (fallback)
- **A:** targeted INDEX-first footgun/lesson hits
- **B:** `git log --oneline -20`, config.yaml
- **C:** [] (isolation enforced)

## Worked examples

### Full phase walkthrough: Phase 2 context-leak edge case

- **Artifact:** `SKILL.md`
- **Rubric:** Generic fallback
- **Agent C output under review:** "The Context leak scan section names `goat-critique` and `.goat-flow`; do not discard those references when they are copied from artifact text."
- **Phase 2 actions:** grep Agent C output for forbidden terms; apply the framework-self exemption because the artifact is a goat-flow skill; verify each project term is traceable to the artifact text; still check for structural navigation leaks such as config keys or architecture sections absent from Agent C's input.
- **Expected Phase 2 result:** `no context leak - framework-self terms traceable to artifact; proceed to completeness gate`.

### Example: Plan rubric critique output

```markdown
## Finding: Verification belongs after execution, not only during synthesis
- **Severity:** HIGH | **Confidence:** HIGH
- **Evidence:** a coordination lesson (search: "Phase 3 verification catches state drift invisible to plan-level reasoning") - live `wc -w` and `git show` checks found word-count and version drift after prior critique passes missed them
- **Proof attempt:** Read the lesson entry and verified the recorded failure mode was post-plan state drift
- **Proof class:** STATIC
- **Evidence quality:** OBSERVED
- **SKEPTIC:** A plan can look internally consistent while the repo has drifted underneath it
- **ANALYST:** The failure appeared only when live commands re-checked the current files, so synthesis alone was insufficient
- **STRATEGIST:** Keep an execution-adjacent verification gate and cite the command output before closing the milestone
- **Rubric dimensions:** validation coverage [O], sequencing quality [M]
```

### Example: Architecture/refactor rubric critique output

```markdown
## Finding: Quick critique fallback would break the skill mechanism
- **Severity:** HIGH | **Confidence:** HIGH
- **Evidence:** local decision record (search: "goat-critique runs in one mode: full delegated") - accepted decision binds goat-critique to real delegated agents, not inline role-play
- **Proof attempt:** Read the decision record and confirmed it rejects quick/inline fallback as self-talk under critique labels
- **Proof class:** STATIC
- **Evidence quality:** OBSERVED
- **SKEPTIC:** Reintroducing quick mode would make the output promise multi-perspective critique without isolated contexts
- **ANALYST:** `/goat-review` already covers lightweight single-context review, so the fallback duplicates another skill and weakens this one
- **STRATEGIST:** Keep goat-critique full-delegated and route low-ceremony requests to goat-review
- **Rubric dimensions:** blast radius accuracy [M], migration safety [M], dependency impact [O]
```

### Example: Differential mode delta block (Phase 5 Verdict)

When Step 0 detects a same-artifact critique log within 30 days and differential mode is active, Phase 5 appends a delta block to the Verdict comparing this run against the prior one. Worked example for a plan re-critiqued after the author resolved two findings and added a milestone:

```markdown
## Verdict
- **Gate:** CONCERNS  <!-- one HIGH survives -->
- **Delta vs prior critique [diff-of: a1b2c]:** Resolved: 2 | Regressed: 0 | New: 1 | Unchanged: 1
```

- **Resolved (2):** the prior MILE-03 sequencing gap and the missing rollback step are absent from the current artifact.
- **New (1):** the added milestone introduces an untested integration boundary (HIGH) - this drives the CONCERNS gate.
- **Unchanged (1):** the prior MEDIUM on task specificity persists.
- Counts come from matching this run's findings against the prior log's findings by title/anchor; `[diff-of: a1b2c]` cites the `<rand5>` slug of the prior critique's filename.

## Meta-audit rubric (Phase 5.5)

The meta-agent scores the draft critique against these 10 points:

1. **Gate-finding match** - Gate value matches highest surviving severity
2. **Evidence quality per finding** - every finding has Proof attempt + Proof class + Evidence quality fields
3. **Rubric coverage completeness** - no unaddressed mandatory dimensions
4. **Rec-changes actionability** - every recommendation has a concrete next step
5. **No orphan retractions** - every retracted finding has rationale
6. **No contradictory findings** - no two findings making mutually exclusive claims
7. **Top-blockers traceability** - top blockers map to specific surviving findings
8. **Severity calibration internal consistency** - similar issues rated similar severity
9. **Integration-hooks 1:1 with findings** - no orphan hooks, no missed findings
10. **Blind-spot-check non-empty** - What Wasn't Critiqued populated
