/**
 * Check how the review workflow establishes scope, handles consent, gathers evidence, and reports a verdict.
 *
 * These contracts inspect canonical and installed guidance so every supported agent follows the same review rules.
 * Use them when changing review instructions, evidence requirements, or output contracts.
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
        skill,
        /Unconfirmed:[^\n]+Missing proof:[^\n]+Next check:/u,
        skillPath,
      );
      assert.match(
        skill,
        /confirmed=0, refuted=0, unresolved=0, leads-verified=0, model=n\/a/u,
        skillPath,
      );
      assert.match(
        output,
        /Machine-valid anchors use repo-relative paths such as `<repo-relative-path>` \(search: `literal`\)[^\n]+Findings[^\n]+Systemic Patterns[^\n]+Top 5 Risks/u,
        skillPath,
      );
    });
  });

  it("tiers goat-review consumer searches and discloses text-only coverage", () => {
    assertForEachTarget(installedSkillPaths("goat-review"), (skillPath) => {
      const diffReview = readMarkdownSection(
        skillPath,
        "Diff Review - Quick and Full",
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
        diffReview,
        /text-only adds `callsite-completeness-grep-only`/u,
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
      assert.match(reference, /Refuter outcomes/u, referencePath);
      assert.match(
        reference,
        /active findings[^\n]+refuted history/u,
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
      const findingAuthority = readMarkdownSection(
        skillPath,
        "Diff Review - Quick and Full",
      );
      assert.match(
        findingAuthority,
        /Only host-reproduced evidence controls[\s\S]*Ship Verdict/u,
        skillPath,
      );
      assert.match(constraints, /Ship Verdict/u, skillPath);
    });
  });

  it("keeps final finding authority with the host reviewer", () => {
    assertForEachTarget(installedSkillPaths("goat-review"), (skillPath) => {
      const diffReview = readMarkdownSection(
        skillPath,
        "Diff Review - Quick and Full",
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
      // One strip rule covers every bot suffix, so no per-alias row repeats it.
      assert.match(
        overlapGuidance,
        /[Ss]trip one trailing `\[bot\]` suffix first, then map the[\s\S]+alias/,
        referencePath,
      );
    });
  });

  it("qualifies refuter recipes with an enforced boundary and a closed fallback", () => {
    assertForEachTarget(
      installedSkillReferencePaths("goat-review", "references/refuter-spec.md"),
      (referencePath) => {
        const reference = readMarkdownSection(
          referencePath,
          "Supported Invocation Recipes",
        );

        // Each documented recipe names the runtime and the flags that actually restrict it.
        assert.match(
          reference,
          /codex exec --sandbox read-only/u,
          referencePath,
        );
        assert.match(reference, /claude -p --restricted/u, referencePath);
        assert.match(reference, /is the enforced boundary/u, referencePath);

        // Configuration isolation is never presented as runtime containment.
        assert.match(
          reference,
          /never its runtime containment/u,
          referencePath,
        );
        assert.match(
          reference,
          /[Nn]one of them proves that no filesystem write can occur/u,
          referencePath,
        );

        // Bypass flags stay forbidden in every documented recipe.
        assert.match(
          reference,
          /\*\*Forbidden in any recipe:\*\*/u,
          referencePath,
        );
        for (const forbiddenFlag of [
          "--dangerously-bypass-approvals-and-sandbox",
          "--dangerously-bypass-hook-trust",
          "--dangerously-skip-permissions",
          "--allow-dangerously-skip-permissions",
        ]) {
          assert.match(
            reference,
            new RegExp(forbiddenFlag, "u"),
            `${referencePath}: missing forbidden flag ${forbiddenFlag}`,
          );
        }

        // An unsupported configuration falls back locally instead of improvising a weaker call.
        assert.match(reference, /[Ff]ail closed/u, referencePath);
        assert.match(reference, /cross-model-refuter-failed/u, referencePath);
        assert.match(
          reference,
          /[Ww]ithholding a recipe never blocks local delivery/u,
          referencePath,
        );
      },
    );
  });

  it("normalizes every observed bot login shape once", () => {
    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-review",
        "references/automated-review.md",
      ),
      (referencePath) => {
        const reference = readMarkdownSection(
          referencePath,
          "Post-Pass-2 Ingestion",
        );

        // One strip rule covers every suffixed spelling the endpoints actually return.
        assert.match(
          reference,
          /[Ss]trip one trailing `\[bot\]` suffix first/u,
          referencePath,
        );
        for (const observedLogin of [
          "copilot-pull-request-reviewer",
          "chatgpt-codex-connector",
          "coderabbitai",
          "github-advanced-security",
        ]) {
          assert.match(
            reference,
            new RegExp(observedLogin, "u"),
            `${referencePath}: missing observed login ${observedLogin}`,
          );
        }

        // An unmapped author stays unknown rather than being guessed into a vendor.
        assert.match(
          reference,
          /author matching no row stays unknown/u,
          referencePath,
        );
        assert.match(
          reference,
          /[Nn]ever infer a vendor from a partial name/u,
          referencePath,
        );
      },
    );
  });

  it("states the setup trigger requirement as the signal the scorer accepts", () => {
    const setup = readProjectFile("workflow/setup/03-install-skills.md");

    // The trigger requirement accepts the statement form the scorer scores and two shipped skills use.
    assert.match(
      setup,
      /A trigger signal: either a `## When to Use` section or a `Use when \.\.\.` statement/u,
    );
    assert.doesNotMatch(setup, /Sections: When to Use,/u);

    // Both affected skills carry the statement form rather than a redundant heading.
    for (const skillName of ["goat-review", "goat-clarity"]) {
      assertForEachTarget(installedSkillPaths(skillName), (skillPath) => {
        const skill = readProjectFile(skillPath);
        assert.match(skill, /Use when /iu, skillPath);
        assert.doesNotMatch(skill, /^## When to Use$/mu, skillPath);
      });
    }
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
        "Diff Review - Quick and Full",
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

    // Every installed review copy must preserve the canonical order: finish local investigation before reading automated conclusions.
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
