---
category: index
bucket: patterns
last_reviewed: 2026-06-04
generated: false
---

# Patterns Index

Hand-maintained map of the patterns buckets. A pattern is a proven approach worth reusing (if the agent did something wrong → `.goat-flow/learning-loop/lessons/`; if the trap is in the code itself → `.goat-flow/learning-loop/footguns/`). Each entry below is a category file holding one or more `## Pattern:` blocks. When you add, rename, or move a pattern, update this index in the same change. Authoring rules and required frontmatter live in [README.md](README.md).

## [architecture.md](architecture.md) — last reviewed 2026-05-27
System-shape and guardrail-design patterns.
- UNSET sentinel + recursive merge for layered CLI overlays
- Hot-import deferral for slow CLI dependencies
- Use POSIX-shape paths for every user-visible string
- Model cross-platform PTY launches as pure spawn specs
- Summary surfaces should use cheap evidence and reserve full proofs for drill-ins
- Split guardrails by operational decision
- Asymmetric trust — set state from output, clear state from input

## [dependencies.md](dependencies.md) — last reviewed 2026-05-25
Supply-chain and dependency-constraint patterns.
- Pin AWAY from known-bad versions via `!=`, not only `>=`

## [external-lessons.md](external-lessons.md) — last reviewed 2026-05-27
Lessons extracted from reviewing merged PRs in external projects, mapped to goat-flow surfaces (CLI, dashboard, audit pipeline, config merging, persistence).
- Error messages MUST include the input identity that caused them
- Bug-fix clusters arc fix → over-correct → calibrate when the original bug was a silent equality-contract violation
- New polymorphic classes ship with silent bugs without integration tests at parity
- Tests that monkeypatch the function under test mask empty production paths
- CLI must enforce every constraint the service silently applies
- Verify a fix by re-running the original reproducer, not just the test suite
- Status markers drift from ground truth unless the audit verifies the underlying change

## [multi-agent.md](multi-agent.md) — last reviewed 2026-05-27
Running multi-agent critique and review effectively.
- Multi-agent critique — how to run it effectively
- Convert self-declared critique gates into executable checks

## [refactoring.md](refactoring.md) — last reviewed 2026-05-27
Safe contract-change and rename patterns.
- Canary-first contract changes (one consumer before all consumers)
- Verify structural renames with a repo-wide grep
- Skill consolidation requires a full grep after every merge
- Put prompt side effects on the CLI side of the boundary
- Sandwich-layer refactor for behavior-preserving migration of load-bearing seams

## [verification.md](verification.md) — last reviewed 2026-05-27
Proof and verification-discipline patterns.
- Cross-runner quality-report triage by convergence
- Auto-detect required runtime in CI, skip cleanly when absent
- Bounded wait loops in tests, never bare `while not condition`
- Verification scope must match change scope
- Complexity refactors need file-level lint before closeout
- Refactors need typecheck before preflight
- Non-gating audit gaps belong in explicit limits
- Source-grep guardrail for banned API surfaces
- Verification needs a real context boundary

## [workflow.md](workflow.md) — last reviewed 2026-05-27
PR-process and tooling-loop patterns.
- Phase-boundary PR template for oversize work
- Deny-rule grammar matrix before mirror fanout
- Dry-run readiness belongs beside the command
- Skill-playbook structural template
- Gruff docs cleanup is a tight analyzer loop
