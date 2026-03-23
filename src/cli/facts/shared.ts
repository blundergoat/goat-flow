import type { SharedFacts, ReadonlyFS } from '../types.js';

/**
 * Matches file:line evidence in multiple formats:
 * - `src/auth.ts:42` (backtick-wrapped)
 * - (lines 866-880) or (line 52) (prose-style)
 * - `src/auth.ts` (lines 42-50) (backtick path + prose line)
 */
const EVIDENCE_PATTERN = /`[^`]+:[0-9]+`|\(lines?\s+[0-9]+/;

/** Extract footgun facts: existence, evidence quality, and directory mention counts. */
function extractFootgunFacts(fs: ReadonlyFS): SharedFacts['footguns'] {
  /** Raw content of the footguns documentation file */
  const footgunsContent = fs.readFile('docs/footguns.md');
  /** Whether the footguns file exists on disk */
  const exists = footgunsContent !== null;
  /** Whether the footguns file contains file:line evidence references */
  const hasEvidence = exists && EVIDENCE_PATTERN.test(footgunsContent);
  /** Map of directory paths to how many times they appear in footgun evidence */
  const dirMentions = new Map<string, number>();
  if (footgunsContent) {
    /** All backtick-wrapped file:line references found in the footguns content */
    const pathRefs = footgunsContent.matchAll(/`([^`]+):[0-9]+`/g);
    // Iterate over file:line references to count directory mentions
    for (const match of pathRefs) {
      /** File path extracted from the backtick reference */
      const group = match[1];
      if (group === undefined) continue;
      const filePath = group;
      /** Parent directory of the referenced file */
      const dir = filePath.split('/').slice(0, -1).join('/');
      if (dir) {
        dirMentions.set(dir, (dirMentions.get(dir) ?? 0) + 1);
      }
    }
  }
  // Validate that referenced files still exist on disk
  const staleRefs: string[] = [];
  let totalRefs = 0;
  let validRefs = 0;
  if (footgunsContent) {
    /** All backtick-wrapped file:line references for staleness checks */
    const fileRefs = footgunsContent.matchAll(/`([^`]+):[0-9]+`/g);
    for (const match of fileRefs) {
      const filePath = match[1];
      if (filePath === undefined) continue;
      totalRefs++;
      if (fs.exists(filePath)) {
        validRefs++;
      } else {
        staleRefs.push(filePath);
      }
    }
  }
  return { exists, hasEvidence, dirMentions, staleRefs, totalRefs, validRefs };
}

/** Extract lessons facts: existence and whether entries are present. */
function extractLessonsFacts(fs: ReadonlyFS): SharedFacts['lessons'] {
  /** Raw content of the lessons documentation file */
  const lessonsContent = fs.readFile('docs/lessons.md');
  /** Whether the lessons file exists on disk */
  const exists = lessonsContent !== null;
  /** Whether the lessons file contains at least one H3 entry */
  const hasEntries = exists && /^### /m.test(lessonsContent);
  /** Count of H3 heading entries in lessons file */
  const entryCount = exists ? (lessonsContent.match(/^### /gm) ?? []).length : 0;
  return { exists, hasEntries, entryCount };
}

/** Extract eval facts: directory, file count, replay prompts, origin labels, skill coverage. */
function extractEvalFacts(fs: ReadonlyFS): SharedFacts['evals'] {
  /** Whether the agent-evals directory exists */
  const dirExists = fs.exists('agent-evals');
  /** Markdown eval files (excluding README) found in the evals directory */
  const evalFiles = dirExists ? fs.listDir('agent-evals').filter(f => f.endsWith('.md') && f !== 'README.md') : [];
  /** Total number of eval files found */
  const count = evalFiles.length;
  /** Whether the evals directory contains a README.md */
  const hasReadme = dirExists && fs.exists('agent-evals/README.md');

  if (count === 0) {
    return { dirExists, count, hasReadme, hasOriginLabels: false, hasReplayPrompts: false, evalSkillCount: 0 };
  }

  /** Distinct skill names referenced across all eval files */
  const skillNames = new Set<string>();
  /** Track whether all eval files pass origin/replay checks */
  let allHaveOrigin = true;
  let allHaveReplay = true;
  // Iterate over ALL eval files for quality checks and skill counting
  for (const f of evalFiles) {
    /** Raw content of this eval file */
    const content = fs.readFile(`agent-evals/${f}`);
    if (content === null) {
      allHaveOrigin = false;
      allHaveReplay = false;
      continue;
    }
    if (/\*\*Origin:\*\*/i.test(content) === false) allHaveOrigin = false;
    if (/## Replay Prompt/i.test(content) === false) allHaveReplay = false;
    /** All skill label matches found in the eval content */
    const skillMatches = content.matchAll(/\*\*Skill:\*\*\s*(.+)|skill:\s*(.+)/gi);
    // Iterate over skill matches to collect unique skill names
    for (const m of skillMatches) {
      /** Normalized skill name from the match */
      const name = (m[1] ?? m[2] ?? '').trim().toLowerCase();
      if (name) skillNames.add(name);
    }
  }
  return { dirExists, count, hasReadme, hasOriginLabels: allHaveOrigin, hasReplayPrompts: allHaveReplay, evalSkillCount: skillNames.size };
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
    handoffTemplate: { exists: fs.exists('tasks/handoff-template.md') },
    ignoreFiles: { copilotignore, cursorignore, geminiignore },
    gitignore: { exists: gitignoreExists, hasRequiredEntries },
    guidelinesOwnership: { exists: fs.exists('docs/guidelines-ownership-split.md') },
    domainReference: { exists: fs.exists('docs/domain-reference.md') },
    preflightScript: { exists: fs.exists('scripts/preflight-checks.sh') },
    changelog: { exists: fs.exists('CHANGELOG.md') },
    decisions: extractDecisionsFacts(fs),
    localInstructions: extractLocalInstructions(fs),
    gitCommitInstructions: { exists: fs.exists('.github/git-commit-instructions.md') },
  };
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
