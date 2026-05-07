/**
 * Coordinates fact extraction for a project.
 * Full extraction combines stack detection, shared project facts, and per-agent
 * facts. Dashboard summary extraction can skip stack detection because that
 * shared report contract does not expose stack-derived fields.
 */
import type { ProjectFacts, ReadonlyFS, AgentId, StackInfo } from "../types.js";
import { KNOWN_AGENT_IDS } from "../types.js";
import type { LoadedConfig } from "../config/types.js";
import { detectAgents, PROFILES } from "../detect/agents.js";
import { detectStack } from "../detect/project-stack.js";
import { extractSharedFacts } from "./shared/index.js";
import { extractAgentFacts } from "./agent/index.js";

interface FactExtractionProfiler {
  span<T>(name: string, fn: () => T): T;
}

/** Configuration for extracting project facts during a scan run. */
interface ExtractOptions {
  agentFilter: AgentId | null;
  projectPath?: string;
  configState: LoadedConfig;
  /** Skip expensive setup-time stack detection for dashboard summary audits. */
  includeStack?: boolean;
  /** Optional development/test profiler for extraction timing. */
  profile?: FactExtractionProfiler;
}

const KNOWN_AGENT_SET = new Set<string>(KNOWN_AGENT_IDS);

/** Return true when a config string names a supported agent profile. */
function isAgentId(id: string): id is AgentId {
  return KNOWN_AGENT_SET.has(id);
}

/** Keep configured agents in first-seen order while ignoring duplicates. */
function uniqueConfiguredAgentIds(ids: string[]): AgentId[] {
  const seen = new Set<AgentId>();
  const unique: AgentId[] = [];
  for (const id of ids) {
    if (!isAgentId(id) || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

function span<T>(
  profile: FactExtractionProfiler | undefined,
  name: string,
  fn: () => T,
): T {
  return profile ? profile.span(name, fn) : fn();
}

/** Stack sentinel for profiles that intentionally do not have stack facts. */
function unavailableStack(): StackInfo {
  const message =
    "facts.stack is unavailable in dashboard-summary audit profile; mark the check requiresStack or run a full audit profile";
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "toJSON") {
          return () => ({ unavailable: true });
        }
        throw new Error(`${message} (accessed ${String(prop)})`);
      },
    },
  ) as StackInfo;
}

/** Gather stack, shared, and per-agent facts into the single scan input object. */
export function extractProjectFacts(
  fs: ReadonlyFS,
  options: ExtractOptions,
): ProjectFacts {
  /** All detected agent profiles in the project */
  let agents = detectAgents(fs);

  // An explicit --agent flag is the strongest selector and wins over config.yaml.
  if (options.agentFilter) {
    agents = agents.filter((a) => a.id === options.agentFilter);
  }
  // Otherwise, config.yaml can narrow an auto-detected project to the supported agents
  // the project has chosen to manage with goat-flow.
  else if (options.configState.config.agents) {
    agents = uniqueConfiguredAgentIds(options.configState.config.agents).map(
      (id) => PROFILES[id],
    );
  }

  /** Detected technology stack (language, framework, etc.) */
  const stack =
    options.includeStack === false
      ? unavailableStack()
      : span(options.profile, "detectStack", () => detectStack(fs));

  /** Shared facts covering docs, CI, and other project-wide resources */
  const shared = span(options.profile, "shared facts", () =>
    extractSharedFacts(fs, options.configState),
  );

  /** Per-agent facts including instruction, settings, skills, and hooks */
  const agentFacts = agents.map((agent) =>
    span(options.profile, "agent facts", () => {
      /** Extracted facts for this specific agent */
      const facts = extractAgentFacts(fs, agent);

      // Cross-reference: populate warranted local context from footgun dir mentions
      /** Directories warranting local context files */
      const warranted: string[] = [];
      /** Warranted directories that lack a local context file */
      const missing: string[] = [];
      // Repeated footgun references are treated as a signal that the directory is
      // risky enough to deserve local instructions. A single mention is often noise.
      for (const [dir, count] of shared.footguns.dirMentions) {
        if (count >= 2) {
          warranted.push(dir);
          // Missing local context is only interesting for directories repeatedly named in footguns.
          /** Whether a local instruction file already exists for this directory */
          const hasLocal = facts.localContext.files.some((f) =>
            f.startsWith(dir),
          );
          if (hasLocal === false) {
            missing.push(dir);
          }
        }
      }
      facts.localContext.warranted = warranted;
      facts.localContext.missing = missing;

      return facts;
    }),
  );

  return {
    root: options.projectPath ?? ".",
    stack,
    agents: agentFacts,
    shared,
  };
}
