/**
 * Contracts for the review workflow a user drives: how scope is established, when consent
 * gates apply, what counts as evidence, and how a ship verdict must be earned.
 *
 * Reads the installed copies rather than sources, so a contract fails when the guidance a user
 * actually receives drifts - not merely when the template does.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertForEachTarget,
  installedSkillPaths,
  installedSkillReferencePaths,
  readMarkdownSection,
  readProjectFile,
  INSTALLED_SKILL_ROOTS,
} from "./skill-hardening.helpers.js";

describe("skill hardening contracts: goat-review (3/3)", () => {
  it("wires optional review validation into the goat-review proof gate", () => {
    assertForEachTarget(installedSkillPaths("goat-review"), (skillPath) => {
      const skill = readProjectFile(skillPath);
      const output = readMarkdownSection(skillPath, "Output Format");
      assert.match(
        skill,
        /version-matched CLI[^\n]+goat-flow review validate/iu,
        skillPath,
      );
      assert.match(
        skill,
        /Review validator:[^\n]+validated[^\n]+validator-unavailable/iu,
        skillPath,
      );
      assert.match(
        skill,
        /validator-unavailable[^\n]+does not block/iu,
        skillPath,
      );
      assert.match(
        output,
        /Machine-valid anchors use `<target-project>\/path` \(search: `literal`\)[^\n]+Findings[^\n]+Systemic Patterns[^\n]+Top 5 Risks/u,
        skillPath,
      );
    });
  });

  it("tiers goat-review consumer searches and discloses text-only coverage", () => {
    assertForEachTarget(installedSkillPaths("goat-review"), (skillPath) => {
      const diffReview = readMarkdownSection(
        skillPath,
        "Diff Review (Quick) - Two-Pass Discipline",
      );
      const integrity = readMarkdownSection(
        skillPath,
        "Review Integrity (confidence signal)",
      );
      const output = readMarkdownSection(skillPath, "Output Format");

      assert.match(
        diffReview,
        /symbol-aware \(LSP\/MCP\) → AST \(`ast-grep`\) → text \(`rg`\/`grep`\)/u,
        skillPath,
      );
      assert.match(
        diffReview,
        /dynamic dispatch[^\n]+external consumers/u,
        skillPath,
      );
      assert.match(integrity, /callsite-completeness-grep-only/u, skillPath);
      assert.match(
        output,
        /grep-only coverage[^\n]+callsite-completeness-grep-only/u,
        skillPath,
      );
    });
  });

  it("requires evidence before goat-review refutations affect Ship Verdict", () => {
    const referencePaths = installedSkillReferencePaths(
      "goat-review",
      "references/refuter-spec.md",
    );

    assertForEachTarget(referencePaths, (referencePath) => {
      const reference = readProjectFile(referencePath);
      assert.match(reference, /"finding_id": "R-001"/u, referencePath);
      assert.match(reference, /required for REFUTER-REFUTED/u, referencePath);
      assert.match(
        reference,
        /Before any refuter result changes/u,
        referencePath,
      );
      assert.match(reference, /refuter-citation-unverified/u, referencePath);
      assert.match(
        reference,
        /external library\/framework behaviour/u,
        referencePath,
      );
    });

    assertForEachTarget(installedSkillPaths("goat-review"), (skillPath) => {
      const passThree = readMarkdownSection(
        skillPath,
        "Pass 3 - Cross-Model Refuter (explicit approval only)",
      );
      const constraints = readMarkdownSection(skillPath, "Constraints");
      assert.match(passThree, /Refuter output is advisory/u, skillPath);
      assert.match(passThree, /host-reproduced evidence/u, skillPath);
      assert.match(
        constraints,
        /Refuter output changes Ship Verdict only after host reproduction/u,
        skillPath,
      );
    });
  });

  it("keeps final finding authority with the host reviewer", () => {
    assertForEachTarget(installedSkillPaths("goat-review"), (skillPath) => {
      const diffReview = readMarkdownSection(
        skillPath,
        "Diff Review (Quick) - Two-Pass Discipline",
      );
      assert.match(diffReview, /\*\*Finding authority:\*\*/u, skillPath);
      assert.match(
        diffReview,
        /bot\/subagent\/refuter output is advisory/u,
        skillPath,
      );
      assert.match(
        diffReview,
        /add\/remove\/demote findings[^\n]+severity\/action\/disposition\/Ship Verdict/u,
        skillPath,
      );
    });

    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-review",
        "references/automated-review.md",
      ),
      (referencePath) => {
        const reference = readProjectFile(referencePath);
        assert.match(
          reference,
          /Bot output cannot directly add, remove, demote, or retag/u,
          referencePath,
        );
        assert.match(
          reference,
          /severity, action, disposition, or Ship Verdict/u,
          referencePath,
        );
        assert.match(
          reference,
          /bot-reported command failure[^\n]+host reruns/iu,
          referencePath,
        );
      },
    );

    assertForEachTarget(
      installedSkillReferencePaths("goat-review", "references/refuter-spec.md"),
      (referencePath) => {
        const reference = readProjectFile(referencePath);
        assert.match(
          reference,
          /Empty, broad, uncited, or unresolvable[^\n]+has no effect/u,
          referencePath,
        );
        assert.doesNotMatch(
          reference,
          /may demote severity one rung/u,
          referencePath,
        );
        assert.match(
          reference,
          /host re-derives the evidence from the declared authority/u,
          referencePath,
        );
        assert.match(
          reference,
          /REVIEW AUTHORITY \(metadata only\)/u,
          referencePath,
        );
        assert.match(
          reference,
          /never substitute the current checkout/u,
          referencePath,
        );
      },
    );
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

  it("keeps an unselected optional Spec Drift pass out of review degradation", () => {
    assertForEachTarget(installedSkillPaths("goat-review"), (skillPath) => {
      const reviewIntegrity = readMarkdownSection(
        skillPath,
        "Review Integrity (confidence signal)",
      );
      const constraints = readMarkdownSection(skillPath, "Constraints");
      const outputFormat = readMarkdownSection(skillPath, "Output Format");

      assert.match(
        reviewIntegrity,
        /\*\*Spec drift:\*\* `checked M\[NN\]` \| `skipped` \| `unavailable`\. Optional skip is not degradation/u,
        skillPath,
      );
      assert.doesNotMatch(
        reviewIntegrity,
        /\*\*Degradation flags:\*\*[^\n]*spec-drift-skipped/u,
        `${skillPath}: an optional local pass must not degrade a complete review`,
      );
      assert.match(
        constraints,
        /If skipped, record `Spec drift: skipped` without a degradation flag/u,
        skillPath,
      );
      assert.doesNotMatch(constraints, /log `spec-drift-skipped`/u, skillPath);
      assert.match(
        outputFormat,
        /- Spec drift: <checked M\[NN\] \| skipped/u,
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

    // Reference examples teach output shape without claiming framework-only incidents as evidence.
    const reviewExamplePaths = INSTALLED_SKILL_ROOTS.map(
      (skillRoot) => `${skillRoot}/goat-review/references/examples.md`,
    );
    assertForEachTarget(reviewExamplePaths, (examplePath) => {
      const reviewExamples = readProjectFile(examplePath);
      assert.doesNotMatch(reviewExamples, /Pass 3 auto-triggered/, examplePath);
      assert.doesNotMatch(reviewExamples, /PR #412|a1b2c3d/, examplePath);
      assert.match(
        reviewExamples,
        /Illustrative scenario - input\/output shape only; never evidence/,
        examplePath,
      );
      assert.doesNotMatch(
        reviewExamples,
        /PR #56|checkSharedFileSets|src\/cli\/audit\/check-artifact-integrity\.ts/,
        examplePath,
      );
    });
  });

  it("defines one goat-review verdict degradation ladder", () => {
    assertForEachTarget(installedSkillPaths("goat-review"), (skillPath) => {
      const constraints = readMarkdownSection(skillPath, "Constraints");
      assert.match(
        constraints,
        /YES -> YES WITH CONDITIONS -> PARTIAL -> NO/u,
        skillPath,
      );
      assert.match(
        constraints,
        /PENDING REFUTER\/HUMAN is a pending state, not a ladder rung/u,
        skillPath,
      );
    });
  });

  it("keeps delegated-work review independent and bounded", () => {
    const delegatedReviewPattern = readProjectFile(
      ".goat-flow/learning-loop/patterns/multi-agent.md",
    );
    assert.match(delegatedReviewPattern, /Delegated-work review/);
    assert.match(delegatedReviewPattern, /re-run every done criterion/);
    assert.match(delegatedReviewPattern, /git diff --stat/);
    assert.match(
      delegatedReviewPattern,
      /read the full diff against stated intent/,
    );
    assert.match(delegatedReviewPattern, /meaningful assertions/);
    assert.match(delegatedReviewPattern, /documented deviations on merit/);
    assert.match(
      delegatedReviewPattern,
      /undocumented deviations as review failures/,
    );
    assert.match(delegatedReviewPattern, /two failed revision loops/);
  });

  // Users must not receive an eighth skill that silently owns implementation or repository history.

  it("keeps goat-review mutation opt-in aligned with the shared report-only contract", () => {
    assertForEachTarget(installedSkillPaths("goat-review"), (skillPath) => {
      assert.match(
        readProjectFile(skillPath),
        /MUST NOT edit files unless user separately says to apply, edit, update, fix, or implement/u,
        skillPath,
      );
    });
  });

  it("ingests path-bearing automated findings from inline PR comments", () => {
    const reviewSkillTargets = [
      "workflow/skills/goat-review/SKILL.md",
      ...installedSkillPaths("goat-review"),
    ];
    assertForEachTarget(reviewSkillTargets, (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(
        skillGuidance,
        /gh api --paginate[^\n]+pulls\/<number>\/comments/,
        skillPath,
      );
    });

    const overlapReferenceTargets = [
      "workflow/skills/goat-review/references/automated-review.md",
      ...INSTALLED_SKILL_ROOTS.map(
        (skillRoot) =>
          `${skillRoot}/goat-review/references/automated-review.md`,
      ),
    ];
    assertForEachTarget(overlapReferenceTargets, (referencePath) => {
      const overlapGuidance = readProjectFile(referencePath);
      assert.match(
        overlapGuidance,
        /pulls\/<number>\/comments[^\n]+path-bearing source for bot claims[^\n]+not final finding authority/,
        referencePath,
      );
      assert.match(
        overlapGuidance,
        /`Copilot`[^\n]+`copilot-pull-request-reviewer`/,
        referencePath,
      );
      assert.match(
        overlapGuidance,
        /`github-advanced-security\[bot\]`[^\n]+`github-advanced-security`/,
        referencePath,
      );
    });
  });

  it("keeps automated-review conclusions hidden until both local passes finish", () => {
    const reviewSkillTargets = installedSkillPaths("goat-review");
    assertForEachTarget(reviewSkillTargets, (skillPath) => {
      const stepZero = readMarkdownSection(
        skillPath,
        "Step 0 - Scope, Size, Spec",
      );
      const diffReview = readMarkdownSection(
        skillPath,
        "Diff Review (Quick) - Two-Pass Discipline",
      );
      const passOneIndex = diffReview.indexOf("### Pass 1 - Blind Suspicion");
      const passTwoIndex = diffReview.indexOf(
        "### Pass 2 - Grounded Verification",
      );
      const overlapIndex = diffReview.indexOf(
        "### Automated-Review Overlap (PR mode, after local findings)",
      );

      assert.ok(passOneIndex >= 0, `${skillPath}: missing local Pass 1`);
      assert.ok(
        passTwoIndex > passOneIndex,
        `${skillPath}: Pass 2 must follow Pass 1`,
      );
      assert.ok(
        overlapIndex > passTwoIndex,
        `${skillPath}: automated-review ingestion must follow both local passes`,
      );
      assert.match(
        stepZero,
        /Automated-review conclusions stay unread until both local passes finish/u,
        skillPath,
      );
      assert.doesNotMatch(
        stepZero,
        /--json\s+[^`\s]*(?:reviews|comments)/u,
        skillPath,
      );
      assert.doesNotMatch(stepZero, /gh api --paginate/u, skillPath);
    });

    const canonicalSkill = readProjectFile(
      "workflow/skills/goat-review/SKILL.md",
    );
    const canonicalOverlap = readProjectFile(
      "workflow/skills/goat-review/references/automated-review.md",
    );
    const overlapReferenceTargets = INSTALLED_SKILL_ROOTS.map(
      (skillRoot) => `${skillRoot}/goat-review/references/automated-review.md`,
    );

    assertForEachTarget(overlapReferenceTargets, (referencePath) => {
      const overlapGuidance = readProjectFile(referencePath);
      const localFindingsIndex = overlapGuidance.indexOf(
        "Record the complete local findings list before fetching automated-review conclusions.",
      );
      const inlineFetchIndex = overlapGuidance.indexOf("gh api --paginate");
      const briefIndex = overlapGuidance.indexOf("first 80 chars");
      const overlapTaggingIndex = overlapGuidance.indexOf(
        "## Post-Pass-2 Overlap Tagging",
      );

      assert.ok(
        localFindingsIndex >= 0,
        `${referencePath}: missing local-findings checkpoint`,
      );
      assert.ok(
        inlineFetchIndex > localFindingsIndex,
        `${referencePath}: bot comment bodies must follow the local findings checkpoint`,
      );
      assert.ok(
        briefIndex > inlineFetchIndex,
        `${referencePath}: bot comment briefs must be built only after ingestion`,
      );
      assert.ok(
        overlapTaggingIndex > briefIndex,
        `${referencePath}: overlap classification must follow conclusion ingestion`,
      );
      assert.doesNotMatch(overlapGuidance, /before Pass 1/u, referencePath);
    });

    for (const installedRoot of [
      ".claude/skills",
      ".agents/skills",
      ".github/skills",
    ]) {
      assert.equal(
        readProjectFile(`${installedRoot}/goat-review/SKILL.md`),
        canonicalSkill,
        `${installedRoot}/goat-review/SKILL.md`,
      );
      assert.equal(
        readProjectFile(
          `${installedRoot}/goat-review/references/automated-review.md`,
        ),
        canonicalOverlap,
        `${installedRoot}/goat-review/references/automated-review.md`,
      );
    }
  });
});
