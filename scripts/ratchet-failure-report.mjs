/**
 * Collects everything blocking a warning-ratchet run, grouped by the heading a maintainer reads.
 * Shared by scripts/check-gruff-warning-ratchet.mjs and gruff-warning-ratchet-checks.mjs so one run
 * reports each kind of regression together - new warnings, grown files, stale entries - instead of
 * stopping at the first problem and hiding the rest. The gate prints these lines to stderr and exits
 * non-zero; an empty report means the run passed and the maintainer sees the accepted-debt summary.
 */

// Eight lines per category keeps the worst-case failure readable inside one preflight row; the
// suppressed-count line below preserves the real total, because this limit must never let a large
// regression look small. Raise the threshold only if preflight row details get taller.
const MAX_REPORTED_LINES_PER_CATEGORY = 8;

/**
 * Holds the failure lines for one ratchet run until the gate prints its verdict.
 * Construct one per run, add a line for each thing that blocks the release, then ask it to render.
 * Every check in the ratchet writes here rather than printing directly, which is why a single red run
 * can show a maintainer new debt, grown files, and stale entries side by side.
 */
export class RatchetFailureReport {
  /** Start with nothing recorded, so an untouched report always means the gate passes. */
  constructor() {
    this.failureLinesByCategory = new Map();
  }

  /**
   * Record one thing that blocks this run under the category heading the maintainer will read.
   *
   * @param category - failure heading shown before the colon, such as "new warning"; never empty
   * @param detail - one short line naming the identity, file, or bound that failed
   * @returns nothing; the line is held until the gate prints its verdict
   */
  addFailure(category, detail) {
    const existingLines = this.failureLinesByCategory.get(category) ?? [];
    existingLines.push(detail);
    this.failureLinesByCategory.set(category, existingLines);
  }

  /**
   * Answer whether anything blocks this run, so callers know to stop before comparing further.
   *
   * @returns true once any category holds a line; false means nothing has failed yet
   */
  hasFailures() {
    return this.failureLinesByCategory.size > 0;
  }

  /**
   * Turn the recorded failures into the bounded stderr lines a maintainer reads on a red run.
   * Invariant: truncation is never silent - if lines are dropped, a "... and N more suppressed"
   * line always follows, so a capped report cannot understate how much regressed.
   *
   * @returns printable lines sorted by category; empty means the run had nothing to report
   */
  renderReportLines() {
    const reportLines = [];
    // One block per category, alphabetical, so repeated runs read the same way.
    for (const category of [...this.failureLinesByCategory.keys()].sort()) {
      const categoryLines = this.failureLinesByCategory.get(category);
      // Show the first few examples; the maintainer fixes these before needing the rest.
      for (const detail of categoryLines.slice(
        0,
        MAX_REPORTED_LINES_PER_CATEGORY,
      )) {
        reportLines.push(`${category}: ${detail}`);
      }
      // More failed than fits, so state the hidden count rather than quietly dropping them.
      if (categoryLines.length > MAX_REPORTED_LINES_PER_CATEGORY) {
        reportLines.push(
          `${category}: ... and ${categoryLines.length - MAX_REPORTED_LINES_PER_CATEGORY} more suppressed`,
        );
      }
    }
    return reportLines;
  }
}
