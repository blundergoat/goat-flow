/**
 * Smoke tests: shell scripts are valid bash.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");

function bashCheck(scriptPath: string): void {
  const full = resolve(PROJECT_ROOT, scriptPath);
  assert.ok(existsSync(full), `${scriptPath} should exist`);
  try {
    execSync(`bash -n "${full}"`, { stdio: "pipe", timeout: 5000 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    assert.fail(`bash -n failed for ${scriptPath}: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// preflight-checks.sh is valid bash
// ---------------------------------------------------------------------------
describe("preflight-checks.sh", () => {
  it("passes bash -n syntax check", () => {
    bashCheck("scripts/preflight-checks.sh");
  });
});

// ---------------------------------------------------------------------------
// workflow/validate-goat-flow-setup.sh is valid bash
// ---------------------------------------------------------------------------
describe("validate-goat-flow-setup.sh", () => {
  it("passes bash -n syntax check", () => {
    bashCheck("workflow/validate-goat-flow-setup.sh");
  });
});
