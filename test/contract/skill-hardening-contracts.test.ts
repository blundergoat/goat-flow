/**
 * Enforces the ADR-023 word budgets on shared skill references and playbooks.
 * These files are loaded into an agent's context on demand, so an oversized one costs the user
 * context they need for their actual task. The tiers here are the agreed ceilings.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertForEachTarget,
  countSkillBodyWords,
  installedSkillPaths,
  installedSkillReferencePaths,
} from "./skill-hardening.helpers.js";

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
    "hook-policy-testing.md",
    "observability.md",
    "page-capture.md",
    "release-notes.md",
    "skill-playbook-authoring-sync.md",
    "writing-style.md",
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
      ...installedSkillReferencePaths(
        "goat-debug",
        "references/diagnostic-techniques.md",
      ),
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
