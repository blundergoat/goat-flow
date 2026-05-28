import assert from "node:assert/strict";

export function assertExists<T>(
  value: T,
  message?: string | Error,
): asserts value is NonNullable<T> {
  assert.ok(value != null, message);
}
