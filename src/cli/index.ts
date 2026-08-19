/**
 * The programmatic entry point for using goat-flow as a library rather than a command.
 *
 * Re-exports the stable audit, prompt, config, and utility APIs that tests and external consumers are allowed to depend on.
 *
 * Anything absent from this barrel is internal and may move between releases, so importing around it is what breaks on upgrade.
 */

export type {
  AgentId,
  AgentProfile,
  ProjectFacts,
  AgentFacts,
  SharedFacts,
  StackInfo,
  ReadonlyFS,
  CLIOptions,
} from "./types.js";

export { createFS } from "./facts/fs.js";
