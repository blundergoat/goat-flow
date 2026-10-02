/**
 * Regression coverage for descriptor-bound quality report persistence.
 * This fixture mutates only a temporary project root and never the assessed checkout.
 */
import { getQualityRubricId } from "../../src/cli/quality/rubric.js";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
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
import { makeCurrentQualityReport } from "../fixtures/quality-report.js";
import { parseQualityReport } from "../../src/cli/quality/schema.js";
import { QUALITY_CONCERNS } from "../../src/cli/quality/schema-types.js";
import { countQualityConcerns } from "../../src/cli/quality/fix-references.js";

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
    rubric_version: getQualityRubricId("skills"),
    quality_mode: "skills",
    prior_report_id: null,
    assessment_context: {
      project_revision: "a".repeat(40),
      working_tree_state: "clean",
      grounding_status: "complete",
      unverified_probes: [],
      score_confidence: "high",
      workspace_snapshot: {
        start: `review-v1:sha256:${"a".repeat(64)}`,
        end: `review-v1:sha256:${"a".repeat(64)}`,
      },
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
    improvements: [],
  };
}

describe("quality save safety", () => {
  /**
   * Fixture purpose: relocates the allocated parent during descriptor-bound writing and proves the post-write identity gate rejects it.
   * Filesystem side effects: renames and replaces paths only inside the temporary project root.
   * Error behavior: skips only when the host denies the open-child rename with EPERM;
   * other setup failures propagate.
   */
  it("fails closed when the allocated report parent moves during writing", (t) => {
    const projectRoot = mkdtempSync(resolve(tmpdir(), "quality-relocated-"));
    execFileSync("git", ["-C", projectRoot, "init", "--quiet"], {
      stdio: "ignore",
    });
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
      // Probe the same open-child rename before crediting the saver with containment.
      // Linux CI's test-fast job runs the invariant when this host cannot stage it.
      const probeDirectory = resolve(projectRoot, "rename-probe");
      mkdirSync(probeDirectory);
      const probeDescriptor = openSync(
        resolve(probeDirectory, "report"),
        "wx",
        0o600,
      );
      try {
        renameSync(probeDirectory, `${probeDirectory}-moved`);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "EPERM" &&
          "syscall" in error &&
          error.syscall === "rename"
        ) {
          t.skip(
            "Host denies renaming a directory with an open report (EPERM)",
          );
          return;
        }
        throw error;
      } finally {
        closeSync(probeDescriptor);
      }
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

describe("quality concerns and fix record parsing", () => {
  it("requires one current concern and retains unclassified legacy findings", () => {
    const report = makeCurrentQualityReport(
      "/tmp/quality-concerns",
      "Observed test evidence",
    );
    for (const concern of QUALITY_CONCERNS) {
      report.findings[0].concern = concern;
      assert.equal(parseQualityReport(report).ok, true, concern);
    }
    const { concern: _concern, ...legacyFinding } = report.findings[0];
    const legacy = { ...report, findings: [legacyFinding] };
    assert.equal(parseQualityReport(legacy).ok, false);
    const parsedLegacy = parseQualityReport(legacy, {
      requireCurrentFields: false,
    });
    assert.ok(parsedLegacy.ok);
    assert.equal(countQualityConcerns(parsedLegacy.report).unclassified, 1);
    assert.equal(
      parseQualityReport({
        ...report,
        findings: [{ ...legacyFinding, concern: "unknown" }],
      }).ok,
      false,
    );
  });

  it("parses both fixed targets, retains missing proof and discards incoming admission claims", () => {
    const report = makeCurrentQualityReport(
      "/tmp/quality-fixes",
      "Observed test evidence",
    );
    const capture = {
      file: ".goat-flow/logs/review/capture.json",
      sha256: "a".repeat(64),
    };
    const targets = [
      { kind: "commit", revision: "a".repeat(40) },
      {
        kind: "workspace-snapshot",
        fingerprint: `review-v1:sha256:${"b".repeat(64)}`,
        capture,
      },
    ];
    for (const target of targets) {
      const parsed = parseQualityReport({
        ...report,
        fixes: [
          {
            conclusion: "assessor-verified",
            target,
            reference_check: {
              status: "confirmed",
              reason: "Untrusted supplied status",
            },
          },
        ],
      });
      assert.ok(parsed.ok);
      assert.deepEqual(parsed.report.fixes?.[0], {
        conclusion: "assessor-verified",
        target,
        prior_report_id: null,
        finding_id: null,
        explanation: null,
        evidence: null,
      });
    }
    assert.equal(
      parseQualityReport({
        ...report,
        fixes: [
          {
            conclusion: "assessor-verified",
            target: { kind: "commit", revision: "HEAD" },
          },
        ],
      }).ok,
      false,
    );
    assert.equal(
      parseQualityReport({
        ...report,
        fixes: [{ conclusion: "assessor-verified", unexpected: true }],
      }).ok,
      false,
    );
  });
});
