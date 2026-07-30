---
goat-flow-reference-version: "1.14.0"
---
# goat-qa Output Templates

Read this reference only when rendering the final response. Select the template matching the mode and gate reached; do not combine templates from different phases.

### Regression Guard mode

```markdown
## Regression Guards
| Invariant | Current Coverage | Recommended Guard | Owner | Proof Class |

## Verification Integrity
- Prior fix evidence: [file, command output, or human-approved record]
- Code and tests read: [list]
- Coverage claim basis: [OBSERVED | INFERRED | UNVERIFIED]
- Proof classes: <N> RUNTIME / <M> CONTRACT-GREP / <K> STATIC / <L> NOT-REPRODUCED
- Evidence limit: [unavailable source, runtime, or tool context]
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

## Verification Integrity
- Intent spec: [PR/issue/test plan URL or `no-intent-spec`]
- Tests read: [list]
- Tests not read / unavailable: [list or `none`]
- Commands discovered: [test/lint commands found]
- Commands run: `none` (goat-qa does not execute tests)
- Runtime execution by others: [who ran what, or `none observed`]
- Coverage claim basis: [OBSERVED | INFERRED | UNVERIFIED]
- Proof classes: <N> RUNTIME / <M> CONTRACT-GREP / <K> STATIC / <L> NOT-REPRODUCED
- Analysis confidence: [HIGH | MEDIUM | LOW] - [rationale]
- Evidence limit: [diff/files read and any unavailable runtime/tool context]
- Assessed by: [agent]
```

### Standard mode - Phase 3 output (generate only after Phase 2 gate approval)

```markdown
## Targeted Testing Plan
### Must test before shipping  <!-- Matrix Blocking pairs; include manual steps, failure symptoms, time, proof class -->
### Should test if time allows  <!-- Matrix High-value pairs; include proof class -->
### Safe to skip  <!-- Matrix Defer pairs; include rationale and proof class -->

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

## Verification Integrity
- Intent spec: [audit scope rationale or `no-intent-spec`]
- Tests read: [list]
- Tests not read / unavailable: [list or `none`]
- Commands discovered: [test/lint commands found]
- Commands run: `none` (goat-qa does not execute tests)
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

## Verification Integrity
<!-- Preserve A4 evidence limits; name test executors. -->
```
