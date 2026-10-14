/**
 * Tests what `goat-flow plans export` does at the filesystem boundary, from the first preview to a saved bundle the plan author can share.
 * Most cases run the export in-process so failures read like terminal output; the JSON preview and JSON file-write cases spawn the real CLI.
 *
 * What a plan author running the command can rely on:
 * - With no `--output`, it prints a redacted JSON or Markdown preview to stdout and writes no files.
 * - With `--output`, it writes the export; replacing an export that already exists needs `--force`.
 * - Even with `--force`, it refuses to overwrite a source milestone or to write through a symlinked or hardlinked destination.
 * - Every refusal exits 2 with a message on stderr and writes no export file.
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
  runPlansExportCli,
  symlinkOrSkip,
  hardlinkOrSkip,
} from "./plans-export.helpers.js";

/**
 * Follows a plan author from previewing a plan export to saving it, regenerating it, and hitting each refusal.
 * Each file-based case writes a throwaway plan in the OS temp folder and removes it in `finally`, so that a failed assertion leaves nothing behind.
 */
describe("plans export: CLI previews and protected writes", () => {
  /**
   * An author types `goat-flow plans export <plan> --format json` to see what the export would contain before saving anything.
   * The parser must route that to the export subcommand and keep the plan folder as the path to read.
   */
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
    // No `--output` was typed, so output stays null and the command previews to stdout instead of writing files.
    assert.equal(parsed.output, null);
  });

  /**
   * An author previews a plan before choosing where to save it, but a token was pasted into the objective and the milestone filename.
   * Spawns the real CLI and writes only the temp source milestone; the preview must be redacted and no `exports/` folder may appear.
   */
  it("prints redacted JSON preview without creating export files", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-preview-"),
    );
    const planPath = join(temporaryRoot, "1.15.0");
    // Built from parts so this source never holds a whole token-shaped string that the repo's secret scan would block.
    const fakeToken = ["ghp", "p".repeat(36)].join("_");
    writePlanFixture(
      planPath,
      completeMilestoneBody(fakeToken),
      `M42-${fakeToken}.md`,
    );

    try {
      const result = runPlansExportCli(planPath, "--format", "json");

      assert.equal(result.status, 0, result.stderr);
      const records = JSON.parse(result.stdout) as Array<{
        objective: string;
      }>;
      // An empty preview leaves `records[0]` undefined and fails here; otherwise the objective shows the redaction marker, not the token.
      assert.equal(records[0]?.objective, "[REDACTED:token]");
      assert.doesNotMatch(result.stdout, new RegExp(fakeToken, "u"));
      // Previewing must not create an `exports/` folder; files appear only once the author passes `--output`.
      assert.equal(existsSync(join(planPath, "exports")), false);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /**
   * An author abandons a milestone and explains why, but the status reason and the Lane value both quote a pasted token.
   * Runs JSON and Markdown previews in-process and writes only the temp source milestone; both must keep the reason's wording and mask the token.
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
      // With no record this reads undefined and fails; with one, the Lane value is masked whole because it held only the token.
      assert.equal(records[0]?.lane, "[REDACTED:token]");
      assert.match(markdownPreview.stdout, /\*\*Lane:\*\* \[REDACTED:token\]/u);
      // Only the token is masked, so a reader of the export still learns why the milestone stopped; a missing record fails as undefined.
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

  // One test per Lane value, so a failure names the shape that broke: empty (a bare `**Lane:**` header, titled "an empty lane") and `php`.
  for (const lane of ["", "php"]) {
    /**
     * An author adds a `**Lane:**` line under "Depends on" in a plan that already exports cleanly.
     * Runs previews in-process and writes then removes a temp plan; the export must gain the Lane field and change nothing else.
     */
    it(`adds only declared Lane metadata to previews for ${lane || "an empty lane"}`, () => {
      const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-lane-"));
      const planPath = join(temporaryRoot, "plan");
      try {
        writePlanFixture(planPath, completeMilestoneBody());
        const noLaneJsonPreview = runPlansExport(planPath, "--format", "json");
        const noLaneMarkdownPreview = runPlansExport(
          planPath,
          "--format",
          "markdown",
        );
        assert.equal(noLaneJsonPreview.status, 0, noLaneJsonPreview.stderr);
        assert.equal(
          noLaneMarkdownPreview.status,
          0,
          noLaneMarkdownPreview.stderr,
        );
        const noLaneRecords = JSON.parse(noLaneJsonPreview.stdout);
        // A plan with no Lane line must not gain a `lane` key in JSON or a Lane line in Markdown.
        assert.equal(Object.hasOwn(noLaneRecords[0], "lane"), false);
        assert.doesNotMatch(noLaneMarkdownPreview.stdout, /\*\*Lane:\*\*/u);
        // Example: the author edits the same milestone file and adds a Lane line directly under "Depends on".
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
          { ...noLaneRecords[0], lane },
        ]);
        // An empty Lane renders as a bare `**Lane:**` header with no trailing space; a named Lane follows the label.
        const laneHeader = lane === "" ? "**Lane:**" : `**Lane:** ${lane}`;
        assert.equal(
          markdownPreview.stdout,
          noLaneMarkdownPreview.stdout.replace(
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
   * An author passes a `.json` file path to `--output` to save the export for sharing outside the repo.
   * Spawns the real CLI and writes one bundle inside a temp folder; stderr must confirm the saved path and the file must hold the milestone.
   */
  it("writes a redacted JSON record bundle to an explicit output file", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-json-"));
    const planPath = join(temporaryRoot, "1.15.0");
    const outputPath = join(temporaryRoot, "exports", "1.15.0.json");
    writePlanFixture(planPath, completeMilestoneBody());

    try {
      const result = runPlansExportCli(
        planPath,
        "--format",
        "json",
        "--output",
        outputPath,
      );

      assert.equal(result.status, 0, result.stderr);
      // The saved path goes to stderr, so stdout stays clean for scripts that pipe the command.
      assert.equal(result.stderr, `Written to ${outputPath}\n`);
      const records = JSON.parse(readFileSync(outputPath, "utf-8")) as Array<{
        title: string;
        verificationMarkdown: string;
      }>;
      // A file with no milestones leaves `records[0]` undefined and both checks fail; otherwise the title and verification steps must survive.
      assert.equal(records[0]?.title, "M42: Portable plan");
      assert.match(records[0]?.verificationMarkdown ?? "", /focused tests/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /**
   * An author saves Markdown exports, edits one by hand, then runs the same export again.
   *
   * Runs three in-process exports and writes only inside one temp folder.
   * The rerun must exit 2 and keep the edit until the author adds `--force`.
   */
  it("writes redacted Markdown and requires force before regeneration", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-markdown-"),
    );
    const planPath = join(temporaryRoot, "1.15.0");
    const outputDirectory = join(temporaryRoot, "exports");
    const fakeToken = ["npm", "q".repeat(36)].join("_");
    writePlanFixture(planPath, completeMilestoneBody(fakeToken));

    try {
      const firstWrite = runPlansExport(
        planPath,
        "--format",
        "markdown",
        "--output",
        outputDirectory,
      );
      assert.equal(firstWrite.status, 0, firstWrite.stderr);
      const milestoneOutputPath = join(outputDirectory, "M42-portable-plan.md");
      const firstBody = readFileSync(milestoneOutputPath, "utf-8");
      assert.match(firstBody, /## Proof/u);
      assert.match(firstBody, /\[REDACTED:token\]/u);
      assert.doesNotMatch(firstBody, new RegExp(fakeToken, "u"));

      // Example: the author hand-edits the generated file; a plain rerun must not overwrite that edit.
      writeFileSync(milestoneOutputPath, "user-owned replacement\n", "utf-8");
      const refusedWrite = runPlansExport(
        planPath,
        "--format",
        "markdown",
        "--output",
        outputDirectory,
      );
      assert.equal(refusedWrite.status, 2);
      assert.match(refusedWrite.stderr, /already exists.*--force/iu);
      assert.equal(
        readFileSync(milestoneOutputPath, "utf-8"),
        "user-owned replacement\n",
      );

      // With `--force` the author opts in, so the regenerated export replaces the hand edit.
      const forcedWrite = runPlansExport(
        planPath,
        "--format",
        "markdown",
        "--output",
        outputDirectory,
        "--force",
      );
      assert.equal(forcedWrite.status, 0, forcedWrite.stderr);
      assert.match(readFileSync(milestoneOutputPath, "utf-8"), /# M42/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /**
   * An author points Markdown `--output` at the plan folder itself and adds `--force`, which would overwrite the milestones being exported.
   * Runs the export in-process and reads the temp source file back; it must exit 2 and leave the source unchanged.
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
   * An author selects the plan through a symlinked folder and names the real source milestone as the JSON `--output`, with `--force`.
   * Runs the export in-process and reads the source back; the export must see through the symlink, exit 2, and leave the milestone unchanged.
   *
   * @param testContext - the running test, so a host that blocks unprivileged symlinks skips this case instead of failing it
   */
  it("refuses forced JSON output that aliases a source through the selected plan path", (testContext) => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-json-source-alias-"),
    );
    const planPath = join(temporaryRoot, "1.15.0");
    const selectedPlanPath = join(temporaryRoot, "selected-plan");
    const sourcePath = join(planPath, "M42-portable-plan.md");
    writePlanFixture(planPath, completeMilestoneBody());
    // Example: on Windows without Developer Mode the symlink is refused, so the case is skipped and its temp folder removed before `try` starts.
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
   * An author has two milestones, `M01-a!.md` and `M01-a#.md`, that both become `M01-a-.md` once unsafe filename characters are replaced.
   * Runs the export in-process and writes only the temp sources; even with `--force` it must exit 2 and ask the author to rename one.
   */
  it("rejects sanitized Markdown filename collisions before writing", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-filename-collision-"),
    );
    const planPath = join(temporaryRoot, "1.15.0");
    const outputDirectory = join(temporaryRoot, "exports");
    writePlanFixture(planPath, completeMilestoneBody(), "M01-a!.md");
    writePlanFixture(planPath, completeMilestoneBody(), "M01-a#.md");

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
      assert.match(result.stderr, /same export filename.*rename/iu);
      // The collision is caught before any write, so not even the export folder is created.
      assert.equal(existsSync(outputDirectory), false);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /**
   * Two milestone filenames differ only by the token pasted into them, so after redaction both would get the same export filename.
   * Runs the export in-process and writes only the temp sources; it must exit 2 and keep both tokens out of the error message.
   */
  it("rejects redaction-induced Markdown filename collisions", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-redaction-collision-"),
    );
    const planPath = join(temporaryRoot, "1.15.0");
    const outputDirectory = join(temporaryRoot, "exports");
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
        outputDirectory,
      );

      assert.equal(result.status, 2);
      assert.match(result.stderr, /same export filename.*redaction/iu);
      // Refused before writing, so the export folder the author named never appears.
      assert.equal(existsSync(outputDirectory), false);
      assert.doesNotMatch(result.stderr, new RegExp(firstToken, "u"));
      assert.doesNotMatch(result.stderr, new RegExp(secondToken, "u"));
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /**
   * An author passes an existing folder as the JSON `--output`, with `--force`, where a single bundle file is expected.
   * Runs the export in-process and writes only a temp plan and that folder; it must exit 2 with a usage message, not a raw `EISDIR` error.
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

  /**
   * An author names `out/bundle.json`, but `out` is a symlink to another folder, so the bundle would land outside the folder they named.
   * Writes the symlink and a temp plan; the export must exit 2 and write nothing into the symlink's target.
   *
   * @param testContext - the running test, so a host that blocks unprivileged symlinks skips this case instead of failing it
   */
  it("refuses JSON export through a symlinked parent directory", (testContext: TestContext) => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plans-"));
    const planPath = join(temporaryRoot, "plan");
    const redirectedDirectory = join(temporaryRoot, "outside");
    const outputParent = join(temporaryRoot, "out");
    writePlanFixture(planPath, completeMilestoneBody());
    mkdirSync(redirectedDirectory, { recursive: true });

    try {
      // If the host refuses the symlink (EPERM), the case is skipped here; `finally` still removes the temp folder.
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

  /**
   * The same escape one level higher: `linked-ancestor` is a symlink and the author names `linked-ancestor/nested/bundle.json`.
   * Writes the symlink and a temp plan; checking only the final folder would miss it, so every existing parent must be a real folder.
   *
   * @param testContext - the running test, so a host that blocks unprivileged symlinks skips this case instead of failing it
   */
  it("refuses JSON export through a symlinked intermediate ancestor", (testContext: TestContext) => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plans-"));
    const planPath = join(temporaryRoot, "plan");
    const redirectedDirectory = join(temporaryRoot, "outside");
    const linkedAncestor = join(temporaryRoot, "linked-ancestor");
    writePlanFixture(planPath, completeMilestoneBody());
    mkdirSync(join(redirectedDirectory, "nested"), { recursive: true });

    try {
      // Without symlink permission the case skips here, and the export never runs against an unlinked path.
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

  /**
   * The author's chosen `bundle.json` is a hardlink to an unrelated file, so writing the bundle would also overwrite that file's content.
   * Writes the hardlink and a temp plan; even with `--force` the export must exit 2 and leave the unrelated file reading "keep".
   *
   * @param testContext - the running test, so a filesystem that blocks hardlinks skips this case instead of failing it
   */
  it("refuses a hardlinked JSON destination even with force", (testContext: TestContext) => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plans-"));
    const planPath = join(temporaryRoot, "plan");
    const outputPath = join(temporaryRoot, "bundle.json");
    const unrelatedFilePath = join(temporaryRoot, "victim.txt");
    writePlanFixture(planPath, completeMilestoneBody());
    writeFileSync(unrelatedFilePath, "keep\n", "utf-8");

    try {
      // Example: a temp folder on a filesystem that blocks hardlinks (EACCES, EPERM or EXDEV) skips this case; `finally` still cleans up.
      if (!hardlinkOrSkip(testContext, unrelatedFilePath, outputPath)) return;
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
      assert.equal(readFileSync(unrelatedFilePath, "utf-8"), "keep\n");
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /**
   * An author exports a two-milestone plan with `--force`, but a folder already sits where `M43-second.md` would be written.
   *
   * Writes a temp plan plus that folder, then removes the whole temp root.
   * The export must exit 2 before writing any milestone, so the author never gets a partial bundle.
   */
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

  /**
   * The generated `M42-portable-plan.md` in the output folder is a symlink to an unrelated file, and the author passes `--force`.
   * Writes a temp plan and the symlink; the export must exit 2 rather than follow the link, so the unrelated file still reads "keep".
   *
   * @param testContext - the running test, so a host that blocks unprivileged symlinks skips this case instead of failing it
   */
  it("refuses symlinked Markdown destinations even with force", (testContext: TestContext) => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plans-"));
    const planPath = join(temporaryRoot, "plan");
    const outputDirectory = join(temporaryRoot, "out");
    const unrelatedFilePath = join(temporaryRoot, "victim.txt");
    writePlanFixture(planPath, completeMilestoneBody());
    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(unrelatedFilePath, "keep\n", "utf-8");

    try {
      // A host that blocks the symlink skips the case here, since it cannot stage a link for the export to follow.
      if (
        !symlinkOrSkip(
          testContext,
          unrelatedFilePath,
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
        readFileSync(unrelatedFilePath, "utf-8"),
        "keep\n",
        "the symlink target must remain untouched",
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /**
   * An author names `out` as the Markdown `--output`, but `out` is a symlink, so the export would land outside the folder they named.
   * Writes the symlink and a temp plan; the export must exit 2 and write no milestone into the symlink's target.
   *
   * @param testContext - the running test, so a host that blocks unprivileged symlinks skips this case instead of failing it
   */
  it("refuses a symlinked Markdown output directory", (testContext: TestContext) => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plans-"));
    const planPath = join(temporaryRoot, "plan");
    const redirectedDirectory = join(temporaryRoot, "outside");
    const outputDirectory = join(temporaryRoot, "out");
    writePlanFixture(planPath, completeMilestoneBody());
    mkdirSync(redirectedDirectory, { recursive: true });

    try {
      // Without a symlink there is nothing to escape through, so the case is skipped instead of run against an ordinary folder.
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

  /**
   * The symlink sits two levels above the Markdown output folder: the author names `linked-ancestor/nested/exports`, and only `linked-ancestor` is a link.
   * Writes the symlink and a temp plan; a check of only the final folder would pass, so the export must inspect every existing parent and exit 2.
   *
   * @param testContext - the running test, so a host that blocks unprivileged symlinks skips this case instead of failing it
   */
  it("refuses Markdown export through a symlinked intermediate ancestor", (testContext: TestContext) => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plans-"));
    const planPath = join(temporaryRoot, "plan");
    const redirectedDirectory = join(temporaryRoot, "outside");
    const linkedAncestor = join(temporaryRoot, "linked-ancestor");
    writePlanFixture(planPath, completeMilestoneBody());
    mkdirSync(join(redirectedDirectory, "nested"), { recursive: true });

    try {
      // If the host blocks symlinks the case stops here as skipped; the temp folder is still removed in `finally`.
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
