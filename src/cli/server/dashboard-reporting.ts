/**
 * Assembles dashboard audit reports and manages their content-aware caches.
 * Use when Home, audit, or quality routes need current scores and memory context.
 * Stable sentinels keep partial projects usable; content signatures prevent stale reports.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { AGENT_PROFILE_MAP } from "./dashboard-route-types.js";
import type {
  DashboardAuditProfileSpan,
  DashboardAuditProfiler,
} from "./dashboard-route-types.js";
import type { AuditReport } from "../audit/types.js";
import { loadConfig } from "../config/reader.js";
import { createFS } from "../facts/fs.js";
import { extractSharedFacts } from "../facts/shared/index.js";
import type { QualityHistoryEntry } from "../quality/history.js";
import { collectIndexFreshness } from "../stats/index-freshness.js";
import { buildStatsReport, checkStats } from "../stats/stats.js";
import type { AgentId } from "../types.js";
import {
  parseBucket,
  resolveIndexBucketPaths,
} from "../learning-loop-index/parse-bucket.js";
import { resolveLocalStatePath } from "./local-paths.js";
import type { DashboardReport } from "./types.js";

/** Home-card projection of the latest quality report, stripped to display totals. */
interface LatestQualitySummary {
  id: string;
  date: string;
  time: string;
  agent: AgentId;
  setupTotal: number;
  systemTotal: number;
  blockerCount: number;
  majorCount: number;
  minorCount: number;
  evidenceMethods: string[];
  scope: string | null;
}

/** Compact learning-loop entry shown without loading the full lesson file. */
interface RecentLessonSummary {
  title: string;
  created: string | null;
  path: string;
  order: number;
}

/**
 * Decide whether to collect per-span audit timings for one request. Profiling is gated on both an
 * explicit opt-in and a trust signal so an untrusted caller cannot force the extra timing work.
 *
 * @param url - the request URL; profiling requires the `profile=true` query parameter
 * @param isDevMode - true when the server runs in dev mode; otherwise the `GOAT_FLOW_AUDIT_PROFILE=1`
 *   environment flag must be set to allow profiling on a packaged server
 * @returns true only when the request opts in AND the server is trusted to expose timings
 */
export function shouldProfileAuditRequest(
  url: URL,
  isDevMode: boolean,
): boolean {
  return (
    url.searchParams.get("profile") === "true" &&
    (isDevMode || process.env["GOAT_FLOW_AUDIT_PROFILE"] === "1")
  );
}

/**
 * Create the profiler that times audit stages for an opted-in request.
 * A disabled profiler still runs every measured block, so enabling profiling changes what is recorded and never what the request computes.
 *
 * @param isEnabled - whether timings are collected; false makes `span` a transparent pass-through
 * @returns a profiler whose `spans` fill only while enabled
 */
export function createDashboardAuditProfiler(
  isEnabled: boolean,
): DashboardAuditProfiler {
  const spans: DashboardAuditProfileSpan[] = [];
  return {
    enabled: isEnabled,
    spans,
    /** Time one stage; the span is recorded even when the measured work throws. */
    span<T>(name: string, measuredStage: () => T): T {
      if (!isEnabled) return measuredStage();
      const start = performance.now();
      try {
        return measuredStage();
      } finally {
        spans.push({
          name,
          durationMs: Number((performance.now() - start).toFixed(3)),
        });
      }
    },
  };
}

/**
 * Attach collected span timings to a response body for an opted-in request.
 * Error behavior: throws nothing; a disabled profiler returns the body unchanged, so callers can append unconditionally without checking whether
 * profiling was requested.
 *
 * @param body - response body returned unchanged when profiling is disabled
 * @param profiler - profiler whose spans are summarised into `_profile`
 * @returns the body, with `_profile` present only when profiling was enabled
 */
export function appendAuditProfile<T extends object>(
  body: T,
  profiler: DashboardAuditProfiler,
): T & {
  _profile?: { summedSpanMs: number; spans: DashboardAuditProfileSpan[] };
} {
  if (!profiler.enabled) return body;
  const summedSpanMs = Number(
    profiler.spans
      .reduce((total, span) => total + span.durationMs, 0)
      .toFixed(3),
  );
  return {
    ...body,
    _profile: {
      summedSpanMs,
      spans: profiler.spans,
    },
  };
}

/**
 * Project one quality-history entry into the compact Home-card summary, deriving severity counts and
 * the distinct evidence methods from its findings so the dashboard never loads the full report.
 *
 * @param entry - the latest matching history entry, or null when no history matches the filter
 * @returns the display summary, or null when entry is null - null means "no quality run to show yet"
 *   (an expected empty state, not an error)
 */
export function buildLatestQualitySummary(
  entry: QualityHistoryEntry | null,
): LatestQualitySummary | null {
  if (!entry) return null;
  const findings = entry.report.findings;
  return {
    id: entry.id,
    date: entry.date,
    time: entry.time,
    agent: entry.agent,
    setupTotal: entry.report.scores.setup.total,
    systemTotal: entry.report.scores.system.total,
    blockerCount: findings.filter((f) => f.severity === "BLOCKER").length,
    majorCount: findings.filter((f) => f.severity === "MAJOR").length,
    minorCount: findings.filter((f) => f.severity === "MINOR").length,
    evidenceMethods: Array.from(
      new Set(findings.map((f) => f.evidence_method)),
    ),
    scope: entry.report.scope ?? null,
  };
}

/**
 * Count stats findings matching any of the named rules.
 *
 * Home groups several rules into one user-visible number, so this takes a rule list rather than one rule and keeps
 * the grouping visible at the call site.
 *
 * @param findings - stats findings for the selected project
 * @param rules - rule ids to count together; no rules yields zero
 * @returns how many findings matched; zero means that repair action is not due. The contract is that each finding
 *   counts at most once, so grouping rules never double-counts one that satisfies more than one of them.
 */
function countStatsFindings(
  findings: ReturnType<typeof checkStats>["findings"],
  ...rules: string[]
): number {
  return findings.filter((finding) => rules.includes(finding.rule)).length;
}

/**
 * Count generated indexes sitting in one freshness state.
 *
 * @param indexes - index freshness records for the selected project
 * @param state - state to count, such as `stale` or `missing`
 * @returns how many indexes are in that state; zero means none need that action
 */
function countIndexesInState(
  indexes: ReturnType<typeof collectIndexFreshness>,
  state: string,
): number {
  return indexes.filter((indexStatus) => indexStatus.state === state).length;
}

/**
 * Build the compact learning-loop health card shown on Dashboard Home.
 *
 * Use when a user opens a project and needs the next memory-maintenance action at a glance.
 * Each health count is derived separately because they drive different repair actions: stale review dates need a re-read, brittle line references
 * need semantic-anchor repair, and oversized buckets need splitting, so collapsing them into one number would hide which work is due.
 *
 * Error behavior: throws nothing; an unreadable project reports as a null card rather than failing the whole dashboard response.
 *
 * @param projectPath - selected project; empty or unreadable paths make the Home card unavailable.
 * @returns Home-card data, or null when the selected project cannot provide safe memory facts. It review dates are sorted so the oldest-review
 *   indicator is deterministic across runs.
 */
function buildDashboardLearningLoopSummary(
  projectPath: string,
): DashboardReport["learningLoop"] {
  // e.g. the user selected a project on Home and the dashboard now assembles its memory card.
  try {
    const fs = createFS(projectPath);
    const configState = loadConfig(projectPath, fs);
    const shared = extractSharedFacts(fs, configState);
    const indexes = collectIndexFreshness(
      fs,
      resolveIndexBucketPaths(configState.config),
    );
    const stats = buildStatsReport({
      footguns: shared.footguns,
      lessons: shared.lessons,
      // Home derives memory warnings from the same stable facts used by prompt retrieval.
      learningLoopEntries: shared.learningLoopEntries,
      indexes,
    });
    const check = checkStats(stats);
    // Users see one count for outdated review dates and broken semantic references.
    const staleCount = countStatsFindings(
      check.findings,
      "stale-last-reviewed",
      "stale-ref",
    );
    // Brittle line evidence gets a separate count because it needs semantic-anchor repair.
    const invalidLineRefCount = countStatsFindings(
      check.findings,
      "invalid-line-ref",
    );
    // Oversized buckets tell users where retrieval context needs splitting.
    const oversizedCount = countStatsFindings(check.findings, "bucket-size");
    // Stale generated indexes prevent users from trusting current retrieval results.
    const indexStaleCount = countIndexesInState(indexes, "stale");
    // Missing indexes remain a setup nudge rather than a false health claim.
    const indexMissingCount = countIndexesInState(indexes, "missing");
    const recordCount =
      stats.footguns.totalEntries + stats.lessons.totalEntries;

    const allBuckets = [...stats.footguns.buckets, ...stats.lessons.buckets];
    // Only real review dates participate in the oldest-review indicator shown to users.
    const reviewedDates = allBuckets
      .map((bucket) => bucket.lastReviewed)
      .filter((lastReviewed): lastReviewed is string => lastReviewed !== null)
      .sort();
    // No reviewed buckets leaves the card date empty instead of inventing recency.
    const oldestLastReviewed = reviewedDates[0] ?? null;

    // Only buckets with direct repair work appear in the Home action list.
    const topBucketsNeedingAction = allBuckets
      .filter(
        (bucket) =>
          bucket.staleRefs.length > 0 ||
          bucket.invalidLineRefs.length > 0 ||
          bucket.sizeBytes > 40_000,
      )
      // Buckets with more broken evidence rise above lower-impact maintenance work.
      .sort(
        (leftBucket, rightBucket) =>
          rightBucket.staleRefs.length +
          rightBucket.invalidLineRefs.length -
          (leftBucket.staleRefs.length + leftBucket.invalidLineRefs.length),
      )
      .slice(0, 3)
      // Each action row explains the visible reason the user should open that bucket.
      .map((bucket) => ({
        path: bucket.path,
        reason: [
          // No stale references means this reason stays out of the user's action label.
          bucket.staleRefs.length > 0
            ? `${bucket.staleRefs.length} stale refs`
            : "",
          // No invalid line references means this reason stays out of the action label.
          bucket.invalidLineRefs.length > 0
            ? `${bucket.invalidLineRefs.length} invalid line refs`
            : "",
          // Only oversized buckets show a size reason to the user.
          bucket.sizeBytes > 40_000
            ? `${Math.round(bucket.sizeBytes / 1024)}KB`
            : "",
        ]
          // Empty reasons are removed so the card shows plain, comma-separated repair guidance.
          .filter(Boolean)
          .join(", "),
      }));

    // Missing memory directories make the card unavailable; real defects escalate it for review.
    const status =
      !shared.footguns.exists && !shared.lessons.exists
        ? "unavailable"
        : staleCount > 2 ||
            invalidLineRefCount > 0 ||
            oversizedCount > 0 ||
            indexStaleCount > 0
          ? "needs-review"
          : "fresh";
    return {
      recordCount,
      footgunCount: stats.footguns.totalEntries, // total: includes resolved entries
      lessonCount: stats.lessons.totalEntries, // total; `entryCount` below is active-only
      staleCount,
      invalidLineRefCount,
      oversizedCount,
      // Each index row includes its live entry count for the user's Home summary.
      indexes: indexes.map((indexStatus) => ({
        ...indexStatus,
        entryCount: parseBucket(fs, indexStatus.dirPath, indexStatus.bucket)
          .length,
      })),
      indexStaleCount,
      indexMissingCount,
      oldestLastReviewed,
      topBucketsNeedingAction,
      status,
    };
  } catch {
    // For example, the user selected a deleted or unreadable project; Home shows no stale card.
    return null;
  }
}

/** List stable markdown lesson buckets; swallows absent lessons directories. */
function listLessonBuckets(lessonsDir: string): string[] {
  try {
    return readdirSync(lessonsDir)
      .filter(
        (filename) => filename.endsWith(".md") && filename !== "README.md",
      )
      .sort();
  } catch {
    return [];
  }
}

/** Return the created date inside one lesson section, if present. */
function parseLessonCreated(section: string): string | null {
  return section.match(/\*\*Created:\*\*\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
}

/**
 * Read lesson headings from one bucket file.
 * Error behavior: throws nothing; an unreadable bucket swallows the failure and reports no entries, so one missing file cannot blank the whole Home
 * panel.
 *
 * @param lessonsDir - absolute lessons directory for the selected project
 * @param filename - bucket file to read; a missing file yields an empty list
 * @param startOrder - running offset so entries keep their file order across buckets
 * @returns lesson summaries in file order; empty when the bucket is missing or has no headings
 */
function readLessonBucketEntries(
  lessonsDir: string,
  filename: string,
  startOrder: number,
): RecentLessonSummary[] {
  let content: string;
  try {
    content = readFileSync(join(lessonsDir, filename), "utf-8");
  } catch {
    return [];
  }

  return Array.from(content.matchAll(/^## Lesson:\s+(.+)$/gm)).flatMap(
    (heading, index, headings) => {
      const title = heading[1]?.trim();
      if (!title) return [];
      const start = heading.index;
      const nextHeading = headings[index + 1];
      const end =
        nextHeading === undefined ? content.length : nextHeading.index;
      const section = content.slice(start, end);
      return [
        {
          title,
          created: parseLessonCreated(section),
          path: `.goat-flow/learning-loop/lessons/${filename}`,
          order: startOrder + index,
        },
      ];
    },
  );
}

/**
 * Sort latest lessons first, with file order as the fallback.
 * Invariant: the ordering is total and deterministic.
 * Undated entries always sort after dated ones, and equal dates fall back to file order, so the Home panel cannot reshuffle between identical runs.
 *
 * @param lessons - entries to order; sorted in place and also returned
 * @returns the same array, newest first, with undated entries last
 */
function sortRecentLessons(
  lessons: RecentLessonSummary[],
): RecentLessonSummary[] {
  return lessons.sort((a, b) => {
    if (a.created !== b.created) {
      if (a.created === null) return 1;
      if (b.created === null) return -1;
      return b.created.localeCompare(a.created);
    }
    return b.order - a.order;
  });
}

/** Read recent lesson headings for the compact Home panel. */
function readRecentLessons(
  projectPath: string,
): DashboardReport["recentLessons"] {
  const lessonsDir = join(
    projectPath,
    ".goat-flow",
    "learning-loop",
    "lessons",
  );
  const filenames = listLessonBuckets(lessonsDir);

  const lessons: RecentLessonSummary[] = [];
  for (const filename of filenames) {
    lessons.push(
      ...readLessonBucketEntries(lessonsDir, filename, lessons.length),
    );
  }

  const total = lessons.length;
  return sortRecentLessons(lessons)
    .slice(0, 4)
    .map((lesson, index) => ({
      id: `L-${String(total - index).padStart(3, "0")}`,
      title: lesson.title,
      created: lesson.created,
      path: lesson.path,
    }));
}

const ENRICHMENT_TTL_MS = 60_000;
// Cap the signature walk at 500 entries because the signature only needs to detect learning-loop
// edits, not fingerprint the whole tree; an unbounded walk would let a large project stall every
// cache-miss audit on directory I/O. Past the limit the walk records a `:truncated` marker and stops.
const DIRECTORY_SIGNATURE_FILE_LIMIT = 500;
const DIRECTORY_SIGNATURE_IGNORES = new Set([".git", "node_modules", "dist"]);
const enrichmentCache = new Map<
  string,
  {
    learningLoop: DashboardReport["learningLoop"];
    recentLessons: DashboardReport["recentLessons"];
    signature: string;
    cachedAt: number;
  }
>();

/** Hash cache and identity inputs without storing raw remote URLs in keys. */
function hashString(inputText: string): string {
  return createHash("sha256").update(inputText).digest("hex");
}

/** Hash one cache input file; swallows disappearing files as a stable `missing` sentinel. */
function hashExistingFile(projectPath: string, relativePath: string): string {
  try {
    return hashString(readFileSync(join(projectPath, relativePath), "utf-8"));
  } catch {
    return "missing";
  }
}

/**
 * Stat one cache-signature input without letting a missing path abort the whole signature.
 * Error behavior: throws nothing; it swallows the stat failure so one vanished file cannot abort the signature for every other input.
 *
 * @param projectPath - selected project root
 * @param relativePath - repo-relative path to stat
 * @returns the stat result, or null when the path is missing or unreadable
 */
function readSignatureStat(
  projectPath: string,
  relativePath: string,
): ReturnType<typeof statSync> | null {
  try {
    return statSync(join(projectPath, relativePath));
  } catch {
    return null;
  }
}

/**
 * Add one directory entry to the cache signature, recursing into subdirectories.
 *
 * A missing path contributes an explicit `missing` marker rather than nothing, so a deletion still changes the signature and invalidates the cache.
 * Side effect: mutates the caller's `entries` array in place.
 *
 * @param projectPath - selected project root
 * @param relativeDir - repo-relative directory holding `name`
 * @param name - entry to record; ignored names are skipped entirely
 * @param entries - accumulator appended to in place
 * @returns nothing; the result is whatever was appended
 */
function appendDirectorySignatureEntry(
  projectPath: string,
  relativeDir: string,
  name: string,
  entries: string[],
): void {
  if (DIRECTORY_SIGNATURE_IGNORES.has(name)) return;

  const relativePath = join(relativeDir, name);
  const stat = readSignatureStat(projectPath, relativePath);
  if (!stat) {
    entries.push(`${relativePath}:missing`);
    return;
  }
  if (stat.isDirectory()) {
    readDirectorySignatureEntries(projectPath, relativePath, entries);
    return;
  }
  if (!stat.isFile()) return;
  entries.push(
    `${relativePath}:${stat.size}:${stat.mtimeMs}:${hashExistingFile(
      projectPath,
      relativePath,
    )}`,
  );
}

/**
 * Walk one directory into cache-signature entries, stopping at the file-count ceiling.
 *
 * Invariant: names are sorted before recording, so the same tree always produces the same signature regardless of the order the filesystem returns
 * entries.
 * Side effect: mutates the caller's `entries` array in place.
 *
 * Error behavior: throws nothing; an unreadable directory swallows the failure and records a
 * `missing` marker, which still changes the signature.
 *
 * @param projectPath - selected project root
 * @param relativeDir - repo-relative directory to walk
 * @param entries - accumulator appended to in place; the ceiling is checked against its length
 * @returns nothing; an unreadable directory records a `missing` marker and stops that branch
 */
function readDirectorySignatureEntries(
  projectPath: string,
  relativeDir: string,
  entries: string[],
): void {
  if (entries.length >= DIRECTORY_SIGNATURE_FILE_LIMIT) return;
  let names: string[];
  try {
    names = readdirSync(join(projectPath, relativeDir)).sort();
  } catch {
    entries.push(`${relativeDir}:missing`);
    return;
  }

  for (const name of names) {
    if (entries.length >= DIRECTORY_SIGNATURE_FILE_LIMIT) {
      entries.push(`${relativeDir}:truncated`);
      return;
    }
    appendDirectorySignatureEntry(projectPath, relativeDir, name, entries);
  }
}

/** Hash a bounded, deterministic directory snapshot for cache invalidation. */
function directorySignature(projectPath: string, relativeDir: string): string {
  const entries: string[] = [];
  readDirectorySignatureEntries(projectPath, relativeDir, entries);
  return hashString(entries.join("\n"));
}

/** Build the Home enrichment cache key from learning-loop content directories. */
function buildLearningLoopCacheSignature(projectPath: string): string {
  return hashString(
    [
      directorySignature(projectPath, ".goat-flow/learning-loop/footguns"),
      directorySignature(projectPath, ".goat-flow/learning-loop/lessons"),
      directorySignature(projectPath, ".goat-flow/learning-loop/patterns"),
      directorySignature(projectPath, ".goat-flow/learning-loop/decisions"),
    ].join("\n"),
  );
}

/**
 * Build the fingerprint that decides whether a persisted audit cache is still valid.
 * Invariant: every input that can change audit output contributes, so a stale cache can never be served as current.
 * Adding a new audit input without listing it here silently keeps stale results.
 *
 * @param projectPath - selected project root whose files are fingerprinted
 * @param packageVersion - running package version, so an upgrade invalidates every cache
 * @returns the signature string; never empty
 */
export function buildAuditCacheSignature(
  projectPath: string,
  packageVersion: string,
): string {
  const contentFiles = [
    ".goat-flow/config.yaml",
    ".goat-flow/architecture.md",
    ".goat-flow/code-map.md",
    ".goat-flow/glossary.md",
    "CLAUDE.md",
    "AGENTS.md",
    ".github/copilot-instructions.md",
    ".claude/settings.json",
    ".codex/config.toml",
    ".codex/hooks.json",
    ".agents/hooks.json",
    ".github/hooks/hooks.json",
    ".goat-flow/hooks/deny-dangerous.sh",
    ".goat-flow/hooks/gruff-code-quality.sh",
    ".goat-flow/hooks/post-turn-safety.sh",
    ".goat-flow/hooks/deny-dangerous/patterns-shell.sh",
    ".goat-flow/hooks/deny-dangerous/patterns-paths.sh",
    ".goat-flow/hooks/deny-dangerous/patterns-writes.sh",
    ".goat-flow/hooks/deny-dangerous/deny-dangerous-self-test.sh",
  ];
  const directoryInputs = [
    ".claude/skills",
    ".agents/skills",
    ".github/skills",
    ".goat-flow/learning-loop/decisions",
    ".goat-flow/learning-loop/footguns",
    ".goat-flow/learning-loop/lessons",
    ".goat-flow/learning-loop/patterns",
    ".goat-flow/skill-docs",
    ".goat-flow/hooks/deny-dangerous",
  ];
  return hashString(
    [
      `package:${packageVersion}`,
      ...contentFiles.map(
        (relativePath) =>
          `${relativePath}:${hashExistingFile(projectPath, relativePath)}`,
      ),
      ...directoryInputs.map(
        (relativeDir) =>
          `${relativeDir}:${directorySignature(projectPath, relativeDir)}`,
      ),
    ].join("\n"),
  );
}

/**
 * Attach cached learning-loop health and recent lessons to the Home report.
 * Use after audit so repeated Home loads avoid rescanning unchanged project memory.
 *
 * @param report - base report; empty enrichment fields are replaced when memory is readable
 * @param projectPath - selected project; empty or unreadable paths produce null loop health
 * @param shouldBypassCache - true skips the cache after a new audit; false may reuse current content
 * @returns copied report; learningLoop is null when project memory is unavailable
 */
export function enrichDashboardReport(
  report: DashboardReport,
  projectPath: string,
  shouldBypassCache = false,
): DashboardReport {
  const now = Date.now();
  const signature = buildLearningLoopCacheSignature(projectPath);
  const cached = enrichmentCache.get(projectPath);
  if (
    !shouldBypassCache &&
    cached &&
    cached.signature === signature &&
    now - cached.cachedAt < ENRICHMENT_TTL_MS
  ) {
    return {
      ...report,
      learningLoop: cached.learningLoop,
      recentLessons: cached.recentLessons,
    };
  }
  const learningLoop = buildDashboardLearningLoopSummary(projectPath);
  const recentLessons = readRecentLessons(projectPath);
  enrichmentCache.set(projectPath, {
    learningLoop,
    recentLessons,
    signature,
    cachedAt: now,
  });
  return { ...report, learningLoop, recentLessons };
}

/**
 * Assemble the audit response shown across dashboard cards and agent details.
 * Use after all selected agent audits complete so the UI receives one consistent snapshot.
 *
 * @param auditRpt - aggregate audit; never null after a completed dashboard audit
 * @param perAgentAudits - selected agent reports; empty means no agent cards are shown
 * @param projectPath - selected project; empty paths leave learning-loop enrichment unavailable
 * @param profiler - optional timings; null or absent omits profiling from the user response
 * @returns complete dashboard report; agentScores is empty when no agents were selected
 */
export function buildDashboardReport(
  auditRpt: AuditReport,
  perAgentAudits: { id: string; audit: AuditReport }[],
  projectPath: string,
  profiler?: DashboardAuditProfiler,
): DashboardReport {
  const report: DashboardReport = {
    agentScores: perAgentAudits.map((pa) => {
      const agentId = pa.id as AgentId;
      return {
        id: pa.id,
        name: AGENT_PROFILE_MAP[agentId].name,
        agent: pa.audit.scopes.agent,
        harness: pa.audit.scopes.harness,
        concerns: pa.audit.concerns,
        enforcement:
          pa.audit.enforcement.find((entry) => entry.agent === pa.id) ?? null,
      };
    }),
    status: auditRpt.status,
    scopes: {
      setup: auditRpt.scopes.setup,
      agent: auditRpt.scopes.agent,
      ...(auditRpt.scopes.harness ? { harness: auditRpt.scopes.harness } : {}),
    },
    overall: auditRpt.overall,
    hookCoverage: auditRpt.hookCoverage,
    learningLoop: null,
    recentLessons: [],
    target: auditRpt.target,
  };
  return profiler
    ? profiler.span("learning-loop enrichment", () =>
        enrichDashboardReport(report, projectPath, true),
      )
    : enrichDashboardReport(report, projectPath, true);
}

const AUDIT_CACHE_FILE = "audit-cache.json";

/** Persisted audit cache contract. Invariant: package, config, and content keys match its report. */
interface AuditCacheEnvelope {
  packageVersion: string;
  configVersion: string;
  cachedAt: string;
  signature: string;
  report: DashboardReport;
}

/** Read the local config version; swallows absent configs as cache-miss input. */
function readConfigVersion(projectPath: string): string | null {
  try {
    const raw = readFileSync(
      resolveLocalStatePath(projectPath, "config.yaml"),
      "utf-8",
    );
    const match = raw.match(/^version:\s*["']?([^\s"']+)["']?\s*$/m);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Recognize a non-null JSON object before the dashboard reads cache properties. */
function isCacheObject(
  candidate: unknown,
): candidate is Record<string, unknown> {
  // Null and primitive cache values cannot provide user-visible report fields.
  return typeof candidate === "object" && candidate !== null;
}

/** Validate persisted cache JSON before trusting it as a dashboard report. */
function isAuditCacheEnvelope(
  candidate: unknown,
): candidate is AuditCacheEnvelope {
  // Null or primitive cache data cannot carry a dashboard report.
  if (!isCacheObject(candidate)) return false;
  const envelope = candidate;
  const cachedReport = envelope.report;
  const hasCompleteCacheIdentity = [
    envelope.packageVersion,
    envelope.configVersion,
    envelope.cachedAt,
    envelope.signature,
  ].every((identityField) => typeof identityField === "string");
  return (
    hasCompleteCacheIdentity &&
    isCacheObject(cachedReport) &&
    "hookCoverage" in cachedReport &&
    isCacheObject(cachedReport.hookCoverage)
  );
}

/** Parse cached audit JSON; swallows malformed envelopes as a cache miss. */
function parseAuditCacheEnvelope(raw: string): AuditCacheEnvelope | null {
  try {
    const parsed = JSON.parse(raw);
    return isAuditCacheEnvelope(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Decide whether a persisted envelope still describes the current project and package.
 * An unreadable config version fails the match rather than being ignored, so a project whose config cannot be read never serves a cache entry that
 * config might have invalidated.
 *
 * @param envelope - parsed cache envelope under test
 * @param projectPath - selected project root, used to re-read the config version
 * @param packageVersion - running package version
 * @param signature - freshly computed input signature
 * @returns true only when package, signature, and config version all still agree
 */
function auditCacheMatches(
  envelope: AuditCacheEnvelope,
  projectPath: string,
  packageVersion: string,
  signature: string,
): boolean {
  const configVersion = readConfigVersion(projectPath);
  return (
    envelope.packageVersion === packageVersion &&
    envelope.signature === signature &&
    configVersion !== null &&
    envelope.configVersion === configVersion
  );
}

/**
 * Load a persisted audit report when it still matches the current inputs.
 * Error behavior: throws nothing; a missing, malformed, or stale cache all report as a plain miss, so the caller only has to distinguish "have a
 * report" from "run the audit".
 *
 * @param projectPath - selected project root
 * @param packageVersion - running package version, compared against the envelope
 * @param signature - freshly computed input signature, compared against the envelope
 * @returns the cached report and its timestamp, or null on any kind of miss
 */
export function readAuditCache(
  projectPath: string,
  packageVersion: string,
  signature: string,
): { report: DashboardReport; cachedAt: string } | null {
  try {
    const raw = readFileSync(
      resolveLocalStatePath(projectPath, AUDIT_CACHE_FILE),
      "utf-8",
    );
    const envelope = parseAuditCacheEnvelope(raw);
    if (!envelope) return null;
    if (!auditCacheMatches(envelope, projectPath, packageVersion, signature)) {
      return null;
    }
    return {
      report: envelope.report,
      cachedAt: envelope.cachedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Persist an audit report so the next matching request can skip the audit.
 *
 * A project with no readable config version is skipped, because the stored envelope could never be matched back and would only occupy local state.
 * Side effect: writes the audit cache file into the project's local-state directory.
 *
 * Error behavior: throws nothing; a failed write swallows the error, since losing a cache entry
 * only costs time on the next request.
 *
 * @param projectPath - selected project root
 * @param packageVersion - running package version recorded in the envelope
 * @param signature - input signature recorded in the envelope
 * @param report - report to persist verbatim
 * @returns nothing; success is the file left in local state
 */
export function writeAuditCache(
  projectPath: string,
  packageVersion: string,
  signature: string,
  report: DashboardReport,
): void {
  try {
    const configVersion = readConfigVersion(projectPath);
    if (!configVersion) return;
    const envelope = {
      packageVersion,
      configVersion,
      signature,
      cachedAt: new Date().toISOString(),
      report,
    };
    writeFileSync(
      resolveLocalStatePath(projectPath, AUDIT_CACHE_FILE),
      JSON.stringify(envelope),
    );
  } catch {
    // Cache write failure is non-fatal
  }
}

/**
 * Build the in-memory key that separates quality-audit results per project and agent.
 * Invariant: the newline separator keeps the two parts unambiguous, so no project path and agent pair can collide with a different pair.
 *
 * @param projectPath - selected project root
 * @param agent - selected agent, so two agents on one project never share an entry
 * @returns the composite cache key; never empty
 */
export function buildQualityAuditCacheKey(
  projectPath: string,
  agent: AgentId,
): string {
  return `${projectPath}\n${agent}`;
}
