/**
 * Exercises config defaults, merging, and validation shown to setup users.
 * Use these tests when configuration parsing changes so missing or malformed
 * project settings still produce predictable operator-facing results.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../../src/cli/config/reader.js";
import { AUDIT_VERSION } from "../../src/cli/constants.js";
import type { ReadonlyFS } from "../../src/cli/types.js";

/** Build a config-only filesystem so each test models exactly what a setup user saved. */
function configFS(content: string | null): ReadonlyFS {
  return {
    exists: (path: string) =>
      path === ".goat-flow/config.yaml" && content !== null,
    readFile: (path: string) =>
      path === ".goat-flow/config.yaml" ? content : null,
    lineCount: () => 0,
    readJson: () => null,
    isReadableDirectory: () => false,
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
    const expectedDefaultLineTarget = 125;
    const expectedDefaultLineLimit = 150;
    const result = loadConfig("/tmp", configFS(null));
    assert.equal(result.exists, false);
    assert.equal(result.valid, true);
    assert.equal(result.config.lineLimits.target, expectedDefaultLineTarget);
    assert.equal(result.config.lineLimits.limit, expectedDefaultLineLimit);
    assert.equal(result.config.userRole, "developer");
    assert.deepStrictEqual(result.config.toolchain.test, []);
    assert.equal(result.config.learningLoop.autoCapture.enabled, false);
    assert.deepStrictEqual(result.config.learningLoop.autoCapture.targets, []);
  });
});

describe("config validates release versions", () => {
  it("rejects malformed versions before downstream direction checks", () => {
    const result = loadConfig("/tmp", configFS('version: "999.invalid"\n'));

    assert.equal(result.valid, false);
    assert.equal(result.config.version, AUDIT_VERSION);
    assert.deepEqual(result.errors, [
      {
        level: "error",
        path: "version",
        message: "must use numeric X.Y.Z release format",
      },
    ]);
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

describe("config merges hook binaries overrides", () => {
  it("carries binaries entries into the normalized hook config", () => {
    const yaml = `
version: "${AUDIT_VERSION}"
hooks:
  gruff-code-quality:
    enabled: true
    binaries:
      py: strands_agents/.venv/bin/gruff-py
`;
    const result = loadConfig("/tmp", configFS(yaml));
    assert.equal(result.valid, true);
    assert.deepStrictEqual(result.config.hooks["gruff-code-quality"], {
      enabled: true,
      binaries: { py: "strands_agents/.venv/bin/gruff-py" },
    });
  });

  it("fails validation when a binaries entry is not a string path", () => {
    const yaml = `
version: "${AUDIT_VERSION}"
hooks:
  gruff-code-quality:
    enabled: true
    binaries:
      py: 3
`;
    const result = loadConfig("/tmp", configFS(yaml));
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some(
        (error) => error.path === "hooks.gruff-code-quality.binaries.py",
      ),
      JSON.stringify(result.errors),
    );
  });
});

describe("config ignores removed plan-checkbox guard settings", () => {
  it("treats legacy plan-guard config as an unknown top-level key", () => {
    const yaml = `
version: "${AUDIT_VERSION}"
plan-guard:
  enabled: true
  search-paths:
    - .goat-flow/plans
`;
    const result = loadConfig("/tmp", configFS(yaml));
    assert.equal(result.valid, true);
    assert.equal("planGuard" in result.config, false);
    assert.ok(
      result.warnings.some((warning) => warning.path === "plan-guard"),
      JSON.stringify(result.warnings),
    );
  });
});

describe("config merges learning-loop auto-capture policy", () => {
  it("defaults automatic capture to disabled with no targets", () => {
    const result = loadConfig("/tmp", configFS(null));
    assert.equal(result.valid, true);
    assert.equal(result.config.learningLoop.autoCapture.enabled, false);
    assert.deepStrictEqual(result.config.learningLoop.autoCapture.targets, []);
  });

  it("parses explicit automatic capture settings from YAML", () => {
    const yaml = `
version: "${AUDIT_VERSION}"
learning-loop:
  auto-capture:
    enabled: true
    targets:
      - lessons
      - footguns
`;
    const result = loadConfig("/tmp", configFS(yaml));
    assert.equal(result.valid, true);
    assert.equal(result.config.learningLoop.autoCapture.enabled, true);
    assert.deepStrictEqual(result.config.learningLoop.autoCapture.targets, [
      "lessons",
      "footguns",
    ]);
  });

  it("fails closed when automatic capture config is malformed", () => {
    const yaml = `
version: "${AUDIT_VERSION}"
learning-loop:
  auto-capture:
    enabled: "yes"
    targets:
      - quality-reports
`;
    const result = loadConfig("/tmp", configFS(yaml));
    assert.equal(result.valid, false);
    assert.equal(result.config.learningLoop.autoCapture.enabled, false);
    assert.deepStrictEqual(result.config.learningLoop.autoCapture.targets, []);
    assert.ok(
      result.errors.some(
        (error) => error.path === "learning-loop.auto-capture.enabled",
      ),
      JSON.stringify(result.errors),
    );
    assert.ok(
      result.errors.some(
        (error) => error.path === "learning-loop.auto-capture.targets[0]",
      ),
      JSON.stringify(result.errors),
    );
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

describe("config ignores legacy agents field", () => {
  it("does not let agents act as an audit allowlist", () => {
    const yaml = `
version: "${AUDIT_VERSION}"
agents:
  - cursor
  - 42
  - claude
`;
    const result = loadConfig("/tmp", configFS(yaml));
    assert.equal(result.valid, true);
    assert.equal(result.config.agents, null);
    assert.deepEqual(result.errors, []);
    assert.ok(
      result.warnings.some(
        (warning) =>
          warning.path === "agents" && warning.message.includes("ignored"),
      ),
      JSON.stringify(result.warnings),
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
// Config loading fails closed.
// ---------------------------------------------------------------------------
describe("config fails closed on validation errors", () => {
  it("keeps defaults when legacy agents has bad element types", () => {
    const yaml = `
version: "${AUDIT_VERSION}"
agents:
  - 42
  - null
  - "claude"
`;
    const result = loadConfig("/tmp", configFS(yaml));
    assert.equal(result.valid, true);
    assert.equal(
      result.config.agents,
      null,
      "legacy config.agents must not leak into downstream consumers",
    );
    assert.ok(
      result.warnings.some(
        (warning) =>
          warning.path === "agents" && warning.message.includes("ignored"),
      ),
      JSON.stringify(result.warnings),
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
// harness.acknowledge list.
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

describe("config surfaces misspelled nested keys", () => {
  /**
   * Root-level typos were already reported, but a misspelling one level down read
   * exactly like leaving the setting out: the validator consumed the fields it knew
   * and never looked at the rest, so the user saw a feature that "did nothing".
   */
  it("warns on an unread key inside a fixed-shape block", () => {
    const yaml = `
version: "${AUDIT_VERSION}"
learning-loop:
  auto-captrue:
    enabled: true
`;
    const result = loadConfig("/tmp", configFS(yaml));
    // Warning, not error: an unknown key must not stop an older CLI loading a newer config.
    assert.equal(result.valid, true);
    assert.ok(
      result.warnings.some(
        (warning) => warning.path === "learning-loop.auto-captrue",
      ),
      JSON.stringify(result.warnings),
    );
  });

  it("warns on an unread key inside a hook row keyed by hook id", () => {
    const yaml = `
version: "${AUDIT_VERSION}"
hooks:
  gruff-code-quality:
    enabled: true
    binariez:
      py: some/path
`;
    const result = loadConfig("/tmp", configFS(yaml));
    assert.ok(
      result.warnings.some(
        (warning) => warning.path === "hooks.gruff-code-quality.binariez",
      ),
      JSON.stringify(result.warnings),
    );
  });

  it("stays silent on correctly spelled nested keys", () => {
    const yaml = `
version: "${AUDIT_VERSION}"
learning-loop:
  auto-capture:
    enabled: false
terminal:
  idle-timeout: 30
`;
    const result = loadConfig("/tmp", configFS(yaml));
    assert.equal(result.valid, true);
    assert.deepEqual(
      result.warnings.filter((warning) => warning.message === "unknown key"),
      [],
    );
  });

  /** Hook ids and the quality block are user-chosen, so neither can be swept. */
  it("does not warn on user-named hook ids", () => {
    const yaml = `
version: "${AUDIT_VERSION}"
hooks:
  some-project-hook:
    enabled: true
`;
    const result = loadConfig("/tmp", configFS(yaml));
    assert.deepEqual(
      result.warnings.filter(
        (warning) => warning.path === "hooks.some-project-hook",
      ),
      [],
    );
  });
});
