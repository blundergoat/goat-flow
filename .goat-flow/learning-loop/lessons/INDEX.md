---
category: index
bucket: lessons
last_reviewed: 2026-06-04
generated: false
---

# Lessons Index

Hand-maintained index of lesson bucket files. A lesson exists because the agent *did something wrong* — a misread intent, a skipped step, an overreach — not because the code is structured badly (those go in [footguns](../footguns/), proven approaches go in [patterns](../patterns/)). Each line links to a bucket, summarises what it covers, and records its entry count and `last_reviewed` date. When you add a lesson to a bucket, update its count and date here in the same change. Authoring rules and the frontmatter contract live in [README.md](README.md).

- [agent-behavior.md](agent-behavior.md) — Misreading intent, citing bad evidence, overstepping scope, silencing findings. (22 entries, reviewed 2026-06-04)
- [agent-frontend.md](agent-frontend.md) — Dashboard/UI work: mockup parity, stale audit cache from uncovered compiled JS. (8 entries, reviewed 2026-05-18)
- [agent-routing.md](agent-routing.md) — Task routing & skill invocation: bare paths aren't approval, never downgrade an explicit skill. (14 entries, reviewed 2026-05-02)
- [audit-contracts.md](audit-contracts.md) — Audit check/report contract changes need paired fixture + renderer updates. (5 entries, reviewed 2026-05-31)
- [coordination.md](coordination.md) — Multi-agent council coordination: env-var cross-contamination, false-finding normalisation. (9 entries, reviewed 2026-05-25)
- [dashboard-testing.md](dashboard-testing.md) — Dashboard release QA: prove hook capability before marking unsupported, avoid real runners. (16 entries, reviewed 2026-05-31)
- [filesystem-io.md](filesystem-io.md) — Filesystem/encoding traps: post-replacement greps, behaviour-before-errno assertions. (2 entries, reviewed 2026-05-23)
- [gruff-cleanup.md](gruff-cleanup.md) — gruff-ts cleanup: fix don't tune, verify path-ignore by directory scan, confirm before deleting. (9 entries, reviewed 2026-06-03)
- [hook-testing.md](hook-testing.md) — Hook test matrices: live-guard self-interference, format fixtures before preflight. (13 entries, reviewed 2026-06-07)
- [naming.md](naming.md) — Renames & naming: boundary names aren't placeholder debt, one-letter sweeps corrupt regex flags. (5 entries, reviewed 2026-05-31)
- [review-feedback.md](review-feedback.md) — Applying review/critique output: verify findings before applying, synthesis is the expensive part. (9 entries, reviewed 2026-06-05)
- [setup-and-migration.md](setup-and-migration.md) — Setup agents rewriting shared docs as agent-specific, propagating errors, cutting required sections. (9 entries, reviewed 2026-05-27)
- [test-execution-environment.md](test-execution-environment.md) — Test runtime/platform: timer isolation, live-runner proof, Windows `file://` imports. (13 entries, reviewed 2026-06-07)
- [test-fixtures.md](test-fixtures.md) — Fixture sync after refactors: package test scripts, parser coverage, disk + in-memory parity. (9 entries, reviewed 2026-06-07)
- [verification-preflight.md](verification-preflight.md) — Preflight/formatter verification: preserve repo style flags, unrelated drift can block. (16 entries, reviewed 2026-06-07)
- [verification-testing.md](verification-testing.md) — Targeted test proof for fixes: preserve caller-visible failure signal, facade proof. (16 entries, reviewed 2026-06-03)
- [verification.md](verification.md) — General verification discipline: mutation testing, gruff probes with real configs and wrapper PATH. (26 entries, reviewed 2026-05-31)
