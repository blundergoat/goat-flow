/**
 * Unit tests for hook-enabled config reads and managed hook-block writes.
 */
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  readHookEnabled,
  readHookScanRoots,
  removeTopLevelConfigBlock,
  setHookEnabled,
} from "../../src/cli/config/writer.js";

/** Writes a cleaned temporary project for each config-writer assertion. */
function withTempProject(scenario: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-config-writer-"));
  try {
    mkdirSync(join(root, ".goat-flow"), { recursive: true });
    scenario(root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

/**
 * Create the exact executable convention detected by Gruff hook configuration.
 * Side effect: writes one disposable console-script fixture below the supplied test root.
 */
function writeConventionalGruffPy(root: string): string {
  const binaryDirectory = join(root, "strands_agents", ".venv", "bin");
  const binaryPath = join(binaryDirectory, "gruff-py");
  mkdirSync(binaryDirectory, { recursive: true });
  writeFileSync(binaryPath, "#!/usr/bin/env python3\n");
  chmodSync(binaryPath, 0o755);
  return binaryPath;
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

  // Fixture purpose: creates the nested analyzer that hook enablement must persist; writes stay in the disposable project.
  it("pins the conventional strands_agents gruff-py when enabling its hook", () => {
    withTempProject((root) => {
      writeConventionalGruffPy(root);

      setHookEnabled(root, "gruff-code-quality", true);

      const next = readFileSync(
        join(root, ".goat-flow", "config.yaml"),
        "utf-8",
      );
      assert.match(next, /gruff-code-quality:\n {4}enabled: true/u);
      assert.match(
        next,
        /binaries:\n {6}py: strands_agents\/\.venv\/bin\/gruff-py/u,
      );
    });
  });

  // Fixture purpose: gives Gruff an empty binary block that enablement must preserve; writes stay in the disposable project.
  it("keeps an empty gruff binaries block authoritative when enabling", () => {
    withTempProject((root) => {
      writeConventionalGruffPy(root);
      const configPath = join(root, ".goat-flow", "config.yaml");
      writeFileSync(
        configPath,
        [
          'version: "1.8.0"',
          "hooks:",
          "  gruff-code-quality:",
          "    enabled: false",
          "    binaries: {}",
          "",
        ].join("\n"),
      );

      setHookEnabled(root, "gruff-code-quality", true);

      const next = readFileSync(configPath, "utf-8");
      assert.match(next, /gruff-code-quality:\n {4}enabled: true/u);
      assert.match(next, /binaries: \{\}/u);
      assert.doesNotMatch(next, /strands_agents\/\.venv\/bin\/gruff-py/u);
    });
  });

  // Fixture purpose: removes execute permission from the nested analyzer; writes stay in the disposable project.
  it(
    "does not pin a non-executable conventional gruff-py when enabling",
    { skip: process.platform === "win32" },
    () => {
      withTempProject((root) => {
        chmodSync(writeConventionalGruffPy(root), 0o644);

        setHookEnabled(root, "gruff-code-quality", true);

        const next = readFileSync(
          join(root, ".goat-flow", "config.yaml"),
          "utf-8",
        );
        assert.doesNotMatch(next, /binaries:/u);
      });
    },
  );

  // Covers hook binaries overrides surviving a toggle: writes config, toggles, and expects them preserved.
  it("preserves hook binaries overrides through toggle writes", () => {
    withTempProject((root) => {
      writeConventionalGruffPy(root);
      const configPath = join(root, ".goat-flow", "config.yaml");
      writeFileSync(
        configPath,
        [
          'version: "1.8.0"',
          "hooks:",
          "  gruff-code-quality:",
          "    enabled: false",
          "    binaries:",
          "      py: tools/gruff-py",
          "",
        ].join("\n"),
      );

      setHookEnabled(root, "gruff-code-quality", true);
      const enabled = readFileSync(configPath, "utf-8");
      assert.match(enabled, /gruff-code-quality:\n {4}enabled: true/u);
      assert.match(enabled, /binaries:\n {6}py: tools\/gruff-py/u);
      assert.doesNotMatch(enabled, /strands_agents\/\.venv\/bin\/gruff-py/u);

      setHookEnabled(root, "gruff-code-quality", false);
      setHookEnabled(root, "deny-dangerous", true);

      const next = readFileSync(configPath, "utf-8");
      assert.match(next, /gruff-code-quality:\n {4}enabled: false/u);
      assert.match(next, /binaries:\n {6}py: tools\/gruff-py/u);
      assert.doesNotMatch(next, /strands_agents\/\.venv\/bin\/gruff-py/u);
    });
  });

  // Fixture purpose: redirects the conventional path outside the project; side effects: writes only inside two cleaned temp roots.
  it(
    "rejects a conventional gruff-py symlink that resolves outside the project",
    { skip: process.platform === "win32" },
    () => {
      withTempProject((outsideRoot) => {
        const outsideBinary = join(outsideRoot, "gruff-py");
        writeFileSync(outsideBinary, "#!/usr/bin/env python3\n");
        chmodSync(outsideBinary, 0o755);
        withTempProject((root) => {
          const binaryDirectory = join(root, "strands_agents", ".venv", "bin");
          mkdirSync(binaryDirectory, { recursive: true });
          symlinkSync(outsideBinary, join(binaryDirectory, "gruff-py"));

          setHookEnabled(root, "gruff-code-quality", true);

          const next = readFileSync(
            join(root, ".goat-flow", "config.yaml"),
            "utf-8",
          );
          assert.doesNotMatch(next, /binaries:/u);
        });
      });
    },
  );

  // Fixture purpose: writes a multi-root YAML block, toggles it, and reads the preserved paths back.
  it("preserves post-turn scan roots through toggle writes", () => {
    withTempProject((root) => {
      const configPath = join(root, ".goat-flow", "config.yaml");
      writeFileSync(
        configPath,
        [
          'version: "1.8.0"',
          "hooks:",
          "  post-turn-safety:",
          "    enabled: true",
          "    scan-roots:",
          "      - services/api",
          "      - packages/web",
          "",
        ].join("\n"),
      );

      setHookEnabled(root, "post-turn-safety", false);

      const next = readFileSync(configPath, "utf-8");
      assert.match(next, /post-turn-safety:\n {4}enabled: false/u);
      assert.match(
        next,
        /scan-roots:\n {6}- services\/api\n {6}- packages\/web/u,
      );
      assert.deepEqual(readHookScanRoots(root, "post-turn-safety"), [
        "services/api",
        "packages/web",
      ]);
    });
  });

  // Fixture purpose: writes a flow-style mapping and reads it back, pinning the registrar parity target for the runtime hook parser.
  it("reads scan roots from flow-style hook mappings", () => {
    withTempProject((root) => {
      const configPath = join(root, ".goat-flow", "config.yaml");
      writeFileSync(
        configPath,
        'hooks: { "post-turn-safety": { enabled: true, "scan-roots": ["services/api"] } }\n',
      );

      assert.deepEqual(readHookScanRoots(root, "post-turn-safety"), [
        "services/api",
      ]);
    });
  });

  // Covers unsafe top-level block keys: writes them and expects they are ignored, not built into a regex.
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
