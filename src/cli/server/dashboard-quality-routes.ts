/**
 * Quality-prompt and quality-history HTTP route handlers for the dashboard server.
 *
 * Backs `/api/quality` (compose a quality review prompt for one agent, optionally reusing a short-TTL in-memory audit cache) and
 * `/api/quality/history` (return persisted history rows plus the latest trend summary).
 *
 * Query parameters are validated up front, with invalid agent/mode/limit values answered as 400 JSON; downstream audit or filesystem failures are
 * reported as JSON status bodies rather than thrown.
 * Report shaping lives in dashboard-reporting.ts; history loading in quality/history.ts.
 */
import type { ServerResponse } from "node:http";
import { runAudit } from "../audit/audit.js";
import type { AuditReport } from "../audit/types.js";
import { loadConfig } from "../config/reader.js";
import { redactEvidenceText } from "../evidence/redaction.js";
import { createFS } from "../facts/fs.js";
import { extractSharedFacts } from "../facts/shared/index.js";
import { findLatestQualityReport } from "../quality/history.js";
import { QUALITY_MODES, type QualityMode } from "../quality/schema.js";
import { composeQuality } from "../prompt/compose-quality.js";
import type { AgentId } from "../types.js";
import {
  KNOWN_AGENT_LIST,
  VALID_AGENTS,
  VALID_QUALITY_MODES,
  type DashboardRouteContext,
  type QualityAuditCacheStatus,
  type QualityRequestParams,
} from "./dashboard-route-types.js";
import {
  buildLatestQualitySummary,
  buildQualityAuditCacheKey,
} from "./dashboard-reporting.js";

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

function qualityHistoryEntryMatchesFilters(
  entry: { agent: AgentId; report: { quality_mode?: QualityMode } },
  agent: AgentId | null,
  qualityMode: QualityMode | null,
): boolean {
  if (agent !== null && entry.agent !== agent) return false;
  if (qualityMode === null) return true;
  return (entry.report.quality_mode ?? "agent-setup") === qualityMode;
}

/**
 * Validated `/api/quality/history` query filters.
 * A null `agent` or `qualityMode` means "no filter" (return all), while `limit` is always a clamped positive count so callers cannot request an
 * unbounded or zero-row window.
 */
interface QualityHistoryFilters {
  agent: AgentId | null;
  limit: number;
  qualityMode: QualityMode | null;
}

function readQualityHistoryFilters(
  ctx: DashboardRouteContext,
  url: URL,
  res: ServerResponse,
): QualityHistoryFilters | null {
  const agentParam = url.searchParams.get("agent");
  const agent =
    agentParam && VALID_AGENTS.has(agentParam) ? (agentParam as AgentId) : null;

  if (agentParam && !agent) {
    ctx.jsonResponse(res, 400, {
      error: `quality history agent must be one of: ${KNOWN_AGENT_LIST}`,
    });
    return null;
  }

  const modeParam = url.searchParams.get("mode");
  const qualityMode = parseQualityModeParam(modeParam);

  if (modeParam && !qualityMode) {
    ctx.jsonResponse(res, 400, {
      error: `quality history mode must be one of: ${QUALITY_MODES.join(", ")}`,
    });
    return null;
  }

  return {
    agent,
    limit: parseQualityHistoryLimit(url.searchParams.get("limit")),
    qualityMode,
  };
}

function parseQualityRequestParams(
  ctx: DashboardRouteContext,
  url: URL,
  res: ServerResponse,
): QualityRequestParams | null {
  const agentParam = url.searchParams.get("agent");
  if (!agentParam || !VALID_AGENTS.has(agentParam)) {
    ctx.jsonResponse(res, 400, {
      error: `quality requires --agent. Valid: ${KNOWN_AGENT_LIST}`,
    });
    return null;
  }

  const modeParam = url.searchParams.get("mode");
  if (modeParam && !VALID_QUALITY_MODES.has(modeParam)) {
    ctx.jsonResponse(res, 400, {
      error: `quality mode must be one of: ${QUALITY_MODES.join(", ")}`,
    });
    return null;
  }

  return {
    agent: agentParam as AgentId,
    qualityMode: parseQualityModeParam(modeParam) ?? "agent-setup",
    includeFresh: url.searchParams.get("fresh") === "true",
    shouldUseFastCache: url.searchParams.get("fast") === "true",
  };
}

function readQualityAuditCache(
  ctx: DashboardRouteContext,
  projectPath: string,
  agent: AgentId,
  fresh: boolean,
): AuditReport | null {
  if (fresh) return null;
  const cached = ctx.qualityAuditCache.get(
    buildQualityAuditCacheKey(projectPath, agent),
  );
  if (!cached) return null;
  if (Date.now() - cached.cachedAt >= 10_000) {
    ctx.qualityAuditCache.delete(buildQualityAuditCacheKey(projectPath, agent));
    return null;
  }
  return cached.report;
}

function writeQualityAuditCache(
  ctx: DashboardRouteContext,
  projectPath: string,
  agent: AgentId,
  report: AuditReport,
): void {
  ctx.qualityAuditCache.set(buildQualityAuditCacheKey(projectPath, agent), {
    report,
    cachedAt: Date.now(),
  });
}

function getOrRunQualityAudit(
  ctx: DashboardRouteContext,
  projectPath: string,
  agent: AgentId,
  {
    cacheOnly = false,
    fresh = false,
  }: { cacheOnly?: boolean; fresh?: boolean } = {},
): { report: AuditReport | null; cacheStatus: QualityAuditCacheStatus } {
  const cached = readQualityAuditCache(ctx, projectPath, agent, fresh);
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
      // Generating a quality prompt is a read, whether the user is assessing goat-flow itself or a project they selected, so it stops at static
      // evidence and never runs the project's own hook command.
      //
      // Every path that fills qualityAuditCache must keep this one static contract, because the cache key does not record the evidence level and a
      // full report could otherwise be served to a passive request later.
      denyMechanismEvidenceLevel: "static",
    });
    writeQualityAuditCache(ctx, projectPath, agent, report);
    return { report, cacheStatus };
  } catch {
    return { report: null, cacheStatus };
  }
}

/** Generate a quality prompt and reports path/audit failures as JSON. */
function handleQualityRequest(
  ctx: DashboardRouteContext,
  url: URL,
  res: ServerResponse,
): boolean {
  if (url.pathname !== "/api/quality") return false;

  const params = parseQualityRequestParams(ctx, url, res);
  if (params === null) return true;

  try {
    const projectPath = ctx.validatedPath(
      url.searchParams.get("path"),
      "project-read",
    );
    const selectedProjectPath = ctx.validatedPath(
      url.searchParams.get("target"),
      "project-read",
    );
    const fs = createFS(projectPath);
    const sharedFacts = extractSharedFacts(fs, loadConfig(projectPath, fs));
    const audit = getOrRunQualityAudit(ctx, projectPath, params.agent, {
      cacheOnly: params.shouldUseFastCache,
      fresh: params.includeFresh,
    });
    const auditReport = audit.report;
    const { entry: priorReport } = findLatestQualityReport(
      projectPath,
      params.agent,
      params.qualityMode,
    );
    const composeInput = {
      agent: params.agent,
      projectPath,
      auditReport,
      auditUnavailableReason:
        audit.report === null && params.shouldUseFastCache
          ? ("fast-cache-only" as const)
          : undefined,
      priorReport,
      qualityMode: params.qualityMode,
      selectedProjectPath,
      sharedFacts,
    };
    const result = composeQuality(composeInput);
    // Enforced Claude reporting launches cannot run the Bash saver (ADR-044), and the runner is chosen client-side after this response, so both
    // persistence variants ship: `prompt` for copy/manual runs, `launchPrompt` for staged-draft dashboard sessions.
    const launchResult = composeQuality({
      ...composeInput,
      persistence: "staged-draft",
    });
    ctx.recordDashboardEvent(projectPath, "quality.prompt", {
      agent: params.agent,
      quality_mode: params.qualityMode,
      audit_status: auditReport?.status ?? "unavailable",
      prompt: redactEvidenceText("quality prompt", result.prompt),
    });
    ctx.jsonResponse(res, 200, {
      ...result,
      launchPrompt: launchResult.prompt,
      auditCacheStatus: audit.cacheStatus,
    });
  } catch (err) {
    ctx.jsonResponse(res, ctx.responseStatusForError(err, 500), {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return true;
}

/** Return persisted quality-history rows and latest trend summary for dashboard UI rendering. */
async function handleQualityHistoryRequest(
  ctx: DashboardRouteContext,
  url: URL,
  res: ServerResponse,
): Promise<boolean> {
  if (url.pathname !== "/api/quality/history") return false;

  const filters = readQualityHistoryFilters(ctx, url, res);
  if (filters === null) return true;

  try {
    const projectPath = ctx.validatedPath(
      url.searchParams.get("path"),
      "project-read",
    );
    const { buildQualityHistoryRows, loadQualityHistoryWindow } =
      await import("../quality/history.js");
    const history = loadQualityHistoryWindow(projectPath, {
      agent: filters.agent,
      limit: filters.limit,
      qualityMode: filters.qualityMode,
    });
    const rows = buildQualityHistoryRows(history.entries, {
      agent: filters.agent,
      limit: filters.limit,
      qualityMode: filters.qualityMode,
    });
    const latestEntry =
      history.entries.find((entry) =>
        qualityHistoryEntryMatchesFilters(
          entry,
          filters.agent,
          filters.qualityMode,
        ),
      ) ?? null;

    ctx.jsonResponse(res, 200, {
      rows,
      latest: buildLatestQualitySummary(latestEntry),
      warnings: history.warnings,
    });
  } catch (err) {
    ctx.jsonResponse(res, ctx.responseStatusForError(err, 500), {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return true;
}

/**
 * Bind the quality handlers to one server's request context so each closure shares the path validator,
 * the per-server audit cache, and the evidence recorder.
 *
 * @param ctx - per-server dashboard route context with path validation, the quality audit cache, and IO hooks
 * @returns the quality-prompt and quality-history handlers; each resolves true once it has answered a
 *   matching request, or false to let another handler claim the URL
 */
export function createQualityRouteHandlers(ctx: DashboardRouteContext) {
  return {
    handleQualityRequest: (url: URL, res: ServerResponse) =>
      handleQualityRequest(ctx, url, res),
    handleQualityHistoryRequest: (url: URL, res: ServerResponse) =>
      handleQualityHistoryRequest(ctx, url, res),
  };
}
