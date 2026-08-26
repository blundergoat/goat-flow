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
  blockers?: string[];
}

interface InstructionBridgeUpdate {
  path: string;
  original: string;
  updated: string;
}

/** Render caught non-Error values without default object stringification. */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "unknown error";
}

/** Locate the selected bridge section without treating another level-two section as writable. */
function commitMessagesRange(
  content: string,
): { start: number; end: number } | null {
  const heading = /^##[ \t]+Commit Messages[ \t]*$/mu.exec(content);
  if (heading === null) return null;
  const sectionBodyStart = heading.index + heading[0].length;
  const nextHeading = /^##[ \t]+/mu.exec(content.slice(sectionBodyStart));
  return {
    start: heading.index,
    end:
      nextHeading === null
        ? content.length
        : sectionBodyStart + nextHeading.index,
  };
}

/** Preflight every supported instruction surface before any migration write occurs. */
function preflightLegacyReferences(
  root: string,
  selectedAgent: AgentId,
): { bridge: InstructionBridgeUpdate | null; blockers: string[] } {
  const selectedPath = getAgentProfile(selectedAgent).instructionFile;
  let bridge: InstructionBridgeUpdate | null = null;
  const blockers: string[] = [];
  const instructionPaths = new Set(
    getAgentProfiles().map((profile) => profile.instructionFile),
  );
  for (const relativePath of instructionPaths) {
    const absolutePath = join(root, relativePath);
    if (!existsSync(absolutePath)) continue;
    const original = readFileSync(absolutePath, "utf-8");
    const referenceOffsets: number[] = [];
    for (
      let offset = original.indexOf(LEGACY_GIT_COMMIT_INSTRUCTIONS_PATH);
      offset >= 0;
      offset = original.indexOf(
        LEGACY_GIT_COMMIT_INSTRUCTIONS_PATH,
        offset + LEGACY_GIT_COMMIT_INSTRUCTIONS_PATH.length,
      )
    ) {
      referenceOffsets.push(offset);
    }
    if (referenceOffsets.length === 0) continue;
    const range = commitMessagesRange(original);
    if (
      relativePath !== selectedPath ||
      range === null ||
      referenceOffsets.some(
        (offset) => offset < range.start || offset >= range.end,
      )
    ) {
      blockers.push(relativePath);
      continue;
    }
    bridge = {
      path: absolutePath,
      original,
      updated: original.replaceAll(
        LEGACY_GIT_COMMIT_INSTRUCTIONS_PATH,
        GIT_COMMIT_INSTRUCTIONS_PATH,
      ),
    };
  }
  return { bridge, blockers };
}

/** Copy first, update the selected bridge atomically, then remove the former guide. */
function renameLegacyGuide(
  root: string,
  legacyPath: string,
  outputPath: string,
  bridge: InstructionBridgeUpdate | null,
): void {
  copyFileSync(legacyPath, outputPath, constants.COPYFILE_EXCL);
  let bridgeWritten = false;
  try {
    if (bridge !== null) {
      writeFileAtomic(bridge.path, bridge.updated, root);
      bridgeWritten = true;
    }
    unlinkSync(legacyPath);
  } catch (error) {
    let rollbackError: unknown = null;
    if (bridgeWritten && bridge !== null) {
      try {
        writeFileAtomic(bridge.path, bridge.original, root);
      } catch (restoreError) {
        rollbackError = restoreError;
      }
    }
    if (rollbackError === null) {
      try {
        unlinkSync(outputPath);
      } catch (cleanupError) {
        rollbackError = cleanupError;
      }
    }
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

  // Only the former filename exists, so the user keeps their own content and simply finds it under the current name.
  if (existsSync(legacyPath)) {
    const preflight = preflightLegacyReferences(root, selectedAgent);
    if (preflight.blockers.length > 0) {
      return {
        status: "skipped-references",
        path: LEGACY_GIT_COMMIT_INSTRUCTIONS_PATH,
        blockers: preflight.blockers,
      };
    }
    renameLegacyGuide(root, legacyPath, outputPath, preflight.bridge);
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
    // A read-only docs tree, a Windows permission error, or the race that renameLegacyGuide
    // documents must read as a skipped extra, not as a failed install.
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
      `  ! kept ${result.path} (legacy references in ${(result.blockers ?? []).join(", ")})`,
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
