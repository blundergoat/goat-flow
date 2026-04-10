import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Load presets from the source file
const presetsContent = readFileSync(
  join(import.meta.dirname, "../../src/dashboard/preset-prompts.js"),
  "utf-8",
);
// Extract the PRESETS array by evaluating the JS
const PRESETS: Array<{
  id: string;
  name: string;
  desc: string;
  prompt: string;
  cat: string;
}> = eval(presetsContent + "; PRESETS");

describe("Preset launcher content validation", () => {
  it("every preset has required fields", () => {
    for (const p of PRESETS) {
      assert.ok(p.id, `Preset missing id`);
      assert.ok(p.name, `Preset ${p.id} missing name`);
      assert.ok(p.desc, `Preset ${p.id} missing desc`);
      assert.ok(
        p.prompt.length > 10,
        `Preset ${p.id} prompt too short (${p.prompt.length} chars)`,
      );
      assert.ok(p.cat, `Preset ${p.id} missing cat`);
    }
  });

  it("no duplicate preset IDs", () => {
    const ids = PRESETS.map((p) => p.id);
    const unique = new Set(ids);
    assert.equal(
      ids.length,
      unique.size,
      `Duplicate preset IDs: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`,
    );
  });

  it("categories are from the allowed set", () => {
    const allowed = new Set([
      "debug",
      "review",
      "plan",
      "critique",
      "test",
      "security",
    ]);
    for (const p of PRESETS) {
      assert.ok(
        allowed.has(p.cat),
        `Preset ${p.id} has unknown category '${p.cat}'. Allowed: ${[...allowed].join(", ")}`,
      );
    }
  });

  it("deleted presets are gone", () => {
    const ids = PRESETS.map((p) => p.id);
    assert.ok(!ids.includes("question"), "Quick Question should be deleted");
    assert.ok(!ids.includes("docs"), "Generate Docs should be deleted");
    assert.ok(!ids.includes("compare"), "Compare & Rate should be deleted");
    assert.ok(!ids.includes("triage"), "Triage Ideas should be deleted");
  });

  it("current presets exist", () => {
    const ids = PRESETS.map((p) => p.id);
    assert.ok(ids.includes("fix-bug"), "Fix Bug preset missing");
    assert.ok(ids.includes("dep-scan"), "Dependency Scan preset missing");
    assert.ok(ids.includes("user-flow"), "User Flow Diagram preset missing");
    assert.ok(
      ids.includes("review-instructions"),
      "Review Instructions preset missing",
    );
    assert.ok(ids.includes("sbao"), "SBAO Critique preset missing");
    assert.ok(ids.includes("milestones"), "Milestones preset missing");
    assert.ok(ids.includes("test-audit"), "Coverage Audit preset missing");
    assert.ok(
      ids.includes("test-regression"),
      "Regression Guard preset missing",
    );
  });

  it("every preset with a skill prefix uses a valid skill", () => {
    const validSkills = [
      "/goat-debug",
      "/goat-review",
      "/goat-plan",
      "/goat-sbao",
      "/goat-test",
      "/goat-security",
      "/goat",
    ];
    for (const p of PRESETS) {
      if (p.prompt.startsWith("/goat")) {
        const skill = p.prompt.split(" ")[0];
        assert.ok(
          validSkills.some((s) => skill.startsWith(s)),
          `Preset ${p.id} uses unknown skill prefix '${skill}'`,
        );
      }
    }
  });

  it("category filter works correctly", () => {
    const filterByCategory = (cat: string) =>
      cat === "all" ? PRESETS : PRESETS.filter((p) => p.cat === cat);

    assert.ok(
      filterByCategory("all").length === PRESETS.length,
      "All filter returns everything",
    );
    assert.ok(
      filterByCategory("debug").length >= 2,
      "Debug category has presets",
    );
    assert.ok(
      filterByCategory("security").length >= 2,
      "Security category has presets",
    );
    assert.ok(
      filterByCategory("review").length >= 3,
      "Review category has presets",
    );
    assert.ok(
      filterByCategory("critique").length >= 1,
      "Critique category has presets",
    );
    assert.ok(
      filterByCategory("nonexistent").length === 0,
      "Unknown category returns nothing",
    );
  });
});
