/** Frozen Bash execution controls; native common-runner proof lives separately. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  assertOutcome,
  extractSelfTests,
  loadArtifacts,
  materializeReference,
  runFrozen,
  validateSnapshot,
} from "../../scripts/check-hook-parity.mjs";

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
        // The frozen Unicode parser needs a longer Linux window; its original
        // input and verdict assertions remain the acceptance criteria.
        const timeoutMs =
          process.platform === "linux" &&
          locale === "C.UTF-8" &&
          row.id === "contract-locale-sentinel-deny-dangerous"
            ? 120_000
            : 30_000;
        assertOutcome(
          runFrozen(
            project,
            row.policy,
            row.input,
            locale,
            row.setup.environment,
            row.id,
            timeoutMs,
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
