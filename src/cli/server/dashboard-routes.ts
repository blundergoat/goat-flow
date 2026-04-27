/**
 * Non-terminal dashboard route handlers and their shared response shapers.
 * The main dashboard server wires these into HTTP dispatch while keeping
 * lifecycle, live-reload, and terminal state management local.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
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
import { detectAgents as detectConfiguredAgents } from "../detect/agents.js";
import { createFS } from "../facts/fs.js";
import { extractSharedFacts } from "../facts/shared/index.js";
import type { QualityHistoryEntry } from "../quality/history.js";
import type { AgentId } from "../types.js";
import { loadDashboardAsset } from "./dashboard-assets.js";
import { buildSetupDetectPayload, isProjectDirectory } from "./setup-detect.js";
import type { DashboardReport } from "./types.js";
import type { QualityMode } from "../quality/schema.js";
import { QUALITY_MODES } from "../quality/schema.js";
import { buildStatsReport, checkStats } from "../stats/stats.js";

const KNOWN_AGENT_IDS = getKnownAgentIds();
const KNOWN_AGENT_LIST = KNOWN_AGENT_IDS.join(", ");
const AGENT_PROFILE_MAP = getAgentProfileMap();
const AGENT_PROFILES = getAgentProfiles();
const SUPPORTED_AGENTS = AGENT_PROFILES.map(({ id, name }) => ({ id, name }));
const VALID_AGENTS = new Set<string>(KNOWN_AGENT_IDS);
const VALID_QUALITY_MODES = new Set<string>(QUALITY_MODES);

interface DashboardPresetData {
  id: string;
  name: string;
  desc: string;
  prompt: string;
  cat: string;
}

interface DashboardStateData {
  paths: string[];
  favorites: string[];
  projectTitles: Record<string, string>;
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

type BodyReader = (req: IncomingMessage) => Promise<string>;

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
const enrichmentCache = new Map<
  string,
  {
    learningLoop: DashboardReport["learningLoop"];
    recentLessons: DashboardReport["recentLessons"];
    cachedAt: number;
  }
>();

/** Enrich a dashboard report with compact Home-only learning-loop context. */
function enrichDashboardReport(
  report: DashboardReport,
  projectPath: string,
  fresh = false,
): DashboardReport {
  const now = Date.now();
  const cached = enrichmentCache.get(projectPath);
  if (!fresh && cached && now - cached.cachedAt < ENRICHMENT_TTL_MS) {
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
    cachedAt: now,
  });
  return { ...report, learningLoop, recentLessons };
}

/** Build the dashboard API payload from aggregate and per-agent audit results. */
function buildDashboardReport(
  auditRpt: AuditReport,
  perAgentAudits: { id: string; audit: AuditReport }[],
  projectPath: string,
): DashboardReport {
  return enrichDashboardReport(
    {
      agentScores: perAgentAudits.map((pa) => {
        const agentId = pa.id as AgentId;
        return {
          id: pa.id,
          name: AGENT_PROFILE_MAP[agentId].name,
          agent: pa.audit.scopes.agent,
          harness: pa.audit.scopes.harness,
          concerns: pa.audit.concerns,
        };
      }),
      status: auditRpt.status,
      scopes: {
        setup: auditRpt.scopes.setup,
        agent: auditRpt.scopes.agent,
        ...(auditRpt.scopes.harness
          ? { harness: auditRpt.scopes.harness }
          : {}),
      },
      overall: auditRpt.overall,
      learningLoop: null,
      recentLessons: [],
      target: auditRpt.target,
    },
    projectPath,
    true,
  );
}

const AUDIT_CACHE_FILE = "audit-cache.json";

function readConfigVersion(projectPath: string): string | null {
  try {
    const raw = readFileSync(
      join(projectPath, ".goat-flow", "config.yaml"),
      "utf-8",
    );
    const match = raw.match(/^version:\s*["']?([^\s"']+)["']?\s*$/m);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function readAuditCache(
  projectPath: string,
  packageVersion: string,
): { report: DashboardReport; cachedAt: string } | null {
  try {
    const raw = readFileSync(
      join(projectPath, ".goat-flow", AUDIT_CACHE_FILE),
      "utf-8",
    );
    const envelope = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof envelope.packageVersion !== "string" ||
      typeof envelope.configVersion !== "string" ||
      typeof envelope.cachedAt !== "string" ||
      !envelope.report
    )
      return null;
    if (envelope.packageVersion !== packageVersion) return null;
    const configVersion = readConfigVersion(projectPath);
    if (!configVersion || envelope.configVersion !== configVersion) return null;
    return {
      report: envelope.report as DashboardReport,
      cachedAt: envelope.cachedAt,
    };
  } catch {
    return null;
  }
}

function writeAuditCache(
  projectPath: string,
  packageVersion: string,
  report: DashboardReport,
): void {
  try {
    const configVersion = readConfigVersion(projectPath);
    if (!configVersion) return;
    const envelope = {
      packageVersion,
      configVersion,
      cachedAt: new Date().toISOString(),
      report,
    };
    writeFile(
      join(projectPath, ".goat-flow", AUDIT_CACHE_FILE),
      JSON.stringify(envelope),
    ).catch(() => {});
  } catch {
    // Cache write failure is non-fatal
  }
}

/** Build the non-terminal dashboard route handlers for one server instance. */
export function createDashboardRouteHandlers(
  deps: DashboardRouteDependencies,
): {
  handleHtmlRequest: (url: URL, res: ServerResponse) => boolean;
  handleAssetRequest: (url: URL, res: ServerResponse) => boolean;
  handleAuditRequest: (url: URL, res: ServerResponse) => boolean;
  handleSetupDetectRequest: (url: URL, res: ServerResponse) => boolean;
  handleSetupRequest: (url: URL, res: ServerResponse) => Promise<boolean>;
  handleQualityRequest: (url: URL, res: ServerResponse) => Promise<boolean>;
  handleQualityHistoryRequest: (
    url: URL,
    res: ServerResponse,
  ) => Promise<boolean>;
  handleBrowseRequest: (url: URL, res: ServerResponse) => boolean;
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
    dashboardPresets,
    jsonResponse,
    readBody,
  } = deps;
  const dashboardStateFile = join(
    absDefault,
    ".goat-flow",
    "dashboard-state.json",
  );
  const legacyProjectsListFile = join(
    absDefault,
    ".goat-flow",
    "dashboard-projects.json",
  );

  /** Resolve a user-supplied path to an absolute path. */
  function safeResolvePath(raw: string | null): string {
    return resolve(raw || absDefault);
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
    return { paths, favorites, projectTitles };
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
    return { paths: [], favorites: [], projectTitles: {} };
  }

  /** Fail fast when an endpoint expects a real project directory. */
  function requireProjectDirectory(projectPath: string): void {
    const stats = statSync(projectPath);
    if (!stats.isDirectory()) {
      throw new Error(`${projectPath} is not a directory`);
    }
  }

  /** Serve the dashboard shell and inject the default workspace path. */
  function handleHtmlRequest(url: URL, res: ServerResponse): boolean {
    if (url.pathname !== "/") return false;

    const injection = `<script>window.__GOAT_FLOW_DEFAULT_PATH__ = ${JSON.stringify(absDefault)}; window.__GOAT_FLOW_VERSION__ = ${JSON.stringify(packageVersion)}; window.__GOAT_FLOW_AGENTS__ = ${JSON.stringify(SUPPORTED_AGENTS)}; window.__GOAT_FLOW_RUNNER_IDS__ = ${JSON.stringify(KNOWN_AGENT_IDS)}; window.__GOAT_FLOW_PRESETS__ = ${JSON.stringify(dashboardPresets)};</script>`;
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
  function handleAssetRequest(url: URL, res: ServerResponse): boolean {
    if (!url.pathname.startsWith("/assets/")) return false;

    const filename = url.pathname.slice("/assets/".length);
    if (!/^[a-z0-9_-]+\.(js|css|json)$/i.test(filename)) return false;

    const contentType = filename.endsWith(".css")
      ? "text/css; charset=utf-8"
      : filename.endsWith(".json")
        ? "application/json; charset=utf-8"
        : "application/javascript; charset=utf-8";
    try {
      const content = loadDashboardAsset(filename);
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
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

  /** Run both evaluation systems and return a typed DashboardReport. */
  function handleAuditRequest(url: URL, res: ServerResponse): boolean {
    if (url.pathname !== "/api/audit") return false;

    const projectPath = safeResolvePath(url.searchParams.get("path"));
    const harness = url.searchParams.get("quality") === "true";
    const agentParam = url.searchParams.get("agent");
    const agentFilter =
      agentParam && VALID_AGENTS.has(agentParam)
        ? (agentParam as AgentId)
        : null;
    const fresh = url.searchParams.get("fresh") === "true";

    try {
      requireProjectDirectory(projectPath);

      if (!fresh && isCacheEligible(agentFilter, harness)) {
        const cached = readAuditCache(projectPath, packageVersion);
        if (cached) {
          const report = enrichDashboardReport(cached.report, projectPath);
          jsonResponse(res, 200, {
            ...report,
            cached: true,
            cachedAt: cached.cachedAt,
          });
          return true;
        }
      }

      const fs = createFS(projectPath);
      const configAgents = detectConfiguredAgents(fs).map((a) => a.id);
      const batch = runAuditBatch(
        fs,
        projectPath,
        { agentFilter, harness },
        configAgents,
      );
      const report = buildDashboardReport(
        batch.aggregate,
        batch.perAgent,
        projectPath,
      );

      if (isCacheEligible(agentFilter, harness)) {
        writeAuditCache(projectPath, packageVersion, report);
      }

      jsonResponse(res, 200, { ...report, cached: false, cachedAt: null });
    } catch (err) {
      jsonResponse(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  /** Detect project stack, commands, agents, and existing config for the setup view. */
  function handleSetupDetectRequest(url: URL, res: ServerResponse): boolean {
    if (url.pathname !== "/api/setup/detect") return false;

    const projectPath = safeResolvePath(url.searchParams.get("path"));

    try {
      requireProjectDirectory(projectPath);
      jsonResponse(res, 200, buildSetupDetectPayload(projectPath));
    } catch (err) {
      jsonResponse(res, 500, {
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

    const projectPath = safeResolvePath(url.searchParams.get("path"));
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
      requireProjectDirectory(projectPath);
      const fs = createFS(projectPath);
      const { loadConfig } = await import("../config/reader.js");
      const { extractProjectFacts } = await import("../facts/orchestrator.js");
      const configState = loadConfig(projectPath, fs);
      const facts = extractProjectFacts(fs, {
        agentFilter: agent,
        projectPath,
        configState,
      });
      const auditReport = runAudit(fs, projectPath, {
        agentFilter: agent,
        harness: false,
      });
      const { composeSetup } = await import("../prompt/compose-setup.js");
      const output = composeSetup(auditReport, facts, agent);
      jsonResponse(res, 200, {
        output: output ?? "No setup output generated.",
      });
    } catch (err) {
      jsonResponse(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  /** Generate a quality-assessment prompt for a selected agent and return it to the dashboard. */
  async function handleQualityRequest(
    url: URL,
    res: ServerResponse,
  ): Promise<boolean> {
    if (url.pathname !== "/api/quality") return false;

    const agentParam = url.searchParams.get("agent");
    if (!agentParam || !VALID_AGENTS.has(agentParam)) {
      jsonResponse(res, 400, {
        error: `quality requires --agent. Valid: ${KNOWN_AGENT_LIST}`,
      });
      return true;
    }

    const projectPath = safeResolvePath(url.searchParams.get("path"));
    const selectedProjectPath = safeResolvePath(url.searchParams.get("target"));
    const agent = agentParam as AgentId;
    const modeParam = url.searchParams.get("mode");
    const qualityMode = parseQualityModeParam(modeParam) ?? "agent-setup";

    if (modeParam && !VALID_QUALITY_MODES.has(modeParam)) {
      jsonResponse(res, 400, {
        error: `quality mode must be one of: ${QUALITY_MODES.join(", ")}`,
      });
      return true;
    }

    try {
      requireProjectDirectory(projectPath);
      const { composeQuality } = await import("../prompt/compose-quality.js");
      const { findLatestQualityReport } = await import("../quality/history.js");

      let auditReport: AuditReport | null = null;
      try {
        const fs = createFS(projectPath);
        auditReport = runAudit(fs, projectPath, {
          agentFilter: agent,
          harness: true,
        });
      } catch {
        /* audit failure is fine - quality prompt generates with degraded context */
      }

      const { entry: priorReport } = findLatestQualityReport(
        projectPath,
        agent,
        qualityMode,
      );
      const result = composeQuality({
        agent,
        projectPath,
        auditReport,
        priorReport,
        qualityMode,
        selectedProjectPath,
      });
      jsonResponse(res, 200, result);
    } catch (err) {
      jsonResponse(res, 500, {
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

    const projectPath = safeResolvePath(url.searchParams.get("path"));
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
      requireProjectDirectory(projectPath);
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
      jsonResponse(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  /** List child directories so the dashboard path picker can browse nearby repos. */
  function handleBrowseRequest(url: URL, res: ServerResponse): boolean {
    if (url.pathname !== "/api/browse") return false;

    const dirPath = resolve(url.searchParams.get("path") || absDefault);
    try {
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
      jsonResponse(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  /** Detect which coding agent CLIs are installed on the machine. */
  function detectInstalledAgents(): {
    id: string;
    name: string;
    installed: boolean;
    version: string | null;
  }[] {
    return SUPPORTED_AGENTS.map(({ id, name }) => {
      try {
        const whichCmd = process.platform === "win32" ? "where" : "which";
        execFileSync(whichCmd, [id], { timeout: 3000, stdio: "pipe" });
        let version: string | null = null;
        try {
          version = normalizeAgentVersionOutput(
            execFileSync(id, ["--version"], {
              timeout: 5000,
              stdio: "pipe",
            }).toString(),
          );
        } catch {
          /* version detection optional */
        }
        return { id, name, installed: true, version };
      } catch {
        return { id, name, installed: false, version: null };
      }
    });
  }

  let cachedAgentDetection: ReturnType<typeof detectInstalledAgents> | null =
    null;

  function handleAgentDetectRequest(url: URL, res: ServerResponse): boolean {
    if (url.pathname !== "/api/agents/installed") return false;

    const fresh = url.searchParams.get("fresh") === "true";
    if (fresh || cachedAgentDetection === null) {
      cachedAgentDetection = detectInstalledAgents();
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
        await mkdir(join(absDefault, ".goat-flow"), { recursive: true });
        await writeFile(
          dashboardStateFile,
          JSON.stringify(decoded.value, null, 2),
        );
        await rm(legacyProjectsListFile, { force: true });
        jsonResponse(res, 200, { ok: true });
      } catch (err) {
        jsonResponse(res, 400, { error: String(err) });
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
        const resolved = resolve(p);
        const fs = createFS(resolved);
        return { path: resolved, ...classifyProjectState(fs) };
      } catch (err) {
        return {
          path: p,
          state: "error" as const,
          action: "none" as const,
          details: String(err),
        };
      }
    });

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
    handleBrowseRequest,
    handleAgentDetectRequest,
    handleProjectsListRequest,
    handleProjectsStatusRequest,
  };
}
