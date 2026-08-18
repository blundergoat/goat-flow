/**
 * Gruff warning-debt ratchet.
 *
 * The checker must fail closed on every way debt can grow unnoticed:
 *
 * - analyzer operational errors, and malformed or drifted JSON
 * - new or duplicated warnings, worsened size and process metadata, and stale accepted debt
 * - shell-enabled process execution, and coverage loss
 *
 * Unchanged or reduced reviewed debt passes. The suite also pins the preflight Gruff Policy wiring and the
 * dedicated Node 22 CI ratchet job, so neither gate can silently disappear.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const CHECKER = join(REPO_ROOT, "scripts", "check-gruff-warning-ratchet.mjs");
const FAKE_ANALYZER = join(
  REPO_ROOT,
  "test",
  "fixtures",
  "gruff-ratchet",
  "fake-gruff-analyzer.mjs",
);

/**
 * Reviewed-debt manifest fixture mirroring the real baseline shape.
 *
 * Invariant: it stays in exact agreement with {@link scanFixture} so the unchanged-debt case passes, and a
 * regression test mutates a fresh copy rather than editing this shared shape.
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

/** One scan warning finding with fixture defaults overridable per test. */
function warning(overrides: Record<string, unknown>): Record<string, unknown> {
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
 * Analyzer scan fixture that exactly matches {@link baselineFixture}.
 *
 * Invariant: that agreement must always hold, so every regression fixture is one deliberate mutation of a fresh
 * copy rather than an edit to the shared pass-case shape.
 */
function scanFixture(): Record<string, unknown> {
  return {
    schemaVersion: "gruff.analysis.v2",
    diagnostics: [],
    paths: { analysedFiles: 120 },
    findings: [
      warning({}),
      warning({
        ruleId: "security.process-exec",
        file: "scripts/example-exec.mjs",
        stableIdentity: "procfixture0001",
        metadata: {
          callName: "spawnSync",
          argumentSource: "parameter",
          shellEnabled: false,
        },
      }),
      warning({
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

/** Observable outcome of one checker run: exit status plus both streams. */
interface RatchetRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Per-test knobs for one checker run: the manifest to write or a path to a deliberately missing one, the fake
 * analyzer's JSON scan or raw stdout, and its exit code and stderr for operational-failure fixtures.
 *
 * Contract: `baselinePath` always wins over `baseline` and `rawStdout` always wins over `scan`. An unset field
 * never means empty; it falls back to the shared pass-case fixture.
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
  let fixtureRoot = "";
  let runSerial = 0;

  before(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), "goat-flow-gruff-ratchet-"));
  });

  after(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  /**
   * Run the real checker against the fake analyzer and a fixture manifest.
   *
   * It writes the fixture manifest into the suite's temp directory and spawns one synchronous checker child whose
   * environment routes analyzer resolution to the fake entry.
   *
   * @param options - per-run knobs for the manifest, analyzer output, and exit status
   * @returns the child's exit status and both decoded streams. The contract is that it never throws on a failing
   *   checker, because pass and fail assertions belong to the calling test.
   */
  async function runRatchet(options: RatchetRunOptions): Promise<RatchetRun> {
    runSerial += 1;
    let baselinePath = options.baselinePath;
    if (baselinePath === undefined) {
      baselinePath = join(fixtureRoot, `baseline-${runSerial}.json`);
      await writeFile(
        baselinePath,
        `${JSON.stringify(options.baseline ?? baselineFixture(), null, 2)}\n`,
      );
    }
    const stdout =
      options.rawStdout ??
      `${JSON.stringify(options.scan ?? scanFixture(), null, 2)}\n`;
    const result = spawnSync(process.execPath, [CHECKER], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        GOAT_FLOW_GRUFF_RATCHET_ANALYZER_BIN: FAKE_ANALYZER,
        GOAT_FLOW_GRUFF_RATCHET_BASELINE: baselinePath,
        FAKE_GRUFF_STDOUT: stdout,
        FAKE_GRUFF_STDERR: options.analyzerStderr ?? "",
        FAKE_GRUFF_EXIT: String(options.analyzerExit ?? 0),
      },
    });
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  /** Assert a run failed and reported the expected bounded failure category. */
  function assertFailure(run: RatchetRun, pattern: RegExp): void {
    assert.notEqual(run.status, 0, `expected failure, got:\n${run.stdout}`);
    assert.match(run.stderr, pattern);
  }

  it("fails when the analyzer exits with an operational error", async () => {
    const run = await runRatchet({ analyzerExit: 2, analyzerStderr: "boom" });
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
    (scan.findings as Record<string, unknown>[])[0].stableIdentity = "";
    assertFailure(await runRatchet({ scan }), /schema drift:.*stableIdentity/s);
  });

  it("fails when the analyzer reports diagnostics", async () => {
    const scan = {
      ...scanFixture(),
      diagnostics: [{ message: "config schemaVersion missing" }],
    };
    assertFailure(await runRatchet({ scan }), /analyzer diagnostics:/);
  });

  it("fails on any error-severity finding", async () => {
    const scan = scanFixture();
    (scan.findings as Record<string, unknown>[]).push(
      warning({ severity: "error", stableIdentity: "errfixture00001" }),
    );
    assertFailure(await runRatchet({ scan }), /error findings:/);
  });

  it("fails on a warning identity missing from the manifest", async () => {
    const scan = scanFixture();
    (scan.findings as Record<string, unknown>[]).push(
      warning({ stableIdentity: "sizefixture0002", file: "src/new-debt.ts" }),
    );
    assertFailure(await runRatchet({ scan }), /new warning:.*sizefixture0002/s);
  });

  // The manifest accepts exactly two occurrences of this process identity, so
  // a third occurrence must trip the duplicate-growth bound even though its
  // metadata shape is accepted: this fixture covers the count-only regression.
  it("fails when a duplicated identity grows another occurrence", async () => {
    const scan = scanFixture();
    (scan.findings as Record<string, unknown>[]).push(
      warning({
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
    (baseline.entries as Record<string, unknown>[])[0].rationale = "";
    assertFailure(
      await runRatchet({ baseline }),
      /invalid manifest:.*rationale/s,
    );
  });

  it("treats a missing manifest as zero accepted debt, so any warning is a regression", async () => {
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
    scan.findings = (scan.findings as Record<string, unknown>[]).filter(
      (finding) => finding.stableIdentity !== "procfixture0001",
    );
    assertFailure(
      await runRatchet({ scan }),
      /stale accepted debt:.*procfixture0001/s,
    );
  });

  it("fails when analysed-file coverage drops below the recorded floor", async () => {
    const scan = { ...scanFixture(), paths: { analysedFiles: 99 } };
    assertFailure(await runRatchet({ scan }), /coverage regression:.*99/s);
  });

  it("passes and reports accepted debt when the scan matches the manifest", async () => {
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
    findings[0].metadata = { lines: 820, threshold: 750 };
    scan.findings = findings.filter(
      (finding, index) => !(index === 2), // drop one accepted process occurrence
    );
    const run = await runRatchet({ scan });
    assert.equal(run.status, 0, `expected pass, got:\n${run.stderr}`);
    assert.match(run.stdout, /2 accepted identities/);
  });

  it("invokes the warning ratchet from the preflight Gruff Policy check", () => {
    const preflight = readFileSync(
      join(REPO_ROOT, "scripts", "preflight-checks.sh"),
      "utf8",
    );
    assert.match(preflight, /check-gruff-warning-ratchet\.mjs/);
    assert.match(preflight, /No gruff-ts rules disabled/);
  });

  it("runs the warning ratchet in a dedicated Node 22 CI job", () => {
    const ciWorkflow = readFileSync(
      join(REPO_ROOT, ".github", "workflows", "ci.yml"),
      "utf8",
    );
    const jobStart = ciWorkflow.indexOf("gruff-warning-ratchet:");
    assert.notEqual(jobStart, -1, "dedicated ratchet job should exist");
    // The ratchet job is the last job in ci.yml, so the slice below covers
    // exactly its block; keep it last or tighten this slice when reordering.
    const jobBlock = ciWorkflow.slice(jobStart);
    assert.match(jobBlock, /node-version: "22"/);
    assert.match(jobBlock, /node scripts\/check-gruff-warning-ratchet\.mjs/);
    // The Node 20 compatibility job must remain alongside the ratchet job.
    assert.match(ciWorkflow.slice(0, jobStart), /node-version: "20"/);
  });
});
