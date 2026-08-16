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
  verifyNamedAnchorsResolve,
} from "./skill-hardening.helpers.js";

describe("skill hardening contracts: goat-review (2/3)", () => {
  it("calibrates goat-review severity from evidence before labels", () => {
    assertForEachTarget(installedSkillPaths("goat-review"), (skillPath) => {
      const skill = readProjectFile(skillPath);
      const crossCheck = readMarkdownSection(
        skillPath,
        "Diff Review (Quick) - Two-Pass Discipline",
      );
      assert.match(crossCheck, /references\/review-traps\.md/u, skillPath);
      assert.match(crossCheck, /confirmed review-reasoning miss/u, skillPath);
      assert.match(skill, /Evidence before severity/u, skillPath);
      for (const axis of [
        "reachability",
        "attacker control",
        "preconditions",
        "authentication",
        "blast radius",
      ]) {
        assert.match(skill, new RegExp(axis), skillPath);
      }
      assert.match(skill, /axes disagree[^\n]+lower/u, skillPath);
      assert.match(skill, /threat-model boost[^\n]+one tier/u, skillPath);
    });
  });

  it("checks goat-review findings for tension and non-convergence", () => {
    assertForEachTarget(installedSkillPaths("goat-review"), (skillPath) => {
      const skill = readProjectFile(skillPath);
      assert.match(skill, /Self-consistency check/u, skillPath);
      assert.match(skill, /\{R-id, file, range, action\}/u, skillPath);
      assert.match(skill, /same-file overlapping ranges/iu, skillPath);
      assert.match(skill, /demote both one rung/u, skillPath);
      assert.match(skill, /Tension with R-0NN/u, skillPath);
      assert.match(skill, /two review→fix cycles/u, skillPath);
      assert.match(skill, /finding count dropping/u, skillPath);
      assert.match(
        skill,
        /re-derive whether the original defect was real/u,
        skillPath,
      );
      assert.match(skill, /re-scope with the human/u, skillPath);
    });
  });

  it("keeps goat-review Pass 2.5 inline and admission-gated", () => {
    assertForEachTarget(installedSkillPaths("goat-review"), (skillPath) => {
      const skill = readProjectFile(skillPath);
      assert.match(skill, /Pass 2\.5 - Inline Re-framings/u, skillPath);
      assert.match(
        skill,
        /Additive[^\n]+silent failures[^\n]+trust boundaries[^\n]+integration seams/u,
        skillPath,
      );
      assert.match(
        skill,
        />200 lines[^\n]+MUST[^\n]+verification mechanism/u,
        skillPath,
      );
      assert.match(
        skill,
        /Subtractive[^\n]+named guard[^\n]+pinned-version framework behaviour[^\n]+passing test/u,
        skillPath,
      );
      assert.match(skill, /MUST or correctness-SHOULD/u, skillPath);
      assert.match(
        skill,
        /Re-frame only Pass 0 result lines and Pass 2 reads already gathered/u,
        skillPath,
      );
      assert.match(
        skill,
        /no new tool, file, command, or model calls/u,
        skillPath,
      );
      assert.match(
        skill,
        /passing test[^\n]+literal Pass 0 result[^\n]+this session/iu,
        skillPath,
      );
      assert.match(skill, /subagent[^\n]+Orchestration Admission/u, skillPath);
    });
  });

  it("renders goat-review sections only when they carry review signal", () => {
    assertForEachTarget(installedSkillPaths("goat-review"), (skillPath) => {
      const output = readMarkdownSection(skillPath, "Output Format");
      assert.match(
        output,
        /Emit `## Top 5 Risks` only when[^\n]+more than five surfaced findings/iu,
        skillPath,
      );
      assert.doesNotMatch(output, /If <5 total, list all/iu, skillPath);
      assert.match(output, /render only with content/iu, skillPath);
      for (const conditionalSection of [
        "Systemic Patterns",
        "Spec Drift",
        "Pre-existing Nearby",
        "Pre-existing Issues",
        "Breaking Changes",
      ]) {
        assert.match(
          output,
          new RegExp("`" + conditionalSection + "`", "u"),
          skillPath,
        );
      }
      assert.match(
        output,
        /What's Good[^\n]+substantive[^\n]+generic praise/iu,
        skillPath,
      );
      assert.match(
        output,
        /Clean PR[^\n]+scope line[^\n]+verdict[^\n]+defended zero-findings statement[^\n]+one-line integrity summary[^\n]+one-line unexamined surface/iu,
        skillPath,
      );
    });

    const presetCatalog = readProjectFile("src/dashboard/preset-prompts.json");
    assert.match(presetCatalog, /MUST\/SHOULD\/MAY severity/u);
    assert.match(
      presetCatalog,
      /zero MUST findings[^\n]+defend what was checked[^\n]+Review Integrity/u,
    );
  });

  it("emits only resolved goat-review integrity fields", () => {
    assertForEachTarget(installedSkillPaths("goat-review"), (skillPath) => {
      const integrity = readMarkdownSection(
        skillPath,
        "Review Integrity (confidence signal)",
      );
      const output = readMarkdownSection(skillPath, "Output Format");

      assert.match(integrity, /\*\*Always emit:\*\*/u, skillPath);
      for (const mandatoryField of [
        "Scope snapshot",
        "Files opened in Pass 2",
        "Evidence",
        "Verdicts",
        "Refutations logged",
        "Review validator",
        "Gates",
        "Gate evidence",
        "Size",
        "Degradation flags",
        "Conclusion",
      ]) {
        assert.match(
          integrity,
          new RegExp(`\\*\\*Always emit:\\*\\*[\\s\\S]*${mandatoryField}`, "u"),
          `${skillPath}: missing mandatory field ${mandatoryField}`,
        );
      }
      assert.match(integrity, /\*\*Emit when resolved:\*\*/u, skillPath);
      for (const conditionalField of [
        "Refutation ledger",
        "Automated-review provenance",
        "Refuter pass",
        "Spec drift",
      ]) {
        assert.match(
          integrity,
          new RegExp(
            `\\*\\*Emit when resolved:\\*\\*[\\s\\S]*${conditionalField}`,
            "u",
          ),
          `${skillPath}: missing conditional field ${conditionalField}`,
        );
      }
      assert.match(integrity, /Never emit.*whole field.*`n\/a`/u, skillPath);
      assert.match(
        output,
        /<!-- When count > 0\. -->\n- Refutation ledger:/u,
        skillPath,
      );
      assert.match(
        output,
        /<!-- PR only\. -->\n- Automated-review provenance:/u,
        skillPath,
      );
      assert.match(
        output,
        /<!-- Pass 3 only\. -->\n- Refuter pass:/u,
        skillPath,
      );
      assert.match(
        output,
        /<!-- Spec Drift only\. -->\n- Spec drift:/u,
        skillPath,
      );
    });
  });

  it("keeps goat-review bound to the universal skill constraints", () => {
    assertForEachTarget(installedSkillPaths("goat-review"), (skillPath) => {
      assert.match(
        readMarkdownSection(skillPath, "Constraints"),
        /Universal constraints from `?skill-preamble\.md`? apply/u,
        skillPath,
      );
    });
  });

  it("reconciles automated review with four-way provenance", () => {
    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-review",
        "references/automated-review.md",
      ),
      (referencePath) => {
        const reference = readProjectFile(referencePath);
        for (const provenance of [
          "overlap-confirmed",
          "local-only",
          "bot-only-locally-verified",
          "disputed-match",
        ]) {
          assert.match(reference, new RegExp(provenance, "u"), referencePath);
        }
        assert.match(
          reference,
          /bot-only-locally-verified[^\n]+Pass 2[^\n]+Findings[^\n]+provenance/iu,
          referencePath,
        );
        assert.match(
          reference,
          /never[^\n]+independent discovery/iu,
          referencePath,
        );
        assert.match(
          reference,
          /automated findings the local review missed/iu,
          referencePath,
        );
        assert.match(
          reference,
          /local findings every bot missed/iu,
          referencePath,
        );
        assert.match(
          reference,
          /never suppress a finding as overlap/iu,
          referencePath,
        );
        assert.match(
          reference,
          /same line[^\n]+different root causes[^\n]+two findings/iu,
          referencePath,
        );

        const hierarchyStart = reference.indexOf("### Matching Hierarchy");
        assert.ok(
          hierarchyStart >= 0,
          `${referencePath}: missing matching hierarchy`,
        );
        const matchingHierarchy = reference.slice(hierarchyStart);
        let previousHierarchyIndex = -1;
        for (const hierarchyTerm of [
          "symbol",
          "rule ID",
          "category",
          "root cause",
          "line range",
          "token similarity",
        ]) {
          const hierarchyIndex = matchingHierarchy.indexOf(hierarchyTerm);
          assert.ok(
            hierarchyIndex > previousHierarchyIndex,
            `${referencePath}: ${hierarchyTerm} must follow the previous matching signal`,
          );
          previousHierarchyIndex = hierarchyIndex;
        }
      },
    );

    assertForEachTarget(installedSkillPaths("goat-review"), (skillPath) => {
      const integrity = readMarkdownSection(
        skillPath,
        "Review Integrity (confidence signal)",
      );
      const output = readMarkdownSection(skillPath, "Output Format");
      for (const provenance of [
        "overlap-confirmed",
        "local-only",
        "bot-only-locally-verified",
        "disputed-match",
      ]) {
        assert.match(integrity, new RegExp(provenance, "u"), skillPath);
        assert.match(output, new RegExp(provenance, "u"), skillPath);
      }
    });
  });

  it("requires positive evidence for goat-review verdicts", () => {
    assertForEachTarget(installedSkillPaths("goat-review"), (skillPath) => {
      const diffReview = readMarkdownSection(
        skillPath,
        "Diff Review (Quick) - Two-Pass Discipline",
      );
      const integrity = readMarkdownSection(
        skillPath,
        "Review Integrity (confidence signal)",
      );

      assert.match(
        diffReview,
        /CONFIRMED[^\n]+positive reachability/u,
        skillPath,
      );
      assert.match(diffReview, /failed disproof[^\n]+UNRESOLVED/u, skillPath);
      assert.match(diffReview, /ADJUSTED[^\n]+real but narrower/u, skillPath);
      assert.match(diffReview, /confirmed with caveat/u, skillPath);
      assert.match(diffReview, /matches prior behaviour/u, skillPath);
      assert.match(diffReview, /sloppy but not exploitable/u, skillPath);
      assert.match(
        integrity,
        /Verdicts:[^\n]+confirmed\/adjusted\/refuted\/unresolved/u,
        skillPath,
      );
    });
  });

  it("gives goat-review findings stable IDs, harm, and distinct evidence axes", () => {
    assertForEachTarget(installedSkillPaths("goat-review"), (skillPath) => {
      const diffReview = readMarkdownSection(
        skillPath,
        "Diff Review (Quick) - Two-Pass Discipline",
      );
      const output = readMarkdownSection(skillPath, "Output Format");

      assert.match(diffReview, /stable `R-001…` IDs/u, skillPath);
      assert.match(diffReview, /Refutation Ledger:[^\n]+with R-ID/u, skillPath);
      assert.match(diffReview, /`pre-existing` is area-audit-only/u, skillPath);
      assert.match(diffReview, /Evidence tags measure certainty/u, skillPath);
      assert.match(diffReview, /proof classes method/u, skillPath);
      assert.match(diffReview, /verdicts disposition/u, skillPath);
      assert.match(diffReview, /`UNVERIFIED` ≠ `NOT-REPRODUCED`/u, skillPath);
      assert.match(output, /R-001 \[SEVERITY:ACTION\]/u, skillPath);
      assert.match(output, /Harm: \[concrete consequence/u, skillPath);
      assert.match(
        output,
        /R-001 \[SEVERITY:ACTION\][^\n]+affected anchors/u,
        skillPath,
      );
      assert.match(
        output,
        /R-001 \[SEVERITY:ACTION\][^\n]+affected anchors:[^\n]+Harm:[^\n]+Evidence:[^\n]+Proof:/u,
        skillPath,
      );
    });
  });

  it("keeps goat-review finding examples on the validator-ready grammar", () => {
    assertForEachTarget(
      installedSkillReferencePaths("goat-review", "references/examples.md"),
      (referencePath) => {
        const examples = readMarkdownSection(
          referencePath,
          "Finding Format Examples",
        );
        assert.match(
          examples,
          /- R-001 \[SHOULD:patch\][^\n]+affected anchors:[^\n]+Harm:[^\n]+Evidence: OBSERVED[^\n]+Proof: STATIC/u,
          referencePath,
        );
        assert.match(
          examples,
          /- R-002 \[SHOULD:patch\] \[overlap-confirmed:copilot-pull-request-reviewer\][^\n]+Harm:[^\n]+Evidence: OBSERVED[^\n]+Proof: STATIC/u,
          referencePath,
        );
        assert.doesNotMatch(examples, /\[overlap:/u, referencePath);
      },
    );
  });

  it("goat-review internal anchors resolve to named current targets", (testContext) => {
    const reviewRoot = "workflow/skills/goat-review";
    const bundlePaths = [
      `${reviewRoot}/SKILL.md`,
      `${reviewRoot}/references/automated-review.md`,
      `${reviewRoot}/references/examples.md`,
      `${reviewRoot}/references/refuter-spec.md`,
      `${reviewRoot}/references/review-traps.md`,
    ];
    const { anchorsChecked, placeholderAnchors } = verifyNamedAnchorsResolve(
      reviewRoot,
      bundlePaths,
    );

    const examples = readProjectFile(`${reviewRoot}/references/examples.md`);
    assert.doesNotMatch(examples, /Automated-reviewer overlap/u);
    assert.match(examples, /Search for `Automated-review provenance`/u);
    assert.match(
      examples,
      /`references\/automated-review\.md` \(search: `Automated-review provenance`\)/u,
    );
    assert.match(examples, /search: `Group 3\+ findings with one root`/u);
    assert.ok(anchorsChecked > 0, "the live anchor sweep checked no anchors");
    testContext.diagnostic(
      `anchors checked=${anchorsChecked}; placeholder anchors exempted=${placeholderAnchors}; live misses=0`,
    );
  });

  it("routes goat-review durable artifacts through host-owned redaction", () => {
    assertForEachTarget(installedSkillPaths("goat-review"), (skillPath) => {
      const diffReview = readMarkdownSection(
        skillPath,
        "Diff Review (Quick) - Two-Pass Discipline",
      );
      assert.match(
        diffReview,
        /Refutation Ledger:[^\n]+draft[^\n]+in memory[^\n]+host[^\n]+`goat-flow redact --output/iu,
        skillPath,
      );
      assert.match(
        diffReview,
        /redactor is unavailable[^\n]+do not persist[^\n]+`Refutations logged: <N> \(persist-skipped\)`/iu,
        skillPath,
      );
      assert.match(
        diffReview,
        /one record per line[^\n]+R-NNN[^\n]+Suspicion:[^\n]+Evidence:[^\n]+Rationale:/u,
        skillPath,
      );
      assert.match(
        diffReview,
        /goat-review-refutations\.<random>\.txt[^\n]+exact path/u,
        skillPath,
      );
    });

    assertForEachTarget(
      installedSkillReferencePaths("goat-review", "references/refuter-spec.md"),
      (referencePath) => {
        const reference = readProjectFile(referencePath);
        assert.match(
          reference,
          /refuter runtime[^\n]+never writes directly/iu,
          referencePath,
        );
        assert.match(
          reference,
          /host[^\n]+in memory[^\n]+`goat-flow redact --output/iu,
          referencePath,
        );
        assert.match(
          reference,
          /redactor is unavailable[^\n]+do not persist/iu,
          referencePath,
        );
        assert.match(
          reference,
          /exact `goat-review-refutations\.<random>\.txt` path[^\n]+`Refutation ledger`/u,
          referencePath,
        );
        assert.doesNotMatch(reference, /^Output to:/mu, referencePath);
      },
    );
  });

  it("documents validator-ready anchors, REFUTED-only ledgers, and resumable chunks", () => {
    assertForEachTarget(installedSkillPaths("goat-review"), (skillPath) => {
      const skill = readProjectFile(skillPath);
      const diffReview = readMarkdownSection(
        skillPath,
        "Diff Review (Quick) - Two-Pass Discipline",
      );
      const constraints = readMarkdownSection(skillPath, "Constraints");
      const output = readMarkdownSection(skillPath, "Output Format");

      assert.doesNotMatch(skill, /<target-project>\/path/u, skillPath);
      assert.match(
        output,
        /Machine-valid anchors use repo-relative paths/u,
        skillPath,
      );
      assert.match(
        diffReview,
        /Refutation Ledger:[^\n]+REFUTED suspicions only/iu,
        skillPath,
      );
      assert.match(
        diffReview,
        /CONFIRMED\/ADJUSTED[^\n]+Findings[^\n]+UNRESOLVED[^\n]+verdict counts/iu,
        skillPath,
      );
      assert.match(
        diffReview,
        /`Refutations logged`[^\n]+ledger record count/iu,
        skillPath,
      );
      assert.match(
        constraints,
        /\.goat-flow\/logs\/review\/goat-review-chunks\.<random>\.md/u,
        skillPath,
      );
      for (const requiredState of [
        "scope snapshot",
        "bound authority",
        "chunks completed",
        "chunks remaining",
        "findings with R-IDs",
        "refutation ledger",
        "verify no drift",
        "next chunk",
        "one consolidated verdict",
      ]) {
        assert.match(
          constraints,
          new RegExp(requiredState, "iu"),
          `${skillPath}: missing resumable chunk state ${requiredState}`,
        );
      }
    });
  });

  it("aligns goat-review persistence and validator status across output surfaces", () => {
    assertForEachTarget(installedSkillPaths("goat-review"), (skillPath) => {
      const scope = readMarkdownSection(
        skillPath,
        "Step 0 - Scope, Size, Spec",
      );
      const integrity = readMarkdownSection(
        skillPath,
        "Review Integrity (confidence signal)",
      );
      const output = readMarkdownSection(skillPath, "Output Format");

      assert.match(
        scope,
        /Bundle:[^\n]+persist-skipped: redactor-unavailable/u,
        skillPath,
      );
      assert.match(
        integrity,
        /Review validator:[^\n]+validated[^\n]+validator-unavailable/u,
        skillPath,
      );
      assert.match(
        output,
        /Review validator:[^\n]+validated[^\n]+validator-unavailable/u,
        skillPath,
      );
      assert.match(
        integrity,
        /Refutations logged:[^\n]+persist-skipped/u,
        skillPath,
      );
      assert.match(
        output,
        /Refutations logged:[^\n]+persist-skipped/u,
        skillPath,
      );
      assert.match(
        integrity,
        /Refutation ledger:[^\n]+only when Refutations logged is nonzero[^\n]+exact path[^\n]+`persist-skipped`/u,
        skillPath,
      );
      assert.match(
        output,
        /Refutation ledger: persist-skipped \| \.goat-flow\/logs\/review\/goat-review-refutations\.<random>\.txt/u,
        skillPath,
      );
      assert.doesNotMatch(output, /Refutation ledger: n\/a/u, skillPath);
      assert.match(
        integrity,
        /Degradation flags:[^\n]+persist-skipped: redactor-unavailable/u,
        skillPath,
      );
      assert.match(
        output,
        /Degradation flags:[^\n]+persist-skipped: redactor-unavailable/u,
        skillPath,
      );
    });

    assertForEachTarget(
      installedSkillReferencePaths("goat-review", "references/examples.md"),
      (referencePath) => {
        const examples = readMarkdownSection(
          referencePath,
          "Conditional Output and Provenance Shapes",
        );
        assert.match(
          examples,
          /Review Integrity:[^\n]+validator=(?:validated|validator-unavailable)/u,
          referencePath,
        );
      },
    );

    const publicGuidance = readMarkdownSection(
      "docs/skills.md",
      "/goat-review",
    );
    assert.match(publicGuidance, /host-owned pre-write redaction/iu);
    assert.match(
      publicGuidance,
      /Pass 2\.5[^\n]+no new tool, file, command, or model calls/u,
    );
    assert.match(publicGuidance, /Review validator:[^\n]+validated/iu);
  });
});
