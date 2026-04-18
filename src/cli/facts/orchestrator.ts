/**
 * Coordinates full fact extraction for a project.
 * It combines stack detection, shared project facts, and per-agent facts into the `ProjectFacts` object used by audit and setup.
 */
import type { ProjectFacts, ReadonlyFS, AgentId } from "../types.js";
import type { LoadedConfig } from "../config/types.js";
import { detectAgents } from "../detect/agents.js";
import { detectStack } from "../detect/project-stack.js";
import { extractSharedFacts } from "./shared/index.js";
import { extractAgentFacts } from "./agent/index.js";

/** Configuration for extracting project facts during a scan run. */
interface ExtractOptions {
  agentFilter: AgentId | null;
  projectPath?: string;
  configState: LoadedConfig;
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
    const configured = new Set(options.configState.config.agents);
    agents = agents.filter((a) => configured.has(a.id));
  }

  /** Detected technology stack (language, framework, etc.) */
  const stack = detectStack(fs);

  /** Shared facts covering docs, CI, and other project-wide resources */
  const shared = extractSharedFacts(fs, options.configState);

  /** Per-agent facts including instruction, settings, skills, and hooks */
  const agentFacts = agents.map((agent) => {
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
  });

  return {
    root: options.projectPath ?? ".",
    stack,
    agents: agentFacts,
    shared,
  };
}
