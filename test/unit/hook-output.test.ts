/** Native output capture protects byte budgets and strict EOF decoding before launcher integration. */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appendBoundedHookOutput,
  createCapturedHookOutput,
  finishCapturedHookOutput,
} from "../../workflow/hooks/hook-output.mjs";

test("retains split result bytes and rejects damaged or incomplete UTF-8", () => {
  const bytes = Buffer.from("a🐐z");
  for (let offset = 1; offset < bytes.length; offset += 1) {
    const capture = createCapturedHookOutput(true);
    assert.equal(
      appendBoundedHookOutput(capture, "stdout", bytes.subarray(0, offset)),
      true,
    );
    assert.equal(
      appendBoundedHookOutput(capture, "stdout", bytes.subarray(offset)),
      true,
    );
    assert.equal(finishCapturedHookOutput(capture), false);
    assert.equal(capture.stdout, "a🐐z");
    assert.equal(capture.output?.stdoutBytes, bytes.length);
  }
  for (const damaged of [
    Buffer.from([0xff]),
    Buffer.from("🐐").subarray(0, 3),
  ]) {
    const capture = createCapturedHookOutput(true);
    assert.equal(appendBoundedHookOutput(capture, "stdout", damaged), true);
    assert.equal(finishCapturedHookOutput(capture), true);
  }
  const empty = createCapturedHookOutput(true);
  assert.equal(finishCapturedHookOutput(empty), false);
  assert.equal(empty.stdout, "");
  assert.equal(empty.stderr, "");
  assert.equal(empty.output?.stdoutBytes, 0);
  assert.equal(empty.output?.stderrBytes, 0);
});

test("drains managed diagnostics beyond retention without losing the result", () => {
  const capture = createCapturedHookOutput(true);
  // The retention boundary cuts a real character; omitted diagnostic bytes must not invent a replacement character.
  const diagnostics = Buffer.from("x".repeat(4095) + "🐐");
  assert.equal(appendBoundedHookOutput(capture, "stderr", diagnostics), true);
  assert.equal(appendBoundedHookOutput(capture, "stderr", "tail"), true);
  assert.equal(appendBoundedHookOutput(capture, "stdout", "result"), true);
  assert.equal(finishCapturedHookOutput(capture), false);
  assert.equal(capture.stdout, "result");
  assert.equal(capture.stderr, "x".repeat(4095));
  assert.equal(capture.output?.stdoutBytes, 6);
  assert.equal(capture.output?.stderrBytes, diagnostics.length + 4);
  assert.equal(capture.output?.isStderrTruncated, true);
  assert.equal(capture.output?.areByteCountsExact, false);
});

test("preserves managed ceilings and the legacy shared output cap", () => {
  for (const boundary of [
    { stream: "stdout", limit: 65_536, stage: "envelope" },
    { stream: "stderr", limit: 1_048_576, stage: "diagnostic-flood" },
  ] as const) {
    const capture = createCapturedHookOutput(true);
    const content =
      boundary.stream === "stdout"
        ? "x".repeat(boundary.limit - 4) + "🐐"
        : "x".repeat(boundary.limit);
    assert.equal(
      appendBoundedHookOutput(capture, boundary.stream, content),
      true,
    );
    assert.equal(appendBoundedHookOutput(capture, boundary.stream, "x"), false);
    assert.equal(
      capture.output?.[
        boundary.stream === "stdout" ? "stdoutBytes" : "stderrBytes"
      ],
      boundary.limit + 1,
    );
    assert.equal(capture.output?.failureStage, boundary.stage);
    assert.equal(capture.output?.areByteCountsExact, false);
  }
  const legacy = createCapturedHookOutput(false);
  assert.equal(legacy.output, undefined);
  assert.equal(
    appendBoundedHookOutput(legacy, "stdout", "x".repeat(9999)),
    true,
  );
  assert.equal(appendBoundedHookOutput(legacy, "stderr", "e"), true);
  assert.equal(appendBoundedHookOutput(legacy, "stderr", "x"), false);
  assert.equal(legacy.stdout.length + legacy.stderr.length, 10_000);
  assert.equal(legacy.output?.failureStage, undefined);
});
