# ADR-059: Prefer useful comment contracts over syntax quotas

**Status:** Accepted
**Date:** 2026-08-14
**Updated:** 2026-09-05 - evidence now cites the committed contract test and playbook instead of local milestone files that no longer exist; deferred-owner milestone references are removed.

## Context

An earlier comment-hardening pass adopted a 150-character maximum while telling agents to use the available width, and kept mandatory comments on every method with broad branch coverage. A later review-cost analysis found that width, branch, and unit-presence rules reward long prose, hide weak names, and narrate ordinary control flow. Comment volume measures review cost, not quality. The originating milestone files were local working state and are no longer available; the committed enforcement is `test/contract/comment-playbook-doctrine.test.ts` (search: `removes syntax quotas without weakening consequential branches`) over `.goat-flow/skill-docs/playbooks/code-comments.md`.

## Decision

Comments are required by usefulness contracts, not by syntax quotas.

| ID | Rule |
| --- | --- |
| D1 | 150 characters is a hard ceiling. The shortest complete useful comment wins; one point is not fragmented merely to stay short. |
| D2 | A reader-meaningful branch gets one local sentence naming trigger plus consequence. A branch whose only honest comment restates code gets none. Naming or structural remedies need existing authority and are otherwise reported or deferred. |
| D3 | Select the interface reader first: product user, caller, or operator. Apply a separate layer lens for domain/service invariants, repository/query result-set contracts, and infrastructure consequences and mechanisms. |
| D4 | Diagnose rewrites with `STALE`, `FALSE`, `RESTATES`, `TERM`, `METAPHOR`, `HISTORY`, `REMOTE`, `VERBOSE`, or `MISSING-CONSEQUENCE`. Record one primary code and optional secondary codes in a ledger or report, never in source comments. |
| D5 | Reject compensating prose that explains what a better name, type, or structure would show. The comment pass grants no structural authority. |
| D6 | Require doc comments where project or language canon requires them, for public and exported APIs, and for file, module, or class boundaries with a non-obvious contract. Self-explanatory private and local units need none. |

This narrows the earlier width-and-fullness, blanket-branch, and blanket-unit rules. It preserves the 150-character maximum, the anti-fragmentation rule, `@param` and `@returns` consequence contracts, evidenced catch comments, journey anchors at flow entry points and non-obvious triggers, verified rationale, and the discretionary inline-comment contract. Detailed naming ownership and project-precedence semantics are not decided here. ADR-023's progressive-reference budget stays `<3000` words.

## Failure Mode Comparison

| Option | What fails | Verdict |
| --- | --- | --- |
| Retain syntax and fullness quotas | Agents satisfy the visible shape with restatements and hidden naming defects | Rejected |
| Remove comment requirements broadly | Public contracts, null consequences, traceable catches, and hidden rationale lose protection | Rejected |
| Verified useful contract plus targeted mandates | Comments carry non-obvious information without quota-filling prose | Accepted |

## Consequences

- Contract tests reject active fullness wording and blanket branch or private-unit quotas.
- Reader selection and code-layer interpretation are independent decisions; rewrite reports separate a primary defect from secondary observations.
- Gruff documentation findings are candidates that must pass the same usefulness gate; analyzer presence alone does not require a comment. Compliant comments stay unchanged unless a diagnosed defect justifies a rewrite.

## Reversibility

Two-way: revert doctrine, contract, and sibling-triage changes together if measured review evidence shows the gate omits required public, safety, or operational information. Do not restore a syntax quota because an analyzer reports fewer comments; require evidence about missing reader information.
