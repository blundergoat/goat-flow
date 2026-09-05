/**
 * Builds dashboard audit responses and caches the project evidence used by Home.
 *
 * Combines agent scores, quality totals, memory health, and recent lessons for the selected project.
 * Optional profiling records audit stages without changing their work; cache misses let the route obtain a current audit.
 *
 * Content signatures cover the listed files and capped directory entries; package versions distinguish installed releases.
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

/**
 * Summarises the latest quality run for the totals displayed on Home.
 *
 * Counts and evidence methods come from that run's findings, keeping the summary consistent with its details.
 * A null scope means the stored run has no scope label to display.
 */
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

/**
 * Carries the lesson title and source path used by Home's recent-lessons panel.
 *
 * A null creation date keeps an undated lesson eligible while sorting it after dated entries.
 * Bucket order breaks date ties consistently, with later entries shown first.
 */
interface RecentLessonSummary {
  title: string;
  created: string | null;
  path: string;
  order: number;
}

/**
 * Enable audit timings only when the request opts in and the server configuration permits profiling.
 *
 * @param url - the request URL; profiling requires the `profile=true` query parameter
 * @param isDevMode - true permits profiling; otherwise the `GOAT_FLOW_AUDIT_PROFILE=1` environment flag must enable it
 * @returns true when the request opts in and dev mode or the environment flag enables timings
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
    // Run a synchronous audit stage and record its duration, even when it throws.
    span<T>(name: string, measuredStage: () => T): T {
      // Without profiling opt-in, run the same audit work without collecting timing data.
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
 * Attach recorded audit timings when profiling was enabled for this request.
 *
 * Disabled profiling returns the original body; enabled profiling reports the collected spans.
 * The sum can include overlapping nested stages, so it is not the request's wall-clock duration.
 *
 * @param body - response body returned unchanged when profiling is disabled
 * @param profiler - profiler whose spans are summarised into `_profile`; an empty list means no stages were recorded
 * @returns the body, with `_profile` present only when profiling was enabled
 */
export function appendAuditProfile<T extends object>(
  body: T,
  profiler: DashboardAuditProfiler,
): T & {
  _profile?: { summedSpanMs: number; spans: DashboardAuditProfileSpan[] };
} {
  // Requests that did not enable profiling keep the ordinary dashboard response shape.
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
 * Build Home's quality summary from one stored run; its counts and evidence methods must describe the same run as the displayed scores.
 *
 * @param entry - the latest matching history entry, or null when no history matches the filter
 * @returns the display summary, or null for the expected "no quality run to show yet" state
 */
export function buildLatestQualitySummary(
  entry: QualityHistoryEntry | null,
): LatestQualitySummary | null {
  // No matching saved run leaves Home's quality summary in its expected empty state.
  if (!entry) return null;
  // A run with no findings still supplies scores, with zero severity counts and no evidence methods.
  const findings = entry.report.findings;
  return {
    id: entry.id,
    date: entry.date,
    time: entry.time,
    agent: entry.agent,
    setupTotal: entry.report.scores.setup.total,
    systemTotal: entry.report.scores.system.total,
    blockerCount: findings.filter((finding) => finding.severity === "BLOCKER")
      .length,
    majorCount: findings.filter((finding) => finding.severity === "MAJOR")
      .length,
    minorCount: findings.filter((finding) => finding.severity === "MINOR")
      .length,
    evidenceMethods: Array.from(
      new Set(findings.map((finding) => finding.evidence_method)),
    ),
    // Older runs without a scope field leave the Home scope label absent.
    scope: entry.report.scope ?? null,
  };
}

/**
 * Count findings for one Home repair category, keeping its grouped rule names visible at the call site.
 *
 * @param findings - stats findings for the selected project; an empty list means none need repair
 * @param rules - rule ids to count together; no rules yields zero
 * @returns matching findings, each counted once by contract; zero means no supplied finding needs that repair
 */
function countStatsFindings(
  findings: ReturnType<typeof checkStats>["findings"],
  ...rules: string[]
): number {
  return findings.filter((finding) => rules.includes(finding.rule)).length;
}

/**
 * Count indexes in one freshness state for Home's memory-health summary.
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
 * Build Home's memory-health card with separate counts for review dates, broken references, oversized buckets, and stale indexes.
 *
 * These counts guide different repairs; stable date ordering keeps the oldest-review indicator deterministic.
 * If extraction fails, the null fallback omits this card while the dashboard audit remains available.
 *
 * @param projectPath - selected project root used to read its configured learning-loop directories
 * @returns health data; missing memory directories produce `unavailable` status, while extraction failure produces null
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
    return null;
  }
}

// List stable Markdown lesson buckets for Home; swallows unavailable directories as no recent lessons.
function listLessonBuckets(lessonsDir: string): string[] {
  try {
    return readdirSync(lessonsDir)
      .filter(
        (filename) => filename.endsWith(".md") && filename !== "README.md",
      )
      .sort();
  } catch {
    // The selected project may have no lessons directory yet; ignore this optional read failure and show no recent lessons.
    return [];
  }
}

// Read a lesson's creation date; null keeps an undated lesson eligible for Home, after dated entries.
function parseLessonCreated(section: string): string | null {
  return section.match(/\*\*Created:\*\*\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
}

/**
 * Read the lesson headings Home can link to in one bucket.
 * Swallows an unreadable bucket as no entries so a missing file does not erase lessons from other buckets.
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
    // A bucket may be removed after directory listing; skip that optional file while retaining other recent lessons.
    return [];
  }

  return Array.from(content.matchAll(/^## Lesson:\s+(.+)$/gm)).flatMap(
    (heading, index, headings) => {
      const title = heading[1]?.trim();
      // A blank heading cannot provide a useful lesson link for Home.
      if (!title) return [];
      const start = heading.index;
      const nextHeading = headings[index + 1];
      // The final lesson continues to the file's end; a following heading starts another lesson.
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
 * Sort Home's lessons by newest date, placing undated entries last.
 * Equal dates use later bucket entries first so unchanged input has deterministic ordering.
 *
 * @param lessons - entries to order; sorted in place and also returned; empty means there are no recent lessons
 * @returns the same array, newest first, with undated entries last
 */
function sortRecentLessons(
  lessons: RecentLessonSummary[],
): RecentLessonSummary[] {
  return lessons.sort((leftLesson, rightLesson) => {
    // Different creation dates decide recency before the stable bucket-order fallback.
    if (leftLesson.created !== rightLesson.created) {
      // An undated lesson follows a lesson with a known creation date.
      if (leftLesson.created === null) return 1;
      // A dated lesson stays ahead of an undated lesson in Home's recent list.
      if (rightLesson.created === null) return -1;
      return rightLesson.created.localeCompare(leftLesson.created);
    }
    return rightLesson.order - leftLesson.order;
  });
}

// Read up to four recent lesson headings for Home; an empty result leaves the panel without lesson links.
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
  // Collect readable headings across buckets before choosing Home's four most recent lessons.
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
// Limit recorded signature entries to reduce the file reads needed for a dashboard cache check.
// After the entry limit, a truncation marker records that the remaining tree was not fingerprinted.
const DIRECTORY_SIGNATURE_ENTRY_LIMIT = 500;
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

// Hash cache input text into a stable key used to decide whether Home can reuse saved evidence.
function hashString(inputText: string): string {
  return createHash("sha256").update(inputText).digest("hex");
}

// Hash one cache input file; swallows disappearing files as a stable `missing` sentinel.
function hashExistingFile(projectPath: string, relativePath: string): string {
  try {
    return hashString(readFileSync(join(projectPath, relativePath), "utf-8"));
  } catch {
    // A project file may disappear during the scan; the stable missing marker lets cache matching account for its absence.
    return "missing";
  }
}

/**
 * Read metadata for one cache input; swallows filesystem failures so a vanished file cannot abort the entire signature.
 *
 * @param projectPath - selected project root
 * @param relativePath - repo-relative path to inspect
 * @returns metadata, or null when the path is missing or unreadable and must contribute a missing-input marker
 */
function readSignatureStat(
  projectPath: string,
  relativePath: string,
): ReturnType<typeof statSync> | null {
  try {
    return statSync(join(projectPath, relativePath));
  } catch {
    // A listed file may have been removed or become unreadable; its caller records a missing marker instead of aborting the cache check.
    return null;
  }
}

/**
 * Add a file or nested directory to the dashboard cache fingerprint.
 * Mutates the entries array; missing paths leave an explicit marker so their removal changes the recorded input.
 *
 * @param projectPath - selected project root
 * @param relativeDir - repo-relative directory holding `name`
 * @param name - entry to record; ignored names are skipped entirely
 * @param entries - accumulator appended to in place; an empty array starts this signature collection
 * @returns nothing; the result is whatever was appended
 */
function appendDirectorySignatureEntry(
  projectPath: string,
  relativeDir: string,
  name: string,
  entries: string[],
): void {
  // Repository internals and generated dependency folders do not contribute to this bounded project-evidence signature.
  if (DIRECTORY_SIGNATURE_IGNORES.has(name)) return;

  const relativePath = join(relativeDir, name);
  const stat = readSignatureStat(projectPath, relativePath);
  // An unavailable entry contributes a missing marker so its previous cached evidence can be invalidated.
  if (!stat) {
    entries.push(`${relativePath}:missing`);
    return;
  }
  // Nested project evidence contributes through the same bounded signature walk.
  if (stat.isDirectory()) {
    readDirectorySignatureEntries(projectPath, relativePath, entries);
    return;
  }
  // Special filesystem entries supply no readable file content for this dashboard cache.
  if (!stat.isFile()) return;
  entries.push(
    `${relativePath}:${stat.size}:${stat.mtimeMs}:${hashExistingFile(
      projectPath,
      relativePath,
    )}`,
  );
}

/**
 * Read capped file and missing-path entries for the dashboard cache fingerprint.
 *
 * Mutates entries in deterministic name order; the ceiling leaves a truncation marker when more names remain.
 * Swallows unreadable directories as missing markers so an optional cache input does not block the report.
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
  // A filled signature collection stops further directory work so checking the cache remains bounded.
  if (entries.length >= DIRECTORY_SIGNATURE_ENTRY_LIMIT) return;
  let names: string[];
  try {
    names = readdirSync(join(projectPath, relativeDir)).sort();
  } catch {
    // An optional evidence directory may be missing or unreadable; its marker preserves that absence in the cache signature.
    entries.push(`${relativeDir}:missing`);
    return;
  }

  // Visit sorted entries so unchanged project evidence produces the same cache signature.
  for (const name of names) {
    // Further entries exceed this scan's budget; record truncation and stop before delaying the dashboard response.
    if (entries.length >= DIRECTORY_SIGNATURE_ENTRY_LIMIT) {
      entries.push(`${relativeDir}:truncated`);
      return;
    }
    appendDirectorySignatureEntry(projectPath, relativeDir, name, entries);
  }
}

// Hash a bounded, deterministic directory snapshot for cache invalidation.
function directorySignature(projectPath: string, relativeDir: string): string {
  const entries: string[] = [];
  readDirectorySignatureEntries(projectPath, relativeDir, entries);
  return hashString(entries.join("\n"));
}

// Build the Home enrichment cache key from learning-loop content directories.
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
 * Build the audit-cache fingerprint from the listed project inputs and running package version.
 *
 * The signature contract caps recorded directory entries and does not include compiled development code.
 * Keep declared inputs aligned with audit dependencies so recorded changes invalidate saved results.
 *
 * @param projectPath - selected project root whose listed files are fingerprinted
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
 * @param report - base report whose enrichment fields are replaced with current or cached memory summaries
 * @param projectPath - selected project root used to read memory and identify its cache entry
 * @param shouldBypassCache - true skips the cache after a new audit; false may reuse current content
 * @returns copied report; absent memory has unavailable health and no recent lessons, while extraction failure leaves learningLoop null
 */
export function enrichDashboardReport(
  report: DashboardReport,
  projectPath: string,
  shouldBypassCache = false,
): DashboardReport {
  const now = Date.now();
  const signature = buildLearningLoopCacheSignature(projectPath);
  const cached = enrichmentCache.get(projectPath);
  // Reuse Home's summary only when allowed, present, matched to this signature, and under a minute old.
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
 * @param projectPath - selected project root used to load learning-loop enrichment
 * @param profiler - optional stage timer; absent skips timing the enrichment work
 * @returns complete dashboard report; agentScores is empty when no agents were selected
 */
export function buildDashboardReport(
  auditRpt: AuditReport,
  perAgentAudits: { id: string; audit: AuditReport }[],
  projectPath: string,
  profiler?: DashboardAuditProfiler,
): DashboardReport {
  const report: DashboardReport = {
    agentScores: perAgentAudits.map((agentAudit) => {
      const agentId = agentAudit.id as AgentId;
      return {
        id: agentAudit.id,
        name: AGENT_PROFILE_MAP[agentId].name,
        agent: agentAudit.audit.scopes.agent,
        harness: agentAudit.audit.scopes.harness,
        concerns: agentAudit.audit.concerns,
        // An audit without this agent's enforcement row leaves that detail absent from its card.
        enforcement:
          agentAudit.audit.enforcement.find(
            (entry) => entry.agent === agentAudit.id,
          ) ?? null,
      };
    }),
    status: auditRpt.status,
    scopes: {
      setup: auditRpt.scopes.setup,
      agent: auditRpt.scopes.agent,
      // Audits that omit harness scope do not add that section to the dashboard response.
      ...(auditRpt.scopes.harness ? { harness: auditRpt.scopes.harness } : {}),
    },
    overall: auditRpt.overall,
    hookCoverage: auditRpt.hookCoverage,
    // Enrichment below fills these fields; unavailable facts can still leave no memory summary or lesson links.
    learningLoop: null,
    recentLessons: [],
    target: auditRpt.target,
  };
  // An optional profiler times enrichment; both paths build the same Home memory fields.
  return profiler
    ? profiler.span("learning-loop enrichment", () =>
        enrichDashboardReport(report, projectPath, true),
      )
    : enrichDashboardReport(report, projectPath, true);
}

const AUDIT_CACHE_FILE = "audit-cache.json";

/**
 * Stores a dashboard audit with the identity needed to judge later reuse.
 *
 * The package version, config version, and content signature must match the current request before its report is returned.
 * The saved timestamp lets the dashboard disclose when the reused audit was recorded.
 */
interface AuditCacheEnvelope {
  packageVersion: string;
  configVersion: string;
  cachedAt: string;
  signature: string;
  report: DashboardReport;
}

// Read the local config version; swallows absent configs as cache-miss input.
function readConfigVersion(projectPath: string): string | null {
  try {
    const raw = readFileSync(
      resolveLocalStatePath(projectPath, "config.yaml"),
      "utf-8",
    );
    const match = raw.match(/^version:\s*["']?([^\s"']+)["']?\s*$/m);
    // A config without a version cannot validate a saved audit, so reuse stays disabled.
    return match?.[1] ?? null;
  } catch {
    // The project may have no readable config file; ignore this optional cache lookup so the dashboard can run an audit.
    return null;
  }
}

// Recognize a non-null JSON object before the dashboard reads cache properties.
function isCacheObject(
  candidate: unknown,
): candidate is Record<string, unknown> {
  // Null and primitive cache values cannot provide user-visible report fields.
  return typeof candidate === "object" && candidate !== null;
}

// Check cache metadata and the hook-coverage object before matching a saved dashboard audit.
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
  // Missing cache identity or hook coverage prevents reuse of an older or incomplete saved audit.
  return (
    hasCompleteCacheIdentity &&
    isCacheObject(cachedReport) &&
    "hookCoverage" in cachedReport &&
    isCacheObject(cachedReport.hookCoverage)
  );
}

// Parse cached audit JSON; swallows malformed envelopes as a cache miss.
function parseAuditCacheEnvelope(raw: string): AuditCacheEnvelope | null {
  try {
    const parsed = JSON.parse(raw);
    // An incompatible envelope leaves the route without a reusable audit.
    return isAuditCacheEnvelope(parsed) ? parsed : null;
  } catch {
    // An interrupted cache write can leave malformed JSON; ignore the optional entry instead of failing the dashboard request.
    return null;
  }
}

/**
 * Match the stored audit to the current package, input signature, and config version.
 * An unreadable config version rejects reuse because the dashboard cannot verify which configuration the report describes.
 *
 * @param envelope - parsed cache envelope under test
 * @param projectPath - selected project root, used to re-read the config version
 * @param packageVersion - running package version
 * @param signature - freshly computed input signature
 * @returns true only when package, signature, and readable config version all agree
 */
function auditCacheMatches(
  envelope: AuditCacheEnvelope,
  projectPath: string,
  packageVersion: string,
  signature: string,
): boolean {
  const configVersion = readConfigVersion(projectPath);
  // An absent config version prevents the dashboard from treating a saved report as current.
  return (
    envelope.packageVersion === packageVersion &&
    envelope.signature === signature &&
    configVersion !== null &&
    envelope.configVersion === configVersion
  );
}

/**
 * Read a stored audit only when its cache identity matches the current inputs.
 * Swallows missing or unusable cache data as a miss so the route can obtain a current audit.
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
    // Unusable stored cache data cannot supply the dashboard's audit report.
    if (!envelope) return null;
    // Changed inputs or versions require a current audit instead of reusing this report.
    if (!auditCacheMatches(envelope, projectPath, packageVersion, signature)) {
      return null;
    }
    return {
      report: envelope.report,
      cachedAt: envelope.cachedAt,
    };
  } catch {
    // A cache file may be absent or removed between requests; ignore the optional read failure and report a cache miss.
    return null;
  }
}

/**
 * Writes the audit report to project-local state so a matching later request can reuse it.
 *
 * Skip unreadable config versions because the saved entry could not be matched; swallows write failures so the current report remains available.
 *
 * @param projectPath - selected project root
 * @param packageVersion - running package version recorded in the envelope
 * @param signature - input signature recorded in the envelope
 * @param report - report to persist verbatim
 * @returns nothing; success leaves a cache file, while failure only removes the opportunity for later reuse
 */
export function writeAuditCache(
  projectPath: string,
  packageVersion: string,
  signature: string,
  report: DashboardReport,
): void {
  try {
    const configVersion = readConfigVersion(projectPath);
    // Without a readable config version, a stored audit could never match a later request.
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
    // A read-only project can reject this optional cache write; the current audit still displays, and a later request can run again.
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
