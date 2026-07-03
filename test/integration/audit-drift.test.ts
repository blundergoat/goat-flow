/**
 * checkDrift clean-fixture baseline: with templates and installed copies identical, asserts a pass
 * with zero findings and that `checked` equals the exact expected skill-file plus shared-file count.
 */
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
  rmSync,
  setupFixture,
  getSkillNames,
} from "./audit-drift.helpers.ts";

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
    const expectedSharedComparisons = 15;
    assert.equal(
      report.checked,
      expectedSkillComparisons + expectedSharedComparisons,
    );
  });
});
