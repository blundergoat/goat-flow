/**
 * Fail clearly when a test cannot find an expected user-visible result or fixture value.
 *
 * Use this assertion before reading a nullable lookup result in later expectations.
 * A successful assertion also lets TypeScript treat the value as present.
 */
import assert from "node:assert/strict";

/**
 * Assert a value is present and narrow it, so the rest of a test can use it without optional chaining.
 *
 * @param candidate - value under test; only null or undefined fails, so false, zero, and empty values remain usable
 * @param message - optional failure text; omitted uses Node's default, which names the assertion but not the fixture
 * @returns nothing; on return the value is narrowed to non-nullable for the remainder of the test
 */
export function assertExists<T>(
  candidate: T,
  message?: string | Error,
): asserts candidate is NonNullable<T> {
  // A missing expected result fails here so later field checks do not obscure what the test's scenario lost.
  assert.ok(candidate != null, message);
}
