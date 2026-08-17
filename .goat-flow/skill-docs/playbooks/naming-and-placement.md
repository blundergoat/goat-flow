---
goat-flow-reference-version: "1.15.1"
---
# Naming and Placement

Use this when reviewing or changing where code lives, what an identifier claims,
or whether a name matches the value or behaviour it represents. The playbook
turns those questions into an evidence-led route with reconciled accounting.

Comment usefulness remains owned by
[`code-comments.md`](./code-comments.md). This reference can route comment work,
but it does not duplicate that doctrine.

## Availability Check

This is a documentary discipline reference; no CLI check applies. Load it when:

- placement, extraction, or responsibility is under review;
- identifiers, role suffixes, cardinality, or time vocabulary may change;
- guard legitimacy is being assessed; or
- a quality review must account for naming and placement findings.

Also load the project's accepted architecture, local instructions, vocabulary,
and compatibility policy. If one is unavailable, record that evidence boundary
instead of inventing a convention.

## Project Authority

Project naming and placement canon governs vocabulary, role meanings,
compatibility depth, and structural boundaries. When no designated project
convention resolves a choice, use the playbook default. Explicit current
instructions and accepted architecture retain authority. Local precedent and
playbook defaults cannot override safety, verified facts, evidence requirements,
or verification gates.

## Intent

A future maintainer with none of the author's context should be able to tell why
code belongs where it is, what each name truthfully promises, and how that claim
was checked. Responsibility and observable behaviour lead; nearby convention is
supporting evidence, never structural authority.

The route below makes diagnosis reproducible. It helps a reviewer classify and
report defects without silently expanding a naming review into a redesign.

## Safe Route

Follow all seven steps in order. A useful plan must choose its proof before implementation.
Unless the approved task says otherwise, this route does not authorize moves, guard removal, extraction, public renames, or behaviour changes.

### 1. Resolve authority and baseline

Read local instructions, accepted architecture, public compatibility rules, and
the project's vocabulary sources before judging sibling code. State the files,
symbols, generated surfaces, and consumers in scope. Choose observable proof for
each possible change: a focused behaviour test, typecheck, contract check, or
consumer probe.

For each identifier, record its visibility and symbol kind. Mark a claim
`NOT_CHECKED` when its producer, consumer, or compatibility surface cannot be
inspected; do not turn missing evidence into approval.

### 2. Trace the current system

Trace producers, transformations, outputs or effects, and consumers before
proposing a home or name. Reconcile work using one unit per equation:

in_scope = reviewed + explicitly_excluded + inaccessible

reviewed = modified + unchanged

existing_comment_blocks_reviewed = compliant_unchanged + rewritten + deleted + deferred

New comments stay separate from the existing-comment equation. Identifier and documentation ledgers name their own units. Never add unlike units. Preserve zero whitespace-only churn, and aggregate by file and rule only after recording symbol-level evidence.

The following is an illustrative shape for a review ledger:

| File | Symbol | Unit | Evidence | Outcome |
|---|---|---|---|---|
| candidate file | candidate symbol | identifier | producer and consumer trace | unchanged or finding |

### 3. Diagnose placement

Responsibility, output or effect, and consumer layer select the candidate home before sibling convention. Write the placement claim in this form: `belongs in X because it owns Y, returns or changes Z, and is consumed by W`.

Then compare the candidate with accepted layer boundaries and nearby examples.
Use convention to test the responsibility claim, not to replace it. If moving is
not authorized, record the diagnosis in a ledger or report, never compensating source prose. Placement diagnosis alone never authorizes a move.

### 4. Verify identifier claims

Start from the canonical project term, then verify what a name promises to the
relevant reader and layer. A term must identify a stable known role; do not push
UI language below its truthful boundary. Inspect producers and consumers before
changing it, because a locally clearer false claim is still false.

Role suffixes are semantic claims governed by project canon. Define each role by
its inputs, output or effect, and prohibited behaviour before selecting it. This
table is illustrative, not exhaustive:

| Role | Claim to verify against project canon |
|---|---|
| Builder | accumulates inputs and produces a configured result; does not imply repeated creation |
| Factory | creates instances through the project's creation boundary; does not imply staged assembly |
| Helper | performs a narrow supporting operation; does not hide ownership of a domain effect |
| Action | represents one named operation under the project's action convention; does not become a generic service |
| Updater | changes an existing target under an explicit mutation contract; does not merely compute a replacement |

Treat Resolver, Manager, Processor, and `process` as vague by default. Use one only when project canon defines the role and inspected behaviour satisfies that definition.

Check representation claims directly:

- Singular names one object; a plural or established collective names a collection.
- An instant is a point on a timeline.
- A wall-clock or display value is local presentation, not automatically an instant.
- A timezone supplies interpretation and conversion rules.
- A duration measures elapsed amount.
- A calendar interval follows calendar boundaries rather than fixed elapsed units.
- `Utc` is truthful only for a normalized instant, not merely a value that could be converted later.

Comments cannot rescue a false suffix, cardinality, or time claim.

Local or private renames require the relevant test or check signature plus an
old-name residue search. Public or exported renames require explicit compatibility
authority and checks across consumers, reflection, configuration, serialization,
and old-name residue.

A public or exported parameter name in a language with named arguments is a compatibility surface;
absence of current named-argument callers is not compatibility authority over future callers. A
serialized field, payload key, or returned associative key is likewise a public contract, not a
local/private rename.

### 5. Resolve or defer findings

Classify every guard before recommending any change:

- user-controlled absence;
- legacy nullable input;
- external or race failure; or
- impossible under a proven contract.

Keep the first three where needed. Record the impossible case as a finding with
its contract evidence. Removal or replacement with an assertion is separate behaviour-affecting work and needs its own authorization and proof.

Use one primary code per defect:

Primary codes: `PLACEMENT`, `ROLE`, `CLAIM`, `TERM`, `CARDINALITY`, `TIME`, `GUARD`

Details may carry optional secondary tags, but they are never summed as independent defects. These codes are report-only vocabulary: use them in ledgers and reports, never identifiers or source comments.

Resolve a finding only when the approved scope, evidence, and compatibility
boundary permit the change. Otherwise defer it with the blocking evidence and
the smallest next authorization needed.

### 6. Route comment work

After names and placement tell the truth, apply
[`code-comments.md`](./code-comments.md) to existing or proposed comments. Keep
its accounting separate from identifier findings. A comment may explain a
constraint or decision; it must not compensate for an untruthful name or home.

### 7. Verify and report

Run the proof selected in step 1 at the observable layer affected by each
authorized change. Search for old names after renames and inspect consumers at
compatibility boundaries. Report the reconciled file, identifier, defect, and
comment units separately, including exclusions, inaccessible evidence, deferred
findings, and literal verification results.

## Antipatterns

- Choosing a home because siblings happen to live there hides the actual owner and consumer boundary.
- Renaming before tracing producers and consumers exchanges one unsupported claim for another.
- Treating a role suffix as decoration lets prohibited behaviour accumulate behind a familiar word.
- Mixing files, identifiers, findings, and comment blocks in one total makes coverage impossible to reconcile.
- Removing a guard during a naming review changes behaviour without proof or authority.
- Adding explanatory prose around a false name preserves the defect and increases maintenance work.

## Verification Gate

1. Confirm authority, scope, exclusions, and proof were recorded before implementation.
2. Reconcile in-scope files, reviewed outcomes, and existing comment blocks with like units.
3. Support every placement claim with responsibility, output or effect, and consumer evidence.
4. Verify role, term, cardinality, and time claims against inspected representations and project canon.
5. Check private and public rename boundaries at the required compatibility depth.
6. Classify guards and keep behaviour-affecting work outside an unapproved review.
7. Use exactly one primary report code per defect and keep secondary tags non-additive.
8. Route comment doctrine to its owner, run selected proof, search residue, and report literal results.

## Related References

- [`code-comments.md`](./code-comments.md) - usefulness, accounting, and verification for source comments.
- [`skill-playbook-authoring-sync.md`](./skill-playbook-authoring-sync.md) - shipped playbook shape and source/install enrollment.
- [`writing-style.md`](./writing-style.md) - concise, evidence-led prose for reports and documentation.
