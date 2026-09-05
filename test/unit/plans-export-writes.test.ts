/**
 * How the command behaves at the filesystem boundary: redacted previews by default, writes
 * only on explicit output, force required to regenerate, and symlinked or hardlinked
 * destinations refused outright.
 * Runs the real CLI and parser against written fixtures, so failures read as the author's
 * terminal output rather than as internals.
 */
import { describe, it } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseCLIArgs } from "../../src/cli/cli-parser.js";
import {
  completeMilestoneBody,
  writePlanFixture,
  runPlansExport,
  symlinkOrSkip,
  hardlinkOrSkip,
} from "./plans-export.helpers.js";

describe("plans export: CLI previews and protected writes", () => {
  // CLI parsing keeps the plan path distinct from the export subcommand users invoked.
  it("parses plans export as a first-class CLI command", () => {
    const planPath = resolve(".goat-flow/plans/1.15.0");
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
    const planPath = join(temporaryRoot, "1.15.0");
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
   * Fixture purpose: prove an exceptional-status explanation survives both portable formats without leaking pasted credentials.
   * Process/filesystem side effects: spawns two previews and writes only the temporary source milestone.
   */
  it("redacts status reasons and Lane values in JSON and Markdown previews", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-status-reason-"),
    );
    const planPath = join(temporaryRoot, "1.17.0");
    const fakeToken = ["ghp", "r".repeat(36)].join("_");
    const body = completeMilestoneBody().replace(
      "**Status:** in-progress",
      [
        "**Status:** abandoned",
        `**Status reason:** Human stopped after ${fakeToken} appeared in evidence.`,
        `**Lane:** ${fakeToken}`,
      ].join("\n"),
    );
    writePlanFixture(planPath, body);

    try {
      const jsonPreview = runPlansExport(planPath, "--format", "json");
      const markdownPreview = runPlansExport(planPath, "--format", "markdown");

      assert.equal(jsonPreview.status, 0, jsonPreview.stderr);
      assert.equal(markdownPreview.status, 0, markdownPreview.stderr);
      const records = JSON.parse(jsonPreview.stdout) as Array<{
        statusReason: string;
        lane: string;
      }>;
      assert.equal(records[0]?.lane, "[REDACTED:token]");
      assert.match(markdownPreview.stdout, /\*\*Lane:\*\* \[REDACTED:token\]/u);
      assert.equal(
        records[0]?.statusReason,
        "Human stopped after [REDACTED:token] appeared in evidence.",
      );
      assert.match(
        markdownPreview.stdout,
        /\*\*Status reason:\*\* Human stopped after \[REDACTED:token\] appeared in evidence\./u,
      );
      assert.doesNotMatch(jsonPreview.stdout, new RegExp(fakeToken, "u"));
      assert.doesNotMatch(markdownPreview.stdout, new RegExp(fakeToken, "u"));
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  for (const lane of ["", "php"]) {
    /**
     * Fixture purpose: preserve explicit Lane metadata without changing other exported bytes.
     * Process/filesystem side effects: spawns CLI previews and writes then removes a temporary plan.
     */
    it(`adds only declared Lane metadata to previews for ${lane || "an empty lane"}`, () => {
      const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-lane-"));
      const planPath = join(temporaryRoot, "plan");
      try {
        writePlanFixture(planPath, completeMilestoneBody());
        const legacyJson = runPlansExport(planPath, "--format", "json");
        const legacyMarkdown = runPlansExport(planPath, "--format", "markdown");
        assert.equal(legacyJson.status, 0, legacyJson.stderr);
        assert.equal(legacyMarkdown.status, 0, legacyMarkdown.stderr);
        const legacy = JSON.parse(legacyJson.stdout);
        assert.equal(Object.hasOwn(legacy[0], "lane"), false);
        assert.doesNotMatch(legacyMarkdown.stdout, /\*\*Lane:\*\*/u);
        writePlanFixture(
          planPath,
          completeMilestoneBody().replace(
            "**Depends on:** M08; M07",
            `**Depends on:** M08; M07\n**Lane:** ${lane}`,
          ),
        );
        const jsonPreview = runPlansExport(planPath, "--format", "json");
        const markdownPreview = runPlansExport(
          planPath,
          "--format",
          "markdown",
        );
        assert.equal(jsonPreview.status, 0, jsonPreview.stderr);
        assert.equal(markdownPreview.status, 0, markdownPreview.stderr);
        assert.deepEqual(JSON.parse(jsonPreview.stdout), [
          { ...legacy[0], lane },
        ]);
        const laneHeader = lane === "" ? "**Lane:**" : `**Lane:** ${lane}`;
        assert.equal(
          markdownPreview.stdout,
          legacyMarkdown.stdout.replace(
            "**Depends on:** M08; M07\n",
            `**Depends on:** M08; M07\n${laneHeader}\n`,
          ),
        );
      } finally {
        rmSync(temporaryRoot, { recursive: true, force: true });
      }
    });
  }

  /**
   * Fixture purpose: cover the JSON persistence adapter rather than only its stdout preview.
   * Process/filesystem side effects: spawns the CLI and writes one bundle inside a temp directory.
   */
  it("writes a redacted JSON record bundle to an explicit output file", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-json-"));
    const planPath = join(temporaryRoot, "1.15.0");
    const outputPath = join(temporaryRoot, "exports", "1.15.0.json");
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
    const planPath = join(temporaryRoot, "1.15.0");
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
      assert.match(firstBody, /## Proof/u);
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
   * Fixture purpose: prove force never converts a source milestone into its generated export.
   * Process/filesystem side effects: spawns the CLI and reads one unchanged temp source file.
   */
  it("refuses forced Markdown output that aliases a source milestone", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-source-alias-"),
    );
    const planPath = join(temporaryRoot, "1.15.0");
    const sourcePath = join(planPath, "M42-portable-plan.md");
    writePlanFixture(planPath, completeMilestoneBody());
    const sourceBefore = readFileSync(sourcePath, "utf-8");

    try {
      const result = runPlansExport(
        planPath,
        "--format",
        "markdown",
        "--output",
        planPath,
        "--force",
      );

      assert.equal(result.status, 2);
      assert.match(result.stderr, /would overwrite source milestone/iu);
      assert.equal(readFileSync(sourcePath, "utf-8"), sourceBefore);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /**
   * Fixture purpose: mirror source protection for the single-file JSON export path.
   * Process/filesystem side effects: spawns the CLI and reads one unchanged temp source file.
   */
  it("refuses forced JSON output that aliases a source through the selected plan path", (testContext) => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-json-source-alias-"),
    );
    const planPath = join(temporaryRoot, "1.15.0");
    const selectedPlanPath = join(temporaryRoot, "selected-plan");
    const sourcePath = join(planPath, "M42-portable-plan.md");
    writePlanFixture(planPath, completeMilestoneBody());
    if (!symlinkOrSkip(testContext, planPath, selectedPlanPath)) {
      rmSync(temporaryRoot, { recursive: true, force: true });
      return;
    }
    const sourceBefore = readFileSync(sourcePath, "utf-8");

    try {
      const result = runPlansExport(
        selectedPlanPath,
        "--format",
        "json",
        "--output",
        sourcePath,
        "--force",
      );

      assert.equal(result.status, 2);
      assert.match(result.stderr, /would overwrite source milestone/iu);
      assert.equal(readFileSync(sourcePath, "utf-8"), sourceBefore);
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
    const planPath = join(temporaryRoot, "1.15.0");
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
    const planPath = join(temporaryRoot, "1.15.0");
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
    const planPath = join(temporaryRoot, "1.15.0");
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

  // Fixture: writes an output parent that is a symlink to another directory, so a JSON export would land outside the folder the author named.
  it("refuses JSON export through a symlinked parent directory", (testContext: TestContext) => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plans-"));
    const planPath = join(temporaryRoot, "plan");
    const redirectedDirectory = join(temporaryRoot, "outside");
    const outputParent = join(temporaryRoot, "out");
    writePlanFixture(planPath, completeMilestoneBody());
    mkdirSync(redirectedDirectory, { recursive: true });

    try {
      if (!symlinkOrSkip(testContext, redirectedDirectory, outputParent)) {
        return;
      }
      const result = runPlansExport(
        planPath,
        "--format",
        "json",
        "--output",
        join(outputParent, "bundle.json"),
      );

      assert.equal(result.status, 2);
      assert.match(result.stderr, /real directory or absent/u);
      assert.equal(existsSync(join(redirectedDirectory, "bundle.json")), false);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // Fixture: writes a symlink above the output directory, so checking only the final path would miss the escape.
  it("refuses JSON export through a symlinked intermediate ancestor", (testContext: TestContext) => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plans-"));
    const planPath = join(temporaryRoot, "plan");
    const redirectedDirectory = join(temporaryRoot, "outside");
    const linkedAncestor = join(temporaryRoot, "linked-ancestor");
    writePlanFixture(planPath, completeMilestoneBody());
    mkdirSync(join(redirectedDirectory, "nested"), { recursive: true });

    try {
      if (!symlinkOrSkip(testContext, redirectedDirectory, linkedAncestor)) {
        return;
      }
      const result = runPlansExport(
        planPath,
        "--format",
        "json",
        "--output",
        join(linkedAncestor, "nested", "bundle.json"),
      );

      assert.equal(result.status, 2);
      assert.match(result.stderr, /real directory or absent/u);
      assert.equal(
        existsSync(join(redirectedDirectory, "nested", "bundle.json")),
        false,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // Fixture: writes a destination that is a hardlink to an unrelated file, so the export would overwrite content the author never named.
  it("refuses a hardlinked JSON destination even with force", (testContext: TestContext) => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plans-"));
    const planPath = join(temporaryRoot, "plan");
    const outputPath = join(temporaryRoot, "bundle.json");
    const victimPath = join(temporaryRoot, "victim.txt");
    writePlanFixture(planPath, completeMilestoneBody());
    writeFileSync(victimPath, "keep\n", "utf-8");

    try {
      if (!hardlinkOrSkip(testContext, victimPath, outputPath)) return;
      const result = runPlansExport(
        planPath,
        "--format",
        "json",
        "--output",
        outputPath,
        "--force",
      );

      assert.equal(result.status, 2);
      assert.match(result.stderr, /single-link regular file or absent/u);
      assert.equal(readFileSync(victimPath, "utf-8"), "keep\n");
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // A directory shadowing one generated filename must fail before ANY milestone
  // is written; a forced regeneration must never leave a partial bundle. Writes a
  // disposable plan plus the shadowing directory, then removes the whole root.
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
  // even when the user authorized replacement with --force. Writes a disposable
  // plan and the symlink, then removes the whole root.
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

  // Fixture: writes an output directory that is itself a symlink, so a forced export would land outside the directory the author named.
  it("refuses a symlinked Markdown output directory", (testContext: TestContext) => {
    // Fixture: an output directory that is itself a symlink to elsewhere, so a forced export
    // would silently write outside the directory the author named.
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plans-"));
    const planPath = join(temporaryRoot, "plan");
    const redirectedDirectory = join(temporaryRoot, "outside");
    const outputDirectory = join(temporaryRoot, "out");
    writePlanFixture(planPath, completeMilestoneBody());
    mkdirSync(redirectedDirectory, { recursive: true });

    try {
      if (!symlinkOrSkip(testContext, redirectedDirectory, outputDirectory)) {
        return;
      }
      const result = runPlansExport(
        planPath,
        "--format",
        "markdown",
        "--output",
        outputDirectory,
      );

      assert.equal(result.status, 2);
      assert.match(result.stderr, /real directory or absent/u);
      assert.equal(
        existsSync(join(redirectedDirectory, "M42-portable-plan.md")),
        false,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // Fixture: writes the symlink one level above the output directory, so a naive check of the final path would pass while the write escapes.
  it("refuses Markdown export through a symlinked intermediate ancestor", (testContext: TestContext) => {
    // Fixture: the symlink sits one level above the output directory, so a naive check of the
    // final path would pass while the write still escapes the tree the author chose.
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plans-"));
    const planPath = join(temporaryRoot, "plan");
    const redirectedDirectory = join(temporaryRoot, "outside");
    const linkedAncestor = join(temporaryRoot, "linked-ancestor");
    writePlanFixture(planPath, completeMilestoneBody());
    mkdirSync(join(redirectedDirectory, "nested"), { recursive: true });

    try {
      if (!symlinkOrSkip(testContext, redirectedDirectory, linkedAncestor)) {
        return;
      }
      const result = runPlansExport(
        planPath,
        "--format",
        "markdown",
        "--output",
        join(linkedAncestor, "nested", "exports"),
      );

      assert.equal(result.status, 2);
      assert.match(result.stderr, /real directory or absent/u);
      assert.equal(
        existsSync(
          join(
            redirectedDirectory,
            "nested",
            "exports",
            "M42-portable-plan.md",
          ),
        ),
        false,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
