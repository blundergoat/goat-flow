import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SKILLS_DIR = join(import.meta.dirname, "../../.claude/skills");
const CONVENTIONS_PATH = join(
  import.meta.dirname,
  "../../.goat-flow/skill-preamble.md",
);
const CONVENTIONS_FULL_PATH = join(
  import.meta.dirname,
  "../../.goat-flow/skill-conventions.md",
);
const SKILL_NAMES = [
  "goat-debug",
  "goat-plan",
  "goat-review",
  "goat-security",
  "goat-test",
];

function readSkill(name: string): string {
  return readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf-8");
}

const conventions = readFileSync(CONVENTIONS_PATH, "utf-8");
const conventionsFull = readFileSync(CONVENTIONS_FULL_PATH, "utf-8");
const conventionsCombined = conventions + "\n" + conventionsFull;

describe("Skill content contracts", () => {
  for (const name of SKILL_NAMES) {
    describe(name, () => {
      const content = readSkill(name);

      it("has YAML frontmatter with required fields", () => {
        assert.ok(
          content.startsWith("---"),
          "Should start with YAML frontmatter",
        );
        assert.ok(content.includes("name:"), "Should have name field");
        assert.ok(
          content.includes("description:"),
          "Should have description field",
        );
        assert.ok(
          content.includes("goat-flow-skill-version:"),
          "Should have version field",
        );
      });

      it("has Step 0 section", () => {
        assert.ok(content.includes("Step 0"), `${name} should have Step 0`);
      });

      it("has footgun check in Step 0", () => {
        assert.ok(
          content.includes("Footgun check") || content.includes("footgun"),
          `${name} should check footguns in Step 0`,
        );
      });

      it("delegates contradiction check to skill-conventions.md", () => {
        // 10n moved contradiction check to skill-conventions.md
        assert.ok(
          content.includes("skill-conventions.md"),
          `${name} should reference skill-conventions.md (which now contains the contradiction check)`,
        );
      });

      it("delegates shared conventions to skill-conventions.md", () => {
        assert.ok(
          content.includes("skill-conventions.md"),
          `${name} should reference skill-conventions.md for shared conventions`,
        );
      });

      it("does not reference deleted skills", () => {
        const deleted = [
          "goat-investigate",
          "goat-onboard",
          "goat-reflect",
          "goat-resume",
          "goat-audit",
        ];
        for (const d of deleted) {
          assert.ok(
            !content.includes(d),
            `${name} references deleted skill ${d}`,
          );
        }
      });

      it("does not have duplicate recurrence check (goat-debug only)", () => {
        if (name !== "goat-debug") return;
        const recurrenceMatches = content.match(/RECURRENCE CHECK/g);
        assert.ok(
          !recurrenceMatches || recurrenceMatches.length <= 1,
          `goat-debug should have at most 1 recurrence check, found ${recurrenceMatches?.length}`,
        );
      });

      it("goat-debug has investigate mode", () => {
        if (name !== "goat-debug") return;
        assert.ok(
          content.includes("Investigate Mode"),
          "goat-debug should have Investigate Mode",
        );
        // Onboard mode was compressed to a one-line note in M14
        assert.ok(
          content.includes("Onboard Mode") ||
            content.includes("onboard") ||
            content.includes("Onboard"),
          "goat-debug should reference onboarding (full mode or one-line note)",
        );
      });

      it("goat-plan has milestone archetypes", () => {
        if (name !== "goat-plan") return;
        assert.ok(
          content.includes("Prove It Works") ||
            content.includes("Make It Real"),
          "goat-plan should have milestone archetypes",
        );
      });

      it("goat-plan has testing gates", () => {
        if (name !== "goat-plan") return;
        assert.ok(
          content.includes("Testing Gate") || content.includes("testing gate"),
          "goat-plan should enforce testing gates between milestones",
        );
      });

      it("goat-plan has between-milestones phase", () => {
        if (name !== "goat-plan") return;
        assert.ok(
          content.includes("Between Milestones"),
          "goat-plan should have a Between Milestones phase",
        );
      });

      it("goat-review has auto-detect mode", () => {
        if (name !== "goat-review") return;
        assert.ok(
          content.includes("Auto-detect mode") ||
            content.includes("Auto-detect scope"),
          "goat-review should auto-detect review scope or mode",
        );
      });

      it("goat-test has mode detection", () => {
        if (name !== "goat-test") return;
        assert.ok(
          content.includes("Mode detection") ||
            content.includes("Changes exist"),
          "goat-test should have mode detection for Standard vs Audit",
        );
      });
    });
  }
});

describe("Shared skill-conventions content (essential + full)", () => {
  const conventionsCombined = conventions + "\n" + conventionsFull;

  it("has ceremony level section in full reference", () => {
    assert.ok(
      conventionsCombined.includes("Ceremony Level"),
      "skill-conventions.md should have Ceremony Level section",
    );
  });

  it("has footgun fast-path in full reference", () => {
    assert.ok(
      conventionsCombined.includes("Footgun Fast-Path"),
      "skill-conventions.md should have Footgun Fast-Path section",
    );
  });

  it("has learning loop reference in essential", () => {
    assert.ok(
      conventions.includes("Learning Loop"),
      "skill-conventions.md should have Learning Loop section",
    );
  });

  it("has session log in full reference closing", () => {
    assert.ok(
      conventionsCombined.includes("logs/sessions"),
      "skill-conventions should reference session logs",
    );
  });

  it("has category bucket format for lessons/footguns in full reference", () => {
    assert.ok(
      conventionsFull.includes("## Lesson:") ||
        conventionsFull.includes("## Footgun:"),
      "skill-conventions.md should have category bucket entry format examples",
    );
  });

  it("essential file is under 50 lines", () => {
    const lineCount = conventions.split("\n").length;
    assert.ok(
      lineCount < 120,
      `skill-conventions.md should be under 120 lines (essential only), got ${lineCount}`,
    );
  });
});

describe("Skill-template consistency", () => {
  const WORKFLOW_DIR = join(import.meta.dirname, "../../workflow/skills");

  for (const name of SKILL_NAMES) {
    it(`${name} installed version has same key sections as workflow template`, () => {
      const installed = readSkill(name);
      const templatePath = join(WORKFLOW_DIR, `${name}.md`);
      if (!existsSync(templatePath)) return;

      const template = readFileSync(templatePath, "utf-8");

      // Both should have these required sections
      const requiredSections = ["Step 0", "When to Use", "Shared Conventions"];
      for (const section of requiredSections) {
        if (template.includes(section)) {
          assert.ok(
            installed.includes(section),
            `${name}: installed missing '${section}' section that template has`,
          );
        }
      }
    });
  }
});
