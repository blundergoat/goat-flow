// Compare the real Node policy entrypoints against the frozen corpus.
import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertOutcome,
  loadArtifacts,
  materializeReference,
  referenceEnvironment,
} from "./check-hook-parity.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Candidate hooks may start only Node and Git. The test preload journals every
// launch in each child so acceptance can require zero denials.
function spawnGuardEnvironment(work, env) {
  const pathValue =
    Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1] ??
    "";
  const names =
    process.platform === "win32"
      ? [".exe", ".com", ".cmd", ".bat"].map((suffix) => `git${suffix}`)
      : ["git"];
  const git = pathValue
    .split(delimiter)
    .filter(Boolean)
    .flatMap((directory) => names.map((name) => join(directory, name)))
    .find((candidate) => existsSync(candidate));
  assert(git, "candidate parity requires git on PATH");
  const preload = pathToFileURL(
    join(root, "test/helpers/spawn-guard.mjs"),
  ).href;
  return {
    NODE_OPTIONS: `${env.NODE_OPTIONS ?? ""} --import=${preload}`.trim(),
    GOAT_TEST_SPAWN_PRELOAD: preload,
    GOAT_TEST_SPAWN_ALLOWED: JSON.stringify([
      realpathSync(process.execPath),
      realpathSync(git),
    ]),
    GOAT_TEST_SPAWN_LOG: join(work, "spawn-journal.jsonl"),
  };
}

// Turn a row's temporary paths, including resolved and forward-slash spellings,
// back into its corpus tokens; longer paths go first so nested tokens survive.
function tokenizer(tokens) {
  const pairs = tokens.flatMap(([token, path]) =>
    [...new Set([path, realpathSync.native(path)])].flatMap((form) => [
      [form, token],
      [form.replaceAll("\\", "/"), token],
    ]),
  );
  pairs.sort((left, right) => right[0].length - left[0].length);
  return (text) =>
    pairs.reduce((value, [from, to]) => value.split(from).join(to), text);
}

// Recreate an incomplete install with the native entrypoint beside the recorded
// missing runtime. The fixture location, including outside-cwd cases, stays intact.
function candidateEntrypoint(row, request) {
  const source = join(root, "workflow/hooks", `${row.policy}.mjs`);
  if (!row.availabilityCase) return source;
  const relative = `.goat-flow/hooks/${row.policy}.sh`;
  const group = row.setup.files.find((fixture) =>
    fixture.files.some(
      (file) => file.path === relative && file.kind === "frozen-runtime",
    ),
  );
  assert(group, `missing startup fixture: ${row.id}`);
  const token = request.tokens.find(([name]) => name === group.token);
  assert(token, `missing startup fixture token: ${row.id}`);
  const entrypoint = join(token[1], ".goat-flow/hooks", `${row.policy}.mjs`);
  copyFileSync(source, entrypoint);
  return entrypoint;
}

// Run the real candidate entrypoint for one materialized row, as the launcher
// would, and record its outcome in the corpus's token form.
function runCandidateRow(row, request) {
  const args =
    row.input.kind === "self-test"
      ? [`--self-test=${row.input.mode}`]
      : request.argv;
  const tokenize = tokenizer(request.tokens);
  const entrypoint = candidateEntrypoint(row, request);
  const keepsStdinOpen = row.availabilityCase && row.input.kind === "self-test";
  return new Promise((resolveRow, rejectRow) => {
    const child = spawn(process.execPath, [entrypoint, ...args], {
      cwd: request.cwd,
      env: request.environment,
      timeout: keepsStdinOpen ? 1_000 : 30_000,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    // A hook deciding from argv may exit before it reads stdin.
    child.stdin.on("error", () => {});
    child.on("error", rejectRow);
    child.on("close", (status) => {
      if (status === null) {
        rejectRow(new Error(`Candidate launch incomplete: case=${row.id}`));
        return;
      }
      resolveRow({
        status,
        stdoutBase64: Buffer.from(
          tokenize(Buffer.concat(stdout).toString()),
        ).toString("base64"),
        stderrBase64: Buffer.from(
          tokenize(Buffer.concat(stderr).toString()),
        ).toString("base64"),
      });
    });
    if (!keepsStdinOpen) child.stdin.end(request.stdin);
  });
}

// Compare one locale's selected rows with their approved expectations, a few at a time.
async function compareCandidateLocale(rows, project, environment, comparison) {
  const { materializePolicyRow, divergences, locale } = comparison;
  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      const row = rows[next++];
      const request = materializePolicyRow(row, project, environment);
      try {
        const actual = await runCandidateRow(row, request);
        try {
          assertOutcome(
            actual,
            row.expected,
            row.predicates.requiresAvailable,
            row.id,
          );
        } catch (error) {
          divergences.push({
            id: row.id,
            locale,
            expected: row.expected,
            actual,
            message: error.message,
          });
        }
      } finally {
        request.cleanup();
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(availableParallelism(), 8) }, worker),
  );
}

// Every selected row runs through the real candidate entrypoint in each pinned
// locale and must meet the corpus's approved expectation, with zero spawn denials.
export async function compareCandidate(options, artifacts = loadArtifacts()) {
  assert.equal(options.stage, "candidate", "candidate stage");
  for (const id of options.cases)
    assert(
      artifacts.corpus.rows.some((row) => row.id === id),
      `unknown case: ${id}`,
    );
  const rows = options.cases.length
    ? artifacts.corpus.rows.filter((row) => options.cases.includes(row.id))
    : artifacts.corpus.rows;
  const locales = ["C", "C.UTF-8"].includes(process.env.LC_ALL)
    ? [process.env.LC_ALL]
    : ["C", "C.UTF-8"];
  const { materializePolicyRow } = await import(
    pathToFileURL(join(root, "workflow/hooks/policy-corpus.mjs")).href
  );
  console.log(
    `Candidate host: ${JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, locales })}`,
  );
  const project = materializeReference();
  const work = mkdtempSync(join(tmpdir(), "goat-hook-candidate-"));
  const divergences = [];
  try {
    for (const locale of locales) {
      const base = referenceEnvironment(project, locale);
      const environment = { ...base, ...spawnGuardEnvironment(work, base) };
      const before = divergences.length;
      await compareCandidateLocale(rows, project, environment, {
        materializePolicyRow,
        divergences,
        locale,
      });
      const found = divergences.length - before;
      console.log(
        `${found ? "DIVERGENT" : "PASS"}: candidate ${locale} cases=${rows.length} differences=${found}`,
      );
    }
    const journal = readFileSync(join(work, "spawn-journal.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert(
      journal.some((entry) => entry.event === "loaded"),
      "spawn guard loaded",
    );
    assert.deepEqual(
      journal.filter((entry) => entry.event === "denied"),
      [],
      "spawn-guard denials",
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
  if (options.listDivergent)
    console.log(JSON.stringify({ divergences }, null, 2));
  else
    assert.equal(
      divergences.length,
      0,
      `unapproved candidate differences: ${divergences.length}; first ${divergences
        .slice(0, 5)
        .map(({ id, locale }) => `${id}/${locale}`)
        .join(", ")}`,
    );
  console.log(
    `PASS: ${options.listDivergent ? "candidate divergence report" : "candidate parity"}; cases=${rows.length}; differences=${divergences.length}; spawn-denials=0`,
  );
  return { cases: rows.length, divergences };
}
