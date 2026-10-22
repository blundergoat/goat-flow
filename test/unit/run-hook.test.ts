/** Real CLI fixtures prove that native launch stages are wired in the required order. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { restrictedConsumerEnvironment } from "../helpers/restricted-consumer-env.js";

const codexStop = "codex:post-turn:goat-flow.hook-result.v1:turn-stop:1:75000";

/** Copy only the hook tree into one selected project; teardown owns its complete temporary parent. */
function fixture(t: TestContext) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "goat-native-cli-")));
  const root = join(parent, "project '$& 🐐");
  const hooks = join(root, ".goat-flow/hooks");
  mkdirSync(hooks, { recursive: true });
  cpSync(
    fileURLToPath(new URL("../../workflow/hooks", import.meta.url)),
    hooks,
    { recursive: true },
  );
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  writeFileSync(
    join(hooks, "fixture.mjs"),
    'process.stdout.write("complete\\n");',
  );
  return { root, hooks };
}

/** Invoke the installed CLI with literal argv, finite stdin and no shell on PATH. */
function run(
  root: string,
  script = ".goat-flow/hooks/fixture.mjs",
  mode = "policy",
  input = "",
  env: NodeJS.ProcessEnv = {},
) {
  const result = spawnSync(
    process.execPath,
    [join(root, ".goat-flow/hooks/run-hook.mjs"), script, mode],
    {
      cwd: root,
      env: { ...process.env, PATH: "", ...env },
      input,
      encoding: "utf8",
      timeout: 10000,
    },
  );
  assert.equal(result.error, undefined);
  return result;
}

/** Identify one explicit provider turn; true is its continuation rather than another user turn. */
function stopInput(active: boolean) {
  return JSON.stringify({
    hook_event_name: "Stop",
    session_id: "fixture-session",
    turn_id: "fixture-turn",
    stop_hook_active: active,
  });
}

// Writes a native evaluator fixture; PID and byte checks expose extra Node processes or consumed stdin.
test("native imported API preserves the selected root and stdin without an intermediate Node process", (t) => {
  const { root, hooks } = fixture(t);
  writeFileSync(
    join(hooks, "fixture.mjs"),
    'import { readFileSync } from "node:fs";import { argv, cwd, env, ppid } from "node:process";process.stdout.write(JSON.stringify({args:argv.slice(2),cwd:cwd(),input:readFileSync(0,"utf8"),directParent:String(ppid)===env.GOAT_FLOW_TEST_NATIVE_PARENT_PID}));',
  );
  const program = `
    import { cwd, env, pid } from "node:process";
    const originalDirectory=cwd();
    const {runHookNative}=await import(${JSON.stringify(pathToFileURL(join(hooks, "run-hook.mjs")).href)});
    env.GOAT_FLOW_TEST_NATIVE_PARENT_PID=String(pid);
    process.exitCode=await runHookNative(".goat-flow/hooks/fixture.mjs","policy",{root:${JSON.stringify(root)}});
    if(cwd()!==originalDirectory)throw new Error("native API changed the caller working directory");
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", program],
    {
      cwd: dirname(root),
      env: { ...process.env, PATH: "" },
      input: " original imported 🐐 bytes\n",
      encoding: "utf8",
      timeout: 10000,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), {
    args: ["--root", root],
    cwd: root,
    input: " original imported 🐐 bytes\n",
    directParent: true,
  });
});

test("native CLI forwards the selected root, original stdin and literal evaluator arguments", (t) => {
  const { root, hooks } = fixture(t);
  writeFileSync(
    join(hooks, "fixture.mjs"),
    'import fs from "node:fs";process.stdout.write(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),input:fs.readFileSync(0,"utf8"),owner:process.env.GOAT_FLOW_STOP_RECOVERY_OWNER??null}));',
  );
  const result = run(root, undefined, undefined, " original 🐐 bytes\n", {
    GOAT_FLOW_STOP_RECOVERY_OWNER: "launcher",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    args: ["--root", root],
    cwd: root,
    input: " original 🐐 bytes\n",
    owner: null,
  });
});

test("native CLI rejects missing, escaped and non-file scripts before an opt-out", (t) => {
  const { root, hooks } = fixture(t);
  mkdirSync(join(hooks, "directory.mjs"));
  for (const [script, reason] of [
    ["../outside.mjs", /escaped the project root/u],
    [".goat-flow/hooks/missing.mjs", /was not found/u],
    [".goat-flow/hooks/directory.mjs", /not a regular file/u],
  ] as const) {
    const result = run(root, script);
    assert.equal(result.status, 2);
    assert.match(result.stderr, reason);
    assert.equal(result.stdout, "");
  }
  writeFileSync(
    join(root, ".goat-flow/config.yaml"),
    "hooks:\n  deny-dangerous:\n    enabled: false\n",
  );
  // The missing-path control must not depend on which hooks the package ships.
  rmSync(join(hooks, "deny-dangerous.mjs"));
  assert.equal(run(root, ".goat-flow/hooks/deny-dangerous.mjs").status, 2);
});

test("native CLI honors independent saved opt-outs before invalid deadline settings", (t) => {
  const { root, hooks } = fixture(t);
  for (const name of ["deny-dangerous", "deny-git-mutations"]) {
    writeFileSync(
      join(hooks, name + ".mjs"),
      'process.stdout.write("evaluated\\n");',
    );
    writeFileSync(
      join(root, ".goat-flow/config.yaml"),
      `hooks:\n  ${name}:\n    enabled: false\n`,
    );
    const disabled = run(
      root,
      `.goat-flow/hooks/${name}.mjs`,
      "antigravity",
      "",
      { GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS: "invalid" },
    );
    assert.equal(disabled.status, 0, disabled.stderr);
    assert.equal(disabled.stdout, '{"decision":"allow"}\n');
    assert.equal(disabled.stderr, "");
    const other =
      name === "deny-dangerous" ? "deny-git-mutations" : "deny-dangerous";
    writeFileSync(
      join(hooks, other + ".mjs"),
      'process.stdout.write("evaluated\\n");',
    );
    assert.equal(
      run(root, `.goat-flow/hooks/${other}.mjs`).stdout,
      "evaluated\n",
    );
  }
  const invalid = run(root, undefined, undefined, "", {
    GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS: "invalid",
  });
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /hook timeout configuration is invalid/u);
});

test("native CLI bounds Claude startup recovery while healthy feedback retains stdin", (t) => {
  const { root, hooks } = fixture(t);
  assert.equal(
    run(root, "missing.mjs", "post-turn", stopInput(false)).status,
    2,
  );
  const repeated = run(root, "missing.mjs", "post-turn", stopInput(true));
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.match(repeated.stderr, /no clean scan was recorded/u);
  writeFileSync(
    join(hooks, "fixture.mjs"),
    'import fs from "node:fs";process.stdout.write(fs.readFileSync(0,"utf8"));process.exitCode=2;',
  );
  const healthy = run(root, undefined, "post-turn", "original feedback input");
  assert.equal(healthy.status, 2);
  assert.equal(healthy.stdout, "original feedback input");
});

test("native CLI recovers Codex startup faults even when its provider adapter is missing", (t) => {
  const { root, hooks } = fixture(t);
  rmSync(join(hooks, "hook-provider-adapters.mjs"));
  const invalid = run(
    root,
    "missing.mjs",
    codexStop,
    '{"stop_hook_active":true}',
  );
  assert.equal(JSON.parse(invalid.stdout).decision, "block");
  const initial = run(root, "missing.mjs", codexStop, stopInput(false));
  assert.equal(initial.status, 0, initial.stderr);
  assert.equal(JSON.parse(initial.stdout).decision, "block");
  const repeated = run(root, "missing.mjs", codexStop, stopInput(true));
  assert.equal(repeated.status, 0, repeated.stderr);
  const warning = JSON.parse(repeated.stdout);
  assert.equal(warning.decision, undefined);
  assert.equal(warning.continue, undefined);
  assert.match(warning.systemMessage, /bounded-reentry-ended.*coverage none/u);
});

test("native CLI delegates recovery only after preserving a valid Codex input and provider identity", (t) => {
  const { root, hooks } = fixture(t);
  const input =
    " \n" + stopInput(false).replace("fixture-session", "fixture-🐐") + "\n";
  const envelope = {
    schema: "goat-flow.hook-result.v1",
    hookId: "post-turn-safety",
    event: "turn-stop",
    outcome: "pass",
    coverage: {
      status: "complete",
      attemptedUnits: 1,
      completedUnits: 1,
      skippedUnits: 0,
    },
    reasonCode: "completed-clean",
    findings: [],
    execution: {
      hookVersion: "fixture",
      provider: "codex",
      providerMode: "managed",
      adapterName: "codex-turn-stop",
      adapterVersion: "1",
      durationMs: 1,
    },
  };
  writeFileSync(
    join(hooks, "fixture.mjs"),
    `import assert from "node:assert/strict";import fs from "node:fs";import { argv, env } from "node:process";
    assert.equal(fs.readFileSync(0,"utf8"),${JSON.stringify(input)});
    assert.deepEqual(argv.slice(2),["--root",${JSON.stringify(root)}]);
    assert.equal(env.GOAT_FLOW_STOP_RECOVERY_OWNER,"launcher");
    assert.equal(env.GOAT_FLOW_HOOK_PROVIDER,"codex");
    process.stdout.write(${JSON.stringify(JSON.stringify(envelope))});`,
  );
  const result = run(root, undefined, codexStop, input, {
    GOAT_FLOW_STOP_RECOVERY_OWNER: "scanner",
    GOAT_FLOW_HOOK_PROVIDER: "copilot",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("native CLI enforces its configured deadline before releasing partial policy output", (t) => {
  const { root, hooks } = fixture(t);
  const marker = join(root, "started");
  writeFileSync(
    join(hooks, "fixture.mjs"),
    `import fs from "node:fs";fs.writeFileSync(${JSON.stringify(marker)},"started");process.stdout.write("untrusted partial output");setInterval(()=>{},1000);`,
  );
  const environment = restrictedConsumerEnvironment(root);
  const result = run(root, undefined, undefined, "", {
    ...environment,
    GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS: "3000",
  });
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stdout, "");
  assert.match(
    result.stderr,
    /exceeded its deadline; process-tree termination was requested/u,
  );
  assert.equal(existsSync(marker), true);
  assert.ok(environment.GOAT_TEST_SPAWN_LOG);
  const journal = readFileSync(environment.GOAT_TEST_SPAWN_LOG, "utf8")
    .trim()
    .split("\n")
    .map((row) => JSON.parse(row));
  assert.ok(journal.some((event) => event.event === "loaded"));
  assert.deepEqual(
    journal.filter((event) => event.event === "denied"),
    [],
  );
});

test("native CLI interrupts a blocking regex without trusting its partial policy reply", (t) => {
  const { root, hooks } = fixture(t);
  const marker = join(root, "regex-started");
  // This deliberately pathological fixture blocks the evaluator's event loop, including any local timer.
  writeFileSync(
    join(hooks, "fixture.mjs"),
    `import {writeFileSync} from "node:fs";writeFileSync(${JSON.stringify(marker)},"started");process.stdout.write("incomplete allow");/^(a+)+$/u.test("a".repeat(10000)+"!");`,
  );
  const environment = restrictedConsumerEnvironment(root);
  const result = run(root, undefined, undefined, "", {
    ...environment,
    GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS: "2000",
  });
  assert.equal(existsSync(marker), true, "regex evaluator must start");
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stdout, "");
  assert.match(
    result.stderr,
    /exceeded its deadline; process-tree termination was requested/u,
  );
  assert.ok(environment.GOAT_TEST_SPAWN_LOG);
  const journal = readFileSync(environment.GOAT_TEST_SPAWN_LOG, "utf8")
    .trim()
    .split("\n")
    .map((row) => JSON.parse(row));
  assert.ok(journal.some((event) => event.event === "loaded"));
  assert.deepEqual(
    journal.filter((event) => event.event === "denied"),
    [],
  );
});
