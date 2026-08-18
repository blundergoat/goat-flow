/**
 * Skill/reference artifact quality HTTP route handlers for the dashboard server.
 *
 * Backs `/api/skill-quality/inventory` (list a runner's installed skill and reference artifacts), `/api/skill-quality` (score one artifact and
 * compose its tip prompt), and `/api/quality/evaluate` plus its deprecated `/api/quality/analyse` alias (score uploaded or pasted markdown).
 * Discovery is narrowed to the selected runner's skill tree.
 *
 * Oversized uploads are rejected as 413 and all validation/scoring failures are reported as JSON; alias responses also carry Deprecation headers.
 *
 * Scoring engine lives in quality/skill-quality.ts; body decoding in decoders.ts.
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

/** Map mirrored skill directories to the source label shown in quality reports. */
function skillSourceForDir(dir: string): ArtifactSource {
  if (dir === ".agents/skills") return "agent-mirror";
  if (dir === ".github/skills") return "github-mirror";
  return "installed";
}

/** Narrow skill-quality discovery to the selected runner's installed skill tree. */
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
  if (url.pathname !== "/api/skill-quality/inventory") return false;

  const agent = parseRequiredAgentParam(
    ctx,
    url.searchParams.get("agent"),
    "skill-quality inventory",
    res,
  );
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
    ctx.jsonResponse(res, ctx.responseStatusForError(err, 500), {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return true;
}

/**
 * Score one skill/reference artifact because the dashboard needs artifact-level
 * feedback without running the full project inventory again.
 *
 * Reports missing artifacts and validation failures as JSON.
 */
function handleSkillQualityRequest(
  ctx: DashboardRouteContext,
  url: URL,
  res: ServerResponse,
): boolean {
  if (url.pathname !== "/api/skill-quality") return false;

  const agent = parseRequiredAgentParam(
    ctx,
    url.searchParams.get("agent"),
    "skill-quality",
    res,
  );
  if (!agent) return true;
  const artifactId = url.searchParams.get("artifact");

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
    ctx.jsonResponse(res, ctx.responseStatusForError(err, 500), {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return true;
}

/** Writes deprecation headers on every response served via the `/analyse` alias. */
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
function evaluateRequestBody(projectPath: string, value: EvaluateBody) {
  if (value.files) {
    return evaluateUploadedBundle(projectPath, {
      files: value.files,
      suggestedName: value.suggestedName,
      kind: value.kind,
    });
  }
  return evaluateContent(projectPath, {
    content: value.content ?? "",
    suggestedName: value.suggestedName,
    kind: value.kind,
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
  if (url.pathname !== "/api/quality/evaluate" && !isAlias) return false;
  if (req.method !== "POST") {
    sendEvaluateError(ctx, res, isAlias, 405, { error: "Method not allowed" });
    return true;
  }
  const body = await readEvaluateRequestBody(ctx, req, res, isAlias);
  if (body === null) return true;
  const decoded = decodeEvaluateBody(body);
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
    if (isAlias) markEvaluateAliasDeprecation(res);
    ctx.jsonResponse(res, 200, result);
  } catch (err) {
    sendEvaluateError(ctx, res, isAlias, ctx.responseStatusForError(err, 500), {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return true;
}

/**
 * Bind the skill-quality handlers to one server's request context so each closure shares the path
 * validator, JSON responder, and body reader.
 *
 * @param ctx - per-server dashboard route context with path validation, the body reader, and IO hooks
 * @returns the skill-quality, inventory, and evaluate handlers; each resolves true once it has
 *   answered a matching request, or false to let another handler claim the URL
 */
export function createSkillQualityRouteHandlers(ctx: DashboardRouteContext) {
  return {
    handleSkillQualityRequest: (url: URL, res: ServerResponse) =>
      handleSkillQualityRequest(ctx, url, res),
    handleSkillQualityInventoryRequest: (url: URL, res: ServerResponse) =>
      handleSkillQualityInventoryRequest(ctx, url, res),
    handleQualityEvaluateRequest: (
      req: IncomingMessage,
      url: URL,
      res: ServerResponse,
    ) => handleQualityEvaluateRequest(ctx, req, url, res),
  };
}
