---
category: index
bucket: decisions
last_reviewed: 2026-06-05
generated: false
---

# Decisions Index

Hand-maintained index of Architectural Decision Records. Each line links to the ADR and records its current status and date. When you add, supersede, or amend an ADR, update this file in the same change (ADR numbers are referenced across docs — see the "ADR renumbering breaks cross-references" footgun). Authoring rules and required structure live in [README.md](README.md).

- [ADR-001: Remove confusion-log.md from the workflow](ADR-001-remove-confusion-log.md) — Accepted, 2026-03-21
- [ADR-002: Replace goat-preflight skill with goat-security](ADR-002-replace-preflight-with-security-skill.md) — Accepted, 2026-03-22
- [ADR-003: Replace inline setup skeletons with reference-based prompts](ADR-003-reference-based-setup-prompts.md) — Accepted, 2026-03-28
- [ADR-004: Config file and directory-based learning loop](ADR-004-config-file-and-directory-learning-loop.md) — Accepted, 2026-03-31
- [ADR-005: No implementation skill — extend existing skills instead](ADR-005-no-implementation-skill.md) — Accepted (partial; Phase 5/`persona` never shipped), 2026-04-03
- [ADR-006: Autonomous skill mode via complexity-conditional ceremony](ADR-006-autonomous-skill-mode.md) — Accepted, 2026-04-03
- [ADR-007: Extract shared skill conventions to skill-conventions.md](ADR-007-extract-skill-conventions.md) — Accepted, 2026-04-06
- [ADR-008: Instruction budget constraint — why 125 lines, why it matters](ADR-008-instruction-budget-constraint.md) — Accepted, 2026-04-06
- [ADR-009: Skill consolidation and canonical-skill doctrine](ADR-009-skill-consolidation.md) — Accepted, 2026-04-06
- [ADR-010: Setup file ownership — what setup can and cannot touch](ADR-010-setup-file-ownership.md) — Accepted, 2026-04-06
- [ADR-011: Multi-perspective critique (goat-critique) is a core feature](ADR-011-critique-mob-core-features.md) — Accepted (updated 2026-04-18), 2026-04-10
- [ADR-012: Expand quality checks from 15 to 26](ADR-012-quality-checks-expansion.md) — Accepted, 2026-04-12
- [ADR-013: Remove scanner/rubric system, drive setup from audit](ADR-013-remove-scanner-system.md) — Accepted, 2026-04-13
- [ADR-014: Treat `toolchain` and `ask_first` as optional project calibration](ADR-014-optional-project-calibration-config.md) — Implemented, 2026-04-15
- [ADR-015: Remove stop-lint.sh from goat-flow core](ADR-015-remove-stop-lint-from-core.md) — Implemented, 2026-04-15
- [ADR-016: Cold-path truth maintenance](ADR-016-cold-path-truth-maintenance.md) — Accepted, 2026-04-15
- [ADR-017: Active-plan marker for `.goat-flow/plans/.active`](ADR-017-active-plan-marker.md) — Superseded by ADR-033, 2026-04-17
- [ADR-018: No standalone goat-verify skill; use shared Proof Gate](ADR-018-no-goat-verify-skill.md) — Implemented, 2026-04-18
- [ADR-019: Rename `goat-sbao` to `goat-critique` and `goat-test` to `goat-qa`](ADR-019-rename-sbao-to-critique-and-test-to-qa.md) — Accepted, 2026-04-18
- [ADR-020: Add Copilot CLI as a first-class supported agent](ADR-020-add-copilot-cli.md) — Accepted, 2026-04-18
- [ADR-021: goat-critique is full delegated mode only (no quick/inline fallback)](ADR-021-goat-critique-full-mode-only.md) — Accepted, 2026-04-19
- [ADR-022: Canonical source for agent identity](ADR-022-agent-authority-canonical-source.md) — Accepted, 2026-04-19
- [ADR-023: Reference-pack budget tiers split by load pattern](ADR-023-reference-pack-budget-tiers.md) — Accepted, 2026-04-20
- [ADR-024: Semantic anchors over line numbers in evidence](ADR-024-semantic-anchors-over-line-numbers.md) — Accepted, 2026-04-24
- [ADR-025: Block all git push from agents](ADR-025-block-all-git-push.md) — Accepted, 2026-04-26
- [ADR-026: Keep workspace boundary audit check path-agnostic](ADR-026-keep-workspace-boundary-path-agnostic.md) — Accepted, 2026-05-01
- [ADR-027: Remove DDT layer reference packs](ADR-027-remove-ddt-layer-reference-packs.md) — Accepted, 2026-05-02
- [ADR-028: Treat GitHub CLI as mostly read-only, except issue and pull request comments](ADR-028-github-cli-mostly-read-only-except-comments.md) — Accepted (updated 2026-06-02), 2026-05-20
- [ADR-029: Two-ceiling runaway protection for orchestrated long-lived resources](ADR-029-two-ceiling-runaway-protection.md) — Accepted, 2026-05-25
- [ADR-030: Replace Gemini with Antigravity as the fourth supported runtime](ADR-030-replace-gemini-with-antigravity.md) — Accepted, 2026-05-24
- [ADR-031: Single canonical commit-conventions doc at docs/coding-standards/git-commit.md](ADR-031-single-canonical-commit-doc.md) — Accepted, 2026-05-29
- [ADR-032: Scope gruff-code-quality hook binary discovery to standard install locations](ADR-032-scope-gruff-hook-binary-discovery.md) — Accepted, 2026-06-01
- [ADR-033: `.goat-flow/` directory restructure](ADR-033-goat-flow-directory-restructure.md) — Accepted, 2026-06-07
