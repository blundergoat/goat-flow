/**
 * Feedback Loop concern: Are feedback loop directories in place?
 * 2 checks: feedback-loop-active (directory existence), decisions-tracked.
 * A fresh install with zero entries is a valid PASS.
 */
import type {
  AuditContext,
  HarnessCheck,
  HarnessCheckDetails,
} from "../types.js";
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

/**
 * Build per-agent freshness rows from project-level learning-loop facts.
 *
 * Footguns and lessons are shared project memory, but the harness renderer
 * expects details keyed by agent so every check can use one details shape.
 */
function learningLoopFreshnessDetails(ctx: AuditContext): HarnessCheckDetails {
  const buckets = [
    ...ctx.facts.shared.footguns.buckets,
    ...ctx.facts.shared.lessons.buckets,
  ];
  const fresh = buckets.filter(
    (bucket) => bucket.freshnessBand === "fresh",
  ).length;
  const aging = buckets.filter(
    (bucket) => bucket.freshnessBand === "aging",
  ).length;
  const stale = buckets.filter(
    (bucket) => bucket.freshnessBand === "stale",
  ).length;
  return {
    freshness: ctx.agents.map((agentFacts) => ({
      agent: agentFacts.agent.id,
      fresh,
      aging,
      stale,
    })),
  };
}

/**
 * Build the decision-log freshness row for each audited agent.
 *
 * ADRs are also shared project memory, but repeating the same counts per agent
 * preserves the dashboard/table contract used by every harness concern.
 */
function decisionsFreshnessDetails(ctx: AuditContext): HarnessCheckDetails {
  const { decisions } = ctx.facts.shared;
  return {
    freshness: ctx.agents.map((agentFacts) => ({
      agent: agentFacts.agent.id,
      fresh: decisions.dirExists ? decisions.fileCount : 0,
      aging: 0,
      stale: decisions.dirExists ? 0 : 1,
    })),
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
    const details = learningLoopFreshnessDetails(ctx);

    const footgunsDir = ctx.config.config.footguns.path;
    const lessonsDir = ctx.config.config.lessons.path;

    if (ctx.facts.shared.footguns.exists) {
      const fileCount = ctx.facts.shared.footguns.buckets.length;
      findings.push(
        `Footguns directory exists (${ctx.facts.shared.footguns.entryCount} entries across ${fileCount} files)`,
      );
    } else {
      findings.push("Footguns directory missing");
      missing.push(footgunsDir);
    }

    if (ctx.facts.shared.lessons.exists) {
      const fileCount = ctx.facts.shared.lessons.buckets.length;
      findings.push(
        `Lessons directory exists (${ctx.facts.shared.lessons.entryCount} entries across ${fileCount} files)`,
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
        details,
      );
    }

    const footgunStale = ctx.facts.shared.footguns.staleRefs;
    const lessonStale = ctx.facts.shared.lessons.staleRefs;
    const totalStale = footgunStale.length + lessonStale.length;
    const invalidLineRefs = [
      ...ctx.facts.shared.footguns.invalidLineRefs,
      ...ctx.facts.shared.lessons.invalidLineRefs,
    ];
    const formatDiagnostics = [
      ctx.facts.shared.footguns.formatDiagnostic,
      ctx.facts.shared.lessons.formatDiagnostic,
    ].filter((item): item is string => typeof item === "string");
    const staleBuckets = [
      ...ctx.facts.shared.footguns.buckets,
      ...ctx.facts.shared.lessons.buckets,
    ].filter((bucket) => bucket.freshnessBand === "stale");
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
          "Run `goat-flow stats . --check` (or `npx goat-flow stats . --check`), then update the cited footgun/lesson entries so every backticked local path resolves or is rewritten as external incident prose.",
        ],
        details,
      );
    }
    if (invalidLineRefs.length > 0 || formatDiagnostics.length > 0) {
      findings.push(
        ...invalidLineRefs.map(
          (ref) => `Invalid learning-loop line ref: ${ref}`,
        ),
        ...formatDiagnostics,
      );
      return fail(
        findings,
        [
          "Fix invalid learning-loop line refs and bucket metadata before trusting feedback-loop health",
        ],
        [
          "Run `goat-flow stats . --check`, replace brittle file:line references with semantic anchors, and add valid bucket frontmatter.",
        ],
        details,
      );
    }
    if (staleBuckets.length > 0) {
      findings.push(
        `${staleBuckets.length} learning-loop bucket(s) have stale last_reviewed dates: ${staleBuckets
          .map((bucket) => bucket.path)
          .join(", ")}`,
      );
      return fail(
        findings,
        ["Review stale learning-loop buckets and update last_reviewed"],
        [
          "Review each stale bucket, fix any stale advice, and update its YYYY-MM-DD last_reviewed frontmatter.",
        ],
        details,
      );
    }
    return pass(findings, details);
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
    const details = decisionsFreshnessDetails(ctx);
    if (!decisions.dirExists) {
      return fail(
        ["No decisions directory"],
        [
          "Create .goat-flow/learning-loop/decisions/ for tracking significant technical decisions",
        ],
        [
          "Create .goat-flow/learning-loop/decisions/ and log significant technical decisions with context and rationale.",
        ],
        details,
      );
    }
    return pass(
      [`Decisions directory exists (${decisions.fileCount} records)`],
      details,
    );
  },
};

export const FEEDBACK_LOOP_CHECKS: HarnessCheck[] = [
  feedbackLoopActive,
  decisionsTracked,
];
