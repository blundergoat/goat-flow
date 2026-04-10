/**
 * Contract tests for setup's "migrate, not duplicate" principle.
 * These verify what setup SHOULD do when existing artifacts exist.
 * They test the contract by scanning fixture projects that simulate migration scenarios.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");

// ---------------------------------------------------------------
// 1. Canonical path contract: one surface per artifact type
// ---------------------------------------------------------------
describe("Canonical path contract: no duplicate surfaces in goat-flow itself", () => {
  it("does not have both docs/footguns.md (flat) and .goat-flow/footguns/ (directory)", () => {
    const flatFile = existsSync(join(ROOT, "docs/footguns.md"));
    const dirExists = existsSync(join(ROOT, "docs/footguns"));
    if (flatFile && dirExists) {
      assert.fail(
        "Both docs/footguns.md and .goat-flow/footguns/ exist. " +
          "Setup should use one canonical surface, not both.",
      );
    }
  });

  it("does not have both docs/lessons.md (flat) and .goat-flow/lessons/ (directory)", () => {
    const flatFile = existsSync(join(ROOT, "docs/lessons.md"));
    const dirExists = existsSync(join(ROOT, ".goat-flow/lessons"));
    if (flatFile && dirExists) {
      assert.fail(
        "Both docs/lessons.md and .goat-flow/lessons/ exist. " +
          "Setup should use one canonical surface, not both.",
      );
    }
  });

  // agent-evals/.goat-flow/evals tests removed - evals system removed in v1.1.0 (M09).
});

// ---------------------------------------------------------------
// 2. Config.yaml paths match what actually exists
// ---------------------------------------------------------------
describe("Config.yaml paths match filesystem reality", () => {
  const configPath = join(ROOT, ".goat-flow/config.yaml");

  it(".goat-flow/config.yaml exists", () => {
    assert.ok(existsSync(configPath), "Missing .goat-flow/config.yaml");
  });

  it("configured footguns path exists", () => {
    const config = readFileSync(configPath, "utf-8");
    const match = config.match(/^\s+committed:\s*(.+)$/m);
    if (match) {
      const committedPath = match[1].trim();
      assert.ok(
        existsSync(join(ROOT, committedPath)),
        `Config footguns.committed path ${committedPath} does not exist on disk`,
      );
    }
  });

  it("configured lessons path exists", () => {
    const config = readFileSync(configPath, "utf-8");
    // Find lessons section
    const lessonsMatch = config.match(/lessons:\s*\n\s+committed:\s*(.+)/m);
    if (lessonsMatch) {
      const committedPath = lessonsMatch[1].trim();
      assert.ok(
        existsSync(join(ROOT, committedPath)),
        `Config lessons.committed path ${committedPath} does not exist on disk`,
      );
    }
  });
});

// ---------------------------------------------------------------
// 3. Setup templates describe migration, not duplication
// ---------------------------------------------------------------
describe("Setup templates use new numbered structure", () => {
  const setupDir = join(ROOT, "workflow/setup");

  it("workflow/setup/shared directory does NOT exist (moved to numbered files)", () => {
    assert.ok(
      !existsSync(join(setupDir, "shared")),
      "shared/ should be deleted — content moved to numbered files and execution-loop.md",
    );
  });

  it("workflow/setup/reference/execution-loop.md exists (reference template)", () => {
    assert.ok(existsSync(join(setupDir, "reference/execution-loop.md")));
  });

  it("numbered setup files exist (01 through 06)", () => {
    for (let i = 1; i <= 6; i++) {
      const prefix = String(i).padStart(2, "0");
      const files = readdirSync(setupDir).filter((f) =>
        f.startsWith(`${prefix}-`),
      );
      assert.ok(files.length > 0, `Expected a file starting with ${prefix}-`);
    }
  });

  it("reference setup docs exist for optional follow-on work", () => {
    const refDir = join(setupDir, "reference");
    for (const file of [
      "reference-coding-guidelines.md",
      "reference-polish.md",
    ]) {
      assert.ok(existsSync(join(refDir, file)), `Expected ${file}`);
    }
  });

  it("agent config files exist", () => {
    const agentsDir = join(setupDir, "agents");
    assert.ok(existsSync(agentsDir), "agents/ directory should exist");
    for (const agent of ["claude.md", "codex.md", "gemini.md", "copilot.md"]) {
      assert.ok(
        existsSync(join(agentsDir, agent)),
        `agents/${agent} should exist`,
      );
    }
  });
});

// ---------------------------------------------------------------
// 4. Fixture contract: passing-minimal uses canonical paths only
// ---------------------------------------------------------------
describe("Fixture passing-minimal uses canonical paths only", () => {
  const fixtureDir = join(ROOT, "test/fixtures/projects/passing-minimal");

  it("does not have duplicate lesson surfaces", () => {
    const flatFile = existsSync(join(fixtureDir, "docs/lessons.md"));
    assert.ok(
      !flatFile,
      "passing-minimal should not have docs/lessons.md (flat file) - use .goat-flow/lessons/ only",
    );
  });

  // legacy eval path test removed - evals system removed in v1.1.0 (M09).

  it("does not have duplicate footgun surfaces", () => {
    const flatFile = existsSync(join(fixtureDir, "docs/footguns.md"));
    assert.ok(
      !flatFile,
      "passing-minimal should not have docs/footguns.md (flat file) - use .goat-flow/footguns/ (dir) only",
    );
  });
});
