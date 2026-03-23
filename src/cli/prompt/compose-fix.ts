import type { ScanReport, AgentReport, AgentId } from '../types.js';
import type { ComposedPrompt, PromptSection, ResolvedFragment, FragmentPhase, PromptVariables } from './types.js';
import { getFragment } from './registry.js';
import { extractVariables, fillTemplate } from './variables.js';

/** Ordered phases for grouping fix fragments from highest to lowest severity */
const PHASE_ORDER: FragmentPhase[] = ['anti-pattern', 'foundation', 'standard', 'full'];
/** Human-readable heading for each fragment phase */
const PHASE_HEADINGS: Record<FragmentPhase, string> = {
  'anti-pattern': 'Critical: Anti-Pattern Fixes',
  foundation: 'Phase 1: Foundation',
  standard: 'Phase 2: Standard',
  full: 'Phase 3: Full',
};

/**
 * Compose a fix prompt from failed checks in a scan report.
 * Only includes fragments for checks that failed or had anti-patterns triggered.
 */
export function composeFix(report: ScanReport, agentId: AgentId): ComposedPrompt | null {
  /** Agent-specific report extracted from the scan */
  const agentReport = report.agents.find(a => a.agent === agentId);
  if (agentReport === undefined) return null;

  /** Template variables derived from the scan report */
  const vars = extractVariables(report, agentReport);

  /** Fragment keys needed for failed checks and triggered anti-patterns */
  const neededKeys = new Set<string>();

  // Iterate over each check to collect recommendation keys for failures
  for (const check of agentReport.checks) {
    if ((check.status === 'fail' || check.status === 'partial') && check.recommendationKey) {
      neededKeys.add(check.recommendationKey);
    }
  }

  // Iterate over each anti-pattern to collect recommendation keys for triggered ones
  for (const ap of agentReport.antiPatterns) {
    if (ap.triggered && ap.recommendationKey) {
      neededKeys.add(ap.recommendationKey);
    }
  }

  if (neededKeys.size === 0) {
    return {
      mode: 'fix',
      agent: agentId,
      title: `GOAT Flow Fix — ${vars.agentName}`,
      preamble: `All checks pass. ${vars.agentName} scores ${vars.grade} (${vars.percentage}%). No fixes needed.`,
      sections: [],
      summary: 'Nothing to fix.',
    };
  }

  /** Prompt sections grouped by phase */
  const sections = resolveFragmentsByPhase(neededKeys, agentId, vars);

  return {
    mode: 'fix',
    agent: agentId,
    title: `GOAT Flow Fix — ${vars.agentName}`,
    preamble: buildPreamble(vars, agentReport),
    sections,
    summary: buildSummary(neededKeys.size, vars),
  };
}

/** Resolve fragment keys into grouped prompt sections by phase */
function resolveFragmentsByPhase(neededKeys: Set<string>, agentId: AgentId, vars: PromptVariables): PromptSection[] {
  const sections: PromptSection[] = [];
  // Iterate over each phase to resolve and group matching fragments
  for (const phase of PHASE_ORDER) {
    const fragments: ResolvedFragment[] = [];
    // Iterate over each needed key to find fragments matching the current phase
    for (const key of neededKeys) {
      const fragment = getFragment(key);
      if (fragment === undefined || fragment.phase !== phase) continue;
      const override = fragment.agentOverrides?.[agentId];
      const instruction = fillTemplate(override ?? fragment.instruction, vars);
      fragments.push({ key, category: fragment.category, instruction });
    }
    if (fragments.length > 0) {
      sections.push({ phase, heading: PHASE_HEADINGS[phase], fragments });
    }
  }
  return sections;
}

/** Build the preamble text summarising score and stack for the fix prompt */
function buildPreamble(vars: PromptVariables, agentReport: AgentReport): string {
  /** Formatted command strings for build, test, and lint */
  const cmds = [
    vars.buildCommand && `**Build:** \`${vars.buildCommand}\``,
    vars.testCommand && `**Test:** \`${vars.testCommand}\``,
    vars.lintCommand && `**Lint:** \`${vars.lintCommand}\``,
  ].filter(Boolean).join(' | ');

  /** Preamble lines assembled into the final string */
  const lines = [
    `This project scores **${vars.grade}** (${vars.percentage}%) for ${vars.agentName}.`,
    `**${vars.failedCount}** checks need attention out of ${vars.totalCount} total.`,
    '',
    `**Stack:** ${vars.languages}`,
    ...(cmds ? [cmds] : []),
    '',
    'Work through each section in order. Complete all foundation fixes before moving to standard.',
  ];

  /** Anti-patterns that fired during the scan */
  const triggered = agentReport.antiPatterns.filter(ap => ap.triggered);
  if (triggered.length > 0) {
    lines.push('', `**⚠ ${triggered.length} anti-pattern(s) detected** — fix these first (marked Critical).`);
  }

  return lines.join('\n');
}

/** Build the closing summary line with fix count and re-scan instruction */
function buildSummary(fixCount: number, vars: PromptVariables): string {
  return `${fixCount} fix${fixCount === 1 ? '' : 'es'} for ${vars.agentName}. After applying, re-run \`goat-flow scan .\` to verify.`;
}

