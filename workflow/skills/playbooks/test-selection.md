---
goat-flow-reference-version: "1.16.0"
---
# Test Selection

Use this before creating, changing, reviewing, consolidating, moving, or pruning tests. Select tests from the behaviour and risk they protect, not from filenames, coverage percentage, suite size, or a wish to exercise every branch. This workflow is usable during ordinary implementation without invoking `goat-qa`; goat-qa applies the same owner when it reports coverage gaps.

## Availability Check

This is a documentary decision workflow and needs no dedicated binary. Confirm the installed copy exists, then read the production path, its callers or consumers, and relevant test assertions. A filename, suite label, or coverage report may locate candidates but cannot prove what they protect. If code, tests, or runtime evidence needed for a decision is unavailable, use `UNRESOLVED` and name the next check rather than filling the gap with inference.

Test selection does not replace repository-mandated lint, typecheck, build, security, or full-suite gates. A focused choice may add evidence; it never waives a required gate.

## Project Authority

Project testing policy controls suite ownership, required gates, test levels, and supported test forms. When no designated project standard answers a selection question, use this playbook's generic default. Explicit current instructions and the authoritative project hierarchy stay higher. Safety, accepted architecture, verified facts, evidence requirements, and verification gates are never superseded by project convention or playbook defaults.

## Intent

Choose the smallest trustworthy set of checks that protects real behaviour at proportionate maintenance cost. Keep four units distinct:

1. tests to inspect while establishing current coverage;
2. tests or manual checks to recommend;
3. checks an implementing agent is authorized to execute; and
4. mandatory repository gates that remain required regardless of focused selection.

This playbook supplies a decision and handoff. It grants no authority to add, rewrite, move, consolidate, or delete a test.

## Decision Route

### 1. Establish behaviour, risk, and overlap

Start from the changed or assessed behaviour. Trace the production path, callers, consumers, failure effects, and current assertions. Record the risk if the behaviour regresses and who or what experiences the impact. Search broadly enough to find coverage at other levels; then read assertions instead of inferring depth from paths or names.

Separate coverage discovery from disposition. Existing coverage can protect the behaviour while still being costly, misplaced, or duplicated. Conversely, an uncovered branch does not earn a new test until the value gate passes.

#### Selector-driven non-semantic lane

Use this lane only for an explicit folder or file selector when baseline, current bytes, and explicit request prove every change is limited to comments or docstrings, or local or private identifier spelling. Preserve all of:

- test case presence, stable identity, title, registration, and parametrized membership;
- assertions, expectations, snapshots, and failure semantics;
- fixture values, setup and teardown, mocks, stubs, fakes, data builders, and environment controls; and
- grouping, execution level, skip or focus state, coverage intent, observable output, and user-visible meaning.

A change to any preserved item is semantic and forces the full lane.

If an existing PR or uncommitted diff contains a semantic test change, or equivalence is uncertain, run the full case-level manifest and four-part value gate. Otherwise freeze selected test-source units, selected spans, baseline and current identity, write set, and focused verification command. Reconcile every changed span and prove untouched bytes remain untouched. This lane waives only per-case value and disposition rows.

### 2. Apply the four-part value gate

Every proposed or retained test must answer all four questions:

| Gate | Required evidence |
|------|-------------------|
| Plausible regression | What realistic code or dependency change could break the behaviour? |
| User or business impact | What incorrect outcome, lost protection, or operational consequence would follow? |
| Current overlap | What other coverage protects the same invariant, and why other coverage is insufficient? |
| Stable contract | Which observable stable behaviour is asserted rather than an implementation detail? |

Generic or circular answers fail. “It tests the function” is not a regression story, and “more coverage” is not impact. Current overlap may be `none observed` after a bounded search: sole valuable coverage can earn `KEEP` without claiming it overlaps itself.

A candidate that fails the gate is not recommended. Incomplete evidence is not failure evidence; classify it `UNRESOLVED` and name the missing read, runtime result, or authority.

### 3. Choose the cheapest trustworthy level

Use the lowest-cost level that proves the real contract without recreating the relevant boundary in test doubles:

| Level | Owns |
|-------|------|
| **Static analysis** | Facts completely provable by types, lint, compilation, schema validation, or another deterministic static rule. |
| **Unit** | Focused deterministic behaviour whose real contract is inside one isolated unit. |
| **Integration** | Cooperation with real persistence, framework, repository, service, serialization, or process boundaries. |
| **End-to-end or manual** | A user or operator workflow when the workflow itself is the contract or lower levels cannot establish it truthfully. |

Choose from evidence, not prestige. A rejected unit test is not automatically promoted to integration, end-to-end, or manual work; the candidate at another level must independently pass the value gate. A required repository gate remains required even when it is broader than the focused choice.

### 4. Assign a disposition

Creation dispositions: `ADD UNIT`, `ADD INTEGRATION`, `ADD END-TO-END/MANUAL`, `SKIP`, `UNRESOLVED`

Existing-test dispositions: `KEEP`, `CONSOLIDATE`, `MOVE LEVEL`, `PRUNE CANDIDATE`, `UNRESOLVED`

Added-test dispositions: `ADDED KEEP`, `ADDED CONSOLIDATE`, `ADDED MOVE LEVEL`, `ADDED DROP CANDIDATE`, `ADDED UNRESOLVED`

Removed-test dispositions: `REMOVAL SUPPORTED`, `RESTORE`, `REPLACE`, `REMOVAL UNRESOLVED`

Relocated-test state: `RELOCATED`

For PR or uncommitted work, cases absent from the base use added-test dispositions, cases absent from
the selected current snapshot use removed-test dispositions, and materially changed cases present in
both use existing-test dispositions. A relocation mapping requires case-level anchor and assertion
equivalence after ignoring only a demonstrated path or namespace rename; file similarity alone is a
lead, not proof. Proven carryover uses `RELOCATED`. These states are mutually exclusive. Folder and
file reviews use existing-test dispositions for every selected case. Read removed-test evidence from
the bound comparison baseline without fetching or materializing it into the worktree. A rename-shaped
pair with uncertain identity receives one `ADDED UNRESOLVED` row and one `REMOVAL UNRESOLVED` row;
never collapse or double-count either path.

| Disposition | Use when |
|-------------|----------|
| `ADD UNIT` | A new focused deterministic check passes the gate at unit level. |
| `ADD INTEGRATION` | A real cooperation boundary is necessary to prove the stable contract. |
| `ADD END-TO-END/MANUAL` | The actual user or operator workflow is the cheapest trustworthy proof. |
| `SKIP` | Sufficient current protection or a static owner makes a new test unnecessary. |
| `KEEP` | The existing test protects a distinct valuable invariant, including sole valuable coverage. |
| `CONSOLIDATE` | Replacement coverage can preserve the same invariants with less duplication. |
| `MOVE LEVEL` | The invariant is valuable but the current level cannot prove its real boundary. |
| `PRUNE CANDIDATE` | Current evidence proves the behaviour no longer needs protection and no replacement is required. |
| `ADDED KEEP` | The added case protects a distinct valuable invariant at a trustworthy level. |
| `ADDED CONSOLIDATE` | The invariant is valuable, but replacement-backed consolidation can remove duplication. |
| `ADDED MOVE LEVEL` | The invariant is valuable, but another level must pass before the added case is omitted. |
| `ADDED DROP CANDIDATE` | Complete evidence shows the added case protects no distinct valuable invariant. |
| `ADDED UNRESOLVED` | Evidence needed to judge the added case is unavailable. |
| `REMOVAL SUPPORTED` | Retained coverage protects the invariant, or current evidence proves it no longer needs protection. |
| `RESTORE` | The removed case protected a valuable invariant that retained coverage does not protect. |
| `REPLACE` | The removed invariant remains valuable; the removal remains unsupported until replacement coverage at another owner or level passes. |
| `REMOVAL UNRESOLVED` | Evidence needed to judge the removed case is unavailable. |
| `RELOCATED` | The same case and assertions moved under a proven path or namespace-only mapping. |
| `UNRESOLVED` | A required production, coverage, compatibility, or runtime fact is missing. |

Failing the creation gate blocks a new recommendation; it never authorizes deletion of an existing test. Unresolved evidence keeps an existing test in place and records the next evidence needed.

### 5. Revalidate before mutation

Selection evidence can drift. Ordinary ACT re-reads current production code, the candidate test, adjacent coverage, and the handoff invariant immediately before any approved mutation. Human approval selects work but does not replace coverage evidence.

`CONSOLIDATE` and `MOVE LEVEL` keep the original until replacement coverage proves the same invariant and passes at the chosen level. `PRUNE CANDIDATE` records why no replacement is required. All dispositions from goat-qa remain report-only; an implementing agent or human owns any separately authorized change and its verification.

Every disposition is report-only and never authorizes an agent to add, rewrite, restore, replace,
move, consolidate, omit, or delete a test.

## Mock Boundary

Mocks may isolate a boundary irrelevant to the contract. Collaborator call counts, call order, and non-calls are `STRUCTURAL` unless that interaction is itself a named public protocol. A mock graph that simulates real component cooperation is also `STRUCTURAL` and earns no integration confidence. Require the real boundary for an integration claim; do not promote structural choreography by renaming its suite.

## Consolidation Before Multiplication

Prefer one worked invariant, a small table of materially different boundaries, or an extension to an existing test over repeated setup for nearby permutations. Every retained scenario needs a distinct regression story. Data providers and parameterization can reduce repetition but cannot hide scenario volume.

Consolidation is replacement-backed, not immediate deletion. Name the invariants the replacement must preserve and keep the originals until that proof passes.

## Deletion Safeguards

Read the production path and relevant tests before assigning any existing-test, added-test, or removed-test disposition. Preserve real authorization, tenancy, financial, clinical, date/time, persisted-data, external-contract, reproduced-regression, and other high-impact invariants. These labels prompt evidence; they are neither automatic exemptions nor automatic deletions.

Age, mock use, suite size, a high test-to-change ratio, or failed admission for a new test cannot independently justify pruning. A superficial deletion request remains rejected unless current evidence satisfies `CONSOLIDATE`, `MOVE LEVEL`, or `PRUNE CANDIDATE` and the actor boundary is honored.

## Volume and Maintenance

Volume is diagnostic only. A large method count, scenario count, or test-to-change ratio triggers a second value pass and consolidation review; no numeric quota grants or removes permission. Low volume likewise does not prove that important behaviour is covered.

Maintenance is part of value. Prefer stable inputs and observable outcomes. Reject a recommendation whose likely upkeep comes mainly from refactors that preserve behaviour. Do not add production seams, test-only abstractions, follow-up tickets, or developer justification forms solely to rescue a weak test.

## Decision Record and Handoff

Record one row per assessed existing, added, removed, relocated, materially changed, or proposed test. Use a repository-relative path plus a semantic anchor for an assessed test; use the intended owning surface for a proposal.

| Disposition | Regression and impact | Current overlap | Stable contract | Chosen level | Evidence status | Owning surface | Semantic anchor | Handoff invariant and next check |
|-------------|-----------------------|-----------------|-----------------|--------------|-----------------|----------------|-----------------|----------------------------------|
| `<disposition>` | `<regression; impact>` | `<coverage; insufficiency or sufficient owner>` | `<observable outcome>` | `<static; unit; integration; end-to-end/manual>` | `<OBSERVED; INFERRED; UNVERIFIED; HUMAN-PENDING>` | `<path or proposed owner>` | `<searchable anchor or n/a>` | `<protected invariant; immediate revalidation>` |

Incomplete evidence uses the matching `UNRESOLVED`, `ADDED UNRESOLVED`, or `REMOVAL UNRESOLVED` with the reason and next check; never omit the row silently. For folder and file work, reconcile existing-test totals with this equation:

assessed_existing = KEEP + CONSOLIDATE + MOVE LEVEL + PRUNE CANDIDATE + UNRESOLVED

For PR and uncommitted change-state accounting, reconcile these mutually exclusive totals too:

```text
assessed_added = ADDED_KEEP + ADDED_CONSOLIDATE + ADDED_MOVE_LEVEL + ADDED_DROP_CANDIDATE + ADDED_UNRESOLVED
assessed_removed = REMOVAL_SUPPORTED + RESTORE + REPLACE + REMOVAL_UNRESOLVED
assessed_materially_changed = KEEP + CONSOLIDATE + MOVE_LEVEL + PRUNE_CANDIDATE + UNRESOLVED
assessed_relocated = RELOCATED
assessed_pr_or_uncommitted = assessed_added + assessed_removed + assessed_materially_changed + assessed_relocated
```

Equation identifiers write each disposition with underscores.

Do not add unlike units to that total. Content hashes and persistent approval receipts are conditional on long-lived, content-specific approval or an applicable repository boundary; they are not universal paperwork.

## Antipatterns

- Test every branch or guard because it exists.
- Treat a file match, suite label, or coverage percentage as behavioural proof.
- Preserve a weak proposal by moving it to a more expensive level.
- Count mock choreography as integration confidence.
- Recommend deletion because a test is old, numerous, slow to read, or structurally heavy.
- Turn `UNRESOLVED` into silent omission or speculative confidence.
- Create production structure or process artifacts solely to justify a test.
- Let a focused selection waive mandatory repository verification.

## Verification Gate

Before handing off a selection:

1. Every candidate has all four value-gate answers or uses its matching unresolved disposition.
2. Creation, existing-test, added-test, removed-test, and relocated-test states use the correct vocabulary.
3. The chosen level proves the real contract at the lowest trustworthy cost.
4. Structural mock assertions receive no behavioural or integration credit without a public-protocol basis.
5. Consolidation or movement names replacement invariants and preserves originals until proof passes.
6. A prune candidate explains why no replacement is required and identifies the production and coverage evidence read.
7. Disposition totals reconcile for the applicable selector and change states, and every material-change handoff names the invariant and immediate next check.
8. Required repository gates remain visible and the ordinary actor revalidation boundary is explicit.

## Related References

- `.goat-flow/skill-docs/skill-quality-testing/README.md` and `.goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md` - capability-aware fixtures and application-not-citation scoring when testing a skill.
- `.goat-flow/skill-docs/skill-preamble.md` - shared proof classes, evidence discipline, and actor boundaries.
- `.agents/skills/goat-qa/SKILL.md` - report-only coverage analysis that applies this playbook before emitting recommendations.
