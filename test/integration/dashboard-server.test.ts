/**
 * Dashboard HTML shell contract: GET / returns text/html injecting the runtime globals (default
 * path, version, token, agents, runner ids, presets), links every dashboard asset script, and
 * renders exactly one Home view root. Unknown routes and asset files return 404 instead of the shell.
 */
import { assert, baseUrl, describe, it } from "./dashboard-server.helpers.js";

describe("dashboard HTML", () => {
  it("GET / returns HTML shell with the expected scripts", async () => {
    const res = await fetch(baseUrl);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/i);

    const html = await res.text();
    assert.match(html, /__GOAT_FLOW_DEFAULT_PATH__/);
    assert.match(html, /__GOAT_FLOW_VERSION__/);
    assert.match(html, /__GOAT_FLOW_DASHBOARD_TOKEN__/);
    assert.match(html, /__GOAT_FLOW_AGENTS__/);
    assert.match(html, /__GOAT_FLOW_RUNNER_IDS__/);
    assert.match(html, /__GOAT_FLOW_PRESETS__/);
    // Alpine and Tailwind ship vendored locally (1.13.0/M02) - no CDN origins.
    assert.match(html, /\/assets\/alpine\.js/);
    assert.match(html, /\/assets\/tailwind\.js/);
    assert.match(html, /\/assets\/dashboard-readers\.js/);
    assert.match(html, /\/assets\/dashboard-setup-quality\.js/);
    assert.match(html, /\/assets\/dashboard-projects\.js/);
    assert.match(html, /\/assets\/dashboard-custom-prompts\.js/);
    assert.match(html, /\/assets\/dashboard-prompts\.js/);
    assert.match(html, /\/assets\/dashboard-terminal\.js/);
    assert.match(html, /\/assets\/app\.js/);
    assert.match(html, /Refresh Status/u);
    assert.match(html, /return 'Open audit'/u);
    assert.match(html, />\s*Archive\s*</u);
    assert.match(html, />\s*Restore\s*</u);
    assert.doesNotMatch(html, />\s*Audit All\s*</u);
    assert.doesNotMatch(html, />\s*Remove\s*</u);
    assert.equal(
      html.match(/x-show="activeView === 'home'"/g)?.length ?? 0,
      1,
      "dashboard HTML should contain exactly one Home view root",
    );
  });
});

describe("dashboard error handling", () => {
  it("returns 404 for unknown routes", async () => {
    const res = await fetch(`${baseUrl}/nonexistent`);
    assert.equal(res.status, 404);
  });

  it("returns 404 for unknown asset files", async () => {
    const res = await fetch(`${baseUrl}/assets/nonexistent.js`);
    assert.equal(res.status, 404);
  });
});
