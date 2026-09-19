/**
 * Protect the instructions users rely on when asking for QA, critique, or help choosing a workflow.
 *
 * Run these contracts after changing a skill's routing, evidence rules, or report fields to check every supported harness copy.
 * These are static guidance checks; application trials establish how agents use the instructions in a user's workflow.
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

      // A user's existing manual test plan counts as coverage, so NONE requires a search that finds neither tests nor a plan.
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
    // Asking goat-qa for a test plan releases Standard's Phase 2 gate, so the answer includes both the risk analysis and the plan.
    // The output template must allow that combined answer because it controls rendering after the skill chooses the mode.
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
    const preflightScript = readProjectFile("scripts/preflight-checks.sh");
    assert.match(preflightScript, /section "Skill Static Contracts"/);
    assert.doesNotMatch(preflightScript, /Skill Behavioral Contracts/);
  });

  it("accepts verified clean goat-critique results without fabricated findings", () => {
    assertForEachTarget(installedSkillPaths("goat-critique"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assertMatchesAll(
        skillGuidance,
        [
          /Check sub-agent completeness/,
          /clean-result attestation after one documented second pass/,
          /Evidence reviewed:/,
          /Residual uncertainty:/,
          /sub-agent completeness limited/,
          /Fresh-eyes boundary and recovery/u,
        ],
        skillPath,
      );
      assert.doesNotMatch(
        skillGuidance,
        /Each sub-agent MUST return 3-7 findings/,
        skillPath,
      );
    });

    const directivePaths = INSTALLED_SKILL_ROOTS.map(
      (skillRoot) =>
        `${skillRoot}/goat-critique/references/sub-agent-directives.md`,
    );
    assertForEachTarget(directivePaths, (referencePath) => {
      const directives = readProjectFile(referencePath);
      // A missing reviewer leaves a visible coverage limit; it cannot earn another retry or become a defect in the user's artifact.
      assertMatchesAll(
        directives,
        [
          /Clean-result attestation/,
          /Second-pass result:/,
          /Residual uncertainty:/,
          /Never invent a finding to meet the normal target/,
          /supplied artifact[\s\S]*selected rubric/iu,
          /instructions.*assessment material/iu,
          /c_replacements_used.*0/u,
          /one run-wide C replacement.*leak and missing-field failures/iu,
          /never reset.*resume.*failure type/iu,
          /Never resume.*contaminated child/iu,
          /exhausted[\s\S]*A\/B[\s\S]*host.*meta.*human/iu,
          /stdout.*candidate matches.*not.*verdict/iu,
          /zero matches.*no textual signal/iu,
          /unauthorized read.*even.*no matching term/iu,
          /Generic words.*tests.*not navigation/iu,
          /self-report.*unavailable/iu,
        ],
        referencePath,
      );
    });
  });

  it("merges goat-critique rubric context maps into the fixed context split", () => {
    assertForEachTarget(installedSkillPaths("goat-critique"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assertMatchesAll(
        skillGuidance,
        [
          /Merge the selected rubric map[^\n]+fixed A\/B\/C split[^\n]+never replace baseline context/u,
          /Read only the selected rubric's `###` map under Rubric Context Maps[^\n]+Other reference sections load at the phase that names them/u,
          /Fresh-eyes boundary and recovery/u,
          /separate input payloads and no result sharing/u,
        ],
        skillPath,
      );
      assert.doesNotMatch(
        skillGuidance,
        /same-field control|isolation enforced/u,
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
        assertMatchesAll(
          contextMaps,
          [
            /Each map lists additions to the fixed Context split[^\n]+never replaces it[\s\S]*\*\*B:\*\* relevant selected milestone artifacts/u,
            /Agents A and B keep their artifact[^\n]+architecture[^\n]+rubric baseline[\s\S]*Prefer the explicitly supplied milestone\/set.*advisory locator.*resolve the relevant milestone files; ask when the intended plan is ambiguous/iu,
            /empty C list means no additional project context[\s\S]*<active>.*need not be a version directory.*read-only context selection: never switch.*\.active.*change milestone status, or load all historical plans.*Milestone logs do not replace the selected artifacts/iu,
          ],
          referencePath,
        );
        // These rubrics add no project reading for C; users still receive a fresh-eyes critique from its fixed baseline context.
        const rubricsWithEmptyContextList = 7;

        // No matching empty lists means that guidance disappeared, so the missing count must fail this contract.
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
        /reference pack's complete Meta-audit rubric/u,
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
        // Show every missing audit rule in one failure so maintainers can restore the complete report-grading contract together.
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

  // A user receiving no findings still needs the same assessment and coverage evidence as a user receiving a list of defects.
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
        assert.doesNotMatch(
          directives,
          /returns this schema instead of findings/iu,
          referencePath,
        );
      },
    );
  });

  // Stable finding IDs let users trace coverage, hooks, and retractions to the same reported issue throughout a critique.
  // The shared evidence scale keeps HUMAN-PENDING visible when a finding still needs the user's verification.
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

  // Users need unread scope shown as a coverage gap; turning that gap into a HIGH finding would falsely block a clean artifact.
  it("reports goat-critique dimension coverage instead of manufacturing findings", () => {
    assertForEachTarget(installedSkillPaths("goat-critique"), (skillPath) => {
      const ranking = readMarkdownSection(
        skillPath,
        "Phase 2 - Rank and Compare",
      );
      assertMatchesAll(ranking, [/checked-clean/u, /unassessed/u], skillPath);
      assert.match(ranking, /Verify each Coverage-ledger scope/u, skillPath);
      assert.doesNotMatch(ranking, /`Rubric coverage:` entries/u, skillPath);
      assert.doesNotMatch(ranking, /auto-generate HIGH/iu, skillPath);
      assert.doesNotMatch(ranking, /optional . MEDIUM/iu, skillPath);
      assert.match(
        readProjectFile(skillPath),
        /never generates a HIGH/iu,
        skillPath,
      );
    });
    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-critique",
        "references/sub-agent-directives.md",
      ),
      (referencePath) => {
        const envelope = readMarkdownSection(referencePath, "Result envelope");
        assertMatchesAll(
          envelope,
          [
            /one row per selected dimension/iu,
            /full declared scope/iu,
            /within the same row/iu,
            /otherwise.*`unassessed`/iu,
            /unions verified inspected scopes/iu,
          ],
          referencePath,
        );
        assert.doesNotMatch(envelope, /remainder as its own `unassessed` row/u);
      },
    );
  });

  // The meta-agent grades a packet it is handed; every rule it applies has to travel inside that packet.
  it("makes the goat-critique meta packet carry the rules it grades against", () => {
    assertForEachTarget(installedSkillPaths("goat-critique"), (skillPath) => {
      const synthesis = readMarkdownSection(skillPath, "Phase 5 - Synthesise");
      assertMatchesAll(
        synthesis,
        [
          /Audit payload identity/u,
          /Final-finding schema/u,
          /complete Meta-audit rubric/u,
          /Packet vocabulary/u,
        ],
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
        assertMatchesAll(
          metaAudit,
          [
            /any CRITICAL gives BLOCK/iu,
            /HIGH without CRITICAL gives CONCERNS/iu,
            /otherwise CLEAN/u,
            /zero or multiple/iu,
            /incomplete inspection is not an artifact defect/iu,
            /Recommended action.*required only when.*warrants/isu,
            /omission.*does not fail check 2/iu,
          ],
          referencePath,
        );
      },
    );
  });

  // Explain why one critic's assessment is stronger so users can judge the comparison without an invented numerical ranking.
  it("defines evidence-based goat-critique ranking criteria at their routed owner", () => {
    assertForEachTarget(installedSkillPaths("goat-critique"), (skillPath) => {
      assert.match(
        readMarkdownSection(skillPath, "Phase 2 - Rank and Compare"),
        /reference pack's Ranking criteria/u,
        skillPath,
      );
    });
    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-critique",
        "references/sub-agent-directives.md",
      ),
      (referencePath) => {
        const criteria = readMarkdownSection(referencePath, "Ranking criteria");
        assertMatchesAll(
          criteria,
          [
            /Grounding.*evidence/iu,
            /Specificity.*scope/iu,
            /Actionability.*next step/iu,
            /Coverage.*verified/iu,
            /Calibration.*severity.*confidence/iu,
            /strong.*adequate.*limited.*Never sum/isu,
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

  // Show users the highest supported severity and the coverage gaps separately so they can judge what CLEAN establishes.
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
        /Phases 1-5, 5\.5 meta-audit, 5\.6 outcome capture, three critique sub-agents, one meta-agent[\s\S]+full delegated, Phases 1-5 plus 5\.5\/5\.6, three critique sub-agents plus one meta-agent/,
        skillPath,
      );
    });

    const acceptedDecision = readProjectFile(
      ".goat-flow/learning-loop/decisions/ADR-021-goat-critique-full-mode-only.md",
    );
    assert.match(
      acceptedDecision,
      /mandatory lifecycle is Phases 1-5 plus Phase 5\.5 meta-audit and Phase 5\.6 outcome capture[\s\S]+three isolated critique sub-agents[\s\S]+up to three cross-exam agents[\s\S]+one meta-agent/,
    );

    const publicSkills = readProjectFile("docs/skills.md");
    assert.match(publicSkills, /3 critique agents \(always\)/);
    assert.match(publicSkills, /up to 3 cross-exam agents \(conditional\)/);
    assert.match(publicSkills, /1 meta-agent \(always\)/);
    assert.match(publicSkills, /5\.5: Meta-audit; 5\.6: Outcome capture/);
    assert.match(publicSkills, /CLEAN means no surviving HIGH or CRITICAL/);
    assert.match(publicSkills, /recheck are additional agents/);

    const auditGuide = readProjectFile("docs/audit-and-quality.md");
    assert.match(auditGuide, /spawns at least 4 sub-agents if invoked/);
    assert.doesNotMatch(auditGuide, /spawns 3 sub-agents/);

    const setupGuide = readProjectFile("workflow/setup/03-install-skills.md");
    assert.match(setupGuide, /mandatory Phase 5\.5 meta-audit/);
    assert.match(setupGuide, /Phase 5\.6 outcome capture/);
    assert.match(setupGuide, /1 mandatory meta-agent/);
  });

  it("keeps goat-critique host-owned so human gates cannot auto-convert", () => {
    assertForEachTarget(installedSkillPaths("goat-critique"), (skillPath) => {
      const intake = readMarkdownSection(skillPath, "Step 0 - Intake");
      const synthesis = readMarkdownSection(skillPath, "Phase 5 - Synthesise");

      assertMatchesAll(
        intake,
        [
          /host\/root context owns Phases 1-5\.6/u,
          /forked sub-agent[\s\S]+return[\s\S]+before Phase 1/u,
          /does not apply the shared sub-agent gate conversion/u,
        ],
        skillPath,
      );
      assert.match(
        synthesis,
        /Phase 5\.5[\s\S]*Persist final:.*fresh `finalized` record.*Saved records and recovery[\s\S]*BLOCKING GATE[\s\S]*After the host receives the human's A\/B\/C\/D pick.*fresh linked `outcomes` record.*Saved records and recovery/u,
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
      const records = readMarkdownSection(
        skillPath.replace(/SKILL\.md$/u, "references/rubric-examples.md"),
        "Saved records and recovery",
      );
      assert.match(
        readMarkdownSection(skillPath, "Phase 4 - Clarify"),
        /keep.*Phase 1-3.*in memory.*fresh `pre-clarification` record.*Saved records and recovery.*Phase 3 early exit/isu,
        skillPath,
      );
      assertMatchesAll(
        records,
        [
          /stdin.*`goat-flow redact --output \.goat-flow\/logs\/critiques\/<YYYY-MM-DD>-<HHMM>-<artifact-slug>-<rand5>\.md`.*matching source CLI/isu,
          /only.*redactor.*destination bytes.*disk/isu,
          /unavailable.*redaction fails.*write nothing.*`persist-skipped: redactor-unavailable`.*continue.*human gate/isu,
        ],
        skillPath,
      );
      assert.doesNotMatch(
        records,
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
      // An explicit critique request already authorizes its reviewers, so none of these extra consent prompts may return.
      for (const forbiddenPrompt of [
        forbiddenCodexExceptionPattern,
        forbiddenCodexConsentPattern,
        forbiddenDelegationPromptPattern,
      ]) {
        assert.doesNotMatch(skillGuidance, forbiddenPrompt, skillPath);
      }
    });
  });

  it("keeps goat-critique report-only until explicit apply", () => {
    assertForEachTarget(installedSkillPaths("goat-critique"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assertMatchesAll(
        skillGuidance,
        [
          /Report-only by default/,
          /Do not mutate the target artifact/,
          /user separately says to apply, edit, update, fix/,
          /Recommendations are never auto-applied/,
          /After synthesis, stop/,
          /Do not enter implementation mode/,
          /freeze writes/,
        ],
        skillPath,
      );
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

    assertMatchesAll(
      dispatcherDocumentation,
      [
        /Explicit -->\|Yes\| Execute\["Load (?:named|target) skill's Step 0"\]/u,
        /Explicit skill invocations pass through immediately to the named skill's Step 0 without reclassification/u,
        /Multi-intent requests are split into numbered intents and routed separately/u,
        /Destination Step 0 selects unspecified depth/u,
        /applies its own rules to explicit requests/u,
        /Snapshot markers are not depth arguments/u,
        /direct execution records `not applicable`/u,
        /quality flow has no Route Snapshot/u,
      ],
      "docs/skills.md dispatcher invocation, intent order, and depth ownership",
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
