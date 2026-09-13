/**
 * Exercise review command intake from the caller's working directory.
 * Saved input and selected project are separate paths, while an expected version guards the controlling CLI.
 *
 * Temporary projects let usage failures be checked before any report or stdin is consumed.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  symlinkSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { parseCLIArgs } from "../../src/cli/cli-parser.js";
import { CLIError } from "../../src/cli/cli-error.js";
import { getPackageVersion } from "../../src/cli/paths.js";
import {
  canonicalReviewJson,
  captureReviewSnapshot,
} from "../../src/cli/review-validate-authority.js";
import {
  CLI_PATH,
  createReviewedProject,
  validReview,
  cleanReview,
  fullCleanReview,
  createVersionedReviewedProject,
  withReviewSource,
  withIntegrityFields,
  reviewReportTemplate,
} from "./review-validate.helpers.js";

/** Run the controlling source CLI from another directory; empty input deliberately provides no report evidence. */
function reviewCli(cwd: string, args: string[], input = "") {
  return spawnSync(
    process.execPath,
    ["--import", import.meta.resolve("tsx"), CLI_PATH, ...args],
    {
      cwd,
      input,
      encoding: "utf8",
      timeout: 15000,
    },
  );
}

describe("review project and version options", () => {
  it("resolves input from cwd and keeps reviewed evidence separate", () => {
    const request = parseCLIArgs([
      "review",
      "validate",
      "report.md",
      "--project",
      "target",
      "--expected-version",
      getPackageVersion(),
    ]);
    assert.equal(request.reviewValidatePath, resolve("report.md"));
    assert.equal(request.projectPath, resolve("target"));
    assert.equal(request.reviewExpectedVersion, getPackageVersion());
    assert.equal(
      parseCLIArgs(["review", "validate"]).projectPath,
      process.cwd(),
    );
    assert.equal(parseCLIArgs(["review", "validate"]).reviewValidatePath, null);
  });

  it("rejects ambiguous options and unsupported placements with usage exit 2", () => {
    const invalid = [
      ["review", "validate", "--project"],
      ["review", "validate", "--project", ""],
      ["review", "validate", "--project", ".", "--project", "."],
      ["review", "validate", "--expected-version"],
      ["review", "validate", "--expected-version", ""],
      [
        "review",
        "validate",
        "--expected-version",
        "1.17.0",
        "--expected-version",
        "1.17.0",
      ],
      ["review", "validate", "one.md", "two.md"],
      ["review", "validate-ledger", "--project", "."],
      ["audit", ".", "--project", "."],
      ["audit", ".", "--expected-version", "1.17.0"],
    ];
    // Every rejected request must fail at intake rather than reading an unintended report or project.
    for (const args of invalid)
      assert.throws(
        () => parseCLIArgs(args),
        (error: unknown) => error instanceof CLIError && error.exitCode === 2,
        args.join(" "),
      );
  });

  it("checks exact caller versions before input for every review operation", (test) => {
    const cwd = createReviewedProject(test);
    // Malformed and stale stamps both identify expected and actual versions before the missing file can be opened.
    for (const operation of [
      "snapshot",
      "validate",
      "validate-draft",
      "validate-ledger",
    ])
      // Both an older installed version and an invalid version string must fail before reading the supplied report.
      for (const expected of ["1.16.0", "not-a-version"]) {
        const result = reviewCli(cwd, [
          "review",
          operation,
          "missing.md",
          "--expected-version",
          expected,
        ]);
        assert.equal(result.status, 2, result.stderr);
        assert.match(result.stderr, /version mismatch/);
        assert.ok(result.stderr.includes(expected));
        assert.ok(result.stderr.includes(getPackageVersion()));
        assert.doesNotMatch(result.stderr, /Cannot read review input/);
      }
  });

  it("captures the selected project through a canonical directory while reading a relative request", (test) => {
    const cwd = createReviewedProject(test);
    const project = createReviewedProject(test);
    writeFileSync(
      join(project, "src/example.ts"),
      "export const selectedProject = true;\n",
    );
    const alias = join(cwd, "selected-project");
    symlinkSync(project, alias, "dir");
    const input = JSON.stringify({
      schema: "goat-review-request/v1",
      source: {
        kind: "paths",
        paths: [{ path: "src/example.ts", from: "live" }],
      },
    });
    writeFileSync(join(cwd, "request.json"), input);
    const result = reviewCli(cwd, [
      "review",
      "snapshot",
      "request.json",
      "--project",
      alias,
      "--expected-version",
      getPackageVersion(),
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout.trim(),
      canonicalReviewJson(captureReviewSnapshot(input, project)),
    );
  });

  it("refuses missing or non-directory projects and preserves informational commands", (test) => {
    const cwd = createReviewedProject(test);
    writeFileSync(join(cwd, "file"), "not a project");
    // A mistyped evidence root must not fall back to the directory containing the saved report.
    for (const project of ["missing", "file"]) {
      const result = reviewCli(cwd, [
        "review",
        "validate",
        "missing.md",
        "--project",
        project,
      ]);
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /Cannot open reviewed project/);
    }
    mkdirSync(join(cwd, "empty"));
    // Help and version remain readable before a project has been created or configured.
    for (const flag of ["--help", "--version"]) {
      const result = reviewCli(cwd, ["review", flag, "--project", "missing"]);
      assert.equal(result.status, 0, result.stderr);
    }
  });
});

describe("review validate CLI", () => {
  it("parses stdin-first and optional-file forms from the reviewed-project cwd", () => {
    const stdinForm = parseCLIArgs(["review", "validate"]);
    assert.equal(stdinForm.command, "review");
    assert.equal(stdinForm.reviewSubcommand, "validate");
    assert.equal(stdinForm.reviewValidatePath, null);
    assert.equal(stdinForm.projectPath, resolve("."));

    const fileForm = parseCLIArgs(["review", "validate", "saved-review.md"]);
    assert.equal(fileForm.reviewValidatePath, resolve("saved-review.md"));
    assert.equal(fileForm.projectPath, resolve("."));

    assert.equal(
      parseCLIArgs(["review", "validate-draft"]).reviewSubcommand,
      "validate-draft",
    );
    assert.equal(
      parseCLIArgs(["review", "validate-ledger"]).reviewSubcommand,
      "validate-ledger",
    );
  });

  it("rejects missing, unknown, and extra review positionals", () => {
    assert.throws(
      () => parseCLIArgs(["review"]),
      /requires subcommand "snapshot"/iu,
    );
    assert.throws(
      () => parseCLIArgs(["review", "check"]),
      /requires subcommand/iu,
    );
    assert.throws(
      () => parseCLIArgs(["review", "validate", "one.md", "two.md"]),
      /at most one \[report-file\]/iu,
    );
    assert.throws(
      () => parseCLIArgs(["review", "validate-draft", "one.md", "two.md"]),
      /at most one \[draft-envelope-file\]/iu,
    );
  });

  it("validates ledger grammar and a complete report draft before persistence", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const ledgerPath =
      ".goat-flow/logs/review/goat-review-refutations.not-written.txt";
    const rawLedger = `- R-005 | Suspicion: missing guard | Evidence: caller rejects empty values | Rationale: the guard removes reachability
- R-006 | Suspicion: missing fallback | Evidence: caller supplies a default | Rationale: the fallback removes reachability
`;

    const ledger = reviewCli(
      projectRoot,
      ["review", "validate-ledger"],
      rawLedger,
    );
    assert.equal(ledger.status, 0, ledger.stderr);
    assert.match(ledger.stdout, /review validate-ledger: PASS \(2 records\)/u);

    const report = validReview(
      projectRoot,
      "src/example.ts",
      "loadConfig",
      2,
      ledgerPath,
    )
      .replace("bundle.fixture.diff", "bundle.draft.diff")
      .replace("- Review validator: validated", "- Review validator: pending");
    const draftEnvelope = `${report}<!-- goat-flow-review-ledger-draft -->\n${rawLedger}`;

    const draft = reviewCli(
      projectRoot,
      ["review", "validate-draft"],
      draftEnvelope,
    );
    assert.equal(draft.status, 0, draft.stderr);
    assert.match(draft.stdout, /review validate-draft: PASS/u);
    assert.match(draft.stdout, /persistence unverified/iu);

    const mismatchedEnvelope = `${validReview(
      projectRoot,
      "src/example.ts",
      "loadConfig",
      1,
      ledgerPath,
    ).replace(
      "- Review validator: validated",
      "- Review validator: pending",
    )}<!-- goat-flow-review-ledger-draft -->\n${rawLedger}`;
    const mismatched = reviewCli(
      projectRoot,
      ["review", "validate-draft"],
      mismatchedEnvelope,
    );
    assert.equal(mismatched.status, 1, mismatched.stderr);
    assert.match(mismatched.stdout, /2 records.+claims 1/iu);

    const missingAppendix = reviewCli(
      projectRoot,
      ["review", "validate-draft"],
      report,
    );
    assert.equal(missingAppendix.status, 1, missingAppendix.stderr);
    assert.match(
      missingAppendix.stdout,
      /nonzero refutations require.+goat-flow-review-ledger-draft/iu,
    );

    const prematureValidated = reviewCli(
      projectRoot,
      ["review", "validate-draft"],
      draftEnvelope.replace(
        "- Review validator: pending",
        "- Review validator: validated",
      ),
    );
    assert.equal(prematureValidated.status, 1, prematureValidated.stderr);
    assert.match(prematureValidated.stdout, /pending.+final validation/iu);

    const duplicateMarker = reviewCli(
      projectRoot,
      ["review", "validate-draft"],
      `${draftEnvelope}<!-- goat-flow-review-ledger-draft -->\n${rawLedger}`,
    );
    assert.equal(duplicateMarker.status, 1, duplicateMarker.stderr);
    assert.match(duplicateMarker.stdout, /exactly one ledger marker/iu);

    const zeroRefutationDraft = validReview(
      projectRoot,
      "src/example.ts",
      "loadConfig",
    )
      .replace("bundle.fixture.diff", "bundle.draft.diff")
      .replace("- Review validator: validated", "- Review validator: pending");
    const zeroRefutations = reviewCli(
      projectRoot,
      ["review", "validate-draft"],
      zeroRefutationDraft,
    );
    assert.equal(zeroRefutations.status, 0, zeroRefutations.stderr);

    const unexpectedAppendix = reviewCli(
      projectRoot,
      ["review", "validate-draft"],
      `${zeroRefutationDraft}<!-- goat-flow-review-ledger-draft -->\n${rawLedger}`,
    );
    assert.equal(unexpectedAppendix.status, 1, unexpectedAppendix.stderr);
    assert.match(
      unexpectedAppendix.stdout,
      /zero refutations must not include.+appendix/iu,
    );

    const final = reviewCli(
      projectRoot,
      ["review", "validate"],
      report.replace(
        "- Review validator: pending",
        "- Review validator: validated",
      ),
    );
    assert.equal(final.status, 1, final.stderr);
    assert.match(final.stdout, /declared receipt is absent/u);

    const invalidLedger = reviewCli(
      projectRoot,
      ["review", "validate-ledger"],
      "not a record\n",
    );
    assert.equal(invalidLedger.status, 1, invalidLedger.stderr);
    assert.match(invalidLedger.stdout, /does not match.+one-line grammar/iu);
  });

  it("accepts review help without a report and validates stdin end to end", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const help = reviewCli(projectRoot, ["review", "--help"], "");
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /review validate \[report-file\]/u);
    assert.match(help.stdout, /review validate-draft \[draft-envelope-file\]/u);
    assert.match(help.stdout, /review validate-ledger \[ledger-file\]/u);
    assert.match(help.stdout, /Structural failures exit 1/iu);
    assert.match(help.stdout, /advisory warnings.*exit 0/iu);
    assert.match(help.stdout, /capture refusals exit 2/iu);

    const report = validReview(projectRoot, "src/example.ts", "loadConfig");
    const valid = reviewCli(projectRoot, ["review", "validate"], report);
    assert.equal(valid.status, 0, valid.stderr);
    assert.match(valid.stdout, /review validate: PASS/u);
  });

  it("exits one and reports each stdin violation", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const report = validReview(
      projectRoot,
      "src/example.ts",
      "missingReviewValidatorAnchor",
    ).replace(" | Harm: requests use an invalid configuration.", "");
    const invalid = reviewCli(projectRoot, ["review", "validate"], report);
    assert.equal(invalid.status, 1, invalid.stderr);
    assert.match(invalid.stdout, /\[V1\/anchor-unresolved\]/u);
    assert.match(invalid.stdout, /\[V3\/finding-harm\]/u);
  });

  it("keeps warning-only CLI results at exit zero", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const report =
      validReview(projectRoot, "src/example.ts", "loadConfig") +
      "\n## Breaking Changes\n";
    const warned = reviewCli(projectRoot, ["review", "validate"], report);
    assert.equal(warned.status, 0, warned.stderr);
    assert.match(warned.stdout, /review validate: PASS \(1 warning\)/u);
    assert.match(warned.stdout, /\[V7\/optional-section-empty\]/u);
  });

  // Covers writing validation output through --output: writes the file and expects its contents to match.
  it("writes validation output through --output", (testContext) => {
    const projectRoot = createReviewedProject(testContext);
    const outputRoot = mkdtempSync(join(tmpdir(), "goat-flow-review-output-"));
    testContext.after(() =>
      rmSync(outputRoot, { recursive: true, force: true }),
    );
    const outputPath = join(outputRoot, "validation.txt");
    const report = validReview(projectRoot, "src/example.ts", "loadConfig");
    const result = reviewCli(
      projectRoot,
      ["review", "validate", "--output", outputPath],
      report,
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(readFileSync(outputPath, "utf-8"), /review validate: PASS/u);
  });
});

describe("saved review project selection", () => {
  it("validates saved reports and drafts from another cwd without moving the input operand", (test) => {
    const root = createReviewedProject(test);
    const caller = createReviewedProject(test);
    const compact = cleanReview(root);
    const reportPath = join(caller, "report.md");
    writeFileSync(reportPath, compact);
    /** Run a saved-report check from the chosen directory to expose confusion between input and reviewed-project paths. */
    const runReviewFromDirectory = (cwd: string, args: string[]) =>
      reviewCli(cwd, ["review", ...args], "");
    const selected = runReviewFromDirectory(caller, [
      "validate",
      "report.md",
      "--project",
      root,
      "--expected-version",
      getPackageVersion(),
    ]);
    assert.equal(selected.status, 0, selected.stdout + selected.stderr);
    assert.match(selected.stdout, /review validate: PASS/u);
    const legacy = runReviewFromDirectory(root, ["validate", reportPath]);
    assert.equal(legacy.status, 0, legacy.stdout + legacy.stderr);
    const wrong = runReviewFromDirectory(caller, ["validate", "report.md"]);
    assert.equal(wrong.status, 1, wrong.stdout + wrong.stderr);
    assert.match(wrong.stdout, /authority-/u);
    const draftPath = join(caller, "draft.md");
    writeFileSync(
      draftPath,
      compact
        .replace("validator=validated", "validator=pending")
        .replace("bundle.fixture.diff", "bundle.future.diff"),
    );
    const draft = runReviewFromDirectory(caller, [
      "validate-draft",
      "draft.md",
      "--project",
      root,
      "--expected-version",
      getPackageVersion(),
    ]);
    assert.equal(draft.status, 0, draft.stdout + draft.stderr);
    assert.match(draft.stdout, /persistence unverified/u);
    assert.equal(
      existsSync(
        join(root, ".goat-flow/logs/review/goat-review-bundle.future.diff"),
      ),
      false,
    );
  });
});

describe("review CLI metadata boundaries", () => {
  // Real PR objects prove that finding labels, provenance totals, and CLI exit status stay tied to the same report.
  it("counts one provenance class per finding and ignores labels mentioned in PR prose", (test) => {
    const { projectRoot, base, head } = createVersionedReviewedProject(test);
    const control = withIntegrityFields(
      withReviewSource(
        reviewReportTemplate("src/example.ts", "committedAnchor"),
        projectRoot,
        { kind: "pr", target: base, head },
      ),
      {
        "Automated-review provenance":
          "overlap-confirmed=0, local-only=4, bot-only-locally-verified=0, disputed-match=0; automated findings the local review missed: none; local findings every bot missed: R-001, R-002, R-003, R-004",
      },
    );
    const baseline = reviewCli(projectRoot, ["review", "validate"], control);
    assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
    const conflicting = control
      .replace(
        "[SHOULD:patch] [local-only]",
        "[SHOULD:patch] [local-only] [overlap-confirmed:reviewer]",
      )
      .replace("overlap-confirmed=0", "overlap-confirmed=1");
    const refused = reviewCli(projectRoot, ["review", "validate"], conflicting);
    assert.equal(refused.status, 1, refused.stdout + refused.stderr);
    assert.match(refused.stdout, /exactly one class per active finding/u);
    const sameClass = control
      .replace(
        "[SHOULD:patch] [local-only]",
        "[SHOULD:patch] [overlap-confirmed:first] [overlap-confirmed:second]",
      )
      .replace(
        "overlap-confirmed=0, local-only=4",
        "overlap-confirmed=1, local-only=3",
      )
      .replace(
        "local findings every bot missed: R-001, ",
        "local findings every bot missed: ",
      );
    // Several bots may confirm one concern; a label discussed after the title still contributes no provenance credit.
    for (const report of [
      sameClass,
      control.replace(
        "The loader accepts an empty value.",
        "The loader accepts an empty value; [overlap-confirmed:reviewer] is explanatory prose.",
      ),
    ]) {
      const accepted = reviewCli(projectRoot, ["review", "validate"], report);
      assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
    }
  });

  it("keeps local explanations from claiming bot or refuter participation", (test) => {
    const root = createReviewedProject(test);
    const control = validReview(root)
      .replace(/^- Refuter (?:pass|outcomes):.*\n/gmu, "")
      .replace(" [CONFIRMED-CROSS-MODEL]", "");
    const baseline = reviewCli(root, ["review", "validate"], control);
    assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
    // Discussing a classification in the explanation does not declare it on the finding or create a refuter run.
    for (const tag of [
      "[overlap-confirmed:reviewer]",
      "[CONFIRMED-CROSS-MODEL]",
    ]) {
      const report = control.replace(
        "The loader accepts an empty value.",
        "The loader accepts an empty value; " + tag + " is explanatory prose.",
      );
      const result = reviewCli(root, ["review", "validate"], report);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
  });

  it("rejects explicit null maps while accepting omitted or empty maps in both report forms", (test) => {
    const root = createReviewedProject(test);
    const compact = cleanReview(root);
    // Both presentations share the map contract, including the legitimate no-entry state.
    for (const report of [compact, fullCleanReview(compact)]) {
      const omitted = reviewCli(root, ["review", "validate"], report);
      assert.equal(omitted.status, 0, omitted.stdout + omitted.stderr);
      const empty = reviewCli(
        root,
        ["review", "validate"],
        withIntegrityFields(report, {
          "Gate findings": "{}",
          "Refuter outcomes": "{}",
        }),
      );
      assert.equal(empty.status, 0, empty.stdout + empty.stderr);
      // Null explicitly supplies the wrong JSON type; it cannot stand in for an omitted optional map.
      for (const field of ["Gate findings", "Refuter outcomes"]) {
        const result = reviewCli(
          root,
          ["review", "validate"],
          withIntegrityFields(report, { [field]: "null" }),
        );
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.ok(
          result.stdout.includes(field + " must be an object"),
          result.stdout,
        );
      }
    }
  });
});
