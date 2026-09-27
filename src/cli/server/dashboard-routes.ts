/**
 * Collect the dashboard's non-terminal HTTP handlers for one server instance.
 *
 * One shared context connects page loading, audits, setup, quality, Skills, Projects, Tasks, and index maintenance to the same server settings.
 * The HTTP server tries these handlers to answer dashboard requests; terminal and WebSocket routing remain separate.
 *
 * Also re-export normalizeAgentVersionOutput for the server's runner probes.
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
