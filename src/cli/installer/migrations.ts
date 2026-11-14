/** Move residual user files without replacing a destination that another writer created. */
import {
  linkSync,
  lstatSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { installerDestination, installerDirectory } from "./atomic-files.js";

const DIRECTORY_MIGRATIONS = [
  [".goat-flow/footguns", ".goat-flow/learning-loop/footguns"],
  [".goat-flow/lessons", ".goat-flow/learning-loop/lessons"],
  [".goat-flow/patterns", ".goat-flow/learning-loop/patterns"],
  [".goat-flow/decisions", ".goat-flow/learning-loop/decisions"],
  [".goat-flow/tasks", ".goat-flow/plans"],
  [".goat-flow/hook-lib", ".goat-flow/hooks/deny-dangerous"],
  [".goat-flow/skill-reference", ".goat-flow/skill-docs"],
  [
    ".goat-flow/skill-playbooks/skill-quality-testing",
    ".goat-flow/skill-docs/skill-quality-testing",
  ],
  [".goat-flow/skill-playbooks", ".goat-flow/skill-docs/playbooks"],
] as const;

/** Link then unlink one regular file: collisions and unsupported filesystems preserve its source. */
export function moveInstallerFile(
  project: string,
  source: string,
  destination: string,
  report: (message: string) => void,
): void {
  const sourcePath = installerDestination(project, source);
  if (!lstatSync(sourcePath, { throwIfNoEntry: false })) return;
  const destinationPath = installerDestination(project, destination);
  if (lstatSync(destinationPath, { throwIfNoEntry: false })) {
    report(
      `  · ${source} → ${destination} (target exists, left old file in place)`,
    );
    return;
  }
  installerDirectory(project, dirname(destination));
  installerDestination(project, source);
  installerDestination(project, destination);
  try {
    linkSync(sourcePath, destinationPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      report(
        `  · ${source} → ${destination} (target appeared, left old file in place)`,
      );
      return;
    }
    throw new Error(
      `atomic migration rename failed for '${source}' → '${destination}'; source was preserved and no copy fallback was attempted`,
      { cause: error },
    );
  }
  unlinkSync(sourcePath);
  report(`  ✓ ${source} → ${destination}`);
}

/** Merge directories leaf by leaf; each collision keeps the original user file in place. */
function migrateDirectory(
  project: string,
  source: string,
  destination: string,
  report: (message: string) => void,
): void {
  const sourcePath = join(project, source);
  const stats = lstatSync(sourcePath, { throwIfNoEntry: false });
  if (!stats) return;
  installerDestination(project, `${source}/.goat-flow-directory-check`);
  installerDirectory(project, destination);
  for (const entry of readdirSync(sourcePath, { withFileTypes: true })) {
    const from = `${source}/${entry.name}`;
    const to = `${destination}/${entry.name}`;
    if (lstatSync(join(project, to), { throwIfNoEntry: false })) {
      report(`  · ${from} → ${to} (target exists, left old entry in place)`);
      continue;
    }
    if (entry.isDirectory()) migrateDirectory(project, from, to, report);
    else moveInstallerFile(project, from, to, report);
  }
  if (readdirSync(sourcePath).length === 0) {
    rmdirSync(sourcePath);
    report(`  ✓ ${source}/ → ${destination}/`);
  }
}

/** Residual layouts can survive supported upgrades; omit obsolete config rewrites and unconditional pruning. */
export function migrateInstallerDirectories(
  project: string,
  report: (message: string) => void,
): void {
  for (const [source, destination] of DIRECTORY_MIGRATIONS) {
    if (source === ".goat-flow/skill-playbooks") {
      moveInstallerFile(
        project,
        `${source}/skill-quality-testing.md`,
        ".goat-flow/skill-docs/skill-quality-testing/README.md",
        report,
      );
    }
    migrateDirectory(project, source, destination, report);
  }
}
