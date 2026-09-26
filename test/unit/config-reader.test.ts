/**
 * Exercises config defaults, merging, and validation shown to setup users.
 * Use these tests when configuration parsing changes so missing or malformed
 * project settings still produce predictable operator-facing results.
 */
import { describe, it } from "node:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCLIArgs } from "../../src/cli/cli-parser.js";
import { CLIError } from "../../src/cli/cli-error.js";
import {
  PROJECT_ROOT,
  runPlansCheck,
  writeCheckFixture,
  writeCheckPlan,
  canonicalMilestoneBody,
} from "./plans-check.helpers.js";
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

describe("config validates active milestone policy", () => {
  it("accepts optional asymmetric percentile pairs and rejects malformed bands by config key", () => {
    for (const pair of [
      [20, 80],
      [12.5, 95],
      [1, 99],
    ]) {
      const result = loadConfig(
        "/tmp",
        configFS(`plans:\n  forecastBandQuantiles: ${JSON.stringify(pair)}`),
      );
      assert.equal(result.valid, true);
      assert.deepEqual(result.config.plans.forecastBandQuantiles, pair);
      assert.deepEqual(result.warnings, []);
    }
    for (const raw of [
      "null",
      "true",
      '"20,80"',
      "[]",
      "[10]",
      "[10, 90, 95]",
      '["10", 90]',
      "[0, 90]",
      "[50, 90]",
      "[10, 50]",
      "[10, 100]",
      "[90, 10]",
      "[.nan, 90]",
      "[10, .inf]",
    ]) {
      const result = loadConfig(
        "/tmp",
        configFS(`plans:\n  forecastBandQuantiles: ${raw}`),
      );
      assert.equal(result.valid, false, raw);
      assert.deepEqual(result.config.plans.forecastBandQuantiles, [10, 90]);
      assert.deepEqual(result.errors, [
        {
          level: "error",
          path: "plans.forecastBandQuantiles",
          message: "must be a pair with 0 < low < 50 < high < 100",
        },
      ]);
    }
  });

  it("defaults omitted policy to one and retains the canonical plans path", () => {
    for (const yaml of [null, "", "plans: {}", "plans:\n  path: elsewhere"]) {
      const result = loadConfig("/tmp", configFS(yaml));
      assert.equal(result.valid, true);
      assert.deepEqual(result.config.plans, {
        path: ".goat-flow/plans/",
        maxActiveMilestones: 1,
        forecastBandQuantiles: [10, 90],
      });
    }
  });

  it("loads positive safe integer caps without config warnings", () => {
    for (const cap of [1, 2, Number.MAX_SAFE_INTEGER]) {
      const result = loadConfig(
        "/tmp",
        configFS(`plans:\n  maxActiveMilestones: ${cap}`),
      );
      assert.equal(result.valid, true);
      assert.equal(result.config.plans.maxActiveMilestones, cap);
      assert.deepEqual(result.warnings, []);
    }
  });

  it("names malformed policy values instead of silently accepting defaults", () => {
    for (const raw of [
      "0",
      "-1",
      "1.5",
      '"2"',
      "true",
      ".inf",
      ".nan",
      "9007199254740992",
      "null",
    ]) {
      const result = loadConfig(
        "/tmp",
        configFS(`plans:\n  maxActiveMilestones: ${raw}`),
      );
      assert.equal(result.valid, false, raw);
      assert.equal(result.config.plans.maxActiveMilestones, 1);
      assert.deepEqual(result.errors, [
        {
          level: "error",
          path: "plans.maxActiveMilestones",
          message: "must be a positive safe integer",
        },
      ]);
    }
    for (const raw of ["null", "[]", "2"]) {
      const result = loadConfig("/tmp", configFS(`plans: ${raw}`));
      assert.equal(result.valid, false, raw);
      assert.equal(result.errors[0]?.path, "plans");
    }
  });

  it("warns about a misspelled cap while preserving the default", () => {
    const result = loadConfig(
      "/tmp",
      configFS("plans:\n  maxActiveMilestone: 2"),
    );
    assert.equal(result.valid, true);
    assert.equal(result.config.plans.maxActiveMilestones, 1);
    assert.deepEqual(result.warnings, [
      {
        level: "warning",
        path: "plans.maxActiveMilestone",
        message: "unknown key",
      },
    ]);
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

describe("config merges post-turn scan roots", () => {
  it("normalizes scan-roots into the typed hook config", () => {
    const yaml = `
version: "${AUDIT_VERSION}"
hooks:
  post-turn-safety:
    enabled: true
    scan-roots:
      - services/api
      - packages/web
`;
    const result = loadConfig("/tmp", configFS(yaml));
    assert.equal(result.valid, true);
    assert.deepStrictEqual(result.config.hooks["post-turn-safety"], {
      enabled: true,
      scanRoots: ["services/api", "packages/web"],
    });
  });

  for (const invalidCase of [
    {
      name: "non-array value",
      yaml: "    scan-roots: services/api",
      path: "hooks.post-turn-safety.scan-roots",
    },
    {
      name: "empty list",
      yaml: "    scan-roots: []",
      path: "hooks.post-turn-safety.scan-roots",
    },
    {
      name: "non-string item",
      yaml: "    scan-roots:\n      - 7",
      path: "hooks.post-turn-safety.scan-roots[0]",
    },
    {
      name: "absolute path",
      yaml: "    scan-roots:\n      - /tmp/repo",
      path: "hooks.post-turn-safety.scan-roots[0]",
    },
    {
      name: "parent escape",
      yaml: "    scan-roots:\n      - ../repo",
      path: "hooks.post-turn-safety.scan-roots[0]",
    },
    {
      name: "normalized parent escape",
      yaml: "    scan-roots:\n      - services/../../repo",
      path: "hooks.post-turn-safety.scan-roots[0]",
    },
  ]) {
    it(`rejects ${invalidCase.name} at its exact config key`, () => {
      const yaml = `
version: "${AUDIT_VERSION}"
hooks:
  post-turn-safety:
    enabled: true
${invalidCase.yaml}
`;
      const result = loadConfig("/tmp", configFS(yaml));
      assert.equal(result.valid, false);
      assert.ok(
        result.errors.some((error) => error.path === invalidCase.path),
        JSON.stringify(result.errors),
      );
    });
  }
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

describe("config warns on misspelled quality keys", () => {
  it("warns on unknown keys across the quality block's fixed nesting", () => {
    const yaml = `
version: "${AUDIT_VERSION}"
quality:
  max-artifact-byte: 200000
  composition:
    skill-preamble-paths: workflow/skills/skill-preamble.md
  gate-vocabulary:
    verification-gates: ["runs? tests"]
  subtypes:
    dispatchers: {}
    workflow:
      profil:
        token-cost: 5
`;
    const result = loadConfig("/tmp", configFS(yaml));
    assert.equal(result.valid, true);
    for (const path of [
      "quality.max-artifact-byte",
      "quality.composition.skill-preamble-paths",
      "quality.gate-vocabulary.verification-gates",
      "quality.subtypes.dispatchers",
      "quality.subtypes.workflow.profil",
    ]) {
      assert.ok(
        result.warnings.some((warning) => warning.path === path),
        `${path} missing from ${JSON.stringify(result.warnings)}`,
      );
    }
  });

  it("accepts a fully valid nested quality block without warnings", () => {
    const yaml = `
version: "${AUDIT_VERSION}"
quality:
  max-artifact-bytes: 200000
  walk-roots:
    skills:
      - dir: .claude/skills
        source: installed
  composition:
    skill-preamble-path: workflow/skills/skill-preamble.md
  gate-vocabulary:
    verification-gate: ["runs? tests"]
  tool-keywords-regex: "browser-use"
  fixture-path: test/fixtures/quality-scores.json
  additional-fixtures: []
  subtypes:
    workflow:
      notes: tuned for this project
      profile:
        token-cost: 5
      detection:
        name-patterns: ["goat-review"]
`;
    const result = loadConfig("/tmp", configFS(yaml));
    assert.equal(result.valid, true);
    assert.equal(
      result.warnings.some((warning) => warning.path.startsWith("quality")),
      false,
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

  it("warns when a goat-review option is misspelled", () => {
    const yaml = `
version: "${AUDIT_VERSION}"
skills:
  goat-review:
    local_pr_baze: "deploy"
`;
    const result = loadConfig("/tmp", configFS(yaml));

    assert.ok(
      result.warnings.some(
        (warning) => warning.path === "skills.goat-review.local_pr_baze",
      ),
      JSON.stringify(result.warnings),
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

describe("plans check: active cap input and project authority", () => {
  it("parses only canonical positive decimal caps", () => {
    assert.equal(parseCLIArgs(["plans", "check", "."]).plansMaxActive, null);
    for (const cap of [1, 2, Number.MAX_SAFE_INTEGER]) {
      assert.equal(
        parseCLIArgs(["plans", "check", ".", "--max-active", String(cap)])
          .plansMaxActive,
        cap,
      );
    }
    for (const raw of [
      "",
      "0",
      "-1",
      "1.5",
      "01",
      "+2",
      "2e0",
      "0x2",
      " 2",
      "2 ",
      "Infinity",
      "NaN",
      "9007199254740992",
    ]) {
      assert.throws(
        () => parseCLIArgs(["plans", "check", ".", `--max-active=${raw}`]),
        (error: unknown) =>
          error instanceof CLIError &&
          error.exitCode === 2 &&
          error.message.includes("--max-active"),
      );
    }
  });

  it("rejects the cap on export, every timing action, and non-plan commands", () => {
    for (const args of [
      ["plans", "export", "."],
      ["plans", "time", "start", "M01.md", "--category", "product"],
      ["plans", "time", "stop", "M01.md"],
      ["plans", "time", "status", "M01.md"],
      ["audit", "."],
    ]) {
      assert.throws(
        () => parseCLIArgs([...args, "--max-active", "2"]),
        (error: unknown) =>
          error instanceof CLIError &&
          error.exitCode === 2 &&
          error.message === "--max-active is only valid for plans check.",
      );
    }
    const missing = runPlansCheck(".", "--max-active");
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /--max-active/u);
  });

  /** Temporary canonical and external plans prove config errors, precedence, and quiet warnings through the CLI. */
  it("loads only canonical project policy and lets fully explicit policy bypass malformed config", () => {
    const root = mkdtempSync(join(tmpdir(), "goat-flow-plan-policy-"));
    try {
      const canonical = writeCheckFixture(
        join(root, ".goat-flow", "plans"),
        canonicalMilestoneBody(),
      );
      const external = writeCheckFixture(
        join(root, "external"),
        canonicalMilestoneBody(),
      );
      const configPath = join(root, ".goat-flow", "config.yaml");
      const baseline = runPlansCheck(external, "--strict");
      assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
      const missingConfig = runPlansCheck(canonical, "--strict");
      assert.equal(missingConfig.stdout, baseline.stdout);
      assert.equal(missingConfig.stderr, baseline.stderr);
      assert.equal(missingConfig.status, 0);
      for (const yaml of [
        "plans:\n  maxActiveMilestones: 0",
        "plans: []",
        "plans: [",
      ]) {
        writeFileSync(configPath, yaml);
        const invalid = runPlansCheck(canonical, "--strict");
        assert.equal(invalid.status, 2);
        assert.ok(invalid.stderr.includes(configPath), invalid.stderr);
        if (yaml.includes("maxActiveMilestones"))
          assert.match(invalid.stderr, /plans\.maxActiveMilestones/u);
        const override = runPlansCheck(
          canonical,
          "--strict",
          "--max-active",
          "2",
          "--band-quantiles",
          "10,90",
        );
        assert.equal(override.status, 0, override.stdout + override.stderr);
        assert.equal(override.stderr, "");
        const outside = runPlansCheck(external, "--strict");
        assert.equal(outside.stdout, baseline.stdout);
        assert.equal(outside.stderr, baseline.stderr);
        assert.equal(outside.status, baseline.status);
      }
      writeFileSync(
        configPath,
        "plans:\n  maxActiveMilestones: 1\n  future-policy: true\n",
      );
      const warning = runPlansCheck(canonical, "--strict");
      assert.equal(warning.stdout, baseline.stdout);
      assert.equal(warning.stderr, baseline.stderr);
      assert.equal(warning.status, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /** Copies the consumer fixture into a temporary project to prove which positive cap reaches enforcement. */
  it("uses the canonical configured cap unless an explicit flag overrides it", () => {
    const root = mkdtempSync(join(tmpdir(), "goat-flow-plan-cap-precedence-"));
    try {
      const files: Record<string, string> = {};
      for (const name of [
        "M17-shared-baseline.md",
        "M18-go-precision.md",
        "M19-php-precision.md",
      ]) {
        files[name] = readFileSync(
          join(
            PROJECT_ROOT,
            "test",
            "fixtures",
            "plans",
            "parallel-lanes",
            name,
          ),
          "utf-8",
        );
      }
      const plan = writeCheckPlan(join(root, ".goat-flow", "plans"), files);
      const config = join(root, ".goat-flow", "config.yaml");
      writeFileSync(config, "plans:\n  maxActiveMilestones: 2\n");
      const configured = runPlansCheck(plan, "--strict");
      assert.equal(configured.status, 0, configured.stdout + configured.stderr);
      assert.match(configured.stdout, /plan: 2 active milestones \(cap 2\)/u);
      const overridden = runPlansCheck(plan, "--strict", "--max-active", "1");
      assert.equal(overridden.status, 1);
      assert.match(
        overridden.stdout,
        /error: plan: multiple active milestones: M18, M19/u,
      );
      assert.doesNotMatch(overridden.stdout, /^active:|\(cap /mu);
      writeFileSync(config, "plans: {}\n");
      const omitted = runPlansCheck(plan, "--strict");
      assert.equal(omitted.status, overridden.status);
      assert.equal(omitted.stdout, overridden.stdout);
      assert.equal(omitted.stderr, overridden.stderr);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /** Symlinked operands may be readable while lacking authority to use the apparent project's config. */
  it("requires physical containment of both the plans root and selected directory", (context) => {
    const root = mkdtempSync(join(tmpdir(), "goat-flow-plan-policy-links-"));
    try {
      const project = join(root, "project");
      const canonical = writeCheckFixture(
        join(project, ".goat-flow", "plans"),
        canonicalMilestoneBody(),
      );
      const outsidePlans = writeCheckFixture(
        join(project, "elsewhere"),
        canonicalMilestoneBody(),
      );
      const escaped = join(project, ".goat-flow", "plans", "escaped");
      const contained = join(project, ".goat-flow", "plans", "contained");
      const redirectedProject = join(root, "redirected");
      mkdirSync(join(redirectedProject, ".goat-flow"), { recursive: true });
      try {
        symlinkSync(outsidePlans, escaped, "dir");
        symlinkSync(canonical, contained, "dir");
        symlinkSync(
          join(project, ".goat-flow", "plans"),
          join(redirectedProject, ".goat-flow", "plans"),
          "dir",
        );
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "EPERM"
        ) {
          context.skip("Host does not permit unprivileged symlinks.");
          return;
        }
        throw error;
      }
      for (const owner of [project, redirectedProject]) {
        writeFileSync(
          join(owner, ".goat-flow", "config.yaml"),
          "plans:\n  maxActiveMilestones: 0",
        );
      }
      for (const selected of [
        escaped,
        join(redirectedProject, ".goat-flow", "plans", "plan"),
      ]) {
        const result = runPlansCheck(selected, "--strict");
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.equal(result.stderr, "");
      }
      const within = runPlansCheck(contained, "--strict");
      assert.equal(within.status, 2);
      assert.match(within.stderr, /plans\.maxActiveMilestones/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
