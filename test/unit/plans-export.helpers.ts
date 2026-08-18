/**
 * Shared fixtures for the `plans export` suites.
 * Exports are the one plans surface that writes files a user shares outside the repo, so the
 * suites need the same three things over and over: a complete milestone the way an author
 * writes one, a disposable plan directory to run the real CLI against, and link builders for
 * proving the writer refuses symlinked or hardlinked destinations.
 *
 * The link builders skip rather than fail where the platform cannot create links, so the
 * write-protection suites stay honest on filesystems that cannot express the attack.
 */
import { spawnSync } from "node:child_process";
import type { TestContext } from "node:test";
import { linkSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
export const CLI_PATH = join(PROJECT_ROOT, "src", "cli", "cli.ts");

/**
 * Build a full milestone body with every field users expect in an exported issue.
 *
 * @param secretValue - objective text, so a redaction test can plant a value it then proves never reaches the export
 * @returns the milestone Markdown a fixture writes to disk
 */
export function completeMilestoneBody(secretValue = "safe objective"): string {
  return `# M42: Portable plan

**Status:** in-progress
**Depends on:** M08; M07
**Objective:** ${secretValue}

## Scope Discipline

- Export local artifacts.

## Boundary Gate

- No remote writes.

## Tasks

- [x] Parse the plan.
- [ ] Export the body.

## Verification Gate

- [ ] Run focused tests.

## Exit Criteria

- Export keeps verification evidence.

## STOP conditions

- Stop if export loses required context.
`;
}

/**
 * Write one plan fixture so CLI tests exercise the same filesystem shape users select.
 *
 * @param planPath - plan directory to create; parents are created as needed
 * @param body - milestone Markdown exactly as an author would save it
 * @param sourceFile - filename inside the plan; defaults to a canonical milestone name
 */
export function writePlanFixture(
  planPath: string,
  body: string,
  sourceFile = "M42-portable-plan.md",
): void {
  mkdirSync(planPath, { recursive: true });
  writeFileSync(join(planPath, sourceFile), body, "utf-8");
}

/**
 * Spawn the real CLI so parser, dispatch, redaction, and filesystem behavior stay integrated.
 *
 * @param args - arguments after `plans export`, exactly as an author would type them
 * @returns the finished process with stdout/stderr strings, so a test asserts on the same
 *   text the author reads in their terminal
 */
export function runPlansExport(...args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", CLI_PATH, "plans", "export", ...args],
    { cwd: PROJECT_ROOT, encoding: "utf-8" },
  );
}

/**
 * Create a symlink, or skip the test on hosts that forbid unprivileged links; it swallows that platform failure into a skip rather than a red test.
 *
 * @param testContext - the running test, so a forbidden host skips rather than fails
 * @param target - existing path the link should point at
 * @param link - link path the write-protection check will then try to export through
 * @returns true when the link exists and the check can run; false means the host cannot
 *   express the attack and the test has already been skipped
 */
export function symlinkOrSkip(
  testContext: TestContext,
  target: string,
  link: string,
): boolean {
  try {
    symlinkSync(target, link);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "EPERM"
    ) {
      testContext.skip(
        "Skipped: host blocks unprivileged symlinks (Windows without Developer Mode)",
      );
      return false;
    }
    throw error;
  }
}

/**
 * Create a hardlink, or skip when the host filesystem does not support it; it swallows that platform failure into a skip rather than a red test.
 *
 * @param testContext - the running test, so an unsupporting filesystem skips rather than fails
 * @param target - existing file the link should alias
 * @param link - link path the write-protection check will then try to export through
 * @returns true when the link exists and the check can run; false means the filesystem cannot
 *   express the attack and the test has already been skipped
 */
export function hardlinkOrSkip(
  testContext: TestContext,
  target: string,
  link: string,
): boolean {
  try {
    linkSync(target, link);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      ["EACCES", "EPERM", "EXDEV"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    ) {
      testContext.skip("Skipped: host filesystem blocks hardlinks");
      return false;
    }
    throw error;
  }
}
