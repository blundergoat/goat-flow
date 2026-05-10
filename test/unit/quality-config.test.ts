import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  cloneQualityConfig,
  compilePatternList,
  DEFAULT_QUALITY_CONFIG,
  loadQualityConfig,
  mergeQualityConfig,
  profileMaxForSubtype,
} from "../../src/cli/quality/quality-config.js";
import {
  findArtifact,
  scoreArtifact,
} from "../../src/cli/quality/skill-quality.js";

function makeTempProject(): string {
  return mkdtempSync(join(tmpdir(), "goat-flow-quality-config-"));
}

function writeYaml(projectRoot: string, body: string): void {
  mkdirSync(join(projectRoot, ".goat-flow"), { recursive: true });
  writeFileSync(join(projectRoot, ".goat-flow/config.yaml"), body);
}

function writeSkill(projectRoot: string, name: string, content: string): void {
  mkdirSync(join(projectRoot, ".claude/skills", name), { recursive: true });
  writeFileSync(join(projectRoot, ".claude/skills", name, "SKILL.md"), content);
}

describe("loadQualityConfig", () => {
  it("returns goat-flow defaults when no config file exists", () => {
    const projectRoot = makeTempProject();
    const config = loadQualityConfig(projectRoot);
    assert.deepEqual(
      config.walkRoots.skills,
      DEFAULT_QUALITY_CONFIG.walkRoots.skills,
    );
    assert.equal(
      config.maxArtifactBytes,
      DEFAULT_QUALITY_CONFIG.maxArtifactBytes,
    );
    assert.equal(
      config.composition.maxComposedBytes,
      DEFAULT_QUALITY_CONFIG.composition.maxComposedBytes,
    );
    assert.equal(
      config.toolKeywordsRegex,
      DEFAULT_QUALITY_CONFIG.toolKeywordsRegex,
    );
  });

  it("returns goat-flow defaults when config has no quality section", () => {
    const projectRoot = makeTempProject();
    writeYaml(projectRoot, "version: 1.6.0\n");
    const config = loadQualityConfig(projectRoot);
    assert.deepEqual(
      config.walkRoots.skills,
      DEFAULT_QUALITY_CONFIG.walkRoots.skills,
    );
  });

  it("merges custom gate vocabulary on top of defaults", () => {
    const projectRoot = makeTempProject();
    writeYaml(
      projectRoot,
      [
        "quality:",
        "  gate-vocabulary:",
        "    verification-gate:",
        '      - "SLO Gate"',
        '      - "Release Gate"',
      ].join("\n"),
    );
    const config = loadQualityConfig(projectRoot);
    assert.deepEqual(config.gateVocabulary.verificationGate, [
      "SLO Gate",
      "Release Gate",
    ]);
    assert.deepEqual(
      config.gateVocabulary.explicitPass,
      DEFAULT_QUALITY_CONFIG.gateVocabulary.explicitPass,
      "explicit-pass should fall back to defaults when not overridden",
    );
  });

  it("accepts a custom subtype profile", () => {
    const projectRoot = makeTempProject();
    writeYaml(
      projectRoot,
      [
        "quality:",
        "  subtypes:",
        "    workflow:",
        "      profile:",
        "        trigger-clarity: 20",
        "        workflow-completeness: 20",
      ].join("\n"),
    );
    const config = loadQualityConfig(projectRoot);
    assert.equal(config.subtypes.workflow.profile["trigger-clarity"], 20);
    assert.equal(config.subtypes.workflow.profile["workflow-completeness"], 20);
    assert.equal(
      config.subtypes.workflow.profile["gate-quality"],
      DEFAULT_QUALITY_CONFIG.subtypes.workflow.profile["gate-quality"],
      "gate-quality should fall back to default when not overridden",
    );
  });

  it("accepts custom subtype detection rules", () => {
    const projectRoot = makeTempProject();
    writeYaml(
      projectRoot,
      [
        "quality:",
        "  subtypes:",
        "    report:",
        "      detection:",
        "        kinds: [skill]",
        "        name-patterns: []",
        '        heading-patterns: ["##\\\\s+Audit Mode"]',
        '        must-not-have: ["##\\\\s+Step 0"]',
      ].join("\n"),
    );
    const config = loadQualityConfig(projectRoot);
    assert.deepEqual(config.subtypes.report.detection.headingPatterns, [
      "##\\s+Audit Mode",
    ]);
    assert.deepEqual(config.subtypes.report.detection.namePatterns, []);
  });

  it("custom config does not affect goat-flow's snapshot when applied to a different project", () => {
    const projectRoot = makeTempProject();
    writeYaml(
      projectRoot,
      [
        "quality:",
        "  subtypes:",
        "    workflow:",
        "      profile:",
        "        trigger-clarity: 1",
      ].join("\n"),
    );
    writeSkill(
      projectRoot,
      "tiny",
      [
        "---",
        "name: tiny",
        'description: "Tiny skill."',
        'goat-flow-skill-version: "1.6.0"',
        "---",
        "# /tiny",
        "## When to Use",
        "Use when testing.",
        "## Step 0",
        "Read context.",
        "## Phase 1",
        "Do.",
        "## Phase 2",
        "More.",
      ].join("\n"),
    );
    const artifact = findArtifact(projectRoot, "skill:tiny")!;
    const report = scoreArtifact(projectRoot, artifact);
    const trigger = report.metrics.find((m) => m.metric === "trigger-clarity")!;
    assert.equal(
      trigger.maxScore,
      1,
      "custom subtype profile must apply to consumer-project scoring",
    );
  });
});

describe("mergeQualityConfig", () => {
  it("returns defaults for null/undefined input", () => {
    assert.deepEqual(mergeQualityConfig(null), DEFAULT_QUALITY_CONFIG);
    assert.deepEqual(mergeQualityConfig(undefined), DEFAULT_QUALITY_CONFIG);
  });

  it("returns defaults for non-object input", () => {
    assert.deepEqual(mergeQualityConfig("string"), DEFAULT_QUALITY_CONFIG);
    assert.deepEqual(mergeQualityConfig(42), DEFAULT_QUALITY_CONFIG);
    assert.deepEqual(mergeQualityConfig([]), DEFAULT_QUALITY_CONFIG);
  });

  it("rejects negative or non-positive numeric overrides for caps", () => {
    const merged = mergeQualityConfig({
      "max-artifact-bytes": -100,
      composition: { "max-composed-bytes": 0 },
    });
    assert.equal(
      merged.maxArtifactBytes,
      DEFAULT_QUALITY_CONFIG.maxArtifactBytes,
    );
    assert.equal(
      merged.composition.maxComposedBytes,
      DEFAULT_QUALITY_CONFIG.composition.maxComposedBytes,
    );
  });

  it("preserves goat-flow profile total maxes (workflow=100)", () => {
    const config = cloneQualityConfig(DEFAULT_QUALITY_CONFIG);
    assert.equal(profileMaxForSubtype(config, "workflow"), 100);
    assert.equal(profileMaxForSubtype(config, "dispatcher"), 70);
    assert.equal(profileMaxForSubtype(config, "report"), 85);
    assert.equal(profileMaxForSubtype(config, "playbook"), 80);
    assert.equal(profileMaxForSubtype(config, "meta"), 50);
    assert.equal(profileMaxForSubtype(config, "index"), 60);
  });
});

describe("compilePatternList", () => {
  it("returns a never-matching regex for an empty list", () => {
    const regex = compilePatternList([]);
    assert.equal(regex.test("anything"), false);
  });

  it("ORs patterns case-insensitively", () => {
    const regex = compilePatternList(["BLOCKING GATE", "Proof Gate"]);
    assert.ok(regex.test("blocking gate appears here"));
    assert.ok(regex.test("Proof Gate"));
    assert.equal(regex.test("nothing relevant"), false);
  });
});
