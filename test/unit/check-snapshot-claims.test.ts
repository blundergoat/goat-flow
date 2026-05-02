/**
 * Unit tests for M06b snapshot-claim lint.
 *
 * The module parses CHANGELOG.md section-by-section and release.md whole-file,
 * and compares numeric claims against frozen snapshots under
 * `workflow/manifest-snapshots/vX.Y.Z.json`. Tests cover:
 *   - CHANGELOG section parsing
 *   - release.md H1 version extraction
 *   - each snapshot-claim pattern (skills, checks, views, presets)
 *   - loadSnapshotFacts (real repo integration)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractReleaseVersion,
  loadSnapshotFacts,
  parseChangelogSections,
  scanSectionAgainstSnapshot,
} from "../../src/cli/audit/check-snapshot-claims.js";

const V110: Parameters<typeof scanSectionAgainstSnapshot>[1] = {
  skills_total: 7,
  skills_functional_count: 6,
  checks_setup: 12,
  checks_agent: 4,
  checks_build: 16,
  checks_harness: 16,
  checks_total: 32,
  dashboard_views_count: 7,
  presets_count: 20,
};

const EXPECTED_RELEASE_SNAPSHOTS = [
  {
    version: "1.1.0",
    facts: {
      skills_total: 7,
      skills_functional_count: 6,
      checks_setup: 12,
      checks_agent: 4,
      checks_build: 16,
      checks_harness: 16,
      checks_total: 32,
      dashboard_views_count: 7,
      presets_count: 20,
    },
  },
  {
    version: "1.2.0",
    facts: {
      skills_total: 7,
      skills_functional_count: 6,
      checks_setup: 13,
      checks_agent: 4,
      checks_build: 17,
      checks_harness: 16,
      checks_total: 33,
      dashboard_views_count: 8,
      presets_count: 22,
    },
  },
  {
    version: "1.2.1",
    facts: {
      skills_total: 7,
      skills_functional_count: 6,
      checks_setup: 13,
      checks_agent: 4,
      checks_build: 17,
      checks_harness: 16,
      checks_total: 33,
      dashboard_views_count: 8,
      presets_count: 22,
    },
  },
  {
    version: "1.2.2",
    facts: {
      skills_total: 7,
      skills_functional_count: 6,
      checks_setup: 13,
      checks_agent: 4,
      checks_build: 17,
      checks_harness: 16,
      checks_total: 33,
      dashboard_views_count: 8,
      presets_count: 22,
    },
  },
  {
    version: "1.2.3",
    facts: {
      skills_total: 7,
      skills_functional_count: 6,
      checks_setup: 13,
      checks_agent: 4,
      checks_build: 17,
      checks_harness: 16,
      checks_total: 33,
      dashboard_views_count: 8,
      presets_count: 23,
    },
  },
  {
    version: "1.2.4",
    facts: {
      skills_total: 7,
      skills_functional_count: 6,
      checks_setup: 13,
      checks_agent: 4,
      checks_build: 17,
      checks_harness: 16,
      checks_total: 33,
      dashboard_views_count: 8,
      presets_count: 28,
    },
  },
  {
    version: "1.2.5",
    facts: {
      skills_total: 7,
      skills_functional_count: 6,
      checks_setup: 13,
      checks_agent: 4,
      checks_build: 17,
      checks_harness: 16,
      checks_total: 33,
      dashboard_views_count: 8,
      presets_count: 28,
    },
  },
  {
    version: "1.3.0",
    facts: {
      skills_total: 7,
      skills_functional_count: 6,
      checks_setup: 13,
      checks_agent: 4,
      checks_build: 17,
      checks_harness: 16,
      checks_total: 33,
      dashboard_views_count: 8,
      presets_count: 29,
    },
  },
  {
    version: "1.3.1",
    facts: {
      skills_total: 7,
      skills_functional_count: 6,
      checks_setup: 13,
      checks_agent: 4,
      checks_build: 17,
      checks_harness: 16,
      checks_total: 33,
      dashboard_views_count: 8,
      presets_count: 29,
    },
  },
  {
    version: "1.3.2",
    facts: {
      skills_total: 7,
      skills_functional_count: 6,
      checks_setup: 13,
      checks_agent: 4,
      checks_build: 17,
      checks_harness: 16,
      checks_total: 33,
      dashboard_views_count: 8,
      presets_count: 29,
    },
  },
  {
    version: "1.4.0",
    facts: {
      skills_total: 7,
      skills_functional_count: 6,
      checks_setup: 13,
      checks_agent: 4,
      checks_build: 17,
      checks_harness: 17,
      checks_total: 34,
      dashboard_views_count: 8,
      presets_count: 26,
    },
  },
] as const;

// ---------------------------------------------------------------------------
// parseChangelogSections
// ---------------------------------------------------------------------------
describe("parseChangelogSections", () => {
  it("splits CHANGELOG by `## vX.Y.Z` headers", () => {
    const text = [
      "# Changelog",
      "",
      "## v1.1.0 (2026-04-13)",
      "- entry one",
      "- entry two",
      "",
      "## v1.0.0",
      "- old entry",
    ].join("\n");
    const sections = parseChangelogSections(text);
    assert.equal(sections.length, 2);
    assert.equal(sections[0]!.version, "1.1.0");
    assert.equal(sections[1]!.version, "1.0.0");
    assert.match(sections[0]!.body, /entry one/);
    assert.match(sections[0]!.body, /entry two/);
    assert.match(sections[1]!.body, /old entry/);
  });

  it("captures the correct startLine for each section header", () => {
    const text = ["# Log", "", "", "## v1.2.3", "content"].join("\n");
    const sections = parseChangelogSections(text);
    assert.equal(sections.length, 1);
    assert.equal(sections[0]!.startLine, 4);
  });

  it("returns an empty array when no version headers are present", () => {
    const sections = parseChangelogSections("# Changelog\n\nno sections here.");
    assert.equal(sections.length, 0);
  });
});

// ---------------------------------------------------------------------------
// extractReleaseVersion
// ---------------------------------------------------------------------------
describe("extractReleaseVersion", () => {
  it("pulls version from `# GOAT Flow vX.Y.Z Release Notes`", () => {
    const text = "# GOAT Flow v1.1.0 Release Notes\n\nbody";
    assert.equal(extractReleaseVersion(text), "1.1.0");
  });

  it("pulls version from a bare `# vX.Y.Z` H1", () => {
    const text = "# v2.0.1\nbody";
    assert.equal(extractReleaseVersion(text), "2.0.1");
  });

  it("returns null when the H1 is missing a version", () => {
    const text = "# Random title\nbody";
    assert.equal(extractReleaseVersion(text), null);
  });
});

// ---------------------------------------------------------------------------
// scanSectionAgainstSnapshot (claim patterns)
// ---------------------------------------------------------------------------
describe("scanSectionAgainstSnapshot", () => {
  it("flags wrong harness-check count in a CHANGELOG section", () => {
    const section = {
      version: "1.1.0",
      startLine: 3,
      body: "Replaced with 27 advisory harness checks across 5 concerns.",
    };
    const findings = scanSectionAgainstSnapshot(section, V110, "CHANGELOG.md");
    assert.ok(findings.some((f) => f.rule === "changelog-harness-checks"));
    assert.equal(findings[0]!.severity, "warning");
    assert.match(findings[0]!.message, /v1\.1\.0/);
    assert.match(findings[0]!.message, /27/);
    assert.match(findings[0]!.message, /16/);
  });

  it("accepts matching harness-check count", () => {
    const section = {
      version: "1.1.0",
      startLine: 3,
      body: "16 advisory harness checks",
    };
    const findings = scanSectionAgainstSnapshot(section, V110, "CHANGELOG.md");
    assert.equal(findings.length, 0);
  });

  it("matches the 'completeness' and 'installation' harness variants", () => {
    const completenessSec = {
      version: "1.1.0",
      startLine: 1,
      body: "99 harness completeness checks",
    };
    const installationSec = {
      version: "1.1.0",
      startLine: 1,
      body: "99 AI harness installation checks",
    };
    assert.equal(
      scanSectionAgainstSnapshot(completenessSec, V110, "x.md").length,
      1,
    );
    assert.equal(
      scanSectionAgainstSnapshot(installationSec, V110, "x.md").length,
      1,
    );
  });

  it("flags wrong skill-template and canonical-skill counts", () => {
    const section = {
      version: "1.1.0",
      startLine: 1,
      body: "8 skill templates, 9 canonical skills",
    };
    const findings = scanSectionAgainstSnapshot(section, V110, "x.md");
    assert.ok(findings.some((f) => f.rule === "changelog-skill-templates"));
    assert.ok(findings.some((f) => f.rule === "changelog-skills-canonical"));
  });

  it("flags wrong project-wide setup + per-agent checks", () => {
    const section = {
      version: "1.1.0",
      startLine: 1,
      body: "13 project-wide setup checks, 5 per-agent checks",
    };
    const findings = scanSectionAgainstSnapshot(section, V110, "x.md");
    assert.ok(findings.some((f) => f.rule === "changelog-setup-checks"));
    assert.ok(findings.some((f) => f.rule === "changelog-agent-checks"));
  });

  it("flags wrong build-check, dashboard-view, preset counts", () => {
    const section = {
      version: "1.1.0",
      startLine: 1,
      body: "99 build checks, 8 dashboard views, 21 workspace presets",
    };
    const findings = scanSectionAgainstSnapshot(section, V110, "x.md");
    assert.ok(findings.some((f) => f.rule === "changelog-build-checks"));
    assert.ok(findings.some((f) => f.rule === "changelog-dashboard-views"));
    assert.ok(findings.some((f) => f.rule === "changelog-presets"));
  });

  it("skips numeric claims inside code blocks", () => {
    const section = {
      version: "1.1.0",
      startLine: 1,
      body: ["```", "99 canonical skills", "```", "7 canonical skills"].join(
        "\n",
      ),
    };
    const findings = scanSectionAgainstSnapshot(section, V110, "x.md");
    assert.equal(findings.length, 0);
  });

  it("labels release.md findings with the file name instead of CHANGELOG", () => {
    // release.md uses startLine=0 as the sentinel for whole-file scans.
    const section = {
      version: "1.1.0",
      startLine: 0,
      body: "99 build checks",
    };
    const findings = scanSectionAgainstSnapshot(
      section,
      V110,
      ".goat-flow/scratchpad/release.md",
    );
    assert.equal(findings.length, 1);
    assert.match(findings[0]!.message, /release\.md/);
    assert.doesNotMatch(findings[0]!.message, /CHANGELOG v/);
  });
});

// ---------------------------------------------------------------------------
// loadSnapshotFacts (live repo)
// ---------------------------------------------------------------------------
describe("loadSnapshotFacts (real repo)", () => {
  it("loads every release snapshot that CHANGELOG sections rely on", () => {
    for (const expected of EXPECTED_RELEASE_SNAPSHOTS) {
      const facts = loadSnapshotFacts(expected.version);
      assert.ok(facts, `expected v${expected.version} snapshot to exist`);
      for (const [key, value] of Object.entries(expected.facts)) {
        assert.equal(
          facts[key as keyof typeof expected.facts],
          value,
          `expected v${expected.version} ${key}=${value}`,
        );
      }
    }
  });

  it("returns null for a version with no snapshot", () => {
    const facts = loadSnapshotFacts("0.0.1");
    assert.equal(facts, null);
  });
});
