/** Child-only process controls; the developer shell keeps its normal environment. */
import {
  constants,
  accessSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
} from "node:fs";
import {
  delimiter,
  dirname,
  extname,
  isAbsolute,
  join,
  resolve,
} from "node:path";
import { pathToFileURL } from "node:url";

/** Find an executable without invoking a shell or accepting a PATH fallback. */
export function resolveExecutable(
  command: string,
  environment = process.env,
): string {
  const pathValue =
    Object.entries(environment).find(
      ([key]) => key.toUpperCase() === "PATH",
    )?.[1] ?? "";
  const suffixes =
    process.platform === "win32" && !extname(command)
      ? (environment.PATHEXT ?? ".EXE;.COM;.CMD;.BAT").split(";")
      : [""];
  const directories = isAbsolute(command)
    ? [""]
    : pathValue.split(delimiter).filter(Boolean);
  for (const directory of directories) {
    for (const suffix of suffixes) {
      const candidate = resolve(directory, command + suffix);
      try {
        accessSync(candidate, constants.X_OK);
        return realpathSync(candidate);
      } catch {
        /* Missing or non-executable candidates are ignored; try next location in host order. */
      }
    }
  }
  throw new Error(`required executable unavailable: ${command}`);
}

/**
 * Build an explicit PATH and preload journal for a caller-owned disposable fixture.
 * Only Node, Git, native cleanup/provider tools and declared analyzers are admitted.
 * This observes Node child-process APIs, not subprocesses inside native tools or workers.
 */
export function restrictedConsumerEnvironment(
  directory: string,
  analyzers: string[] = [],
): NodeJS.ProcessEnv {
  const allowed = [realpathSync(process.execPath), resolveExecutable("git")];
  const toolDirectory = join(directory, "restricted-tools");
  mkdirSync(toolDirectory, { recursive: true });
  let pathValue: string;
  if (process.platform === "win32") {
    const system = join(process.env.SystemRoot ?? "C:\\Windows", "System32");
    const powershellDirectory = join(system, "WindowsPowerShell", "v1.0");
    for (const helper of [
      join(system, "taskkill.exe"),
      join(powershellDirectory, "powershell.exe"),
    ]) {
      allowed.push(resolveExecutable(helper));
    }
    pathValue = [
      dirname(process.execPath),
      dirname(allowed[1]),
      system,
      powershellDirectory,
    ].join(delimiter);
  } else {
    allowed.push(resolveExecutable("ps"));
    for (const [index, name] of ["node", "git", "ps"].entries()) {
      symlinkSync(allowed[index], join(toolDirectory, name));
    }
    pathValue = toolDirectory;
  }
  for (const analyzer of analyzers) {
    if (!isAbsolute(analyzer))
      throw new Error(`analyzer must be absolute: ${analyzer}`);
    allowed.push(resolveExecutable(analyzer));
  }
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.toUpperCase() === "PATH") delete environment[key];
  }
  const preload = pathToFileURL(
    resolve(import.meta.dirname, "spawn-guard.mjs"),
  ).href;
  return {
    ...environment,
    PATH: pathValue,
    NODE_OPTIONS: `--import=${preload}`,
    GOAT_TEST_SPAWN_PRELOAD: preload,
    GOAT_TEST_SPAWN_ALLOWED: JSON.stringify(allowed),
    GOAT_TEST_SPAWN_LOG: join(directory, "spawn-journal.jsonl"),
  };
}
