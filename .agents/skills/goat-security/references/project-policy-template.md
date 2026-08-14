---
goat-flow-reference-version: "1.15.1"
---
# Project Security Policy Template

Setup template for goat-security policy overrides. This file is not a scan reference; load it only when creating or revising a project policy file.

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
