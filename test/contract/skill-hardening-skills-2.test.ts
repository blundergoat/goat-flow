/**
 * Contracts for the remaining user-invocable skills and the router that selects them.
 * Grouped because each is small alone but shares the same install-mirror rules.
 *
 * Reads the installed copies rather than sources, so a contract fails when the guidance a user
 * actually receives drifts - not merely when the template does.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertForEachTarget,
  forbiddenCodexConsentPattern,
  forbiddenCodexExceptionPattern,
  forbiddenDelegationPromptPattern,
  installedSkillPaths,
  installedSkillReferencePaths,
  readMarkdownSection,
  readProjectFile,
  INSTALLED_SKILL_ROOTS,
} from "./skill-hardening.helpers.js";

describe("skill hardening contracts: debug, qa, critique, security, dispatcher (2/2)", () => {
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
          "### Standard mode - Phase 3 output (generate only after Phase 2 gate approval)";
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
      "Rec-changes actionability",
      "No orphan retractions",
      "No contradictory findings",
      "Top-blockers traceability",
      "Severity calibration internal consistency",
      "Integration-hooks 1:1 with findings",
      "Blind-spot-check non-empty",
    ];

    assertForEachTarget(installedSkillPaths("goat-critique"), (skillPath) => {
      const synthesis = readMarkdownSection(skillPath, "Phase 5 - Synthesise");
      assert.match(
        synthesis,
        /10 checks in `references\/rubric-examples\.md`/u,
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

  /*
   * A user receiving a 100/100 critique still sees what the meta-audit found.
   * The clean attestation keeps the required section honest and non-empty.
   */
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
        /one objective, structured return, 5-call budget/,
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

  it("keeps goat-security Quick Scan out of Full-only specialist work", () => {
    assertForEachTarget(installedSkillPaths("goat-security"), (skillPath) => {
      const quickScanPath = readMarkdownSection(skillPath, "Quick Scan Path");
      const fullAssessmentPath = readMarkdownSection(
        skillPath,
        "Full Assessment Path",
      );
      assert.match(quickScanPath, /Stop after step 5/, skillPath);
      assert.match(
        quickScanPath,
        /MUST NOT enter the Full Assessment Path/,
        skillPath,
      );
      assert.match(
        quickScanPath,
        /recommend Full Assessment instead of running or waiting for a specialist/,
        skillPath,
      );
      assert.match(
        fullAssessmentPath,
        /Full Assessment-only specialist cross-check/,
        skillPath,
      );
    });
  });

  it("defines goat-security specialist admission and unavailable fallback", () => {
    assertForEachTarget(installedSkillPaths("goat-security"), (skillPath) => {
      const fullAssessmentPath = readMarkdownSection(
        skillPath,
        "Full Assessment Path",
      );
      assert.match(
        fullAssessmentPath,
        /An admissible specialist is an independent tool or reviewer with a named failure class and structured return/,
        skillPath,
      );
      assert.match(
        fullAssessmentPath,
        /Same-context self-review does not qualify/,
        skillPath,
      );
      assert.match(
        fullAssessmentPath,
        /invocation is already authorized by current-session user intent or local instructions/,
        skillPath,
      );
      assert.match(
        fullAssessmentPath,
        /record `specialist-unavailable`; do not wait or block/,
        skillPath,
      );
      assert.match(
        fullAssessmentPath,
        /Preserve each affected candidate's current confidence: retain `CONFIRMED` findings/,
        skillPath,
      );
      assert.match(
        fullAssessmentPath,
        /Only unresolved candidates remain `PROBABLE` with the exact evidence needed/,
        skillPath,
      );
      assert.match(
        fullAssessmentPath,
        /Outcomes: `retain CONFIRMED`, `promote to CONFIRMED`, `keep as PROBABLE`, or `kill as false positive`/,
        skillPath,
      );
      assert.doesNotMatch(
        fullAssessmentPath,
        /Keep each affected candidate `PROBABLE`/,
        skillPath,
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

  it("documents distinct dispatcher endpoints for inferred skills and direct execution", () => {
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
    assert.doesNotMatch(
      skillsDocumentation,
      /Snapshot --> Execute(?:\s|$)/u,
      "a shared endpoint collapses direct execution into skill loading",
    );
  });
});
