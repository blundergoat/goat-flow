---
category: architecture
last_reviewed: 2026-05-02
---

## Pattern: Model cross-platform PTY launches as pure spawn specs
**Context:** Terminal or runner integrations that must work on native Windows and POSIX shells.
**Approach:** Keep shell/args/env selection in a pure helper that accepts an explicit platform, keep Windows runner-path ranking in its own helper, test both branches directly with synthetic `win32` / `linux` / `darwin` inputs, then finish with one host-local real spawn repro for the current OS. This keeps Linux/macOS behavior pinned even when the live bug only shows up on Windows.

## Pattern: Summary surfaces should use cheap evidence and reserve full proofs for drill-ins
**Context:** Dashboard home cards, aggregate setup summaries, or any overview route that only needs to answer "is this mechanism installed?" rather than "does the full runtime proof pass right now?"
**Approach:** Split expensive validation by intent. Let summary surfaces use the cheapest evidence that still answers the summary question, such as file presence, cached facts, or a downgraded evidence level. Keep full runtime probes, self-tests, and live enforcement checks on explicit deep paths like per-agent audits, quality pages, or dedicated verification commands. Verify both paths separately: one route-scoped test that proves the summary path stays fast, and one deeper-path test that proves the runtime check still exists where it matters.
