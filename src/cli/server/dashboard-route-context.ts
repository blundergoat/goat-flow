/**
 * Create the shared settings and IO helpers used while dashboard requests read or update the selected project.
 *
 * State-file locations and the quality-audit cache are created once per server, so route groups share persistence and recent audit results.
 * Path validation, response-status mapping, and project event recording give those routes a consistent request boundary.
 *
 * dashboard-routes.ts consumes the context; dashboard-route-types.ts defines its contract.
 */
import { recordEvidenceEvent } from "../evidence/envelope.js";
import {
  LocalPathValidationError,
  resolveLocalStatePath,
  validateLocalPath,
} from "./local-paths.js";
import type {
  DashboardRouteContext,
  DashboardRouteDependencies,
} from "./dashboard-route-types.js";

/**
 * Connect the server's dependencies to saved-project state, recent quality audits, and the validation helpers used by dashboard requests.
 *
 * @param deps - server settings and IO helpers, including its default project, page template, response writer, and request-body reader
 * @returns shared route dependencies, resolved state-file paths, an initially empty audit cache, and evidence and validation helpers
 */
export function createDashboardRouteContext(
  deps: DashboardRouteDependencies,
): DashboardRouteContext {
  const dashboardStateFile = resolveLocalStatePath(
    deps.absDefault,
    "dashboard-state.json",
  );
  const legacyProjectsListFile = resolveLocalStatePath(
    deps.absDefault,
    "dashboard-projects.json",
  );

  return {
    ...deps,
    dashboardStateFile,
    legacyProjectsListFile,
    qualityAuditCache: new Map(),
    /**
     * Record a dashboard action in the acting project's timeline with the server as actor.
     * The evidence writer reports append failures without throwing, so an unavailable trace does not reject the user's action.
     */
    recordDashboardEvent(projectPath, eventKind, payload): void {
      recordEvidenceEvent({
        producer: "dashboard-session-trace",
        actor: "server",
        eventType: eventKind,
        projectRoot: projectPath,
        payload,
      });
    },
    /**
     * Resolve a request's project path; an absent or empty value selects the server's launch project.
     * Throws LocalPathValidationError for missing, non-directory, or policy-blocked paths so routes can explain the rejection with a 400.
     */
    validatedPath(raw, purpose): string {
      // Requests without a project selection operate on the folder from which this dashboard server was launched.
      return validateLocalPath(raw || deps.absDefault, purpose).path;
    },
    // Report rejected project paths as 400 responses; other failures retain the status chosen by the route.
    responseStatusForError(err, fallback): number {
      return err instanceof LocalPathValidationError ? 400 : fallback;
    },
  };
}
