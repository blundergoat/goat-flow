/**
 * Top-level scan orchestrator.
 * It loads config, extracts facts, runs the rubric, computes recommendations, and returns the full report consumed by CLI renderers and tests.
 */
import type { ScanReport, AgentReport, ReadonlyFS, AgentId } from "../types.js";
import { loadConfig } from "../config/index.js";
import { extractProjectFacts } from "../facts/orchestrator.js";
import { allChecks, allAntiPatterns } from "../rubric/registry.js";
import { RUBRIC_VERSION, SCHEMA_VERSION } from "../rubric/version.js";
import { getPackageVersion } from "../paths.js";

/** Current package version embedded in scan report metadata */
const PACKAGE_VERSION = getPackageVersion();
import {
  runChecks,
  runAntiPatterns,
  computeScore,
} from "../scoring/calculate.js";
import { generateRecommendations } from "../scoring/recommendations.js";

/** Options for the scan orchestrator */
export interface ScanOptions {
  agentFilter: AgentId | null;
}

/** Run all rubric checks and anti-pattern detections against a project, returning a full scan report. */
export function scanProject(
  fs: ReadonlyFS,
  projectPath: string,
  options: ScanOptions,
): ScanReport {
  const configState = loadConfig(projectPath, fs);
  /** Extracted project and agent facts used by all evaluators */
  const facts = extractProjectFacts(fs, {
    agentFilter: options.agentFilter,
    projectPath,
    configState,
  });

  // Iterate over each detected agent to produce per-agent reports
  /** Per-agent scan reports containing scores, check results, and recommendations */
  const agentReports: AgentReport[] = facts.agents.map((agentFacts) => {
    /** Evaluation context combining shared and agent-specific facts */
    const ctx = { facts, agentFacts, fs };

    /** Results from running all rubric checks */
    const checkResults = runChecks(allChecks, ctx);
    /** Results from running all anti-pattern detections */
    const antiPatternResults = runAntiPatterns(allAntiPatterns, ctx);
    /** Computed score based on check and anti-pattern results */
    const score = computeScore(
      checkResults,
      antiPatternResults,
      allChecks.length,
      allChecks,
    );
    /** Prioritized recommendations based on failed checks and detected anti-patterns */
    const recommendations = generateRecommendations(
      checkResults,
      antiPatternResults,
      allChecks,
      allAntiPatterns,
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
      versions: {
        schema: SCHEMA_VERSION,
        package: PACKAGE_VERSION,
        rubric: RUBRIC_VERSION,
      },
      config: {
        exists: facts.shared.config.exists,
        valid: facts.shared.config.valid,
      },
      learningLoop: {
        footguns: {
          count: facts.shared.footguns.entryCount,
        },
        lessons: {
          count: facts.shared.lessons.entryCount,
        },
      },
    },
  };
}
