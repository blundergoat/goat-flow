import type { ScanReport, AgentId, AgentReport } from '../types.js';
import type { ComposedPrompt, PromptSection, PromptVariables, FragmentPhase } from './types.js';
import { getAllFragments, getFragment } from './registry.js';
import { extractTemplateVars, fillTemplate } from './template-filler.js';
import { PROFILES } from '../detect/agents.js';
import { getTemplatePath } from '../paths.js';
import { getAgentTemplates, validateTemplateRefs, mapLanguagesToTemplates, getFragmentTemplate } from './template-refs.js';

/** Projects at or above this percentage get the short fix list instead of targeted fix */
const SHORT_FIX_THRESHOLD = 90;

/** Phase order for targeted-fix mode (anti-patterns first, then tiers) */
const PHASE_ORDER: FragmentPhase[] = ['anti-pattern', 'foundation', 'standard', 'full'];
const PHASE_HEADINGS: Record<FragmentPhase, string> = {
  'anti-pattern': 'Critical: Anti-Pattern Fixes',
  foundation: 'Phase 1: Foundation',
  standard: 'Phase 2: Standard',
  full: 'Phase 3: Full',
};

/**
 * Compose a setup prompt that adapts to the project's state.
 *
 * - No agents or 0%  → full reference-based setup
 * - 1-89%            → targeted fix (template refs for creates, inline for fixes)
 * - 90-99%           → short fix list (just remaining issues)
 * - 100%             → all-pass message
 */
export function composeSetup(report: ScanReport, agentId: AgentId): string | null {
  // Rollback: GOAT_FLOW_INLINE_SETUP=1 activates the old inline renderer
  if (process.env.GOAT_FLOW_INLINE_SETUP === '1') {
    return null;  // Caller handles via composeInlineSetup + renderPrompt
  }

  const agentReport = report.agents.find(a => a.agent === agentId);

  // No agents detected → full setup
  if (!agentReport) {
    return renderFullSetup(report, agentId);
  }

  const percentage = agentReport.score.percentage;

  if (percentage === 100) {
    return renderAllPass(agentId, agentReport);
  }
  if (percentage >= SHORT_FIX_THRESHOLD) {
    return renderShortFix(report, agentId, agentReport);
  }
  if (percentage > 0) {
    return renderTargetedFix(report, agentId, agentReport);
  }
  // 0% with agent detected → full setup
  return renderFullSetup(report, agentId);
}

// ---------------------------------------------------------------------------
// Mode: All pass (100%)
// ---------------------------------------------------------------------------

function renderAllPass(agentId: AgentId, agentReport: AgentReport): string {
  const profile = PROFILES[agentId];
  return `# GOAT Flow Setup — ${profile.name}\n\nAll checks pass (${agentReport.score.grade}, ${agentReport.score.percentage}%). Nothing to do.`;
}

// ---------------------------------------------------------------------------
// Mode: Short fix (90-99%)
// ---------------------------------------------------------------------------

function renderShortFix(report: ScanReport, agentId: AgentId, agentReport: AgentReport): string {
  const profile = PROFILES[agentId];
  const vars = extractTemplateVars(report, agentReport);
  const lines: string[] = [];

  lines.push(`# GOAT Flow Setup — ${profile.name}`);
  lines.push('');
  lines.push(`This project scores **${agentReport.score.grade}** (${agentReport.score.percentage}%). ${vars.failedCount} checks remaining.`);
  lines.push('');

  // Collect needed fragment keys
  const neededKeys = collectNeededKeys(agentReport);

  if (neededKeys.size === 0) {
    lines.push('No actionable fixes found.');
    return lines.join('\n');
  }

  // Render each failing item with its recommendation or fragment content
  for (const key of neededKeys) {
    const fragment = getFragment(key);
    if (!fragment) continue;
    const templatePath = getFragmentTemplate(key, agentId);
    if (templatePath) {
      lines.push(`- **${fragment.category}**: Adapt from ${getTemplatePath(templatePath)}`);
    } else {
      const override = fragment.agentOverrides?.[agentId];
      const instruction = fillTemplate(override ?? fragment.instruction, vars);
      // Take first line as summary
      const summary = (instruction.split('\n')[0] ?? '').slice(0, 120);
      lines.push(`- **${fragment.category}**: ${summary}`);
    }
  }

  // Anti-patterns
  const triggered = agentReport.antiPatterns.filter(ap => ap.triggered);
  if (triggered.length > 0) {
    lines.push('');
    lines.push('**Anti-patterns to fix:**');
    for (const ap of triggered) {
      lines.push(`- ${ap.id}: ${ap.message}`);
    }
  }

  lines.push('');
  lines.push(`Re-run: \`goat-flow scan . --agent ${agentId}\``);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Mode: Targeted fix (1-89%)
// ---------------------------------------------------------------------------

function renderTargetedFix(report: ScanReport, agentId: AgentId, agentReport: AgentReport): string {
  const profile = PROFILES[agentId];
  const vars = extractTemplateVars(report, agentReport);
  const lines: string[] = [];

  lines.push(`# GOAT Flow Setup — ${profile.name}`);
  lines.push('');
  lines.push(`This project scores **${agentReport.score.grade}** (${agentReport.score.percentage}%) for ${profile.name}.`);
  lines.push(`**${vars.failedCount}** checks need attention out of ${vars.totalCount} total.`);
  lines.push('');
  lines.push(`**Stack:** ${vars.languages}`);
  const cmds = [
    vars.buildCommand && `**Build:** \`${vars.buildCommand}\``,
    vars.testCommand && `**Test:** \`${vars.testCommand}\``,
    vars.lintCommand && `**Lint:** \`${vars.lintCommand}\``,
  ].filter(Boolean).join(' | ');
  if (cmds) lines.push(cmds);
  lines.push('');

  // Collect needed fragment keys
  const neededKeys = collectNeededKeys(agentReport);

  // Group fragments by phase, rendering template refs or inline content
  for (const phase of PHASE_ORDER) {
    /** Template references for this phase (grouped by category) */
    const templateRefs: Array<{ category: string; key: string; template: string }> = [];
    /** Inline fix instructions for this phase */
    const inlineFragments: Array<{ category: string; instruction: string }> = [];

    for (const key of neededKeys) {
      const fragment = getFragment(key);
      if (!fragment || fragment.phase !== phase) continue;

      const templatePath = getFragmentTemplate(key, agentId);
      if (templatePath) {
        templateRefs.push({ category: fragment.category, key, template: templatePath });
      } else {
        const override = fragment.agentOverrides?.[agentId];
        const instruction = fillTemplate(override ?? fragment.instruction, vars);
        inlineFragments.push({ category: fragment.category, instruction });
      }
    }

    if (templateRefs.length === 0 && inlineFragments.length === 0) continue;

    lines.push(`## ${PHASE_HEADINGS[phase]}`);
    lines.push('');

    // Group template refs by template path (collapse same-template refs)
    if (templateRefs.length > 0) {
      /** Map from template path to the fragment keys that reference it */
      const byTemplate = new Map<string, string[]>();
      for (const ref of templateRefs) {
        const existing = byTemplate.get(ref.template) ?? [];
        existing.push(ref.key);
        byTemplate.set(ref.template, existing);
      }

      // Check if this is a skills group (render as table)
      const skillRefs = templateRefs.filter(r => r.key.startsWith('create-skill-'));
      if (skillRefs.length > 0) {
        lines.push(`### Missing Skills (${skillRefs.length} of 10)`);
        lines.push('');
        lines.push('| Skill | Template |');
        lines.push('|-------|----------|');
        for (const ref of skillRefs) {
          const name = ref.key.replace('create-skill-', 'goat-');
          lines.push(`| ${name} | ${getTemplatePath(ref.template)} |`);
        }
        lines.push('');
        lines.push(`Target directory: \`${PROFILES[agentId].skillsDir}/goat-{name}/SKILL.md\``);
        lines.push('');
      }

      // Non-skill template refs — list or collapse
      for (const [template, keys] of byTemplate) {
        if (keys.every(k => k.startsWith('create-skill-'))) continue; // already rendered
        if (keys.length >= 3) {
          // Collapse same-template refs
          const names = keys.map(k => k.replace(/^(add-|create-)/, '')).join(', ');
          lines.push(`- Read ${getTemplatePath(template)} and add missing sections: ${names}`);
        } else {
          for (const key of keys) {
            const ref = templateRefs.find(r => r.key === key)!;
            lines.push(`- **${ref.category}**: Adapt from ${getTemplatePath(ref.template)}`);
          }
        }
      }
      lines.push('');
    }

    // Inline fragments
    for (const frag of inlineFragments) {
      lines.push(frag.instruction);
      lines.push('');
    }

    if (phase === 'standard') {
      lines.push('**Skill quality requirements** — each skill MUST include ALL of these sections from the template:');
      lines.push('- **When to Use** — specific triggers, not generic descriptions');
      lines.push('- **Process** with phased steps and human gates between phases');
      lines.push('- **Constraints** (MUST/MUST NOT rules)');
      lines.push('- **Output Format** — define the expected deliverable structure');
      lines.push('- **Chaining** — what skill to suggest next');
      lines.push('');
    }

    if (phase !== 'anti-pattern') {
      lines.push(`GATE: Run \`goat-flow scan . --agent ${agentId}\``);
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('');
  lines.push(`After completing fixes, re-run \`goat-flow setup . --agent ${agentId}\` to check for remaining issues.`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Mode: Full setup (0% or no agents)
// ---------------------------------------------------------------------------

function renderFullSetup(report: ScanReport, agentId: AgentId): string {
  // Validate all template paths exist — hard error if any missing
  const missing = validateTemplateRefs(agentId);
  if (missing.length > 0) {
    const list = missing.map(p => `  - ${getTemplatePath(p)}`).join('\n');
    throw new Error(`Missing template files for ${agentId} setup:\n${list}\nRe-install goat-flow or check the installation.`);
  }

  const profile = PROFILES[agentId];
  const stack = report.stack;
  const languages = stack.languages.join(', ') || 'unknown';
  const cmds = [
    stack.buildCommand && `Build: ${stack.buildCommand}`,
    stack.testCommand && `Test: ${stack.testCommand}`,
    stack.lintCommand && `Lint: ${stack.lintCommand}`,
    stack.formatCommand && `Format: ${stack.formatCommand}`,
  ].filter(Boolean).join(' | ');

  const allRefs = getAgentTemplates(agentId);
  const lines: string[] = [];

  lines.push(`# GOAT Flow Setup — ${profile.name}`);
  lines.push('');
  lines.push(`Stack: ${languages}`);
  if (cmds) lines.push(cmds);
  lines.push('');

  lines.push('## How this works');
  lines.push('');
  lines.push('This prompt references template files in the goat-flow project. For each phase:');
  lines.push('1. Read the referenced template file');
  lines.push('2. Adapt it for THIS project (use the detected stack info above)');
  lines.push('3. Create the output file in THIS project');
  lines.push('4. Verify it meets the template\'s requirements');
  lines.push('');
  lines.push('If any template path below is missing, run `goat-flow setup` again to get updated paths.');

  const phases = [
    { phase: 'foundation' as const, heading: 'Phase 1a: Foundation' },
    { phase: 'standard' as const, heading: 'Phase 1b: Standard' },
    { phase: 'full' as const, heading: 'Phase 2: Full' },
  ];

  const languageRefs = mapLanguagesToTemplates(stack.languages);

  for (const { phase, heading } of phases) {
    let phaseRefs = allRefs.filter(r => r.phase === phase && !r.output.startsWith('('));
    if (phase === 'standard') {
      phaseRefs = [...phaseRefs, ...languageRefs];
    }
    const guideRef = allRefs.find(r => r.phase === phase && r.output.startsWith('('));

    if (phaseRefs.length === 0 && !guideRef) continue;

    lines.push('');
    lines.push(`## ${heading}`);
    lines.push('');
    lines.push('Read and adapt these templates:');
    lines.push('');
    lines.push('| Create | Template | Notes |');
    lines.push('|--------|----------|-------|');

    for (const ref of phaseRefs) {
      lines.push(`| ${ref.output} | ${getTemplatePath(ref.template)} | ${ref.note ?? ''} |`);
    }

    if (guideRef) {
      lines.push('');
      lines.push(`Agent-specific setup: ${getTemplatePath(guideRef.template)} (${heading} section)`);
    }

    if (phase === 'standard') {
      lines.push('');
      lines.push('**Skill quality requirements** — each skill MUST include ALL of these sections from the template:');
      lines.push('- **When to Use** — specific triggers, not generic descriptions');
      lines.push('- **Process** with phased steps and human gates between phases');
      lines.push('- **Constraints** (MUST/MUST NOT rules)');
      lines.push('- **Output Format** — define the expected deliverable structure');
      lines.push('- **Chaining** — what skill to suggest next');
      lines.push('Skills should be conversational: present findings, then let the human drill in with follow-ups.');
      lines.push('Offer structured choices at phase transitions, not just yes/no gates.');
    }

    lines.push('');
    lines.push(`GATE: Run \`goat-flow scan . --agent ${agentId}\` — ${phase === 'foundation' ? 'foundation tier must be 100%' : phase === 'standard' ? 'standard tier must be 100%' : 'target 100% across all tiers'}.`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`After completing all phases, run \`goat-flow setup . --agent ${agentId}\` to address any remaining quality gaps.`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect the set of recommendation keys needed for failed/partial checks and triggered anti-patterns */
function collectNeededKeys(agentReport: AgentReport): Set<string> {
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
  return neededKeys;
}

// ---------------------------------------------------------------------------
// Old inline setup — preserved as rollback
// ---------------------------------------------------------------------------

/**
 * Old inline setup composer — preserved as fallback.
 * Activate with GOAT_FLOW_INLINE_SETUP=1.
 */
export function composeInlineSetup(report: ScanReport, agentId: AgentId): ComposedPrompt | null {
  const agentReport = report.agents.find(a => a.agent === agentId);
  const vars = agentReport
    ? extractTemplateVars(report, agentReport)
    : buildFreshVars(report, agentId);

  const allFragments = getAllFragments();
  const phases = [
    { phase: 'foundation' as const, heading: 'Phase 1a: Foundation — Instruction File + Execution Loop' },
    { phase: 'standard' as const, heading: 'Phase 1b: Standard — Skills, Hooks, Learning Loop' },
    { phase: 'full' as const, heading: 'Phase 2: Full — Evals, CI, Hygiene' },
  ];

  const sections: PromptSection[] = phases.map(({ phase, heading }) => {
    const fragments = allFragments
      .filter(fragment => fragment.phase === phase && fragment.kind === 'create')
      .map(fragment => {
        let instruction = fragment.instruction;
        const override = fragment.agentOverrides?.[agentId];
        if (override) instruction = override;
        return { key: fragment.key, category: fragment.category, instruction: fillTemplate(instruction, vars) };
      });
    return { phase, heading, fragments };
  }).filter(s => s.fragments.length > 0);

  return {
    mode: 'setup',
    agent: agentId,
    title: `GOAT Flow Setup — ${vars.agentName}`,
    preamble: buildSetupPreamble(vars),
    sections,
    summary: `Full GOAT Flow setup for ${vars.agentName}. After completing each phase, run \`goat-flow scan .\` to verify progress.`,
  };
}

function buildSetupPreamble(vars: PromptVariables): string {
  const cmds = [
    vars.buildCommand && `**Build:** \`${vars.buildCommand}\``,
    vars.testCommand && `**Test:** \`${vars.testCommand}\``,
    vars.lintCommand && `**Lint:** \`${vars.lintCommand}\``,
    vars.formatCommand && `**Format:** \`${vars.formatCommand}\``,
  ].filter(Boolean).join(' | ');

  return [
    `Set up GOAT Flow for ${vars.agentName}.`,
    '', `**Stack:** ${vars.languages}`, ...(cmds ? [cmds] : []), '',
    'Work through each phase in order. All Phase 1a gates must pass before starting Phase 1b.',
    '', '**Phase 1a** creates the instruction file, execution loop, autonomy tiers, DoD, and enforcement.',
    '**Phase 1b** adds skills, hooks, learning loop files, router table, and architecture docs.',
    '**Phase 2** adds agent evals, CI validation, and hygiene.',
  ].join('\n');
}

function buildFreshVars(report: ScanReport, agentId: AgentId): PromptVariables {
  const profile = PROFILES[agentId];
  return {
    agentId, agentName: profile.name, instructionFile: profile.instructionFile,
    settingsFile: profile.settingsFile ?? '', skillsDir: profile.skillsDir, hooksDir: profile.hooksDir ?? '',
    languages: report.stack.languages.join(', ') || 'unknown',
    buildCommand: report.stack.buildCommand ?? '', testCommand: report.stack.testCommand ?? '',
    lintCommand: report.stack.lintCommand ?? '', formatCommand: report.stack.formatCommand ?? '',
    grade: 'F', percentage: '0', failedCount: '0', passedCount: '0', totalCount: '0',
    date: new Date().toISOString().slice(0, 10),
  };
}
