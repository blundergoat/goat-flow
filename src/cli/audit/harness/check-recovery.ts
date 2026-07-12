/**
 * Recovery concern for users returning after a crash, compaction, or interrupted coding session.
 * It checks whether milestone notes and session-log storage are available to the agent.
 * The audit reports structural readiness separately from proof that the latest work can resume.
 */
import type {
  HarnessCheck,
  HarnessCheckDetails,
  HarnessCheckResult,
} from "../types.js";
import type { CheckEvidence } from "../provenance-types.js";
import { pass, fail } from "./helpers.js";
import { collectMarkdownFiles } from "./helpers.js";

const VERIFIED_ON = "2026-04-18";

/** Return the recovery provenance. */
function recoveryProvenance(
  type: HarnessCheck["type"],
  paths: string[],
  sourceType: CheckEvidence["source_type"] = "spec",
): CheckEvidence {
  return {
    source_type: sourceType,
    source_urls: [],
    verified_on: VERIFIED_ON,
    normative_level:
      type === "integrity"
        ? "MUST"
        : type === "advisory"
          ? "SHOULD"
          : "BEST_PRACTICE",
    evidence_paths: paths,
  };
}

/**
 * Count markdown checkbox markers without interpreting task completion.
 *
 * Recovery checks only report whether milestone notes contain local workflow
 * state; they intentionally avoid scoring incomplete checkboxes as failures.
 */
function countTaskMarkers(content: string): number {
  // No markers means the user has not recorded checkbox-based task progress in this file.
  return content.match(/- \[[ xX]\]/g)?.length ?? 0;
}

/** Return a structural pass that warns users it is not proof of end-to-end recovery. */
function limitedRecoveryPass(
  findings: string[],
  details: HarnessCheckDetails,
): HarnessCheckResult {
  const result = pass(findings, details);
  result.assurance = "limited";
  return result;
}

const milestoneTracking: HarnessCheck = {
  id: "milestone-tracking",
  name: "Milestone tracking configured",
  concern: "recovery",
  type: "integrity",
  evidenceKind: "structural",
  provenance: recoveryProvenance("integrity", [
    "docs/harness-audit.md",
    ".goat-flow/architecture.md",
    ".goat-flow/plans/README.md",
  ]),
  /** Show whether the project has a stable place for task progress when a user resumes work. */
  run: (ctx) => {
    const plansDir = ".goat-flow/plans";
    /** Build per-agent storage details for the audit UI and JSON report. */
    const buildDetails = (fileCount: number): HarnessCheckDetails => ({
      recovery: ctx.agents.map((af) => ({
        agent: af.agent.id,
        dir: plansDir,
        fileCount,
      })),
    });
    // Without plan storage, the user has no standard local place to recover milestone progress.
    if (!ctx.fs.exists(plansDir)) {
      return fail(
        ["No plans directory found"],
        ["Create .goat-flow/plans/ for milestone tracking"],
        [
          "Create .goat-flow/plans/ so optional task, roadmap, and milestone notes have a stable home.",
        ],
        buildDetails(0),
      );
    }
    const allMdFiles = collectMarkdownFiles(ctx.fs, plansDir);
    // A new project can show an empty plan area without being treated as broken.
    if (allMdFiles.length === 0) {
      return limitedRecoveryPass(
        [
          "Plans directory exists (empty - valid for new projects; plan tracking is optional)",
        ],
        buildDetails(0),
      );
    }
    const markerCounts: number[] = [];
    // Count visible task markers in each note without judging whether the user's work is complete.
    for (const markdownFile of allMdFiles) {
      const content = ctx.fs.readFile(markdownFile);
      // An unreadable or empty note contributes no recoverable checkbox state for the user.
      if (content) {
        markerCounts.push(countTaskMarkers(content));
      }
    }
    const totalMarkers = markerCounts.reduce((sum, count) => sum + count, 0);
    const findings = [
      `Plans directory exists with ${allMdFiles.length} markdown file(s) and ${totalMarkers} checkbox marker(s)`,
      "Task and milestone content is optional local workflow state; checkbox completion, status, testing gates, and roadmap progress are not audited.",
    ];
    return limitedRecoveryPass(findings, buildDetails(allMdFiles.length));
  },
};

const sessionLogs: HarnessCheck = {
  id: "session-logs",
  name: "Session logs directory",
  concern: "recovery",
  type: "integrity",
  evidenceKind: "structural",
  provenance: recoveryProvenance("integrity", [
    "docs/harness-audit.md",
    ".goat-flow/architecture.md",
  ]),
  /** Show whether agents have a stable local log area when a user returns after interruption. */
  run: (ctx) => {
    const logsDir = ".goat-flow/logs/sessions";
    /** Build per-agent session-log details for the audit UI and JSON report. */
    const buildDetails = (fileCount: number): HarnessCheckDetails => ({
      recovery: ctx.agents.map((af) => ({
        agent: af.agent.id,
        dir: logsDir,
        fileCount,
      })),
    });
    // Without the directory, an interrupted user cannot rely on the standard continuity-log location.
    if (!ctx.fs.exists(logsDir)) {
      return fail(
        ["No session logs directory"],
        ["Create .goat-flow/logs/sessions/ directory"],
        [
          "Create .goat-flow/logs/sessions/ and start logging sessions for continuity between conversations.",
        ],
        buildDetails(0),
      );
    }
    let fileCount = 0;
    try {
      fileCount = ctx.fs
        .listDir(logsDir)
        .filter((fileName) => fileName.endsWith(".md")).length;
    } catch {
      // For example, the user may have a file named `sessions` where the UI expects a directory.
      return fail(
        ["Session logs path exists but is not readable as a directory"],
        ["Ensure .goat-flow/logs/sessions/ is a directory, not a file"],
        [
          "Remove or rename the file at .goat-flow/logs/sessions and recreate as a directory.",
        ],
        buildDetails(0),
      );
    }
    return limitedRecoveryPass(
      ["Session logs directory exists"],
      buildDetails(fileCount),
    );
  },
};

export const RECOVERY_CHECKS: HarnessCheck[] = [milestoneTracking, sessionLogs];
