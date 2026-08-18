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

/** Assert stable semantic anchors inside one named Markdown section. */
function assertSectionPatterns(
  markdownPath: string,
  sectionHeading: string,
  patterns: readonly RegExp[],
): void {
  const section = readMarkdownSection(markdownPath, sectionHeading);
  for (const pattern of patterns) assert.match(section, pattern, markdownPath);
}

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

  it("requires mutation-capable skill fixtures to prove fidelity and stability", () => {
    const skillTddReferencePaths = [
      "workflow/skills/playbooks/skill-quality-testing/tdd-iteration.md",
      ".goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md",
    ];

    assertForEachTarget(skillTddReferencePaths, (referencePath) => {
      const reference = readProjectFile(referencePath);

      assert.match(
        reference,
        /exact finding identity[\s\S]+target, semantic anchor, and rule or defect code/u,
        referencePath,
      );
      assert.match(
        reference,
        /clean-input preservation[\s\S]+byte-for-byte/u,
        referencePath,
      );
      assert.match(
        reference,
        /remediation fidelity[\s\S]+non-target bytes and meaning/u,
        referencePath,
      );
      assert.match(reference, /overcorrection[\s\S]+near-miss/u, referencePath);
      assert.match(
        reference,
        /second-pass stability[\s\S]+identical bytes and finding set/u,
        referencePath,
      );
    });
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

  it("keeps writing-style edits truth-preserving and source-aware through the routed core", () => {
    for (const playbookPath of [
      "workflow/skills/playbooks/writing-style.md",
      ".goat-flow/skill-docs/playbooks/writing-style.md",
    ]) {
      assertSectionPatterns(playbookPath, "Availability Check", [
        /review authorizes diagnosis, not an unrequested rewrite/u,
      ]);
      assertSectionPatterns(playbookPath, "Scope Gate", [
        /playbooks and other agent-read references/u,
        /Review comments and replies to a person\s*\|\s*Correctness and residue only/u,
        /Code comments and docstrings\s*\|\s*No - see `code-comments\.md`/u,
        /social-meaning guard and Colleague check/u,
        // The replies permission is correctness and residue, widened only by an explicit user request; consolidating the three
        // shipped wordings once deleted this escape outright, so it is pinned here rather than left to prose review.
        /no other style rule applies unless the user asks/u,
        /deliberate control repetition/u,
        /verified facts and safety[\s\S]+user's task, audience, and required meaning[\s\S]+project-documented style and supplied voice/u,
      ]);
      assertSectionPatterns(playbookPath, "Diagnostic Router", [
        /writing-sentence-diagnostics\.md[\s\S]+sentence-level reader cost/u,
        /writing-structure-diagnostics\.md[\s\S]+document-level assembly defect/u,
        /Do not load either diagnostic playbook for a small edit that passes the minimum core checks/u,
      ]);
      assertSectionPatterns(playbookPath, "Correctness and Meaning", [
        /names, numbers, units, versions, flags, options, and paths/u,
        /proposal[^\n]+decision[^\n]+assumption[^\n]+fact/u,
        /optional[^\n]+required[^\n]+planned or pending check[^\n]+passed check/u,
        /claim strength and specificity to the evidence/u,
        /named attribution to a specific inspectable point/u,
        // `comments only` and `no behavioural changes` have different falsifiers; one rule for both produced a false verdict on a local rename.
        /`comments only` is false when the diff changes executable code/u,
        /a rename may be non-behavioural but is never `comments only`/u,
      ]);
      assertSectionPatterns(playbookPath, "Before Editing Existing Prose", [
        /human-authored, generated, mixed, or unknown/u,
        /lightest effective edit/u,
        /Unknown provenance/u,
        /Protect strong human passages/u,
        /verified claims, not synonym substitutions/u,
      ]);
      assertSectionPatterns(playbookPath, "Audience and Precision", [
        /Precision is not a defect/u,
        /Replies to people carry social meaning/u,
        // One replies permission: Audience defers to the Scope Gate instead of adding a diagnosed social cost as a fourth edit reason.
        /Scope Gate sets the permission/u,
      ]);
      assertSectionPatterns(playbookPath, "Integrity", [
        /Never invent an incident/u,
        /illustrative example must be labelled as illustrative/u,
      ]);
      assertSectionPatterns(playbookPath, "Quick Tests", [
        /Substitution test/u,
        /raises suspicion, not proof/u,
      ]);
      assertSectionPatterns(playbookPath, "Stop Rules", [
        /If the minimum pass is clean, stop editing/u,
      ]);
      assertSectionPatterns(playbookPath, "Verification Gate", [
        /status, requirement level, uncertainty, and provenance/u,
        /Scope Gate[\s\S]+source classification applied/u,
        /claim strength, attribution, and cited claims/u,
      ]);
    }
  });

  it("owns sentence diagnostics without turning lexical signals into verdicts", () => {
    for (const playbookPath of [
      "workflow/skills/playbooks/writing-sentence-diagnostics.md",
      ".goat-flow/skill-docs/playbooks/writing-sentence-diagnostics.md",
    ]) {
      assertSectionPatterns(playbookPath, "Register", [
        /Neutral and conventional are valid voices/u,
        // Case-insensitive on the verb: the playbook shipped a mid-sentence capital "Do" that this assertion pinned verbatim, so correcting the
        // typo failed a contract meant to guarantee the rule exists, not its capitalisation.
        /reader already knows[\s\S]+do not define it again/iu,
      ]);
      assertSectionPatterns(playbookPath, "Diagnostic Route", [
        /component as the actor when the component performs the action/u,
        /person or team only when responsibility is relevant and evidenced/u,
      ]);
      assertSectionPatterns(playbookPath, "Candidate Patterns", [
        /verified meaning/u,
        /diagnose reader cost, not authorship/u,
        /Assistant voice/u,
        /Residue/u,
      ]);

      const guards = readMarkdownSection(
        playbookPath,
        "Guards Against Misapplication",
      );
      assert.match(guards, /Ordinary writing habits are not defects/u);
      assert.match(
        guards,
        /AI-density, banned-word, and rhythm counts are suspicion signals only/u,
        playbookPath,
      );
      assert.match(
        guards,
        /never diagnose a defect, authorize an edit, or produce a pass\/fail result/u,
        playbookPath,
      );
      assert.match(
        guards,
        /Do not run a broad punctuation sweep/u,
        playbookPath,
      );
      assert.doesNotMatch(
        readProjectFile(playbookPath),
        /\u2014/u,
        `${playbookPath}: new prose must not introduce em dashes`,
      );

      assertSectionPatterns(playbookPath, "Quick Tests", [
        /Read it aloud/u,
        /Feelings check/u,
      ]);

      const workedExample = readMarkdownSection(playbookPath, "Worked Example");
      assert.match(workedExample, /Illustrative example \(not evidence/u);
    }
  });

  it("owns document-level structure diagnostics and protects parallel forms", () => {
    for (const playbookPath of [
      "workflow/skills/playbooks/writing-structure-diagnostics.md",
      ".goat-flow/skill-docs/playbooks/writing-structure-diagnostics.md",
    ]) {
      const structure = readMarkdownSection(playbookPath, "Structure");
      for (const requiredAnchor of [
        /Duplicate representation/u,
        /Append seam/u,
        /Compound entries/u,
        /Parallel lists/u,
        /Causal prose/u,
        /Padded triads/u,
        /Process bleed/u,
      ]) {
        assert.match(structure, requiredAnchor, playbookPath);
      }
      assert.match(structure, /chronology[\s\S]+cause or constraint/u);
      assert.match(structure, /Catalogue-shaped repetition is exempt/u);
      assert.match(structure, /Reference-list labels remain valid/u);

      const guards = readMarkdownSection(
        playbookPath,
        "Guards Against Misapplication",
      );
      assert.match(guards, /Tables and code are intentionally parallel/u);
      assert.match(guards, /Plan uniformity is control grammar/u);

      const workedExamples = readMarkdownSection(
        playbookPath,
        "Worked Structural Examples",
      );
      assert.match(workedExamples, /Illustrative examples \(not evidence/u);
      assert.doesNotMatch(
        readProjectFile(playbookPath),
        /\u2014/u,
        playbookPath,
      );
    }
  });

  it("makes product users and fact-preserving release state explicit", () => {
    for (const playbookPath of [
      "workflow/skills/playbooks/changelog.md",
      ".goat-flow/skill-docs/playbooks/changelog.md",
    ]) {
      const audienceGate = readMarkdownSection(playbookPath, "Audience Gate");
      assert.match(
        audienceGate,
        /person who uses, calls, operates, or upgrades the shipped product/u,
        playbookPath,
      );
      assert.match(audienceGate, /Do not invent a UI/u, playbookPath);
      assert.match(
        audienceGate,
        /affected surface, consequence, risk, and required action/u,
        playbookPath,
      );
      assert.match(
        audienceGate,
        /Internal tooling is omitted unless it changes user behaviour or release safety/u,
        playbookPath,
      );

      const releaseState = readMarkdownSection(
        playbookPath,
        "Release State and Version Attribution",
      );
      assert.match(releaseState, /last published release/u, playbookPath);
      assert.match(releaseState, /Unreleased[\s\S]+net state that will ship/u);
      assert.match(releaseState, /one version and one category/u, playbookPath);

      const historicalEditing = readMarkdownSection(
        playbookPath,
        "Historical Editing",
      );
      assert.match(historicalEditing, /fact-preserving cleanup/u);
      assert.match(
        historicalEditing,
        /version attribution, public identifiers, measurements, regressions, chronology, and migration facts/u,
        playbookPath,
      );

      const lengthFallback = readMarkdownSection(
        playbookPath,
        "Length Fallback",
      );
      assert.match(
        lengthFallback,
        /project or release surface owns no different shape/u,
      );
      assert.match(lengthFallback, /150 characters/u, playbookPath);
      assert.match(
        lengthFallback,
        /Never generalise an exact public flag, config key, version, error, or measurement to meet the fallback/u,
        playbookPath,
      );
      assert.doesNotMatch(
        readProjectFile(playbookPath),
        /\u2014/u,
        playbookPath,
      );
    }

    for (const playbookPath of [
      "workflow/skills/playbooks/release-notes.md",
      ".goat-flow/skill-docs/playbooks/release-notes.md",
    ]) {
      const audienceGate = readMarkdownSection(playbookPath, "Audience Gate");
      assert.match(
        audienceGate,
        /person who uses, calls, operates, or upgrades the shipped product/u,
        playbookPath,
      );
      assert.match(audienceGate, /Do not invent a UI/u, playbookPath);
      assert.match(
        audienceGate,
        /Internal-only work is excluded unless it changes user behaviour or release safety/u,
        playbookPath,
      );

      const outputProvenance = readMarkdownSection(
        playbookPath,
        "Output Provenance",
      );
      assert.match(outputProvenance, /diff -> changelog -> release notes/u);
      assert.match(outputProvenance, /Do not summarize from memory/u);

      const writingRules = readMarkdownSection(playbookPath, "Writing Rules");
      assert.match(
        writingRules,
        /effect, then consequence, then required action/u,
        playbookPath,
      );
      assert.match(writingRules, /visible regression/u, playbookPath);

      const lengthFallback = readMarkdownSection(
        playbookPath,
        "Length Fallback",
      );
      assert.match(
        lengthFallback,
        /project or release surface owns no different shape/u,
      );
      assert.match(lengthFallback, /150 characters/u, playbookPath);
      assert.doesNotMatch(
        readProjectFile(playbookPath),
        /\u2014/u,
        playbookPath,
      );
    }
  });

  it("keeps all routed writing playbooks independently discoverable", () => {
    for (const readmePath of [
      "workflow/skills/playbooks/README.md",
      ".goat-flow/skill-docs/playbooks/README.md",
    ]) {
      const readme = readProjectFile(readmePath);
      assert.match(readme, /writing-style\.md[^\n]+correctness router/u);
      assert.match(
        readme,
        /writing-sentence-diagnostics\.md[^\n]+sentence-level reader cost/u,
      );
      assert.match(
        readme,
        /writing-structure-diagnostics\.md[^\n]+document-level assembly/u,
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
