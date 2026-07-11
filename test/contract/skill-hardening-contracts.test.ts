/**
 * Verifies that every installed skill presents the same safety workflow to users.
 * These contracts catch missing approval gates, mirror drift, and oversized guidance
 * before an agent can expose inconsistent behavior in the CLI or dashboard.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..", "..");
const INSTALLED_SKILL_ROOTS = [
  "workflow/skills",
  ".claude/skills",
  ".agents/skills",
  ".github/skills",
] as const;

/**
 * Loads one project file exactly as an agent or UI consumer receives it.
 * Use this when a contract depends on the installed wording, not parsed metadata.
 */
function readProjectFile(projectRelativePath: string): string {
  return readFileSync(resolve(REPOSITORY_ROOT, projectRelativePath), "utf-8");
}

/**
 * Extracts one Markdown H2 section so a UI-facing rule cannot pass by matching an example elsewhere.
 * A missing section means the installed workflow can no longer orient the user as documented.
 */
function readMarkdownSection(
  projectRelativePath: string,
  sectionHeading: string,
): string {
  const documentBody = readProjectFile(projectRelativePath);
  const sectionMarker = `## ${sectionHeading}`;
  const sectionStartIndex = documentBody.indexOf(sectionMarker);

  // A missing heading means users cannot reach the promised workflow section.
  assert.notEqual(
    sectionStartIndex,
    -1,
    `${projectRelativePath} missing ${sectionMarker}`,
  );

  const nextSectionIndex = documentBody.indexOf(
    "\n## ",
    sectionStartIndex + sectionMarker.length,
  );

  // The final section runs to end-of-file because no later user-facing section exists.
  if (nextSectionIndex === -1) {
    return documentBody.slice(sectionStartIndex);
  }

  return documentBody.slice(sectionStartIndex, nextSectionIndex);
}

/**
 * Builds every installed path for a skill so each supported agent sees the same workflow.
 * Use this whenever a safety rule must remain identical across agent integrations.
 */
function installedSkillPaths(skillName: string): string[] {
  // Each installation root represents a user-visible agent integration.
  return INSTALLED_SKILL_ROOTS.map(
    (skillRoot) => `${skillRoot}/${skillName}/SKILL.md`,
  );
}

/**
 * Applies one contract to every user-facing target while preserving its failure label.
 * Use this for mirror parity rather than accepting one correct installation as enough.
 */
function assertForEachTarget<T>(
  contractTargets: readonly T[],
  verifyTarget: (contractTarget: T) => void,
): void {
  // Every target must pass because users can invoke the workflow from any installed agent.
  for (const contractTarget of contractTargets) {
    verifyTarget(contractTarget);
  }
}

describe("skill hardening contracts", () => {
  const forbiddenCodexExceptionPattern = new RegExp("Exception: on C" + "odex");
  const forbiddenCodexConsentPattern = new RegExp(
    ["C", "odex requires ", "explicit user ", "delegation ", "consent"].join(
      "",
    ),
  );
  const forbiddenDelegationPromptPattern = new RegExp(
    ["confirm ", "delegation ", "consent once ", "before spawning"].join(""),
  );

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
    });
  });

  it("lets goat-plan File-Write persist without phase-one approval or critique handoff", () => {
    assertForEachTarget(installedSkillPaths("goat-plan"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(skillGuidance, /Small File-Write/, skillPath);
      assert.match(skillGuidance, /no Phase 1 approval pause/, skillPath);
      assert.match(skillGuidance, /Write artifacts immediately/, skillPath);
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
        /After approval: capture learnings, re-read the next milestone and update invalidated assumptions\/tasks\/exit criteria, set status/,
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

  it("keeps goat dispatcher from routing bare task paths to implementation", () => {
    assertForEachTarget(installedSkillPaths("goat"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(
        skillGuidance,
        /Bare or ambiguous task paths are read-only context/,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /Do not update `\.active`, milestone status, or code from a path alone/,
        skillPath,
      );
    });
  });

  it("documents task-path classifier examples", () => {
    const skillsDocumentation = readProjectFile("docs/skills.md");
    assert.match(
      skillsDocumentation,
      /Task path classifier examples/,
      "missing table",
    );
    assert.match(
      skillsDocumentation,
      /Bare task directory path\s+\|\s+Read-only orientation; no writes/,
      "path-only input must be read-only",
    );
    assert.match(
      skillsDocumentation,
      /Task directory path plus `start current milestone`\s+\|\s+Implementation may start after normal gates/,
      "start current milestone input must allow implementation after gates",
    );
    assert.match(
      skillsDocumentation,
      /`resume` plus a task directory path\s+\|\s+Confirm current milestone unless the plan clearly records one/,
      "resume input must confirm current milestone",
    );
    assert.match(
      skillsDocumentation,
      /`update current milestone` plus a task directory path\s+\|\s+Update the named milestone file only/,
      "update current milestone input must stay plan-file scoped",
    );
    assert.match(
      skillsDocumentation,
      /`implement current milestone` plus a task directory path\s+\|\s+Code implementation may proceed after reading gates/,
      "implement current milestone input must allow code implementation after gates",
    );
  });

  it("requires goat-qa Standard-mode gap output to include Verification Integrity", () => {
    assertForEachTarget(installedSkillPaths("goat-qa"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(
        skillGuidance,
        /gap analysis plus Verification Integrity/,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /Intent spec: \[PR\/issue\/test plan URL or `no-intent-spec`\]/,
        skillPath,
      );
      assert.match(skillGuidance, /Evidence limit:/, skillPath);
    });
  });

  it("separates goat-review reporting-only DoD from implementation DoD", () => {
    assertForEachTarget(installedSkillPaths("goat-review"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(skillGuidance, /Review DoD gate/, skillPath);
      assert.match(skillGuidance, /reporting-only review/, skillPath);
      assert.doesNotMatch(
        skillGuidance,
        /\*\*DoD gate:\*\* \(1\) tests\/lint pass/,
        skillPath,
      );
    });
  });

  it("keeps goat-debug bisect reporting-only until explicit approval", () => {
    // Example: a user asks for a regression diagnosis while unrelated edits remain open.
    assertForEachTarget(installedSkillPaths("goat-debug"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(
        skillGuidance,
        /Bisect is never required for a reporting-only diagnosis/,
        skillPath,
      );
      assert.match(skillGuidance, /clean worktree/, skillPath);
      assert.match(skillGuidance, /known-good and known-bad refs/, skillPath);
      assert.match(
        skillGuidance,
        /deterministic, non-destructive predicate/,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /explicit current-session approval/,
        skillPath,
      );
      assert.match(skillGuidance, /`git bisect reset`/, skillPath);
      assert.match(
        skillGuidance,
        /success, error, cancellation, or interruption/,
        skillPath,
      );
    });
  });

  it("requires informed approval before goat-review external refutation", () => {
    // Example: a MUST finding offers Pass 3 after local review, but egress is not yet approved.
    assertForEachTarget(installedSkillPaths("goat-review"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(skillGuidance, /A trigger is not approval/, skillPath);
      assert.match(skillGuidance, /runtime and model/, skillPath);
      assert.match(skillGuidance, /authentication state/, skillPath);
      assert.match(skillGuidance, /findings-only payload/, skillPath);
      assert.match(skillGuidance, /one refuter inference call/, skillPath);
      assert.match(skillGuidance, /cost or rate-limit impact/, skillPath);
      assert.match(skillGuidance, /local-only fallback/, skillPath);
      assert.match(
        skillGuidance,
        /explicit current-session approval/,
        skillPath,
      );
      assert.match(skillGuidance, /declined or unanswered/, skillPath);
      assert.match(skillGuidance, /complete the local review/, skillPath);
      assert.match(
        skillGuidance,
        /do not add `coverage-degraded` or `cross-model-refuter-failed` solely because the user declined/,
        skillPath,
      );
    });
  });

  it("checks goat-critique sub-agent completeness before trusting self-report", () => {
    assertForEachTarget(installedSkillPaths("goat-critique"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(skillGuidance, /Check sub-agent completeness/, skillPath);
      assert.match(
        skillGuidance,
        /3-7 findings plus required lens fields/,
        skillPath,
      );
      assert.match(skillGuidance, /sub-agent completeness limited/, skillPath);
    });
  });

  it("keeps report-only finding outputs aligned with the shared proof-class contract", () => {
    const proofClassContract =
      /RUNTIME\s*\|\s*CONTRACT-GREP\s*\|\s*STATIC\s*\|\s*NOT-REPRODUCED/;

    assertForEachTarget(installedSkillPaths("goat-security"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(skillGuidance, proofClassContract, skillPath);
      assert.match(skillGuidance, /S-NN:[^\n]+proof-class/, skillPath);
      assert.match(skillGuidance, /Proof classes:/, skillPath);
    });

    assertForEachTarget(installedSkillPaths("goat-qa"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(skillGuidance, proofClassContract, skillPath);
      assert.match(
        skillGuidance,
        /\| File \| Lines Changed[^\n]+\| Proof Class \|/,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /\| Code Change \| Risk[^\n]+\| Proof Class \|/,
        skillPath,
      );
      assert.match(skillGuidance, /Proof classes:/, skillPath);
    });

    assertForEachTarget(installedSkillPaths("goat-critique"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(skillGuidance, proofClassContract, skillPath);
      assert.match(
        skillGuidance,
        /Each sub-agent MUST return[^\n]+Proof class/,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /Validated Findings[^\n]+proof class/,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /Recommended Changes[^\n]+proof class/,
        skillPath,
      );
    });
  });

  it("keeps goat-critique direct invocation as delegation consent", () => {
    assertForEachTarget(installedSkillPaths("goat-critique"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(skillGuidance, /\$goat-critique/, skillPath);
      assert.match(skillGuidance, /\/goat-critique/, skillPath);
      assert.match(skillGuidance, /consent to spawn sub-agents/, skillPath);
      assert.match(skillGuidance, /Do NOT ask again/, skillPath);
      assert.doesNotMatch(
        skillGuidance,
        forbiddenCodexExceptionPattern,
        skillPath,
      );
      assert.doesNotMatch(
        skillGuidance,
        forbiddenCodexConsentPattern,
        skillPath,
      );
      assert.doesNotMatch(
        skillGuidance,
        forbiddenDelegationPromptPattern,
        skillPath,
      );
    });
  });

  it("keeps goat-critique report-only until explicit apply", () => {
    assertForEachTarget(installedSkillPaths("goat-critique"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(skillGuidance, /Report-only by default/, skillPath);
      assert.match(
        skillGuidance,
        /Do not mutate the target artifact/,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /user separately says to apply, edit, update, fix/,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /Recommendations are never auto-applied/,
        skillPath,
      );
      assert.match(skillGuidance, /After synthesis, stop/, skillPath);
      assert.match(
        skillGuidance,
        /Do not enter implementation mode/,
        skillPath,
      );
      assert.match(skillGuidance, /freeze writes/, skillPath);
    });
  });

  it("keeps shared report-only and interrupt freeze contracts installed", () => {
    // Users need the same report-only boundary in source and installed references.
    for (const referencePath of [
      "workflow/skills/reference/skill-preamble.md",
      ".goat-flow/skill-docs/skill-preamble.md",
    ]) {
      const referenceGuidance = readProjectFile(referencePath);
      assert.match(
        referenceGuidance,
        /Report-Only Skill Contract/,
        referencePath,
      );
      assert.match(
        referenceGuidance,
        /are report-only by default/,
        referencePath,
      );
      assert.match(
        referenceGuidance,
        /MUST NOT mutate the target artifact/,
        referencePath,
      );
      assert.match(
        referenceGuidance,
        /a bare or ambiguous task path is context, not a direct planning request/,
        referencePath,
      );
      assert.match(
        referenceGuidance,
        /a task path alone must not update `\.active`, milestone status, checkboxes, or code/,
        referencePath,
      );
    }

    // Users also need the same interruption behavior in both reference surfaces.
    for (const referencePath of [
      "workflow/skills/reference/skill-conventions.md",
      ".goat-flow/skill-docs/skill-conventions.md",
    ]) {
      const referenceGuidance = readProjectFile(referencePath);
      assert.match(
        referenceGuidance,
        /Interrupt Freeze Protocol/,
        referencePath,
      );
      assert.match(
        referenceGuidance,
        /freeze writes immediately/,
        referencePath,
      );
      assert.match(
        referenceGuidance,
        /Only run read-only status or diff checks/,
        referencePath,
      );
    }
  });

  it("keeps functional-skill Step 0 learning-loop emission doctrine installed", () => {
    // Every reference surface must tell users when prior learning was consulted.
    for (const referencePath of [
      "workflow/skills/reference/skill-preamble.md",
      ".goat-flow/skill-docs/skill-preamble.md",
    ]) {
      const learningLoopSection = readMarkdownSection(
        referencePath,
        "Learning-Loop Retrieval",
      );
      assert.match(learningLoopSection, /MUST emit/, referencePath);
      assert.match(
        learningLoopSection,
        /Relevant prior learnings:/,
        referencePath,
      );
      assert.match(learningLoopSection, /Terms searched:/, referencePath);
    }
  });

  it("clarifies deployment bulletproof evidence as a release gate or hardening debt", () => {
    // Both authoring surfaces must set the same expectation before users trust a skill claim.
    for (const referencePath of [
      "workflow/skills/playbooks/skill-quality-testing/deployment.md",
      ".goat-flow/skill-docs/skill-quality-testing/deployment.md",
    ]) {
      const deploymentGuidance = readProjectFile(referencePath);
      assert.match(
        deploymentGuidance,
        /release gate before merging/,
        referencePath,
      );
      assert.match(deploymentGuidance, /hardening debt/, referencePath);
      assert.match(
        deploymentGuidance,
        /do not claim the skill is bulletproof/,
        referencePath,
      );
    }
  });
});

/**
 * Counts user-facing skill guidance without YAML frontmatter, matching ADR-023.
 * Use this to prevent a workflow from becoming too large for agents to apply reliably.
 */
function countSkillBodyWords(projectRelativePath: string): number {
  const skillBody = readProjectFile(projectRelativePath).replace(
    /^---\n[\s\S]*?\n---\n?/,
    "",
  );

  // Empty whitespace segments are not words a user or agent must process.
  return skillBody.split(/\s+/).filter(Boolean).length;
}

describe("ADR-023 word budget tiers", () => {
  const DISPATCHER_CAP = 555;
  const FUNCTIONAL_CAP = 2500;
  const ALWAYS_LOADED_CAP = 1500;
  const AUTHORING_INDEX_CAP = 400;
  const PROGRESSIVE_CAP = 3000;
  const TOP_LEVEL_PLAYBOOKS = [
    "browser-use.md",
    "changelog.md",
    "code-comments.md",
    "gruff-code-quality.md",
    "observability.md",
    "page-capture.md",
    "release-notes.md",
  ] as const;

  const FUNCTIONAL_SKILLS = [
    "goat-debug",
    "goat-plan",
    "goat-qa",
    "goat-review",
    "goat-critique",
    "goat-security",
  ] as const;

  it("dispatcher /goat stays within the 555-word cap across all mirrors", () => {
    assertForEachTarget(installedSkillPaths("goat"), (skillPath) => {
      const userFacingWordCount = countSkillBodyWords(skillPath);
      assert.ok(
        userFacingWordCount <= DISPATCHER_CAP,
        `${skillPath}: ${userFacingWordCount} words exceeds dispatcher cap ${DISPATCHER_CAP}`,
      );
    });
  });

  it("functional skills stay within the 2500-word cap across all mirrors", () => {
    // A user may invoke any functional skill from any supported agent integration.
    const installedFunctionalSkillPaths = FUNCTIONAL_SKILLS.flatMap(
      (skillName) => installedSkillPaths(skillName),
    );

    assertForEachTarget(installedFunctionalSkillPaths, (skillPath) => {
      const userFacingWordCount = countSkillBodyWords(skillPath);
      assert.ok(
        userFacingWordCount < FUNCTIONAL_CAP,
        `${skillPath}: ${userFacingWordCount} words meets or exceeds functional cap ${FUNCTIONAL_CAP}`,
      );
    });
  });

  it("always-loaded shared references stay within the 1500-word cap", () => {
    // Always-loaded guidance affects every user request, so every copy must stay concise.
    for (const referencePath of [
      "workflow/skills/reference/skill-preamble.md",
      ".goat-flow/skill-docs/skill-preamble.md",
      "workflow/skills/reference/skill-conventions.md",
      ".goat-flow/skill-docs/skill-conventions.md",
    ]) {
      const userFacingWordCount = countSkillBodyWords(referencePath);
      assert.ok(
        userFacingWordCount < ALWAYS_LOADED_CAP,
        `${referencePath}: ${userFacingWordCount} words meets or exceeds always-loaded cap ${ALWAYS_LOADED_CAP}`,
      );
    }
  });

  it("skill-quality-testing root index stays within the 400-word cap", () => {
    // Authors need a short index that routes them without consuming the full workflow budget.
    for (const referencePath of [
      "workflow/skills/playbooks/skill-quality-testing.md",
      ".goat-flow/skill-docs/skill-quality-testing/README.md",
    ]) {
      const userFacingWordCount = countSkillBodyWords(referencePath);
      assert.ok(
        userFacingWordCount < AUTHORING_INDEX_CAP,
        `${referencePath}: ${userFacingWordCount} words meets or exceeds root index cap ${AUTHORING_INDEX_CAP}`,
      );
    }
  });

  it("progressive reference packs stay within the 3000-word cap per file", () => {
    const skillQualityTestingFiles = [
      "workflow/skills/playbooks/skill-quality-testing/tdd-iteration.md",
      ".goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md",
      "workflow/skills/playbooks/skill-quality-testing/adversarial-framing.md",
      ".goat-flow/skill-docs/skill-quality-testing/adversarial-framing.md",
      "workflow/skills/playbooks/skill-quality-testing/deployment.md",
      ".goat-flow/skill-docs/skill-quality-testing/deployment.md",
    ];
    // Each playbook name expands to the source and installed paths users can reach.
    const topLevelPlaybookPaths = TOP_LEVEL_PLAYBOOKS.flatMap(
      (playbookName) => [
        `workflow/skills/playbooks/${playbookName}`,
        `.goat-flow/skill-docs/playbooks/${playbookName}`,
      ],
    );

    // Measuring every progressive reference tells authors which user-facing file is too large.
    const measuredReferenceFiles = [
      ...skillQualityTestingFiles,
      ...topLevelPlaybookPaths,
    ].map((referencePath) => ({
      referencePath,
      userFacingWordCount: countSkillBodyWords(referencePath),
    }));

    // Only over-budget files should appear in the UI-facing failure message.
    const overBudgetReferenceFiles = measuredReferenceFiles.filter(
      ({ userFacingWordCount }) => userFacingWordCount >= PROGRESSIVE_CAP,
    );

    // An empty result means every progressive reference remains usable within its budget.
    const overBudgetFailureMessage = overBudgetReferenceFiles
      .map(
        ({ referencePath, userFacingWordCount }) =>
          `${referencePath}: ${userFacingWordCount} words meets or exceeds progressive cap ${PROGRESSIVE_CAP}`,
      )
      .join("\n");

    assert.deepEqual(overBudgetReferenceFiles, [], overBudgetFailureMessage);
  });

  it("progressive reference cap rejects at 3000 words or above", () => {
    // Boundary examples show users that 2999 is allowed while 3000 is rejected.
    const progressiveBudgetBoundaryResults = [
      PROGRESSIVE_CAP - 1,
      PROGRESSIVE_CAP,
    ].map((userFacingWordCount) => userFacingWordCount < PROGRESSIVE_CAP);

    assert.deepEqual(progressiveBudgetBoundaryResults, [true, false]);
  });
});
