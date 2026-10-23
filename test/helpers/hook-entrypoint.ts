/** Select complete hook fixtures without silently substituting another runtime. */
import {
  spawnSync,
  type SpawnSyncOptionsWithStringEncoding,
} from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { validateSnapshot } from "../../scripts/check-hook-parity.mjs";

export type HookSelection = "reference" | "candidate" | "installed";
export type HookLayout = "workflow" | "installed";
const repository = resolve(import.meta.dirname, "../..");
const reported = new Set<string>();
let referenceValidated = false;

/** Unset selection retains the shipped runtime; misspellings never select it. */
export function hookSelection(
  value = process.env.GOAT_FLOW_HOOK_UNDER_TEST,
): HookSelection {
  if (value === undefined) return "installed";
  if (value === "reference" || value === "candidate" || value === "installed")
    return value;
  throw new Error(`unknown hook selection: ${value}`);
}

/** Resolve the source tree, including its readers, vendors and policy modules. */
export function hookTreeRoot(
  layout: HookLayout = "workflow",
  selection = hookSelection(),
  project = repository,
): string {
  let source = project;
  if (selection === "reference") {
    source = join(project, "test/fixtures/hooks-bash");
    if (project !== repository || !referenceValidated) {
      validateSnapshot(source);
      if (project === repository) referenceValidated = true;
    }
  }
  return join(
    source,
    layout === "workflow" ? "workflow/hooks" : ".goat-flow/hooks",
  );
}

/** Install the selected dependencies into a caller-owned disposable project. */
export function copyHookTree(
  destination: string,
  layout: HookLayout = hookSelection() === "installed"
    ? "installed"
    : "workflow",
): void {
  const source = hookTreeRoot(layout);
  if (
    hookSelection() === "candidate" &&
    !existsSync(join(source, "deny-dangerous.mjs"))
  ) {
    throw new Error(`candidate runtime unavailable: ${source}`);
  }
  cpSync(source, destination, { recursive: true });
}

/**
 * Select Node entrypoints for installed and candidate runs; retain the frozen Bash reference.
 * Throws for a missing selection without falling back to another runtime.
 */
export function selectedHookPath(
  path: string,
  selection = hookSelection(),
): string {
  const absolute = resolve(path);
  const nodePath = absolute
    .replace(/\.sh$/u, ".mjs")
    .replace(/run-with-bash\.mjs$/u, "run-hook.mjs");
  const selected = selection === "reference" ? absolute : nodePath;
  if (!existsSync(selected))
    throw new Error(`${selection} hook unavailable: ${selected}`);
  if (!reported.has(selected)) {
    // Test diagnostics remain outside the captured hook response channels.
    process.stderr.write(`hook-under-test ${selection}: ${selected}\n`);
    reported.add(selected);
  }
  return selected;
}

/** Build an argument-array launch; command text remains inert classifier data. */
export function hookInvocation(path: string, args: string[] = []) {
  const entrypoint = selectedHookPath(path);
  return {
    executable: entrypoint.endsWith(".sh") ? "bash" : process.execPath,
    args: [entrypoint, ...args],
    entrypoint,
    name: basename(entrypoint),
  };
}

/** Run the selected fixture with the caller's finite stdin and capture options. */
export function spawnSelectedHook(
  path: string,
  args: string[],
  options: SpawnSyncOptionsWithStringEncoding,
) {
  const invocation = hookInvocation(path, args);
  return spawnSync(invocation.executable, invocation.args, options);
}
