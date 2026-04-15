/**
 * Per-agent fact extractor - thin composer that delegates to sub-extractors.
 */
import type { AgentProfile, AgentFacts, ReadonlyFS } from "../../types.js";
import { extractInstructionFacts } from "./instruction.js";
import { extractSettingsFacts, checkDenyPatterns } from "./settings.js";
import { extractSkillFacts } from "./skills.js";
import { extractRouterFacts } from "./routing.js";
import { extractHookFacts } from "./hooks.js";

/** Collect all facts for a single agent by delegating to sub-extractors. */
export function extractAgentFacts(
  fs: ReadonlyFS,
  agent: AgentProfile,
): AgentFacts {
  const instruction = extractInstructionFacts(fs, agent);
  const settings = extractSettingsFacts(fs, agent);
  const skills = extractSkillFacts(fs, agent);
  const hookFacts = extractHookFacts(
    fs,
    agent,
    settings.parsed,
    settings.hasDenyPatterns,
    settings.valid,
  );
  const deny = checkDenyPatterns(fs, agent);
  const router = extractRouterFacts(fs, instruction.content);

  /** All files matching the agent's local instruction pattern */
  const localFiles = agent.localPattern.includes("*")
    ? fs.glob(agent.localPattern)
    : [];
  /** Local context files excluding the root instruction file */
  const filteredLocal = localFiles.filter((f) => f !== agent.instructionFile);

  // Shared footgun analysis later fills in which local context files are warranted.
  /** Directories warranting local context files based on footgun mentions */
  const warranted: string[] = [];
  /** Warranted directories that lack a local context file */
  const missing: string[] = [];
  // This will be populated from shared facts in the extract orchestrator

  return {
    agent,
    instruction,
    settings: {
      exists: settings.exists,
      valid: settings.valid,
      parsed: settings.parsed,
      hasDenyPatterns: settings.hasDenyPatterns,
    },
    skills,
    hooks: {
      ...hookFacts,
      readDenyCoversSecrets: settings.readDenyCoversSecrets,
    },
    deny,
    router,
    localContext: { files: filteredLocal, warranted, missing },
  };
}
