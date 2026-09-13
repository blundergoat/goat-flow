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
  readMarkdownSubsection,
  readProjectFile,
  verifyNamedAnchorsResolve,
} from "./skill-hardening.helpers.js";

describe("skill hardening contracts: goat-review (2/3)", () => {
  it("calibrates goat-review severity from evidence before labels", () => {
    assertForEachTarget(installedSkillPaths("goat-review"), (skillPath) => {
      const skill = readProjectFile(skillPath);
      const crossCheck = readMarkdownSection(
        skillPath,
        "Diff Review - Quick and Full",
      );
      assert.match(crossCheck, /references\/review-traps\.md/u, skillPath);
      assert.match(crossCheck, /confirmed review-reasoning miss/u, skillPath);
      assert.match(skill, /Evidence before severity/u, skillPath);
      // Severity guidance must consider each reachability and impact factor before labeling a user-facing risk.
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
      assert.match(skill, /\{R-id, file, anchor, action\}/u, skillPath);
      assert.match(
        skill,
        /same-file findings sharing a semantic location/iu,
        skillPath,
      );
      // Line ranges go stale on every edit, so overlap is keyed on the semantic anchor instead.
      assert.doesNotMatch(skill, /overlapping ranges/iu, skillPath);
      assert.match(skill, /demote both one rung/u, skillPath);
      assert.match(skill, /Tension with R-0NN/u, skillPath);
      assert.match(skill, /two review→fix cycles/u, skillPath);
      assert.match(skill, /without fewer findings/u, skillPath);
      assert.match(skill, /re-test the original defect/u, skillPath);
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
        /diff >200 lines[^\n]+MUST[^\n]+verification mechanism/u,
        skillPath,
      );
      assert.match(
        skill,
        /Subtractive[^\n]+named guard[^\n]+pinned-version framework behaviour[^\n]+passing test/u,
        skillPath,
      );
      assert.match(skill, /surviving MUST\/correctness-SHOULD/u, skillPath);
      assert.match(
        skill,
        /Re-frame only gathered Pass 0 lines and Pass 2 reads/u,
        skillPath,
      );
      assert.match(
        skill,
        /no new tool, file, command, or model calls/u,
        skillPath,
      );
      assert.match(
        skill,
        /test passes only[^\n]+literal current-session Pass 0 result/iu,
        skillPath,
      );
      assert.match(skill, /subagent[^\n]+Orchestration Admission/iu, skillPath);
    });
  });

  it("renders goat-review sections only when they carry review signal", () => {
    assertForEachTarget(installedSkillPaths("goat-review"), (skillPath) => {
      const output = readMarkdownSection(skillPath, "Output Format");
      assert.match(
        output,
        /Emit `## Top 5 Risks` only above five surfaced findings/iu,
        skillPath,
      );
      assert.doesNotMatch(output, /If <5 total, list all/iu, skillPath);
      assert.match(output, /Render only populated/iu, skillPath);
      // Optional review sections must be named explicitly so empty report headings are not mistaken for findings.
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
        /Clean PR[^\n]+references\/examples\.md[^\n]+Clean review compact surface/iu,
        skillPath,
      );
      const referencePath = skillPath.replace(
        /SKILL\.md$/u,
        "references/examples.md",
      );
      const compact = readMarkdownSubsection(
        readMarkdownSection(
          referencePath,
          "Conditional Output and Provenance Shapes",
        ),
        "Clean review compact surface",
        referencePath,
      );
      // The compact example must keep each reader-visible summary element after detailed rules move to their reference.
      for (const field of [
        "Scope",
        "Ship Verdict",
        "Zero findings",
        "Review Integrity",
        "What I Didn't Examine",
      ]) {
        assert.ok(
          compact.includes(`${field}:`),
          `${skillPath}: compact ${field}`,
        );
      }
      assert.match(compact, /chunking=<no\|accepted>/u, skillPath);
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
      // Every report must disclose these fields so readers can assess its scope, evidence, and remaining limits.
      for (const mandatoryField of [
        "Scope snapshot",
        "Authority snapshot",
        "Gate authority",
        "Files opened in Pass 2",
        "Source coverage",
        "Final dispositions",
        "Degradation evidence",
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
      // These integrity fields appear only when resolved evidence exists to populate them.
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
      assert.match(output, /- Source coverage: <canonical JSON/u, skillPath);
      assert.match(output, /- Final dispositions: <canonical JSON/u, skillPath);
      assert.match(
        output,
        /- Degradation evidence: <canonical JSON/u,
        skillPath,
      );
      assert.match(integrity, /docs\/cli\.md/u, skillPath);
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

  it("pins one severity vocabulary and canonical integrity field shapes", () => {
    assertForEachTarget(installedSkillPaths("goat-review"), (skillPath) => {
      const diffReview = readMarkdownSection(
        skillPath,
        "Diff Review - Quick and Full",
      );
      const integrity = readMarkdownSection(
        skillPath,
        "Review Integrity (confidence signal)",
      );
      const scope = readMarkdownSection(
        skillPath,
        "Step 0 - Scope, Size, Spec",
      );

      // A reviewed project's own severity ladder must never reach the report's SEVERITY slot.
      assert.match(
        diffReview,
        /SEVERITY is exactly `MUST`, `SHOULD`, or `MAY`/u,
        skillPath,
      );
      assert.match(diffReview, /never fills that slot/u, skillPath);

      // The disposition map and the verdict tuple must not drift apart.
      assert.match(
        integrity,
        /every final `R-NNN` to exactly one lowercase/u,
        skillPath,
      );
      // Pass 2 refutations keep an R-ID, appear in the map as refuted, and count in the verdict tuple.
      assert.match(
        integrity,
        /refutations keep a distinct R-ID[\s\S]*one `refuted` map entry/u,
        skillPath,
      );
      assert.match(
        integrity,
        /`Verdicts` refuted equals `Refutations logged`/u,
        skillPath,
      );
      assert.doesNotMatch(integrity, /carry no R-ID/u, skillPath);

      // Rows the validator parses as JSON must be bare, and evidence keys must equal the emitted flags.
      assert.match(
        integrity,
        /bare canonical JSON, never code spans/u,
        skillPath,
      );
      assert.match(integrity, /exactly one entry per emitted flag/u, skillPath);
      assert.match(
        integrity,
        /`goat-review-gates\/v1` record; `gates: \[\]` when none run, never `\{\}`/u,
        skillPath,
      );

      // Conclusion precedence: partial-class flags win, inference-only limits give high-inference, other limits degrade coverage.
      assert.match(
        integrity,
        /`partial` for `chunked-partial` or `risk-depth-declined`; `high-inference` for inference-only limits; else `coverage-degraded`; disclosures alone `confident`/u,
        skillPath,
      );

      // The Size row's closing words are literal grammar, not an instruction to the author.
      const output = readMarkdownSection(skillPath, "Output Format");
      assert.match(
        output,
        /<!-- literal "exactly once" -->\n- Size: <n> files/u,
        skillPath,
      );
      assert.match(
        integrity,
        /canonical array of unique completed selected paths/u,
        skillPath,
      );

      // An unavailable producer degrades honestly instead of emitting a hand-built record.
      assert.match(scope, /controlling package source/u, skillPath);
      assert.match(scope, /[Nn]ever invent a schema/u, skillPath);

      // Target guidance is a source for this review, never an import into another project.
      assert.match(
        scope,
        /[Nn]ever import another project's standards/u,
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
        // Automated-review guidance must distinguish agreement, independent findings, verified bot findings, and disputes.
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
        // Stronger matching evidence must precede loose textual similarity when linking local and automated findings.
        for (const hierarchyTerm of [
          "symbol",
          "rule ID",
          "category",
          "root cause",
          // ADR-024: identity is decided on the semantic anchor, because line numbers go stale on every edit.
          "semantic location",
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
      assert.match(
        integrity,
        /Automated-review provenance[^\n]+PR active finding counts\/missed lists/u,
        skillPath,
      );
      // The output grammar must expose every provenance category named by the canonical integrity contract.
      for (const provenance of [
        "overlap-confirmed",
        "local-only",
        "bot-only-locally-verified",
        "disputed-match",
      ]) {
        assert.match(
          readProjectFile("docs/cli.md"),
          new RegExp(provenance, "u"),
          skillPath,
        );
        assert.match(output, new RegExp(provenance, "u"), skillPath);
      }
    });
  });

  it("requires positive evidence for goat-review verdicts", () => {
    assertForEachTarget(installedSkillPaths("goat-review"), (skillPath) => {
      const diffReview = readMarkdownSection(
        skillPath,
        "Diff Review - Quick and Full",
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
        "Diff Review - Quick and Full",
      );
      const output = readMarkdownSection(skillPath, "Output Format");

      assert.match(diffReview, /stable `R-001…` IDs/u, skillPath);
      assert.match(
        diffReview,
        /Refutation Ledger:[^\n]+one record per line:[^\n]+R-NNN/u,
        skillPath,
      );
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
      const skill = readProjectFile(skillPath);
      const diffReview = readMarkdownSection(
        skillPath,
        "Diff Review - Quick and Full",
      );
      const passThree = readMarkdownSection(
        skillPath,
        "Pass 3 - Cross-Model Refuter (explicit approval only)",
      );
      assert.match(
        diffReview,
        /Refutation Ledger:[^\n]+transient[^\n]+Do not redact in Pass 2/iu,
        skillPath,
      );
      assert.match(
        passThree,
        /Proof Gate:[^\n]+references\/examples\.md[^\n]+Pre-persistence Proof Envelope[^\n]+before redaction/iu,
        skillPath,
      );
      assert.match(
        diffReview,
        /one record per line[^\n]+R-NNN[^\n]+Suspicion:[^\n]+Evidence:[^\n]+Rationale:/u,
        skillPath,
      );
      assert.ok(
        skill.indexOf("## Pass 3 - Cross-Model Refuter") <
          skill.indexOf("**Proof Gate:**"),
        skillPath,
      );
    });

    assertForEachTarget(
      installedSkillReferencePaths("goat-review", "references/examples.md"),
      (referencePath) => {
        const scopeProcedure = readMarkdownSection(
          referencePath,
          "Scope, Gates, and Frozen Bundle Procedure",
        );
        const proofEnvelope = readMarkdownSubsection(
          scopeProcedure,
          "Pre-persistence Proof Envelope",
          referencePath,
        );
        assert.match(
          proofEnvelope,
          /`Review validator: pending`[^\n]+`goat-flow review validate-ledger`[^\n]+exact count/iu,
          referencePath,
        );
        assert.match(
          proofEnvelope,
          /fresh[^\n]+goat-review-refutations\.<random>\.txt[^\n]+Without redaction[^\n]+documented skips/iu,
          referencePath,
        );
        assert.match(
          proofEnvelope,
          /`goat-flow review validate-draft`[^\n]+`<!-- goat-flow-review-ledger-draft -->`[^\n]+exact transient records/iu,
          referencePath,
        );
        assert.match(
          proofEnvelope,
          /compatible redactor[^\n]+checked fresh destinations[^\n]+otherwise write nothing/iu,
          referencePath,
        );
        assert.ok(
          proofEnvelope.indexOf("goat-flow review validate-draft") <
            proofEnvelope.indexOf("Use the compatible redactor to write"),
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
        "Diff Review - Quick and Full",
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
        /CONFIRMED\/ADJUSTED[^\n]+Findings[^\n]+UNRESOLVED[^\n]+Unconfirmed[^\n]+Missing proof:[^\n]+Next check:/iu,
        skillPath,
      );
      assert.match(skill, /Pre-persistence Proof Envelope/u, skillPath);
      assert.match(
        constraints,
        /\.goat-flow\/logs\/review\/goat-review-chunks\.<random>\.md/u,
        skillPath,
      );
      // A resumed review needs each saved state item to continue the same scope and produce one consolidated verdict.
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
