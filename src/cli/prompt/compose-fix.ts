import type { ScanReport, AgentReport, AgentId } from '../types.js';
import type { ComposedPrompt, PromptSection, ResolvedFragment, FragmentPhase, PromptVariables } from './types.js';
import { getFragment } from './registry.js';
import { extractVariables, fillTemplate } from './variables.js';

const PHASE_ORDER: FragmentPhase[] = ['anti-pattern', 'foundation', 'standard', 'full'];
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
  const agentReport = report.agents.find(a => a.agent === agentId);
  if (!agentReport) return null;

  const vars = extractVariables(report, agentReport);

  // Collect fragment keys from failed checks and triggered anti-patterns
  const neededKeys = new Set<string>();

  for (const check of agentReport.checks) {
    if ((check.status === 'fail' || check.status === 'partial') && check.recommendationKey) {
      neededKeys.add(check.recommendationKey);
    }
  }

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

  // Resolve fragments, grouped by phase
  const sections: PromptSection[] = [];

  for (const phase of PHASE_ORDER) {
    const fragments: ResolvedFragment[] = [];

    for (const key of neededKeys) {
      const fragment = getFragment(key);
      if (!fragment || fragment.phase !== phase) continue;

      // Use agent-specific override if available
      let instruction = fragment.instruction;
      if (fragment.agentOverrides?.[agentId]) {
        instruction = fragment.agentOverrides[agentId]!;
      }

      fragments.push({
        key,
        category: fragment.category,
        instruction: fillTemplate(instruction, vars),
      });
    }

    if (fragments.length > 0) {
      // Sort by dependency order within phase
      const sorted = topoSort(fragments);
      sections.push({
        phase,
        heading: PHASE_HEADINGS[phase],
        fragments: sorted,
      });
    }
  }

  return {
    mode: 'fix',
    agent: agentId,
    title: `GOAT Flow Fix — ${vars.agentName}`,
    preamble: buildPreamble(vars, agentReport),
    sections,
    summary: buildSummary(neededKeys.size, vars),
  };
}

function buildPreamble(vars: PromptVariables, agentReport: AgentReport): string {
  const lines = [
    `This project scores **${vars.grade}** (${vars.percentage}%) for ${vars.agentName}.`,
    `**${vars.failedCount}** checks need attention out of ${vars.totalCount} total.`,
    '',
    `**Project:** ${vars.shape} | **Stack:** ${vars.languages}`,
    `**Build:** \`${vars.buildCommand}\` | **Test:** \`${vars.testCommand}\` | **Lint:** \`${vars.lintCommand}\``,
    '',
    'Work through each section in order. Complete all foundation fixes before moving to standard.',
  ];

  const triggered = agentReport.antiPatterns.filter(ap => ap.triggered);
  if (triggered.length > 0) {
    lines.push('', `**⚠ ${triggered.length} anti-pattern(s) detected** — fix these first (marked Critical).`);
  }

  return lines.join('\n');
}

function buildSummary(fixCount: number, vars: PromptVariables): string {
  return `${fixCount} fix${fixCount === 1 ? '' : 'es'} for ${vars.agentName}. After applying, re-run \`goat-flow scan .\` to verify.`;
}

/**
 * Simple topo sort by dependency. Falls back to original order for cycles.
 */
function topoSort(fragments: ResolvedFragment[]): ResolvedFragment[] {
  // For now, keep original order — dependency resolution is low-priority
  return fragments;
}
