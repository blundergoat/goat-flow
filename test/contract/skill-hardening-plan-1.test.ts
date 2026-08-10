/**
 * Contracts for planning and timing guidance: milestone structure, effort and forecast
 * obligations, and the accounting a user is promised across installed copies.
 *
 * Reads the installed copies rather than sources, so a contract fails when the guidance a user
 * actually receives drifts - not merely when the template does.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertForEachTarget,
  assertTimingObligationsDocumented,
  countSkillBodyWords,
  installedSkillPaths,
  installedSkillReferencePaths,
  readMarkdownSection,
  readProjectFile,
  INSTALLED_SKILL_ROOTS,
} from "./skill-hardening.helpers.js";

describe("skill hardening contracts: goat-plan (1/2)", () => {
  it("carries one timing and forecast contract into every installed harness", () => {
    assertForEachTarget(installedSkillPaths("goat-plan"), (skillPath) => {
      const breakdown = readMarkdownSection(
        skillPath,
        "Phase 1 - Milestone Breakdown",
      );
      const betweenMilestones = readMarkdownSection(
        skillPath,
        "Phase 3 - Between Milestones",
      );

      assert.match(breakdown, /Start a `plans time` receipt first/u, skillPath);
      assert.match(breakdown, /Optional `Forecast range:`/u, skillPath);
      assert.match(
        breakdown,
        /Forecast basis.*agent work units/u,
        `${skillPath}: forecast inputs are not countable`,
      );
      assert.match(
        breakdown,
        /0\.5-2\.5-10 min\/unit/u,
        `${skillPath}: cold-start prior is missing`,
      );
      assert.match(
        breakdown,
        /scope changes.*reforecast.*before implementation/isu,
        `${skillPath}: scope drift does not block on a fresh forecast`,
      );
      assert.match(
        betweenMilestones,
        /Finalize the receipt before `Actual:`/u,
        skillPath,
      );
      assert.match(
        betweenMilestones,
        /instead of inventing minutes/u,
        skillPath,
      );
      assert.match(
        betweenMilestones,
        /Calibration eligibility starts at `complete`/u,
        skillPath,
      );
    });

    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-plan",
        "references/milestone-examples.md",
      ),
      (referencePath) => {
        assertTimingObligationsDocumented(
          readMarkdownSection(referencePath, "Effort Estimates"),
          referencePath,
        );
        assert.match(
          readMarkdownSection(referencePath, "Effort Estimates"),
          /\[HUMAN\].*excluded.*agent work units/isu,
          `${referencePath}: human-only work is not excluded from agent forecasts`,
        );
      },
    );
  });

  it("keeps goat-plan failure-first thinking inside the existing risk flow", () => {
    assertForEachTarget(installedSkillPaths("goat-plan"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(
        skillGuidance,
        /If this plan fails, the most likely cause is/,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /existing task, assumption, or kill criterion/,
        skillPath,
      );
    });
  });

  it("keeps goat-plan mid-implementation proof explicit and within budget", () => {
    assertForEachTarget(installedSkillPaths("goat-plan"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(
        skillGuidance,
        /Mid-implementation proof/,
        `${skillPath} missing mid-proof`,
      );
      assert.match(
        skillGuidance,
        /before switching modules or after a bounded edit batch/,
        `${skillPath} missing bounded proof timing`,
      );
    });
    assert.ok(
      countSkillBodyWords("workflow/skills/goat-plan/SKILL.md") <= 2500,
      "workflow goat-plan must stay within the functional-skill word budget",
    );
  });

  it("keeps goat-plan path-only task intake read-only", () => {
    assertForEachTarget(installedSkillPaths("goat-plan"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(skillGuidance, /Path-only guard runs first/, skillPath);
      assert.match(
        skillGuidance,
        /Path-Only Intake \/ Read-Only Orientation/,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /Do NOT update `\.active`, milestone status fields, task checkboxes, or code/,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /A path alone is not write approval/,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /Do NOT mutate `\.goat-flow\/plans\/\.active`, milestone status, checkboxes, or code/,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /If exactly one milestone is in-progress, read only its first unchecked task line; no other body content/,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /Zero\/multiple in-progress: report ambiguity; read no bodies/,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /current milestone, and bounded task line when unambiguous/,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /CHECKPOINT \(Named-File Update\)/,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /Edit \[file\] in place for \[delta\]/,
        skillPath,
      );
      assert.doesNotMatch(
        skillGuidance,
        /CHECKPOINT \(all other modes\)/,
        skillPath,
      );
    });

    const milestoneExamplePaths = INSTALLED_SKILL_ROOTS.map(
      (skillRoot) => `${skillRoot}/goat-plan/references/milestone-examples.md`,
    );
    assertForEachTarget(milestoneExamplePaths, (examplePath) => {
      const milestoneExample = readProjectFile(examplePath);
      assert.match(
        milestoneExample,
        /the bounded follow-up read returns only its first unchecked task line/,
        examplePath,
      );
    });
  });

  it("orders goat-plan path-only classification before bounded retrieval and plan reads", () => {
    assertForEachTarget(installedSkillPaths("goat-plan"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      const classifyIndex = skillGuidance.indexOf(
        "1. **Classify the input shape before any plan-state read.**",
      );
      const retrievalIndex = skillGuidance.indexOf(
        "2. **Run learning-loop retrieval before mode-specific reads.**",
      );
      const planStateIndex = skillGuidance.indexOf(
        "3. **Inspect existing plan state only after retrieval.**",
      );
      const modeIndex = skillGuidance.indexOf("4. **Pick exactly one mode.**");

      assert.notEqual(
        classifyIndex,
        -1,
        `${skillPath}: missing classification`,
      );
      assert.notEqual(retrievalIndex, -1, `${skillPath}: missing retrieval`);
      assert.notEqual(
        planStateIndex,
        -1,
        `${skillPath}: missing plan-state step`,
      );
      assert.notEqual(modeIndex, -1, `${skillPath}: missing mode selection`);
      assert.ok(
        classifyIndex < retrievalIndex &&
          retrievalIndex < planStateIndex &&
          planStateIndex < modeIndex,
        `${skillPath}: Step 0 order is ambiguous`,
      );
      assert.match(
        skillGuidance,
        /For path-only intake, search only for plan-orientation and task-state failure classes/u,
        `${skillPath}: path-only retrieval is not bounded to orientation`,
      );
      assert.match(
        skillGuidance,
        /Do not retrieve implementation-domain learnings from the task path/u,
        `${skillPath}: path-only intake can load unrelated implementation context`,
      );
    });
  });

  it("lets goat-plan File-Write persist without phase-one approval or critique handoff", () => {
    assertForEachTarget(installedSkillPaths("goat-plan"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(skillGuidance, /Small File-Write/, skillPath);
      assert.match(skillGuidance, /no Phase 1 approval pause/, skillPath);
      assert.match(
        skillGuidance,
        /Write (?:compact|Standard or triggered high-risk) artifacts immediately/u,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /MUST NOT invoke or prompt for `\/goat-critique`/,
        skillPath,
      );
      assert.doesNotMatch(skillGuidance, /After Phase 1 approval/, skillPath);
      assert.doesNotMatch(
        skillGuidance,
        /Approve milestones and start implementing/,
        skillPath,
      );
      assert.doesNotMatch(
        skillGuidance,
        /delegated alternatives pass before writing milestone files/,
        skillPath,
      );
    });
  });

  it("keeps goat-plan amendments behind the milestone approval gate", () => {
    assertForEachTarget(installedSkillPaths("goat-plan"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(
        skillGuidance,
        /After approval for a non-final milestone, capture learnings, complete it, re-read\/update the next milestone/u,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /do not mark it complete in Phase 3/u,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /Human-requested changes return the milestone to `in-progress`; never amend silently/u,
        skillPath,
      );
    });

    // A user reaches this example after an assumption fails during milestone verification.
    const milestoneExamplePaths = INSTALLED_SKILL_ROOTS.map(
      (skillRoot) => `${skillRoot}/goat-plan/references/milestone-examples.md`,
    );

    assertForEachTarget(milestoneExamplePaths, (examplePath) => {
      const milestoneExample = readProjectFile(examplePath);
      assert.match(milestoneExample, /Proposed M02 amendment/, examplePath);
      assert.match(milestoneExample, /No plan file changed yet/, examplePath);
      assert.match(milestoneExample, /After the human approves/, examplePath);
      assert.match(
        milestoneExample,
        /applies the M02 amendment before changing statuses/,
        examplePath,
      );
      assert.doesNotMatch(milestoneExample, /already amended/, examplePath);
    });
  });

  it("keeps goat-plan ISSUE close-out conditional for compact Small plans", () => {
    assertForEachTarget(installedSkillPaths("goat-plan"), (skillPath) => {
      const artifactRules = readMarkdownSection(
        skillPath,
        "Phase 2 - Deliver Milestones",
      );
      const completionGate = readMarkdownSection(
        skillPath,
        "Phase 4 - Plan Complete",
      );

      assert.match(
        artifactRules,
        /Small only for a requested GitHub brief, multiple milestones, or shared requirements\/budget/u,
        skillPath,
      );
      assert.match(
        completionGate,
        /when `ISSUE\.md` exists, every ISSUE How item/u,
        skillPath,
      );
    });
  });

  // Effort guidance exists to change agent behaviour; pin it so compaction cannot silently drop it.

  it("keeps goat-plan effort estimation agent-calibrated and plan-level", () => {
    assertForEachTarget(installedSkillPaths("goat-plan"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(skillGuidance, /Effort estimate \(agent-time\)/, skillPath);
      assert.match(skillGuidance, /Never use duration intuition/, skillPath);
      assert.match(skillGuidance, /~70\/20\/10 stays advisory/, skillPath);
      assert.match(
        skillGuidance,
        /goat-flow plans check \.goat-flow\/plans\/<active> --strict/,
        skillPath,
      );
      assert.match(skillGuidance, /records structured `Actual:`/, skillPath);
      assert.match(
        skillGuidance,
        /start it only when `Depends on` permits/u,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /rerun only stale\/failed checks or when risk requires it/,
        skillPath,
      );
    });

    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-plan",
        "references/milestone-examples.md",
      ),
      (examplePath) => {
        const milestoneExample = readProjectFile(examplePath);
        assert.match(milestoneExample, /## Effort Estimates/, examplePath);
        assert.match(milestoneExample, /\*\*Actual:\*\*/, examplePath);
        assert.match(
          milestoneExample,
          /Plan\/admin overhead: n min other/,
          examplePath,
        );
        assert.match(
          milestoneExample,
          /must exactly reproduce each category and the headline/,
          examplePath,
        );
        assert.match(
          milestoneExample,
          /diagnostic guide, never a quota or pass\/fail gate/,
          examplePath,
        );
        assert.equal(
          milestoneExample.match(
            /\*\*Effort estimate:\*\* ~<total> min agent-time \(<product> product \/ <proof> proof \/ <other> other\)/gu,
          )?.length,
          2,
          `${examplePath}: both plan templates must show the strict effort grammar`,
        );
        assert.match(
          milestoneExample,
          /## Deferred and Backlog Routing/,
          examplePath,
        );
      },
    );
  });
});
