/**
 * Check the dispatcher and user-invoked workflows covered by the shared skill contracts.
 *
 * These contracts inspect canonical and installed guidance so supported agents apply the same mode and evidence rules.
 * Use them when changing workflow routing, behavior, or required output.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertForEachTarget,
  assertMatchesAll,
  forbiddenCodexConsentPattern,
  forbiddenCodexExceptionPattern,
  forbiddenDelegationPromptPattern,
  installedSkillPaths,
  installedSkillReferencePaths,
  readMarkdownSection,
  readProjectFile,
  INSTALLED_SKILL_ROOTS,
} from "./skill-hardening.helpers.js";

describe("skill hardening contracts: debug, qa, critique, dispatcher (2/2)", () => {
  it("gives public type contracts higher risk than internal type-only changes", () => {
    assertForEachTarget(installedSkillPaths("goat-qa"), (skillPath) => {
      const changeRisk = readMarkdownSection(
        skillPath,
        "Phase 1 - Change Risk Analysis",
      );

      assert.match(
        changeRisk,
        /private\/internal type-only changes with no contract impact/u,
        skillPath,
      );
      assert.match(changeRisk, /Risk follows impact, not syntax/u, skillPath);
      assert.match(
        changeRisk,
        /A type-only change is LOW only when it cannot change or misrepresent a public\/exported, serialized, persisted, or cross-module contract/u,
        skillPath,
      );
      assert.match(
        changeRisk,
        /When classifications overlap, use the higher risk/u,
        skillPath,
      );
    });
  });

  it("keeps Audit inspection role separate from impact-based risk", () => {
    assertForEachTarget(installedSkillPaths("goat-qa"), (skillPath) => {
      const auditMode = readMarkdownSection(skillPath, "Audit Mode");
      assert.match(
        auditMode,
        /File role sets inspection priority, not risk/u,
        skillPath,
      );
      assert.match(
        auditMode,
        /Assign risk from each named behaviour's demonstrated impact and blast radius/u,
        skillPath,
      );
      assert.match(
        auditMode,
        /A public export or route alone does not force CRITICAL or HIGH/u,
        skillPath,
      );
      assert.doesNotMatch(
        auditMode,
        /Load-bearing \+ Interface files get CRITICAL or HIGH risk ratings by default/u,
        skillPath,
      );
    });
  });

  it("keeps goat-qa Audit priorities coherent through the post-gate plan", () => {
    assertForEachTarget(installedSkillPaths("goat-qa"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(
        skillGuidance,
        /Audit uses "Blocking \/ High-value \/ Defer"/,
        skillPath,
      );
      assert.doesNotMatch(
        readMarkdownSection(skillPath, "Constraints"),
        /MUST produce "must test \/ should test \/ safe to skip"/,
        skillPath,
      );
    });
    assertForEachTarget(
      installedSkillReferencePaths("goat-qa", "references/output-templates.md"),
      (referencePath) => {
        const outputTemplates = readProjectFile(referencePath);
        const auditPostGateHeading =
          "### Audit post-gate plan (after A4 approval)";
        assert.notEqual(
          outputTemplates.indexOf(auditPostGateHeading),
          -1,
          referencePath,
        );
        const auditPostGateTemplate = outputTemplates.slice(
          outputTemplates.indexOf(auditPostGateHeading),
        );
        assert.match(auditPostGateTemplate, /### Blocking gaps/, referencePath);
        assert.match(
          auditPostGateTemplate,
          /### High-value additions/,
          referencePath,
        );
        assert.match(auditPostGateTemplate, /### Defer/, referencePath);
      },
    );
  });

  it("classifies goat-qa Audit coverage per named behaviour or invariant", () => {
    assertForEachTarget(installedSkillPaths("goat-qa"), (skillPath) => {
      const auditMode = readMarkdownSection(skillPath, "Audit Mode");
      assert.match(
        auditMode,
        /Inventory named behaviours\/invariants with a code anchor and risk before coverage; CRITICAL\/HIGH\/MEDIUM inventory must be exhaustive/u,
        skillPath,
      );
      assert.match(
        auditMode,
        /Create one row per named behaviour; files may have multiple rows\/labels/u,
        skillPath,
      );
      assert.match(
        auditMode,
        /A file summary cannot promote a row/u,
        skillPath,
      );
      assert.match(
        auditMode,
        /BEHAVIOURAL applies only to the named behaviour\/invariant actually asserted/u,
        skillPath,
      );
    });
  });

  it("defines each goat-qa coverage depth by the evidence that earns it", () => {
    // These four definitions decide every depth an agent may assign, so each one names the evidence that earns it.
    assertForEachTarget(installedSkillPaths("goat-qa"), (skillPath) => {
      const coverageDepth = readMarkdownSection(skillPath, "Coverage Depth");

      // NONE must require a bounded search and must count a manual plan as coverage.
      assert.match(
        coverageDepth,
        /\| NONE \| No current automated assertion or manual plan found for the named behaviour after a bounded search \|/u,
        skillPath,
      );
      // Snapshots and mock choreography alone stay structural, whatever their apparent depth.
      assert.match(
        coverageDepth,
        /\| STRUCTURAL \| Imports, constructs, snapshots, or collaborator choreography only[^\n]*no behaviour assertion \|/u,
        skillPath,
      );
      assert.match(
        coverageDepth,
        /\| PARTIAL-BEHAVIOURAL \| Happy path or narrow behaviour only; error\/edge paths untested \|/u,
        skillPath,
      );
      assert.match(
        coverageDepth,
        /\| BEHAVIOURAL \| Meaningful output, side-effect, error-path, or invariant coverage \|/u,
        skillPath,
      );
      // An absent test body is an unavailable depth, not a fifth level and not NONE.
      assert.doesNotMatch(
        coverageDepth,
        /\| (UNKNOWN|UNVERIFIED|UNRESOLVED) \|/u,
        skillPath,
      );
    });
  });

  it("requires goat-qa to back absent, unavailable, and zero-gap claims with evidence", () => {
    assertForEachTarget(installedSkillPaths("goat-qa"), (skillPath) => {
      const gapAnalysis = readMarkdownSection(
        skillPath,
        "Phase 2 - Gap Analysis",
      );

      // A test that cannot be read is recorded, never silently dropped or counted as absent.
      assert.match(
        gapAnalysis,
        /Read each matched test file and classify coverage depth; record unavailable tests in Verification Integrity/u,
        skillPath,
      );
      // Missing evidence produces an unresolved row and a next check, never a dropped row.
      assert.match(
        gapAnalysis,
        /incomplete evidence is `UNRESOLVED`, not omission/u,
        skillPath,
      );
      // Audit reaches NONE only after searching tests and exported-symbol references.
      assert.match(
        readMarkdownSection(skillPath, "Audit Mode"),
        /Search all tests and exported-symbol references\. No matching test\/manual plan → coverage `NONE`/u,
        skillPath,
      );
      // A clean result is a claim that must carry its own evidence.
      assert.match(
        readMarkdownSection(skillPath, "Constraints"),
        /MUST defend zero-gap results explicitly[^\n]*Zero gaps without justification is an error condition, not a clean bill/u,
        skillPath,
      );
    });
  });

  it("lets an auto-released goat-qa gate carry both phases in one response", () => {
    // Explicit test-plan intent releases Standard's Phase 2 gate, so both phases render in one response.
    // The reference is read at render time and outranks the skill there: a blanket ban on combining
    // phases would drop the risk map and gap analysis from every test-plan answer.
    assertForEachTarget(
      installedSkillReferencePaths("goat-qa", "references/output-templates.md"),
      (referencePath) => {
        const outputTemplates = readProjectFile(referencePath);

        // Modes never mix, and a gate report never ships with the plan that follows it.
        // Only Standard's auto-release is exempt; Audit always stays separated.
        assert.match(
          outputTemplates,
          /Never combine templates from different modes, and never combine a gate report with the plan that follows it/u,
          referencePath,
        );
        assert.match(
          outputTemplates,
          /Audit has no such release and always waits after A4/u,
          referencePath,
        );
        assert.doesNotMatch(
          outputTemplates,
          /do not combine templates from different phases/u,
          referencePath,
        );
        // The combined response keeps Phase 2 first and carries one ledger and one integrity section.
        assert.match(
          outputTemplates,
          /explicit test-plan intent releases the Phase 2 gate[^.]*Phase 2 blocks first and the Phase 3 plan after them/u,
          referencePath,
        );
        assert.match(
          outputTemplates,
          /single Refuted Candidates ledger and a single Verification Integrity section/u,
          referencePath,
        );
        // The Phase 3 block itself must not read as though the gate can only be approved by a human.
        assert.match(
          outputTemplates,
          /### Standard mode - Phase 3 output \(after the Phase 2 gate is approved or auto-released\)/u,
          referencePath,
        );
      },
    );
  });

  it("routes every goat-qa risk and coverage combination exhaustively", () => {
    const expectedMatrixCases = [
      /\| CRITICAL \| Blocking \| Blocking \| Blocking \| Defer \|/,
      /\| HIGH \| Blocking \| Blocking \| High-value \| Defer \|/,
      /\| MEDIUM \| High-value \| High-value \| High-value \| Defer \|/,
      /\| LOW \| Defer \| Defer \| Defer \| Defer \|/,
    ];

    assertForEachTarget(installedSkillPaths("goat-qa"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(skillGuidance, /Exhaustive priority matrix/, skillPath);
      // Every risk and coverage combination must have guidance so QA priority does not depend on an omitted case.
      for (const matrixRow of expectedMatrixCases) {
        assert.match(skillGuidance, matrixRow, skillPath);
      }
      assert.match(
        skillGuidance,
        /Standard maps Blocking to Must test, High-value to Should test, and Defer to Safe to skip/,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /Risk × uncovered fraction.*NONE=1\.0, STRUCTURAL=0\.66, PARTIAL-BEHAVIOURAL=0\.33, BEHAVIOURAL=0/,
        `${skillPath}: uncovered fraction must decrease as behavioural coverage increases`,
      );
      assert.match(
        skillGuidance,
        /Illustrative scenario - input\/output shape only; never evidence/,
        skillPath,
      );
      assert.doesNotMatch(
        skillGuidance,
        /content-integrity helper with no unit, integration, or exported-symbol references is genuinely NONE/,
        skillPath,
      );
    });
    assertForEachTarget(
      installedSkillReferencePaths("goat-qa", "references/output-templates.md"),
      (referencePath) => {
        const outputTemplates = readProjectFile(referencePath);
        assert.match(
          outputTemplates,
          /### Must test before shipping  <!-- Matrix Blocking pairs/,
          referencePath,
        );
        assert.match(
          outputTemplates,
          /### Should test if time allows  <!-- Matrix High-value pairs/,
          referencePath,
        );
      },
    );
  });

  it("carries MEDIUM high-value gaps into goat-qa Standard Phase 2", () => {
    assertForEachTarget(installedSkillPaths("goat-qa"), (skillPath) => {
      const phase2 = readMarkdownSection(skillPath, "Phase 2 - Gap Analysis");

      assert.match(
        phase2,
        /map every case and CRITICAL\/HIGH\/MEDIUM change in both directions/u,
        skillPath,
      );
      assert.match(
        phase2,
        /Apply the exhaustive priority matrix to every changed behaviour/u,
        skillPath,
      );
    });
    assertForEachTarget(
      installedSkillReferencePaths("goat-qa", "references/output-templates.md"),
      (referencePath) => {
        const outputTemplates = readProjectFile(referencePath);
        const outputStartMarker =
          "### Standard mode - Phase 2 output (diff-driven, present at BLOCKING GATE)";
        const outputEndMarker =
          "### Standard mode - Phase 3 output (after the Phase 2 gate is approved or auto-released)";
        const outputStartIndex = outputTemplates.indexOf(outputStartMarker);
        const outputEndIndex = outputTemplates.indexOf(outputEndMarker);

        assert.notEqual(outputStartIndex, -1, referencePath);
        assert.ok(outputEndIndex > outputStartIndex, referencePath);
        const standardPhase2Output = outputTemplates.slice(
          outputStartIndex,
          outputEndIndex,
        );
        assert.match(
          standardPhase2Output,
          /Matrix Blocking and High-value pairs/u,
          referencePath,
        );
        assert.doesNotMatch(
          standardPhase2Output,
          /CRITICAL\/HIGH changes with no or partial test coverage/u,
          referencePath,
        );
      },
    );
  });

  it("labels the preflight goat-critique wording gate as static", () => {
    const preflight = readProjectFile("scripts/preflight-checks.sh");
    assert.match(preflight, /section "Skill Static Contracts"/);
    assert.doesNotMatch(preflight, /Skill Behavioral Contracts/);
  });

  it("accepts verified clean goat-critique results without fabricated findings", () => {
    assertForEachTarget(installedSkillPaths("goat-critique"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(skillGuidance, /Check sub-agent completeness/, skillPath);
      assert.match(
        skillGuidance,
        /clean-result attestation after one documented second pass/,
        skillPath,
      );
      assert.match(skillGuidance, /Evidence reviewed:/, skillPath);
      assert.match(skillGuidance, /Residual uncertainty:/, skillPath);
      assert.doesNotMatch(
        skillGuidance,
        /Each sub-agent MUST return 3-7 findings/,
        skillPath,
      );
      assert.match(skillGuidance, /sub-agent completeness limited/, skillPath);
    });

    const directivePaths = INSTALLED_SKILL_ROOTS.map(
      (skillRoot) =>
        `${skillRoot}/goat-critique/references/sub-agent-directives.md`,
    );
    assertForEachTarget(directivePaths, (referencePath) => {
      const directives = readProjectFile(referencePath);
      assert.match(directives, /Clean-result attestation/, referencePath);
      assert.match(directives, /Second-pass result:/, referencePath);
      assert.match(directives, /Residual uncertainty:/, referencePath);
      assert.match(
        directives,
        /Never invent a finding to meet the normal target/,
        referencePath,
      );
    });
  });

  it("merges goat-critique rubric context maps into the fixed context split", () => {
    assertForEachTarget(installedSkillPaths("goat-critique"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(
        skillGuidance,
        /Merge the selected rubric map[^\n]+fixed A\/B\/C split[^\n]+never replace baseline context/u,
        skillPath,
      );
    });

    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-critique",
        "references/rubric-examples.md",
      ),
      (referencePath) => {
        const contextMaps = readMarkdownSection(
          referencePath,
          "Rubric Context Maps",
        );
        assert.match(
          contextMaps,
          /Each map lists additions to the fixed Context split[^\n]+never replaces it/u,
          referencePath,
        );
        assert.match(
          contextMaps,
          /Agents A and B keep their artifact[^\n]+architecture[^\n]+rubric baseline/iu,
          referencePath,
        );
        assert.match(
          contextMaps,
          /empty C list means no additional project context/iu,
          referencePath,
        );
        // Rubrics that add no project context of their own, so an agent running them sees
        // only the fixed baseline split rather than an invented extra reading list.
        const rubricsWithEmptyContextList = 7;

        assert.equal(
          contextMaps.match(/- \*\*C:\*\* \[\]/gu)?.length,
          rubricsWithEmptyContextList,
          referencePath,
        );
      },
    );
  });

  it("uses one reproducible goat-critique meta-audit rubric", () => {
    const metaAuditChecks = [
      "Gate-finding match",
      "Evidence quality per finding",
      "Rubric coverage completeness",
      "Recommendation actionability",
      "Retraction rationale",
      "Contradictions",
      "Top-blocker traceability",
      "Severity consistency",
      "Integration hooks",
      "Blind-spot statement",
    ];

    assertForEachTarget(installedSkillPaths("goat-critique"), (skillPath) => {
      const synthesis = readMarkdownSection(skillPath, "Phase 5 - Synthesise");
      assert.match(
        synthesis,
        /ten rules from `references\/rubric-examples\.md`/u,
        skillPath,
      );
      assert.match(synthesis, /Score each 0 or 10/u, skillPath);
      assert.match(synthesis, /sum is `Meta-score`/u, skillPath);
      assert.match(synthesis, /no partial credit/u, skillPath);
      assert.doesNotMatch(
        synthesis,
        /unsupported-certainty|missing-objections|decision-clarity/u,
        skillPath,
      );
    });

    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-critique",
        "references/rubric-examples.md",
      ),
      (referencePath) => {
        const metaAudit = readMarkdownSection(
          referencePath,
          "Meta-audit rubric (Phase 5.5)",
        );
        // Collect every absent check first, so one failure names all of them rather than
        // stopping at whichever happened to be listed first.
        const missingMetaAuditChecks = metaAuditChecks.filter(
          (checkName) => !metaAudit.includes(checkName),
        );

        assert.deepEqual(missingMetaAuditChecks, [], referencePath);
        assert.match(
          metaAudit,
          /Award 10 only when a check is fully satisfied/u,
        );
        assert.match(metaAudit, /partial credit is forbidden/u);
        assert.match(metaAudit, /`Meta-score` is the sum/u);
      },
    );
  });

  // A clean critique and a critique with findings must be gradeable by the same reader, so the two
  // returns carry one field contract and clean is an empty finding list rather than a different schema.
  it("gives goat-critique one result envelope for clean and non-clean returns", () => {
    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-critique",
        "references/sub-agent-directives.md",
      ),
      (referencePath) => {
        const directives = readProjectFile(referencePath);
        assertMatchesAll(
          directives,
          [
            /same envelope/iu,
            /empty finding list/iu,
            /Agent identity:/u,
            /Coverage ledger:/u,
            /Lens dispositions:/u,
          ],
          referencePath,
        );
        // One envelope means the two returns are never mutually exclusive at whole-return level.
        assert.doesNotMatch(
          directives,
          /returns this schema instead of findings/iu,
          referencePath,
        );
      },
    );
  });

  // Every rule that attributes a scope, a hook or a retraction to something needs a referent, so a
  // finding carries an identifier and the shared evidence scale the rest of the harness already uses.
  // Invariant: the identifier is run-local and the scale includes HUMAN-PENDING, so hooks, retractions and
  // coverage rows resolve to one finding and the evidence contract matches the shared preamble.
  it("gives every goat-critique finding an identity and the shared evidence scale", () => {
    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-critique",
        "references/sub-agent-directives.md",
      ),
      (referencePath) => {
        assertMatchesAll(
          readProjectFile(referencePath),
          [
            /Finding ID:/u,
            /run-local/iu,
            /HUMAN-PENDING/u,
            /Rubric dimensions:/u,
          ],
          referencePath,
        );
      },
    );
  });

  // An unaddressed dimension is missing coverage, not a defect in the artifact; manufacturing a HIGH
  // for it both fabricates a finding and makes the CLEAN gate unreachable on the clean path.
  it("reports goat-critique dimension coverage instead of manufacturing findings", () => {
    assertForEachTarget(installedSkillPaths("goat-critique"), (skillPath) => {
      const ranking = readMarkdownSection(
        skillPath,
        "Phase 2 - Rank and Compare",
      );
      assertMatchesAll(ranking, [/checked-clean/u, /unassessed/u], skillPath);
      assert.doesNotMatch(ranking, /auto-generate HIGH/iu, skillPath);
      assert.doesNotMatch(ranking, /optional . MEDIUM/iu, skillPath);
      assert.match(
        readProjectFile(skillPath),
        /never generates a HIGH/iu,
        skillPath,
      );
    });
  });

  // The meta-agent grades a packet it is handed; every rule it applies has to travel inside that packet.
  it("makes the goat-critique meta packet carry the rules it grades against", () => {
    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-critique",
        "references/rubric-examples.md",
      ),
      (referencePath) => {
        const metaAudit = readMarkdownSection(
          referencePath,
          "Meta-audit rubric (Phase 5.5)",
        );
        assertMatchesAll(
          metaAudit,
          [
            /any CRITICAL gives BLOCK/iu,
            /HIGH without CRITICAL gives CONCERNS/iu,
            /otherwise CLEAN/u,
            /zero or multiple/iu,
            /incomplete inspection is not an artifact defect/iu,
          ],
          referencePath,
        );
      },
    );
  });

  // A score names the exact draft it graded, so a later edit cannot inherit a score it never earned.
  it("binds a goat-critique meta score to the revision it audited", () => {
    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-critique",
        "references/rubric-examples.md",
      ),
      (referencePath) => {
        assertMatchesAll(
          readProjectFile(referencePath),
          [
            /report_revision/u,
            /audited_revision/u,
            /one fresh two-call recheck/iu,
          ],
          referencePath,
        );
      },
    );
  });

  // Risk level and CLEAN are separate axes from coverage; neither may read as a safety clearance.
  it("derives goat-critique risk level and CLEAN from surviving findings", () => {
    assertForEachTarget(installedSkillPaths("goat-critique"), (skillPath) => {
      const synthesis = readMarkdownSection(skillPath, "Phase 5 - Synthesise");
      assertMatchesAll(
        synthesis,
        [
          /highest surviving evidenced artifact severity/iu,
          /no evidenced defect/iu,
          /CLEAN coexists with lower-severity findings/iu,
        ],
        skillPath,
      );
      assert.match(
        readMarkdownSection(skillPath, "Phase 3 - Cross-Examine"),
        /No findings require cross-examination/u,
        skillPath,
      );
      assert.doesNotMatch(synthesis, /Must never be empty/iu, skillPath);
    });
    assertForEachTarget(installedSkillPaths("goat-critique"), (skillPath) => {
      assert.doesNotMatch(
        readProjectFile(skillPath),
        /no disputes - full consensus/iu,
        skillPath,
      );
    });
  });

  // Even a 100/100 critique must show the meta-audit result, using a clean attestation when it found no issues.
  it("renders truthful goat-critique meta-audit issues for clean results", () => {
    assertForEachTarget(installedSkillPaths("goat-critique"), (skillPath) => {
      const synthesis = readMarkdownSection(skillPath, "Phase 5 - Synthesise");
      const outputFormat = readMarkdownSection(skillPath, "Output Format");

      assert.match(
        synthesis,
        /at 100\/100 write exactly `No failed meta-audit checks\.`/u,
        skillPath,
      );
      assert.match(synthesis, /Never invent issues/u, skillPath);
      assert.match(
        outputFormat,
        /## Auto-Detected Issues  <!-- failures or exact clean attestation; always present -->/u,
        skillPath,
      );
      assert.doesNotMatch(
        outputFormat,
        /## Auto-Detected Issues[^\n]+if any/u,
        skillPath,
      );
    });

    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-critique",
        "references/rubric-examples.md",
      ),
      (referencePath) => {
        const metaAudit = readMarkdownSection(
          referencePath,
          "Meta-audit rubric (Phase 5.5)",
        );
        assert.match(
          metaAudit,
          /When all 10 checks pass, write exactly `No failed meta-audit checks\.`/u,
          referencePath,
        );
        assert.match(
          metaAudit,
          /A clean attestation is not an issue and must not be expanded into one/u,
          referencePath,
        );
      },
    );
  });

  it("keeps goat-critique lifecycle aligned with its accepted decision and public guidance", () => {
    assertForEachTarget(installedSkillPaths("goat-critique"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(
        skillGuidance,
        /Phases 1-5, 5\.5 meta-audit, 5\.6 outcome capture, three critique sub-agents, one meta-agent/,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /full delegated, Phases 1-5 plus 5\.5\/5\.6, three critique sub-agents plus one meta-agent/,
        skillPath,
      );
    });

    const acceptedDecision = readProjectFile(
      ".goat-flow/learning-loop/decisions/ADR-021-goat-critique-full-mode-only.md",
    );
    assert.match(
      acceptedDecision,
      /mandatory lifecycle is Phases 1-5 plus Phase 5\.5 meta-audit and Phase 5\.6 outcome capture/,
    );
    assert.match(
      acceptedDecision,
      /three isolated critique sub-agents[\s\S]+up to three cross-exam agents[\s\S]+one meta-agent/,
    );

    const publicSkills = readProjectFile("docs/skills.md");
    assert.match(publicSkills, /3 critique agents \(always\)/);
    assert.match(publicSkills, /up to 3 cross-exam agents \(conditional\)/);
    assert.match(publicSkills, /1 meta-agent \(always\)/);
    assert.match(publicSkills, /5\.5: Meta-audit; 5\.6: Outcome capture/);

    const setupGuide = readProjectFile("workflow/setup/03-install-skills.md");
    assert.match(setupGuide, /mandatory Phase 5\.5 meta-audit/);
    assert.match(setupGuide, /Phase 5\.6 outcome capture/);
    assert.match(setupGuide, /1 mandatory meta-agent/);
  });

  it("keeps goat-critique host-owned so human gates cannot auto-convert", () => {
    assertForEachTarget(installedSkillPaths("goat-critique"), (skillPath) => {
      const intake = readMarkdownSection(skillPath, "Step 0 - Intake");
      const synthesis = readMarkdownSection(skillPath, "Phase 5 - Synthesise");

      assert.match(intake, /host\/root context owns Phases 1-5\.6/u, skillPath);
      assert.match(
        intake,
        /forked sub-agent[\s\S]+return[\s\S]+before Phase 1/u,
        skillPath,
      );
      assert.match(
        intake,
        /does not apply the shared sub-agent gate conversion/u,
        skillPath,
      );
      assert.match(
        synthesis,
        /After the host receives the human's A\/B\/C\/D pick/u,
        skillPath,
      );
    });

    const acceptedDecision = readProjectFile(
      ".goat-flow/learning-loop/decisions/ADR-021-goat-critique-full-mode-only.md",
    );
    assert.match(acceptedDecision, /lifecycle is host-owned/u);
    assert.match(
      acceptedDecision,
      /forked sub-agent[\s\S]+returns control before Phase 1/u,
    );

    const publicSkills = readProjectFile("docs/skills.md");
    assert.match(
      publicSkills,
      /host\/root owns the lifecycle and human gates/u,
    );

    const setupGuide = readProjectFile("workflow/setup/03-install-skills.md");
    assert.match(setupGuide, /host owns the lifecycle and human gates/u);
  });

  it("redacts goat-critique persistence before disk and preserves the human gate", () => {
    assertForEachTarget(installedSkillPaths("goat-critique"), (skillPath) => {
      const phaseFour = readMarkdownSection(skillPath, "Phase 4 - Clarify");
      assert.match(phaseFour, /keep.*Phase 1-3.*in memory/iu, skillPath);
      assert.match(
        phaseFour,
        /stdin.*`goat-flow redact --output \.goat-flow\/logs\/critiques\/<YYYY-MM-DD>-<HHMM>-<artifact-slug>-<rand5>\.md`.*matching source CLI/isu,
        skillPath,
      );
      assert.match(
        phaseFour,
        /only.*redactor.*destination bytes.*disk/isu,
        skillPath,
      );
      assert.match(
        phaseFour,
        /unavailable.*redaction fails.*write nothing.*`persist-skipped: redactor-unavailable`.*continue.*human gate/isu,
        skillPath,
      );
      assert.match(phaseFour, /Phase 3 early exit/u, skillPath);
      assert.doesNotMatch(
        phaseFour,
        /\bWrite Phase 1-3\b|(?:write|persist).*raw.*(?:then|before).*redact/iu,
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

  it("requires team fit without weakening mandatory critique", () => {
    const conventionPaths = [
      "workflow/skills/reference/skill-conventions.md",
      ".goat-flow/skill-docs/skill-conventions.md",
    ];

    assertForEachTarget(conventionPaths, (referencePath) => {
      const admissionGuidance = readMarkdownSection(
        referencePath,
        "Orchestration Admission",
      );
      assert.match(admissionGuidance, /Objective per subagent:/, referencePath);
      assert.match(
        admissionGuidance,
        /Why tasks are independent:/,
        referencePath,
      );
      assert.match(admissionGuidance, /Merge boundary:/, referencePath);
      assert.match(admissionGuidance, /Budget\/call cap:/, referencePath);
      assert.match(admissionGuidance, /Return schema:/, referencePath);
      assert.match(admissionGuidance, /Conflict owner:/, referencePath);
      assert.match(admissionGuidance, /Stop condition:/, referencePath);
      assert.match(
        admissionGuidance,
        /Same-context reassurance with no new evidence is denied/,
        referencePath,
      );
      assert.match(
        admissionGuidance,
        /Scouts get 5 tool calls; implementation gets 5 plus the task's estimated minutes, up to 20 tool calls, with larger tasks split first/,
        referencePath,
      );
      assert.match(
        admissionGuidance,
        /Required skill phases and verification are pre-admitted/,
        referencePath,
      );
      assert.match(
        admissionGuidance,
        /Explicit `goat-critique` stays full delegated mode/,
        referencePath,
      );
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

  it("lets simple factual questions bypass dispatcher ceremony", () => {
    assertForEachTarget(installedSkillPaths("goat"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(skillGuidance, /Simple-fact fast path/, skillPath);
      assert.match(
        skillGuidance,
        /answer directly after UNDERSTAND; skip GATHER and the Route Snapshot/,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /Route Snapshot for every inferred skill or direct-execution dispatch/,
        skillPath,
      );
    });
  });

  it("documents every dispatcher terminal outcome without collapsing endpoints", () => {
    const skillsDocumentation = readProjectFile("docs/skills.md");
    const dispatcherDocumentation = readMarkdownSection(
      "docs/skills.md",
      "/goat - Dispatcher",
    );

    assert.match(
      dispatcherDocumentation,
      /Explicit -->\|Yes\| Execute\["Load (?:named|target) skill's Step 0"\]/u,
      "explicit skill invocations must load the named skill",
    );
    assert.match(
      dispatcherDocumentation,
      /Explicit skill invocations pass through immediately to the named skill's Step 0 without reclassification/u,
      "explicit invocations must bypass inferred routing",
    );
    assert.match(
      dispatcherDocumentation,
      /Multi-intent requests are split into numbered intents and routed separately/u,
      "compound requests must retain separate ordered routes",
    );
    assert.match(
      dispatcherDocumentation,
      /Snapshot --> Destination/u,
      "every inferred route must emit its Route Snapshot before dispatch",
    );
    assert.match(
      dispatcherDocumentation,
      /Destination -->\|Skill\| Execute/u,
      "inferred skill routes must load the target skill",
    );
    assert.match(
      dispatcherDocumentation,
      /Destination -->\|Direct\| Direct\["Use execution loop directly"\]/u,
      "direct execution must not load a skill Step 0",
    );
    assert.match(
      dispatcherDocumentation,
      /Outcome -->\|Quality flow\| Quality\["Use goat-flow quality"\]/u,
      "framework quality assessment must use its dedicated flow",
    );
    assert.match(
      dispatcherDocumentation,
      /Outcome -->\|Bare path\| Context\["Keep read-only context"\]/u,
      "a bare path must remain a non-writing context outcome",
    );
    assert.match(
      dispatcherDocumentation,
      /GOAT Flow setup\/process\/harness\/skills quality assessment[^\n]+`goat-flow quality` CLI\/dashboard prompt flow; no goat skill wrapper/u,
      "the quality-flow table row must not imply a skill wrapper",
    );
    assert.match(
      dispatcherDocumentation,
      /Comment, documentation, naming, or private-placement remediation[^\n]+`\/goat-clarity`/u,
      "clarity remediation must have a public route",
    );
    assert.match(
      dispatcherDocumentation,
      /Bare task path \(no action verb\)[^\n]+Read-only context; do not update `\.active`, milestone status, or code/u,
      "bare task paths must remain read-only",
    );
    assert.match(
      dispatcherDocumentation,
      /Simple implementation \(single-file, obvious\)[^\n]+Direct execution loop with a Route Snapshot; no skill/u,
      "simple implementation must terminate in direct execution",
    );
    assert.match(
      dispatcherDocumentation,
      /Simple question[^\n]+Direct answer; no GATHER or Route Snapshot/u,
      "simple questions must terminate in a direct answer",
    );
    assert.doesNotMatch(
      skillsDocumentation,
      /Snapshot --> Execute(?:\s|$)/u,
      "a shared endpoint collapses direct execution into skill loading",
    );
  });
});
