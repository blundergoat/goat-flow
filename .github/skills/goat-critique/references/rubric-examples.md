---
goat-flow-reference-version: "1.9.1"
---
# Critique Rubric Examples (Reference Pack)

*Extracted from the goat-critique SKILL.md to stay within the 2500-word skill cap. Canonical rubric definitions remain in SKILL.md; worked examples and context-map details live here.*

## Rubric Context Maps

Each rubric has a context map that Step 0 reads and passes to sub-agent spawn directives. Footgun/lesson entries mean targeted grep-first hits from those buckets, not whole-directory reads. Agent C's isolation enforcement (Phase 2 step 1 grep check) is unchanged regardless of context map. Generic fallback uses the default split.

### Plan
- **A:** targeted grep-first footgun/lesson hits, `.goat-flow/decisions/`
- **B:** `.goat-flow/tasks/.active`, `git log --oneline -20`, milestone logs
- **C:** [] (isolation enforced)

### Security assessment
- **A:** targeted grep-first footgun/lesson hits, threat-model docs, `.goat-flow/decisions/`
- **B:** `git log --oneline -20`, config.yaml, dependency manifests
- **C:** [] (isolation enforced)

### Debug hypotheses
- **A:** targeted grep-first footgun/lesson hits, `.goat-flow/logs/sessions/`
- **B:** `git log --oneline -20`, config.yaml, test output
- **C:** [] (isolation enforced)

### Review findings
- **A:** targeted grep-first footgun/lesson hits, `.goat-flow/decisions/`
- **B:** `git log --oneline -20`, config.yaml, CI logs
- **C:** [] (isolation enforced)

### Test strategy
- **A:** targeted grep-first footgun/lesson hits, `.goat-flow/decisions/`
- **B:** `git log --oneline -20`, config.yaml, test manifests
- **C:** [] (isolation enforced)

### Architecture/refactor
- **A:** targeted grep-first footgun/lesson hits, `.goat-flow/decisions/`, dependency maps
- **B:** `git log --oneline -20`, config.yaml, module boundaries
- **C:** [] (isolation enforced)

### Generic (fallback)
- **A:** targeted grep-first footgun/lesson hits
- **B:** `git log --oneline -20`, config.yaml
- **C:** [] (isolation enforced)

## Worked examples

### Example: Plan rubric critique output

```markdown
## Finding: Migration sequencing risk
- **Severity:** HIGH | **Confidence:** HIGH
- **Evidence:** Milestone plan excerpt (search: "Phase 2 additions") - Phase 2 additions depend on Phase 1 extraction completing first
- **Proof attempt:** Read the milestone plan excerpt, confirmed extraction must precede additions
- **Proof class:** STATIC
- **Evidence quality:** OBSERVED
- **SKEPTIC:** If extraction doesn't reclaim enough words, Phase 2 additions blow the 2500 cap
- **ANALYST:** Current 2532w minus ~100w extraction gives ~80w budget for additions; tight but feasible
- **STRATEGIST:** Extract first, measure, then add incrementally - abort additions if buffer insufficient
- **Rubric dimensions:** sequencing quality [M], integration safety [M]
```

### Example: Security assessment rubric critique output

```markdown
## Finding: Unvalidated input in API handler
- **Severity:** CRITICAL | **Confidence:** HIGH
- **Evidence:** `src/api/handler.ts` (search: "database query") - user input passed directly to database query
- **Proof attempt:** Read handler.ts around the database query, confirmed no sanitization before query construction
- **Proof class:** STATIC
- **Evidence quality:** OBSERVED
- **SKEPTIC:** SQL injection vector; worst case is full database compromise
- **ANALYST:** Direct string interpolation in query; parameterised queries would eliminate the risk at zero performance cost
- **STRATEGIST:** Immediate fix: switch to parameterised queries. Defer: full input validation audit
- **Rubric dimensions:** exploitability calibration [M], attack surface coverage [M]
```

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
