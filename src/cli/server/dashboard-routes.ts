/**
 * Non-terminal dashboard route handlers and their shared response shapers.
 * The main dashboard server wires these into HTTP dispatch while keeping
 * lifecycle, live-reload, and terminal state management local.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { isPackagedInstall } from "../paths.js";
import { classifyProjectState } from "../classify-state.js";
import { loadConfig } from "../config/reader.js";
import { runAudit, runAuditBatch } from "../audit/audit.js";
import type { AuditReport } from "../audit/types.js";
import {
  getAgentProfileMap,
  getAgentProfiles,
  getKnownAgentIds,
} from "../agents/registry.js";
import { createFS } from "../facts/fs.js";
import { extractProjectFacts } from "../facts/orchestrator.js";
import { extractSharedFacts } from "../facts/shared/index.js";
import {
  findLatestQualityReport,
  type QualityHistoryEntry,
} from "../quality/history.js";
import { composeQuality } from "../prompt/compose-quality.js";
import type { AgentId } from "../types.js";
import { loadDashboardAssetCached } from "./dashboard-assets.js";
import { buildSetupDetectPayload, isProjectDirectory } from "./setup-detect.js";
import type { DashboardReport } from "./types.js";
import type { QualityMode } from "../quality/schema.js";
import { QUALITY_MODES } from "../quality/schema.js";
import {
  evaluateContent,
  evaluateUploadedBundle,
  discoverArtifacts,
  findArtifact,
  scoreArtifact,
} from "../quality/skill-quality.js";
import { MAX_EVALUATE_CONTENT_BYTES } from "./decoders.js";
import {
  loadQualityConfig,
  type ArtifactSource,
} from "../quality/quality-config.js";
import { composeArtifactQualityPrompt } from "../prompt/compose-quality.js";
import { buildStatsReport, checkStats } from "../stats/stats.js";
import {
  recordEvidenceEvent,
  type EvidenceEventKind,
  type EvidencePayload,
} from "../evidence/envelope.js";
import { redactEvidenceText } from "../evidence/redaction.js";
import {
  LocalPathValidationError,
  resolveLocalStatePath,
  validateLocalPath,
  type LocalPathPurpose,
} from "./local-paths.js";

const KNOWN_AGENT_IDS = getKnownAgentIds();
const KNOWN_AGENT_LIST = KNOWN_AGENT_IDS.join(", ");
const AGENT_PROFILE_MAP = getAgentProfileMap();
const AGENT_PROFILES = getAgentProfiles();
const SUPPORTED_AGENTS = AGENT_PROFILES.map(
  ({
    id,
    name,
    terminalBinary,
    setupSurfaces,
    promptInvocationStyle,
    skillSource,
    supportsPostTurnHook,
  }) => ({
    id,
    name,
    terminalBinary,
    setupSurfaces,
    promptInvocationStyle,
    skillSource,
    supportsPostTurnHook,
  }),
);
const VALID_AGENTS = new Set<string>(KNOWN_AGENT_IDS);
const VALID_QUALITY_MODES = new Set<string>(QUALITY_MODES);
const QUALITY_EVALUATE_MAX_BODY_BYTES = MAX_EVALUATE_CONTENT_BYTES + 64 * 1024;

type QualityAuditCacheStatus = "hit" | "miss" | "bypass";

interface DashboardPresetData {
  id: string;
  name: string;
  desc: string;
  prompt: string;
  cat: string;
}

type ProjectIdentitySource = "git-remote" | "goat-marker" | "path";

interface DashboardProjectIdentity {
  identity: string;
  identitySource: ProjectIdentitySource;
  currentPath: string;
  remoteUrlHash?: string;
  markerId?: string;
}

interface DashboardProjectRecord extends DashboardProjectIdentity {
  paths: string[];
  title?: string;
}

interface DashboardStateData {
  paths: string[];
  favorites: string[];
  projectTitles: Record<string, string>;
  projects: Record<string, DashboardProjectRecord>;
}

interface DashboardTaskMilestoneSummary {
  filename: string;
  path: string;
  title: string;
  status: string;
  objective: string;
  totalTasks: number;
  completedTasks: number;
  modifiedAt: string;
}

interface DashboardTaskPlanSummary {
  name: string;
  path: string;
  modifiedAt: string;
  milestoneCount: number;
  active: boolean;
}

interface DashboardTaskState {
  taskRoot: string;
  exists: boolean;
  active: string | null;
  activeExists: boolean;
  selectedPlan: string | null;
  plans: DashboardTaskPlanSummary[];
  milestones: DashboardTaskMilestoneSummary[];
}

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

interface QualityRequestParams {
  agent: AgentId;
  qualityMode: QualityMode;
  fresh: boolean;
  fast: boolean;
}

interface RecentLessonSummary {
  title: string;
  created: string | null;
  path: string;
  order: number;
}

type JsonResponder = (
  res: ServerResponse,
  status: number,
  body: unknown,
) => void;

interface BodyReadOptions {
  maxBytes?: number;
  tooLargeMessage?: string;
}

type BodyReader = (
  req: IncomingMessage,
  options?: BodyReadOptions,
) => Promise<string>;

interface DashboardAuditProfileSpan {
  name: string;
  durationMs: number;
}

interface DashboardAuditProfiler {
  enabled: boolean;
  spans: DashboardAuditProfileSpan[];
  span<T>(name: string, fn: () => T): T;
}

function shouldProfileAuditRequest(url: URL, devMode: boolean): boolean {
  return (
    url.searchParams.get("profile") === "true" &&
    (devMode || process.env["GOAT_FLOW_AUDIT_PROFILE"] === "1")
  );
}

function createDashboardAuditProfiler(
  enabled: boolean,
): DashboardAuditProfiler {
  const spans: DashboardAuditProfileSpan[] = [];
  return {
    enabled,
    spans,
    span<T>(name: string, fn: () => T): T {
      if (!enabled) return fn();
      const start = performance.now();
      try {
        return fn();
      } finally {
        spans.push({
          name,
          durationMs: Number((performance.now() - start).toFixed(3)),
        });
      }
    },
  };
}

function appendAuditProfile<T extends object>(
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

export function normalizeAgentVersionOutput(raw: string): string | null {
  const firstLine = raw.trim().split(/\r?\n/)[0]?.trim() ?? "";
  if (!firstLine) return null;
  return firstLine.replace(/(\d)[.,;:]+$/u, "$1");
}

interface DashboardRouteDependencies {
  absDefault: string;
  devMode: boolean;
  getTemplate: () => string;
  packageVersion: string;
  dashboardToken: string;
  dashboardPresets: ReadonlyArray<DashboardPresetData>;
  jsonResponse: JsonResponder;
  readBody: BodyReader;
}

/** Parse the quality history limit. Invalid input (non-numeric, zero, negative)
 *  falls back to the default so callers can't bypass the cap with ?limit=0. */
function parseQualityHistoryLimit(param: string | null): number {
  if (param === null) return 20;
  const parsed = Number.parseInt(param, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 20;
  return Math.min(parsed, 100);
}

/** Parse a dashboard quality-mode filter. */
function parseQualityModeParam(param: string | null): QualityMode | null {
  if (param === null) return null;
  return VALID_QUALITY_MODES.has(param) ? (param as QualityMode) : null;
}

function statOrNull(path: string) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function readOptionalTextFile(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function listTaskMilestoneFilenames(planPath: string): string[] {
  try {
    return readdirSync(planPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^M.*\.md$/iu.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } catch {
    return [];
  }
}

function readMarkdownField(
  content: string,
  pattern: RegExp,
  fallback: string,
): string {
  return content.match(pattern)?.[1]?.trim() || fallback;
}

function readTaskProgress(content: string): {
  totalTasks: number;
  completedTasks: number;
} {
  const taskMatches = Array.from(content.matchAll(/^\s*-\s+\[( |x|X)\]/gmu));
  return {
    totalTasks: taskMatches.length,
    completedTasks: taskMatches.filter(
      (match) => match[1]?.toLowerCase() === "x",
    ).length,
  };
}

function parseTaskMilestone(
  planPath: string,
  filename: string,
): DashboardTaskMilestoneSummary {
  const path = join(planPath, filename);
  const content = readOptionalTextFile(path) ?? "";
  const modifiedAt = statOrNull(path)?.mtime.toISOString() ?? "";
  const progress = readTaskProgress(content);
  return {
    filename,
    path,
    title: readMarkdownField(content, /^#\s+(.+)$/mu, filename),
    status: readMarkdownField(content, /^\*\*Status:\*\*\s*(.+)$/mu, "unknown"),
    objective: readMarkdownField(content, /^\*\*Objective:\*\*\s*(.+)$/mu, ""),
    totalTasks: progress.totalTasks,
    completedTasks: progress.completedTasks,
    modifiedAt,
  };
}

function buildTaskPlanSummary(
  taskRoot: string,
  name: string,
  active: string | null,
): DashboardTaskPlanSummary {
  const planPath = join(taskRoot, name);
  const milestoneFilenames = listTaskMilestoneFilenames(planPath);
  const newestMilestoneTime = milestoneFilenames.reduce<number | null>(
    (newest, filename) => {
      const mtime = statOrNull(join(planPath, filename))?.mtime.getTime();
      if (mtime === undefined) return newest;
      return newest === null ? mtime : Math.max(newest, mtime);
    },
    null,
  );
  const planMtime = statOrNull(planPath)?.mtime.getTime() ?? 0;
  const modifiedAt = new Date(newestMilestoneTime ?? planMtime).toISOString();
  return {
    name,
    path: planPath,
    modifiedAt,
    milestoneCount: milestoneFilenames.length,
    active: active === name,
  };
}

function listTaskPlanNames(taskRoot: string): string[] {
  return readdirSync(taskRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name);
}

function emptyDashboardTaskState(
  taskRoot: string,
  active: string | null,
): DashboardTaskState {
  return {
    taskRoot,
    exists: false,
    active,
    activeExists: false,
    selectedPlan: null,
    plans: [],
    milestones: [],
  };
}

function selectDashboardTaskPlan(
  requestedPlan: string | null,
  active: string | null,
  activeExists: boolean,
  plans: DashboardTaskPlanSummary[],
): string | null {
  const requestedExists = plans.some((plan) => plan.name === requestedPlan);
  if (requestedPlan && requestedExists) return requestedPlan;
  if (activeExists) return active;
  return plans[0]?.name ?? null;
}

function buildDashboardTaskState(
  projectPath: string,
  requestedPlan: string | null,
): DashboardTaskState {
  const taskRoot = resolveLocalStatePath(projectPath, "tasks");
  const taskRootStats = statOrNull(taskRoot);
  const active =
    readOptionalTextFile(join(taskRoot, ".active"))?.trim() || null;
  if (!taskRootStats?.isDirectory()) {
    return emptyDashboardTaskState(taskRoot, active);
  }

  const planNames = listTaskPlanNames(taskRoot);
  const plans = planNames
    .map((name) => buildTaskPlanSummary(taskRoot, name, active))
    .sort((a, b) => {
      const byMtime =
        new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
      return byMtime !== 0 ? byMtime : a.name.localeCompare(b.name);
    });
  const activeExists = Boolean(
    active && plans.some((plan) => plan.name === active),
  );
  const selectedPlan = selectDashboardTaskPlan(
    requestedPlan,
    active,
    activeExists,
    plans,
  );
  const selectedPlanPath = selectedPlan ? join(taskRoot, selectedPlan) : null;
  const milestones = selectedPlanPath
    ? listTaskMilestoneFilenames(selectedPlanPath).map((filename) =>
        parseTaskMilestone(selectedPlanPath, filename),
      )
    : [];

  return {
    taskRoot,
    exists: true,
    active,
    activeExists,
    selectedPlan,
    plans,
    milestones,
  };
}

function parseJsonObjectBody(body: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("Request body must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function assertTopLevelPlanName(planName: string): void {
  if (
    planName === "." ||
    planName === ".." ||
    planName.includes("/") ||
    planName.includes("\\") ||
    planName.startsWith(".")
  ) {
    throw new Error("body.plan must name a top-level task plan directory");
  }
}

function readActiveTaskPlanBody(body: string): string {
  const parsed = parseJsonObjectBody(body);
  const plan = parsed["plan"];
  if (typeof plan !== "string" || plan.trim().length === 0) {
    throw new Error("body.plan must be a non-empty string");
  }
  const normalized = plan.trim();
  assertTopLevelPlanName(normalized);
  return normalized;
}

function writeActiveTaskPlan(projectPath: string, planName: string): void {
  const taskRoot = resolveLocalStatePath(projectPath, "tasks");
  const taskRootStats = statOrNull(taskRoot);
  if (!taskRootStats?.isDirectory()) {
    throw new Error(".goat-flow/tasks does not exist for the selected project");
  }
  const planNames = listTaskPlanNames(taskRoot);
  if (!planNames.includes(planName)) {
    throw new Error(`task plan not found: ${planName}`);
  }
  writeFileSync(
    resolveLocalStatePath(projectPath, "tasks/.active"),
    `${planName}\n`,
  );
}

/** Resolve the managed agent list for dashboard aggregate audits. */
function resolveDashboardManagedAgentIds(
  agentFilter: AgentId | null,
): AgentId[] {
  return agentFilter === null ? [...KNOWN_AGENT_IDS] : [agentFilter];
}

/** Build the latest quality summary. */
function buildLatestQualitySummary(
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

/** Return true when a history entry belongs to the requested dashboard mode. */
function qualityEntryMatchesMode(
  entry: QualityHistoryEntry,
  mode: QualityMode | null,
): boolean {
  if (mode === null) return true;
  return (entry.report.quality_mode ?? "agent-setup") === mode;
}

/** Return latest quality history entry for the dashboard's selected filters. */
function getDashboardLatestQualityEntry(
  entries: QualityHistoryEntry[],
  agent: AgentId | null,
  mode: QualityMode | null,
): QualityHistoryEntry | null {
  return (
    entries.find((entry) => {
      if (agent !== null && entry.agent !== agent) return false;
      return qualityEntryMatchesMode(entry, mode);
    }) ?? null
  );
}

/** Return compact learning-loop health for Home without exposing the full stats report. */
function buildDashboardLearningLoopSummary(
  projectPath: string,
): DashboardReport["learningLoop"] {
  try {
    const fs = createFS(projectPath);
    const configState = loadConfig(projectPath, fs);
    const shared = extractSharedFacts(fs, configState);
    const stats = buildStatsReport({
      footguns: shared.footguns,
      lessons: shared.lessons,
    });
    const check = checkStats(stats);
    const staleCount = check.findings.filter(
      (finding) =>
        finding.rule === "stale-last-reviewed" || finding.rule === "stale-ref",
    ).length;
    const invalidLineRefCount = check.findings.filter(
      (finding) => finding.rule === "invalid-line-ref",
    ).length;
    const oversizedCount = check.findings.filter(
      (finding) => finding.rule === "bucket-size",
    ).length;
    const recordCount =
      stats.footguns.totalEntries + stats.lessons.totalEntries;

    const allBuckets = [...stats.footguns.buckets, ...stats.lessons.buckets];
    const reviewedDates = allBuckets
      .map((bucket) => bucket.lastReviewed)
      .filter((lastReviewed): lastReviewed is string => lastReviewed !== null)
      .sort();
    const oldestLastReviewed = reviewedDates[0] ?? null;

    const topBucketsNeedingAction = allBuckets
      .filter(
        (b) =>
          b.staleRefs.length > 0 ||
          b.invalidLineRefs.length > 0 ||
          b.sizeBytes > 40_000,
      )
      .sort(
        (a, b) =>
          b.staleRefs.length +
          b.invalidLineRefs.length -
          (a.staleRefs.length + a.invalidLineRefs.length),
      )
      .slice(0, 3)
      .map((b) => ({
        path: b.path,
        reason: [
          b.staleRefs.length > 0 ? `${b.staleRefs.length} stale refs` : "",
          b.invalidLineRefs.length > 0
            ? `${b.invalidLineRefs.length} invalid line refs`
            : "",
          b.sizeBytes > 40_000 ? `${Math.round(b.sizeBytes / 1024)}KB` : "",
        ]
          .filter(Boolean)
          .join(", "),
      }));

    const status =
      !shared.footguns.exists && !shared.lessons.exists
        ? "unavailable"
        : staleCount > 2 || invalidLineRefCount > 0 || oversizedCount > 0
          ? "needs-review"
          : "fresh";
    return {
      recordCount,
      footgunCount: stats.footguns.totalEntries,
      lessonCount: stats.lessons.totalEntries,
      staleCount,
      invalidLineRefCount,
      oversizedCount,
      oldestLastReviewed,
      topBucketsNeedingAction,
      status,
    };
  } catch {
    return null;
  }
}

/** List markdown lesson buckets that can contribute Home lesson rows. */
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

/** Read lesson headings from one bucket file. */
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
          path: `.goat-flow/lessons/${filename}`,
          order: startOrder + index,
        },
      ];
    },
  );
}

/** Sort latest lessons first, with file order as the fallback. */
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
  const lessonsDir = join(projectPath, ".goat-flow", "lessons");
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
const QUALITY_AUDIT_TTL_MS = 10_000;
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

function hashString(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const PROJECT_ID_COMMENT =
  "# Local goat-flow dashboard project identity. Gitignored by default.";

function identitySourceFrom(value: unknown): ProjectIdentitySource | null {
  return value === "git-remote" || value === "goat-marker" || value === "path"
    ? value
    : null;
}

function dedupeStrings(values: string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    if (value && !result.includes(value)) result.push(value);
  }
  return result;
}

function normalizeProjectPath(projectPath: string): string {
  const resolved = resolve(projectPath);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function directoryExists(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function cleanRemotePath(host: string | undefined, path: string | undefined) {
  const remotePath = path?.replace(/^\/+/u, "");
  if (!host || !remotePath) return null;
  return `${host.toLowerCase()}/${remotePath}`
    .replace(/\.git$/u, "")
    .replace(/\/+$/u, "");
}

function normalizeScpLikeRemote(trimmed: string): string | null {
  const scpLike = trimmed.match(/^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/u);
  if (!scpLike || trimmed.includes("://")) return null;
  return cleanRemotePath(scpLike[1], scpLike[2]);
}

function normalizeUrlRemote(trimmed: string): string | null {
  try {
    const parsed = new URL(trimmed);
    return cleanRemotePath(parsed.hostname, parsed.pathname);
  } catch {
    return null;
  }
}

function normalizeGitRemoteUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return (
    normalizeScpLikeRemote(trimmed) ??
    normalizeUrlRemote(trimmed) ??
    trimmed.replace(/\.git$/u, "").replace(/\/+$/u, "")
  );
}

function readGitRemote(projectPath: string): string | null {
  try {
    const output = execFileSync(
      "git",
      ["-C", projectPath, "config", "--get", "remote.origin.url"],
      {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1000,
      },
    );
    return typeof output === "string" ? output.trim() : String(output).trim();
  } catch {
    return null;
  }
}

function readProjectMarkerId(markerPath: string): string | null {
  try {
    const raw = readFileSync(markerPath, "utf-8");
    for (const line of raw.split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      return trimmed;
    }
  } catch {
    /* missing or unreadable marker */
  }
  return null;
}

function writeProjectMarkerId(markerPath: string): string | null {
  try {
    const markerId = `gf_${randomUUID()}`;
    writeFileSync(markerPath, `${PROJECT_ID_COMMENT}\n${markerId}\n`, {
      encoding: "utf-8",
    });
    return markerId;
  } catch {
    return null;
  }
}

function resolveGitRemoteIdentity(
  currentPath: string,
): DashboardProjectIdentity | null {
  const normalizedRemote = normalizeGitRemoteUrl(
    readGitRemote(currentPath) ?? "",
  );
  if (!normalizedRemote) return null;
  const remoteUrlHash = hashString(normalizedRemote);
  return {
    identity: `git-remote:${remoteUrlHash}`,
    identitySource: "git-remote",
    currentPath,
    remoteUrlHash,
  };
}

function resolveMarkerIdentity(
  currentPath: string,
  allowMarkerWrite: boolean,
): DashboardProjectIdentity | null {
  const goatFlowDir = join(currentPath, ".goat-flow");
  if (!directoryExists(goatFlowDir)) return null;
  let markerPath: string | null = null;
  try {
    markerPath = resolveLocalStatePath(currentPath, "project-id");
  } catch (err) {
    if (allowMarkerWrite) throw err;
  }
  const markerId =
    markerPath === null
      ? null
      : (readProjectMarkerId(markerPath) ??
        (allowMarkerWrite ? writeProjectMarkerId(markerPath) : null));
  if (!markerId) return null;
  return {
    identity: `goat-marker:${markerId}`,
    identitySource: "goat-marker",
    currentPath,
    markerId,
  };
}

function resolveProjectIdentity(
  projectPath: string,
  options: { allowMarkerWrite?: boolean } = {},
): DashboardProjectIdentity {
  const currentPath = normalizeProjectPath(projectPath);
  return (
    resolveGitRemoteIdentity(currentPath) ??
    resolveMarkerIdentity(currentPath, options.allowMarkerWrite === true) ?? {
      identity: `path:${currentPath}`,
      identitySource: "path",
      currentPath,
    }
  );
}

function hashExistingFile(projectPath: string, relativePath: string): string {
  try {
    return hashString(readFileSync(join(projectPath, relativePath), "utf-8"));
  } catch {
    return "missing";
  }
}

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

function directorySignature(projectPath: string, relativeDir: string): string {
  const entries: string[] = [];
  readDirectorySignatureEntries(projectPath, relativeDir, entries);
  return hashString(entries.join("\n"));
}

function buildLearningLoopCacheSignature(projectPath: string): string {
  return hashString(
    [
      directorySignature(projectPath, ".goat-flow/footguns"),
      directorySignature(projectPath, ".goat-flow/lessons"),
    ].join("\n"),
  );
}

function buildAuditCacheSignature(
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
    "GEMINI.md",
    ".github/copilot-instructions.md",
    ".claude/settings.json",
    ".codex/config.toml",
    ".codex/hooks.json",
    ".gemini/settings.json",
    ".github/hooks/hooks.json",
    ".claude/hooks/deny-dangerous.sh",
    ".codex/hooks/deny-dangerous.sh",
    ".gemini/hooks/deny-dangerous.sh",
    ".github/hooks/deny-dangerous.sh",
  ];
  const directoryInputs = [
    ".claude/skills",
    ".agents/skills",
    ".gemini/skills",
    ".github/skills",
    ".goat-flow/decisions",
    ".goat-flow/footguns",
    ".goat-flow/lessons",
    ".goat-flow/patterns",
    ".goat-flow/skill-reference",
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

/** Enrich a dashboard report with compact Home-only learning-loop context. */
function enrichDashboardReport(
  report: DashboardReport,
  projectPath: string,
  fresh = false,
): DashboardReport {
  const now = Date.now();
  const signature = buildLearningLoopCacheSignature(projectPath);
  const cached = enrichmentCache.get(projectPath);
  if (
    !fresh &&
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

/** Build the dashboard API payload from aggregate and per-agent audit results. */
function buildDashboardReport(
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

interface AuditCacheEnvelope {
  packageVersion: string;
  configVersion: string;
  cachedAt: string;
  signature: string;
  report: DashboardReport;
}

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

function isAuditCacheEnvelope(value: unknown): value is AuditCacheEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const envelope = value as Record<string, unknown>;
  return (
    typeof envelope.packageVersion === "string" &&
    typeof envelope.configVersion === "string" &&
    typeof envelope.cachedAt === "string" &&
    typeof envelope.signature === "string" &&
    typeof envelope.report === "object" &&
    envelope.report !== null
  );
}

function parseAuditCacheEnvelope(raw: string): AuditCacheEnvelope | null {
  try {
    const parsed = JSON.parse(raw);
    return isAuditCacheEnvelope(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

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

function readAuditCache(
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

function writeAuditCache(
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

function buildQualityAuditCacheKey(
  projectPath: string,
  agent: AgentId,
): string {
  return `${projectPath}\n${agent}`;
}

/** Build the non-terminal dashboard route handlers for one server instance. */
export function createDashboardRouteHandlers(
  deps: DashboardRouteDependencies,
): {
  handleHtmlRequest: (url: URL, res: ServerResponse) => boolean;
  handleAssetRequest: (
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ) => boolean;
  handleAuditRequest: (url: URL, res: ServerResponse) => boolean;
  handleSetupDetectRequest: (url: URL, res: ServerResponse) => boolean;
  handleSetupRequest: (url: URL, res: ServerResponse) => Promise<boolean>;
  handleQualityRequest: (url: URL, res: ServerResponse) => boolean;
  handleQualityHistoryRequest: (
    url: URL,
    res: ServerResponse,
  ) => Promise<boolean>;
  handleSkillQualityRequest: (url: URL, res: ServerResponse) => boolean;
  handleSkillQualityInventoryRequest: (
    url: URL,
    res: ServerResponse,
  ) => boolean;
  handleQualityEvaluateRequest: (
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ) => Promise<boolean>;
  handleBrowseRequest: (url: URL, res: ServerResponse) => boolean;
  handleTasksRequest: (
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ) => Promise<boolean>;
  handleAgentDetectRequest: (url: URL, res: ServerResponse) => boolean;
  handleProjectsListRequest: (
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ) => Promise<boolean>;
  handleProjectsStatusRequest: (url: URL, res: ServerResponse) => boolean;
} {
  const {
    absDefault,
    devMode,
    getTemplate,
    packageVersion,
    dashboardToken,
    dashboardPresets,
    jsonResponse,
    readBody,
  } = deps;
  const dashboardStateFile = resolveLocalStatePath(
    absDefault,
    "dashboard-state.json",
  );
  const legacyProjectsListFile = resolveLocalStatePath(
    absDefault,
    "dashboard-projects.json",
  );
  const qualityAuditCache = new Map<
    string,
    {
      report: AuditReport;
      cachedAt: number;
    }
  >();

  function recordDashboardEvent(
    projectPath: string,
    eventKind: EvidenceEventKind,
    payload?: EvidencePayload,
  ): void {
    recordEvidenceEvent({
      producer: "dashboard-session-trace",
      actor: "server",
      eventKind,
      projectPath,
      payload,
    });
  }

  function readQualityAuditCache(
    projectPath: string,
    agent: AgentId,
    fresh: boolean,
  ): AuditReport | null {
    if (fresh) return null;
    const cached = qualityAuditCache.get(
      buildQualityAuditCacheKey(projectPath, agent),
    );
    if (!cached) return null;
    if (Date.now() - cached.cachedAt >= QUALITY_AUDIT_TTL_MS) {
      qualityAuditCache.delete(buildQualityAuditCacheKey(projectPath, agent));
      return null;
    }
    return cached.report;
  }

  function writeQualityAuditCache(
    projectPath: string,
    agent: AgentId,
    report: AuditReport,
  ): void {
    qualityAuditCache.set(buildQualityAuditCacheKey(projectPath, agent), {
      report,
      cachedAt: Date.now(),
    });
  }

  /** Validate a user-supplied local directory path for the requested operation. */
  function validatedPath(
    raw: string | null,
    purpose: LocalPathPurpose,
  ): string {
    return validateLocalPath(raw || absDefault, purpose).path;
  }

  /** Read one optional string array property from a parsed dashboard state file. */
  function readOptionalStringArrayProperty(
    value: Record<string, unknown>,
    key: string,
  ): string[] | null {
    const raw = value[key];
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) return null;
    const items: string[] = [];
    for (const item of raw) {
      if (typeof item !== "string") return null;
      items.push(item);
    }
    return items;
  }

  /** Read an optional `{ [path]: title }` map from parsed dashboard state.
   *  Invalid entries are dropped rather than failing the whole load so one bad
   *  title can't wipe the user's `paths` / `favorites`. */
  function readOptionalStringMapProperty(
    value: Record<string, unknown>,
    key: string,
  ): Record<string, string> {
    const raw = value[key];
    if (raw === undefined) return {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "string" && v.length > 0) result[k] = v;
    }
    return result;
  }

  function normalizeProjectRecordPaths(record: Record<string, unknown>) {
    const paths = Array.isArray(record.paths)
      ? record.paths
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => normalizeProjectPath(entry))
      : [];
    return paths;
  }

  function readRecordString(
    record: Record<string, unknown>,
    key: string,
  ): string | null {
    const value = record[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  function applyOptionalProjectRecordFields(
    normalized: DashboardProjectRecord,
    record: Record<string, unknown>,
  ): void {
    const remoteUrlHash = readRecordString(record, "remoteUrlHash");
    const markerId = readRecordString(record, "markerId");
    const title = readRecordString(record, "title")?.trim();
    if (remoteUrlHash) normalized.remoteUrlHash = remoteUrlHash;
    if (markerId) normalized.markerId = markerId;
    if (title) normalized.title = title.slice(0, 120);
  }

  function normalizeDashboardProjectRecord(
    identity: string,
    value: unknown,
  ): DashboardProjectRecord | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    const identityValue = readRecordString(record, "identity") ?? identity;
    const identitySource = identitySourceFrom(record.identitySource);
    const currentPath = readRecordString(record, "currentPath");
    if (!identityValue || !identitySource || !currentPath) return null;

    const normalized: DashboardProjectRecord = {
      identity: identityValue,
      identitySource,
      currentPath: normalizeProjectPath(currentPath),
      paths: dedupeStrings([
        normalizeProjectPath(currentPath),
        ...normalizeProjectRecordPaths(record),
      ]),
    };
    applyOptionalProjectRecordFields(normalized, record);
    return normalized;
  }

  function readOptionalProjectRecordsProperty(
    value: Record<string, unknown>,
  ): Record<string, DashboardProjectRecord> {
    const raw = value.projects;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const records: Record<string, DashboardProjectRecord> = {};
    for (const [identity, record] of Object.entries(raw)) {
      const normalized = normalizeDashboardProjectRecord(identity, record);
      if (normalized) records[normalized.identity] = normalized;
    }
    return records;
  }

  function addProjectRecord(
    records: Map<string, DashboardProjectRecord>,
    next: DashboardProjectRecord,
  ): void {
    const existing = records.get(next.identity);
    if (!existing) {
      records.set(next.identity, {
        ...next,
        paths: dedupeStrings(next.paths),
      });
      return;
    }
    records.set(next.identity, {
      ...existing,
      currentPath: next.currentPath,
      paths: dedupeStrings([...existing.paths, ...next.paths]),
      title: next.title ?? existing.title,
      remoteUrlHash: next.remoteUrlHash ?? existing.remoteUrlHash,
      markerId: next.markerId ?? existing.markerId,
    });
  }

  function hydrateDashboardState(
    state: DashboardStateData,
    options: { allowMarkerWrite: boolean },
  ): DashboardStateData {
    const records = new Map<string, DashboardProjectRecord>();
    for (const record of Object.values(state.projects)) {
      addProjectRecord(records, record);
    }

    for (const path of state.paths) {
      const identity = resolveProjectIdentity(path, {
        allowMarkerWrite: options.allowMarkerWrite,
      });
      const title =
        state.projectTitles[identity.identity] ?? state.projectTitles[path];
      addProjectRecord(records, {
        ...identity,
        paths: [identity.currentPath],
        ...(title ? { title } : {}),
      });
    }

    const projectTitles: Record<string, string> = {};
    for (const record of records.values()) {
      const title =
        record.title ??
        state.projectTitles[record.identity] ??
        state.projectTitles[record.currentPath];
      if (title) {
        record.title = title;
        projectTitles[record.identity] = title;
      }
    }

    const projects = Object.fromEntries(
      [...records.entries()].sort(([a], [b]) => a.localeCompare(b)),
    );
    const paths = dedupeStrings(
      Object.values(projects).flatMap((record) => record.paths),
    );
    return {
      paths,
      favorites: dedupeStrings(state.favorites),
      projectTitles,
      projects,
    };
  }

  /** Normalize parsed dashboard state JSON into the server's expected shape. */
  function normalizeDashboardState(value: unknown): DashboardStateData | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    const paths = readOptionalStringArrayProperty(record, "paths");
    if (paths === null) return null;
    const favorites = readOptionalStringArrayProperty(record, "favorites");
    if (favorites === null) return null;
    const projectTitles = readOptionalStringMapProperty(
      record,
      "projectTitles",
    );
    return hydrateDashboardState(
      {
        paths,
        favorites,
        projectTitles,
        projects: readOptionalProjectRecordsProperty(record),
      },
      { allowMarkerWrite: false },
    );
  }

  /** Read dashboard state from the new file first, then the legacy projects-only file. */
  async function loadDashboardState(): Promise<DashboardStateData> {
    const { readFile } = await import("node:fs/promises");
    for (const filePath of [dashboardStateFile, legacyProjectsListFile]) {
      try {
        const parsed = normalizeDashboardState(
          JSON.parse(await readFile(filePath, "utf-8")),
        );
        if (parsed) return parsed;
      } catch {
        /* try next location */
      }
    }
    return { paths: [], favorites: [], projectTitles: {}, projects: {} };
  }

  function responseStatusForError(err: unknown, fallback: number): number {
    return err instanceof LocalPathValidationError ? 400 : fallback;
  }

  /** Serve the dashboard shell and inject the default workspace path. */
  function handleHtmlRequest(url: URL, res: ServerResponse): boolean {
    if (url.pathname !== "/") return false;

    const injection = `<script>window.__GOAT_FLOW_DEFAULT_PATH__ = ${JSON.stringify(absDefault)}; window.__GOAT_FLOW_VERSION__ = ${JSON.stringify(packageVersion)}; window.__GOAT_FLOW_DASHBOARD_TOKEN__ = ${JSON.stringify(dashboardToken)}; window.__GOAT_FLOW_AGENTS__ = ${JSON.stringify(SUPPORTED_AGENTS)}; window.__GOAT_FLOW_RUNNER_IDS__ = ${JSON.stringify(KNOWN_AGENT_IDS)}; window.__GOAT_FLOW_PRESETS__ = ${JSON.stringify(dashboardPresets)};</script>`;
    const liveReloadScript = devMode
      ? `<script>(function(){var ws=new WebSocket('ws://'+location.host+'/ws/livereload');ws.onmessage=function(){location.reload()};ws.onclose=function(){setTimeout(function(){location.reload()},1000)}})()</script>`
      : "";
    const html = getTemplate().replace(
      "</body>",
      `${injection}\n${liveReloadScript}\n</body>`,
    );
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return true;
  }

  /** Serve bundled dashboard assets from the compiled `dist/dashboard/` output. */
  function handleAssetRequest(
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ): boolean {
    if (!url.pathname.startsWith("/assets/")) return false;

    const filename = url.pathname.slice("/assets/".length);
    if (!/^[a-z0-9_-]+\.(js|css|json)$/i.test(filename)) return false;

    const contentType = filename.endsWith(".css")
      ? "text/css; charset=utf-8"
      : filename.endsWith(".json")
        ? "application/json; charset=utf-8"
        : "application/javascript; charset=utf-8";
    try {
      const asset = loadDashboardAssetCached(filename);
      const headers = {
        "Cache-Control": "no-cache",
        "Content-Type": contentType,
        ETag: asset.etag,
      };
      if (req.headers["if-none-match"] === asset.etag) {
        res.writeHead(304, headers);
        res.end();
        return true;
      }
      res.writeHead(200, headers);
      res.end(asset.content);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
    return true;
  }

  function isCacheEligible(
    agentFilter: AgentId | null,
    harness: boolean,
  ): boolean {
    return !agentFilter && harness && isPackagedInstall();
  }

  function buildDashboardAuditReport(
    projectPath: string,
    agentFilter: AgentId | null,
    harness: boolean,
    profiler: DashboardAuditProfiler,
  ): DashboardReport {
    const fs = createFS(projectPath);
    const configAgents = profiler.span("managed-agent resolution", () =>
      resolveDashboardManagedAgentIds(agentFilter),
    );
    const auditFactProfile =
      agentFilter === null ? "dashboard-summary" : "full";
    const batch = profiler.span("runAuditBatch", () =>
      runAuditBatch(
        fs,
        projectPath,
        {
          agentFilter,
          harness,
          // Summary cards only need to know whether the deny mechanism is
          // installed. Explicit per-agent audits and quality flows still run the
          // slower runtime self-test.
          denyMechanismEvidenceLevel:
            agentFilter === null ? "present-only" : "full",
          factProfile: auditFactProfile,
          profile: profiler,
        },
        configAgents,
      ),
    );
    return profiler.span("dashboard report build", () =>
      buildDashboardReport(
        batch.aggregate,
        batch.perAgent,
        projectPath,
        profiler,
      ),
    );
  }

  function readCachedDashboardAudit(
    projectPath: string,
    fresh: boolean,
    signature: string | null,
    profiler: DashboardAuditProfiler,
  ) {
    if (fresh || signature === null) return null;
    return profiler.span("cache read", () =>
      readAuditCache(projectPath, packageVersion, signature),
    );
  }

  function parseAgentFilter(param: string | null): AgentId | null {
    return param && VALID_AGENTS.has(param) ? (param as AgentId) : null;
  }

  function parseQualityRequestParams(
    url: URL,
    res: ServerResponse,
  ): QualityRequestParams | null {
    const agentParam = url.searchParams.get("agent");
    if (!agentParam || !VALID_AGENTS.has(agentParam)) {
      jsonResponse(res, 400, {
        error: `quality requires --agent. Valid: ${KNOWN_AGENT_LIST}`,
      });
      return null;
    }

    const modeParam = url.searchParams.get("mode");
    if (modeParam && !VALID_QUALITY_MODES.has(modeParam)) {
      jsonResponse(res, 400, {
        error: `quality mode must be one of: ${QUALITY_MODES.join(", ")}`,
      });
      return null;
    }

    return {
      agent: agentParam as AgentId,
      qualityMode: parseQualityModeParam(modeParam) ?? "agent-setup",
      fresh: url.searchParams.get("fresh") === "true",
      fast: url.searchParams.get("fast") === "true",
    };
  }

  function parseRequiredAgentParam(
    param: string | null,
    routeName: string,
    res: ServerResponse,
  ): AgentId | null {
    if (!param || !VALID_AGENTS.has(param)) {
      jsonResponse(res, 400, {
        error: `${routeName} requires agent. Valid: ${KNOWN_AGENT_LIST}`,
      });
      return null;
    }
    return param as AgentId;
  }

  function skillSourceForDir(dir: string): ArtifactSource {
    if (dir === ".agents/skills") return "agent-mirror";
    if (dir === ".github/skills") return "github-mirror";
    return "installed";
  }

  function runnerSkillQualityConfig(projectPath: string, agent: AgentId) {
    const base = loadQualityConfig(projectPath);
    const skillsDir = AGENT_PROFILE_MAP[agent].skillsDir;
    return {
      ...base,
      walkRoots: {
        skills: [{ dir: skillsDir, source: skillSourceForDir(skillsDir) }],
        references: base.walkRoots.references,
      },
    };
  }

  /**
   * Run both evaluation systems and return the shared DashboardReport consumed
   * by Home, Setup, and Quality. Aggregate dashboard requests intentionally use
   * dashboard-summary facts: stack-derived setup details come from
   * `/api/setup/detect`, while this route must preserve report/scopes/agentScores
   * without paying setup-time stack detection on every fresh Home load.
   */
  function handleAuditRequest(url: URL, res: ServerResponse): boolean {
    if (url.pathname !== "/api/audit") return false;

    const harness = url.searchParams.get("quality") === "true";
    const agentFilter = parseAgentFilter(url.searchParams.get("agent"));
    const fresh = url.searchParams.get("fresh") === "true";
    const profiler = createDashboardAuditProfiler(
      shouldProfileAuditRequest(url, devMode),
    );

    try {
      const projectPath = validatedPath(
        url.searchParams.get("path"),
        "project-read",
      );
      const auditCacheSignature = isCacheEligible(agentFilter, harness)
        ? profiler.span("cache signature", () =>
            buildAuditCacheSignature(projectPath, packageVersion),
          )
        : null;

      const cached = readCachedDashboardAudit(
        projectPath,
        fresh,
        auditCacheSignature,
        profiler,
      );
      if (cached) {
        const report = profiler.span("learning-loop enrichment", () =>
          enrichDashboardReport(cached.report, projectPath),
        );
        recordDashboardEvent(projectPath, "audit.run", {
          cached: true,
          harness,
          agent: agentFilter ?? "all",
          status: report.status,
        });
        jsonResponse(
          res,
          200,
          appendAuditProfile(
            {
              ...report,
              cached: true,
              cachedAt: cached.cachedAt,
            },
            profiler,
          ),
        );
        return true;
      }

      const report = buildDashboardAuditReport(
        projectPath,
        agentFilter,
        harness,
        profiler,
      );

      if (auditCacheSignature !== null) {
        profiler.span("cache write", () => {
          writeAuditCache(
            projectPath,
            packageVersion,
            auditCacheSignature,
            report,
          );
        });
      }

      recordDashboardEvent(projectPath, "audit.run", {
        cached: false,
        harness,
        agent: agentFilter ?? "all",
        status: report.status,
      });
      jsonResponse(
        res,
        200,
        appendAuditProfile(
          { ...report, cached: false, cachedAt: null },
          profiler,
        ),
      );
    } catch (err) {
      jsonResponse(
        res,
        responseStatusForError(err, 500),
        appendAuditProfile(
          {
            error: err instanceof Error ? err.message : String(err),
          },
          profiler,
        ),
      );
    }
    return true;
  }

  /** Detect project stack, commands, agents, and existing config for the setup view. */
  function handleSetupDetectRequest(url: URL, res: ServerResponse): boolean {
    if (url.pathname !== "/api/setup/detect") return false;

    try {
      const projectPath = validatedPath(
        url.searchParams.get("path"),
        "project-read",
      );
      jsonResponse(res, 200, buildSetupDetectPayload(projectPath));
    } catch (err) {
      jsonResponse(res, responseStatusForError(err, 500), {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  /** Compose setup output for one agent and return it to the dashboard. */
  async function handleSetupRequest(
    url: URL,
    res: ServerResponse,
  ): Promise<boolean> {
    if (url.pathname !== "/api/setup") return false;

    const agentParam = url.searchParams.get("agent");
    if (!agentParam) {
      jsonResponse(res, 400, {
        error: `Missing required parameter: agent. Valid: ${KNOWN_AGENT_LIST}`,
      });
      return true;
    }
    if (!VALID_AGENTS.has(agentParam)) {
      jsonResponse(res, 400, {
        error: `Invalid agent: ${agentParam}. Valid: ${KNOWN_AGENT_LIST}`,
      });
      return true;
    }

    const agent = agentParam as AgentId;
    try {
      const projectPath = validatedPath(
        url.searchParams.get("path"),
        "project-read",
      );
      const fs = createFS(projectPath);
      const configState = loadConfig(projectPath, fs);
      const facts = extractProjectFacts(fs, {
        agentFilter: agent,
        projectPath,
        configState,
        includeStack: false,
      });
      const auditReport = runAudit(fs, projectPath, {
        agentFilter: agent,
        harness: true,
        factProfile: "dashboard-summary",
        denyMechanismEvidenceLevel: "static",
      });
      const { composeSetup } = await import("../prompt/compose-setup.js");
      const output = composeSetup(auditReport, facts, agent, {
        denyMechanismEvidenceLevel: "static",
      });
      const renderedOutput = output ?? "No setup output generated.";
      recordDashboardEvent(projectPath, "setup.prompt", {
        agent,
        output: redactEvidenceText("setup prompt", renderedOutput),
      });
      jsonResponse(res, 200, {
        output: renderedOutput,
      });
    } catch (err) {
      jsonResponse(res, responseStatusForError(err, 500), {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  function getOrRunQualityAudit(
    projectPath: string,
    agent: AgentId,
    {
      cacheOnly = false,
      fresh = false,
    }: { cacheOnly?: boolean; fresh?: boolean } = {},
  ): { report: AuditReport | null; cacheStatus: QualityAuditCacheStatus } {
    const cached = readQualityAuditCache(projectPath, agent, fresh);
    if (cached !== null) {
      return { report: cached, cacheStatus: "hit" };
    }
    const cacheStatus = fresh ? "bypass" : "miss";
    if (cacheOnly) return { report: null, cacheStatus };
    try {
      const fs = createFS(projectPath);
      const report = runAudit(fs, projectPath, {
        agentFilter: agent,
        harness: true,
      });
      writeQualityAuditCache(projectPath, agent, report);
      return { report, cacheStatus };
    } catch {
      return { report: null, cacheStatus };
    }
  }

  /** Generate a quality-assessment prompt for a selected agent and return it to the dashboard. */
  function handleQualityRequest(url: URL, res: ServerResponse): boolean {
    if (url.pathname !== "/api/quality") return false;

    const params = parseQualityRequestParams(url, res);
    if (params === null) return true;

    try {
      const projectPath = validatedPath(
        url.searchParams.get("path"),
        "project-read",
      );
      const selectedProjectPath = validatedPath(
        url.searchParams.get("target"),
        "project-read",
      );
      const fs = createFS(projectPath);
      const sharedFacts = extractSharedFacts(fs, loadConfig(projectPath, fs));
      const audit = getOrRunQualityAudit(projectPath, params.agent, {
        cacheOnly: params.fast,
        fresh: params.fresh,
      });
      const auditReport = audit.report;
      const { entry: priorReport } = findLatestQualityReport(
        projectPath,
        params.agent,
        params.qualityMode,
      );
      const result = composeQuality({
        agent: params.agent,
        projectPath,
        auditReport,
        auditUnavailableReason:
          audit.report === null && params.fast ? "fast-cache-only" : undefined,
        priorReport,
        qualityMode: params.qualityMode,
        selectedProjectPath,
        sharedFacts,
      });
      recordDashboardEvent(projectPath, "quality.prompt", {
        agent: params.agent,
        quality_mode: params.qualityMode,
        audit_status: auditReport?.status ?? "unavailable",
        prompt: redactEvidenceText("quality prompt", result.prompt),
      });
      jsonResponse(res, 200, {
        ...result,
        auditCacheStatus: audit.cacheStatus,
      });
    } catch (err) {
      jsonResponse(res, responseStatusForError(err, 500), {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  /** Return persisted quality-history rows and latest trend summary for dashboard UI rendering. */
  async function handleQualityHistoryRequest(
    url: URL,
    res: ServerResponse,
  ): Promise<boolean> {
    if (url.pathname !== "/api/quality/history") return false;

    const agentParam = url.searchParams.get("agent");
    const agent =
      agentParam && VALID_AGENTS.has(agentParam)
        ? (agentParam as AgentId)
        : null;

    if (agentParam && !agent) {
      jsonResponse(res, 400, {
        error: `quality history agent must be one of: ${KNOWN_AGENT_LIST}`,
      });
      return true;
    }

    const limit = parseQualityHistoryLimit(url.searchParams.get("limit"));
    const modeParam = url.searchParams.get("mode");
    const qualityMode = parseQualityModeParam(modeParam);

    if (modeParam && !qualityMode) {
      jsonResponse(res, 400, {
        error: `quality history mode must be one of: ${QUALITY_MODES.join(", ")}`,
      });
      return true;
    }

    try {
      const projectPath = validatedPath(
        url.searchParams.get("path"),
        "project-read",
      );
      const { buildQualityHistoryRows, loadQualityHistoryWindow } =
        await import("../quality/history.js");
      const history = loadQualityHistoryWindow(projectPath, {
        agent,
        limit,
        qualityMode,
      });
      const rows = buildQualityHistoryRows(history.entries, {
        agent,
        limit,
        qualityMode,
      });
      const latestEntry = getDashboardLatestQualityEntry(
        history.entries,
        agent,
        qualityMode,
      );

      jsonResponse(res, 200, {
        rows,
        latest: buildLatestQualitySummary(latestEntry),
        warnings: history.warnings,
      });
    } catch (err) {
      jsonResponse(res, responseStatusForError(err, 500), {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  /** Return the skill/reference artifact inventory for a project. */
  function handleSkillQualityInventoryRequest(
    url: URL,
    res: ServerResponse,
  ): boolean {
    if (url.pathname !== "/api/skill-quality/inventory") return false;

    const agent = parseRequiredAgentParam(
      url.searchParams.get("agent"),
      "skill-quality inventory",
      res,
    );
    if (!agent) return true;
    try {
      const projectPath = validatedPath(
        url.searchParams.get("path"),
        "project-read",
      );
      const artifacts = discoverArtifacts(
        projectPath,
        runnerSkillQualityConfig(projectPath, agent),
      );
      jsonResponse(res, 200, { artifacts });
    } catch (err) {
      jsonResponse(res, responseStatusForError(err, 500), {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  /** Score a single skill/reference artifact with deterministic metrics. */
  function handleSkillQualityRequest(url: URL, res: ServerResponse): boolean {
    if (url.pathname !== "/api/skill-quality") return false;

    const agent = parseRequiredAgentParam(
      url.searchParams.get("agent"),
      "skill-quality",
      res,
    );
    if (!agent) return true;
    const artifactId = url.searchParams.get("artifact");

    if (!artifactId) {
      jsonResponse(res, 400, {
        error: "skill-quality requires ?artifact=<id>",
      });
      return true;
    }

    try {
      const projectPath = validatedPath(
        url.searchParams.get("path"),
        "project-read",
      );
      const config = runnerSkillQualityConfig(projectPath, agent);
      const artifact = findArtifact(projectPath, artifactId, config);
      if (!artifact) {
        jsonResponse(res, 404, {
          error: `artifact not found: ${artifactId}`,
        });
        return true;
      }
      const report = scoreArtifact(projectPath, artifact, config);
      const prompt = composeArtifactQualityPrompt(report);
      jsonResponse(res, 200, { ...report, prompt });
    } catch (err) {
      jsonResponse(res, responseStatusForError(err, 500), {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  /** Stamp the deprecation contract on responses served via the `/analyse`
   *  alias. Called before `jsonResponse` on every status path of the alias. */
  function markEvaluateAliasDeprecation(res: ServerResponse): void {
    res.setHeader("Deprecation", "true");
    res.setHeader("Link", '</api/quality/evaluate>; rel="successor-version"');
  }

  /** POST /api/quality/evaluate — score uploaded markdown and return tips.
   * Also handles `POST /api/quality/analyse` as a deprecated alias (responds
   * with `Deprecation: true` and `Link: <…/evaluate>; rel="successor-version"`
   * headers; the response body is identical).
   *
   * Body: { content: string, suggestedName?: string, kind?: "skill" | "shared-reference" }.
   * Returns the full SkillQualityReport plus an `tips` array with actionable
   * improvement suggestions derived from failing/warning metrics.
   *
   * Read-only — does not write any file. The "side-effectful" classification
   * is conservative: even though no IO happens, the endpoint is POST so the
   * Origin check applies, and the body cap keeps the engine from being abused
   * as a CPU sink. */
  // eslint-disable-next-line complexity -- one handler covers /evaluate + the deprecated /analyse alias across method/decoder/exec/error branches; each branch represents one HTTP outcome and the deprecation header must stamp every alias path
  async function handleQualityEvaluateRequest(
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ): Promise<boolean> {
    const isAlias = url.pathname === "/api/quality/analyse";
    if (url.pathname !== "/api/quality/evaluate" && !isAlias) return false;
    if (req.method !== "POST") {
      if (isAlias) markEvaluateAliasDeprecation(res);
      jsonResponse(res, 405, { error: "Method not allowed" });
      return true;
    }
    let body: string;
    try {
      body = await readBody(req, {
        maxBytes: QUALITY_EVALUATE_MAX_BODY_BYTES,
        tooLargeMessage: "Evaluate body too large",
      });
    } catch (err) {
      if (isAlias) markEvaluateAliasDeprecation(res);
      jsonResponse(res, 413, {
        error: err instanceof Error ? err.message : String(err),
      });
      return true;
    }
    const { decodeEvaluateBody } = await import("./decoders.js");
    const decoded = decodeEvaluateBody(body);
    if (!decoded.ok) {
      if (isAlias) markEvaluateAliasDeprecation(res);
      jsonResponse(res, 400, { error: decoded.error, path: decoded.path });
      return true;
    }
    try {
      const projectPath = validatedPath(
        url.searchParams.get("path"),
        "project-read",
      );
      const result = decoded.value.files
        ? evaluateUploadedBundle(projectPath, {
            files: decoded.value.files,
            suggestedName: decoded.value.suggestedName,
            kind: decoded.value.kind,
          })
        : evaluateContent(projectPath, {
            content: decoded.value.content ?? "",
            suggestedName: decoded.value.suggestedName,
            kind: decoded.value.kind,
          });
      if (isAlias) markEvaluateAliasDeprecation(res);
      jsonResponse(res, 200, result);
    } catch (err) {
      if (isAlias) markEvaluateAliasDeprecation(res);
      jsonResponse(res, responseStatusForError(err, 500), {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  /** List child directories so the dashboard path picker can browse nearby repos. */
  function handleBrowseRequest(url: URL, res: ServerResponse): boolean {
    if (url.pathname !== "/api/browse") return false;

    try {
      const dirPath = validatedPath(url.searchParams.get("path"), "browse");
      const entries = readdirSync(dirPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name)
        .sort();
      const dirs = entries.map((name) => {
        const full = join(dirPath, name);
        return { name, path: full, isProject: isProjectDirectory(full) };
      });
      jsonResponse(res, 200, {
        current: dirPath,
        parent: dirname(dirPath),
        dirs,
      });
    } catch (err) {
      jsonResponse(res, responseStatusForError(err, 500), {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  /** Return or update milestone/task state for the selected project. */
  async function handleTasksRequest(
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ): Promise<boolean> {
    if (url.pathname !== "/api/tasks") return false;

    const requestedPlan = url.searchParams.get("plan");
    if (req.method === "POST") {
      try {
        const projectPath = validatedPath(
          url.searchParams.get("path"),
          "write-local-state",
        );
        const planName = readActiveTaskPlanBody(await readBody(req));
        writeActiveTaskPlan(projectPath, planName);
        jsonResponse(res, 200, buildDashboardTaskState(projectPath, planName));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status =
          message.includes("does not exist") || message.includes("not found")
            ? 404
            : 400;
        jsonResponse(res, status, { error: message });
      }
      return true;
    }

    if (req.method !== "GET") {
      jsonResponse(res, 405, { error: "Method not allowed" });
      return true;
    }

    try {
      const projectPath = validatedPath(
        url.searchParams.get("path"),
        "project-read",
      );
      jsonResponse(
        res,
        200,
        buildDashboardTaskState(projectPath, requestedPlan),
      );
    } catch (err) {
      jsonResponse(res, responseStatusForError(err, 500), {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  /** Detect which coding agent CLIs are installed on the machine. */
  function detectInstalledAgents(includeVersions: boolean): {
    id: string;
    name: string;
    installed: boolean;
    version: string | null;
  }[] {
    return SUPPORTED_AGENTS.map((agent) => {
      try {
        const whichCmd = process.platform === "win32" ? "where" : "which";
        execFileSync(whichCmd, [agent.terminalBinary], {
          timeout: 3000,
          stdio: "pipe",
        });
        let version: string | null = null;
        if (includeVersions) {
          try {
            version = normalizeAgentVersionOutput(
              execFileSync(agent.terminalBinary, ["--version"], {
                timeout: 5000,
                stdio: "pipe",
              }).toString(),
            );
          } catch {
            /* version detection optional */
          }
        }
        return { ...agent, installed: true, version };
      } catch {
        return { ...agent, installed: false, version: null };
      }
    });
  }

  let cachedAgentDetection: ReturnType<typeof detectInstalledAgents> | null =
    null;

  function handleAgentDetectRequest(url: URL, res: ServerResponse): boolean {
    if (url.pathname !== "/api/agents/installed") return false;

    const fresh = url.searchParams.get("fresh") === "true";
    if (fresh || cachedAgentDetection === null) {
      cachedAgentDetection = detectInstalledAgents(fresh);
    }

    jsonResponse(res, 200, { agents: cachedAgentDetection });
    return true;
  }

  /** Save/load the dashboard state to/from disk so it survives server restarts. */
  async function handleProjectsListRequest(
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ): Promise<boolean> {
    if (url.pathname !== "/api/projects/list") return false;

    if (req.method === "GET") {
      jsonResponse(res, 200, await loadDashboardState());
      return true;
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      try {
        const { decodeProjectsListBody } = await import("./decoders.js");
        const decoded = decodeProjectsListBody(body);
        if (!decoded.ok) {
          jsonResponse(res, 400, {
            error: decoded.error,
            path: decoded.path,
          });
          return true;
        }
        const { mkdir, rm, writeFile } = await import("node:fs/promises");
        const previousState = await loadDashboardState();
        const validatedProjectPaths = decoded.value.paths.map(
          (path) => validateLocalPath(path, "write-local-state").path,
        );
        const nextState = hydrateDashboardState(
          {
            ...decoded.value,
            paths: validatedProjectPaths,
            projects: {},
          },
          { allowMarkerWrite: true },
        );
        const previousPaths = new Set(previousState.paths);
        const nextPaths = new Set(nextState.paths);
        const removedCount = previousState.paths.filter(
          (path) => !nextPaths.has(path),
        ).length;
        const addedCount = nextState.paths.filter(
          (path) => !previousPaths.has(path),
        ).length;
        await mkdir(dirname(dashboardStateFile), { recursive: true });
        await writeFile(dashboardStateFile, JSON.stringify(nextState, null, 2));
        await rm(legacyProjectsListFile, { force: true });
        recordDashboardEvent(absDefault, "project.save", {
          project_count: nextState.paths.length,
          favorite_count: nextState.favorites.length,
          added_count: addedCount,
          removed_count: removedCount,
        });
        if (removedCount > 0) {
          recordDashboardEvent(absDefault, "project.remove", {
            removed_count: removedCount,
          });
        }
        jsonResponse(res, 200, { ok: true });
      } catch (err) {
        jsonResponse(res, 400, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return true;
    }

    jsonResponse(res, 405, { error: "Method not allowed" });
    return true;
  }

  /** Classify project adoption state for one or more paths. */
  function handleProjectsStatusRequest(url: URL, res: ServerResponse): boolean {
    if (url.pathname !== "/api/projects/status") return false;

    const pathsParam = url.searchParams.get("paths");
    if (!pathsParam) {
      jsonResponse(res, 400, { error: "Missing paths parameter" });
      return true;
    }

    const paths = pathsParam
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);

    const results = paths.map((p) => {
      try {
        const projectPath = validateLocalPath(p, "write-local-state").path;
        const identity = resolveProjectIdentity(projectPath, {
          allowMarkerWrite: true,
        });
        const fs = createFS(identity.currentPath);
        return {
          path: identity.currentPath,
          paths: [identity.currentPath],
          ...identity,
          ...classifyProjectState(fs),
        };
      } catch (err) {
        return {
          path: p,
          state: "error" as const,
          action: "none" as const,
          details: String(err),
        };
      }
    });

    if (paths.length === 1) {
      const result = results[0];
      if (
        result &&
        result.state !== "error" &&
        typeof result.path === "string"
      ) {
        recordDashboardEvent(result.path, "project.switch", {
          state: result.state,
          identity: "identity" in result ? result.identity : "",
          identity_source:
            "identitySource" in result ? result.identitySource : "",
        });
      }
    }

    jsonResponse(res, 200, { projects: results });
    return true;
  }

  return {
    handleHtmlRequest,
    handleAssetRequest,
    handleAuditRequest,
    handleSetupDetectRequest,
    handleSetupRequest,
    handleQualityRequest,
    handleQualityHistoryRequest,
    handleSkillQualityRequest,
    handleSkillQualityInventoryRequest,
    handleQualityEvaluateRequest,
    handleBrowseRequest,
    handleTasksRequest,
    handleAgentDetectRequest,
    handleProjectsListRequest,
    handleProjectsStatusRequest,
  };
}
