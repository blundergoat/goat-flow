import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");

function lineCount(path: string): number {
  return readFileSync(path, "utf-8").split(/\r?\n/).length;
}

describe("Copilot and skill-reference contracts", () => {
  it("keeps the root goat-security skill within the 220-line ceiling", () => {
    const path = resolve(
      PROJECT_ROOT,
      "workflow/skills/goat-security/SKILL.md",
    );
    assert.ok(existsSync(path), "workflow goat-security SKILL.md should exist");
    assert.ok(
      lineCount(path) <= 220,
      "workflow goat-security SKILL.md must stay at or under 220 lines",
    );
  });

  it("keeps every goat-security reference pack within the 200-line ceiling", () => {
    const dir = resolve(
      PROJECT_ROOT,
      "workflow/skills/goat-security/references",
    );
    assert.ok(existsSync(dir), "goat-security references dir should exist");
    for (const file of readdirSync(dir).filter((entry) =>
      entry.endsWith(".md"),
    )) {
      const path = resolve(dir, file);
      assert.ok(
        lineCount(path) <= 200,
        `${file} must stay at or under 200 lines`,
      );
    }
  });

  it("keeps .github/copilot-instructions.md within the 120-line ceiling", () => {
    const path = resolve(PROJECT_ROOT, ".github/copilot-instructions.md");
    assert.ok(existsSync(path), ".github/copilot-instructions.md should exist");
    assert.ok(
      lineCount(path) <= 120,
      ".github/copilot-instructions.md must stay at or under 120 lines",
    );
  });
});
