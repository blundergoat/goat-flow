/**
 * Enumerates every non-template destination a goat-flow install may write, and inspects one target path without following symlinked components.
 * Managed templates are exact copies compared by hash; the destinations here are user-owned files the installer seeds or migrates in place, plus
 * generated files the CLI rewrites from project state after Bash exits.
 *
 * Preview consumes both so a user sees the complete write set before authorizing an install.
 *
 * Removals and legacy path migrations are deliberately absent: they are cleanup, not writes, and the preview declares that boundary in its limits.
 */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";

import { loadConfig } from "./config/reader.js";
import {
  INDEX_BUCKETS,
  resolveIndexBucketPaths,
} from "./learning-loop-index/parse-bucket.js";
import { loadManifest } from "./manifest/manifest.js";
import { KNOWN_AGENT_IDS, type AgentId } from "./types.js";

/** Filesystem evidence for a destination, gathered without following target symlinks. */
export type ManagedTargetStatus =
  "regular" | "missing" | "non-regular" | "unreadable";

/** One target path's safe status and optional regular-file hash for three-way comparison. */
export interface ManagedTargetEvidence {
  status: ManagedTargetStatus;
  sha256: string | null;
}

/** Update policy for a destination outside the exact-copy template contract. */
type ProjectWriteOwnership = "user-owned" | "generated";

/**
 * One destination install may write that carries no exact-copy template.
 * `seedable` records whether install creates the path when it is absent; a non-seedable row is only ever repaired in place, so an absent target stays
 * absent.
 */
export interface ProjectWriteDefinition {
  path: string;
  ownership: ProjectWriteOwnership;
  seedable: boolean;
  replaceable: boolean;
  reason: string;
}

/** Manifest generator value marking a file the install command itself writes. */
const INSTALL_GENERATOR = "goat-flow install";

/** Optional Claude override that install repairs in place but never creates. */
const CLAUDE_LOCAL_SETTINGS_PATH = ".claude/settings.local.json";

const SEED_ONLY_REASON =
  "Install seeds this user-owned file once and never replaces your content.";

/**
 * Reasons for manifest-declared user-owned destinations whose migration behavior
 * users need spelled out; other user-owned records fall back to the seed-only reason.
 */
const MANIFEST_USER_OWNED_REASONS: Record<string, string> = {
  ".goat-flow/config.yaml":
    "Install scaffolds this config once, then applies only declared narrow migrations; hook choices, comments, and unrelated keys are preserved.",
};

/**
 * Hash one package or target file for the managed comparison.
 * Use when users need byte-level evidence without storing or displaying file contents.
 *
 * @param filePath - package or target file to hash; empty is invalid upstream and cannot be read
 * @returns lowercase SHA-256 text; never null or empty after a successful read
 */
export function hashFile(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

/**
 * Inspect one destination without following symlinked path components.
 * Use before preview or install so users never authorize writes redirected outside their project.
 *
 * @param projectPath - selected project root; empty is invalid upstream and cannot contain a target
 * @param managedPath - safe manifest or baseline-relative path; empty is rejected before this helper
 * @returns target status and hash; null hash means missing, non-regular, or unreadable bytes
 */
export function readManagedTargetEvidence(
  projectPath: string,
  managedPath: string,
): ManagedTargetEvidence {
  const pathSegments = managedPath.split("/");
  let inspectedPath = projectPath;
  // Every parent must remain a real directory so setup cannot escape through a nested symlink.
  for (const directorySegment of pathSegments.slice(0, -1)) {
    inspectedPath = join(inspectedPath, directorySegment);
    try {
      const parentStats = lstatSync(inspectedPath);
      // A symlink or file parent redirects or blocks the managed destination, so install must pause.
      if (!parentStats.isDirectory()) {
        return { status: "non-regular", sha256: null };
      }
    } catch (error) {
      // For example, a first install has no `.goat-flow` parent yet, so the destination is simply missing.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { status: "missing", sha256: null };
      }
      return { status: "unreadable", sha256: null };
    }
  }

  const targetFilePath = join(projectPath, managedPath);
  try {
    const targetStats = lstatSync(targetFilePath);
    // Symlinks, directories, and multiply linked files can redirect a managed replacement.
    if (!targetStats.isFile() || targetStats.nlink !== 1) {
      return { status: "non-regular", sha256: null };
    }
    return { status: "regular", sha256: hashFile(targetFilePath) };
  } catch (error) {
    // For example, a user deleted this managed file; absence is evidence and unreadable bytes stay blocked.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "missing", sha256: null };
    }
    return { status: "unreadable", sha256: null };
  }
}

/**
 * Collect manifest-declared destinations the installer seeds or the install command regenerates.
 * Manifest ownership is the single source of truth, so a new record reaches preview without a code edit.
 */
function manifestProjectWrites(): ProjectWriteDefinition[] {
  const definitions: ProjectWriteDefinition[] = [];
  for (const [managedPath, ownership] of Object.entries(
    loadManifest().file_ownership,
  )) {
    // Seeded user files are created once and then preserved through every later refresh.
    if (ownership.ownership === "user-owned") {
      definitions.push({
        path: managedPath,
        ownership: "user-owned",
        seedable: true,
        replaceable: ownership.source !== undefined,
        reason: MANIFEST_USER_OWNED_REASONS[managedPath] ?? SEED_ONLY_REASON,
      });
      continue;
    }
    // Only install-generated records belong here; `goat-flow setup` writes the rest.
    if (
      ownership.ownership === "generated" &&
      ownership.generator === INSTALL_GENERATOR
    ) {
      definitions.push({
        path: managedPath,
        ownership: "generated",
        seedable: true,
        replaceable: false,
        reason:
          "Install creates this anchor when it is missing so the directory survives an empty checkout.",
      });
    }
  }
  return definitions;
}

/**
 * Collect the selected agent's settings and hook-config destinations.
 * These carry the user's permissions, unrelated hook rows, and local preferences, so install seeds them once and afterwards changes only goat-flow's
 * own entries.
 */
function agentProjectWrites(agent: AgentId): ProjectWriteDefinition[] {
  const agentProfile = loadManifest().agents[agent];
  // A missing profile would make the preview disagree with installer-supported agents.
  if (!agentProfile) {
    throw new Error(`Manifest has no agent profile for ${agent}.`);
  }

  const definitions: ProjectWriteDefinition[] = [];
  const settingsPath = agentProfile.settings;
  // Antigravity ships no settings destination, so only agents that declare one are listed.
  if (settingsPath) {
    definitions.push({
      path: settingsPath,
      ownership: "user-owned",
      seedable: true,
      replaceable: false,
      reason:
        "Install seeds agent settings once, then applies only declared narrow migrations; permissions, comments, and unrelated keys are preserved.",
    });
  }
  const hookConfigPath = agentProfile.hook_config_file;
  // Claude registers hooks inside settings, so a separate row would duplicate the same file.
  if (hookConfigPath && hookConfigPath !== settingsPath) {
    definitions.push({
      path: hookConfigPath,
      ownership: "user-owned",
      seedable: true,
      replaceable: false,
      reason:
        "Install seeds this hook config once, then converges only goat-flow's own registrations; unrelated hook rows are preserved.",
    });
  }
  // Personal Claude overrides carry the same shipped rule shapes and are repaired, never created.
  if (agent === "claude") {
    definitions.push({
      path: CLAUDE_LOCAL_SETTINGS_PATH,
      ownership: "user-owned",
      seedable: false,
      replaceable: false,
      reason:
        "Install repairs stale permission rules in this optional local override only when it already exists; it is never created.",
    });
  }
  return definitions;
}

/**
 * Collect destinations the installer script and install command write outside manifest ownership.
 * Each row states the condition install applies, because several are written only in one project shape.
 */
function conditionalProjectWrites(
  projectPath: string,
): ProjectWriteDefinition[] {
  const bucketPaths = resolveIndexBucketPaths(loadConfig(projectPath).config);
  return [
    {
      path: ".gitignore",
      ownership: "user-owned",
      seedable: true,
      replaceable: false,
      reason:
        "Install appends a node_modules/ ignore line when one is missing and never rewrites your other entries.",
    },
    {
      path: ".goat-flow/plans/.active",
      ownership: "user-owned",
      seedable: true,
      replaceable: false,
      reason:
        "Install writes this marker only when no marker exists and the target holds exactly one version-named plan directory.",
    },
    {
      path: "docs/coding-standards/git-commit-message.md",
      ownership: "user-owned",
      seedable: true,
      replaceable: false,
      reason:
        "Install seeds commit guidance only in a Git project that has no guide at this path.",
    },
    {
      path: ".goat-flow/install-state/managed.json",
      ownership: "generated",
      seedable: true,
      replaceable: false,
      reason:
        "Install records the project-wide hash-only baseline and verified agent receipts after the managed refresh.",
    },
    ...KNOWN_AGENT_IDS.map((knownAgent) => ({
      path: `.goat-flow/install-state/${knownAgent}.json`,
      ownership: "generated" as const,
      seedable: true,
      replaceable: false,
      reason:
        "Install replaces the retired agent-specific baseline with a hashless managed-state cutover marker.",
    })),
    ...INDEX_BUCKETS.map((bucket) => ({
      path: posix.join(bucketPaths[bucket], "INDEX.md"),
      ownership: "generated" as const,
      seedable: true,
      replaceable: false,
      reason: `Install regenerates the ${bucket} index from that bucket's current entries.`,
    })),
  ];
}

/**
 * Build the path-sorted list of non-template destinations one install may write.
 * Use alongside the exact-copy template contract so dry-run output is a complete write set.
 *
 * @param projectPath - selected target root; its config decides where learning-loop indexes are written
 * @param agent - selected agent whose settings and hook config are included; never null after CLI validation
 * @returns one definition per destination, sorted by path; never empty for a supported agent
 */
export function collectProjectWriteDefinitions(
  projectPath: string,
  agent: AgentId,
): ProjectWriteDefinition[] {
  const definitions = new Map<string, ProjectWriteDefinition>();
  // One destination may be declared by only one rule, so later sources never silently reclassify it.
  for (const definition of [
    ...manifestProjectWrites(),
    ...agentProjectWrites(agent),
    ...conditionalProjectWrites(projectPath),
  ]) {
    const existing = definitions.get(definition.path);
    // Two different ownership claims for one path would make the preview action unverifiable.
    if (
      existing?.ownership !== undefined &&
      existing.ownership !== definition.ownership
    ) {
      throw new Error(
        `Install write set claims ${definition.path} as both ${existing.ownership} and ${definition.ownership}.`,
      );
    }
    definitions.set(definition.path, existing ?? definition);
  }
  // Stable path order keeps repeated text and JSON previews easy to diff.
  return [...definitions.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}
