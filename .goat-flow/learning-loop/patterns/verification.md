---
category: verification
last_reviewed: 2026-09-05
---

## Pattern: Cross-runner quality-report triage by convergence

**Context:** `goat-flow quality` produces one JSON report per runner (Claude, Codex, Antigravity, Copilot) and their findings overlap unevenly. Acting on every finding linearly wastes effort when one is real and another is hallucinated; let the agreement shape set the verification order.

**Approach:** Before opening any code, bucket findings by how many runners flagged them:
1. **Convergent (all runners):** high signal, usually something with loud evidence such as a failing preflight gate. Verify once anyway, because every runner may have read the same outdated state, then fix.
2. **Multi-runner (some):** suggestive; verify against live code for each runner's framing.
3. **Singleton (one):** a hypothesis. It is a real issue one runner noticed (typically with a file anchor), a hallucinated fact (a file that does not exist), or a defensible trade-off one runner misread. Verify before acting; reject hallucinations and document trade-offs instead of fixing them.

Treat hallucinations as a routine 5-10% rate per report, not a character flaw. When a singleton turns out real, ask why the other runners missed it (blind spot or tool access) to tune rubrics. With one runner, convergence is unavailable; weight each finding by its `evidence_method` and `evidence_command` fields instead (`src/cli/quality/schema-parser.ts`, search: `evidence_method`).

**Evidence (OBSERVED, 2026-05-25 self-review by four runners):**
- Convergent 4-of-4: the lessons `verification.md` bucket at 41,323 bytes exceeded the bucket-size gate (`src/cli/stats/stats.ts`, search: `BUCKET_SIZE_WARN_BYTES`); preflight confirmed it, and splitting external-PR lessons into a patterns bucket brought it to 33,325 bytes. It was already fixed when the reports arrived, which the triage pass surfaced as a fast no-op.
- Singleton real (Codex): `.goat-flow/learning-loop/footguns/setup.md` cited an installer anchor that no longer existed; the installer had moved to the `isInvalidNoneKey` predicate the footgun now names (search: `isInvalidNoneKey`).
- Singleton hallucination (Antigravity): a claimed `references/refuter-spec.md` under goat-critique. The file exists only under `goat-review/references/`, and all four skill mirrors returned zero hits.
- Singleton defensible (Claude): `CLAUDE.md` (search: `Tool playbooks`) names two playbooks as examples rather than all of them. The README is the named index, so the finding was documented, not fixed.

## Pattern: Auto-detect required runtime in CI, skip cleanly when absent

**Context:** Tests that depend on an external runtime (container engine, language runtime, native binary) are valuable where it exists and unrunnable elsewhere. Hard-coding one runtime fails hosts that have an equivalent; hard-coding "skip if missing" forfeits partial coverage.

**Approach:** One fixture probes the preferred runtime first and its alternatives after, with a short timeout so an installed-but-broken runtime cannot hang CI; skips the test with a named reason when none respond; and exports the detected choice in the environment variable the production code reads, so test and code use the same runtime. Reserve auto-skip for runtimes where partial coverage beats none; a test that is meaningless without its runtime should fail loud.

**Evidence (EXTERNAL_REFERENCE):** mini-swe-agent PR #743 (merged 2026-02-12) added a `container_executable` pytest fixture in `tests/conftest.py` that tries `docker version` then `podman version` with a 5-second timeout, skips when neither answers, and sets `MSWEA_DOCKER_EXECUTABLE` for `DockerEnvironment`.

**Goat-flow state (2026-09-05):** No test probes for an agent CLI, and none needs to: the deny-hook runtime audit spawns a Bash child for the hook self-test, not `claude` or `codex` (`src/cli/audit/check-agent-deny-runtime.ts`, search: `executable = "bash"`). The closest local shape is the capability skip in `test/integration/setup-install.helpers.ts` (search: `host blocks unprivileged symlinks`). Tests here use `node:test`, so the fixture is a helper that calls `t.skip(reason)`.

## Pattern: Bounded wait loops in tests, never bare `while not condition`

**Context:** Integration tests that poll for an external state change (server ready, session attached, file appeared) hang the whole CI run if the state never arrives.

**Approach:** Poll inside a loop with an explicit iteration or deadline budget, and throw a message naming the awaited state and the budget when it expires. Size the budget to the operation: seconds for a state change, longer for a build. Do not poll when a deterministic signal exists (callback, promise, event).

```typescript
for (let i = 0; i < 50; i++) {
  await pause(100);
  if (await condition()) return;
}
throw new Error("Condition X did not become true within 5 seconds");
```

**Evidence (EXTERNAL_REFERENCE):** mini-swe-agent PR #682 (merged 2026-01-04) replaced `while app.agent_state != "AWAITING_INPUT": await pilot.pause(0.1)` with a 50-iteration for-else that raises `AssertionError` naming the state.

**Local instance:** `test/integration/preflight-progress.test.ts` (search: `async function waitForFixtureProcessExit`) polls against a deadline with a bounded grace period.

## Pattern: Verification scope must match change scope

**Context:** Any change that touches more than code.

**Approach:** Code-only changes are verified by tests. Changes to docs, setup prompts, or workflow templates need those files read as well, and files you build on need auditing first, because their errors propagate. For learning-loop bucket edits, run `goat-flow index` itself. It rewrites all four indexes, so check the learning-loop tree's dirty state immediately before regenerating, not at session start; if unrelated buckets are dirty, snapshot their `INDEX.md` files first or run it against an isolated copy, and keep only the owning `INDEX.md`. `stats --check` proves byte freshness but does not surface write-side generation diagnostics.

**Evidence (OBSERVED):** 2026-08-26: `stats --check` returned `status: pass` for a prose-only empty bucket while `goat-flow index` emitted `[unindexed-bucket-content]`. The split is explicit in `src/cli/stats/index-freshness.ts` (search: `const expected = formatIndex`) and `src/cli/learning-loop-index/generate.ts` (search: `unindexedContentDiagnostics`). 2026-09-05: a patterns-only rewrite regenerated `footguns/INDEX.md` from another session's uncommitted bucket edits made after the session-start status check; restoring it from HEAD was safe only because its pre-regen checksum still matched HEAD.

## Pattern: Complexity refactors need file-level lint before closeout

**Context:** Reducing complexity in a specific function.

**Approach:** Lint the whole file before declaring the pass complete. One extracted function can leave sibling offenders, and helper rewrites can introduce small follow-up mistakes. The file, not the original function, is the verification unit.

## Pattern: Refactors need typecheck before preflight

**Context:** After a large extraction or restructuring pass.

**Approach:** Run `npm run typecheck` before relying on preflight. Complexity-only verification misses callback type drift, helper return narrowing, and unused-parameter regressions that only appear when TypeScript checks the whole tree.

**Evidence (OBSERVED):** During M53, the extracted `reconcileSupportedAgentHook` helper declared its profile list `readonly` while the existing callee required a mutable array. File-level ESLint passed; typecheck rejected the mismatch before behavioural tests or preflight ran. Anchor: `src/cli/server/hook-registrar.ts` (search: `function reconcileSupportedAgentHook`).

## Pattern: Non-gating audit gaps belong in explicit limits

**Context:** A deterministic audit check passes by design, but review evidence shows a reader could read the PASS as complete assurance.

**Approach:** Keep the status gate when the missing evidence is optional, project-specific, or advisory. Add a first-class `limits` or warning field and carry it through renderers, dashboard readers, and quality prompts. Prove it with one machine-readable assertion and one human-facing assertion. Anchors: `src/cli/audit/audit.ts` (search: `addNonGatingEvidenceLimits`); `test/unit/audit-command/scoring-model.test.ts` (search: `keeps unrelated concern scores, statuses, and limits unchanged`) for the machine-readable assertion and (search: `keeps evidence limits adjacent to passing concerns in terminal and Markdown output`) for the human-facing one.

## Pattern: Source-grep guardrail for banned API surfaces

**Context:** An API or coding pattern is known to be dangerous in some scope (`sql.raw` with string concatenation, `eval()`, `Math.random()` for security-bearing IDs, `console.log` in structured-output code). Review can catch new uses, but the burden grows with PR volume and one missed review lets it back in.

**Approach:** Ship a test that walks the production source and fails when any file matches. Keep exceptions in a sibling allowlist with a one-line reason each, so reviewers challenge specific entries. Patterns with rare legitimate uses get an allowlist rather than a ban; syntactically ambiguous substrings need a scoped regex or AST rather than a grep, and a false-positive rate over 5% is the signal to escalate.

```typescript
it("Math.random() is banned in src/cli/server/", () => {
  const offenders = walkTs("src/cli/server/").filter((f) =>
    readFileSync(f, "utf8").includes("Math.random("),
  );
  assert.deepEqual(offenders, []);
});
```

**Evidence (EXTERNAL_REFERENCE):** promptfoo PR #9345 paired the `buildSafeJsonPath()` SQL-injection fix with `test/database/sqlSafety.test.ts`, which walks `src/` and asserts no production file contains `sql.raw(`.

**Goat-flow state (2026-09-05):** No test walks `src/` for banned patterns yet. Candidate first bans: `Math.random()` in `src/cli/server/`, where `randomUUID` is already the convention (`src/cli/server/terminal.ts` (search: `randomUUID`), `src/cli/server/dashboard-project-state.ts` (search: `randomUUID`)); `console.log` on stdout in structured-output paths (`.goat-flow/learning-loop/footguns/cli.md`, search: `Diagnostic logs to stdout corrupt structured-output modes`); and a bare `setTimeout` or `setInterval` without a matching clear in the same server file.

## Pattern: Verification needs a real context boundary

**Context:** The same agent writes a change and then proposes to "independently verify" it inside the same invocation.

**Approach:** Treat same-context self-verification as evidence gathering, not independent review. Real verification needs a context boundary: a fresh invocation, a different agent, a human, or a deterministic test that can fail the author. Use `/goat-review` or `/goat-qa` after implementation rather than a self-verifier phase inside the same skill. Anchor: `.goat-flow/learning-loop/decisions/ADR-005-no-implementation-skill.md` (search: `goat-doer + goat-verifier`).
