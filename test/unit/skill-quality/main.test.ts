/**
 * Artifact discovery for skill-quality: enumerating installed skills, shared references, and playbooks (README
 * excluded), looking artifacts up by id, aggregating mirrored skills without duplicate rows while marking
 * agent-mirror-only skills as missing metadata, skipping symlinks, and counting skill-local references.
 */
import {
  describe,
  it,
  assert,
  mkdirSync,
  writeFileSync,
  join,
  discoverArtifacts,
  evaluateContent,
  findArtifact,
  scoreArtifact,
  symlinkOrSkip,
  PROJECT_ROOT,
  makeTempProject,
  writeText,
  writeSkill,
  getRepoArtifacts,
  cloneQualityConfig,
  DEFAULT_QUALITY_CONFIG,
} from "./helpers.js";
import { composeArtifactQualityPrompt } from "../../../src/cli/prompt/compose-quality.js";
import { composeArtifactContent } from "../../../src/cli/quality/skill-quality-content.js";

describe("artifact composition", () => {
  it("keeps the primary skill ahead of shared context when composition truncates", () => {
    const projectRoot = makeTempProject();
    const config = cloneQualityConfig(DEFAULT_QUALITY_CONFIG);
    config.composition.skillPreamblePath = "preamble.md";
    config.composition.skillConventionsPath = null;
    config.composition.maxComposedBytes = 1024;
    writeText(join(projectRoot, "preamble.md"), "P".repeat(2000));
    const rawContent = [
      "# /primary-probe",
      "Primary workflow evidence must be assessed before shared context.",
      "PRIMARY-SKILL-TAIL",
    ].join("\n");

    const composed = composeArtifactContent(
      projectRoot,
      {
        id: "skill:primary-probe",
        name: "primary-probe",
        path: ".claude/skills/primary-probe/SKILL.md",
        kind: "skill",
        source: "installed",
      },
      rawContent,
      config,
      { scanDisk: false },
    );

    assert.equal(composed.sources[0], "SKILL.md");
    assert.match(composed.composed, /PRIMARY-SKILL-TAIL/u);
    assert.deepEqual(composed.notes, ["composition truncated at 1KB"]);
  });
});

describe("artifact discovery", () => {
  it("discovers installed skills from .claude/skills/", () => {
    const artifacts = getRepoArtifacts();
    const skills = artifacts.filter((a) => a.kind === "skill");
    assert.ok(
      skills.length >= 7,
      `expected at least 7 skills, got ${skills.length}`,
    );
    assert.ok(skills.some((s) => s.id === "skill:goat-plan"));
    assert.ok(skills.some((s) => s.id === "skill:goat-review"));
  });

  it("discovers shared references and playbooks", () => {
    const artifacts = getRepoArtifacts();
    const refs = artifacts.filter((a) => a.kind === "shared-reference");
    assert.ok(refs.some((r) => r.id === "reference:browser-use"));
    assert.ok(refs.some((r) => r.id === "reference:page-capture"));
    assert.ok(refs.some((r) => r.id === "reference:skill-quality-testing"));
  });

  it("excludes README.md from references", () => {
    const artifacts = getRepoArtifacts();
    assert.ok(!artifacts.some((a) => a.name === "README"));
  });

  it("finds a specific artifact by id", () => {
    const artifact = findArtifact(PROJECT_ROOT, "skill:goat-plan");
    assert.ok(artifact);
    assert.equal(artifact.kind, "skill");
    assert.equal(artifact.name, "goat-plan");
  });

  it("returns null for unknown artifact id", () => {
    const artifact = findArtifact(PROJECT_ROOT, "skill:nonexistent");
    assert.equal(artifact, null);
  });

  it("aggregates mirrored skills without duplicate artifact rows", () => {
    const artifacts = getRepoArtifacts();
    const goatArtifacts = artifacts.filter((a) => a.id === "skill:goat");
    assert.equal(goatArtifacts.length, 1);
    assert.ok(
      goatArtifacts[0].mirrorPaths?.includes(".agents/skills/goat/SKILL.md"),
    );
    assert.ok(
      goatArtifacts[0].mirrorPaths?.includes(".github/skills/goat/SKILL.md"),
    );
    assert.ok(
      goatArtifacts[0].mirrorPaths?.includes("workflow/skills/goat/SKILL.md"),
    );
    assert.deepEqual(goatArtifacts[0].missingMirrors, []);
  });

  it("represents agent-mirror-only skills with missing mirror metadata", () => {
    const projectRoot = makeTempProject();
    writeText(
      join(projectRoot, ".agents/skills/foo/SKILL.md"),
      [
        "---",
        "name: foo",
        'description: "Mirror-only skill."',
        'goat-flow-skill-version: "1.6.0"',
        "---",
        "# /foo",
      ].join("\n"),
    );
    const artifacts = discoverArtifacts(projectRoot).filter(
      (artifact) => artifact.id === "skill:foo",
    );
    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0].path, ".agents/skills/foo/SKILL.md");
    assert.deepEqual(artifacts[0].mirrorPaths, []);
    assert.deepEqual(artifacts[0].missingMirrors, [
      ".claude/skills/foo/SKILL.md",
      ".github/skills/foo/SKILL.md",
      "workflow/skills/foo/SKILL.md",
    ]);
  });

  // Fixture purpose: writes a symlinked skill entry to cover walk-root filtering.
  it("skips symlink entries in skill walk roots", (testContext) => {
    const projectRoot = makeTempProject();
    mkdirSync(join(projectRoot, ".claude/skills/real"), { recursive: true });
    writeFileSync(
      join(projectRoot, ".claude/skills/real/SKILL.md"),
      [
        "---",
        "name: real",
        'description: "Real skill."',
        'goat-flow-skill-version: "1.6.0"',
        "---",
        "# /real",
      ].join("\n"),
    );
    if (
      !symlinkOrSkip(
        testContext,
        join(projectRoot, ".claude/skills/real"),
        join(projectRoot, ".claude/skills/link"),
      )
    ) {
      return;
    }
    const artifacts = discoverArtifacts(projectRoot);
    assert.ok(artifacts.some((artifact) => artifact.id === "skill:real"));
    assert.ok(!artifacts.some((artifact) => artifact.id === "skill:link"));
  });

  it("counts skill-local references from the references directory", () => {
    const projectRoot = makeTempProject();
    writeSkill(
      projectRoot,
      "ref-count",
      [
        "---",
        "name: ref-count",
        'description: "Skill with local references."',
        'goat-flow-skill-version: "1.6.0"',
        "---",
        "# /ref-count",
        "## When to Use",
        "Use when counting references.",
      ].join("\n"),
    );
    writeText(
      join(projectRoot, ".claude/skills/ref-count/references/one.md"),
      "# One\n",
    );
    writeText(
      join(projectRoot, ".claude/skills/ref-count/references/two.md"),
      "# Two\n",
    );
    writeText(
      join(projectRoot, ".claude/skills/ref-count/references/three.md"),
      "# Three\n",
    );
    const artifact = findArtifact(projectRoot, "skill:ref-count")!;
    const report = scoreArtifact(projectRoot, artifact);
    const tokenCost = report.metrics.find((m) => m.metric === "token-cost")!;
    assert.match(tokenCost.detail, /3 sub-reference\(s\)/);
  });

  it("credits the canonical boundary-command triplet as an exclusion contract", () => {
    const report = evaluateContent(PROJECT_ROOT, {
      kind: "skill",
      suggestedName: "boundary-probe",
      content: [
        "---",
        "name: boundary-probe",
        'description: "Use when checking boundary behavior."',
        'goat-flow-skill-version: "1.13.1"',
        "---",
        "# /boundary-probe",
        "## When to Use",
        "Use when the user needs a bounded workflow.",
        "## Boundary Commands",
        "- **NEVER:** Implement adjacent work inside this workflow.",
        "- **ALWAYS:** Preserve the selected reporting boundary.",
        "- **DEFER TO:** `/goat-review` for code-quality review.",
      ].join("\n"),
    });
    const triggerClarity = report.metrics.find(
      (metric) => metric.metric === "trigger-clarity",
    );
    assert.ok(triggerClarity, "expected trigger-clarity metric");
    assert.equal(triggerClarity.score, 15);
  });

  it("reports unconditioned vague prose without changing score or recommendation", () => {
    const baseSkill = [
      "---",
      "name: vague-probe",
      'description: "Use when checking author guidance."',
      'goat-flow-skill-version: "1.13.1"',
      "---",
      "# /vague-probe",
      "## When to Use",
      "Use when a maintainer needs a documented fallback.",
      "## Step 0",
      "Read the current artifact before deciding.",
      "## Boundary Commands",
      "- **NEVER:** Change the artifact during assessment.",
      "- **ALWAYS:** Report the observed evidence.",
      "- **DEFER TO:** `/goat-plan` for implementation planning.",
    ];
    const unconditionedReport = evaluateContent(PROJECT_ROOT, {
      kind: "skill",
      suggestedName: "vague-unconditioned",
      content: [...baseSkill, "Use the manual fallback as needed.", ""].join(
        "\n",
      ),
    });
    const conditionedReport = evaluateContent(PROJECT_ROOT, {
      kind: "skill",
      suggestedName: "vague-conditioned",
      content: [
        ...baseSkill,
        "Use the manual fallback as needed.",
        "When the browser tool is unavailable, follow the manual steps.",
      ].join("\n"),
    });
    const fencedReport = evaluateContent(PROJECT_ROOT, {
      kind: "skill",
      suggestedName: "vague-fenced",
      content: [
        ...baseSkill,
        "```text",
        "Use the manual fallback as needed.",
        "```",
      ].join("\n"),
    });

    assert.match(
      unconditionedReport.fitNotes.join("\n"),
      /advisory vague-language.+as needed/i,
    );
    assert.doesNotMatch(
      conditionedReport.fitNotes.join("\n"),
      /advisory vague-language/i,
    );
    assert.doesNotMatch(
      fencedReport.fitNotes.join("\n"),
      /advisory vague-language/i,
    );
    assert.equal(unconditionedReport.totalScore, conditionedReport.totalScore);
    assert.equal(
      unconditionedReport.recommendation,
      conditionedReport.recommendation,
    );
  });

  it("asks reviewers to score misuse limits and resist metric gaming", () => {
    const artifact = findArtifact(PROJECT_ROOT, "skill:goat-plan");
    assert.ok(artifact, "expected goat-plan artifact");
    const report = scoreArtifact(PROJECT_ROOT, artifact);
    const prompt = composeArtifactQualityPrompt(report);

    assert.match(prompt, /\*\*Misuse \/ Limits \(1-5\)\*\*/);
    assert.match(
      prompt,
      /What could an author add to satisfy this score without improving agent behavior\?/,
    );
    assert.match(prompt, /default `\/25` across the five dimensions/);
    assert.match(prompt, /"misuseLimits": 4/);
    assert.match(prompt, /"max": 25/);
  });
});
