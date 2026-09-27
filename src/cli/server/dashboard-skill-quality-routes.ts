/**
 * Supply installed-artifact scores and evaluate the Markdown a user pastes or uploads in the Skills view.
 *
 * Inventory and artifact requests use the selected runner's skill tree; evaluation accepts single documents or uploaded bundles.
 * Validation and scoring failures become JSON errors, and oversized request bodies receive a 413 response.
 *
 * The deprecated /api/quality/analyse route shares evaluation behavior and marks responses with deprecation headers.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  loadQualityConfig,
  type ArtifactSource,
} from "../quality/quality-config.js";
import {
  discoverArtifacts,
  evaluateContent,
  evaluateUploadedBundle,
  findArtifact,
  scoreArtifact,
} from "../quality/skill-quality.js";
import { composeArtifactQualityPrompt } from "../prompt/compose-quality.js";
import type { AgentId } from "../types.js";
import {
  AGENT_PROFILE_MAP,
  KNOWN_AGENT_LIST,
  QUALITY_EVALUATE_MAX_BODY_BYTES,
  VALID_AGENTS,
  type DashboardRouteContext,
} from "./dashboard-route-types.js";
import { decodeEvaluateBody, type EvaluateBody } from "./decoders.js";

/**
 * Insist on a known agent before any skill discovery runs, since the answer depends entirely on which runner the user picked.
 *
 * @param ctx - dashboard route context supplying the response helper
 * @param param - raw `agent` query value; missing or unknown values are answered with a 400 naming the valid ones
 * @param routeName - route named in that error so the user knows which request failed
 * @param res - response already answered when the value is rejected
 * @returns the accepted agent, or null once an error response has been sent and the caller should stop
 */
function parseRequiredAgentParam(
  ctx: DashboardRouteContext,
  param: string | null,
  routeName: string,
  res: ServerResponse,
): AgentId | null {
  // Without a valid runner the inventory would be a guess, so the user is told which values work.
  if (!param || !VALID_AGENTS.has(param)) {
    ctx.jsonResponse(res, 400, {
      error: `${routeName} requires agent. Valid: ${KNOWN_AGENT_LIST}`,
    });
    return null;
  }
  return param as AgentId;
}

// Map mirrored skill directories to the source label shown in quality reports.
function skillSourceForDir(dir: string): ArtifactSource {
  // Shared agent skill copies need the agent-mirror label so reports distinguish them from other installed sources.
  if (dir === ".agents/skills") return "agent-mirror";
  // Copilot's installed skill copies carry their GitHub mirror source in the report.
  if (dir === ".github/skills") return "github-mirror";
  return "installed";
}

// Narrow skill-quality discovery to the selected runner's installed skill tree.
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
 * List the skills and references installed for one runner, which is what fills the Skills tab.
 * It reports a missing agent or an unreadable project as a JSON status body rather than throwing at the server.
 *
 * @param ctx - dashboard route context supplying path validation and response helpers
 * @param url - request URL carrying the project path and agent
 * @param res - JSON response target
 * @returns true once this route has answered; false means the URL belongs to another handler
 */
function handleSkillQualityInventoryRequest(
  ctx: DashboardRouteContext,
  url: URL,
  res: ServerResponse,
): boolean {
  // Individual scores and pasted evaluations have separate request handlers.
  if (url.pathname !== "/api/skill-quality/inventory") return false;

  const agent = parseRequiredAgentParam(
    ctx,
    url.searchParams.get("agent"),
    "skill-quality inventory",
    res,
  );
  // The runner check has already explained the invalid selection, so no inventory is discovered.
  if (!agent) return true;
  try {
    const projectPath = ctx.validatedPath(
      url.searchParams.get("path"),
      "project-read",
    );
    const artifacts = discoverArtifacts(
      projectPath,
      runnerSkillQualityConfig(projectPath, agent),
    );
    ctx.jsonResponse(res, 200, { artifacts });
  } catch (err) {
    // A project removed after selection cannot supply installed skills; the Skills view receives an error instead of an empty inventory.
    ctx.jsonResponse(res, ctx.responseStatusForError(err, 500), {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return true;
}

/**
 * Score the artifact selected in the Skills view and return its improvement prompt without refreshing the whole inventory.
 *
 * Reports missing artifacts and validation failures as JSON.
 */
function handleSkillQualityRequest(
  ctx: DashboardRouteContext,
  url: URL,
  res: ServerResponse,
): boolean {
  // Inventory loading and evaluation uploads must continue to their dedicated routes.
  if (url.pathname !== "/api/skill-quality") return false;

  const agent = parseRequiredAgentParam(
    ctx,
    url.searchParams.get("agent"),
    "skill-quality",
    res,
  );
  // A rejected runner selection already has an error response, so no artifact is scored.
  if (!agent) return true;
  const artifactId = url.searchParams.get("artifact");

  // Without an artifact selection, the Skills view has not identified the document whose details should open.
  if (!artifactId) {
    ctx.jsonResponse(res, 400, {
      error: "skill-quality requires ?artifact=<id>",
    });
    return true;
  }

  try {
    const projectPath = ctx.validatedPath(
      url.searchParams.get("path"),
      "project-read",
    );
    const config = runnerSkillQualityConfig(projectPath, agent);
    const artifact = findArtifact(projectPath, artifactId, config);
    // A skill removed since inventory loading no longer has a detail report; tell the view that its selection is missing.
    if (!artifact) {
      ctx.jsonResponse(res, 404, {
        error: `artifact not found: ${artifactId}`,
      });
      return true;
    }
    const report = scoreArtifact(projectPath, artifact, config);
    const prompt = composeArtifactQualityPrompt(report);
    ctx.jsonResponse(res, 200, { ...report, prompt });
  } catch (err) {
    // A selected project deleted before scoring fails validation; the detail request receives the reason its report is unavailable.
    ctx.jsonResponse(res, ctx.responseStatusForError(err, 500), {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return true;
}

// Writes deprecation headers on every response served via the `/analyse` alias.
function markEvaluateAliasDeprecation(res: ServerResponse): void {
  res.setHeader("Deprecation", "true");
  res.setHeader("Link", '</api/quality/evaluate>; rel="successor-version"');
}

/**
 * Answer a failed evaluate request, keeping the deprecation header on the old alias so callers still see they should move off it.
 *
 * @param ctx - dashboard route context supplying the response helper
 * @param res - JSON response target
 * @param isAlias - true when the request came in on the deprecated alias path
 * @param status - HTTP status to send
 * @param payload - error body shown to the user
 */
function sendEvaluateError(
  ctx: DashboardRouteContext,
  res: ServerResponse,
  isAlias: boolean,
  status: number,
  payload: Record<string, unknown>,
): void {
  // Older callers must receive the migration hint even when their evaluation request fails.
  if (isAlias) markEvaluateAliasDeprecation(res);
  ctx.jsonResponse(res, status, payload);
}

/**
 * Read the pasted or uploaded markdown, refusing anything past the size cap before it reaches the scorer.
 * It reports an oversized body as a 413 rather than throwing, so the modal can tell the user their upload was too big.
 *
 * @param ctx - dashboard route context supplying the body reader
 * @param req - incoming POST request carrying the content
 * @param res - response already answered when the body is refused
 * @param isAlias - true when the request came in on the deprecated alias path
 * @returns the body text, or null once an error response has been sent and the caller should stop
 */
async function readEvaluateRequestBody(
  ctx: DashboardRouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  isAlias: boolean,
): Promise<string | null> {
  try {
    return await ctx.readBody(req, {
      maxBytes: QUALITY_EVALUATE_MAX_BODY_BYTES,
      tooLargeMessage: "Evaluate body too large",
    });
  } catch (err) {
    // An upload exceeding the body limit is rejected before scoring; the Evaluate modal receives the size error.
    sendEvaluateError(ctx, res, isAlias, 413, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Score a decoded evaluate request against the project, routing a multi-file upload to the bundle scorer and a single payload to the content scorer.
 * Treats a missing `content` field as an empty string so the content path always has a value to score.
 */
function evaluateRequestBody(projectPath: string, body: EvaluateBody) {
  // Uploaded companion files must be evaluated together so the report can account for the composed artifact.
  if (body.files) {
    return evaluateUploadedBundle(projectPath, {
      files: body.files,
      suggestedName: body.suggestedName,
      kind: body.kind,
    });
  }
  return evaluateContent(projectPath, {
    // With no upload bundle, absent content becomes an empty document for the content scorer.
    content: body.content ?? "",
    suggestedName: body.suggestedName,
    kind: body.kind,
  });
}

/**
 * Score the markdown a user pasted or dropped into the Evaluate modal and return its tips.
 * It reports a wrong method, an oversized body, or a scoring failure as a JSON status body rather than throwing at the server.
 *
 * @param ctx - dashboard route context supplying path validation and response helpers
 * @param req - incoming POST request carrying the content
 * @param url - request URL, which also selects the deprecated alias behaviour
 * @param res - JSON response target
 * @returns true once this route has answered; false means the URL belongs to another handler
 */
async function handleQualityEvaluateRequest(
  ctx: DashboardRouteContext,
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
): Promise<boolean> {
  const isAlias = url.pathname === "/api/quality/analyse";
  // Current and legacy evaluation URLs share scoring; other Quality requests belong to separate handlers.
  if (url.pathname !== "/api/quality/evaluate" && !isAlias) return false;
  // Evaluation requires submitted Markdown; simply opening the endpoint does not request a score.
  if (req.method !== "POST") {
    sendEvaluateError(ctx, res, isAlias, 405, { error: "Method not allowed" });
    return true;
  }
  const body = await readEvaluateRequestBody(ctx, req, res, isAlias);
  // The body reader already returned the upload failure, so scoring must not start.
  if (body === null) return true;
  const decoded = decodeEvaluateBody(body);
  // Invalid content or file fields must be corrected before the user's Markdown reaches the scorer.
  if (!decoded.ok) {
    sendEvaluateError(ctx, res, isAlias, 400, {
      error: decoded.error,
      path: decoded.path,
    });
    return true;
  }
  try {
    const projectPath = ctx.validatedPath(
      url.searchParams.get("path"),
      "project-read",
    );
    const result = evaluateRequestBody(projectPath, decoded.value);
    // Successful evaluations also tell legacy callers which endpoint replaces this alias.
    if (isAlias) markEvaluateAliasDeprecation(res);
    ctx.jsonResponse(res, 200, result);
  } catch (err) {
    // A project removed while the modal was open cannot provide scoring settings; return the error while preserving legacy-route headers.
    sendEvaluateError(ctx, res, isAlias, ctx.responseStatusForError(err, 500), {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return true;
}

/**
 * Bind installed-skill reports and pasted or uploaded evaluations to this dashboard server's path validator and request-body reader.
 *
 * @param ctx - per-server dashboard route context with path validation, the body reader, and IO hooks
 * @returns handlers that answer matching skill or evaluation requests, or return false for the next route group
 */
export function createSkillQualityRouteHandlers(ctx: DashboardRouteContext) {
  return {
    // Connect the selected artifact's report request to this server's validated project paths.
    handleSkillQualityRequest: (url: URL, res: ServerResponse) =>
      handleSkillQualityRequest(ctx, url, res),
    // Connect Skills inventory loading to the runner and project selected in the request.
    handleSkillQualityInventoryRequest: (url: URL, res: ServerResponse) =>
      handleSkillQualityInventoryRequest(ctx, url, res),
    // Connect pasted and uploaded Markdown requests to the shared evaluation and error-response flow.
    handleQualityEvaluateRequest: (
      req: IncomingMessage,
      url: URL,
      res: ServerResponse,
    ) => handleQualityEvaluateRequest(ctx, req, url, res),
  };
}
