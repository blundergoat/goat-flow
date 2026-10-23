/** Real candidate entrypoints decide policy, scan edits and honor saved launcher choices without a shell fallback. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { assertOutcome } from "../../scripts/check-hook-parity.mjs";
import { hookTreeRoot, selectedHookPath } from "../helpers/hook-entrypoint.js";
import { restrictedConsumerEnvironment } from "../helpers/restricted-consumer-env.js";

/** Writes a complete candidate fixture; teardown removes only its disposable project. */
function candidateFixture(testContext: TestContext) {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "goat-candidate-scaffold-")),
  );
  const hooks = join(root, ".goat-flow/hooks");
  mkdirSync(hooks, { recursive: true });
  cpSync(hookTreeRoot("workflow", "candidate"), hooks, { recursive: true });
  testContext.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, hooks, environment: restrictedConsumerEnvironment(root) };
}

/** Read the fixture's spawn journal and require that no child process was denied. */
function assertNoSpawnDenials(environment: NodeJS.ProcessEnv): void {
  assert.ok(environment.GOAT_TEST_SPAWN_LOG);
  const journal = readFileSync(environment.GOAT_TEST_SPAWN_LOG, "utf8")
    .trim()
    .split("\n")
    .map((row) => JSON.parse(row));
  assert.ok(journal.some((observation) => observation.event === "loaded"));
  assert.deepEqual(
    journal.filter((observation) => observation.event === "denied"),
    [],
  );
}

/** Run one candidate entrypoint directly, as the launcher does, with `--root` first. */
function runEntrypoint(
  testContext: TestContext,
  policy: string,
  args: string[],
  input = "",
) {
  const { root, hooks, environment } = candidateFixture(testContext);
  const entrypoint = selectedHookPath(join(hooks, policy + ".sh"), "candidate");
  const result = spawnSync(
    process.execPath,
    [entrypoint, "--root", root, ...args],
    { cwd: root, env: environment, input, encoding: "utf8", timeout: 20000 },
  );
  assert.equal(result.error, undefined);
  assertNoSpawnDenials(environment);
  return result;
}

// Stop failures block; Gruff reports an advisory skip. Neither is a completed evaluation.
for (const [hookIdentifier, expectedStatus, diagnostic] of [
  ["post-turn-safety", 2, /^Usage: post-turn-safety\.mjs \[--self-test\]\n$/u],
  [
    "gruff-code-quality",
    2,
    /^Usage: gruff-code-quality\.mjs \[--self-test\|--self-test=smoke\]\n$/u,
  ],
] as const) {
  test(
    hookIdentifier === "post-turn-safety"
      ? "post-turn-safety candidate refuses unsupported work without a shell fallback"
      : `${hookIdentifier} candidate refuses unsupported work without a shell fallback`,
    (testContext) => {
      const { root, hooks, environment } = candidateFixture(testContext);
      const entrypoint = selectedHookPath(
        join(hooks, hookIdentifier + ".sh"),
        "candidate",
      );
      const result = spawnSync(
        process.execPath,
        [entrypoint, "--root", root, "--check", "echo harmless"],
        {
          cwd: root,
          env: environment,
          input: "",
          encoding: "utf8",
          timeout: 10000,
        },
      );
      assert.equal(result.error, undefined);
      assert.equal(result.status, expectedStatus, result.stderr);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, diagnostic);
      if (hookIdentifier === "post-turn-safety") {
        const initialized = spawnSync("git", ["init", "-q", root], {
          cwd: root,
          env: environment,
          encoding: "utf8",
          timeout: 10000,
        });
        assert.equal(initialized.status, 0, initialized.stderr);
        const selfTest = spawnSync(
          process.execPath,
          [entrypoint, "--self-test"],
          {
            cwd: root,
            env: environment,
            input: "",
            encoding: "utf8",
            timeout: 10000,
          },
        );
        assert.equal(selfTest.error, undefined);
        assert.equal(selfTest.status, 0, selfTest.stderr);
        assert.match(selfTest.stdout, /post-turn-safety self-test: ok/u);
        assert.equal(selfTest.stderr, "");
        // Ignoring every fixture file leaves nothing to scan, so the native scan must finish clean.
        writeFileSync(join(root, ".gitignore"), "*\n");
        const scanned = spawnSync(process.execPath, [entrypoint], {
          cwd: root,
          env: environment,
          input: "",
          encoding: "utf8",
          timeout: 10000,
        });
        assert.equal(scanned.error, undefined);
        assert.equal(scanned.status, 0, scanned.stderr);
        assert.equal(scanned.stdout, "");
        assert.equal(scanned.stderr, "");
      }
      assertNoSpawnDenials(environment);
    },
  );
}

// Writes a disposable repository with an untracked token, then sends two Stops through the native launcher, which passes --root first.
// A refused --root would block once and then release the repeated Stop without scanning.
test("candidate launcher scans the selected project on a repeated post-turn Stop", (testContext) => {
  const { root, hooks, environment } = candidateFixture(testContext);
  const gitOptions = { cwd: root, env: environment, encoding: "utf8" as const };
  assert.equal(spawnSync("git", ["init", "-q"], gitOptions).status, 0);
  const identity = [
    "-c",
    "user.name=goat-flow-test",
    "-c",
    "user.email=goat-flow-test@example.invalid",
  ];
  const commit = spawnSync(
    "git",
    [...identity, "commit", "-q", "--allow-empty", "-m", "base"],
    gitOptions,
  );
  assert.equal(commit.status, 0, commit.stderr);
  writeFileSync(join(root, ".gitignore"), ".goat-flow/\n");
  // Fragments keep a token-shaped literal out of this file.
  writeFileSync(
    join(root, "leak.txt"),
    `key ${["AKIA", "1234567890ABCDEF"].join("")}\n`,
  );
  const launcher = selectedHookPath(
    join(hooks, "run-with-bash.mjs"),
    "candidate",
  );
  const entrypoint = selectedHookPath(
    join(hooks, "post-turn-safety.sh"),
    "candidate",
  );
  for (const isContinuation of [false, true]) {
    const result = spawnSync(
      process.execPath,
      [
        launcher,
        entrypoint,
        "codex:post-turn:goat-flow.hook-result.v1:turn-stop:1:75000",
      ],
      {
        cwd: root,
        env: environment,
        input: JSON.stringify({
          hook_event_name: "Stop",
          session_id: "launcher-root",
          turn_id: "turn-1",
          stop_hook_active: isContinuation,
        }),
        encoding: "utf8",
        timeout: 20000,
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    const reply = JSON.parse(result.stdout) as {
      decision?: string;
      reason?: string;
    };
    assert.equal(reply.decision, "block", result.stdout);
    assert.match(reply.reason ?? "", /post-turn-safety: BLOCK/u);
    assert.match(reply.reason ?? "", /leak\.txt/u);
  }
  assertNoSpawnDenials(environment);
});

// Use the real process boundary to catch permissive decoding or byte-limit regressions.
test("post-turn-safety candidate rejects invalid Stop fields and bytes without a shell fallback", (testContext) => {
  const { root, hooks, environment } = candidateFixture(testContext);
  const entrypoint = selectedHookPath(
    join(hooks, "post-turn-safety.sh"),
    "candidate",
  );
  const validPayload = JSON.stringify({
    session_id: "stop-input-boundary",
    stop_hook_active: false,
  });
  const inputs = {
    "null payload": "null",
    "missing fields": "{}",
    "empty session": JSON.stringify({
      session_id: "",
      stop_hook_active: false,
    }),
    "oversized session": JSON.stringify({
      session_id: "s".repeat(513),
      stop_hook_active: false,
    }),
    "nonboolean active flag": JSON.stringify({
      session_id: "s",
      stop_hook_active: "false",
    }),
    "wrong event": JSON.stringify({
      session_id: "s",
      stop_hook_active: false,
      hook_event_name: "PreToolUse",
    }),
    "invalid UTF-8": Buffer.concat([
      Buffer.from('{"session_id":"'),
      Buffer.from([0xff]),
      Buffer.from('","stop_hook_active":false}'),
    ]),
    "BOM prefix": `\uFEFF${validPayload}`,
    "multibyte byte limit": JSON.stringify({
      session_id: "s",
      stop_hook_active: false,
      padding: "€".repeat(350000),
    }),
  };

  for (const [label, input] of Object.entries(inputs)) {
    const result = spawnSync(process.execPath, [entrypoint], {
      cwd: root,
      env: environment,
      input,
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(result.error, undefined, label);
    assert.equal(result.status, 2, `${label}: ${result.stderr}`);
    assert.equal(result.stdout, "", label);
    assert.match(result.stderr, /invalid Stop payload/u, label);
    if (label === "multibyte byte limit")
      assert.match(result.stderr, /payload exceeds 1048576 bytes/u, label);
  }
  assertNoSpawnDenials(environment);
});

for (const [policy, denied, stderr] of [
  [
    "deny-dangerous",
    "rm -rf /",
    "BLOCKED: Policy destructive: rm -r without safe scoping. Only for already-approved deletion: use rm on each reviewed literal file, then rmdir on the empty directory. Confirm targets before deleting 5+ files; secret and human-only restrictions still apply.\n",
  ],
  [
    "deny-git-mutations",
    "git push origin main",
    "BLOCKED: Policy repository: Git publication is not allowed. Ask the user to push manually.\n",
  ],
] as const) {
  test(`${policy} candidate decides --check text after the launcher's --root`, (testContext) => {
    const deny = runEntrypoint(testContext, policy, ["--check", denied]);
    assert.equal(deny.status, 2, deny.stderr);
    assert.equal(deny.stdout, "");
    assert.equal(deny.stderr, stderr);
    const allow = runEntrypoint(testContext, policy, [
      "--check",
      "echo harmless",
    ]);
    const actual = {
      status: allow.status ?? -1,
      stdoutBase64: Buffer.from(allow.stdout).toString("base64"),
      stderrBase64: Buffer.from(allow.stderr).toString("base64"),
    };
    assertOutcome(actual, { status: 0, stdoutBase64: "", stderrBase64: "" });
  });

  test(`candidate launcher delivers the ${policy} decision for a stdin payload`, (testContext) => {
    const { root, hooks, environment } = candidateFixture(testContext);
    writeFileSync(
      join(root, ".goat-flow/config.yaml"),
      `hooks:\n  ${policy}:\n    enabled: true\n`,
    );
    const launcher = selectedHookPath(
      join(hooks, "run-with-bash.mjs"),
      "candidate",
    );
    const entrypoint = selectedHookPath(
      join(hooks, policy + ".sh"),
      "candidate",
    );
    for (const [command, status, expected] of [
      [denied, 2, stderr],
      ["echo harmless", 0, ""],
    ] as const) {
      const result = spawnSync(
        process.execPath,
        [launcher, entrypoint, "policy"],
        {
          cwd: root,
          env: environment,
          input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
          encoding: "utf8",
          timeout: 20000,
        },
      );
      assert.equal(result.error, undefined);
      assert.equal(result.status, status, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, expected);
    }
    assertNoSpawnDenials(environment);
  });

  test(`${policy} candidate self-test runs every smoke row it owns`, (testContext) => {
    const corpus = JSON.parse(
      readFileSync(
        join(
          hookTreeRoot("workflow", "candidate"),
          "deny-dangerous/corpus.json",
        ),
        "utf8",
      ),
    ) as {
      rows: {
        policy: string;
        membership: string[];
        availabilityCase: boolean;
      }[];
    };
    const smoke = corpus.rows.filter((row) => row.membership.includes("smoke"));
    const executed = smoke.filter(
      (row) => row.policy === policy && !row.availabilityCase,
    ).length;
    const passed = runEntrypoint(testContext, policy, ["--self-test=smoke"]);
    assert.equal(passed.status, 0, passed.stderr);
    assert.equal(
      passed.stdout,
      `PASS: ${policy} self-test (mode=smoke, executed=${executed}, skipped=${smoke.length - executed})\n`,
    );
    assert.equal(passed.stderr, "");
    const unsupported = runEntrypoint(testContext, policy, [
      "--self-test=fast",
    ]);
    assert.equal(unsupported.status, 1);
    assert.equal(unsupported.stdout, "");
    assert.equal(
      unsupported.stderr,
      "FAIL: unsupported self-test mode: fast\n",
    );
  });
}

test("candidate entrypoints answer JSON providers on stdout and route tool ownership", (testContext) => {
  const copilot = runEntrypoint(
    testContext,
    "deny-git-mutations",
    [],
    '{"toolName":"bash","toolArgs":"{\\"command\\":\\"git push\\"}"}',
  );
  assert.equal(copilot.status, 0);
  assert.equal(JSON.parse(copilot.stdout).permissionDecision, "deny");
  const antigravity = runEntrypoint(
    testContext,
    "deny-dangerous",
    [],
    '{"toolCall":{"name":"run_command","args":{"CommandLine":"echo ok"}}}',
  );
  assert.equal(antigravity.status, 0);
  assert.equal(antigravity.stdout, '{"decision":"allow"}\n');
  const unowned = runEntrypoint(
    testContext,
    "deny-git-mutations",
    [],
    '{"tool_name":"Read","tool_input":{"file_path":".env"}}',
  );
  assert.deepEqual(
    [unowned.status, unowned.stdout, unowned.stderr],
    [0, "", ""],
  );
  const conflict = runEntrypoint(
    testContext,
    "deny-dangerous",
    ["echo hi"],
    '{"tool_name":"Bash","tool_input":{"command":"rm -rf /"}}',
  );
  assert.equal(conflict.status, 2);
  assert.equal(
    conflict.stderr,
    "BLOCKED: Policy deny-dangerous: Hook received both positional command and stdin payload. Submit exactly one command source.\n",
  );
});

for (const policyIdentifier of ["deny-dangerous", "deny-git-mutations"]) {
  test(`candidate launcher honors the saved ${policyIdentifier} opt-out before evaluation`, (testContext) => {
    const { root, hooks, environment } = candidateFixture(testContext);
    writeFileSync(
      join(root, ".goat-flow/config.yaml"),
      `hooks:\n  ${policyIdentifier}:\n    enabled: false\n`,
    );
    const launcher = selectedHookPath(
      join(hooks, "run-with-bash.mjs"),
      "candidate",
    );
    const entrypoint = selectedHookPath(
      join(hooks, policyIdentifier + ".sh"),
      "candidate",
    );
    const result = spawnSync(
      process.execPath,
      [launcher, entrypoint, "policy"],
      {
        cwd: root,
        env: environment,
        input: "",
        encoding: "utf8",
        timeout: 10000,
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.ok(environment.GOAT_TEST_SPAWN_LOG);
    const journal = readFileSync(environment.GOAT_TEST_SPAWN_LOG, "utf8")
      .trim()
      .split("\n")
      .map((row) => JSON.parse(row));
    assert.ok(journal.some((observation) => observation.event === "loaded"));
    assert.deepEqual(
      journal.filter((observation) => observation.event === "denied"),
      [],
    );
    assert.deepEqual(
      journal.filter((observation) => observation.event === "allowed"),
      [],
    );
  });
}

/** Delay a provider payload until the child has started waiting on its pipe. */
async function delayedPolicyInput(
  context: TestContext,
  policy: string,
  isIncomplete: boolean,
) {
  const { root, hooks, environment } = candidateFixture(context);
  if (isIncomplete) rmSync(join(hooks, "policy-evaluation.mjs"));
  const payload = isIncomplete
    ? { toolName: "bash", toolArgs: { command: "echo safe" } }
    : { tool_name: "PowerShell", tool_input: { command: "echo safe" } };
  const child = spawn(process.execPath, [join(hooks, `${policy}.mjs`)], {
    cwd: root,
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  child.stdin.on("error", () => {});
  const result = await new Promise<{
    status: number | null;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    const send = setTimeout(
      () => child.stdin.end(JSON.stringify(payload)),
      400,
    );
    const deadline = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("delayed policy input timed out"));
    }, 5000);
    child.once("error", reject);
    child.once("close", (status) => {
      clearTimeout(send);
      clearTimeout(deadline);
      resolve({ status, stdout, stderr });
    });
  });
  assertNoSpawnDenials(environment);
  return result;
}

for (const policy of ["deny-dangerous", "deny-git-mutations"]) {
  for (const isIncomplete of [false, true]) {
    test(`${policy} waits for delayed provider input with ${isIncomplete ? "missing" : "healthy"} modules`, async (context) => {
      const result = await delayedPolicyInput(context, policy, isIncomplete);
      if (isIncomplete) {
        assert.equal(result.status, 0, result.stderr);
        const response = JSON.parse(result.stdout);
        assert.equal(response.permissionDecision, "deny");
        assert.match(
          response.permissionDecisionReason,
          /Policy hook unavailable/u,
        );
        assert.equal(result.stderr, "");
      } else {
        assert.equal(result.status, 2, result.stderr);
        assert.equal(result.stdout, "");
        assert.match(result.stderr, /Native PowerShell tool commands/u);
        assert.doesNotMatch(result.stderr, /Policy hook unavailable/u);
      }
    });
  }
}
