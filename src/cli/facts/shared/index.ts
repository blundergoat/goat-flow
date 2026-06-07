/**
 * Project-wide shared fact extractor - composes sub-extractors for learning-loop,
 * local instructions, and project-level metadata into a single SharedFacts object.
 */
import type { SharedFacts, ReadonlyFS } from "../../types.js";
import type { LoadedConfig } from "../../config/types.js";

import {
  extractFootgunFacts,
  extractLessonsFacts,
  extractLearningLoopEntries,
} from "./learning-loop.js";
import { isDecisionRecordMarkdown } from "./decision-files.js";
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
  /** Count of ADR markdown files in decisions directory, excluding metadata files. */
  const files = dirExists
    ? fs.listDir(path).filter(isDecisionRecordMarkdown)
    : [];
  const fileCount = files.length;
  // Require at least one ADR with substantive Context and Decision sections.
  let hasRealContent = false;
  for (const fileName of files) {
    const content = fs.readFile(`${path}/${fileName}`);
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

/**
 * Resolve the project-local commit guidance location.
 *
 * Canonical home is docs/coding-standards/git-commit.md: one file serves both humans and agents.
 * IDEs auto-read .github/copilot-instructions.md (which points here), not a bespoke .github commit
 * file, so the legacy .github locations are reported as misplaced and flagged for a move. The check
 * is repo-wide and intentionally does not depend on a .github/ directory existing.
 *
 * @param fs - Read-only filesystem used to probe the canonical and legacy commit-doc locations.
 * @returns Commit-guidance facts: existence, resolved path, the required canonical path, and any misplaced legacy copies.
 */
function extractGitCommitInstructionFacts(
  fs: ReadonlyFS,
): SharedFacts["gitCommitInstructions"] {
  const canonicalPath = "docs/coding-standards/git-commit.md";
  const legacyPaths = [
    ".github/git-commit-instructions.md",
    ".github/instructions/git-commit.md",
  ];
  const canonicalExists = fs.exists(canonicalPath);
  return {
    exists: canonicalExists,
    path: canonicalExists ? canonicalPath : null,
    requiredPath: canonicalPath,
    misplacedPaths: canonicalExists
      ? []
      : legacyPaths.filter((path) => fs.exists(path)),
  };
}

/**
 * Extract project-wide shared facts from docs, CI, and config files.
 *
 * @param fs - project filesystem adapter used by shared fact extractors
 * @param configState - parsed goat-flow config state to expose beside filesystem facts
 * @returns shared project facts consumed by setup, audit, and dashboard surfaces
 */
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
    },
    gitignore: extractGitignoreFacts(fs),
    preflightScript: { exists: fs.exists("scripts/preflight-checks.sh") },
    skillConventions: {
      exists: fs.exists(".goat-flow/skill-docs/skill-preamble.md"),
    },
    // changelog removed - project-level concern, not AI workflow.
    decisions: extractDecisionsFacts(fs, configState.config.decisions.path),
    localInstructions,
    gitCommitInstructions: extractGitCommitInstructionFacts(fs),
    localInstructionsLineCount: countLocalInstructionLines(localInstructions),
    learningLoopEntries: extractLearningLoopEntries(fs, configState),
  };
}
