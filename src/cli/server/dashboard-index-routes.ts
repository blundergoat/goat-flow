/**
 * The dashboard endpoints that regenerate a project's learning-loop indexes and report how stale they currently are.
 *
 * A user hits these from the Home memory card, after it warns that their footgun or lesson indexes no longer match the bucket files.
 * Indexes are generated rather than hand-edited, so this is the supported way for a user to make retrieval trustworthy again.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig } from "../config/reader.js";
import { createFS } from "../facts/fs.js";
import { generateIndexes } from "../learning-loop-index/generate.js";
import { resolveIndexBucketPaths } from "../learning-loop-index/parse-bucket.js";
import { collectIndexFreshness } from "../stats/index-freshness.js";
import type { DashboardRouteContext } from "./dashboard-route-types.js";

/**
 * Regenerate all existing learning-loop bucket indexes for the caller-selected project.
 * It reports every failure, from a bad request body to an unwritable project, as a JSON error rather than letting it take the server down.
 *
 * @param ctx - dashboard route context with path validation and response helpers
 * @param req - incoming POST request carrying `{ path }`
 * @param res - JSON response target
 */
async function regenerateLearningLoopIndexes(
  ctx: DashboardRouteContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const { decodeProjectPathBody } = await import("./decoders.js");
    const decoded = decodeProjectPathBody(await ctx.readBody(req));
    // The request body did not carry a usable project path, so the user is told which field to fix.
    if (!decoded.ok) {
      ctx.jsonResponse(res, 400, {
        error: decoded.error,
        path: decoded.path,
      });
      return;
    }

    const projectPath = ctx.validatedPath(
      decoded.value.path,
      "write-local-state",
    );
    const fs = createFS(projectPath);
    const configState = loadConfig(projectPath, fs);
    const bucketPaths = resolveIndexBucketPaths(configState.config);
    const results = generateIndexes(projectPath, fs, bucketPaths);
    const indexes = collectIndexFreshness(createFS(projectPath), bucketPaths);
    ctx.recordDashboardEvent(projectPath, "index.regenerate", {
      bucket_count: results.filter((result) => result.entryCount !== null)
        .length,
    });
    ctx.jsonResponse(res, 200, { results, indexes });
  } catch (err) {
    // A read-only .goat-flow directory prevents index replacement; Home receives the failure instead of a regeneration success.
    ctx.jsonResponse(res, ctx.responseStatusForError(err, 500), {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Bind the Home memory card's index-regeneration request to the selected project's validated write path.
 * Route and method checks report unsupported requests before index generation can write files.
 *
 * @param ctx - per-server dashboard route context
 * @returns the index handler, which returns false for unrelated URLs and true after answering an index request
 */
export function createIndexRouteHandlers(ctx: DashboardRouteContext) {
  return {
    // Regenerate learning-loop indexes only when the caller submits the Home card's maintenance request.
    handleIndexRegenerateRequest: async (
      req: IncomingMessage,
      url: URL,
      res: ServerResponse,
    ): Promise<boolean> => {
      // Other maintenance requests remain available to the next dashboard route group.
      if (url.pathname !== "/api/index/regenerate") return false;
      // Merely opening this endpoint must not rewrite the selected project's indexes.
      if (req.method !== "POST") {
        ctx.jsonResponse(res, 405, { error: "Method not allowed" });
        return true;
      }
      await regenerateLearningLoopIndexes(ctx, req, res);
      return true;
    },
  };
}
