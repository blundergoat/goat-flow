/** Guards the frozen oracle, complete coverage and the shipped corpus boundary. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  assertOutcome,
  assertMirrorBytes,
  checkPackInventory,
  extractSelfTests,
  loadArtifacts,
  materializeReference,
  parseOptions,
  runFrozen,
  validateCorpora,
  validateSnapshot,
} from "../../scripts/check-hook-parity.mjs";

const root = resolve(import.meta.dirname, "../..");

// Mutations model distinct ways a port can silently lose reference coverage.
// They affect cloned JSON only; no test can repair or rewrite the saved oracle.
function damagePair(pair, kind: string) {
  const row = pair.corpus.rows[0];
  switch (kind) {
    case "missing candidate":
      pair.corpus.rows.pop();
      break;
    case "missing reference":
      pair.reference.rows.pop();
      break;
    case "duplicate identity":
      pair.corpus.rows[1].id = row.id;
      break;
    case "orphaned candidate":
      row.id = "unrecorded-case";
      break;
    case "orphaned reference":
      pair.reference.rows[0].id = "unrecorded-case";
      break;
    case "input drift":
      row.input.command = "echo changed";
      break;
    case "reference input drift":
      pair.reference.rows[0].inputSha256 = "changed";
      break;
    case "candidate outcome drift":
      row.expected.status = 123;
      break;
    case "unknown exception":
      row.exceptionId = "approve-anything";
      break;
    case "missing locale":
      delete pair.reference.rows[0].original.C;
      break;
    case "incomplete coverage":
      pair.corpus.rows.pop();
      pair.reference.rows.pop();
      pair.corpus.caseCount--;
      pair.reference.caseCount--;
      break;
    default:
      throw new Error(`unknown damage: ${kind}`);
  }
}

test("saved pair binds every original case and both mirror bytes", () => {
  const pair = loadArtifacts();
  assert.deepEqual(
    validateCorpora(pair.corpus, pair.reference, pair.snapshot),
    {
      cases: pair.corpus.caseCount,
      policies: 2,
    },
  );
});

test("divergence captures failed original assertions without allowing acceptance", () => {
  const project = materializeReference();
  const source = join(
    project,
    "workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh",
  );
  const before = readFileSync(source, "utf8");
  const marker = 'expect_allow shell "echo safe"';
  assert(
    before.includes(marker),
    "real smoke assertion exists before fault injection",
  );
  writeFileSync(
    source,
    before.replace(marker, 'expect_block shell "echo safe"'),
  );
  let diagnostics: string | null = null;
  try {
    assert.throws(
      () => extractSelfTests(project, "C", "smoke", "deny-dangerous"),
      /original deny-dangerous/,
    );
    const report = extractSelfTests(
      project,
      "C",
      "smoke",
      "deny-dangerous",
      true,
    );
    diagnostics = report.diagnosticsDirectory;
    assert.equal(report.failed, 1);
    const expectedAssertions =
      validateSnapshot().generatedRowCounts.C["deny-dangerous"].smoke.executed;
    assert.equal(report.executed, expectedAssertions);
    assert.equal(report.records.length, expectedAssertions);
    assert(
      diagnostics,
      "failed original journal remains available for diagnosis",
    );
    assert.equal(
      readFileSync(source, "utf8"),
      before.replace(marker, 'expect_block shell "echo safe"'),
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
    if (diagnostics) rmSync(diagnostics, { recursive: true, force: true });
  }
});

for (const kind of [
  "missing candidate",
  "missing reference",
  "duplicate identity",
  "orphaned candidate",
  "orphaned reference",
  "input drift",
  "reference input drift",
  "candidate outcome drift",
  "unknown exception",
  "missing locale",
  "incomplete coverage",
]) {
  test(`rejects ${kind}`, () => {
    const pair = structuredClone(loadArtifacts());
    damagePair(pair, kind);
    assert.throws(() =>
      validateCorpora(pair.corpus, pair.reference, pair.snapshot),
    );
  });
}

test("frozen launches preserve long and UNC literal inputs in both locales", () => {
  const pair = loadArtifacts();
  const labels = new Set([
    "Windows UNC AWS credentials",
    "large unquoted quality heredoc stays blocked",
    "generic long command stays blocked",
  ]);
  const rows = pair.corpus.rows.filter(
    (row) =>
      row.origin.kind === "locale-sentinel" || labels.has(row.origin.label),
  );
  assert.equal(
    rows.length,
    5,
    "three observed launch cases and both sentinels",
  );
  const originals = new Map(pair.reference.rows.map((row) => [row.id, row]));
  const project = materializeReference();
  try {
    for (const locale of ["C", "C.UTF-8"]) {
      for (const row of rows) {
        assertOutcome(
          runFrozen(
            project,
            row.policy,
            row.input,
            locale,
            row.setup.environment,
          ),
          originals.get(row.id).original[locale],
          true,
          row.id,
        );
      }
    }
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("ordinary allow and block cases reject unavailable instead of agreeing", () => {
  const unavailable = {
    status: 2,
    stdoutBase64: "",
    stderrBase64: Buffer.from("Policy hook unavailable").toString("base64"),
  };
  assert.throws(() => assertOutcome(unavailable, unavailable), /unavailable/);
  assert.throws(
    () =>
      assertOutcome(
        { ...unavailable, status: 0 },
        { ...unavailable, status: 0 },
      ),
    /unavailable/,
  );
  const provider = {
    status: 0,
    stdoutBase64: Buffer.from('{"decision":"allow"}').toString("base64"),
    stderrBase64: "",
  };
  assert.throws(() =>
    assertOutcome(
      {
        ...provider,
        stdoutBase64: Buffer.from("broken JSON").toString("base64"),
      },
      provider,
    ),
  );
});

test("acceptance filters and unavailable candidate stages fail through the CLI", () => {
  const filtered = spawnSync(
    process.execPath,
    ["scripts/check-hook-parity.mjs", "--require-complete", "--case=anything"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(filtered.status, 1);
  assert.match(filtered.stderr, /complete acceptance rejects case filters/);
  const candidate = spawnSync(
    process.execPath,
    [
      "scripts/check-hook-parity.mjs",
      "--stage=candidate",
      "--require-complete",
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(candidate.status, 1);
  assert.match(candidate.stderr, /candidate runtime unavailable/);
  assert.throws(
    () => parseOptions(["--require-complete", "--list-divergent"]),
    /not acceptance/,
  );
});

test("frozen dependency lookup cannot recover a missing installed helper from live source", () => {
  const project = materializeReference();
  try {
    const before = runFrozen(project, "deny-dangerous", {
      command: "echo safe",
    });
    assert.equal(before.status, 0);
    rmSync(join(project, ".goat-flow/hooks/deny-dangerous/guard-runtime.sh"));
    const missing = runFrozen(project, "deny-dangerous", {
      command: "echo safe",
    });
    assert.equal(missing.status, 2);
    assert.match(
      Buffer.from(missing.stderrBase64, "base64").toString(),
      /Policy hook unavailable/,
    );
    assert.throws(() => assertOutcome(missing, before), /unavailable/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("mirror validation rejects byte drift and npm excludes frozen references", () => {
  const bytes = readFileSync(
    join(root, "workflow/hooks/deny-dangerous/corpus.json"),
  );
  assertMirrorBytes(bytes, bytes);
  assert.throws(
    () => assertMirrorBytes(bytes, Buffer.concat([bytes, Buffer.from("\n")])),
    /mirror bytes/,
  );
  assert(checkPackInventory() > 0);
});

test("frozen hash validation rejects a changed dependency in a disposable copy", () => {
  const project = materializeReference();
  try {
    writeFileSync(
      join(project, "snapshot.json"),
      readFileSync(join(root, "test/fixtures/hooks-bash/snapshot.json")),
    );
    validateSnapshot(project);
    writeFileSync(
      join(project, ".goat-flow/hooks/vendor/graphql.cjs"),
      "changed",
    );
    assert.throws(() => validateSnapshot(project), /frozen length|frozen hash/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
