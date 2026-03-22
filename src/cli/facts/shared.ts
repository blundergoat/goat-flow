import type { SharedFacts, ReadonlyFS } from '../types.js';

/**
 * Matches file:line evidence in multiple formats:
 * - `src/auth.ts:42` (backtick-wrapped)
 * - (lines 866-880) or (line 52) (prose-style)
 * - `src/auth.ts` (lines 42-50) (backtick path + prose line)
 */
const EVIDENCE_PATTERN = /`[^`]+:[0-9]+`|\(lines?\s+[0-9]+/;

/** Extract project-wide shared facts from docs, evals, CI, and config files. */
export function extractSharedFacts(fs: ReadonlyFS): SharedFacts {
  /** Raw content of the footguns documentation file */
  const footgunsContent = fs.readFile('docs/footguns.md');
  /** Whether the footguns file exists on disk */
  const footgunsExists = footgunsContent !== null;
  /** Whether the footguns file contains file:line evidence references */
  const footgunsHasEvidence = footgunsExists && EVIDENCE_PATTERN.test(footgunsContent);
  /** Map of directory paths to how many times they appear in footgun evidence */
  const dirMentions = new Map<string, number>();
  if (footgunsContent) {
    /** All backtick-wrapped file:line references found in the footguns content */
    const pathRefs = footgunsContent.matchAll(/`([^`]+):[0-9]+`/g);
    // Iterate over file:line references to count directory mentions
    for (const match of pathRefs) {
      /** File path extracted from the backtick reference */
      const filePath = match[1]!;
      /** Parent directory of the referenced file */
      const dir = filePath.split('/').slice(0, -1).join('/');
      if (dir) {
        dirMentions.set(dir, (dirMentions.get(dir) ?? 0) + 1);
      }
    }
  }

  /** Raw content of the lessons documentation file */
  const lessonsContent = fs.readFile('docs/lessons.md');
  /** Whether the lessons file exists on disk */
  const lessonsExists = lessonsContent !== null;
  /** Whether the lessons file contains at least one H3 entry */
  const lessonsHasEntries = lessonsExists && /^### /m.test(lessonsContent);

  /** Whether the architecture documentation file exists */
  const archExists = fs.exists('docs/architecture.md');
  /** Line count of the architecture file (0 if missing) */
  const archLineCount = archExists ? fs.lineCount('docs/architecture.md') : 0;

  /** Whether the agent-evals directory exists */
  const evalsDir = fs.exists('agent-evals');
  /** Markdown eval files (excluding README) found in the evals directory */
  const evalFiles = evalsDir ? fs.listDir('agent-evals').filter(f => f.endsWith('.md') && f !== 'README.md') : [];
  /** Total number of eval files found */
  const evalCount = evalFiles.length;
  /** Whether the evals directory contains a README.md */
  const hasReadme = evalsDir && fs.exists('agent-evals/README.md');

  let hasOriginLabels = false;
  let hasReplayPrompts = false;
  let evalSkillCount = 0;
  if (evalCount > 0) {
    /** Up to 3 eval files sampled for quality checks */
    const sampled = evalFiles.slice(0, 3);
    hasOriginLabels = sampled.every(f => {
      const content = fs.readFile(`agent-evals/${f}`);
      return content !== null && /\*\*Origin:\*\*/i.test(content);
    });
    hasReplayPrompts = sampled.every(f => {
      const content = fs.readFile(`agent-evals/${f}`);
      return content !== null && /## Replay Prompt/i.test(content);
    });
    /** Distinct skill names referenced across all eval files */
    const skillNames = new Set<string>();
    // Iterate over eval files to collect distinct skill name references
    for (const f of evalFiles) {
      /** Raw content of this eval file */
      const content = fs.readFile(`agent-evals/${f}`);
      if (content) {
        /** All skill label matches found in the eval content */
        const skillMatches = content.matchAll(/\*\*Skill:\*\*\s*(.+)|skill:\s*(.+)/gi);
        // Iterate over skill matches to collect unique skill names
        for (const m of skillMatches) {
          /** Normalized skill name from the match */
          const name = (m[1] ?? m[2] ?? '').trim().toLowerCase();
          if (name) skillNames.add(name);
        }
      }
    }
    evalSkillCount = skillNames.size;
  }

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
    footguns: { exists: footgunsExists, hasEvidence: footgunsHasEvidence, dirMentions },
    lessons: { exists: lessonsExists, hasEntries: lessonsHasEntries },
    architecture: { exists: archExists, lineCount: archLineCount },
    evals: { dirExists: evalsDir, count: evalCount, hasReadme, hasOriginLabels, hasReplayPrompts, evalSkillCount },
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
    localInstructions: extractLocalInstructions(fs),
    gitCommitInstructions: { exists: fs.exists('.github/git-commit-instructions.md') },
  };
}

/** Detect and analyze local instruction files from ai/instructions/ or .github/instructions/. */
function extractLocalInstructions(fs: ReadonlyFS): SharedFacts['localInstructions'] {
  /** Whether the ai/instructions/ directory exists */
  const aiDir = fs.exists('ai/instructions');
  /** Whether the .github/instructions/ directory exists */
  const ghDir = fs.exists('.github/instructions');

  if (aiDir === false && ghDir === false) {
    return { dirExists: false, location: null, fileCount: 0, hasRouter: false, hasConventions: false, conventionsHasContent: false, hasFrontend: false, hasBackend: false, hasCodeReview: false, hasGitCommit: false };
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

  // Check conventions.md has real content (commands + conventions, not just a header)
  let conventionsHasContent = false;
  if (hasConventions) {
    /** Resolved path to the conventions instruction file */
    const conventionsPath = aiDir ? 'ai/instructions/conventions.md' : '.github/instructions/conventions.instructions.md';
    /** Raw content of the conventions file */
    const conventionsContent = fs.readFile(conventionsPath);
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

  return { dirExists: true, location, fileCount: files.length, hasRouter, hasConventions, conventionsHasContent, hasFrontend, hasBackend, hasCodeReview, hasGitCommit };
}
