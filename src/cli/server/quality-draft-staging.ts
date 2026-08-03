/**
 * Create the private project-owned staging path used by dashboard quality capture.
 * The directory walk rejects links and file-shadowed components, including a
 * competing process that wins creation with an unsafe entry. Git ignore proof
 * runs before this module creates any missing project directories.
 */
import { chmodSync, lstatSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { isQualityPersistencePathIgnored } from "../quality/quality-command.js";

/** Exact local directory whose descendants may briefly contain raw quality text. */
const STAGING_RELATIVE_PATH = ".goat-flow/logs/quality/staging/";

/** One prospective staging component and its non-following filesystem observation. */
interface InspectedDraftDirectory {
  componentPath: string;
  stats: NonNullable<ReturnType<typeof lstatSync>> | null;
}

/** Inspect components without creating them; unreadable paths fail before any write. */
function inspectQualityDraftDirectories(
  componentPaths: readonly string[],
): InspectedDraftDirectory[] {
  return componentPaths.map((componentPath) => {
    try {
      return { componentPath, stats: lstatSync(componentPath) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { componentPath, stats: null };
      }
      throw new Error(
        `quality capture: could not inspect ${componentPath} before creating staging.`,
      );
    }
  });
}

/** Reject existing components that would redirect or shadow the private staging tree. */
function assertQualityDraftDirectories(
  components: readonly InspectedDraftDirectory[],
): void {
  for (const component of components) {
    if (component.stats !== null && !component.stats.isDirectory()) {
      throw new Error(
        `quality capture: ${component.componentPath} must be a real project-local directory.`,
      );
    }
  }
}

/** Create one missing component; non-`EEXIST` failures and unsafe winners abort capture. */
function createMissingQualityDraftDirectory(
  component: InspectedDraftDirectory,
  stagingPath: string,
): void {
  if (component.stats !== null) return;
  try {
    mkdirSync(component.componentPath, {
      mode: component.componentPath === stagingPath ? 0o700 : undefined,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const winner = lstatSync(component.componentPath);
    if (!winner.isDirectory()) {
      throw new Error(
        `quality capture: ${component.componentPath} must be a real project-local directory.`,
      );
    }
  }
}

/** Recheck one component after creation; the function throws for missing or redirected winners. */
function assertCurrentQualityDraftDirectory(componentPath: string): void {
  if (!lstatSync(componentPath).isDirectory()) {
    throw new Error(
      `quality capture: ${componentPath} must be a real project-local directory.`,
    );
  }
}

/** Keep the POSIX staging leaf private; a mode that remains permissive aborts capture. */
function enforcePrivateQualityStagingDirectory(
  componentPath: string,
  stagingPath: string,
): void {
  if (process.platform === "win32" || componentPath !== stagingPath) return;
  chmodSync(componentPath, 0o700);
  if ((lstatSync(componentPath).mode & 0o077) !== 0) {
    throw new Error(
      "quality capture: staging directory must be private (0700).",
    );
  }
}

/** Create and recheck each missing component, then enforce the private staging leaf. */
function createQualityDraftDirectories(
  components: readonly InspectedDraftDirectory[],
  stagingPath: string,
): void {
  for (const component of components) {
    createMissingQualityDraftDirectory(component, stagingPath);
    assertCurrentQualityDraftDirectory(component.componentPath);
    enforcePrivateQualityStagingDirectory(component.componentPath, stagingPath);
  }
}

/**
 * Create the quality staging directory after proving it is ignored and local.
 * Use before launching a reporting agent so its narrow write allow already exists.
 * Unsafe, unreadable, or non-ignored paths throw before capture starts.
 *
 * @param projectRoot - report owner project; empty or missing roots cannot pass Git ignore proof
 * @returns absolute private staging directory; never a symlink after the final recheck
 */
export function ensureQualityDraftStagingDirectory(
  projectRoot: string,
): string {
  const components = [
    join(projectRoot, ".goat-flow"),
    join(projectRoot, ".goat-flow", "logs"),
    join(projectRoot, ".goat-flow", "logs", "quality"),
    join(projectRoot, ".goat-flow", "logs", "quality", "staging"),
  ];
  const inspectedComponents = inspectQualityDraftDirectories(components);
  assertQualityDraftDirectories(inspectedComponents);
  if (!isQualityPersistencePathIgnored(projectRoot, STAGING_RELATIVE_PATH)) {
    throw new Error(
      `quality capture: ${STAGING_RELATIVE_PATH} must be gitignored before capture starts.`,
    );
  }
  const stagingPath = components[components.length - 1] as string;
  createQualityDraftDirectories(inspectedComponents, stagingPath);
  return stagingPath;
}
