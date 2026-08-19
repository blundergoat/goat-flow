/**
 * Process- and global-state fixtures for tests that must temporarily replace a
 * `process.env` variable or a global such as `Date`. Use these instead of
 * writing to the global inline: each snapshots the prior value, applies the
 * override, and restores it in `finally` even when the body throws - which
 * keeps the mutation scoped to one callback and isolates the fixture, the shape
 * gruff's `test-quality.global-state-mutation` rule asks for (the rule flags any
 * `process.env.X =` / `globalThis.X =` text inside a test block, regardless of
 * restore). (search: "test-quality.global-state-mutation")
 *
 * Footgun: `process.env` and `globalThis` are process-wide, so these helpers
 * bound a mutation in time, not across truly-parallel tests. Two tests that
 * override the same key concurrently can still race - keep them in separate
 * files or use distinct keys.
 */

/**
 * Apply `process.env` overrides and return a function that restores the prior
 * values. Use in an imperative `try { ... } finally { restore() }` when the body
 * is long enough that callback-wrapping (`withEnv`) would hurt readability, or
 * when env teardown must interleave with other cleanup (e.g. a temp project).
 *
 * @param overrides - env keys to set; each key's prior value (including the
 *   "previously unset" case) is captured so the returned function can restore it.
 * @returns a restore function that reverts every overridden key to its prior value.
 */
export function setEnv(overrides: Record<string, string>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  return () => {
    for (const [key, prior] of previous) {
      if (prior === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prior;
      }
    }
  };
}

/**
 * Run `fn` with `process.env` overrides applied, restoring prior values after.
 * Prefer this scoped form over {@link setEnv} when the body is a single call or
 * short block, so restore can't be forgotten.
 *
 * @param overrides - env keys to set for the duration of `fn`.
 * @param block - work to run under the overrides; may be synchronous or async.
 * @returns whatever `fn` resolves to, after env has been restored.
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
 * Run `fn` with the global `Date` constructor replaced by `fake`, then restore
 * the real `Date`. Use for tests that pin "now" or calendar getters.
 *
 * @param fake - stand-in `Date` constructor, typically a local `class extends Date`.
 * @param block - synchronous work to run while the stub is installed.
 * @returns whatever `fn` returns, after the real `Date` has been restored.
 */
export function withStubbedDate<T>(fake: DateConstructor, block: () => T): T {
  const real = globalThis.Date;
  globalThis.Date = fake;
  try {
    return block();
  } finally {
    globalThis.Date = real;
  }
}
