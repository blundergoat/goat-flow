/**
 * Regression coverage for descriptor-bound quality report persistence.
 * This fixture mutates only a temporary project root and never the assessed checkout.
 */
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLIError } from "../../src/cli/cli-error.js";
import { getPackageVersion } from "../../src/cli/paths.js";
import { persistQualityReportText } from "../../src/cli/quality/quality-command.js";
import { makeQualityScoreRationale } from "../fixtures/quality-score-rationale.js";

/** Build the smallest current report accepted by the persistence contract. */
function currentQualityReport(projectRoot: string) {
  const version = getPackageVersion();
  return {
    report_kind: "goat-flow-quality-report",
    goat_flow_version: version,
    agent: "codex",
    project_path: projectRoot,
    run_date: "2026-08-29",
    audit_status: "pass",
    scope: "framework-self",
    rubric_version: version,
    quality_mode: "skills",
    prior_report_id: null,
    assessment_context: {
      project_revision: "a".repeat(40),
      working_tree_state: "clean",
      grounding_status: "complete",
      unverified_probes: [],
      score_confidence: "high",
    },
    scores: {
      setup: {
        total: 0,
        accuracy: 0,
        relevance: 0,
        completeness: 0,
        friction: 0,
      },
      system: {
        total: 0,
        usefulness: 0,
        signal_to_noise: 0,
        adaptability: 0,
        learnability: 0,
      },
    },
    score_rationale: makeQualityScoreRationale(),
    findings: [],
    refuted_candidates: [],
  };
}

describe("quality save safety", () => {
  /**
   * Fixture purpose: relocates the allocated parent during descriptor-bound writing and proves the post-write identity gate rejects it.
   * Filesystem side effects: renames and replaces paths only inside the temporary project root.
   */
  it("fails closed when the allocated report parent moves during writing", () => {
    const projectRoot = mkdtempSync(resolve(tmpdir(), "quality-relocated-"));
    execFileSync("git", ["-C", projectRoot, "init", "--quiet"]);
    writeFileSync(
      resolve(projectRoot, ".gitignore"),
      ".goat-flow/logs/quality/*.json\n",
    );
    const qualityDirectory = resolve(projectRoot, ".goat-flow/logs/quality");
    const movedQualityDirectory = resolve(
      projectRoot,
      ".goat-flow/logs/quality-moved",
    );

    try {
      assert.throws(
        () =>
          persistQualityReportText(
            {
              projectPath: projectRoot,
              rawText: JSON.stringify(currentQualityReport(projectRoot)),
            },
            {
              CLIError,
              /** Moves the parent, installs an empty replacement, then writes only through the pinned descriptor. */
              writeReportFile(reportDescriptor: number, report: string): void {
                renameSync(qualityDirectory, movedQualityDirectory);
                mkdirSync(qualityDirectory);
                writeFileSync(reportDescriptor, report);
              },
            },
          ),
        /allocated report changed before persistence completed/u,
      );
      const [movedReportName] = readdirSync(movedQualityDirectory);
      assert.ok(movedReportName, "moved allocation must remain inspectable");
      assert.equal(
        readFileSync(resolve(movedQualityDirectory, movedReportName), "utf8"),
        "",
      );
      assert.deepEqual(readdirSync(qualityDirectory), []);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
