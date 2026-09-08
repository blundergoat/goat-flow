/**
 * Check that the built dashboard offers users the current preset prompts.
 *
 * The slow suite builds first, so contributors can run source contracts without generated assets.
 * Use this check after changing presets or the build step that copies them into the dashboard.
 */
import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

it("keeps dashboard preset source/dist parity", () => {
  assert.equal(
    readFileSync(
      new URL("../../dist/dashboard/preset-prompts.json", import.meta.url),
      "utf8",
    ),
    readFileSync(
      new URL("../../src/dashboard/preset-prompts.json", import.meta.url),
      "utf8",
    ),
    "dashboard preset source/dist parity",
  );
});
