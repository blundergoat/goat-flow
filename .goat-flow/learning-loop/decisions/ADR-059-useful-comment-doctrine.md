# ADR-059: Prefer useful comment contracts over syntax quotas

**Status:** Accepted
**Date:** 2026-08-14

## Context

The earlier comment hardening adopted a 150-character maximum while also telling agents to use the
available width. It preserved mandatory comments on every method and broad branch coverage. Evidence:
`.goat-flow/plans/1.16.0/M00-comment-verification-playbook-hardening.md` (search: `Items 1-3`).

The later review-cost packet found that width, branch, and unit-presence rules could reward long prose,
hide weak names, and narrate ordinary control flow. Its portable finding is that comment volume measures
review cost, not quality; consumer vocabulary and incident details are not doctrine. Evidence:
`.goat-flow/plans/1.16.0/_reference/code-quality/M06-calibrate-comments-for-cold-readers.md`
(search: `## Current-state evidence`).

The upstream milestone converts those observations into six explicit supersessions while preserving
the unrelated verification contracts. Evidence:
`.goat-flow/plans/1.16.0/code-quality-upstream/M01-recalibrate-comment-doctrine.md`
(search: `## Doctrine decisions`).

## Decision

Adopt these six comment-doctrine rules:

| ID | Decision |
|---|---|
| D1 | Treat 150 characters as a hard ceiling. The shortest complete useful comment wins; one point is not fragmented merely to stay short. |
| D2 | Give a reader-meaningful branch one local sentence naming trigger plus consequence. A branch whose only honest comment restates code gets none. Naming or structural remedies require existing authority and are otherwise reported or deferred. |
| D3 | Select the interface reader first: product user, caller, or operator. Apply a separate layer lens for domain/service invariants, repository/query result-set contracts, and infrastructure consequences and mechanisms. |
| D4 | Diagnose rewrites with `STALE`, `FALSE`, `RESTATES`, `TERM`, `METAPHOR`, `HISTORY`, `REMOTE`, `VERBOSE`, or `MISSING-CONSEQUENCE`. Record one primary code and optional secondary codes in a ledger or report, never in source comments. |
| D5 | Reject compensating prose that explains what a better name, type, or structure would show. The comment pass grants no structural authority. |
| D6 | Require doc comments where project or language canon requires them, for public/exported APIs, and for file/module/class boundaries with a non-obvious contract. Self-explanatory private/local units need none. |

This narrows the width/fullness, blanket branch, and blanket unit-presence decisions recorded by M00.
It preserves the 150-character maximum, anti-fragmentation rule, `@param` and `@returns` consequence
contracts, evidenced catch comments, journey anchors at flow entry points and non-obvious triggers,
verified rationale, and the existing discretionary-inline-comment contract.

Detailed naming ownership remains deferred to code-quality-upstream M02. Project-precedence semantics
remain deferred to M05. ADR-023's progressive-reference budget remains `<3000` words; M01's lower
2,900-word target reserves room for those later owners rather than changing the durable budget.

## Failure Mode Comparison

| Option | What fails | Decision |
|---|---|---|
| Retain syntax and fullness quotas | Agents can satisfy visible shape while adding restatements or hiding naming defects. | Rejected |
| Remove comment requirements broadly | Public contracts, null consequences, traceable catches, and hidden rationale lose protection. | Rejected |
| Require a verified useful contract and preserve targeted mandates | Comments carry non-obvious information without quota-filling prose. | Accepted |

## Consequences

- Contract tests reject active fullness wording and blanket branch or private-unit quotas.
- Reader selection and code-layer interpretation are independent decisions.
- Rewrite reports distinguish a primary defect from overlapping secondary observations.
- Gruff documentation findings are candidates that must pass the same usefulness gate; analyzer presence
  alone does not require a comment.
- Existing compliant comments remain unchanged unless a diagnosed defect justifies a rewrite.

## Reversibility

This is a two-way decision. Revert the doctrine, contract, and sibling-triage changes together if
measured review evidence shows the useful-contract gate omits required public, safety, or operational
information that project or language canon cannot express. Do not restore a syntax quota merely because
an analyzer reports fewer comments; require evidence about missing reader information.
