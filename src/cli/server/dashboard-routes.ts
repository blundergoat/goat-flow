/**
 * Aggregator for the dashboard's non-terminal HTTP route handlers.
 *
 * Builds the shared route context once and merges the handler bags from each route group (shell,
 * audit, quality, skill-quality, projects) into one flat object the server matches requests against.
 * This is the single entry point the HTTP server imports for non-terminal routes; terminal/WebSocket
 * routing lives elsewhere. Also re-exports normalizeAgentVersionOutput for the server's agent probes.
 */
import { createAuditRouteHandlers } from "./dashboard-audit-routes.js";
import { createIndexRouteHandlers } from "./dashboard-index-routes.js";
import { createDashboardRouteContext } from "./dashboard-route-context.js";
import type { DashboardRouteDependencies } from "./dashboard-route-types.js";
import { normalizeAgentVersionOutput } from "./dashboard-route-types.js";
import { createProjectRouteHandlers } from "./dashboard-project-routes.js";
import { createQualityRouteHandlers } from "./dashboard-quality-routes.js";
import { createShellRouteHandlers } from "./dashboard-shell-routes.js";
import { createSkillQualityRouteHandlers } from "./dashboard-skill-quality-routes.js";

export { normalizeAgentVersionOutput };

/**
 * Build the non-terminal dashboard route handlers for one server instance.
 *
 * @param deps - Server-owned dependencies and IO hooks shared by the route handlers.
 */
export function createDashboardRouteHandlers(deps: DashboardRouteDependencies) {
  const ctx = createDashboardRouteContext(deps);
  return {
    ...createShellRouteHandlers(ctx),
    ...createAuditRouteHandlers(ctx),
    ...createQualityRouteHandlers(ctx),
    ...createSkillQualityRouteHandlers(ctx),
    ...createProjectRouteHandlers(ctx),
    ...createIndexRouteHandlers(ctx),
  };
}
