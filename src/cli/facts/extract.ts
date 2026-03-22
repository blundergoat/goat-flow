import type { ProjectFacts, ReadonlyFS } from '../types.js';
import { detectAgents } from '../detect/agents.js';
import { detectStack } from '../detect/stack.js';
import { extractSharedFacts } from './shared.js';
import { extractAgentFacts } from './agent.js';

export interface ExtractOptions {
  agentFilter: string | null;
}

export function extractFacts(fs: ReadonlyFS, options: ExtractOptions): ProjectFacts {
  // Detect agents
  let agents = detectAgents(fs);

  // Filter to specific agent if requested
  if (options.agentFilter) {
    agents = agents.filter(a => a.id === options.agentFilter);
  }

  // Detect stack
  const stack = detectStack(fs);

  // Extract shared facts (docs, evals, CI, etc.)
  const shared = extractSharedFacts(fs);

  // Extract per-agent facts
  const agentFacts = agents.map(agent => {
    const facts = extractAgentFacts(fs, agent);

    // Cross-reference: populate warranted local context from footgun dir mentions
    const warranted: string[] = [];
    const missing: string[] = [];
    for (const [dir, count] of shared.footguns.dirMentions) {
      if (count >= 2) {
        warranted.push(dir);
        // Check if a local instruction file exists for this dir
        const hasLocal = facts.localContext.files.some(f => f.startsWith(dir));
        if (!hasLocal) {
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
