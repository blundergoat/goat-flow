/**
 * Assertion helper that narrows nullable values after test fixture lookups.
 */
import assert from "node:assert/strict";

/**
 * Assert a value is present and narrow it, so the rest of a test can use it without optional chaining.
 *
 * @param value - value under test; null or undefined fails the assertion rather than silently passing through
 * @param message - optional failure text; omitted uses Node's default, which names the assertion but not the fixture
 * @returns nothing; on return the value is narrowed to non-nullable for the remainder of the test
 */
export function assertExists<T>(
  value: T,
  message?: string | Error,
): asserts value is NonNullable<T> {
  assert.ok(value != null, message);
}
