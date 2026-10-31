// Launch frozen commands and replay their fixtures without changing literal operands or output bytes.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { materializePolicyRow } from "../workflow/hooks/policy-corpus.mjs";

// Convert only runner-owned paths for Bash; policy inputs remain literal.
export function bashPath(path) {
  return process.platform === "win32"
    ? path
        .replaceAll("\\", "/")
        .replace(/^([A-Za-z]):\//, (_, drive) => `/${drive.toLowerCase()}/`)
    : path;
}

// Native Windows argv can be truncated or unescaped before Bash sees it.
// Let Bash read literal operands from an owned file, then exec the frozen command.
export function spawnReferenceCommand(executable, args, options) {
  if (process.platform !== "win32") return spawnSync(executable, args, options);
  const operands = [executable, ...args];
  if (operands.some((arg) => arg.includes("\0")))
    throw new TypeError("Reference arguments cannot contain NUL bytes");
  const work = mkdtempSync(join(tmpdir(), "goat-parity-argv-"));
  try {
    const data = join(work, "argv.bin");
    const script = join(work, "dispatch.sh");
    writeFileSync(data, operands.join("\0") + "\0");
    writeFileSync(
      script,
      'mapfile -d \'\' -t goat_parity_args < "$1" || exit 1\nexec "${goat_parity_args[@]}"\n',
    );
    return spawnSync("bash", [bashPath(script), bashPath(data)], options);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// Replace only path bytes; frozen output may contain invalid UTF-8.
export function tokenizeReferenceOutcome(outcome, tokens) {
  const paths = tokens
    .flatMap(([token, path]) => [
      [token, path],
      [token, path.replaceAll("\\", "/")],
    ])
    .sort((left, right) => right[1].length - left[1].length);
  const asBytes = (text) => Buffer.from(text).toString("latin1");
  const tokenize = (encoded) =>
    Buffer.from(
      paths.reduce(
        (text, [token, path]) => text.split(asBytes(path)).join(asBytes(token)),
        Buffer.from(encoded, "base64").toString("latin1"),
      ),
      "latin1",
    ).toString("base64");
  return {
    ...outcome,
    stdoutBase64: tokenize(outcome.stdoutBase64),
    stderrBase64: tokenize(outcome.stderrBase64),
  };
}

// Replay supplemental rows with the same fixture files, cwd and tokens used by candidate acceptance.
export function replayFrozenRow(
  project,
  row,
  locale,
  referenceEnvironment,
  runFrozen,
) {
  const request = materializePolicyRow(
    row,
    project,
    referenceEnvironment(project, locale),
  );
  try {
    const input =
      row.input.command === undefined
        ? { ...row.input, payloadBase64: request.stdin.toString("base64") }
        : { ...row.input, command: request.argv[0].slice("--check=".length) };
    const actual = runFrozen(
      project,
      row.policy,
      input,
      locale,
      request.environment,
      row.id,
      { cwd: request.cwd },
    );
    return tokenizeReferenceOutcome(actual, request.tokens);
  } finally {
    request.cleanup();
  }
}
