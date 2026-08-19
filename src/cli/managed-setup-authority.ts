/**
 * Resolves what one install run is allowed to replace, and records that decision per path.
 *
 * Authority is deliberately narrow: a conflict is admitted only by an authority that names its ownership, and a named path must match a row the user
 * could actually see in the preview.
 *
 * Nothing here can reach a redirected or unreadable destination - path safety is decided from filesystem evidence before authority is consulted, and
 * no flag combination overrides it.
 */

/** Every authority the user supplied for one install or preview run. */
export interface ManagedSetupAuthority {
  /** `--force-managed`, or its bare `--force` alias, admits every inspected system-owned conflict. */
  shouldReplaceAllManagedConflicts: boolean;
  /** Repeated `--force-path` values; each names one project-relative destination. */
  namedPaths: readonly string[];
  /** `--force-user-owned` widens the named paths to user-owned destinations, and only those. */
  shouldReplaceNamedUserOwned: boolean;
}

/** What the supplied authority decided for one previewed destination. */
export type ManagedSetupAuthorityDecision =
  | "not-required"
  | "granted-managed"
  | "granted-path"
  | "granted-user-owned"
  | "withheld"
  | "refused-replaceability"
  | "refused-path-safety";

/** The row fields authority resolution reads; the full preview row satisfies this shape. */
interface AuthorityInput {
  path: string;
  ownership: "system-owned" | "user-owned" | "generated";
  isConflict: boolean;
  isPathUnsafe: boolean;
  isReplaceable: boolean;
}

/** An authority carrying nothing, used for preview runs where the user supplied no flags. */
export const NO_MANAGED_SETUP_AUTHORITY: ManagedSetupAuthority = {
  shouldReplaceAllManagedConflicts: false,
  namedPaths: [],
  shouldReplaceNamedUserOwned: false,
};

/** Resolve the two-part authority required to replace one user-owned destination. */
function resolveUserOwnedAuthorityDecision(
  row: AuthorityInput,
  authority: ManagedSetupAuthority,
  isNamed: boolean,
): ManagedSetupAuthorityDecision {
  if (!authority.shouldReplaceNamedUserOwned || !isNamed) return "not-required";
  if (!row.isReplaceable) return "refused-replaceability";
  return row.isPathUnsafe ? "refused-path-safety" : "granted-user-owned";
}

/**
 * Decide what the supplied authority permits for one destination.
 * Use while building each preview row so the report and the admission gate cannot disagree.
 *
 * @param row - one destination's ownership plus its conflict and path-safety evidence
 * @param authority - every authority the user supplied for this run
 * @returns the decision shown beside the row; never null because every row has an outcome
 */
export function resolveAuthorityDecision(
  row: AuthorityInput,
  authority: ManagedSetupAuthority,
): ManagedSetupAuthorityDecision {
  const isNamed = authority.namedPaths.includes(row.path);

  // A user-owned destination is replaced only when both flags name it together.
  if (row.ownership === "user-owned") {
    return resolveUserOwnedAuthorityDecision(row, authority, isNamed);
  }

  // Generated files are rewritten from project state, so they need no authority at all.
  if (row.ownership === "generated") return "not-required";

  // A system-owned row that is not a conflict is already safe to refresh or leave alone.
  if (!row.isConflict) return "not-required";

  // Redirected or unreadable destinations stay refused however broad the authority is.
  if (row.isPathUnsafe) return "refused-path-safety";

  // A path named without `--force-user-owned` still authorizes its system-owned conflict.
  if (isNamed) return "granted-path";
  return authority.shouldReplaceAllManagedConflicts
    ? "granted-managed"
    : "withheld";
}

/**
 * Report named paths that match no destination this preview could act on.
 * Use before running an install so a typo or stale path fails loudly instead of being ignored.
 *
 * @param authority - every authority the user supplied for this run
 * @param admittedPaths - paths whose rows the supplied authority actually granted
 * @returns unmatched named paths in the order the user supplied them; empty means every name landed
 */
export function unmatchedAuthorityPaths(
  authority: ManagedSetupAuthority,
  admittedPaths: readonly string[],
): string[] {
  return authority.namedPaths.filter((path) => !admittedPaths.includes(path));
}
