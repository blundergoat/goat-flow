/**
 * Contracts for planning and timing guidance: milestone structure, effort and forecast
 * obligations, and the accounting a user is promised across installed copies.
 *
 * Reads the installed copies rather than sources, so a contract fails when the guidance a user
 * actually receives drifts - not merely when the template does.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertForEachTarget,
  countSkillBodyWords,
  installedSkillPaths,
  installedSkillReferencePaths,
  readMarkdownSection,
  readProjectFile,
  INSTALLED_SKILL_ROOTS,
} from "./skill-hardening.helpers.js";

describe("skill hardening contracts: goat-plan (2/2)", () => {
  it("defines proportional goat-plan renderings and a mixed-audience ISSUE contract", () => {
    assertForEachTarget(installedSkillPaths("goat-plan"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(
        skillGuidance,
        /Budget determines must-deliver scope, ranked stretch work, and cut order/u,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /Small, Standard, or high-risk rendering/u,
        skillPath,
      );
      assert.match(skillGuidance, /Archetypes are optional lenses/u, skillPath);
    });

    assertForEachTarget(
      installedSkillReferencePaths("goat-plan", "references/issue-format.md"),
      (issuePath) => {
        const issueGuidance = readProjectFile(issuePath);
        const orderedHeadings = [
          "## Outcome",
          "## At a glance",
          "## What we lose without this",
          "## Why this helps",
          "## What",
          "## How",
          "## Out of scope",
        ];
        const issueLines = issueGuidance.split(/\r?\n/u);
        const headingIndexes = orderedHeadings.map((heading) =>
          issueLines.findIndex((line) => line === heading),
        );

        assert.ok(
          headingIndexes.every((index) => index >= 0),
          `${issuePath}: missing mixed-audience ISSUE heading`,
        );
        assert.ok(
          headingIndexes.every(
            (index, position) =>
              position === 0 || headingIndexes[position - 1] < index,
          ),
          `${issuePath}: mixed-audience ISSUE headings are out of order`,
        );
        assert.match(
          issueGuidance,
          /GitHub readers across technical levels/u,
          issuePath,
        );
        assert.match(
          issueGuidance,
          /10-20 visible words on one physical line/u,
          issuePath,
        );
        assert.match(
          issueGuidance,
          /open at authoring and close only after verified delivery/u,
          issuePath,
        );
        assert.match(issueGuidance, /= <agent-time range>/u, issuePath);
        assert.match(
          issueGuidance,
          /delivery band.*derived from.*milestone forecast/isu,
          `${issuePath}: ISSUE delivery bands are not derived from milestones`,
        );
        assert.match(
          issueGuidance,
          /never.*input.*milestone estimate/isu,
          `${issuePath}: ISSUE bands can still anchor milestone estimates`,
        );
        assert.match(
          issueGuidance,
          /800 words and 60 nonblank lines/u,
          issuePath,
        );
        assert.match(
          issueGuidance,
          /above 1,200 words names the safety reason/u,
          issuePath,
        );
      },
    );
  });

  /*
   * The two plain-language sections are the only part of a milestone a reader outside the project can act on.
   * Renaming them back to jargon, or dropping the worked BAD/GOOD pair that carries the register, returns plans to
   * internal vocabulary, so the demonstration is pinned alongside the names.
   */
  it("pins the plain-language milestone sections and the example that shows their register", () => {
    assertForEachTarget(installedSkillPaths("goat-plan"), (skillPath) => {
      assert.match(
        readProjectFile(skillPath),
        /`## What we lose without this` and `## Why this helps` between Objective and Context, one plain line each/u,
        skillPath,
      );
    });

    assertForEachTarget(
      installedSkillReferencePaths(
        "goat-plan",
        "references/milestone-examples.md",
      ),
      (examplesPath) => {
        const examples = readProjectFile(examplesPath);
        const templateLines = examples.split(/\r?\n/u);
        const lossIndex = templateLines.indexOf("## What we lose without this");
        const helpIndex = templateLines.indexOf("## Why this helps");

        assert.ok(lossIndex >= 0, `${examplesPath}: missing loss section`);
        assert.ok(
          helpIndex > lossIndex,
          `${examplesPath}: cost must precede benefit in the milestone template`,
        );
        assert.match(
          examples,
          /one concrete, jargon-free line a reader outside the project understands/u,
          examplesPath,
        );
        assert.match(examples, /^- BAD: /mu, examplesPath);
        assert.match(examples, /^- GOOD: /mu, examplesPath);

        // An author trimming for the word cap deletes these three rules first, and every other check here still passes without
        // them: correct headings, correct order, one line each, written by compressing the Objective into shorter jargon.
        for (const derivationRule of [
          /not by shortening the Objective/u,
          /benefit line just negates the cost line/u,
          /spike that ships nothing says so/u,
        ]) {
          assert.match(examples, derivationRule, examplesPath);
        }
        assert.doesNotMatch(
          examples,
          /How users will notice the difference|^\| Motivation \|/mu,
          `${examplesPath}: superseded section names are still present`,
        );
      },
    );
  });

  /*
   * A user starting a Standard plan needs an ISSUE.md beside the milestone files.
   * The format reference guides that artifact and must stay unchanged.
   */
  it("writes the user-facing ISSUE artifact without treating its format reference as output", () => {
    assertForEachTarget(installedSkillPaths("goat-plan"), (skillPath) => {
      const planGuidance = readProjectFile(skillPath);

      assert.match(
        planGuidance,
        /\*\*ISSUE\.md:\*\* Standard\+ writes `ISSUE\.md` using `references\/issue-format\.md`/u,
        skillPath,
      );
      assert.doesNotMatch(
        planGuidance,
        /Standard\+ writes `references\/issue-format\.md`/u,
        skillPath,
      );
    });
  });

  it("keeps public goat-plan consumers aligned with proportional planning", () => {
    const presetCatalog = JSON.parse(
      readProjectFile("src/dashboard/preset-prompts.json"),
    ) as { id?: string; prompt?: string }[];
    const milestonePreset = presetCatalog.find(
      (preset) => preset.id === "milestones",
    );
    assert.ok(milestonePreset?.prompt, "missing milestones preset");
    assert.match(milestonePreset.prompt, /delivery budget/u);
    assert.match(milestonePreset.prompt, /coding-agent time/u);
    assert.match(milestonePreset.prompt, /named uncertainty/u);
    assert.match(milestonePreset.prompt, /merge or omit/u);
    assert.doesNotMatch(milestonePreset.prompt, /always a spike/u);
    assert.doesNotMatch(milestonePreset.prompt, /\d+-\d+ days/u);

    const publicPlanGuidance = readMarkdownSection(
      "docs/skills.md",
      "/goat-plan",
    );
    assert.match(publicPlanGuidance, /delivery budget controls scope/u);
    assert.match(publicPlanGuidance, /coding-agent time/u);
    assert.match(publicPlanGuidance, /optional planning lenses/u);
    assert.match(publicPlanGuidance, /one compact file/u);
    assert.match(publicPlanGuidance, /claim → evidence/u);

    const exporterLesson = readMarkdownSection(
      ".goat-flow/learning-loop/lessons/milestone-accounting.md",
      "Lesson: Milestone plans need exporter-contract verification before handoff",
    );
    assert.match(
      exporterLesson,
      /At that revision, the exporter accepted only the bold `Objective` field/u,
    );
    assert.match(
      exporterLesson,
      /Current objective parsing accepts a bold field, an `## Objective` section, or the outcome title/u,
    );
  });

  it("keeps the redesigned goat-plan canonical surface within its tighter budget", () => {
    assert.ok(
      countSkillBodyWords("workflow/skills/goat-plan/SKILL.md") <= 2150,
      "workflow goat-plan must stay at or below the redesign target of 2150 words",
    );

    const canonicalSurfaceWords = [
      "workflow/skills/goat-plan/SKILL.md",
      "workflow/skills/goat-plan/references/milestone-examples.md",
      "workflow/skills/goat-plan/references/issue-format.md",
    ]
      .map((filePath) => readProjectFile(filePath))
      .join("\n")
      .split(/\s+/u)
      .filter(Boolean).length;

    // The obvious way to buy room here is cutting the restating Verification baseline and Maintenance notes subsections,
    // but the "keeps goat-plan handoff artifacts drift-aware" contract pins them, so that trim costs a shipped check.
    assert.ok(
      canonicalSurfaceWords <= 4700,
      `canonical goat-plan surface has ${canonicalSurfaceWords} words; expected at most 4700`,
    );
  });

  it("aligns goat-plan lifecycle guidance with human-verification-pending", () => {
    assertForEachTarget(installedSkillPaths("goat-plan"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(
        skillGuidance,
        /Successful AI proof records structured `Actual:` and sets `human-verification-pending`/u,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /Human-requested changes return the milestone to `in-progress`/u,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /final pending milestone enters the combined Phase 4 review/u,
        skillPath,
      );
    });

    for (const conventionsPath of [
      "workflow/skills/reference/skill-conventions.md",
      ".goat-flow/skill-docs/skill-conventions.md",
    ]) {
      const conventions = readProjectFile(conventionsPath);
      assert.match(
        conventions,
        /Successful AI proof records structured `Actual:` and sets `human-verification-pending`/u,
        conventionsPath,
      );
      assert.match(
        conventions,
        /Human-requested changes return it to `in-progress`/u,
        conventionsPath,
      );
    }
  });

  // A user handing work to a fresh agent needs the same drift-safe plan in every runner.

  it("keeps goat-plan handoff artifacts drift-aware without burdening small plans", () => {
    // Every installed reference must expose the detailed template linked from its skill.
    const milestoneExamplePaths = INSTALLED_SKILL_ROOTS.map(
      (skillRoot) => `${skillRoot}/goat-plan/references/milestone-examples.md`,
    );

    assertForEachTarget(installedSkillPaths("goat-plan"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(skillGuidance, /Handoff-grade artifacts/, skillPath);
      assert.match(
        skillGuidance,
        /references\/milestone-examples\.md/u,
        skillPath,
      );
      assert.match(skillGuidance, /Small File-Write stays compact/, skillPath);
    });

    assertForEachTarget(milestoneExamplePaths, (examplePath) => {
      const milestoneExample = readProjectFile(examplePath);
      assert.match(
        milestoneExample,
        /## Handoff-grade milestone template/,
        examplePath,
      );
      assert.match(milestoneExample, /\*\*Planned at:\*\*/, examplePath);
      assert.match(
        milestoneExample,
        /git diff --stat <sha> -- <paths>/,
        examplePath,
      );
      assert.match(
        milestoneExample,
        /git status --short -- <paths>/,
        examplePath,
      );
      assert.match(
        milestoneExample,
        /\| Command \| Expected result \|/,
        examplePath,
      );
      assert.match(milestoneExample, /### Verification baseline/, examplePath);
      assert.match(milestoneExample, /### Maintenance notes/, examplePath);
    });
  });

  // A user resuming old local work needs status reconciliation without accidental implementation.

  it("keeps goat-plan reconciliation local and status-aware", () => {
    assertForEachTarget(installedSkillPaths("goat-plan"), (skillPath) => {
      const skillGuidance = readProjectFile(skillPath);
      assert.match(
        skillGuidance,
        /### Reconcile Existing Plan State/,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /report each canonical Status token with a plain-language explanation/u,
        skillPath,
      );
      assert.match(
        skillGuidance,
        /local workflow state, not a setup invariant/,
        skillPath,
      );
      assert.doesNotMatch(skillGuidance, /execute <plan>/, skillPath);
    });
  });

  it("makes goat-qa Audit mode assess misaligned effort without inventing it", () => {
    assertForEachTarget(installedSkillPaths("goat-qa"), (skillPath) => {
      const auditMode = readMarkdownSection(skillPath, "Audit Mode");
      const constraints = readMarkdownSection(skillPath, "Constraints");

      assert.match(
        auditMode,
        /Misaligned effort is an observed test-to-risk mismatch/u,
        skillPath,
      );
      assert.match(
        auditMode,
        /Do not infer misalignment from high coverage alone/u,
        skillPath,
      );
      assert.match(
        auditMode,
        /If no item meets these evidence conditions, report `none found`/u,
        skillPath,
      );
      assert.match(
        constraints,
        /MUST assess gaps in BOTH directions/u,
        skillPath,
      );
    });
    assertForEachTarget(
      installedSkillReferencePaths("goat-qa", "references/output-templates.md"),
      (referencePath) => {
        const outputTemplates = readProjectFile(referencePath);
        const auditOutputHeading = "### Audit mode (no diff - A1–A4 shape)";
        const auditOutputIndex = outputTemplates.indexOf(auditOutputHeading);
        assert.notEqual(
          auditOutputIndex,
          -1,
          `${referencePath}: missing Audit output`,
        );
        assert.match(
          outputTemplates.slice(auditOutputIndex),
          /### Misaligned effort/u,
          referencePath,
        );
      },
    );
  });

  it("labels goat-plan issue examples as non-evidence placeholders", () => {
    const issueFormatPaths = INSTALLED_SKILL_ROOTS.map(
      (skillRoot) => `${skillRoot}/goat-plan/references/issue-format.md`,
    );

    assertForEachTarget(issueFormatPaths, (referencePath) => {
      const issueFormat = readProjectFile(referencePath);
      assert.match(
        issueFormat,
        /illustrative input\/output shape only, never repository evidence/iu,
        referencePath,
      );
      assert.match(
        issueFormat,
        /<Observable requirement and acceptance boundary expressed in stakeholder language\.>/u,
        referencePath,
      );
      assert.doesNotMatch(
        issueFormat,
        /Dashboard users cannot sign in|refresh-token rotation|OAuth callback/,
        referencePath,
      );
    });
  });

  it("routes planning narrative through writing style without styling plan mechanics", () => {
    for (const referencePath of [
      "workflow/skills/reference/skill-preamble.md",
      ".goat-flow/skill-docs/skill-preamble.md",
    ]) {
      const engineeringStandards = readMarkdownSection(
        referencePath,
        "Engineering Standards",
      );
      assert.match(
        engineeringStandards,
        /milestone and testing-plan narrative/u,
        referencePath,
      );
      assert.match(
        engineeringStandards,
        /fixed schema fields, exact paths, commands, approved requirements and acceptance\/proof\/verification\/exit criteria, task\/proof checklists, tables, catalogues, and deliberate control repetition stay exempt/u,
        referencePath,
      );
    }

    for (const playbookPath of [
      "workflow/skills/playbooks/writing-style.md",
      ".goat-flow/skill-docs/playbooks/writing-style.md",
    ]) {
      const scopeGate = readMarkdownSection(playbookPath, "Scope Gate");
      assert.match(
        scopeGate,
        /`ISSUE\.md`, milestone narrative, and testing-plan narrative\s*\|\s*Yes/u,
        playbookPath,
      );
      assert.match(
        scopeGate,
        /fixed schema fields, task\/proof checklists, commands, approved requirements and acceptance\/proof\/verification\/exit criteria, tables, INDEX and catalogue formats\s*\|\s*No/u,
        playbookPath,
      );
      assert.match(scopeGate, /Mixed planning artifacts/u, playbookPath);
      assert.match(
        scopeGate,
        /Objective, Context, Scope, assumptions, rollback, and testing-rationale prose/u,
        playbookPath,
      );
      assert.match(
        scopeGate,
        /If an exempt control surface conflicts with a source of truth, report the discrepancy/u,
        playbookPath,
      );
    }
  });
});
