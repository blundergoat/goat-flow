/**
 * Check the frozen Bash evidence runner a maintainer uses to investigate hook-policy differences.
 *
 * Exercise report mode, strict acceptance, fixture setup, and unavailable dependencies in disposable projects.
 * Native common-runner delivery has separate coverage; these cases verify the frozen reference transport.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  assertOutcome,
  compareExtraRows,
  extractSelfTests,
  loadArtifacts,
  materializeReference,
  runFrozen,
  runFrozenRow,
  validateSnapshot,
} from "../../scripts/check-hook-parity.mjs";

// A maintainer requesting a difference report still needs later cases to run after a completed sentinel mismatch.
// Writes a disposable reference tree, spawns frozen Bash, and removes the temporary project after comparison.
test("supplemental divergence reports sentinel status mismatches and visits later rows", () => {
  const pair = loadArtifacts();
  const sentinel = pair.corpus.rows.find(
    (row) => row.origin.kind === "locale-sentinel",
  );
  assert.ok(sentinel);
  const changed = {
    ...sentinel,
    input: { kind: "check", command: "echo safe" },
  };
  const following = {
    ...changed,
    id: `${sentinel.id}-following`,
    origin: { kind: "fixture" },
  };
  const project = materializeReference();
  try {
    const clean = runFrozen(project, changed.policy, changed.input, "C");
    assert.equal(clean.status, 0);
    const original = pair.reference.rows.find((row) => row.id === sentinel.id);
    assert.ok(original);
    const comparison = {
      originals: new Map([
        [changed.id, original],
        [following.id, { original: { C: clean } }],
      ]),
      selected: new Set([changed.id, following.id]),
      options: { listDivergent: true },
      divergences: [] as { id: string; message: string }[],
    };
    const seen = new Set<string>();
    compareExtraRows(project, [changed, following], comparison, seen, "C");
    assert.equal(comparison.divergences.length, 1);
    assert.equal(comparison.divergences[0].id, changed.id);
    assert.match(comparison.divergences[0].message, /locale sentinel/u);
    assert.deepEqual([...seen], [changed.id, following.id]);
    assert.throws(
      () =>
        compareExtraRows(
          project,
          [changed, following],
          { ...comparison, options: { listDivergent: false } },
          new Set(),
          "C",
        ),
      /locale sentinel/u,
    );
    assert.throws(
      () =>
        compareExtraRows(
          project,
          [
            {
              ...changed,
              setup: { ...changed.setup, cwd: "$REFERENCE/missing-root" },
            },
          ],
          comparison,
          new Set(),
          "C",
        ),
      /Frozen launch failed/u,
    );
    assert.equal(comparison.divergences.length, 1);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

// An injected failure proves that report mode retains original assertion evidence while strict acceptance refuses the run.
// Writes a fault into the temporary self-test, spawns Bash, and removes the project and returned failure journal.
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
  // No retained failure journal exists until extraction returns its diagnostic directory.
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
    // A failed-assertion journal lives outside the disposable project and needs its own cleanup when returned.
    if (diagnostics) rmSync(diagnostics, { recursive: true, force: true });
  }
});

// A maintainer comparing hosts must preserve long command and UNC-path bytes across both frozen locales.
// Writes a disposable reference tree, spawns each policy under both locales, and removes the temporary project.
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
    // Exercise both locale decoders because the same user-supplied bytes can reach different parser limits.
    for (const locale of ["C", "C.UTF-8"]) {
      // Each selected frozen case must retain its original input and saved decision on this host.
      for (const row of rows) {
        // Allow the slower Linux Unicode sentinel to finish while preserving its original input and verdict assertions.
        const timeoutMs =
          process.platform === "linux" &&
          locale === "C.UTF-8" &&
          row.origin.kind === "locale-sentinel"
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

// A broken installed hook must report unavailable rather than borrow a working helper from the maintainer's live source.
// Writes a reference tree, removes one installed helper, and spawns Bash to check the unavailable response.
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

// The same command can resolve to a blocked Git alias only after the runner restores the user's recorded working directory.
// Writes fixture Git configuration in a temporary project and spawns Bash to compare alias handling.
test("supplemental reference rows use fixture cwd and relative Git configuration", () => {
  const project = materializeReference();
  const row = {
    id: "relative-alias-fixture",
    policy: "deny-git-mutations",
    input: { kind: "check", command: "git pub" },
    setup: {
      cwd: "$FIXTURE0",
      environment: { GIT_CONFIG_GLOBAL: "fixture.gitconfig" },
      files: [
        {
          token: "$FIXTURE0",
          files: [
            {
              path: "fixture.gitconfig",
              kind: "file",
              bytesBase64: Buffer.from("[alias]\npub=push\n").toString(
                "base64",
              ),
            },
          ],
        },
      ],
    },
  };
  try {
    assert.equal(runFrozen(project, row.policy, row.input).status, 0);
    const actual = runFrozenRow(project, row);
    assert.equal(actual.status, 2);
    assert.match(
      Buffer.from(actual.stderrBase64, "base64").toString(),
      /BLOCKED: Policy/u,
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
