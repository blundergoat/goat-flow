import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { AUDIT_VERSION } from "../../src/cli/constants.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");

/** Count physical lines so contract ceilings match the human-visible files. */
function lineCount(path: string): number {
  return readFileSync(path, "utf-8").split(/\r?\n/).length;
}

/** Walk reference trees recursively because mirrored skill docs can nest packs. */
function markdownFilesUnder(path: string): string[] {
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  if (stat.isFile()) return path.endsWith(".md") ? [path] : [];
  return readdirSync(path).flatMap((entry) =>
    markdownFilesUnder(resolve(path, entry)),
  );
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

  it("keeps .github/copilot-instructions.md within the 125-line ceiling", () => {
    const path = resolve(PROJECT_ROOT, ".github/copilot-instructions.md");
    assert.ok(existsSync(path), ".github/copilot-instructions.md should exist");
    assert.ok(
      lineCount(path) <= 125,
      ".github/copilot-instructions.md must stay at or under 125 lines",
    );
  });

  it("keeps shared and per-skill reference docs version-tagged", () => {
    const roots = [
      "workflow/skills/reference",
      ".goat-flow/skill-reference",
      "workflow/skills/goat-security/references",
      ".agents/skills/goat-security/references",
      ".claude/skills/goat-security/references",
      ".github/skills/goat-security/references",
      "test/fixtures/skill-with-references/references",
    ];
    const files = roots.flatMap((root) =>
      markdownFilesUnder(resolve(PROJECT_ROOT, root)),
    );
    assert.ok(files.length > 0, "expected reference markdown files to exist");
    for (const file of files) {
      assert.match(
        readFileSync(file, "utf-8"),
        new RegExp(
          `^---\\ngoat-flow-reference-version: "${AUDIT_VERSION}"\\n---\\n`,
        ),
        `${file} must have current goat-flow-reference-version frontmatter`,
      );
    }
  });
});
