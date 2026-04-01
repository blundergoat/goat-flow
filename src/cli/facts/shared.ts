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
    if (/^evidence_type:\s*.+$/mi.test(content) || /^\*\*Evidence type:\*\*/m.test(content)) {
      labelCount++;
    }

    if (!hasEvidence && EVIDENCE_PATTERN.test(content)) {
      const refs = content.matchAll(new RegExp(FILE_REF_REGEX.source, 'g'));
      for (const match of refs) {
        if (match[1] !== undefined && isFileRef(match[1])) {
          hasEvidence = true;
          break;
        }
      }
      if (!hasEvidence) hasEvidence = /\(lines?\s+[0-9]+/.test(content);
    }

    mergeDirMentions(dirMentions, content);

    const fileRefs = content.matchAll(/`([^`]+):[0-9]+(?:[-,][0-9]+)*`/g);
    for (const match of fileRefs) {
      const filePath = match[1];
      if (filePath === undefined || !isFileRef(filePath) || !isCheckableForStaleness(filePath, fs)) continue;
      totalRefs++;
      if (fs.exists(filePath)) validRefs++;
      else staleRefs.push(filePath);
    }

    if (!/^---\n[\s\S]*?\n---\n?/m.test(content)) {
      diagnostics.push(`${path} missing YAML frontmatter`);
    }
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
    if (!/^---\n[\s\S]*?\n---\n?/m.test(content)) {
      diagnostics.push(`${path} missing YAML frontmatter`);
    }
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

/** Extract eval facts: directory, file count, replay prompts, origin labels, skill coverage. */
function extractEvalFacts(fs: ReadonlyFS, rawEvalsPath: string): SharedFacts['evals'] {
  const evalsPath = rawEvalsPath.replace(/\/$/, '');
  /** Whether the evals directory exists */
  const dirExists = fs.exists(evalsPath);
  /** Markdown eval files (excluding README) found in the evals directory */
  const evalFiles = dirExists ? fs.listDir(evalsPath).filter(f => f.endsWith('.md') && f !== 'README.md' && f !== 'FORMAT.md') : [];
  /** Total number of eval files found */
  const count = evalFiles.length;
  /** Whether the evals directory contains a README.md */
  const hasReadme = dirExists && fs.exists(`${evalsPath}/README.md`);

  if (count === 0) {
    return { dirExists, count, hasReadme, hasOriginLabels: false, hasAgentsLabels: false, hasReplayPrompts: false, hasRealContent: false, hasFrontmatter: false, evalSkillCount: 0, missingSkills: [], path: evalsPath };
  }

  /** The 6 canonical goat-flow skills (5 + dispatcher) */
  const CANONICAL_SKILLS = new Set(['goat', 'goat-debug', 'goat-review', 'goat-plan', 'goat-security', 'goat-test']);
  /** Canonical skills with at least one eval */
  const skillNames = new Set<string>();
  /** Track whether all eval files pass origin/replay/agents/frontmatter checks */
  let allHaveOrigin = true;
  let allHaveAgents = true;
  let allHaveReplay = true;
  let allHaveFrontmatter = true;
  let realContentCount = 0;
  // Iterate over ALL eval files for quality checks and skill counting
  for (const f of evalFiles) {
    /** Raw content of this eval file */
    const content = fs.readFile(`${evalsPath}/${f}`);
    if (content === null) {
      allHaveOrigin = false;
      allHaveAgents = false;
      allHaveReplay = false;
      continue;
    }
    if (!/^---\n/.test(content)) allHaveFrontmatter = false;
    if (/\*\*Origin:\*\*/i.test(content) === false && /^## Origin/im.test(content) === false && /^origin:/im.test(content) === false) allHaveOrigin = false;
    if (/\*\*Agents:\*\*/i.test(content) === false && /^agents:/im.test(content) === false) allHaveAgents = false;
    if (/##+ Replay Prompt/i.test(content) === false && /##+ Scenario/i.test(content) === false) allHaveReplay = false;
    // Check for real scenario content: ≥100 chars after scenario heading, not just TODO/TBD
    const scenarioMatch = content.match(/##+ (?:Replay Prompt|Scenario)\s*\n([\s\S]*?)(?=\n##|\n---|$)/i);
    const scenarioBody = scenarioMatch?.[1]?.trim() ?? '';
    if (scenarioBody.length >= 100 && !/^(?:TODO|TBD)/i.test(scenarioBody)) realContentCount++;
    /** All skill label matches found in the eval content */
    const skillMatches = content.matchAll(/\*\*Skill:\*\*\s*(.+)|skill:\s*(.+)/gi);
    // Iterate over skill matches to collect unique skill names
    for (const m of skillMatches) {
      /** Normalized skill name from the match */
      const name = (m[1] ?? m[2] ?? '').trim().toLowerCase();
      if (name && CANONICAL_SKILLS.has(name)) skillNames.add(name);
    }
  }
  const missingSkills = Array.from(CANONICAL_SKILLS).filter(skill => !skillNames.has(skill)).sort();
  // hasRealContent: at least 60% of evals have ≥100 char scenarios (not all — dispatcher intent tests and other eval types use shorter formats)
  const hasRealContent = count > 0 && realContentCount >= Math.ceil(count * 0.60);
  return { dirExists, count, hasReadme, hasOriginLabels: allHaveOrigin, hasAgentsLabels: allHaveAgents, hasReplayPrompts: allHaveReplay, hasRealContent, hasFrontmatter: allHaveFrontmatter, evalSkillCount: skillNames.size, missingSkills, path: evalsPath };
}

/** Extract project-wide shared facts from docs, evals, CI, and config files. */
export function extractSharedFacts(fs: ReadonlyFS, configState: LoadedConfig): SharedFacts {
  /** Whether the architecture documentation file exists */
  const archExists = fs.exists('docs/architecture.md');
  /** Line count of the architecture file (0 if missing) */
  const archLineCount = archExists ? fs.lineCount('docs/architecture.md') : 0;

  /** Raw content of the CI workflow file */
  const ciContent = fs.readFile('.github/workflows/context-validation.yml');
  /** Whether the CI workflow file exists */
  const ciExists = ciContent !== null;

  /** Whether a .copilotignore file exists */
  const copilotignore = fs.exists('.copilotignore');
  /** Whether a .cursorignore file exists */
  const cursorignore = fs.exists('.cursorignore');
  /** Whether a .geminiignore file exists */
  const geminiignore = fs.exists('.geminiignore');

  /** Raw content of the .gitignore file */
  const gitignoreContent = fs.readFile('.gitignore');
  /** Whether the .gitignore file exists */
  const gitignoreExists = gitignoreContent !== null;
  /** Entries that must be present in .gitignore for security */
  const requiredEntries = ['.env', 'settings.local.json'];
  /** Whether all required entries are present in .gitignore */
  const hasRequiredEntries = gitignoreExists && requiredEntries.every(e =>
    gitignoreContent.includes(e)
  );

  /** Raw content of the shared handoff template */
  const handoffContent = fs.readFile('.goat-flow/tasks/handoff-template.md');
  /** Whether the handoff template exists */
  const handoffExists = handoffContent !== null;
  /** Count of required handoff sections present - accepts ## H2 headings or **Bold:** labels */
  const HANDOFF_SECTIONS = ['status', 'current state', 'key decisions', 'known risks', 'next step'];
  const handoffSectionCount = handoffContent
    ? HANDOFF_SECTIONS.filter(s => new RegExp(`##\\s*${s}|\\*\\*${s}`, 'i').test(handoffContent)).length
    : 0;

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
    architecture: { exists: archExists, lineCount: archLineCount },
    evals: extractEvalFacts(fs, configState.config.evals.path),
    ci: {
      workflowExists: ciExists,
      // Hardened checks: look for actual invocations in `run:` blocks, not just keywords
      // Accept: wc -l in a run block, or context-validate.sh (which does the check)
      checksLineCount: ciExists && ((/wc\s+-l/i.test(ciContent) && /CLAUDE|AGENTS|GEMINI|\.md/i.test(ciContent)) || /context-validate/i.test(ciContent)),
      // Accept: context-validate.sh, or router/reference check in a run block
      checksRouter: ciExists && (/context-validate/i.test(ciContent) || /router.*resolve|router.*check|router.*ref/i.test(ciContent)),
      // Accept: goat- pattern in a run block checking skill dirs, or context-validate.sh
      checksSkills: ciExists && (/context-validate/i.test(ciContent) || /goat-.*SKILL\.md|skills.*goat-/i.test(ciContent)),
      ciTriggersOnPRs: ciExists && /pull_request/i.test(ciContent),
    },
    handoffTemplate: {
      exists: handoffExists,
      sectionCount: handoffSectionCount,
      hasRequiredSections: handoffSectionCount >= 5,
    },
    ignoreFiles: { copilotignore, cursorignore, geminiignore },
    gitignore: { exists: gitignoreExists, hasRequiredEntries },
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

/** Detect and analyze local instruction files from coding-standards dir or .github/instructions/. */
function extractLocalInstructions(fs: ReadonlyFS, rawCsPath: string): SharedFacts['localInstructions'] {
  const csPath = rawCsPath.replace(/\/$/, '');
  /** Whether the coding-standards directory exists at the configured path */
  const aiDir = fs.exists(csPath);
  /** Whether the .github/instructions/ directory exists */
  const ghDir = fs.exists('.github/instructions');

  if (aiDir === false && ghDir === false) {
    return { dirExists: false, location: null, fileCount: 0, hasRouter: false, hasConventions: false, conventionsHasContent: false, hasFrontend: false, hasBackend: false, hasCodeReview: false, hasGitCommit: false, conventionsContent: null, localFileSizes: [], path: csPath };
  }

  /** Which directory convention is in use ('ai' or 'github') */
  const location = aiDir ? 'ai' as const : 'github' as const;
  /** Resolved path to the local instructions directory */
  const dir = aiDir ? csPath : '.github/instructions';
  /** Markdown files found in the local instructions directory */
  const files = fs.listDir(dir).filter(f => f.endsWith('.md'));
  /** Whether a router README exists for the ai/ convention */
  const hasRouter = aiDir ? fs.exists('ai/README.md') : false;

  /** Whether a conventions instruction file exists */
  const hasConventions = files.some(f => f === 'conventions.md' || f === 'conventions.instructions.md');
  /** Whether a frontend instruction file exists */
  const hasFrontend = files.some(f => f === 'frontend.md' || f === 'frontend.instructions.md');
  /** Whether a backend instruction file exists */
  const hasBackend = files.some(f => f === 'backend.md' || f === 'backend.instructions.md');
  /** Whether a code-review instruction file exists */
  const hasCodeReview = files.some(f => f === 'code-review.md' || f === 'code-review.instructions.md');
  /** Whether a git-commit instruction file exists */
  const hasGitCommit = files.some(f => f === 'git-commit.md' || f === 'git-commit.instructions.md');

  /** Line counts for each markdown file in the local instructions directory */
  const localFileSizes: Array<{ path: string; lines: number }> = [];
  // Iterate over instruction files to record their line counts
  for (const f of files) {
    /** Line count for this instruction file */
    const lines = fs.lineCount(`${dir}/${f}`);
    localFileSizes.push({ path: `${dir}/${f}`, lines });
  }

  // Check conventions.md has real content (commands + conventions, not just a header)
  let conventionsHasContent = false;
  /** Raw content of the conventions file, stored for anti-pattern checks */
  let conventionsContent: string | null = null;
  if (hasConventions) {
    /** Resolved path to the conventions instruction file */
    const conventionsPath = aiDir ? `${csPath}/conventions.md` : '.github/instructions/conventions.instructions.md';
    conventionsContent = fs.readFile(conventionsPath);
    if (conventionsContent) {
      /** Whether the conventions file includes command examples */
      const hasCommands = /##.*command|```bash|```sh/i.test(conventionsContent);
      /** Whether the conventions file includes convention rules */
      const hasConvRules = /##.*convention|do.*don't|do:.*don't:|good.*bad/i.test(conventionsContent);
      /** Line count of the conventions file */
      const lineCount = conventionsContent.split('\n').length;
      conventionsHasContent = hasCommands && hasConvRules && lineCount > 15;
    }
  }

  return { dirExists: true, location, fileCount: files.length, hasRouter, hasConventions, conventionsHasContent, hasFrontend, hasBackend, hasCodeReview, hasGitCommit, conventionsContent, localFileSizes, path: dir };
}
