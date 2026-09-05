/**
 * Check the planning and timing guidance users receive across supported agent integrations.
 *
 * These contracts inspect canonical and installed instructions for milestone structure, effort records, and forecast obligations.
 * Use them when changing the planning workflow or its reference material.
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
      assert.match(skillGuidance, /One session owns one milestone/u, skillPath);
      assert.match(
        skillGuidance,
        /With several active milestones and no selection,[\s\S]*?ask which milestone this session owns/u,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /Read only the bounded next item: implementation task, executor proof, or human item according to status/u,
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
        /the bounded follow-up read returns only its first unchecked task line/u,
        examplePath,
      );
    });
  });

  // Lane metadata changes scheduling; these contracts preserve the checks that authorize a session's next action.
  it("bounds lane orientation by current cap authority and one session milestone", () => {
    const skillPath = "workflow/skills/goat-plan/SKILL.md";
    const delivery = readMarkdownSection(
      skillPath,
      "Phase 2 - Deliver Milestones",
    );
    assert.match(
      delivery,
      /filenames plus Status, Lane, and Depends on/u,
      skillPath,
    );
    assert.match(delivery, /plans check <plan-path> --strict/u, skillPath);
    assert.match(delivery, /Checker errors stop body reads/u, skillPath);
    assert.match(
      delivery,
      /--max-active.*operator supplied it for this session/u,
      skillPath,
    );
    assert.match(
      delivery,
      /otherwise omit it for canonical config or default one/u,
      skillPath,
    );
    assert.match(
      delivery,
      /Never infer a cap from the active count or borrow an earlier override/u,
      skillPath,
    );
    assert.match(
      delivery,
      /absent override is needed, stop and ask/u,
      skillPath,
    );
    assert.match(
      delivery,
      /Active means `in-progress`, `testing-gate`, or `human-verification-pending`/u,
      skillPath,
    );
    assert.match(delivery, /absent or empty Lane means `default`/u, skillPath);
    assert.match(
      delivery,
      /explicit path or user instruction selects it; select the sole active milestone automatically/u,
      skillPath,
    );
    assert.match(
      delivery,
      /Report other lanes as state, never implementation authority/u,
      skillPath,
    );
    assert.match(
      delivery,
      /Check the final join below before source work or timing/u,
      skillPath,
    );
  });

  it("keeps lane eligibility and one participating dependency join explicit", () => {
    const skillPath = "workflow/skills/goat-plan/SKILL.md";
    const lifecycle = readMarkdownSection(
      skillPath,
      "Phase 3 - Between Milestones",
    );
    const completion = readMarkdownSection(
      skillPath,
      "Phase 4 - Plan Complete",
    );
    assert.match(
      lifecycle,
      /every dependency is complete, its lane is free, and the active count is below the cap/u,
      skillPath,
    );
    assert.match(
      lifecycle,
      /contention, show eligible IDs, lanes, and dependencies; ask, never select by number/u,
      skillPath,
    );
    assert.match(
      lifecycle,
      /Each milestone retains its own receipt and blocking human gate/u,
      skillPath,
    );
    assert.match(
      lifecycle,
      /unrelated active lanes keep their state and receipts/u,
      skillPath,
    );
    assert.match(
      lifecycle,
      /Exclude `abandoned`, `superseded`, and `deferred`; `blocked` still participates/u,
      skillPath,
    );
    assert.match(
      lifecycle,
      /participating dependency sink whose transitive dependency closure covers every other participating milestone/u,
      skillPath,
    );
    assert.match(
      lifecycle,
      /Multiple sinks or uncovered work requires a plan amendment before source work or timing/u,
      skillPath,
    );
    assert.match(
      lifecycle,
      /Authors join every participating lane tip/u,
      skillPath,
    );
    assert.match(
      lifecycle,
      /Lanes grant no writer ownership; use disjoint scopes, applicable write claims, and an agreed merge boundary/u,
      skillPath,
    );
    assert.match(
      completion,
      /unique final join is `human-verification-pending`/u,
      skillPath,
    );
    assert.match(
      completion,
      /every other participating milestone and every join dependency is complete, and no sibling active work remains/u,
      skillPath,
    );
    assert.match(completion, /Cap-one plans keep one final review/u, skillPath);
    assert.doesNotMatch(
      lifecycle,
      /no later milestone becomes active|M\[N\+1\]/u,
      skillPath,
    );
  });

  it("documents optional lanes, independent receipts, and downgrade recovery at their owners", () => {
    const examplesPath =
      "workflow/skills/goat-plan/references/milestone-examples.md";
    const examples = readProjectFile(examplesPath);
    const laneGuide = readMarkdownSection(examplesPath, "Lane lifecycle");
    assert.match(
      examples,
      /\*\*Depends on:\*\*[^\n]+\n\*\*Lane:\*\* <optional lowercase lane token>\n\*\*Effort estimate:/u,
    );
    assert.match(laneGuide, /Omitted or empty Lane means `default`/u);
    assert.match(laneGuide, /stop every extra open receipt/u);
    assert.match(
      laneGuide,
      /prior state, downgrade pause, and cap-compatible resume condition/u,
    );
    assert.match(
      laneGuide,
      /Restore each prior state only after lane-cap support returns; preserve every task and receipt history/u,
    );

    const conventions = readMarkdownSection(
      "workflow/skills/reference/skill-conventions.md",
      "Milestone Retrospective (goat-plan)",
    );
    assert.match(
      conventions,
      /Each milestone owns its receipt and blocking human gate; unrelated active lanes keep their state and receipts/u,
    );
    assert.match(
      conventions,
      /Human approval completes only that non-final milestone/u,
    );
    assert.match(
      conventions,
      /multiple sinks or uncovered work requires a plan amendment before source work or timing/u,
    );
    assert.match(conventions, /no sibling active work/u);
    assert.doesNotMatch(conventions, /no later milestone activates/u);

    const cli = readProjectFile("docs/cli.md");
    assert.match(cli, /plans\.maxActiveMilestones/u);
    assert.match(
      cli,
      /At cap one, output and the legacy `multiple active milestones` error remain unchanged/u,
    );
    assert.match(cli, /lane names grant no writer ownership/u);
    assert.match(
      cli,
      /One span is open per milestone file; separate valid lanes may hold simultaneous spans/u,
    );
  });

  it("makes explicit no-write signals outrank named-file mutation verbs", () => {
    assertForEachTarget(installedSkillPaths("goat-plan"), (skillPath) => {
      const intake = readMarkdownSection(skillPath, "Step 0 - Intake");
      const readOnlyIndex = intake.indexOf("2. **Read-Only Analysis**");
      const namedFileIndex = intake.indexOf("1. **Named-File Update**");

      assert.notEqual(
        readOnlyIndex,
        -1,
        `${skillPath}: missing read-only mode`,
      );
      assert.notEqual(
        namedFileIndex,
        -1,
        `${skillPath}: missing named-file update mode`,
      );
      assert.ok(
        readOnlyIndex < namedFileIndex,
        `${skillPath}: explicit no-write signals lose first-match selection`,
      );
      assert.match(
        intake,
        /Named-File Update.*only when no explicit reporting-only or no-implementation signal is present/su,
        `${skillPath}: ordinary update verbs can override explicit no-write intent`,
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
        /After approval for a non-final milestone, capture learnings, complete it, re-read\/update the selected eligible milestone/u,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /do not mark it complete in Phase 3/u,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /Human-requested changes return the milestone to `in-progress`; this applies only to the reviewed milestone; never amend silently/u,
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
