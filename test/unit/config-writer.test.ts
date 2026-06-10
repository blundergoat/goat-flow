/**
 * Unit tests for hook-enabled config reads and managed hook-block writes.
 */
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  readHookEnabled,
  setHookEnabled,
} from "../../src/cli/config/writer.js";

/** Writes a cleaned temporary project for each config-writer assertion. */
function withTempProject(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-config-writer-"));
  try {
    mkdirSync(join(root, ".goat-flow"), { recursive: true });
    fn(root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

describe("config writer", () => {
  it("migrates the old gruff hook id when reading desired state", () => {
    withTempProject((root) => {
      const configPath = join(root, ".goat-flow", "config.yaml");
      writeFileSync(
        configPath,
        [
          'version: "1.8.0"',
          "hooks:",
          "  gruff-on-change:",
          "    enabled: false",
          "",
        ].join("\n"),
      );

      assert.equal(readHookEnabled(root, "gruff-code-quality", true), false);
    });
  });

  // Fixture purpose: writes duplicate legacy hook comments to cover canonical hook ids.
  it("deduplicates generated hook comments and writes canonical hook ids", () => {
    withTempProject((root) => {
      const configPath = join(root, ".goat-flow", "config.yaml");
      writeFileSync(
        configPath,
        [
          'version: "1.8.0"',
          "",
          "# Project-wide toggles for goat-flow-shipped hooks.",
          "# Togglable goat-flow hook state. Missing entries use registry defaults.",
          "# Manage with the dashboard Hooks page or `goat-flow hooks <enable|disable|sync>`.",
          "# Togglable goat-flow hook state. Missing entries use registry defaults.",
          "# Manage with the dashboard Hooks page or `goat-flow hooks <enable|disable|sync>`.",
          "hooks:",
          "  guard-secret-paths:",
          "    enabled: true",
          "  gruff-on-change:",
          "    enabled: false",
          "",
          "line-limits:",
          "  target: 125",
          "",
        ].join("\n"),
      );

      setHookEnabled(root, "deny-dangerous", false);

      const next = readFileSync(configPath, "utf-8");
      assert.equal(next.match(/Togglable goat-flow hook state/gu)?.length, 1);
      assert.equal(next.includes("gruff-on-change:"), false);
      assert.equal(next.includes("guard-secret-paths:"), false);
      assert.match(next, /gruff-code-quality:\n    enabled: false/u);
      assert.match(next, /deny-dangerous:\n    enabled: false/u);
      assert.match(next, /# Project-wide toggles/u);
      assert.match(next, /line-limits:\n  target: 125/u);
    });
  });
});
