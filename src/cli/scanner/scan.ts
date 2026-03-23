import type { ScanReport, AgentReport, ReadonlyFS, AgentId } from '../types.js';
import { extractProjectFacts } from '../facts/orchestrator.js';
import { allChecks, allAntiPatterns } from '../rubric/registry.js';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUBRIC_VERSION, SCHEMA_VERSION } from '../rubric/version.js';

/** Find package.json by walking up from the current file's directory */
function findPackageVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  // Walk up until we find package.json (max 10 levels to prevent infinite loop)
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      return (JSON.parse(readFileSync(candidate, 'utf-8')) as { version: string }).version;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '0.0.0';
}

/** Package version from package.json — single source of truth */
const PACKAGE_VERSION = findPackageVersion();
import { runChecks, runAntiPatterns, computeScore } from '../scoring/scorer.js';
import { generateRecommendations } from '../scoring/recommendations.js';

export interface ScanOptions {
  agentFilter: AgentId | null;
}

/** Run all rubric checks and anti-pattern detections against a project, returning a full scan report. */
export function scanProject(fs: ReadonlyFS, projectPath: string, options: ScanOptions): ScanReport {
  /** Extracted project and agent facts used by all evaluators */
  const facts = extractProjectFacts(fs, {
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
