import type { SharedFacts, ReadonlyFS } from '../types.js';

// Matches file:line evidence in multiple formats:
// - `src/auth.ts:42` (backtick-wrapped)
// - (lines 866-880) or (line 52) (prose-style)
// - `src/auth.ts` (lines 42-50) (backtick path + prose line)
const EVIDENCE_PATTERN = /`[^`]+:[0-9]+`|\(lines?\s+[0-9]+/;

export function extractSharedFacts(fs: ReadonlyFS): SharedFacts {
  // Footguns
  const footgunsContent = fs.readFile('docs/footguns.md');
  const footgunsExists = footgunsContent !== null;
  const footgunsHasEvidence = footgunsExists && EVIDENCE_PATTERN.test(footgunsContent!);
  const dirMentions = new Map<string, number>();
  if (footgunsContent) {
    const pathRefs = footgunsContent.matchAll(/`([^`]+):[0-9]+`/g);
    for (const match of pathRefs) {
      const filePath = match[1];
      const dir = filePath.split('/').slice(0, -1).join('/');
      if (dir) {
        dirMentions.set(dir, (dirMentions.get(dir) ?? 0) + 1);
      }
    }
  }

  // Lessons
  const lessonsContent = fs.readFile('docs/lessons.md');
  const lessonsExists = lessonsContent !== null;
  const lessonsHasEntries = lessonsExists && /^### /m.test(lessonsContent!);

  // Architecture
  const archExists = fs.exists('docs/architecture.md');
  const archLineCount = archExists ? fs.lineCount('docs/architecture.md') : 0;

  // Evals
  const evalsDir = fs.exists('agent-evals');
  const evalFiles = evalsDir ? fs.listDir('agent-evals').filter(f => f.endsWith('.md') && f !== 'README.md') : [];
  const evalCount = evalFiles.length;
  const hasReadme = evalsDir && fs.exists('agent-evals/README.md');

  let hasOriginLabels = false;
  let hasReplayPrompts = false;
  let evalSkillCount = 0;
  if (evalCount > 0) {
    // Check first 3 evals for origin labels and replay prompts
    const sampled = evalFiles.slice(0, 3);
    hasOriginLabels = sampled.every(f => {
      const content = fs.readFile(`agent-evals/${f}`);
      return content !== null && /\*\*Origin:\*\*/i.test(content);
    });
    hasReplayPrompts = sampled.every(f => {
      const content = fs.readFile(`agent-evals/${f}`);
      return content !== null && /## Replay Prompt/i.test(content);
    });
    // Count distinct skills referenced across eval files
    const skillNames = new Set<string>();
    for (const f of evalFiles) {
      const content = fs.readFile(`agent-evals/${f}`);
      if (content) {
        const skillMatches = content.matchAll(/\*\*Skill:\*\*\s*(.+)|skill:\s*(.+)/gi);
        for (const m of skillMatches) {
          const name = (m[1] ?? m[2]).trim().toLowerCase();
          if (name) skillNames.add(name);
        }
      }
    }
    evalSkillCount = skillNames.size;
  }

  // CI
  const ciContent = fs.readFile('.github/workflows/context-validation.yml');
  const ciExists = ciContent !== null;

  // Ignore files
  const copilotignore = fs.exists('.copilotignore');
  const cursorignore = fs.exists('.cursorignore');
  const geminiignore = fs.exists('.geminiignore');

  // Gitignore
  const gitignoreContent = fs.readFile('.gitignore');
  const gitignoreExists = gitignoreContent !== null;
  const requiredEntries = ['.env', 'settings.local.json'];
  const hasRequiredEntries = gitignoreExists && requiredEntries.every(e =>
    gitignoreContent!.includes(e)
  );

  return {
    footguns: { exists: footgunsExists, hasEvidence: footgunsHasEvidence, dirMentions },
    lessons: { exists: lessonsExists, hasEntries: lessonsHasEntries },
    architecture: { exists: archExists, lineCount: archLineCount },
    evals: { dirExists: evalsDir, count: evalCount, hasReadme, hasOriginLabels, hasReplayPrompts, evalSkillCount },
    ci: {
      workflowExists: ciExists,
      checksLineCount: ciExists && /wc -l/i.test(ciContent!),
      checksRouter: ciExists && /router/i.test(ciContent!),
      checksSkills: ciExists && /skills/i.test(ciContent!),
      ciTriggersOnPRs: ciExists && /pull_request/i.test(ciContent!),
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

function extractLocalInstructions(fs: ReadonlyFS): SharedFacts['localInstructions'] {
  // Check ai/instructions/ first, fall back to .github/instructions/
  const aiDir = fs.exists('ai/instructions');
  const ghDir = fs.exists('.github/instructions');

  if (!aiDir && !ghDir) {
    return { dirExists: false, location: null, fileCount: 0, hasRouter: false, hasConventions: false, conventionsHasContent: false, hasFrontend: false, hasBackend: false, hasCodeReview: false, hasGitCommit: false };
  }

  const location = aiDir ? 'ai' as const : 'github' as const;
  const dir = aiDir ? 'ai/instructions' : '.github/instructions';
  const files = fs.listDir(dir).filter(f => f.endsWith('.md'));
  const hasRouter = aiDir ? fs.exists('ai/README.md') : false;

  // Accept both .md and .instructions.md naming
  const hasConventions = files.some(f => f === 'conventions.md' || f === 'conventions.instructions.md');
  const hasFrontend = files.some(f => f === 'frontend.md' || f === 'frontend.instructions.md');
  const hasBackend = files.some(f => f === 'backend.md' || f === 'backend.instructions.md');
  const hasCodeReview = files.some(f => f === 'code-review.md' || f === 'code-review.instructions.md');
  const hasGitCommit = files.some(f => f === 'git-commit.md' || f === 'git-commit.instructions.md');

  // Check conventions.md has real content (commands + conventions, not just a header)
  let conventionsHasContent = false;
  if (hasConventions) {
    const conventionsPath = aiDir ? 'ai/instructions/conventions.md' : '.github/instructions/conventions.instructions.md';
    const conventionsContent = fs.readFile(conventionsPath);
    if (conventionsContent) {
      const hasCommands = /##.*command|```bash|```sh/i.test(conventionsContent);
      const hasConvRules = /##.*convention|do.*don't|do:.*don't:|good.*bad/i.test(conventionsContent);
      const lineCount = conventionsContent.split('\n').length;
      conventionsHasContent = hasCommands && hasConvRules && lineCount > 15;
    }
  }

  return { dirExists: true, location, fileCount: files.length, hasRouter, hasConventions, conventionsHasContent, hasFrontend, hasBackend, hasCodeReview, hasGitCommit };
}
