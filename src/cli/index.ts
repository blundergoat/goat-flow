// Library entry point for programmatic consumers (M2, M3)
// Re-exports the scan engine, types, and utilities

export type {
  AgentId,
  ProjectShape,
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

// TODO: export scan(), score(), detect() functions as they are built
