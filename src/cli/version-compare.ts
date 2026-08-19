/**
 * Compares goat-flow release versions so callers can tell which side of a version skew they are on.
 *
 * Version checks that only test inequality cannot tell "project is ahead of this CLI" from "project is behind", and an older CLI that assumes the
 * second case will prescribe a downgrade of a newer install.
 * Use this module wherever a mismatch drives user-facing remediation or a file write.
 */

const RELEASE_VERSION = /^\d+\.\d+\.\d+$/u;

/**
 * Check that a version reads as a plain `X.Y.Z` release we can safely rank.
 * Use before any version comparison, so a hand-edited or pre-release value in the user's project is screened out up front instead of producing a
 * confusing upgrade prompt.
 *
 * @param version - version text read from the user's project config or hook stamp; empty
 *   means nothing was recorded there yet, which counts as not comparable
 * @returns true when the value can be ranked; false means the CLI should stay quiet about
 *   version skew rather than guess which side is newer
 */
export function isReleaseVersion(version: string): boolean {
  return RELEASE_VERSION.test(version);
}

/**
 * Split a release into its major, minor, and patch numbers so they can be compared.
 * Use only behind an `isReleaseVersion` check - this is the strict inner step that refuses to interpret anything it was not handed in plain `X.Y.Z`
 * form.
 *
 * @param version - a release already confirmed comparable; an empty or pre-release value is
 *   rejected rather than quietly read as `0.0.0`
 * @returns the three numbers in order, so callers can compare them position by position
 * @throws TypeError when the version is not plain `X.Y.Z`; callers reading versions from a
 *   user's project must screen with `isReleaseVersion` first, so someone who hand-edited
 *   their config to `1.2` sees a skew message instead of a crash
 */
function releaseNumberParts(version: string): [number, number, number] {
  // Not a rankable release, so refuse rather than invent an ordering the user would act on.
  if (!isReleaseVersion(version)) {
    throw new TypeError(
      `version must use numeric X.Y.Z release format: ${JSON.stringify(version)}`,
    );
  }

  const [major, minor, patch] = version.split(".");
  return [Number(major), Number(minor), Number(patch)];
}

/**
 * Rank two goat-flow releases so the CLI can tell the user which side is out of date.
 * Use when a project's recorded version and the running CLI disagree and the user needs to be pointed at upgrading one side rather than the other.
 *
 * @param leftVersion - usually the version recorded in the user's project
 * @param rightVersion - usually the version of the CLI the user is running
 * @returns `1` when the left side is newer, `-1` when it is older, `0` when the two match
 *   and there is no skew worth mentioning to the user
 * @throws TypeError when either value is not plain `X.Y.Z`; screen with `isReleaseVersion`
 *   first so a hand-edited config produces a message rather than a crash
 */
export function compareVersions(
  leftVersion: string,
  rightVersion: string,
): number {
  const left = releaseNumberParts(leftVersion);
  const right = releaseNumberParts(rightVersion);
  const width = Math.max(left.length, right.length);

  // Major first, then minor, then patch - the first difference decides who is newer.
  for (let position = 0; position < width; position += 1) {
    const delta = (left[position] ?? 0) - (right[position] ?? 0);

    // This position settles it; later positions cannot overturn a difference here.
    if (delta !== 0) return delta > 0 ? 1 : -1;
  }

  // Every position matched, so both sides are the same release and there is no skew.
  return 0;
}

/**
 * Report whether an installed artifact is stamped newer than the CLI inspecting it.
 * Callers use this to stop recommending or performing a downgrade of a newer install.
 *
 * @param installedVersion - version recorded in the user's project config or hook stamp;
 *   empty or unreadable means we cannot tell, and the CLI stays quiet
 * @param cliVersion - version of the CLI the user is currently running
 * @returns true when the project is ahead and the CLI is the stale side; false also covers
 *   "cannot tell", so callers must not read it as "the project is behind"
 */
export function projectIsAheadOfCli(
  installedVersion: string,
  cliVersion: string,
): boolean {
  // One side is not a plain release, so we cannot rank them and say nothing rather than
  // nudging the user toward the wrong upgrade.
  if (!isReleaseVersion(installedVersion) || !isReleaseVersion(cliVersion)) {
    return false;
  }

  return compareVersions(installedVersion, cliVersion) > 0;
}
