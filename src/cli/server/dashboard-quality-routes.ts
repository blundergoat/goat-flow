/**
 * Supply quality-review prompts and saved review history for the selected project and agent.
 *
 * The Quality view can compose a prompt, reuse a short-lived audit, and compare saved runs with the latest trend summary.
 * Invalid agent or mode choices receive a 400; history limits default or clamp to a bounded window.
 *
 * Route handlers report request failures as JSON, while a missing audit can still yield a prompt with unavailable evidence marked.
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

// Keep the Quality history list bounded: an absent or invalid limit uses 20 rows, and larger requests stop at 100.
function parseQualityHistoryLimit(param: string | null): number {
  // Opening history without a requested page size uses the normal 20-run window.
  if (param === null) return 20;
  const parsed = Number.parseInt(param, 10);
  // An unusable page size retains the default history window instead of showing no runs or removing the cap.
  if (!Number.isFinite(parsed) || parsed <= 0) return 20;
  return Math.min(parsed, 100);
}

// Return a recognized quality mode, or null so history can remain unfiltered and prompt requests can use their default.
function parseQualityModeParam(param: string | null): QualityMode | null {
  // An omitted mode leaves the route free to choose its history or prompt default.
  if (param === null) return null;
  return VALID_QUALITY_MODES.has(param) ? (param as QualityMode) : null;
}

/**
 * Decide whether one saved run belongs in the history list the user is currently looking at.
 *
 * @param entry - saved run being considered
 * @param agent - selected runner, or null to include saved runs from all agents
 * @param qualityMode - selected review mode, or null to include all modes
 * @returns true when the run should appear in the table
 */
function qualityHistoryEntryMatchesFilters(
  entry: { agent: AgentId; report: { quality_mode?: QualityMode } },
  agent: AgentId | null,
  qualityMode: QualityMode | null,
): boolean {
  // A selected runner hides saved reviews produced for other agents.
  if (agent !== null && entry.agent !== agent) return false;
  // With no mode filter, the history list includes every review mode for the accepted runner.
  if (qualityMode === null) return true;
  // Older saved runs without a mode belong to the original agent-setup review category.
  return (entry.report.quality_mode ?? "agent-setup") === qualityMode;
}

/**
 * Carry the accepted Quality history choices after query validation.
 *
 * Null agent or mode values leave that part of the list unfiltered.
 * The positive, capped limit prevents callers from requesting an empty or unbounded history window.
 */
interface QualityHistoryFilters {
  agent: AgentId | null;
  limit: number;
  qualityMode: QualityMode | null;
}

/**
 * Read and check the history filters from the query string before any file is opened.
 *
 * @param ctx - dashboard route context supplying the response helpers
 * @param url - request URL carrying the agent, mode, and limit parameters
 * @param res - response already answered with a 400 when a parameter is rejected
 * @returns the accepted filters, or null once an error response has been sent and the caller should stop
 */
function readQualityHistoryFilters(
  ctx: DashboardRouteContext,
  url: URL,
  res: ServerResponse,
): QualityHistoryFilters | null {
  const agentParam = url.searchParams.get("agent");
  const agent =
    agentParam && VALID_AGENTS.has(agentParam) ? (agentParam as AgentId) : null;

  // A named but unsupported runner must be corrected instead of silently showing another agent's reviews.
  if (agentParam && !agent) {
    ctx.jsonResponse(res, 400, {
      error: `quality history agent must be one of: ${KNOWN_AGENT_LIST}`,
    });
    return null;
  }

  const modeParam = url.searchParams.get("mode");
  const qualityMode = parseQualityModeParam(modeParam);

  // Reject an unknown review mode rather than displaying a broader history than the user requested.
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

/**
 * Read and check the parameters for composing a quality prompt, before any audit work starts.
 *
 * @param ctx - dashboard route context supplying the response helpers
 * @param url - request URL carrying the agent, mode, and freshness parameters
 * @param res - response already answered with a 400 when a parameter is rejected
 * @returns the accepted parameters, or null once an error response has been sent and the caller should stop
 */
function parseQualityRequestParams(
  ctx: DashboardRouteContext,
  url: URL,
  res: ServerResponse,
): QualityRequestParams | null {
  const agentParam = url.searchParams.get("agent");
  // Prompt composition needs a supported runner so its instructions match the user's selected agent.
  if (!agentParam || !VALID_AGENTS.has(agentParam)) {
    ctx.jsonResponse(res, 400, {
      error: `quality requires --agent. Valid: ${KNOWN_AGENT_LIST}`,
    });
    return null;
  }

  const modeParam = url.searchParams.get("mode");
  // An unsupported review mode cannot safely select the prompt's assessment criteria.
  if (modeParam && !VALID_QUALITY_MODES.has(modeParam)) {
    ctx.jsonResponse(res, 400, {
      error: `quality mode must be one of: ${QUALITY_MODES.join(", ")}`,
    });
    return null;
  }

  return {
    agent: agentParam as AgentId,
    // An omitted or empty mode requests the standard agent-setup review.
    qualityMode: parseQualityModeParam(modeParam) ?? "agent-setup",
    includeFresh: url.searchParams.get("fresh") === "true",
    shouldUseFastCache: url.searchParams.get("fast") === "true",
  };
}

/**
 * Reuse a recent audit for this project and agent, so composing a prompt does not re-audit on every click.
 *
 * @param ctx - dashboard route context supplying the short-lived cache
 * @param projectPath - validated project the user selected
 * @param agent - agent the prompt is being composed for
 * @param isFresh - true when the user asked for live results and the cache must be ignored
 * @returns the cached report, or null when nothing recent enough was stored
 */
function readQualityAuditCache(
  ctx: DashboardRouteContext,
  projectPath: string,
  agent: AgentId,
  isFresh: boolean,
): AuditReport | null {
  // An explicit fresh request must re-check the selected project instead of reusing a recent prompt audit.
  if (isFresh) return null;
  const cached = ctx.qualityAuditCache.get(
    buildQualityAuditCacheKey(projectPath, agent),
  );
  // The first prompt for this project and runner has no audit available to reuse.
  if (!cached) return null;
  // A report older than ten seconds may miss recent setup edits, so the next prompt must obtain current evidence.
  if (Date.now() - cached.cachedAt >= 10_000) {
    ctx.qualityAuditCache.delete(buildQualityAuditCacheKey(projectPath, agent));
    return null;
  }
  return cached.report;
}

/**
 * Keep a just-computed audit in memory so the next prompt for the same project and agent is instant.
 *
 * @param ctx - dashboard route context supplying the short-lived cache
 * @param projectPath - validated project the user selected
 * @param agent - agent the report was produced for
 * @param report - audit result to reuse until it expires
 */
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

/**
 * Return the audit a quality prompt needs, reusing the cached one when it is still good and running a fresh audit otherwise.
 * Swallows audit failures into a null report so the prompt can identify unavailable audit evidence and still be composed.
 *
 * @param ctx - dashboard route context supplying the cache and audit entry points
 * @param projectPath - validated project the user selected
 * @param agent - agent the prompt is being composed for
 * @returns the report and cache outcome; a null report tells prompt composition that audit evidence is unavailable
 */
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
  // A recent report answers repeated prompt requests without another project audit.
  if (cached !== null) {
    return { report: cached, cacheStatus: "hit" };
  }
  const cacheStatus = fresh ? "bypass" : "miss";
  // Fast prompt requests continue without audit evidence when the cache has no acceptable report.
  if (cacheOnly) return { report: null, cacheStatus };
  try {
    const fs = createFS(projectPath);
    const report = runAudit(fs, projectPath, {
      agentFilter: agent,
      harness: true,
      // Generating a prompt must not execute the selected project's hook commands, so audit evidence stays static.
      //
      // Every cache writer must keep this limit because cache keys do not distinguish evidence levels.
      // Otherwise a later passive request could receive a report gathered with broader execution authority.
      denyMechanismEvidenceLevel: "static",
    });
    writeQualityAuditCache(ctx, projectPath, agent, report);
    return { report, cacheStatus };
  } catch {
    // A project audit that fails while its files are being changed leaves evidence unavailable; prompt composition owns that user-facing notice.
    return { report: null, cacheStatus };
  }
}

// Compose the selected runner's review prompt; reports request failures as JSON the Quality view can display.
function handleQualityRequest(
  ctx: DashboardRouteContext,
  url: URL,
  res: ServerResponse,
): boolean {
  // History and artifact requests belong to other handlers even though they share the Quality view.
  if (url.pathname !== "/api/quality") return false;

  const params = parseQualityRequestParams(ctx, url, res);
  // Parameter validation already explained why the prompt request was rejected.
  if (params === null) return true;

  try {
    const projectPath = ctx.validatedPath(
      url.searchParams.get("path"),
      "project-read",
    );
    const requestedTarget = url.searchParams.get("target");
    // Validating an absent target would substitute the server's own project, presenting a target the caller never selected.
    const selectedProjectPath = requestedTarget
      ? ctx.validatedPath(requestedTarget, "project-read")
      : undefined;
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
    // A selected project removed since page load fails validation; the Quality view receives the reason no prompt could be returned.
    ctx.jsonResponse(res, ctx.responseStatusForError(err, 500), {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return true;
}

/**
 * Answer the Quality tab with the user's saved runs plus the latest trend summary.
 * It reports a rejected filter or an unreadable history directory as a JSON status body rather than throwing at the server.
 *
 * @param ctx - dashboard route context supplying path validation and response helpers
 * @param url - request URL carrying the project path and filters
 * @param res - JSON response target
 * @returns true once this route has answered; false means the URL belongs to another handler
 */
async function handleQualityHistoryRequest(
  ctx: DashboardRouteContext,
  url: URL,
  res: ServerResponse,
): Promise<boolean> {
  // Only saved-review history requests belong here; prompt requests continue to their own handler.
  if (url.pathname !== "/api/quality/history") return false;

  const filters = readQualityHistoryFilters(ctx, url, res);
  // Invalid history choices already produced an error, so no saved reviews should be read.
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
    // No saved run matching these choices leaves the latest-summary panel without a comparison baseline.
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
    // A project deleted since selection cannot supply history; return an error so unavailable history is not mistaken for no saved runs.
    ctx.jsonResponse(res, ctx.responseStatusForError(err, 500), {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return true;
}

/**
 * Bind prompt composition and saved-review history to this dashboard server's path validator, audit cache, and evidence recorder.
 *
 * @param ctx - per-server dashboard route context with path validation, the quality audit cache, and IO hooks
 * @returns handlers that answer matching prompt or history requests, or return false for the next route group
 */
export function createQualityRouteHandlers(ctx: DashboardRouteContext) {
  return {
    // Connect the Quality view's prompt request to this server's cached audit and selected project.
    handleQualityRequest: (url: URL, res: ServerResponse) =>
      handleQualityRequest(ctx, url, res),
    // Connect saved-review history requests to this server's validated project paths.
    handleQualityHistoryRequest: (url: URL, res: ServerResponse) =>
      handleQualityHistoryRequest(ctx, url, res),
  };
}
