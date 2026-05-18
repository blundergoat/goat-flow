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
const DASHBOARD_INDEX_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "index.html",
);

describe("Skills dashboard view", () => {
  it("leads with the evaluator workflow and keeps installed skills as support", () => {
    const source = readFileSync(SKILLS_VIEW_PATH, "utf-8");
    const indexSource = readFileSync(DASHBOARD_INDEX_PATH, "utf-8");

    assert.match(indexSource, />\s*Skill Evaluator\s*</);
    assert.match(source, />\s*Skill Evaluator\s*</);
    assert.match(source, /Evaluate coding-agent skill drafts and bundles/);
    assert.match(source, /class="gf-skill-evaluator-panel"/);
    assert.match(
      source,
      /skillQualityArtifacts\.length \+ ' skill'/,
      "scope strip should count only real skills",
    );
    assert.doesNotMatch(source, /skillQualityArtifacts\.length \+ ' artifact'/);
    assert.match(source, />\s*Installed skills\s*<span/s);
    assert.doesNotMatch(source, />\s*Artifacts\s*<span/s);
    assert.doesNotMatch(source, /Deterministic structural metrics/);
    assert.doesNotMatch(source, /No skills discovered\./);
    assert.match(source, /No installed skills discovered\./);
    assert.match(
      source,
      /Select an installed skill to view its quality metrics\./,
    );
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

  it("evaluates pasted drafts inline as skills and describes local-server scoring", () => {
    const viewSource = readFileSync(SKILLS_VIEW_PATH, "utf-8");
    const appSource = readFileSync(DASHBOARD_APP_PATH, "utf-8");

    assert.match(appSource, /body\.kind = "skill"/);
    assert.match(viewSource, /x-model="skillEvaluatorContent"/);
    assert.match(viewSource, /@click="runSkillEvaluator\(\)"/);
    assert.match(
      viewSource,
      /Evaluation runs on this local dashboard server\./,
    );
    assert.doesNotMatch(viewSource, /No data leaves your browser/);
    assert.doesNotMatch(viewSource, /x-teleport="body"/);
  });

  it("renders inline evaluation result controls and report sections", () => {
    const viewSource = readFileSync(SKILLS_VIEW_PATH, "utf-8");
    const appSource = readFileSync(DASHBOARD_APP_PATH, "utf-8");

    assert.match(
      viewSource,
      /class="gf-modal-actions"[\s\S]*@click="skillEvaluatorReportCopied = true; copySkillEvaluatorReport\(\)"[\s\S]*x-text="skillEvaluatorReportCopied \? 'Copied' : 'Copy report'"/,
    );
    assert.match(viewSource, /skillEvaluatorResult\.metrics/);
    assert.match(viewSource, /skillEvaluatorResult\.tips/);
    assert.match(viewSource, /skillEvaluatorResult\.composedFrom/);
    assert.match(viewSource, /skillEvaluatorSlug\(skillEvaluatorResult\)/);
    assert.doesNotMatch(viewSource, /gf-mrf-actions/);
    assert.doesNotMatch(appSource, /skillEvaluatorOpen/);
    assert.match(appSource, /skillEvaluatorReportCopied:\s*false/);
    assert.match(appSource, /skillEvaluatorReportCopied = false/);
  });
});
