/**
 * Contracts for goat-security identity, compliance, Git, supply-chain, path, and reporting guidance.
 * Reads installed copies so user-visible drift fails regardless of the canonical source.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertForEachTarget,
  assertMatchesAll,
  installedSkillPaths,
  installedSkillReferencePaths,
  readMarkdownSection,
  readPresetPrompt,
  readPresetStringField,
  readProjectFile,
} from "./skill-hardening.helpers.js";

describe("skill hardening contracts: security (2/2)", () => {
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
          /applicable-control inventory.*global completeness gate.*one row per applicable control/iu,
          /compliant.*partially compliant.*non-compliant.*not assessed.*not applicable/u,
          /every disposition except `not assessed`.*current `OBSERVED` evidence.*applicable control authority/iu,
          /every disposition except `not assessed`.*exact assessed authority\/snapshot.*affected scope\/deployment.*mismatched.*unresolved.*`not assessed`.*`coverage-degraded`.*MUST NOT recommend clearance/isu,
          /`partially compliant`.*observed satisfied portions.*observed gap/iu,
          /`non-compliant`.*observed gap/iu,
          /mismatched.*unresolved.*inferred.*satisfaction.*gap.*applicability.*snapshot.*scope.*`not assessed`/iu,
          /MUST NOT claim certification/u,
          /Compliance output.*control identifier.*source.*status.*evidence.*gap/iu,
          /Compliance output.*evidence authority\/snapshot\/status\/proof-class.*scope\/deployment/iu,
          /Compliance output.*jurisdiction.*effective date/iu,
        ],
        skillPath,
      );
    });
    assertMatchesAll(
      readMarkdownSection("docs/skills.md", "/goat-security"),
      [
        /Quick.*shared Proof Gate/iu,
        /Compliance.*overlay.*Quick or Full/iu,
        /every disposition except `not assessed`.*current `OBSERVED` evidence.*applicable control authority/iu,
        /every disposition except `not assessed`.*exact assessed authority\/snapshot.*affected scope\/deployment.*mismatched.*unresolved.*`not assessed`.*coverage-degraded.*MUST NOT recommend clearance/isu,
        /Compliance rows.*evidence authority.*evidence status.*proof-class/iu,
        /Compliance rows.*authority\/snapshot.*scope\/deployment/iu,
        /authoritative applicable-control inventory.*independently verified complete.*one row per applicable control.*omitted.*unverifiably complete.*`not assessed`.*coverage-degraded.*MUST NOT recommend clearance/isu,
      ],
      "docs/skills.md",
    );
    assertMatchesAll(
      readPresetPrompt("compliance-check"),
      [
        /row for every supplied control.*not applicable/iu,
        /authoritative applicable-control inventory.*independently verified complete.*row for every applicable control.*omitted.*unverifiably complete.*not assessed.*coverage-degraded.*must not recommend clearance/isu,
        /compliant, partially compliant, non-compliant, not assessed, or not applicable/u,
        /every disposition except not assessed.*current observed evidence.*applicable control authority/iu,
        /every disposition except not assessed.*exact assessed authority\/snapshot.*affected scope\/deployment.*mismatched.*unresolved.*not assessed.*coverage-degraded.*must not recommend clearance/isu,
        /partially compliant.*observed satisfied portions.*observed gap/iu,
        /non-compliant.*observed gap/iu,
        /mismatched.*unresolved.*inferred.*satisfaction.*gap.*applicability.*snapshot.*scope.*not assessed/iu,
        /evidence authority\/snapshot.*scope\/deployment.*evidence status.*proof-class/iu,
        /Report.*jurisdiction.*effective date/iu,
        /do not claim certification/u,
      ],
      "dashboard preset compliance-check",
    );
    assert.match(
      readPresetPrompt("security"),
      /compliance row.*current observed evidence.*exact assessed authority\/snapshot.*affected scope\/deployment.*mismatched.*unresolved.*not assessed.*coverage-degraded.*withhold.*clearance/iu,
      "dashboard preset security compliance binding",
    );
    assert.match(
      readPresetPrompt("security"),
      /authoritative applicable-control inventory.*independently verified complete.*row per applicable control.*omitted.*unverifiably complete.*not assessed.*coverage-degraded.*withhold.*clearance/iu,
      "dashboard preset security compliance inventory",
    );
  });

  it("uses non-executing Git inspection and phase-aware persistence recovery", () => {
    assertForEachTarget(installedSkillPaths("goat-security"), (skillPath) => {
      assert.match(
        readMarkdownSection(skillPath, "Step 0 - Intake"),
        /Before any Git read.*common-threats.*non-executing profile/iu,
        skillPath,
      );
      assertMatchesAll(
        readProjectFile(skillPath),
        [
          /Bootstrap authority.*host.*pre-load.*skill.*mandatory references.*independently trusted.*immutable.*absolute installed source.*version\/digest.*assessed head\/worktree.*evidence only.*no load\/invocation\/clearance.*cannot self-authorize after load/isu,
          /apply.*common-threats.*non-executing Git inspection profile.*before.*Git/iu,
          /networked tools.*endpoint.*data.*credentials.*trusted configuration.*explicit authorization before submission.*effective destination/isu,
          /DNS\/redirects.*approved scope.*before forwarding.*stop\/re-authorize.*change/iu,
          /resolved address.*actual connected peer.*before application data.*every redirect\/retry.*mismatch.*stop\/re-authorize/iu,
          /before every tool invocation.*apply.*common-threats\.md.*untrusted-tool-input gate.*path.*ref.*anchor.*pattern.*snippet.*failure.*`UNVERIFIED`.*no-invocation/isu,
          /every local untrusted-artifact content read.*descriptor-anchored.*race-safe no-follow.*validated root.*post-open identity\/type.*bounded raw bytes.*MUST NOT import.*render.*execute.*invoke handlers.*otherwise.*`UNVERIFIED`/isu,
          /skill-local.*narrows.*durable-artifact convention.*MUST NOT use.*redact --output.*final/iu,
          /untrusted provenance.*MUST NOT use.*source-checkout redactor fallback.*independently trusted absolute installed binary.*`persist-skipped`/iu,
          /write approval.*MUST NOT satisfy.*target-controlled execution authorization/iu,
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
            /non-executing Git inspection profile.*GIT_NO_LAZY_FETCH=1.*--no-replace-objects.*--no-pager.*core\.fsmonitor=false.*--no-ext-diff.*--no-textconv/isu,
            /GIT_NO_LAZY_FETCH=1.*GIT_OPTIONAL_LOCKS=0.*git/iu,
            /trusted absolute Git binary.*clean, allowlisted environment.*clear every inherited `GIT_\*`/iu,
            /GIT_DIR.*GIT_WORK_TREE.*GIT_COMMON_DIR.*GIT_INDEX_FILE.*GIT_OBJECT_DIRECTORY.*GIT_ALTERNATE_OBJECT_DIRECTORIES.*GIT_EXEC_PATH.*GIT_CONFIG_/u,
            /GIT_CONFIG_NOSYSTEM=1.*GIT_CONFIG_GLOBAL=\/dev\/null/u,
            /before invoking Git.*non-Git.*repository config.*includes.*alternates/iu,
            /before invoking Git.*non-Git no-follow.*gitfile.*commondir.*resolved common directory.*bind.*--git-dir.*--work-tree/iu,
            /set `GIT_COMMON_DIR`.*independently resolved trusted absolute common directory/iu,
            /isolated read-only snapshot.*descriptor-anchored identity stability.*untrusted mutation.*throughout.*Git invocation.*`UNVERIFIED`.*Git MUST NOT run/iu,
            /resolved Git and common directories.*config.*includes.*alternates.*`UNVERIFIED`.*Git MUST NOT run/iu,
            /allowlisted non-executing plumbing/iu,
            /fixed allowlisted argv.*MUST NOT pass repo-controlled refs or options.*literal pathspec.*`--` before every untrusted path/iu,
            /MUST NOT pass repo-controlled data on Git stdin.*batch.*`-Z`.*full-format OIDs.*untrusted revision\/object expressions.*bounded output\/runtime.*response-to-object identity/iu,
            /every untrusted tool input.*path.*ref.*anchor.*pattern.*snippet.*fixed argv.*non-executing data channel.*literal mode.*`--`.*leading options.*bounded input\/output.*no shell interpolation.*`UNVERIFIED`.*MUST NOT invoke/isu,
            /every tool invocation.*bounded.*byte-safe.*non-rendering capture.*stdout.*stderr.*no PTY.*direct display.*parse.*identity-bind.*records.*render only.*canonically encoded fields.*otherwise.*withhold.*`UNVERIFIED`/isu,
            /every Git command emitting repo-controlled names\/paths.*NUL-delimited output.*byte-safe schema parsing.*record-to-object verification/iu,
            /signature verification.*configured helper.*target-controlled execution.*independently pinned helper.*Shared Pre-Probe Gate/iu,
            /core\.fsmonitor=false.*core\.hooksPath=\/dev\/null/iu,
            /pin.*--git-dir.*--work-tree.*independently validated/iu,
            /paths.*repository-local config.*alternates.*cannot be validated.*`UNVERIFIED`.*MUST NOT recommend clearance/iu,
            /MUST NOT run worktree-sensitive Git diff\/status.*attributes.*filter drivers.*independently neutralized/iu,
            /committed\/index objects.*fixed plumbing.*worktree bytes.*non-Git read-only primitives.*conversion-dependent.*`UNVERIFIED`/iu,
            /before every worktree content read.*no-follow.*classification/iu,
            /symlink.*link text\/object metadata only/iu,
            /escape.*validated worktree.*`UNVERIFIED`/iu,
            /descriptor-anchored.*race-safe.*no-follow.*open/iu,
            /post-open.*identity\/type/iu,
            /cannot be proven.*`UNVERIFIED`/iu,
            /every local untrusted-artifact content read.*descriptor-anchored.*race-safe no-follow.*validated root.*post-open identity\/type.*bounded raw bytes.*MUST NOT import.*render.*execute.*invoke handlers.*otherwise.*`UNVERIFIED`/isu,
            /MUST NOT checkout.*clean\/smudge.*fetch.*submodule.*LFS/iu,
            /missing objects.*`UNVERIFIED`.*MUST NOT fetch/iu,
            /verify.*inspected object bytes.*cited.*OID/iu,
          ],
          referencePath,
        );
      },
    );
    assertMatchesAll(
      readMarkdownSection("docs/skills.md", "/goat-security"),
      [
        /bootstrap authority.*invoking host.*before loading.*goat-security.*mandatory references.*independently trusted.*immutable.*absolute installed source.*version.*digest.*assessed head\/worktree.*evidence only.*withhold.*invocation.*clearance.*cannot establish.*own authority.*after load/isu,
        /trusted absolute Git binary.*clean, allowlisted environment.*inherited `GIT_\*`/iu,
        /worktree-sensitive Git diff\/status.*filters.*neutralized.*worktree bytes.*non-Git read-only/iu,
        /no-follow.*before every worktree content read.*symlink.*link text.*escape.*`UNVERIFIED`/iu,
        /descriptor-anchored.*race-safe.*no-follow.*post-open.*identity\/type.*`UNVERIFIED`/iu,
        /before invoking Git.*non-Git.*repository config.*includes.*alternates/iu,
        /before invoking Git.*non-Git no-follow.*gitfile.*commondir.*resolved common directory.*bind.*Git-dir.*work-tree/iu,
        /GIT_COMMON_DIR.*independently resolved trusted absolute common directory.*read-only snapshot.*identity stability.*untrusted mutation.*Git invocation/iu,
        /fixed allowlisted argv.*repo-controlled refs or options.*literal pathspec.*`--` before every untrusted path/iu,
        /Git stdin.*repo-controlled data.*batch.*`-Z`.*full-format OIDs.*untrusted revision\/object expressions.*bounded output\/runtime.*response-to-object identity/iu,
        /every Git command emitting repo-controlled names\/paths.*NUL-delimited output.*byte-safe schema parsing.*record-to-object verification/iu,
        /signature verification.*configured helper.*target-controlled execution.*independently pinned helper/iu,
        /untrusted provenance.*source-checkout redactor fallback.*independently trusted absolute installed binary.*persist-skipped/iu,
        /write approval.*target-controlled execution authorization/iu,
        /effective destination.*DNS\/redirects.*approved scope.*stop.*re-authoriz/iu,
        /resolved address.*actual connected peer.*before application data.*every redirect\/retry.*mismatch.*stop.*re-authoriz/iu,
        /every untrusted tool input.*path.*ref.*anchor.*pattern.*snippet.*fixed argv.*non-executing data channel.*literal mode.*`--`.*leading options.*bounded input\/output.*no shell interpolation.*`UNVERIFIED`.*MUST NOT invoke/isu,
        /every tool invocation.*bounded.*byte-safe.*non-rendering capture.*stdout.*stderr.*no PTY.*direct display.*parse.*identity-bind.*records.*render only.*canonically encoded fields.*otherwise.*withhold.*`UNVERIFIED`/isu,
        /every local untrusted-artifact content read.*descriptor-anchored.*race-safe no-follow.*validated root.*post-open identity\/type.*bounded raw bytes.*MUST NOT import.*render.*execute.*invoke handlers.*otherwise.*`UNVERIFIED`/isu,
      ],
      "docs/skills.md",
    );
    assertMatchesAll(
      readPresetPrompt("security"),
      [
        /bootstrap authority.*invoking host.*before loading.*goat-security.*mandatory references.*independently trusted.*immutable.*absolute installed source.*version.*digest.*assessed head\/worktree.*evidence only.*withhold.*invocation.*clearance.*cannot establish.*own authority.*after load/isu,
        /trusted absolute Git binary.*clean, allowlisted environment.*inherited GIT_\*/iu,
        /worktree-sensitive Git diff\/status.*filters.*neutralized.*worktree bytes.*non-Git read-only/iu,
        /no-follow.*before every worktree content read.*symlink.*link text.*escape.*UNVERIFIED/iu,
        /descriptor-anchored.*race-safe.*no-follow.*post-open.*identity\/type.*UNVERIFIED/iu,
        /before invoking Git.*non-Git.*repository config.*includes.*alternates/iu,
        /before invoking Git.*non-Git no-follow.*gitfile.*commondir.*resolved common directory.*bind.*git-dir.*work-tree/iu,
        /GIT_COMMON_DIR.*independently resolved trusted absolute common directory.*read-only snapshot.*identity stability.*untrusted mutation.*Git invocation/iu,
        /fixed allowlisted argv.*repo-controlled refs or options.*literal pathspec.*-- before every untrusted path/iu,
        /Git stdin.*repo-controlled data.*batch.*-Z.*full-format OIDs.*untrusted revision\/object expressions.*bounded output\/runtime.*response-to-object identity/iu,
        /every Git command emitting repo-controlled names\/paths.*NUL-delimited output.*byte-safe schema parsing.*record-to-object verification/iu,
        /signature verification.*configured helper.*target-controlled execution.*independently pinned helper/iu,
        /untrusted provenance.*source-checkout redactor fallback.*independently trusted absolute installed binary.*persist-skipped/iu,
        /write approval.*target-controlled execution authorization/iu,
        /effective destination.*DNS\/redirects.*approved scope.*stop.*re-authorize/iu,
        /resolved address.*actual connected peer.*before application data.*every redirect\/retry.*mismatch.*stop.*re-authorize/iu,
        /every untrusted tool input.*path.*ref.*anchor.*pattern.*snippet.*fixed argv.*non-executing data channel.*literal mode.*--.*leading options.*bounded input\/output.*no shell interpolation.*UNVERIFIED.*must not invoke/isu,
        /every tool invocation.*bounded.*byte-safe.*non-rendering capture.*stdout.*stderr.*no PTY.*direct display.*parse.*identity-bind.*records.*render only.*canonically encoded fields.*otherwise.*withhold.*UNVERIFIED/isu,
      ],
      "dashboard preset security",
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
          /Quick Scan output.*category-ledger.*baseline-name\/version.*family.*scanned.*skipped.*not-applicable.*not-assessed.*assessment-evidence.*authority\/snapshot.*evidence-status.*proof-class.*scope-evidence/iu,
          /Quick Scan output.*class applicability\/evidence/iu,
          /Quick Scan output.*pre-probe record.*tool\/run.*connectivity.*target effect.*target-controlled execution.*active-probing.*destination.*submitted data.*credentials.*authorization\/withheld/iu,
          /Quick Scan output.*file \+ semantic anchor.*authority.*entry→sink.*requirement gap.*recommended remediation.*proof-of-fix/iu,
          /Quick Scan output.*accepted risk.*identifier.*clause.*trusted policy source.*ref.*OID.*anchor.*independently trusted approval evidence.*owner.*named authorized approver.*rationale.*expiry.*scope/iu,
          /Quick Scan output.*Accepted risk:.*current status evidence.*review\/revocation trigger/isu,
          /Quick Scan output.*Accepted risk:.*status[- ]observation[- ]time/isu,
          /Quick Scan output.*Accepted risk:.*named status authority/isu,
          /up to three verified chains; state `none` when no chain survives/u,
          /evidence needed/u,
          /exception authority.*identifier.*clause.*trusted policy source.*ref.*OID.*anchor.*independently trusted approval evidence.*owner.*named authorized approver.*rationale.*expiry.*scope/iu,
          /exception authority.*current status evidence.*review\/revocation trigger/iu,
          /exception authority.*status[- ]observation[- ]time/iu,
          /exception authority.*named status authority/iu,
          /Baselines:.*name\/version.*currency evidence.*status/iu,
          /UNVERIFIED/u,
          /HUMAN-PENDING/u,
          /Positive observations.*claim.*exact assessed authority\/snapshot.*affected scope\/deployment\/path.*evidence status.*proof-class.*only current-session `OBSERVED` evidence.*bound to both.*proves applicability.*supports clearance.*`INFERRED`\/`UNVERIFIED`\/`HUMAN-PENDING`.*MUST NOT support clearance/isu,
          /Positive observations.*exact assessed authority\/snapshot.*affected scope\/deployment\/path.*current-session `OBSERVED` evidence.*stale.*mismatched.*unresolved.*MUST NOT support clearance/isu,
          /apply.*common-threats\.md.*untrusted-output gate.*before terminal\/Markdown output.*failure.*`UNVERIFIED`.*raw-omitted/isu,
          /Every Quick\/Full\/Compliance output.*one inventory-integrity row per authoritative assessment-driving inventory kind.*kind.*current-session `OBSERVED` completeness evidence.*evidence-authority\/snapshot\/status\/proof-class.*exact[- ]assessed[- ]authority\/snapshot\/scope\/deployment.*omissions.*stale.*mismatched.*missing.*unresolved.*`coverage-degraded`.*MUST NOT recommend clearance/isu,
          /Class-dispositions:.*class.*applicable.*not-applicable.*not-assessed.*scope\/deployment-evidence.*baseline-name\/version.*currency-evidence\/status/iu,
          /Category-ledger:.*baseline-name\/version.*family.*scanned.*skipped.*not-applicable.*not-assessed.*assessment-evidence.*authority\/snapshot.*evidence-status.*proof-class.*scope-evidence/iu,
        ],
        skillPath,
      );
      assertMatchesAll(
        readProjectFile(skillPath),
        [
          /Quick and Full.*zero-findings defence.*what was scanned.*surfaces.*why/iu,
          /material critical surface.*unassessed.*coverage-degraded.*MUST NOT recommend clearance/iu,
          /selected-baseline family.*skipped\/not-assessed.*coverage-degraded.*MUST NOT recommend clearance/iu,
          /redact.*fresh private temp(?:orary)?.*atomic exclusive.*publish/iu,
          /MUST NOT use.*overwrite-capable.*final[- ]path/iu,
          /write approval.*resolved destination.*race-safe.*no-follow parent traversal.*approved root.*`persist-skipped`/iu,
          /failure before.*publish.*`persist-skipped`/iu,
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
        assert.match(
          readProjectFile(referencePath),
          /before terminal\/Markdown output.*every untrusted report field.*paths.*anchors.*snippets.*inert.*canonical.*backticks.*Markdown.*newlines.*ANSI.*control.*bidi.*links.*images.*HTML.*renderer fetches.*handlers.*Failure.*`UNVERIFIED`.*omit raw bytes/isu,
          referencePath,
        );
        assert.match(
          readMarkdownSection(
            referencePath,
            "Positive observations worth calling out",
          ),
          /claim.*exact assessed authority\/snapshot.*affected scope\/deployment\/path.*evidence status.*proof-class.*only current-session `OBSERVED` evidence.*bound to both.*proves applicability.*supports clearance.*`INFERRED`\/`UNVERIFIED`\/`HUMAN-PENDING`.*MUST NOT support clearance/isu,
          referencePath,
        );
        assert.match(
          readMarkdownSection(
            referencePath,
            "Positive observations worth calling out",
          ),
          /exact assessed authority\/snapshot.*affected scope\/deployment\/path.*current-session `OBSERVED` evidence.*stale.*mismatched.*unresolved.*MUST NOT support clearance/isu,
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
        assert.match(
          readMarkdownSection(referencePath, "Positive observations"),
          /current-session `OBSERVED` evidence.*exact assessed authority\/snapshot.*affected scope\/deployment\/path.*stale.*mismatched.*unresolved.*MUST NOT support clearance/isu,
          referencePath,
        );
      },
    );
    assertMatchesAll(
      readPresetPrompt("security"),
      [
        /GIT_NO_LAZY_FETCH=1/u,
        /GIT_OPTIONAL_LOCKS=0/u,
        /pin.*--git-dir.*--work-tree/iu,
        /other\/unknown/iu,
        /currency-unverified.*not assessed.*coverage-degraded.*clearance/iu,
        /Quick output.*pre-probe record.*tool\/run.*connectivity.*target effect.*target-controlled execution.*active probing.*destination.*submitted data.*credentials.*authorization.*withheld/iu,
        /evidence needed/u,
        /accepted risk.*identifier.*clause.*trusted policy source.*ref.*OID.*anchor.*independently trusted approval evidence.*owner.*named authorized approver.*rationale.*expiry.*scope/iu,
        /accepted risk.*current status evidence.*review\/revocation trigger/iu,
        /accepted risk.*status observation time/iu,
        /before terminal\/Markdown output.*every untrusted report field.*paths.*anchors.*snippets.*inert.*canonical.*backticks.*Markdown.*newlines.*ANSI.*control.*bidi.*links.*images.*HTML.*renderer fetches.*handlers.*Failure.*UNVERIFIED.*omit raw bytes/isu,
        /every Quick\/Full\/Compliance output.*one inventory-integrity row per authoritative assessment-driving inventory kind.*kind.*current-session observed completeness evidence.*evidence authority\/snapshot\/status\/proof-class.*exact assessed authority\/snapshot\/scope\/deployment.*omissions.*stale.*mismatched.*missing.*unresolved.*coverage-degraded.*withholds? clearance/isu,
        /positive observations.*claim.*exact assessed authority\/snapshot.*affected scope\/deployment\/path.*evidence status.*proof-class.*only current-session observed evidence.*bound to both.*proves applicability.*supports clearance.*inferred.*unverified.*human-pending.*must not support clearance/iu,
        /positive observations.*exact assessed authority\/snapshot.*affected scope\/deployment\/path.*current-session observed evidence.*stale.*mismatched.*unresolved.*must not support clearance/isu,
        /Full output.*per-class disposition.*scope\/deployment evidence.*baseline name\/version.*currency evidence\/status/iu,
        /Quick and Full output.*category ledger.*family.*scanned.*skipped.*not applicable.*not assessed.*scope evidence/iu,
        /category ledger.*one row per family per selected baseline.*baseline name\/version.*assessment evidence.*authority\/snapshot.*evidence status.*proof-class.*scope evidence/iu,
        /scanned requires current-session observed evidence.*exact authority\/snapshot.*family coverage.*affected scope\/deployment.*not applicable requires current observed applicability evidence at scope authority.*mismatched.*unresolved.*inferred.*unverified.*human-pending.*not assessed.*coverage-degraded.*withholds clearance/iu,
        /every skipped row.*coverage-degraded.*withholds clearance/iu,
        /selected-baseline family.*skipped or not assessed.*coverage-degraded.*withholds clearance/iu,
        /authoritative baseline-family inventory.*independently verified complete.*row per family.*omitted.*unverifiably complete.*not assessed.*coverage-degraded.*withholds clearance/isu,
        /every local untrusted-artifact content read.*descriptor-anchored.*race-safe no-follow.*validated root.*post-open identity\/type.*bounded raw bytes.*must not import.*render.*execute.*invoke handlers.*otherwise.*unverified/isu,
        /framework-mitigated defaults.*current observed evidence.*declared authority.*affected path.*otherwise retain.*missing check.*non-clearance posture/iu,
      ],
      "dashboard preset security",
    );
    assertMatchesAll(
      readMarkdownSection("docs/skills.md", "/goat-security"),
      [
        /Quick output.*pre-probe record.*tool\/run.*connectivity.*target effect.*target-controlled execution.*active probing.*destination.*submitted data.*credentials.*authorization.*withheld/iu,
        /persistence.*resolved destination.*race-safe.*no-follow parent traversal.*approved root.*persist-skipped/iu,
        /positive observations.*claim.*exact assessed authority\/snapshot.*affected scope\/deployment\/path.*evidence status.*proof-class.*only current-session `OBSERVED` evidence.*bound to both.*proves applicability.*supports clearance.*`INFERRED`.*`UNVERIFIED`.*`HUMAN-PENDING`.*MUST NOT support clearance/iu,
        /positive observations.*exact assessed authority\/snapshot.*affected scope\/deployment\/path.*current-session `OBSERVED` evidence.*stale.*mismatched.*unresolved.*MUST NOT support clearance/isu,
        /before terminal\/Markdown output.*every untrusted report field.*paths.*anchors.*snippets.*inert.*canonical.*backticks.*Markdown.*newlines.*ANSI.*control.*bidi.*links.*images.*HTML.*renderer fetches.*handlers.*Failure.*`UNVERIFIED`.*omit raw bytes/isu,
        /every Quick\/Full\/Compliance output.*one inventory-integrity row per authoritative assessment-driving inventory kind.*kind.*current-session `OBSERVED` completeness evidence.*evidence authority\/snapshot\/status\/proof-class.*exact assessed authority\/snapshot\/scope\/deployment.*omissions.*stale.*mismatched.*missing.*unresolved.*coverage-degraded.*withholds? clearance/isu,
        /Full output.*per-class disposition.*scope\/deployment evidence.*baseline name\/version.*currency evidence\/status/iu,
        /Quick and Full output.*category ledger.*family.*scanned.*skipped.*not applicable.*not assessed.*scope evidence/iu,
        /category ledger.*one row per family per selected baseline.*baseline name\/version.*assessment evidence.*authority\/snapshot.*evidence status.*proof-class.*scope evidence/iu,
        /`scanned` requires current-session `OBSERVED` evidence.*exact authority\/snapshot.*family coverage.*affected scope\/deployment.*`not applicable` requires current `OBSERVED` applicability evidence at scope authority.*mismatched.*unresolved.*`INFERRED`.*`UNVERIFIED`.*`HUMAN-PENDING`.*`not assessed`.*coverage-degraded.*withholds clearance/iu,
        /every `skipped` row.*coverage-degraded.*withholds clearance/iu,
        /selected-baseline family.*skipped or not assessed.*coverage-degraded.*withholds clearance/iu,
        /authoritative baseline-family inventory.*independently verified complete.*one row per family.*omitted.*unverifiably complete.*`not assessed`.*coverage-degraded.*withholds clearance/isu,
        /every local untrusted-artifact content read.*descriptor-anchored.*race-safe no-follow.*validated root.*post-open identity\/type.*bounded raw bytes.*MUST NOT import.*render.*execute.*invoke handlers.*otherwise.*`UNVERIFIED`/isu,
        /framework-mitigated defaults.*current `OBSERVED` evidence.*declared authority.*affected path.*otherwise retain.*missing check.*non-clearance posture/iu,
      ],
      "docs/skills.md",
    );
    assert.match(
      readPresetStringField("security", "desc"),
      /Quick or full threat assessment/iu,
      "dashboard preset security description",
    );
    assert.equal(
      readProjectFile("dist/dashboard/preset-prompts.json"),
      readProjectFile("src/dashboard/preset-prompts.json"),
      "dashboard preset source/dist parity",
    );
  });
});
