import type { ScanReport, AgentId } from '../types.js';
import type { ComposedPrompt, PromptSection, PromptVariables } from './types.js';
import { getAllFragments } from './registry.js';
import { extractVariables, fillTemplate } from './variables.js';

/**
 * Compose a full setup prompt for a fresh project.
 * Includes ALL fragments grouped by phase, pre-filled with detected facts.
 */
export function composeSetup(report: ScanReport, agentId: AgentId): ComposedPrompt | null {
  /** Agent-specific report extracted from the scan, if one exists */
  const agentReport = report.agents.find(a => a.agent === agentId);

  // For setup mode on a project with no agents, create a synthetic agent report
  /** Template variables, either from existing report or synthesised for a fresh project */
  const vars = agentReport
    ? extractVariables(report, agentReport)
    : buildFreshVars(report, agentId);

  /** Every registered fragment across all phases */
  const allFragments = getAllFragments();

  /** Phase definitions with display headings, ordered for sequential setup */
  const phases = [
    { phase: 'foundation' as const, heading: 'Phase 1a: Foundation — Instruction File + Execution Loop' },
    { phase: 'standard' as const, heading: 'Phase 1b: Standard — Skills, Hooks, Learning Loop' },
    { phase: 'full' as const, heading: 'Phase 2: Full — Evals, CI, Profiles, Hygiene' },
  ];

  /** Sections built by mapping each phase to its matching create-kind fragments */
  const sections: PromptSection[] = phases.map(({ phase, heading }) => {
    /** Fragments filtered to this phase with create kind, then template-filled */
    const fragments = allFragments
      .filter(f => f.phase === phase && f.kind === 'create')
      .map(f => {
        let instruction = f.instruction;
        if (f.agentOverrides?.[agentId]) {
          instruction = f.agentOverrides[agentId]!;
        }
        return {
          key: f.key,
          category: f.category,
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
    '**Phase 2** adds agent evals, CI validation, permission profiles, and hygiene.',
  ].join('\n');
}

/** Build synthetic template variables for a project with no existing agent config */
function buildFreshVars(report: ScanReport, agentId: AgentId): PromptVariables {
  /** Per-agent defaults for instruction file, settings, skills dir, and hooks dir */
  const AGENT_INFO = {
    claude: { name: 'Claude Code', instruction: 'CLAUDE.md', settings: '.claude/settings.json', skills: '.claude/skills', hooks: '.claude/hooks' },
    codex: { name: 'Codex', instruction: 'AGENTS.md', settings: '(none)', skills: '.agents/skills', hooks: 'scripts/' },
    gemini: { name: 'Gemini CLI', instruction: 'GEMINI.md', settings: '.gemini/settings.json', skills: '.agents/skills', hooks: '.gemini/hooks' },
  };
  /** Resolved info for the target agent */
  const info = AGENT_INFO[agentId];

  return {
    agentId,
    agentName: info.name,
    instructionFile: info.instruction,
    settingsFile: info.settings,
    skillsDir: info.skills,
    hooksDir: info.hooks,
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
