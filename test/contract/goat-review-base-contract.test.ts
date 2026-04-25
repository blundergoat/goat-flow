import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");

const SKILL_PATHS = [
  "workflow/skills/goat-review/SKILL.md",
  ".claude/skills/goat-review/SKILL.md",
  ".agents/skills/goat-review/SKILL.md",
  ".github/skills/goat-review/SKILL.md",
] as const;

function readSkill(path: string): string {
  return readFileSync(resolve(PROJECT_ROOT, path), "utf-8");
}

describe("goat-review PR base branch contract", () => {
  it("does not hardcode origin/main as the universal review base", () => {
    for (const path of SKILL_PATHS) {
      const body = readSkill(path);
      assert.doesNotMatch(
        body,
        /origin\/main/,
        `${path} hardcodes origin/main`,
      );
      assert.doesNotMatch(
        body,
        /default:\s*`main`/,
        `${path} defaults PR fallback to main`,
      );
      assert.match(body, /detected review base/, `${path} detects a base`);
      assert.match(body, /baseRefName/, `${path} prefers PR metadata`);
      assert.match(
        body,
        /refs\/remotes\/origin\/HEAD/,
        `${path} detects origin HEAD`,
      );
      assert.match(
        body,
        /git remote show origin/,
        `${path} documents remote fallback discovery`,
      );
      assert.match(
        body,
        /base-detection-failed/,
        `${path} records base detection degradation`,
      );
      assert.match(
        body,
        /last-resort fallback/,
        `${path} only permits main as last resort`,
      );
    }
  });

  it("keeps installed goat-review mirrors byte-aligned with the workflow template", () => {
    const template = readSkill("workflow/skills/goat-review/SKILL.md");
    for (const path of SKILL_PATHS.slice(1)) {
      assert.equal(readSkill(path), template, `${path} drifted from template`);
    }
  });
});
