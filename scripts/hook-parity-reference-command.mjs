// Launch frozen-reference commands without changing literal Windows operands.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

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
