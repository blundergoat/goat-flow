/**
 * Unit tests for skill-quality dashboard summaries that temper otherwise-clean scores with evidence limits.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { createContext, runInContext } from "node:vm";
import { ScriptTarget, transpileModule } from "typescript";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const SKILL_QUALITY_FRAGMENT_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "dashboard-app-skill-quality-fragments.ts",
);

interface SkillQualityHelpers {
  dashboardSkillSummaryBanner(
    ctx: { skillReportPct(report: Record<string, unknown>): number },
    report: Record<string, unknown>,
  ): { title: string; desc: string; severity: string };
  dashboardSkillQualityReportFragment(): {
    skillsWithWarningsCount(this: Record<string, unknown>): number;
  };
  dashboardSkillEvaluatorResultFragment(): {
    skillEvaluatorVerdict(report: Record<string, unknown>): {
      title: string;
      desc: string;
    };
  };
}

/** Load the browser-local skill-quality helpers in a script-shaped VM context. */
function loadSkillQualityHelpers(): SkillQualityHelpers {
  const source = readFileSync(SKILL_QUALITY_FRAGMENT_PATH, "utf-8");
  const compiled = transpileModule(source, {
    compilerOptions: { target: ScriptTarget.ES2023 },
  }).outputText;
  const context = createContext({});
  runInContext(
    `${compiled}
globalThis.__helpers = {
  dashboardSkillSummaryBanner,
  dashboardSkillQualityReportFragment,
  dashboardSkillEvaluatorResultFragment,
};`,
    context,
  );
  return (context as typeof context & { __helpers: SkillQualityHelpers })
    .__helpers;
}

/** Build an otherwise-clean report whose composed evidence hit the safety cap. */
function truncatedCleanReport(): Record<string, unknown> {
  return {
    artifact: {
      id: "skill:probe",
      name: "probe",
      path: ".agents/skills/probe/SKILL.md",
      kind: "skill",
      source: "agent-mirror",
    },
    totalScore: 100,
    maxTotalScore: 100,
    profileMax: 100,
    subtype: "workflow",
    detectedShape: "workflow",
    shapeConfidence: 1,
    shapeMismatch: false,
    classification: {
      detectedSubtype: "workflow",
      confidence: 1,
      alternatives: [],
      reasoning: [],
    },
    recommendation: "keep-skill",
    metrics: [],
    composedFrom: ["SKILL.md", "skill-preamble.md"],
    fitNotes: ["composition truncated at 32KB"],
  };
}

describe("skill-quality dashboard summaries", () => {
  it("shows composition truncation as a partial-evidence warning", () => {
    const helpers = loadSkillQualityHelpers();
    const report = truncatedCleanReport();

    const banner = helpers.dashboardSkillSummaryBanner(
      { skillReportPct: () => 1 },
      report,
    );
    assert.equal(banner.severity, "warn");
    assert.match(banner.title, /partial evidence/iu);
    assert.match(banner.desc, /composition truncated at 32KB/iu);

    const reportFragment = helpers.dashboardSkillQualityReportFragment();
    assert.equal(
      reportFragment.skillsWithWarningsCount.call({
        skillQualityReports: { "skill:probe": report },
      }),
      1,
    );

    const evaluator = helpers.dashboardSkillEvaluatorResultFragment();
    const verdict = evaluator.skillEvaluatorVerdict({ ...report, tips: [] });
    assert.match(verdict.title, /partial evidence/iu);
    assert.match(verdict.desc, /composition truncated at 32KB/iu);
  });
});
