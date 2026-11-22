/** Exercise corpus integrity through the public Node self-test entrypoints. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const sourceHooks = resolve(import.meta.dirname, "../../workflow/hooks");

function allowRow(policy: string, membership = ["smoke", "full"]) {
  return {
    id: "fixture-" + policy,
    policy,
    membership,
    input: { kind: "check", command: "echo safe" },
    setup: { cwd: "$REFERENCE", files: [], environment: {} },
    availabilityCase: false,
    expected: { status: 0, stdoutBase64: "", stderrBase64: "" },
    predicates: { requiresAvailable: true },
  };
}

function selfTest(policy: string, corpus: unknown) {
  const root = mkdtempSync(join(tmpdir(), "goat-corpus-integrity-"));
  const hooks = join(root, "hooks");
  try {
    cpSync(sourceHooks, hooks, { recursive: true });
    writeFileSync(
      join(hooks, "deny-dangerous/corpus.json"),
      JSON.stringify(corpus),
    );
    return spawnSync(
      process.execPath,
      [join(hooks, policy + ".mjs"), "--self-test=full"],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 10000,
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

for (const policy of ["deny-dangerous", "deny-git-mutations"]) {
  const other =
    policy === "deny-dangerous" ? "deny-git-mutations" : "deny-dangerous";
  for (const fixture of [
    { name: "empty corpus", corpus: { caseCount: 0, rows: [] } },
    {
      name: "wrong complete count",
      corpus: { caseCount: 2, rows: [allowRow(policy)] },
    },
    {
      name: "empty mode selection",
      corpus: { caseCount: 1, rows: [allowRow(policy, ["smoke"])] },
    },
    {
      name: "empty policy selection",
      corpus: { caseCount: 1, rows: [allowRow(other)] },
    },
  ]) {
    test(`${policy} self-test refuses ${fixture.name}`, () => {
      const result = selfTest(policy, fixture.corpus);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /FAIL:/u);
      assert.doesNotMatch(result.stdout, /PASS:/u);
    });
  }
  test(`${policy} validates the complete count before filtering a nonempty selection`, () => {
    const result = selfTest(policy, {
      caseCount: 2,
      rows: [allowRow(policy), allowRow(other)],
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PASS:.*executed=1, skipped=1/u);
  });
}
