/**
 * Assemble feature fragments into the reactive object that the dashboard page reads.
 *
 * Preserve getters so switching project or session recomputes the values shown on screen.
 * Methods share the assembled app as `this`, allowing feature fragments to use the same selection and loading state.
 */
type DashboardAppContext = DashboardTerminalContext &
  DashboardProjectsContext &
  DashboardSetupQualityContext &
  DashboardPromptsContext &
  DashboardCustomPromptsContext &
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional: Alpine adds methods dynamically across classic scripts.
  Record<string, any>;

type DashboardAppFragment = Record<string, unknown> &
  ThisType<DashboardAppContext>;

/**
 * Stitch the dashboard's feature fragments into the one object Alpine binds the page to.
 * Descriptors are copied rather than spread, because a plain spread would evaluate every getter once and freeze the values the page reads.
 *
 * @param fragments - feature fragments in merge order; later fragments replace repeated keys, while no fragments produce an empty app object
 * @returns the assembled app context
 */
function dashboardMergeAppFragments(
  ...fragments: DashboardAppFragment[]
): DashboardAppContext {
  const target: Record<string, unknown> = {};
  // Retain live getters from each feature so derived labels keep responding to user actions after app assembly.
  for (const fragment of fragments) {
    Object.defineProperties(target, Object.getOwnPropertyDescriptors(fragment));
  }
  return target as DashboardAppContext;
}
