/**
 * Dashboard HTML shell contract: GET / returns text/html injecting the runtime globals (default
 * path, version, token, agents, runner ids, presets), links every dashboard asset script, and
 * renders exactly one Home view root.
 */
import { assert, baseUrl, describe, it } from "./dashboard-server.helpers.js";
import { loadDashboardPresets } from "../../src/cli/server/dashboard-assets.js";
import { resolveProjectIdentity } from "../../src/cli/server/dashboard-project-state.js";
import {
  createDashboardAuditProfiler,
  shouldProfileAuditRequest,
} from "../../src/cli/server/dashboard-reporting.js";
import {
  buildSetupDetectPayload,
  isProjectDirectory,
} from "../../src/cli/server/setup-detect.js";

describe("dashboard HTML", () => {
  it("exercises dashboard support helper behaviour behind the server integration surface", () => {
    const profiler = createDashboardAuditProfiler(true);
    const profiled = profiler.span("demo", () => "ok");

    assert.equal(loadDashboardPresets().length > 0, true);
    assert.equal(
      resolveProjectIdentity(process.cwd()).currentPath.length > 0,
      true,
    );
    assert.equal(
      shouldProfileAuditRequest(
        new URL("http://localhost/?profile=true"),
        true,
      ),
      true,
    );
    assert.equal(profiled, "ok");
    assert.equal(profiler.spans.length, 1);
    assert.equal(isProjectDirectory(process.cwd()), true);
    assert.equal(
      buildSetupDetectPayload(process.cwd()).languages.length > 0,
      true,
    );
  });

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
    assert.equal(
      html.match(/x-show="activeView === 'home'"/g)?.length ?? 0,
      1,
      "dashboard HTML should contain exactly one Home view root",
    );
  });
});
