/** Run the shipped policy corpus: materialize each row's fixtures, compare outcomes with the parity rule and report the self-test. */
import { isDeepStrictEqual } from "node:util";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  runPolicyHook,
  type PolicyGuard,
  type PolicyResponse,
} from "./policy-evaluation.mjs";

interface PolicyCorpusFile {
  path: string;
  kind: "directory" | "file" | "frozen-runtime";
  bytesBase64?: string;
}

/** One corpus case: who owns it, which self-test modes include it, its input, fixtures and approved outcome. */
export interface PolicyCorpusRow {
  id: string;
  policy: string;
  membership: string[];
  input: {
    kind: string;
    command?: string;
    payloadBase64?: string;
    mode?: string;
  };
  setup: {
    cwd: string;
    files: { token: string; files: PolicyCorpusFile[] }[];
    environment: Record<string, string>;
  };
  availabilityCase: boolean;
  expected: {
    status: number;
    stdoutBase64?: string;
    stderrBase64?: string;
    stderrIncludes?: string;
  };
  predicates?: { requiresAvailable?: boolean };
}

/** Read the corpus shipped beside the policy runtime. */
export function loadPolicyCorpus(): { rows: PolicyCorpusRow[] } {
  return JSON.parse(
    readFileSync(
      new URL("./deny-dangerous/corpus.json", import.meta.url),
      "utf8",
    ),
  ) as { rows: PolicyCorpusRow[] };
}

/** A row's materialized request: where it runs, its environment and input, and the token for each temporary path. */
export interface MaterializedPolicyRow {
  cwd: string;
  environment: NodeJS.ProcessEnv;
  argv: string[];
  stdin: Uint8Array;
  tokens: ReadonlyArray<readonly [string, string]>;
  cleanup: () => void;
}

/** Replace every corpus token with its path. */
function withPaths(
  text: string,
  tokens: ReadonlyArray<readonly [string, string]>,
): string {
  return tokens.reduce(
    (current, [token, path]) => current.replaceAll(token, path),
    text,
  );
}

/**
 * Write one fixture tree; environment-provided files such as Git hook samples are recorded without bytes and written empty. Capture
 * leaves out Git object stores, and Git only recognizes a repository that has one, so each `.git` directory gets an empty store.
 */
function writeFixtureFiles(
  root: string,
  files: readonly PolicyCorpusFile[],
): void {
  for (const file of files) {
    const destination = join(root, file.path);
    if (file.kind === "directory") {
      mkdirSync(destination, { recursive: true });
      if (file.path === ".git" || file.path.endsWith("/.git"))
        mkdirSync(join(destination, "objects"), { recursive: true });
      continue;
    }
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, Buffer.from(file.bytesBase64 ?? "", "base64"));
  }
}

/**
 * Create a row's fixtures in fresh temporary directories and resolve its tokens, e.g. `$FIXTURE0/other repository/.git`.
 *
 * @param row - the corpus case
 * @param referenceRoot - the directory standing in for `$REFERENCE`
 * @param baseEnvironment - the environment the row's own variables extend
 * @returns the resolved request; call `cleanup` to remove its fixtures
 */
export function materializePolicyRow(
  row: PolicyCorpusRow,
  referenceRoot: string,
  baseEnvironment: NodeJS.ProcessEnv,
): MaterializedPolicyRow {
  const tokens: Array<readonly [string, string]> = [
    ["$REFERENCE", referenceRoot],
  ];
  const created: string[] = [];
  const cleanup = () => {
    for (const root of created) rmSync(root, { recursive: true, force: true });
  };
  try {
    for (const group of row.setup.files) {
      const holder = mkdtempSync(join(tmpdir(), "goat-policy-fixture-"));
      created.push(holder);
      // A token can name a single file, such as a Git config file passed through GIT_CONFIG_GLOBAL.
      const namesFile = group.files.some(
        (file) => file.path === "" && file.kind !== "directory",
      );
      const root = namesFile ? join(holder, "fixture") : holder;
      tokens.push([group.token, root]);
      writeFixtureFiles(root, group.files);
    }
  } catch (error) {
    cleanup();
    throw error;
  }
  const environment = { ...baseEnvironment };
  for (const [name, value] of Object.entries(row.setup.environment))
    environment[name] = withPaths(value, tokens);
  // Token paths enter shell text, where native Windows backslashes would be escapes.
  const commandTokens = tokens.map(
    ([token, path]) => [token, path.replaceAll("\\", "/")] as const,
  );
  return {
    cwd: withPaths(row.setup.cwd, tokens),
    environment,
    argv:
      row.input.command === undefined
        ? []
        : [`--check=${withPaths(row.input.command, commandTokens)}`],
    stdin: Buffer.from(row.input.payloadBase64 ?? "", "base64"),
    tokens,
    cleanup,
  };
}

/** Parse JSON for a semantic comparison; non-JSON text compares as itself. */
function parsedOrText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** Compare output for a row that records exact bytes: provider JSON as values, everything else byte for byte. */
function exactOutputMismatch(
  expected: PolicyCorpusRow["expected"],
  stdout: string,
  stderr: string,
): string | null {
  const expectedOut = Buffer.from(
    expected.stdoutBase64 ?? "",
    "base64",
  ).toString();
  const stdoutMatches = expectedOut.trim().startsWith("{")
    ? isDeepStrictEqual(parsedOrText(stdout), parsedOrText(expectedOut))
    : stdout === expectedOut;
  if (!stdoutMatches) return "stdout differs";
  return stderr ===
    Buffer.from(expected.stderrBase64 ?? "", "base64").toString()
    ? null
    : "stderr differs";
}

/**
 * Apply the parity outcome rule: no unavailable reply where availability is required, the exact status, JSON replies compared as
 * values, and exact stderr unless the row only requires a message fragment. Temporary paths are turned back into tokens first.
 *
 * @param row - the corpus case and its approved outcome
 * @param actual - the observed response
 * @param tokens - the row's token-to-path pairs
 * @returns a short reason for the first mismatch, or null when the outcome matches
 */
export function policyRowMismatch(
  row: PolicyCorpusRow,
  actual: PolicyResponse,
  tokens: ReadonlyArray<readonly [string, string]>,
): string | null {
  const byLength = [...tokens].sort(
    (left, right) => right[1].length - left[1].length,
  );
  const asTokens = (text: string) =>
    byLength.reduce(
      (current, [token, path]) => current.replaceAll(path, token),
      text,
    );
  const stdout = asTokens(actual.stdout);
  const stderr = asTokens(actual.stderr);
  const requiresAvailable = row.predicates?.requiresAvailable ?? true;
  if (
    requiresAvailable &&
    `${stdout}${stderr}`.includes("Policy hook unavailable")
  )
    return "unavailable";
  if (actual.exitCode !== row.expected.status)
    return `status ${actual.exitCode}, expected ${row.expected.status}`;
  if (row.expected.stderrIncludes === undefined)
    return exactOutputMismatch(row.expected, stdout, stderr);
  return stdout === "" && stderr.includes(row.expected.stderrIncludes)
    ? null
    : "required message missing";
}

/** Stand in for `$REFERENCE` with a fresh directory holding the reference project's hook layout and no repository of its own. */
function createReferenceStandIn(): string {
  const root = mkdtempSync(join(tmpdir(), "goat-policy-reference-"));
  mkdirSync(join(root, ".goat-flow/hooks"), { recursive: true });
  mkdirSync(join(root, "workflow/hooks"), { recursive: true });
  return root;
}

/** Decide one materialized row in-process with the guard's complete policy. */
async function evaluatePolicyRow(
  guard: PolicyGuard,
  request: MaterializedPolicyRow,
): Promise<PolicyResponse> {
  const outcome = await runPolicyHook(
    {
      guard,
      directory: request.cwd,
      deadlineAt: Date.now() + 20_000,
      ...(request.environment.HOME === undefined
        ? {}
        : { homeDirectory: request.environment.HOME }),
      environment: request.environment,
    },
    {
      argv: request.argv,
      readStdin: () => request.stdin,
      stdinIsTerminal: false,
    },
  );
  return outcome.kind === "response"
    ? outcome
    : {
        stdout: "",
        stderr: "self-test request inside a corpus row\n",
        exitCode: 1,
      };
}

/**
 * Run the guard's corpus rows for one mode and print the reference summary line, e.g.
 * `PASS: deny-dangerous self-test (mode=smoke, executed=41, skipped=129)`. Rows the other policy owns, and this policy's startup
 * availability rows that need a separate broken install, count as skipped. Fixtures live in temporary directories and Git reads
 * neither global nor system configuration, so the consumer's own repository never changes the result.
 *
 * @param guard - the policy under test
 * @param mode - `smoke` or `full`
 * @returns the exit status: 0 when every executed row matches, 1 otherwise
 */
export async function runPolicySelfTest(
  guard: PolicyGuard,
  mode: string,
): Promise<number> {
  if (mode !== "smoke" && mode !== "full") {
    process.stderr.write(`FAIL: unsupported self-test mode: ${mode}\n`);
    return 1;
  }
  const rows = loadPolicyCorpus().rows.filter((row) =>
    row.membership.includes(mode),
  );
  const runnable = rows.filter(
    (row) => row.policy === guard && !row.availabilityCase,
  );
  const reference = createReferenceStandIn();
  // An inherited repository or root override would point the rows' Git lookups at the consumer's project.
  const inheritedOverrides = new Set([
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GOAT_FLOW_ROOT",
    "GOAT_HOOK_LIB_DIR",
  ]);
  const baseEnvironment: NodeJS.ProcessEnv = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !inheritedOverrides.has(name),
      ),
    ),
    LC_ALL: "C",
    LANG: "C",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  let failed = 0;
  try {
    for (const row of runnable) {
      const request = materializePolicyRow(row, reference, baseEnvironment);
      try {
        const mismatch = policyRowMismatch(
          row,
          await evaluatePolicyRow(guard, request),
          request.tokens,
        );
        if (mismatch !== null) {
          process.stderr.write(`FAIL: ${row.id}: ${mismatch}\n`);
          failed++;
        }
      } finally {
        request.cleanup();
      }
    }
  } finally {
    rmSync(reference, { recursive: true, force: true });
  }
  const counts = `mode=${mode}, executed=${runnable.length}, skipped=${rows.length - runnable.length}`;
  if (failed > 0) {
    process.stderr.write(
      `FAIL: ${guard} self-test (${counts}, failed=${failed})\n`,
    );
    return 1;
  }
  process.stdout.write(`PASS: ${guard} self-test (${counts})\n`);
  return 0;
}
