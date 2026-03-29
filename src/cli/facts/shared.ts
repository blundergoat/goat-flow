import type { SharedFacts, ReadonlyFS } from '../types.js';

/**
 * Matches file:line evidence in multiple formats:
 * - `src/auth.ts:42` (backtick-wrapped)
 * - `src/auth.ts:42-50` (backtick-wrapped with line range)
 * - `src/auth.ts:42,86-94` (backtick-wrapped with comma-separated ranges)
 * - (lines 866-880) or (line 52) (prose-style)
 * - `src/auth.ts` (lines 42-50) (backtick path + prose line)
 */
const EVIDENCE_PATTERN = /`[^`]+:[0-9]+(?:[-,][0-9]+)*`|\(lines?\s+[0-9]+/;

/** Regex to extract file paths from backtick-wrapped file:line references (with optional ranges). */
const FILE_REF_REGEX = /`([^`]+):[0-9]+(?:[-,][0-9]+)*`/g;

/** Check if a backtick-wrapped file:line reference is a real file path (not a URL/hostname) */
function isFileRef(filePath: string): boolean {
  // Skip hostname/URL patterns (not file references)
  if (/^https?:|:\/\//.test(filePath) || /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(filePath)) return false;
  // Paths with '/' are clearly file paths
  if (filePath.includes('/')) return true;
  // Root-level files with extensions (e.g., AGENTS.md:42) are valid refs
  // Bare names without extensions (e.g., webpack:123) are ambiguous — skip
  return /\.[a-zA-Z0-9]+$/.test(filePath);
}

/**
 * Check if a file reference can be reliably validated for staleness.
 * Paths with '/' are resolvable relative to the project root.
 * Bare filenames with source-code extensions (e.g., `router.go`, `auth.ts`)
 * are ambiguous — they may exist deep in subdirectories. We try fs.exists()
 * at root first; if it resolves, it's checkable. If not, and it has a source
 * extension without '/', skip it rather than reporting a false stale ref.
 */
function isCheckableForStaleness(filePath: string, fs: ReadonlyFS): boolean {
  if (filePath.includes('/')) return true;
  // If it exists at root, it's checkable regardless of extension
  if (fs.exists(filePath)) return true;
  // Bare source filenames that don't exist at root are likely shorthand
  // for deeply nested files — skip to avoid false positives
  if (/\.(go|ts|tsx|js|jsx|py|php|rs|java|kt|rb|cs|c|cpp|h|hpp|swift|scala)$/i.test(filePath)) return false;
  // Non-source files (AGENTS.md, package.json, etc.) should be at root
  return true;
}

/** Extract footgun facts: existence, evidence quality, and directory mention counts. */
function extractFootgunFacts(fs: ReadonlyFS): SharedFacts['footguns'] {
  /** Raw content of the footguns documentation file */
  const footgunsContent = fs.readFile('docs/footguns.md');
  /** Whether the footguns file exists on disk */
  const exists = footgunsContent !== null;
  /** Number of footgun entries in the file.
   * Detects two formats:
   *   Standard:    ## Footgun: Name
   *   H3 entries:  ### Name  (older projects that predate the standard format)
   */
  const entryCount = footgunsContent ? (
    (footgunsContent.match(/^## Footgun:/gm)?.length ?? 0) +
    (footgunsContent.match(/^### .{5,}/gm)?.length ?? 0)
  ) : 0;
  /** Number of explicit evidence type labels in the file */
  const labelCount = footgunsContent ? (footgunsContent.match(/^\*\*Evidence type:\*\*/gm)?.length ?? 0) : 0;
  // Check for real file:line evidence (filter out URLs/hostnames before deciding)
  let hasEvidence = false;
  if (exists && footgunsContent) {
    // First check: does the file have any evidence-like patterns at all?
    if (EVIDENCE_PATTERN.test(footgunsContent)) {
      // Second check: does it have at least one real file:line ref (not just URLs)?
      const refs = footgunsContent.matchAll(new RegExp(FILE_REF_REGEX.source, 'g'));
      for (const m of refs) {
        if (m[1] !== undefined && isFileRef(m[1])) { hasEvidence = true; break; }
      }
      // Also accept prose-style evidence: (lines 42-50) or (line 52)
      if (!hasEvidence) hasEvidence = /\(lines?\s+[0-9]+/.test(footgunsContent);
    }
  }
  /** Map of directory paths to how many times they appear in footgun evidence */
  const dirMentions = new Map<string, number>();
  if (footgunsContent) {
    /** All backtick-wrapped file:line references found in the footguns content */
    const pathRefs = footgunsContent.matchAll(new RegExp(FILE_REF_REGEX.source, 'g'));
    for (const match of pathRefs) {
      const group = match[1];
      if (group === undefined) continue;
      if (!isFileRef(group)) continue;
      /** Parent directory of the referenced file */
      const dir = group.split('/').slice(0, -1).join('/');
      if (dir) {
        dirMentions.set(dir, (dirMentions.get(dir) ?? 0) + 1);
      }
    }
  }
  // Validate that referenced files still exist on disk.
  // Skip bare source filenames (e.g., `router.go:335`) that can't be resolved
  // from the project root — they're valid evidence but not checkable for staleness.
  const staleRefs: string[] = [];
  let totalRefs = 0;
  let validRefs = 0;
  if (footgunsContent) {
    const fileRefs = footgunsContent.matchAll(new RegExp(FILE_REF_REGEX.source, 'g'));
    for (const match of fileRefs) {
      const filePath = match[1];
      if (filePath === undefined) continue;
      if (!isFileRef(filePath)) continue;
      if (!isCheckableForStaleness(filePath, fs)) continue;
      totalRefs++;
      if (fs.exists(filePath)) {
        validRefs++;
      } else {
        staleRefs.push(filePath);
      }
    }
  }
  return {
    exists,
    hasEvidence,
    entryCount,
    labelCount,
    hasEvidenceLabels: entryCount > 0 && labelCount >= entryCount,
    dirMentions,
    staleRefs,
    totalRefs,
    validRefs,
  };
}

/** Extract lessons facts: existence and whether entries are present. */
function extractLessonsFacts(fs: ReadonlyFS): SharedFacts['lessons'] {
  /** Raw content of the lessons documentation file */
  const lessonsContent = fs.readFile('docs/lessons.md');
  /** Whether the lessons file exists on disk */
  const exists = lessonsContent !== null;

  let hasEntries = false;
  let entryCount = 0;

  if (exists) {
    // Strip HTML comments before checking for entries
    const stripped = lessonsContent.replace(/<!--[\s\S]*?-->/g, '');
    // Find H3 headings followed by actual content (not just whitespace/comments)
    const h3Pattern = /^### .+\n+(\S[^\n]{19,})/gm;
    const matches = stripped.match(h3Pattern);
    entryCount = matches ? matches.length : 0;
    hasEntries = entryCount > 0;
  }

  // Check for stale file references in lessons
  const staleRefs: string[] = [];
  if (lessonsContent) {
    const pathPattern = /`((?:src|config|app|apps|lib|docs|scripts|setup|workflow|strands_agents|agents)\/[^`]+)`/g;
    for (const m of lessonsContent.matchAll(pathPattern)) {
      const p = m[1];
      if (p === undefined || /[*?{}]/.test(p)) continue;
      const filePath = p.replace(/:[0-9]+(?:[-,][0-9]+)*$/, '');
      if (!fs.exists(filePath)) staleRefs.push(filePath);
    }
  }

  return { exists, hasEntries, entryCount, staleRefs };
}

/** Extract eval facts: directory, file count, replay prompts, origin labels, skill coverage. */
function extractEvalFacts(fs: ReadonlyFS): SharedFacts['evals'] {
  /** Whether the agent-evals directory exists */
  const dirExists = fs.exists('agent-evals');
  /** Markdown eval files (excluding README) found in the evals directory */
  const evalFiles = dirExists ? fs.listDir('agent-evals').filter(f => f.endsWith('.md') && f !== 'README.md' && f !== 'FORMAT.md') : [];
  /** Total number of eval files found */
  const count = evalFiles.length;
  /** Whether the evals directory contains a README.md */
  const hasReadme = dirExists && fs.exists('agent-evals/README.md');

  if (count === 0) {
    return { dirExists, count, hasReadme, hasOriginLabels: false, hasAgentsLabels: false, hasReplayPrompts: false, hasFrontmatter: false, evalSkillCount: 0 };
  }

  /** The 8 canonical goat-flow skills — only these count toward eval diversity */
  const CANONICAL_SKILLS = new Set(['goat-debug', 'goat-investigate', 'goat-plan', 'goat-refactor', 'goat-review', 'goat-security', 'goat-simplify', 'goat-test']);
  /** Canonical skills with at least one eval */
  const skillNames = new Set<string>();
  /** Track whether all eval files pass origin/replay/agents/frontmatter checks */
  let allHaveOrigin = true;
  let allHaveAgents = true;
  let allHaveReplay = true;
  let allHaveFrontmatter = true;
  // Iterate over ALL eval files for quality checks and skill counting
  for (const f of evalFiles) {
    /** Raw content of this eval file */
    const content = fs.readFile(`agent-evals/${f}`);
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
    /** All skill label matches found in the eval content */
    const skillMatches = content.matchAll(/\*\*Skill:\*\*\s*(.+)|skill:\s*(.+)/gi);
    // Iterate over skill matches to collect unique skill names
    for (const m of skillMatches) {
      /** Normalized skill name from the match */
      const name = (m[1] ?? m[2] ?? '').trim().toLowerCase();
      if (name && CANONICAL_SKILLS.has(name)) skillNames.add(name);
    }
  }
  return { dirExists, count, hasReadme, hasOriginLabels: allHaveOrigin, hasAgentsLabels: allHaveAgents, hasReplayPrompts: allHaveReplay, hasFrontmatter: allHaveFrontmatter, evalSkillCount: skillNames.size };
}

/** Extract project-wide shared facts from docs, evals, CI, and config files. */
export function extractSharedFacts(fs: ReadonlyFS): SharedFacts {
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
  const handoffContent = fs.readFile('tasks/handoff-template.md');
  /** Whether the handoff template exists */
  const handoffExists = handoffContent !== null;
  /** Count of required handoff sections present — accepts ## H2 headings or **Bold:** labels */
  const HANDOFF_SECTIONS = ['status', 'current state', 'key decisions', 'known risks', 'next step'];
  const handoffSectionCount = handoffContent
    ? HANDOFF_SECTIONS.filter(s => new RegExp(`##\\s*${s}|\\*\\*${s}`, 'i').test(handoffContent)).length
    : 0;

  return {
    footguns: extractFootgunFacts(fs),
    lessons: extractLessonsFacts(fs),
    architecture: { exists: archExists, lineCount: archLineCount },
    evals: extractEvalFacts(fs),
    ci: {
      workflowExists: ciExists,
      checksLineCount: ciExists && /wc -l/i.test(ciContent),
      checksRouter: ciExists && /router/i.test(ciContent),
      checksSkills: ciExists && /skills/i.test(ciContent),
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
    // changelog removed — project-level concern, not AI workflow.
    decisions: extractDecisionsFacts(fs),
    localInstructions: extractLocalInstructions(fs),
    gitCommitInstructions: { exists: fs.exists('.github/git-commit-instructions.md') },
    aiInstructionsLineCount: countAiInstructionsLines(fs),
  };
}

/** Count total lines across ai/instructions/ files */
function countAiInstructionsLines(fs: ReadonlyFS): number {
  if (!fs.exists('ai/instructions')) return 0;
  const files = fs.listDir('ai/instructions').filter(f => f.endsWith('.md'));
  let total = 0;
  for (const f of files) {
    total += fs.lineCount(`ai/instructions/${f}`);
  }
  return total;
}

/** Extract decisions directory facts: existence and file count. */
function extractDecisionsFacts(fs: ReadonlyFS): SharedFacts['decisions'] {
  /** Whether the decisions directory exists */
  const dirExists = fs.exists('docs/decisions');
  /** Count of markdown files in decisions directory, excluding README */
  const fileCount = dirExists
    ? fs.listDir('docs/decisions').filter(f => f.endsWith('.md') && f !== 'README.md').length
    : 0;
  return { dirExists, fileCount };
}

/** Detect and analyze local instruction files from ai/instructions/ or .github/instructions/. */
function extractLocalInstructions(fs: ReadonlyFS): SharedFacts['localInstructions'] {
  /** Whether the ai/instructions/ directory exists */
  const aiDir = fs.exists('ai/instructions');
  /** Whether the .github/instructions/ directory exists */
  const ghDir = fs.exists('.github/instructions');

  if (aiDir === false && ghDir === false) {
    return { dirExists: false, location: null, fileCount: 0, hasRouter: false, hasConventions: false, conventionsHasContent: false, hasFrontend: false, hasBackend: false, hasCodeReview: false, hasGitCommit: false, conventionsContent: null, localFileSizes: [] };
  }

  /** Which directory convention is in use ('ai' or 'github') */
  const location = aiDir ? 'ai' as const : 'github' as const;
  /** Resolved path to the local instructions directory */
  const dir = aiDir ? 'ai/instructions' : '.github/instructions';
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
    const conventionsPath = aiDir ? 'ai/instructions/conventions.md' : '.github/instructions/conventions.instructions.md';
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

  return { dirExists: true, location, fileCount: files.length, hasRouter, hasConventions, conventionsHasContent, hasFrontend, hasBackend, hasCodeReview, hasGitCommit, conventionsContent, localFileSizes };
}
