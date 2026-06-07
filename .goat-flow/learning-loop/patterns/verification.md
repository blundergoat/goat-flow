---
category: verification
last_reviewed: 2026-05-27
---

## Pattern: Cross-runner quality-report triage by convergence

**Context:** `goat-flow quality` runs produce a JSON report per runner. When the same project is reviewed by multiple runners (Claude / Codex / Antigravity / Copilot) in a session, the resulting set of findings overlap unevenly: some issues land in every report, some only in one. Acting on every finding linearly is expensive when one finding is real and another is hallucinated. The triage discipline is to read all reports together and let the agreement shape guide verification order.

**Approach:** Group findings across reports into three triage tiers before opening any code:

1. **Convergent (N-of-N runners flagged it):** The signal is high. The finding usually corresponds to something the system has loud evidence for — a failing preflight gate, a contradiction visible in any reading of the surface, a Status tag mismatch. Verify once (because all runners might still be wrong, e.g., reading outdated state), fix, and treat as the load-bearing item.
2. **Multi-runner (2..N-1 flagged it):** The signal is suggestive. Two independent agents converging on the same artifact usually means a real issue, but the specifics can disagree; verify against the live code for each runner's framing of it.
3. **Singleton (1-of-N flagged it):** The finding is a HYPOTHESIS, not a fact. The other runners did not see it. Three sub-cases: (a) a real issue only one runner happened to notice (rare but valuable — typically with a specific file:line anchor), (b) a hallucinated fact the agent invented (e.g., a reference to a file that does not exist), (c) a defensible design tradeoff one runner misread. Per-finding verification is mandatory before any action; reject (b) and document (c) as defensible rather than fixing.

**Evidence (2026-05-25 quality session, framework-self):** Four runners reviewed goat-flow at 20:06-20:18.
- Convergent (4-of-4): `verification.md` lessons bucket exceeded 39KB schema gate. Verified by running preflight (failed at `Learning-loop schema` exit 1) and `wc -c` (41,323 bytes). Real and load-bearing — splitting external PR lessons into their own patterns bucket reduced it to 33,325 bytes, preflight green.
- Singleton-real (1-of-4, Codex): `footguns/setup.md:10` cites search anchor `invalidNoneEntryPattern` that no longer exists in `workflow/install-goat-flow.sh`. Verified by `rg invalidNoneEntryPattern workflow/install-goat-flow.sh` returning zero hits and `rg isInvalidNoneKey workflow/install-goat-flow.sh` returning lines 497 + 599. Real and actionable.
- Singleton-hallucination (1-of-4, Antigravity): `.agents/skills/goat-critique/SKILL.md` references `references/refuter-spec.md` that does not exist. Verified by `grep refuter-spec .{agents,claude,github}/skills/goat-critique/SKILL.md workflow/skills/goat-critique/SKILL.md` returning zero hits across all four mirrors. `refuter-spec.md` exists only under `goat-review/references/`. False positive — the agent confused which skill it was reviewing.
- Singleton-defensible (1-of-4, Claude, persisted): `CLAUDE.md:38` lists only 2 of 9 playbook examples on the Tool playbooks hot-path hint. Defensible design — the line says "examples" and the README is the named index; the v1.4.1 parity check requires `browser-use` + `page-capture` specifically. Persisted finding worth documenting as a tradeoff, not fixing.

**Goat-flow application:**
- When a user pastes one or more quality reports, the first action is the triage pass: parse the findings, bucket by convergence, decide order of attack. Convergent first (cheapest validation), then real-singletons (cite-the-file-then-grep), then defensible/hallucination skipped or documented.
- Convergent does not mean "skip verification" — all runners can read outdated state simultaneously (e.g., reports captured before a fix landed). Confirm the issue still exists in the live tree before acting. The 2026-05-25 verification.md finding was already fixed mid-session when the user pasted the reports; the triage pass surfaces "already fixed" as a fast no-op for the convergent tier.
- Hallucinations are not failures of the reporting agent's character — they are a property of LM review under uncertainty. Treat them as a routine 5-10% rate per report and design the triage discipline around that rate, not against it.
- When a singleton-real finding is acted on, audit whether the OTHER runners had blind spots (the same evidence was present and they missed it) or different framing (one runner had access to a tool the others didn't). The "why only one runner saw this" question informs future rubric tuning.

**When NOT to use:** Single-runner sessions (only one agent reviewed) cannot use convergence triage — every finding is a singleton. In that case the discipline collapses to per-finding verification, weighted by evidence quality (`evidence_method` + `evidence_command` fields in the JSON report) rather than by cross-runner agreement.

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
- Ban `console.log` in MCP server code (when added) — see `.goat-flow/learning-loop/footguns/cli.md` (search: `Diagnostic logs to stdout corrupt structured-output modes`).
- Ban `JSON.stringify` as a `Set<string>` dedupe key in merge functions — see `.goat-flow/learning-loop/footguns/config.md` (search: `JSON.stringify as a dedupe key silently drops function values`).
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

## Pattern: Verification needs a real context boundary

**Context:** The same agent writes a change and then proposes to "independently verify" it inside the same invocation.

**Approach:** Treat same-context self-verification as evidence gathering, not independent review. Real verification needs a context boundary: a fresh invocation, a different agent, a human, or a deterministic test that can fail the author. Use `/goat-review` or `/goat-qa` as the verification layer after implementation, not a self-verifier phase inside the same skill. Evidence anchor: `.goat-flow/learning-loop/decisions/ADR-005-no-implementation-skill.md` (search: `goat-doer / goat-verifier`).

---
