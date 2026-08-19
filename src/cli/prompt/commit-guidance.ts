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
 * Move the former guide to the preferred path with no window in which a user could lose it.
 * The copy is exclusive so it throws rather than overwriting a file that appeared since the caller looked, and the delete runs only once that copy
 * succeeded, which leaves the old guide in place whenever either write fails.
 *
 * @param legacyPath - absolute path of the guide written under the former filename
 * @param outputPath - absolute path of the preferred filename to write
 */
function renameLegacyGuide(legacyPath: string, outputPath: string): void {
  copyFileSync(legacyPath, outputPath, constants.COPYFILE_EXCL);
  unlinkSync(legacyPath);
}

/**
 * Give one project its commit-message guide, writing at most one file into the target and never overwriting a guide the user already has.
 *
 * Reads the target for `.git` and an existing guide first, then either keeps what is there, renames the former filename, or copies the template.
 *
 * @param targetRoot - project root to inspect and, when applicable, write into
 * @returns which of the four outcomes applied plus the project-relative guide path, which is reported even when nothing was written
 */
function ensureGitCommitInstructions(
  targetRoot: string,
): CommitGuidanceWriteResult {
  const root = resolve(targetRoot);
  const outputPath = join(root, GIT_COMMIT_INSTRUCTIONS_PATH);
  const legacyPath = join(root, LEGACY_GIT_COMMIT_INSTRUCTIONS_PATH);

  // No version control here, so a commit convention would have nothing to apply to and the project is left untouched.
  if (!existsSync(join(root, ".git"))) {
    return {
      status: "skipped-no-git",
      path: GIT_COMMIT_INSTRUCTIONS_PATH,
    };
  }

  // The user already has a guide at the preferred path, and their wording wins over the shipped template.
  if (existsSync(outputPath)) {
    return {
      status: "skipped-existing",
      path: GIT_COMMIT_INSTRUCTIONS_PATH,
    };
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  // Only the former filename exists, so the user keeps their own content and simply finds it under the current name.
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
 * Print the commit-guide result as the last line of an install that already succeeded.
 * It swallows every failure from the guide step, because the guide is an extra and a completed install must not be reported to the user as a crash.
 *
 * @param projectPath - selected project root; a non-Git target prints nothing at all
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
  // Nothing was written, so the install output stays quiet rather than reporting a no-op to the user.
  if (result.status !== "copied" && result.status !== "renamed") return;
  console.log("");
  console.log("Git commit instructions:");
  const summary =
    result.status === "copied"
      ? "copied from goat-flow template"
      : "renamed from docs/coding-standards/git-commit.md";
  console.log(`  ✓ ${result.path} (${summary})`);
}
