---
category: verification
last_reviewed: 2026-05-25
---

## Pattern: Auto-detect required runtime in CI, skip cleanly when absent

**Context:** Tests that depend on an external runtime (container engine, language runtime, native binary) may be valuable in some CI environments but unrunnable in others. Hard-coding the runtime makes the suite fail on platforms that have an equivalent alternative; hard-coding "skip if missing" prevents partial-coverage runs. The right shape is auto-detect, prefer-first, set-env, fall-through-skip.

**Approach:** A pytest fixture (or vitest beforeEach) probes for the preferred runtime, falls back to alternatives, and skips the test cleanly if none are available. It also exports an environment variable so the production code under test uses the same runtime the fixture detected.

**Evidence (external — mini-swe-agent):** PR #743 (merged 2026-02-12, `klieret`, "CI: Fall back to podman if docker not available"). The fixture in `tests/conftest.py` (search: `container_executable`):

```python
def _get_container_executable() -> str | None:
    for exe in ("docker", "podman"):
        try:
            subprocess.run([exe, "version"], capture_output=True, check=True, timeout=5)
            return exe
        except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
            continue
    return None

@pytest.fixture
def container_executable(monkeypatch):
    exe = _get_container_executable()
    if exe is None:
        pytest.skip("Neither docker nor podman is available")
    monkeypatch.setenv("MSWEA_DOCKER_EXECUTABLE", exe)
    return exe
```

The fixture is the test's only entry point — every container test takes `container_executable` as a parameter. The `monkeypatch.setenv` ensures the `DockerEnvironment` class uses the same runtime the fixture probed. The fixture's 5-second timeout on the probe prevents hanging CI if a runtime is installed but broken.

**Goat-flow application:**
- Audit checks that exercise runtime evidence (per `denyMechanismEvidenceLevel: "full"` in `src/cli/audit/audit.ts`) need the agent runner CLI installed (`claude`, `codex`, etc.). A vitest fixture that probes for available runners and routes tests accordingly would let CI gracefully degrade when, e.g., the codex CLI isn't installed on a runner.
- Browser-driven tests for the dashboard need a working browser binary (Chromium/Firefox). Same shape: probe at fixture, skip if missing, set the env var the test code reads.
- Order the probe by preference: list the primary first, fallbacks after. Mini's `("docker", "podman")` order reflects "use docker if available, else podman."

**When NOT to use:** For runtimes that are *required* (the test makes no sense without them), don't auto-skip — fail loud. Auto-skip is for runtimes where partial coverage is genuinely better than no coverage.

## Pattern: Bounded wait loops in tests, never bare `while not condition`

**Context:** Integration tests that wait for an external state change (server ready, session attached, event delivered, file appeared) can hang indefinitely if the state never arrives. Without an explicit timeout, the whole CI run is held hostage to one stuck test.

**Approach:** Replace bare `while not condition: await pause()` loops with a bounded `for` loop that includes an explicit failure case. The for-else pattern (Python) or counter-with-throw pattern (JS) makes the timeout failure mode unambiguous.

**Evidence (external — mini-swe-agent):** PR #682 (merged 2026-01-04, `klieret`, "CI: Fix tests that can get stuck indefinitely"). Replaced:

```python
while app.agent_state != "AWAITING_INPUT":
    await pilot.pause(0.1)
```

with:

```python
for _ in range(50):
    await pilot.pause(0.1)
    if app.agent_state == "AWAITING_INPUT":
        break
else:
    raise AssertionError("Agent did not reach AWAITING_INPUT state within 5 seconds")
```

50 iterations × 0.1s = 5 seconds total budget. The `else` branch of the for loop fires when the loop completes without breaking — exactly the "timeout" case. The assertion message names the awaited state explicitly so a future maintainer sees what should have happened.

**Goat-flow application:**
- vitest tests that wait on dashboard server readiness, hook execution, audit completion, terminal session events — all need this shape.
- TypeScript form:
  ```typescript
  for (let i = 0; i < 50; i++) {
    await pause(100);
    if (await condition()) return;
  }
  throw new Error("Condition X did not become true within 5 seconds");
  ```
- Pick the iteration count and per-iteration pause so the total budget is appropriate for the operation (5 seconds for state-change tests, 30 seconds for build operations). Document the budget in the throw message.

**When NOT to use:** If the operation has a deterministic completion signal (callback, promise resolution, event emit), use that directly — don't poll. The bounded-loop pattern is for polling-only scenarios where deterministic completion isn't available.

---

## Pattern: Verification scope must match change scope
**Context:** Any change that touches more than just code.
**Approach:** When the change is code-only, running tests is sufficient. When the change touches docs, setup prompts, or workflow templates, verification must read those files too. When building on existing files, audit them first - errors in source files propagate to everything built on top.

## Pattern: Complexity refactors need file-level lint before closeout
**Context:** Reducing complexity in a specific function.
**Approach:** Lint the whole file before declaring the pass complete. A single extracted function can still leave sibling offenders, and helper rewrites can introduce small follow-up mistakes. Treat the file, not the original function, as the verification unit.

## Pattern: Refactors need typecheck before preflight
**Context:** After a large extraction or restructuring pass.
**Approach:** Run `npx tsc --noEmit` before relying on preflight. Complexity-only verification can miss callback type drift, helper return narrowing, and small unused-parameter regressions that only show up once TypeScript checks the whole tree.

## Pattern: Non-gating audit gaps belong in explicit limits
**Context:** A deterministic audit check passes by design, but review evidence shows a reader could over-interpret the PASS as complete assurance.
**Approach:** Preserve the existing status gate when the missing evidence is optional, project-specific, or intentionally advisory. Add a first-class `limits`/warning field and carry it through renderers, dashboard readers, and quality prompts. Prove the fix with one machine-readable assertion and one human-facing assertion. Evidence anchors: `src/cli/audit/audit.ts` (search: `addNonGatingEvidenceLimits`), `test/unit/audit-command.test.ts` (search: `Constraint score covers verified deny patterns only`), `test/unit/quality-command.test.ts` (search: `verification: PASS (75%; metrics=2; limits:`).

---

## Pattern: Source-grep guardrail for banned API surfaces

**Context:** A particular API or coding pattern has been identified as dangerous in some scope (`sql.raw` with string concat, `eval()`, `Math.random()` for security-bearing IDs, `console.log` in MCP server code, bare `setTimeout` without paired cleanup, etc.). Code review can catch new uses, but the burden grows linearly with PR volume and one missed review leaks the pattern back in.

**Approach:** Ship a test that greps the source tree for the banned pattern and fails the build if any production file matches. The enforcement lives in CI, not in human attention. Allowlist exceptions go in a sibling file with a one-line `// reason:` annotation per entry; reviewers see the allowlist diff and can challenge specific entries.

**Evidence (external — promptfoo PR #9345):** Alongside the SQL injection fix in `buildSafeJsonPath()`, the PR added `test/database/sqlSafety.test.ts` which walks `src/` and asserts no production file contains `sql.raw(`. The hand-rolled escape that caused the bug can never come back via a different file because the test catches it before review.

**Goat-flow application:**
- Ban `Math.random()` in `src/cli/server/` (where session IDs live) — `randomUUID()` is already the convention (`src/cli/server/terminal.ts` search: `randomUUID`, `src/cli/server/dashboard-routes.ts` search: `randomUUID`). The grep test prevents regression.
- Ban `console.log` in MCP server code (when added) — see `.goat-flow/footguns/cli.md` (search: `Diagnostic logs to stdout corrupt structured-output modes`).
- Ban `JSON.stringify` as a `Set<string>` dedupe key in merge functions — see `.goat-flow/footguns/config.md` (search: `JSON.stringify as a dedupe key silently drops function values`).
- Ban bare `setTimeout` / `setInterval` without an associated `clearTimeout` / `clearInterval` in the same file (dashboard server long-running handlers in `src/cli/server/`).

**Shape of the test (TypeScript, Node's built-in test runner):**

```typescript
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

function walkTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walkTs(p);
    if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) return [p];
    return [];
  });
}

describe("source-grep guardrails", () => {
  it("Math.random() is banned in src/cli/server/", () => {
    const offenders = walkTs("src/cli/server/").filter((f) =>
      readFileSync(f, "utf8").includes("Math.random("),
    );
    assert.deepEqual(offenders, []);
  });
});
```

**When NOT to use:** Patterns that have legitimate but rare uses (e.g., a single intentional `eval` for a sandbox) deserve an allowlist instead of an outright ban. Patterns that are syntactically ambiguous (a substring grep on `cache` matches every comment) need a more structured detector (AST or scoped regex). Don't fight regex limits — escalate to AST if the false-positive rate exceeds 5%.

---

## Pattern: Hollow-test detection in skill bodies (proposed audit check)

**Context:** A test or skill body claims coverage that doesn't actually exist. Example from the wild: `it("should reuse existing connection", () => expect(provider.config.maintainContext).toBe(true))` proves nothing about connection reuse — it asserts a config flag that was just set up by the test fixture. Equivalent shape for skills: a skill body that promises a behaviour (`"This skill validates the dashboard launches"`) but the actual implementation is `expect(true).toBe(true)` or `// TODO: implement` or returns immediately before any assertion. The test / skill passes, coverage looks healthy, and the bug it was supposed to surface ships unprotected.

**Approach:** A static check that flags test functions / skill bodies matching the hollow shape. Detection signal candidates in priority order:
1. Body whose only non-comment statement is `expect(true).toBe(true)` / `assert.ok(true)` / `assert.equal(1, 1)` — high precision, low effort.
2. Body that includes `TODO`, `FIXME`, `Skip`, `difficult to mock`, `for now`, `placeholder` in a comment AND has fewer than 2 assertion calls — medium precision; tune to the false-positive rate observed.
3. Skill body that contains a behavioural claim in the description but the implementation has zero side-effects (no file writes, no return value, no thrown error) — harder to detect; defer until 1 and 2 prove their value.

**Evidence (external — promptfoo PR #9344):** AI-graded code review on the promptfoo codebase flagged `test/providers/openai/realtime.test.ts` `it('should reuse existing connection', ...)` whose body was a comment ("Skip this test since it's difficult to mock") plus a trivial `expect(provider.config.maintainContext).toBe(true)`. The test name advertised connection-reuse coverage that didn't exist. The PR replaced the body with a real two-turn assertion that proves `MockWebSocket` is NOT re-constructed and `conversation.item.create` fires twice. This was the highest-signal finding in the PR — no linter catches "the test name lies about what it asserts."

**Goat-flow application:**
- Closest existing rule shape lives in `src/cli/audit/check-content-quality.ts` (search: `scanContentQuality`) — vague-term detector for skill / instruction prose. Adding a "test / skill body looks hollow" pass extends the same module's vocabulary.
- Format the finding as the standard audit shape: file path with a semantic anchor (the `it("...")` or skill heading), the offending body excerpt, and a suggested remediation ("write a real assertion or delete the test").
- Surface in `check-content-quality.ts` first (low risk, opt-out per check id). Promote to a gating check after running against the live repo to calibrate the false-positive rate.

**When NOT to use:** Some test bodies are legitimately one-line tautologies (e.g., a smoke test that just imports a module to verify it loads). Distinguish by checking the test name: tautological tests usually have names like `"module loads"` or `"import succeeds"`; hollow tests have names that promise behaviour (`"should reuse"`, `"handles errors"`, `"sends N messages"`). When in doubt, surface the finding as a warning rather than a fail and let the human decide.

**Companion footgun (rejected AI findings):** During the same PR review, the AI proposed adding a trailing `0` to four SHA256 fixtures — confidently wrong on deterministic data. The PR author recomputed the digests, confirmed the AI was wrong, and documented the refusal in the PR body. Lesson: any AI-driven audit check that flags hash literals, snapshot fixtures, or numeric constants must require running the producing function before trusting the suggested fix. Add a "AI-finding disposition log" section to any review-driven PR template so rejected findings are surfaced for future readers.
