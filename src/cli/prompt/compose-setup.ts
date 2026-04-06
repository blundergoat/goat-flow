/**
 * Composes setup, fix, and redirect prompts from scan results.
 * This is the main policy layer that turns rubric failures, detected signals, and template refs into agent-facing task lists.
 */
import type {
  ScanReport,
  AgentId,
  AgentReport,
  ProjectSignals,
} from '../types.js';
import { SKILL_NAMES } from '../constants.js';
import type {
  PromptVariables,
  FragmentPhase,
  SetupTask,
} from './types.js';
import { getFragment } from './registry.js';
import { extractTemplateVars, fillTemplate } from './template-filler.js';
import { PROFILES } from '../detect/agents.js';
import { getTemplatePath, getCliCommand } from '../paths.js';
import { classifyProjectState } from '../classify-state.js';
import { createFS } from '../facts/fs.js';
import {
  getAgentTemplates,
  validateTemplateRefs,
  mapLanguagesToTemplates,
  mapSignalsToTemplates,
  getFragmentTemplate,
  getLanguageTemplate,
} from './template-refs.js';

/** Projects at or above this percentage get the short fix list instead of targeted fix */
const SHORT_FIX_THRESHOLD = 90;

/** Format static analysis tools. */
function formatStaticAnalysisTools(
  signals: ProjectSignals,
  withLevelLabel: boolean,
): string {
  return signals.staticAnalysis
    .map((signal) => {
      if (!signal.level) return signal.tool;
      return withLevelLabel
        ? `${signal.tool} level ${signal.level}`
        : `${signal.tool} (${signal.level})`;
    })
    .join(', ');
}

/** Collect signal summary parts. */
function collectSignalSummaryParts(signals: ProjectSignals): string[] {
  const parts: string[] = [];
  if (signals.codeGenTools.length > 0)
    parts.push(`**Code gen:** ${signals.codeGenTools.join(', ')}`);
  if (signals.deployPlatforms.length > 0)
    parts.push(`**Deploy:** ${signals.deployPlatforms.join(', ')}`);
  if (signals.llmIntegration) parts.push('**LLM integration detected**');
  if (signals.staticAnalysis.length > 0)
    parts.push(
      `**Static analysis:** ${formatStaticAnalysisTools(signals, false)}`,
    );
  return parts;
}

/** Collect signal action lines. */
function collectSignalActionLines(signals: ProjectSignals): string[] {
  const actions: string[] = [];
  if (signals.llmIntegration) {
    actions.push(
      '- **LLM integration:** Add prompt/template file paths to the Router Table. Add "prompt changes require scenario testing" to Ask First boundaries. Seed a learning-loop entry for prompt-regression risk.',
    );
  }
  if (signals.staticAnalysis.length > 0) {
    const tools = formatStaticAnalysisTools(signals, true);
    actions.push(
      `- **Static analysis (${tools}):** Verify the linter is enforced in hooks (stop-lint.sh), not just configured. Add \`<important if="editing source files">MUST maintain ${tools} compliance</important>\` to the instruction file (conditional tag keeps it contextual).`,
    );
  }
  return actions;
}

/** Append signal-specific lines (code gen, deploy, LLM, compliance) and actionable follow-up tasks to the prompt output. */
function renderSignals(lines: string[], signals: ProjectSignals): void {
  const parts = collectSignalSummaryParts(signals);
  if (parts.length > 0) {
    lines.push('');
    lines.push(parts.join(' | '));
  }

  const actions = collectSignalActionLines(signals);
  if (actions.length > 0) {
    lines.push('');
    lines.push('**Signal-driven setup tasks:**');
    lines.push(...actions);
  }
}

/** Anti-patterns are rendered before tiers so critical issues surface at the top of the fix list. */
const PHASE_ORDER: FragmentPhase[] = [
  'anti-pattern',
  'foundation',
  'standard',
  'full',
];
/** Human-readable heading text for each setup phase. */
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
export function composeSetup(
  report: ScanReport,
  agentId: AgentId,
): string | null {
  const agentReport = report.agents.find((a) => a.agent === agentId);

  // No agents detected → redirect to setup guide
  if (!agentReport) {
    return renderSetupRedirect(report, agentId, null);
  }

  const percentage = agentReport.score.percentage;

  if (percentage === 100) {
    return renderAllPass(agentId, agentReport, report);
  }
  if (percentage >= SHORT_FIX_THRESHOLD) {
    return renderShortFix(report, agentId, agentReport);
  }
  if (percentage >= 50) {
    return renderTargetedFix(report, agentId, agentReport);
  }
  // Under 50% - too many issues for targeted fixes, redirect to full setup guide
  return renderSetupRedirect(report, agentId, agentReport);
}

// ---------------------------------------------------------------------------
// Mode: All pass (100%)
// ---------------------------------------------------------------------------

/** Render congratulatory message when all checks pass (100%). */
function renderAllPass(
  agentId: AgentId,
  agentReport: AgentReport,
  report?: ScanReport,
): string {
  const profile = PROFILES[agentId];
  const lines: string[] = [];
  lines.push(`# GOAT Flow Setup - ${profile.name}`);
  lines.push('');
  lines.push(
    `All checks pass (${agentReport.score.grade}, ${agentReport.score.percentage}%).`,
  );
  lines.push('');

  // Summary of what's installed
  const facts = report?.agents.find((a) => a.agent === agentId);
  if (facts) {
    const checks = agentReport.checks;
    const skillCount = checks.filter(
      (c) => c.category === 'Skills' && c.status === 'pass',
    ).length;
    const hookCount = [
      checks.find((c) => c.id === '2.2.1')?.status === 'pass',
      checks.find((c) => c.id === '2.2.3')?.status === 'pass',
      checks.find((c) => c.id === '2.2.4')?.status === 'pass',
    ].filter(Boolean).length;

    lines.push('**Installed:**');
    if (skillCount > 0) lines.push(`- ${skillCount} skill checks passing`);
    if (hookCount > 0)
      lines.push(`- ${hookCount} hooks (deny, stop-lint, format)`);
    lines.push(
      `- Score: ${agentReport.score.tiers.foundation.earned}/${agentReport.score.tiers.foundation.available} foundation, ${agentReport.score.tiers.standard.earned}/${agentReport.score.tiers.standard.available} standard, ${agentReport.score.tiers.full.earned}/${agentReport.score.tiers.full.available} full`,
    );
    lines.push('');
  }

  lines.push('**Maintenance:**');
  lines.push(
    '- After upgrading goat-flow, re-run `goat-flow setup` to check for new checks',
  );
  lines.push('- Run `goat-flow scan --min-score 90` in CI to catch drift');
  lines.push(
    '- Review `ai-docs/footguns/`, `.goat-flow/footguns/`, `ai-docs/lessons/`, and `.goat-flow/lessons/` after incidents',
  );

  return lines.join('\n');
}

/** Return triggered anti patterns. */
function getTriggeredAntiPatterns(
  agentReport: AgentReport,
): AgentReport['antiPatterns'] {
  return agentReport.antiPatterns.filter((ap) => ap.triggered);
}

/** Render short fix summary line. */
function renderShortFixSummaryLine(
  agentReport: AgentReport,
  failedCount: string,
  triggeredCount: number,
): string {
  const countText =
    triggeredCount > 0
      ? `${failedCount} checks + ${triggeredCount} anti-patterns remaining.`
      : `${failedCount} checks remaining.`;
  return `This project scores **${agentReport.score.grade}** (${agentReport.score.percentage}%). ${countText}`;
}

/** Find recommendation action. */
function findRecommendationAction(
  agentReport: AgentReport,
  key: string,
): string | null {
  const recommendation = agentReport.recommendations.find(
    (item) =>
      item.checkId &&
      agentReport.checks.some(
        (check) => check.id === item.checkId && check.recommendationKey === key,
      ),
  );
  return recommendation?.action ?? null;
}

/** Render short fix item. */
function renderShortFixItem(
  key: string,
  agentId: AgentId,
  agentReport: AgentReport,
  vars: PromptVariables,
): string | null {
  const fragment = getFragment(key);
  if (!fragment || fragment.phase === 'anti-pattern') return null;

  const isSkillQuality =
    key.startsWith('add-skill-') || key === 'create-all-skills';
  const templatePath = isSkillQuality
    ? null
    : getFragmentTemplate(key, agentId);
  if (templatePath) {
    return `- **${fragment.category}**: Adapt from ${getTemplatePath(templatePath)}`;
  }

  const recommendationAction = findRecommendationAction(agentReport, key);
  if (recommendationAction) {
    return `- **${fragment.category}**: ${recommendationAction}`;
  }

  const override = fragment.agentOverrides?.[agentId];
  const instruction = fillTemplate(override ?? fragment.instruction, vars);
  return `- **${fragment.category}**: ${instruction.split('\n')[0] ?? ''}`;
}

/** Render short fix items. */
function renderShortFixItems(
  lines: string[],
  neededKeys: Set<string>,
  agentId: AgentId,
  agentReport: AgentReport,
  vars: PromptVariables,
): void {
  for (const key of neededKeys) {
    const line = renderShortFixItem(key, agentId, agentReport, vars);
    if (line) lines.push(line);
  }
}

/** Render triggered anti pattern fixes. */
function renderTriggeredAntiPatternFixes(
  lines: string[],
  triggered: AgentReport['antiPatterns'],
  agentId: AgentId,
  vars: PromptVariables,
): void {
  if (triggered.length === 0) return;

  lines.push('');
  lines.push('**Anti-patterns to fix:**');
  lines.push('');
  for (const antiPattern of triggered) {
    const fragment = antiPattern.recommendationKey
      ? getFragment(antiPattern.recommendationKey)
      : undefined;
    if (!fragment) {
      lines.push(`- **${antiPattern.id}**: ${antiPattern.message}`);
      continue;
    }

    const override = fragment.agentOverrides?.[agentId];
    const instruction = fillTemplate(override ?? fragment.instruction, vars);
    lines.push(
      `### ${antiPattern.id}: ${antiPattern.name} (${antiPattern.deduction} pts)`,
    );
    lines.push('');
    if (antiPattern.evidence) {
      lines.push(`**Evidence:** ${antiPattern.evidence}`);
      lines.push('');
    }
    lines.push(instruction);
    lines.push('');
  }
}

// ---------------------------------------------------------------------------
// Mode: Short fix (90-99%)
// ---------------------------------------------------------------------------

/** Compose a short fix prompt for projects scoring 90-99%. */
function renderShortFix(
  report: ScanReport,
  agentId: AgentId,
  agentReport: AgentReport,
): string {
  const profile = PROFILES[agentId];
  const vars = extractTemplateVars(report, agentReport);
  const lines: string[] = [];
  const neededKeys = collectNeededKeys(agentReport);
  const triggered = getTriggeredAntiPatterns(agentReport);

  lines.push(`# GOAT Flow Setup - ${profile.name}`);
  lines.push('');
  lines.push(
    renderShortFixSummaryLine(agentReport, vars.failedCount, triggered.length),
  );
  renderSignals(lines, report.stack.signals);
  lines.push('');

  if (neededKeys.size === 0 && triggered.length === 0) {
    lines.push('No actionable fixes found.');
    return lines.join('\n');
  }

  renderShortFixItems(lines, neededKeys, agentId, agentReport, vars);
  renderTriggeredAntiPatternFixes(lines, triggered, agentId, vars);

  lines.push('');
  lines.push(`**Target: 100% with zero anti-pattern deductions.**`);
  lines.push(`Re-run: \`${getCliCommand()} scan . --agent ${agentId}\``);
  lines.push(
    `If not 100%, run \`${getCliCommand()} setup . --agent ${agentId}\` for fix instructions. Repeat until 100% (max 3 cycles).`,
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Mode: Targeted fix (1-89%)
// ---------------------------------------------------------------------------

/** Template reference used in targeted fix mode. */
interface TargetedTemplateRef {
  category: string;
  key: string;
  template: string;
}

/** Inline fragment rendered directly in targeted fix mode. */
interface TargetedInlineFragment {
  category: string;
  instruction: string;
}

/** Build command summary. */
function buildCommandSummary(
  parts: Array<string | false | null | undefined>,
): string {
  return parts.filter(Boolean).join(' | ');
}

/** Render targeted fix header. */
function renderTargetedFixHeader(
  lines: string[],
  profileName: string,
  agentReport: AgentReport,
  vars: PromptVariables,
): void {
  lines.push(`# GOAT Flow Setup - ${profileName}`);
  lines.push('');
  lines.push(
    `This project scores **${agentReport.score.grade}** (${agentReport.score.percentage}%) for ${profileName}.`,
  );
  lines.push(
    `**${vars.failedCount}** checks need attention out of ${vars.totalCount} total.`,
  );
  lines.push('');
  lines.push(`**Stack:** ${vars.languages}`);
  const commands = buildCommandSummary([
    vars.buildCommand && `**Build:** \`${vars.buildCommand}\``,
    vars.testCommand && `**Test:** \`${vars.testCommand}\``,
    vars.lintCommand && `**Lint:** \`${vars.lintCommand}\``,
  ]);
  if (commands) lines.push(commands);
  lines.push('');
}

/** Collect phase fixes. */
function collectPhaseFixes(
  neededKeys: Set<string>,
  phase: FragmentPhase,
  languages: string[],
  agentId: AgentId,
  vars: PromptVariables,
): {
  templateRefs: TargetedTemplateRef[];
  inlineFragments: TargetedInlineFragment[];
} {
  const templateRefs: TargetedTemplateRef[] = [];
  const inlineFragments: TargetedInlineFragment[] = [];

  for (const key of neededKeys) {
    const fragment = getFragment(key);
    if (!fragment || fragment.phase !== phase) continue;

    const langTemplate = getLanguageTemplate(key, languages);
    const templatePath = langTemplate ?? getFragmentTemplate(key, agentId);
    if (templatePath) {
      templateRefs.push({
        category: fragment.category,
        key,
        template: templatePath,
      });
      continue;
    }

    const override = fragment.agentOverrides?.[agentId];
    inlineFragments.push({
      category: fragment.category,
      instruction: fillTemplate(override ?? fragment.instruction, vars),
    });
  }

  return { templateRefs, inlineFragments };
}

/** Render skill template tasks. */
function renderSkillTemplateTasks(
  lines: string[],
  refs: TargetedTemplateRef[],
  agentId: AgentId,
  languages: string,
): number {
  if (refs.length === 0) return 1;

  lines.push(
    `**Missing Skills (${refs.length} of ${SKILL_NAMES.length})** - create in \`${PROFILES[agentId].skillsDir}/{skill-name}/SKILL.md\``,
  );
  lines.push('');
  let taskNum = 1;

  for (const ref of refs) {
    const name =
      ref.key === 'create-skill-goat'
        ? 'goat'
        : ref.key.replace('create-skill-', 'goat-');
    const outputPath = `${PROFILES[agentId].skillsDir}/${name}/SKILL.md`;
    lines.push(
      renderTask({
        num: taskNum++,
        outputPath,
        templatePath: getTemplatePath(ref.template),
        adapt: defaultAdaptGuidance(outputPath, undefined, languages),
        verify: defaultVerify(outputPath),
      }),
    );
    lines.push('');
  }

  return taskNum;
}

/** Render non skill template tasks. */
function renderNonSkillTemplateTasks(
  lines: string[],
  refs: TargetedTemplateRef[],
  startTaskNum: number,
  languages: string,
): void {
  let taskNum = startTaskNum;

  for (const ref of refs) {
    if (ref.key.startsWith('add-skill-') || ref.key === 'create-all-skills')
      continue;
    const outputPath =
      getFragment(ref.key)?.category ??
      ref.key.replace(/^create-/, '').replace(/-/g, '/');
    lines.push(
      renderTask({
        num: taskNum++,
        outputPath,
        templatePath: getTemplatePath(ref.template),
        adapt: defaultAdaptGuidance(ref.key, undefined, languages),
        verify: defaultVerify(ref.key),
      }),
    );
    lines.push('');
  }
}

/** Render inline targeted fragments. */
function renderInlineTargetedFragments(
  lines: string[],
  fragments: TargetedInlineFragment[],
): void {
  for (const fragment of fragments) {
    lines.push(fragment.instruction);
    lines.push('');
  }
}

/** Render standard phase notes. */
function renderStandardPhaseNotes(
  lines: string[],
  phase: FragmentPhase,
  vars: PromptVariables,
): void {
  if (phase !== 'standard') return;

  lines.push(
    '**Skill quality check** - every skill MUST have: **When to Use**, **Process** (phased + human gates), **Constraints**, **Output Format**, **Chaining**. No placeholder text.',
  );
  lines.push('');
  if (vars.languages && vars.languages !== 'unknown') {
    lines.push(
      `**Adaptation for this project:** Replace template Step 0 questions with questions about ${vars.languages} patterns. Replace template examples with patterns from this codebase. Do NOT leave placeholder text like "[Step 1]" or "[describe X]".`,
    );
    lines.push('');
  }
}

/** Render phase gate. */
function renderPhaseGate(
  lines: string[],
  phase: FragmentPhase,
  agentId: AgentId,
): void {
  if (phase === 'anti-pattern') return;
  lines.push(`**GATE:** Run \`${getCliCommand()} scan . --agent ${agentId}\``);
  lines.push('');
}

/** Render targeted phase. */
function renderTargetedPhase(
  lines: string[],
  phase: FragmentPhase,
  templateRefs: TargetedTemplateRef[],
  inlineFragments: TargetedInlineFragment[],
  agentId: AgentId,
  vars: PromptVariables,
): void {
  if (templateRefs.length === 0 && inlineFragments.length === 0) return;

  lines.push(`## ${PHASE_HEADINGS[phase]}`);
  lines.push('');
  const skillRefs = templateRefs.filter((ref) =>
    ref.key.startsWith('create-skill-'),
  );
  const nonSkillRefs = templateRefs.filter(
    (ref) => !ref.key.startsWith('create-skill-'),
  );
  const nextTaskNum = renderSkillTemplateTasks(
    lines,
    skillRefs,
    agentId,
    vars.languages,
  );
  renderNonSkillTemplateTasks(lines, nonSkillRefs, nextTaskNum, vars.languages);
  renderInlineTargetedFragments(lines, inlineFragments);
  renderStandardPhaseNotes(lines, phase, vars);
  renderPhaseGate(lines, phase, agentId);
}

/** Render targeted fix. */
function renderTargetedFix(
  report: ScanReport,
  agentId: AgentId,
  agentReport: AgentReport,
): string {
  const profile = PROFILES[agentId];
  const vars = extractTemplateVars(report, agentReport);
  const lines: string[] = [];
  const neededKeys = collectNeededKeys(agentReport);
  renderTargetedFixHeader(lines, profile.name, agentReport, vars);

  for (const phase of PHASE_ORDER) {
    const phaseFixes = collectPhaseFixes(
      neededKeys,
      phase,
      report.stack.languages,
      agentId,
      vars,
    );
    renderTargetedPhase(
      lines,
      phase,
      phaseFixes.templateRefs,
      phaseFixes.inlineFragments,
      agentId,
      vars,
    );
  }

  lines.push('---');
  lines.push('');
  lines.push(
    `After completing fixes, re-run \`${getCliCommand()} setup . --agent ${agentId}\` to check for remaining issues.`,
  );

  return lines.join('\n');
}

/** Format a task as a numbered markdown block with read/adapt/verify steps, used inside phase sections. */
function renderTask(task: SetupTask): string {
  const lines: string[] = [];
  lines.push(`### Task ${task.num}: Create \`${task.outputPath}\``);
  lines.push('');
  lines.push(`1. **Read template:** ${task.templatePath}`);
  lines.push(`2. **Adapt:** ${task.adapt}`);
  lines.push(`3. **Verify:** ${task.verify}`);
  return lines.join('\n');
}

/** Return human-readable adapt instructions for a task, choosing path-specific guidance (skills, config, footguns, etc.) or falling back to a generic message. */
function defaultAdaptGuidance(
  output: string,
  note: string | undefined,
  languages: string,
): string {
  // Path-specific guidance takes precedence over generic notes
  if (output.includes('/skills/'))
    return `Replace template Step 0 questions and examples with ${languages} patterns from this project`;
  if (output === '.goat-flow/config.yaml')
    return 'Use the default directory paths unless this project already needs explicit overrides. IMPORTANT: if config.yaml declares local paths (e.g., local: .goat-flow/footguns/), create those directories with a .gitkeep file. Config must not reference paths that do not exist.';
  if (output === 'ai-docs/footguns/')
    return 'Seed `ai-docs/footguns/` with category bucket files. Use `category:` frontmatter on the file and `## Footgun:` entries with `file:line` evidence. No hypotheticals. For EVERY cited file:line: read the actual code and verify the claim - does the method exist? Does the exception type match? Does the risk description match actual behavior? Flag any footgun where cited behavior does not match the code as UNVERIFIED';
  if (output === 'ai-docs/lessons/')
    return 'Seed `ai-docs/lessons/` with category bucket files. Use `category:` frontmatter on the file and `## Lesson:` / `## Pattern:` entries from real incidents';
  if (output === 'ai-docs/architecture.md')
    return 'Read project entry points and main directories. Document what exists - under 100 lines, no aspirational content';
  if (output.includes('instructions/'))
    return `Adapt for this project's ${languages} patterns. Replace generic examples with real patterns from the codebase`;
  // Fall back to template ref note or generic
  if (note) return note;
  return 'Adapt template for this project - replace generic examples with real project patterns';
}

/** Return the verify instruction shown in step 3 of a task, matched to output type (skill, config, shell, JSON, etc.). */
function defaultVerify(output: string): string {
  if (output.includes('/skills/'))
    return 'File has: When to Use, Process with human gates, Constraints, Output Format, Chaining sections';
  if (output === '.goat-flow/config.yaml')
    return 'File exists, parses as YAML, and includes version plus footguns/lessons/decisions/tasks/logs/agents/skills settings';
  if (output === 'ai-docs/footguns/')
    return 'Directory exists with README.md plus 1+ category bucket files using `category:` frontmatter and `path:line` evidence inside `## Footgun:` entries';
  if (output === 'ai-docs/lessons/')
    return 'Directory exists with README.md plus 1+ category bucket files using `category:` frontmatter and `## Lesson:` / `## Pattern:` entries';
  if (output === 'ai-docs/architecture.md')
    return 'File exists and is under 100 lines';
  if (output.endsWith('.sh'))
    return '`bash -n <file>` passes (no syntax errors)';
  if (output.endsWith('.json')) return 'Valid JSON (no parse errors)';
  if (output.endsWith('.yml')) return 'Valid YAML';
  return 'File exists and has project-specific content (not placeholder text)';
}

// renderFullSetup removed - all new/low-scoring projects use renderSetupRedirect
// which points agents at setup/setup-{agent}.md instead of generating inline tasks.

// ---------------------------------------------------------------------------
// Mode: Multi-agent deduplicated setup
// ---------------------------------------------------------------------------

/** Validate that all referenced template files exist for each agent. */
function validateMultiAgentTemplateRefs(agentIds: AgentId[]): void {
  for (const id of agentIds) {
    const missing = validateTemplateRefs(id);
    if (missing.length === 0) continue;
    const list = missing
      .map((path) => `  - ${getTemplatePath(path)}`)
      .join('\n');
    throw new Error(
      `Missing template files for ${id} setup:\n${list}\nRe-install goat-flow or check the installation.`,
    );
  }
}

/** Render multi agent intro. */
function renderMultiAgentIntro(lines: string[], report: ScanReport): string {
  const stack = report.stack;
  const languages = stack.languages.join(', ') || 'unknown';
  const commands = buildCommandSummary([
    stack.buildCommand && `Build: ${stack.buildCommand}`,
    stack.testCommand && `Test: ${stack.testCommand}`,
    stack.lintCommand && `Lint: ${stack.lintCommand}`,
    stack.formatCommand && `Format: ${stack.formatCommand}`,
  ]);

  lines.push('# GOAT Flow Setup - All Agents');
  lines.push('');
  lines.push(`Stack: ${languages}`);
  if (commands) lines.push(commands);
  renderSignals(lines, stack.signals);
  lines.push('');
  lines.push('## How this works');
  lines.push('');
  lines.push(
    'This prompt references template files in the goat-flow project. For each phase:',
  );
  lines.push('1. Read the referenced template file');
  lines.push(
    '2. Adapt it for THIS project (use the detected stack info above)',
  );
  lines.push('3. Create the output file in THIS project');
  lines.push("4. Verify it meets the template's requirements");
  lines.push('');
  lines.push(
    `If any template path below is missing, run \`${getCliCommand()} setup\` again to get updated paths.`,
  );
  lines.push('');

  return languages;
}

/** Normalize shared output path. */
function normalizeSharedOutputPath(output: string): string {
  return output.includes('/skills/')
    ? output.replace(/\.[^/]+\/skills\//, '{skills_dir}/')
    : output;
}

/** Render multi agent task list. */
function renderMultiAgentTaskList(
  lines: string[],
  refs: Array<{ output: string; template: string; note?: string }>,
  languages: string,
): void {
  let taskNum = 1;
  for (const ref of refs) {
    const output = normalizeSharedOutputPath(ref.output);
    lines.push(
      renderTask({
        num: taskNum++,
        outputPath: output,
        templatePath: getTemplatePath(ref.template),
        adapt: defaultAdaptGuidance(output, ref.note, languages),
        verify: defaultVerify(output),
      }),
    );
    lines.push('');
  }
}

/** Render multi agent foundation sections. */
function renderMultiAgentFoundationSections(
  lines: string[],
  agentIds: AgentId[],
  languages: string,
): void {
  for (const agentId of agentIds) {
    const profile = PROFILES[agentId];
    const templates = getAgentTemplates(agentId);
    const foundationRefs = templates.filter(
      (ref) => ref.phase === 'foundation' && !ref.output.startsWith('('),
    );
    const guideRef = templates.find(
      (ref) => ref.output.startsWith('(') && ref.phase === 'foundation',
    );

    lines.push(`## ${profile.name} - Foundation`);
    lines.push('');
    let taskNum = 1;
    for (const ref of foundationRefs) {
      lines.push(
        renderTask({
          num: taskNum++,
          outputPath: ref.output,
          templatePath: getTemplatePath(ref.template),
          adapt: defaultAdaptGuidance(ref.output, ref.note, languages),
          verify: defaultVerify(ref.output),
        }),
      );
      lines.push('');
    }
    if (guideRef) {
      lines.push(
        `> **Agent-specific details:** Also read ${getTemplatePath(guideRef.template)} (foundation section)`,
      );
      lines.push('');
    }
  }
}

/** Render multi agent shared section. */
function renderMultiAgentSharedSection(
  lines: string[],
  heading: string,
  refs: Array<{ output: string; template: string; note?: string }>,
  languages: string,
  gateText: string,
  includeSkillNote: boolean,
): void {
  lines.push(heading);
  lines.push('');
  renderMultiAgentTaskList(lines, refs, languages);
  if (includeSkillNote) {
    lines.push(
      "Skills go in each agent's skills directory: `.claude/skills/`, `.agents/skills/`",
    );
    lines.push('');
    lines.push(
      '**Skill quality check** - every skill file MUST have: **When to Use**, **Process** (phased + human gates), **Constraints**, **Output Format**, **Chaining**. No placeholder text.',
    );
    lines.push('');
  }
  lines.push(gateText);
  lines.push('');
}

/**
 * Compose a deduplicated setup for multiple agents.
 * Shared files (docs, skills, coding-standards, evals, CI) appear once.
 * Per-agent files (instruction file, settings, hooks) appear in agent sections.
 */
export function composeMultiAgentSetup(
  report: ScanReport,
  agentIds: AgentId[],
): string {
  validateMultiAgentTemplateRefs(agentIds);

  const lines: string[] = [];
  const languages = renderMultiAgentIntro(lines, report);
  const firstId = agentIds[0];
  if (!firstId) return lines.join('\n');
  const allRefs = getAgentTemplates(firstId);
  const languageRefs = mapLanguagesToTemplates(report.stack.languages);
  const signalRefs = mapSignalsToTemplates(
    report.stack.signals,
    report.stack.languages,
  );
  const standardShared = allRefs.filter(
    (r) => r.phase === 'standard' && !r.output.startsWith('('),
  );
  const fullShared = allRefs.filter(
    (r) => r.phase === 'full' && !r.output.startsWith('('),
  );

  renderMultiAgentFoundationSections(lines, agentIds, languages);
  lines.push(
    `**GATE:** Run \`${getCliCommand()} scan .\` - foundation tier must be 100% for all agents.`,
  );
  lines.push('');
  renderMultiAgentSharedSection(
    lines,
    '## Standard (shared across all agents)',
    [...standardShared, ...languageRefs, ...signalRefs],
    languages,
    `**GATE:** Run \`${getCliCommand()} scan .\` - standard tier must be 100% for all agents.`,
    true,
  );
  renderMultiAgentSharedSection(
    lines,
    '## Full (shared across all agents)',
    fullShared,
    languages,
    `**GATE:** Run \`${getCliCommand()} scan .\` - target 100% across all agents.`,
    false,
  );

  lines.push('---');
  lines.push('');
  lines.push(
    `After completing all phases, run \`${getCliCommand()} setup .\` to check for remaining issues.`,
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Mode: Setup redirect (under 50% - too many issues for inline fixes)
// ---------------------------------------------------------------------------

/** Lookup from agent ID to its setup guide in the goat-flow templates directory. */
const SETUP_FILES: Record<AgentId, string> = {
  claude: 'workflow/setup/setup-claude.md',
  codex: 'workflow/setup/setup-codex.md',
  gemini: 'workflow/setup/setup-gemini.md',
};

/** Render setup redirect. */
// eslint-disable-next-line complexity -- state-aware routing requires many branches
function renderSetupRedirect(
  report: ScanReport,
  agentId: AgentId,
  agentReport: AgentReport | null,
): string {
  const profile = PROFILES[agentId];
  const setupFile = getTemplatePath(SETUP_FILES[agentId]);
  const stack = report.stack;
  const languages = stack.languages.join(', ') || 'unknown';
  const lines: string[] = [];

  // State-aware routing: classify project and branch on adoption state
  const projectFS = createFS(report.target);
  const projectState = classifyProjectState(projectFS);

  if (projectState.state === 'v1.1') {
    // Current version — just scan and fix
    lines.push(`# GOAT Flow Setup - ${profile.name}`);
    lines.push('');
    lines.push('## This project is already on the current goat-flow version');
    lines.push('');
    lines.push(
      `Run \`${getCliCommand()} scan . --agent ${agentId}\` and fix any failing checks.`,
    );
    lines.push('No setup changes needed — the project is up to date.');
    lines.push('');
    return lines.join('\n');
  }

  if (projectState.state === 'v1.0') {
    lines.push(`# GOAT Flow Setup - ${profile.name}`);
    lines.push('');
    lines.push('## Upgrade from v1.0 to current');
    lines.push('');
    lines.push(
      'This project has goat-flow v1.0. Follow the upgrade path:',
    );
    lines.push(
      'Read and implement `workflow/setup/upgrade-1.0.0.md`.',
    );
    lines.push('');
    lines.push(
      'Key changes: install `.goat-flow/skill-conventions.md`, update skills to use 7-line fallback,',
    );
    lines.push(
      'remove handoff-template.md/todo.md/handoff.md, update instruction file Working Memory section.',
    );
    lines.push('');
    // Still include stack detection and agent-specific info below
  }

  if (projectState.state === 'v0.9') {
    lines.push(`# GOAT Flow Setup - ${profile.name}`);
    lines.push('');
    lines.push('## Migration from v0.9 to current');
    lines.push('');
    lines.push(
      'This project has old goat-flow skills (v0.9 era). Follow the migration path:',
    );
    lines.push(
      'Read and implement `workflow/setup/upgrade-0.9.x.md`.',
    );
    lines.push('');
    lines.push(
      'Key changes: consolidate 10 old skills to 5+dispatcher, migrate docs/footguns.md → ai-docs/footguns/,',
    );
    lines.push(
      'docs/lessons.md → ai-docs/lessons/, create .goat-flow/config.yaml, install skill-conventions.md.',
    );
    lines.push('');
    // Still include stack detection and agent-specific info below
  }

  // For bare/partial/error states, render the standard header
  if (
    projectState.state === 'bare' ||
    projectState.state === 'partial' ||
    projectState.state === 'error'
  ) {
    lines.push(`# GOAT Flow Setup - ${profile.name}`);
    lines.push('');
    if (agentReport) {
      lines.push(
        `This project scores **${agentReport.score.grade}** (${agentReport.score.percentage}%) - it needs a full setup pass.`,
      );
    } else {
      lines.push(
        `No ${profile.name} configuration detected - this project needs a full setup.`,
      );
    }
    lines.push('');
  }

  // Project context - detected stack info
  lines.push(`**Stack:** ${languages}`);
  const cmds = [
    stack.buildCommand && `**Build:** \`${stack.buildCommand}\``,
    stack.testCommand && `**Test:** \`${stack.testCommand}\``,
    stack.lintCommand && `**Lint:** \`${stack.lintCommand}\``,
  ]
    .filter(Boolean)
    .join(' | ');
  if (cmds) lines.push(cmds);
  renderSignals(lines, stack.signals);
  lines.push('');

  // Check for LLM integration signal
  const hasLLM = report.stack.signals?.llmIntegration === true;
  if (hasLLM) {
    lines.push('## LLM Integration Detected');
    lines.push('');
    lines.push(
      'This project integrates with LLM providers (Anthropic, OpenAI, Strands, LangChain, or similar).',
    );
    lines.push('Setup MUST account for this:');
    lines.push('');
    lines.push(
      '1. **Ask First boundaries** in the instruction file MUST include prompt/template files,',
    );
    lines.push(
      '   system prompts, and agent configuration files. Prompt changes are behavioral changes.',
    );
    lines.push(
      '2. **Router table** MUST include paths to prompt files, system prompts, and agent configs.',
    );
    lines.push(
      '   Agents need to know where the sensitive LLM-facing files are.',
    );
    lines.push(
      '3. **goat-security** is especially important — the threat model should cover:',
    );
    lines.push(
      '   prompt injection, output validation, credential exposure, and LLM cost controls.',
    );
    lines.push(
      '4. **Footguns** should document any coupling between prompt templates and code logic',
    );
    lines.push(
      '   (e.g., if changing a system prompt breaks JSON parsing downstream).',
    );
    lines.push('');
  }

  // Pre-instructions — only for bare/partial/error states
  // (v0.9 and v1.0 already have their upgrade header with specific instructions)
  if (
    projectState.state === 'bare' ||
    projectState.state === 'partial' ||
    projectState.state === 'error'
  ) {
    lines.push('## Before you start');
    lines.push('');
    lines.push('**Step 0 - Clean up stale artifacts (if upgrading):**');
    lines.push('');
    lines.push(
      '**Skills:** The 6 canonical skills are: `goat`, `goat-debug`, `goat-plan`, `goat-review`, `goat-security`, `goat-test`.',
    );
    lines.push('');
    lines.push(
      'Check the skills directory for stale or duplicate entries:',
    );
    lines.push(
      '- Delete stale `goat-*` directories: `goat-investigate`, `goat-audit`, `goat-onboard`, `goat-reflect`, `goat-resume`, `goat-simplify`, `goat-refactor`, `goat-context`',
    );
    lines.push(
      '- Check for generic skill directories: `audit/`, `review/`, `preflight/`, `debug/`, `plan/`, `test/`, `security/`',
    );
    lines.push(
      '  If any exist alongside the `goat-*` version: (a) migrate unique content into the goat-* version, (b) delete the generic directory, or (c) skip if it\'s a project-specific skill unrelated to goat-flow',
    );
    lines.push('');
    lines.push(
      '**Multi-agent consistency:** If multiple agent skill directories exist (`.claude/skills/`, `.agents/skills/`, `.gemini/skills/`), clean stale dirs from ALL of them - not just the agent being set up. Also update `GEMINI.md` and `AGENTS.md` if they reference deleted skills.',
    );
    lines.push('');
    lines.push(
      '**Instruction files:** Check if `.github/instructions/` exists before creating `ai-docs/coding-standards/`.',
    );
    lines.push(
      '  If both would exist: (a) migrate `.github/instructions/` content into `ai-docs/coding-standards/`, (b) replace `.github/instructions/` files with one-line imports pointing to `ai-docs/coding-standards/`, or (c) keep `.github/instructions/` as canonical and skip `ai-docs/coding-standards/` creation. Do NOT create overlapping content in both locations.',
    );
    lines.push('');
    lines.push(
      '**Router table:** Rewrite the Router Table in the instruction file. Remove entries pointing to deleted skills. If `ai-docs/README.md` exists, include it as the Project Guidelines entry.',
    );
    lines.push('');
    lines.push(
      '**Dispatcher:** Replace the `/goat` dispatcher skill entirely from the goat-flow template.',
    );
    lines.push(
      'Read the template at `workflow/skills/goat.md` and write it to the agent skills dir.',
    );
    lines.push(
      'Preserve any project-specific disambiguation examples the existing dispatcher may have.',
    );
    lines.push('');
    lines.push(
      '**Step 0b - Migrate, don\'t duplicate (check BEFORE creating files):**',
    );
    lines.push('');
    lines.push(
      'Before creating any artifact, check if an equivalent already exists. Do NOT create parallel surfaces.',
    );
    lines.push('');
    lines.push('| Artifact | If this exists... | Do NOT also create... |');
    lines.push('|----------|-------------------|----------------------|');
    lines.push(
      '| Tasks | `tasks/` | `.goat-flow/tasks/` (or vice versa) |',
    );
    lines.push(
      '| Footguns | `docs/footguns.md` (flat file) | `ai-docs/footguns/` (directory) |',
    );
    lines.push(
      '| Lessons | `docs/lessons.md` (flat file) | `ai-docs/lessons/` (directory) |',
    );
    lines.push(
      '| Evals | `agent-evals/` | `ai-docs/evals/` |',
    );
    lines.push(
      '| Coding standards | `ai/instructions/` or `.github/instructions/` | `ai-docs/coding-standards/` with overlapping content |',
    );
    lines.push('');
    lines.push(
      'For each artifact type: (1) use the EXISTING path as canonical, (2) update `.goat-flow/config.yaml` to point there, (3) list what you chose NOT to create and why.',
    );
    lines.push('');
    lines.push(
      'Examples: If `.github/instructions/` exists with coding standards, do NOT create `ai-docs/coding-standards/` with overlapping content — reference the existing files from `ai-docs/README.md`. If `docs/footguns.md` exists, migrate its entries to `ai-docs/footguns/` instead of creating a parallel surface.',
    );
    lines.push('');
    lines.push(
      '1. Verify the detected stack above is correct. If not, the setup file will',
    );
    lines.push(
      '   ask you to detect it from the actual codebase (package.json, composer.json, etc.)',
    );
    lines.push(
      '2. "Adapt" means: replace generic examples with THIS project\'s real examples.',
    );
    lines.push(
      '   Skills: replace generic Step 0 questions with questions specific to this stack.',
    );
    lines.push(
      '   Footguns: only real traps from THIS codebase with `file:line` evidence.',
    );
    lines.push(
      '   Conventions: real build/test/lint commands, real file naming patterns.',
    );
    lines.push(
      '3. Do NOT copy templates verbatim. If a template says "[describe X]", describe X for THIS project.',
    );
    lines.push(
      '4. Check for existing permission restrictions: if `.claude/settings.local.json` (or equivalent)',
    );
    lines.push(
      '   exists and limits allowed tools/commands, the setup may fail to create files.',
    );
    lines.push(
      '   Read it first. If it restricts Bash or Write, work single-threaded instead of spawning sub-agents.',
    );
    lines.push(
      '5. **Deny rule escape hatch:** The default deny pattern `Bash(*git commit*)` blocks ALL commits.',
    );
    lines.push(
      '   To relax specific rules after setup, add allow overrides in `.claude/settings.local.json` (gitignored).',
    );
    lines.push(
      '   See `workflow/hooks/README.md` for hook configuration details.',
    );
    lines.push('');
  } // end: "Before you start" section (bare/partial/error only)

  // Main instruction
  lines.push('## Setup instructions');
  lines.push('');
  lines.push(
    'FIRST, read `workflow/setup/shared/system-overview.md` to understand the design intent.',
  );
  lines.push('');
  lines.push(
    `Deeply review and implement the instructions in: \`${setupFile}\``,
  );
  lines.push('');
  lines.push('That file walks through:');
  lines.push(
    '- **Phase 1a:** Instruction file, docs seed files, local instruction files',
  );
  lines.push(
    '- **Phase 1b:** 6 skills (5 goat-* skills + /goat dispatcher) adapted for this project',
  );
  lines.push(
    '- **Phase 1c:** Advisory hooks, deny patterns, coding guidelines',
  );
  lines.push(
    '- **Phase 1d:** Agent evals, hygiene (handoff template, RFC 2119 pass)',
  );
  lines.push('- **Final Verification:** Verify 100% on the CLI scan');
  lines.push('');
  lines.push(
    '**Read `workflow/setup/shared/system-overview.md` first** to understand the design intent behind the goat-flow system.',
  );
  lines.push(
    'Install the full system for every project. Do not skip components based on project size.',
  );
  lines.push('');

  // Post-setup verification
  lines.push('## Post-setup verification');
  lines.push('');
  lines.push('**Hook smoke-test** (run after creating hook scripts):');
  lines.push('```bash');
  lines.push('# Syntax check every hook script');
  lines.push(
    `for f in ${profile.hooksDir}/*.sh; do bash -n "$f" || echo "FAIL: $f"; done`,
  );
  lines.push('# Shellcheck if available');
  lines.push(
    `command -v shellcheck >/dev/null && shellcheck ${profile.hooksDir}/*.sh`,
  );
  lines.push('```');
  lines.push(
    'If any hook fails syntax check: fix it before declaring setup complete.',
  );
  lines.push('');
  lines.push(
    '**File creation checklist:** After setup, verify all expected files exist. Report any you could not create (permission denied, path conflict) with the reason.',
  );
  lines.push('');

  // Scan + iterate
  lines.push(
    `**Scan:** Run \`${getCliCommand()} scan . --agent ${agentId}\``,
  );
  lines.push('');
  lines.push('**Target: 100% with zero anti-pattern deductions.**');
  lines.push(
    `If not 100%, run \`${getCliCommand()} setup . --agent ${agentId}\` for remaining fix instructions. Repeat until 100% (max 3 cycles).`,
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Gather fragment keys from all non-passing checks and triggered anti-patterns so the prompt only renders fixes the project actually needs. */
function collectNeededKeys(agentReport: AgentReport): Set<string> {
  const neededKeys = new Set<string>();
  for (const check of agentReport.checks) {
    if (
      (check.status === 'fail' || check.status === 'partial') &&
      check.recommendationKey
    ) {
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

