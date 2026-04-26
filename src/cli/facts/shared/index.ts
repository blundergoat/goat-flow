/**
 * Project-wide shared fact extractor - composes sub-extractors for learning-loop,
 * local instructions, and project-level metadata into a single SharedFacts object.
 */
import type { SharedFacts, ReadonlyFS } from "../../types.js";
import type { LoadedConfig } from "../../config/types.js";

import { extractFootgunFacts, extractLessonsFacts } from "./learning-loop.js";
import { extractGitignoreFacts } from "./ci.js";
import { extractLocalInstructions } from "./local-instructions.js";

/** Extract existence and line-count facts for the architecture doc. */
function extractArchitectureFacts(fs: ReadonlyFS): SharedFacts["architecture"] {
  const exists = fs.exists(".goat-flow/architecture.md");
  return {
    exists,
    lineCount: exists ? fs.lineCount(".goat-flow/architecture.md") : 0,
  };
}

/** Count total markdown lines across canonical local-instruction files. */
function countLocalInstructionLines(
  localInstructions: SharedFacts["localInstructions"],
): number {
  return localInstructions.localFileSizes.reduce(
    (total, file) => total + file.lines,
    0,
  );
}

/** Extract decisions directory facts: existence and file count. */
function extractDecisionsFacts(
  fs: ReadonlyFS,
  rawPath: string,
): SharedFacts["decisions"] {
  const path = rawPath.replace(/\/$/, "");
  /** Whether the decisions directory exists */
  const dirExists = fs.exists(path);
  /** Count of markdown files in decisions directory, excluding README */
  const files = dirExists
    ? fs.listDir(path).filter((f) => f.endsWith(".md") && f !== "README.md")
    : [];
  const fileCount = files.length;
  // Require at least one ADR with substantive Context and Decision sections.
  let hasRealContent = false;
  for (const f of files) {
    const content = fs.readFile(`${path}/${f}`);
    if (!content) continue;
    const hasContext =
      /^## (?:Context|Background|Problem)\s*\n([\s\S]{50,}?)(?=^## |$)/m.test(
        content,
      );
    const hasDecision =
      /^## (?:Decision|Rationale|Resolution)\s*\n([\s\S]{50,}?)(?=^## |$)/m.test(
        content,
      );
    const startsWithTodo =
      /^## (?:Context|Background|Problem|Decision|Rationale|Resolution)\s*\n\s*(?:TODO|TBD)/im.test(
        content,
      );
    if (hasContext && hasDecision && !startsWithTodo) {
      hasRealContent = true;
      break;
    }
  }
  return { dirExists, fileCount, path, hasRealContent };
}

/** Resolve the project-local commit guidance location. */
function extractGitCommitInstructionFacts(
  fs: ReadonlyFS,
): SharedFacts["gitCommitInstructions"] {
  const githubPath = ".github/git-commit-instructions.md";
  const fallbackPaths = [
    ".github/instructions/git-commit.md",
    "docs/coding-standards/git-commit.md",
  ];
  const githubDirExists = fs.exists(".github");
  const githubPathExists = fs.exists(githubPath);
  const misplacedPaths = fallbackPaths.filter((path) => fs.exists(path));

  if (githubDirExists) {
    return {
      exists: githubPathExists,
      path: githubPathExists ? githubPath : null,
      requiredPath: githubPath,
      misplacedPaths: githubPathExists ? [] : misplacedPaths,
    };
  }

  const fallbackPath = fallbackPaths.find((path) => fs.exists(path)) ?? null;
  return {
    exists: githubPathExists || fallbackPath !== null,
    path: githubPathExists ? githubPath : fallbackPath,
    requiredPath: fallbackPath ?? githubPath,
    misplacedPaths: [],
  };
}

/** Extract project-wide shared facts from docs, CI, and config files. */
export function extractSharedFacts(
  fs: ReadonlyFS,
  configState: LoadedConfig,
): SharedFacts {
  const localInstructions = extractLocalInstructions(fs);

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
      userRole: configState.config.userRole,
    },
    architecture: extractArchitectureFacts(fs),
    ignoreFiles: {
      copilotignore: fs.exists(".copilotignore"),
      cursorignore: fs.exists(".cursorignore"),
      geminiignore: fs.exists(".geminiignore"),
    },
    gitignore: extractGitignoreFacts(fs),
    preflightScript: { exists: fs.exists("scripts/preflight-checks.sh") },
    skillConventions: {
      exists: fs.exists(".goat-flow/skill-reference/skill-preamble.md"),
    },
    // changelog removed - project-level concern, not AI workflow.
    decisions: extractDecisionsFacts(fs, configState.config.decisions.path),
    localInstructions,
    gitCommitInstructions: extractGitCommitInstructionFacts(fs),
    localInstructionsLineCount: countLocalInstructionLines(localInstructions),
  };
}
