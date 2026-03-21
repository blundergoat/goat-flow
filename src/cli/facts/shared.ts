import type { SharedFacts, ReadonlyFS } from '../types.js';

const EVIDENCE_PATTERN = /`[^`]+:[0-9]+`/;

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
    confusionLog: { exists: fs.exists('docs/confusion-log.md') },
    architecture: { exists: archExists, lineCount: archLineCount },
    evals: { dirExists: evalsDir, count: evalCount, hasReadme, hasOriginLabels, hasReplayPrompts },
    ci: {
      workflowExists: ciExists,
      checksLineCount: ciExists && /wc -l/i.test(ciContent!),
      checksRouter: ciExists && /router/i.test(ciContent!),
      checksSkills: ciExists && /skills/i.test(ciContent!),
    },
    handoffTemplate: { exists: fs.exists('tasks/handoff-template.md') },
    ignoreFiles: { copilotignore, cursorignore, geminiignore },
    gitignore: { exists: gitignoreExists, hasRequiredEntries },
    guidelinesOwnership: { exists: fs.exists('docs/guidelines-ownership-split.md') },
    domainReference: { exists: fs.exists('docs/domain-reference.md') },
  };
}
