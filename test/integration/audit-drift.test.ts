/**
 * checkDrift clean-fixture baseline: with templates and installed copies identical, asserts a pass
 * with zero findings and that `checked` equals every manifest-derived comparison users rely on.
 */
import { loadManifest } from "../../src/cli/manifest/manifest.js";
import { SHARED_ARTIFACT_MIRRORS } from "../../src/cli/audit/artifact-templates.js";
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

/** Render the minimal shared Execution Loop prose needed by the parity fixture. */
const proseRoutingInstruction = (shouldIncludeWritingStyle: boolean): string =>
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
 * Side effects: creates `.github/` and writes files only under the disposable root.
 */
function writeInstructionParityFixture(
  root: string,
  shouldCopilotIncludeWritingStyle: boolean,
): void {
  writeFileSync(join(root, "CLAUDE.md"), proseRoutingInstruction(true));
  writeFileSync(join(root, "AGENTS.md"), proseRoutingInstruction(true));
  mkdirSync(join(root, ".github"), { recursive: true });
  writeFileSync(
    join(root, ".github", "copilot-instructions.md"),
    proseRoutingInstruction(shouldCopilotIncludeWritingStyle),
  );
}

describe("checkDrift: clean fixture", () => {
  let root: string;
  before(() => {
    root = setupFixture();
  });
  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reports pass with zero findings when templates and installed copies match", () => {
    const report = checkDrift({
      fs: createFS(root),
      projectPath: root,
      templateRoot: root,
    });
    assert.equal(report.status, "pass");
    assert.deepEqual(report.findings, []);
    const expectedSkillComparisons =
      getSkillNames().reduce(
        (total, name) => total + getSkillFiles(name).length,
        0,
      ) * getInstalledSkillRoots().length;
    const expectedSharedComparisons = SHARED_ARTIFACT_MIRRORS.length;
    const expectedDeprecatedHookComparisons =
      loadManifest().hooks.stale_names.length;
    assert.equal(
      report.checked,
      expectedSkillComparisons +
        expectedSharedComparisons +
        expectedDeprecatedHookComparisons,
    );
  });

  it("reports aligned sibling instruction phrases as clean", () => {
    const parityRoot = setupFixture();
    try {
      writeInstructionParityFixture(parityRoot, true);
      const report = checkDrift({
        fs: createFS(parityRoot),
        projectPath: parityRoot,
        templateRoot: parityRoot,
        agentFilter: "claude",
      });

      assert.equal(report.status, "pass");
      assert.equal(
        report.findings.some((finding) =>
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
      const report = checkDrift({
        fs: createFS(parityRoot),
        projectPath: parityRoot,
        templateRoot: parityRoot,
        agentFilter: "claude",
      });
      const parityFindings = report.findings.filter((finding) =>
        finding.message.startsWith("instruction parity:"),
      );

      assert.equal(report.status, "fail");
      assert.deepEqual(parityFindings, [
        {
          kind: "content",
          path: ".github/copilot-instructions.md",
          message:
            'instruction parity: prose-surface READ routing differs in Execution Loop; missing "need `writing-style.md`" while present in CLAUDE.md, AGENTS.md',
        },
      ]);
    } finally {
      rmSync(parityRoot, { recursive: true, force: true });
    }
  });
});
