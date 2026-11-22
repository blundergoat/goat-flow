/**
 * The worker behind `node scripts/check-hook-parity.mjs`: it runs every selected corpus row through one hook copy and counts differences.
 *
 * - `candidate` runs `workflow/hooks/`, the generated hooks about to ship; `installed` runs `.goat-flow/hooks/`, the copy consumers get.
 * - Each row gets fresh temporary fixtures and its own Node process; temporary paths in its output become corpus tokens before comparison.
 * - A spawn guard records every process a hook starts, and any launch other than Node or Git fails the run.
 */
import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
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
  loadCorpus,
  policyEnvironment,
  stages,
} from "./check-hook-parity.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hookTrees = {
  candidate: join(repositoryRoot, "workflow/hooks"),
  installed: join(repositoryRoot, ".goat-flow/hooks"),
};

/**
 * Add the spawn guard to a locale's environment, so a hook that starts anything other than Node or Git fails the parity run.
 *
 * @param spawnJournalDirectory - temporary directory that receives `spawn-journal.jsonl`, one line per launch the guard saw
 * @param environment - the locale environment the hooks will run in; its PATH decides which Git the guard allows
 * @returns the extra variables that load the guard in every hook process; with no Git on PATH the check stops before any row runs
 */
function spawnGuardEnvironment(spawnJournalDirectory, environment) {
  const pathValue =
    Object.entries(environment).find(
      ([key]) => key.toUpperCase() === "PATH",
    )?.[1] ?? "";
  const gitExecutableNames =
    process.platform === "win32"
      ? [".exe", ".com", ".cmd", ".bat"].map((suffix) => `git${suffix}`)
      : ["git"];
  const gitPath = pathValue
    .split(delimiter)
    .filter(Boolean)
    .flatMap((directory) =>
      gitExecutableNames.map((name) => join(directory, name)),
    )
    .find((candidate) => existsSync(candidate));
  assert(gitPath, "policy parity requires git on PATH");
  const preload = pathToFileURL(
    join(repositoryRoot, "test/helpers/spawn-guard.mjs"),
  ).href;
  return {
    NODE_OPTIONS:
      `${environment.NODE_OPTIONS ?? ""} --import=${preload}`.trim(),
    GOAT_TEST_SPAWN_PRELOAD: preload,
    GOAT_TEST_SPAWN_ALLOWED: JSON.stringify([
      realpathSync(process.execPath),
      realpathSync(gitPath),
    ]),
    GOAT_TEST_SPAWN_LOG: join(spawnJournalDirectory, "spawn-journal.jsonl"),
  };
}

/**
 * Create the empty project that the corpus token `$REFERENCE` points at, matching what the shipped self-test builds.
 *
 * @returns path of the temporary directory it writes, holding empty `.goat-flow/hooks` and `workflow/hooks` folders; the caller removes it
 */
function createReferenceStandIn() {
  const standIn = mkdtempSync(join(tmpdir(), "goat-policy-reference-"));
  mkdirSync(join(standIn, ".goat-flow/hooks"), { recursive: true });
  mkdirSync(join(standIn, "workflow/hooks"), { recursive: true });
  return standIn;
}

/**
 * Build a replacer that turns one row's temporary fixture paths back into the corpus tokens its saved output uses.
 * Longest paths are replaced first, so a nested fixture path is not half-replaced by its parent's token and the output stays deterministic.
 *
 * @param tokens - the row's `[token, temporary path]` pairs; resolved and forward-slash spellings of each path are covered too
 * @returns a function from hook output text to tokenized text; empty text stays empty
 */
function createPathTokenReplacer(tokens) {
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

/**
 * Pick the hook file a row runs; a missing-runtime row runs a lone copy inside its fixture install, so the hook must fail closed.
 *
 * @param row - corpus row; `availabilityCase` marks the rows that simulate an install with the policy modules missing
 * @param request - the materialized row, whose tokens map each fixture group to its temporary directory
 * @param hookTree - the stage's hook folder, `workflow/hooks/` or `.goat-flow/hooks/`
 * @returns path of the entrypoint to spawn; a missing-runtime row without its recorded fixture stops the check with the row ID
 */
function stageEntrypoint(row, request, hookTree) {
  const source = join(hookTree, `${row.policy}.mjs`);
  // Most rows run the stage's own entrypoint, beside the policy modules it imports.
  if (!row.availabilityCase) return source;
  const frozenEntrypointPath = `.goat-flow/hooks/${row.policy}.sh`;
  const startupFixture = row.setup.files.find((fixture) =>
    fixture.files.some(
      (file) =>
        file.path === frozenEntrypointPath && file.kind === "frozen-runtime",
    ),
  );
  assert(startupFixture, `missing startup fixture: ${row.id}`);
  const fixtureToken = request.tokens.find(
    ([name]) => name === startupFixture.token,
  );
  assert(fixtureToken, `missing startup fixture token: ${row.id}`);
  const entrypoint = join(
    fixtureToken[1],
    ".goat-flow/hooks",
    `${row.policy}.mjs`,
  );
  copyFileSync(source, entrypoint);
  return entrypoint;
}

/**
 * Run one materialized row the way an agent's hook launcher would, and save its outcome in the corpus's token form.
 *
 * @param row - corpus row; a self-test row passes `--self-test=<mode>` instead of the recorded arguments
 * @param request - the materialized row: arguments, working directory, environment, stdin text and fixture tokens
 * @param hookTree - the stage's hook folder, `workflow/hooks/` or `.goat-flow/hooks/`
 * @returns the exit status and base64 output; rejects when the hook cannot spawn or is killed before it exits
 */
function runStageRow(row, request, hookTree) {
  const hookArguments =
    row.input.kind === "self-test"
      ? [`--self-test=${row.input.mode}`]
      : request.argv;
  const replacePathsWithTokens = createPathTokenReplacer(request.tokens);
  const entrypoint = stageEntrypoint(row, request, hookTree);
  // A broken install's self-test must refuse without waiting for input, so stdin stays open and a hook that waits is killed after one second.
  const keepsStdinOpen = row.availabilityCase && row.input.kind === "self-test";
  return new Promise((resolveRow, rejectRow) => {
    const child = spawn(process.execPath, [entrypoint, ...hookArguments], {
      cwd: request.cwd,
      env: request.environment,
      timeout: keepsStdinOpen ? 1_000 : 30_000,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    // A hook that decides from its arguments, such as a self-test, can exit before reading stdin; the write's EPIPE is expected.
    child.stdin.on("error", () => {});
    child.on("error", rejectRow);
    child.on("close", (status) => {
      // No exit status means a signal stopped the hook, for example the timeout above, so the row has no decision to compare.
      if (status === null) {
        rejectRow(new Error(`Policy launch incomplete: case=${row.id}`));
        return;
      }
      resolveRow({
        status,
        stdoutBase64: Buffer.from(
          replacePathsWithTokens(Buffer.concat(stdout).toString()),
        ).toString("base64"),
        stderrBase64: Buffer.from(
          replacePathsWithTokens(Buffer.concat(stderr).toString()),
        ).toString("base64"),
      });
    });
    // Every row except a broken-install self-test sends its recorded stdin, then closes the pipe like a real launcher.
    if (!keepsStdinOpen) child.stdin.end(request.stdin);
  });
}

/**
 * Run one locale's rows, up to eight at a time; each row whose outcome differs from the corpus reports one difference.
 *
 * @param rows - the selected corpus rows; an empty list runs nothing and records nothing
 * @param referenceRoot - the empty project from `createReferenceStandIn`, used for the `$REFERENCE` token
 * @param environment - the locale environment with the spawn guard already added
 * @param comparison - the stage's row materializer, the shared differences list, the locale name and the hook folder
 * @returns a promise that resolves once every row has run; a hook that cannot launch rejects it
 */
async function compareLocale(rows, referenceRoot, environment, comparison) {
  const { materializePolicyRow, divergences, locale, hookTree } = comparison;
  let nextRowIndex = 0;
  // Each worker takes the next unclaimed row until none remain, so at most eight hooks run at once.
  // A different outcome reports one difference and the worker moves on; a launch failure throws once the row's fixtures are removed.
  const worker = async () => {
    // Claim rows one at a time; the shared index means two workers never run the same row.
    while (nextRowIndex < rows.length) {
      const row = rows[nextRowIndex++];
      const request = materializePolicyRow(row, referenceRoot, environment);
      try {
        const actual = await runStageRow(row, request, hookTree);
        try {
          assertOutcome(
            actual,
            row.expected,
            row.predicates.requiresAvailable,
            row.id,
          );
        } catch (error) {
          // For example a rule edit that now allows a command the corpus saved as blocked; it becomes one listed difference.
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

/**
 * Run the parity check for one stage: every selected row, in each pinned locale, with zero spawn-guard denials.
 * Spawns one Node process per row and locale, writes fixtures to temporary directories it removes, and prints one line per locale.
 *
 * @param options - parsed options: `candidate` or `installed`, selected row IDs (empty means all rows) and the report/acceptance mode
 * @param corpus - the validated corpus; omitted loads the shipped corpus and checks the installed copy matches it
 * @returns the row count and the differences found; an empty list means every row matched, and outside report mode any difference throws
 */
export async function compareCandidate(options, corpus = loadCorpus()) {
  assert(stages.includes(options.stage), `known stage: ${options.stage}`);
  const hookTree = hookTrees[options.stage];
  // A mistyped `--case` ID stops the run instead of silently checking fewer rows.
  for (const id of options.cases)
    assert(
      corpus.rows.some((row) => row.id === id),
      `unknown case: ${id}`,
    );
  // No `--case` filter means the full corpus.
  const rows = options.cases.length
    ? corpus.rows.filter((row) => options.cases.includes(row.id))
    : corpus.rows;
  // A shell that exports LC_ALL=C or LC_ALL=C.UTF-8 runs only that locale; any other value runs both.
  const locales = ["C", "C.UTF-8"].includes(process.env.LC_ALL)
    ? [process.env.LC_ALL]
    : ["C", "C.UTF-8"];
  const { materializePolicyRow } = await import(
    pathToFileURL(join(hookTree, "policy-corpus.mjs")).href
  );
  console.log(
    `Policy host: ${JSON.stringify({ stage: options.stage, node: process.version, platform: process.platform, arch: process.arch, locales })}`,
  );
  const referenceRoot = createReferenceStandIn();
  const spawnJournalDirectory = mkdtempSync(
    join(tmpdir(), "goat-hook-parity-"),
  );
  const divergences = [];
  try {
    // Each locale gets its own environment and a PASS or DIVERGENT line in the log.
    for (const locale of locales) {
      const localeEnvironment = policyEnvironment(locale);
      const environment = {
        ...localeEnvironment,
        ...spawnGuardEnvironment(spawnJournalDirectory, localeEnvironment),
      };
      const earlierDifferences = divergences.length;
      await compareLocale(rows, referenceRoot, environment, {
        materializePolicyRow,
        divergences,
        locale,
        hookTree,
      });
      const localeDifferences = divergences.length - earlierDifferences;
      console.log(
        `${localeDifferences ? "DIVERGENT" : "PASS"}: ${options.stage} ${locale} cases=${rows.length} differences=${localeDifferences}`,
      );
    }
    const journal = readFileSync(
      join(spawnJournalDirectory, "spawn-journal.jsonl"),
      "utf8",
    )
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
    rmSync(referenceRoot, { recursive: true, force: true });
    rmSync(spawnJournalDirectory, { recursive: true, force: true });
  }
  // `--list-divergent` prints every difference for investigation; otherwise any difference fails and names the first five.
  if (options.listDivergent)
    console.log(JSON.stringify({ divergences }, null, 2));
  else
    assert.equal(
      divergences.length,
      0,
      `unapproved ${options.stage} differences: ${divergences.length}; first ${divergences
        .slice(0, 5)
        .map(({ id, locale }) => `${id}/${locale}`)
        .join(", ")}`,
    );
  console.log(
    `PASS: ${options.listDivergent ? `${options.stage} divergence report` : `${options.stage} parity`}; cases=${rows.length}; differences=${divergences.length}; spawn-denials=0`,
  );
  return { cases: rows.length, divergences };
}
