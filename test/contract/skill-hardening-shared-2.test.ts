/**
 * Contracts for guidance every skill inherits: the preamble, conventions, playbook wiring,
 * and the mirror parity that keeps all four install roots saying the same thing.
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
  INSTALLED_SKILL_ROOTS,
} from "./skill-hardening.helpers.js";

describe("skill hardening contracts: shared surfaces (2/3)", () => {
  it("keeps glossary continuity terms aligned with the conditional session-log contract", () => {
    const glossary = readProjectFile(".goat-flow/glossary.md");
    assert.match(
      glossary,
      /A current handoff receipt is an optional, redacted session-log fallback written on `\/compact` when no active milestone exists or when the user explicitly requests one/u,
    );
    assert.match(
      glossary,
      /milestone state remains primary; only when no active milestone exists, or the user explicitly requests it, write a redacted session log/u,
    );
    // Contributors need every user-visible skill root before checking mirror drift.
    for (const skillRoot of [
      "workflow/skills",
      ".claude/skills",
      ".agents/skills",
      ".github/skills",
    ]) {
      assert.equal(glossary.includes(skillRoot), true, skillRoot);
    }
    assert.doesNotMatch(glossary, /\| Handoff \| Deprecated in v1\.1\.0\./u);
    assert.doesNotMatch(glossary, /On `\/compact`, session log written/u);
  });

  it("keeps historical Claude Write-rule evidence distinct from current guidance", () => {
    const settingsFootguns = readProjectFile(
      ".goat-flow/learning-loop/footguns/agent-settings.md",
    );
    assert.match(settingsFootguns, /At the 2026-06-07 fix/u);
    assert.match(
      settingsFootguns,
      /2026-07-16 follow-up below later removed unmatched Write rules/u,
    );
    assert.match(
      settingsFootguns,
      /`audit` drift \(search: `differs from the current goat-flow template`\)/u,
    );
  });

  it("documents task-path classifier examples", () => {
    const skillsDocumentation = readProjectFile("docs/skills.md");
    assert.match(
      skillsDocumentation,
      /Task path classifier examples/,
      "missing table",
    );
    assert.match(
      skillsDocumentation,
      /Bare task directory path\s+\|\s+Read-only orientation; no writes/,
      "path-only input must be read-only",
    );
    assert.match(
      skillsDocumentation,
      /Task directory path plus `start current milestone`\s+\|\s+Implementation may start after normal gates/,
      "start current milestone input must allow implementation after gates",
    );
    assert.match(
      skillsDocumentation,
      /`resume` plus a task directory path\s+\|\s+Confirm current milestone unless the plan clearly records one/,
      "resume input must confirm current milestone",
    );
    assert.match(
      skillsDocumentation,
      /`update current milestone` plus a task directory path\s+\|\s+Update the named milestone file only/,
      "update current milestone input must stay plan-file scoped",
    );
    assert.match(
      skillsDocumentation,
      /`implement current milestone` plus a task directory path\s+\|\s+Code implementation may proceed after reading gates/,
      "implement current milestone input must allow code implementation after gates",
    );
  });

  it("keeps covered behaviours from deferring uncovered siblings", () => {
    assertForEachTarget(installedSkillPaths("goat-qa"), (skillPath) => {
      const auditMode = readMarkdownSection(skillPath, "Audit Mode");

      assert.match(
        auditMode,
        /Rank each behaviour row by `Risk × uncovered fraction`/u,
        skillPath,
      );
      assert.match(auditMode, /One line per behaviour\/invariant/u, skillPath);
      assert.match(
        auditMode,
        /A BEHAVIOURAL row never defers uncovered sibling behaviours in the same file/u,
        skillPath,
      );
    });
    assertForEachTarget(
      installedSkillReferencePaths("goat-qa", "references/output-templates.md"),
      (referencePath) => {
        const outputTemplates = readProjectFile(referencePath);
        const auditOutputHeading = "### Audit mode (no diff - A1–A4 shape)";
        const auditOutput = outputTemplates.slice(
          outputTemplates.indexOf(auditOutputHeading),
        );
        assert.match(
          auditOutput,
          /\| File \| Behaviour \/ Invariant \| Risk \| Test file \| Coverage \| Notes \| Proof Class \|/u,
          referencePath,
        );
      },
    );
  });

  it("lets an explicit read-only investigation pass its scope checkpoint", () => {
    assertForEachTarget(installedSkillPaths("goat-debug"), (skillPath) => {
      const investigateMode = readMarkdownSection(
        skillPath,
        "Investigate Mode",
      );

      assert.match(
        investigateMode,
        /\*\*CHECKPOINT:\*\* "I'll investigate \[scope\] reading up to \[N\] files\. Adjust\?"/u,
        skillPath,
      );
      assert.match(
        investigateMode,
        /When the goal and scope are explicit, continue to I2 without waiting/u,
        skillPath,
      );
      assert.match(
        investigateMode,
        /Pause only when the goal or boundary is ambiguous, or before exceeding the declared 3x read limit/u,
        skillPath,
      );
      assert.doesNotMatch(
        investigateMode,
        /\*\*BLOCKING GATE:\*\* "I'll investigate/u,
        `${skillPath}: read-only orientation must not wait when scope is explicit`,
      );
    });
  });

  it("keeps the skill-TDD example isolated from repository-history policy", () => {
    const skillTddReferencePaths = [
      "workflow/skills/playbooks/skill-quality-testing/tdd-iteration.md",
      ".goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md",
    ];

    assertForEachTarget(skillTddReferencePaths, (referencePath) => {
      const fullReference = readProjectFile(referencePath);
      const pressureExamples = readMarkdownSection(
        referencePath,
        "Seven pressure types",
      );
      const globalLabelIndex = fullReference.indexOf(
        "Illustrative scenarios - input/output shape only; never evidence.",
      );
      assert.ok(
        globalLabelIndex > 0 &&
          globalLabelIndex < fullReference.indexOf("## The iron law"),
        `${referencePath}: missing prominent file-wide illustrative label`,
      );
      assert.match(
        pressureExamples,
        /Illustrative scenario - input\/output shape only; never evidence/,
        referencePath,
      );
      assert.match(
        pressureExamples,
        /only the test-first ordering differs/,
        referencePath,
      );
      assert.doesNotMatch(
        pressureExamples,
        /Real goat-flow incident|M33|test\/contract\/skill-hardening-contracts\.test\.ts/,
        referencePath,
      );
      assert.doesNotMatch(pressureExamples, /Commit now/, referencePath);
      assert.doesNotMatch(pressureExamples, /git commit/, referencePath);
      assert.doesNotMatch(
        fullReference,
        /superpowers' own TDD skill|typical ~\$0\.07|A full TDD pass[^\n]+~\$0\.50|Baseline RED typically|Baseline budget[^\n]+6 iterations/,
        `${referencePath}: uncited framework history or fixed-cost claims remain`,
      );
    });
    assert.equal(
      readProjectFile(skillTddReferencePaths[0]),
      readProjectFile(skillTddReferencePaths[1]),
      "workflow Skill TDD methodology and consumer-installed copy must remain byte-identical",
    );
  });

  it("ties resolved hook footguns to the regressions that prove each boundary", () => {
    const optionalMigration = readMarkdownSection(
      ".goat-flow/learning-loop/footguns/hooks.md",
      "Footgun: Optional hook migration must remove old registrations and re-add enabled central entries",
    );
    const failSoftAnalyzer = readMarkdownSection(
      ".goat-flow/learning-loop/footguns/hook-scanning.md",
      "Footgun: Fail-soft analyzer skips can silently uncover a configured language",
    );

    // Both footguns must read as resolved on the same date, or a reader cannot tell
    // which boundary is still live. Asserted separately so a failure names the entry.
    const resolvedStamp =
      /\*\*Status:\*\* resolved[^\n]+\*\*Resolved:\*\* 2026-07-17/u;
    assert.match(optionalMigration, resolvedStamp, "optional hook migration");
    assert.match(failSoftAnalyzer, resolvedStamp, "fail-soft analyzer skip");
    assert.match(
      optionalMigration,
      /setup-install-codex-config-migration\.test\.ts[^\n]+migrates legacy Codex Gruff registration to the approved provider contract/u,
    );
    assert.match(
      optionalMigration,
      /hook-registrar-surfaces\.test\.ts[^\n]+keeps gruff-code-quality unregistered for Antigravity without result delivery/u,
    );
    assert.match(
      failSoftAnalyzer,
      /gruff-code-quality-smoke\.test\.ts[^\n]+exits silently when project config is missing and diagnoses configured languages without a binary/u,
    );
  });

  // A user asking what to build next needs evidence-backed ideas that cannot distort merge safety.

  it("keeps direction audits advisory, grounded, and separate from defect verdicts", () => {
    // Every runner must show the evidence classes and rejection routes behind the concise skill rule.
    const reviewExamplePaths = INSTALLED_SKILL_ROOTS.map(
      (skillRoot) => `${skillRoot}/goat-review/references/examples.md`,
    );

    assertForEachTarget(installedSkillPaths("goat-review"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(skillGuidance, /Direction \/ Opportunity Audit/, skillPath);
      assert.match(skillGuidance, /advisory opportunity output/, skillPath);
      assert.match(skillGuidance, /does not affect Ship Verdict/, skillPath);
      assert.match(skillGuidance, /repo-grounded evidence/, skillPath);
    });

    assertForEachTarget(reviewExamplePaths, (examplePath) => {
      const reviewExamples = readProjectFile(examplePath);
      assert.match(reviewExamples, /unfinished intent/, examplePath);
      assert.match(reviewExamples, /stated-but-undelivered/, examplePath);
      assert.match(reviewExamples, /surface asymmetry/, examplePath);
      assert.match(reviewExamples, /adjacent possible/, examplePath);
      assert.match(reviewExamples, /friction worth productizing/, examplePath);
      assert.match(reviewExamples, /impact divided by effort/, examplePath);
      assert.match(
        reviewExamples,
        /discounted by confidence and fix risk/,
        examplePath,
      );
      assert.match(reviewExamples, /Per-run refutations/, examplePath);
      assert.match(reviewExamples, /Local cross-run rejections/, examplePath);
      assert.match(reviewExamples, /Durable policy decisions/, examplePath);
    });
  });

  // A user receiving delegated work needs independent verification and a clear re-plan threshold.

  it("does not install a canonical goat-improve execution skill", () => {
    const workflowManifest = readProjectFile("workflow/manifest.json");
    assert.doesNotMatch(workflowManifest, /goat-improve/);
    assert.doesNotMatch(workflowManifest, /execute <plan>/);
  });

  it("keeps report-only finding outputs aligned with the shared proof-class contract", () => {
    const proofClassContract =
      /RUNTIME\s*\|\s*CONTRACT-GREP\s*\|\s*STATIC\s*\|\s*NOT-REPRODUCED/;

    assertForEachTarget(installedSkillPaths("goat-security"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(skillGuidance, proofClassContract, skillPath);
      assert.match(skillGuidance, /S-NN:[^\n]+proof-class/, skillPath);
      assert.match(skillGuidance, /Proof classes:/, skillPath);
    });

    assertForEachTarget(installedSkillPaths("goat-qa"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(skillGuidance, proofClassContract, skillPath);
    });
    assertForEachTarget(
      installedSkillReferencePaths("goat-qa", "references/output-templates.md"),
      (referencePath) => {
        const outputTemplates = readProjectFile(referencePath);
        assert.match(
          outputTemplates,
          /\| File \| Lines Changed[^\n]+\| Proof Class \|/,
          referencePath,
        );
        assert.match(
          outputTemplates,
          /\| Code Change \| Risk[^\n]+\| Proof Class \|/,
          referencePath,
        );
        assert.match(outputTemplates, /Proof classes:/, referencePath);
      },
    );

    assertForEachTarget(installedSkillPaths("goat-critique"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(skillGuidance, proofClassContract, skillPath);
      assert.match(
        skillGuidance,
        /Each sub-agent normally returns[^\n]+Proof class/,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /Validated Findings[^\n]+proof class/,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /Recommended Changes[^\n]+proof class/,
        skillPath,
      );
    });
  });

  it("keeps writing-style edits truth-preserving and source-aware", () => {
    for (const playbookPath of [
      "workflow/skills/playbooks/writing-style.md",
      ".goat-flow/skill-docs/playbooks/writing-style.md",
    ]) {
      const availability = readMarkdownSection(
        playbookPath,
        "Availability Check",
      );
      assert.match(
        availability,
        /review authorizes diagnosis, not an unrequested rewrite/u,
        playbookPath,
      );

      const scopeGate = readMarkdownSection(playbookPath, "Scope Gate");
      assert.match(
        scopeGate,
        /playbooks and other agent-read references/u,
        playbookPath,
      );
      assert.match(
        scopeGate,
        /Review comments and replies to a person\s*\|\s*Correctness and residue only/u,
        playbookPath,
      );
      assert.match(
        scopeGate,
        /Code comments and docstrings\s*\|\s*No - see `code-comments\.md`/u,
        playbookPath,
      );
      assert.match(
        scopeGate,
        /social-meaning guard and Colleague check/u,
        playbookPath,
      );
      assert.match(scopeGate, /deliberate control repetition/u, playbookPath);
      assert.match(
        scopeGate,
        /verified facts and safety[\s\S]+user's task, audience, and required meaning[\s\S]+project-documented style and supplied voice/u,
        playbookPath,
      );

      const correctnessGate = readMarkdownSection(
        playbookPath,
        "Correctness and Meaning",
      );
      assert.match(
        correctnessGate,
        /names, numbers, units, versions, flags, options, and paths/u,
        playbookPath,
      );
      assert.match(
        correctnessGate,
        /proposal[^\n]+decision[^\n]+assumption[^\n]+fact/u,
        playbookPath,
      );
      assert.match(
        correctnessGate,
        /optional[^\n]+required[^\n]+planned or pending check[^\n]+passed check/u,
        playbookPath,
      );
      assert.match(
        correctnessGate,
        /claim strength and specificity to the evidence/u,
        playbookPath,
      );
      assert.match(
        correctnessGate,
        /named attribution to a specific inspectable point/u,
        playbookPath,
      );

      const sourceGate = readMarkdownSection(
        playbookPath,
        "Before Editing Existing Prose",
      );
      assert.match(
        sourceGate,
        /human-authored, generated, mixed, or unknown/u,
        playbookPath,
      );
      assert.match(sourceGate, /lightest effective edit/u, playbookPath);
      assert.match(sourceGate, /Unknown provenance/u, playbookPath);
      assert.match(sourceGate, /Protect strong human passages/u, playbookPath);
      assert.match(
        sourceGate,
        /verified claims, not synonym substitutions/u,
        playbookPath,
      );

      const register = readMarkdownSection(playbookPath, "Register");
      assert.match(
        register,
        /Neutral and conventional are valid voices/u,
        playbookPath,
      );
      assert.match(
        register,
        /Documentation and decisions[\s\S]+Reports and reviews[\s\S]+Release and changelog prose/u,
        playbookPath,
      );
      assert.match(
        register,
        /correctness-and-residue-only surfaces whose social meaning must survive/u,
        playbookPath,
      );

      const fixOnSight = readMarkdownSection(playbookPath, "Fix on Sight");
      assert.match(fixOnSight, /verified meaning/u, playbookPath);
      assert.match(
        fixOnSight,
        /diagnose reader cost, not authorship/u,
        playbookPath,
      );
      assert.match(fixOnSight, /record the primary cost once/u, playbookPath);
      assert.match(fixOnSight, /Canonical terminology/u, playbookPath);
      assert.match(
        fixOnSight,
        /Manufactured engagement closers/u,
        playbookPath,
      );
      assert.match(fixOnSight, /Report issues at the tracker/u, playbookPath);

      const structure = readMarkdownSection(playbookPath, "Structure");
      assert.match(structure, /Process bleed/u, playbookPath);
      assert.match(structure, /Illustrative before/u, playbookPath);
      assert.match(
        structure,
        /Catalogue-shaped repetition is exempt/u,
        playbookPath,
      );
      assert.match(
        structure,
        /Reference-list labels remain valid/u,
        playbookPath,
      );

      const guards = readMarkdownSection(
        playbookPath,
        "Guards Against Misapplication",
      );
      assert.match(guards, /Plan uniformity is control grammar/u, playbookPath);
      assert.match(
        guards,
        /Replies to people carry social meaning/u,
        playbookPath,
      );

      const verification = readMarkdownSection(
        playbookPath,
        "Verification Gate",
      );
      assert.match(
        verification,
        /status, requirement level, uncertainty, and provenance/u,
        playbookPath,
      );
      assert.match(
        verification,
        /Scope Gate, register,[^\n]+source classification applied/u,
        playbookPath,
      );
      assert.match(
        verification,
        /claim strength, attribution, and cited claims/u,
        playbookPath,
      );
    }

    for (const readmePath of [
      "workflow/skills/playbooks/README.md",
      ".goat-flow/skill-docs/playbooks/README.md",
    ]) {
      assert.match(
        readProjectFile(readmePath),
        /writing-style\.md[^\n]+correctness and meaning preservation[^\n]+register- and source-aware editing/u,
        readmePath,
      );
    }
  });

  it("keeps shared report-only and interrupt freeze contracts installed", () => {
    // Users need the same report-only boundary in source and installed references.
    for (const referencePath of [
      "workflow/skills/reference/skill-preamble.md",
      ".goat-flow/skill-docs/skill-preamble.md",
    ]) {
      const referenceGuidance = readProjectFile(referencePath);
      assert.match(
        referenceGuidance,
        /Report-Only Skill Contract/,
        referencePath,
      );
      assert.match(
        referenceGuidance,
        /are report-only by default/,
        referencePath,
      );
      assert.match(
        referenceGuidance,
        /MUST NOT mutate the target artifact/,
        referencePath,
      );
      assert.match(
        referenceGuidance,
        /a bare or ambiguous task path is context, not a direct planning request/,
        referencePath,
      );
      assert.match(
        referenceGuidance,
        /a task path alone must not update `\.active`, milestone status, checkboxes, or code/,
        referencePath,
      );
    }

    // Users also need the same interruption behavior in both reference surfaces.
    for (const referencePath of [
      "workflow/skills/reference/skill-conventions.md",
      ".goat-flow/skill-docs/skill-conventions.md",
    ]) {
      const referenceGuidance = readProjectFile(referencePath);
      assert.match(
        referenceGuidance,
        /Interrupt Freeze Protocol/,
        referencePath,
      );
      assert.match(
        referenceGuidance,
        /freeze writes immediately/,
        referencePath,
      );
      assert.match(
        referenceGuidance,
        /Only run read-only status or diff checks/,
        referencePath,
      );
    }
  });

  it("keeps functional-skill Step 0 learning-loop emission doctrine installed", () => {
    // Every reference surface must tell users when prior learning was consulted.
    for (const referencePath of [
      "workflow/skills/reference/skill-preamble.md",
      ".goat-flow/skill-docs/skill-preamble.md",
    ]) {
      const learningLoopSection = readMarkdownSection(
        referencePath,
        "Learning-Loop Retrieval",
      );
      assert.match(learningLoopSection, /MUST emit/, referencePath);
      assert.match(
        learningLoopSection,
        /Relevant prior learnings:/,
        referencePath,
      );
      assert.match(learningLoopSection, /Terms searched:/, referencePath);
    }
  });
});
