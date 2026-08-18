/**
 * Assertion helper that narrows nullable values after test fixture lookups.
 */
import assert from "node:assert/strict";

/**
 * Assert a value is present and narrow it, so the rest of a test can use it without optional chaining.
 *
 * @param candidate - value under test; null or undefined fails the assertion rather than silently passing through
 * @param message - optional failure text; omitted uses Node's default, which names the assertion but not the fixture
 * @returns nothing; on return the value is narrowed to non-nullable for the remainder of the test
 */
export function assertExists<T>(
  candidate: T,
  message?: string | Error,
): asserts candidate is NonNullable<T> {
  assert.ok(candidate != null, message);
}
