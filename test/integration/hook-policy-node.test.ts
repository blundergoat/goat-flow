/** Real candidate entrypoints preserve unavailable reporting and implemented launcher choices. */
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

// Policy and Stop failures block; Gruff reports an advisory skip. None is a completed evaluation.
for (const [hookIdentifier, expectedStatus] of [
  ["deny-dangerous", 2],
  ["deny-git-mutations", 2],
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
    if (
      hookIdentifier === "deny-dangerous" ||
      hookIdentifier === "deny-git-mutations"
    ) {
      const actual = {
        status: result.status,
        stdoutBase64: Buffer.from(result.stdout).toString("base64"),
        stderrBase64: Buffer.from(result.stderr).toString("base64"),
      };
      assert.throws(() => assertOutcome(actual, actual), /unavailable:/u);
    }
  });
}

for (const policyIdentifier of ["deny-dangerous", "deny-git-mutations"]) {
  test(`candidate launcher honors the saved ${policyIdentifier} opt-out before unported evaluation`, (testContext) => {
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
