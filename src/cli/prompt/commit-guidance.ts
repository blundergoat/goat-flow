/**
 * Installs the project's commit-message guidance from the reviewed workflow template.
 *
 * A user gets this during setup, and it is what gives their agent one consistent commit convention to follow.
 *
 * Non-Git targets are left untouched, because commit conventions are meaningless in a directory with no version control.
 */
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { getTemplatePath } from "../paths.js";

const GIT_COMMIT_INSTRUCTIONS_PATH =
  "docs/coding-standards/git-commit-message.md";
const LEGACY_GIT_COMMIT_INSTRUCTIONS_PATH =
  "docs/coding-standards/git-commit.md";
const GIT_COMMIT_INSTRUCTIONS_TEMPLATE =
  "workflow/setup/reference/git-commit-message.md";

type CommitGuidanceStatus =
  "copied" | "renamed" | "skipped-existing" | "skipped-no-git";

/** Outcome from applying the Git-only commit-guidance setup contract. */
interface CommitGuidanceWriteResult {
  status: CommitGuidanceStatus;
  path: string;
}

/**
 * Move the former guide to the preferred path without an overwrite window.
 * An exclusive copy fails if the destination appears after the caller's existence check; unlinking only after that copy succeeds preserves the former
 * guide when either operation fails.
 */
function renameLegacyGuide(legacyPath: string, outputPath: string): void {
  copyFileSync(legacyPath, outputPath, constants.COPYFILE_EXCL);
  unlinkSync(legacyPath);
}

/**
 * Apply commit-guidance setup to one target project.
 *
 * Targets without a `.git` entry receive no commit guide.
 * Git targets preserve an existing preferred guide, migrate the former filename when it is the only accepted guide, or copy the reviewed workflow
 * template when neither guide exists.
 *
 * A preferred-path collision is never overwritten.
 *
 * @param targetRoot - Project root to inspect and, when applicable, update.
 * @returns The applied or skipped result and its project-relative path.
 */
function ensureGitCommitInstructions(
  targetRoot: string,
): CommitGuidanceWriteResult {
  const root = resolve(targetRoot);
  const outputPath = join(root, GIT_COMMIT_INSTRUCTIONS_PATH);
  const legacyPath = join(root, LEGACY_GIT_COMMIT_INSTRUCTIONS_PATH);

  if (!existsSync(join(root, ".git"))) {
    return {
      status: "skipped-no-git",
      path: GIT_COMMIT_INSTRUCTIONS_PATH,
    };
  }

  if (existsSync(outputPath)) {
    return {
      status: "skipped-existing",
      path: GIT_COMMIT_INSTRUCTIONS_PATH,
    };
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  if (existsSync(legacyPath)) {
    renameLegacyGuide(legacyPath, outputPath);
    return {
      status: "renamed",
      path: GIT_COMMIT_INSTRUCTIONS_PATH,
    };
  }

  copyFileSync(
    getTemplatePath(GIT_COMMIT_INSTRUCTIONS_TEMPLATE),
    outputPath,
    constants.COPYFILE_EXCL,
  );
  return {
    status: "copied",
    path: GIT_COMMIT_INSTRUCTIONS_PATH,
  };
}

/**
 * Print commit-guide setup status after an install that already succeeded.
 * Use as the final install step; it never rethrows, because guidance is additive and a completed, recorded install must not be reported to the user
 * as a crash.
 *
 * @param projectPath - selected project root; a non-Git target prints nothing
 */
export function emitCommitGuidanceInstallResult(projectPath: string): void {
  let result: CommitGuidanceWriteResult;
  try {
    result = ensureGitCommitInstructions(projectPath);
  } catch (error) {
    // A read-only docs tree, a Windows permission error, or the race that renameLegacyGuide
    // documents must read as a skipped extra, not as a failed install.
    const reason = error instanceof Error ? error.message : String(error);
    console.log("");
    console.log("Git commit instructions:");
    console.log(`  ! skipped (${reason})`);
    return;
  }
  if (result.status !== "copied" && result.status !== "renamed") return;
  console.log("");
  console.log("Git commit instructions:");
  const summary =
    result.status === "copied"
      ? "copied from goat-flow template"
      : "renamed from docs/coding-standards/git-commit.md";
  console.log(`  ✓ ${result.path} (${summary})`);
}
