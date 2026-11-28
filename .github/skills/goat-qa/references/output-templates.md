---
goat-flow-reference-version: "1.19.0"
---
# goat-qa Output Templates

Read this reference only when rendering the final response. Select the template matching the mode and gate reached. Never combine templates from different modes, and never combine a gate report with the plan that follows it. One exception: within Standard, explicit test-plan intent releases the Phase 2 gate, and that one response carries the Phase 2 blocks first and the Phase 3 plan after them, under a single Refuted Candidates ledger and a single Verification Integrity section covering the whole response. Audit has no such release and always waits after A4.

### Regression Guard mode

```markdown
## Regression Guards
| Invariant | Current Coverage | Recommended Guard | Owner | Proof Class |

**Test-selection record**
| Disposition | Regression and impact | Current overlap | Stable contract | Level | Evidence status | Owner or path and semantic anchor | Handoff invariant and next check |
|-------------|-----------------------|-----------------|-----------------|-------|-----------------|-----------------------------------|----------------------------------|

## Refuted Candidates
| Claim | Why Excluded | File | Line | Evidence Quality | Evidence Method | Evidence Summary | Command | Exit Code | Excerpt |
|-------|--------------|------|------|------------------|-----------------|------------------|---------|-----------|---------|
<!-- One row per `kill as false positive`; write `None` when there are no rows. Use `—` for nullable or optional fields. -->

## Verification Integrity
- Prior fix evidence: [file, command output, or human-approved record]
- Code and tests read: [list]
- Coverage claim basis: [OBSERVED | INFERRED | UNVERIFIED]
- Proof classes: <N> RUNTIME / <M> CONTRACT-GREP / <K> STATIC / <L> NOT-REPRODUCED
- Evidence limit: [unavailable source, runtime, or tool context]
```

### Fix Replay mode

```markdown
## Fix Replay
- Claimed fix: [what changed and the failure it is said to fix]
- Recorded reproduction: [source and steps, or `none recorded`]

| Step | Expected | Recorded original | Observed now | Evidence |
|------|----------|-------------------|--------------|----------|

## Existing-Test Results
| Command | Directory | Exit | Pass | Fail | Skip | Unverified scope |
|---------|-----------|------|------|------|------|------------------|

## Verdict
[verified | failed | unverified] - [reason, and what stays unverified]

## Refuted Candidates
| Claim | Why Excluded | File | Line | Evidence Quality | Evidence Method | Evidence Summary | Command | Exit Code | Excerpt |
|-------|--------------|------|------|------------------|-----------------|------------------|---------|-----------|---------|
<!-- One row per `kill as false positive`; write `None` when there are no rows. Use `—` for nullable or optional fields. -->

## Verification Integrity
- Reproduction source: [path or link, or `none recorded`]
- Commands run: [each row in Existing-Test Results]
- Browser: [browser and mode used, or `not needed` / `blocked: <reason>`]
- Screenshots: [each kept capture's path, with its `meta.json`, or `none needed`]
- Proof classes: <N> RUNTIME / <M> CONTRACT-GREP / <K> STATIC / <L> NOT-REPRODUCED
- Evidence limit: [unreplayed steps, missing tools, or other limits]
```

### Standard mode - Phase 2 output (diff-driven, present at BLOCKING GATE)

```markdown
## TL;DR  <!-- what changed, what's at risk, biggest testing gaps -->

## Change Risk Map
| File | Lines Changed | What Changed | Risk | Blast Radius | User-Visible Impact | Proof Class |

## Gap Analysis
### Undertested Risks  <!-- Matrix Blocking and High-value pairs -->
| Code Change | Risk | Coverage Depth | Covered By | Gap | Proof Class |

### Misaligned Effort  <!-- test cases that don't match code changes in this branch -->
| Test Case | Maps to Change | Assessment | Proof Class |

**Test-selection record**
| Disposition | Regression and impact | Current overlap | Stable contract | Level | Evidence status | Owner or path and semantic anchor | Handoff invariant and next check |
|-------------|-----------------------|-----------------|-----------------|-------|-----------------|-----------------------------------|----------------------------------|

## Existing-Test Results  <!-- one row per command from Existing-Test Execution; omit the table on an analysis-only request -->
| Command | Directory | Exit | Pass | Fail | Skip | Unverified scope |
|---------|-----------|------|------|------|------|------------------|

## Browser Checks  <!-- one row per affected journey; omit when the change has no browser-visible behaviour -->
| Journey | Page | Steps | Expected | Observed | Evidence | Status |
|---------|------|-------|----------|----------|----------|--------|
<!-- Status: verified | failed | blocked | untested. Evidence: request or screenshot link, or `none`. -->

## Refuted Candidates
| Claim | Why Excluded | File | Line | Evidence Quality | Evidence Method | Evidence Summary | Command | Exit Code | Excerpt |
|-------|--------------|------|------|------------------|-----------------|------------------|---------|-----------|---------|
<!-- One row per `kill as false positive`; write `None` when there are no rows. Use `—` for nullable or optional fields. -->

## Verification Integrity
- Intent spec: [PR/issue/test plan URL or `no-intent-spec`]
- Tests read: [list]
- Tests not read / unavailable: [list or `none`]
- Commands discovered: [test/lint commands found]
- Commands run: [each row in Existing-Test Results, or `none (analysis-only request)`]
- Checks not run: [optional, slow, networked, or credentialed suites skipped and why, or `none`]
- New failures: [failing test and exit status, handed to `/goat-debug`, or `none`]
- Browser: [browser and mode used, or `not needed` / `blocked: <reason>`]
- Screenshots: [each kept capture's path, with its `meta.json`, or `none needed`]
- Runtime execution by others: [who ran what, or `none observed`]
- Coverage claim basis: [OBSERVED | INFERRED | UNVERIFIED]
- Proof classes: <N> RUNTIME / <M> CONTRACT-GREP / <K> STATIC / <L> NOT-REPRODUCED
- Analysis confidence: [HIGH | MEDIUM | LOW] - [rationale]
- Evidence limit: [diff/files read and any unavailable runtime/tool context]
- Assessed by: [agent]
```

### Standard mode - Phase 3 output (after the Phase 2 gate is approved or auto-released)

When the gate auto-released, the Phase 2 blocks above already appear in this same response; emit
this plan after them and do not repeat the ledger or the integrity section.

```markdown
## Targeted Testing Plan
### Must test before shipping  <!-- Matrix Blocking pairs; include manual steps, failure symptoms, time, proof class -->
### Should test if time allows  <!-- Matrix High-value pairs; include proof class -->
### Safe to skip  <!-- Matrix Defer pairs; include rationale and proof class -->

**Test-selection record**
| Disposition | Regression and impact | Current overlap | Stable contract | Level | Evidence status | Owner or path and semantic anchor | Handoff invariant and next check |
|-------------|-----------------------|-----------------|-----------------|-------|-----------------|-----------------------------------|----------------------------------|

## Refuted Candidates
| Claim | Why Excluded | File | Line | Evidence Quality | Evidence Method | Evidence Summary | Command | Exit Code | Excerpt |
|-------|--------------|------|------|------------------|-----------------|------------------|---------|-----------|---------|
<!-- One row per `kill as false positive`; write `None` when there are no rows. Use `—` for nullable or optional fields. -->

## Verification Integrity

- Changes by: [agent/developer]
- Testing by: [who executes]
- Doer-verifier separation: [FULL / PARTIAL / NONE]

## Flow Diagram  <!-- only on request -->
```

### Audit mode (no diff - A1–A4 shape)

```markdown
## TL;DR  <!-- which files carry load-bearing behaviour, coverage shape, biggest gaps -->

## Scope
<!-- Declared boundary from A1: directory, module, or risk class. -->

## Inventory and Risk Ranking
| File | Role | Risk | Proof Class |
<!-- Roles: load-bearing / interface boundary / integration glue / UI / support -->

## Coverage Analysis
| File | Behaviour / Invariant | Risk | Test file | Coverage | Notes | Proof Class |
<!-- Coverage: NONE | STRUCTURAL | PARTIAL-BEHAVIOURAL | BEHAVIOURAL -->

## Gap Report
### Blocking gaps  <!-- Matrix Blocking pairs; each item includes proof class -->
### High-value additions  <!-- Matrix High-value pairs; each item includes proof class -->
### Defer  <!-- Matrix Defer pairs; each item includes proof class -->
### Misaligned effort  <!-- Evidence-backed test-to-risk mismatches, or `none found` -->

**Test-selection record**
| Disposition | Regression and impact | Current overlap | Stable contract | Level | Evidence status | Owner or path and semantic anchor | Handoff invariant and next check |
|-------------|-----------------------|-----------------|-----------------|-------|-----------------|-----------------------------------|----------------------------------|

## Existing-Test Results  <!-- only when the user asked for a run; otherwise omit the table -->
| Command | Directory | Exit | Pass | Fail | Skip | Unverified scope |
|---------|-----------|------|------|------|------|------------------|

## Refuted Candidates
| Claim | Why Excluded | File | Line | Evidence Quality | Evidence Method | Evidence Summary | Command | Exit Code | Excerpt |
|-------|--------------|------|------|------------------|-----------------|------------------|---------|-----------|---------|
<!-- One row per `kill as false positive`; write `None` when there are no rows. Use `—` for nullable or optional fields. -->

## Verification Integrity
- Intent spec: [audit scope rationale or `no-intent-spec`]
- Tests read: [list]
- Tests not read / unavailable: [list or `none`]
- Commands discovered: [test/lint commands found]
- Commands run: [each row in Existing-Test Results, or `none` when no run was requested]
- Coverage claim basis: [OBSERVED | INFERRED | UNVERIFIED]
- Proof classes: <N> RUNTIME / <M> CONTRACT-GREP / <K> STATIC / <L> NOT-REPRODUCED
- Analysis confidence: [HIGH | MEDIUM | LOW] - [rationale]
- Assessed by: [agent]
- Would-be testers: [who executes once gaps are filled]

## Flow Diagram  <!-- only on request -->
```

### Audit post-gate plan (after A4 approval)

```markdown
## Targeted Testing Plan
### Blocking gaps
### High-value additions
### Defer
### Misaligned effort

**Test-selection record**
| Disposition | Regression and impact | Current overlap | Stable contract | Level | Evidence status | Owner or path and semantic anchor | Handoff invariant and next check |
|-------------|-----------------------|-----------------|-----------------|-------|-----------------|-----------------------------------|----------------------------------|

## Refuted Candidates
| Claim | Why Excluded | File | Line | Evidence Quality | Evidence Method | Evidence Summary | Command | Exit Code | Excerpt |
|-------|--------------|------|------|------------------|-----------------|------------------|---------|-----------|---------|
<!-- One row per `kill as false positive`; write `None` when there are no rows. Use `—` for nullable or optional fields. -->

## Verification Integrity
<!-- Preserve A4 evidence limits; name test executors. -->
```
