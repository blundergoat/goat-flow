/** Keep installed and candidate Node routing separate from the frozen Bash reference. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  hookSelection,
  hookTreeRoot,
  selectedHookPath,
} from "../helpers/hook-entrypoint.js";

test("unknown selection refuses instead of using the shipped hook", () => {
  assert.equal(hookSelection(undefined), "installed");
  for (const value of ["", "Reference", "typo"]) {
    assert.throws(() => hookSelection(value), /unknown hook selection/u);
  }
});

test("missing candidate never falls back to an existing Bash entrypoint", () => {
  const project = mkdtempSync(join(tmpdir(), "goat-hook-selection-"));
  const bash = join(project, "deny-dangerous.sh");
  try {
    writeFileSync(bash, "exit 0\n");
    assert.throws(
      () => selectedHookPath(bash, "candidate"),
      /candidate hook unavailable/u,
    );
    assert.throws(
      () => selectedHookPath(bash, "installed"),
      /installed hook unavailable/u,
    );
    const node = join(project, "deny-dangerous.mjs");
    writeFileSync(node, "process.exit(0);\n");
    assert.equal(selectedHookPath(bash, "candidate"), node);
    assert.equal(selectedHookPath(bash, "installed"), node);
    assert.equal(selectedHookPath(node, "installed"), node);
    const launcher = join(project, "run-with-bash.mjs");
    const nativeLauncher = join(project, "run-hook.mjs");
    writeFileSync(launcher, "process.exit(0);\n");
    writeFileSync(nativeLauncher, "process.exit(0);\n");
    assert.equal(selectedHookPath(launcher, "installed"), nativeLauncher);
    assert.equal(selectedHookPath(launcher, "candidate"), nativeLauncher);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("reference selects both frozen layouts and their transitive dependencies", () => {
  const project = resolve(import.meta.dirname, "../..");
  for (const layout of ["workflow", "installed"] as const) {
    const source = hookTreeRoot(layout, "reference");
    assert(source.startsWith(join(project, "test/fixtures/hooks-bash")));
    const frozen = readFileSync(join(source, "vendor/graphql.cjs"));
    assert(frozen.length > 0);
    assert.notEqual(source, hookTreeRoot(layout, "installed"));
  }
});
