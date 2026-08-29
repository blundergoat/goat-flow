/**
 * Contracts for goat-security quick-scan, specialist, policy, evidence, threat, and runtime guidance.
 * Reads installed copies so user-visible drift fails regardless of the canonical source.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findArtifact } from "../../src/cli/quality/skill-quality-content.js";
import { scoreArtifact } from "../../src/cli/quality/skill-quality-score.js";
import {
  assertForEachTarget,
  assertMatchesAll,
  installedSkillPaths,
  installedSkillReferencePaths,
  readMarkdownSection,
  readMarkdownSubsection,
  readPresetPrompt,
  readProjectFile,
} from "./skill-hardening.helpers.js";

describe("skill hardening contracts: security (1/2)", () => {
  it("loads full-depth conventions and every configured security reference", () => {
    assertForEachTarget(installedSkillPaths("goat-security"), (skillPath) => {
      assertMatchesAll(
        readMarkdownSection(skillPath, "Shared Conventions"),
        [/skill-preamble\.md/iu, /Full.*skill-conventions\.md/iu],
        skillPath,
      );
    });

    const projectRoot = process.cwd();
    const artifact = findArtifact(projectRoot, "skill:goat-security");
    assert.ok(artifact, "missing goat-security quality artifact");
    const report = scoreArtifact(projectRoot, artifact);
    assert.deepEqual(
      report.composedFrom,
      [
        "SKILL.md",
        "skill-preamble.md",
        "skill-conventions.md",
        "references/common-threats.md",
        "references/project-policy-template.md",
        "references/supply-chain-and-cicd.md",
        "references/identity-and-data.md",
        "references/file-upload-and-paths.md",
      ],
      "goat-security quality composition must match the context its runtime instructions load",
    );
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
          /Before step 1.*read.*`references\/common-threats\.md`.*`references\/supply-chain-and-cicd\.md`/isu,
          /`references\/identity-and-data\.md`.*identity.*authentication.*authorization.*session.*secret.*data/isu,
          /`references\/file-upload-and-paths\.md`.*upload.*path.*archive/isu,
          /applicable reference.*unavailable.*`not assessed`.*`coverage-degraded`.*MUST NOT recommend clearance/isu,
          /Phase 4.*Phase 5.*shared definitions.*does not enter.*Full Assessment/iu,
          /Before stopping.*shared Proof Gate.*Phase 6.*does not enter.*Full Assessment/iu,
          /every retained or withheld lead.*confidence.*evidence status.*exploit status.*finding type.*risk disposition.*severity/iu,
          /every retained or withheld lead.*proof-class/iu,
          /every retained or withheld lead.*file \+ semantic anchor.*authority.*entry→sink.*requirement gap.*recommended remediation.*proof-of-fix/iu,
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

  it("admits an early target read only for trusted explicit-component Quick scans", () => {
    assertForEachTarget(installedSkillPaths("goat-security"), (skillPath) => {
      const intake = readMarkdownSection(skillPath, "Step 0 - Intake");
      const earlyRead = intake.indexOf("Trusted explicit-component Quick");
      const exhaustiveInventory = intake.indexOf(
        "Inventory every project/runtime class",
      );

      assert.ok(
        earlyRead >= 0,
        `${skillPath}: missing trusted early-read lane`,
      );
      assert.ok(
        earlyRead < exhaustiveInventory,
        `${skillPath}: bounded target evidence must precede exhaustive inventory`,
      );
      assertMatchesAll(
        intake,
        [
          /trusted explicit-component Quick.*bounded, non-executing, non-rendering, no-follow.*target and adjacent-boundary read.*before exhaustive inventory/isu,
          /MUST NOT use Git, import code, load plugins, execute configuration, or run a scanner/iu,
          /unknown or untrusted provenance.*repo-wide.*unresolved path containment.*ambiguous applicability.*fail.*exhaustive/isu,
          /No lead may be retained, severity assigned, zero-findings result declared, or clearance recommended until.*mandatory references.*inventory.*baseline.*family rows.*complete/isu,
        ],
        skillPath,
      );
    });
  });

  it("keeps goat-security quality composition complete", () => {
    const projectRoot = process.cwd();
    const artifact = findArtifact(projectRoot, "skill:goat-security");
    assert.ok(artifact, "missing goat-security quality artifact");
    const report = scoreArtifact(projectRoot, artifact);
    assert.doesNotMatch(
      report.fitNotes.join("\n"),
      /composition truncated/iu,
      "goat-security quality composition must include its full configured context",
    );
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
    // Step 0 keeps the exception outcome rules inline and points at the reference for the
    // field, approval, and status validation an agent runs only when an exception exists.
    assertForEachTarget(installedSkillPaths("goat-security"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assertMatchesAll(
        readMarkdownSection(skillPath, "Step 0 - Intake"),
        [
          /Policy exception: validate every field, approval, and status per `references\/project-policy-template\.md` \(search: `Validation during assessment`\) before honouring it/u,
          /mismatch.*unverifiable.*identity.*role.*binding.*retain.*`OPEN`/iu,
        ],
        skillPath,
      );
      assertMatchesAll(
        skillGuidance,
        [
          /load the policy from the trusted base ref/u,
          /head policy changes as untrusted review evidence/iu,
          /head policy additions.*proposed changes.*MUST NOT govern.*independently trusted adoption/iu,
          /check.*policy.*trusted base.*even when absent at head/iu,
          /head.*deletion.*cannot remove governing base controls/iu,
          /Establish trusted-base provenance.*repository identity.*remote\/ref.*immutable OID.*independent.*head/iu,
          /every untrusted provenance.*independently trusted policy authority/iu,
          /worktree\/artifact policy.*evidence only.*MUST NOT authorize.*`ACCEPTED-RISK`.*clearance/iu,
          /trusted base cannot be resolved.*policy authority.*`UNVERIFIED`.*MUST NOT recommend clearance/iu,
          /base trust cannot be established.*policy authority.*`UNVERIFIED`.*MUST NOT recommend clearance/iu,
          /policy lookup.*confirmed present.*confirmed absent.*unreadable/iu,
          /unreadable.*policy authority.*`UNVERIFIED`.*MUST NOT recommend clearance/iu,
          /accepted risk.*MUST NOT erase\/downgrade factual[- ]finding.*evidence.*exploit[- ]status.*severity/iu,
          /exception.*identifier.*trusted policy source.*ref.*OID.*anchor.*approval evidence.*owner.*rationale.*expiry.*scope/iu,
          /mismatch.*unverifiable.*identity.*role.*binding.*retains.*`OPEN`/iu,
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
          /endpoint.*data.*credentials.*trusted configuration/u,
          /explicit authorization before.*submission/u,
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
        const acceptedRiskRecords = readMarkdownSection(
          referencePath,
          "Accepted-risk records",
        );
        assertMatchesAll(
          policyTemplate,
          [/accepted-risk disposition, not a false-positive classification/u],
          referencePath,
        );
        // The assessment-time validation rules moved here from Step 0 (Validation during
        // assessment); the section still owns the record shape a policy author fills in.
        assertMatchesAll(
          acceptedRiskRecords,
          [
            /### Validation during assessment/u,
            /exception.*identifier.*trusted[- ]policy[- ]source.*ref.*OID.*anchor.*named[- ]authorized[- ]approver.*independently[- ]trusted[- ]approval[- ]evidence.*owner.*rationale.*expiry.*verified[- ]scope[- ]match/iu,
            /Validity:.*authorized.*in-scope.*unexpired.*independently trusted evidence.*authenticat.*named approver.*policy-authorized role.*approval.*bind.*identifier.*clause\/decision.*exact[- ]scope.*expiry.*review\/revocation[- ]trigger[- ]definition.*governing[- ]trusted[- ]policy[- ]source\/ref\/OID\/anchor/iu,
            /mismatch.*unverifiable.*identity.*role.*binding.*retain.*`OPEN`/iu,
            /current independently trusted status evidence.*bind.*identifier.*governing[- ]trusted[- ]policy[- ]source\/ref\/OID\/anchor.*approved[- ]review\/revocation[- ]trigger.*exact[- ]assessed[- ]authority\/snapshot\/deployment.*observation[- ]time.*prove.*active.*not.revoked.*no[- ]trigger[- ]fired.*unresolved.*mismatched.*status.*retains `OPEN`/isu,
            /current independently trusted status evidence.*named[- ]status[- ]authority.*authenticat.*status authority.*governing policy.*authorized.*attest.*lifecycle\/revocation status.*observation[- ]time/isu,
            /approval.*status.*governing trusted policy authority.*cross-record mismatch.*retains `OPEN`/isu,
            /converts only `OPEN` to `ACCEPTED-RISK`.*MUST NOT replace `NEEDS-DECISION`.*accepted risk MUST NOT erase\/downgrade factual-finding.*evidence.*exploit-status.*severity/iu,
            /stable exception identifier/iu,
            /trusted policy source\/ref\/OID\/anchor/iu,
            /named authorized approver/iu,
            /independently trusted approval evidence/iu,
            /exception owner/iu,
            /rationale/iu,
            /expiry/iu,
            /verified scope match/iu,
            /approval evidence.*authenticate.*named approver.*bind.*identifier.*clause\/decision.*scope.*expiry/iu,
            /trusted.*evidence.*named approver.*policy-authorized role.*approval time/iu,
            /approval evidence.*bind.*review\/revocation trigger definition.*governing trusted policy source\/ref\/OID\/anchor/iu,
            /current independently trusted status evidence.*bind.*identifier.*governing trusted policy source\/ref\/OID\/anchor.*approved review\/revocation trigger.*exact assessed authority\/snapshot\/deployment.*observation time.*prove.*active.*not revoked.*no trigger fired/isu,
            /named status authority.*status evidence.*authenticate.*status authority.*governing policy.*authorized.*attest.*lifecycle\/revocation status.*observation time/isu,
            /revoked.*trigger-fired.*status-unverified.*`OPEN`/iu,
            /approval.*status.*policy[- ]authority.*mismatch.*`OPEN`/iu,
            /mismatch.*unverifiabl.*bound.*`OPEN`/iu,
          ],
          referencePath,
        );
      },
    );
    assert.match(
      readMarkdownSection("docs/skills.md", "/goat-security"),
      /approval evidence.*authenticate.*named approver.*policy-authorized role.*approval time.*bind.*identifier.*clause\/decision.*scope.*expiry/iu,
      "docs/skills.md",
    );
    assert.match(
      readPresetPrompt("security"),
      /approval evidence.*authenticate.*named approver.*policy-authorized role.*approval time.*bind.*identifier.*clause\/decision.*scope.*expiry/iu,
      "dashboard preset security",
    );
    assert.match(
      readMarkdownSection("docs/skills.md", "/goat-security"),
      /approval evidence.*bind.*review\/revocation trigger definition.*governing trusted policy source\/ref\/OID\/anchor/iu,
      "docs/skills.md exception trigger binding",
    );
    assert.match(
      readPresetPrompt("security"),
      /approval evidence.*bind.*review\/revocation trigger definition.*governing trusted policy source\/ref\/OID\/anchor/iu,
      "dashboard preset security exception trigger binding",
    );
    assert.match(
      readMarkdownSection("docs/skills.md", "/goat-security"),
      /current independently trusted evidence.*bind.*identifier.*governing trusted policy source\/ref\/OID\/anchor.*approved review\/revocation trigger.*exact assessed authority\/snapshot\/deployment.*observation time.*prove.*exception.*active.*not revoked.*no trigger fired.*unresolved.*mismatched.*status.*retains `OPEN`/isu,
      "docs/skills.md exception status",
    );
    assert.match(
      readPresetPrompt("security"),
      /current independently trusted evidence.*bind.*identifier.*governing trusted policy source\/ref\/OID\/anchor.*approved review\/revocation trigger.*exact assessed authority\/snapshot\/deployment.*observation time.*prove.*exception.*active.*not revoked.*no trigger fired.*unresolved.*mismatched.*status.*retains OPEN/isu,
      "dashboard preset security exception status",
    );
    assert.match(
      readMarkdownSection("docs/skills.md", "/goat-security"),
      /current independently trusted evidence.*named status authority.*authenticate.*status authority.*governing policy.*authorized.*attest.*lifecycle\/revocation status.*observation time/isu,
      "docs/skills.md exception status authority",
    );
    assert.match(
      readPresetPrompt("security"),
      /current independently trusted evidence.*named status authority.*authenticate.*status authority.*governing policy.*authorized.*attest.*lifecycle\/revocation status.*observation time/isu,
      "dashboard preset security exception status authority",
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
          /every assessment mode.*map posture/iu,
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
          /For each applicable class.*record.*named\/versioned baseline/iu,
          /one row per family per selected baseline.*baseline-name\/version.*family.*scanned.*skipped.*not-applicable.*not-assessed.*assessment-evidence.*authority\/snapshot.*evidence-status.*proof-class.*scope-evidence/iu,
          /`scanned` requires current-session `OBSERVED` evidence.*exact authority\/snapshot.*family coverage.*affected scope\/deployment.*`not-applicable` requires current `OBSERVED` applicability evidence at scope authority.*mismatched.*unresolved.*`INFERRED`.*`UNVERIFIED`.*`HUMAN-PENDING`.*`not-assessed`.*`coverage-degraded`.*MUST NOT recommend clearance/isu,
          /`scanned`.*evidence.*prove.*family coverage.*exact authority\/snapshot.*affected scope\/deployment|`scanned`.*evidence.*exact authority\/snapshot.*proving family coverage.*affected scope\/deployment/iu,
          /every `skipped` row.*`coverage-degraded`.*MUST NOT recommend clearance/iu,
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
            /application and API surfaces.*select both baselines.*separate currency evidence\/status/iu,
            /omitting either.*`not assessed`.*`coverage-degraded`/iu,
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
            /every baseline family.*scanned.*skipped.*not applicable.*not assessed.*scope evidence/iu,
            /authoritative baseline-family inventory.*independently verified complete.*one row per family.*omitted.*unverifiably complete.*`not assessed`.*`coverage-degraded`.*MUST NOT recommend clearance/isu,
            /one row per family per selected baseline.*baseline-name\/version.*assessment-evidence.*authority\/snapshot.*evidence-status.*proof-class.*scope-evidence/iu,
            /`scanned` requires current-session `OBSERVED` evidence.*exact authority\/snapshot.*family coverage.*affected scope\/deployment.*`not-applicable` requires current `OBSERVED` applicability evidence at scope authority.*mismatched.*unresolved.*`INFERRED`.*`UNVERIFIED`.*`HUMAN-PENDING`.*`not-assessed`.*`coverage-degraded`.*MUST NOT recommend clearance/isu,
            /`scanned`.*evidence.*prove.*family coverage.*exact authority\/snapshot.*affected scope\/deployment|`scanned`.*evidence.*exact authority\/snapshot.*proving family coverage.*affected scope\/deployment/iu,
            /every `skipped` row.*`coverage-degraded`.*MUST NOT recommend clearance/iu,
            /Retain.*control gap.*exact requirement.*evidence gap/iu,
            /framework-mitigated defaults.*current `OBSERVED` evidence.*declared authority.*affected path.*otherwise retain.*missing check.*non-clearance posture/iu,
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
            /every applicable layer.*separate named\/versioned baseline.*currency evidence\/status/iu,
            /omitted applicable layer.*`not assessed`.*`coverage-degraded`/iu,
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
    assert.match(
      readMarkdownSection("docs/skills.md", "/goat-security"),
      /application and API surfaces.*both baselines.*separate currency evidence\/status/iu,
      "docs/skills.md",
    );
    assert.match(
      readPresetPrompt("security"),
      /application and API surfaces.*both baselines.*separate currency evidence\/status/iu,
      "dashboard preset security",
    );
  });

  it("covers project runtime classes and complementary LLM risks", () => {
    assertForEachTarget(installedSkillPaths("goat-security"), (skillPath) => {
      assertMatchesAll(
        readMarkdownSection(skillPath, "Step 0 - Intake"),
        [
          /every project\/runtime class.*applicable.*not applicable.*not assessed.*scope\/deployment evidence/iu,
          /every authoritative assessment-driving inventory.*project\/deployments.*assets.*entry[- ]points.*flows\/stores.*trust[- ]boundaries.*critical[- ]surfaces.*runtime[- ]classes.*baseline[- ]families.*applicable[- ]controls.*independent completeness proof.*omitted.*unverifiably[- ]complete.*`not assessed`.*`coverage-degraded`.*MUST NOT recommend clearance/isu,
          /every authoritative assessment-driving inventory.*critical[- ]surfaces.*attackers.*assumptions.*expected[- ]security[- ]controls.*runtime[- ]classes/isu,
          /unresolved or inferred applicability.*`not assessed`.*`coverage-degraded`.*MUST NOT recommend clearance/iu,
          /baseline identity.*currency.*independently trusted authoritative source/iu,
          /target\/head.*baseline.*currency claims.*evidence only/iu,
          /authority-unverified.*baseline.*`not assessed`.*`coverage-degraded`.*MUST NOT recommend clearance/iu,
        ],
        skillPath,
      );
      assertMatchesAll(
        readProjectFile(skillPath),
        [
          /inventory.*project.*runtime class.*native.*mobile.*embedded.*GenAI.*LLM.*RAG/iu,
          /Inventory.*project\/runtime class.*other\/unknown/iu,
          /missing, stale, or currency-unverified.*baseline.*`not assessed`.*`coverage-degraded`.*MUST NOT recommend clearance/iu,
          /native.*desktop.*mobile.*embedded.*unsafe.*FFI/iu,
          /generative AI.*LLM.*RAG.*model.*agent/iu,
          /non-generative ML\/model.*`references\/supply-chain-and-cicd\.md`/iu,
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
            /Non-generative ML and model baseline/u,
            /named.*authoritative.*complementary baseline/iu,
            /adversarial evasion.*model extraction.*model inversion.*membership inference.*poisoning/iu,
            /every applicable layer.*IaC.*provider\/cloud.*container.*orchestrator.*separate named\/versioned baseline.*currency evidence\/status/iu,
            /omitted applicable layer.*`not assessed`.*`coverage-degraded`.*MUST NOT recommend clearance/iu,
          ],
          referencePath,
        );
      },
    );
    assert.match(
      readMarkdownSection("docs/skills.md", "/goat-security"),
      /every applicable infrastructure layer.*separate named\/versioned baseline.*currency evidence\/status/iu,
      "docs/skills.md",
    );
    assert.match(
      readPresetPrompt("security"),
      /every applicable infrastructure layer.*separate named\/versioned baseline.*currency evidence\/status/iu,
      "dashboard preset security",
    );
    assert.match(
      readMarkdownSection("docs/skills.md", "/goat-security"),
      /baseline identity.*currency.*independently trusted authoritative source.*target\/head.*evidence only/iu,
      "docs/skills.md",
    );
    assert.match(
      readPresetPrompt("security"),
      /baseline identity.*currency.*independently trusted authoritative source.*target\/head.*evidence only/iu,
      "dashboard preset security",
    );
    assert.match(
      readMarkdownSection("docs/skills.md", "/goat-security"),
      /non-generative ML.*adversarial evasion.*model extraction.*membership inference.*poisoning/iu,
      "docs/skills.md",
    );
    assert.match(
      readPresetPrompt("security"),
      /non-generative ML.*adversarial evasion.*model extraction.*membership inference.*poisoning/iu,
      "dashboard preset security",
    );
    assert.match(
      readMarkdownSection("docs/skills.md", "/goat-security"),
      /every runtime class.*applicable.*not applicable.*not assessed.*scope\/deployment evidence.*unresolved or inferred applicability.*not assessed.*coverage-degraded.*clearance/iu,
      "docs/skills.md",
    );
    assert.match(
      readMarkdownSection("docs/skills.md", "/goat-security"),
      /authoritative project\/deployment inventory.*independently verified complete.*omitted.*unverifiably complete.*`not assessed`.*coverage-degraded.*withholds clearance/isu,
      "docs/skills.md runtime inventory completeness",
    );
    assert.match(
      readMarkdownSection("docs/skills.md", "/goat-security"),
      /every authoritative assessment-driving inventory.*project\/deployments.*assets.*entry points.*flows\/stores.*trust boundaries.*critical surfaces.*runtime classes.*baseline families.*applicable controls.*independently verified complete.*omitted.*unverifiably complete.*`not assessed`.*coverage-degraded.*withholds? clearance/isu,
      "docs/skills.md assessment-driving inventory completeness",
    );
    assert.match(
      readMarkdownSection("docs/skills.md", "/goat-security"),
      /every authoritative assessment-driving inventory.*critical surfaces.*attackers.*assumptions.*expected security controls.*runtime classes/isu,
      "docs/skills.md threat-model inventory completeness",
    );
    assert.match(
      readPresetPrompt("security"),
      /every runtime class.*applicable.*not applicable.*not assessed.*scope\/deployment evidence.*unresolved or inferred applicability.*not assessed.*coverage-degraded.*clearance/iu,
      "dashboard preset security",
    );
    assert.match(
      readPresetPrompt("security"),
      /authoritative project\/deployment inventory.*independently verified complete.*omitted.*unverifiably complete.*not assessed.*coverage-degraded.*withholds clearance/isu,
      "dashboard preset runtime inventory completeness",
    );
    assert.match(
      readPresetPrompt("security"),
      /every authoritative assessment-driving inventory.*project\/deployments.*assets.*entry points.*flows\/stores.*trust boundaries.*critical surfaces.*runtime classes.*baseline families.*applicable controls.*independently verified complete.*omitted.*unverifiably complete.*not assessed.*coverage-degraded.*withholds? clearance/isu,
      "dashboard preset assessment-driving inventory completeness",
    );
    assert.match(
      readPresetPrompt("security"),
      /every authoritative assessment-driving inventory.*critical surfaces.*attackers.*assumptions.*expected security controls.*runtime classes/isu,
      "dashboard preset threat-model inventory completeness",
    );
  });
});
