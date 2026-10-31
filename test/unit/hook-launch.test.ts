/** Real Node and filesystem boundaries protect native launch before provider integration. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
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
import { fileURLToPath, pathToFileURL } from "node:url";
import { test, type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { symlinkTestOptions } from "../helpers/symlink-capability.js";
import {
  hookScriptContainmentFailure,
  hookScriptShapeFailure,
  prepareHookLaunchRuntime,
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
  // Both PIDs prove startup; inherited output pipes must not keep delivery open after tree cleanup.
  const worker =
    "require('node:fs').writeFileSync(process.argv[1],String(process.pid)); setInterval(()=>{},1000)";
  writeFileSync(
    script,
    `import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(parentMarker)},String(process.pid)); spawn(process.execPath,['-e',${JSON.stringify(worker)},${JSON.stringify(childMarker)}],{stdio:['ignore','inherit','inherit']}); while(true) {}`,
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

test("native startup preserves legacy ceilings and rejects unusable overrides", async () => {
  const modes = [
    ["policy", 25000],
    ["antigravity", 25000],
    ["copilot", 25000],
    ["gruff", 75000],
    ["post-turn", 75000],
  ] as const;
  for (const [mode, ceiling] of modes) {
    for (const override of [
      undefined,
      "",
      "1",
      "5000",
      String(ceiling + 1),
      "9".repeat(400),
    ]) {
      const env = { PATH: "", GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS: override };
      const prepared = await prepareHookLaunchRuntime(mode, env);
      assert.equal(prepared.failureReason, null, mode);
      if (prepared.failureReason !== null) assert.fail(prepared.failureReason);
      assert.equal(
        prepared.launchTimeout,
        override === undefined || override === ""
          ? ceiling
          : Math.min(Number(override), ceiling),
      );
      assert.equal(prepared.hookEnvironment, env);
      assert.equal(prepared.launchContract, null);
      assert.equal(prepared.providerAdapterRuntime, null);
    }
    for (const override of [
      "0",
      "1.5",
      "+1",
      "-1",
      " 1",
      "1 ",
      "1e3",
      "１",
      "abc",
    ]) {
      const prepared = await prepareHookLaunchRuntime(mode, {
        GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS: override,
      });
      assert.deepEqual(prepared, {
        failureReason: `hook timeout configuration is invalid: GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS=${JSON.stringify(override)} must be a whole number of milliseconds from 1 to ${ceiling}`,
      });
    }
  }
});

test("native startup uses the real adapter contract without mutating the caller environment", async () => {
  for (const [provider, kind, event, deadline] of [
    ["claude", "policy", "pre-tool", 25000],
    ["codex", "post-turn", "turn-stop", 75000],
    ["copilot", "policy", "pre-tool", 25000],
    ["antigravity", "gruff", "post-tool", 75000],
  ] as const) {
    const mode = `${provider}:${kind}:goat-flow.hook-result.v1:${event}:1:${deadline}`;
    const env = {
      PATH: "",
      preserved: "🐐",
      GOAT_FLOW_HOOK_PROVIDER: "stale",
      GOAT_FLOW_HOOK_EVENT: "stale",
      GOAT_FLOW_HOOK_PROVIDER_MODE: "stale",
      GOAT_FLOW_HOOK_ADAPTER_VERSION: "stale",
      GOAT_FLOW_HOOK_RESULT_PROTOCOL: "stale",
      GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS: String(deadline + 1),
    };
    const before = { ...env };
    const prepared = await prepareHookLaunchRuntime(mode, env);
    assert.equal(prepared.failureReason, null);
    if (prepared.failureReason !== null) assert.fail(prepared.failureReason);
    assert.deepEqual(prepared.launchContract, {
      providerIdentifier: provider,
      responseKind: kind,
      hookEvent: event,
      resultProtocol: "goat-flow.hook-result.v1",
      adapterVersion: "1",
      launcherDeadlineMs: deadline,
    });
    assert.deepEqual(prepared.hookEnvironment, {
      ...env,
      GOAT_FLOW_HOOK_PROVIDER: provider,
      GOAT_FLOW_HOOK_EVENT: event,
      GOAT_FLOW_HOOK_PROVIDER_MODE: "managed",
      GOAT_FLOW_HOOK_ADAPTER_VERSION: "1",
      GOAT_FLOW_HOOK_RESULT_PROTOCOL: "goat-flow.hook-result.v1",
    });
    assert.equal(prepared.launchTimeout, deadline);
    assert.deepEqual(env, before);
    assert.deepEqual(
      prepared.providerAdapterRuntime.decodeHookLaunchContract(mode),
      prepared.launchContract,
    );
    const shorter = await prepareHookLaunchRuntime(mode, {
      GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS: "1",
    });
    assert.equal(shorter.launchTimeout, 1);
    const rejected = await prepareHookLaunchRuntime(mode, {
      GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS: "0",
    });
    assert.deepEqual(rejected, {
      failureReason: `hook timeout configuration is invalid: GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS="0" must be a whole number of milliseconds from 1 to ${deadline}`,
    });
  }
  for (const mode of [
    "",
    "unknown",
    "codex:post-turn",
    "unknown:policy:goat-flow.hook-result.v1:pre-tool:1:25000",
    "codex:policy:goat-flow.hook-result.v1:pre-tool:1:0",
  ]) {
    assert.deepEqual(await prepareHookLaunchRuntime(mode, {}), {
      failureReason: "hook launch contract is invalid",
    });
  }
});

test("native startup reports missing or invalid packaged adapters while legacy startup stays usable", (t) => {
  const { root } = fixture(t);
  for (const module of [
    "hook-launch.mjs",
    "hook-supervisor.mjs",
    "hook-output.mjs",
    "process-tree.mjs",
  ]) {
    copyFileSync(
      fileURLToPath(new URL(`../../workflow/hooks/${module}`, import.meta.url)),
      join(root, module),
    );
  }
  const launcherUrl = pathToFileURL(join(root, "hook-launch.mjs")).href;
  const probe = `const {prepareHookLaunchRuntime}=await import(${JSON.stringify(launcherUrl)}); console.log(JSON.stringify(await prepareHookLaunchRuntime(process.argv[1], {})))`;
  const mode = "codex:post-turn:goat-flow.hook-result.v1:turn-stop:1:75000";
  for (const malformedAdapter of [false, true]) {
    if (malformedAdapter)
      writeFileSync(
        join(root, "hook-provider-adapters.mjs"),
        "export const invalid = ;",
      );
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", probe, mode],
      {
        cwd: root,
        env: { ...process.env, PATH: "" },
        encoding: "utf8",
        timeout: 10000,
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      failureReason: "hook provider adapter could not load",
    });
    const legacy = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", probe, "policy"],
      {
        cwd: root,
        env: { ...process.env, PATH: "" },
        encoding: "utf8",
        timeout: 10000,
      },
    );
    assert.equal(legacy.error, undefined);
    assert.equal(legacy.status, 0, legacy.stderr);
    assert.equal(legacy.stderr, "");
    const prepared = JSON.parse(legacy.stdout);
    assert.equal(prepared.failureReason, null);
    assert.equal(prepared.launchTimeout, 25000);
  }
});

/** Run the real policy reader in a native process; the marker means the caller may continue to its evaluator. */
function policyChoiceResult(
  root: string,
  hook: string,
  mode: string,
  moduleUrl = new URL("../../workflow/hooks/hook-launch.mjs", import.meta.url)
    .href,
) {
  const probe = `const {policyChoiceBeforeNativeLaunch}=await import(${JSON.stringify(moduleUrl)}); const status=await policyChoiceBeforeNativeLaunch(process.argv[1],process.argv[2],process.argv[3]); if(status===null) process.stdout.write("continue\\n"); else process.exitCode=status;`;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", probe, root, hook, mode],
    {
      cwd: root,
      env: { ...process.env, PATH: "" },
      encoding: "utf8",
      timeout: 5000,
    },
  );
  assert.equal(result.error, undefined);
  return result;
}

test("native policy choices keep defaults enabled and honor each independent opt-out", (t) => {
  const { root } = fixture(t);
  for (const hook of ["deny-dangerous", "deny-git-mutations"]) {
    const result = policyChoiceResult(root, hook, "policy");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "continue\n");
    assert.equal(result.stderr, "");
  }
  mkdirSync(join(root, ".goat-flow"));
  const config = join(root, ".goat-flow/config.yaml");
  for (const disabled of ["deny-dangerous", "deny-git-mutations"]) {
    const enabled =
      disabled === "deny-dangerous" ? "deny-git-mutations" : "deny-dangerous";
    writeFileSync(
      config,
      `hooks:\n  ${disabled}: {enabled: false}\n  ${enabled}: {enabled: true}\n`,
    );
    for (const mode of ["policy", "antigravity", "copilot"]) {
      const off = policyChoiceResult(root, disabled, mode);
      assert.equal(off.status, 0, off.stderr);
      assert.equal(
        off.stdout,
        mode === "antigravity" ? '{"decision":"allow"}\n' : "",
      );
      assert.equal(off.stderr, "");
      const on = policyChoiceResult(root, enabled, mode);
      assert.equal(on.status, 0, on.stderr);
      assert.equal(on.stdout, "continue\n");
      assert.equal(on.stderr, "");
    }
  }
});

test("native policy choices return the existing provider repair responses for invalid saved settings", (t) => {
  const { root } = fixture(t);
  mkdirSync(join(root, ".goat-flow"));
  const reason =
    "Policy hook unavailable: deny-dangerous: policy configuration or reader is unavailable.";
  for (const config of [
    "[",
    'hooks: {deny-dangerous: {enabled: "false"}}',
    "hooks: {deny-dangerous: {enabled: false}, deny-git-mutations: {enabled: nope}}",
    "hooks: {deny-dangerous: {enabled: false}, guard-secret-paths: {enabled: true}}",
  ]) {
    writeFileSync(join(root, ".goat-flow/config.yaml"), config);
    for (const mode of ["policy", "antigravity", "copilot"]) {
      const result = policyChoiceResult(root, "deny-dangerous", mode);
      assert.equal(result.status, mode === "policy" ? 2 : 0, result.stderr);
      assert.equal(
        result.stderr,
        mode === "policy" ? "BLOCKED: " + reason + "\n" : "",
      );
      assert.equal(
        result.stdout,
        mode === "antigravity"
          ? JSON.stringify({ decision: "deny", reason }) + "\n"
          : mode === "copilot"
            ? JSON.stringify({
                permissionDecision: "deny",
                permissionDecisionReason: reason,
              }) + "\n"
            : "",
      );
    }
  }
});

test("native policy choices preserve unsupported-mode and unrelated-hook behavior", (t) => {
  const { root } = fixture(t);
  for (const [mode, status, stdout, stderr] of [
    [
      "unknown",
      2,
      "",
      "BLOCKED: Policy hook unavailable: deny-dangerous: unsupported policy response mode.\n",
    ],
    [
      "gruff",
      0,
      "",
      "gruff-code-quality: hook unavailable: unsupported policy response mode; skipped.\n",
    ],
    [
      "post-turn",
      2,
      "",
      "post-turn-safety: hook unavailable: unsupported policy response mode.\n",
    ],
    [
      "codex:policy:goat-flow.hook-result.v1:pre-tool:1:25000",
      2,
      "",
      "BLOCKED: Policy hook unavailable: deny-dangerous: unsupported policy response mode.\n",
    ],
    [
      "antigravity:policy:goat-flow.hook-result.v1:pre-tool:1:25000",
      0,
      '{"decision":"deny","reason":"Policy hook unavailable: deny-dangerous: unsupported policy response mode."}\n',
      "",
    ],
  ] as const) {
    const result = policyChoiceResult(root, "deny-dangerous", mode);
    assert.equal(result.status, status, result.stderr);
    assert.equal(result.stdout, stdout);
    assert.equal(result.stderr, stderr);
  }
  const unrelated = policyChoiceResult(root, "post-turn-safety", "post-turn");
  assert.equal(unrelated.status, 0, unrelated.stderr);
  assert.equal(unrelated.stdout, "continue\n");
  assert.equal(unrelated.stderr, "");
});

test("native policy choices report a missing reader or invalid reader API without disabling protection", (t) => {
  const { root } = fixture(t);
  for (const module of [
    "hook-launch.mjs",
    "hook-supervisor.mjs",
    "hook-output.mjs",
    "process-tree.mjs",
  ]) {
    copyFileSync(
      fileURLToPath(new URL(`../../workflow/hooks/${module}`, import.meta.url)),
      join(root, module),
    );
  }
  const url = pathToFileURL(join(root, "hook-launch.mjs")).href;
  for (const invalidReader of [false, true]) {
    if (invalidReader)
      writeFileSync(
        join(root, "hook-policy-state.cjs"),
        "module.exports = {};",
      );
    const result = policyChoiceResult(
      root,
      "deny-git-mutations",
      "policy",
      url,
    );
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      "BLOCKED: Policy hook unavailable: deny-git-mutations: policy configuration or reader is unavailable.\n",
    );
    const unrelated = policyChoiceResult(
      root,
      "gruff-code-quality",
      "gruff",
      url,
    );
    assert.equal(unrelated.status, 0, unrelated.stderr);
    assert.equal(unrelated.stdout, "continue\n");
    assert.equal(unrelated.stderr, "");
  }
});
