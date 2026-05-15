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
const TASKS_VIEW_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "views",
  "tasks.html",
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
    assert.match(sideMenu, /aria-label="Primary navigation"/);
    for (const label of ["Harness", "Managers", "Operations"]) {
      assert.match(sideMenu, new RegExp(`>\\s*${label}\\s*<`));
    }
    for (const label of [
      "Home",
      "Workspace",
      "Tasks",
      "Context",
      "Constraints",
      "Verification",
      "Recovery",
      "Feedback Loop",
      "Skills",
      "Playbooks",
      "Hooks",
      "Memory",
      "Prompts",
      "Projects",
      "Telemetry",
      "Setup",
      "Quality",
      "Settings",
      "About",
    ]) {
      assert.match(sideMenu, new RegExp(`>\\s*${label}\\s*<`));
    }
    assert.doesNotMatch(sideMenu, /\sdisabled(?:=|\s|>)/);
  });

  it("keeps project switching in the header and includes Tasks plus Coming Soon views", () => {
    const html = read(DASHBOARD_INDEX_PATH);
    const tasksView = read(TASKS_VIEW_PATH);
    const comingSoonView = read(COMING_SOON_VIEW_PATH);

    assert.match(html, /@click="openBrowser\(\)"/);
    assert.match(html, /<!-- include: views\/tasks\.html -->/);
    assert.match(html, /<!-- include: views\/coming-soon\.html -->/);
    assert.match(tasksView, /x-show="activeView === 'tasks'"/);
    assert.match(tasksView, /loadTasks\(\)/);
    assert.match(comingSoonView, /x-show="isComingSoonView\(\)"/);
    assert.match(comingSoonView, /comingSoonMeta\(activeView\)/);
  });

  it("maps unimplemented side-menu items to coming-soon metadata", () => {
    const appSource = read(DASHBOARD_APP_PATH);

    for (const view of [
      "context",
      "constraints",
      "verification",
      "recovery",
      "feedback-loop",
      "playbooks",
      "hooks",
      "memory",
      "telemetry",
    ]) {
      assert.match(appSource, new RegExp(`["']?${view}["']?\\s*:`));
    }
  });
});
