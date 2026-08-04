/**
 * The error type for plan problems a user can fix themselves.
 * Exporting a plan fails for two very different reasons: the person pointed at the wrong
 * directory or wrote a milestone the parser cannot read, or goat-flow has a bug. Only the
 * first kind should reach them as a short message; the second should crash loudly with a
 * stack trace so it gets reported rather than quietly reworded into advice.
 *
 * This lives in its own module because both halves of the export flow raise it - the parser
 * that reads milestones and the writer that checks destinations - and neither should have to
 * import the other just to throw.
 */

/**
 * Invalid plan input that users can fix without a stack trace.
 * Use for missing plan directories, unreadable milestones, or absent titles.
 */
export class PlansExportInputError extends Error {
  /** Create one usage-safe plan error that the CLI can show without a stack trace. */
  constructor(message: string) {
    super(message);
    this.name = "PlansExportInputError";
  }
}

/**
 * Identify plan-input failures so callers can convert them to friendly usage
 * errors instead of stack traces.
 *
 * @param error - anything thrown while loading a plan; non-plan errors stay unrecognised
 *   so they crash loudly instead of being reworded
 * @returns true when the error is a user-fixable plan input problem
 */
export function isPlansExportInputError(
  error: unknown,
): error is PlansExportInputError {
  return error instanceof PlansExportInputError;
}
