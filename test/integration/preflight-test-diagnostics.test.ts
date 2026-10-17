/**
 * Checks preflight failure details and isolated parallel-worker reporting.
 *
 * Recorded TAP and Windows output exercise the production summary without another full-suite run.
 * Disposable projects isolate diagnostics; a missing counter must never become a fabricated zero.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, it } from "node:test";
const PREFLIGHT_SCRIPT_PATH = resolve(
  import.meta.dirname,
  "../../scripts/preflight-checks.sh",
);
const PROJECT_ROOT = resolve(import.meta.dirname, "../..");
const fixtureProcessIds = new Set<number>();
const fixtureTemporaryDirectories = new Set<string>();
afterEach(() => {
  for (const pid of fixtureProcessIds) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
  fixtureProcessIds.clear();
  for (const directory of fixtureTemporaryDirectories)
    rmSync(directory, { recursive: true, force: true });
  fixtureTemporaryDirectories.clear();
});

describe("preflight Tests failure details", () => {
  // Minimized recorded TAP retains the inherited npm-prefix error and one stack frame that the user-facing summary must omit.
  const capturedPrefixFailureLines = [
    "TAP version 13",
    "    not ok 1 - allows quoted repository evidence while the registered hook still blocks repository writes",
    "      ---",
    "      error: |-",
    '        nvm is not compatible with the "npm_config_prefix" environment variable: currently set to "/home/user/.cursor-server/bin"',
    "        Run `unset npm_config_prefix` to unset it.",
    "        bash: line 1: node: command not found",
    "        127 !== 0",
    "      stack: |-",
    "        Test.runInAsyncScope (node:async_hooks:214:14)",
    "      ...",
    "not ok 1 - agent deny hook template comparison",
    "  ---",
    "  error: '1 subtest failed'",
    "  ...",
    "1..1",
    "# tests 1",
    "# pass 0",
    "# fail 1",
  ];
  const capturedPrefixFailure = capturedPrefixFailureLines.join("\n");
  // Must match the caps in preflight's Tests failure branch; change both together.
  const maximumDetailLines = 30;
  const maximumDetailBytes = 200;

  /**
   * Writes a temporary project registered for cleanup, then spawns Bash on the production details writer and Tests section.
   * Only the suite launch, verdict rows and report ledger location are replaced; captured output stands in for the suite.
   *
   * @param suiteOutput - captured runner output; empty output supplies no test-count evidence
   * @param scripts - declared package commands; defaults exercise the coverage fallback
   * @param exitCode - runner outcome; defaults to failure for diagnostic checks
   * @returns shell status, selected command, verdict rows and the details a maintainer would see under Tests
   */
  function runTestsSection(
    suiteOutput: string,
    scripts: Record<string, string> = { test: "", "test:coverage": "" },
    exitCode = 1,
  ) {
    const source = readFileSync(PREFLIGHT_SCRIPT_PATH, "utf8");
    const detailsStart = source.indexOf("details_pipe() {");
    const detailsEnd = source.indexOf("\n}\n", detailsStart);
    const start = source.indexOf('section "Tests"');
    const end = source.indexOf("# Show coverage only when", start);
    assert.ok(detailsStart >= 0 && detailsEnd > detailsStart);
    assert.ok(start >= 0 && end > start);
    const directory = mkdtempSync(join(tmpdir(), "goat-flow-tests-failure-"));
    fixtureTemporaryDirectories.add(directory);
    writeFileSync(join(directory, "package.json"), JSON.stringify({ scripts }));
    writeFileSync(join(directory, "suite-output.tap"), suiteOutput);
    const result = spawnSync(
      "bash",
      [
        "-c",
        `
      set -euo pipefail
      errors=0
      current_section=Tests
      LEDGER=ledger.tsv
      section() { :; }
      pass() { printf 'ROW\\tPASS\\t%s\\n' "$1" >> "$LEDGER"; }
      warn() { printf 'ROW\\tWARN\\t%s\\n' "$1" >> "$LEDGER"; }
      fail() { errors=$((errors + 1)); printf 'ROW\\tFAIL\\t%s\\n' "$1" >> "$LEDGER"; }
      run_command_capture_with_timeout() {
        printf '%s\\n' "\${@:3}" >> invocation.txt
        printf -v "$1" '%s' "$(cat suite-output.tap)"
        printf -v "$2" '%s' ${exitCode}
      }
      ${source.slice(detailsStart, detailsEnd + 2)}
      ${source.slice(start, end)}
      [[ "$errors" -eq 0 ]]
    `,
      ],
      {
        cwd: directory,
        encoding: "utf8",
        env: {
          ...process.env,
          GOAT_FLOW_PREFLIGHT_TEST_TIMEOUT_SECONDS: "0",
        },
      },
    );
    const ledger = readFileSync(join(directory, "ledger.tsv"), "utf8").split(
      "\n",
    );
    return {
      status: result.status,
      stderr: result.stderr,
      invocation: readFileSync(join(directory, "invocation.txt"), "utf8")
        .trim()
        .split("\n"),
      rows: ledger.filter((line) => line.startsWith("ROW\t")),
      details: ledger
        .filter((line) => line.startsWith("DETAIL\tTests\t"))
        .map((line) => line.slice("DETAIL\tTests\t".length)),
    };
  }

  // These illustrative package declarations exercise the real selection branch without launching another complete suite.
  for (const [scripts, command, label] of [
    [
      { test: "", "test:preflight": "", "test:fast": "" },
      ["npm", "run", "test:preflight"],
      "Preflight suite",
    ],
    [
      { test: "", "test:fast": "", "test:coverage": "" },
      ["npm", "run", "test:fast"],
      "Fast suite",
    ],
    [
      { test: "", "test:coverage": "" },
      ["npm", "run", "test:coverage"],
      "Tests + coverage",
    ],
    [{ test: "" }, ["npm", "test"], "All"],
  ] as const) {
    it(`selects only ${command.join(" ")} and preserves a disabled timeout`, () => {
      const captured = runTestsSection(
        "# tests 1\n# pass 1\n# fail 0\n",
        scripts,
        0,
      );
      assert.equal(captured.status, 0, captured.stderr);
      assert.deepEqual(captured.invocation, ["0", "Tests", ...command]);
      assert.deepEqual(captured.rows, [`ROW\tPASS\t${label} passing (1/1)`]);
    });
  }

  // Minimized TAP counts retain the recorded coverage diagnostic and a runner-failure control.
  for (const [label, cause] of [
    [
      "Coverage reporting failed",
      "# Warning: Could not report code coverage. TypeError: Cannot read properties of null (reading 'sourcesContent')",
    ],
    ["Test runner failed", "runner teardown failed"],
  ]) {
    it(`keeps ${label} failing despite zero assertion failures`, () => {
      const captured = runTestsSection(
        `# tests 1\n# pass 1\n# fail 0\n${cause}\n`,
      );
      assert.equal(captured.status, 1);
      assert.deepEqual(captured.rows, [
        `ROW\tFAIL\t${label} (exit 1; tests reported 0/1 failures)`,
      ]);
      assert.ok(captured.details.join("\n").includes(cause));
    });
  }

  it("retains bounded raw diagnostics when the observed Windows reporter is not TAP", () => {
    const captured = runTestsSection(
      "ℹ tests 3473\nℹ pass 3350\nℹ fail 71\n✖ exits zero when run exactly as published\nSC2329: This function is never invoked.\n",
    );
    assert.equal(captured.status, 1);
    assert.deepEqual(captured.rows, ["ROW\tFAIL\tTests failed (?/? failures)"]);
    assert.match(captured.details.join("\n"), /SC2329/u);
    assert.ok(captured.details.length <= maximumDetailLines);
  });

  it("shows the first failure's assertion within a fixed bound and keeps Tests failing", () => {
    const captured = runTestsSection(capturedPrefixFailure);
    assert.equal(captured.status, 1, captured.stderr);
    assert.deepEqual(captured.rows, ["ROW\tFAIL\tTests failed (1/1 failures)"]);
    assert.match(
      captured.details[0] ?? "",
      /not ok 1 - allows quoted repository evidence while the registered hook still blocks repository writes/u,
    );
    const shownDetails = captured.details.join("\n");
    assert.match(
      shownDetails,
      /nvm is not compatible with the "npm_config_prefix" environment variable/u,
    );
    assert.match(shownDetails, /bash: line 1: node: command not found/u);
    assert.match(shownDetails, /127 !== 0/u);
    assert.doesNotMatch(shownDetails, /Test\.runInAsyncScope/u);

    // A flooded assertion message is cut to the same bound instead of burying the report.
    const nvmWarning = capturedPrefixFailureLines.find((line) =>
      line.includes("nvm is not compatible"),
    );
    assert.ok(nvmWarning);
    const flooded = runTestsSection(
      capturedPrefixFailure.replace(
        nvmWarning,
        Array(40).fill(nvmWarning.repeat(3)).join("\n"),
      ),
    );
    assert.equal(flooded.status, 1, flooded.stderr);
    assert.deepEqual(flooded.rows, captured.rows);
    assert.equal(flooded.details.length, maximumDetailLines);
    assert.equal(flooded.details[0], captured.details[0]);
    assert.ok(
      [...captured.details, ...flooded.details].every(
        (line) => Buffer.byteLength(line) <= maximumDetailBytes,
      ),
      "every Tests failure detail line must fit the byte bound",
    );
  });
});

/** Wait for a scheduler fixture's child to disappear after the parent cancels its workers. */
async function waitForFixtureProcessExit(processId: number): Promise<boolean> {
  const deadline = Date.now() + 1500;
  while (Date.now() <= deadline) {
    try {
      process.kill(processId, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      fixtureProcessIds.delete(processId);
      return true;
    }
    await new Promise((resolvePoll) => setTimeout(resolvePoll, 25));
  }
  return false;
}

/** Build a harmless workload around the production scheduler, keeping its process and ledger boundaries real. */
function preflightSchedulerFixture(
  failingWorker = false,
  lingeringWorker = false,
) {
  const directory = mkdtempSync(join(tmpdir(), "goat-preflight-scheduler-"));
  fixtureTemporaryDirectories.add(directory);
  const source = readFileSync(PREFLIGHT_SCRIPT_PATH, "utf8");
  const end = source.lastIndexOf("\nrun_preflight_workers\n");
  assert.ok(end > 0);
  const labels: Record<string, string> = {
    shell: "Shell Scripts",
    contracts: "Version Consistency",
    typescript: "TypeScript",
    tests: "Tests",
    dependency: "Dependency Audit",
    gruff: "Gruff Policy",
    audit: "GOAT Flow Audit",
    memory: "Learning-Loop Schema",
    content: "Content Drift",
    drift: "Doc/Code Drift",
    sync: "Skill Docs Sync",
    links: "Markdown Links",
  };
  let overrides = "\ncache_manifest_inventory() { :; }\n";
  for (const [name, label] of Object.entries(labels)) {
    const buildReady =
      name === "typescript" ? ': > "$PREFLIGHT_BUILD_READY"' : ":";
    const requireBuild = [
      "tests",
      "audit",
      "memory",
      "content",
      "drift",
    ].includes(name)
      ? '[[ -f "$PREFLIGHT_BUILD_READY" ]] || exit 9'
      : ":";
    const failure =
      failingWorker && name === "shell"
        ? 'printf "fixture child diagnostic\\n"; exit 7'
        : ":";
    const linger =
      lingeringWorker && name === "tests"
        ? 'sleep 20 & printf "%s\\n" "$!" > "$PREFLIGHT_TEST_DIRECTORY/descendant"; wait'
        : ":";
    overrides += `
check_${name}() {
  section "${label}"
  ${requireBuild}
  printf 'start ${name}\\n' >> "$PREFLIGHT_TEST_DIRECTORY/events"
  sleep 0.1
  ${buildReady}
  pass "fixture ${name}"
  ${failure}
  ${linger}
  printf 'end ${name}\\n' >> "$PREFLIGHT_TEST_DIRECTORY/events"
}
`;
  }
  const script = join(directory, "scheduler.sh");
  writeFileSync(
    script,
    `${source.slice(0, end)}${overrides}
run_preflight_workers
merge_preflight_workers
[[ "$errors" -eq 0 ]]
`,
  );
  return { directory, script };
}

describe("preflight parallel scheduler", () => {
  it("runs every check once with bounded overlap and renders the established order", () => {
    const fixture = preflightSchedulerFixture();
    const result = spawnSync(
      "bash",
      [fixture.script, "--no-color", "--ascii", "--verbose"],
      {
        cwd: PROJECT_ROOT,
        encoding: "utf8",
        timeout: 15000,
        env: { ...process.env, PREFLIGHT_TEST_DIRECTORY: fixture.directory },
      },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PASS\s+12 checks \+ 0 warnings/u);
    const events = readFileSync(join(fixture.directory, "events"), "utf8")
      .trim()
      .split("\n");
    const started = new Set<string>();
    let active = 0;
    let maximumActive = 0;
    for (const event of events) {
      const [operation, name] = event.split(" ");
      assert.ok(name);
      if (operation === "start") {
        assert.ok(!started.has(name));
        started.add(name);
        active++;
        maximumActive = Math.max(maximumActive, active);
      } else active--;
    }
    assert.equal(started.size, 12);
    assert.equal(active, 0);
    assert.ok(maximumActive > 1 && maximumActive <= 4);
    const reportOrder = [
      "fixture shell",
      "fixture contracts",
      "fixture typescript",
      "fixture tests",
      "fixture dependency",
      "fixture gruff",
      "fixture audit",
      "fixture memory",
      "fixture content",
      "fixture drift",
      "fixture sync",
      "fixture links",
    ];
    let previous = -1;
    for (const label of reportOrder) {
      const position = result.stdout.indexOf(label);
      assert.ok(position > previous, label);
      previous = position;
    }
  });

  it("retains a worker's partial results and diagnostic while failing the complete run", () => {
    const fixture = preflightSchedulerFixture(true);
    const result = spawnSync(
      "bash",
      [fixture.script, "--no-color", "--ascii", "--verbose"],
      {
        cwd: PROJECT_ROOT,
        encoding: "utf8",
        timeout: 15000,
        env: { ...process.env, PREFLIGHT_TEST_DIRECTORY: fixture.directory },
      },
    );
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /fixture shell/u);
    assert.match(result.stdout, /shell worker failed \(exit 7\)/u);
    assert.match(result.stdout, /fixture child diagnostic/u);
    assert.match(result.stdout, /FAIL\s+13 checks/u);
    assert.doesNotMatch(result.stdout, /PASS\s+13 checks/u);
  });

  it("reports a worker that exits before opening a report section", () => {
    const fixture = preflightSchedulerFixture();
    const script = readFileSync(fixture.script, "utf8").replace(
      "\nrun_preflight_workers\n",
      '\ncheck_shell() { printf "fixture startup failure\\n"; exit 7; }\nrun_preflight_workers\n',
    );
    writeFileSync(fixture.script, script);
    const result = spawnSync(
      "bash",
      [fixture.script, "--no-color", "--ascii", "--verbose"],
      {
        cwd: PROJECT_ROOT,
        encoding: "utf8",
        timeout: 15000,
        env: { ...process.env, PREFLIGHT_TEST_DIRECTORY: fixture.directory },
      },
    );
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /shell worker failed \(exit 7\)/u);
    assert.match(result.stdout, /fixture startup failure/u);
    assert.match(result.stdout, /FAIL\s+12 checks/u);
  });

  it(
    "terminates running worker descendants when the complete preflight is interrupted",
    { skip: process.platform === "win32" },
    async () => {
      const fixture = preflightSchedulerFixture(false, true);
      const child = spawn("bash", [fixture.script, "--no-color", "--ascii"], {
        cwd: PROJECT_ROOT,
        stdio: "ignore",
        env: { ...process.env, PREFLIGHT_TEST_DIRECTORY: fixture.directory },
      });
      if (child.pid) fixtureProcessIds.add(child.pid);
      const closed = new Promise<number | null>((resolveExit, rejectExit) => {
        child.once("error", rejectExit);
        child.once("close", resolveExit);
      });
      const marker = join(fixture.directory, "descendant");
      const deadline = Date.now() + 10000;
      while (!existsSync(marker) && Date.now() < deadline) {
        await new Promise((resolvePoll) => setTimeout(resolvePoll, 20));
      }
      assert.ok(existsSync(marker), "worker reached the live descendant");
      const descendant = Number(readFileSync(marker, "utf8").trim());
      fixtureProcessIds.add(descendant);
      child.kill("SIGTERM");
      assert.equal(await closed, 143);
      assert.equal(await waitForFixtureProcessExit(descendant), true);
    },
  );
});
