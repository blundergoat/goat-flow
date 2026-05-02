/**
 * Config reader tests - defaults, merging, validation.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../../src/cli/config/reader.js";
import { getKnownAgentIds } from "../../src/cli/agents/registry.js";
import { AUDIT_VERSION } from "../../src/cli/constants.js";
import type { ReadonlyFS } from "../../src/cli/types.js";

function configFS(content: string | null): ReadonlyFS {
  return {
    exists: (path: string) =>
      path === ".goat-flow/config.yaml" && content !== null,
    readFile: (path: string) =>
      path === ".goat-flow/config.yaml" ? content : null,
    lineCount: () => 0,
    readJson: () => null,
    listDir: () => [],
    isExecutable: () => false,
    glob: () => [],
    existsGlob: () => false,
  };
}

// ---------------------------------------------------------------------------
// Config defaults
// ---------------------------------------------------------------------------
describe("config defaults when file is missing", () => {
  it("returns defaults with exists=false", () => {
    const result = loadConfig("/tmp", configFS(null));
    assert.equal(result.exists, false);
    assert.equal(result.valid, true);
    assert.equal(result.config.lineLimits.target, 120);
    assert.equal(result.config.lineLimits.limit, 150);
    assert.equal(result.config.userRole, "developer");
    assert.deepStrictEqual(result.config.toolchain.test, []);
  });
});

// ---------------------------------------------------------------------------
// Config merging
// ---------------------------------------------------------------------------
describe("config merges custom toolchain", () => {
  it("merges toolchain commands from YAML", () => {
    const yaml = `
version: "${AUDIT_VERSION}"
toolchain:
  test: ["npm test"]
  lint: ["eslint ."]
  build: ["tsc"]
`;
    const result = loadConfig("/tmp", configFS(yaml));
    assert.equal(result.exists, true);
    assert.equal(result.valid, true);
    assert.deepStrictEqual(result.config.toolchain.test, ["npm test"]);
    assert.deepStrictEqual(result.config.toolchain.lint, ["eslint ."]);
    assert.deepStrictEqual(result.config.toolchain.build, ["tsc"]);
  });
});

describe("config merges goat-review skill settings", () => {
  it("defaults local_pr_base to absent when not configured", () => {
    const result = loadConfig("/tmp", configFS(null));
    assert.equal(result.config.skills["goat-review"], undefined);
  });

  it("parses skills.goat-review.local_pr_base from YAML", () => {
    const yaml = `
version: "${AUDIT_VERSION}"
skills:
  install: all
  goat-review:
    local_pr_base: "deploy"
`;
    const result = loadConfig("/tmp", configFS(yaml));
    assert.equal(result.valid, true);
    assert.equal(result.config.skills["goat-review"]?.localPrBase, "deploy");
  });

  it("fails closed when skills.goat-review.local_pr_base is not a string", () => {
    const yaml = `
version: "${AUDIT_VERSION}"
skills:
  install: all
  goat-review:
    local_pr_base: 42
`;
    const result = loadConfig("/tmp", configFS(yaml));
    assert.equal(result.valid, false);
    assert.equal(result.config.skills["goat-review"], undefined);
    assert.ok(
      result.errors.some(
        (error) => error.path === "skills.goat-review.local_pr_base",
      ),
      JSON.stringify(result.errors),
    );
  });

  it("fails closed when skills.goat-review.local_pr_base is empty", () => {
    const yaml = `
version: "${AUDIT_VERSION}"
skills:
  install: all
  goat-review:
    local_pr_base: "   "
`;
    const result = loadConfig("/tmp", configFS(yaml));
    assert.equal(result.valid, false);
    assert.equal(result.config.skills["goat-review"], undefined);
    assert.ok(
      result.errors.some(
        (error) => error.path === "skills.goat-review.local_pr_base",
      ),
      JSON.stringify(result.errors),
    );
  });
});

describe("config validates agent ids against the registry", () => {
  it("errors with the manifest-backed supported-agent list", () => {
    const yaml = `
version: "${AUDIT_VERSION}"
agents:
  - cursor
`;
    const result = loadConfig("/tmp", configFS(yaml));
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some(
        (error) =>
          error.path === "agents[0]" &&
          error.message.includes(getKnownAgentIds().join(", ")),
      ),
      JSON.stringify(result.errors),
    );
  });
});

// ---------------------------------------------------------------------------
// Config parse errors
// ---------------------------------------------------------------------------
describe("config parse errors", () => {
  it("reports parseError on invalid YAML", () => {
    const result = loadConfig("/tmp", configFS("{ broken: yaml: ["));
    assert.equal(result.exists, true);
    assert.equal(result.valid, false);
    assert.ok(result.parseError !== null, "parseError should be set");
  });
});

// ---------------------------------------------------------------------------
// M17-7: Config loading fails closed
// ---------------------------------------------------------------------------
describe("config fails closed on validation errors", () => {
  it("returns defaults (not a partial merge) when agents array has bad element types", () => {
    // A config with an invalid agents array must not leak the malformed
    // shape through to downstream consumers. The merge layer used to silently
    // forward non-string elements; M17-7 requires defaults on validation fail.
    const yaml = `
version: "${AUDIT_VERSION}"
agents:
  - 42
  - null
  - "claude"
`;
    const result = loadConfig("/tmp", configFS(yaml));
    assert.equal(result.valid, false);
    // Defaults have agents: null (auto-detect). The malformed array must NOT
    // be passed through.
    assert.equal(
      result.config.agents,
      null,
      "config.agents must be defaults (null) when validation fails, not the malformed array",
    );
    // Error detail should still be surfaced so callers can report it.
    assert.ok(
      result.errors.some((e) => e.path.startsWith("agents[")),
      `errors must name the failing element paths: ${JSON.stringify(result.errors)}`,
    );
  });

  it("returns defaults when toolchain fields have bad element types", () => {
    const yaml = `
version: "${AUDIT_VERSION}"
toolchain:
  test:
    - "npm test"
    - 42
`;
    const result = loadConfig("/tmp", configFS(yaml));
    assert.equal(result.valid, false);
    // With fail-closed: test command list is defaulted, not partially merged.
    assert.deepStrictEqual(
      result.config.toolchain.test,
      [],
      "toolchain.test must be defaults ([]) when validation fails",
    );
  });
});

// ---------------------------------------------------------------------------
// M01: harness.acknowledge list
// ---------------------------------------------------------------------------
describe("harness.acknowledge in config", () => {
  it("defaults to an empty list when absent", () => {
    const result = loadConfig("/tmp", configFS(null));
    assert.deepStrictEqual(result.config.harness.acknowledge, []);
  });

  it("parses an acknowledge list from YAML", () => {
    const yaml = `
version: "${AUDIT_VERSION}"
harness:
  acknowledge:
    - deny-blocks-pipe-to-shell
    - instruction-line-count
`;
    const result = loadConfig("/tmp", configFS(yaml));
    assert.equal(result.valid, true);
    assert.deepStrictEqual(result.config.harness.acknowledge, [
      "deny-blocks-pipe-to-shell",
      "instruction-line-count",
    ]);
  });

  it("errors when acknowledge is not an array", () => {
    const yaml = `
version: "${AUDIT_VERSION}"
harness:
  acknowledge: deny-blocks-pipe-to-shell
`;
    const result = loadConfig("/tmp", configFS(yaml));
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((e) => e.path === "harness.acknowledge"),
      `errors should include harness.acknowledge: ${JSON.stringify(result.errors)}`,
    );
  });
});
