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
  compareCandidate,
  loadArtifacts,
  materializeReference,
  parseOptions,
  validateCorpora,
  validateSnapshot,
} from "../../scripts/check-hook-parity.mjs";

const root = resolve(import.meta.dirname, "../..");
// JSON-only mutations share this validated input; filesystem corruption is checked separately.
const validatedArtifacts = loadArtifacts();

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
  const pair = validatedArtifacts;
  assert.deepEqual(
    validateCorpora(pair.corpus, pair.reference, pair.snapshot),
    {
      cases: pair.corpus.caseCount,
      policies: 2,
    },
  );
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
    const pair = structuredClone(validatedArtifacts);
    damagePair(pair, kind);
    assert.throws(() =>
      validateCorpora(pair.corpus, pair.reference, pair.snapshot),
    );
  });
}

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
  const installed = spawnSync(
    process.execPath,
    [
      "scripts/check-hook-parity.mjs",
      "--stage=installed",
      "--require-complete",
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(installed.status, 1);
  assert.match(installed.stderr, /installed runtime unavailable/);
  assert.throws(
    () => parseOptions(["--require-complete", "--list-divergent"]),
    /not acceptance/,
  );
});

test("candidate stage runs real entrypoints over fixture rows and rejects outcome drift", async () => {
  const cases = [
    "selftest-deny-dangerous-05c6ef8113f35b5d-1",
    // A file token for the global Git config, plus a selected repository whose captured fixture omits its object store.
    "selftest-deny-git-mutations-6c04fb19b11edeb5-1",
  ];
  const options = parseOptions([
    "--stage=candidate",
    ...cases.map((id) => `--case=${id}`),
  ]);
  const passed = await compareCandidate(options, validatedArtifacts);
  assert.deepEqual(passed.divergences, []);
  const drifted = structuredClone(validatedArtifacts);
  const row = drifted.corpus.rows.find(
    (candidate) => candidate.id === cases[1],
  );
  row.expected.status = 0;
  await assert.rejects(
    compareCandidate(options, drifted),
    /unapproved candidate differences/,
  );
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
