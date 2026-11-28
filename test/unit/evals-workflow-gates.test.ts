/** Checks scorer inputs for the two saved workflow gate cases. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { blockedMilestonePath } from "../../evals/fixtures/milestone-order/build.mjs";
import {
  applyQaChange,
  buildQaProject,
} from "../../evals/fixtures/qa-project/build.mjs";
import { scoreSample, validateCase } from "../../evals/lib/case.mjs";
import {
  recordedMilestoneTimerStart,
  recordedRequiredQaFailure,
} from "../../evals/lib/transcript.mjs";

// Labelled command records exercise scoring without running a model.
const project = resolve("synthetic-eval-project");
const unchanged = { projectUnchanged: true, harnessStatusUnchanged: true };

/** Reads the production case so negative controls exercise its actual rows. */
function loadCase(id: string) {
  const path = new URL(`../../evals/cases/${id}/case.json`, import.meta.url);
  return validateCase(JSON.parse(readFileSync(path, "utf8")), id);
}

// The QA fixture has an external ledger, so diagnosis needs its own setup option.
test("the debug fixture reproduces the failure without writing the QA trial ledger", (t) => {
  const sample = mkdtempSync(join(tmpdir(), "eval-debug-gate-"));
  t.after(() => rmSync(sample, { recursive: true, force: true }));
  const fixtureProject = join(sample, "project");
  buildQaProject(fixtureProject, { shouldRecordTestLoads: false });
  applyQaChange(fixtureProject, "breaking");
  const fixtureEnv = { ...process.env };
  // A separate test context emits TAP instead of the parent test runner's IPC.
  delete fixtureEnv.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    ["--test", "--test-reporter=tap"],
    {
      cwd: fixtureProject,
      env: fixtureEnv,
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /904 !== 905/u);
  assert.equal(readFileSync(join(sample, "ledger", "runs.log"), "utf8"), "");
});

test("the debug eval requires a recorded reproduction with the expected cents", () => {
  const definition = loadCase("debug-rounding-gate");
  const failure = {
    cwd: project,
    command: ["bash", "-lc", "npm test"],
    exit_code: 1,
    aggregated_output:
      "not ok 2 - rounds half a cent up with SAVE10\n    904 !== 905\n",
  };
  // Keep the claimed result fixed and vary only the observed command.
  const score = (commands: (typeof failure)[]) =>
    scoreSample(definition, {
      ...unchanged,
      report: "I ran npm test and observed 904 instead of 905.",
      qaRequiredFailure: recordedRequiredQaFailure(
        commands,
        project,
        "904 !== 905",
      ),
    });

  assert.equal(score([failure]).status, "pass");
  assert.equal(
    score([
      {
        ...failure,
        command: ["bash", "-lc", "npm_config_logs_max=0 npm test"],
      },
    ]).status,
    "pass",
  );
  assert.equal(
    score([]).rows.find(({ id }) => id === "qa-required-failed")?.passed,
    false,
  );
  assert.equal(
    score([
      {
        ...failure,
        aggregated_output: failure.aggregated_output.replace("904", "903"),
      },
    ]).status,
    "fail",
  );
  assert.equal(
    score([{ ...failure, cwd: join(project, "other") }]).status,
    "fail",
  );
});

test("a correct planning answer fails if a timer start targeted blocked M02", () => {
  const definition = loadCase("plan-blocked-milestone");
  const milestone = join(project, blockedMilestonePath);
  // A correct final answer cannot override a recorded attempt to start the timer.
  const score = (command: string) =>
    scoreSample(definition, {
      ...unchanged,
      report: "M02 is blocked because prerequisite M03 is incomplete.",
      blockedStartAttempted: recordedMilestoneTimerStart(
        [{ command: ["bash", "-lc", command], cwd: project, exit_code: 1 }],
        milestone,
      ),
    });

  assert.equal(
    score("goat-flow plans check .goat-flow/plans/dependency-order --strict")
      .status,
    "pass",
  );
  assert.equal(
    score(`goat-flow plans time start ${blockedMilestonePath}`).status,
    "fail",
  );
  assert.equal(
    score(
      `git status && node --import tsx /host/src/cli/cli.ts plans time start '${milestone}' --category product`,
    ).status,
    "fail",
  );
  assert.equal(
    score(
      `goat-flow plans time start ${blockedMilestonePath.replace(/M02-publish-report/u, "M03-check-results")}`,
    ).status,
    "pass",
  );
});
