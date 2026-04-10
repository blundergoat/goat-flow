import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const WORKFLOW_SKILLS_DIR = join(ROOT, "workflow/skills");
const INSTALLED_SKILLS_DIR = join(ROOT, ".claude/skills");
const SETUP_DIR = join(ROOT, "workflow/setup");
const SETUP_REF_DIR = join(ROOT, "workflow/setup/reference");
const EVALUATION_DIR = join(ROOT, "workflow/evaluation");

const DELETED_SKILLS = [
  "goat-investigate",
  "goat-onboard",
  "goat-reflect",
  "goat-resume",
  "goat-audit",
];

/** List all goat-*.md files in workflow/skills (excluding directories). */
function getWorkflowTemplates(): string[] {
  return readdirSync(WORKFLOW_SKILLS_DIR).filter(
    (f) => f.startsWith("goat-") && f.endsWith(".md"),
  );
}

// ---------------------------------------------------------------
// 1. Every workflow/skills/goat-*.md has a matching installed copy
// ---------------------------------------------------------------
describe("Workflow template to installed skill mapping", () => {
  const templates = getWorkflowTemplates();

  assert.ok(templates.length > 0, "Should find at least one workflow template");

  for (const templateFile of templates) {
    const skillName = templateFile.replace(".md", "");

    it(`${skillName} has an installed copy at .claude/skills/${skillName}/SKILL.md`, () => {
      const installedPath = join(INSTALLED_SKILLS_DIR, skillName, "SKILL.md");
      assert.ok(
        existsSync(installedPath),
        `Workflow template ${templateFile} has no matching installed skill at ${installedPath}`,
      );
    });
  }
});

// ---------------------------------------------------------------
// 2. No workflow template references deleted skill names
// ---------------------------------------------------------------
describe("No references to deleted skills", () => {
  const templates = getWorkflowTemplates();

  for (const templateFile of templates) {
    const content = readFileSync(
      join(WORKFLOW_SKILLS_DIR, templateFile),
      "utf-8",
    );

    for (const deleted of DELETED_SKILLS) {
      it(`${templateFile} does not reference deleted skill ${deleted}`, () => {
        assert.ok(
          !content.includes(deleted),
          `${templateFile} still references deleted skill "${deleted}"`,
        );
      });
    }
  }
});

// ---------------------------------------------------------------
// 3. All workflow skill templates have goat-flow-skill-version
// ---------------------------------------------------------------
describe("Workflow skill templates have goat-flow-skill-version in frontmatter", () => {
  const templates = getWorkflowTemplates();

  for (const templateFile of templates) {
    it(`${templateFile} has goat-flow-skill-version in frontmatter`, () => {
      const content = readFileSync(
        join(WORKFLOW_SKILLS_DIR, templateFile),
        "utf-8",
      );
      assert.ok(
        content.startsWith("---"),
        `${templateFile} should start with YAML frontmatter`,
      );
      // Extract frontmatter block (between first and second ---)
      const fmEnd = content.indexOf("---", 3);
      assert.ok(
        fmEnd > 3,
        `${templateFile} should have closing frontmatter delimiter`,
      );
      const frontmatter = content.slice(0, fmEnd);
      assert.ok(
        frontmatter.includes("goat-flow-skill-version:"),
        `${templateFile} frontmatter is missing goat-flow-skill-version`,
      );
    });
  }
});

// ---------------------------------------------------------------
// 4. workflow/evaluation/lessons.md mentions "category bucket" format
// ---------------------------------------------------------------
describe("Evaluation template: lessons.md", () => {
  it('mentions "category bucket" format', () => {
    const lessonsPath = join(EVALUATION_DIR, "lessons.md");
    assert.ok(
      existsSync(lessonsPath),
      "workflow/evaluation/lessons.md should exist",
    );
    const content = readFileSync(lessonsPath, "utf-8");
    assert.ok(
      content.toLowerCase().includes("category bucket"),
      'lessons.md should mention "category bucket" format (not per-incident files)',
    );
  });
});

// ---------------------------------------------------------------
// 5. workflow/evaluation/footguns.md mentions "category bucket" format
// ---------------------------------------------------------------
describe("Evaluation template: footguns.md", () => {
  it('mentions "category bucket" format', () => {
    const footgunsPath = join(EVALUATION_DIR, "footguns.md");
    assert.ok(
      existsSync(footgunsPath),
      "workflow/evaluation/footguns.md should exist",
    );
    const content = readFileSync(footgunsPath, "utf-8");
    assert.ok(
      content.toLowerCase().includes("category bucket"),
      'footguns.md should mention "category bucket" format (not per-incident files)',
    );
  });
});

// ---------------------------------------------------------------
// 6. execution-loop.md mentions "3x" or "re-classify"
// ---------------------------------------------------------------
describe("Execution loop: dynamic read budgets", () => {
  const execLoopPath = join(SETUP_REF_DIR, "execution-loop.md");

  it("exists", () => {
    assert.ok(
      existsSync(execLoopPath),
      "workflow/setup/reference/execution-loop.md should exist",
    );
  });

  it('mentions "3x" or "re-classify" instead of fixed read budgets', () => {
    const content = readFileSync(execLoopPath, "utf-8");
    const has3x = content.includes("3x");
    const hasReclassify = content.toLowerCase().includes("re-classify");
    assert.ok(
      has3x || hasReclassify,
      'execution-loop.md should mention "3x" or "re-classify" for dynamic read budgets',
    );
  });
});

// ---------------------------------------------------------------
// 7. execution-loop.md mentions "session logs" or "logs/sessions"
// ---------------------------------------------------------------
describe("Execution loop: session logs", () => {
  it('mentions "session logs" or "logs/sessions"', () => {
    const content = readFileSync(join(SETUP_REF_DIR, "execution-loop.md"), "utf-8");
    const hasSessionLogs = content.toLowerCase().includes("session logs");
    const hasLogsSessions = content.includes("logs/sessions");
    assert.ok(
      hasSessionLogs || hasLogsSessions,
      'execution-loop.md should mention "session logs" or "logs/sessions"',
    );
  });
});

// ---------------------------------------------------------------
// 8. execution-loop.md references .goat-flow/ paths consistently
// ---------------------------------------------------------------
describe("workflow/setup/reference/execution-loop.md .goat-flow/ path consistency", () => {
  const execLoopPath = join(SETUP_REF_DIR, "execution-loop.md");

  it("no disagreement on log paths (.goat-flow/logs vs .goat-flow/tasks/logs)", () => {
    const content = readFileSync(execLoopPath, "utf-8");
    const usesGoatFlowLogs = /\.goat-flow\/logs\//.test(content);
    const usesGoatFlowTasksLogs = /\.goat-flow\/tasks\/logs\//.test(content);

    // If both patterns exist, there is a disagreement
    assert.ok(
      !(usesGoatFlowLogs && usesGoatFlowTasksLogs),
      `Path disagreement in execution-loop.md: .goat-flow/logs/ and .goat-flow/tasks/logs/ both used`,
    );
  });

  it("references canonical .goat-flow/lessons/ and .goat-flow/footguns/ paths", () => {
    const content = readFileSync(execLoopPath, "utf-8");
    assert.ok(
      content.includes(".goat-flow/lessons/"),
      "execution-loop.md should reference canonical .goat-flow/lessons/ path",
    );
    assert.ok(
      content.includes(".goat-flow/footguns/"),
      "execution-loop.md should reference canonical .goat-flow/footguns/ path",
    );
  });
});

// ---------------------------------------------------------------
// 9. execution-loop.md does not reference deleted skill names
// ---------------------------------------------------------------
describe("No setup/execution-loop references to deleted skills", () => {
  const execLoopPath = join(SETUP_REF_DIR, "execution-loop.md");
  const content = readFileSync(execLoopPath, "utf-8");

  for (const deleted of DELETED_SKILLS) {
    it(`execution-loop.md does not reference deleted skill ${deleted}`, () => {
      assert.ok(
        !content.includes(deleted),
        `workflow/setup/reference/execution-loop.md still references deleted skill "${deleted}"`,
      );
    });
  }
});

// ---------------------------------------------------------------
// 10. No installed skill references deleted skill names
// ---------------------------------------------------------------
describe("No installed skill references to deleted skills", () => {
  const skillDirs = readdirSync(INSTALLED_SKILLS_DIR).filter((d) =>
    d.startsWith("goat"),
  );

  for (const dir of skillDirs) {
    const skillPath = join(INSTALLED_SKILLS_DIR, dir, "SKILL.md");
    if (!existsSync(skillPath)) continue;
    const content = readFileSync(skillPath, "utf-8");

    for (const deleted of DELETED_SKILLS) {
      it(`installed ${dir}/SKILL.md does not reference ${deleted}`, () => {
        assert.ok(
          !content.includes(deleted),
          `Installed ${dir}/SKILL.md still references deleted skill "${deleted}"`,
        );
      });
    }
  }
});

// ---------------------------------------------------------------
// 11. execution-loop.md matches CLAUDE.md complexity tier model
// ---------------------------------------------------------------
describe("Execution loop matches CLAUDE.md complexity tiers", () => {
  const claudeMdPath = join(ROOT, "CLAUDE.md");
  const execLoopPath = join(SETUP_REF_DIR, "execution-loop.md");

  it("CLAUDE.md has complexity tiers", () => {
    const content = readFileSync(claudeMdPath, "utf-8");
    assert.ok(
      content.includes("Hotfix"),
      "CLAUDE.md should mention Hotfix tier",
    );
    assert.ok(
      content.includes("Standard"),
      "CLAUDE.md should mention Standard tier",
    );
  });

  it("execution-loop.md has matching tier names", () => {
    const content = readFileSync(execLoopPath, "utf-8");
    assert.ok(
      content.includes("Hotfix"),
      "execution-loop.md should mention Hotfix tier",
    );
    assert.ok(
      content.includes("Standard"),
      "execution-loop.md should mention Standard tier",
    );
  });

  it("neither file uses old fixed read budgets (2/4/6/8 reads)", () => {
    const claudeContent = readFileSync(claudeMdPath, "utf-8");
    // Check CLAUDE.md classify section doesn't have old "N reads" budgets
    const classifySection = claudeContent.match(
      /\*\*CLASSIFY\*\*[\s\S]*?\*\*SCOPE\*\*/,
    );
    if (classifySection) {
      const section = classifySection[0];
      assert.ok(
        !/ [2468] reads/.test(section),
        "CLAUDE.md CLASSIFY section should not have fixed read budgets",
      );
    }
  });
});

// ---------------------------------------------------------------
// 12. execution-loop.md references .goat-flow/logs/sessions/ consistently
// ---------------------------------------------------------------
describe("Session log path consistency in setup templates", () => {
  const execLoopPath = join(SETUP_REF_DIR, "execution-loop.md");

  it("execution-loop.md uses logs/sessions/ (not tasks/logs/)", () => {
    const content = readFileSync(execLoopPath, "utf-8");
    if (content.includes("session")) {
      assert.ok(
        !content.includes(".goat-flow/tasks/logs/sessions"),
        "execution-loop.md uses wrong path .goat-flow/tasks/logs/sessions - should be .goat-flow/logs/sessions/",
      );
    }
  });
});

// ---------------------------------------------------------------
// 13. skill-conventions (essential + full) have required sections
// ---------------------------------------------------------------
describe("Shared preamble required sections", () => {
  const essentialPath = join(
    WORKFLOW_SKILLS_DIR,
    "reference/skill-preamble.md",
  );
  const fullPath = join(
    WORKFLOW_SKILLS_DIR,
    "reference/skill-conventions.md",
  );

  it("essential file exists", () => {
    assert.ok(
      existsSync(essentialPath),
      "workflow/skills/reference/skill-conventions.md should exist",
    );
  });

  it("full reference file exists", () => {
    assert.ok(
      existsSync(fullPath),
      "workflow/skills/reference/skill-conventions.md should exist",
    );
  });

  const essential = readFileSync(essentialPath, "utf-8");
  const full = readFileSync(fullPath, "utf-8");

  it("has Ceremony Level section in full reference", () => {
    assert.ok(
      full.includes("Ceremony Level"),
      'skill-conventions.md should have a "Ceremony Level" section',
    );
  });

  it("has Footgun Fast-Path section in full reference", () => {
    assert.ok(
      full.includes("Footgun Fast-Path"),
      'skill-conventions.md should have a "Footgun Fast-Path" section',
    );
  });

  it("has Recovery section in full reference", () => {
    assert.ok(
      full.includes("## Recovery"),
      'skill-conventions.md should have a "Recovery" section',
    );
  });

  it("has Session Log reference in full reference", () => {
    const combined = essential + "\n" + full;
    const hasSessionLog =
      combined.includes("Session Log") ||
      combined.includes("session log") ||
      combined.includes("logs/sessions");
    assert.ok(
      hasSessionLog,
      "skill-conventions should reference session logs",
    );
  });

  it("essential file is under 50 lines", () => {
    const lineCount = essential.split("\n").length;
    assert.ok(
      lineCount < 50,
      `skill-conventions.md should be under 50 lines (essential only), got ${lineCount}`,
    );
  });
});
