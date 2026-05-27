import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const HOOKS_VIEW_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "views",
  "hooks.html",
);
const DASHBOARD_APP_PATH = resolve(PROJECT_ROOT, "src", "dashboard", "app.ts");
const DASHBOARD_STYLES_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "styles.css",
);

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

describe("dashboard hooks view", () => {
  it("uses the grouped hooks manager layout without owning shell navigation", () => {
    const view = read(HOOKS_VIEW_PATH);
    const styles = read(DASHBOARD_STYLES_PATH);

    assert.match(view, /class="gf-hooks-summary"/);
    assert.match(view, /class="gf-hooks-toolbar"/);
    assert.match(view, /hooksForSection\(section\.id\)/);
    assert.match(view, /class="gf-hook-row"/);
    assert.match(view, /role="switch"/);
    assert.match(view, /class="gf-hooks-legend"/);
    assert.doesNotMatch(view, /gf-side-link/);
    assert.doesNotMatch(view, /gf-side-nav/);
    assert.match(styles, /\.gf-hooks-summary/);
    assert.match(styles, /\.gf-hook-switch/);
  });

  it("labels hook-specific unsupported surfaces without implying agent support is unavailable", () => {
    const appSource = read(DASHBOARD_APP_PATH);

    assert.match(
      appSource,
      /if \(!state\.supported\) return "not for this hook"/,
    );
    assert.doesNotMatch(appSource, /return "not supported"/);
    assert.doesNotMatch(appSource, /return "unavailable"/);
  });
});
