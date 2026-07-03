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
  removeTopLevelConfigBlock,
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

  it("preserves hook binaries overrides through toggle writes", () => {
    withTempProject((root) => {
      const configPath = join(root, ".goat-flow", "config.yaml");
      writeFileSync(
        configPath,
        [
          'version: "1.8.0"',
          "hooks:",
          "  gruff-code-quality:",
          "    enabled: true",
          "    binaries:",
          "      py: strands_agents/.venv/bin/gruff-py",
          "",
        ].join("\n"),
      );

      setHookEnabled(root, "gruff-code-quality", false);
      setHookEnabled(root, "deny-dangerous", true);

      const next = readFileSync(configPath, "utf-8");
      assert.match(next, /gruff-code-quality:\n {4}enabled: false/u);
      assert.match(
        next,
        /binaries:\n {6}py: strands_agents\/\.venv\/bin\/gruff-py/u,
      );
    });
  });

  it("ignores unsafe top-level block keys instead of constructing a regex", () => {
    withTempProject((root) => {
      const configPath = join(root, ".goat-flow", "config.yaml");
      writeFileSync(
        configPath,
        [
          'version: "1.8.0"',
          "plan-guard:",
          "  enabled: true",
          "line-limits:",
          "  target: 125",
          "",
        ].join("\n"),
      );

      removeTopLevelConfigBlock(root, "plan-guard|line-limits");

      const next = readFileSync(configPath, "utf-8");
      assert.match(next, /plan-guard:\n  enabled: true/u);
      assert.match(next, /line-limits:\n  target: 125/u);
    });
  });
});
