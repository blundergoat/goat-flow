/**
 * Dashboard routes for maintaining generated learning-loop indexes in the selected target project.
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
    ctx.jsonResponse(res, ctx.responseStatusForError(err, 500), {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Bind index-maintenance handlers to one dashboard route context. This factory owns route matching
 * because the aggregator probes every handler for every request; non-index paths must return false
 * and method rejection must happen here before any write-side handler runs.
 *
 * @param ctx - per-server dashboard route context
 * @returns route handler bag consumed by the dashboard route aggregator
 */
export function createIndexRouteHandlers(ctx: DashboardRouteContext) {
  return {
    handleIndexRegenerateRequest: async (
      req: IncomingMessage,
      url: URL,
      res: ServerResponse,
    ): Promise<boolean> => {
      if (url.pathname !== "/api/index/regenerate") return false;
      if (req.method !== "POST") {
        ctx.jsonResponse(res, 405, { error: "Method not allowed" });
        return true;
      }
      await regenerateLearningLoopIndexes(ctx, req, res);
      return true;
    },
  };
}
