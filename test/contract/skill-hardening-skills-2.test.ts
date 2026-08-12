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

function assertMatchesAll(
  content: string,
  patterns: readonly RegExp[],
  sourcePath: string,
): void {
  for (const pattern of patterns) {
    assert.match(content, pattern, `${sourcePath}: missing ${pattern}`);
  }
}

function readMarkdownSubsection(
  sectionBody: string,
  subsectionHeading: string,
  sourcePath: string,
): string {
  const marker = `### ${subsectionHeading}`;
  const start = sectionBody.indexOf(marker);
  assert.notEqual(start, -1, `${sourcePath} missing ${marker}`);
  const remainder = sectionBody.slice(start + marker.length);
  const nextHeading = remainder.search(/\n###\s+/u);
  return nextHeading === -1 ? remainder : remainder.slice(0, nextHeading);
}

// Keep preset-specific assertions from passing on matching text in an unrelated catalog entry.
function readPresetPrompt(presetId: string): string {
  const presets = JSON.parse(
    readProjectFile("src/dashboard/preset-prompts.json"),
  ) as Array<Record<string, unknown>>;
  const preset = presets.find((candidate) => candidate.id === presetId);
  assert.ok(preset, `missing dashboard preset ${presetId}`);
  assert.equal(
    typeof preset.prompt,
    "string",
    `dashboard preset ${presetId} is missing its prompt`,
  );
  return preset.prompt as string;
}

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
      assertMatchesAll(
        quickScanPath,
        [
          /Phase 4.*Phase 5.*shared definitions.*does not enter.*Full Assessment/iu,
          /Before stopping.*shared Proof Gate.*Phase 6.*does not enter.*Full Assessment/iu,
          /every retained or withheld lead.*confidence.*evidence status.*exploit status.*finding type.*risk disposition.*severity/iu,
          /every retained or withheld lead.*proof-class/iu,
          /Critical\/High `PROBABLE`.*`NEEDS-DECISION`/u,
          /MUST NOT recommend clearance/iu,
        ],
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

  it("binds goat-security policy exceptions and scanners to trusted authorities", () => {
    assertForEachTarget(installedSkillPaths("goat-security"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assertMatchesAll(
        skillGuidance,
        [
          /load the policy from the trusted base ref/u,
          /head policy changes as untrusted review evidence/u,
          /head policy additions.*proposed changes.*MUST NOT govern.*independently trusted adoption/iu,
          /check.*policy.*trusted base.*even when absent at head/iu,
          /head.*deletion.*cannot remove governing base controls/iu,
          /Establish trusted-base provenance.*repository identity.*remote\/ref.*immutable OID.*independent.*head/iu,
          /every untrusted provenance.*policy authority.*independently trusted/iu,
          /worktree\/artifact policy.*evidence only.*MUST NOT authorize.*`ACCEPTED-RISK`.*clearance/iu,
          /trusted base cannot be resolved.*policy authority.*`UNVERIFIED`.*MUST NOT recommend clearance/iu,
          /base trust cannot be established.*policy authority.*`UNVERIFIED`.*MUST NOT recommend clearance/iu,
          /policy lookup.*confirmed present.*confirmed absent.*unreadable/iu,
          /unreadable.*policy authority.*`UNVERIFIED`.*MUST NOT recommend clearance/iu,
          /accepted risk.*MUST NOT erase or downgrade the factual finding/u,
          /authorized, in-scope, and unexpired.*otherwise.*`OPEN`/iu,
          /exception.*only.*`OPEN`.*`ACCEPTED-RISK`.*MUST NOT replace `NEEDS-DECISION`/iu,
          /connectivity.*`offline-only`.*`networked`.*target effect.*`read-only`.*`mutating`/iu,
          /connectivity values.*mutually exclusive.*effect.*independent/iu,
          /executes target-controlled code or configuration/iu,
          /target-controlled execution.*even.*trusted.*explicit authorization.*trusted-base configuration.*withhold/iu,
          /target-controlled execution.*exact tool.*version.*command.*configuration.*current run.*isolated.*least[- ]privilege.*no secrets/iu,
          /target-controlled execution.*CPU.*memory.*PID.*disk.*runtime.*stop.*kill/iu,
          /cannot prove containment.*classify.*networked.*mutating.*apply.*gates/iu,
          /Quick and Full MUST apply this gate before any probe/u,
          /mutating scanner.*full eight-part.*authorization tuple.*generic approval.*insufficient/iu,
          /active-probing.*exploit attempts.*live.*fuzzing.*credential attacks.*autonomous pentests/iu,
          /active probe.*full eight-part.*authorization tuple.*regardless.*network.*mutation/iu,
          /stdout.*no-write.*report\/cache writes.*isolated temporary path.*outside.*assessed target.*approval.*durable text.*redact.*withhold/iu,
          /report\/cache writes.*operational output.*not target mutation/iu,
          /endpoint, submitted data, credentials, and trusted configuration/u,
          /explicit authorization before network submission/u,
          /lockfile-only.*does not prove no egress/iu,
          /MUST NOT install a missing scanner/u,
          /MUST NOT run audit `fix` modes/u,
        ],
        skillPath,
      );
    });

    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-security",
        "references/project-policy-template.md",
      ),
      (referencePath) => {
        const policyTemplate = readProjectFile(referencePath);
        assertMatchesAll(
          policyTemplate,
          [
            /exception owner, rationale, and expiry/u,
            /accepted-risk disposition, not a false-positive classification/u,
          ],
          referencePath,
        );
      },
    );
  });

  it("separates goat-security evidence, exploitability, type, disposition, and severity", () => {
    assertForEachTarget(installedSkillPaths("goat-security"), (skillPath) => {
      const fullAssessment = readMarkdownSection(
        skillPath,
        "Full Assessment Path",
      );
      const classification = readMarkdownSubsection(
        fullAssessment,
        "Phase 4 - Finding Classification",
        skillPath,
      );
      const severity = readMarkdownSubsection(
        fullAssessment,
        "Phase 5 - Severity, Review Posture, and Cross-Check",
        skillPath,
      );
      const chaining = readMarkdownSubsection(
        fullAssessment,
        "Phase 5.5 - Exploit Chaining",
        skillPath,
      );
      assertMatchesAll(
        classification,
        [
          /Evidence status:/u,
          /Exploit status:/u,
          /Finding type:/u,
          /Risk disposition:/u,
          /An observed control gap can be `CONFIRMED` with exploit status `NOT-APPLICABLE`/u,
          /`CONFIRMED` requires `OBSERVED`/u,
          /`UNVERIFIED` or `HUMAN-PENDING`.*MUST NOT be `CONFIRMED`/u,
        ],
        skillPath,
      );
      assertMatchesAll(
        severity,
        [
          /Critical\/High `CONFIRMED` \+ `OPEN`.*block/u,
          /Critical\/High `CONFIRMED` \+ `ACCEPTED-RISK`.*unchanged.*authorized governance.*MUST NOT call.*safe.*clear/iu,
          /Critical\/High `PROBABLE`.*`NEEDS-DECISION`/u,
          /MUST NOT recommend clearance while that evidence gap remains/u,
          /Control-gap severity.*realistic exploitability.*potential impact/iu,
        ],
        skillPath,
      );
      assertMatchesAll(
        chaining,
        [
          /compatible preconditions/u,
          /combined entry.*pivot.*impact/u,
          /preserve each component severity/u,
          /never add qualitative labels/u,
          /`DEMONSTRATED` or `REACHABLE`/u,
          /exclude `UNPROVEN`, `NOT-APPLICABLE`, and control-gap components/u,
        ],
        skillPath,
      );
      assert.doesNotMatch(chaining, /Low [+] Low to Critical/u, skillPath);
    });
  });

  it("covers versioned application and agentic threats plus every Git delta state", () => {
    assertForEachTarget(installedSkillPaths("goat-security"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assertMatchesAll(
        skillGuidance,
        [
          /Record each selected baseline name and version/u,
          /explicitly list applicable categories skipped/iu,
          /added.*modified.*deleted.*renamed.*mode\/type-changed.*symlink.*submodule/u,
          /deleted or renamed-away control.*trusted base-ref anchor/u,
          /binary\/unscannable.*attribute-suppressed/iu,
          /non-executing old\/new blob inspection/u,
          /unreadable high-risk blob.*MUST NOT recommend clearance/iu,
          /staged.*unstaged.*untracked/u,
          /separate `HEAD`, index, and worktree snapshots.*index blob.*staged.*worktree.*unstaged/iu,
          /submodule OID.*identity.*not safety/iu,
          /referenced content.*`UNVERIFIED`.*MUST NOT.*clearance/iu,
          /Git LFS.*external artifact pointer.*identity.*not reviewed content/iu,
          /symlink target.*trust boundary/iu,
          /required old\/base object.*unavailable.*`PROBABLE`.*`UNVERIFIED`.*`NEEDS-DECISION`.*MUST NOT recommend clearance/iu,
          /artifact authority.*source.*immutable digest.*member.*byte.*digest.*identity.*not trust.*safety/iu,
          /submodule.*old\/new OID.*identity only.*referenced content.*Critical\/High.*`PROBABLE`.*`UNVERIFIED`.*`NEEDS-DECISION`/iu,
        ],
        skillPath,
      );
    });
    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-security",
        "references/common-threats.md",
      ),
      (referencePath) => {
        assertMatchesAll(
          readProjectFile(referencePath),
          [
            /OWASP Top 10:2025/u,
            /OWASP API Security Top 10 2023/u,
            /injection/u,
            /cross-site scripting/u,
            /server-side request forgery/u,
            /unsafe deserialization/u,
            /cryptographic failures/u,
            /security misconfiguration/u,
            /logging and alerting failures/u,
            /exceptional conditions/u,
            /business-logic and resource abuse/u,
            /object-level.*property-level.*function-level authorization/iu,
            /sensitive business flows/u,
            /inventory.*version.*shadow endpoints/iu,
            /unsafe consumption of third-party APIs/u,
            /state-changing browser requests/iu,
            /CSRF token/u,
            /Origin.*Fetch Metadata.*SameSite/u,
            /SameSite.*not.*sole control/iu,
            /CORS.*distinct from CSRF/iu,
            /exact authorized origins/u,
            /reflect.*Origin/iu,
            /substring.*suffix/u,
            /credentials/u,
            /preflight.*not authorization/iu,
            /Vary: Origin/u,
            /postMessage.*event\.origin.*event\.source.*schema.*target origin.*sandbox.*framing/iu,
            /request (?:smuggling|desynchronization).*shared-cache poisoning.*framing.*path normalization.*forwarded.*authentication.*cache keys/iu,
            /binary\/unscannable.*attribute-suppressed/iu,
            /Retain.*control gap.*exact requirement.*evidence gap/iu,
            /affected version\/function.*reachable path.*positively disproven/iu,
            /untested or indeterminate.*`PROBABLE`.*`UNVERIFIED`.*`UNPROVEN`.*missing check/iu,
            /MUST NOT inherit.*advisory severity/iu,
          ],
          referencePath,
        );
      },
    );
    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-security",
        "references/supply-chain-and-cicd.md",
      ),
      (referencePath) => {
      assertMatchesAll(
        readProjectFile(referencePath),
          [
            /OWASP Agentic Top 10 2026/u,
            /goal hijack/u,
            /tool misuse/u,
            /identity and privilege abuse/u,
            /memory and context poisoning/u,
            /insecure inter-agent communication/u,
            /cascading failures/u,
            /human-agent trust exploitation/u,
            /rogue agents/u,
          ],
          referencePath,
        );
      },
    );
    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-security",
        "references/supply-chain-and-cicd.md",
      ),
      (referencePath) => {
        assertMatchesAll(
          readProjectFile(referencePath),
          [
            /Infrastructure, IaC, cloud, container, and orchestrator/u,
            /named provider\/project baseline.*`not assessed`/iu,
            /public exposure.*network boundar/iu,
            /IAM.*workload identity/iu,
            /secret.*state.*encryption/iu,
            /privileged.*root.*host mount.*capabilit/iu,
            /metadata.*network polic/iu,
            /destructive drift/iu,
          ],
          referencePath,
        );
      },
    );
  });

  it("covers project runtime classes and complementary LLM risks", () => {
    assertForEachTarget(installedSkillPaths("goat-security"), (skillPath) => {
      assertMatchesAll(
        readProjectFile(skillPath),
        [
          /inventory.*project.*runtime classes.*native.*mobile.*embedded.*GenAI.*LLM.*RAG/iu,
          /applicable class.*without.*named baseline.*`not assessed`.*`coverage-degraded`.*MUST NOT recommend clearance/iu,
          /native.*desktop.*mobile.*embedded.*unsafe.*FFI/iu,
          /generative AI.*LLM.*RAG.*model.*agent/iu,
        ],
        skillPath,
      );
    });
    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-security",
        "references/common-threats.md",
      ),
      (referencePath) => {
        assertMatchesAll(
          readProjectFile(referencePath),
          [
            /Native, desktop, mobile, embedded, and unsafe-code review/u,
            /integer.*overflow.*bounds.*use-after-free.*double-free.*data race/iu,
            /unsafe.*FFI.*ABI.*ownership.*lifetime/iu,
            /IPC.*deep link.*permission.*update signing.*local storage.*transport/iu,
          ],
          referencePath,
        );
      },
    );
    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-security",
        "references/supply-chain-and-cicd.md",
      ),
      (referencePath) => {
        assertMatchesAll(
          readProjectFile(referencePath),
          [
            /OWASP Top 10 for LLM Applications 2025/u,
            /prompt injection/u,
            /sensitive information disclosure/u,
            /data and model poisoning/u,
            /improper output handling/u,
            /system prompt leakage/u,
            /vector and embedding weaknesses/u,
            /misinformation/u,
            /unbounded consumption/u,
            /complementary.*Agentic/iu,
          ],
          referencePath,
        );
      },
    );
  });

  it("keeps goat-security identity preconditions and sensitive hashes calibrated", () => {
    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-security",
        "references/identity-and-data.md",
      ),
      (referencePath) => {
        assertMatchesAll(
          readProjectFile(referencePath),
          [
            /Authentication changes attacker preconditions; it does not make an unauthorized disclosure safe/u,
            /session fixation.*rotation/iu,
            /OIDC.*issuer.*audience.*nonce/u,
            /MFA.*recovery/iu,
            /cookie-authenticated.*CSRF/iu,
            /adaptive password hash/iu,
            /credential stuffing/u,
            /MFA bypass/iu,
            /Secure.*HttpOnly.*SameSite/u,
            /API key.*service account.*scope.*rotation/iu,
            /webhook.*signature.*freshness.*replay/iu,
            /password hashes.*remain sensitive/iu,
            /data classification.*minimization.*retention/iu,
          ],
          referencePath,
        );
      },
    );
  });

  it("makes goat-security compliance source-bound with complete dispositions", () => {
    assertForEachTarget(installedSkillPaths("goat-security"), (skillPath) => {
      assertMatchesAll(
        readMarkdownSection(skillPath, "Compliance Mode"),
        [
          /overlay on a selected Quick Scan or Full Assessment.*does not replace/iu,
          /map controls only after.*Proof Gate/iu,
          /authoritative clause or control source/u,
          /framework name and version/u,
          /jurisdiction, applicability, and effective date/u,
          /ask for it and keep affected controls `not assessed`/u,
        /every supplied control.*including.*not applicable/iu,
        /compliant.*partially compliant.*non-compliant.*not assessed.*not applicable/u,
          /MUST NOT claim certification/u,
          /Compliance output.*control identifier.*source.*status.*evidence.*gap/iu,
        ],
        skillPath,
      );
    });
    assertMatchesAll(
      readMarkdownSection("docs/skills.md", "/goat-security"),
      [
        /Quick.*shared Proof Gate/iu,
        /Compliance.*overlay.*Quick or Full/iu,
      ],
      "docs/skills.md",
    );
    assertMatchesAll(
      readPresetPrompt("compliance-check"),
      [
        /row for every supplied control.*not applicable/iu,
        /compliant, partially compliant, non-compliant, not assessed, or not applicable/u,
        /do not claim certification/u,
      ],
      "dashboard preset compliance-check",
    );
  });

  it("uses non-executing Git inspection and phase-aware persistence recovery", () => {
    assertForEachTarget(installedSkillPaths("goat-security"), (skillPath) => {
      assertMatchesAll(
        readProjectFile(skillPath),
        [
          /apply.*common-threats.*non-executing Git inspection profile.*before.*Git/iu,
          /skill-local.*narrows.*durable-artifact convention.*MUST NOT use.*redact --output.*final/iu,
          /failure before.*publish.*`persist-skipped`.*publish succeeds.*`persisted`.*cleanup fails.*`persisted-cleanup-pending`/isu,
        ],
        skillPath,
      );
    });
    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-security",
        "references/common-threats.md",
      ),
      (referencePath) => {
        assertMatchesAll(
          readProjectFile(referencePath),
          [
            /non-executing Git inspection profile.*`--no-replace-objects`.*`--no-pager`.*`core\.fsmonitor=false`.*`--no-ext-diff`.*`--no-textconv`/isu,
            /MUST NOT checkout.*clean\/smudge.*fetch.*submodule.*LFS/iu,
            /verify.*inspected object bytes.*cited.*OID/iu,
          ],
          referencePath,
        );
      },
    );
  });

  it("hardens supply-chain verification and binds active testing to exact scope", () => {
    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-security",
        "references/supply-chain-and-cicd.md",
      ),
      (referencePath) => {
        assertMatchesAll(
          readProjectFile(referencePath),
          [
            /full-length commit SHA or a verified immutable release/u,
            /artifact attestations/u,
            /SBOM/u,
            /OIDC trust/u,
            /cache poisoning/u,
            /self-hosted runner/u,
            /install or build-time execution does not require runtime reachability/u,
            /exact targets/u,
            /start, end, timezone, and allowed windows/u,
            /allowed and prohibited techniques/u,
            /rate, concurrency, and data limits/u,
            /credential boundaries/u,
            /emergency stop/u,
            /escalation contact/u,
            /authorization tuple changes, run the full gate again/u,
          ],
          referencePath,
        );
      },
    );
  });

  it("covers upload resource abuse and race-safe path handling", () => {
    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-security",
        "references/file-upload-and-paths.md",
      ),
      (referencePath) => {
        assertMatchesAll(
          readProjectFile(referencePath),
          [
            /post-decompression limits/u,
            /storage quotas/u,
            /download amplification/u,
            /server-generated random names/u,
            /antivirus, sandbox, or CDR/u,
            /CSRF protection/u,
            /outside the webroot or on a separate host/u,
            /symlink and TOCTOU races/u,
            /safe-open primitive/u,
          ],
          referencePath,
        );
      },
    );
  });

  it("gives goat-security distinct quick and full reporting contracts", () => {
    assertForEachTarget(installedSkillPaths("goat-security"), (skillPath) => {
      assertMatchesAll(
        readMarkdownSection(skillPath, "Output Format"),
        [
          /Quick Scan output/u,
          /Full Assessment output/u,
          /retained\/withheld leads.*severity.*risk disposition/u,
          /Quick Scan output.*confidence.*evidence status.*exploit status.*finding type.*severity.*risk disposition.*proof-class/iu,
          /Quick Scan output.*accepted risk.*exception.*clause.*owner.*rationale.*expiry.*scope/iu,
          /up to three verified chains; state `none` when no chain survives/u,
          /recommended remediation/u,
          /evidence needed/u,
          /exception authority.*clause.*owner.*rationale.*expiry.*scope/iu,
          /UNVERIFIED/u,
          /HUMAN-PENDING/u,
        ],
        skillPath,
      );
      assertMatchesAll(readProjectFile(skillPath), [
        /Quick and Full.*zero-findings defence.*what was scanned.*surfaces.*why/iu,
        /material critical surface.*unassessed.*coverage-degraded.*MUST NOT recommend clearance/iu,
        /posture-relevant applicable.*skipped.*coverage-degraded.*MUST NOT recommend clearance/iu,
        /redact.*fresh private temporary.*atomic exclusive.*publish.*MUST NOT.*directly.*final.*persist-skipped/iu,
      ], skillPath);
    });
    assertMatchesAll(
      readPresetPrompt("security"),
      [
        /evidence needed/u,
        /accepted risk.*exception.*clause.*owner.*rationale.*expiry.*scope/iu,
      ],
      "dashboard preset security",
    );
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
