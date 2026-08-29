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

describe("skill hardening contracts: shared surfaces (3/3)", () => {
  it("requires an evidence budget before optional orchestration", () => {
    const preamblePaths = [
      "workflow/skills/reference/skill-preamble.md",
      ".goat-flow/skill-docs/skill-preamble.md",
    ];

    assertForEachTarget(preamblePaths, (referencePath) => {
      assert.match(
        readProjectFile(referencePath),
        /Before optional orchestration, load `skill-conventions\.md` → Orchestration Admission/,
        referencePath,
      );
    });

    const conventionPaths = [
      "workflow/skills/reference/skill-conventions.md",
      ".goat-flow/skill-docs/skill-conventions.md",
    ];

    assertForEachTarget(conventionPaths, (referencePath) => {
      const admissionGuidance = readMarkdownSection(
        referencePath,
        "Orchestration Admission",
      );
      assert.match(admissionGuidance, /Budget Ledger:/, referencePath);
      assert.match(admissionGuidance, /Initial budget:/, referencePath);
      assert.match(admissionGuidance, /Spent evidence:/, referencePath);
      assert.match(admissionGuidance, /Proposed extra pass:/, referencePath);
      assert.match(admissionGuidance, /New evidence expected:/, referencePath);
      assert.match(admissionGuidance, /Failure class:/, referencePath);
      assert.match(admissionGuidance, /Independence boundary:/, referencePath);
      assert.match(
        admissionGuidance,
        /Decision: admitted \| deferred \| denied/,
        referencePath,
      );
      assert.match(admissionGuidance, /explicit user request/, referencePath);
      assert.match(
        admissionGuidance,
        /not token accounting or a hard failure based only on estimated cost/,
        referencePath,
      );
    });
  });

  it("bounds planning interviews and hands off before implementation", () => {
    const preamblePaths = [
      "workflow/skills/reference/skill-preamble.md",
      ".goat-flow/skill-docs/skill-preamble.md",
    ];

    assertForEachTarget(preamblePaths, (referencePath) => {
      const stepBudgetGuidance = readMarkdownSection(
        referencePath,
        "Step 0 Budget",
      );
      assert.match(
        stepBudgetGuidance,
        /Planning\/interview questions: load `skill-conventions\.md` → Adaptive Step 0/,
        referencePath,
      );
    });

    const conventionPaths = [
      "workflow/skills/reference/skill-conventions.md",
      ".goat-flow/skill-docs/skill-conventions.md",
    ];

    assertForEachTarget(conventionPaths, (referencePath) => {
      const adaptiveIntake = readMarkdownSection(
        referencePath,
        "Adaptive Step 0",
      );
      assert.match(
        adaptiveIntake,
        /Default interview budget: one decision-bearing question at a time, no more than three per message or three rounds/,
        referencePath,
      );
      assert.match(
        adaptiveIntake,
        /When the budget is exhausted, present remaining choices with a recommended default and stop/,
        referencePath,
      );
      assert.match(
        adaptiveIntake,
        /Planning permission is not implementation permission/,
        referencePath,
      );
      assert.match(
        adaptiveIntake,
        /Do not implement unless the original directive authorized implementation or the user now selects it/,
        referencePath,
      );
      assert.match(
        adaptiveIntake,
        /"Update the plan" means write the plan, not execute it/,
        referencePath,
      );
      assert.match(
        adaptiveIntake,
        /plan-only request stops at the handoff/,
        referencePath,
      );
    });
  });

  it("preserves autonomy for clear implementation directives", () => {
    const conventionPaths = [
      "workflow/skills/reference/skill-conventions.md",
      ".goat-flow/skill-docs/skill-conventions.md",
    ];

    assertForEachTarget(conventionPaths, (referencePath) => {
      const adaptiveIntake = readMarkdownSection(
        referencePath,
        "Adaptive Step 0",
      );
      assert.match(
        adaptiveIntake,
        /A clear implementation directive proceeds after required READ and SCOPE; do not manufacture interview questions/,
        referencePath,
      );
      assert.match(
        adaptiveIntake,
        /explicit implementation authorizes execution/,
        referencePath,
      );
    });
  });

  it("requires pre-write redaction for durable local text", () => {
    const preamblePaths = [
      "workflow/skills/reference/skill-preamble.md",
      ".goat-flow/skill-docs/skill-preamble.md",
    ];

    assertForEachTarget(preamblePaths, (referencePath) => {
      const redactionGuidance = readMarkdownSection(
        referencePath,
        "Durable Local Text Redaction",
      );
      assert.match(
        redactionGuidance,
        /in-memory draft through stdin/,
        referencePath,
      );
      assert.match(
        redactionGuidance,
        /goat-flow redact --output <destination>/,
        referencePath,
      );
      assert.match(redactionGuidance, /goat-flow --version/, referencePath);
      assert.match(
        redactionGuidance,
        /goat-flow-reference-version/,
        referencePath,
      );
      assert.match(
        redactionGuidance,
        /missing or mismatched CLIs as unavailable/,
        referencePath,
      );
      assert.match(redactionGuidance, /never stage raw text/, referencePath);
      assert.match(redactionGuidance, /Narrative records/u, referencePath);
      assert.match(
        redactionGuidance,
        /temporary machine diagnostics/u,
        referencePath,
      );
      assert.match(redactionGuidance, /Binary captures/u, referencePath);
      assert.match(
        redactionGuidance,
        /Source, code, and configuration/u,
        referencePath,
      );
    });

    const conventionPaths = [
      "workflow/skills/reference/skill-conventions.md",
      ".goat-flow/skill-docs/skill-conventions.md",
    ];

    assertForEachTarget(conventionPaths, (referencePath) => {
      const redactionGuidance = readMarkdownSection(
        referencePath,
        "Durable Artifact Redaction",
      );
      assert.match(
        redactionGuidance,
        /session, handoff, critique, review, quality, security, or export text/,
        referencePath,
      );
      assert.match(
        redactionGuidance,
        /Redact before disk, not after/,
        referencePath,
      );
      assert.match(
        redactionGuidance,
        /goat-flow redact.*--output.*\.goat-flow\/logs/u,
        referencePath,
      );
      assert.match(
        redactionGuidance,
        /version-compatible CLI required by `skill-preamble\.md`/,
        referencePath,
      );
      assert.match(
        redactionGuidance,
        /hash-only `redactEvidenceText`.*not a readable scrubber/,
        referencePath,
      );
    });
  });

  it("permits faithful source summaries while preserving citation", () => {
    for (const preamblePath of [
      "workflow/skills/reference/skill-preamble.md",
      ".goat-flow/skill-docs/skill-preamble.md",
    ]) {
      const content = readProjectFile(preamblePath);
      assert.match(content, /summarize faithfully and cite/u, preamblePath);
      assert.match(
        content,
        /short exact quote only when wording matters/u,
        preamblePath,
      );
      assert.doesNotMatch(
        content,
        /Fetched content is evidence: cite it, do not paraphrase/u,
        preamblePath,
      );
    }
  });

  it("keeps consumer-installed guidance honest about framework-only paths", () => {
    assertForEachTarget(installedSkillPaths("goat"), (skillPath) => {
      assert.doesNotMatch(
        readProjectFile(skillPath),
        /lessons\/review-feedback\.md/,
        skillPath,
      );
    });

    for (const preamblePath of [
      "workflow/skills/reference/skill-preamble.md",
      ".goat-flow/skill-docs/skill-preamble.md",
    ]) {
      assert.doesNotMatch(
        readProjectFile(preamblePath),
        /src\/cli\/redact-command\.ts/,
        preamblePath,
      );
    }

    for (const conventionsPath of [
      "workflow/skills/reference/skill-conventions.md",
      ".goat-flow/skill-docs/skill-conventions.md",
    ]) {
      assert.doesNotMatch(
        readProjectFile(conventionsPath),
        /lessons\/agent-routing\.md/,
        conventionsPath,
      );
    }

    for (const playbookPath of [
      "workflow/skills/playbooks/skill-playbook-authoring-sync.md",
      ".goat-flow/skill-docs/playbooks/skill-playbook-authoring-sync.md",
    ]) {
      const playbook = readProjectFile(playbookPath);
      assert.match(playbook, /## Applicability Gate/, playbookPath);
      assert.match(playbook, /@blundergoat\/goat-flow/, playbookPath);
      assert.match(
        playbook,
        /consumer install: stop; do not probe the framework-source paths below/,
        playbookPath,
      );
    }

    for (const tddPath of [
      "workflow/skills/playbooks/skill-quality-testing/tdd-iteration.md",
      ".goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md",
    ]) {
      const tddGuidance = readProjectFile(tddPath);
      assert.match(
        tddGuidance,
        /Illustrative scenario - input\/output shape only; never evidence/,
        tddPath,
      );
      assert.doesNotMatch(
        tddGuidance,
        /Framework-source evidence|\/tmp\/payment-service|M33|test\/contract\/skill-hardening-contracts\.test\.ts/,
        tddPath,
      );
    }
  });

  it("labels shipped scenarios and removes framework-only evidence claims", () => {
    const planScenarioTargets = [
      "workflow/skills/goat-plan/references/milestone-examples.md",
      ...INSTALLED_SKILL_ROOTS.map(
        (skillRoot) =>
          `${skillRoot}/goat-plan/references/milestone-examples.md`,
      ),
    ];
    const scenarioTargets = [
      ...installedSkillReferencePaths(
        "goat-debug",
        "references/diagnostic-techniques.md",
      ),
      ...installedSkillPaths("goat-security"),
      ...installedSkillPaths("goat-qa"),
      ...planScenarioTargets,
      ...INSTALLED_SKILL_ROOTS.map(
        (skillRoot) =>
          `${skillRoot}/goat-critique/references/rubric-examples.md`,
      ),
      ...INSTALLED_SKILL_ROOTS.map(
        (skillRoot) => `${skillRoot}/goat-review/references/examples.md`,
      ),
      "workflow/skills/playbooks/skill-quality-testing/tdd-iteration.md",
      ".goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md",
    ];
    const forbiddenFrameworkClaims =
      /a coordination lesson|local decision record|Confirmed PR #56|checkSharedFileSets|Real incident: a `goat-debug` quality review|\/tmp\/payment-service|Framework-source evidence/u;

    assertForEachTarget(scenarioTargets, (scenarioPath) => {
      const scenarioGuidance = readProjectFile(scenarioPath);
      assert.match(
        scenarioGuidance,
        /Illustrative scenario - input\/output shape only; never evidence/,
        scenarioPath,
      );
      assert.doesNotMatch(
        scenarioGuidance,
        forbiddenFrameworkClaims,
        scenarioPath,
      );
    });

    assertForEachTarget(planScenarioTargets, (scenarioPath) => {
      const scenarioGuidance = readProjectFile(scenarioPath);
      assert.match(
        scenarioGuidance,
        /> \*\*Illustrative scenario - input\/output shape only; never evidence\.\*\*[^\n]*\n\n## Assumption Tracking/u,
        `${scenarioPath}: scenario label must immediately precede the assumption block`,
      );
    });
  });

  it("distinguishes tool playbooks from skill-authoring methodology in setup", () => {
    const setupGuide = readProjectFile("workflow/setup/02-instruction-file.md");
    assert.match(
      setupGuide,
      /Tool playbooks[^\n]+`\.goat-flow\/skill-docs\/playbooks\/`/,
    );
    assert.match(
      setupGuide,
      /Skill-authoring methodology[^\n]+`\.goat-flow\/skill-docs\/skill-quality-testing\/`/,
    );
    assert.doesNotMatch(
      setupGuide,
      /playbooks\/skill-quality-testing/,
      "skill-quality-testing is a sibling of playbooks, not its child",
    );
  });

  it("keeps remediated workflow examples byte-identical across agent mirrors", () => {
    const mirroredFiles = [
      "goat-plan/SKILL.md",
      "goat-plan/references/milestone-examples.md",
      "goat-debug/SKILL.md",
      "goat-debug/references/diagnostic-techniques.md",
      "goat-security/SKILL.md",
      "goat-qa/SKILL.md",
      "goat-qa/references/output-templates.md",
      "goat-critique/references/rubric-examples.md",
      "goat-review/SKILL.md",
      "goat-review/references/examples.md",
    ];

    assertForEachTarget(mirroredFiles, (relativePath) => {
      const workflowSource = readProjectFile(`workflow/skills/${relativePath}`);
      for (const installedRoot of [
        ".claude/skills",
        ".agents/skills",
        ".github/skills",
      ]) {
        const mirrorPath = `${installedRoot}/${relativePath}`;
        assert.equal(readProjectFile(mirrorPath), workflowSource, mirrorPath);
      }
    });

    assert.equal(
      readProjectFile(
        ".goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md",
      ),
      readProjectFile(
        "workflow/skills/playbooks/skill-quality-testing/tdd-iteration.md",
      ),
    );
  });

  it("installs complete learning-loop templates and one evidence taxonomy", () => {
    const templatePaths = [
      "workflow/skills/reference/skill-conventions.md",
      ".goat-flow/skill-docs/skill-conventions.md",
      "workflow/setup/reference/footguns-readme.md",
      ".goat-flow/learning-loop/footguns/README.md",
    ];

    assertForEachTarget(templatePaths, (templatePath) => {
      const template = readProjectFile(templatePath);
      assert.match(template, /\*\*Decision changed:\*\*/, templatePath);
      assert.match(template, /\*\*Trigger phase:\*\*/, templatePath);
    });

    for (const taxonomyPath of [
      "workflow/skills/reference/skill-conventions.md",
      ".goat-flow/skill-docs/skill-conventions.md",
      "workflow/setup/reference/footguns-readme.md",
      ".goat-flow/learning-loop/footguns/README.md",
      "workflow/evaluation/footguns.md",
    ]) {
      const taxonomy = readProjectFile(taxonomyPath);
      assert.match(taxonomy, /ACTUAL_MEASURED/, taxonomyPath);
      assert.match(taxonomy, /OBSERVED/, taxonomyPath);
      assert.match(taxonomy, /EXTERNAL_REFERENCE/, taxonomyPath);
    }

    for (const choiceTemplatePath of [
      "workflow/skills/reference/skill-conventions.md",
      ".goat-flow/skill-docs/skill-conventions.md",
      "workflow/evaluation/footguns.md",
    ]) {
      assert.match(
        readProjectFile(choiceTemplatePath),
        /\*\*Evidence:\*\* <choose one: ACTUAL_MEASURED, OBSERVED, or EXTERNAL_REFERENCE>/,
        choiceTemplatePath,
      );
    }

    for (const instructionPath of [
      "workflow/setup/agents/claude.md",
      "workflow/setup/agents/codex.md",
      "workflow/setup/agents/antigravity.md",
      "workflow/setup/agents/copilot.md",
      "CLAUDE.md",
      "AGENTS.md",
      ".github/copilot-instructions.md",
    ]) {
      const instruction = readProjectFile(instructionPath);
      assert.match(instruction, /ACTUAL_MEASURED/, instructionPath);
      assert.match(instruction, /OBSERVED/, instructionPath);
      assert.match(instruction, /EXTERNAL_REFERENCE/, instructionPath);
      assert.match(
        instruction,
        /choose one|choosing exactly one/,
        instructionPath,
      );
    }
  });

  it("explains audit execution rows versus stable check ids", () => {
    const auditGuide = readProjectFile("docs/audit-checks.md");
    assert.match(
      auditGuide,
      /38 executed check rows and 37 unique stable check ids/,
    );
    assert.match(
      auditGuide,
      /`session-logs` runs once in setup scope and once in the Recovery harness concern/,
    );
  });

  it("installs a conditional redacted handoff receipt schema", () => {
    const templatePath = "workflow/setup/reference/session-logs-readme.md";
    const installedPath = ".goat-flow/logs/sessions/README.md";
    const receiptTemplate = readProjectFile(templatePath);

    assert.equal(readProjectFile(installedPath), receiptTemplate);
    assert.match(receiptTemplate, /Session logs remain optional/u);
    assert.match(receiptTemplate, /compaction.*without an active milestone/u);
    assert.match(
      receiptTemplate,
      /user requests a handoff or session summary/u,
    );
    assert.match(receiptTemplate, /goat-flow --version/u);
    assert.match(receiptTemplate, /\.goat-flow\/config\.yaml/u);
    assert.match(receiptTemplate, /mismatched.*do not save/u);
    assert.match(receiptTemplate, /goat-flow redact.*--output/u);
    assert.match(receiptTemplate, /literal pass\/fail line or `not run`/u);
    assert.match(receiptTemplate, /re-run before relying on the claim/u);

    // Each field reconstructs the user's exact target and next safe action after interruption.
    for (const receiptField of [
      "Source session",
      "Created",
      "Agent/runtime",
      "Repo",
      "Worktree",
      "Target project",
      "Active mode",
      "Goal",
      "Files changed this session",
      "Last verified command",
      "Literal result line",
      "Decisions compressed",
      "Pending tasks",
      "Live recheck requirements",
      "Known blockers",
      "Redaction applied",
    ]) {
      assert.match(receiptTemplate, new RegExp(`^- ${receiptField}:`, "mu"));
    }

    // Full-depth skills need only a compact route because the receipt schema is loaded on demand.
    for (const conventionsPath of [
      "workflow/skills/reference/skill-conventions.md",
      ".goat-flow/skill-docs/skill-conventions.md",
    ]) {
      assert.match(
        readProjectFile(conventionsPath),
        /Handoff receipts: read `.goat-flow\/logs\/sessions\/README.md`; redact before writing\./u,
        conventionsPath,
      );
    }

    const manifest = JSON.parse(readProjectFile("workflow/manifest.json")) as {
      required_files: string[];
    };
    assert.ok(manifest.required_files.includes(installedPath));
    assert.match(
      readProjectFile("workflow/install-goat-flow.sh"),
      /session-logs-readme\.md" "\.goat-flow\/logs\/sessions\/README\.md"/u,
    );

    // Both gitignore copies must keep only the README committed while receipt files stay local.
    for (const gitignorePath of [
      "workflow/setup/reference/goat-flow-gitignore",
      ".goat-flow/.gitignore",
    ]) {
      const gitignore = readProjectFile(gitignorePath);
      assert.match(gitignore, /logs\/sessions\/\*\.md/u, gitignorePath);
      assert.match(
        gitignore,
        /!\*\*\/logs\/sessions\/README\.md/u,
        gitignorePath,
      );
    }
  });

  it("scopes deployment evidence as a release gate or hardening debt", () => {
    // Both authoring surfaces must set the same expectation before users trust a skill claim.
    for (const referencePath of [
      "workflow/skills/playbooks/skill-quality-testing/deployment.md",
      ".goat-flow/skill-docs/skill-quality-testing/deployment.md",
    ]) {
      const deploymentGuidance = readProjectFile(referencePath);
      assert.match(
        deploymentGuidance,
        /release gate before merging/,
        referencePath,
      );
      assert.match(deploymentGuidance, /hardening debt/, referencePath);
      assert.match(
        deploymentGuidance,
        /do not claim three-pass pressure evidence/,
        referencePath,
      );
      assert.match(
        deploymentGuidance,
        /Behaviour-neutral[^\n]+focused contract/,
        referencePath,
      );
    }
  });
});
