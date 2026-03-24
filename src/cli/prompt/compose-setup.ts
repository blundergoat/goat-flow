import type { ScanReport, AgentId } from '../types.js';
import type { ComposedPrompt, PromptSection, PromptVariables } from './types.js';
import { getAllFragments } from './registry.js';
import { extractTemplateVars, fillTemplate } from './template-filler.js';
import { PROFILES } from '../detect/agents.js';
import { getTemplatePath } from '../paths.js';
import { getAgentTemplates, validateTemplateRefs, mapLanguagesToTemplates } from './template-refs.js';

/**
 * Compose a reference-based setup prompt for a fresh project.
 * Returns a markdown string that references goat-flow templates by path.
 */
export function composeSetup(report: ScanReport, agentId: AgentId): string | null {
  // Rollback: GOAT_FLOW_INLINE_SETUP=1 activates the old inline renderer
  // The caller must handle this by importing renderPrompt and calling composeInlineSetup
  if (process.env.GOAT_FLOW_INLINE_SETUP === '1') {
    return null;
  }

  // Validate all template paths exist — hard error if any missing
  const missing = validateTemplateRefs(agentId);
  if (missing.length > 0) {
    const list = missing.map(p => `  - ${getTemplatePath(p)}`).join('\n');
    throw new Error(`Missing template files for ${agentId} setup:\n${list}\nRe-install goat-flow or check the installation.`);
  }

  const profile = PROFILES[agentId];
  const stack = report.stack;
  const languages = stack.languages.join(', ') || 'unknown';

  /** Formatted command strings */
  const cmds = [
    stack.buildCommand && `Build: ${stack.buildCommand}`,
    stack.testCommand && `Test: ${stack.testCommand}`,
    stack.lintCommand && `Lint: ${stack.lintCommand}`,
    stack.formatCommand && `Format: ${stack.formatCommand}`,
  ].filter(Boolean).join(' | ');

  const allRefs = getAgentTemplates(agentId);

  const lines: string[] = [];

  // Title
  lines.push(`# GOAT Flow Setup — ${profile.name}`);
  lines.push('');

  // Stack info
  lines.push(`Stack: ${languages}`);
  if (cmds) lines.push(cmds);
  lines.push('');

  // How this works
  lines.push('## How this works');
  lines.push('');
  lines.push('This prompt references template files in the goat-flow project. For each phase:');
  lines.push('1. Read the referenced template file');
  lines.push('2. Adapt it for THIS project (use the detected stack info above)');
  lines.push('3. Create the output file in THIS project');
  lines.push('4. Verify it meets the template\'s requirements');
  lines.push('');
  lines.push('If any template path below is missing, run `goat-flow setup` again to get updated paths.');

  // Render each phase
  const phases = [
    { phase: 'foundation' as const, heading: 'Phase 1a: Foundation' },
    { phase: 'standard' as const, heading: 'Phase 1b: Standard' },
    { phase: 'full' as const, heading: 'Phase 2: Full' },
  ];

  /** Coding-standards refs dynamically generated from detected stack languages */
  const languageRefs = mapLanguagesToTemplates(stack.languages);

  for (const { phase, heading } of phases) {
    /** Template refs for this phase, excluding setup guide meta-refs */
    let phaseRefs = allRefs.filter(r => r.phase === phase && !r.output.startsWith('('));

    // Append language-based coding-standards refs to the standard phase
    if (phase === 'standard') {
      phaseRefs = [...phaseRefs, ...languageRefs];
    }

    /** Setup guide meta-ref for this phase */
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

    // Add skill quality requirements after Phase 1b table
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
    lines.push(`GATE: Run \`goat-flow scan . --agent ${agentId}\` — ${phase === 'foundation' ? 'foundation tier should pass' : phase === 'standard' ? 'standard tier should mostly pass' : 'target A grade'}.`);
  }

  // Second-pass fix recommendation
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`After completing all phases, run \`goat-flow fix . --agent ${agentId}\` to address quality gaps (real incidents for footguns, git-history lessons, hook hardening).`);

  return lines.join('\n');
}

/**
 * Old inline setup composer — preserved as fallback.
 * Activate with GOAT_FLOW_INLINE_SETUP=1.
 */
export function composeInlineSetup(report: ScanReport, agentId: AgentId): ComposedPrompt | null {
  /** Agent-specific report extracted from the scan, if one exists */
  const agentReport = report.agents.find(a => a.agent === agentId);

  // For setup mode on a project with no agents, create a synthetic agent report
  /** Template variables, either from existing report or synthesised for a fresh project */
  const vars = agentReport
    ? extractTemplateVars(report, agentReport)
    : buildFreshVars(report, agentId);

  /** Every registered fragment across all phases */
  const allFragments = getAllFragments();

  /** Phase definitions with display headings, ordered for sequential setup */
  const phases = [
    { phase: 'foundation' as const, heading: 'Phase 1a: Foundation — Instruction File + Execution Loop' },
    { phase: 'standard' as const, heading: 'Phase 1b: Standard — Skills, Hooks, Learning Loop' },
    { phase: 'full' as const, heading: 'Phase 2: Full — Evals, CI, Hygiene' },
  ];

  /** Sections built by mapping each phase to its matching create-kind fragments */
  const sections: PromptSection[] = phases.map(({ phase, heading }) => {
    /** Fragments filtered to this phase with create kind, then template-filled */
    const fragments = allFragments
      .filter(fragment => fragment.phase === phase && fragment.kind === 'create')
      .map(fragment => {
        let instruction = fragment.instruction;
        const override = fragment.agentOverrides?.[agentId];
        if (override) {
          instruction = override;
        }
        return {
          key: fragment.key,
          category: fragment.category,
          instruction: fillTemplate(instruction, vars),
        };
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

/** Build the setup preamble describing the stack and phase progression */
function buildSetupPreamble(vars: PromptVariables): string {
  /** Formatted command strings for build, test, lint, and format */
  const cmds = [
    vars.buildCommand && `**Build:** \`${vars.buildCommand}\``,
    vars.testCommand && `**Test:** \`${vars.testCommand}\``,
    vars.lintCommand && `**Lint:** \`${vars.lintCommand}\``,
    vars.formatCommand && `**Format:** \`${vars.formatCommand}\``,
  ].filter(Boolean).join(' | ');

  return [
    `Set up GOAT Flow for ${vars.agentName}.`,
    '',
    `**Stack:** ${vars.languages}`,
    ...(cmds ? [cmds] : []),
    '',
    'Work through each phase in order. All Phase 1a gates must pass before starting Phase 1b.',
    '',
    '**Phase 1a** creates the instruction file, execution loop, autonomy tiers, DoD, and enforcement.',
    '**Phase 1b** adds skills, hooks, learning loop files, router table, and architecture docs.',
    '**Phase 2** adds agent evals, CI validation, and hygiene.',
  ].join('\n');
}

/** Build synthetic template variables for a project with no existing agent config */
function buildFreshVars(report: ScanReport, agentId: AgentId): PromptVariables {
  const profile = PROFILES[agentId];

  return {
    agentId,
    agentName: profile.name,
    instructionFile: profile.instructionFile,
    settingsFile: profile.settingsFile ?? '',
    skillsDir: profile.skillsDir,
    hooksDir: profile.hooksDir ?? '',
    languages: report.stack.languages.join(', ') || 'unknown',
    buildCommand: report.stack.buildCommand ?? '',
    testCommand: report.stack.testCommand ?? '',
    lintCommand: report.stack.lintCommand ?? '',
    formatCommand: report.stack.formatCommand ?? '',
    grade: 'F',
    percentage: '0',
    failedCount: '0',
    passedCount: '0',
    totalCount: '0',
    date: new Date().toISOString().slice(0, 10),
  };
}
