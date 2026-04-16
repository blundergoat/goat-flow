/**
 * Feedback Loop concern: Are feedback loop directories in place?
 * 2 checks: feedback-loop-active (directory existence), decisions-tracked.
 * A fresh install with zero entries is a valid PASS.
 */
import type { HarnessCheck } from "../types.js";
import { pass, fail } from "./helpers.js";

const feedbackLoopActive: HarnessCheck = {
  id: "feedback-loop-active",
  name: "Feedback loop directories exist",
  concern: "feedback_loop",
  run: (ctx) => {
    const findings: string[] = [];
    const missing: string[] = [];

    const footgunsDir = ctx.config.config.footguns.path;
    const lessonsDir = ctx.config.config.lessons.path;

    if (ctx.facts.shared.footguns.exists) {
      findings.push(
        `Footguns directory exists (${ctx.facts.shared.footguns.entryCount} entries)`,
      );
    } else {
      findings.push("Footguns directory missing");
      missing.push(footgunsDir);
    }

    if (ctx.facts.shared.lessons.exists) {
      findings.push(
        `Lessons directory exists (${ctx.facts.shared.lessons.entryCount} entries)`,
      );
    } else {
      findings.push("Lessons directory missing");
      missing.push(lessonsDir);
    }

    if (missing.length > 0) {
      return fail(
        findings,
        [`Create missing directories: ${missing.join(", ")}`],
        [`Create ${missing.join(" and ")} to enable the feedback loop.`],
      );
    }

    // Report stale references (informational, not a failure)
    const footgunStale = ctx.facts.shared.footguns.staleRefs ?? [];
    const lessonStale = ctx.facts.shared.lessons.staleRefs ?? [];
    const totalStale = footgunStale.length + lessonStale.length;
    if (totalStale > 0) {
      findings.push(
        `${totalStale} stale file reference(s) in learning loop entries`,
      );
    }
    return pass(findings);
  },
};

const decisionsTracked: HarnessCheck = {
  id: "decisions-tracked",
  name: "Decisions directory exists",
  concern: "feedback_loop",
  run: (ctx) => {
    const { decisions } = ctx.facts.shared;
    if (!decisions.dirExists) {
      return fail(
        ["No decisions directory"],
        [
          "Create .goat-flow/decisions/ for tracking significant technical decisions",
        ],
        [
          "Create .goat-flow/decisions/ and log significant technical decisions with context and rationale.",
        ],
      );
    }
    return pass([
      `Decisions directory exists (${decisions.fileCount} records)`,
    ]);
  },
};

export const FEEDBACK_LOOP_CHECKS: HarnessCheck[] = [
  feedbackLoopActive,
  decisionsTracked,
];
