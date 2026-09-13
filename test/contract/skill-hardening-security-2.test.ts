/**
 * Check the security workflow guidance users receive across supported agent integrations.
 *
 * These contracts inspect canonical and installed instructions for the evidence, coverage, and reporting each mode requires.
 * Use them when changing security review modes, trust boundaries, or required disclosures.
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
    // Selecting Compliance Mode loads the policy reference's mapping rules after the review's Proof Gate.
    assertForEachTarget(installedSkillPaths("goat-security"), (skillPath) => {
      assertMatchesAll(
        readMarkdownSection(skillPath, "Compliance Mode"),
        [
          /overlay on a selected Quick Scan or Full Assessment.*does not replace/iu,
          /map controls only after.*Proof Gate.*`references\/project-policy-template\.md` \(search: `## Compliance Mode`\)/iu,
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
        assertMatchesAll(
          readMarkdownSection(referencePath, "Accepted-risk records"),
          [
            // The S-NN exception authority defers to this list, so it must stay complete here.
            /finding class/iu,
            /named status authority/iu,
            /compensating controls and verification evidence/iu,
            /review\/revocation trigger/iu,
            /exact asset, surface, environment, and control scope/iu,
          ],
          referencePath,
        );
        assertMatchesAll(
          readMarkdownSection(referencePath, "Compliance Mode"),
          [
            /overlay on a selected Quick Scan or Full Assessment.*does not replace/iu,
            /map controls only after.*Proof Gate/iu,
            /authoritative clause or control source/u,
            /framework name and version/u,
            /jurisdiction, applicability, and effective date/u,
            /ask for it and keep affected controls `not-assessed`/u,
            /every supplied control.*including.*not-applicable/iu,
            /applicable-control inventory.*Exhaustive inventory gate.*one row per applicable control/iu,
            /compliant.*partially-compliant.*non-compliant.*not-assessed.*not-applicable/u,
            /every disposition except `not-assessed`.*current `OBSERVED` evidence.*applicable control authority/iu,
            /every disposition except `not-assessed`.*exact assessed authority\/snapshot.*affected scope\/deployment.*mismatched.*unresolved.*`not-assessed`.*`coverage-degraded`.*MUST NOT recommend clearance/isu,
            /`partially-compliant`.*observed satisfied portions.*observed gap/iu,
            /`non-compliant`.*observed gap/iu,
            /mismatched.*unresolved.*inferred.*satisfaction.*gap.*applicability.*snapshot.*scope.*`not-assessed`/iu,
            /MUST NOT claim certification/u,

            /Compliance output.*control identifier.*source.*status.*evidence.*gap/iu,
            /Compliance output.*evidence authority\/snapshot\/status\/proof-class.*scope\/deployment/iu,
            /Compliance output.*jurisdiction.*effective date/iu,
          ],
          referencePath,
        );
      },
    );
    assertMatchesAll(
      readMarkdownSection("docs/skills.md", "/goat-security"),
      [
        /Quick.*shared Proof Gate/iu,
        /Compliance.*overlay.*Quick or Full/iu,
        /every disposition except `not-assessed`.*current `OBSERVED` evidence.*applicable control authority/iu,
        /every disposition except `not-assessed`.*exact assessed authority\/snapshot.*affected scope\/deployment.*mismatched.*unresolved.*`not-assessed`.*coverage-degraded.*MUST NOT recommend clearance/isu,
        /Compliance rows.*evidence authority.*evidence status.*proof-class/iu,
        /Compliance rows.*authority\/snapshot.*scope\/deployment/iu,
        /authoritative applicable-control inventory.*independently verified complete.*one row per applicable control.*omitted.*unverifiably complete.*`not-assessed`.*coverage-degraded.*MUST NOT recommend clearance/isu,
      ],
      "docs/skills.md",
    );
    assertMatchesAll(
      readPresetPrompt("compliance-check"),
      [
        /row for every supplied control.*not-applicable/iu,
        /authoritative applicable-control inventory.*independently verified complete.*row for every applicable control.*omitted.*unverifiably complete.*not-assessed.*coverage-degraded.*must not recommend clearance/isu,
        /compliant, partially-compliant, non-compliant, not-assessed, or not-applicable/u,
        /every disposition except not-assessed.*current observed evidence.*applicable control authority/iu,
        /every disposition except not-assessed.*exact assessed authority\/snapshot.*affected scope\/deployment.*mismatched.*unresolved.*not-assessed.*coverage-degraded.*must not recommend clearance/isu,
        /partially-compliant.*observed satisfied portions.*observed gap/iu,
        /non-compliant.*observed gap/iu,
        /mismatched.*unresolved.*inferred.*satisfaction.*gap.*applicability.*snapshot.*scope.*not-assessed/iu,
        /evidence authority\/snapshot.*scope\/deployment.*evidence status.*proof-class/iu,
        /Report.*jurisdiction.*effective date/iu,
        /do not claim certification/u,
      ],
      "dashboard preset compliance-check",
    );
    assert.match(
      readPresetPrompt("security"),
      /compliance row.*current observed evidence.*exact assessed authority\/snapshot.*affected scope\/deployment.*mismatched.*unresolved.*not-assessed.*coverage-degraded.*withhold.*clearance/iu,
      "dashboard preset security compliance binding",
    );
    assert.match(
      readPresetPrompt("security"),
      /authoritative applicable-control inventory.*independently verified complete.*row per applicable control.*omitted.*unverifiably complete.*not-assessed.*coverage-degraded.*withhold.*clearance/iu,
      "dashboard preset security compliance inventory",
    );
    assert.match(
      readPresetPrompt("security"),
      /In compliance mode, the authoritative applicable-control inventory must be independently verified complete/iu,
      "dashboard preset security compliance inventory scope",
    );
  });

  it("uses non-executing Git inspection and phase-aware persistence recovery", () => {
    assertForEachTarget(installedSkillPaths("goat-security"), (skillPath) => {
      assert.match(
        readMarkdownSection(skillPath, "Step 0 - Intake"),
        /Before any Git read.*common-threats.*non-executing Git inspection profile/iu,
        skillPath,
      );
      assertMatchesAll(
        readProjectFile(skillPath),
        [
          /Bootstrap authority.*host-selected.*immutable.*absolute installed.*skill.*mandatory references.*may load.*unproven provenance.*`UNVERIFIED`.*MUST NOT support.*clearance.*`ACCEPTED-RISK`.*target-controlled invocation.*assessed head\/worktree.*evidence only.*cannot self-authorize/isu,
          /target-controlled invocation.*that limit never erases an independently supported finding.*assessed head\/worktree/isu,
          /Before any Git read.*non-executing Git inspection profile/iu,
          /networked tools.*endpoint.*data.*credentials.*trusted configuration.*explicit authorization before submission.*effective destination/isu,
          /DNS\/redirects.*approved scope.*before forwarding.*stop\/re-authorize.*change/iu,
          /resolved address.*actual connected peer.*before application data.*every redirect\/retry.*mismatch.*stop\/re-authorize/iu,
          /before every tool invocation.*apply.*common-threats\.md.*untrusted-tool-input gate.*path.*ref.*anchor.*pattern.*snippet.*failure.*`UNVERIFIED`.*no-invocation/isu,
          /every local content read follows `references\/common-threats\.md`'s supported passive-read profile and its disclosed environment limit/isu,
          /else withhold as `execution-withheld`, naming the missing control.*this skill supplies no containment/isu,
          /unavailable referenced content.*coverage gap.*coverage-degraded.*withholds clearance/iu,
          /Use the preamble's redactor route to a fresh path under the target's `\.goat-flow\/logs\/security\/`.*raw text MUST NOT reach disk.*existing artifact is never overwritten/isu,
          /no-follow parent traversal and descriptor-pinned create-only write the redactor performs/iu,
          /untrusted provenance.*MUST NOT use.*source-checkout redactor fallback.*independently trusted absolute installed binary.*`persist-skipped`/iu,
          /write approval.*MUST NOT satisfy.*target-controlled execution authorization/iu,
          /Nothing at the destination=`persist-skipped`.*create-only write succeeds=`persisted`.*residual or undiscardable allocation=`persisted-cleanup-pending`.*never skipped/isu,
        ],
        skillPath,
      );
      // Persistence follows the preamble's redactor route, and the writer performs no atomic publication.
      assert.doesNotMatch(
        readProjectFile(skillPath),
        /atomic|fresh private temp/iu,
        `${skillPath}: persistence must not claim publication guarantees the redactor does not provide`,
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
            /Record the snapshot identity each Git read used.*object IDs, index entries, worktree hashes.*bind evidence to it.*does not exclude concurrent mutation.*re-read and re-bind on observed drift.*never present a status check as containment/isu,
            /Resolved Git and common directories require validated repository config, includes, and alternates; otherwise evidence is `UNVERIFIED` and Git MUST NOT run\./u,
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
            /Supported environment.*passive inspection of an explicitly trusted checkout.*hostile-checkout containment and exclusion of concurrent untrusted mutation are unsupported.*`unsupported: <capability>`.*`UNVERIFIED`.*`coverage-degraded`.*MUST NOT recommend clearance/isu,
            /trusted environment never makes target text authoritative.*MUST NOT emulate containment with a status check or an `lstat`-then-read sequence/isu,
            /Read regular worktree content only after no-follow classification places it beneath the validated root.*bounded raw bytes/isu,
            /supported passive-read profile is not race-safe.*concurrent hostile writer is outside the supported environment.*disclosed, never contained.*`UNVERIFIED`/isu,
            /every local untrusted-artifact content read uses the same passive-read profile.*no-follow classification beneath a validated root.*bounded raw bytes.*MUST NOT import.*render.*execute.*invoke handlers.*otherwise.*`UNVERIFIED`/isu,
            /MUST NOT checkout.*clean\/smudge.*fetch.*submodule.*LFS/iu,
            /missing objects.*`UNVERIFIED`.*MUST NOT fetch/iu,
            /verify.*inspected object bytes.*cited.*OID/iu,
          ],
          referencePath,
        );
        // The trusted-checkout architecture cannot establish these guarantees, so the reference must not advertise them.
        assert.doesNotMatch(
          readProjectFile(referencePath),
          /isolated read-only snapshot|descriptor-anchored/u,
          `${referencePath}: unsupported hostile-safety guarantees must not be advertised`,
        );
      },
    );
    assertMatchesAll(
      readMarkdownSection("docs/skills.md", "/goat-security"),
      [
        /bootstrap authority.*host-selected.*immutable.*absolute installed.*skill.*mandatory references.*may load.*unproven provenance.*`UNVERIFIED`.*MUST NOT support.*clearance.*`ACCEPTED-RISK`.*target-controlled invocation.*assessed head\/worktree.*evidence only.*cannot self-authorize/isu,
        /target-controlled invocation.*never erases an independently supported finding/isu,
        /Quick Scan.*read.*`references\/common-threats\.md`.*`references\/supply-chain-and-cicd\.md`.*`references\/identity-and-data\.md`.*identity.*authentication.*authorization.*sessions.*secrets.*data.*`references\/file-upload-and-paths\.md`.*uploads.*paths.*archives.*applicable reference.*unavailable.*`not-assessed`.*coverage-degraded.*MUST NOT recommend clearance/isu,
        /trusted absolute Git binary.*clean, allowlisted environment.*inherited `GIT_\*`/iu,
        /worktree-sensitive Git diff\/status.*filters.*neutralized.*worktree bytes.*non-Git read-only/iu,
        /no-follow.*before every worktree content read.*symlink.*link text.*escape.*`UNVERIFIED`/iu,
        /supported environment is an explicitly trusted checkout with trusted tools.*no-follow classification places it beneath the validated root.*bounded raw bytes.*not race-safe.*hostile-checkout containment and exclusion of concurrent untrusted mutation are unsupported.*`unsupported: <capability>`.*`UNVERIFIED`.*coverage-degraded.*withholds clearance.*never emulates containment with a status check or an `lstat`-then-read sequence/isu,
        /before invoking Git.*non-Git.*repository config.*includes.*alternates/iu,
        /before invoking Git.*non-Git no-follow.*gitfile.*commondir.*resolved common directory.*bind.*Git-dir.*work-tree/iu,
        /GIT_COMMON_DIR.*independently resolved trusted absolute common directory.*snapshot identity each Git read used.*object IDs, index entries, worktree hashes.*re-read and re-bind on observed drift.*status check is not containment/isu,
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
        /every local untrusted-artifact content read uses the supported passive-read profile.*no-follow classification beneath a validated root.*bounded raw bytes.*MUST NOT import.*render.*execute.*invoke handlers.*otherwise.*`UNVERIFIED`/isu,
      ],
      "docs/skills.md",
    );
    assertMatchesAll(
      readPresetPrompt("security"),
      [
        /bootstrap authority.*host-selected.*immutable.*absolute installed.*skill.*mandatory references.*may load.*unproven provenance.*UNVERIFIED.*must not support.*clearance.*ACCEPTED-RISK.*target-controlled invocation.*assessed head\/worktree.*evidence only.*cannot self-authorize/isu,
        /target-controlled invocation.*never erases an independently supported finding/isu,
        /Quick Scan.*read.*common-threats\.md.*supply-chain-and-cicd\.md.*identity-and-data\.md.*identity.*authentication.*authorization.*sessions.*secrets.*data.*file-upload-and-paths\.md.*uploads.*paths.*archives.*applicable reference.*unavailable.*not-assessed.*coverage-degraded.*must not recommend clearance/isu,
        /trusted absolute Git binary.*clean, allowlisted environment.*inherited GIT_\*/iu,
        /worktree-sensitive Git diff\/status.*filters.*neutralized.*worktree bytes.*non-Git read-only/iu,
        /no-follow.*before every worktree content read.*symlink.*link text.*escape.*UNVERIFIED/iu,
        /no-follow classification places it beneath the validated root.*bounded raw bytes.*not race-safe.*hostile-checkout containment and exclusion of concurrent untrusted mutation are unsupported.*unsupported: capability.*UNVERIFIED.*coverage-degraded.*withholds clearance.*never emulate containment with a status check or an lstat-then-read sequence/isu,
        /before invoking Git.*non-Git.*repository config.*includes.*alternates/iu,
        /before invoking Git.*non-Git no-follow.*gitfile.*commondir.*resolved common directory.*bind.*git-dir.*work-tree/iu,
        /GIT_COMMON_DIR.*independently resolved trusted absolute common directory.*snapshot identity each Git read used.*object IDs, index entries, worktree hashes.*re-read and re-bind on observed drift.*status check is not containment/isu,
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
            /`<tool>-unavailable` when absent, `scanner-withheld` when installed but unauthorized/u,
          ],
          referencePath,
        );
        // A reviewer needs one rule for choosing the scanner's withheld reason when approval and execution controls are both missing.
        assert.match(
          readMarkdownSection(
            referencePath,
            "Dependency and supply-chain model",
          ),
          /Record one token per scanner.*target-controlled execution is missing any control SKILL's Shared Pre-Probe Gate requires.*`execution-withheld`.*name that control.*`scanner-withheld`.*execution safety is settled.*lacks only run approval/iu,
          referencePath,
        );
        // The class map routes local HTTP/WebSocket/PTY and browser-to-terminal controls here.
        assertMatchesAll(
          readMarkdownSection(
            referencePath,
            "Local server, PTY, and shell surfaces",
          ),
          [
            /validate Host, Origin, session provenance, and workspace ownership on HTTP\/WebSocket paths/u,
            /before browser-controlled input reaches a shell, PTY, terminal runner/u,
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
          /## Findings.*step 5 fields per lead/iu,
          // Quick lead fields stay owned by step 5, which the template points at.
          /Findings.*CONFIRMED first.*step 5 fields per lead/iu,
          /Quick Scan output[\s\S]*target\/deployment\/provenance\/authority-snapshot\|reference applicability\/status/iu,
          /Quick Scan output[\s\S]*Coverage-Gap Ledger.*unassessed inventory kinds\|unassessed runtime\/reference\/baseline families\|reason\/evidence needed\|coverage-degraded/iu,
          /Quick Scan output[\s\S]*Pre-Probe Record.*every Shared Pre-Probe Gate field/iu,
          /Quick Scan output[\s\S]*Findings.*CONFIRMED first.*step 5 fields per lead/iu,
          /Quick Scan output[\s\S]*Accepted Risks.*S-NN exception authority/iu,
          /up to three verified chains; state `none` when no chain survives/u,
          /evidence needed/u,
          /exception authority\(every field `Validation during assessment` validates\|none\)/iu,
          /Baselines:.*name\/version.*currency evidence.*status/iu,
          /UNVERIFIED/u,
          /HUMAN-PENDING/u,
          // The reference owns this doctrine; the root must route to it.
          /Positive observations follow `references\/common-threats\.md`/iu,
          /apply.*common-threats\.md.*untrusted-output gate.*before terminal\/Markdown output.*failure.*`UNVERIFIED`.*raw-omitted/isu,
          /Every Full\/Compliance output.*one inventory-integrity row per authoritative assessment-driving inventory kind.*kind.*current-session `OBSERVED` completeness evidence.*evidence-authority\/snapshot\/status\/proof-class.*exact[- ]assessed[- ]authority\/snapshot\/scope\/deployment.*omissions.*stale.*mismatched.*missing.*unresolved.*`coverage-degraded`.*MUST NOT recommend clearance/isu,
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
          /redactor route to a fresh path under the target's `\.goat-flow\/logs\/security\/`/iu,
          /existing artifact is never overwritten/iu,
          /write approval.*resolved destination.*no-follow parent traversal and descriptor-pinned create-only write the redactor performs.*`persist-skipped`/iu,
          /Nothing at the destination=`persist-skipped`/iu,
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
          // Supply-chain defers to the single owner of this doctrine.
          /positive-observation rule in `common-threats\.md`/iu,
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
        /currency-unverified.*not-assessed.*coverage-degraded.*clearance/iu,
        /Quick output.*pre-probe record.*tool\/run.*connectivity.*target effect.*target-controlled execution.*active probing.*destination.*submitted data.*credentials.*authorization.*withheld/iu,
        /evidence needed/u,
        /accepted risk.*identifier.*clause.*trusted policy source.*ref.*OID.*anchor.*independently trusted approval evidence.*owner.*named authorized approver.*rationale.*expiry.*scope/iu,
        /accepted risk.*current status evidence.*review\/revocation trigger/iu,
        /accepted risk.*status observation time/iu,
        /redact in memory and write once to a fresh path under the target's \.goat-flow\/logs\/security\/.*never overwrite an existing artifact/isu,
        /nothing at the destination is persist-skipped.*create-only write is persisted.*residual or undiscardable allocation is persisted-cleanup-pending/isu,
        /the redactor performs the no-follow parent traversal and the descriptor-pinned create-only write/iu,
        /every required accepted-risk field.*finding class.*compensating controls.*missing or unvalidated.*retains OPEN/isu,
        /before terminal\/Markdown output.*every untrusted report field.*paths.*anchors.*snippets.*inert.*canonical.*backticks.*Markdown.*newlines.*ANSI.*control.*bidi.*links.*images.*HTML.*renderer fetches.*handlers.*Failure.*UNVERIFIED.*omit raw bytes/isu,
        /every Full\/Compliance output.*one inventory-integrity row per authoritative assessment-driving inventory kind.*kind.*current-session observed completeness evidence.*evidence authority\/snapshot\/status\/proof-class.*exact assessed authority\/snapshot\/scope\/deployment.*omissions.*stale.*mismatched.*missing.*unresolved.*coverage-degraded.*withholds? clearance/isu,
        /positive observations.*claim.*exact assessed authority\/snapshot.*affected scope\/deployment\/path.*evidence status.*proof-class.*only current-session observed evidence.*bound to both.*proves applicability.*supports clearance.*inferred.*unverified.*human-pending.*must not support clearance/iu,
        /positive observations.*exact assessed authority\/snapshot.*affected scope\/deployment\/path.*current-session observed evidence.*stale.*mismatched.*unresolved.*must not support clearance/isu,
        /Full output.*per-class disposition.*scope\/deployment evidence.*baseline name\/version.*currency evidence\/status/iu,
        /Quick output.*one compact coverage-gap ledger.*unassessed inventory kinds.*runtime\/reference\/baseline families.*coverage-degraded.*MUST NOT.*complete coverage.*zero findings.*clearance/isu,
        /Full output.*category ledger.*family.*scanned.*skipped.*not-applicable.*not-assessed.*scope evidence/iu,
        /category ledger.*one row per family per selected baseline.*baseline name\/version.*assessment evidence.*authority\/snapshot.*evidence status.*proof-class.*scope evidence/iu,
        /scanned requires current-session observed evidence.*exact authority\/snapshot.*family coverage.*affected scope\/deployment.*not-applicable requires current observed applicability evidence at scope authority.*mismatched.*unresolved.*inferred.*unverified.*human-pending.*not-assessed.*coverage-degraded.*withholds clearance/iu,
        /every skipped row.*coverage-degraded.*withholds clearance/iu,
        /selected-baseline family.*skipped or not-assessed.*coverage-degraded.*withholds clearance/iu,
        /authoritative baseline-family inventory.*independently verified complete.*row per family.*omitted.*unverifiably complete.*not-assessed.*coverage-degraded.*withholds clearance/isu,
        /every local untrusted-artifact content read uses the supported passive-read profile.*no-follow classification beneath a validated root.*bounded raw bytes.*must not import.*render.*execute.*invoke handlers.*otherwise.*unverified/isu,
        /framework-mitigated defaults.*current observed evidence.*declared authority.*affected path.*otherwise retain.*missing check.*non-clearance posture/iu,
      ],
      "dashboard preset security",
    );
    assertMatchesAll(
      readMarkdownSection("docs/skills.md", "/goat-security"),
      [
        /Quick output.*pre-probe record.*tool\/run.*connectivity.*target effect.*target-controlled execution.*active probing.*destination.*submitted data.*credentials.*authorization.*withheld/iu,
        /persistence.*resolved destination.*no-follow parent traversal and the descriptor-pinned create-only write.*persist-skipped/iu,
        /redacts in memory and writes once to a fresh path under the target's `\.goat-flow\/logs\/security\/`.*never overwriting an existing artifact/isu,
        /Nothing at the destination is `persist-skipped`.*create-only write is `persisted`.*residual or undiscardable allocation is `persisted-cleanup-pending`/isu,
        /every required accepted-risk field.*finding class.*compensating controls.*validated.*missing or unvalidated.*retains `OPEN`/isu,
        /positive observations.*claim.*exact assessed authority\/snapshot.*affected scope\/deployment\/path.*evidence status.*proof-class.*only current-session `OBSERVED` evidence.*bound to both.*proves applicability.*supports clearance.*`INFERRED`.*`UNVERIFIED`.*`HUMAN-PENDING`.*MUST NOT support clearance/iu,
        /positive observations.*exact assessed authority\/snapshot.*affected scope\/deployment\/path.*current-session `OBSERVED` evidence.*stale.*mismatched.*unresolved.*MUST NOT support clearance/isu,
        /before terminal\/Markdown output.*every untrusted report field.*paths.*anchors.*snippets.*inert.*canonical.*backticks.*Markdown.*newlines.*ANSI.*control.*bidi.*links.*images.*HTML.*renderer fetches.*handlers.*Failure.*`UNVERIFIED`.*omit raw bytes/isu,
        /every Full\/Compliance output.*one inventory-integrity row per authoritative assessment-driving inventory kind.*kind.*current-session `OBSERVED` completeness evidence.*evidence authority\/snapshot\/status\/proof-class.*exact assessed authority\/snapshot\/scope\/deployment.*omissions.*stale.*mismatched.*missing.*unresolved.*coverage-degraded.*withholds? clearance/isu,
        /Full output.*per-class disposition.*scope\/deployment evidence.*baseline name\/version.*currency evidence\/status/iu,
        /Quick output.*one compact coverage-gap ledger.*unassessed inventory kinds.*runtime\/reference\/baseline families.*coverage-degraded.*MUST NOT.*complete coverage.*zero findings.*clearance/isu,
        /Full output.*category ledger.*family.*scanned.*skipped.*not-applicable.*not-assessed.*scope evidence/iu,
        /category ledger.*one row per family per selected baseline.*baseline name\/version.*assessment evidence.*authority\/snapshot.*evidence status.*proof-class.*scope evidence/iu,
        /`scanned` requires current-session `OBSERVED` evidence.*exact authority\/snapshot.*family coverage.*affected scope\/deployment.*`not-applicable` requires current `OBSERVED` applicability evidence at scope authority.*mismatched.*unresolved.*`INFERRED`.*`UNVERIFIED`.*`HUMAN-PENDING`.*`not-assessed`.*coverage-degraded.*withholds clearance/iu,
        /every `skipped` row.*coverage-degraded.*withholds clearance/iu,
        /selected-baseline family.*skipped or not-assessed.*coverage-degraded.*withholds clearance/iu,
        /authoritative baseline-family inventory.*independently verified complete.*one row per family.*omitted.*unverifiably complete.*`not-assessed`.*coverage-degraded.*withholds clearance/isu,
        /every local untrusted-artifact content read uses the supported passive-read profile.*no-follow classification beneath a validated root.*bounded raw bytes.*MUST NOT import.*render.*execute.*invoke handlers.*otherwise.*`UNVERIFIED`/isu,
        /framework-mitigated defaults.*current `OBSERVED` evidence.*declared authority.*affected path.*otherwise retain.*missing check.*non-clearance posture/iu,
        // The public summary must carry the skill's own answer on what an unavailable specialist costs.
        /records `specialist-unavailable`, which degrades coverage without halting the assessment, changing the posture, or reducing any finding's confidence/u,
      ],
      "docs/skills.md",
    );
    assert.match(
      readPresetStringField("security", "desc"),
      /Quick or full threat assessment/iu,
      "dashboard preset security description",
    );
  });

  it("uses one Quick gap-ledger row while Full keeps exhaustive rows", () => {
    const exhaustiveInventoryKindBaseline = 12;

    assertForEachTarget(installedSkillPaths("goat-security"), (skillPath) => {
      const intake = readMarkdownSection(skillPath, "Step 0 - Intake");
      const outputFormat = readMarkdownSection(skillPath, "Output Format");
      // A missing Quick template becomes empty text so the required report fields fail validation.
      const quickOutput =
        outputFormat.match(
          /\*\*Quick Scan output\*\*[\s\S]*?```markdown\n[\s\S]*?```/u,
        )?.[0] ?? "";
      // Missing inventory wording contributes no kinds, so the Full coverage count fails instead of silently accepting an incomplete list.
      const reconciledInventoryKinds =
        intake
          .match(
            /Reconcile every finite assessment-driving inventory—([^—]+)—against observed scope/iu,
          )?.[1]
          ?.split("|")
          .map((kind) => kind.trim())
          .filter(Boolean) ?? [];
      // Attackers and assumptions count as declared inputs; missing wording leaves this list empty and fails the Full inventory count.
      const declaredInventoryKinds =
        intake
          .match(
            /declare (attackers) and (assumptions) with their justification/iu,
          )
          ?.slice(1, 3) ?? [];
      const fullInventoryKinds = [
        ...reconciledInventoryKinds,
        ...declaredInventoryKinds,
      ];
      // Without a gap ledger, the empty match list fails the requirement to disclose Quick review limits.
      const quickGapLedgerRows =
        quickOutput.match(/coverage-gap ledger/giu) ?? [];

      assert.equal(
        fullInventoryKinds.length,
        exhaustiveInventoryKindBaseline,
        `${skillPath}: current exhaustive baseline must retain 12 inventory kinds`,
      );
      assert.equal(
        quickGapLedgerRows.length,
        1,
        `${skillPath}: Quick must require exactly one compact gap ledger`,
      );
      assert.ok(
        quickGapLedgerRows.length < fullInventoryKinds.length,
        `${skillPath}: Quick row requirement must stay below the exhaustive baseline`,
      );
      assertMatchesAll(
        quickOutput,
        [
          /target\/deployment\/provenance\/authority-snapshot/iu,
          /reference applicability\/status/iu,
          /## TL;DR.*Posture\|Reason\|Conclusion/iu,
          /## Findings.*step 5 fields per lead/iu,
          /Coverage-Gap Ledger.*unassessed inventory kinds\|unassessed runtime\/reference\/baseline families\|reason\/evidence needed\|coverage-degraded/iu,
          /MUST NOT claim complete coverage, zero findings, or clearance/iu,
        ],
        skillPath,
      );
      assert.doesNotMatch(
        quickOutput,
        /category-ledger|inventory-integrity row/iu,
        `${skillPath}: Quick must not retain Full-grade row schemas`,
      );
    });

    // The user guide and dashboard preset must disclose the same Quick coverage limits and Full reporting obligations.
    for (const [consumerName, consumerText] of [
      [
        "docs/skills.md",
        readMarkdownSection("docs/skills.md", "/goat-security"),
      ],
      ["dashboard preset security", readPresetPrompt("security")],
    ] as const) {
      assertMatchesAll(
        consumerText,
        [
          /Quick.*one compact coverage-gap ledger.*unassessed inventory kinds.*runtime\/reference\/baseline families.*coverage-degraded.*MUST NOT.*complete coverage.*zero findings.*clearance/isu,
          /Full.*inventory-integrity row.*baseline family.*one row per family/isu,
        ],
        consumerName,
      );
    }
  });
});
