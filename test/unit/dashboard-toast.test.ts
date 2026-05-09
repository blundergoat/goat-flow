import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { resolve } from "node:path";

const DASHBOARD_HTML = resolve(
  import.meta.dirname,
  "../../src/dashboard/index.html",
);

describe("dashboard toast", () => {
  it("colors success and error toasts from toastError state", () => {
    const html = readFileSync(DASHBOARD_HTML, "utf-8");

    assert.match(html, /toastError \? \{ backgroundColor: '#dc2626' \}/);
    assert.match(html, /: \{ backgroundColor: '#16a34a' \}/);
    assert.doesNotMatch(
      html,
      /class="[^"]*bg-red-600[^"]*"/,
      "toast shell must not hardcode the error background",
    );
  });
});
