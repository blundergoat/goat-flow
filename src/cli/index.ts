/**
 * Library entry point for programmatic consumers (M2, M3).
 * Re-exports the scan engine, types, and utilities.
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
} from './types.js';

export { scan } from './evaluate/runner.js';
export type { ScanOptions } from './evaluate/runner.js';

export { createFS } from './facts/fs.js';

export {
  getCheck,
  getChecksByTier,
  getChecksByCategory,
} from './rubric/registry.js';

export { getFragmentsByPhase } from './prompt/registry.js';

export type { EvalScore, EvalResult } from './eval/types.js';
