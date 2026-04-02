import type { ScanReport, AgentId, AgentReport, ProjectSignals } from '../types.js';
import { SKILL_NAMES } from '../constants.js';
import type { ComposedPrompt, PromptSection, PromptVariables, FragmentPhase, SetupTask } from './types.js';
import { getAllFragments, getFragment } from './registry.js';
import { extractTemplateVars, fillTemplate } from './template-filler.js';
import { PROFILES } from '../detect/agents.js';
import { getTemplatePath, getCliCommand } from '../paths.js';
import { getAgentTemplates, validateTemplateRefs, mapLanguagesToTemplates, mapSignalsToTemplates, getFragmentTemplate, getLanguageTemplate } from './template-refs.js';

/** Projects at or above this percentage get the short fix list instead of targeted fix */
const SHORT_FIX_THRESHOLD = 90;

function formatStaticAnalysisTools(signals: ProjectSignals, withLevelLabel: boolean): string {
  return signals.staticAnalysis
    .map((signal) => {
      if (!signal.level) return signal.tool;
      return withLevelLabel ? `${signal.tool} level ${signal.level}` : `${signal.tool} (${signal.level})`;
    })
    .join(', ');
}

function collectSignalSummaryParts(signals: ProjectSignals): string[] {
  const parts: string[] = [];
  if (signals.codeGenTools.length > 0) parts.push(`**Code gen:** ${signals.codeGenTools.join(', ')}`);
  if (signals.deployPlatforms.length > 0) parts.push(`**Deploy:** ${signals.deployPlatforms.join(', ')}`);
  if (signals.llmIntegration) parts.push('**LLM integration detected**');
  if (signals.staticAnalysis.length > 0) parts.push(`**Static analysis:** ${formatStaticAnalysisTools(signals, false)}`);
  if (signals.complianceSignals) parts.push('**PHI/compliance signals detected**');
  if (signals.formatterGaps.length > 0) parts.push(`**Formatter gaps:** ${signals.formatterGaps.join(', ')}`);
  return parts;
}

function collectSignalActionLines(signals: ProjectSignals): string[] {
  const actions: string[] = [];
  if (signals.llmIntegration) {
    actions.push('- **LLM integration:** Add prompt/template file paths to the Router Table. Add "prompt changes require scenario testing" to Ask First boundaries. Seed a learning-loop entry for prompt-regression risk.');
  }
  if (signals.complianceSignals) {
    actions.push('- **PHI/compliance:** Add mandatory constraints to the instruction file hot path (not just cold-path docs): "MUST NOT log PHI", "MUST NOT include patient data in error messages", "MUST scope all queries by tenant". These belong in the execution loop or Ask First section, not only in ai/coding-standards/security.md.');
  }
  if (signals.formatterGaps.length > 0) {
    actions.push(`- **Formatter gaps (${signals.formatterGaps.join(', ')}):** Add formatters to the PostToolUse hook (format-file.sh). Every detected language should have a formatter running on save.`);
  }
  if (signals.staticAnalysis.length > 0) {
    const tools = formatStaticAnalysisTools(signals, true);
    actions.push(`- **Static analysis (${tools}):** Verify the linter is enforced in hooks (stop-lint.sh), not just configured. Add "MUST maintain ${tools} compliance" to the instruction file.`);
  }
  return actions;
}

/** Render detected project signals into the setup prompt output */
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

function renderAllPass(agentId: AgentId, agentReport: AgentReport, report?: ScanReport): string {
  const profile = PROFILES[agentId];
  const lines: string[] = [];
  lines.push(`# GOAT Flow Setup - ${profile.name}`);
  lines.push('');
  lines.push(`All checks pass (${agentReport.score.grade}, ${agentReport.score.percentage}%).`);
  lines.push('');

  // Summary of what's installed
  const facts = report?.agents.find(a => a.agent === agentId);
  if (facts) {
    const checks = agentReport.checks;
    const skillCount = checks.filter(c => c.category === 'Skills' && c.status === 'pass').length;
    const hookCount = [
      checks.find(c => c.id === '2.2.1')?.status === 'pass',
      checks.find(c => c.id === '2.2.3')?.status === 'pass',
      checks.find(c => c.id === '2.2.4')?.status === 'pass',
    ].filter(Boolean).length;

    lines.push('**Installed:**');
    if (skillCount > 0) lines.push(`- ${skillCount} skill checks passing`);
    if (hookCount > 0) lines.push(`- ${hookCount} hooks (deny, stop-lint, format)`);
    lines.push(`- Score: ${agentReport.score.tiers.foundation.earned}/${agentReport.score.tiers.foundation.available} foundation, ${agentReport.score.tiers.standard.earned}/${agentReport.score.tiers.standard.available} standard, ${agentReport.score.tiers.full.earned}/${agentReport.score.tiers.full.available} full`);
    lines.push('');
  }

  lines.push('**Maintenance:**');
  lines.push('- After upgrading goat-flow, re-run `goat-flow setup` to check for new checks');
  lines.push('- Run `goat-flow scan --min-score 90` in CI to catch drift');
  lines.push('- Review `docs/footguns/`, `.goat-flow/footguns/`, `ai/lessons/`, and `.goat-flow/lessons/` after incidents');

  return lines.join('\n');
}

function getTriggeredAntiPatterns(agentReport: AgentReport): AgentReport['antiPatterns'] {
  return agentReport.antiPatterns.filter(ap => ap.triggered);
}

function renderShortFixSummaryLine(agentReport: AgentReport, failedCount: string, triggeredCount: number): string {
  const countText = triggeredCount > 0
    ? `${failedCount} checks + ${triggeredCount} anti-patterns remaining.`
    : `${failedCount} checks remaining.`;
  return `This project scores **${agentReport.score.grade}** (${agentReport.score.percentage}%). ${countText}`;
}

function findRecommendationAction(agentReport: AgentReport, key: string): string | null {
  const recommendation = agentReport.recommendations.find(
    item => item.checkId
      && agentReport.checks.some(check => check.id === item.checkId && check.recommendationKey === key),
  );
  return recommendation?.action ?? null;
}

function renderShortFixItem(
  key: string,
  agentId: AgentId,
  agentReport: AgentReport,
  vars: PromptVariables,
): string | null {
  const fragment = getFragment(key);
  if (!fragment || fragment.phase === 'anti-pattern') return null;

  const isSkillQuality = key.startsWith('add-skill-') || key === 'create-all-skills';
  const templatePath = isSkillQuality ? null : getFragmentTemplate(key, agentId);
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
    const fragment = antiPattern.recommendationKey ? getFragment(antiPattern.recommendationKey) : undefined;
    if (!fragment) {
      lines.push(`- **${antiPattern.id}**: ${antiPattern.message}`);
      continue;
    }

    const override = fragment.agentOverrides?.[agentId];
    const instruction = fillTemplate(override ?? fragment.instruction, vars);
    lines.push(`### ${antiPattern.id}: ${antiPattern.name} (${antiPattern.deduction} pts)`);
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

function renderShortFix(report: ScanReport, agentId: AgentId, agentReport: AgentReport): string {
  const profile = PROFILES[agentId];
  const vars = extractTemplateVars(report, agentReport);
  const lines: string[] = [];
  const neededKeys = collectNeededKeys(agentReport);
  const triggered = getTriggeredAntiPatterns(agentReport);

  lines.push(`# GOAT Flow Setup - ${profile.name}`);
  lines.push('');
  lines.push(renderShortFixSummaryLine(agentReport, vars.failedCount, triggered.length));
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
  lines.push(`If not 100%, run \`${getCliCommand()} setup . --agent ${agentId}\` for fix instructions. Repeat until 100% (max 3 cycles).`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Mode: Targeted fix (1-89%)
// ---------------------------------------------------------------------------

interface TargetedTemplateRef {
  category: string;
  key: string;
  template: string;
}

interface TargetedInlineFragment {
  category: string;
  instruction: string;
}

function buildCommandSummary(parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' | ');
}

function renderTargetedFixHeader(
  lines: string[],
  profileName: string,
  agentReport: AgentReport,
  vars: PromptVariables,
): void {
  lines.push(`# GOAT Flow Setup - ${profileName}`);
  lines.push('');
  lines.push(`This project scores **${agentReport.score.grade}** (${agentReport.score.percentage}%) for ${profileName}.`);
  lines.push(`**${vars.failedCount}** checks need attention out of ${vars.totalCount} total.`);
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
      templateRefs.push({ category: fragment.category, key, template: templatePath });
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

function renderSkillTemplateTasks(
  lines: string[],
  refs: TargetedTemplateRef[],
  agentId: AgentId,
  languages: string,
): number {
  if (refs.length === 0) return 1;

  lines.push(`**Missing Skills (${refs.length} of ${SKILL_NAMES.length})** - create in \`${PROFILES[agentId].skillsDir}/{skill-name}/SKILL.md\``);
  lines.push('');
  let taskNum = 1;

  for (const ref of refs) {
    const name = ref.key === 'create-skill-goat'
      ? 'goat'
      : ref.key.replace('create-skill-', 'goat-');
    const outputPath = `${PROFILES[agentId].skillsDir}/${name}/SKILL.md`;
    lines.push(renderTask({
      num: taskNum++,
      outputPath,
      templatePath: getTemplatePath(ref.template),
      adapt: defaultAdaptGuidance(outputPath, undefined, languages),
      verify: defaultVerify(outputPath),
    }));
    lines.push('');
  }

  return taskNum;
}

function renderNonSkillTemplateTasks(
  lines: string[],
  refs: TargetedTemplateRef[],
  startTaskNum: number,
  languages: string,
): void {
  let taskNum = startTaskNum;

  for (const ref of refs) {
    if (ref.key.startsWith('add-skill-') || ref.key === 'create-all-skills') continue;
    const outputPath = getFragment(ref.key)?.category ?? ref.key.replace(/^create-/, '').replace(/-/g, '/');
    lines.push(renderTask({
      num: taskNum++,
      outputPath,
      templatePath: getTemplatePath(ref.template),
      adapt: defaultAdaptGuidance(ref.key, undefined, languages),
      verify: defaultVerify(ref.key),
    }));
    lines.push('');
  }
}

function renderInlineTargetedFragments(lines: string[], fragments: TargetedInlineFragment[]): void {
  for (const fragment of fragments) {
    lines.push(fragment.instruction);
    lines.push('');
  }
}

function renderStandardPhaseNotes(lines: string[], phase: FragmentPhase, vars: PromptVariables): void {
  if (phase !== 'standard') return;

  lines.push('**Skill quality check** - every skill MUST have: **When to Use**, **Process** (phased + human gates), **Constraints**, **Output Format**, **Chaining**. No placeholder text.');
  lines.push('');
  if (vars.languages && vars.languages !== 'unknown') {
    lines.push(`**Adaptation for this project:** Replace template Step 0 questions with questions about ${vars.languages} patterns. Replace template examples with patterns from this codebase. Do NOT leave placeholder text like "[Step 1]" or "[describe X]".`);
    lines.push('');
  }
}

function renderPhaseGate(lines: string[], phase: FragmentPhase, agentId: AgentId): void {
  if (phase === 'anti-pattern') return;
  lines.push(`**GATE:** Run \`${getCliCommand()} scan . --agent ${agentId}\``);
  lines.push('');
}

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
  const skillRefs = templateRefs.filter(ref => ref.key.startsWith('create-skill-'));
  const nonSkillRefs = templateRefs.filter(ref => !ref.key.startsWith('create-skill-'));
  const nextTaskNum = renderSkillTemplateTasks(lines, skillRefs, agentId, vars.languages);
  renderNonSkillTemplateTasks(lines, nonSkillRefs, nextTaskNum, vars.languages);
  renderInlineTargetedFragments(lines, inlineFragments);
  renderStandardPhaseNotes(lines, phase, vars);
  renderPhaseGate(lines, phase, agentId);
}

function renderTargetedFix(report: ScanReport, agentId: AgentId, agentReport: AgentReport): string {
  const profile = PROFILES[agentId];
  const vars = extractTemplateVars(report, agentReport);
  const lines: string[] = [];
  const neededKeys = collectNeededKeys(agentReport);
  renderTargetedFixHeader(lines, profile.name, agentReport, vars);

  for (const phase of PHASE_ORDER) {
    const phaseFixes = collectPhaseFixes(neededKeys, phase, report.stack.languages, agentId, vars);
    renderTargetedPhase(lines, phase, phaseFixes.templateRefs, phaseFixes.inlineFragments, agentId, vars);
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
  if (output === '.goat-flow/config.yaml') return 'Use the default directory paths unless this project already needs explicit overrides';
  if (output === 'docs/footguns/') return `Seed \`docs/footguns/\` with individual markdown entries using YAML frontmatter. Every entry needs \`file:line\` evidence. No hypotheticals`;
  if (output === 'ai/lessons/') return `Seed \`ai/lessons/\` with individual markdown entries using YAML frontmatter. Use real incidents from git history`;
  if (output === 'docs/architecture.md') return 'Read project entry points and main directories. Document what exists - under 100 lines, no aspirational content';
  if (output.includes('instructions/')) return `Adapt for this project's ${languages} patterns. Replace generic examples with real patterns from the codebase`;
  // Fall back to template ref note or generic
  if (note) return note;
  return 'Adapt template for this project - replace generic examples with real project patterns';
}

/** Default verification text for a task */
function defaultVerify(output: string): string {
  if (output.includes('/skills/')) return 'File has: When to Use, Process with human gates, Constraints, Output Format, Chaining sections';
  if (output === '.goat-flow/config.yaml') return 'File exists, parses as YAML, and includes version plus footguns/lessons/decisions/tasks/logs/agents/skills settings';
  if (output === 'docs/footguns/') return 'Directory exists with README.md plus 1+ entry files using YAML frontmatter and `path:line` evidence';
  if (output === 'ai/lessons/') return 'Directory exists with README.md plus 1+ entry files using YAML frontmatter';
  if (output === 'docs/architecture.md') return 'File exists and is under 100 lines';
  if (output.endsWith('.sh')) return '`bash -n <file>` passes (no syntax errors)';
  if (output.endsWith('.json')) return 'Valid JSON (no parse errors)';
  if (output.endsWith('.yml')) return 'Valid YAML';
  return 'File exists and has project-specific content (not placeholder text)';
}

// renderFullSetup removed - all new/low-scoring projects use renderSetupRedirect
// which points agents at setup/setup-{agent}.md instead of generating inline tasks.

// ---------------------------------------------------------------------------
// Mode: Multi-agent deduplicated setup
// ---------------------------------------------------------------------------

function validateMultiAgentTemplateRefs(agentIds: AgentId[]): void {
  for (const id of agentIds) {
    const missing = validateTemplateRefs(id);
    if (missing.length === 0) continue;
    const list = missing.map(path => `  - ${getTemplatePath(path)}`).join('\n');
    throw new Error(`Missing template files for ${id} setup:\n${list}\nRe-install goat-flow or check the installation.`);
  }
}

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
  lines.push('This prompt references template files in the goat-flow project. For each phase:');
  lines.push('1. Read the referenced template file');
  lines.push('2. Adapt it for THIS project (use the detected stack info above)');
  lines.push('3. Create the output file in THIS project');
  lines.push('4. Verify it meets the template\'s requirements');
  lines.push('');
  lines.push(`If any template path below is missing, run \`${getCliCommand()} setup\` again to get updated paths.`);
  lines.push('');

  return languages;
}

function normalizeSharedOutputPath(output: string): string {
  return output.includes('/skills/')
    ? output.replace(/\.[^/]+\/skills\//, '{skills_dir}/')
    : output;
}

function renderMultiAgentTaskList(
  lines: string[],
  refs: Array<{ output: string; template: string; note?: string }>,
  languages: string,
): void {
  let taskNum = 1;
  for (const ref of refs) {
    const output = normalizeSharedOutputPath(ref.output);
    lines.push(renderTask({
      num: taskNum++,
      outputPath: output,
      templatePath: getTemplatePath(ref.template),
      adapt: defaultAdaptGuidance(output, ref.note, languages),
      verify: defaultVerify(output),
    }));
    lines.push('');
  }
}

function renderMultiAgentFoundationSections(lines: string[], agentIds: AgentId[], languages: string): void {
  for (const agentId of agentIds) {
    const profile = PROFILES[agentId];
    const templates = getAgentTemplates(agentId);
    const foundationRefs = templates.filter(ref => ref.phase === 'foundation' && !ref.output.startsWith('('));
    const guideRef = templates.find(ref => ref.output.startsWith('(') && ref.phase === 'foundation');

    lines.push(`## ${profile.name} - Foundation`);
    lines.push('');
    let taskNum = 1;
    for (const ref of foundationRefs) {
      lines.push(renderTask({
        num: taskNum++,
        outputPath: ref.output,
        templatePath: getTemplatePath(ref.template),
        adapt: defaultAdaptGuidance(ref.output, ref.note, languages),
        verify: defaultVerify(ref.output),
      }));
      lines.push('');
    }
    if (guideRef) {
      lines.push(`> **Agent-specific details:** Also read ${getTemplatePath(guideRef.template)} (foundation section)`);
      lines.push('');
    }
  }
}

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
    lines.push('Skills go in each agent\'s skills directory: `.claude/skills/`, `.agents/skills/`');
    lines.push('');
    lines.push('**Skill quality check** - every skill file MUST have: **When to Use**, **Process** (phased + human gates), **Constraints**, **Output Format**, **Chaining**. No placeholder text.');
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
export function composeMultiAgentSetup(report: ScanReport, agentIds: AgentId[]): string {
  validateMultiAgentTemplateRefs(agentIds);

  const lines: string[] = [];
  const languages = renderMultiAgentIntro(lines, report);
  const firstId = agentIds[0];
  if (!firstId) return lines.join('\n');
  const allRefs = getAgentTemplates(firstId);
  const languageRefs = mapLanguagesToTemplates(report.stack.languages);
  const signalRefs = mapSignalsToTemplates(report.stack.signals, report.stack.languages);
  const standardShared = allRefs.filter(r => r.phase === 'standard' && !r.output.startsWith('('));
  const fullShared = allRefs.filter(r => r.phase === 'full' && !r.output.startsWith('('));

  renderMultiAgentFoundationSections(lines, agentIds, languages);
  lines.push(`**GATE:** Run \`${getCliCommand()} scan .\` - foundation tier must be 100% for all agents.`);
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
  lines.push(`After completing all phases, run \`${getCliCommand()} setup .\` to check for remaining issues.`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Mode: Setup redirect (under 50% - too many issues for inline fixes)
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

  lines.push(`# GOAT Flow Setup - ${profile.name}`);
  lines.push('');
  if (agentReport) {
    lines.push(`This project scores **${agentReport.score.grade}** (${agentReport.score.percentage}%) - it needs a full setup pass.`);
  } else {
    lines.push(`No ${profile.name} configuration detected - this project needs a full setup.`);
  }
  lines.push('');

  // Project context - detected stack info
  lines.push(`**Stack:** ${languages}`);
  const cmds = [
    stack.buildCommand && `**Build:** \`${stack.buildCommand}\``,
    stack.testCommand && `**Test:** \`${stack.testCommand}\``,
    stack.lintCommand && `**Lint:** \`${stack.lintCommand}\``,
  ].filter(Boolean).join(' | ');
  if (cmds) lines.push(cmds);
  renderSignals(lines, stack.signals);
  lines.push('');

  // Pre-instructions
  lines.push('## Before you start');
  lines.push('');
  lines.push('**Step 0 — Clean up stale artifacts (if upgrading):**');
  lines.push('');
  lines.push('**Skills:** The 6 canonical skills are: `goat`, `goat-debug`, `goat-plan`, `goat-review`, `goat-security`, `goat-test`.');
  lines.push('Delete any other `goat-*` directories (e.g., `goat-investigate`, `goat-audit`, `goat-onboard`, `goat-reflect`, `goat-resume`, `goat-simplify`, `goat-refactor`, `goat-context`).');
  lines.push('Also delete legacy skill directories: `audit/`, `review/`, `preflight/`.');
  lines.push('');
  lines.push('**Router table:** Rewrite the Router Table in the instruction file to reference only the 6 canonical skills:');
  lines.push('```');
  lines.push('| Resource | Path |');
  lines.push('|----------|------|');
  lines.push('| Skills | `.claude/skills/goat-*/` (or equivalent agent skills dir) |');
  lines.push('```');
  lines.push('Remove any entries pointing to deleted skills (goat-investigate, goat-reflect, etc.).');
  lines.push('');
  lines.push('**Dispatcher:** Replace the `/goat` dispatcher skill entirely from the goat-flow template.');
  lines.push('Read the template at `workflow/skills/goat.md` and write it to the agent skills dir.');
  lines.push('Preserve any project-specific disambiguation examples the existing dispatcher may have.');
  lines.push('');
  lines.push('1. Verify the detected stack above is correct. If not, the setup file will');
  lines.push('   ask you to detect it from the actual codebase (package.json, composer.json, etc.)');
  lines.push('2. "Adapt" means: replace generic examples with THIS project\'s real examples.');
  lines.push('   Skills: replace generic Step 0 questions with questions specific to this stack.');
  lines.push('   Footguns: only real traps from THIS codebase with `file:line` evidence.');
  lines.push('   Conventions: real build/test/lint commands, real file naming patterns.');
  lines.push('3. Do NOT copy templates verbatim. If a template says "[describe X]", describe X for THIS project.');
  lines.push('4. Check for existing permission restrictions: if `.claude/settings.local.json` (or equivalent)');
  lines.push('   exists and limits allowed tools/commands, the setup may fail to create files.');
  lines.push('   Read it first. If it restricts Bash or Write, work single-threaded instead of spawning sub-agents.');
  lines.push('');

  // Main instruction
  lines.push('## Setup instructions');
  lines.push('');
  lines.push(`Deeply review and implement the instructions in: \`${setupFile}\``);
  lines.push('');
  lines.push('That file walks through:');
  lines.push('- **Phase 1a:** Instruction file, docs seed files, local instruction files');
  lines.push('- **Phase 1b:** 6 skills (5 goat-* skills + /goat dispatcher) adapted for this project');
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
// Old inline setup - preserved as rollback
// ---------------------------------------------------------------------------

/**
 * Old inline setup composer - preserved as fallback.
 * Activate with GOAT_FLOW_INLINE_SETUP=1.
 */
export function composeInlineSetup(report: ScanReport, agentId: AgentId): ComposedPrompt | null {
  const agentReport = report.agents.find(a => a.agent === agentId);
  const vars = agentReport
    ? extractTemplateVars(report, agentReport)
    : buildFreshVars(report, agentId);

  const allFragments = getAllFragments();
  const phases = [
    { phase: 'foundation' as const, heading: 'Phase 1a: Foundation - Instruction File + Execution Loop' },
    { phase: 'standard' as const, heading: 'Phase 1b: Standard - Skills, Hooks, Learning Loop' },
    { phase: 'full' as const, heading: 'Phase 2: Full - Evals, CI, Hygiene' },
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
    title: `GOAT Flow Setup - ${vars.agentName}`,
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
