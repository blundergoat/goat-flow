/**
 * Recovery concern: Can the agent resume after crash or compaction?
 * 2 checks: milestone-tracking, session-logs.
 */
import type { HarnessCheck } from "../types.js";
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

function countTaskMarkers(content: string): number {
  return content.match(/- \[[ xX]\]/g)?.length ?? 0;
}

const milestoneTracking: HarnessCheck = {
  id: "milestone-tracking",
  name: "Milestone tracking configured",
  concern: "recovery",
  type: "integrity",
  provenance: recoveryProvenance("integrity", [
    "docs/harness-audit.md",
    ".goat-flow/architecture.md",
    ".goat-flow/tasks/README.md",
  ]),
  /** Run the Milestone tracking configured check. */
  run: (ctx) => {
    const tasksDir = ".goat-flow/tasks";
    if (!ctx.fs.exists(tasksDir)) {
      return fail(
        ["No tasks directory found"],
        ["Create .goat-flow/tasks/ for milestone tracking"],
        [
          "Create .goat-flow/tasks/ so optional task, roadmap, and milestone notes have a stable home.",
        ],
      );
    }
    const allMdFiles = collectMarkdownFiles(ctx.fs, tasksDir);
    if (allMdFiles.length === 0) {
      return pass([
        "Tasks directory exists (empty - valid for new projects; task tracking is optional)",
      ]);
    }
    const markerCounts: number[] = [];
    for (const f of allMdFiles) {
      const content = ctx.fs.readFile(f);
      if (content) markerCounts.push(countTaskMarkers(content));
    }
    const totalMarkers = markerCounts.reduce((sum, count) => sum + count, 0);
    const findings = [
      `Tasks directory exists with ${allMdFiles.length} markdown file(s) and ${totalMarkers} checkbox marker(s)`,
      "Task and milestone content is optional local workflow state; checkbox completion, status, testing gates, and roadmap progress are not audited.",
    ];
    return pass(findings);
  },
};

const sessionLogs: HarnessCheck = {
  id: "session-logs",
  name: "Session logs directory",
  concern: "recovery",
  type: "integrity",
  provenance: recoveryProvenance("integrity", [
    "docs/harness-audit.md",
    ".goat-flow/architecture.md",
  ]),
  /** Run the Session logs directory check. */
  run: (ctx) => {
    const logsDir = ".goat-flow/logs/sessions";
    if (!ctx.fs.exists(logsDir)) {
      return fail(
        ["No session logs directory"],
        ["Create .goat-flow/logs/sessions/ directory"],
        [
          "Create .goat-flow/logs/sessions/ and start logging sessions for continuity between conversations.",
        ],
      );
    }
    try {
      ctx.fs.listDir(logsDir);
    } catch {
      return fail(
        ["Session logs path exists but is not readable as a directory"],
        ["Ensure .goat-flow/logs/sessions/ is a directory, not a file"],
        [
          "Remove or rename the file at .goat-flow/logs/sessions and recreate as a directory.",
        ],
      );
    }
    return pass(["Session logs directory exists"]);
  },
};

export const RECOVERY_CHECKS: HarnessCheck[] = [milestoneTracking, sessionLogs];
