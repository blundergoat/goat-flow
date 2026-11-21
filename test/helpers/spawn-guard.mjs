/** Test preload: journal Node launches and retain instrumentation in child environments. */
import childProcess from "node:child_process";
import { appendFileSync, realpathSync } from "node:fs";
import { basename, delimiter, isAbsolute, resolve } from "node:path";
import { syncBuiltinESMExports } from "node:module";

const journal = process.env.GOAT_TEST_SPAWN_LOG;
const preload = process.env.GOAT_TEST_SPAWN_PRELOAD;
const encodedAllowlist = process.env.GOAT_TEST_SPAWN_ALLOWED;
if (!journal || !preload || !encodedAllowlist) throw new Error("spawn guard configuration missing");
const normalize = (path) => process.platform === "win32" ? path.toLowerCase() : path;
const allowed = new Set(JSON.parse(encodedAllowlist).map(normalize));
const commandName = (path) => normalize(basename(path)).replace(/\.exe$/u, "");
const allowedNames = new Set([...allowed].map(commandName));
const settings = {
  GOAT_TEST_SPAWN_LOG: journal,
  GOAT_TEST_SPAWN_PRELOAD: preload,
  GOAT_TEST_SPAWN_ALLOWED: encodedAllowlist,
};

function record(event) {
  appendFileSync(journal, JSON.stringify({ pid: process.pid, ...event }) + "\n");
}

function propagate(environment = process.env) {
  const options = environment.NODE_OPTIONS ?? "";
  return {
    ...environment,
    ...settings,
    NODE_OPTIONS: options.includes(preload) ? options : `${options} --import=${preload}`.trim(),
  };
}

// Missing candidates recover to null; only the first real path can reach the allowlist.
function resolveGuardExecutable(executable, environment, cwd) {
  const pathValue = Object.entries(environment).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? (process.platform === "win32" ? process.env.PATH ?? "" : "/usr/bin:/bin");
  const suffixes = process.platform === "win32" && !/\.[a-z]+$/iu.test(executable)
    ? [".exe", ".com", ".cmd", ".bat"] : [""];
  const directories = isAbsolute(executable) ? [""]
    : /[\\/]/u.test(executable) ? [cwd]
    : pathValue.split(delimiter).map((directory) => resolve(cwd, directory || "."));
  for (const directory of directories) {
    for (const suffix of suffixes) {
      try { return normalize(realpathSync(resolve(directory, executable + suffix))); }
      catch { /* A missing candidate cannot be admitted. */ }
    }
  }
  return null;
}

function inspect(api, executable, options = {}) {
  const environment = options.env ?? process.env;
  const resolved = resolveGuardExecutable(executable, environment, options.cwd ?? process.cwd());
  // A missing declared dependency cannot launch; retain the native ENOENT result for recovery fixtures.
  const unavailable = resolved === null && executable === basename(executable) && allowedNames.has(commandName(executable));
  const denied = options.shell || api === "exec" || api === "execSync" || (!allowed.has(resolved) && !unavailable);
  record({ event: denied ? "denied" : unavailable ? "unavailable" : "allowed", api, executable: resolved ?? executable });
  if (denied) {
    const error = new Error(`restricted consumer denied ${api}: ${executable}`);
    error.code = "GOAT_TEST_SPAWN_DENIED";
    throw error;
  }
  return { ...options, env: propagate(environment) };
}

// Async spawn is reached through the prototype even when a caller cached spawn itself.
const originalSpawn = childProcess.ChildProcess.prototype.spawn;
childProcess.ChildProcess.prototype.spawn = function (options) {
  const environment = Object.fromEntries((options.envPairs ?? []).map((entry) => {
    const separator = entry.indexOf("=", entry.startsWith("=") ? 1 : 0);
    return [entry.slice(0, separator), entry.slice(separator + 1)];
  }));
  const checked = inspect("spawn", options.file, { ...options, env: environment });
  return originalSpawn.call(this, {
    ...options,
    envPairs: Object.entries(checked.env).map(([key, value]) => `${key}=${value}`),
  });
};

for (const api of ["spawnSync", "execFileSync", "execFile", "exec", "execSync"]) {
  const original = childProcess[api];
  childProcess[api] = function (executable, ...operands) {
    const optionsIndex = Array.isArray(operands[0]) ? 1 : 0;
    const options = operands[optionsIndex];
    const checked = inspect(api, executable, options && typeof options === "object" ? options : {});
    if (typeof options === "function") operands.splice(optionsIndex, 0, checked);
    else operands[optionsIndex] = checked;
    return original.call(this, executable, ...operands);
  };
}
syncBuiltinESMExports();
record({ event: "loaded", executable: normalize(realpathSync(process.execPath)) });
