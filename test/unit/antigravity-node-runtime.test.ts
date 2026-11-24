/**
 * Antigravity on WSL starts hooks without a shell profile; the CLI warns only when that host cannot find an executable node.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  antigravityNodeRuntimeWarning,
  isExecutableFile,
} from "../../src/cli/antigravity-node-runtime.js";
import type { AntigravityNodeHost } from "../../src/cli/antigravity-node-runtime.js";

const WSL_KERNEL = "6.18.58.1-microsoft-standard-WSL2";
const GOAT_FLOW_ANTIGRAVITY_CONFIG =
  '{"deny-dangerous":{"PreToolUse":[{"hooks":[{"command":"node ../.goat-flow/hooks/antigravity-hook-bootstrap.cjs .goat-flow/hooks/deny-dangerous.mjs"}]}]}}';

/** Build a WSL host with goat-flow Antigravity hooks and no node anywhere; each case overrides one fact. */
function wslHost(
  overrides: Partial<AntigravityNodeHost> = {},
): AntigravityNodeHost {
  return {
    platform: "linux",
    kernelRelease: WSL_KERNEL,
    readHooksConfig: () => GOAT_FLOW_ANTIGRAVITY_CONFIG,
    isExecutableFile: () => false,
    ...overrides,
  };
}

describe("antigravityNodeRuntimeWarning", () => {
  // The lockout case: WSL, goat-flow Antigravity hooks installed, and no executable node on the server PATH.
  it("names the exit 127 symptom and the system-wide install fix", () => {
    const warning = antigravityNodeRuntimeWarning(wslHost());
    assert.ok(warning !== null);
    assert.match(warning, /sh: 1: node: not found/u);
    assert.match(warning, /exit 127/u);
    assert.match(warning, /install Node system-wide/u);
  });

  // A NodeSource or distro package at /usr/bin/node is on the server PATH, so hooks can start.
  it("stays silent when /usr/bin/node is executable", () => {
    const host = wslHost({
      isExecutableFile: (filePath) => filePath === "/usr/bin/node",
    });
    assert.equal(antigravityNodeRuntimeWarning(host), null);
  });

  // Only WSL was observed starting Antigravity without a shell, so native Linux kernels stay silent.
  it("stays silent on a non-WSL Linux kernel", () => {
    assert.equal(
      antigravityNodeRuntimeWarning(
        wslHost({ kernelRelease: "6.8.0-49-generic" }),
      ),
      null,
    );
  });

  // A hooks file that goat-flow did not write, or no hooks file, has no goat-flow hook to block tool calls.
  it("stays silent without goat-flow Antigravity registrations", () => {
    assert.equal(
      antigravityNodeRuntimeWarning(wslHost({ readHooksConfig: () => "{}" })),
      null,
    );
    assert.equal(
      antigravityNodeRuntimeWarning(wslHost({ readHooksConfig: () => null })),
      null,
    );
  });
});

describe("isExecutableFile", () => {
  // Writes a temporary directory, a plain file and an executable file, then removes them.
  it("counts only executable regular files, not a directory named node", () => {
    const root = mkdtempSync(join(tmpdir(), "goat-flow-node-probe-"));
    try {
      const directoryNamedNode = join(root, "dir", "node");
      mkdirSync(directoryNamedNode, { recursive: true });
      const plainFile = join(root, "plain-node");
      writeFileSync(plainFile, "");
      chmodSync(plainFile, 0o644);
      const executableFile = join(root, "executable-node");
      writeFileSync(executableFile, "");
      chmodSync(executableFile, 0o755);

      assert.equal(isExecutableFile(directoryNamedNode), false);
      assert.equal(isExecutableFile(plainFile), false);
      assert.equal(isExecutableFile(executableFile), true);
      assert.equal(isExecutableFile(join(root, "missing-node")), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
