import type { ScanReport, AgentReport, ReadonlyFS, AgentId } from '../types.js';
import { extractFacts } from '../facts/extract.js';
import { allChecks, allAntiPatterns } from '../rubric/registry.js';
import { RUBRIC_VERSION, PACKAGE_VERSION, SCHEMA_VERSION } from '../rubric/version.js';
import { runChecks, runAntiPatterns, computeScore } from '../scoring/engine.js';
import { generateRecommendations } from '../scoring/recommendations.js';

export interface ScanOptions {
  agentFilter: AgentId | null;
}

/** Run all rubric checks and anti-pattern detections against a project, returning a full scan report. */
export function scan(fs: ReadonlyFS, projectPath: string, options: ScanOptions): ScanReport {
  /** Extracted project and agent facts used by all evaluators */
  const facts = extractFacts(fs, {
    agentFilter: options.agentFilter,
  });

  // Iterate over each detected agent to produce per-agent reports
  /** Per-agent scan reports containing scores, check results, and recommendations */
  const agentReports: AgentReport[] = facts.agents.map(agentFacts => {
    /** Evaluation context combining shared and agent-specific facts */
    const ctx = { facts, agentFacts };

    /** Results from running all rubric checks */
    const checkResults = runChecks(allChecks, ctx);
    /** Results from running all anti-pattern detections */
    const antiPatternResults = runAntiPatterns(allAntiPatterns, ctx);
    /** Computed score based on check and anti-pattern results */
    const score = computeScore(checkResults, antiPatternResults, allChecks.length);
    /** Prioritized recommendations based on failed checks and detected anti-patterns */
    const recommendations = generateRecommendations(
      checkResults, antiPatternResults, allChecks, allAntiPatterns,
    );

    return {
      agent: agentFacts.agent.id,
      agentName: agentFacts.agent.name,
      score,
      checks: checkResults,
      antiPatterns: antiPatternResults,
      recommendations,
    };
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    packageVersion: PACKAGE_VERSION,
    rubricVersion: RUBRIC_VERSION,
    target: projectPath,
    stack: facts.stack,
    agents: agentReports,
    meta: {
      checkCount: allChecks.length,
      antiPatternCount: allAntiPatterns.length,
      timestamp: new Date().toISOString(),
    },
  };
}
