/**
 * Unit tests for `test/helpers/hook-entrypoint.ts`, which decides which hook copy every hook test runs.
 *
 * - A misspelled or retired `GOAT_FLOW_HOOK_UNDER_TEST` value must stop the test, never quietly run the installed hooks.
 * - A missing Node entrypoint must fail, never fall back to a Bash file left beside it.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  hookSelection,
  hookTreeRoot,
  selectedHookPath,
} from "../helpers/hook-entrypoint.js";

// A maintainer who exports `GOAT_FLOW_HOOK_UNDER_TEST=reference` from an old CI recipe must see an error, not a green run on other hooks.
test("unknown selection refuses instead of using the shipped hook", () => {
  assert.equal(hookSelection(undefined), "installed");
  // The retired frozen-reference value is refused like any misspelling, and so is an empty value.
  for (const rejected of ["", "Reference", "reference", "typo"]) {
    assert.throws(
      () => hookSelection(rejected),
      /unknown hook selection/u,
      `selection ${rejected}`,
    );
    assert.throws(
      () => hookTreeRoot("workflow", rejected as never),
      /unknown hook selection/u,
      `tree ${rejected}`,
    );
  }
});

// Writes a lone `.sh` file first, so a test naming an old Bash hook fails until the matching Node file exists beside it.
test("missing candidate never falls back to an existing Bash entrypoint", () => {
  const project = mkdtempSync(join(tmpdir(), "goat-hook-selection-"));
  const bashEntrypoint = join(project, "deny-dangerous.sh");
  try {
    writeFileSync(bashEntrypoint, "exit 0\n");
    assert.throws(
      () => selectedHookPath(bashEntrypoint, "candidate"),
      /candidate hook unavailable/u,
    );
    assert.throws(
      () => selectedHookPath(bashEntrypoint, "installed"),
      /installed hook unavailable/u,
    );
    const nodeEntrypoint = join(project, "deny-dangerous.mjs");
    writeFileSync(nodeEntrypoint, "process.exit(0);\n");
    assert.equal(selectedHookPath(bashEntrypoint, "candidate"), nodeEntrypoint);
    assert.equal(selectedHookPath(bashEntrypoint, "installed"), nodeEntrypoint);
    assert.equal(selectedHookPath(nodeEntrypoint, "installed"), nodeEntrypoint);
    const bashLauncher = join(project, "run-with-bash.mjs");
    const nodeLauncher = join(project, "run-hook.mjs");
    writeFileSync(bashLauncher, "process.exit(0);\n");
    writeFileSync(nodeLauncher, "process.exit(0);\n");
    assert.equal(selectedHookPath(bashLauncher, "installed"), nodeLauncher);
    assert.equal(selectedHookPath(bashLauncher, "candidate"), nodeLauncher);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
