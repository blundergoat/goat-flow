/** Native hook cleanup retains the existing owned-tree contract without a shell launch. */
import { spawnSync, type ChildProcess } from "node:child_process";
import { win32 } from "node:path";

/**
 * Resolve the OS tree terminator without consulting project PATH or cwd.
 * Contract: a missing or relative Windows root returns null for direct-process fallback.
 */
export function windowsTaskkillExecutablePath(
  environment: NodeJS.ProcessEnv,
): string | null {
  const root = environment.SystemRoot || environment.WINDIR || "";
  return win32.isAbsolute(root)
    ? win32.join(root, "System32", "taskkill.exe")
    : null;
}

/**
 * Parse positive process identities from the bounded ps result.
 * Ignore incomplete rows so they cannot identify unrelated work for cleanup.
 */
function readHookProcessChildren(
  output: string,
): Map<number, { processId: number; groupId: number }[]> {
  const childrenByParent = new Map<
    number,
    { processId: number; groupId: number }[]
  >();
  for (const row of output.trim().split("\n")) {
    const [processId = NaN, parentId = NaN, groupId = NaN] = row
      .trim()
      .split(/[ \t]+/u)
      .map(Number);
    if (
      ![processId, parentId, groupId].every(
        (id) => Number.isSafeInteger(id) && id > 0,
      )
    )
      continue;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push({ processId, groupId });
    childrenByParent.set(parentId, siblings);
  }
  return childrenByParent;
}

/** Starts one bounded process lookup; failure returns no extra owned groups. */
function findDetachedHookProcessGroups(hookProcessId: number): number[] {
  const lookup = spawnSync("ps", ["-e", "-o", "pid=,ppid=,pgid="], {
    encoding: "utf8",
    timeout: 1000,
    maxBuffer: 262_144,
    windowsHide: true,
  });
  if (lookup.status !== 0 || lookup.error) return [];
  const childrenByParent = readHookProcessChildren(lookup.stdout);
  const descendantIds = new Set([hookProcessId]);
  const detachedGroups = new Set<number>();
  for (const parentId of descendantIds) {
    for (const child of childrenByParent.get(parentId) ?? []) {
      descendantIds.add(child.processId);
      if (child.groupId === child.processId) detachedGroups.add(child.groupId);
    }
  }
  return [...detachedGroups].reverse();
}

/**
 * Stop a hook's owned descendants, including detached POSIX groups.
 * Contract: the launcher must have started the POSIX hook as a detached process group.
 * Mutates process state; swallows exit races, and a failed Windows tree kill falls back to its direct child.
 */
export function stopHookProcessTree(
  hookProcess: ChildProcess,
  hostPlatform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
): void {
  if (!hookProcess.pid) return;
  try {
    if (hostPlatform === "win32") {
      const executable = windowsTaskkillExecutablePath(environment);
      if (executable === null) {
        hookProcess.kill("SIGKILL");
        return;
      }
      const result = spawnSync(
        executable,
        ["/pid", String(hookProcess.pid), "/T", "/F"],
        {
          stdio: "ignore",
          timeout: 1000,
          windowsHide: true,
        },
      );
      if (result.status !== 0) hookProcess.kill("SIGKILL");
      return;
    }
    // Detached checks need stopping before the parent relationships disappear.
    for (const groupId of findDetachedHookProcessGroups(hookProcess.pid)) {
      try {
        process.kill(-groupId, "SIGKILL");
      } catch {
        // Ignore cleanup races with a child finishing after the process snapshot.
      }
    }
    process.kill(-hookProcess.pid, "SIGKILL");
  } catch {
    // Cleanup is best effort when the process exits or the host refuses a signal.
  }
}
