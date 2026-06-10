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
  findArtifact,
  scoreArtifact,
  symlinkOrSkip,
  PROJECT_ROOT,
  makeTempProject,
  writeText,
  writeSkill,
  getRepoArtifacts,
} from "./helpers.js";

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
});
