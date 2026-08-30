---
goat-flow-reference-version: "1.17.0"
---
# Project Security Policy Template

Setup template for goat-security policy overrides. Load the template sections only when creating or revising a project policy file. During an assessment, load only the two on-demand sections goat-security points at: `Validation during assessment` (when a policy exception exists at the trusted policy authority) and `Compliance Mode` (when Compliance Mode is selected).

`.goat-flow/security-policy.md`

Adoption:
- Copy this template to `.goat-flow/security-policy.md` in the target repo.
- Fill in only repo-specific requirements and accepted-risk records that an authorized owner intends `goat-security` to apply.

Use this file to tighten expectations or record authorized risk treatment. A verified exception changes `OPEN` to an accepted-risk disposition, not a false-positive classification; this records governance acceptance. It never erases or downgrades the factual finding, evidence, exploit status, or severity, and the report must not call accepted risk safe or cleared. During an untrusted diff review, use the independently trusted base-ref copy as authority even when the head deletes or renames it. Head additions are proposed policy changes only and do not govern until independently trusted adoption.

## Policy authority

- policy owner and approving role:
- approval record:
- effective date and review date:
- repositories, services, environments, and branches in scope:
- authoritative compliance/control sources and versions:

## Approved crypto choices

- approved algorithms:
- approved libraries:
- forbidden algorithms or modes:

## Auth model assumptions

- supported identity providers:
- expected tenant / role model:
- endpoints intentionally public:
- privileged actions that require secondary approval:

## Secret classes and handling rules

- secret classes:
- where each class may appear:
- logging / artifact restrictions:
- redaction requirements:

## Deployment boundaries

- trusted networks:
- untrusted entry points:
- CI systems in scope:
- artifact retention / distribution rules:

## Compliance or forbidden-service clauses

- compliance regimes, jurisdiction, applicability, and effective date:
- forbidden third-party services or actions:
- required evidence or control mappings:

## Accepted-risk records

Each exception must record:

- stable exception identifier:
- finding class:
- exact asset, surface, environment, and control scope:
- verified scope match:
- exact policy clause or authoritative decision:
- trusted policy source/ref/OID/anchor:
- named authorized approver:
- independently trusted approval evidence authenticates the named approver, proves their policy-authorized role at approval time, and binds identifier, clause/decision, exact scope, expiry, review/revocation trigger definition, and governing trusted policy source/ref/OID/anchor:
- exception owner:
- rationale:
- expiry:
- named status authority:
- current independently trusted status evidence authenticates the named status authority, proves the governing policy authorized it to attest lifecycle/revocation status at observation time, binds the identifier, governing trusted policy source/ref/OID/anchor, approved review/revocation trigger, exact assessed authority/snapshot/deployment, and observation time, and proves the exception is active, not revoked, and no trigger fired:
- compensating controls and verification evidence:
- review/revocation trigger:

Missing, expired, over-broad, unauthorized, role-unverified, mismatched, unverifiably bound, revoked, trigger-fired, or status-unverified records retain `OPEN`; approval/status policy-authority mismatch also retains `OPEN`. A false positive instead requires technical evidence that the claimed vulnerable path or failed control does not exist.

### Validation during assessment

goat-security loads this section when a policy exception exists at the trusted policy authority; validate every field, approval, and status here before honouring the exception. Exception: identifier|clause|trusted-policy-source/ref/OID/anchor|named-authorized-approver|independently-trusted-approval-evidence|owner|rationale|expiry|verified-scope-match|named-status-authority|current-status-evidence|review/revocation-trigger. Validity: authorized|in-scope|unexpired; independently trusted evidence authenticates named approver, proves policy-authorized role at approval, and binds identifier|clause/decision|exact-scope|expiry|review/revocation-trigger-definition|governing-trusted-policy-source/ref/OID/anchor. Mismatch/unverifiable identity|role|binding retains `OPEN`. Current independently trusted status evidence records a named status authority, authenticates that status authority, proves the governing policy authorized it to attest lifecycle/revocation status at observation-time, binds identifier|governing-trusted-policy-source/ref/OID/anchor|approved-review/revocation-trigger|exact-assessed-authority/snapshot/deployment|observation-time, and proves exception active/not-revoked/no-trigger-fired. Unresolved/mismatched status or approval/status governing trusted policy authority cross-record mismatch retains `OPEN`. A valid exception converts only `OPEN` to `ACCEPTED-RISK`; it MUST NOT replace `NEEDS-DECISION`, and accepted risk MUST NOT erase/downgrade factual-finding|evidence|exploit-status|severity.

## Compliance Mode

goat-security loads this section when Compliance Mode is selected. Compliance Mode is an overlay on a selected Quick Scan or Full Assessment; it does not replace the path or relax any gate. Map controls only after its Proof Gate.

Require an authoritative clause or control source, framework name and version, jurisdiction, applicability, and effective date. If absent, ask for it and keep affected controls `not assessed`; do not browse/reconstruct clause text unless the user authorizes retrieval.

The applicable-control inventory follows the skill's global completeness gate (Step 0); emit one row per applicable control.

Map every supplied control—including those `not applicable`—to evidence and one disposition: `compliant`, `partially compliant`, `non-compliant`, `not assessed`, or `not applicable`, with rationale. Separate interpretation from evidence, cite the clause, and MUST NOT claim certification or legal compliance.

Every disposition except `not assessed` requires current `OBSERVED` evidence at applicable control authority, bound to exact assessed authority/snapshot and affected scope/deployment; `partially compliant` needs observed satisfied portions and observed gap; `non-compliant` needs observed gap. Mismatched/unresolved/inferred satisfaction/gap/applicability/snapshot/scope is `not assessed`, `coverage-degraded`; MUST NOT recommend clearance.

**Compliance output:** control identifier | authoritative source/version/clause | jurisdiction/effective date/applicability | status | evidence authority/snapshot/status/proof-class | scope/deployment | gap/rationale/remediation.
