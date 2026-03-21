import type { ScanReport, AgentReport, ReadonlyFS, ProjectShape, AgentId } from '../types.js';
import { extractFacts } from '../facts/extract.js';
import { allChecks, allAntiPatterns } from '../rubric/registry.js';
import { RUBRIC_VERSION, PACKAGE_VERSION, SCHEMA_VERSION } from '../rubric/version.js';
import { runChecks, runAntiPatterns, computeScore } from '../scoring/engine.js';
import { generateRecommendations } from '../scoring/recommendations.js';

export interface ScanOptions {
  shapeOverride: ProjectShape | null;
  agentFilter: AgentId | null;
}

export function scan(fs: ReadonlyFS, projectPath: string, options: ScanOptions): ScanReport {
  const facts = extractFacts(fs, {
    shapeOverride: options.shapeOverride,
    agentFilter: options.agentFilter,
  });

  const agentReports: AgentReport[] = facts.agents.map(agentFacts => {
    const ctx = { facts, agentFacts };

    const checkResults = runChecks(allChecks, ctx);
    const antiPatternResults = runAntiPatterns(allAntiPatterns, ctx);
    const score = computeScore(checkResults, antiPatternResults, allChecks.length);
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
    shape: { value: facts.shape, source: facts.shapeSource },
    stack: facts.stack,
    agents: agentReports,
    meta: {
      checkCount: allChecks.length,
      antiPatternCount: allAntiPatterns.length,
      timestamp: new Date().toISOString(),
    },
  };
}
