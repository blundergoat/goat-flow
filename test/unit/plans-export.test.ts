/**
 * Verifies portable milestone exports from parsing through CLI persistence.
 * Users can preview redacted JSON or Markdown without writes, then explicitly
 * materialize generated files while existing output remains protected.
 * Fixtures cover complete, partial, and malformed goat-plan milestones.
 */
import { spawnSync } from "node:child_process";
import { describe, it, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { parseCLIArgs } from "../../src/cli/cli-parser.js";
import { parseMilestoneMarkdown } from "../../src/cli/plans-export.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const CLI_PATH = join(PROJECT_ROOT, "src", "cli", "cli.ts");

/** Build a full milestone body with every field users expect in an exported issue. */
function completeMilestoneBody(secretValue = "safe objective"): string {
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
`;
}

/** Write one plan fixture so CLI tests exercise the same filesystem shape users select. */
function writePlanFixture(
  planPath: string,
  body: string,
  sourceFile = "M42-portable-plan.md",
): void {
  mkdirSync(planPath, { recursive: true });
  writeFileSync(join(planPath, sourceFile), body, "utf-8");
}

/** Spawn the real CLI so parser, dispatch, redaction, and filesystem behavior stay integrated. */
function runPlansExport(...args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", CLI_PATH, "plans", "export", ...args],
    { cwd: PROJECT_ROOT, encoding: "utf-8" },
  );
}

/** Create a symlink, or skip the test on hosts that forbid unprivileged links. */
function symlinkOrSkip(
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

describe("plans export", () => {
  // A complete plan keeps every gate and checkbox future issue adapters need.
  it("parses complete milestone fields without warnings", () => {
    const record = parseMilestoneMarkdown(
      completeMilestoneBody(),
      "M42-portable-plan.md",
    );

    assert.equal(record.title, "M42: Portable plan");
    assert.equal(record.status, "in-progress");
    assert.equal(record.dependencies, "M08; M07");
    assert.equal(record.objective, "safe objective");
    assert.match(record.scopeMarkdown, /Export local artifacts/u);
    assert.match(record.boundaryMarkdown, /No remote writes/u);
    assert.deepEqual(record.tasks, [
      { isChecked: true, text: "Parse the plan." },
      { isChecked: false, text: "Export the body." },
    ]);
    assert.match(record.verificationMarkdown, /Run focused tests/u);
    assert.match(record.exitCriteriaMarkdown, /verification evidence/u);
    assert.deepEqual(record.warnings, []);
  });

  // A partial plan remains portable but tells users exactly which verification context is absent.
  it("exports missing optional fields as explicit warnings", () => {
    const record = parseMilestoneMarkdown(
      "# M43: Partial plan\n",
      "M43-partial-plan.md",
    );

    assert.equal(record.status, "unknown");
    assert.equal(record.objective, "");
    assert.deepEqual(record.tasks, []);
    assert.ok(record.warnings.includes("missing status"));
    assert.ok(record.warnings.includes("missing verification gate"));
    assert.ok(record.warnings.includes("missing exit criteria"));
  });

  // Handoff-grade milestones use a `## Objective` section and bare `Status:` line.
  it("parses section-style objectives and plain status lines", () => {
    const record = parseMilestoneMarkdown(
      [
        "# Milestone 01: Prove refresh-token rotation",
        "Status: not-started",
        "",
        "## Objective",
        "",
        "Prove the provider issues rotated refresh tokens.",
        "",
        "## Tasks",
        "",
        "- [ ] [RISKY] Verify rotation",
        "",
      ].join("\n"),
      "M01-prove-rotation.md",
    );

    assert.equal(record.status, "not-started");
    assert.equal(
      record.objective,
      "Prove the provider issues rotated refresh tokens.",
    );
    assert.ok(!record.warnings.includes("missing status"));
    assert.ok(!record.warnings.includes("missing objective"));
  });

  // A body without its milestone heading is malformed because an issue title cannot be inferred safely.
  it("rejects milestone markdown without a title", () => {
    assert.throws(
      () =>
        parseMilestoneMarkdown("**Status:** not-started\n", "M44-malformed.md"),
      (error: unknown) =>
        error instanceof Error &&
        error.name === "PlansExportInputError" &&
        error.message.includes("M44-malformed.md") &&
        error.message.includes("top-level title"),
    );
  });

  // CLI parsing keeps the plan path distinct from the export subcommand users invoked.
  it("parses plans export as a first-class CLI command", () => {
    const planPath = resolve(".goat-flow/plans/1.14.0");
    const parsed = parseCLIArgs([
      "plans",
      "export",
      planPath,
      "--format",
      "json",
    ]);

    assert.equal(parsed.command, "plans");
    assert.equal(parsed.plansSubcommand, "export");
    assert.equal(parsed.projectPath, planPath);
    assert.equal(parsed.output, null);
  });

  /**
   * Fixture purpose: reproduce a user previewing a sensitive plan before choosing an output path.
   * Process/filesystem side effects: spawns the CLI and writes only the temporary source milestone.
   */
  it("prints redacted JSON preview without creating export files", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-preview-"),
    );
    const planPath = join(temporaryRoot, "1.14.0");
    const fakeToken = ["ghp", "p".repeat(36)].join("_");
    writePlanFixture(
      planPath,
      completeMilestoneBody(fakeToken),
      `M42-${fakeToken}.md`,
    );

    try {
      const result = runPlansExport(planPath, "--format", "json");

      assert.equal(result.status, 0, result.stderr);
      const records = JSON.parse(result.stdout) as Array<{
        objective: string;
      }>;
      assert.equal(records[0]?.objective, "[REDACTED:token]");
      assert.doesNotMatch(result.stdout, new RegExp(fakeToken, "u"));
      assert.equal(existsSync(join(planPath, "exports")), false);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /**
   * Fixture purpose: cover the JSON persistence adapter rather than only its stdout preview.
   * Process/filesystem side effects: spawns the CLI and writes one bundle inside a temp directory.
   */
  it("writes a redacted JSON record bundle to an explicit output file", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-json-"));
    const planPath = join(temporaryRoot, "1.14.0");
    const outputPath = join(temporaryRoot, "exports", "1.14.0.json");
    writePlanFixture(planPath, completeMilestoneBody());

    try {
      const result = runPlansExport(
        planPath,
        "--format",
        "json",
        "--output",
        outputPath,
      );

      assert.equal(result.status, 0, result.stderr);
      const records = JSON.parse(readFileSync(outputPath, "utf-8")) as Array<{
        title: string;
        verificationMarkdown: string;
      }>;
      assert.equal(records[0]?.title, "M42: Portable plan");
      assert.match(records[0]?.verificationMarkdown ?? "", /focused tests/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /**
   * Fixture purpose: cover generated Markdown output and the explicit overwrite contract.
   * Process/filesystem side effects: spawns three CLI runs and writes only inside one temp directory.
   */
  it("writes redacted Markdown and requires force before regeneration", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-markdown-"),
    );
    const planPath = join(temporaryRoot, "1.14.0");
    const outputPath = join(temporaryRoot, "exports");
    const fakeToken = ["npm", "q".repeat(36)].join("_");
    writePlanFixture(planPath, completeMilestoneBody(fakeToken));

    try {
      const firstWrite = runPlansExport(
        planPath,
        "--format",
        "markdown",
        "--output",
        outputPath,
      );
      assert.equal(firstWrite.status, 0, firstWrite.stderr);
      const milestoneOutputPath = join(outputPath, "M42-portable-plan.md");
      const firstBody = readFileSync(milestoneOutputPath, "utf-8");
      assert.match(firstBody, /## Verification Gate/u);
      assert.match(firstBody, /\[REDACTED:token\]/u);
      assert.doesNotMatch(firstBody, new RegExp(fakeToken, "u"));

      writeFileSync(milestoneOutputPath, "user-owned replacement\n", "utf-8");
      const refusedWrite = runPlansExport(
        planPath,
        "--format",
        "markdown",
        "--output",
        outputPath,
      );
      assert.equal(refusedWrite.status, 2);
      assert.match(refusedWrite.stderr, /already exists.*--force/iu);
      assert.equal(
        readFileSync(milestoneOutputPath, "utf-8"),
        "user-owned replacement\n",
      );

      const forcedWrite = runPlansExport(
        planPath,
        "--format",
        "markdown",
        "--output",
        outputPath,
        "--force",
      );
      assert.equal(forcedWrite.status, 0, forcedWrite.stderr);
      assert.match(readFileSync(milestoneOutputPath, "utf-8"), /# M42/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /**
   * Fixture purpose: prove two source names cannot silently overwrite one generated Markdown file.
   * Process/filesystem side effects: spawns the CLI and writes only temporary source milestones.
   */
  it("rejects sanitized Markdown filename collisions before writing", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-filename-collision-"),
    );
    const planPath = join(temporaryRoot, "1.14.0");
    const outputPath = join(temporaryRoot, "exports");
    writePlanFixture(planPath, completeMilestoneBody(), "M01-a!.md");
    writePlanFixture(planPath, completeMilestoneBody(), "M01-a?.md");

    try {
      const result = runPlansExport(
        planPath,
        "--format",
        "markdown",
        "--output",
        outputPath,
        "--force",
      );

      assert.equal(result.status, 2);
      assert.match(result.stderr, /same export filename.*rename/iu);
      assert.equal(existsSync(outputPath), false);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /**
   * Fixture purpose: prove redaction cannot collapse distinct secret-bearing names into one destination.
   * Process/filesystem side effects: spawns the CLI and writes only temporary source milestones.
   */
  it("rejects redaction-induced Markdown filename collisions", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-redaction-collision-"),
    );
    const planPath = join(temporaryRoot, "1.14.0");
    const outputPath = join(temporaryRoot, "exports");
    const firstToken = ["ghp", "a".repeat(36)].join("_");
    const secondToken = ["ghp", "b".repeat(36)].join("_");
    writePlanFixture(planPath, completeMilestoneBody(), `M01-${firstToken}.md`);
    writePlanFixture(
      planPath,
      completeMilestoneBody(),
      `M01-${secondToken}.md`,
    );

    try {
      const result = runPlansExport(
        planPath,
        "--format",
        "markdown",
        "--output",
        outputPath,
      );

      assert.equal(result.status, 2);
      assert.match(result.stderr, /same export filename.*redaction/iu);
      assert.equal(existsSync(outputPath), false);
      assert.doesNotMatch(result.stderr, new RegExp(firstToken, "u"));
      assert.doesNotMatch(result.stderr, new RegExp(secondToken, "u"));
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /**
   * Fixture purpose: keep a directory-shaped JSON destination on the user-facing usage path.
   * Process/filesystem side effects: spawns the CLI and creates only temporary directories.
   */
  it("rejects a JSON output directory even with force", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-json-directory-"),
    );
    const planPath = join(temporaryRoot, "1.14.0");
    const outputPath = join(temporaryRoot, "exports");
    writePlanFixture(planPath, completeMilestoneBody());
    mkdirSync(outputPath, { recursive: true });

    try {
      const result = runPlansExport(
        planPath,
        "--format",
        "json",
        "--output",
        outputPath,
        "--force",
      );

      assert.equal(result.status, 2);
      assert.match(result.stderr, /JSON --output must be a file/iu);
      assert.doesNotMatch(result.stderr, /EISDIR/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // A directory shadowing one generated filename must fail before ANY milestone
  // is written; a forced regeneration must never leave a partial bundle.
  it("fails atomically when a forced Markdown destination is a directory", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plans-"));
    const planPath = join(temporaryRoot, "plan");
    const outputDirectory = join(temporaryRoot, "out");
    writePlanFixture(planPath, completeMilestoneBody());
    writePlanFixture(planPath, completeMilestoneBody(), "M43-second.md");
    mkdirSync(join(outputDirectory, "M43-second.md"), { recursive: true });

    try {
      const result = runPlansExport(
        planPath,
        "--format",
        "markdown",
        "--output",
        outputDirectory,
        "--force",
      );

      assert.equal(result.status, 2);
      assert.match(result.stderr, /regular file or absent/u);
      assert.doesNotMatch(result.stderr, /EISDIR/u);
      assert.ok(
        !existsSync(join(outputDirectory, "M42-portable-plan.md")),
        "no partial bundle may be written before the collision fails",
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // A symlinked generated filename must never be followed to an outside file,
  // even when the user authorized replacement with --force.
  it("refuses symlinked Markdown destinations even with force", (testContext: TestContext) => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plans-"));
    const planPath = join(temporaryRoot, "plan");
    const outputDirectory = join(temporaryRoot, "out");
    const victimPath = join(temporaryRoot, "victim.txt");
    writePlanFixture(planPath, completeMilestoneBody());
    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(victimPath, "keep\n", "utf-8");

    try {
      if (
        !symlinkOrSkip(
          testContext,
          victimPath,
          join(outputDirectory, "M42-portable-plan.md"),
        )
      ) {
        return;
      }
      const result = runPlansExport(
        planPath,
        "--format",
        "markdown",
        "--output",
        outputDirectory,
        "--force",
      );

      assert.equal(result.status, 2);
      assert.match(result.stderr, /regular file or absent/u);
      assert.equal(
        readFileSync(victimPath, "utf-8"),
        "keep\n",
        "the symlink target must remain untouched",
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
