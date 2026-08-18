/**
 * Create the private project-owned staging path used by dashboard quality capture.
 *
 * The directory walk rejects links and file-shadowed components, including a competing process that wins creation with an unsafe entry.
 * Git ignore proof runs before this module creates any missing project directories.
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

/** Filesystem seam used to reproduce concurrent directory replacement in tests. */
interface QualityDraftStagingDeps {
  createDraftDirectory?: (path: string, options?: { mode?: number }) => unknown;
}

/** Inspect components without creating them; it throws on an unreadable path before any write happens. */
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

/** Reject existing components that would redirect or shadow the private staging tree; it throws on the first one it finds. */
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

/** Create one missing component; it throws when creation fails for any reason other than a safe concurrent winner. */
function createMissingQualityDraftDirectory(
  component: InspectedDraftDirectory,
  stagingPath: string,
  deps: QualityDraftStagingDeps,
): void {
  if (component.stats !== null) return;
  const createDraftDirectory = deps.createDraftDirectory ?? mkdirSync;
  const options =
    component.componentPath === stagingPath ? { mode: 0o700 } : undefined;
  try {
    createDraftDirectory(component.componentPath, options);
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
  try {
    if (lstatSync(componentPath).isDirectory()) return;
  } catch {
    // Missing and unreadable components fail through the same local-path contract.
  }
  throw new Error(
    `quality capture: ${componentPath} must be a real project-local directory.`,
  );
}

/** Keep the POSIX staging leaf private; it throws when the mode stays group or world readable after the change. */
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
  deps: QualityDraftStagingDeps,
): void {
  for (const component of components) {
    createMissingQualityDraftDirectory(component, stagingPath, deps);
    assertCurrentQualityDraftDirectory(component.componentPath);
    enforcePrivateQualityStagingDirectory(component.componentPath, stagingPath);
  }
}

/**
 * Create the quality staging directory after proving it is ignored and local.
 * Use before launching a reporting agent so its narrow write allow already exists.
 * It throws on an unsafe, unreadable, or non-ignored path before capture starts, so a reporting agent never writes outside private staging.
 *
 * @param projectRoot - report owner project; empty or missing roots cannot pass Git ignore proof
 * @param deps - optional directory creator used to reproduce concurrent replacement in tests
 * @returns absolute private staging directory; never a symlink after the final recheck
 */
export function ensureQualityDraftStagingDirectory(
  projectRoot: string,
  deps: QualityDraftStagingDeps = {},
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
  createQualityDraftDirectories(inspectedComponents, stagingPath, deps);
  // Earlier components can be replaced while a later descendant is created.
  // Revalidate the complete chain immediately before the caller uses staging.
  for (const componentPath of components) {
    assertCurrentQualityDraftDirectory(componentPath);
  }
  return stagingPath;
}
