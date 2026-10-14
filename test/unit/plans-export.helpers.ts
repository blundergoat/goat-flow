/**
 * Shared fixtures for the `plans export` suites.
 * Exports are the one plans surface that writes files a user shares outside the repo, so the suites need the same setup over and over.
 *
 * The helpers cover what a developer has on disk and types before reading an export result:
 * - a complete milestone the way an author writes one, saved into a plan directory;
 * - in-process and real-process runners for `goat-flow plans export <plan-path>` that return the exit status, stdout and stderr;
 * - symlink and hardlink builders that stage a linked plan or `--output` path for write-protection tests; they skip where links are blocked.
 */
import type { TestContext } from "node:test";
import { linkSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CLIError } from "../../src/cli/cli-error.js";
import { parseCLIArgs } from "../../src/cli/cli-parser.js";
import { runPlansExportOutput } from "../../src/cli/plans-export.js";
import { runPlansCommand } from "./plans-check.helpers.js";

/** Repository root, resolved from this test folder so it stays correct whatever directory the suite is started from. */
export const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
/** The `src/cli/cli.ts` entry a developer runs with `node --import tsx` to start goat-flow from this checkout. */
export const CLI_PATH = join(PROJECT_ROOT, "src", "cli", "cli.ts");

/**
 * Build a full milestone body with every field users expect in an exported issue.
 *
 * Suites save it with {@link writePlanFixture} or pass it straight to `parseMilestoneMarkdown`, often after appending or `.replace`-ing one field.
 * A redaction test passes a fake `ghp_` token, as if an author had pasted a credential into the Objective line.
 *
 * @param secretValue - objective text, so a redaction test can plant a value it then proves never reaches the export; omitted uses `safe objective`
 * @returns the milestone Markdown a fixture writes to disk; never empty
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
 * Call it once per milestone, then hand `planPath` to a runner the way a developer passes `<plan-path>` to `goat-flow plans export`.
 *
 * @param planPath - plan directory to create; parents are created as needed
 * @param body - milestone Markdown as an author would save it; empty or title-less text makes `plans export` exit 2 with a missing-title error
 * @param sourceFile - filename inside the plan; omitted writes `M42-portable-plan.md`, and a same-named file is overwritten
 */
export function writePlanFixture(
  planPath: string,
  body: string,
  sourceFile = "M42-portable-plan.md",
): void {
  mkdirSync(planPath, { recursive: true });
  writeFileSync(join(planPath, sourceFile), body, "utf-8");
}

/** Run `plans export` in this process and return what the CLI would print and exit with; requested export files are still written.
 *
 * Mirrors `src/cli/cli.ts`: a CLIError becomes its message on stderr with its exit code, and any other error becomes `Fatal error:` with exit 1.
 * `--help` and `--version` are not handled here; use {@link runPlansExportCli} for them and for the real-process contract.
 *
 * @param args - arguments after `plans export`, exactly as an author would type them; empty returns the `requires one <plan-path>` usage error
 * @returns the exit status, stdout and stderr the plan author would see; stdout is empty after an error or an `--output` write
 * @throws Never; every export error becomes a returned status and stderr text
 */
export function runPlansExport(...args: string[]) {
  try {
    const { stdout, stderr } = runPlansExportOutput(
      parseCLIArgs(["plans", "export", ...args]),
    );
    return { status: 0, stdout, stderr };
  } catch (error) {
    // For example, the developer reruns an export onto an existing `--output` file without `--force`, or asks for `--format sarif`.
    // The CLI prints an expected input error's message and exits with its code.
    if (error instanceof CLIError) {
      return {
        status: error.exitCode,
        stdout: "",
        stderr: `${error.message}\n`,
      };
    }
    // Any other failure, such as EACCES when `--output` points into a folder the developer cannot write to, becomes `Fatal error:` and exit 1.
    return {
      status: 1,
      stdout: "",
      stderr: `Fatal error: ${error instanceof Error ? error.message : String(error)}\n`,
    };
  }
}

/**
 * Spawn the real CLI so parser, dispatch, redaction, and filesystem behavior stay integrated.
 * Use it for `--help`, `--version` and end-to-end checks; unlike {@link runPlansExport}, each call starts a new Node process.
 *
 * @param args - arguments after `plans export`, exactly as an author would type them; empty returns the `requires one <plan-path>` usage error
 * @returns the finished process with the stdout/stderr text the author reads in their terminal; status is null only if a signal killed the CLI
 */
export function runPlansExportCli(...args: string[]) {
  return runPlansCommand("export", ...args);
}

/**
 * Create a symlink, or skip the test on hosts that forbid unprivileged links; it swallows that platform failure into a skip rather than a red test.
 * Write-protection tests use it to point a selected plan or an export output somewhere the developer never named.
 *
 * @param testContext - the running test, so a forbidden host skips rather than fails
 * @param target - existing path the link should point at
 * @param link - path the export then meets: the selected plan, an output file or folder, or a folder above the output
 * @returns true when the link exists and the check runs; false means the host cannot express the attack and the test has already been skipped
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
    // For example, a developer runs the suite on Windows without Developer Mode, where creating a symlink fails with EPERM.
    // Only that refusal becomes a skip, so the run lists this test as skipped instead of failed.
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "EPERM"
    ) {
      testContext.skip(
        "Skipped: host blocks unprivileged symlinks (Windows without Developer Mode)",
      );
      return false;
    }
    // Any other failure, such as EEXIST when the link path already exists, is a broken fixture, so the test fails.
    throw error;
  }
}

/**
 * Create a hardlink, or skip when the host filesystem does not support it; it swallows that platform failure into a skip rather than a red test.
 * A write-protection test uses it to make the export destination share its contents with a file the developer never named.
 *
 * @param testContext - the running test, so an unsupporting filesystem skips rather than fails
 * @param target - existing file the link should alias
 * @param link - export destination the test then passes as `--output`, so an unguarded forced export would also rewrite `target`
 * @returns true when the link exists and the check runs; false means the filesystem cannot express the attack and the test has already been skipped
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
    // For example, the developer's system temp folder is on a mount that refuses hardlinks, and Node reports EACCES, EPERM or EXDEV.
    // Those permission and cross-device refusals become a skip, so the run lists this test as skipped instead of failed.
    if (
      error instanceof Error &&
      ["EACCES", "EPERM", "EXDEV"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    ) {
      testContext.skip("Skipped: host filesystem blocks hardlinks");
      return false;
    }
    // Any other failure, such as EEXIST when the link path already exists or an error with no code, is a broken fixture, so the test fails.
    throw error;
  }
}
