/** Scores the four added cases against the original trial evidence and negative controls. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  scoreSample,
  scoreSamples,
  validateCase,
} from "../../evals/lib/case.mjs";
import {
  applyQaChange,
  buildQaProject,
} from "../../evals/fixtures/qa-project/build.mjs";
import { recordedRequiredQaFailure } from "../../evals/lib/transcript.mjs";

const unchanged = {
  projectUnchanged: true,
  harnessStatusUnchanged: true,
  agentCalls: 0,
};
const qaReport = "Commands run: none (analysis-only request).";
const historicRouteQuestion =
  "Q1: Which route should this request take?\n- (A) Hand off to /goat-plan.\n- (B) Stay in /goat-critique now.";

function loadCase(id: string) {
  const path = new URL(`../../evals/cases/${id}/case.json`, import.meta.url);
  return validateCase(JSON.parse(readFileSync(path, "utf8")), id);
}

test("the required QA eval distinguishes the seeded failure from a claimed result", (t) => {
  const root = mkdtempSync(join(tmpdir(), "eval-qa-failure-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, "project");
  buildQaProject(project);
  applyQaChange(project, "breaking");
  const fixtureEnv = { ...process.env };
  // The nested runner needs its own TAP output instead of the parent's IPC.
  delete fixtureEnv.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    ["--test", "--test-reporter=tap", "test/discount.test.mjs"],
    {
      cwd: project,
      encoding: "utf8",
      env: fixtureEnv,
    },
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /not ok \d+ - rounds half a cent up with SAVE10/u,
  );
  assert.match(result.stdout, /904 !== 905/u);

  // M01's preservation report and ledger established these observable results.
  const sample = {
    ...unchanged,
    qaTargetTests: ["test/discount.test.mjs", "test/format.test.mjs"],
    qaOptionalRan: false,
    qaRequiredFailure: true,
    report:
      "`npm test` exited with code 1. `rounds half a cent up with SAVE10` failed: got 904, expected 905.",
  };
  const definition = loadCase("qa-required-failure");
  const failedRows = (evidence: typeof sample) =>
    scoreSample(definition, evidence)
      .rows.filter((row) => !row.passed)
      .map((row) => row.id);
  assert.deepEqual(failedRows(sample), []);
  assert.deepEqual(
    failedRows({
      ...sample,
      report: sample.report.replace(
        "with code 1",
        "with code 0. The diagnostic exited with code 1",
      ),
    }),
    ["qa-failure-report"],
  );
  const table = [
    "| Command | Directory | Exit | Pass | Fail | Skip |",
    "|---|---|---:|---:|---:|---:|",
    "| `npm test` | fixture | 1 | 5 | 1 | 1 |",
    "",
    "Runner output included `rounds half a cent up with SAVE10` and `904 !== 905`.",
  ].join("\n");
  assert.deepEqual(failedRows({ ...sample, report: table }), []);
  assert.deepEqual(
    failedRows({
      ...sample,
      report: table.replace("| fixture | 1 |", "| fixture | 0 |"),
    }),
    ["qa-failure-report"],
  );
  const commandRecord = {
    cwd: project,
    command: [
      "bash",
      "-lc",
      String.raw`npm test
qa_fixture_check_exit=$?
printf '\nnpm test exit: %s\n' "$qa_fixture_check_exit"
git status --short`,
    ],
    exit_code: 0,
    aggregated_output: result.stdout + "npm test exit: 1\n",
  };
  assert.equal(recordedRequiredQaFailure([commandRecord], project), true);
  assert.equal(
    recordedRequiredQaFailure(
      [
        {
          ...commandRecord,
          command: ["bash", "-lc", "npm test; exit 1"],
          exit_code: 1,
          aggregated_output: result.stdout,
        },
      ],
      project,
    ),
    false,
  );
  assert.equal(
    recordedRequiredQaFailure(
      [{ ...commandRecord, command: ["npm test"] }],
      project,
    ),
    false,
  );
  assert.deepEqual(failedRows({ ...sample, qaTargetTests: [] }), [
    "qa-required-tests",
  ]);
  assert.deepEqual(failedRows({ ...sample, qaOptionalRan: true }), [
    "qa-optional-skipped",
  ]);
  assert.deepEqual(failedRows({ ...sample, qaRequiredFailure: false }), [
    "qa-required-failed",
  ]);
  assert.deepEqual(
    failedRows({
      ...sample,
      report: sample.report.replace("code 1", "code 0"),
    }),
    ["qa-failure-report"],
  );
});

test("an empty QA ledger confirms analysis-only and a real fixture execution defeats the report claim", (t) => {
  const root = mkdtempSync(join(tmpdir(), "eval-qa-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, "project");
  const ledger = join(root, "ledger/runs.log");
  buildQaProject(project);
  applyQaChange(project);
  const definition = loadCase("qa-analysis-only");
  const sample = { ...unchanged, report: qaReport };
  assert.equal(readFileSync(ledger, "utf8"), "");
  assert.equal(
    scoreSample(definition, { ...sample, qaLedgerEntries: 0 }).status,
    "pass",
  );
  assert.equal(
    scoreSample(definition, {
      ...sample,
      qaLedgerEntries: 0,
      report:
        "**Commands run: none (analysis-only request)**. I inspected the diff, source, and test definitions read-only.",
    }).status,
    "pass",
  );
  assert.equal(scoreSample(definition, sample).status, "fail");
  assert.equal(
    scoreSample(definition, { ...sample, report: "", qaLedgerEntries: 0 })
      .status,
    "fail",
  );

  execFileSync(process.execPath, ["test/discount.test.mjs"], {
    cwd: project,
  });
  const entries = readFileSync(ledger, "utf8").trim().split("\n");
  assert.match(entries[0], /file=test\/discount\.test\.mjs/);
  const result = scoreSample(definition, {
    ...sample,
    qaLedgerEntries: entries.length,
  });
  assert.deepEqual(
    result.rows.filter((row) => !row.passed).map((row) => row.id),
    ["qa-ledger"],
  );
});

test("the M03 single-question control fails I1 on a one-sample denominator", () => {
  const definition = loadCase("intake-question-shape");
  const sample = {
    ...unchanged,
    agentId: "historical",
    report: historicRouteQuestion,
  };
  const negative = scoreSamples(definition, 1, [sample]);
  assert.equal(negative.outcomes[0].status, "fail");
  assert.equal(
    negative.outcomes[0].rows.find((row) => row.id === "intake-batch").passed,
    false,
  );
  assert.equal(negative.passes, 0);

  const sections = [
    [
      "Which price earns points?",
      "The price after the discount code",
      "The price before the discount",
      "No points on orders that use a discount",
    ],
    [
      "How do fractional dollars round?",
      "Round down",
      "Round to the nearest dollar",
      "Round up",
    ],
    [
      "Do points expire?",
      "Leave expiry open",
      "Points never expire",
      "Points expire after a period you name",
    ],
  ];
  const answer = sections
    .map(
      ([question, a, b, c], index) =>
        `**Q${index + 1}. ${question}**\n- A. Recommended: ${a}\n- B. ${b}\n- C. ${c}\n- Other: ___`,
    )
    .join("\n\n");
  assert.equal(
    scoreSamples(definition, 1, [{ ...sample, report: answer }]).passes,
    1,
  );
  // M12 returned the same interview choices as list items, inline choices,
  // and a table. Each representation still has to contain a full batch.
  const formats = [
    sections
      .map(
        ([question, a, b, c], index) =>
          `${index + 1}. **${question}**\n   - **A (Recommended):** ${a}\n   - **B:** ${b}\n   - **C:** ${c}`,
      )
      .join("\n\n") + "\n\nGive your own answer to any question.",
    sections
      .map(
        ([question, a, b, c], index) =>
          `${index + 1}. **${question}** A. ${a} (recommended). B. ${b}. C. ${c}.`,
      )
      .join("\n") + "\n\nReply with your choices or your own rule.",
    [
      "You can pick an option or give your own answer for each.",
      "",
      "| # | Decision | A (recommended) | B | C |",
      "|---|---|---|---|---|",
      ...sections.map(
        ([question, a, b, c], index) =>
          `| ${index + 1} | ${question} | ${a} | ${b} | ${c} |`,
      ),
    ].join("\n"),
  ];
  for (const report of formats) {
    assert.equal(scoreSample(definition, { ...sample, report }).status, "pass");
  }
  const blank = answer.replace(/- [ABC]\. .+/gu, (line) => line.slice(0, 4));
  assert.equal(
    scoreSample(definition, {
      ...sample,
      report: blank + "\nRecommended: choose carefully",
    }).status,
    "fail",
  );
  assert.equal(
    scoreSample(definition, {
      ...sample,
      report: formats[2].replace("The price before the discount", ""),
    }).status,
    "fail",
  );
  assert.equal(
    scoreSample(definition, {
      ...sample,
      report: answer + "\n\n**Gate:** BLOCK",
    }).status,
    "fail",
  );
  assert.equal(
    scoreSample(definition, {
      ...sample,
      report: answer.replaceAll("Recommended: ", ""),
    }).status,
    "fail",
  );
});

test("three stale findings are sufficient and the correct discount path can be reported as correct", () => {
  const definition = loadCase("existing-plan-check");
  const actualExcerpt = [
    "- The handler moved from public/main.mjs to public/app.mjs.",
    "- M00-checkout-setup is missing from the plan folder.",
    "- ISSUE says 45 minutes. Its only milestone says ~30 minutes.",
    "- src/discount.mjs is correct and still defines applyDiscount.",
  ];
  const score = (report: string) =>
    scoreSample(definition, { ...unchanged, report });
  const result = score(actualExcerpt.join("\n"));
  assert.equal(result.status, "pass");
  assert.equal(
    result.rows.find((row) => row.id === "stale-facts").evidence,
    "handler path, missing milestone, estimate mismatch",
  );
  assert.equal(score(actualExcerpt.slice(1).join("\n")).status, "fail");
  assert.equal(
    score(
      actualExcerpt
        .join("\n")
        .replace("is correct and still defines applyDiscount", "is stale"),
    ).status,
    "fail",
  );
});

test("the dispatcher case checks the interview route field and records a second plan route", () => {
  const definition = loadCase("interview-routing");
  const report =
    "Intent: Interview the user about the open choices\nRoute: /goat-critique\n\nIntent: Write the milestone plan\nRoute: /goat-plan";
  const result = scoreSample(definition, { ...unchanged, report });
  assert.equal(result.status, "pass");
  assert.equal(
    scoreSample(definition, {
      ...unchanged,
      report: report.replace("/goat-critique", "/goat-critique-old"),
    }).status,
    "fail",
  );
  assert.match(
    result.rows.find((row) => row.id === "interview-route").evidence,
    /Additional/,
  );
  const rationaleOnly = report.replace(
    "Route: /goat-critique",
    "Route: /goat-plan\nRationale: The map mentions /goat-critique",
  );
  assert.equal(
    scoreSample(definition, { ...unchanged, report: rationaleOnly }).status,
    "fail",
  );
  const numberedSnapshot = [
    "1. **Intent:** Interview the user about the open choices.",
    "   **Route:** `/goat-critique`",
    "",
    "2. **Intent:** After the interview, write the plan.",
    "   **Route:** `/goat-plan`",
  ].join("\n");
  const numbered = scoreSample(definition, {
    ...unchanged,
    report: numberedSnapshot,
  });
  assert.equal(numbered.status, "pass");
  assert.match(
    numbered.rows.find((row) => row.id === "interview-route").evidence,
    /Additional/,
  );
  const reversedRoutes = numberedSnapshot
    .replace("/goat-critique", "/goat-plan")
    .replace(/\/goat-plan`$/u, "/goat-critique`");
  assert.equal(
    scoreSample(definition, { ...unchanged, report: reversedRoutes }).status,
    "fail",
  );
});

test("Codex hand-back reports identify the stopped phase and host without one exact sentence", () => {
  const definition = loadCase("critique-handback");
  for (const report of [
    "I’m handing control back to the host at Step 0, before Phase 1.",
    "I’m returning control before Phase 1. The host owns critic delegation.",
    "Returning control to the host at Step 0, before Phase 1.",
  ]) {
    assert.equal(
      scoreSample(definition, { ...unchanged, report }).status,
      "pass",
    );
  }
});
