/**
 * Manifest-backed drift fixtures for the skill mirrors users load through each supported agent.
 * Use these tests when setup or upgrade coverage changes a canonical skill or installed destination.
 * Clean, missing, and stale copies prove both the comparison count and exact repair path shown to users.
 */
import { loadManifest } from "../../src/cli/manifest/manifest.js";
import { SHARED_ARTIFACT_MIRRORS } from "../../src/cli/audit/artifact-templates.js";
import { unlinkSync } from "node:fs";
import {
  after,
  assert,
  before,
  checkDrift,
  createFS,
  describe,
  getInstalledSkillRoots,
  getSkillFiles,
  it,
  join,
  mkdirSync,
  rmSync,
  setupFixture,
  getSkillNames,
  writeFileSync,
} from "./audit-drift.helpers.ts";

/** Canonical and installed paths for one manifest-selected skill mirror that a user can invoke. */
interface SkillMirrorFixtureTarget {
  canonicalPath: string;
  installedPath: string;
  skillName: string;
}

/**
 * Select the GitHub-facing goat-clarity mirror from the manifest instead of repeating its destination path in the test.
 * Use when a disposable fixture needs one exact user-visible mirror to remove or modify.
 *
 * @returns canonical and installed paths for goat-clarity; assertions fail if the manifest no longer declares that user surface
 */
function selectManifestSkillMirror(): SkillMirrorFixtureTarget {
  const manifest = loadManifest();
  const skillName = manifest.skills.canonical.find(
    (canonicalSkillName) => canonicalSkillName === "goat-clarity",
  );
  assert.ok(skillName, "manifest should declare goat-clarity");
  const installedAgent = Object.values(manifest.agents).find(
    (agent) => agent.capabilities.skill_source === "github-mirror",
  );
  assert.ok(installedAgent, "manifest should declare a GitHub skill mirror");
  const relativeSkillFile = getSkillFiles(skillName).find(
    (relativeFile) => relativeFile === "SKILL.md",
  );
  assert.ok(relativeSkillFile, `${skillName} should include SKILL.md`);

  const canonicalPath = `workflow/skills/${skillName}/${relativeSkillFile}`;
  const installedRoot = installedAgent.skills_dir.replace(/\/$/u, "");
  return {
    canonicalPath,
    installedPath: `${installedRoot}/${skillName}/${relativeSkillFile}`,
    skillName,
  };
}

/**
 * Render the minimal Execution Loop guidance users receive in sibling instruction files.
 * Use when parity tests need either current prose or one intentionally omitted writing-style pointer.
 *
 * @param shouldIncludeWritingStyle - false models a sibling that omits required prose routing
 * @returns complete fixture Markdown; never empty
 */
const renderProseRoutingInstruction = (
  shouldIncludeWritingStyle: boolean,
): string =>
  [
    "# Agent instructions",
    "",
    "## Execution Loop",
    "",
    "Prose surfaces route the same way before writing.",
    shouldIncludeWritingStyle ? "README and docs need `writing-style.md`." : "",
    "The trigger is touching the surface, not the request naming it.",
    "",
  ].join("\n");

/**
 * Write three sibling instruction files for one parity fixture.
 * Use when users should receive the same Execution Loop guidance from Claude, Codex, and Copilot.
 *
 * @param fixtureRoot - disposable project root; empty input would resolve outside a valid fixture and is not supported
 * @param shouldCopilotIncludeWritingStyle - false reproduces a Copilot instruction missing the writing-style pointer
 * @returns nothing; creates `.github/` and writes only inside the disposable fixture
 */
function writeInstructionParityFixture(
  fixtureRoot: string,
  shouldCopilotIncludeWritingStyle: boolean,
): void {
  writeFileSync(
    join(fixtureRoot, "CLAUDE.md"),
    renderProseRoutingInstruction(true),
  );
  writeFileSync(
    join(fixtureRoot, "AGENTS.md"),
    renderProseRoutingInstruction(true),
  );
  mkdirSync(join(fixtureRoot, ".github"), { recursive: true });
  writeFileSync(
    join(fixtureRoot, ".github", "copilot-instructions.md"),
    renderProseRoutingInstruction(shouldCopilotIncludeWritingStyle),
  );
}

describe("checkDrift: clean fixture", () => {
  let cleanFixtureRoot: string;
  before(() => {
    cleanFixtureRoot = setupFixture();
  });
  after(() => {
    rmSync(cleanFixtureRoot, { recursive: true, force: true });
  });

  it("reports pass with zero findings when templates and installed copies match", () => {
    const manifest = loadManifest();
    const installedSkillRoots = getInstalledSkillRoots();
    const agentSkillRoots = Object.values(manifest.agents).map((agent) =>
      agent.skills_dir.replace(/\/$/u, ""),
    );
    const driftReport = checkDrift({
      fs: createFS(cleanFixtureRoot),
      projectPath: cleanFixtureRoot,
      templateRoot: cleanFixtureRoot,
    });
    assert.equal(driftReport.status, "pass");
    assert.deepEqual(driftReport.findings, []);
    assert.equal(
      installedSkillRoots.length,
      new Set(agentSkillRoots).size,
      "shared agent destinations should be compared once",
    );
    assert.ok(
      agentSkillRoots.length > installedSkillRoots.length,
      "the fixture should prove that at least two agents share one skill destination",
    );
    const expectedSkillComparisons =
      getSkillNames().reduce(
        (comparisonCount, skillName) =>
          comparisonCount + getSkillFiles(skillName).length,
        0,
      ) * installedSkillRoots.length;
    const expectedSharedComparisons = SHARED_ARTIFACT_MIRRORS.length;
    const expectedDeprecatedHookComparisons = manifest.hooks.stale_names.length;
    assert.equal(
      driftReport.checked,
      expectedSkillComparisons +
        expectedSharedComparisons +
        expectedDeprecatedHookComparisons,
    );
  });

  it("names the exact manifest destination when a user-facing skill mirror is missing", () => {
    const missingMirrorRoot = setupFixture();
    try {
      const mirrorTarget = selectManifestSkillMirror();
      // Example: an interrupted upgrade leaves Copilot without the goat-clarity file that Claude and Codex received.
      unlinkSync(join(missingMirrorRoot, mirrorTarget.installedPath));
      const driftReport = checkDrift({
        fs: createFS(missingMirrorRoot),
        projectPath: missingMirrorRoot,
        templateRoot: missingMirrorRoot,
      });

      assert.equal(driftReport.status, "fail");
      assert.deepEqual(driftReport.findings, [
        {
          kind: "missing",
          path: mirrorTarget.installedPath,
          message: `${mirrorTarget.skillName}: template at ${mirrorTarget.canonicalPath} has no installed copy at ${mirrorTarget.installedPath}`,
        },
      ]);
    } finally {
      rmSync(missingMirrorRoot, { recursive: true, force: true });
    }
  });

  it("names the exact manifest destination when a user-facing skill mirror is stale", () => {
    const modifiedMirrorRoot = setupFixture();
    try {
      const mirrorTarget = selectManifestSkillMirror();
      // Example: a local Copilot edit keeps an older skill contract while the workflow source moves forward.
      writeFileSync(
        join(modifiedMirrorRoot, mirrorTarget.installedPath),
        "# stale user-facing skill mirror\n",
      );
      const driftReport = checkDrift({
        fs: createFS(modifiedMirrorRoot),
        projectPath: modifiedMirrorRoot,
        templateRoot: modifiedMirrorRoot,
      });

      assert.equal(driftReport.status, "fail");
      assert.deepEqual(driftReport.findings, [
        {
          kind: "content",
          path: mirrorTarget.installedPath,
          message: `${mirrorTarget.skillName}: template (${mirrorTarget.canonicalPath}) and installed copy (${mirrorTarget.installedPath}) differ`,
        },
      ]);
    } finally {
      rmSync(modifiedMirrorRoot, { recursive: true, force: true });
    }
  });

  it("reports aligned sibling instruction phrases as clean", () => {
    const parityRoot = setupFixture();
    try {
      writeInstructionParityFixture(parityRoot, true);
      const driftReport = checkDrift({
        fs: createFS(parityRoot),
        projectPath: parityRoot,
        templateRoot: parityRoot,
        agentFilter: "claude",
      });

      assert.equal(driftReport.status, "pass");
      assert.equal(
        driftReport.findings.some((finding) =>
          finding.message.startsWith("instruction parity:"),
        ),
        false,
      );
    } finally {
      rmSync(parityRoot, { recursive: true, force: true });
    }
  });

  it("reports a shared phrase omitted from one sibling instruction file", () => {
    const parityRoot = setupFixture();
    try {
      writeInstructionParityFixture(parityRoot, false);
      const driftReport = checkDrift({
        fs: createFS(parityRoot),
        projectPath: parityRoot,
        templateRoot: parityRoot,
        agentFilter: "claude",
      });
      const parityFindings = driftReport.findings.filter((finding) =>
        finding.message.startsWith("instruction parity:"),
      );

      assert.equal(driftReport.status, "fail");
      assert.deepEqual(parityFindings, [
        {
          kind: "content",
          path: ".github/copilot-instructions.md",
          message:
            "instruction parity: prose-surface READ routing differs in Execution Loop; " +
            'missing "need `writing-style.md`" while present in CLAUDE.md, AGENTS.md',
        },
      ]);
    } finally {
      rmSync(parityRoot, { recursive: true, force: true });
    }
  });
});
