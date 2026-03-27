# Output Skeleton Templates

Literal markdown templates for skill output. Skills that produce findings or
reports MUST use these skeletons to ensure consistent, parseable output.

---

## Findings Report (goat-audit, goat-review, goat-security)

```markdown
## TL;DR
<!-- 3 sentences: what was examined, what was found, what matters most -->

## Findings

### MUST Fix (Blocking)
- **[title]** — `file:line` — [description]
  Footgun match: MATCH [entry] | CLEAR
  Evidence: OBSERVED | INFERRED (missing: [what direct evidence is needed])

### SHOULD Fix
- **[title]** — `file:line` — [description]

### MAY Fix (Optional)
- **[title]** — `file:line` — [description]

## What I Didn't Examine
<!-- List files/areas skipped and why: too many, lower priority, needs access -->

## Patterns
<!-- If 3+ findings share a root cause, group them here as a systemic issue -->
```

## Investigation Report (goat-investigate)

```markdown
## TL;DR
<!-- 3 sentences: scope, key finding, recommendation -->

## Components
| Component | Location | Role |
|-----------|----------|------|
<!-- fill -->

## Data Flow
<!-- Mermaid.js diagram or prose description of how data moves through components -->

## Boundaries Touched
<!-- Which module/service/API boundaries does this area cross? -->

## Risks / Gotchas
<!-- Minimum 3, with file:line evidence -->
- `file:line` — [risk description] — Evidence: OBSERVED | INFERRED

## Current vs Expected State
| Aspect | Current | Expected | Gap |
|--------|---------|----------|-----|
<!-- fill -->

## Open Questions
<!-- What couldn't be determined from reading code alone? -->

## What I Didn't Read
<!-- Files/areas skipped. Reason: too many | lower priority | needs context -->

## Recommendation
<!-- What should happen next? Chain to which skill? -->
```

## Diagnosis Report (goat-debug)

```markdown
## TL;DR
<!-- 1 sentence: root cause + confidence level -->

## Hypotheses
| # | Hypothesis | Category | Status | Evidence |
|---|-----------|----------|--------|----------|
| 1 | [description] | data/logic/timing/env/config | CONFIRMED/ELIMINATED/UNRESOLVED | `file:line` |
| 2 | ... | ... | ... | ... |

## Root Cause
**Confidence:** HIGH (reproduced) | MEDIUM (traced) | LOW (inferred)
**Location:** `file:line`
**Description:** [what's wrong and why]

## Reproduction Steps
1. [step]
2. [step]
3. Expected: [X] — Actual: [Y]

## Fix Plan
<!-- Only if human approved Phase 3 -->
- What changes: [description]
- Blast radius: [what else could break]
- Verification: [how to confirm the fix worked]
```

## Security Assessment (goat-security)

```markdown
## TL;DR
<!-- 3 sentences: threat model, key findings, posture assessment -->

## Threat Surface
| Category | Status | Skip Reason |
|----------|--------|-------------|
| Input validation | Scanned / Skipped | [if skipped: why] |
| Auth/authz | ... | ... |
| Secret handling | ... | ... |
| SQL injection | ... | ... |
| XSS | ... | ... |
| Command injection | ... | ... |
| Path traversal | ... | ... |
| Dependency CVEs | ... | ... |
| CORS/CSP | ... | ... |
| Permission escalation | ... | ... |

## Findings (by exploitability)

### Critical (exploitable without auth)
- **[title]** — `file:line`
  **Attack scenario:** An [attacker profile] can [action] via [vector], resulting in [impact]
  **Framework mitigation:** [checked — not mitigated | mitigated by X — downgraded]

### High / Medium / Low
<!-- Same format, without attack scenario for Low -->

## Framework Mitigations Verified
| Framework Feature | Installed | Configured | Applied to relevant routes |
|-------------------|-----------|------------|---------------------------|
<!-- fill -->

## What I Didn't Check
<!-- Threat surfaces skipped and why -->

## Dependency Audit
<!-- Output of npm audit / pip-audit / cargo audit / etc. -->
```

## Test Plan (goat-test)

```markdown
## TL;DR
<!-- What changed, what's tested, what isn't -->

## Track 0: Change Manifest
| File | Component | Change Type | Risk | Verification Ratio |
|------|-----------|-------------|------|-------------------|
<!-- fill -->

## Track 1: Automated Tests
<!-- Commands for the coding agent to run -->
```bash
<!-- ADAPT: your project's test commands -->
```

### Integration Gaps
<!-- Risk areas from Track 0 NOT covered by automated tests -->

## Track 2: AI Verification
<!-- Self-contained prompts for a SEPARATE agent with no shared context -->

### Failure Signatures
| If this breaks... | You'll see... |
|-------------------|---------------|
<!-- fill -->

## Track 3: Human Testing
| What to test | Where | What "good" looks like | What to look for |
|-------------|-------|----------------------|-----------------|
<!-- fill -->

## What ISN'T Tested
<!-- Explicit gaps in coverage -->
```

## Context Report (goat-context)

```markdown
## Session Reconstruction

**Last session:** [task from handoff/git]
**Branch:** [name] — [N] commits ahead of main, [N] behind
**Modified files:**
| File | Status | Summary |
|------|--------|---------|
<!-- fill from git diff --stat + sampling -->

**Handoff drift:** [MATCH — handoff.md aligns with git] | [DRIFT — handoff says X, git shows Y]

## Recommendation
**Next action:** [what to do]
**Suggested skill:** /goat-[name]
**Confidence:** HIGH | MEDIUM | LOW
**Reasoning:** [one sentence]
```
