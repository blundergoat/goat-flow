import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const DASHBOARD_INDEX_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "index.html",
);
const DASHBOARD_APP_PATH = resolve(PROJECT_ROOT, "src", "dashboard", "app.ts");
const PLANS_VIEW_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "views",
  "plans.html",
);
const COMING_SOON_VIEW_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "views",
  "coming-soon.html",
);

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

describe("dashboard side navigation", () => {
  it("renders the requested desktop side menu without disabled destinations", () => {
    const html = read(DASHBOARD_INDEX_PATH);
    const sideMenu = html.slice(
      html.indexOf('<aside class="no-print gf-side-nav"'),
      html.indexOf("</aside>") + "</aside>".length,
    );

    assert.doesNotMatch(html, /class="gf-nav-wrap"/);
    assert.match(html, /'gf-side-collapsed': sideNavCollapsed/);
    assert.match(sideMenu, /class="gf-side-collapse-btn"/);
    assert.match(sideMenu, /@click="toggleSideNav\(\)"/);
    assert.match(sideMenu, /aria-label="goat-flow Home"/);
    assert.match(sideMenu, /class="gf-side-logo-emoji"[\s\S]*🐐/);
    assert.match(sideMenu, /class="gf-side-logo-text"[\s\S]*goat-flow/);
    assert.match(html, /id="gf-side-icon-home"/);
    assert.match(sideMenu, /href="#gf-side-icon-home"/);
    assert.match(sideMenu, /class="gf-side-icon"/);
    assert.match(sideMenu, /aria-label="Primary navigation"/);
    for (const label of ["Managers", "Operations"]) {
      assert.match(sideMenu, new RegExp(`>\\s*${label}\\s*<`));
    }
    assert.match(
      sideMenu,
      />\s*Home\s*<[\s\S]*>\s*Prompts\s*<[\s\S]*>\s*Workspace\s*</,
    );
    assert.match(
      sideMenu,
      />\s*Managers\s*<[\s\S]*>\s*Skill Evaluator\s*<[\s\S]*>\s*Plans\s*</,
    );
    assert.match(
      sideMenu,
      />\s*Operations\s*<[\s\S]*>\s*Projects\s*<[\s\S]*>\s*Quality\s*<[\s\S]*>\s*Setup\s*</,
    );
    for (const label of [
      "Home",
      "Prompts",
      "Workspace",
      "Skill Evaluator",
      "Plans",
      "Projects",
      "Quality",
      "Setup",
    ]) {
      assert.match(sideMenu, new RegExp(`>\\s*${label}\\s*<`));
    }
    for (const label of [
      "Context",
      "Constraints",
      "Verification",
      "Recovery",
      "Feedback Loop",
      "Harness Overview",
      "Harness",
      "Hooks",
      "Memory",
      "Playbooks",
      "Telemetry",
    ]) {
      assert.doesNotMatch(sideMenu, new RegExp(`>\\s*${label}\\s*<`));
    }
    for (const label of ["Settings", "About"]) {
      assert.doesNotMatch(sideMenu, new RegExp(`>\\s*${label}\\s*<`));
    }
    assert.doesNotMatch(sideMenu, /\sdisabled(?:=|\s|>)/);
  });

  it("keeps Settings and About in the header and supports a compact rail", () => {
    const html = read(DASHBOARD_INDEX_PATH);
    const appSource = read(DASHBOARD_APP_PATH);
    const sideMenu = html.slice(
      html.indexOf('<aside class="no-print gf-side-nav"'),
      html.indexOf("</aside>") + "</aside>".length,
    );

    assert.doesNotMatch(sideMenu, /gf-side-nav-group-secondary/);
    assert.doesNotMatch(sideMenu, /data-short="St"[\s\S]*Settings/);
    assert.doesNotMatch(sideMenu, /data-short="A"[\s\S]*About/);
    assert.match(html, /title="Settings"[\s\S]*aria-label="Settings"/);
    assert.match(html, /title="About"[\s\S]*aria-label="About"/);
    assert.match(appSource, /sideNavCollapsed:/);
    assert.match(appSource, /localStorage\.getItem\("gf-side-nav-collapsed"\)/);
    assert.match(appSource, /toggleSideNav\(\)/);
    assert.match(
      appSource,
      /localStorage\.setItem\(\s*"gf-side-nav-collapsed"/,
    );
  });

  it("keeps project switching in the header and includes Plans plus Coming Soon views", () => {
    const html = read(DASHBOARD_INDEX_PATH);
    const plansView = read(PLANS_VIEW_PATH);
    const comingSoonView = read(COMING_SOON_VIEW_PATH);

    assert.match(html, /@click="openBrowser\(\)"/);
    assert.match(html, /<!-- include: views\/plans\.html -->/);
    assert.match(html, /<!-- include: views\/coming-soon\.html -->/);
    assert.match(plansView, /x-show="activeView === 'plans'"/);
    assert.match(plansView, /loadTasks\(\)/);
    assert.match(
      plansView,
      /@gf-set-active-task-plan="setActiveTaskPlan\(\$event\.detail\.planName\)"/,
    );
    assert.match(
      plansView,
      /\$dispatch\('gf-set-active-task-plan', \{ planName: plan\.name \}\)/,
    );
    assert.match(plansView, /What active plan means/);
    assert.match(plansView, /Active is the default work plan/);
    assert.match(plansView, /Set active plan/);
    assert.match(comingSoonView, /x-show="isComingSoonView\(\)"/);
    assert.match(comingSoonView, /comingSoonMeta\(activeView\)/);
  });

  it("keeps deferred dashboard pages out of coming-soon metadata", () => {
    const appSource = read(DASHBOARD_APP_PATH);

    for (const view of [
      "harness",
      "playbooks",
      "hooks",
      "memory",
      "telemetry",
    ]) {
      assert.doesNotMatch(
        appSource,
        new RegExp(`["']?${view}["']?\\s*:\\s*\\{\\s*title:\\s*["']`, "u"),
        `${view} is deferred; it should not appear in 1.7.0 comingSoonMeta`,
      );
    }
  });

  it("does not include deferred harness manager views", () => {
    const html = read(DASHBOARD_INDEX_PATH);
    for (const view of [
      "harness",
      "feedback-loop",
      "context",
      "constraints",
      "verification",
      "recovery",
      "hooks",
      "memory",
      "playbooks",
    ]) {
      assert.doesNotMatch(
        html,
        new RegExp(`<!-- include: views\\/${view}\\.html -->`),
      );
    }
  });
});
