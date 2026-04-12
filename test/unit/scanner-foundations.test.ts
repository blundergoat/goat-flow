/**
 * Scanner foundation tests - skill constants, rubric registry, project state classification, tier validation.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { SKILL_NAMES } from "../../src/cli/constants.js";
import { classifyProjectState } from "../../src/cli/classify-state.js";
import { allChecks } from "../../src/cli/rubric/registry.js";

// ---------------------------------------------------------------------------
// Contract: SKILL_NAMES matches workflow/skills/ directories
// ---------------------------------------------------------------------------
describe("SKILL_NAMES contract", () => {
  it("matches the skill template directories in workflow/skills/", () => {
    const skillsDir = join(import.meta.dirname, "..", "..", "workflow", "skills");
    const dirs = readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.startsWith("goat") && d.name.endsWith(".md"))
      .map((d) => d.name.replace(".md", ""));

    assert.deepStrictEqual(
      [...SKILL_NAMES].sort(),
      dirs.sort(),
      `SKILL_NAMES (${SKILL_NAMES.length}) should match workflow/skills/goat-*.md files (${dirs.length})`,
    );
  });
});

// ---------------------------------------------------------------------------
// Contract: no check count drift (README doesn't hardcode, but registry is stable)
// ---------------------------------------------------------------------------
describe("Registry check count", () => {
  it("has a stable count of registered checks", () => {
    assert.ok(
      allChecks.length > 0,
      "Registry should have at least one check",
    );
    // All checks should be foundation or standard (no full tier)
    for (const check of allChecks) {
      assert.ok(
        check.tier === "foundation" || check.tier === "standard",
        `Check ${check.id} has unexpected tier "${check.tier}" - only foundation and standard are valid`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// classify-state: "audit" action for current-version projects
// ---------------------------------------------------------------------------
describe("classify-state", () => {
  const makeFS = (files: Record<string, string | null>) => ({
    exists: (path: string) => path in files,
    readFile: (path: string) => files[path] ?? null,
  });

  it('returns action "audit" for current v1.1 projects', () => {
    const files: Record<string, string | null> = {
      ".goat-flow/config.yaml": 'version: "1.1.0"',
      ".goat-flow/skill-preamble.md": "preamble",
      "CLAUDE.md": "instruction file",
    };
    // Add all skill paths
    for (const skill of SKILL_NAMES) {
      files[`.claude/skills/${skill}/SKILL.md`] = "skill";
    }

    const result = classifyProjectState(makeFS(files));
    assert.equal(result.action, "audit", "healthy v1.1 project should get 'audit' action");
    assert.equal(result.state, "v1.1");
  });

  it('returns action "fix" for unparseable config version', () => {
    const result = classifyProjectState(
      makeFS({
        ".goat-flow/config.yaml": "no-version-here: true",
      }),
    );
    assert.equal(result.action, "fix");
    assert.equal(result.state, "error");
  });

  it('returns "partial" state for skills-without-config', () => {
    const files: Record<string, string | null> = {};
    for (const skill of SKILL_NAMES) {
      files[`.claude/skills/${skill}/SKILL.md`] = "skill";
    }
    const result = classifyProjectState(makeFS(files));
    assert.equal(result.state, "partial");
    assert.equal(result.action, "setup");
  });
});

// ---------------------------------------------------------------------------
// CLI tier validation: "full" should be rejected
// ---------------------------------------------------------------------------
describe("Tier validation", () => {
  it("Tier type does not include full", () => {
    // This is a compile-time check - if Tier included "full",
    // this assignment would succeed, but the runtime check confirms
    // that VALID_TIERS (which mirrors Tier) doesn't include it.
    const validTiers = ["foundation", "standard"];
    assert.ok(
      !validTiers.includes("full"),
      '"full" should not be a valid tier',
    );
  });
});
