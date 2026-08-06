/**
 * Verifies quality CLI parsing and bounded report persistence.
 * Users reach these paths when they request, save, or inspect a quality run.
 * The tests keep invalid input out of history without hiding recoverable legacy reports.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { classifyProjectState } from "../../src/cli/classify-state.js";
import {
  MULTI_AGENT_SYNC_BANNER,
  validAgentFlags,
  validAgentList,
  validAgents,
} from "../../src/cli/cli-agent-options.js";
import { CLIError } from "../../src/cli/cli-error.js";
import { writeOutput } from "../../src/cli/cli-output.js";
import { parseCLIArgs } from "../../src/cli/cli-parser.js";
import {
  COMMANDS,
  HOOK_SUBCOMMANDS,
  REMOVED_COMMANDS,
  VALID_FORMATS,
} from "../../src/cli/cli-types.js";
import type { ParsedCLI } from "../../src/cli/cli-types.js";
import { getPackageVersion } from "../../src/cli/paths.js";
import { persistQualityReportText } from "../../src/cli/quality/quality-command.js";
import { parseQualityReport } from "../../src/cli/quality/schema.js";

const CLI_USAGE_EXIT_CODE = 2;
const REPOSITORY_ROOT = resolve(import.meta.dirname, "..", "..");
const QUALITY_REPORT_TOKEN_FIXTURE = `ghp_${"abcdefghijklmnopqrstuvwxyz"}`;

/** Impossible formatted dates that current quality reports must reject. */
const INVALID_CURRENT_RUN_DATES = [
  "2026-02-29",
  "2026-04-31",
  "2026-13-01",
] as const;

/** Build one current report accepted by the strict quality schema. */
function currentQualityReport(
  projectPath: string,
  detail = `Token fixture ${QUALITY_REPORT_TOKEN_FIXTURE}`,
) {
  const version = getPackageVersion();
  return {
    report_kind: "goat-flow-quality-report",
    goat_flow_version: version,
    agent: "claude",
    project_path: projectPath,
    run_date: "2026-07-31",
    audit_status: "pass",
    scope: "framework-self",
    rubric_version: version,
    quality_mode: "skills",
    prior_report_id: null,
    scores: {
      setup: {
        total: 0,
        accuracy: 0,
        relevance: 0,
        completeness: 0,
        friction: 0,
      },
      system: {
        total: 0,
        usefulness: 0,
        signal_to_noise: 0,
        adaptability: 0,
        learnability: 0,
      },
    },
    findings: [
      {
        type: "setup_quality",
        severity: "MINOR",
        file: null,
        line: null,
        summary: "Persistence fixture",
        detail,
        evidence_quality: "OBSERVED",
        evidence_method: "static-analysis",
        delta_tag: null,
      },
    ],
  };
}

/** Spawns the public source CLI saver with one raw stdin body. */
function runQualitySaveText(projectPath: string, input: string) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "src/cli/cli.ts", "quality", "save", projectPath],
    {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      input,
    },
  );
}

/** Run the public source CLI saver with one in-memory report body. */
function runQualitySave(projectPath: string, report: unknown) {
  return runQualitySaveText(
    projectPath,
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

/**
 * Writes a Git project whose exact quality report filename family is gitignored.
 * Use when a test needs the "report stays local" precondition the save path requires.
 *
 * @returns the project root path, already carrying the ignore rule the save path checks
 */
function makeIgnoredQualityRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-quality-save-"));
  execFileSync("git", ["-C", root, "init", "--quiet"]);
  writeFileSync(join(root, ".gitignore"), ".goat-flow/logs/quality/*.json\n");
  return root;
}

/**
 * Capture stdout emitted by the shared CLI output writer.
 *
 * @param rendered - command output body to write
 * @returns the exact text written to stdout
 */
function captureStdoutWrite(rendered: string): string {
  let captured = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    captured += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  try {
    writeOutput({ output: null } as ParsedCLI, rendered);
  } finally {
    process.stdout.write = originalWrite;
  }
  return captured;
}

describe("quality subcommand parsing", () => {
  it("keeps CLI support modules aligned with parser-visible command vocabulary", () => {
    assert.equal(validAgents().includes("claude"), true);
    assert.match(validAgentList(), /claude/);
    assert.match(validAgentFlags(), /--agent claude/);
    assert.match(MULTI_AGENT_SYNC_BANNER.join("\n"), /Multi-agent sync/);
    assert.equal(
      new CLIError("usage", CLI_USAGE_EXIT_CODE).exitCode,
      CLI_USAGE_EXIT_CODE,
    );
    assert.equal(COMMANDS.includes("quality"), true);
    assert.equal(HOOK_SUBCOMMANDS.has("sync"), true);
    assert.equal(VALID_FORMATS.includes("json"), true);
    assert.match(REMOVED_COMMANDS.check, /audit --check-drift/);
    assert.match(REMOVED_COMMANDS.critique, /\bquality\b/);
    assert.match(REMOVED_COMMANDS.fix, /\b(?:audit|quality)\b/);
    assert.match(REMOVED_COMMANDS.eval, /\bquality candidacy\b/);
    assert.doesNotMatch(REMOVED_COMMANDS.eval, /quality evaluate/);
    assert.equal(captureStdoutWrite("payload"), "payload\n");
    assert.equal(
      classifyProjectState({ exists: () => false, readFile: () => null }).state,
      "bare",
    );
  });

  it("rejects the removed capture subcommand with a migration hint", () => {
    assert.throws(
      () => parseCLIArgs(["quality", "capture"]),
      /quality capture.+removed/i,
    );
  });

  it("parses history mode with --all", () => {
    const parsed = parseCLIArgs([
      "quality",
      "history",
      "--agent",
      "claude",
      "--mode",
      "skills",
      "--all",
    ]);
    assert.equal(parsed.qualitySubcommand, "history");
    assert.equal(parsed.includeAll, true);
    assert.equal(parsed.agent, "claude");
    assert.equal(parsed.qualityMode, "skills");
  });

  it("parses diff mode with an explicit report pair", () => {
    const parsed = parseCLIArgs([
      "quality",
      "diff",
      "2026-04-01-0900-claude-aaaaa:2026-04-15-1000-claude-bbbbb",
      "--agent",
      "claude",
    ]);
    assert.equal(parsed.qualitySubcommand, "diff");
    assert.equal(
      parsed.qualityDiffPair,
      "2026-04-01-0900-claude-aaaaa:2026-04-15-1000-claude-bbbbb",
    );
  });

  it("parses prompt mode for mode-specific quality prompts", () => {
    const parsed = parseCLIArgs([
      "quality",
      ".",
      "--agent",
      "claude",
      "--mode",
      "skills",
    ]);
    assert.equal(parsed.qualitySubcommand, "prompt");
    assert.equal(parsed.qualityMode, "skills");
  });

  it("parses bounded quality-save ownership and rejects ambiguous paths", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "goat-flow-quality-save-"));
    try {
      const parsed = parseCLIArgs(["quality", "save", projectRoot]);
      assert.equal(parsed.qualitySubcommand, "save");
      assert.equal(parsed.projectPath, projectRoot);
      assert.throws(
        () => parseCLIArgs(["quality", "save"]),
        /quality save requires exactly one positional project path/i,
      );
      assert.throws(
        () => parseCLIArgs(["quality", "save", projectRoot, "extra"]),
        /quality save requires exactly one positional project path/i,
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects --all on non-quality commands", () => {
    assert.throws(
      () => parseCLIArgs(["audit", ".", "--all"]),
      /only valid for the quality command/i,
    );
  });
});

describe("quality report run dates", () => {
  /** A real leap day remains available to users saving a current quality report. */
  it("accepts a real leap day in a current report", () => {
    const projectRoot = resolve("quality-date-fixture");
    const leapDayReport = parseQualityReport({
      ...currentQualityReport(projectRoot),
      run_date: "2028-02-29",
    });
    assert.equal(leapDayReport.ok, true);
  });

  // Each impossible date gets a named failure before it can enter current history.
  for (const invalidRunDate of INVALID_CURRENT_RUN_DATES) {
    /** The schema error tells the user to repair the calendar date before saving. */
    it(`rejects current run date ${invalidRunDate}`, () => {
      const projectRoot = resolve("quality-date-fixture");
      const invalidReport = parseQualityReport({
        ...currentQualityReport(projectRoot),
        run_date: invalidRunDate,
      });
      assert.deepEqual(invalidReport, {
        ok: false,
        error: "report.run_date must be a real calendar date in YYYY-MM-DD",
      });
    });
  }

  /** Legacy history stays readable even when an old producer emitted an impossible formatted date. */
  it("loads a legacy impossible date without admitting it as a current report", () => {
    const projectRoot = resolve("quality-legacy-date-fixture");
    const impossibleDateReport = {
      ...currentQualityReport(projectRoot),
      run_date: "2026-02-30",
    };

    assert.equal(
      parseQualityReport(impossibleDateReport, {
        requireCurrentFields: false,
      }).ok,
      true,
    );
    assert.equal(parseQualityReport(impossibleDateReport).ok, false);
  });
});

describe("quality save", () => {
  it("redacts, validates, and exclusively writes under the selected project", () => {
    const projectRoot = makeIgnoredQualityRoot();
    try {
      const sensitiveValue = ["fixture", "-credential", "-value"].join("");
      const nestedDetail = [
        "API",
        "_KEY=",
        sensitiveValue,
        "; ",
        JSON.stringify({ password: sensitiveValue }),
      ].join("");
      const result = runQualitySave(
        projectRoot,
        currentQualityReport(projectRoot, nestedDetail),
      );
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(
        result.stdout.trim(),
        /^OK .+\.goat-flow\/logs\/quality\/.+\.json$/u,
      );

      const qualityDir = join(projectRoot, ".goat-flow", "logs", "quality");
      const files = readdirSync(qualityDir);
      assert.equal(files.length, 1);
      assert.match(
        files[0] ?? "",
        /^\d{4}-\d{2}-\d{2}-\d{4}-claude-[a-z0-9]{5}\.json$/u,
      );
      const reportPath = join(qualityDir, files[0] ?? "");
      const stats = lstatSync(reportPath);
      assert.equal(stats.isFile(), true);
      assert.equal(stats.nlink, 1);
      const saved = readFileSync(reportPath, "utf8");
      assert.equal(saved.includes(sensitiveValue), false);
      assert.match(saved, /\[REDACTED:env-value\]/u);
      assert.match(saved, /\[REDACTED:field\]/u);
      assert.equal(JSON.parse(saved).project_path, projectRoot);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("fails closed before creating directories when reports are not ignored", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "goat-flow-quality-save-"));
    try {
      const result = runQualitySave(
        projectRoot,
        currentQualityReport(projectRoot),
      );

      assert.equal(result.status, CLI_USAGE_EXIT_CODE);
      assert.match(result.stderr, /must be gitignored before writing/i);
      assert.equal(readdirSync(projectRoot).includes(".goat-flow"), false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("writes nothing for malformed or wrong-owner reports", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "goat-flow-quality-save-"));
    const otherRoot = mkdtempSync(join(tmpdir(), "goat-flow-quality-owner-"));
    try {
      const malformed = runQualitySave(projectRoot, { invalid: true });
      assert.equal(malformed.status, CLI_USAGE_EXIT_CODE);
      assert.match(malformed.stderr, /quality save: schema error/i);

      const wrongOwner = runQualitySave(
        projectRoot,
        currentQualityReport(otherRoot),
      );
      assert.equal(wrongOwner.status, CLI_USAGE_EXIT_CODE);
      assert.match(wrongOwner.stderr, /project_path.+selected project/i);
      assert.equal(
        readdirSync(projectRoot).includes(".goat-flow"),
        false,
        "validation failures must happen before directory creation",
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(otherRoot, { recursive: true, force: true });
    }
  });

  it("rejects deeply nested invalid input without overflowing the scrubber", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "goat-flow-quality-save-"));
    try {
      const nesting = 15_000;
      const input = `{"unknown":${"[".repeat(nesting)}0${"]".repeat(nesting)}}`;
      const result = runQualitySaveText(projectRoot, input);

      assert.equal(result.status, CLI_USAGE_EXIT_CODE);
      assert.match(result.stderr, /quality save: schema error/i);
      assert.doesNotMatch(result.stderr, /Maximum call stack|RangeError/u);
      assert.equal(readdirSync(projectRoot).includes(".goat-flow"), false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("refuses a redirected quality-report directory", () => {
    const projectRoot = makeIgnoredQualityRoot();
    const redirectRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-quality-redirect-"),
    );
    try {
      symlinkSync(redirectRoot, join(projectRoot, ".goat-flow"));
      const result = runQualitySave(
        projectRoot,
        currentQualityReport(projectRoot),
      );
      assert.equal(result.status, CLI_USAGE_EXIT_CODE);
      assert.match(result.stderr, /must be a real project-local directory/i);
      assert.deepStrictEqual(readdirSync(redirectRoot), []);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(redirectRoot, { recursive: true, force: true });
    }
  });

  /**
   * Preserve both reports when two first saves observe the same missing directory chain.
   * Side effects: writes two local reports and removes the temporary project afterwards.
   * Fixture purpose: the injected creator completes a competing save before the first mkdir resumes.
   */
  it("keeps both valid reports when first-save directory creation races", () => {
    const projectRoot = makeIgnoredQualityRoot();
    let competingReportPath: string | null = null;
    const firstSaveDependencies = {
      CLIError,
      /** Writes the competing report, then retries this directory creation. */
      createReportDirectory(directoryPath: string): void {
        // Example: another dashboard session completes its first save while this user is saving.
        if (competingReportPath === null) {
          competingReportPath = persistQualityReportText(
            {
              projectPath: projectRoot,
              rawText: JSON.stringify(
                currentQualityReport(projectRoot, "Competing session"),
              ),
              sourceLabel: "competing draft",
            },
            { CLIError },
          );
        }
        mkdirSync(directoryPath);
      },
    };

    try {
      const firstReportPath = persistQualityReportText(
        {
          projectPath: projectRoot,
          rawText: JSON.stringify(
            currentQualityReport(projectRoot, "First session"),
          ),
          sourceLabel: "first draft",
        },
        firstSaveDependencies,
      );

      assert.ok(competingReportPath);
      const savedReports = readdirSync(
        join(projectRoot, ".goat-flow", "logs", "quality"),
      ).map((name) => join(projectRoot, ".goat-flow", "logs", "quality", name));
      assert.equal(savedReports.length, 2);
      assert.ok(savedReports.includes(firstReportPath));
      assert.ok(savedReports.includes(competingReportPath));
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  /**
   * Reject a path changed to a file while the user's first report directory is being created.
   * Side effects: writes the unsafe fixture, verifies rejection, then removes the temporary project.
   * Fixture purpose: the injected creator swaps in a file and reproduces an unsafe EEXIST race.
   */
  it("fails closed when a first-save race creates a non-directory", () => {
    const projectRoot = makeIgnoredQualityRoot();
    const unsafeSaveDependencies = {
      CLIError,
      /** Writes a file at the requested folder path to model an unsafe race. */
      createReportDirectory(directoryPath: string): void {
        // Example: an external process replaces the expected folder before the save reaches mkdir.
        writeFileSync(directoryPath, "not a directory");
        mkdirSync(directoryPath);
      },
    };

    try {
      assert.throws(
        () =>
          persistQualityReportText(
            {
              projectPath: projectRoot,
              rawText: JSON.stringify(currentQualityReport(projectRoot)),
              sourceLabel: "racing draft",
            },
            unsafeSaveDependencies,
          ),
        /must be a real project-local directory/u,
      );
      assert.equal(lstatSync(join(projectRoot, ".goat-flow")).isFile(), true);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  /**
   * Fixture purpose: replaces a checked ancestor during a save and proves no report escapes.
   * Filesystem side effects: mutates paths only inside the two temporary fixture roots.
   */
  it("fails closed when a first-save race replaces an existing ancestor", () => {
    const projectRoot = makeIgnoredQualityRoot();
    const outsideRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-quality-outside-"),
    );
    mkdirSync(join(projectRoot, ".goat-flow"));
    let hasSwappedAncestor = false;
    const unsafeSaveDependencies = {
      CLIError,
      /** Renames the checked ancestor, writes a symlink, then creates the requested child. */
      createReportDirectory(directoryPath: string): void {
        if (!hasSwappedAncestor) {
          hasSwappedAncestor = true;
          renameSync(
            join(projectRoot, ".goat-flow"),
            join(projectRoot, ".goat-flow-original"),
          );
          symlinkSync(outsideRoot, join(projectRoot, ".goat-flow"), "dir");
        }
        mkdirSync(directoryPath);
      },
    };

    try {
      assert.throws(
        () =>
          persistQualityReportText(
            {
              projectPath: projectRoot,
              rawText: JSON.stringify(currentQualityReport(projectRoot)),
              sourceLabel: "ancestor-swap draft",
            },
            unsafeSaveDependencies,
          ),
        /must be a real project-local directory/u,
      );
      assert.deepEqual(readdirSync(join(outsideRoot, "logs", "quality")), []);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });
});

describe("skill subcommand parsing", () => {
  it("keeps projectPath at cwd instead of treating 'new' as a path", () => {
    const redLogPath =
      ".goat-flow/logs/sessions/2026-07-17-deploy-checks-tdd.md";
    const parsed = parseCLIArgs([
      "skill",
      "new",
      "I want a workflow for deploy checks",
      "--name",
      "deploy-checks",
      "--red-log",
      redLogPath,
      "--yes",
    ]);
    assert.equal(parsed.command, "skill");
    assert.equal(parsed.skillSubcommand, "new");
    assert.equal(parsed.projectPath, resolve("."));
    assert.equal(
      parsed.skillDescription,
      "I want a workflow for deploy checks",
    );
    assert.equal(parsed.skillRedLogPath, resolve(redLogPath));
  });

  it("parses an explicit project path after skill new", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "goat-flow-skill-cli-"));
    const redLogPath =
      ".goat-flow/logs/sessions/2026-07-17-deploy-checks-tdd.md";
    try {
      const parsed = parseCLIArgs([
        "skill",
        "new",
        projectRoot,
        "I want a workflow for deploy checks",
        "--red-log",
        redLogPath,
      ]);
      assert.equal(parsed.command, "skill");
      assert.equal(parsed.skillSubcommand, "new");
      assert.equal(parsed.projectPath, projectRoot);
      assert.equal(
        parsed.skillDescription,
        "I want a workflow for deploy checks",
      );
      assert.equal(parsed.skillRedLogPath, resolve(projectRoot, redLogPath));
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("parses an explicit project path before skill new", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "goat-flow-skill-cli-"));
    try {
      const parsed = parseCLIArgs([
        "skill",
        projectRoot,
        "new",
        "I want a workflow for deploy checks",
      ]);
      assert.equal(parsed.command, "skill");
      assert.equal(parsed.skillSubcommand, "new");
      assert.equal(parsed.projectPath, projectRoot);
      assert.equal(
        parsed.skillDescription,
        "I want a workflow for deploy checks",
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("parses skill doctor with the shared agent/format flags and a skill filter", () => {
    const parsed = parseCLIArgs([
      "skill",
      "doctor",
      ".",
      "--agent",
      "codex",
      "--skill",
      "goat",
      "--format",
      "json",
    ]);

    assert.equal(parsed.command, "skill");
    assert.equal(parsed.skillSubcommand, "doctor");
    assert.equal(parsed.projectPath, resolve("."));
    assert.equal(parsed.agent, "codex");
    assert.equal(parsed.skillFilter, "goat");
    assert.equal(parsed.format, "json");
  });

  it("parses a project path before skill doctor", () => {
    const parsed = parseCLIArgs(["skill", ".", "doctor"]);

    assert.equal(parsed.skillSubcommand, "doctor");
    assert.equal(parsed.projectPath, resolve("."));
  });

  it("reports a missing skill subcommand after a project path", () => {
    assert.throws(
      () => parseCLIArgs(["skill", "./fixture-project"]),
      (error: unknown) =>
        error instanceof CLIError &&
        error.exitCode === CLI_USAGE_EXIT_CODE &&
        /project path.*missing a subcommand.*new.*doctor/iu.test(error.message),
    );
  });

  it("rejects unsupported agent profiles before skill doctor dispatch", () => {
    assert.throws(
      () => parseCLIArgs(["skill", "doctor", "--agent", "unknown"]),
      /Invalid agent: unknown/i,
    );
  });

  it("keeps skill-new write flags out of the read-only doctor mode", () => {
    assert.throws(
      () => parseCLIArgs(["skill", "doctor", "--yes"]),
      /--yes is only valid for skill new/i,
    );
    assert.throws(
      () => parseCLIArgs(["skill", "new", "description", "--skill", "goat"]),
      /--skill is only valid for skill doctor/i,
    );
  });
});

describe("quality candidacy draft naming", () => {
  it("uses the platform path basename instead of POSIX-only splitting", () => {
    const qualityCommandSource = readFileSync(
      resolve(
        import.meta.dirname,
        "..",
        "..",
        "src",
        "cli",
        "quality",
        "quality-command.ts",
      ),
      "utf-8",
    );
    assert.match(qualityCommandSource, /basename\(path\)\.replace/);
    assert.doesNotMatch(qualityCommandSource, /path\.split\("\/"\)/);
  });
});
