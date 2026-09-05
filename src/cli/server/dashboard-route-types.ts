/**
 * Defines shared types and agent constants for the dashboard's non-terminal HTTP routes.
 *
 * Routes use validated request shapes and one server context to serve project, audit, and quality responses consistently.
 * Registry-derived agent lists supply both query validation and the browser's supported-agent data.
 *
 * The context implementation and route handlers live in the sibling dashboard server modules.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  getAgentProfileMap,
  getAgentProfiles,
  getKnownAgentIds,
} from "../agents/registry.js";
import type { AuditReport } from "../audit/types.js";
import { MAX_EVALUATE_CONTENT_BYTES } from "./decoders.js";
import type {
  EvidenceEventKind,
  EvidencePayload,
} from "../evidence/envelope.js";
import { QUALITY_MODES, type QualityMode } from "../quality/schema.js";
import type { AgentId } from "../types.js";
import type { LocalPathPurpose } from "./local-paths.js";

export const KNOWN_AGENT_IDS = getKnownAgentIds();
export const KNOWN_AGENT_LIST = KNOWN_AGENT_IDS.join(", ");
export const AGENT_PROFILE_MAP = getAgentProfileMap();
const AGENT_PROFILES = getAgentProfiles();
export const SUPPORTED_AGENTS = AGENT_PROFILES.map(
  ({
    id,
    name,
    terminalBinary,
    setupSurfaces,
    promptInvocationStyle,
    skillSource,
    supportsPostTurnHook,
  }) => ({
    id,
    name,
    terminalBinary,
    setupSurfaces,
    promptInvocationStyle,
    skillSource,
    supportsPostTurnHook,
  }),
);
export const VALID_AGENTS = new Set<string>(KNOWN_AGENT_IDS);
export const VALID_QUALITY_MODES = new Set<string>(QUALITY_MODES);
export const QUALITY_EVALUATE_MAX_BODY_BYTES =
  MAX_EVALUATE_CONTENT_BYTES + 64 * 1024;

/**
 * Reports the quality cache lookup: a hit found a saved audit, a miss found none, and bypass means freshness skipped lookup.
 * A miss does not promise a recomputation because a fast-cache request can return without running an audit.
 */
export type QualityAuditCacheStatus = "hit" | "miss" | "bypass";

/**
 * Describes a bundled prompt preset sent to the dashboard's preset picker.
 *
 * The stable field names match `preset-prompts.json` and its browser consumers.
 * Labels and prompt text come from that asset so the selected preset reaches the user without runtime label derivation.
 */
interface DashboardPresetData {
  id: string;
  name: string;
  desc: string;
  prompt: string;
  cat: string;
}

/**
 * Carries a validated quality request for the selected agent and mode.
 *
 * A fresh request can bypass cached audits; the fast-cache option separately controls whether a missing audit is run.
 * Keeping these choices separate lets the route report cache availability without promising a recomputation.
 */
export interface QualityRequestParams {
  agent: AgentId;
  qualityMode: QualityMode;
  includeFresh: boolean;
  shouldUseFastCache: boolean;
}

type JsonResponder = (
  res: ServerResponse,
  status: number,
  body: unknown,
) => void;

/**
 * Lets an upload or mutation route choose its request-body limits.
 *
 * An omitted byte limit keeps the body reader's default; a supplied limit applies to the whole body.
 * An omitted error message keeps the reader's default oversized-request response.
 */
interface BodyReadOptions {
  maxBytes?: number;
  tooLargeMessage?: string;
}

type BodyReader = (
  req: IncomingMessage,
  options?: BodyReadOptions,
) => Promise<string>;

/**
 * Records one named audit stage for an explicitly profiled request.
 *
 * Duration is elapsed time in milliseconds, recorded even if that stage throws.
 * Nested stages can overlap, so their sum is not the request's wall-clock duration.
 */
export interface DashboardAuditProfileSpan {
  name: string;
  durationMs: number;
}

/**
 * Keeps collected audit timings within one dashboard request.
 *
 * Disabled profiling still runs each wrapped stage and returns its result.
 * An empty spans list means no timings were collected; enabled stages append a duration even when their work throws.
 */
export interface DashboardAuditProfiler extends Record<"enabled", boolean> {
  spans: DashboardAuditProfileSpan[];
  // Time one labelled step of a dashboard audit; implementations return whatever the wrapped block returned.
  span<T>(name: string, block: () => T): T;
}

/**
 * Supplies shared server inputs to non-terminal dashboard routes.
 *
 * Project defaults, package metadata, presets, and template access describe this dashboard instance.
 * Response and body-reading helpers keep HTTP encoding and request limits consistent across its handlers.
 */
export interface DashboardRouteDependencies {
  absDefault: string;
  isDevMode: boolean;
  getTemplate: () => string;
  packageVersion: string;
  dashboardToken: string;
  dashboardPresets: ReadonlyArray<DashboardPresetData>;
  jsonResponse: JsonResponder;
  readBody: BodyReader;
}

/**
 * Shares state paths, helpers, and a quality cache across one dashboard server's routes.
 *
 * Built by `createDashboardRouteContext`; each server receives its own cache, reused by that server's requests.
 * Evidence recording and error mapping keep route results consistent for the selected project.
 *
 * Caller-supplied paths must pass the applicable path validation contract before filesystem work.
 * Project-local state helpers add containment checks for saved data and markers.
 */
export interface DashboardRouteContext extends DashboardRouteDependencies {
  dashboardStateFile: string;
  legacyProjectsListFile: string;
  qualityAuditCache: Map<string, { report: AuditReport; cachedAt: number }>;
  recordDashboardEvent: (
    projectPath: string,
    eventKind: EvidenceEventKind,
    payload?: EvidencePayload,
  ) => void;
  validatedPath: (raw: string | null, purpose: LocalPathPurpose) => string;
  responseStatusForError: (err: unknown, fallback: number) => number;
}

/**
 * Extract the first trimmed output line for the detected agent version, removing trailing punctuation after a digit.
 *
 * @param raw - stdout captured from the agent binary; empty or whitespace-only output carries no version
 * @returns a trimmed version line, or null when the command produced no text
 */
export function normalizeAgentVersionOutput(raw: string): string | null {
  const firstLine = raw.trim().split(/\r?\n/)[0]?.trim() ?? "";
  // An agent command that prints no version leaves the dashboard without a detected version label.
  if (!firstLine) return null;
  return firstLine.replace(/(\d)[.,;:]+$/u, "$1");
}
