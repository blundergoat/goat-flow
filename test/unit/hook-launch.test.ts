/** Real Node and filesystem boundaries protect native launch before provider integration. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { symlinkTestOptions } from "../helpers/symlink-capability.js";
import {
  hookScriptContainmentFailure,
  hookScriptShapeFailure,
  runNativeHookProcessUntilDeadline,
} from "../../workflow/hooks/hook-launch.mjs";

/** Create a caller-owned project with shell punctuation; cleanup removes only this fixture. */
function fixture(t: TestContext) {
  const host = mkdtempSync(join(tmpdir(), "goat-native-launch-"));
  t.after(() => rmSync(host, { recursive: true, force: true }));
  const root = join(host, "project '$& 🐐");
  mkdirSync(root);
  return { host, root, script: join(root, "hook '$&.mjs") };
}

const environment = {
  ...process.env,
  PATH: "",
  GOAT_FLOW_HOOK_PROVIDER_MODE: "managed",
};

test("native launch preserves selected-root argv, cwd and accepted stdin without a shell", async (t) => {
  const { root, script } = fixture(t);
  // The evaluator records original bytes and argument boundaries; it executes no command text.
  writeFileSync(
    script,
    "const chunks=[]; for await(const chunk of process.stdin) chunks.push(chunk); process.stdout.write(JSON.stringify({argv:process.argv.slice(2),cwd:process.cwd(),input:Buffer.concat(chunks).toString('hex')})); process.stderr.write('details'); process.exitCode=7;",
  );
  const input = Buffer.from('\n { "turn": "🐐" } \n');
  const result = await runNativeHookProcessUntilDeadline(
    script,
    root,
    environment,
    5000,
    process.platform,
    { shouldCaptureResult: true, acceptedStopInput: input },
  );
  assert.equal(result.status, 7);
  assert.equal(result.launchError, null);
  assert.equal(result.timedOut, false);
  assert.deepEqual(JSON.parse(result.stdout), {
    argv: ["--root", root],
    cwd: realpathSync(root),
    input: input.toString("hex"),
  });
  assert.equal(result.stderr, "details");
  assert.equal(result.output?.areByteCountsExact, true);
});

test("native launch retains evaluator status when stdin closes early", async (t) => {
  const { root, script } = fixture(t);
  writeFileSync(
    script,
    "process.stdin.destroy(); process.stdout.write('closed'); process.exitCode=2;",
  );
  const result = await runNativeHookProcessUntilDeadline(
    script,
    root,
    environment,
    5000,
    process.platform,
    { shouldCaptureResult: true, acceptedStopInput: Buffer.alloc(262144) },
  );
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "closed");
  assert.equal(result.launchError, null);
  assert.equal(result.timedOut, false);
});

test("native launch deadline stops a ready evaluator and its owned child", async (t) => {
  const { root, script } = fixture(t);
  const parentMarker = join(root, "parent.pid");
  const childMarker = join(root, "child.pid");
  // Each process records its own PID after starting; the evaluator then stays busy until supervision ends it.
  const worker =
    "require('node:fs').writeFileSync(process.argv[1],String(process.pid)); setInterval(()=>{},1000)";
  writeFileSync(
    script,
    `import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(parentMarker)},String(process.pid)); spawn(process.execPath,['-e',${JSON.stringify(worker)},${JSON.stringify(childMarker)}],{stdio:'ignore'}); while(true) {}`,
  );
  let pids: number[] = [];
  t.after(() => {
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* Ignore already-stopped fixture processes. */
      }
    }
  });
  const captured = runNativeHookProcessUntilDeadline(
    script,
    root,
    environment,
    5000,
    process.platform,
    { shouldCaptureResult: true, acceptedStopInput: Buffer.alloc(0) },
  );
  const readyDeadline = Date.now() + 4000;
  while (!existsSync(parentMarker) || !existsSync(childMarker)) {
    assert.ok(
      Date.now() < readyDeadline,
      "both fixture processes must start before the deadline",
    );
    await delay(10);
  }
  pids = [
    Number(readFileSync(parentMarker, "utf8")),
    Number(readFileSync(childMarker, "utf8")),
  ];
  assert.ok(pids.every((pid) => Number.isSafeInteger(pid) && pid > 0));
  assert.ok(pids.every(isRunning));
  const result = await captured;
  assert.equal(result.timedOut, true);
  assert.equal(result.status, null);
  const cleanupDeadline = Date.now() + 5000;
  while (pids.some(isRunning)) {
    assert.ok(
      Date.now() < cleanupDeadline,
      "owned processes must stop after timeout delivery",
    );
    await delay(10);
  }
});

/** Missing processes and unreaped POSIX zombies are stopped for fixture cleanup. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    if (process.platform === "win32") return true;
    const state = spawnSync("ps", ["-p", String(pid), "-o", "stat="], {
      encoding: "utf8",
    }).stdout.trim();
    return state.length > 0 && !state.startsWith("Z");
  } catch {
    return false;
  }
}

test("native launch inherits stdin and relays feedback without ending host streams", (t) => {
  const { root, script, host } = fixture(t);
  writeFileSync(
    script,
    "const chunks=[]; for await(const chunk of process.stdin) chunks.push(chunk); process.stdout.write('relay:'+Buffer.concat(chunks)); process.stderr.write('diagnostic\\n'); process.exitCode=7;",
  );
  const wrapper = join(host, "wrapper.mjs");
  const moduleUrl = new URL(
    "../../workflow/hooks/hook-launch.mjs",
    import.meta.url,
  ).href;
  // A real wrapper owns host streams, so post-result writes prove the child did not end them.
  writeFileSync(
    wrapper,
    `import {runNativeHookProcessUntilDeadline} from ${JSON.stringify(moduleUrl)}; const result=await runNativeHookProcessUntilDeadline(${JSON.stringify(script)},${JSON.stringify(root)},process.env,5000,process.platform,{shouldCaptureResult:false}); process.stdout.write('after:'+JSON.stringify({status:result.status,stdout:result.stdout,stderr:result.stderr})+'\\n'); process.stderr.write('after diagnostic\\n'); process.exitCode=result.status;`,
  );
  const result = spawnSync(process.execPath, [wrapper], {
    cwd: root,
    env: { ...environment, GOAT_FLOW_HOOK_PROVIDER_MODE: "" },
    input: "provider input\n",
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(result.status, 7, result.stderr);
  assert.equal(
    result.stdout,
    'relay:provider input\nafter:{"status":7,"stdout":"","stderr":""}\n',
  );
  assert.equal(result.stderr, "diagnostic\nafter diagnostic\n");
});

test("native paths reject lexical escapes and invalid file identities", (t) => {
  const { root, script, host } = fixture(t);
  writeFileSync(script, "");
  assert.equal(hookScriptContainmentFailure(root, script), null);
  assert.equal(hookScriptShapeFailure(root, script), null);
  assert.equal(
    hookScriptContainmentFailure(root, root),
    "hook script path escaped the project root",
  );
  assert.equal(
    hookScriptContainmentFailure(root, join(host, "missing.mjs")),
    "hook script path escaped the project root",
  );
  assert.equal(
    hookScriptContainmentFailure(root, join(root, "missing.mjs")),
    null,
  );
  assert.equal(
    hookScriptShapeFailure(root, join(root, "missing.mjs")),
    "hook script was not found",
  );
  assert.equal(
    hookScriptShapeFailure(root, root),
    "hook script is not a regular file",
  );
  linkSync(script, join(root, "second-name.mjs"));
  assert.equal(
    hookScriptShapeFailure(root, script),
    "hook script has multiple hard links",
  );
});

test(
  "native paths accept a linked project spelling and refuse linked scripts or escaped parents",
  symlinkTestOptions(),
  (t) => {
    const { root, script, host } = fixture(t);
    writeFileSync(script, "");
    const alias = join(host, "alias");
    symlinkSync(root, alias, "dir");
    const aliasScript = join(alias, "hook '$&.mjs");
    assert.equal(hookScriptContainmentFailure(alias, aliasScript), null);
    assert.equal(hookScriptShapeFailure(alias, aliasScript), null);
    const linkedScript = join(root, "linked.mjs");
    symlinkSync(script, linkedScript, "file");
    assert.equal(
      hookScriptShapeFailure(root, linkedScript),
      "hook script is a symlink; managed hooks must be regular files",
    );
    const outside = join(host, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "escape.mjs"), "");
    symlinkSync(outside, join(root, "escaped"), "dir");
    const escaped = join(root, "escaped", "escape.mjs");
    assert.equal(
      hookScriptContainmentFailure(root, escaped),
      "hook script path escaped the project root",
    );
    assert.equal(
      hookScriptShapeFailure(root, escaped),
      "hook script path escaped the project root",
    );
  },
);
