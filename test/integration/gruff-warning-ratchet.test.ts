/**
 * Tests for the Gruff warning-debt ratchet, the gate a developer meets in the Gruff Policy section of `bash scripts/preflight-checks.sh`.
 *
 * Unchanged or reduced reviewed debt passes; the checker must fail closed on:
 * - analyzer operational errors, and malformed or drifted JSON
 * - new or duplicated warnings, worsened size and process metadata, and stale accepted debt
 * - shell-enabled process execution, and coverage loss
 *
 * The suite also pins the preflight Gruff Policy wiring and the dedicated Node 22 CI ratchet job, so neither gate can silently disappear.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
// The checker script that preflight runs, plus a stand-in analyzer that replays each test's scripted output instead of scanning.
const CHECKER = join(REPO_ROOT, "scripts", "check-gruff-warning-ratchet.mjs");
const FAKE_ANALYZER = join(
  REPO_ROOT,
  "test",
  "fixtures",
  "gruff-ratchet",
  "fake-gruff-analyzer.mjs",
);

/**
 * Spawns `node scripts/check-gruff-warning-ratchet.mjs` from the repo root, as preflight does, and returns what the developer would see.
 *
 * Writes stdout and stderr to private temp files, not pipes: sandboxed runs have returned empty piped output from a finished child.
 * Reads both files back, then removes the temp folder even when the run throws.
 *
 * @param environment - full checker environment: process env minus the test overrides for the installed analyzer, or one routed to the fake
 * @param timeout - milliseconds before the checker is killed; omitted means no limit, and only the installed-analyzer smoke case sets one
 * @returns spawnSync's status, signal and error as-is, with the full stdout and stderr text; an empty stream means nothing was printed there
 */
function runChecker(environment: NodeJS.ProcessEnv, timeout?: number) {
  const captureDirectory = mkdtempSync(
    join(tmpdir(), "goat-ratchet-checker-output-"),
  );
  const stdoutPath = join(captureDirectory, "stdout");
  const stderrPath = join(captureDirectory, "stderr");
  const descriptors: number[] = [];
  try {
    // Create each capture file fresh and owner-only, so the checker's output cannot mix with a leftover or shared file.
    for (const path of [stdoutPath, stderrPath]) {
      descriptors.push(openSync(path, "wx", 0o600));
    }
    const result = spawnSync(process.execPath, [CHECKER], {
      cwd: REPO_ROOT,
      env: environment,
      encoding: "utf8",
      timeout,
      stdio: ["ignore", ...descriptors],
    });
    return {
      ...result,
      stdout: readFileSync(stdoutPath, "utf8"),
      stderr: readFileSync(stderrPath, "utf8"),
    };
  } finally {
    // Close whichever capture files opened, even if the second open or the spawn threw, before the temp folder is removed.
    for (const descriptor of descriptors) closeSync(descriptor);
    rmSync(captureDirectory, { recursive: true, force: true });
  }
}

/**
 * A fresh reviewed-debt manifest: the hand-edited list of accepted warnings a maintainer would keep beside the checker script.
 *
 * Invariant: it stays in exact agreement with {@link scanFixture} so the unchanged-debt case passes.
 * A regression test mutates its own fresh copy rather than editing this shared shape.
 *
 * @returns a new manifest accepting one oversized file and two shell-free spawnSync occurrences, with a coverage floor of 100 files
 */
function baselineFixture(): Record<string, unknown> {
  return {
    schemaVersion: "gruff.analysis.v2",
    analyzer: "@blundergoat/gruff-ts",
    minimumAnalysedFiles: 100,
    entries: [
      {
        stableIdentity: "sizefixture0001",
        ruleId: "size.file-length",
        file: "src/example-oversized.ts",
        rationale: "Reviewed oversized module scheduled for later split.",
        occurrences: [{ lines: 900, threshold: 750 }],
      },
      {
        stableIdentity: "procfixture0001",
        ruleId: "security.process-exec",
        file: "scripts/example-exec.mjs",
        rationale: "Reviewed argv-only spawn without shell interpretation.",
        occurrences: [
          {
            callName: "spawnSync",
            argumentSource: "parameter",
            shellEnabled: false,
          },
          {
            callName: "spawnSync",
            argumentSource: "member",
            shellEnabled: false,
          },
        ],
      },
    ],
  };
}

/**
 * One warning as the analyzer's JSON report lists it, defaulting to the reviewed oversized-file warning the manifest accepts.
 *
 * @param overrides - fields a test changes, such as ruleId or severity; an empty object `{}` keeps the default size warning
 * @returns a new finding object a test can push into, or mutate inside, its own scan fixture
 */
function scanWarning(
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ruleId: "size.file-length",
    severity: "warning",
    file: "src/example-oversized.ts",
    line: 1,
    stableIdentity: "sizefixture0001",
    metadata: { lines: 900, threshold: 750 },
    ...overrides,
  };
}

/**
 * A fresh analyzer JSON report for the unchanged-debt case: exactly the warnings {@link baselineFixture} accepts, plus one advisory.
 *
 * Invariant: that agreement must always hold, so every regression fixture is one deliberate mutation of a fresh copy, never an edit here.
 *
 * @returns a new passing report: no diagnostics, 120 analysed files, the accepted warnings, and one ungated advisory
 */
function scanFixture(): Record<string, unknown> {
  return {
    schemaVersion: "gruff.analysis.v2",
    diagnostics: [],
    paths: { analysedFiles: 120 },
    findings: [
      scanWarning({}),
      scanWarning({
        ruleId: "security.process-exec",
        file: "scripts/example-exec.mjs",
        stableIdentity: "procfixture0001",
        metadata: {
          callName: "spawnSync",
          argumentSource: "parameter",
          shellEnabled: false,
        },
      }),
      scanWarning({
        ruleId: "security.process-exec",
        file: "scripts/example-exec.mjs",
        stableIdentity: "procfixture0001",
        metadata: {
          callName: "spawnSync",
          argumentSource: "member",
          shellEnabled: false,
        },
      }),
      // Advisories stay visible but are never gated by the ratchet.
      {
        ruleId: "docs.missing-file-overview",
        severity: "advisory",
        file: "src/example-advisory.ts",
        line: 1,
        stableIdentity: "advisoryfixture1",
        metadata: {},
      },
    ],
  };
}

/** What the developer would see from one checker run: the exit code preflight branches on, plus the stdout pass line or stderr failure list. */
interface RatchetRun {
  /** 0 debt unchanged or reduced, 1 policy or manifest failure, 2 analyzer could not run; null when a signal killed the checker. */
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * The parts of one checker run a test overrides; `{}` replays the shared passing manifest and analyzer report.
 *
 * Contract: unset fields fall back to the shared passing fixture or a healthy analyzer, never to an empty manifest or report, and:
 * - `baselinePath` wins over `baseline`, for cases whose manifest file is deliberately never written
 * - `rawStdout` wins over `scan`, for cases where the analyzer prints something that is not JSON
 * - unset `analyzerExit` and `analyzerStderr` mean exit 0 with nothing on stderr, like a healthy analyzer
 */
interface RatchetRunOptions {
  baseline?: unknown;
  baselinePath?: string;
  scan?: unknown;
  rawStdout?: string;
  analyzerExit?: number;
  analyzerStderr?: string;
}

describe("gruff warning ratchet", () => {
  // End-to-end smoke run: the installed gruff-ts scans this repository through the real checker, as in a developer's preflight run.
  // The installed gruff-ts requires Node 22 or newer, so older Node skips this case.
  it(
    "launches the installed analyzer through the production ratchet",
    { skip: Number(process.versions.node.split(".")[0]) < 22 },
    () => {
      // Drop the fixture overrides so the checker resolves the installed analyzer and the default manifest path.
      const environment = { ...process.env };
      delete environment.GOAT_FLOW_GRUFF_RATCHET_ANALYZER_BIN;
      delete environment.GOAT_FLOW_GRUFF_RATCHET_BASELINE;
      const run = runChecker(environment, 120_000);
      // On failure, show the checker's stderr, or the spawn error when the checker printed nothing.
      assert.equal(run.status, 0, run.stderr || run.error?.message);
      assert.equal(run.signal, null);
      // Sandboxes can attach EPERM to a checker that still finished, so only EPERM is tolerated; the exit 0 above proves the run completed.
      assert.ok(
        !run.error || ("code" in run.error && run.error.code === "EPERM"),
        run.error?.message,
      );
      assert.match(
        run.stdout,
        /gruff warning ratchet:.*analysedFiles \d+ >= floor \d+/u,
      );
    },
  );

  // Fixture cases write their manifests into one temp folder; the counter keeps each run's manifest file name unique.
  let fixtureRoot = "";
  let runSerial = 0;

  // Create the temp folder for fixture manifests before the first fixture case runs.
  before(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), "goat-flow-gruff-ratchet-"));
  });

  // Remove the temp folder and every manifest written into it, whether the cases passed or failed.
  after(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  /**
   * Replays one scripted analyzer result through the real checker and returns what the developer would see in preflight.
   *
   * Writes the run's manifest to a numbered temp file unless the test names a missing one, then spawns the checker on the fake analyzer.
   * Contract: it never throws on a failing checker, because pass and fail assertions belong to the calling test.
   *
   * @param options - what this test overrides; `{}` replays the passing manifest and analyzer report
   * @returns the checker's exit status and both streams as text; an empty stream means the checker printed nothing there
   */
  async function runRatchet(options: RatchetRunOptions): Promise<RatchetRun> {
    runSerial += 1;
    let baselinePath = options.baselinePath;
    // No deliberately missing path was given, so write this run's manifest (the shared fixture unless the test supplied one).
    if (baselinePath === undefined) {
      baselinePath = join(fixtureRoot, `baseline-${runSerial}.json`);
      await writeFile(
        baselinePath,
        `${JSON.stringify(options.baseline ?? baselineFixture(), null, 2)}\n`,
      );
    }
    // Raw text wins over a JSON scan so malformed-output cases reach the checker unchanged; with neither, the passing report replays.
    const stdout =
      options.rawStdout ??
      `${JSON.stringify(options.scan ?? scanFixture(), null, 2)}\n`;
    // Route the checker to the fake analyzer and this run's manifest; unset stderr and exit code mean a healthy analyzer run.
    const result = runChecker({
      ...process.env,
      GOAT_FLOW_GRUFF_RATCHET_ANALYZER_BIN: FAKE_ANALYZER,
      GOAT_FLOW_GRUFF_RATCHET_BASELINE: baselinePath,
      FAKE_GRUFF_STDOUT: stdout,
      FAKE_GRUFF_STDERR: options.analyzerStderr ?? "",
      FAKE_GRUFF_EXIT: String(options.analyzerExit ?? 0),
    });
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  /**
   * Asserts the developer would see a failed gate: a non-zero exit and a stderr line in the expected failure category.
   *
   * @param run - the checker run under test; its stdout is shown in the assertion message if it unexpectedly passed
   * @param pattern - expected failure category text, such as `/new warning:/`
   */
  function assertFailure(run: RatchetRun, pattern: RegExp): void {
    assert.notEqual(run.status, 0, `expected failure, got:\n${run.stdout}`);
    assert.match(run.stderr, pattern);
  }

  // Exit 2 is gruff-ts's fatal-diagnostic code, for example when it rejects the project's .gruff-ts.yaml.
  // The checker then exits 2, which preflight shows as an unavailable analyzer.
  it("fails when the analyzer exits with an operational error", async () => {
    const run = await runRatchet({ analyzerExit: 2, analyzerStderr: "boom" });
    assert.equal(run.status, 2);
    assertFailure(run, /analyzer failure:.*exit 2/s);
  });

  it("fails on malformed analyzer output instead of guessing", async () => {
    const run = await runRatchet({ rawStdout: "not json at all" });
    assertFailure(run, /malformed analyzer output:/);
  });

  it("fails when the analyzer schema version drifts", async () => {
    const scan = { ...scanFixture(), schemaVersion: "gruff.analysis.v3" };
    assertFailure(await runRatchet({ scan }), /schema drift:.*v3/s);
  });

  it("fails when a warning lacks a stable identity", async () => {
    const scan = scanFixture();
    // An empty identity cannot be matched to reviewed debt, so the checker reports schema drift rather than guessing.
    (scan.findings as Record<string, unknown>[])[0].stableIdentity = "";
    assertFailure(await runRatchet({ scan }), /schema drift:.*stableIdentity/s);
  });

  it("fails when the analyzer reports diagnostics", async () => {
    // The analyzer exited 0 but its report lists its own trouble in diagnostics, so the checker fails rather than trust a partial scan.
    const scan = {
      ...scanFixture(),
      diagnostics: [{ message: "config schemaVersion missing" }],
    };
    assertFailure(await runRatchet({ scan }), /analyzer diagnostics:/);
  });

  it("fails on any error-severity finding", async () => {
    const scan = scanFixture();
    // An error-severity finding is never accepted debt, so one alone fails the gate.
    (scan.findings as Record<string, unknown>[]).push(
      scanWarning({ severity: "error", stableIdentity: "errfixture00001" }),
    );
    assertFailure(await runRatchet({ scan }), /error findings:/);
  });

  it("fails on a warning identity missing from the manifest", async () => {
    const scan = scanFixture();
    // For example, a developer adds a new oversized file that nobody has reviewed or accepted.
    (scan.findings as Record<string, unknown>[]).push(
      scanWarning({
        stableIdentity: "sizefixture0002",
        file: "src/new-debt.ts",
      }),
    );
    assertFailure(await runRatchet({ scan }), /new warning:.*sizefixture0002/s);
  });

  // The manifest accepts exactly two procfixture0001 occurrences, so a third trips the duplicate-growth bound even though its shape was reviewed.
  //
  // For example, a reviewed spawnSync call is copied and the analyzer reports one more occurrence under the same identity.
  // This fixture covers the count-only regression: the extra occurrence's metadata matches an accepted shape.
  it("fails when a duplicated identity grows another occurrence", async () => {
    const scan = scanFixture();
    (scan.findings as Record<string, unknown>[]).push(
      scanWarning({
        ruleId: "security.process-exec",
        file: "scripts/example-exec.mjs",
        stableIdentity: "procfixture0001",
        metadata: {
          callName: "spawnSync",
          argumentSource: "member",
          shellEnabled: false,
        },
      }),
    );
    assertFailure(
      await runRatchet({ scan }),
      /duplicate growth:.*procfixture0001/s,
    );
  });

  it("fails when an accepted size warning grows past its reviewed lines", async () => {
    const scan = scanFixture();
    // For example, a developer adds 50 lines to the reviewed oversized file, taking it from 900 to 950 lines.
    (scan.findings as Record<string, unknown>[])[0].metadata = {
      lines: 950,
      threshold: 750,
    };
    assertFailure(
      await runRatchet({ scan }),
      /metadata regression:.*sizefixture0001/s,
    );
  });

  it("fails when a size warning reports a different threshold", async () => {
    const scan = scanFixture();
    // For example, someone changes the size.file-length limit in .gruff-ts.yaml instead of re-reviewing the file.
    (scan.findings as Record<string, unknown>[])[0].metadata = {
      lines: 900,
      threshold: 700,
    };
    assertFailure(
      await runRatchet({ scan }),
      /metadata regression:.*sizefixture0001/s,
    );
  });

  it("fails when process metadata changes to an unreviewed shape", async () => {
    const scan = scanFixture();
    // The reviewed spawnSync call now reports a "template" argument source, a launch shape no reviewer signed off.
    (scan.findings as Record<string, unknown>[])[1].metadata = {
      callName: "spawnSync",
      argumentSource: "template",
      shellEnabled: false,
    };
    assertFailure(
      await runRatchet({ scan }),
      /metadata regression:.*procfixture0001/s,
    );
  });

  it("fails when a scanned process execution enables a shell", async () => {
    const scan = scanFixture();
    // For example, someone adds `shell: true` to a reviewed spawnSync call; the known identity does not excuse it.
    (scan.findings as Record<string, unknown>[])[1].metadata = {
      callName: "spawnSync",
      argumentSource: "parameter",
      shellEnabled: true,
    };
    assertFailure(await runRatchet({ scan }), /shellEnabled/);
  });

  it("rejects a manifest that accepts shell-enabled process execution", async () => {
    const baseline = baselineFixture();
    const entries = baseline.entries as Record<string, unknown>[];
    // A maintainer tries to accept a shell-enabled launch in the manifest itself, which the checker never allows.
    entries[1].occurrences = [
      {
        callName: "spawnSync",
        argumentSource: "parameter",
        shellEnabled: true,
      },
    ];
    assertFailure(
      await runRatchet({ baseline }),
      /invalid manifest:.*shellEnabled/s,
    );
  });

  it("rejects a manifest entry without a rationale", async () => {
    const baseline = baselineFixture();
    // A maintainer accepted a warning without writing down why, so the entry cannot count as reviewed.
    (baseline.entries as Record<string, unknown>[])[0].rationale = "";
    assertFailure(
      await runRatchet({ baseline }),
      /invalid manifest:.*rationale/s,
    );
  });

  it("treats a missing manifest as zero accepted debt, so any warning is a regression", async () => {
    // 494 meets the coverage floor kept when no manifest exists, so only the warnings themselves can fail this run.
    const scan = { ...scanFixture(), paths: { analysedFiles: 494 } };
    const run = await runRatchet({
      baselinePath: join(fixtureRoot, "missing-baseline.json"),
      scan,
    });
    // No manifest is the intended steady state: this project fixes warnings instead of accepting them,
    // so the scan's warnings must be reported as new rather than as an unusable gate.
    assertFailure(run, /new warning:/);
    assert.doesNotMatch(run.stderr, /invalid manifest:/);
  });

  it("retains reviewed scan coverage when the warning manifest is missing", async () => {
    // For example, a new ignore in .gruff-ts.yaml hides almost every file, so the scan covers 1 file against the kept floor of 494.
    const scan = {
      ...scanFixture(),
      paths: { analysedFiles: 1 },
      findings: [],
    };
    const run = await runRatchet({
      baselinePath: join(fixtureRoot, "missing-baseline.json"),
      scan,
    });
    assertFailure(run, /coverage regression:.*1.*494/s);
  });

  it("passes with no manifest when the scan reports no warnings at all", async () => {
    // The steady state a developer should see: no manifest, no warnings, and full coverage of the 494-file floor.
    const scan = {
      ...scanFixture(),
      paths: { analysedFiles: 494 },
      findings: [],
    };
    const run = await runRatchet({
      baselinePath: join(fixtureRoot, "missing-baseline.json"),
      scan,
    });
    assert.equal(run.status, 0, `expected pass, got:\n${run.stderr}`);
    assert.match(run.stdout, /analysedFiles 494 >= floor 494/);
  });

  it("fails on stale accepted debt so the manifest ratchets down", async () => {
    const scan = scanFixture();
    // For example, a developer fixed both reviewed spawnSync calls but left their manifest entry, which must now be removed.
    scan.findings = (scan.findings as Record<string, unknown>[]).filter(
      (finding) => finding.stableIdentity !== "procfixture0001",
    );
    assertFailure(
      await runRatchet({ scan }),
      /stale accepted debt:.*procfixture0001/s,
    );
  });

  it("fails when analysed-file coverage drops below the recorded floor", async () => {
    // For example, files were deleted or newly ignored, so the scan covers 99 files against the manifest's floor of 100.
    const scan = { ...scanFixture(), paths: { analysedFiles: 99 } };
    assertFailure(await runRatchet({ scan }), /coverage regression:.*99/s);
  });

  it("passes and reports accepted debt when the scan matches the manifest", async () => {
    // The pass line must state every count, so a developer can see the accepted debt and ungated advisories at a glance.
    const run = await runRatchet({});
    assert.equal(run.status, 0, `expected pass, got:\n${run.stderr}`);
    assert.match(run.stdout, /2 accepted identities/);
    assert.match(run.stdout, /3 occurrences/);
    assert.match(run.stdout, /analysedFiles 120 >= floor 100/);
    assert.match(run.stdout, /advisories: 1 \(not gated\)/);
  });

  it("passes when reviewed debt shrinks without a manifest edit", async () => {
    const scan = scanFixture();
    const findings = scan.findings as Record<string, unknown>[];
    // For example, a developer trims the oversized file to 820 lines and removes one reviewed spawnSync call, leaving the manifest alone.
    findings[0].metadata = { lines: 820, threshold: 750 };
    scan.findings = findings.filter(
      (finding, index) => !(index === 2), // drop one accepted process occurrence
    );
    const run = await runRatchet({ scan });
    assert.equal(run.status, 0, `expected pass, got:\n${run.stderr}`);
    assert.match(run.stdout, /2 accepted identities/);
  });

  // Pins the preflight wiring, so the ratchet cannot vanish from the Gruff Policy section a developer reads.
  it("invokes the warning ratchet from the preflight Gruff Policy check", () => {
    const preflight = readFileSync(
      join(REPO_ROOT, "scripts", "preflight-checks.sh"),
      "utf8",
    );
    assert.match(preflight, /check-gruff-warning-ratchet\.mjs/);
    assert.match(preflight, /No gruff-ts rules disabled/);
    // Exit 2 must read as an unavailable analyzer, not as debt growth, so the developer knows to fix the tooling first.
    assert.match(
      preflight,
      /fail "Gruff warning ratchet unavailable: analyzer could not run"/u,
    );
  });

  it("runs the warning ratchet in a dedicated Node 22 CI job", () => {
    const ciWorkflow = readFileSync(
      join(REPO_ROOT, ".github", "workflows", "ci.yml"),
      "utf8",
    );
    const jobStart = ciWorkflow.indexOf("gruff-warning-ratchet:");
    // A missing job name means the Windows ratchet job was deleted or renamed, so CI would silently stop running it.
    assert.notEqual(jobStart, -1, "dedicated ratchet job should exist");
    // The ratchet job is the last job in ci.yml, so this slice is exactly its block; keep it last or tighten this slice when reordering.
    const jobBlock = ciWorkflow.slice(jobStart);
    assert.match(jobBlock, /node-version: "22"/);
    // Until the 1.19.0 release the Windows job runs on every event, so it has no job-level condition.
    // Linux runs the ratchet in the checks job's preflight, pinned next.
    assert.match(jobBlock, /runs-on: windows-latest/u);
    assert.doesNotMatch(jobBlock, /^ {4}if:/mu);
    assert.match(
      ciWorkflow.slice(0, jobStart),
      /run: bash scripts\/preflight-checks\.sh --skip-tests/u,
    );
    assert.match(
      readFileSync(join(REPO_ROOT, "scripts", "preflight-checks.sh"), "utf8"),
      /node scripts\/check-gruff-warning-ratchet\.mjs/u,
    );
    // The Windows job also reruns this suite and preflight-progress, so their launch contracts are checked on Windows paths.
    assert.match(
      jobBlock,
      /test\/integration\/preflight-progress\.test\.ts test\/integration\/gruff-warning-ratchet\.test\.ts/u,
    );
    assert.match(jobBlock, /node scripts\/check-gruff-warning-ratchet\.mjs/);
    // The Node 20 compatibility job must remain alongside the ratchet job.
    assert.match(ciWorkflow.slice(0, jobStart), /node-version: "20"/);
    // windows-hook-contracts runs on the package's minimum Node, 20.11.0; this slice runs from that job up to the ratchet job.
    const minimumNodeJob = ciWorkflow.slice(
      ciWorkflow.indexOf("windows-hook-contracts:"),
      jobStart,
    );
    assert.match(minimumNodeJob, /node-version: "20\.11\.0"/u);
    assert.match(
      minimumNodeJob,
      /node --import tsx --test test\/integration\/preflight-progress\.test\.ts/u,
    );
  });
});
