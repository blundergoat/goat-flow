/**
 * Compares goat-flow release versions so callers can tell which side of a version skew they are on.
 * Version checks that only test inequality cannot tell "project is ahead of this CLI" from "project is behind",
 * and an older CLI that assumes the second case will prescribe a downgrade of a newer install.
 * Use this module wherever a mismatch drives user-facing remediation or a file write.
 */

const RELEASE_VERSION = /^\d+\.\d+\.\d+$/u;

/** Return whether a value is one plain numeric `X.Y.Z` goat-flow release. */
export function isReleaseVersion(version: string): boolean {
  return RELEASE_VERSION.test(version);
}

/** Parse one validated release into its three numeric segments. */
function segments(version: string): [number, number, number] {
  if (!isReleaseVersion(version)) {
    throw new TypeError(
      `version must use numeric X.Y.Z release format: ${JSON.stringify(version)}`,
    );
  }
  const [major, minor, patch] = version.split(".");
  return [Number(major), Number(minor), Number(patch)];
}

/**
 * Compare two validated dotted releases segment by segment.
 * Pre-release, build metadata, shortened versions, and malformed segments are rejected;
 * goat-flow ships plain `X.Y.Z` releases.
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
  if (!isReleaseVersion(installedVersion) || !isReleaseVersion(cliVersion)) {
    return false;
  }
  return compareVersions(installedVersion, cliVersion) > 0;
}
