/** Real Stop input and provider replies protect the native boundary around shared validation/recovery. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { test, type TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readNativeManagedStopContext } from "../../workflow/hooks/hook-launch.mjs";

const codexMode = "codex:post-turn:goat-flow.hook-result.v1:turn-stop:1:75000";

/** Create one selected project; recovery records and fixture scripts remain inside its owned directory. */
function fixture(t: TestContext) {
  const host = mkdtempSync(join(tmpdir(), "goat-native-stop-"));
  const root = join(host, "project '$& 🐐");
  mkdirSync(root);
  mkdirSync(join(root, ".goat-flow"));
  writeFileSync(
    join(root, "diagnostic.mjs"),
    "process.stdout.write('invalid'); process.stderr.write('child diagnostic\\n'); process.exitCode=7;",
  );
  t.after(() => rmSync(host, { recursive: true, force: true }));
  return root;
}

/** Supply an explicit user cycle; Claude validation ignores the Codex-only turn identity. */
function input(active: boolean) {
  return JSON.stringify({
    hook_event_name: "Stop",
    session_id: "fixture-session",
    turn_id: "fixture-turn",
    stop_hook_active: active,
  });
}

/** Run the native APIs with original stdin and capture their real host status and streams. */
function failure(
  root: string,
  mode: string,
  payload: string,
  withOutput = false,
  moduleUrl = new URL("../../workflow/hooks/hook-launch.mjs", import.meta.url)
    .href,
) {
  const probe = `
    const native = await import(${JSON.stringify(moduleUrl)});
    const root = process.argv[1], mode = process.argv[2];
    const context = await native.readNativeManagedStopContext(mode, root);
    const prepared = await native.prepareHookLaunchRuntime(mode, process.env);
    const ready = prepared.failureReason === null ? prepared : null;
    const fallback = mode === ${JSON.stringify(codexMode)} ? {
      providerIdentifier:"codex",responseKind:"post-turn",resultProtocol:"goat-flow.hook-result.v1",
      hookEvent:"turn-stop",adapterVersion:"1",launcherDeadlineMs:75000
    } : null;
    let execution = null, code = context?.state === "invalid" ? "input-invalid" : "hook-unavailable";
    let reason = ready === null ? prepared.failureReason : "hook script was not found";
    if (process.argv[3] === "output") {
      execution = await native.runNativeHookProcessUntilDeadline(root+"/diagnostic.mjs",root,
        {...process.env,GOAT_FLOW_HOOK_PROVIDER_MODE:"managed"},5000,process.platform,
        {shouldCaptureResult:true,acceptedStopInput:context?.acceptedInput??Buffer.alloc(0)});
      const decoded = ready.providerAdapterRuntime.decodeHookResultOutput(execution.stdout);
      if (decoded.state !== "invalid") throw new Error("fixture unexpectedly produced a valid result");
      code = "adapter-delivery-failed"; reason = decoded.reason;
    }
    process.exitCode = await native.reportNativeLauncherUnavailable(mode,ready?.providerAdapterRuntime??null,
      ready?.launchContract??fallback,mode.includes(":policy:")?"deny-git-mutations":"post-turn-safety",
      {unavailableReasonCode:code,userFacingReason:reason,stopContext:context,
        childStandardError:execution?.stderr??"child diagnostic\\n",outputMeasurement:execution?.output});
  `;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      probe,
      root,
      mode,
      withOutput ? "output" : "startup",
    ],
    {
      cwd: root,
      env: { ...process.env, PATH: "" },
      input: payload,
      encoding: "utf8",
      timeout: 10000,
    },
  );
  assert.equal(result.error, undefined);
  return result;
}

test("native Stop validation preserves accepted bytes and leaves unverified input untouched", async (t) => {
  const root = fixture(t);
  const bytes = Buffer.from(
    " \n" + input(false).replace("fixture-session", "fixture-🐐") + "\n",
  );
  const started = Date.now();
  const context = await readNativeManagedStopContext(
    codexMode,
    root,
    Readable.from([bytes]),
  );
  assert.equal(context.state, "valid");
  assert.deepEqual(context.acceptedInput, bytes);
  assert.equal(context.projectRoot, realpathSync(root));
  assert.ok(context.deadlineAt >= started + 75000);
  assert.ok(context.deadlineAt <= Date.now() + 75000);
  const stream = Readable.from([bytes]);
  assert.equal(await readNativeManagedStopContext("gruff", root, stream), null);
  const remaining: Buffer[] = [];
  for await (const chunk of stream) remaining.push(Buffer.from(chunk));
  assert.deepEqual(Buffer.concat(remaining), bytes);
});

test("native Stop validation rejects damaged, oversized and unidentified input", async (t) => {
  const root = fixture(t);
  for (const bytes of [
    Buffer.alloc(0),
    Buffer.from([0xff]),
    Buffer.alloc(1048577, 0x61),
    Buffer.from('{"hook_event_name":"Stop","stop_hook_active":true}'),
    Buffer.from(input(false).replace('"Stop"', '"PostToolUse"')),
    Buffer.from(
      input(false).replace(
        '"stop_hook_active":false',
        '"stop_hook_active":"false"',
      ),
    ),
  ]) {
    const context = await readNativeManagedStopContext(
      codexMode,
      root,
      Readable.from([bytes]),
    );
    assert.deepEqual(context, { state: "invalid" });
  }
  assert.deepEqual(
    await readNativeManagedStopContext(
      codexMode,
      join(root, "missing"),
      Readable.from([Buffer.from(input(false))]),
    ),
    { state: "invalid" },
  );
});

test("native launcher failure preserves Claude startup reentry behavior", (t) => {
  const root = fixture(t);
  const initial = failure(root, "post-turn", input(false));
  assert.equal(initial.status, 2, initial.stderr);
  assert.equal(initial.stdout, "");
  assert.equal(
    initial.stderr,
    "post-turn-safety: hook unavailable: hook script was not found.\n",
  );
  const repeated = failure(root, "post-turn", input(true));
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(repeated.stdout, "");
  assert.match(
    repeated.stderr,
    /ending repeated Stop after launcher infrastructure failure; no clean scan was recorded/u,
  );
  const invalid = failure(
    root,
    "post-turn",
    '{"hook_event_name":"Stop","stop_hook_active":true}',
  );
  assert.equal(invalid.status, 2, invalid.stderr);
  assert.equal(invalid.stdout, "");
});

test("native Codex recovery blocks invalid context and preserves measured output through one retry", (t) => {
  const root = fixture(t);
  const invalid = failure(
    root,
    codexMode,
    '{"hook_event_name":"Stop","stop_hook_active":true}',
  );
  assert.equal(invalid.status, 0, invalid.stderr);
  assert.equal(JSON.parse(invalid.stdout).decision, "block");
  const initial = failure(root, codexMode, input(false), true);
  assert.equal(initial.status, 0, initial.stderr);
  assert.equal(initial.stderr, "child diagnostic\n");
  assert.equal(JSON.parse(initial.stdout).decision, "block");
  assert.match(JSON.parse(initial.stdout).reason, /adapter-delivery-failed/u);
  const repeated = failure(root, codexMode, input(true), true);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(repeated.stderr, "child diagnostic\n");
  const warning = JSON.parse(repeated.stdout);
  assert.equal(warning.decision, undefined);
  assert.equal(warning.continue, undefined);
  assert.match(
    warning.systemMessage,
    /bounded-reentry-ended.*no clean scan was recorded; coverage none/u,
  );
  assert.match(
    warning.systemMessage,
    /Output: exact 7 stdout \/ 17 stderr bytes/u,
  );
});

test("native Codex startup recovery remains available without its adapter module", (t) => {
  const root = fixture(t);
  const runtime = join(root, "runtime");
  mkdirSync(runtime);
  for (const name of [
    "hook-launch.mjs",
    "hook-supervisor.mjs",
    "hook-output.mjs",
    "process-tree.mjs",
    "hook-launch-runtime.mjs",
  ]) {
    copyFileSync(
      fileURLToPath(new URL(`../../workflow/hooks/${name}`, import.meta.url)),
      join(runtime, name),
    );
  }
  const url = pathToFileURL(join(runtime, "hook-launch.mjs")).href;
  const initial = failure(root, codexMode, input(false), false, url);
  assert.equal(initial.status, 0, initial.stderr);
  assert.equal(initial.stderr, "");
  assert.equal(JSON.parse(initial.stdout).decision, "block");
  assert.match(
    JSON.parse(initial.stdout).reason,
    /hook provider adapter could not load.*coverage none/u,
  );
  const repeated = failure(root, codexMode, input(true), false, url);
  assert.equal(repeated.status, 0, repeated.stderr);
  const warning = JSON.parse(repeated.stdout);
  assert.equal(warning.decision, undefined);
  assert.equal(warning.continue, undefined);
  assert.match(warning.systemMessage, /bounded-reentry-ended.*coverage none/u);
});

test("native unavailable delivery attributes the selected policy and retains its diagnostics", (t) => {
  const root = fixture(t);
  const result = failure(
    root,
    "antigravity:policy:goat-flow.hook-result.v1:pre-tool:1:25000",
    "",
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "child diagnostic\n");
  const response = JSON.parse(result.stdout);
  assert.equal(response.decision, "deny");
  assert.match(response.reason, /deny-git-mutations/u);
  assert.match(response.reason, /0\/1 completed; 1 skipped \(none\)/u);
});
