/**
 * Tests for the policy parity check a maintainer runs with `node scripts/check-hook-parity.mjs`.
 *
 * - The shipped corpus must declare complete coverage, and each way an edit could quietly lose coverage must be rejected.
 * - The CLI must refuse partial acceptance runs and unknown stages, including the retired extraction stage.
 * - Both stages must run real hook entrypoints and fail when a saved outcome no longer matches.
 * - The installed corpus copy must match byte for byte, and `npm pack` must ship the corpus without test fixtures.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  assertOutcome,
  assertMirrorBytes,
  checkPackInventory,
  loadCorpus,
  parseOptions,
  validateCorpus,
} from "../../scripts/check-hook-parity.mjs";
import { compareCandidate } from "../../scripts/check-hook-parity-candidate.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
// Every test damages its own clone of this validated corpus; the shipped file is never rewritten.
const validatedCorpus = loadCorpus();

/**
 * Damage a cloned corpus in one named way that an edit could use to quietly lose policy coverage.
 *
 * @param corpus - a `structuredClone` of the validated corpus; the shipped file is never touched
 * @param kind - the damage to apply, which is also the test title, such as `missing row` in `rejects missing row`
 * @returns nothing; the clone is changed in place, and an unlisted kind throws so no test passes by damaging nothing
 */
function damageCorpus(corpus, kind: string) {
  const firstRow = corpus.rows[0];
  // Each case damages one field; the validator must name the matching problem when the test runs it.
  switch (kind) {
    case "missing row":
      corpus.rows.pop();
      break;
    case "duplicate identity":
      corpus.rows[1].id = firstRow.id;
      break;
    case "unknown policy":
      firstRow.policy = "deny-everything";
      break;
    case "unknown suite membership":
      firstRow.membership = ["nightly"];
      break;
    case "input drift":
      firstRow.input.command = "echo changed";
      break;
    case "unknown exception":
      firstRow.exceptionId = "approve-anything";
      break;
    case "misplaced startup exception":
      firstRow.exceptionId = "native-startup";
      break;
    case "availability predicate drift":
      firstRow.predicates.requiresAvailable =
        !firstRow.predicates.requiresAvailable;
      break;
    // Drop every deny-dangerous self-test row but keep the declared count honest, so only the per-policy totals can catch it.
    case "incomplete coverage":
      corpus.rows = corpus.rows.filter(
        (corpusRow) =>
          !(
            corpusRow.policy === "deny-dangerous" &&
            corpusRow.origin.kind === "self-test"
          ),
      );
      corpus.caseCount = corpus.rows.length;
      break;
    // A typo in the kind list below lands here, so a misspelled kind fails instead of testing an undamaged corpus.
    default:
      throw new Error(`unknown damage: ${kind}`);
  }
}

// The corpus a maintainer ships must validate as-is, with both policies counted and its installed copy matching.
test("shipped corpus declares complete coverage and matches its installed mirror", () => {
  assert.deepEqual(validateCorpus(validatedCorpus), {
    cases: validatedCorpus.caseCount,
    policies: 2,
  });
});

// Each damage kind is one way a corpus edit could hide lost coverage; the validator must reject every one.
for (const kind of [
  "missing row",
  "duplicate identity",
  "unknown policy",
  "unknown suite membership",
  "input drift",
  "unknown exception",
  "misplaced startup exception",
  "availability predicate drift",
  "incomplete coverage",
]) {
  test(`rejects ${kind}`, () => {
    const corpus = structuredClone(validatedCorpus);
    damageCorpus(corpus, kind);
    assert.throws(() => validateCorpus(corpus), `${kind} must be rejected`);
  });
}

// A reviewed protection row may only check for the bounded denial text, and only under a reviewed gap label.
test("reviewed protections require a named gap and a bounded denial message", () => {
  // Builds a validator call for one cloned reviewed row given another exception name or denial message.
  const withException = (exceptionId: string, message = "BLOCKED: Policy") => {
    const corpus = structuredClone(validatedCorpus);
    const reviewedRow = corpus.rows.find(
      (candidateRow) => candidateRow.exceptionId === "review-gap-11",
    );
    assert.ok(reviewedRow);
    reviewedRow.exceptionId = exceptionId;
    reviewedRow.expected.stderrIncludes = message;
    return () => validateCorpus(corpus);
  };
  assert.doesNotThrow(withException("review-gap-11"));
  assert.throws(withException("review-gap-22"), /unknown exception/u);
  assert.throws(
    withException("review-gap-11", "anything"),
    /unapproved message predicate/u,
  );
  // An empty predicate would match any stderr, so it is refused like any other unapproved text.
  assert.throws(
    withException("review-gap-11", ""),
    /unapproved message predicate/u,
  );
});

// Two hooks that both failed to start must not count as agreeing, and broken provider JSON must not match a saved reply.
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

// Spawns the real CLI, so a maintainer who combines `--require-complete` with a filter, or types a retired stage, sees exit status 1.
test("acceptance filters, report-mode acceptance and unknown stages fail through the CLI", () => {
  const filteredRun = spawnSync(
    process.execPath,
    ["scripts/check-hook-parity.mjs", "--require-complete", "--case=anything"],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  assert.equal(filteredRun.status, 1);
  assert.match(filteredRun.stderr, /complete acceptance rejects case filters/);
  // The retired frozen extraction stage is now an unknown stage, not a silent fallback.
  const extractionRun = spawnSync(
    process.execPath,
    ["scripts/check-hook-parity.mjs", "--stage=extraction"],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  assert.equal(extractionRun.status, 1);
  assert.match(extractionRun.stderr, /known stage: extraction/);
  assert.throws(
    () => parseOptions(["--require-complete", "--list-divergent"]),
    /not acceptance/,
  );
  assert.equal(parseOptions([]).stage, "installed");
});

const stageCases = [
  "selftest-deny-dangerous-05c6ef8113f35b5d-1",
  // A file token for the global Git config, plus a selected repository whose captured fixture omits its object store.
  "selftest-deny-git-mutations-6c04fb19b11edeb5-1",
  // Missing modules must fail from the copied entrypoint, including open self-test stdin and provider JSON.
  "selftest-deny-dangerous-aa999e6b4a9f641e-1",
  "selftest-deny-dangerous-1b200cef4d0becea-1",
  "selftest-deny-git-mutations-f048cf459ba093b1-1",
];

// Spawns each stage's real entrypoints over five fixture rows, then proves a changed expectation is reported as a difference.
for (const stage of ["candidate", "installed"]) {
  test(`${stage} stage runs real entrypoints over fixture rows and rejects outcome drift`, async () => {
    const options = parseOptions([
      `--stage=${stage}`,
      ...stageCases.map((id) => `--case=${id}`),
    ]);
    const cliRun = spawnSync(
      process.execPath,
      [
        "scripts/check-hook-parity.mjs",
        `--stage=${stage}`,
        ...stageCases.map((id) => `--case=${id}`),
      ],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    assert.equal(cliRun.status, 0, `${stage}: ${cliRun.stderr}`);
    assert.match(cliRun.stdout, new RegExp(`PASS: ${stage} parity`));
    const matchingRun = await compareCandidate(options, validatedCorpus);
    assert.deepEqual(matchingRun.divergences, [], `${stage} divergences`);
    const driftedCorpus = structuredClone(validatedCorpus);
    const driftedRow = driftedCorpus.rows.find(
      (candidateRow) => candidateRow.id === stageCases[1],
    );
    driftedRow.expected.status = 0;
    await assert.rejects(
      compareCandidate(options, driftedCorpus),
      new RegExp(`unapproved ${stage} differences`),
    );
  });
}

// Spawns `npm pack --dry-run`, so a stale installed corpus or a package that ships test fixtures fails before release.
test("mirror validation rejects byte drift and npm excludes test fixtures", () => {
  const corpusBytes = readFileSync(
    join(repositoryRoot, "workflow/hooks/deny-dangerous/corpus.json"),
  );
  assertMirrorBytes(corpusBytes, corpusBytes);
  assert.throws(
    () =>
      assertMirrorBytes(
        corpusBytes,
        Buffer.concat([corpusBytes, Buffer.from("\n")]),
      ),
    /mirror bytes/,
  );
  assert(checkPackInventory() > 0);
});
