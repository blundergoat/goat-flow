---
goat-flow-reference-version: "1.13.0"
---
# Project Security Policy Template

Setup template for goat-security policy overrides. This file is not a scan reference; load it only when creating or revising a project policy file.

`.goat-flow/security-policy.md`

Adoption:
- Copy this template to `.goat-flow/security-policy.md` in the target repo.
- Fill in only repo-specific clauses or suppressions that you intend `goat-security` to treat as policy.

Use this file only to tighten expectations or suppress false positives with explicit clause text. It must not erase an observed exploit path without citing the clause that proves the path is intentionally safe.

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

- compliance regimes:
- forbidden third-party services or actions:
- approved exceptions:

## Suppression rules

Each suppression must cite:

- finding class:
- exact clause text:
- why the clause applies to this surface:
- proof that the observed path is still safe:
