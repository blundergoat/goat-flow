import type { ScanReport, AgentId, AgentReport } from '../types.js';
import type { ComposedPrompt, PromptSection, PromptVariables, FragmentPhase, SetupTask } from './types.js';
import { getAllFragments, getFragment } from './registry.js';
import { extractTemplateVars, fillTemplate } from './template-filler.js';
import { PROFILES } from '../detect/agents.js';
import { getTemplatePath, getCliCommand } from '../paths.js';
import { getAgentTemplates, validateTemplateRefs, mapLanguagesToTemplates, getFragmentTemplate, getLanguageTemplate } from './template-refs.js';

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

  // No agents detected → redirect to setup guide
  if (!agentReport) {
    return renderSetupRedirect(report, agentId, null);
  }

  const percentage = agentReport.score.percentage;

  if (percentage === 100) {
    return renderAllPass(agentId, agentReport);
  }
  if (percentage >= SHORT_FIX_THRESHOLD) {
    return renderShortFix(report, agentId, agentReport);
  }
  if (percentage >= 50) {
    return renderTargetedFix(report, agentId, agentReport);
  }
  // Under 50% — too many issues for targeted fixes, redirect to full setup guide
  return renderSetupRedirect(report, agentId, agentReport);
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
  const triggeredAPs = agentReport.antiPatterns.filter(ap => ap.triggered).length;
  const countText = triggeredAPs > 0
    ? `${vars.failedCount} checks + ${triggeredAPs} anti-patterns remaining.`
    : `${vars.failedCount} checks remaining.`;
  lines.push(`This project scores **${agentReport.score.grade}** (${agentReport.score.percentage}%). ${countText}`);
  lines.push('');

  // Collect needed fragment keys
  const neededKeys = collectNeededKeys(agentReport);

  // Even if no check keys, anti-patterns may still need fixing
  const triggered = agentReport.antiPatterns.filter(ap => ap.triggered);

  if (neededKeys.size === 0 && triggered.length === 0) {
    lines.push('No actionable fixes found.');
    return lines.join('\n');
  }

  // Render each failing check with its recommendation or fragment content
  for (const key of neededKeys) {
    const fragment = getFragment(key);
    if (!fragment) continue;
    // Skip AP fragments here — they're rendered below with evidence
    if (fragment.phase === 'anti-pattern') continue;
    const templatePath = getFragmentTemplate(key, agentId);
    if (templatePath) {
      lines.push(`- **${fragment.category}**: Adapt from ${getTemplatePath(templatePath)}`);
    } else {
      const matchingRec = agentReport.recommendations.find(r => r.checkId && agentReport.checks.some(c => c.id === r.checkId && c.recommendationKey === key));
      if (matchingRec) {
        lines.push(`- **${fragment.category}**: ${matchingRec.action}`);
      } else {
        const override = fragment.agentOverrides?.[agentId];
        const instruction = fillTemplate(override ?? fragment.instruction, vars);
        lines.push(`- **${fragment.category}**: ${instruction.split('\n')[0] ?? ''}`);
      }
    }
  }

  // Anti-patterns — render full fragment instructions with evidence
  if (triggered.length > 0) {
    lines.push('');
    lines.push('**Anti-patterns to fix:**');
    lines.push('');
    for (const ap of triggered) {
      const fragment = ap.recommendationKey ? getFragment(ap.recommendationKey) : undefined;
      if (fragment) {
        const override = fragment.agentOverrides?.[agentId];
        const instruction = fillTemplate(override ?? fragment.instruction, vars);
        lines.push(`### ${ap.id}: ${ap.name} (${ap.deduction} pts)`);
        lines.push('');
        // Include scan evidence if available
        if (ap.evidence) {
          lines.push(`**Evidence:** ${ap.evidence}`);
          lines.push('');
        }
        lines.push(instruction);
        lines.push('');
      } else {
        lines.push(`- **${ap.id}**: ${ap.message}`);
      }
    }
  }

  lines.push('');
  lines.push(`**Target: 100% with zero anti-pattern deductions.**`);
  lines.push(`Re-run: \`${getCliCommand()} scan . --agent ${agentId}\``);
  lines.push(`If not 100%, run \`${getCliCommand()} setup . --agent ${agentId}\` for fix instructions. Repeat until 100% (max 3 cycles).`);

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

      // Prefer language-specific template when available (e.g., php.md over generic conventions.md)
      const langTemplate = getLanguageTemplate(key, report.stack.languages);
      const templatePath = langTemplate ?? getFragmentTemplate(key, agentId);
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

    // Render template refs as numbered tasks
    let taskNum = 1;
    if (templateRefs.length > 0) {
      const skillRefs = templateRefs.filter(r => r.key.startsWith('create-skill-'));
      const nonSkillRefs = templateRefs.filter(r => !r.key.startsWith('create-skill-'));

      // Skills as numbered tasks
      if (skillRefs.length > 0) {
        lines.push(`**Missing Skills (${skillRefs.length} of 10)** — create in \`${PROFILES[agentId].skillsDir}/goat-{name}/SKILL.md\``);
        lines.push('');
        for (const ref of skillRefs) {
          const name = ref.key.replace('create-skill-', 'goat-');
          lines.push(renderTask({ num: taskNum++, outputPath: `${PROFILES[agentId].skillsDir}/${name}/SKILL.md`, templatePath: getTemplatePath(ref.template), adapt: defaultAdaptGuidance(ref.key, undefined, vars.languages), verify: defaultVerify(ref.key) }));
          lines.push('');
        }
      }

      // Non-skill template refs as tasks
      for (const ref of nonSkillRefs) {
        // Skip skill-quality refs — they're guidance, not file creation
        if (ref.key.startsWith('add-skill-') || ref.key === 'create-all-skills') continue;
        const outputPath = ref.key.replace(/^create-/, '').replace(/-/g, '/');
        const fragment = getFragment(ref.key);
        lines.push(renderTask({ num: taskNum++, outputPath: fragment?.category ?? outputPath, templatePath: getTemplatePath(ref.template), adapt: defaultAdaptGuidance(ref.key, undefined, vars.languages), verify: defaultVerify(ref.key) }));
        lines.push('');
      }
    }

    // Inline fragments (fix-kind or fragments without template)
    for (const frag of inlineFragments) {
      lines.push(frag.instruction);
      lines.push('');
    }

    if (phase === 'standard') {
      lines.push('**Skill quality check** — every skill MUST have: **When to Use**, **Process** (phased + human gates), **Constraints**, **Output Format**, **Chaining**. No placeholder text.');
      lines.push('');
      if (vars.languages && vars.languages !== 'unknown') {
        lines.push(`**Adaptation for this project:** Replace template Step 0 questions with questions about ${vars.languages} patterns. Replace template examples with patterns from this codebase. Do NOT leave placeholder text like "[Step 1]" or "[describe X]".`);
        lines.push('');
      }
    }

    if (phase !== 'anti-pattern') {
      lines.push(`**GATE:** Run \`${getCliCommand()} scan . --agent ${agentId}\``);
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('');
  lines.push(`After completing fixes, re-run \`${getCliCommand()} setup . --agent ${agentId}\` to check for remaining issues.`);

  return lines.join('\n');
}

/** Render a SetupTask as a numbered markdown block */
function renderTask(task: SetupTask): string {
  const lines: string[] = [];
  lines.push(`### Task ${task.num}: Create \`${task.outputPath}\``);
  lines.push('');
  lines.push(`1. **Read template:** ${task.templatePath}`);
  lines.push(`2. **Adapt:** ${task.adapt}`);
  lines.push(`3. **Verify:** ${task.verify}`);
  return lines.join('\n');
}

/** Default adaptation guidance based on output path patterns */
function defaultAdaptGuidance(output: string, note: string | undefined, languages: string): string {
  // Path-specific guidance takes precedence over generic notes
  if (output.includes('/skills/')) return `Replace template Step 0 questions and examples with ${languages} patterns from this project`;
  if (output === 'docs/footguns.md') return `Run \`grep -rn 'TODO\\|FIXME\\|HACK' src/ | head -20\` to find real traps. Every entry needs \`file:line\` evidence. No hypotheticals`;
  if (output === 'docs/lessons.md') return `Run \`git log --oneline -50 | grep -iE 'fix|revert|hotfix|bug'\` to find real incidents. Seed 3+ entries`;
  if (output === 'docs/architecture.md') return 'Read project entry points and main directories. Document what exists — under 100 lines, no aspirational content';
  if (output.includes('instructions/')) return `Adapt for this project's ${languages} patterns. Replace generic examples with real patterns from the codebase`;
  // Fall back to template ref note or generic
  if (note) return note;
  return 'Adapt template for this project — replace generic examples with real project patterns';
}

/** Default verification text for a task */
function defaultVerify(output: string): string {
  if (output.includes('/skills/')) return 'File has: When to Use, Process with human gates, Constraints, Output Format, Chaining sections';
  if (output === 'docs/footguns.md') return 'File exists, has 3+ entries, each with backtick-wrapped `path:line` evidence';
  if (output === 'docs/lessons.md') return 'File exists, has entries with ### headings and 20+ chars of content each';
  if (output === 'docs/architecture.md') return 'File exists and is under 100 lines';
  if (output.endsWith('.sh')) return '`bash -n <file>` passes (no syntax errors)';
  if (output.endsWith('.json')) return 'Valid JSON (no parse errors)';
  if (output.endsWith('.yml')) return 'Valid YAML';
  return 'File exists and has project-specific content (not placeholder text)';
}

// renderFullSetup removed — all new/low-scoring projects use renderSetupRedirect
// which points agents at setup/setup-{agent}.md instead of generating inline tasks.

// ---------------------------------------------------------------------------
// Mode: Multi-agent deduplicated setup
// ---------------------------------------------------------------------------

/**
 * Compose a deduplicated setup for multiple agents.
 * Shared files (docs, skills, coding-standards, evals, CI) appear once.
 * Per-agent files (instruction file, settings, hooks) appear in agent sections.
 */
export function composeMultiAgentSetup(report: ScanReport, agentIds: AgentId[]): string {
  // Validate template refs for ALL agents (same guarantee as single-agent path)
  for (const id of agentIds) {
    const missing = validateTemplateRefs(id);
    if (missing.length > 0) {
      const list = missing.map(p => `  - ${getTemplatePath(p)}`).join('\n');
      throw new Error(`Missing template files for ${id} setup:\n${list}\nRe-install goat-flow or check the installation.`);
    }
  }

  const lines: string[] = [];
  const stack = report.stack;
  const languages = stack.languages.join(', ') || 'unknown';
  const cmds = [
    stack.buildCommand && `Build: ${stack.buildCommand}`,
    stack.testCommand && `Test: ${stack.testCommand}`,
    stack.lintCommand && `Lint: ${stack.lintCommand}`,
    stack.formatCommand && `Format: ${stack.formatCommand}`,
  ].filter(Boolean).join(' | ');

  lines.push('# GOAT Flow Setup — All Agents');
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
  lines.push(`If any template path below is missing, run \`${getCliCommand()} setup\` again to get updated paths.`);
  lines.push('');

  // Gather shared refs — use generic skill paths instead of first agent's paths
  const firstId = agentIds[0]!;
  const allRefs = getAgentTemplates(firstId);
  const languageRefs = mapLanguagesToTemplates(stack.languages);
  const standardShared = allRefs.filter(r => r.phase === 'standard' && !r.output.startsWith('('));
  const fullShared = allRefs.filter(r => r.phase === 'full' && !r.output.startsWith('('));

  // --- Per-agent foundation sections ---
  for (const agentId of agentIds) {
    const profile = PROFILES[agentId];
    const agentFoundation = getAgentTemplates(agentId).filter(r => r.phase === 'foundation' && !r.output.startsWith('('));
    const guideRef = getAgentTemplates(agentId).find(r => r.output.startsWith('(') && r.phase === 'foundation');

    lines.push(`## ${profile.name} — Foundation`);
    lines.push('');
    let taskNum = 1;
    for (const ref of agentFoundation) {
      lines.push(renderTask({ num: taskNum++, outputPath: ref.output, templatePath: getTemplatePath(ref.template), adapt: defaultAdaptGuidance(ref.output, ref.note, languages), verify: defaultVerify(ref.output) }));
      lines.push('');
    }
    if (guideRef) {
      lines.push(`> **Agent-specific details:** Also read ${getTemplatePath(guideRef.template)} (foundation section)`);
      lines.push('');
    }
  }

  lines.push(`**GATE:** Run \`${getCliCommand()} scan .\` — foundation tier must be 100% for all agents.`);
  lines.push('');

  // --- Shared standard phase ---
  lines.push('## Standard (shared across all agents)');
  lines.push('');
  let taskNum = 1;
  for (const ref of [...standardShared, ...languageRefs]) {
    const output = ref.output.includes('/skills/') ? ref.output.replace(/\.[^/]+\/skills\//, '{skills_dir}/') : ref.output;
    lines.push(renderTask({ num: taskNum++, outputPath: output, templatePath: getTemplatePath(ref.template), adapt: defaultAdaptGuidance(output, ref.note, languages), verify: defaultVerify(output) }));
    lines.push('');
  }
  lines.push('Skills go in each agent\'s skills directory: `.claude/skills/`, `.agents/skills/`');
  lines.push('');
  lines.push('**Skill quality check** — every skill file MUST have: **When to Use**, **Process** (phased + human gates), **Constraints**, **Output Format**, **Chaining**. No placeholder text.');
  lines.push('');
  lines.push(`**GATE:** Run \`${getCliCommand()} scan .\` — standard tier must be 100% for all agents.`);
  lines.push('');

  // --- Shared full phase ---
  lines.push('## Full (shared across all agents)');
  lines.push('');
  taskNum = 1;
  for (const ref of fullShared) {
    lines.push(renderTask({ num: taskNum++, outputPath: ref.output, templatePath: getTemplatePath(ref.template), adapt: defaultAdaptGuidance(ref.output, ref.note, languages), verify: defaultVerify(ref.output) }));
    lines.push('');
  }
  lines.push(`**GATE:** Run \`${getCliCommand()} scan .\` — target 100% across all agents.`);
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push(`After completing all phases, run \`${getCliCommand()} setup .\` to check for remaining issues.`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Mode: Setup redirect (under 50% — too many issues for inline fixes)
// ---------------------------------------------------------------------------

/** Map agent IDs to their setup file paths */
const SETUP_FILES: Record<AgentId, string> = {
  claude: 'setup/setup-claude.md',
  codex: 'setup/setup-codex.md',
  gemini: 'setup/setup-gemini.md',
};

function renderSetupRedirect(report: ScanReport, agentId: AgentId, agentReport: AgentReport | null): string {
  const profile = PROFILES[agentId];
  const setupFile = getTemplatePath(SETUP_FILES[agentId]);
  const stack = report.stack;
  const languages = stack.languages.join(', ') || 'unknown';
  const lines: string[] = [];

  lines.push(`# GOAT Flow Setup — ${profile.name}`);
  lines.push('');
  if (agentReport) {
    lines.push(`This project scores **${agentReport.score.grade}** (${agentReport.score.percentage}%) — it needs a full setup pass.`);
  } else {
    lines.push(`No ${profile.name} configuration detected — this project needs a full setup.`);
  }
  lines.push('');

  // Project context — detected stack info
  lines.push(`**Stack:** ${languages}`);
  const cmds = [
    stack.buildCommand && `**Build:** \`${stack.buildCommand}\``,
    stack.testCommand && `**Test:** \`${stack.testCommand}\``,
    stack.lintCommand && `**Lint:** \`${stack.lintCommand}\``,
  ].filter(Boolean).join(' | ');
  if (cmds) lines.push(cmds);
  lines.push('');

  // Pre-instructions
  lines.push('## Before you start');
  lines.push('');
  lines.push('1. Verify the detected stack above is correct. If not, the setup file will');
  lines.push('   ask you to detect it from the actual codebase (package.json, composer.json, etc.)');
  lines.push('2. "Adapt" means: replace generic examples with THIS project\'s real examples.');
  lines.push('   Skills: replace generic Step 0 questions with questions specific to this stack.');
  lines.push('   Footguns: only real traps from THIS codebase with `file:line` evidence.');
  lines.push('   Conventions: real build/test/lint commands, real file naming patterns.');
  lines.push('3. Do NOT copy templates verbatim. If a template says "[describe X]", describe X for THIS project.');
  lines.push('');

  // Main instruction
  lines.push('## Setup instructions');
  lines.push('');
  lines.push(`Deeply review and implement the instructions in: \`${setupFile}\``);
  lines.push('');
  lines.push('That file walks through:');
  lines.push('- **Phase 1a:** Instruction file, docs seed files, local instruction files');
  lines.push('- **Phase 1b:** 10 goat-* skills adapted for this project');
  lines.push('- **Phase 1c:** Enforcement hooks, deny patterns, coding guidelines');
  lines.push('- **Phase 2:** Agent evals, hygiene (handoff template, RFC 2119 pass)');
  lines.push('- **Phase 3:** Verify 100% on the CLI scan');
  lines.push('');

  // Scan + iterate
  lines.push(`After completing setup, run: \`${getCliCommand()} scan . --agent ${agentId}\``);
  lines.push('');
  lines.push('**Target: 100% with zero anti-pattern deductions.**');
  lines.push(`If not 100%, run \`${getCliCommand()} setup . --agent ${agentId}\` for remaining fix instructions. Repeat until 100% (max 3 cycles).`);

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
    summary: `Full GOAT Flow setup for ${vars.agentName}. After completing each phase, run \`${getCliCommand()} scan .\` to verify progress.`,
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
    evidence: {},
  };
}
