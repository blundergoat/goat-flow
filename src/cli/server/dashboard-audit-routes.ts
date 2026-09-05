/**
 * Supply the audit results, setup detection, and setup prompts shown for the selected project.
 *
 * Home, Setup, and Quality share one audit report; aggregate packaged-install requests can reuse a matching disk cache.
 * Agent-specific requests run live, and route handlers report audit or path failures as JSON errors the dashboard can display.
 *
 * Route registration lives in dashboard-routes.ts; dashboard-reporting.ts owns report assembly and cache storage.
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

/**
 * Group the audit and setup requests used while inspecting a project's harness installation.
 *
 * A handler returns false when another route group should answer the URL.
 * Matching requests send their own JSON response; prompt composition is asynchronous.
 */
interface AuditRouteHandlers {
  handleAuditRequest: (url: URL, res: ServerResponse) => boolean;
  handleSetupDetectRequest: (url: URL, res: ServerResponse) => boolean;
  handleSetupRequest: (url: URL, res: ServerResponse) => Promise<boolean>;
}

/**
 * Decide whether this request may be answered from the persisted audit cache, which is what makes the Home view open instantly.
 *
 * @param agentFilter - selected agent, or null for all agents; a named agent is answered live because the cache holds the aggregate view
 * @param includeHarness - true when the user asked for harness scores as well
 * @returns true when a cached report would answer this exact request
 */
function isCacheEligible(
  agentFilter: AgentId | null,
  includeHarness: boolean,
): boolean {
  return !agentFilter && includeHarness && isPackagedInstall();
}

// Audit all supported agents when no runner is selected; a runner-specific request checks only that agent.
function resolveDashboardManagedAgentIds(
  agentFilter: AgentId | null,
): AgentId[] {
  // Home needs every managed runner represented even when the user has not installed all of them.
  return agentFilter === null ? [...KNOWN_AGENT_IDS] : [agentFilter];
}

/**
 * Run the audit behind every dashboard view and shape it into the one report Home, Setup, and Quality all read.
 *
 * @param projectPath - validated project the user selected
 * @param agentFilter - agent to narrow to; null audits every installed agent, which is what the Home view shows
 * @param includeHarness - true to score the harness concerns as well
 * @param profiler - per-request profiler that labels each stage for the dev timing panel
 * @returns the report the dashboard renders
 */
function buildDashboardAuditReport(
  projectPath: string,
  agentFilter: AgentId | null,
  includeHarness: boolean,
  profiler: DashboardAuditProfiler,
): DashboardReport {
  const fs = createFS(projectPath);
  const managedAgentIds = profiler.span("managed-agent resolution", () =>
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
        // Opening a project must not execute its hook commands; Home checks presence and agent details use static evidence.
        //
        // Runtime proof requires a deliberate CLI audit against a trusted checkout.
        // These passive dashboard reads therefore keep runtime evidence marked "limited".
        denyMechanismEvidenceLevel:
          agentFilter === null ? "present-only" : "static",
        factProfile: auditFactProfile,
        profile: profiler,
      },
      managedAgentIds,
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

// Convert unknown exceptions to the JSON-safe error message used by dashboard routes.
function routeErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Send a standard dashboard JSON error response for non-profiled routes.
function jsonErrorResponse(
  ctx: DashboardRouteContext,
  res: ServerResponse,
  err: unknown,
): void {
  ctx.jsonResponse(res, ctx.responseStatusForError(err, 500), {
    error: routeErrorMessage(err),
  });
}

/**
 * Look for a saved audit that still matches this project, so a user reopening the dashboard does not wait for a full rerun.
 *
 * @param ctx - dashboard route context supplying cache access
 * @param projectPath - validated project the user selected
 * @param isFresh - true when the user pressed Re-audit and asked for live results
 * @param signature - fingerprint of the project state; null means the cache cannot be trusted for this request
 * @param profiler - timing collector for the dashboard's optional audit profile
 * @returns the cached report, or null when nothing usable was stored and the audit has to run
 */
function readCachedDashboardAudit(
  ctx: DashboardRouteContext,
  projectPath: string,
  isFresh: boolean,
  signature: string | null,
  profiler: DashboardAuditProfiler,
) {
  // Re-audit requests and unverified project signatures need current results instead of a saved Home report.
  if (isFresh || signature === null) return null;
  return profiler.span("cache read", () =>
    readAuditCache(projectPath, ctx.packageVersion, signature),
  );
}

// Record the dashboard audit event after either cache hit or fresh audit run.
function recordAuditRunEvent(
  ctx: DashboardRouteContext,
  projectPath: string,
  includeHarness: boolean,
  agentFilter: AgentId | null,
  report: DashboardReport,
  isCached: boolean,
): void {
  ctx.recordDashboardEvent(projectPath, "audit.run", {
    isCached,
    harness: includeHarness,
    // An unfiltered Home audit is recorded as covering all agents.
    agent: agentFilter ?? "all",
    status: report.status,
  });
}

// Send the audit with cache and timing details; a null cachedAt tells the dashboard these results came from the current request.
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

// Send a profiled audit error response so the dashboard can still render spans.
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

// Read, enrich, record, and return a cached audit response when the cache matches.
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

// Write the fresh audit result to the dashboard cache when the request is eligible.
function writeFreshAuditCache(
  ctx: DashboardRouteContext,
  projectPath: string,
  signature: string | null,
  report: DashboardReport,
  profiler: DashboardAuditProfiler,
): void {
  // Without a trusted project signature, saving this result could make a later Home visit reuse unrelated evidence.
  if (signature === null) return;
  profiler.span("cache write", () => {
    writeAuditCache(projectPath, ctx.packageVersion, signature, report);
  });
}

// Treat an absent, empty, or unknown agent filter as an aggregate dashboard audit.
function parseAgentFilter(param: string | null): AgentId | null {
  // Only a recognized runner narrows the audit; other query values retain the dashboard-wide view.
  return param && VALID_AGENTS.has(param) ? (param as AgentId) : null;
}

/**
 * Note that a setup prompt was handed out, so the project timeline shows when the user last asked for one.
 *
 * @param projectPath - validated project the user selected
 * @param agent - agent the prompt was composed for
 * @param renderedOutput - the prompt text, measured for the event rather than stored in full
 */
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

/**
 * Build the `/api/audit` handler bound to one dashboard route context.
 * The handler reports a failed audit as a JSON error body, because a crashed request would leave the user staring at an empty dashboard.
 *
 * @param ctx - dashboard route context supplying path validation, caching, and response helpers
 * @returns the request handler, which returns false for any URL it does not own
 */
function createHandleAuditRequest(
  ctx: DashboardRouteContext,
): AuditRouteHandlers["handleAuditRequest"] {
  // Answer a matching dashboard audit request and report failures with any collected timing spans.
  return function handleAuditRequest(url: URL, res: ServerResponse): boolean {
    // Leave non-audit requests for the remaining dashboard route groups.
    if (url.pathname !== "/api/audit") return false;

    const includeHarness = url.searchParams.get("quality") === "true";
    const agentFilter = parseAgentFilter(url.searchParams.get("agent"));
    const fresh = url.searchParams.get("fresh") === "true";
    const profiler = createDashboardAuditProfiler(
      shouldProfileAuditRequest(url, ctx.isDevMode),
    );

    try {
      const projectPath = ctx.validatedPath(
        url.searchParams.get("path"),
        "project-read",
      );
      // Only supported aggregate requests can trust the disk cache; a null signature keeps this audit live.
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
      // A matching saved report lets the Home view reuse the audit while refreshing learning-loop details.
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
      // A selected folder removed since page load fails path validation; the dashboard receives the error with its audit timings.
      sendAuditError(ctx, res, err, profiler);
    }
    return true;
  };
}

/**
 * Build the `/api/setup/detect` handler bound to one dashboard route context.
 * The handler reports an unreadable project as a JSON error body rather than throwing, so the Setup view can explain what went wrong.
 *
 * @param ctx - dashboard route context supplying path validation and response helpers
 * @returns the request handler, which returns false for any URL it does not own
 */
function createHandleSetupDetectRequest(
  ctx: DashboardRouteContext,
): AuditRouteHandlers["handleSetupDetectRequest"] {
  // Answer the Setup view's installation check for the selected project.
  return function handleSetupDetectRequest(
    url: URL,
    res: ServerResponse,
  ): boolean {
    // Setup detection must not consume a request intended for prompt generation or another view.
    if (url.pathname !== "/api/setup/detect") return false;

    try {
      const projectPath = ctx.validatedPath(
        url.searchParams.get("path"),
        "project-read",
      );
      ctx.jsonResponse(res, 200, buildSetupDetectPayload(projectPath));
    } catch (err) {
      // A project removed or renamed after selection produces a JSON error for the Setup view.
      jsonErrorResponse(ctx, res, err);
    }
    return true;
  };
}

// Return the runner selected for setup, or null after sending a 400 that explains the missing or invalid selection.
function validateSetupAgentParam(
  ctx: DashboardRouteContext,
  res: ServerResponse,
  agentParam: string | null,
): AgentId | null {
  // A setup prompt needs a selected runner; an absent or empty selection returns the available choices.
  if (!agentParam) {
    ctx.jsonResponse(res, 400, {
      error: `Missing required parameter: agent. Valid: ${KNOWN_AGENT_LIST}`,
    });
    return null;
  }
  // Reject an unknown runner before composing instructions for an installation the server does not support.
  if (!VALID_AGENTS.has(agentParam)) {
    ctx.jsonResponse(res, 400, {
      error: `Invalid agent: ${agentParam}. Valid: ${KNOWN_AGENT_LIST}`,
    });
    return null;
  }
  return agentParam as AgentId;
}

// Compose the setup prompt output using dashboard-summary facts and static deny evidence.
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
  // When composition has no prompt to offer, the Setup view receives an explicit message instead of an absent output.
  return output ?? "No setup output generated.";
}

/**
 * Build the `/api/setup` handler bound to one dashboard route context.
 * The handler reports a rejected agent or a failed compose as a JSON error body, so the user sees why no prompt appeared.
 *
 * @param ctx - dashboard route context supplying path validation and response helpers
 * @returns the request handler, which returns false for any URL it does not own
 */
function createHandleSetupRequest(
  ctx: DashboardRouteContext,
): AuditRouteHandlers["handleSetupRequest"] {
  // Return the setup prompt for a matching request after the user chooses a supported runner.
  return async function handleSetupRequest(
    url: URL,
    res: ServerResponse,
  ): Promise<boolean> {
    // Other Setup requests, including detection, belong to their own handlers.
    if (url.pathname !== "/api/setup") return false;

    const agent = validateSetupAgentParam(
      ctx,
      res,
      url.searchParams.get("agent"),
    );
    // The runner check already explained why no prompt can be composed, so this response is complete.
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
      // A folder deleted after selection cannot supply setup facts; the response explains why the prompt could not be generated.
      jsonErrorResponse(ctx, res, err);
    }
    return true;
  };
}

/**
 * Bind the audit and setup requests to one dashboard server's path validation, cache, and response helpers.
 * Each handler reports request failures as JSON; matching aggregate audits can reuse a saved report to shorten Home loading.
 *
 * @param ctx - per-server dashboard route context carrying path validation, the audit cache, and IO hooks
 * @returns three handlers that return true after answering their URL, or false so another route group can answer
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
