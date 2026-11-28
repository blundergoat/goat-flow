/**
 * Feedback Loop concern: Are feedback loop directories in place? 2 checks: feedback-loop-active (directory existence), decisions-tracked.
 * A fresh install with zero entries is a valid PASS.
 */
import type {
  AuditContext,
  HarnessCheck,
  HarnessCheckDetails,
} from "../types.js";
import type { CheckEvidence } from "../provenance-types.js";
import { pass, fail } from "./helpers.js";
import { PINNED_GOAT_FLOW_INVOCATION } from "../../advised-command.js";

const VERIFIED_ON = "2026-04-18";
const EMPTY_LEARNING_LOOP_DIAGNOSTICS = new Set([
  "Footgun directory exists but contains 0 entries",
  "Lesson directory exists but contains 0 entries",
]);

/**
 * Keep malformed bucket metadata actionable while accepting a new user's empty learning loop.
 * Use before harness scoring; stats may still describe the empty state without failing setup.
 *
 * @param diagnostic - extractor message; null means the bucket metadata is already clean
 * @returns true for a real format problem; false for null or the valid zero-entry state
 */
function isActionableFormatDiagnostic(
  diagnostic: string | null,
): diagnostic is string {
  // No message is clean, while the two zero-entry messages describe a valid first-run state.
  return (
    diagnostic !== null && !EMPTY_LEARNING_LOOP_DIAGNOSTICS.has(diagnostic)
  );
}

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
  const staleBuckets = buckets
    .filter((bucket) => bucket.freshnessBand === "stale")
    .map((bucket) => ({
      path: bucket.path,
      lastReviewed: bucket.lastReviewed,
    }));
  return {
    // Every audited agent sees the same project-level memory freshness in the dashboard.
    freshness: ctx.agents.map((agentFacts) => ({
      agent: agentFacts.agent.id,
      fresh,
      aging,
      stale: staleBuckets.length,
      staleBuckets,
    })),
  };
}

/** One failing cause of the feedback-loop check: the finding lines, the recommendation and the fix a user acts on. */
interface FeedbackLoopCause {
  findings: string[];
  recommendation: string;
  howToFix: string;
}

/**
 * Report a missing footguns or lessons directory, which leaves future incidents and corrections nowhere durable to go.
 *
 * @param ctx - audit context supplying the configured learning-loop paths and their existence facts
 * @returns the cause naming each missing directory, or null when both exist
 */
function missingDirectoryCause(ctx: AuditContext): FeedbackLoopCause | null {
  const { footguns, lessons } = ctx.facts.shared;
  const missing = [
    ...(footguns.exists ? [] : [ctx.config.config.footguns.path]),
    ...(lessons.exists ? [] : [ctx.config.config.lessons.path]),
  ];
  // Both directories exist, so storage is not a cause.
  if (missing.length === 0) return null;
  return {
    findings: [],
    recommendation: `Create missing directories: ${missing.join(", ")}`,
    howToFix: `Create ${missing.join(" and ")} to enable the feedback loop.`,
  };
}

/**
 * Report learning-loop entries that cite files which no longer exist, which can send the user to removed code.
 *
 * @param ctx - audit context supplying footgun and lesson stale-reference facts
 * @returns the cause with the stale-reference count, or null when every cited path resolves
 */
function staleReferenceCause(ctx: AuditContext): FeedbackLoopCause | null {
  const totalStale =
    ctx.facts.shared.footguns.staleRefs.length +
    ctx.facts.shared.lessons.staleRefs.length;
  // Every cited path resolves, so references are not a cause.
  if (totalStale === 0) return null;
  return {
    findings: [
      `${totalStale} stale file reference(s) in learning loop entries`,
    ],
    recommendation:
      "Fix stale footgun/lesson file references or remove local-path markup",
    howToFix: `Run \`${PINNED_GOAT_FLOW_INVOCATION} stats . --check\`, then update the cited footgun/lesson entries so every backticked local path resolves or is rewritten as external incident prose.`,
  };
}

/**
 * Report brittle line references and malformed bucket metadata, which make durable guidance untrustworthy.
 *
 * @param ctx - audit context supplying invalid line references and bucket format diagnostics
 * @returns the cause listing each problem, or null when anchors and metadata are valid
 */
function invalidReferenceCause(ctx: AuditContext): FeedbackLoopCause | null {
  const invalidLineRefs = [
    ...ctx.facts.shared.footguns.invalidLineRefs,
    ...ctx.facts.shared.lessons.invalidLineRefs,
  ];
  const formatDiagnostics = [
    ctx.facts.shared.footguns.formatDiagnostic,
    ctx.facts.shared.lessons.formatDiagnostic,
  ].filter(isActionableFormatDiagnostic);
  // Anchors and metadata are valid, so neither is a cause.
  if (invalidLineRefs.length === 0 && formatDiagnostics.length === 0) {
    return null;
  }
  return {
    findings: [
      ...invalidLineRefs.map((ref) => `Invalid learning-loop line ref: ${ref}`),
      ...formatDiagnostics,
    ],
    recommendation:
      "Fix invalid learning-loop line refs and bucket metadata before trusting feedback-loop health",
    howToFix: `Run \`${PINNED_GOAT_FLOW_INVOCATION} stats . --check\`, replace brittle file:line references with semantic anchors, and add valid bucket frontmatter.`,
  };
}

/**
 * Report buckets whose last review is old enough that their advice may no longer match the project.
 *
 * @param ctx - audit context supplying footgun and lesson bucket freshness
 * @returns the cause naming each stale bucket, or null when every bucket was reviewed recently
 */
function staleBucketCause(ctx: AuditContext): FeedbackLoopCause | null {
  const staleBuckets = [
    ...ctx.facts.shared.footguns.buckets,
    ...ctx.facts.shared.lessons.buckets,
  ].filter((bucket) => bucket.freshnessBand === "stale");
  // Every bucket was reviewed recently, so freshness is not a cause.
  if (staleBuckets.length === 0) return null;
  return {
    findings: [
      `${staleBuckets.length} learning-loop bucket(s) have stale last_reviewed dates: ${staleBuckets
        .map((bucket) => bucket.path)
        .join(", ")}`,
    ],
    recommendation:
      "Review stale learning-loop buckets and update last_reviewed",
    howToFix:
      "Review each stale bucket, fix any stale advice, and update its YYYY-MM-DD last_reviewed frontmatter.",
  };
}

/**
 * Describe the footguns and lessons directories in the order the check reports them.
 *
 * @param ctx - audit context supplying directory existence, entry counts and bucket counts
 * @returns one line per directory, stating its entries or that it is missing
 */
function directoryFindings(ctx: AuditContext): string[] {
  const { footguns, lessons } = ctx.facts.shared;
  return [
    // An available footgun directory is valid even before the user's first incident.
    footguns.exists
      ? `Footguns directory exists (${footguns.entryCount} entries across ${footguns.buckets.length} files)`
      : "Footguns directory missing",
    // An available lessons directory lets future verification failures become durable guidance.
    lessons.exists
      ? `Lessons directory exists (${lessons.entryCount} entries across ${lessons.buckets.length} files)`
      : "Lessons directory missing",
  ];
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
    // Every audited agent sees whether the shared decision log is available for recovery.
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
    const details = learningLoopFreshnessDetails(ctx);
    // Collect every cause before returning, so one run names everything to fix instead of one cause per audit.
    const causes = [
      missingDirectoryCause(ctx),
      staleReferenceCause(ctx),
      invalidReferenceCause(ctx),
      staleBucketCause(ctx),
    ].filter((cause): cause is FeedbackLoopCause => cause !== null);
    const findings = [
      ...directoryFindings(ctx),
      ...causes.flatMap((cause) => cause.findings),
    ];
    // No cause means storage exists and every reference, anchor, bucket metadata block and bucket review is current.
    if (causes.length === 0) return pass(findings, details);
    return fail(
      findings,
      causes.map((cause) => cause.recommendation),
      causes.map((cause) => cause.howToFix),
      details,
    );
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
    // Without a decision directory, major project choices have no durable recovery path.
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
