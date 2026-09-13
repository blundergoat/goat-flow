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
  readFileSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { getAgentProfile, getAgentProfiles } from "../agents/registry.js";
import { getTemplatePath } from "../paths.js";
import { writeFileAtomic } from "../server/safe-exec.js";
import type { AgentId } from "../types.js";

const GIT_COMMIT_INSTRUCTIONS_PATH =
  "docs/coding-standards/git-commit-message.md";
const LEGACY_GIT_COMMIT_INSTRUCTIONS_PATH =
  "docs/coding-standards/git-commit.md";
const GIT_COMMIT_INSTRUCTIONS_TEMPLATE =
  "workflow/setup/reference/git-commit-message.md";

type CommitGuidanceStatus =
  | "copied"
  | "renamed"
  | "skipped-existing"
  | "skipped-no-git"
  | "skipped-references";

/** Outcome from applying the Git-only commit-guidance setup contract. */
interface CommitGuidanceWriteResult {
  status: CommitGuidanceStatus;
  path: string;
  blockingInstructionPaths?: string[];
}

/** Exact instruction bytes and file mode needed to update one selected bridge and restore it after a failed migration. */
interface InstructionBridgeUpdate {
  path: string;
  originalInstructionText: string;
  updatedInstructionText: string;
  fileMode: number;
}

/** Render caught non-Error values without default object stringification. */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "unknown error";
}

/**
 * Locate the selected Commit Messages bridge without treating another level-two section as writable.
 * Use before migration; null means the selected instruction file has no section that setup can safely rewrite.
 *
 * @param instructionContent - complete selected instruction file; empty content contains no writable Commit Messages section
 * @returns section offsets, or null when the required heading is absent
 */
function commitMessagesRange(
  instructionContent: string,
): { start: number; end: number } | null {
  const heading = /^##[ \t]+Commit Messages[ \t]*$/mu.exec(instructionContent);
  // Without the recognised heading, setup must leave the user's instruction file unchanged.
  if (heading === null) return null;
  const sectionBodyStart = heading.index + heading[0].length;
  const nextHeading = /^##[ \t]+/mu.exec(
    instructionContent.slice(sectionBodyStart),
  );
  return {
    start: heading.index,
    end:
      nextHeading === null
        ? instructionContent.length
        : sectionBodyStart + nextHeading.index,
  };
}

/**
 * Inspect every supported instruction surface before setup migrates a user's existing guide.
 * Use to find the one selected bridge that can move safely and every foreign reference that must block the rename.
 *
 * @returns the selected bridge or null when none needs rewriting, plus any instruction paths that keep the former guide in place
 */
function preflightLegacyReferences(
  projectRoot: string,
  selectedAgent: AgentId,
): {
  instructionBridge: InstructionBridgeUpdate | null;
  blockingInstructionPaths: string[];
} {
  const selectedInstructionPath =
    getAgentProfile(selectedAgent).instructionFile;
  let instructionBridge: InstructionBridgeUpdate | null = null;
  const blockingInstructionPaths: string[] = [];
  const instructionPaths = new Set(
    getAgentProfiles().map((profile) => profile.instructionFile),
  );
  // Every installed agent instruction is checked so setup never strands a user-visible link to the former guide.
  for (const relativePath of instructionPaths) {
    const absolutePath = join(projectRoot, relativePath);
    // An agent without an installed instruction file has no legacy reference that can block this migration.
    if (!existsSync(absolutePath)) continue;
    const originalInstructionText = readFileSync(absolutePath, "utf-8");
    const referenceOffsets: number[] = [];
    // Every former-path occurrence is recorded because a reference outside Commit Messages makes the whole rename unsafe.
    for (
      let offset = originalInstructionText.indexOf(
        LEGACY_GIT_COMMIT_INSTRUCTIONS_PATH,
      );
      offset >= 0;
      offset = originalInstructionText.indexOf(
        LEGACY_GIT_COMMIT_INSTRUCTIONS_PATH,
        offset + LEGACY_GIT_COMMIT_INSTRUCTIONS_PATH.length,
      )
    ) {
      referenceOffsets.push(offset);
    }
    // Files that do not mention the former guide need no rewrite and cannot block its rename.
    if (referenceOffsets.length === 0) continue;
    const commitMessagesSection = commitMessagesRange(originalInstructionText);
    // Only the selected agent's Commit Messages section is owned by this setup run; every other reference keeps the former guide available.
    if (
      relativePath !== selectedInstructionPath ||
      commitMessagesSection === null ||
      referenceOffsets.some(
        (offset) =>
          offset < commitMessagesSection.start ||
          offset >= commitMessagesSection.end,
      )
    ) {
      blockingInstructionPaths.push(relativePath);
      continue;
    }
    instructionBridge = {
      path: absolutePath,
      originalInstructionText,
      updatedInstructionText: originalInstructionText.replaceAll(
        LEGACY_GIT_COMMIT_INSTRUCTIONS_PATH,
        GIT_COMMIT_INSTRUCTIONS_PATH,
      ),
      fileMode: statSync(absolutePath).mode & 0o777,
    };
  }
  return { instructionBridge, blockingInstructionPaths };
}

/**
 * Name the selected instruction bridge a pending legacy-guide migration will rewrite.
 * Use while building preview and claim inputs; null means this install cannot or need not migrate a bridge.
 *
 * @param targetRoot - selected project root to inspect without mutation
 * @param selectedAgent - only this agent's recognised Commit Messages bridge may be returned
 * @returns one project-relative instruction path, or null when no bridge write is pending
 */
export function pendingCommitGuidanceMigrationInstructionPath(
  targetRoot: string,
  selectedAgent: AgentId,
): string | null {
  const projectRoot = resolve(targetRoot);
  const outputPath = join(projectRoot, GIT_COMMIT_INSTRUCTIONS_PATH);
  const legacyPath = join(projectRoot, LEGACY_GIT_COMMIT_INSTRUCTIONS_PATH);
  if (
    !existsSync(join(projectRoot, ".git")) ||
    existsSync(outputPath) ||
    !existsSync(legacyPath)
  ) {
    return null;
  }
  const migrationPreflight = preflightLegacyReferences(
    projectRoot,
    selectedAgent,
  );
  if (
    migrationPreflight.instructionBridge === null ||
    migrationPreflight.blockingInstructionPaths.length > 0
  ) {
    return null;
  }
  return getAgentProfile(selectedAgent).instructionFile;
}

/**
 * Copy first, update the selected bridge atomically, then remove the former guide.
 *
 * Use after setup proves no other agent still needs the old path; null bridge input means only the guide filename changes.
 * Error behavior: restores user instruction bytes and removes the new guide before rethrowing; incomplete rollback throws a replacement error.
 *
 * @param instructionBridge - selected Commit Messages rewrite, or null when the user's instructions contain no former-path reference
 */
function renameLegacyGuide(
  projectRoot: string,
  legacyPath: string,
  outputPath: string,
  instructionBridge: InstructionBridgeUpdate | null,
): void {
  copyFileSync(legacyPath, outputPath, constants.COPYFILE_EXCL);
  let didWriteInstructionBridge = false;
  try {
    // A selected bridge is rewritten before the old guide disappears, so the user's instructions never point at a missing file.
    if (instructionBridge !== null) {
      writeFileAtomic(
        instructionBridge.path,
        instructionBridge.updatedInstructionText,
        projectRoot,
        instructionBridge.fileMode,
      );
      didWriteInstructionBridge = true;
    }
    unlinkSync(legacyPath);
  } catch (error) {
    // A failed bridge write or guide removal starts rollback before the optional setup step reports its skipped result.
    let rollbackError: unknown = null;
    // Once the bridge changed, restore its exact bytes and mode before removing the newly copied guide.
    if (didWriteInstructionBridge && instructionBridge !== null) {
      try {
        writeFileAtomic(
          instructionBridge.path,
          instructionBridge.originalInstructionText,
          projectRoot,
          instructionBridge.fileMode,
        );
      } catch (restoreError) {
        // A permission or filesystem failure during restoration leaves rollback incomplete and replaces the original migration error.
        rollbackError = restoreError;
      }
    }
    // The copied guide is removed only when bridge restoration succeeded or no bridge was changed.
    if (rollbackError === null) {
      try {
        unlinkSync(outputPath);
      } catch (cleanupError) {
        // A permission or filesystem failure can leave the copied guide behind, so setup reports an incomplete rollback.
        rollbackError = cleanupError;
      }
    }
    // An incomplete rollback is more actionable to the user than the original migration failure it interrupted.
    if (rollbackError !== null) {
      throw new Error(
        `commit-guide migration failed and rollback was incomplete: ${errorMessage(rollbackError)}`,
      );
    }
    throw error;
  }
}

/**
 * Give one project its commit-message guide without overwriting a guide the user already has.
 *
 * Reads the target for `.git` and an existing guide first, then either keeps what is there, renames the former filename, or copies the template.
 *
 * @param targetRoot - project root to inspect and, when applicable, write into
 * @returns the outcome, reported guide path, and any instruction paths that blocked migration
 */
function ensureGitCommitInstructions(
  targetRoot: string,
  selectedAgent: AgentId,
): CommitGuidanceWriteResult {
  const projectRoot = resolve(targetRoot);
  const outputPath = join(projectRoot, GIT_COMMIT_INSTRUCTIONS_PATH);
  const legacyPath = join(projectRoot, LEGACY_GIT_COMMIT_INSTRUCTIONS_PATH);

  // No version control here, so a commit convention would have nothing to apply to and the project is left untouched.
  if (!existsSync(join(projectRoot, ".git"))) {
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

  // Only the former filename exists, so the user keeps their own content and simply finds it under the current name.
  if (existsSync(legacyPath)) {
    const migrationPreflight = preflightLegacyReferences(
      projectRoot,
      selectedAgent,
    );
    // Another installed agent still links to the old guide, so setup preserves every referenced user file.
    if (migrationPreflight.blockingInstructionPaths.length > 0) {
      return {
        status: "skipped-references",
        path: LEGACY_GIT_COMMIT_INSTRUCTIONS_PATH,
        blockingInstructionPaths: migrationPreflight.blockingInstructionPaths,
      };
    }
    renameLegacyGuide(
      projectRoot,
      legacyPath,
      outputPath,
      migrationPreflight.instructionBridge,
    );
    return {
      status: "renamed",
      path: GIT_COMMIT_INSTRUCTIONS_PATH,
    };
  }

  mkdirSync(dirname(outputPath), { recursive: true });
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
 * @param selectedAgent - only this agent's recognised Commit Messages bridge may change
 */
export function emitCommitGuidanceInstallResult(
  projectPath: string,
  selectedAgent: AgentId,
): void {
  let result: CommitGuidanceWriteResult;
  try {
    result = ensureGitCommitInstructions(projectPath, selectedAgent);
  } catch (error) {
    // A read-only docs tree, a Windows permission error, or a migration race is a skipped extra, not a failed install.
    const reason = errorMessage(error);
    console.log("");
    console.log("Git commit instructions:");
    console.log(`  ! skipped (${reason})`);
    return;
  }
  if (result.status === "skipped-references") {
    console.log("");
    console.log("Git commit instructions:");
    console.log(
      `  ! kept ${result.path} (legacy references in ${(result.blockingInstructionPaths ?? []).join(", ")})`,
    );
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
