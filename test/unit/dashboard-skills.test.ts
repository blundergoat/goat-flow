/**
 * Unit tests for the Skills dashboard view source.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const SKILLS_VIEW_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "views",
  "skills.html",
);
const DASHBOARD_APP_PATH = resolve(PROJECT_ROOT, "src", "dashboard", "app.ts");

describe("Skills dashboard view", () => {
  it("labels the inventory as skills", () => {
    const source = readFileSync(SKILLS_VIEW_PATH, "utf-8");

    assert.match(
      source,
      /skillQualityArtifacts\.length \+ ' skill'/,
      "scope strip should count only real skills",
    );
    assert.doesNotMatch(source, /skillQualityArtifacts\.length \+ ' artifact'/);
    assert.match(source, />\s*Skills\s*<span/s);
    assert.doesNotMatch(source, />\s*Artifacts\s*<span/s);
    assert.match(source, /No skills discovered\./);
    assert.match(source, /Select a skill to view its quality metrics\./);
    assert.match(source, /Re-audit skill/);
  });

  it("does not render shared references in the sidebar", () => {
    const viewSource = readFileSync(SKILLS_VIEW_PATH, "utf-8");
    const appSource = readFileSync(DASHBOARD_APP_PATH, "utf-8");

    assert.match(appSource, /artifact\.kind === "skill"/);
    assert.match(appSource, /isRecord\(artifact\)/);
    assert.doesNotMatch(viewSource, /kind\s*===\s*['"]shared-reference['"]/);
    assert.doesNotMatch(viewSource, />\s*References\s*<span/s);
  });

  it("guards skill report prefetch writes with a generation token", () => {
    const appSource = readFileSync(DASHBOARD_APP_PATH, "utf-8");

    assert.match(appSource, /skillQualityPrefetchGeneration:\s*0/);
    assert.match(
      appSource,
      /this\.skillQualityPrefetchGeneration !== generation/,
    );
    assert.match(appSource, /prefetchSkillReports\([^)]*generation/s);
  });
});
