/**
 * Programmatic entry point for goat-flow as a library.
 * Re-exports the stable audit, prompt, config, and utility APIs used by tests and external consumers.
 */

export type {
  AgentId,
  Tier,
  CheckStatus,
  Confidence,
  Grade,
  AgentProfile,
  CheckDef,
  AntiPatternDef,
  CheckResult,
  AntiPatternResult,
  ProjectFacts,
  AgentFacts,
  SharedFacts,
  StackInfo,
  FactContext,
  ScoreSummary,
  TierScore,
  Recommendation,
  AgentReport,
  ScanReport,
  ReadonlyFS,
  CLIOptions,
} from "./types.js";

export { createFS } from "./facts/fs.js";

export {
  getCheck,
  getChecksByTier,
  getChecksByCategory,
} from "./rubric/registry.js";

export { getFragmentsByPhase } from "./prompt/registry.js";

export { mapSignalsToTemplates } from "./prompt/template-refs.js";
