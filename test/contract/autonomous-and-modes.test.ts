/**
 * Structural verification for M11 (autonomous mode), M14 (auto-mode selection),
 * and M12 (userRole) prerequisites. These tests verify SKILL.md content
 * contains the patterns required for each feature.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SKILLS_DIR = join(import.meta.dirname, "../../.claude/skills");
const PREAMBLE_PATH = join(
  import.meta.dirname,
  "../../workflow/skills/reference/skill-conventions.md",
);
const CONVENTIONS_PATH = join(
  import.meta.dirname,
  "../../.goat-flow/skill-conventions.md",
);

function readSkill(name: string): string {
  return readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf-8");
}

const preamble = readFileSync(PREAMBLE_PATH, "utf-8");
const conventions = readFileSync(CONVENTIONS_PATH, "utf-8");
const ALL_SKILLS = [
  "goat-debug",
  "goat-plan",
  "goat-review",
  "goat-security",
  "goat-test",
];

// === M11: Autonomous mode prerequisites ===

describe("M11: autonomous mode structural checks", () => {
  it("shared preamble has CHECKPOINT definition", () => {
    assert.ok(
      preamble.includes("CHECKPOINT"),
      "Shared preamble should define CHECKPOINT behavior",
    );
  });

  it("shared preamble has BLOCKING GATE definition", () => {
    assert.ok(
      preamble.includes("BLOCKING GATE"),
      "Shared preamble should define BLOCKING GATE behavior",
    );
  });

  it("shared preamble has ceremony level table", () => {
    assert.ok(
      preamble.includes("Ceremony Level") || preamble.includes("Ceremony:"),
      "Shared preamble should have ceremony level guidance",
    );
    assert.ok(
      preamble.includes("Hotfix"),
      "Ceremony should reference Hotfix complexity",
    );
  });

  it("shared preamble has sub-agent mode handling", () => {
    assert.ok(
      preamble.includes("Sub-agent mode") || preamble.includes("sub-agent"),
      "Shared preamble should document sub-agent mode behavior",
    );
  });

  it("shared preamble has recovery section", () => {
    assert.ok(
      preamble.includes("Recovery"),
      "Shared preamble should have recovery guidance",
    );
    assert.ok(
      preamble.includes("Partial completion"),
      "Recovery should cover partial completion",
    );
    assert.ok(
      preamble.includes("Missing artifacts"),
      "Recovery should cover missing artifacts",
    );
  });

  it("shared preamble has checkpoint-based recovery for autonomous mode", () => {
    assert.ok(
      preamble.includes("checkbox") || preamble.includes("milestone"),
      "Recovery should mention milestone checkboxes for context preservation (handoff replaced in v1.1.0)",
    );
  });

  it("skill-conventions.md has ceremony-conditional content", () => {
    assert.ok(
      conventions.includes("Ceremony Level"),
      "skill-conventions.md should have Ceremony Level section",
    );
    assert.ok(
      conventions.includes("Hotfix"),
      "Ceremony should reference Hotfix complexity",
    );
  });

  for (const name of ALL_SKILLS) {
    it(`${name} delegates ceremony to skill-conventions.md`, () => {
      const content = readSkill(name);
      assert.ok(
        content.includes("skill-conventions.md"),
        `${name} should reference skill-conventions.md for ceremony conventions`,
      );
    });

    it(`${name} has CHECKPOINT mentions (autonomous support)`, () => {
      const content = readSkill(name);
      assert.ok(
        content.includes("CHECKPOINT") || content.includes("Checkpoint"),
        `${name} should have CHECKPOINT for autonomous mode`,
      );
    });
  }
});

// === M14: Auto-mode selection prerequisites ===

describe("M14: auto-mode selection structural checks", () => {
  it("goat-review has scope detection priority", () => {
    const content = readSkill("goat-review");
    assert.ok(
      content.includes("Scope detection priority") ||
        content.includes("scope detection") ||
        content.includes("Auto-detect scope"),
      "goat-review should have scope detection priority order",
    );
  });

  it("goat-review auto-detects Standard vs Audit", () => {
    const content = readSkill("goat-review");
    assert.ok(
      content.includes("Standard mode") ||
        content.includes("Full Review") ||
        content.includes("Quick Review"),
      "goat-review should mention review modes (Standard/Full/Quick)",
    );
    assert.ok(
      content.includes("Audit mode") || content.includes("Audit Mode"),
      "goat-review should mention Audit mode",
    );
  });

  it("goat-review handles dirty worktree", () => {
    const content = readSkill("goat-review");
    assert.ok(
      content.includes("20+ changed files") || content.includes("very dirty"),
      "goat-review should handle dirty worktree edge case",
    );
  });

  it("goat-review supports explicit override", () => {
    const content = readSkill("goat-review");
    assert.ok(
      content.includes("respect override") ||
        content.includes("explicitly says") ||
        content.includes("already says") ||
        content.includes("confirm and continue"),
      "goat-review should support explicit mode override",
    );
  });

  it("goat-test has scope detection priority", () => {
    const content = readSkill("goat-test");
    assert.ok(
      content.includes("Scope detection priority") ||
        content.includes("scope detection") ||
        content.includes("Auto-detect mode"),
      "goat-test should have scope detection priority order",
    );
  });

  it("goat-test auto-detects Standard vs Audit", () => {
    const content = readSkill("goat-test");
    assert.ok(
      content.includes("Standard mode") || content.includes("Standard"),
      "goat-test should mention Standard mode",
    );
    assert.ok(
      content.includes("Audit mode") || content.includes("Audit"),
      "goat-test should mention Audit mode",
    );
  });

  it("goat-test audit mode skips Phase 0", () => {
    const content = readSkill("goat-test");
    assert.ok(
      content.includes("skip Phase 0") || content.includes("gap analysis"),
      "goat-test Audit mode should skip Phase 0 or go to gap analysis",
    );
  });

  it("contradiction check lives in skill-conventions.md (deduplicated from individual skills)", () => {
    assert.ok(
      conventions.includes("Contradiction Check") ||
        conventions.includes("Contradiction check"),
      "skill-conventions.md should have the contradiction check (moved from individual skills in 10n)",
    );
    const contradictionSection = conventions.match(
      /[Cc]ontradiction [Cc]heck[\s\S]*?(?=\n## |$)/,
    );
    assert.ok(contradictionSection, "should have contradiction section");
    assert.ok(
      contradictionSection[0].includes("hotfix") ||
        contradictionSection[0].includes("Hotfix"),
      "contradiction check should flag hotfix scope mismatch",
    );
  });
});

// === M12: Persona prerequisites ===

describe("M12: userRole structural checks", () => {
  it("config reader defaults userRole to developer when not set", () => {
    const readerContent = readFileSync(
      join(import.meta.dirname, "../../src/cli/config/reader.ts"),
      "utf-8",
    );
    assert.ok(
      readerContent.includes('userRole: "developer"'),
      "CONFIG_DEFAULTS should set userRole to developer",
    );
  });

  it("config types define valid userRole options", () => {
    const typesContent = readFileSync(
      join(import.meta.dirname, "../../src/cli/config/types.ts"),
      "utf-8",
    );
    assert.ok(
      typesContent.includes("developer"),
      "config types should include developer role",
    );
    assert.ok(
      typesContent.includes("investigator"),
      "config types should include investigator role",
    );
  });

  it("investigation-mode skills are read-only by design", () => {
    // goat-review and goat-security are read-only skills - no implementation phases
    const review = readSkill("goat-review");
    const security = readSkill("goat-security");

    // These skills should NOT have implementation/edit phases
    assert.ok(
      !review.includes("## Phase.*Implement"),
      "goat-review should not have implementation phases",
    );
    assert.ok(
      !security.includes("## Phase.*Implement"),
      "goat-security should not have implementation phases",
    );
  });

  it('goat-debug D2 gate offers investigation-only exit', () => {
    const content = readSkill("goat-debug");
    assert.ok(
      content.includes("just report findings") ||
        content.includes("report findings") ||
        content.includes("stop here") ||
        content.includes("propose fix, or stop") ||
        content.includes("partial findings"),
      "goat-debug D2 gate should offer investigation-only exit",
    );
  });
});

// === M12 manual test coverage: userRole routing behavior ===

describe("M12: userRole routing behavior (contract verification)", () => {
  it("goat-debug investigate mode is structurally read-only (no fix phases)", () => {
    const content = readSkill("goat-debug");
    // Extract investigate mode section
    const investigateSection = content.match(
      /## Investigate Mode[\s\S]*?(?=\n## [A-Z]|\n---\n## )/,
    );
    assert.ok(
      investigateSection,
      "goat-debug should have Investigate Mode section",
    );
    // Investigate mode should NOT contain fix/implement/edit language
    assert.ok(
      !investigateSection[0].includes("implement the fix") &&
        !investigateSection[0].includes("apply the change"),
      "Investigate mode should not contain implementation language",
    );
    // It should have a report phase, not a fix phase
    assert.ok(
      investigateSection[0].includes("Report") ||
        investigateSection[0].includes("I3"),
      "Investigate mode should end with a report phase",
    );
  });

  it("goat-debug diagnose mode has fix gate requiring approval", () => {
    const content = readSkill("goat-debug");
    // The D2→D3 gate should require human approval before any fix
    assert.ok(
      content.includes("BLOCKING GATE") &&
        (content.includes("propose a fix") || content.includes("propose fix")),
      "Diagnose mode should have a blocking gate before fix proposal",
    );
    // Phase D3 should only activate after approval
    assert.ok(
      content.includes("Only if human approved") ||
        content.includes("if approved") ||
        content.includes("If yes") ||
        content.includes("only if human approved") ||
        content.includes("human approved"),
      "Fix phase should be gated on human approval",
    );
  });

  it("goat-debug has mode routing in When to Use or Step 0", () => {
    const content = readSkill("goat-debug");
    assert.ok(
      content.includes("Mode selection") ||
        content.includes("mode routing") ||
        content.includes("Diagnose mode") ||
        content.includes("Investigate mode"),
      "Skill should have mode selection/routing",
    );
    assert.ok(
      content.includes("Diagnose") && content.includes("Investigate"),
      "Skill should list Diagnose and Investigate modes",
    );
  });

  it("goat-plan has implementation gated on approval", () => {
    const content = readSkill("goat-plan");
    // Milestones or phases should have a gate before proceeding
    assert.ok(
      content.includes("Approve and start implementing") ||
        content.includes("approve") ||
        content.includes("approval") ||
        content.includes("human approval"),
      "Milestones should gate implementation on approval",
    );
  });
});

// === M11 manual test coverage: recovery and checkpoint behavior ===

describe("M11: recovery and checkpoint behavior (contract verification)", () => {
  it("skill-conventions.md has recovery procedures", () => {
    assert.ok(
      conventions.includes("## Recovery"),
      "skill-conventions.md should have Recovery section",
    );
    assert.ok(
      conventions.includes("Partial completion"),
      "Recovery should handle partial completion",
    );
    assert.ok(
      conventions.includes("resume from next"),
      "Recovery should describe how to resume",
    );
  });

  for (const name of ALL_SKILLS) {
    it(`${name} references skill-conventions.md for shared conventions`, () => {
      const content = readSkill(name);
      assert.ok(
        content.includes("skill-conventions.md"),
        `${name} should reference .goat-flow/skill-conventions.md (v1.1.0: conventions extracted from inline)`,
      );
    });

    it(`${name} has inline fallback for shared conventions`, () => {
      const content = readSkill(name);
      assert.ok(
        content.includes("If unavailable, use these essentials") ||
          content.includes("SECURITY > CORRECTNESS"),
        `${name} should have inline fallback in case skill-conventions.md is missing`,
      );
    });
  }

  it("shared preamble recovery covers sub-agent mode", () => {
    assert.ok(
      preamble.includes("Sub-agent") ||
        preamble.includes("sub-agent") ||
        preamble.includes("checkpoint") ||
        preamble.includes("milestone"),
      "Recovery should cover sub-agent/autonomous recovery via milestone checkboxes",
    );
  });

  it("task tracking enforces checkbox ticking for plans", () => {
    assert.ok(
      preamble.includes("tick") ||
        preamble.includes("Tick") ||
        preamble.includes("checkbox") ||
        preamble.includes("immediately when completed"),
      "Task Tracking section should enforce checkpoint ticking (replaced flush protocol in v1.1.0)",
    );
  });
});
