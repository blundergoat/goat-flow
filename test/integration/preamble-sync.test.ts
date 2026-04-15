/**
 * Regression test for the preflight preamble/conventions sync check.
 * Verifies the diff-based check correctly detects when template and installed
 * copies of skill-preamble.md or skill-conventions.md diverge.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const TEMPLATE_PREAMBLE = resolve(
  PROJECT_ROOT,
  "workflow/skills/reference/skill-preamble.md",
);
const INSTALLED_PREAMBLE = resolve(
  PROJECT_ROOT,
  ".goat-flow/skill-preamble.md",
);
const TEMPLATE_CONVENTIONS = resolve(
  PROJECT_ROOT,
  "workflow/skills/reference/skill-conventions.md",
);
const INSTALLED_CONVENTIONS = resolve(
  PROJECT_ROOT,
  ".goat-flow/skill-conventions.md",
);

function diffQuiet(a: string, b: string): number {
  const r = spawnSync("diff", ["-q", a, b], {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return r.status ?? -1;
}

// ---------------------------------------------------------------------------
// Template and installed copies currently match (sanity check)
// ---------------------------------------------------------------------------
describe("preamble/conventions sync: current state", () => {
  it("template and installed skill-preamble.md match", () => {
    if (!existsSync(TEMPLATE_PREAMBLE) || !existsSync(INSTALLED_PREAMBLE)) {
      return; // Skip if either file is missing
    }
    assert.equal(
      diffQuiet(TEMPLATE_PREAMBLE, INSTALLED_PREAMBLE),
      0,
      "skill-preamble.md: template and installed should match",
    );
  });

  it("template and installed skill-conventions.md match", () => {
    if (
      !existsSync(TEMPLATE_CONVENTIONS) ||
      !existsSync(INSTALLED_CONVENTIONS)
    ) {
      return; // Skip if either file is missing
    }
    assert.equal(
      diffQuiet(TEMPLATE_CONVENTIONS, INSTALLED_CONVENTIONS),
      0,
      "skill-conventions.md: template and installed should match",
    );
  });
});

// ---------------------------------------------------------------------------
// Regression: diverged files are detected (non-zero diff status)
// ---------------------------------------------------------------------------
describe("preamble/conventions sync: regression detection", () => {
  it("detects when installed skill-preamble.md diverges from template", () => {
    if (!existsSync(TEMPLATE_PREAMBLE) || !existsSync(INSTALLED_PREAMBLE)) {
      return;
    }

    const originalTemplate = readFileSync(TEMPLATE_PREAMBLE);
    const originalInstalled = readFileSync(INSTALLED_PREAMBLE);

    // Back up installed; modify it to diverge
    const backup = resolve(PROJECT_ROOT, ".goat-flow/skill-preamble.md.bak");
    try {
      copyFileSync(INSTALLED_PREAMBLE, backup);
      writeFileSync(INSTALLED_PREAMBLE, originalInstalled + "\n# DIVERGED\n");

      // diff should now report non-zero
      assert.notEqual(
        diffQuiet(TEMPLATE_PREAMBLE, INSTALLED_PREAMBLE),
        0,
        "Diff should detect divergence",
      );

      // Simulate the preflight sync check directly
      assert.notDeepStrictEqual(
        readFileSync(TEMPLATE_PREAMBLE),
        readFileSync(INSTALLED_PREAMBLE),
        "Files should differ after modification",
      );
    } finally {
      // Restore
      writeFileSync(INSTALLED_PREAMBLE, originalInstalled);
      writeFileSync(TEMPLATE_PREAMBLE, originalTemplate);
      // Clean up backup
      try {
        spawnSync("rm", ["-f", backup]);
      } catch {
        // ignore
      }
    }
  });
});
