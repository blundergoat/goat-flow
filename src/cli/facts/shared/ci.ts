/**
 * CI workflow and gitignore fact extraction.
 * Analyzes .github/workflows/context-validation.yml for validation coverage.
 */
import type { SharedFacts, ReadonlyFS } from '../../types.js';

const REQUIRED_GITIGNORE_ENTRIES = ['.env', 'settings.local.json'];

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

/** Collect continuation lines for a YAML block scalar (| or >) starting after baseIndent. */
function collectBlockScalar(
  lines: string[],
  startIndex: number,
  baseIndent: number,
): { command: string; endIndex: number } {
  const blockLines: string[] = [];
  let nextIndex = startIndex;
  while (nextIndex < lines.length) {
    const nextLine = lines[nextIndex] ?? '';
    if (nextLine.trim().length === 0) {
      blockLines.push('');
      nextIndex++;
      continue;
    }
    if (getLineIndent(nextLine) <= baseIndent) break;
    blockLines.push(nextLine.trimStart());
    nextIndex++;
  }
  return { command: blockLines.join('\n').trim(), endIndex: nextIndex };
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

    const runValue = match[1]?.trim() ?? '';
    if (!runValue) continue;

    if (/^[>|]/.test(runValue)) {
      const block = collectBlockScalar(lines, index + 1, getLineIndent(line));
      if (block.command.length > 0) commands.push(block.command);
      index = block.endIndex - 1;
    } else {
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

/** Detect the grep-based instruction-file ref checker pattern (reads instruction file, iterates backtick paths, checks -e). */
function isInstructionRefChecker(lower: string): boolean {
  return (
    /grep\b/.test(lower) &&
    /while\s+read/.test(lower) &&
    (/tr\s+-d/.test(lower) || /missing path/.test(lower)) &&
    (/\[\s*!?\s*-e\b/.test(lower) || /missing path/.test(lower)) &&
    (/(claude|agents|gemini)\.md/.test(lower) || /\$inst\b/.test(lower))
  );
}

/** Detect explicit router-keyword validation commands. */
function isExplicitRouterChecker(lower: string): boolean {
  return (
    /router/.test(lower) &&
    /(check|validation|validate|resolve|ref|reference|missing path)/.test(lower) &&
    (/grep\b/.test(lower) ||
      /\[\s*!?\s*-e\b/.test(lower) ||
      /while\s+read/.test(lower) ||
      /context-validate/.test(lower))
  );
}

/** Match ad-hoc workflow commands that validate router references. */
function isRouterValidationCommand(command: string): boolean {
  const lower = command.toLowerCase();
  return isInstructionRefChecker(lower) || isExplicitRouterChecker(lower);
}

/** Detect whether CI validates router references. */
function checksCIRouter(ciContent: string | null): boolean {
  return (
    hasRunCommand(ciContent, isContextValidationCommand) ||
    hasRunCommand(ciContent, isRouterValidationCommand)
  );
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
export function extractCIFacts(fs: ReadonlyFS): SharedFacts['ci'] {
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
export function extractGitignoreFacts(fs: ReadonlyFS): SharedFacts['gitignore'] {
  const content = fs.readFile('.gitignore');
  return {
    exists: content !== null,
    hasRequiredEntries:
      content !== null &&
      REQUIRED_GITIGNORE_ENTRIES.every((entry) => content.includes(entry)),
  };
}
