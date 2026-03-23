import type { ProjectFacts, ReadonlyFS, AgentId } from '../types.js';
import { detectAgents } from '../detect/agents.js';
import { detectStack } from '../detect/stack.js';
import { extractSharedFacts } from './shared.js';
import { extractAgentFacts } from './agent.js';

interface ExtractOptions {
  agentFilter: AgentId | null;
}

/** Orchestrate full fact extraction: detect agents, detect stack, gather shared and per-agent facts. */
export function extractProjectFacts(fs: ReadonlyFS, options: ExtractOptions): ProjectFacts {
  /** All detected agent profiles in the project */
  let agents = detectAgents(fs);

  // Filter to specific agent if requested
  if (options.agentFilter) {
    agents = agents.filter(a => a.id === options.agentFilter);
  }

  /** Detected technology stack (language, framework, etc.) */
  const stack = detectStack(fs);

  /** Shared facts covering docs, evals, CI, and other project-wide resources */
  const shared = extractSharedFacts(fs);

  /** Per-agent facts including instruction, settings, skills, and hooks */
  const agentFacts = agents.map(agent => {
    /** Extracted facts for this specific agent */
    const facts = extractAgentFacts(fs, agent);

    // Cross-reference: populate warranted local context from footgun dir mentions
    /** Directories warranting local context files */
    const warranted: string[] = [];
    /** Warranted directories that lack a local context file */
    const missing: string[] = [];
    // Iterate over footgun directory mentions to identify warranted local context
    for (const [dir, count] of shared.footguns.dirMentions) {
      if (count >= 2) {
        warranted.push(dir);
        // Check if a local instruction file exists for this dir
        /** Whether a local instruction file already exists for this directory */
        const hasLocal = facts.localContext.files.some(f => f.startsWith(dir));
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
    root: '.',
    stack,
    agents: agentFacts,
    shared,
  };
}
