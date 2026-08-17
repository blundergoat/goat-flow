/**
 * Factory for the shared dashboard route context.
 *
 * Resolves the per-server state-file locations once, allocates the in-memory quality audit cache, and bundles the IO helpers (evidence recording,
 * path validation, error-to-status mapping) that every non-terminal route closure depends on.
 * Centralising these here keeps individual route files free of validation and persistence wiring.
 *
 * Consumed by dashboard-routes.ts; the context shape is defined in dashboard-route-types.ts.
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
 * Build the per-server route context from the server's raw dependency bag, resolving state-file paths
 * and wiring the shared IO helpers exactly once per server instance.
 *
 * @param deps - server-owned dependencies (default path, dev flag, template/version, JSON responder,
 *   body reader) that the helpers close over
 * @returns the route context: the dependencies plus resolved state-file paths, a fresh quality audit
 *   cache, and the evidence/path-validation/error-status helpers
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
     * Record one dashboard interaction into the evidence trace, tagged with the server actor and the acting project root.
     * Writes to the evidence envelope as a side effect; fire-and-forget from the route's perspective.
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
     * Validate a caller-supplied path for the given purpose, substituting the server default when the raw value is empty.
     * Throws LocalPathValidationError when the resolved path is outside the allowed roots, which routes map to a 400 via responseStatusForError.
     */
    validatedPath(raw, purpose): string {
      return validateLocalPath(raw || deps.absDefault, purpose).path;
    },
    /**
     * Choose the HTTP status for a caught route error: 400 for a path-validation failure (caller sent a
     * bad path), otherwise the caller-supplied fallback (typically 500). Pure mapping, no side effects.
     */
    responseStatusForError(err, fallback): number {
      return err instanceof LocalPathValidationError ? 400 : fallback;
    },
  };
}
