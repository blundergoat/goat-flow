// Observe only managed hook children; test setup retains its normal process environment.
import childProcess from "node:child_process";
import { realpathSync } from "node:fs";
import { delimiter, join, resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { syncBuiltinESMExports } from "node:module";
if (!process.env.GOAT_TEST_HOOK_SUITE_LOG)
  throw new Error("hook suite journal missing");
const preload = pathToFileURL(resolve("test/helpers/spawn-guard.mjs")).href;
const executable = (name, environment) => {
  const value =
    Object.entries(environment).find(
      ([key]) => key.toUpperCase() === "PATH",
    )?.[1] ?? "";
  const suffixes =
    process.platform === "win32" && !extname(name)
      ? [".exe", ".com", ".cmd", ".bat"]
      : [""];
  for (const directory of value.split(delimiter))
    for (const suffix of suffixes) {
      try {
        return realpathSync(join(directory, name + suffix));
      } catch {
        // Missing or unreadable PATH entries are expected; continue looking for an executable.
      }
    }
  return undefined;
};
function protect(args, environment = process.env) {
  if (environment.GOAT_TEST_SPAWN_PRELOAD) return environment;
  if (
    !args.some(
      (arg) =>
        /(?:^|[\\/])(?:post-turn-safety|gruff-code-quality|run-hook)\.mjs$/u.test(
          arg,
        ) || arg.includes("run-hook.mjs"),
    )
  )
    return environment;
  const allowed = [
    realpathSync(process.execPath),
    executable("git", environment),
    executable("git", process.env),
  ];
  if (process.platform === "win32")
    allowed.push(
      realpathSync(
        join(
          process.env.SystemRoot ?? "C:\\Windows",
          "System32",
          "taskkill.exe",
        ),
      ),
      realpathSync(
        join(
          process.env.SystemRoot ?? "C:\\Windows",
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        ),
      ),
    );
  else
    allowed.push(executable("ps", environment), executable("ps", process.env));
  if (environment.GOAT_TEST_COMMAND_FAULT)
    allowed.push(JSON.parse(environment.GOAT_TEST_COMMAND_FAULT).executable);
  return {
    ...environment,
    NODE_OPTIONS:
      `${environment.NODE_OPTIONS ?? ""} --import=${preload}`.trim(),
    GOAT_TEST_SPAWN_PRELOAD: preload,
    GOAT_TEST_SPAWN_ALLOWED: JSON.stringify(allowed.filter(Boolean)),
    GOAT_TEST_SPAWN_LOG: process.env.GOAT_TEST_HOOK_SUITE_LOG,
  };
}
const originalSync = childProcess.spawnSync;
childProcess.spawnSync = function (command, args = [], options = {}) {
  return originalSync.call(this, command, args, {
    ...options,
    env: protect(args, options.env),
  });
};
const originalSpawn = childProcess.ChildProcess.prototype.spawn;
childProcess.ChildProcess.prototype.spawn = function (options) {
  const env = Object.fromEntries(
    (options.envPairs ?? []).map((value) => {
      const index = value.indexOf("=", value.startsWith("=") ? 1 : 0);
      return [value.slice(0, index), value.slice(index + 1)];
    }),
  );
  const guarded = protect(options.args ?? [], env);
  return originalSpawn.call(this, {
    ...options,
    envPairs: Object.entries(guarded).map(([key, value]) => `${key}=${value}`),
  });
};
syncBuiltinESMExports();
