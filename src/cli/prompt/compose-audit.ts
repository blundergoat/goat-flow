import type { ScanReport, AgentId } from '../types.js';
import type { ComposedPrompt, PromptSection } from './types.js';
import { extractTemplateVars } from './template-filler.js';

/**
 * Compose a read-only audit prompt.
 * The agent reads and diagnoses without making changes.
 */
export function composeAudit(report: ScanReport, agentId: AgentId): ComposedPrompt | null {
  /** Agent-specific report extracted from the scan */
  const agentReport = report.agents.find(a => a.agent === agentId);
  if (agentReport === undefined) return null;

  /** Template variables derived from the scan report */
  const vars = extractTemplateVars(report, agentReport);
  /** Checks with a fail status */
  const failed = agentReport.checks.filter(c => c.status === 'fail');
  /** Checks with a partial status */
  const partial = agentReport.checks.filter(c => c.status === 'partial');
  /** Anti-patterns that fired during the scan */
  const triggered = agentReport.antiPatterns.filter(ap => ap.triggered);

  /** Accumulated prompt sections built up below */
  const sections: PromptSection[] = [];

  // Section 1: Score Overview
  sections.push({
    phase: 'foundation',
    heading: 'Current Score',
    fragments: [{
      key: '_audit-overview',
      category: 'Overview',
      instruction: [
        `This project scores **${vars.grade}** (${vars.percentage}%) for ${vars.agentName}.`,
        '',
        `| Tier | Score |`,
        `|------|-------|`,
        `| Foundation | ${agentReport.score.tiers.foundation.percentage}% |`,
        `| Standard | ${agentReport.score.tiers.standard.percentage}% |`,
        `| Full | ${agentReport.score.tiers.full.percentage}% |`,
        '',
        `**Failures:** ${failed.length} | **Partial:** ${partial.length} | **Anti-patterns:** ${triggered.length}`,
      ].join('\n'),
    }],
  });

  // Section 2: Failed Checks
  if (failed.length > 0) {
    sections.push({
      phase: 'foundation',
      heading: 'Failed Checks',
      fragments: failed.map(check => ({
        key: `_audit-fail-${check.id}`,
        category: check.category,
        instruction: `**${check.id}** ${check.name}: ${check.message}${check.evidence ? ` (evidence: ${check.evidence})` : ''}`,
      })),
    });
  }

  // Section 3: Anti-patterns
  if (triggered.length > 0) {
    sections.push({
      phase: 'anti-pattern',
      heading: 'Anti-Patterns Detected',
      fragments: triggered.map(ap => ({
        key: `_audit-ap-${ap.id}`,
        category: 'Anti-Pattern',
        instruction: `**${ap.id}** ${ap.name} (${ap.deduction} pts): ${ap.message}`,
      })),
    });
  }

  // Section 4: Diagnostic Questions
  sections.push({
    phase: 'standard',
    heading: 'Diagnostic Questions',
    fragments: [{
      key: '_audit-questions',
      category: 'Diagnosis',
      instruction: `Read the project files and answer these questions:

1. **Instruction file quality:** Read \`${vars.instructionFile}\`. Does the execution loop have all 6 steps? Are the autonomy tiers project-specific?
2. **Enforcement gaps:** Is the deny mechanism actually blocking dangerous commands? Check ${vars.settingsFile}.
3. **Learning loop health:** Read \`docs/lessons.md\` and \`docs/footguns.md\`. Are entries from real incidents or templated?
4. **Router accuracy:** Check every path in the router table. Do they all resolve?
5. **Skills completeness:** Check \`${vars.skillsDir}/\`. Are all 10 goat-* skills present with proper SKILL.md files?
6. **Architecture docs:** Is \`docs/architecture.md\` under 100 lines and actually useful?
7. **Highest-impact fix:** Which single change would improve the score the most?

**IMPORTANT:** This is a read-only audit. Do NOT make any changes. Report findings only.`,
    }],
  });

  return {
    mode: 'audit',
    agent: agentId,
    title: `GOAT Flow Audit — ${vars.agentName}`,
    preamble: `Read-only audit of GOAT Flow implementation for ${vars.agentName}. Do NOT make any file changes. Read, diagnose, report.`,
    sections,
    summary: `Audit complete. Review the findings above and decide which fixes to prioritize.`,
  };
}
