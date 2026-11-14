/**
 * How hook tests pick the hook copy they exercise, through the `GOAT_FLOW_HOOK_UNDER_TEST` environment variable.
 *
 * Example: CI's hook-port jobs set `GOAT_FLOW_HOOK_UNDER_TEST=installed`; a maintainer can set `candidate` to copy `workflow/hooks/` instead.
 * Any other value, including the retired `reference`, stops the test with an error instead of quietly running a different hook.
 */
import {
  spawnSync,
  type SpawnSyncOptionsWithStringEncoding,
} from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";

/** Which hook copy a test run asks for: `candidate` copies `workflow/hooks/`, `installed` copies `.goat-flow/hooks/`, the copy consumers run. */
export type HookSelection = "candidate" | "installed";
/** Which folder to read: `workflow` is the generated source tree in `workflow/hooks/`, `installed` is the `.goat-flow/hooks/` copy. */
export type HookLayout = "workflow" | "installed";
const repositoryRoot = resolve(import.meta.dirname, "../..");
const announcedEntrypoints = new Set<string>();

/**
 * Read which hook copy this test run asks for; an ordinary `npm test` with the variable unset gets the installed copy.
 *
 * @param requested - `GOAT_FLOW_HOOK_UNDER_TEST` by default; undefined means the variable is unset, while an empty string is refused
 * @returns `installed` when unset, otherwise the named selection
 * @throws when the value is not `candidate` or `installed`, including the retired `reference`
 */
export function hookSelection(
  requested = process.env.GOAT_FLOW_HOOK_UNDER_TEST,
): HookSelection {
  // The variable is unset, so the test runs the hooks consumers get.
  if (requested === undefined) return "installed";
  // Only the two known names pass; a typo such as `candiate`, or `reference`, throws below.
  if (requested === "candidate" || requested === "installed") return requested;
  throw new Error(`unknown hook selection: ${requested}`);
}

/**
 * Find the hook folder a test copies or runs from; the folder holds every entrypoint and the policy modules it imports.
 *
 * @param layout - `workflow` for `workflow/hooks/`, `installed` for the `.goat-flow/hooks/` copy
 * @param selection - validated selection; both selections read the same folders, so it only rejects retired values
 * @param project - repository root to resolve against; omitted uses this checkout
 * @returns absolute path of the hook folder
 * @throws when the selection is unknown
 */
export function hookTreeRoot(
  layout: HookLayout = "workflow",
  selection = hookSelection(),
  project = repositoryRoot,
): string {
  hookSelection(selection);
  return join(
    project,
    layout === "workflow" ? "workflow/hooks" : ".goat-flow/hooks",
  );
}

/**
 * Copy the selected hook folder into a test's temporary project, so the test runs hooks laid out like a consumer install.
 *
 * @param destination - temporary directory the test owns and later removes; the hook folder is copied into it recursively
 * @param layout - folder to copy; omitted copies `.goat-flow/hooks/` for `installed` and `workflow/hooks/` for `candidate`
 * @returns nothing; the copied files are the result
 * @throws when `candidate` is selected and its Node entrypoint is missing
 */
export function copyHookTree(
  destination: string,
  layout: HookLayout = hookSelection() === "installed"
    ? "installed"
    : "workflow",
): void {
  const source = hookTreeRoot(layout);
  // A candidate folder without its Node entrypoint throws, rather than copying hooks that cannot start.
  if (
    hookSelection() === "candidate" &&
    !existsSync(join(source, "deny-dangerous.mjs"))
  ) {
    throw new Error(`candidate runtime unavailable: ${source}`);
  }
  cpSync(source, destination, { recursive: true });
}

/**
 * Turn the hook path a test names into the Node file that runs, mapping legacy `.sh` and Bash-launcher names to their Node files.
 *
 * @param path - hook path as a test names it, including legacy `.sh` and `run-with-bash.mjs` names
 * @param selection - selection named in diagnostics; omitted reads `GOAT_FLOW_HOOK_UNDER_TEST`
 * @returns absolute path of the Node entrypoint; the first use of each path writes one diagnostic line to stderr
 * @throws when the Node entrypoint is missing, without falling back to another runtime
 */
export function selectedHookPath(
  path: string,
  selection = hookSelection(),
): string {
  const selected = resolve(path)
    .replace(/\.sh$/u, ".mjs")
    .replace(/run-with-bash\.mjs$/u, "run-hook.mjs");
  // A test naming a hook with no Node file, such as an old `.sh` name with no `.mjs` beside it, fails here.
  if (!existsSync(selected))
    throw new Error(`${selection} hook unavailable: ${selected}`);
  // The test log names each entrypoint once; this goes to the test's stderr, not the hook's captured output.
  if (!announcedEntrypoints.has(selected)) {
    process.stderr.write(`hook-under-test ${selection}: ${selected}\n`);
    announcedEntrypoints.add(selected);
  }
  return selected;
}

/**
 * Build the Node launch for a hook as an argument array, so command text a test passes is data for the hook and never runs in a shell.
 *
 * @param path - hook path as a test names it
 * @param args - hook arguments passed after the entrypoint; empty means none
 * @returns the Node executable, its argument array, and the resolved entrypoint and its file name
 */
export function hookInvocation(path: string, args: string[] = []) {
  const entrypoint = selectedHookPath(path);
  return {
    executable: process.execPath,
    args: [entrypoint, ...args],
    entrypoint,
    name: basename(entrypoint),
  };
}

/**
 * Spawns the selected hook and waits for it to exit; tests use it to send one request and check the hook's reply.
 *
 * @param path - hook path as a test names it
 * @param args - hook arguments passed after the entrypoint; empty means none
 * @param options - spawn options with string encoding; `input` is the stdin text the hook reads
 * @returns the completed process result
 */
export function spawnSelectedHook(
  path: string,
  args: string[],
  options: SpawnSyncOptionsWithStringEncoding,
) {
  const invocation = hookInvocation(path, args);
  return spawnSync(invocation.executable, invocation.args, options);
}
