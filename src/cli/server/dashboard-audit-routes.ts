/**
 * Audit, setup-detect, and setup-prompt HTTP route handlers for the dashboard server.
 *
 * Backs `/api/audit` (the shared DashboardReport for Home/Setup/Quality), `/api/setup/detect`,
 * and `/api/setup`. Aggregate `/api/audit` requests fold a persisted disk cache and a per-request
 * profiler over `runAuditBatch`; explicit per-agent requests skip the cache. Handlers return their
 * outcome as JSON and never throw to the server, so a failed audit becomes an error body rather than
 * a crashed request. Route wiring lives in dashboard-routes.ts; report assembly in dashboard-reporting.ts.
 */
import type { ServerResponse } from "node:http";
import { isPackagedInstall } from "../paths.js";
import { runAudit, runAuditBatch } from "../audit/audit.js";
import type { AuditReport } from "../audit/types.js";
import { loadConfig } from "../config/reader.js";
import { recordEvidenceEvent } from "../evidence/envelope.js";
import { redactEvidenceText } from "../evidence/redaction.js";
import { createFS } from "../facts/fs.js";
import { extractProjectFacts } from "../facts/orchestrator.js";
import type { AgentId } from "../types.js";
import {
  KNOWN_AGENT_IDS,
  KNOWN_AGENT_LIST,
  VALID_AGENTS,
  type DashboardAuditProfiler,
  type DashboardRouteContext,
} from "./dashboard-route-types.js";
import {
  appendAuditProfile,
  buildAuditCacheSignature,
  buildDashboardReport,
  createDashboardAuditProfiler,
  enrichDashboardReport,
  readAuditCache,
  shouldProfileAuditRequest,
  writeAuditCache,
} from "./dashboard-reporting.js";
import { buildSetupDetectPayload } from "./setup-detect.js";
import type { DashboardReport } from "./types.js";

/** Route handlers exported by the dashboard audit/setup route group. */
interface AuditRouteHandlers {
  handleAuditRequest: (url: URL, res: ServerResponse) => boolean;
  handleSetupDetectRequest: (url: URL, res: ServerResponse) => boolean;
  handleSetupRequest: (url: URL, res: ServerResponse) => Promise<boolean>;
}

function isCacheEligible(
  agentFilter: AgentId | null,
  includeHarness: boolean,
): boolean {
  return !agentFilter && includeHarness && isPackagedInstall();
}

/** Resolve the managed agent list for dashboard aggregate audits. */
function resolveDashboardManagedAgentIds(
  agentFilter: AgentId | null,
): AgentId[] {
  return agentFilter === null ? [...KNOWN_AGENT_IDS] : [agentFilter];
}

function buildDashboardAuditReport(
  projectPath: string,
  agentFilter: AgentId | null,
  includeHarness: boolean,
  profiler: DashboardAuditProfiler,
): DashboardReport {
  const fs = createFS(projectPath);
  const configAgents = profiler.span("managed-agent resolution", () =>
    resolveDashboardManagedAgentIds(agentFilter),
  );
  const auditFactProfile = agentFilter === null ? "dashboard-summary" : "full";
  const batch = profiler.span("runAuditBatch", () =>
    runAuditBatch(
      fs,
      projectPath,
      {
        agentFilter,
        harness: includeHarness,
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

/** Convert unknown exceptions to the JSON-safe error message used by dashboard routes. */
function routeErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Send a standard dashboard JSON error response for non-profiled routes. */
function jsonErrorResponse(
  ctx: DashboardRouteContext,
  res: ServerResponse,
  err: unknown,
): void {
  ctx.jsonResponse(res, ctx.responseStatusForError(err, 500), {
    error: routeErrorMessage(err),
  });
}

function readCachedDashboardAudit(
  ctx: DashboardRouteContext,
  projectPath: string,
  fresh: boolean,
  signature: string | null,
  profiler: DashboardAuditProfiler,
) {
  if (fresh || signature === null) return null;
  return profiler.span("cache read", () =>
    readAuditCache(projectPath, ctx.packageVersion, signature),
  );
}

/** Record the dashboard audit event after either cache hit or fresh audit run. */
function recordAuditRunEvent(
  ctx: DashboardRouteContext,
  projectPath: string,
  includeHarness: boolean,
  agentFilter: AgentId | null,
  report: DashboardReport,
  cached: boolean,
): void {
  ctx.recordDashboardEvent(projectPath, "audit.run", {
    cached,
    harness: includeHarness,
    agent: agentFilter ?? "all",
    status: report.status,
  });
}

/** Send an audit report response with cache fields and optional profiling metadata. */
function sendAuditReport(
  ctx: DashboardRouteContext,
  res: ServerResponse,
  report: DashboardReport,
  profiler: DashboardAuditProfiler,
  cacheState: { cached: boolean; cachedAt: string | null },
): void {
  ctx.jsonResponse(
    res,
    200,
    appendAuditProfile(
      {
        ...report,
        cached: cacheState.cached,
        cachedAt: cacheState.cachedAt,
      },
      profiler,
    ),
  );
}

/** Send a profiled audit error response so the dashboard can still render spans. */
function sendAuditError(
  ctx: DashboardRouteContext,
  res: ServerResponse,
  err: unknown,
  profiler: DashboardAuditProfiler,
): void {
  ctx.jsonResponse(
    res,
    ctx.responseStatusForError(err, 500),
    appendAuditProfile({ error: routeErrorMessage(err) }, profiler),
  );
}

/** Read, enrich, record, and return a cached audit response when the cache matches. */
function respondWithCachedAudit(
  ctx: DashboardRouteContext,
  res: ServerResponse,
  cached: { report: DashboardReport; cachedAt: string },
  projectPath: string,
  includeHarness: boolean,
  agentFilter: AgentId | null,
  profiler: DashboardAuditProfiler,
): void {
  const report = profiler.span("learning-loop enrichment", () =>
    enrichDashboardReport(cached.report, projectPath),
  );
  recordAuditRunEvent(
    ctx,
    projectPath,
    includeHarness,
    agentFilter,
    report,
    true,
  );
  sendAuditReport(ctx, res, report, profiler, {
    cached: true,
    cachedAt: cached.cachedAt,
  });
}

/** Write the fresh audit result to the dashboard cache when the request is eligible. */
function writeFreshAuditCache(
  ctx: DashboardRouteContext,
  projectPath: string,
  signature: string | null,
  report: DashboardReport,
  profiler: DashboardAuditProfiler,
): void {
  if (signature === null) return;
  profiler.span("cache write", () => {
    writeAuditCache(projectPath, ctx.packageVersion, signature, report);
  });
}

/** Parse optional agent filters without rejecting dashboard-wide requests. */
function parseAgentFilter(param: string | null): AgentId | null {
  return param && VALID_AGENTS.has(param) ? (param as AgentId) : null;
}

function recordSetupPrompt(
  projectPath: string,
  agent: AgentId,
  renderedOutput: string,
): void {
  recordEvidenceEvent({
    producer: "dashboard-session-trace",
    actor: "server",
    eventType: "setup.prompt",
    projectRoot: projectPath,
    payload: {
      agent,
      output: redactEvidenceText("setup prompt", renderedOutput),
    },
  });
}

/** Build the `/api/audit` handler bound to one dashboard route context. */
function createHandleAuditRequest(
  ctx: DashboardRouteContext,
): AuditRouteHandlers["handleAuditRequest"] {
  return function handleAuditRequest(url: URL, res: ServerResponse): boolean {
    if (url.pathname !== "/api/audit") return false;

    const includeHarness = url.searchParams.get("quality") === "true";
    const agentFilter = parseAgentFilter(url.searchParams.get("agent"));
    const fresh = url.searchParams.get("fresh") === "true";
    const profiler = createDashboardAuditProfiler(
      shouldProfileAuditRequest(url, ctx.devMode),
    );

    try {
      const projectPath = ctx.validatedPath(
        url.searchParams.get("path"),
        "project-read",
      );
      const auditCacheSignature = isCacheEligible(agentFilter, includeHarness)
        ? profiler.span("cache signature", () =>
            buildAuditCacheSignature(projectPath, ctx.packageVersion),
          )
        : null;

      const cached = readCachedDashboardAudit(
        ctx,
        projectPath,
        fresh,
        auditCacheSignature,
        profiler,
      );
      if (cached) {
        respondWithCachedAudit(
          ctx,
          res,
          cached,
          projectPath,
          includeHarness,
          agentFilter,
          profiler,
        );
        return true;
      }

      const report = buildDashboardAuditReport(
        projectPath,
        agentFilter,
        includeHarness,
        profiler,
      );
      writeFreshAuditCache(
        ctx,
        projectPath,
        auditCacheSignature,
        report,
        profiler,
      );
      recordAuditRunEvent(
        ctx,
        projectPath,
        includeHarness,
        agentFilter,
        report,
        false,
      );
      sendAuditReport(ctx, res, report, profiler, {
        cached: false,
        cachedAt: null,
      });
    } catch (err) {
      sendAuditError(ctx, res, err, profiler);
    }
    return true;
  };
}

/** Build the `/api/setup/detect` handler bound to one dashboard route context. */
function createHandleSetupDetectRequest(
  ctx: DashboardRouteContext,
): AuditRouteHandlers["handleSetupDetectRequest"] {
  return function handleSetupDetectRequest(
    url: URL,
    res: ServerResponse,
  ): boolean {
    if (url.pathname !== "/api/setup/detect") return false;

    try {
      const projectPath = ctx.validatedPath(
        url.searchParams.get("path"),
        "project-read",
      );
      ctx.jsonResponse(res, 200, buildSetupDetectPayload(projectPath));
    } catch (err) {
      jsonErrorResponse(ctx, res, err);
    }
    return true;
  };
}

/** Validate the setup agent parameter and send the route-owned 400 response when invalid. */
function validateSetupAgentParam(
  ctx: DashboardRouteContext,
  res: ServerResponse,
  agentParam: string | null,
): AgentId | null {
  if (!agentParam) {
    ctx.jsonResponse(res, 400, {
      error: `Missing required parameter: agent. Valid: ${KNOWN_AGENT_LIST}`,
    });
    return null;
  }
  if (!VALID_AGENTS.has(agentParam)) {
    ctx.jsonResponse(res, 400, {
      error: `Invalid agent: ${agentParam}. Valid: ${KNOWN_AGENT_LIST}`,
    });
    return null;
  }
  return agentParam as AgentId;
}

/** Compose the setup prompt output using dashboard-summary facts and static deny evidence. */
async function composeDashboardSetupOutput(
  projectPath: string,
  agent: AgentId,
): Promise<string> {
  const fs = createFS(projectPath);
  const configState = loadConfig(projectPath, fs);
  const facts = extractProjectFacts(fs, {
    agentFilter: agent,
    projectPath,
    configState,
    includeStack: false,
  });
  const auditReport: AuditReport = runAudit(fs, projectPath, {
    agentFilter: agent,
    harness: true,
    factProfile: "dashboard-summary",
    denyMechanismEvidenceLevel: "static",
  });
  const { composeSetup } = await import("../prompt/compose-setup.js");
  const output = composeSetup(auditReport, facts, agent, {
    denyMechanismEvidenceLevel: "static",
  });
  return output ?? "No setup output generated.";
}

/** Build the `/api/setup` handler bound to one dashboard route context. */
function createHandleSetupRequest(
  ctx: DashboardRouteContext,
): AuditRouteHandlers["handleSetupRequest"] {
  return async function handleSetupRequest(
    url: URL,
    res: ServerResponse,
  ): Promise<boolean> {
    if (url.pathname !== "/api/setup") return false;

    const agent = validateSetupAgentParam(
      ctx,
      res,
      url.searchParams.get("agent"),
    );
    if (agent === null) return true;

    try {
      const projectPath = ctx.validatedPath(
        url.searchParams.get("path"),
        "project-read",
      );
      const renderedOutput = await composeDashboardSetupOutput(
        projectPath,
        agent,
      );
      recordSetupPrompt(projectPath, agent, renderedOutput);
      ctx.jsonResponse(res, 200, {
        output: renderedOutput,
      });
    } catch (err) {
      jsonErrorResponse(ctx, res, err);
    }
    return true;
  };
}

/**
 * Bind the audit/setup route handlers to one server's request context so each closure can reach the
 * validated-path resolver, evidence recorder, and JSON responder without per-request wiring. The
 * closure shape is intentional because the context is resolved once per server, and binding it here
 * lets the handlers be registered as plain `(url, res)` callbacks. Each handler reports validation,
 * audit, and cache failures back to the client as a JSON error body instead of throwing, so a failed
 * request never crashes the server. The aggregate audit route also folds a disk cache over
 * `runAuditBatch` to avoid paying a full re-audit on every fresh Home load.
 *
 * @param ctx - per-server dashboard route context carrying path validation, the audit cache, and IO hooks
 * @returns the three audit/setup handlers; each returns true once it has owned and answered a matching
 *   request, or false to let the next handler try the URL
 */
export function createAuditRouteHandlers(
  ctx: DashboardRouteContext,
): AuditRouteHandlers {
  return {
    handleAuditRequest: createHandleAuditRequest(ctx),
    handleSetupDetectRequest: createHandleSetupDetectRequest(ctx),
    handleSetupRequest: createHandleSetupRequest(ctx),
  };
}
