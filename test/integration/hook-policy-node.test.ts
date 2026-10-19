/** Real candidate entrypoints decide policy natively, report unported hooks unavailable and honor launcher choices. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
for (const [hookIdentifier, expectedStatus] of [
  ["post-turn-safety", 2],
  ["gruff-code-quality", 0],
] as const) {
  test(`unported ${hookIdentifier} candidate reports unavailable without a shell fallback`, (testContext) => {
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
    assert.match(result.stderr, /hook unavailable/u);
    assertNoSpawnDenials(environment);
  });
}

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
