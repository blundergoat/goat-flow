/**
 * Integration tests for the shipped quality history/diff CLI surfaces.
 *
 * Agents write reports directly to `.goat-flow/logs/quality/` under the new
 * `<YYYY-MM-DD>-<HHMM>-<agent>-<rand5>.json` filename scheme. These tests seed
 * that directory from the fixtures and exercise `history` + `diff`.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  existsSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  closeSync,
  openSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { CLIError } from "../../src/cli/cli-error.js";
import { persistQualityReportText } from "../../src/cli/quality/quality-command.js";
import { parseQualityReport } from "../../src/cli/quality/schema.js";
import type {
  QualityFix,
  QualityReport,
} from "../../src/cli/quality/schema-types.js";
import { attachFindingIds } from "../../src/cli/quality/ids.js";
import { captureReviewSnapshot } from "../../src/cli/review-validate-authority.js";
import {
  taggedHash,
  type JsonRecord,
} from "../../src/cli/review-validate-common.js";
import { makeCurrentQualityReport } from "../fixtures/quality-report.js";
import { makeQualityScoreRationale } from "../fixtures/quality-score-rationale.js";
import { getQualityRubricId } from "../../src/cli/quality/rubric.js";
import {
  loadQualityHistory,
  loadQualityHistoryWindow,
} from "../../src/cli/quality/history.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const CLI_PATH = join(PROJECT_ROOT, "src", "cli", "cli.ts");
// Node's --import flag rejects raw Windows paths (D:\...) as ERR_UNSUPPORTED_ESM_URL_SCHEME
// because it parses "D:" as a URL scheme. pathToFileURL produces the safe file:// form.
const TSX_LOADER_URL = pathToFileURL(
  join(PROJECT_ROOT, "node_modules", "tsx", "dist", "loader.mjs"),
).href;
const FIXTURE_DIR = resolve(
  import.meta.dirname,
  "..",
  "fixtures",
  "quality-history",
);
const disposables: string[] = [];

/** Bind retained fixture scores and findings to the disposable project that owns this history. */
function historyFixture(
  projectPath: string,
  id: string,
): Record<string, unknown> {
  const report = JSON.parse(
    readFileSync(join(FIXTURE_DIR, `${id}.json`), "utf8"),
  ) as Record<string, unknown>;
  return { ...report, project_path: projectPath };
}

/** Hash retained fixture bytes exactly as a report author does for evidence references. */
function digest(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Writes real Git objects, saved findings and a review capture with its authority fingerprint into a disposable project. */
function makeFixProject(
  source: string | Buffer = "export const corrected = true;\n",
) {
  const root = makeTempProject();
  // Plumbing creates only fixture objects; no user repository or branch is changed.
  const git = (args: string[], input?: string | Buffer) => {
    const result = captureProcess("git", ["-C", root, ...args], root, input);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(["init", "-b", "main"]);
  writeFileSync(join(root, ".gitignore"), ".goat-flow/logs/\n");
  writeFileSync(join(root, "rule.ts"), source);
  const blob = git(["hash-object", "-w", "--stdin"], source);
  const tree = git(["mktree"], `100644 blob ${blob}\trule.ts\n`);
  const revision = git([
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit-tree",
    tree,
    "-m",
    "Fixture",
  ]);
  git(["update-ref", "refs/heads/main", revision]);
  const raw = makeCurrentQualityReport(root, "Fixture evidence");
  raw.findings[0].concern = "constraints";
  const parsed = parseQualityReport(raw);
  assert.ok(parsed.ok);
  const report = parsed.report;
  const prior: QualityReport = {
    ...report,
    findings: [
      report.findings[0],
      { ...report.findings[0], summary: "Another finding" },
    ],
  };
  const priorId = "2026-09-01-0900-claude-aaaaa";
  const priorPath = join(root, ".goat-flow/logs/quality", `${priorId}.json`);
  const priorBytes = JSON.stringify(prior);
  writeFileSync(priorPath, priorBytes);
  const withIds = attachFindingIds(prior);
  assert.ok(withIds.ok);
  const capture = captureReviewSnapshot(
    JSON.stringify({
      schema: "goat-review-request/v1",
      source: { kind: "paths", paths: [{ path: "rule.ts", from: "live" }] },
    }),
    root,
  );
  const captureText = JSON.stringify(capture);
  const captureFile = ".goat-flow/logs/capture.json";
  writeFileSync(join(root, captureFile), captureText);
  const fix: QualityFix = {
    prior_report_id: priorId,
    finding_id: withIds.report.findings[0].id,
    conclusion: "assessor-verified",
    explanation:
      "The source now contains the corrected declaration cited by the original finding.",
    target: { kind: "commit", revision },
    evidence: {
      method: "static-analysis",
      file: "rule.ts",
      sha256: digest(source),
      summary: "The declaration is corrected.",
      anchor: "corrected = true",
    },
  };
  return {
    root,
    report,
    fix,
    priorPath,
    priorBytes,
    capture,
    captureFile,
    captureText,
    findingIds: withIds.report.findings.map((finding) => finding.id),
  };
}

/** Save through the same redaction, reference validation and exclusive writer used by the CLI. */
function saveFixReport(
  fixture: ReturnType<typeof makeFixProject>,
  fixes: QualityFix[],
): string {
  return persistQualityReportText(
    {
      projectPath: fixture.root,
      rawText: JSON.stringify({ ...fixture.report, fixes }),
    },
    { CLIError },
  );
}

after(() => {
  for (const dir of disposables) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("retained quality evidence admission", () => {
  it("rejects inconsistent agent identities while retaining valid history and fixes", () => {
    const fixture = makeFixProject();
    const validPath = saveFixReport(fixture, [fixture.fix]);
    const mismatchedId = "2026-09-01-0900-codex-aaaaa";
    writeFileSync(
      join(fixture.root, ".goat-flow/logs/quality", `${mismatchedId}.json`),
      fixture.priorBytes,
    );
    for (const history of [
      loadQualityHistory(fixture.root),
      loadQualityHistoryWindow(fixture.root, { agent: "codex", limit: 20 }),
    ]) {
      assert.ok(
        history.entries.every((entry) => entry.agent === entry.report.agent),
      );
      assert.ok(
        history.warnings.some((warning) =>
          warning.includes("report agent does not match filename agent"),
        ),
      );
    }
    assert.ok(
      loadQualityHistory(fixture.root).entries.some(
        (entry) => entry.path === validPath,
      ),
    );
    const saved = JSON.parse(
      readFileSync(
        saveFixReport(fixture, [
          fixture.fix,
          { ...fixture.fix, prior_report_id: mismatchedId },
        ]),
        "utf8",
      ),
    );
    assert.deepEqual(
      saved.fixes.map((fix: QualityFix) => fix.reference_check?.status),
      ["confirmed", "unconfirmed"],
    );
  });

  it("rejects correctly rehashed malformed captures without rejecting valid claims", () => {
    const fixture = makeFixProject();
    const mutations = [
      (capture: JsonRecord) => {
        const source = capture.source as JsonRecord;
        source.kind = "unsupported";
      },
      (capture: JsonRecord) => {
        const source = capture.source as JsonRecord;
        source.requested = {};
      },
      (capture: JsonRecord) => {
        capture.index = "invented";
      },
      (capture: JsonRecord) => {
        const rows = capture.inventory as JsonRecord[];
        delete (rows[0].new as JsonRecord).mode;
      },
      (capture: JsonRecord) => {
        const rows = capture.inventory as JsonRecord[];
        (rows[0].new as JsonRecord).from = "unsupported";
      },
      (capture: JsonRecord) => {
        const rows = capture.inventory as JsonRecord[];
        Object.assign(rows[0].new, { from: "index", blob: "a".repeat(40) });
      },
      (capture: JsonRecord) => {
        const rows = capture.inventory as JsonRecord[];
        rows.push(rows[0]);
      },
      (capture: JsonRecord) => {
        capture.renames = [{}];
      },
      (capture: JsonRecord) => {
        capture.workspace = "invented";
      },
    ];
    for (const mutate of mutations) {
      const capture = structuredClone(fixture.capture.authority);
      mutate(capture);
      const { fingerprint: _old, ...unsigned } = capture;
      capture.fingerprint = taggedHash("authority", unsigned);
      const text = JSON.stringify({ authority: capture });
      writeFileSync(join(fixture.root, fixture.captureFile), text);
      const saved = JSON.parse(
        readFileSync(
          saveFixReport(fixture, [
            fixture.fix,
            {
              ...fixture.fix,
              finding_id: fixture.findingIds[1],
              target: {
                kind: "workspace-snapshot",
                fingerprint: capture.fingerprint,
                capture: { file: fixture.captureFile, sha256: digest(text) },
              },
            },
          ]),
          "utf8",
        ),
      );
      assert.deepEqual(
        saved.fixes.map((fix: QualityFix) => fix.reference_check?.status),
        ["confirmed", "unconfirmed"],
      );
    }
  });
});

/** Writes an isolated project with just enough quality-log structure for CLI tests. */
function makeTempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-quality-cli-"));
  mkdirSync(join(root, ".goat-flow", "logs", "quality"), { recursive: true });
  disposables.push(root);
  return root;
}

/** Spawns a real child with private finite input/output files; failed launches retain a failing status. */
function captureProcess(
  binary: string,
  args: string[],
  cwd: string,
  input?: string | Buffer,
) {
  const capture = mkdtempSync(join(tmpdir(), "quality-history-output-"));
  disposables.push(capture);
  const descriptors: number[] = [];
  try {
    let stdin: number | "ignore" = "ignore";
    if (input !== undefined) {
      writeFileSync(join(capture, "stdin"), input, { flag: "wx", mode: 0o600 });
      stdin = openSync(join(capture, "stdin"), "r");
      descriptors.push(stdin);
    }
    const stdout = openSync(join(capture, "stdout"), "wx", 0o600);
    descriptors.push(stdout);
    const stderr = openSync(join(capture, "stderr"), "wx", 0o600);
    descriptors.push(stderr);
    const result = spawnSync(binary, args, {
      cwd,
      timeout: 20000,
      stdio: [stdin, stdout, stderr],
    });
    const completed =
      result.status !== null &&
      result.signal === null &&
      (!result.error || result.error.code === "EPERM");
    return {
      status: completed ? result.status : null,
      stdout: readFileSync(join(capture, "stdout"), "utf8"),
      stderr:
        readFileSync(join(capture, "stderr"), "utf8") +
        (completed ? "" : String(result.error ?? result.signal)),
    };
  } finally {
    for (const descriptor of descriptors) closeSync(descriptor);
  }
}

// Spawns the real CLI so the suite asserts on the output a user sees, not on an internal call.
function runCLI(
  cwd: string,
  args: string[],
): { status: number | null; stdout: string; stderr: string } {
  return captureProcess(
    process.execPath,
    ["--import", TSX_LOADER_URL, CLI_PATH, ...args],
    cwd,
  );
}

describe("quality history and diff CLI", () => {
  it("accepts prior reports saved through project aliases and rejects another project", () => {
    const fixture = makeFixProject();
    const alias = join(makeTempProject(), "selected");
    symlinkSync(
      fixture.root,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    const prior = JSON.parse(fixture.priorBytes);
    const aliasedPrior = JSON.stringify({ ...prior, project_path: alias });
    writeFileSync(fixture.priorPath, aliasedPrior);
    const saved = saveFixReport(fixture, [fixture.fix]);
    const savedBytes = readFileSync(saved, "utf8");
    assert.equal(
      JSON.parse(savedBytes).fixes[0].reference_check.status,
      "confirmed",
    );
    const history = runCLI(fixture.root, ["quality", "history", "--all"]);
    assert.equal(history.status, 0, history.stderr);
    const current = JSON.parse(history.stdout).reports.find(
      (entry: { path: string }) => entry.path === saved,
    );
    assert.equal(current.fixRecords[0].evidence_availability, "available");
    assert.equal(readFileSync(fixture.priorPath, "utf8"), aliasedPrior);
    assert.equal(readFileSync(saved, "utf8"), savedBytes);

    const foreignPrior = JSON.stringify({
      ...prior,
      project_path: makeTempProject(),
    });
    writeFileSync(fixture.priorPath, foreignPrior);
    const rejected = saveFixReport(fixture, [fixture.fix]);
    assert.equal(
      JSON.parse(readFileSync(rejected, "utf8")).fixes[0].reference_check
        .status,
      "unconfirmed",
    );
    assert.equal(readFileSync(fixture.priorPath, "utf8"), foreignPrior);
  });

  // Writes the result file only after admission; history must not rewrite or promote that admission.
  it("reports restored references as available without promoting an unconfirmed fix", () => {
    const fixture = makeFixProject();
    const proofFile = ".goat-flow/logs/restored-result.txt";
    const proof = "original reproduction and control results\n";
    const fix: QualityFix = {
      ...fixture.fix,
      evidence: {
        method: "runtime-probe",
        file: proofFile,
        sha256: digest(proof),
        summary: "Retained reproduction and control results.",
        command: "fixture probe",
        exit_code: 0,
      },
    };
    const saved = saveFixReport(fixture, [fix]);
    const savedBytes = readFileSync(saved, "utf8");
    assert.equal(
      JSON.parse(savedBytes).fixes[0].reference_check.status,
      "unconfirmed",
    );
    writeFileSync(join(fixture.root, proofFile), proof);
    const history = runCLI(fixture.root, ["quality", "history", "--all"]);
    assert.equal(history.status, 0, history.stderr);
    const current = JSON.parse(history.stdout).reports.find(
      (entry: { path: string }) => entry.path === saved,
    );
    assert.equal(current.fixRecords[0].status, "unconfirmed");
    assert.equal(current.fixRecords[0].evidence_availability, "available");
    assert.equal(current.fixRecords[0].fix.conclusion, "assessor-verified");
    assert.equal(readFileSync(saved, "utf8"), savedBytes);
    assert.equal(readFileSync(fixture.priorPath, "utf8"), fixture.priorBytes);
  });

  // Writes a capture re-fingerprinted after its source field was removed; it must still be rejected as fix evidence.
  it("rejects a workspace capture missing source identity even when its hashes match", () => {
    const fixture = makeFixProject();
    const {
      fingerprint: _fingerprint,
      source: _source,
      ...unsigned
    } = fixture.capture.authority;
    const fingerprint = taggedHash("authority", unsigned);
    const malformed = JSON.stringify({ ...unsigned, fingerprint });
    writeFileSync(join(fixture.root, fixture.captureFile), malformed);
    const proofFile = ".goat-flow/logs/result.txt";
    const proof = "retained reproduction results\n";
    writeFileSync(join(fixture.root, proofFile), proof);
    const saved = saveFixReport(fixture, [
      {
        ...fixture.fix,
        target: {
          kind: "workspace-snapshot",
          fingerprint,
          capture: { file: fixture.captureFile, sha256: digest(malformed) },
        },
        evidence: {
          method: "runtime-probe",
          file: proofFile,
          sha256: digest(proof),
          summary: "Retained reproduction results.",
          command: "fixture probe",
          exit_code: 0,
        },
      },
    ]);
    assert.equal(
      JSON.parse(readFileSync(saved, "utf8")).fixes[0].reference_check.status,
      "unconfirmed",
    );
  });

  it("hashes original evidence bytes before decoding Git source or runtime output", () => {
    const source = Buffer.concat([
      Buffer.from("export const corrected = true;\n"),
      Buffer.from([0xff]),
    ]);
    const fixture = makeFixProject(source);
    assert.ok(fixture.fix.evidence);
    const proofFile = ".goat-flow/logs/result.txt";
    writeFileSync(join(fixture.root, proofFile), source);
    const runtimeFix: QualityFix = {
      ...fixture.fix,
      evidence: {
        method: "runtime-probe",
        file: proofFile,
        sha256: digest(source),
        summary: "Original failure and control results retained.",
        command: "fixture probe",
        exit_code: 0,
      },
    };
    for (const fix of [fixture.fix, runtimeFix]) {
      const saved = JSON.parse(
        readFileSync(saveFixReport(fixture, [fix]), "utf8"),
      );
      assert.equal(
        saved.fixes[0].reference_check.status,
        "confirmed",
        fix.evidence?.method,
      );
      assert.ok(fix.evidence);
      const normalized = {
        ...fix,
        evidence: { ...fix.evidence, sha256: digest(source.toString("utf8")) },
      };
      const rejected = JSON.parse(
        readFileSync(saveFixReport(fixture, [normalized]), "utf8"),
      );
      assert.equal(
        rejected.fixes[0].reference_check.status,
        "unconfirmed",
        fix.evidence.method,
      );
    }
  });

  // Writes a later edit to the fixed file, which must not change how history shows the saved report's concern counts and committed proof.
  it("shows concern counts and committed proof at its recorded revision without rewriting history", () => {
    const fixture = makeFixProject();
    const saved = saveFixReport(fixture, [fixture.fix]);
    const savedBytes = readFileSync(saved, "utf8");
    writeFileSync(
      join(fixture.root, "rule.ts"),
      "export const laterEdit = true;\n",
    );
    const history = runCLI(fixture.root, [
      "quality",
      "history",
      "--all",
      "--format",
      "json",
    ]);
    assert.equal(history.status, 0, history.stderr);
    const current = JSON.parse(history.stdout).reports.find(
      (entry: { path: string }) => entry.path === saved,
    );
    assert.equal(current.concernCounts.constraints, 1);
    assert.equal(current.concernCounts.unclassified, 0);
    assert.equal(current.fixRecords[0].status, "assessor-verified");
    assert.equal(current.fixRecords[0].evidence_availability, "available");
    assert.deepEqual(current.fixRecords[0].assessor, {
      agent: "claude",
      report_id: current.id,
    });
    const diff = runCLI(fixture.root, [
      "quality",
      "diff",
      `${fixture.fix.prior_report_id}:${current.id}`,
      "--format",
      "json",
    ]);
    assert.equal(diff.status, 0, diff.stderr);
    assert.equal(JSON.parse(diff.stdout).to.concernCounts.constraints, 1);
    const text = runCLI(fixture.root, [
      "quality",
      "diff",
      `${fixture.fix.prior_report_id}:${current.id}`,
      "--format",
      "text",
    ]);
    assert.equal(text.status, 0, text.stderr);
    assert.match(
      text.stdout,
      /reported findings by concern:.*constraints 1.*not all open defects/u,
    );
    assert.match(text.stdout, /assessor-verified:.*committed/u);
    assert.equal(readFileSync(fixture.priorPath, "utf8"), fixture.priorBytes);
    assert.equal(readFileSync(saved, "utf8"), savedBytes);
  });

  // Writes over the captured bytes after saving; workspace static proof stays bound to the capture, so the saved conclusion must not change.
  it("binds workspace static proof to captured bytes and retains the conclusion after those bytes change", () => {
    const fixture = makeFixProject();
    const fix: QualityFix = {
      ...fixture.fix,
      target: {
        kind: "workspace-snapshot",
        fingerprint: fixture.capture.authority.fingerprint,
        capture: {
          file: fixture.captureFile,
          sha256: digest(fixture.captureText),
        },
      },
    };
    const saved = saveFixReport(fixture, [fix]);
    const savedBytes = readFileSync(saved, "utf8");
    assert.equal(
      JSON.parse(savedBytes).fixes[0].reference_check.status,
      "confirmed",
    );
    const changedSource = "export const corrected = false;\n";
    writeFileSync(join(fixture.root, "rule.ts"), changedSource);
    assert.ok(fix.evidence);
    const mismatched = saveFixReport(fixture, [
      {
        ...fix,
        evidence: {
          ...fix.evidence,
          sha256: digest(changedSource),
          anchor: "corrected = false",
        },
      },
    ]);
    assert.equal(
      JSON.parse(readFileSync(mismatched, "utf8")).fixes[0].reference_check
        .status,
      "unconfirmed",
    );
    const history = runCLI(fixture.root, [
      "quality",
      "history",
      "--all",
      "--format",
      "json",
    ]);
    assert.equal(history.status, 0, history.stderr);
    const current = JSON.parse(history.stdout).reports.find(
      (entry: { path: string }) => entry.path === saved,
    );
    assert.equal(current.fixRecords[0].status, "assessor-verified");
    assert.equal(
      current.fixRecords[0].warning,
      "evidence unavailable; not reverified",
    );
    assert.equal(readFileSync(saved, "utf8"), savedBytes);
  });

  for (const lostReference of ["capture", "evidence"] as const) {
    it(`retains workspace conclusions after ${lostReference} loss without executing saved commands`, () => {
      const fixture = makeFixProject();
      const proofFile = ".goat-flow/logs/reproduction.txt";
      const proof = "reproduction: prior failure absent; control passes\n";
      writeFileSync(join(fixture.root, proofFile), proof);
      const marker = join(fixture.root, "COMMAND_MUST_NOT_RUN");
      const fix: QualityFix = {
        ...fixture.fix,
        target: {
          kind: "workspace-snapshot",
          fingerprint: fixture.capture.authority.fingerprint,
          capture: {
            file: fixture.captureFile,
            sha256: digest(fixture.captureText),
          },
        },
        evidence: {
          method: "runtime-probe",
          file: proofFile,
          sha256: digest(proof),
          summary: "Original failure is absent and control passes.",
          command: `node -e "require('fs').writeFileSync('${marker}', 'bad')"`,
          exit_code: 0,
        },
      };
      const saved = saveFixReport(fixture, [fix]);
      const savedBytes = readFileSync(saved, "utf8");
      assert.equal(
        JSON.parse(savedBytes).fixes[0].reference_check.status,
        "confirmed",
      );
      const before = runCLI(fixture.root, [
        "quality",
        "history",
        "--all",
        "--format",
        "text",
      ]);
      assert.equal(before.status, 0, before.stderr);
      assert.match(before.stdout, /workspace snapshot/u);
      assert.doesNotMatch(
        before.stdout,
        /evidence unavailable; not reverified/u,
      );
      rmSync(
        join(
          fixture.root,
          lostReference === "capture" ? fixture.captureFile : proofFile,
        ),
      );
      const after = runCLI(fixture.root, [
        "quality",
        "history",
        "--all",
        "--format",
        "json",
      ]);
      assert.equal(after.status, 0, after.stderr);
      const current = JSON.parse(after.stdout).reports.find(
        (entry: { path: string }) => entry.path === saved,
      );
      assert.equal(current.fixRecords[0].status, "assessor-verified");
      assert.equal(
        current.fixRecords[0].warning,
        "evidence unavailable; not reverified",
      );
      const text = runCLI(fixture.root, [
        "quality",
        "history",
        "--all",
        "--format",
        "text",
      ]);
      assert.equal(text.status, 0, text.stderr);
      assert.match(text.stdout, /evidence unavailable; not reverified/u);
      assert.equal(existsSync(marker), false);
      assert.equal(readFileSync(saved, "utf8"), savedBytes);
      assert.equal(readFileSync(fixture.priorPath, "utf8"), fixture.priorBytes);
    });
  }

  it("keeps unsupported claims unconfirmed and allows shared proof for distinct findings", () => {
    const fixture = makeFixProject();
    const evidence = fixture.fix.evidence;
    assert.ok(evidence);
    const unsupported: QualityFix[] = [
      { ...fixture.fix, prior_report_id: "2026-09-01-0900-claude-miss1" },
      { ...fixture.fix, finding_id: "missing-finding" },
      { ...fixture.fix, target: null },
      { ...fixture.fix, evidence: null },
      { ...fixture.fix, explanation: null },
      { ...fixture.fix, evidence: { ...evidence, anchor: undefined } },
      { ...fixture.fix, evidence: { ...evidence, file: "../rule.ts" } },
      {
        ...fixture.fix,
        evidence: { ...evidence, sha256: "0".repeat(64) },
      },
      {
        ...fixture.fix,
        evidence: { ...evidence, method: "runtime-probe" },
      },
    ];
    for (const claim of unsupported) {
      const saved = JSON.parse(
        readFileSync(saveFixReport(fixture, [claim]), "utf8"),
      );
      assert.equal(
        saved.fixes[0].reference_check.status,
        "unconfirmed",
        JSON.stringify(claim),
      );
      assert.equal(
        saved.fixes[0].conclusion,
        "assessor-verified",
        `claim ${JSON.stringify(claim)}`,
      );
    }
    const duplicates = JSON.parse(
      readFileSync(saveFixReport(fixture, [fixture.fix, fixture.fix]), "utf8"),
    );
    assert.deepEqual(
      duplicates.fixes.map((fix: QualityFix) => fix.reference_check?.status),
      ["unconfirmed", "unconfirmed"],
    );
    const shared = JSON.parse(
      readFileSync(
        saveFixReport(fixture, [
          fixture.fix,
          { ...fixture.fix, finding_id: fixture.findingIds[1] },
        ]),
        "utf8",
      ),
    );
    assert.deepEqual(
      shared.fixes.map((fix: QualityFix) => fix.reference_check?.status),
      ["confirmed", "confirmed"],
    );
    assert.equal(readFileSync(fixture.priorPath, "utf8"), fixture.priorBytes);
  });

  // Writes three saved reports straddling a rubric change; deltas across that boundary are suppressed while legacy fields stay readable.
  it("retains legacy fields and suppresses setup/system deltas at the new rubric boundary", () => {
    const root = makeTempProject();
    const ids = [
      "2026-04-01-0900-claude-aaaaa",
      "2026-04-15-1000-claude-bbbbb",
      "2026-04-29-1100-claude-ccccc",
    ];
    for (const [index, id] of ids.entries()) {
      const report = historyFixture(root, id);
      if (index === 1) report.rubric_version = "1.17.0";
      if (index === 2)
        report.rubric_version = getQualityRubricId("agent-setup");
      writeFileSync(
        join(root, ".goat-flow/logs/quality", `${id}.json`),
        JSON.stringify(report),
      );
    }
    const history = runCLI(root, [
      "quality",
      "history",
      "--agent",
      "claude",
      "--format",
      "json",
    ]);
    assert.equal(history.status, 0, history.stderr);
    const payload = JSON.parse(history.stdout);
    assert.deepEqual(
      payload.deltas.map(
        (row: { setup_delta: number | null; system_delta: number | null }) => [
          row.setup_delta,
          row.system_delta,
        ],
      ),
      [
        [null, null],
        [10, 5],
        [null, null],
      ],
    );
    assert.equal(payload.reports[1].report.rubric_version, "1.17.0");
    assert.equal(
      Object.hasOwn(payload.reports[2].report, "rubric_version"),
      false,
    );
    const diff = runCLI(root, [
      "quality",
      "diff",
      `${ids[0]}:${ids[1]}`,
      "--format",
      "json",
    ]);
    assert.equal(diff.status, 0, diff.stderr);
    const warnings: string[] = JSON.parse(diff.stdout).comparisonWarnings;
    assert.equal(
      warnings.filter((w) => w.startsWith("Legacy rubric")).length,
      1,
    );
    assert.equal(
      warnings.some((w) => w.startsWith("Assessment rubric")),
      false,
    );
  });

  // Fixture writes three saved reports because history and explicit diff selection need chronological data.
  it("renders history text and filtered history/diff json from saved reports", () => {
    const root = makeTempProject();
    // Fixture spans three reports so history, filtering, and diff selection all
    // exercise chronological ordering instead of a single saved-report read.
    const fixtures = [
      "2026-04-01-0900-claude-aaaaa",
      "2026-04-15-1000-claude-bbbbb",
      "2026-04-29-1100-claude-ccccc",
    ];
    for (const id of fixtures) {
      writeFileSync(
        join(root, ".goat-flow", "logs", "quality", `${id}.json`),
        JSON.stringify(historyFixture(root, id)),
        "utf-8",
      );
    }
    const currentReportPath = join(
      root,
      ".goat-flow",
      "logs",
      "quality",
      "2026-04-29-1100-claude-ccccc.json",
    );
    const currentReport = JSON.parse(readFileSync(currentReportPath, "utf-8"));
    currentReport.score_rationale = makeQualityScoreRationale();
    writeFileSync(
      currentReportPath,
      `${JSON.stringify(currentReport, null, 2)}\n`,
      "utf-8",
    );
    // Seed a codex-agent entry by cloning the latest claude fixture so history
    // filtering has cross-agent data to discriminate.
    const codexSource = historyFixture(root, "2026-04-29-1100-claude-ccccc");
    writeFileSync(
      join(
        root,
        ".goat-flow",
        "logs",
        "quality",
        "2026-04-20-1200-codex-ddddd.json",
      ),
      `${JSON.stringify(
        {
          ...codexSource,
          agent: "codex",
          run_date: "2026-04-20",
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );

    const history = runCLI(root, [
      "quality",
      "history",
      "--agent",
      "claude",
      "--format",
      "text",
    ]);
    assert.equal(history.status, 0, history.stderr);
    assert.match(
      history.stdout,
      /2026-04-29 \| claude \| agent-setup \| 85 \(\+5\) \[no comparable reruns\] \| 80 \(\+5\) \[no comparable reruns\] \| 1 \| 1 \| 0/,
    );
    assert.match(history.stdout, /Use `--all` to lift the 20-run default/i);
    assert.match(history.stdout, /Score rationale/u);
    assert.match(
      history.stdout,
      /2026-04-29-1100-claude-ccccc[\s\S]*setup\.accuracy 25\/25[\s\S]*evidence: The cited source and runtime evidence support this axis score\./u,
    );
    assert.match(
      history.stdout,
      /2026-04-15-1000-claude-bbbbb[\s\S]*rationale unavailable \(legacy report\)/u,
    );

    const historyJson = runCLI(root, [
      "quality",
      "history",
      "--agent",
      "claude",
      "--format",
      "json",
    ]);
    assert.equal(historyJson.status, 0, historyJson.stderr);
    const historyPayload = JSON.parse(historyJson.stdout);
    assert.deepEqual(
      historyPayload.reports.map((report: { report: { agent: string } }) => {
        return report.report.agent;
      }),
      ["claude", "claude", "claude"],
    );
    assert.deepEqual(
      historyPayload.deltas.map((delta: { id: string }) => delta.id),
      [
        "2026-04-29-1100-claude-ccccc",
        "2026-04-15-1000-claude-bbbbb",
        "2026-04-01-0900-claude-aaaaa",
      ],
    );
    assert.deepEqual(
      historyPayload.reports[0].report.score_rationale,
      makeQualityScoreRationale(),
    );
    assert.equal(
      Object.hasOwn(historyPayload.reports[1].report, "score_rationale"),
      false,
    );

    const diff = runCLI(root, [
      "quality",
      "diff",
      "2026-04-01-0900-claude-aaaaa:2026-04-15-1000-claude-bbbbb",
      "--format",
      "json",
    ]);
    assert.equal(diff.status, 0, diff.stderr);
    const diffPayload = JSON.parse(diff.stdout);
    assert.equal(diffPayload.absent.length, 1);
    assert.equal(diffPayload.newFindings.length, 1);
    assert.equal(diffPayload.persisted.length, 1);
    assert.equal(diffPayload.from.id, "2026-04-01-0900-claude-aaaaa");
    assert.equal(diffPayload.to.id, "2026-04-15-1000-claude-bbbbb");

    const diffText = runCLI(root, [
      "quality",
      "diff",
      "2026-04-15-1000-claude-bbbbb:2026-04-29-1100-claude-ccccc",
      "--format",
      "text",
    ]);
    assert.equal(diffText.status, 0, diffText.stderr);
    assert.match(
      diffText.stdout,
      /Setup 80\/100 → 85\/100 \(\+5\)\. System 75\/100 → 80\/100 \(\+5\)\./u,
    );
    assert.match(
      diffText.stdout,
      /From 2026-04-15-1000-claude-bbbbb[\s\S]*rationale unavailable \(legacy report\)/u,
    );
    assert.match(
      diffText.stdout,
      /To 2026-04-29-1100-claude-ccccc[\s\S]*system\.learnability 20\/25[\s\S]*deduction: The cited rating-band evidence explains the points deducted\./u,
    );
  });

  // Fixture writes mode variants because cross-mode diffs must not pair implicitly by timestamp.
  it("filters history by quality mode and rejects implicit cross-mode diffs", () => {
    const root = makeTempProject();
    // Fixture uses two mode variants with matching timestamps so implicit diff
    // selection must reject cross-mode comparisons instead of pairing by date.
    const first = historyFixture(root, "2026-04-01-0900-claude-aaaaa");
    const second = historyFixture(root, "2026-04-15-1000-claude-bbbbb");
    writeFileSync(
      join(
        root,
        ".goat-flow",
        "logs",
        "quality",
        "2026-04-25-0900-claude-ppppp.json",
      ),
      `${JSON.stringify({ ...first, quality_mode: "process" }, null, 2)}\n`,
      "utf-8",
    );
    writeFileSync(
      join(
        root,
        ".goat-flow",
        "logs",
        "quality",
        "2026-04-25-1000-claude-sssss.json",
      ),
      `${JSON.stringify({ ...second, quality_mode: "skills" }, null, 2)}\n`,
      "utf-8",
    );

    const history = runCLI(root, [
      "quality",
      "history",
      "--agent",
      "claude",
      "--mode",
      "skills",
      "--format",
      "json",
    ]);
    assert.equal(history.status, 0, history.stderr);
    const historyPayload = JSON.parse(history.stdout);
    assert.deepEqual(
      historyPayload.reports.map(
        (report: { report: { quality_mode: string } }) =>
          report.report.quality_mode,
      ),
      ["skills"],
    );

    const implicitDiff = runCLI(root, [
      "quality",
      "diff",
      "--agent",
      "claude",
      "--format",
      "json",
    ]);
    const expectedModeRequiredExitCode = 2;
    assert.equal(implicitDiff.status, expectedModeRequiredExitCode);
    assert.match(implicitDiff.stderr, /Pass --mode to diff one quality mode/i);
  });
});
