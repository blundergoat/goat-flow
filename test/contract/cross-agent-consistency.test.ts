/**
 * Contract tests: cross-surface consistency - versions, skill counts, scope coverage.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SKILL_NAMES } from "../../src/cli/constants.js";
import { AUDIT_VERSION } from "../../src/cli/constants.js";
import { getProjectStructure } from "../../src/cli/paths.js";
import { BUILD_CHECKS } from "../../src/cli/audit/agent-setup-checks.js";
import { QUALITY_CHECKS } from "../../src/cli/audit/harness-checks.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");

// ---------------------------------------------------------------------------
// Package version matches AUDIT_VERSION
// ---------------------------------------------------------------------------
describe("version alignment", () => {
  it("package.json version matches AUDIT_VERSION", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(PROJECT_ROOT, "package.json"), "utf-8"),
    );
    assert.equal(
      pkg.version,
      AUDIT_VERSION,
      `package.json (${pkg.version}) must match AUDIT_VERSION (${AUDIT_VERSION})`,
    );
  });
});

// ---------------------------------------------------------------------------
// SKILL_NAMES count matches project-structure.json canonical skills
// ---------------------------------------------------------------------------
describe("skill count alignment", () => {
  it("SKILL_NAMES matches project-structure.json canonical skills", () => {
    const structure = getProjectStructure();
    const skills = structure.skills as { canonical: string[] } | undefined;
    const canonical = skills?.canonical ?? [];
    assert.deepStrictEqual(
      [...SKILL_NAMES].sort(),
      [...canonical].sort(),
      `SKILL_NAMES (${SKILL_NAMES.length}) must match project-structure.json canonical (${canonical.length})`,
    );
  });
});

// ---------------------------------------------------------------------------
// Build checks have unique IDs
// ---------------------------------------------------------------------------
describe("build check IDs", () => {
  it("all build check IDs are unique", () => {
    const ids = BUILD_CHECKS.map((c) => c.id);
    const unique = new Set(ids);
    assert.equal(
      ids.length,
      unique.size,
      `Duplicate build check IDs: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Quality checks cover all 5 concerns
// ---------------------------------------------------------------------------
describe("quality check concern coverage", () => {
  it("quality checks cover all 5 harness concerns", () => {
    const concerns = new Set(QUALITY_CHECKS.map((c) => c.concern));
    assert.ok(concerns.has("context"), "Should have context checks");
    assert.ok(concerns.has("constraints"), "Should have constraints checks");
    assert.ok(concerns.has("verification"), "Should have verification checks");
    assert.ok(concerns.has("recovery"), "Should have recovery checks");
    assert.ok(
      concerns.has("feedback_loop"),
      "Should have feedback_loop checks",
    );
  });
});
