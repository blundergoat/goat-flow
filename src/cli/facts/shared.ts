import type { SharedFacts, ReadonlyFS } from '../types.js';
import type { LoadedConfig } from '../config/types.js';

/**
 * Matches file path evidence in multiple formats:
 * - `src/auth.ts` (backtick-wrapped file path)
 * - `src/auth.ts:42` (backtick-wrapped with line number)
 * - `src/auth.ts:42-50` (backtick-wrapped with line range)
 * - (lines 866-880) or (line 52) (prose-style)
 * Line numbers are optional historical context — file paths alone are valid evidence.
 */
const EVIDENCE_PATTERN = /`[^`]+\.[a-zA-Z]{1,10}(?::[0-9]+(?:[-,][0-9]+)*)?`|\(lines?\s+[0-9]+/;

/** Regex to extract file paths from backtick-wrapped references (with optional line numbers). */
const FILE_REF_REGEX = /`([^`]+\.[a-zA-Z]{1,10})(?::[0-9]+(?:[-,][0-9]+)*)?`/g;

/** Check if a backtick-wrapped file:line reference is a real file path (not a URL/hostname) */
function isFileRef(filePath: string): boolean {
  // Skip hostname/URL patterns (not file references)
  if (/^https?:|:\/\//.test(filePath) || /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(filePath)) return false;
  // Paths with '/' are clearly file paths
  if (filePath.includes('/')) return true;
  // Root-level files with extensions (e.g., AGENTS.md:42) are valid refs
  // Bare names without extensions (e.g., webpack:123) are ambiguous - skip
  return /\.[a-zA-Z0-9]+$/.test(filePath);
}

/**
 * Check if a file reference can be reliably validated for staleness.
 * Paths with '/' are resolvable relative to the project root.
 * Bare filenames with source-code extensions (e.g., `router.go`, `auth.ts`)
 * are ambiguous - they may exist deep in subdirectories. We try fs.exists()
 * at root first; if it resolves, it's checkable. If not, and it has a source
 * extension without '/', skip it rather than reporting a false stale ref.
 */
function isCheckableForStaleness(filePath: string, fs: ReadonlyFS): boolean {
  if (filePath.includes('/')) return true;
  // If it exists at root, it's checkable regardless of extension
  if (fs.exists(filePath)) return true;
  // Bare source filenames that don't exist at root are likely shorthand
  // for deeply nested files - skip to avoid false positives
  if (/\.(go|ts|tsx|js|jsx|py|php|rs|java|kt|rb|cs|c|cpp|h|hpp|swift|scala)$/i.test(filePath)) return false;
  // Non-source files (AGENTS.md, package.json, etc.) should be at root
  return true;
}

interface MarkdownEntry {
  path: string;
  content: string;
}

interface EntryDir {
  path: string;
  exists: boolean;
  files: MarkdownEntry[];
}

interface FootgunRefSummary {
  staleRefs: string[];
  totalRefs: number;
  validRefs: number;
}

interface EvalFileAnalysis {
  hasOrigin: boolean;
  hasAgents: boolean;
  hasReplay: boolean;
  hasFrontmatter: boolean;
  hasRealContent: boolean;
  skillNames: string[];
}

interface EvalAggregate {
  allHaveOrigin: boolean;
  allHaveAgents: boolean;
  allHaveReplay: boolean;
  allHaveFrontmatter: boolean;
  realContentCount: number;
  skillNames: Set<string>;
}

interface LocalInstructionDir {
  location: 'ai' | 'github';
  dir: string;
}

interface LocalInstructionFlags {
  hasConventions: boolean;
  hasFrontend: boolean;
  hasBackend: boolean;
  hasCodeReview: boolean;
  hasGitCommit: boolean;
}

const CANONICAL_EVAL_SKILLS = ['goat', 'goat-debug', 'goat-review', 'goat-plan', 'goat-security', 'goat-test'];
const CANONICAL_EVAL_SKILL_SET = new Set(CANONICAL_EVAL_SKILLS);
const REQUIRED_GITIGNORE_ENTRIES = ['.env', 'settings.local.json'];
const HANDOFF_SECTIONS = ['status', 'current state', 'key decisions', 'known risks', 'next step'];

function listMarkdownEntries(fs: ReadonlyFS, dir: string): EntryDir {
  const exists = fs.exists(dir);
  const files = exists
    ? fs.listDir(dir)
      .filter(file => file.endsWith('.md') && file !== 'README.md')
      .sort((a, b) => a.localeCompare(b))
      .flatMap(file => {
        const path = dir.endsWith('/') ? `${dir}${file}` : `${dir}/${file}`;
        const content = fs.readFile(path);
        if (content === null) return [];
        return [{ path, content }];
      })
    : [];
  return { path: dir, exists, files };
}

function mergeDirMentions(target: Map<string, number>, content: string): void {
  const pathRefs = content.matchAll(new RegExp(FILE_REF_REGEX.source, 'g'));
  for (const match of pathRefs) {
    const group = match[1];
    if (group === undefined || !isFileRef(group)) continue;
    const dir = group.split('/').slice(0, -1).join('/');
    if (!dir) continue;
    target.set(dir, (target.get(dir) ?? 0) + 1);
  }
}

function hasEvidenceLabel(content: string): boolean {
  return /^evidence_type:\s*.+$/mi.test(content) || /^\*\*Evidence type:\*\*/m.test(content);
}

function hasFileEvidence(content: string): boolean {
  const refs = content.matchAll(new RegExp(FILE_REF_REGEX.source, 'g'));
  for (const match of refs) {
    if (match[1] !== undefined && isFileRef(match[1])) return true;
  }
  return false;
}

function hasFootgunEvidence(content: string): boolean {
  if (!EVIDENCE_PATTERN.test(content)) return false;
  return hasFileEvidence(content) || /\(lines?\s+[0-9]+/.test(content);
}

function summarizeFootgunRefs(fs: ReadonlyFS, content: string): FootgunRefSummary {
  const summary: FootgunRefSummary = { staleRefs: [], totalRefs: 0, validRefs: 0 };
  const fileRefs = content.matchAll(/`([^`]+):[0-9]+(?:[-,][0-9]+)*`/g);

  for (const match of fileRefs) {
    const filePath = match[1];
    if (filePath === undefined || !isFileRef(filePath) || !isCheckableForStaleness(filePath, fs)) continue;
    summary.totalRefs++;
    if (fs.exists(filePath)) {
      summary.validRefs++;
      continue;
    }
    summary.staleRefs.push(filePath);
  }

  return summary;
}

function getMissingFrontmatterDiagnostic(path: string, content: string): string | null {
  return /^---\n[\s\S]*?\n---\n?/m.test(content) ? null : `${path} missing YAML frontmatter`;
}

function summarizeFootgunEntries(fs: ReadonlyFS, entries: MarkdownEntry[]): Pick<
  SharedFacts['footguns'],
  'hasEvidence' | 'labelCount' | 'dirMentions' | 'staleRefs' | 'totalRefs' | 'validRefs' | 'formatDiagnostic'
> {
  const dirMentions = new Map<string, number>();
  const staleRefs: string[] = [];
  const diagnostics: string[] = [];
  let hasEvidence = false;
  let labelCount = 0;
  let totalRefs = 0;
  let validRefs = 0;

  for (const entry of entries) {
    const { content, path } = entry;
    if (hasEvidenceLabel(content)) labelCount++;
    hasEvidence ||= hasFootgunEvidence(content);
    mergeDirMentions(dirMentions, content);
    const refSummary = summarizeFootgunRefs(fs, content);
    totalRefs += refSummary.totalRefs;
    validRefs += refSummary.validRefs;
    staleRefs.push(...refSummary.staleRefs);
    const diagnostic = getMissingFrontmatterDiagnostic(path, content);
    if (diagnostic) diagnostics.push(diagnostic);
  }

  return {
    hasEvidence,
    labelCount,
    dirMentions,
    staleRefs,
    totalRefs,
    validRefs,
    formatDiagnostic: diagnostics.length > 0 ? diagnostics.join('; ') : null,
  };
}

function summarizeLessonEntries(fs: ReadonlyFS, entries: MarkdownEntry[]): Pick<
  SharedFacts['lessons'],
  'staleRefs' | 'formatDiagnostic'
> {
  const staleRefs: string[] = [];
  const diagnostics: string[] = [];

  for (const entry of entries) {
    const { content, path } = entry;
    const pathPattern = /`((?:src|config|app|apps|lib|docs|scripts|setup|workflow|strands_agents|agents|\.goat-flow)\/[^`]+)`/g;
    for (const match of content.matchAll(pathPattern)) {
      const ref = match[1];
      if (ref === undefined || /[*?{}]/.test(ref)) continue;
      const filePath = ref.replace(/:[0-9]+(?:[-,][0-9]+)*$/, '');
      if (!fs.exists(filePath)) staleRefs.push(filePath);
    }
    const diagnostic = getMissingFrontmatterDiagnostic(path, content);
    if (diagnostic) diagnostics.push(diagnostic);
  }

  return {
    staleRefs,
    formatDiagnostic: diagnostics.length > 0 ? diagnostics.join('; ') : null,
  };
}

/** Extract footgun facts: existence, evidence quality, and directory mention counts. */
function extractFootgunFacts(fs: ReadonlyFS, configState: LoadedConfig): SharedFacts['footguns'] {
  const committed = listMarkdownEntries(fs, configState.config.footguns.committed);
  const local = listMarkdownEntries(fs, configState.config.footguns.local);
  const allEntries = [...committed.files, ...local.files];
  const summary = summarizeFootgunEntries(fs, allEntries);
  const formatDiagnostic = allEntries.length === 0 && (committed.exists || local.exists)
    ? 'Footgun directories exist but contain 0 entry files'
    : summary.formatDiagnostic;

  return {
    exists: committed.exists || local.exists,
    committedExists: committed.exists,
    localExists: local.exists,
    hasEvidence: summary.hasEvidence,
    entryCount: allEntries.length,
    committedCount: committed.files.length,
    localCount: local.files.length,
    labelCount: summary.labelCount,
    hasEvidenceLabels: allEntries.length > 0 && summary.labelCount >= allEntries.length,
    dirMentions: summary.dirMentions,
    staleRefs: summary.staleRefs,
    totalRefs: summary.totalRefs,
    validRefs: summary.validRefs,
    formatDiagnostic,
    paths: {
      committed: configState.config.footguns.committed,
      local: configState.config.footguns.local,
    },
  };
}

/** Extract lessons facts: existence and whether entries are present. */
function extractLessonsFacts(fs: ReadonlyFS, configState: LoadedConfig): SharedFacts['lessons'] {
  const committed = listMarkdownEntries(fs, configState.config.lessons.committed);
  const local = listMarkdownEntries(fs, configState.config.lessons.local);
  const allEntries = [...committed.files, ...local.files];
  const summary = summarizeLessonEntries(fs, allEntries);
  const formatDiagnostic = allEntries.length === 0 && (committed.exists || local.exists)
    ? 'Lesson directories exist but contain 0 entry files'
    : summary.formatDiagnostic;

  return {
    exists: committed.exists || local.exists,
    committedExists: committed.exists,
    localExists: local.exists,
    hasEntries: allEntries.length > 0,
    entryCount: allEntries.length,
    committedCount: committed.files.length,
    localCount: local.files.length,
    staleRefs: summary.staleRefs,
    formatDiagnostic,
    paths: {
      committed: configState.config.lessons.committed,
      local: configState.config.lessons.local,
    },
  };
}

function listEvalFiles(fs: ReadonlyFS, evalsPath: string): string[] {
  if (!fs.exists(evalsPath)) return [];
  return fs.listDir(evalsPath).filter(file => file.endsWith('.md') && file !== 'README.md' && file !== 'FORMAT.md');
}

function createEmptyEvalFacts(dirExists: boolean, count: number, hasReadme: boolean, evalsPath: string): SharedFacts['evals'] {
  return {
    dirExists,
    count,
    hasReadme,
    hasOriginLabels: false,
    hasAgentsLabels: false,
    hasReplayPrompts: false,
    hasRealContent: false,
    hasFrontmatter: false,
    evalSkillCount: 0,
    missingSkills: [],
    path: evalsPath,
  };
}

function collectEvalSkillNames(content: string): string[] {
  const skillNames = new Set<string>();
  const skillMatches = content.matchAll(/\*\*Skill:\*\*\s*(.+)|skill:\s*(.+)/gi);

  for (const match of skillMatches) {
    const name = (match[1] ?? match[2] ?? '').trim().toLowerCase();
    if (name && CANONICAL_EVAL_SKILL_SET.has(name)) skillNames.add(name);
  }

  return Array.from(skillNames);
}

function hasEvalRealContent(content: string): boolean {
  const scenarioMatch = content.match(/##+ (?:Replay Prompt|Scenario)\s*\n([\s\S]*?)(?=\n##|\n---|$)/i);
  const scenarioBody = scenarioMatch?.[1]?.trim() ?? '';
  return scenarioBody.length >= 100 && !/^(?:TODO|TBD)/i.test(scenarioBody);
}

function analyzeEvalFile(fs: ReadonlyFS, evalsPath: string, fileName: string): EvalFileAnalysis {
  const content = fs.readFile(`${evalsPath}/${fileName}`);
  if (content === null) {
    return {
      hasOrigin: false,
      hasAgents: false,
      hasReplay: false,
      hasFrontmatter: true,
      hasRealContent: false,
      skillNames: [],
    };
  }

  return {
    hasOrigin: /\*\*Origin:\*\*/i.test(content) || /^## Origin/im.test(content) || /^origin:/im.test(content),
    hasAgents: /\*\*Agents:\*\*/i.test(content) || /^agents:/im.test(content),
    hasReplay: /##+ Replay Prompt/i.test(content) || /##+ Scenario/i.test(content),
    hasFrontmatter: /^---\n/.test(content),
    hasRealContent: hasEvalRealContent(content),
    skillNames: collectEvalSkillNames(content),
  };
}

function createEvalAggregate(): EvalAggregate {
  return {
    allHaveOrigin: true,
    allHaveAgents: true,
    allHaveReplay: true,
    allHaveFrontmatter: true,
    realContentCount: 0,
    skillNames: new Set<string>(),
  };
}

function mergeEvalAnalysis(aggregate: EvalAggregate, analysis: EvalFileAnalysis): void {
  aggregate.allHaveOrigin &&= analysis.hasOrigin;
  aggregate.allHaveAgents &&= analysis.hasAgents;
  aggregate.allHaveReplay &&= analysis.hasReplay;
  aggregate.allHaveFrontmatter &&= analysis.hasFrontmatter;
  if (analysis.hasRealContent) aggregate.realContentCount++;
  for (const skillName of analysis.skillNames) {
    aggregate.skillNames.add(skillName);
  }
}

/** Extract eval facts: directory, file count, replay prompts, origin labels, skill coverage. */
function extractEvalFacts(fs: ReadonlyFS, rawEvalsPath: string): SharedFacts['evals'] {
  const evalsPath = rawEvalsPath.replace(/\/$/, '');
  const dirExists = fs.exists(evalsPath);
  const evalFiles = listEvalFiles(fs, evalsPath);
  const count = evalFiles.length;
  const hasReadme = dirExists && fs.exists(`${evalsPath}/README.md`);

  if (count === 0) return createEmptyEvalFacts(dirExists, count, hasReadme, evalsPath);

  const aggregate = createEvalAggregate();
  for (const fileName of evalFiles) {
    mergeEvalAnalysis(aggregate, analyzeEvalFile(fs, evalsPath, fileName));
  }

  return {
    dirExists,
    count,
    hasReadme,
    hasOriginLabels: aggregate.allHaveOrigin,
    hasAgentsLabels: aggregate.allHaveAgents,
    hasReplayPrompts: aggregate.allHaveReplay,
    hasRealContent: aggregate.realContentCount >= Math.ceil(count * 0.60),
    hasFrontmatter: aggregate.allHaveFrontmatter,
    evalSkillCount: aggregate.skillNames.size,
    missingSkills: CANONICAL_EVAL_SKILLS.filter(skill => !aggregate.skillNames.has(skill)).sort(),
    path: evalsPath,
  };
}

function extractArchitectureFacts(fs: ReadonlyFS): SharedFacts['architecture'] {
  const exists = fs.exists('docs/architecture.md');
  return { exists, lineCount: exists ? fs.lineCount('docs/architecture.md') : 0 };
}

function hasCIWorkflowCheck(ciContent: string | null, pattern: RegExp): boolean {
  return ciContent !== null && pattern.test(ciContent);
}

function checksCILineCount(ciContent: string | null): boolean {
  if (ciContent === null) return false;
  return (/wc\s+-l/i.test(ciContent) && /CLAUDE|AGENTS|GEMINI|\.md/i.test(ciContent))
    || /context-validate/i.test(ciContent);
}

function checksCIRouter(ciContent: string | null): boolean {
  return hasCIWorkflowCheck(ciContent, /context-validate/i)
    || hasCIWorkflowCheck(ciContent, /router.*resolve|router.*check|router.*ref/i);
}

function checksCISkills(ciContent: string | null): boolean {
  return hasCIWorkflowCheck(ciContent, /context-validate/i)
    || hasCIWorkflowCheck(ciContent, /goat-.*SKILL\.md|skills.*goat-/i);
}

function extractCIFacts(fs: ReadonlyFS): SharedFacts['ci'] {
  const workflowContent = fs.readFile('.github/workflows/context-validation.yml');
  return {
    workflowExists: workflowContent !== null,
    checksLineCount: checksCILineCount(workflowContent),
    checksRouter: checksCIRouter(workflowContent),
    checksSkills: checksCISkills(workflowContent),
    ciTriggersOnPRs: hasCIWorkflowCheck(workflowContent, /pull_request/i),
  };
}

function extractGitignoreFacts(fs: ReadonlyFS): SharedFacts['gitignore'] {
  const content = fs.readFile('.gitignore');
  return {
    exists: content !== null,
    hasRequiredEntries: content !== null && REQUIRED_GITIGNORE_ENTRIES.every(entry => content.includes(entry)),
  };
}

function extractHandoffTemplateFacts(fs: ReadonlyFS): SharedFacts['handoffTemplate'] {
  const content = fs.readFile('.goat-flow/tasks/handoff-template.md');
  const sectionCount = content
    ? HANDOFF_SECTIONS.filter(section => new RegExp(`##\\s*${section}|\\*\\*${section}`, 'i').test(content)).length
    : 0;

  return {
    exists: content !== null,
    sectionCount,
    hasRequiredSections: sectionCount >= 5,
  };
}

/** Extract project-wide shared facts from docs, evals, CI, and config files. */
export function extractSharedFacts(fs: ReadonlyFS, configState: LoadedConfig): SharedFacts {
  return {
    footguns: extractFootgunFacts(fs, configState),
    lessons: extractLessonsFacts(fs, configState),
    config: {
      exists: configState.exists,
      valid: configState.valid,
      warningCount: configState.warnings.length,
      errorCount: configState.errors.length,
      parseError: configState.parseError,
      lineLimits: configState.config.lineLimits,
    },
    architecture: extractArchitectureFacts(fs),
    evals: extractEvalFacts(fs, configState.config.evals.path),
    ci: extractCIFacts(fs),
    handoffTemplate: extractHandoffTemplateFacts(fs),
    ignoreFiles: {
      copilotignore: fs.exists('.copilotignore'),
      cursorignore: fs.exists('.cursorignore'),
      geminiignore: fs.exists('.geminiignore'),
    },
    gitignore: extractGitignoreFacts(fs),
    guidelinesOwnership: { exists: fs.exists('docs/guidelines-ownership-split.md') },
    domainReference: { exists: fs.exists('docs/domain-reference.md') },
    preflightScript: { exists: fs.exists('scripts/preflight-checks.sh') },
    // changelog removed - project-level concern, not AI workflow.
    decisions: extractDecisionsFacts(fs, configState.config.decisions.path),
    localInstructions: extractLocalInstructions(fs, configState.config.codingStandards.path),
    gitCommitInstructions: { exists: fs.exists('.github/git-commit-instructions.md') },
    aiInstructionsLineCount: countCodingStandardsLines(fs, configState.config.codingStandards.path),
  };
}

/** Count total lines across coding standards files */
function countCodingStandardsLines(fs: ReadonlyFS, rawCsPath: string): number {
  const csPath = rawCsPath.replace(/\/$/, '');
  if (!fs.exists(csPath)) return 0;
  const files = fs.listDir(csPath).filter(f => f.endsWith('.md'));
  let total = 0;
  for (const f of files) {
    total += fs.lineCount(`${csPath}/${f}`);
  }
  return total;
}

/** Extract decisions directory facts: existence and file count. */
function extractDecisionsFacts(fs: ReadonlyFS, rawPath: string): SharedFacts['decisions'] {
  const path = rawPath.replace(/\/$/, '');
  /** Whether the decisions directory exists */
  const dirExists = fs.exists(path);
  /** Count of markdown files in decisions directory, excluding README */
  const files = dirExists
    ? fs.listDir(path).filter(f => f.endsWith('.md') && f !== 'README.md')
    : [];
  const fileCount = files.length;
  // Check if at least 1 ADR has real Context + Decision content (≥50 chars each, not TODO/TBD)
  let hasRealContent = false;
  for (const f of files) {
    const content = fs.readFile(`${path}/${f}`);
    if (!content) continue;
    const hasContext = /^## Context\s*\n(.{50,})/m.test(content);
    const hasDecision = /^## Decision\s*\n(.{50,})/m.test(content);
    const startsWithTodo = /^## (?:Context|Decision)\s*\n\s*(?:TODO|TBD)/im.test(content);
    if (hasContext && hasDecision && !startsWithTodo) { hasRealContent = true; break; }
  }
  return { dirExists, fileCount, path, hasRealContent };
}

function resolveLocalInstructionDir(fs: ReadonlyFS, csPath: string): LocalInstructionDir | null {
  if (fs.exists(csPath)) return { location: 'ai', dir: csPath };
  if (fs.exists('.github/instructions')) return { location: 'github', dir: '.github/instructions' };
  return null;
}

function createEmptyLocalInstructions(csPath: string): SharedFacts['localInstructions'] {
  return {
    dirExists: false,
    location: null,
    fileCount: 0,
    hasRouter: false,
    hasConventions: false,
    conventionsHasContent: false,
    hasFrontend: false,
    hasBackend: false,
    hasCodeReview: false,
    hasGitCommit: false,
    conventionsContent: null,
    localFileSizes: [],
    path: csPath,
  };
}

function hasInstructionFile(files: string[], baseName: string): boolean {
  return files.some(file => file === `${baseName}.md` || file === `${baseName}.instructions.md`);
}

function collectLocalInstructionFlags(files: string[]): LocalInstructionFlags {
  return {
    hasConventions: hasInstructionFile(files, 'conventions'),
    hasFrontend: hasInstructionFile(files, 'frontend'),
    hasBackend: hasInstructionFile(files, 'backend'),
    hasCodeReview: hasInstructionFile(files, 'code-review'),
    hasGitCommit: hasInstructionFile(files, 'git-commit'),
  };
}

function collectLocalFileSizes(fs: ReadonlyFS, dir: string, files: string[]): Array<{ path: string; lines: number }> {
  return files.map(file => ({ path: `${dir}/${file}`, lines: fs.lineCount(`${dir}/${file}`) }));
}

function hasConventionsContent(content: string): boolean {
  const hasCommands = /##.*command|```bash|```sh/i.test(content);
  const hasConventionRules = /##.*convention|do.*don't|do:.*don't:|good.*bad/i.test(content);
  const lineCount = content.split('\n').length;
  return hasCommands && hasConventionRules && lineCount > 15;
}

function analyzeConventionsContent(
  fs: ReadonlyFS,
  location: LocalInstructionDir['location'],
  csPath: string,
  hasConventions: boolean,
): Pick<SharedFacts['localInstructions'], 'conventionsContent' | 'conventionsHasContent'> {
  if (!hasConventions) return { conventionsContent: null, conventionsHasContent: false };

  const conventionsPath = location === 'ai'
    ? `${csPath}/conventions.md`
    : '.github/instructions/conventions.instructions.md';
  const conventionsContent = fs.readFile(conventionsPath);
  return {
    conventionsContent,
    conventionsHasContent: conventionsContent !== null && hasConventionsContent(conventionsContent),
  };
}

/** Detect and analyze local instruction files from coding-standards dir or .github/instructions/. */
function extractLocalInstructions(fs: ReadonlyFS, rawCsPath: string): SharedFacts['localInstructions'] {
  const csPath = rawCsPath.replace(/\/$/, '');
  const localInstructionDir = resolveLocalInstructionDir(fs, csPath);
  if (localInstructionDir === null) return createEmptyLocalInstructions(csPath);

  const { dir, location } = localInstructionDir;
  const files = fs.listDir(dir).filter(file => file.endsWith('.md'));
  const flags = collectLocalInstructionFlags(files);
  const conventions = analyzeConventionsContent(fs, location, csPath, flags.hasConventions);

  return {
    dirExists: true,
    location,
    fileCount: files.length,
    hasRouter: location === 'ai' && fs.exists('ai/README.md'),
    hasConventions: flags.hasConventions,
    conventionsHasContent: conventions.conventionsHasContent,
    hasFrontend: flags.hasFrontend,
    hasBackend: flags.hasBackend,
    hasCodeReview: flags.hasCodeReview,
    hasGitCommit: flags.hasGitCommit,
    conventionsContent: conventions.conventionsContent,
    localFileSizes: collectLocalFileSizes(fs, dir, files),
    path: dir,
  };
}
