/**
 * Temporarily replace environment values or the clock while testing a user's configuration or date-dependent output.
 *
 * Use the returned cleanup or scoped callback to restore the original state even when a test fails.
 * These values are process-wide, so tests overriding the same key must not run concurrently in one process.
 */

/**
 * Apply environment overrides for a test and return cleanup for its finally block.
 * Use when teardown must also restore other fixtures or a callback would obscure the test.
 *
 * @param overrides - environment values for the test; an empty object changes nothing
 * @returns cleanup that restores previous values and removes keys that were originally unset
 */
export function setEnv(overrides: Record<string, string>): () => void {
  const previous = new Map<string, string | undefined>();
  // Keep each key's original value so this test cannot leave a changed setting for the next case.
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  return () => {
    // Restore every overridden setting, including those the test introduced for the first time.
    for (const [key, prior] of previous) {
      // A previously unset variable must disappear again so later tests exercise the normal default.
      if (prior === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prior;
      }
    }
  };
}

/**
 * Run a test callback with temporary environment values, then restore them even if the callback throws.
 *
 * @param overrides - environment values for this callback; an empty object leaves the environment unchanged
 * @param block - synchronous or asynchronous test work to finish before restoring the environment
 * @returns the callback's result after restoration; callback failures propagate
 */
export async function withEnv<T>(
  overrides: Record<string, string>,
  block: () => T | Promise<T>,
): Promise<T> {
  const restore = setEnv(overrides);
  try {
    return await block();
  } finally {
    restore();
  }
}

/**
 * Pin the global clock for a synchronous test of date-dependent user output, then restore the original constructor.
 *
 * @param fake - Date constructor supplying the test's chosen time
 * @param block - synchronous test work to finish before restoring the clock
 * @returns the callback's result after restoration; callback failures propagate
 */
export function withStubbedDate<T>(fake: DateConstructor, block: () => T): T {
  const originalDate = globalThis.Date;
  globalThis.Date = fake;
  try {
    return block();
  } finally {
    globalThis.Date = originalDate;
  }
}
