/**
 * Project-wide fact extractor for shared GOAT Flow assets.
 * This includes architecture docs, router paths, and the learning-loop directories, including category-bucket lesson and footgun entry counting.
 */
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
const EVIDENCE_PATTERN =
  /`[^`]+\.[a-zA-Z]{1,10}(?::[0-9]+(?:[-,][0-9]+)*)?`|\(lines?\s+[0-9]+/;

/** Regex to extract file paths from backtick-wrapped references (with optional line numbers). */
const FILE_REF_REGEX = /`([^`]+\.[a-zA-Z]{1,10})(?::[0-9]+(?:[-,][0-9]+)*)?`/g;

/** Check if a backtick-wrapped file:line reference is a real file path (not a URL/hostname) */
function isFileRef(filePath: string): boolean {
  // Skip hostname/URL patterns (not file references)
  if (
    /^https?:|:\/\//.test(filePath) ||
    /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(filePath)
  )
    return false;
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
  if (
    /\.(go|ts|tsx|js|jsx|py|php|rs|java|kt|rb|cs|c|cpp|h|hpp|swift|scala)$/i.test(
      filePath,
    )
  )
    return false;
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
  invalidLineRefs: string[];
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

interface RouterValidation {
  hasValidRouter: boolean;
  routerNeedsFix: string | null;
  invalidRefs: string[];
}

const CANONICAL_EVAL_SKILLS = [
  'goat',
  'goat-debug',
  'goat-review',
  'goat-plan',
  'goat-security',
  'goat-test',
];
const FOOTGUN_SURFACE_CANDIDATES = [
  'docs/footguns/',
  '.goat-flow/footguns/',
  'docs/footguns.md',
  '.goat-flow/footguns.md',
];
const LESSON_SURFACE_CANDIDATES = [
  'ai/lessons/',
  '.goat-flow/lessons/',
  'docs/lessons/',
  'docs/lessons.md',
  '.goat-flow/lessons.md',
];
const CANONICAL_EVAL_SKILL_SET = new Set(CANONICAL_EVAL_SKILLS);
const REQUIRED_GITIGNORE_ENTRIES = ['.env', 'settings.local.json'];
export const HANDOFF_SECTIONS = [
  'date',
  'status',
  'current state',
  'key decisions',
  'errors & corrections',
  'learnings',
  'known risks',
  'next step',
  'context files',
];

/** Normalize a surface path so trailing slashes do not affect comparisons. */
function normalizeSurfacePath(path: string): string {
  return path.replace(/\/$/, '');
}

/** Detect competing artifact surfaces outside the configured committed/local split. */
function findCompetingArtifactSurfaces(
  fs: ReadonlyFS,
  canonicalPaths: string[],
  knownPaths: string[],
): string[] {
  if (!canonicalPaths.some((path) => fs.exists(path))) return [];

  const canonicalSet = new Set(canonicalPaths.map(normalizeSurfacePath));
  return knownPaths
    .filter((path) => !canonicalSet.has(normalizeSurfacePath(path)))
    .filter((path) => fs.exists(path))
    .sort((a, b) => a.localeCompare(b));
}

/** List markdown entries. */
function listMarkdownEntries(fs: ReadonlyFS, dir: string): EntryDir {
  const exists = fs.exists(dir);
  const files = exists
    ? fs
        .listDir(dir)
        .filter((file) => file.endsWith('.md') && file !== 'README.md')
        .sort((a, b) => a.localeCompare(b))
        .flatMap((file) => {
          const path = dir.endsWith('/') ? `${dir}${file}` : `${dir}/${file}`;
          const content = fs.readFile(path);
          if (content === null) return [];
          return [{ path, content }];
        })
    : [];
  return { path: dir, exists, files };
}

/** Parse markdown frontmatter. */
function parseMarkdownFrontmatter(content: string): {
  frontmatter: string | null;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: null, body: content };
  return { frontmatter: match[1] ?? '', body: match[2] ?? '' };
}

/** Count matches. */
function countMatches(content: string, pattern: RegExp): number {
  return Array.from(content.matchAll(pattern)).length;
}

/** Count lesson entries. */
function countLessonEntries(content: string): number {
  const { body } = parseMarkdownFrontmatter(content);
  const bucketCount = countMatches(body, /^##\s+(?:Lesson|Pattern):\s+/gm);
  return bucketCount > 0 ? bucketCount : 1;
}

/** Count footgun entries. */
function countFootgunEntries(content: string): number {
  const { body } = parseMarkdownFrontmatter(content);
  const bucketCount = countMatches(body, /^##\s+Footgun:\s+/gm);
  return bucketCount > 0 ? bucketCount : 1;
}

/** Count footgun labels. */
function countFootgunLabels(content: string): number {
  const { body } = parseMarkdownFrontmatter(content);
  const bucketCount = countMatches(body, /^##\s+Footgun:\s+/gm);
  if (bucketCount > 0) {
    return countMatches(
      body,
      /\*\*Evidence(?:\s+type)?:\*\*\s*(?:ACTUAL_MEASURED|DESIGN_TARGET|HYPOTHETICAL_EXAMPLE)/gim,
    );
  }
  return hasEvidenceLabel(content) ? 1 : 0;
}

/** Accumulate directory mention counts from file references in markdown content. */
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

/** Detect whether a footgun entry declares an explicit evidence label. */
function hasEvidenceLabel(content: string): boolean {
  return (
    /^evidence_type:\s*.+$/im.test(content) ||
    /^\*\*Evidence type:\*\*/m.test(content) ||
    /\*\*Evidence:\*\*\s*(?:ACTUAL_MEASURED|DESIGN_TARGET|HYPOTHETICAL_EXAMPLE)/m.test(
      content,
    )
  );
}

/** Detect whether markdown content cites at least one file reference. */
function hasFileEvidence(content: string): boolean {
  const refs = content.matchAll(/`([^`]+\.[a-zA-Z]{1,10}:[0-9]+(?:[-,][0-9]+)*)`/g);
  for (const match of refs) {
    if (match[1] !== undefined && isFileRef(match[1])) return true;
  }
  return false;
}

/** Detect whether a footgun entry includes usable file or line evidence. */
function hasFootgunEvidence(content: string): boolean {
  if (!EVIDENCE_PATTERN.test(content)) return false;
  return hasFileEvidence(content);
}

/** Check referenced `file:line` evidence for stale footgun paths. */
function summarizeFootgunRefs(
  fs: ReadonlyFS,
  content: string,
): FootgunRefSummary {
  const summary: FootgunRefSummary = {
    staleRefs: [],
    invalidLineRefs: [],
    totalRefs: 0,
    validRefs: 0,
  };
  const fileRefs = content.matchAll(
    /`([^`]+):([0-9]+(?:[-,][0-9]+)*)`/g,
  );

  for (const match of fileRefs) {
    const filePath = match[1];
    const rawLines = match[2];
    if (
      filePath === undefined ||
      rawLines === undefined ||
      !isFileRef(filePath) ||
      !isCheckableForStaleness(filePath, fs)
    )
      continue;
    summary.totalRefs++;
    if (!fs.exists(filePath)) {
      summary.staleRefs.push(`${filePath}:${rawLines}`);
      continue;
    }

    const lineCount = fs.lineCount(filePath);
    const lineNumbers = Array.from(rawLines.matchAll(/[0-9]+/g)).flatMap(
      (lineMatch) => {
        const value = Number.parseInt(lineMatch[0], 10);
        return Number.isNaN(value) ? [] : [value];
      },
    );
    const hasOutOfBoundsLine = lineNumbers.some(
      (lineNumber) => lineNumber < 1 || lineNumber > lineCount,
    );

    if (hasOutOfBoundsLine) {
      summary.invalidLineRefs.push(`${filePath}:${rawLines}`);
      continue;
    }

    summary.validRefs++;
  }

  return summary;
}

/** Return a format diagnostic when a lesson or footgun bucket is missing required frontmatter. */
function getMissingFrontmatterDiagnostic(
  path: string,
  content: string,
): string | null {
  const { frontmatter, body } = parseMarkdownFrontmatter(content);
  if (frontmatter === null) return `${path} missing YAML frontmatter`;

  const lessonBucketCount = countMatches(
    body,
    /^##\s+(?:Lesson|Pattern):\s+/gm,
  );
  if (
    lessonBucketCount > 0 &&
    /^category:\s*.+$/im.test(frontmatter) === false
  ) {
    return `${path} is a lessons category bucket but missing frontmatter category`;
  }

  const footgunBucketCount = countMatches(body, /^##\s+Footgun:\s+/gm);
  if (
    footgunBucketCount > 0 &&
    /^category:\s*.+$/im.test(frontmatter) === false
  ) {
    return `${path} is a footguns category bucket but missing frontmatter category`;
  }

  return null;
}

/** Aggregate evidence, labels, directory mentions, and stale refs across footgun entries. */
function summarizeFootgunEntries(
  fs: ReadonlyFS,
  entries: MarkdownEntry[],
): Pick<
  SharedFacts['footguns'],
  | 'hasEvidence'
  | 'entryCount'
  | 'labelCount'
  | 'dirMentions'
  | 'staleRefs'
  | 'invalidLineRefs'
  | 'totalRefs'
  | 'validRefs'
  | 'formatDiagnostic'
> {
  const dirMentions = new Map<string, number>();
  const staleRefs: string[] = [];
  const invalidLineRefs: string[] = [];
  const diagnostics: string[] = [];
  let hasEvidence = false;
  let entryCount = 0;
  let labelCount = 0;
  let totalRefs = 0;
  let validRefs = 0;

  for (const entry of entries) {
    const { content, path } = entry;
    entryCount += countFootgunEntries(content);
    labelCount += countFootgunLabels(content);
    hasEvidence ||= hasFootgunEvidence(content);
    mergeDirMentions(dirMentions, content);
    const refSummary = summarizeFootgunRefs(fs, content);
    totalRefs += refSummary.totalRefs;
    validRefs += refSummary.validRefs;
    staleRefs.push(...refSummary.staleRefs);
    invalidLineRefs.push(...refSummary.invalidLineRefs);
    const diagnostic = getMissingFrontmatterDiagnostic(path, content);
    if (diagnostic) diagnostics.push(diagnostic);
  }

  return {
    hasEvidence,
    entryCount,
    labelCount,
    dirMentions,
    staleRefs,
    invalidLineRefs,
    totalRefs,
    validRefs,
    formatDiagnostic: diagnostics.length > 0 ? diagnostics.join('; ') : null,
  };
}

/** Aggregate entry counts, stale refs, and format diagnostics across lesson entries. */
function summarizeLessonEntries(
  fs: ReadonlyFS,
  entries: MarkdownEntry[],
): Pick<
  SharedFacts['lessons'],
  'entryCount' | 'staleRefs' | 'formatDiagnostic'
> {
  const staleRefs: string[] = [];
  const diagnostics: string[] = [];
  let entryCount = 0;

  for (const entry of entries) {
    const { content, path } = entry;
    entryCount += countLessonEntries(content);
    const pathPattern =
      /`((?:src|config|app|apps|lib|docs|scripts|setup|workflow|strands_agents|agents|\.goat-flow)\/[^`]+)`/g;
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
    entryCount,
    staleRefs,
    formatDiagnostic: diagnostics.length > 0 ? diagnostics.join('; ') : null,
  };
}

/** Extract footgun facts: existence, evidence quality, and directory mention counts. */
function extractFootgunFacts(
  fs: ReadonlyFS,
  configState: LoadedConfig,
): SharedFacts['footguns'] {
  const committed = listMarkdownEntries(
    fs,
    configState.config.footguns.committed,
  );
  const local = listMarkdownEntries(fs, configState.config.footguns.local);
  const allEntries = [...committed.files, ...local.files];
  const summary = summarizeFootgunEntries(fs, allEntries);
  const committedCount = summarizeFootgunEntries(
    fs,
    committed.files,
  ).entryCount;
  const localCount = summarizeFootgunEntries(fs, local.files).entryCount;
  const formatDiagnostic =
    summary.entryCount === 0 && (committed.exists || local.exists)
      ? 'Footgun directories exist but contain 0 entries'
      : summary.formatDiagnostic;

  return {
    exists: committed.exists || local.exists,
    committedExists: committed.exists,
    localExists: local.exists,
    hasEvidence: summary.hasEvidence,
    entryCount: summary.entryCount,
    committedCount,
    localCount,
    labelCount: summary.labelCount,
    hasEvidenceLabels:
      summary.entryCount > 0 && summary.labelCount >= summary.entryCount,
    dirMentions: summary.dirMentions,
    staleRefs: summary.staleRefs,
    invalidLineRefs: summary.invalidLineRefs,
    duplicateSurfacePaths: findCompetingArtifactSurfaces(
      fs,
      [configState.config.footguns.committed, configState.config.footguns.local],
      FOOTGUN_SURFACE_CANDIDATES,
    ),
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
function extractLessonsFacts(
  fs: ReadonlyFS,
  configState: LoadedConfig,
): SharedFacts['lessons'] {
  const committed = listMarkdownEntries(
    fs,
    configState.config.lessons.committed,
  );
  const local = listMarkdownEntries(fs, configState.config.lessons.local);
  const allEntries = [...committed.files, ...local.files];
  const summary = summarizeLessonEntries(fs, allEntries);
  const committedCount = summarizeLessonEntries(fs, committed.files).entryCount;
  const localCount = summarizeLessonEntries(fs, local.files).entryCount;
  const formatDiagnostic =
    summary.entryCount === 0 && (committed.exists || local.exists)
      ? 'Lesson directories exist but contain 0 entries'
      : summary.formatDiagnostic;

  return {
    exists: committed.exists || local.exists,
    committedExists: committed.exists,
    localExists: local.exists,
    hasEntries: summary.entryCount > 0,
    entryCount: summary.entryCount,
    committedCount,
    localCount,
    staleRefs: summary.staleRefs,
    duplicateSurfacePaths: findCompetingArtifactSurfaces(
      fs,
      [configState.config.lessons.committed, configState.config.lessons.local],
      LESSON_SURFACE_CANDIDATES,
    ),
    formatDiagnostic,
    paths: {
      committed: configState.config.lessons.committed,
      local: configState.config.lessons.local,
    },
  };
}

/** List eval markdown files, excluding directory metadata documents. */
function listEvalFiles(fs: ReadonlyFS, evalsPath: string): string[] {
  if (!fs.exists(evalsPath)) return [];
  return fs
    .listDir(evalsPath)
    .filter(
      (file) =>
        file.endsWith('.md') && file !== 'README.md' && file !== 'FORMAT.md',
    );
}

/** Build the empty eval-facts result used when no eval files are present. */
function createEmptyEvalFacts(
  dirExists: boolean,
  count: number,
  hasReadme: boolean,
  evalsPath: string,
): SharedFacts['evals'] {
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

/** Collect canonical skill names referenced inside one eval file. */
function collectEvalSkillNames(content: string): string[] {
  const skillNames = new Set<string>();
  const skillMatches = content.matchAll(
    /\*\*Skill:\*\*\s*(.+)|skill:\s*(.+)/gi,
  );

  for (const match of skillMatches) {
    const name = (match[1] ?? match[2] ?? '').trim().toLowerCase();
    if (name && CANONICAL_EVAL_SKILL_SET.has(name)) skillNames.add(name);
  }

  return Array.from(skillNames);
}

/** Count an eval as real only when its scenario section has substantive non-placeholder text. */
function hasEvalRealContent(content: string): boolean {
  const scenarioMatch = content.match(
    /##+ (?:Replay Prompt|Scenario)\s*\n([\s\S]*?)(?=\n##|\n---|$)/i,
  );
  const scenarioBody = scenarioMatch?.[1]?.trim() ?? '';
  return scenarioBody.length >= 100 && !/^(?:TODO|TBD)/i.test(scenarioBody);
}

/** Analyze one eval file for labels, frontmatter, replay prompts, and skill coverage. */
function analyzeEvalFile(
  fs: ReadonlyFS,
  evalsPath: string,
  fileName: string,
): EvalFileAnalysis {
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
    hasOrigin:
      /\*\*Origin:\*\*/i.test(content) ||
      /^## Origin/im.test(content) ||
      /^origin:/im.test(content),
    hasAgents: /\*\*Agents:\*\*/i.test(content) || /^agents:/im.test(content),
    hasReplay:
      /##+ Replay Prompt/i.test(content) || /##+ Scenario/i.test(content),
    hasFrontmatter: /^---\n/.test(content),
    hasRealContent: hasEvalRealContent(content),
    skillNames: collectEvalSkillNames(content),
  };
}

/** Create the accumulator used while analyzing multiple eval files. */
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

/** Merge one eval-file analysis result into the running aggregate. */
function mergeEvalAnalysis(
  aggregate: EvalAggregate,
  analysis: EvalFileAnalysis,
): void {
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
function extractEvalFacts(
  fs: ReadonlyFS,
  rawEvalsPath: string,
): SharedFacts['evals'] {
  const evalsPath = rawEvalsPath.replace(/\/$/, '');
  const dirExists = fs.exists(evalsPath);
  const evalFiles = listEvalFiles(fs, evalsPath);
  const count = evalFiles.length;
  const hasReadme = dirExists && fs.exists(`${evalsPath}/README.md`);

  if (count === 0)
    return createEmptyEvalFacts(dirExists, count, hasReadme, evalsPath);

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
    hasRealContent: aggregate.realContentCount >= Math.ceil(count * 0.6),
    hasFrontmatter: aggregate.allHaveFrontmatter,
    evalSkillCount: aggregate.skillNames.size,
    missingSkills: CANONICAL_EVAL_SKILLS.filter(
      (skill) => !aggregate.skillNames.has(skill),
    ).sort(),
    path: evalsPath,
  };
}

/** Extract existence and line-count facts for the architecture doc. */
function extractArchitectureFacts(fs: ReadonlyFS): SharedFacts['architecture'] {
  const exists = fs.exists('docs/architecture.md');
  return {
    exists,
    lineCount: exists ? fs.lineCount('docs/architecture.md') : 0,
  };
}

/** Detect whether the CI workflow already includes a required validation pattern. */
function hasCIWorkflowCheck(
  ciContent: string | null,
  pattern: RegExp,
): boolean {
  return ciContent !== null && pattern.test(ciContent);
}

/** Count the indentation prefix on one YAML line. */
function getLineIndent(line: string): number {
  const match = line.match(/^(\s*)/);
  return match?.[1]?.length ?? 0;
}

/** Extract raw `run:` commands from a workflow file. */
function collectWorkflowRunCommands(ciContent: string | null): string[] {
  if (ciContent === null) return [];

  const commands: string[] = [];
  const lines = ciContent.split('\n');

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const match = line.match(/^\s*(?:-\s*)?run:\s*(.+)\s*$/);
    if (!match) continue;

    const baseIndent = getLineIndent(line);
    const runValue = match[1]?.trim() ?? '';
    if (!runValue) continue;

    if (/^[>|]/.test(runValue)) {
      const blockLines: string[] = [];
      let nextIndex = index + 1;
      while (nextIndex < lines.length) {
        const nextLine = lines[nextIndex] ?? '';
        if (nextLine.trim().length === 0) {
          blockLines.push('');
          nextIndex++;
          continue;
        }

        if (getLineIndent(nextLine) <= baseIndent) {
          break;
        }

        blockLines.push(nextLine.trimStart());
        nextIndex++;
      }

      const blockCommand = blockLines.join('\n').trim();
      if (blockCommand.length > 0) {
        commands.push(blockCommand);
      }
      index = nextIndex - 1;
      continue;
    }

    if (runValue.length > 0) {
      commands.push(runValue);
    }
  }

  return commands;
}

/** Detect whether any workflow `run:` command satisfies a validation predicate. */
function hasRunCommand(
  ciContent: string | null,
  predicate: (command: string) => boolean,
): boolean {
  return collectWorkflowRunCommands(ciContent).some(predicate);
}

/** Detect commands that already imply the context-validation workflow is covered. */
function isContextValidationCommand(command: string): boolean {
  const trimmed = command.toLowerCase();
  return (
    /\b(?:bash|sh)\s+(?:\.\/)?scripts\/context-validate\.sh\b/.test(trimmed) ||
    /\b(?:\.\/)?scripts\/context-validate\.sh\b/.test(trimmed) ||
    /\bnode\b[^\n]*\bdist\/cli\/cli\.js\s+scan\b/.test(trimmed) ||
    /\b(?:npx\s+)?goat-flow\s+scan\b/.test(trimmed)
  );
}

/** Detect whether CI validates instruction-file line-count limits. */
function checksCILineCount(ciContent: string | null): boolean {
  if (ciContent === null) return false;

  /** Match ad-hoc shell commands that explicitly count instruction-file lines. */
  const runCommand = (command: string): boolean =>
    /wc\s+-l/i.test(command) && /CLAUDE|AGENTS|GEMINI|\.md/i.test(command);

  return (
    hasRunCommand(ciContent, isContextValidationCommand) ||
    hasRunCommand(ciContent, runCommand)
  );
}

/** Detect whether CI validates router references. */
function checksCIRouter(ciContent: string | null): boolean {
  if (hasRunCommand(ciContent, isContextValidationCommand)) return true;

  /** Match ad-hoc workflow commands that explicitly validate router references. */
  const runCommandChecksRouter = (command: string): boolean => {
    const lower = command.toLowerCase();
    const checksInstructionRefs =
      /grep\b/.test(lower) &&
      /while\s+read/.test(lower) &&
      (/tr\s+-d/.test(lower) || /missing path/.test(lower)) &&
      (/\[\s*!?\s*-e\b/.test(lower) || /missing path/.test(lower)) &&
      (/(claude|agents|gemini)\.md/.test(lower) || /\$inst\b/.test(lower));

    return (
      checksInstructionRefs ||
      (/router/.test(lower) &&
        /(check|validation|validate|resolve|ref|reference|missing path)/.test(
          lower,
        ) &&
        (/grep\b/.test(lower) ||
          /\[\s*!?\s*-e\b/.test(lower) ||
          /while\s+read/.test(lower) ||
          /context-validate/.test(lower)))
    );
  };

  const hasExplicitRouterCheck = hasRunCommand(
    ciContent,
    runCommandChecksRouter,
  );
  return hasExplicitRouterCheck;
}

/** Detect whether CI validates installed skill files. */
function checksCISkills(ciContent: string | null): boolean {
  if (hasRunCommand(ciContent, isContextValidationCommand)) return true;

  /** Match ad-hoc workflow commands that explicitly validate skill installs. */
  const runCommandChecksSkills = (command: string): boolean => {
    const lower = command.toLowerCase();
    return (
      /skills/.test(lower) &&
      /(goat-|skill\.md)/.test(lower) &&
      (/for\s+skill\s+in/.test(lower) ||
        /missing skill/.test(lower) ||
        /fail=/.test(lower) ||
        /exit 1/.test(lower) ||
        (/find\b/.test(lower) && /skill\.md/.test(lower)) ||
        (/grep\b/.test(lower) && /skill\.md/.test(lower)))
    );
  };

  return hasRunCommand(ciContent, runCommandChecksSkills);
}

/** Extract CI validation coverage facts from the context-validation workflow. */
function extractCIFacts(fs: ReadonlyFS): SharedFacts['ci'] {
  const workflowContent = fs.readFile(
    '.github/workflows/context-validation.yml',
  );
  return {
    workflowExists: workflowContent !== null,
    checksLineCount: checksCILineCount(workflowContent),
    checksRouter: checksCIRouter(workflowContent),
    checksSkills: checksCISkills(workflowContent),
    ciTriggersOnPRs: hasCIWorkflowCheck(workflowContent, /pull_request/i),
  };
}

/** Extract `.gitignore` presence and required-entry coverage. */
function extractGitignoreFacts(fs: ReadonlyFS): SharedFacts['gitignore'] {
  const content = fs.readFile('.gitignore');
  return {
    exists: content !== null,
    hasRequiredEntries:
      content !== null &&
      REQUIRED_GITIGNORE_ENTRIES.every((entry) => content.includes(entry)),
  };
}

/** Extract existence and section coverage facts for the shared handoff template. */
function extractHandoffTemplateFacts(
  fs: ReadonlyFS,
): SharedFacts['handoffTemplate'] {
  const content = fs.readFile('.goat-flow/tasks/handoff-template.md');
  const sectionCount = content
    ? HANDOFF_SECTIONS.filter((section) =>
        new RegExp(`##\\s*${section}|\\*\\*${section}`, 'i').test(content),
      ).length
    : 0;

  return {
    exists: content !== null,
    sectionCount,
    hasRequiredSections: sectionCount >= HANDOFF_SECTIONS.length,
  };
}

/** Extract project-wide shared facts from docs, evals, CI, and config files. */
export function extractSharedFacts(
  fs: ReadonlyFS,
  configState: LoadedConfig,
): SharedFacts {
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
    guidelinesOwnership: {
      exists: fs.exists('docs/guidelines-ownership-split.md'),
    },
    domainReference: { exists: fs.exists('docs/domain-reference.md') },
    preflightScript: { exists: fs.exists('scripts/preflight-checks.sh') },
    // changelog removed - project-level concern, not AI workflow.
    decisions: extractDecisionsFacts(fs, configState.config.decisions.path),
    localInstructions: extractLocalInstructions(
      fs,
      configState.config.codingStandards.path,
    ),
    gitCommitInstructions: {
      exists: fs.exists('.github/git-commit-instructions.md'),
    },
    aiInstructionsLineCount: countCodingStandardsLines(
      fs,
      configState.config.codingStandards.path,
    ),
  };
}

/** Count total markdown lines across coding-standards files. */
function countCodingStandardsLines(fs: ReadonlyFS, rawCsPath: string): number {
  const csPath = rawCsPath.replace(/\/$/, '');
  if (!fs.exists(csPath)) return 0;
  const files = fs.listDir(csPath).filter((f) => f.endsWith('.md'));
  let total = 0;
  for (const f of files) {
    total += fs.lineCount(`${csPath}/${f}`);
  }
  return total;
}

/** Extract decisions directory facts: existence and file count. */
function extractDecisionsFacts(
  fs: ReadonlyFS,
  rawPath: string,
): SharedFacts['decisions'] {
  const path = rawPath.replace(/\/$/, '');
  /** Whether the decisions directory exists */
  const dirExists = fs.exists(path);
  /** Count of markdown files in decisions directory, excluding README */
  const files = dirExists
    ? fs.listDir(path).filter((f) => f.endsWith('.md') && f !== 'README.md')
    : [];
  const fileCount = files.length;
  // Require at least one ADR with substantive Context and Decision sections.
  let hasRealContent = false;
  for (const f of files) {
    const content = fs.readFile(`${path}/${f}`);
    if (!content) continue;
    const hasContext = /^## Context\s*\n(.{50,})/m.test(content);
    const hasDecision = /^## Decision\s*\n(.{50,})/m.test(content);
    const startsWithTodo =
      /^## (?:Context|Decision)\s*\n\s*(?:TODO|TBD)/im.test(content);
    if (hasContext && hasDecision && !startsWithTodo) {
      hasRealContent = true;
      break;
    }
  }
  return { dirExists, fileCount, path, hasRealContent };
}

/** Resolve the local instruction directory in either `ai/` or `.github/instructions/`. */
function resolveLocalInstructionDir(
  aiDirExists: boolean,
  githubDirExists: boolean,
  csPath: string,
): LocalInstructionDir | null {
  if (aiDirExists) return { location: 'ai', dir: csPath };
  if (githubDirExists)
    return { location: 'github', dir: '.github/instructions' };
  return null;
}

/** Build the empty local-instructions result used when no instruction directory exists. */
function createEmptyLocalInstructions(
  csPath: string,
): SharedFacts['localInstructions'] {
  return {
    dirExists: false,
    location: null,
    aiDirExists: false,
    githubDirExists: false,
    duplicateSurfacePaths: [],
    fileCount: 0,
    hasRouter: false,
    hasValidRouter: false,
    routerNeedsFix: null,
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

/** Match either the legacy `.md` or newer `.instructions.md` instruction naming convention. */
function hasInstructionFile(files: string[], baseName: string): boolean {
  return files.some(
    (file) =>
      file === `${baseName}.md` || file === `${baseName}.instructions.md`,
  );
}

/** Collect presence flags for the key local-instruction documents. */
function collectLocalInstructionFlags(files: string[]): LocalInstructionFlags {
  return {
    hasConventions: hasInstructionFile(files, 'conventions'),
    hasFrontend: hasInstructionFile(files, 'frontend'),
    hasBackend: hasInstructionFile(files, 'backend'),
    hasCodeReview: hasInstructionFile(files, 'code-review'),
    hasGitCommit: hasInstructionFile(files, 'git-commit'),
  };
}

/** Collect line counts for all local instruction files. */
function collectLocalFileSizes(
  fs: ReadonlyFS,
  dir: string,
  files: string[],
): Array<{ path: string; lines: number }> {
  return files.map((file) => ({
    path: `${dir}/${file}`,
    lines: fs.lineCount(`${dir}/${file}`),
  }));
}

/** Treat conventions as real only when they include both commands and behavioral rules. */
function hasConventionsContent(content: string): boolean {
  const hasCommands = /##.*command|```bash|```sh/i.test(content);
  const hasConventionRules =
    /##.*convention|do.*don't|do:.*don't:|good.*bad/i.test(content);
  const lineCount = content.split('\n').length;
  return hasCommands && hasConventionRules && lineCount > 15;
}

/** Treat only readable local paths as valid router references, not prose or URLs. */
function isReadableRouterRef(rawRef: string): boolean {
  const ref = rawRef.trim();
  if (!ref) return false;
  if (ref.startsWith('http://') || ref.startsWith('https://')) return false;
  if (ref.startsWith('$') || /\b(README|docs|command|format|lint)\b/i.test(ref))
    return false;
  if (ref.includes(' ')) return false;
  return /(?:^\.\/|^\.\.\/|^\w+\/|^[a-zA-Z0-9._-]+\.[a-zA-Z0-9]+$)/.test(ref);
}

/** Remove any markdown anchor fragment from a router reference. */
function stripRouterAnchor(ref: string): string {
  const anchorIndex = ref.indexOf('#');
  if (anchorIndex === -1) return ref.trim();
  return ref.slice(0, anchorIndex).trim();
}

/** Extract local file references from markdown links and backticks. */
function extractRouterRefsFromMarkdown(content: string): string[] {
  const refs = new Set<string>();

  for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const raw = match[1];
    if (!raw) continue;
    const ref = stripRouterAnchor(raw);
    if (isReadableRouterRef(ref)) refs.add(ref);
  }

  for (const match of content.matchAll(/`([^`]+)`/g)) {
    const raw = match[1];
    if (!raw) continue;
    const ref = stripRouterAnchor(raw);
    if (isReadableRouterRef(ref)) refs.add(ref);
  }

  return Array.from(refs);
}

/** Validate that `ai/README.md` references only existing local instruction files. */
function validateRouterLinks(
  fs: ReadonlyFS,
  aiReadmeContent: string | null,
): RouterValidation {
  if (aiReadmeContent === null) {
    return {
      hasValidRouter: false,
      invalidRefs: [],
      routerNeedsFix:
        'ai/README.md missing - create it and reference existing coding standard files',
    };
  }

  const refs = extractRouterRefsFromMarkdown(aiReadmeContent);
  if (refs.length === 0) {
    return {
      hasValidRouter: false,
      invalidRefs: [],
      routerNeedsFix:
        'ai/README.md should reference at least one instruction file (for example ai/coding-standards/conventions.md).',
    };
  }

  const invalidRefs = refs.filter((ref) => !fs.exists(ref));
  if (invalidRefs.length > 0) {
    return {
      hasValidRouter: false,
      invalidRefs,
      routerNeedsFix: `ai/README.md references missing paths: ${invalidRefs.join(', ')}`,
    };
  }

  return {
    hasValidRouter: true,
    invalidRefs: [],
    routerNeedsFix: null,
  };
}

/** Load and grade the conventions document for the active local-instructions location. */
function analyzeConventionsContent(
  fs: ReadonlyFS,
  location: LocalInstructionDir['location'],
  csPath: string,
  hasConventions: boolean,
): Pick<
  SharedFacts['localInstructions'],
  'conventionsContent' | 'conventionsHasContent'
> {
  if (!hasConventions)
    return { conventionsContent: null, conventionsHasContent: false };

  const conventionsPath =
    location === 'ai'
      ? `${csPath}/conventions.md`
      : '.github/instructions/conventions.instructions.md';
  const conventionsContent = fs.readFile(conventionsPath);
  return {
    conventionsContent,
    conventionsHasContent:
      conventionsContent !== null && hasConventionsContent(conventionsContent),
  };
}

/** Detect and analyze local instruction files from coding-standards dir or .github/instructions/. */
function extractLocalInstructions(
  fs: ReadonlyFS,
  rawCsPath: string,
): SharedFacts['localInstructions'] {
  const csPath = rawCsPath.replace(/\/$/, '');
  const aiDirExists = fs.exists(csPath);
  const githubDirExists = fs.exists('.github/instructions');
  const duplicateSurfacePaths =
    aiDirExists && githubDirExists ? [csPath, '.github/instructions'] : [];
  const localInstructionDir = resolveLocalInstructionDir(
    aiDirExists,
    githubDirExists,
    csPath,
  );
  if (localInstructionDir === null) return createEmptyLocalInstructions(csPath);

  const { dir, location } = localInstructionDir;
  const files = fs.listDir(dir).filter((file) => file.endsWith('.md'));
  const flags = collectLocalInstructionFlags(files);
  const conventions = analyzeConventionsContent(
    fs,
    location,
    csPath,
    flags.hasConventions,
  );
  const hasRouter = location === 'ai' && fs.exists('ai/README.md');
  const routerValidation =
    location === 'ai'
      ? validateRouterLinks(fs, fs.readFile('ai/README.md'))
      : {
          hasValidRouter: true,
          routerNeedsFix: null,
          invalidRefs: [],
        };

  return {
    dirExists: true,
    location,
    aiDirExists,
    githubDirExists,
    duplicateSurfacePaths,
    fileCount: files.length,
    hasRouter,
    hasValidRouter: routerValidation.hasValidRouter && hasRouter,
    routerNeedsFix: hasRouter ? routerValidation.routerNeedsFix : null,
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
