/**
 * Unit tests for the M06a single-source-of-truth manifest.
 *
 * `composeManifest` / `validateManifest` are pure and tested with fixtures.
 * `loadManifest` / `checkManifest` are tested against the live repo - this
 * both exercises the real disk path and asserts that `workflow/manifest.json`
 * is consistent with code at test time.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  composeManifest,
  validateManifest,
  validateSkillReferenceSchema,
  loadManifest,
  checkManifest,
  getSkillFiles,
  getRequiredInstructionSections,
  renderManifestMarkdown,
  resetManifestCache,
} from "../../src/cli/manifest/manifest.js";
import type {
  ManifestJson,
  ObservedFacts,
} from "../../src/cli/manifest/types.js";
import { ManifestValidationError } from "../../src/cli/manifest/types.js";
import { AUDIT_VERSION, SKILL_NAMES } from "../../src/cli/constants.js";
import { SETUP_CHECKS } from "../../src/cli/audit/check-goat-flow.js";
import { AGENT_CHECKS } from "../../src/cli/audit/check-agent-setup.js";
import { HARNESS_CHECKS } from "../../src/cli/audit/harness/index.js";

/** Build a fixture ManifestJson whose static facts match the provided observed. */
function fixtureJson(
  overrides: Partial<ManifestJson["facts"]> = {},
  skillsCanonical: string[] = [...SKILL_NAMES],
): ManifestJson {
  return {
    description: "fixture",
    version: AUDIT_VERSION,
    required_files: [],
    required_dirs: [],
    directory_purposes: {},
    optional_files: {},
    never_create: [],
    skills: {
      canonical: skillsCanonical,
      stale_names: ["goat-audit", "goat-investigate"],
      references: {},
    },
    agents: {},
    instruction_file: {
      line_target: 125,
      line_limit: 150,
      required_sections: [
        "Truth Order",
        "Autonomy Tiers",
        "Hard Rules",
        "Key Resources",
        "Essential Commands",
        "Execution Loop",
        "Definition of Done",
        "Artifact Routing",
        "Router Table",
      ],
      version_header_pattern: "# {FILE} - v{VERSION} ({DATE})",
    },
    facts: {
      dashboard_views: ["quality", "about", "home"],
      ...overrides,
    },
  };
}

function fixtureObserved(
  overrides: Partial<ObservedFacts> = {},
): ObservedFacts {
  return {
    views: ["quality", "about", "home"],
    presetsCount: 3,
    skills: [...SKILL_NAMES],
    setupChecks: 12,
    agentChecks: 4,
    harnessChecks: 16,
    version: AUDIT_VERSION,
    ...overrides,
  };
}

function fixtureAgent(
  overrides: Partial<ManifestJson["agents"][string]> = {},
): ManifestJson["agents"][string] {
  return {
    name: "Claude Code",
    instruction_file: "CLAUDE.md",
    skills_dir: ".claude/skills/",
    capabilities: {
      terminal_binary: "claude",
      setup_surfaces: ["CLAUDE.md", ".claude/settings.json"],
      prompt_invocation_style: "slash",
      skill_source: "installed",
    },
    hooks_dir: ".claude/hooks/",
    settings: ".claude/settings.json",
    hook_config_file: ".claude/settings.json",
    deny_hook: ".claude/hooks/guard-repository-writes.sh",
    deny_mechanism: {
      type: "both",
      settings_path: ".claude/settings.json",
      script_path: ".claude/hooks/guard-repository-writes.sh",
    },
    local_pattern: "*/CLAUDE.md",
    hook_events: {
      pre_tool: "PreToolUse",
      post_turn: "Stop",
    },
    hooks: [
      "guard-common.sh",
      "guard-destructive-shell.sh",
      "guard-secret-paths.sh",
      "guard-repository-writes.sh",
      "guardrails-self-test.sh",
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// composeManifest: derivation + shape
// ---------------------------------------------------------------------------
describe("composeManifest", () => {
  it("derives skill facts from observed SKILL_NAMES", () => {
    const json = fixtureJson();
    const observed = fixtureObserved({
      skills: ["goat", "goat-debug", "goat-qa"],
    });
    const m = composeManifest(json, observed);
    assert.equal(m.facts.skills.total, 3);
    assert.equal(m.facts.skills.dispatcher, "goat");
    assert.equal(m.facts.skills.functional_count, 2);
    assert.deepEqual(
      [...m.facts.skills.names],
      ["goat", "goat-debug", "goat-qa"],
    );
  });

  it("sums check counts and exposes them under facts.checks", () => {
    const json = fixtureJson();
    const observed = fixtureObserved({
      setupChecks: 12,
      agentChecks: 4,
      harnessChecks: 16,
    });
    const m = composeManifest(json, observed);
    assert.equal(m.facts.checks.setup, 12);
    assert.equal(m.facts.checks.agent, 4);
    assert.equal(m.facts.checks.harness, 16);
    assert.equal(m.facts.checks.total, 32);
  });

  it("sorts dashboard view names and exposes count", () => {
    const json = fixtureJson({
      dashboard_views: ["workspace", "home", "quality"],
    });
    const observed = fixtureObserved({
      views: ["quality", "home", "workspace"],
    });
    const m = composeManifest(json, observed);
    assert.deepEqual(
      [...m.facts.dashboard_views.names],
      ["home", "quality", "workspace"],
    );
    assert.equal(m.facts.dashboard_views.count, 3);
  });

  it("derives preset count from the observed preset catalog size", () => {
    const json = fixtureJson();
    const observed = fixtureObserved({ presetsCount: 7 });
    const m = composeManifest(json, observed);
    assert.equal(m.facts.presets.count, 7);
  });

  it("passes through stale_names from manifest.skills", () => {
    const json = fixtureJson();
    const observed = fixtureObserved();
    const m = composeManifest(json, observed);
    assert.deepEqual(
      [...m.facts.skills.stale_names],
      ["goat-audit", "goat-investigate"],
    );
  });

  it("exposes per-skill reference files from the live manifest", () => {
    resetManifestCache();
    assert.deepEqual(getSkillFiles("goat"), ["SKILL.md"]);
    assert.deepEqual(getSkillFiles("goat-security"), [
      "SKILL.md",
      "references/common-threats.md",
      "references/identity-and-data.md",
      "references/file-upload-and-paths.md",
      "references/supply-chain-and-cicd.md",
      "references/project-policy-template.md",
    ]);
  });
});

// ---------------------------------------------------------------------------
// validateManifest: drift detection
// ---------------------------------------------------------------------------
describe("validateManifest (clean case)", () => {
  it("accepts a manifest whose static facts match observed state", () => {
    const json = fixtureJson();
    const observed = fixtureObserved();
    assert.doesNotThrow(() => validateManifest(json, observed));
  });

  it("accepts an agent with valid capability metadata", () => {
    const json = fixtureJson();
    json.agents.claude = fixtureAgent();

    assert.doesNotThrow(() => validateManifest(json, fixtureObserved()));
  });
});

describe("validateManifest (agent capability metadata)", () => {
  it("throws when a fake manifest agent is missing capability metadata", () => {
    const json = fixtureJson();
    const agent = fixtureAgent() as ManifestJson["agents"][string] & {
      capabilities?: unknown;
    };
    delete agent.capabilities;
    json.agents.opencode = agent;

    assert.throws(
      () => validateManifest(json, fixtureObserved()),
      (err: unknown) =>
        err instanceof ManifestValidationError &&
        err.findings.some((f) =>
          f.includes("agents.opencode.capabilities must be an object"),
        ),
    );
  });

  it("throws on invalid capability enum values", () => {
    const json = fixtureJson();
    json.agents.claude = fixtureAgent();
    (
      json.agents.claude.capabilities as {
        prompt_invocation_style: unknown;
        skill_source: unknown;
      }
    ).prompt_invocation_style = "bang";
    (
      json.agents.claude.capabilities as {
        prompt_invocation_style: unknown;
        skill_source: unknown;
      }
    ).skill_source = "copied";

    assert.throws(
      () => validateManifest(json, fixtureObserved()),
      (err: unknown) =>
        err instanceof ManifestValidationError &&
        err.findings.some((f) =>
          f.includes("agents.claude.capabilities.prompt_invocation_style"),
        ) &&
        err.findings.some((f) =>
          f.includes("agents.claude.capabilities.skill_source"),
        ),
    );
  });
});

describe("validateSkillReferenceSchema", () => {
  it("accepts an omitted references map", () => {
    const json = fixtureJson();
    assert.doesNotThrow(() => validateSkillReferenceSchema(json));
  });

  it("throws when one skill reference entry is not an array", () => {
    const json = fixtureJson();
    (json.skills.references as Record<string, unknown>).goat = "SKILL.md";
    assert.throws(
      () => validateSkillReferenceSchema(json),
      (err: unknown) =>
        err instanceof ManifestValidationError &&
        err.findings.some((f) => f.includes("skills.references.goat")),
    );
  });

  it("throws when one skill reference entry contains non-strings", () => {
    const json = fixtureJson();
    (json.skills.references as Record<string, unknown>).goat = [
      "references/x.md",
      42,
    ];
    assert.throws(
      () => validateSkillReferenceSchema(json),
      (err: unknown) =>
        err instanceof ManifestValidationError &&
        err.findings.some((f) => f.includes("skills.references.goat")),
    );
  });

  it("throws when a references entry uses an unknown skill key", () => {
    const json = fixtureJson();
    (json.skills.references as Record<string, unknown>).goat_typo = [
      "references/x.md",
    ];
    assert.throws(
      () => validateSkillReferenceSchema(json),
      (err: unknown) =>
        err instanceof ManifestValidationError &&
        err.findings.some((f) => f.includes("skills.references.goat_typo")),
    );
  });
});

describe("validateManifest (missing key)", () => {
  it("throws when the facts key is missing", () => {
    const json = fixtureJson();
    // Simulate pre-M06 manifest with no facts key at all.
    delete (json as { facts?: unknown }).facts;
    assert.throws(
      () => validateManifest(json, fixtureObserved()),
      (err: unknown) =>
        err instanceof ManifestValidationError &&
        err.findings.some((f) =>
          f.includes("missing the top-level `facts` key"),
        ),
    );
  });
});

describe("validateManifest (drifted count)", () => {
  it("throws on dashboard_views list drift", () => {
    const json = fixtureJson({ dashboard_views: ["quality", "about"] });
    const observed = fixtureObserved({ views: ["quality", "about", "home"] });
    assert.throws(
      () => validateManifest(json, observed),
      (err: unknown) =>
        err instanceof ManifestValidationError &&
        err.findings.some((f) => f.includes("dashboard_views drift")),
    );
  });

  it("throws on skills.canonical drift from SKILL_NAMES", () => {
    const json = fixtureJson({}, ["goat", "goat-debug"]);
    const observed = fixtureObserved();
    assert.throws(
      () => validateManifest(json, observed),
      (err: unknown) =>
        err instanceof ManifestValidationError &&
        err.findings.some((f) => f.includes("skills.canonical drift")),
    );
  });

  it("reports multiple findings in a single throw", () => {
    const json = fixtureJson(
      {
        dashboard_views: ["quality"],
      },
      ["goat", "goat-debug"],
    );
    const observed = fixtureObserved();
    try {
      validateManifest(json, observed);
      assert.fail("expected throw");
    } catch (err) {
      assert.ok(err instanceof ManifestValidationError);
      assert.equal(err.findings.length, 2);
    }
  });

  it("allows dashboard_views list to be in any order", () => {
    const json = fixtureJson({
      dashboard_views: ["home", "quality", "about"],
    });
    const observed = fixtureObserved({
      views: ["quality", "about", "home"],
    });
    assert.doesNotThrow(() => validateManifest(json, observed));
  });
});

// ---------------------------------------------------------------------------
// loadManifest + checkManifest: live repo integration
// ---------------------------------------------------------------------------
describe("loadManifest (real repo)", () => {
  it("resolves without throwing and returns correct derived values", () => {
    resetManifestCache();
    const m = loadManifest();
    assert.equal(m.facts.skills.total, SKILL_NAMES.length);
    assert.equal(m.facts.skills.dispatcher, "goat");
    assert.equal(m.facts.skills.functional_count, SKILL_NAMES.length - 1);
    assert.equal(m.facts.checks.setup, SETUP_CHECKS.length);
    assert.equal(m.facts.checks.agent, AGENT_CHECKS.length);
    assert.equal(m.facts.checks.harness, HARNESS_CHECKS.length);
    assert.equal(m.facts.presets.count, 26);
    assert.equal(
      m.facts.checks.total,
      SETUP_CHECKS.length + AGENT_CHECKS.length + HARNESS_CHECKS.length,
    );
  });

  it("is memoised - repeated calls return the same object", () => {
    resetManifestCache();
    const m1 = loadManifest();
    const m2 = loadManifest();
    assert.strictEqual(m1, m2);
  });
});

describe("checkManifest (real repo)", () => {
  it("returns pass with no findings on the live repo", () => {
    resetManifestCache();
    const report = checkManifest();
    assert.equal(report.status, "pass");
    assert.equal(report.findings.length, 0);
  });
});

// ---------------------------------------------------------------------------
// getRequiredInstructionSections: manifest-sourced harness input (T1 pinning)
// ---------------------------------------------------------------------------
describe("getRequiredInstructionSections (real repo)", () => {
  it("returns one entry per manifest required_sections label", () => {
    resetManifestCache();
    const sections = getRequiredInstructionSections();
    const manifestLabels = loadManifest().instruction_file.required_sections;
    assert.equal(sections.length, manifestLabels.length);
    const labels = sections.map((s) => s.label);
    assert.deepEqual(labels, manifestLabels);
  });

  it("each entry's regex matches a case-varied heading with its label", () => {
    resetManifestCache();
    for (const { label, pattern } of getRequiredInstructionSections()) {
      assert.ok(
        pattern.test(`## ${label}\n`),
        `pattern for ${label} should match "## ${label}"`,
      );
      assert.ok(
        pattern.test(`### ${label.toUpperCase()}\n`),
        `pattern for ${label} should be case-insensitive`,
      );
      assert.equal(
        pattern.test(`some prose that mentions ${label} inline`),
        false,
        `pattern for ${label} must not match inline prose`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// renderManifestMarkdown
// ---------------------------------------------------------------------------
describe("renderManifestMarkdown", () => {
  it("produces markdown with a facts table and skill list", () => {
    resetManifestCache();
    const md = renderManifestMarkdown(loadManifest());
    assert.match(md, /^# goat-flow manifest/m);
    assert.match(md, /\| Setup checks \|/);
    assert.match(md, /\| Skills \(total\) \|/);
    assert.match(md, /\*\*Agent registry authority:\*\*/);
    assert.match(md, /^## Agents$/m);
    assert.match(md, /\| Agent \| Instruction \| Settings \| Hook config \|/);
    assert.match(md, /\*\*Skills:\*\*/);
    assert.match(md, /\*\*Dashboard views:\*\*/);
  });
});
