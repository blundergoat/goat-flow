/**
 * Feedback Loop concern: Are feedback loop directories in place?
 * 2 checks: feedback-loop-active (directory existence), decisions-tracked.
 * A fresh install with zero entries is a valid PASS.
 */
import type { HarnessCheck } from "../types.js";
import type { CheckEvidence } from "../provenance-types.js";
import { pass, fail } from "./helpers.js";

const VERIFIED_ON = "2026-04-18";

/** Return the feedback provenance. */
function feedbackProvenance(
  type: HarnessCheck["type"],
  paths: string[],
): CheckEvidence {
  return {
    source_type: "spec",
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

const feedbackLoopActive: HarnessCheck = {
  id: "feedback-loop-active",
  name: "Feedback loop directories exist",
  concern: "feedback_loop",
  type: "integrity",
  provenance: feedbackProvenance("integrity", [
    "docs/harness-audit.md",
    ".goat-flow/architecture.md",
  ]),
  /** Run the Feedback loop directories exist check. */
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

    const footgunStale = ctx.facts.shared.footguns.staleRefs;
    const lessonStale = ctx.facts.shared.lessons.staleRefs;
    const totalStale = footgunStale.length + lessonStale.length;
    if (totalStale > 0) {
      findings.push(
        `${totalStale} stale file reference(s) in learning loop entries`,
      );
      return fail(
        findings,
        [
          "Fix stale footgun/lesson file references or remove local-path markup",
        ],
        [
          "Run `node --import tsx src/cli/cli.ts stats . --check`, then update the cited footgun/lesson entries so every backticked local path resolves or is rewritten as external incident prose.",
        ],
      );
    }
    return pass(findings);
  },
};

const decisionsTracked: HarnessCheck = {
  id: "decisions-tracked",
  name: "Decisions directory exists",
  concern: "feedback_loop",
  type: "integrity",
  provenance: feedbackProvenance("integrity", [
    "docs/harness-audit.md",
    ".goat-flow/architecture.md",
  ]),
  /** Run the Decisions directory exists check. */
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
