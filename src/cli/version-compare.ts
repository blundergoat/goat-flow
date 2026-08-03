/**
 * Compares goat-flow release versions so callers can tell which side of a version skew they are on.
 * Version checks that only test inequality cannot tell "project is ahead of this CLI" from "project is behind",
 * and an older CLI that assumes the second case will prescribe a downgrade of a newer install.
 * Use this module wherever a mismatch drives user-facing remediation or a file write.
 */

/** Parse a dotted version into numeric segments; unparseable segments become 0 so malformed input never throws. */
function segments(version: string): number[] {
  return version
    .trim()
    .split(".")
    .map((part) => {
      const parsed = Number.parseInt(part, 10);
      return Number.isNaN(parsed) ? 0 : parsed;
    });
}

/**
 * Compare two dotted versions segment by segment.
 * Missing trailing segments count as 0, so `1.15` and `1.15.0` compare equal.
 * Pre-release and build metadata are not interpreted; goat-flow ships plain `X.Y.Z` releases.
 *
 * @param a - left version, typically the project's recorded version
 * @param b - right version, typically the running CLI's version
 * @returns `1` when `a` is newer than `b`, `-1` when `a` is older, `0` when they are equivalent
 */
export function compareVersions(a: string, b: string): number {
  const left = segments(a);
  const right = segments(b);
  const width = Math.max(left.length, right.length);
  for (let i = 0; i < width; i++) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta !== 0) return delta > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Report whether an installed artifact is stamped newer than the CLI inspecting it.
 * Callers use this to stop recommending or performing a downgrade of a newer install.
 *
 * @param installedVersion - version recorded in the target project (config or hook stamp)
 * @param cliVersion - version of the CLI currently running the check
 * @returns true when the project is ahead of the CLI and the CLI is the stale side
 */
export function projectIsAheadOfCli(
  installedVersion: string,
  cliVersion: string,
): boolean {
  return compareVersions(installedVersion, cliVersion) > 0;
}
