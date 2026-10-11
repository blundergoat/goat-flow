/**
 * Keeps every inline Node program in the shipped hook scripts small enough for Windows to start it.
 *
 * Git Bash passes a `node -e` program on the Windows command line, which Windows caps at 32,767 characters.
 * A larger program makes the hook fail with "Argument list too long" before any scan runs, so it belongs on stdin or in a file instead.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { it } from "node:test";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const SHIPPED_HOOKS_ROOT = join(PROJECT_ROOT, "workflow", "hooks");
// Leaves room within the 32,767-character limit for Node's path, its flags, and two quoted path arguments.
const WINDOWS_PROGRAM_BUDGET = 30_000;

/**
 * List every shell script a user receives under the shipped hook folder, including policy modules in subfolders.
 *
 * @param hookDirectory - folder to search; an empty folder returns an empty list
 * @returns absolute script paths in directory order
 */
function shippedHookScripts(hookDirectory: string): string[] {
  return readdirSync(hookDirectory, { withFileTypes: true }).flatMap(
    (entry) => {
      const entryPath = join(hookDirectory, entry.name);
      // Policy modules live in subfolders and start their own inline programs.
      if (entry.isDirectory()) return shippedHookScripts(entryPath);
      return entry.name.endsWith(".sh") ? [entryPath] : [];
    },
  );
}

/**
 * Find each single-quoted `node ... -e '...'` program; Bash ends one at the next quote unless it is the `'\''` escape.
 *
 * @param scriptText - full hook script text
 * @returns raw program bodies in file order; empty when the script starts no inline Node program
 */
function inlineNodePrograms(scriptText: string): string[] {
  const programs: string[] = [];
  for (const match of scriptText.matchAll(/\bnode\b[^\n]*?\s-e\s+'/gu)) {
    const bodyStart = match.index + match[0].length;
    let bodyEnd = scriptText.indexOf("'", bodyStart);
    // An escaped quote continues the same program, so its length must count toward the Windows limit.
    while (bodyEnd >= 0 && scriptText.startsWith("'\\''", bodyEnd)) {
      bodyEnd = scriptText.indexOf("'", bodyEnd + 4);
    }
    programs.push(
      scriptText.slice(bodyStart, bodyEnd < 0 ? undefined : bodyEnd),
    );
  }
  return programs;
}

it("keeps every inline node -e program in shipped hooks within the Windows command-line budget", () => {
  const hookScripts = shippedHookScripts(SHIPPED_HOOKS_ROOT);
  assert.ok(hookScripts.length > 0, "no shipped hook scripts were found");
  const oversizedPrograms = hookScripts.flatMap((scriptPath) =>
    inlineNodePrograms(readFileSync(scriptPath, "utf8")).flatMap((program) => {
      // Windows quoting escapes each double quote and can double backslashes, so both add characters.
      const windowsLength =
        program.length + (program.match(/["\\]/gu)?.length ?? 0);
      return windowsLength > WINDOWS_PROGRAM_BUDGET
        ? [`${relative(PROJECT_ROOT, scriptPath)}: ${windowsLength}`]
        : [];
    }),
  );
  assert.deepEqual(
    oversizedPrograms,
    [],
    `inline node -e programs over the ${WINDOWS_PROGRAM_BUDGET}-character Windows budget; feed them on stdin or move them to a file`,
  );
});
