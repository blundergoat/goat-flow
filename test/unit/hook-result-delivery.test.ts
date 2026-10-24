/** Real Node evaluator fixtures protect final native replies, buffered policy decisions and failure recovery. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

const codexStop = "codex:post-turn:goat-flow.hook-result.v1:turn-stop:1:75000";
const antigravityPolicy =
  "antigravity:policy:goat-flow.hook-result.v1:pre-tool:1:25000";

/** Own the selected root and every evaluator/recovery file until the case finishes. */
function projectFixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "goat-native-result-"));
  mkdirSync(join(root, ".goat-flow"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** Produce a complete neutral fixture with findings only when its outcome needs them. */
function resultEnvelope(mode: string, outcome = "block", adapterVersion = "1") {
  const [provider, kind, , event] = mode.split(":");
  return {
    schema: "goat-flow.hook-result.v1",
    hookId:
      kind === "policy"
        ? "deny-dangerous"
        : kind === "gruff"
          ? "gruff-code-quality"
          : "post-turn-safety",
    event,
    outcome,
    coverage: {
      status: "complete",
      attemptedUnits: 1,
      completedUnits: 1,
      skippedUnits: 0,
    },
    reasonCode: outcome === "pass" ? "completed-clean" : "findings-reported",
    findings:
      outcome === "pass"
        ? []
        : [{ code: "fixture-finding", message: "Review the changed file" }],
    execution: {
      hookVersion: "1.18.0",
      provider,
      providerMode: "managed",
      adapterName: `${provider}-${event}`,
      adapterVersion,
      durationMs: 12,
    },
  };
}

/** Send the fixture through real native execution and rendering with no shell on PATH. */
function execute(
  root: string,
  mode: string,
  body: string,
  active = false,
  timeout = 5000,
  missingRoot = false,
) {
  const script = join(root, "evaluator.mjs");
  writeFileSync(script, body);
  const url = new URL("../../workflow/hooks/hook-launch.mjs", import.meta.url)
    .href;
  const probe = `
    const native = await import(${JSON.stringify(url)});
    const [root, mode, script, timeout, missingRoot] = process.argv.slice(1);
    const prepared = await native.prepareHookLaunchRuntime(mode,process.env);
    if (prepared.failureReason !== null) throw new Error(prepared.failureReason);
    const context = mode === ${JSON.stringify(codexStop)} ? await native.readNativeManagedStopContext(mode,root) : null;
    const capture = prepared.providerAdapterRuntime !== null || ["policy","antigravity","copilot"].includes(mode);
    const execution = await native.runNativeHookProcessUntilDeadline(script,missingRoot === "true" ? root+"/missing" : root,
      prepared.hookEnvironment,Number(timeout),process.platform,
      {shouldCaptureResult:capture,acceptedStopInput:context?.acceptedInput??Buffer.alloc(0)});
    process.exitCode = await native.renderNativeHookExecutionResult(mode,prepared.providerAdapterRuntime,
      prepared.launchContract,execution,Number(timeout),"deny-dangerous",context);
  `;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      probe,
      root,
      mode,
      script,
      String(timeout),
      String(missingRoot),
    ],
    {
      cwd: root,
      env: { ...process.env, PATH: "" },
      input: JSON.stringify({
        hook_event_name: "Stop",
        session_id: "fixture-session",
        turn_id: "fixture-turn",
        stop_hook_active: active,
      }),
      encoding: "utf8",
      timeout: 15000,
    },
  );
  assert.equal(result.error, undefined);
  return result;
}

/** Emit one neutral fixture and an independent child diagnostic. */
function emit(envelope: ReturnType<typeof resultEnvelope>) {
  return `process.stderr.write("child diagnostic\\n");process.stdout.write(${JSON.stringify(JSON.stringify(envelope))});`;
}

test("native completed results adapt real findings across provider reply shapes", (t) => {
  const root = projectFixture(t);
  for (const [mode, outcome] of [
    ["claude:gruff:goat-flow.hook-result.v1:post-tool:1:75000", "advisory"],
    [codexStop, "block"],
    ["copilot:policy:goat-flow.hook-result.v1:pre-tool:1:25000", "block"],
    [antigravityPolicy, "block"],
  ]) {
    const result = execute(root, mode, emit(resultEnvelope(mode, outcome)));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "child diagnostic\n");
    const response = JSON.parse(result.stdout);
    if (mode.startsWith("claude:"))
      assert.equal(response.hookSpecificOutput.hookEventName, "PostToolUse");
    if (mode === codexStop) assert.equal(response.decision, "block");
    if (mode.startsWith("copilot:"))
      assert.equal(response.permissionDecision, "deny");
    if (mode === antigravityPolicy) assert.equal(response.decision, "deny");
    assert.match(result.stdout, /Review the changed file/u);
    assert.equal(response.schema, undefined);
  }
});

test("native clean results keep quiet replies and Antigravity explicit allow", (t) => {
  const root = projectFixture(t);
  for (const mode of [
    "claude:gruff:goat-flow.hook-result.v1:post-tool:1:75000",
    codexStop,
    "copilot:policy:goat-flow.hook-result.v1:pre-tool:1:25000",
    antigravityPolicy,
  ]) {
    const result = execute(root, mode, emit(resultEnvelope(mode, "pass")));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "child diagnostic\n");
    assert.equal(
      result.stdout,
      mode === antigravityPolicy ? '{"decision":"allow"}\n' : "",
    );
  }
});

test("native invalid results refuse malformed bytes, stale identity, failed status and output floods", (t) => {
  const root = projectFixture(t);
  for (const [body, reason, diagnostic] of [
    [
      'process.stderr.write("child diagnostic\\n");process.stdout.write("{");',
      /adapter-delivery-failed/u,
      true,
    ],
    [
      'process.stderr.write("child diagnostic\\n");process.stdout.write(Buffer.from([0xff]));',
      /not valid UTF-8/u,
      true,
    ],
    [
      emit(resultEnvelope(antigravityPolicy, "block", "2")),
      /adapter version does not match/u,
      true,
    ],
    [
      emit(resultEnvelope(antigravityPolicy)) + "process.exitCode=7;",
      /without a complete result envelope/u,
      true,
    ],
    [
      "process.stdout.write(Buffer.alloc(65537,0x61));",
      /envelope.*limit/u,
      false,
    ],
  ] as const) {
    const result = execute(root, antigravityPolicy, body);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).decision, "deny");
    assert.match(JSON.parse(result.stdout).reason, reason);
    if (diagnostic) assert.equal(result.stderr, "child diagnostic\n");
  }
});

test("native legacy policies retain valid decisions and withhold untrusted child output", (t) => {
  const root = projectFixture(t);
  for (const mode of ["policy", "copilot", "antigravity"]) {
    const allowed = execute(
      root,
      mode,
      'process.stdout.write("accepted\\n");process.stderr.write("diagnostic\\n");',
    );
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.equal(allowed.stdout, "accepted\n");
    assert.equal(allowed.stderr, "diagnostic\n");
    const failed = execute(
      root,
      mode,
      'process.stdout.write("untrusted child output");process.exitCode=7;',
    );
    assert.equal(failed.status, mode === "policy" ? 2 : 0);
    assert.doesNotMatch(failed.stdout, /untrusted child output/u);
    assert.match(
      failed.stdout + failed.stderr,
      /policy exited with status 7 without a decision/u,
    );
  }
  const denied = execute(
    root,
    "policy",
    'process.stdout.write("denied\\n");process.stderr.write("blocked\\n");process.exitCode=2;',
  );
  assert.equal(denied.status, 2);
  assert.equal(denied.stdout, "denied\n");
  assert.equal(denied.stderr, "blocked\n");
  const flooded = execute(
    root,
    "policy",
    "process.stdout.write(Buffer.alloc(10001,0x61));",
  );
  assert.equal(flooded.status, 2);
  assert.equal(flooded.stdout, "");
  assert.match(flooded.stderr, /policy output exceeded the result limit/u);
});

test("native legacy feedback retains relayed streams and the evaluator status", (t) => {
  const root = projectFixture(t);
  for (const [mode, status] of [
    ["gruff", 7],
    ["post-turn", 2],
  ] as const) {
    const result = execute(
      root,
      mode,
      `process.stdout.write("feedback\\n");process.stderr.write("diagnostic\\n");process.exitCode=${status};`,
    );
    assert.equal(result.status, status, result.stderr);
    assert.equal(result.stdout, "feedback\n");
    assert.equal(result.stderr, "diagnostic\n");
  }
});

test("native deadline and launch errors use managed Stop recovery without a clean-scan claim", (t) => {
  const root = projectFixture(t);
  const body =
    'process.stderr.write("ready\\n");process.stdout.write("{");setInterval(()=>{},1000);';
  const initial = execute(root, codexStop, body, false, 3000);
  assert.equal(initial.status, 0, initial.stderr);
  assert.equal(initial.stderr, "ready\n");
  assert.equal(JSON.parse(initial.stdout).decision, "block");
  assert.match(JSON.parse(initial.stdout).reason, /execution-timeout/u);
  const repeated = execute(root, codexStop, body, true, 3000);
  assert.equal(repeated.status, 0, repeated.stderr);
  const warning = JSON.parse(repeated.stdout);
  assert.equal(warning.decision, undefined);
  assert.equal(warning.continue, undefined);
  assert.match(
    warning.systemMessage,
    /bounded-reentry-ended.*no clean scan was recorded; coverage none/u,
  );
  const unavailable = execute(
    projectFixture(t),
    codexStop,
    "",
    false,
    5000,
    true,
  );
  assert.equal(unavailable.status, 0, unavailable.stderr);
  assert.equal(JSON.parse(unavailable.stdout).decision, "block");
  assert.match(JSON.parse(unavailable.stdout).reason, /Node could not start/u);
});
