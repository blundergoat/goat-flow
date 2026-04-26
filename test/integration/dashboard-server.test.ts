/**
 * Integration tests for the dashboard HTTP server.
 * Starts a real server, hits public endpoints, and validates response contracts.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  getAgentProfileMap,
  getKnownAgentIds,
} from "../../src/cli/agents/registry.js";
import { normalizeAgentVersionOutput } from "../../src/cli/server/dashboard-routes.js";
import { detectSetupStack } from "../../src/cli/detect/project-stack.js";
import { createFS } from "../../src/cli/facts/fs.js";
import type { AgentId } from "../../src/cli/types.js";

const PROJECT_PATH = resolve(import.meta.dirname, "..", "..");
const DASHBOARD_STATE_PATH = resolve(
  PROJECT_PATH,
  ".goat-flow",
  "dashboard-state.json",
);
const LEGACY_PROJECTS_LIST_PATH = resolve(
  PROJECT_PATH,
  ".goat-flow",
  "dashboard-projects.json",
);
const MISSING_PATH = resolve(PROJECT_PATH, "definitely-missing-dashboard-path");

let server: { port: number; close: () => Promise<void> } | undefined;
let baseUrl = "";
let originalDashboardState: string | null = null;
let originalLegacyProjectsList: string | null = null;

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      );
    }),
  ]);
}

function expectRecord(
  value: unknown,
  context: string,
): Record<string, unknown> {
  assert.equal(typeof value, "object", `${context} should be an object`);
  assert.notEqual(value, null, `${context} should not be null`);
  assert.ok(!Array.isArray(value), `${context} should not be an array`);
  return value as Record<string, unknown>;
}

function assertJsonResponse(res: Response, context: string): void {
  assert.match(
    res.headers.get("content-type") ?? "",
    /application\/json/i,
    `${context} should return JSON`,
  );
}

function assertAuditCheckProvenance(value: unknown, context: string): void {
  const provenance = expectRecord(value, context);
  assert.match(
    String(provenance.source_type),
    /^(spec|vendor_docs|paper|incident|community|unknown)$/,
    `${context}.source_type should be a valid provenance source`,
  );
  assert.equal(
    Array.isArray(provenance.source_urls),
    true,
    `${context}.source_urls should be an array`,
  );
  assert.equal(typeof provenance.verified_on, "string");
  assert.match(
    String(provenance.normative_level),
    /^(MUST|SHOULD|BEST_PRACTICE)$/,
    `${context}.normative_level should be a valid provenance level`,
  );
}

function assertAuditScope(value: unknown, context: string): void {
  const scope = expectRecord(value, context);
  assert.match(
    String(scope.status),
    /^(pass|fail)$/,
    `${context}.status should be pass/fail`,
  );
  assert.ok(
    Array.isArray(scope.checks),
    `${context}.checks should be an array`,
  );
  for (const [index, check] of (scope.checks as unknown[]).entries()) {
    const entry = expectRecord(check, `${context}.checks[${index}]`);
    assertAuditCheckProvenance(
      entry.provenance,
      `${context}.checks[${index}].provenance`,
    );
  }
  assert.ok(
    Array.isArray(scope.failures),
    `${context}.failures should be an array`,
  );
  const summary = expectRecord(scope.summary, `${context}.summary`);
  for (const [key, entry] of Object.entries(summary)) {
    assert.equal(typeof key, "string");
    assert.equal(typeof entry, "string");
  }
}

function assertDashboardReport(value: unknown): Record<string, unknown> {
  const report = expectRecord(value, "Dashboard report");
  assert.match(
    String(report.status),
    /^(pass|fail)$/,
    "Dashboard report status should be pass/fail",
  );
  assert.equal(typeof report.target, "string");
  assert.ok(
    Array.isArray(report.agentScores),
    "Dashboard report agentScores should be an array",
  );
  const scopes = expectRecord(report.scopes, "Dashboard report scopes");
  assertAuditScope(scopes.setup, "Dashboard report scopes.setup");
  assertAuditScope(scopes.agent, "Dashboard report scopes.agent");
  if (scopes.harness !== undefined) {
    assertAuditScope(scopes.harness, "Dashboard report scopes.harness");
  }
  const overall = expectRecord(report.overall, "Dashboard report overall");
  assert.match(
    String(overall.status),
    /^(pass|fail)$/,
    "Dashboard report overall.status should be pass/fail",
  );
  assert.ok(
    Object.prototype.hasOwnProperty.call(report, "learningLoop"),
    "Dashboard report should include learningLoop",
  );
  if (report.learningLoop !== null) {
    const learningLoop = expectRecord(
      report.learningLoop,
      "Dashboard report learningLoop",
    );
    assert.equal(typeof learningLoop.recordCount, "number");
    assert.equal(typeof learningLoop.staleCount, "number");
    assert.equal(typeof learningLoop.oversizedCount, "number");
    assert.match(
      String(learningLoop.status),
      /^(fresh|needs-review|unavailable)$/,
      "Dashboard report learningLoop.status should be valid",
    );
  }
  assert.ok(
    Object.prototype.hasOwnProperty.call(report, "recentLessons"),
    "Dashboard report should include recentLessons",
  );
  assert.ok(
    Array.isArray(report.recentLessons),
    "Dashboard report recentLessons should be an array",
  );
  for (const [index, lesson] of (report.recentLessons as unknown[]).entries()) {
    const entry = expectRecord(
      lesson,
      `Dashboard report recentLessons[${index}]`,
    );
    assert.equal(typeof entry.id, "string");
    assert.equal(typeof entry.title, "string");
    assert.equal(typeof entry.path, "string");
    assert.ok(
      entry.created === null || typeof entry.created === "string",
      `Dashboard report recentLessons[${index}].created should be string or null`,
    );
  }
  return report;
}

async function fetchJson(
  path: string,
  init?: RequestInit,
): Promise<{ res: Response; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, init);
  assertJsonResponse(res, path);
  return { res, body: await res.json() };
}

before(async () => {
  try {
    originalDashboardState = await readFile(DASHBOARD_STATE_PATH, "utf-8");
  } catch {
    originalDashboardState = null;
  }

  try {
    originalLegacyProjectsList = await readFile(
      LEGACY_PROJECTS_LIST_PATH,
      "utf-8",
    );
  } catch {
    originalLegacyProjectsList = null;
  }

  const { serveDashboard } = await import("../../src/cli/server/dashboard.js");
  server = await serveDashboard({ projectPath: PROJECT_PATH });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

after(async () => {
  try {
    if (server) {
      await withTimeout(server.close(), 5000, "dashboard server shutdown");
    }
  } finally {
    if (originalDashboardState === null) {
      await rm(DASHBOARD_STATE_PATH, { force: true });
    } else {
      await writeFile(DASHBOARD_STATE_PATH, originalDashboardState);
    }
    if (originalLegacyProjectsList === null) {
      await rm(LEGACY_PROJECTS_LIST_PATH, { force: true });
    } else {
      await writeFile(LEGACY_PROJECTS_LIST_PATH, originalLegacyProjectsList);
    }
  }
});

describe("dashboard HTML", () => {
  it("GET / returns HTML shell with the expected scripts", async () => {
    const res = await fetch(baseUrl);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/i);

    const html = await res.text();
    assert.match(html, /__GOAT_FLOW_DEFAULT_PATH__/);
    assert.match(html, /__GOAT_FLOW_VERSION__/);
    assert.match(html, /__GOAT_FLOW_AGENTS__/);
    assert.match(html, /__GOAT_FLOW_RUNNER_IDS__/);
    assert.match(html, /__GOAT_FLOW_PRESETS__/);
    assert.match(html, /alpinejs@3/i);
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

describe("dashboard assets", () => {
  it("GET /assets/dashboard-readers.js returns JavaScript", async () => {
    const res = await fetch(`${baseUrl}/assets/dashboard-readers.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /javascript/i);

    const body = await res.text();
    assert.match(body, /function readDashboardReport\(/);
  });

  it("GET /assets/dashboard-setup-quality.js returns JavaScript", async () => {
    const res = await fetch(`${baseUrl}/assets/dashboard-setup-quality.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /javascript/i);

    const body = await res.text();
    assert.match(body, /function dashboardDetectStack\(/);
  });

  it("GET /assets/dashboard-projects.js returns JavaScript", async () => {
    const res = await fetch(`${baseUrl}/assets/dashboard-projects.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /javascript/i);

    const body = await res.text();
    assert.match(body, /function dashboardOpenBrowser\(/);
  });

  it("GET /assets/dashboard-prompts.js returns JavaScript", async () => {
    const res = await fetch(`${baseUrl}/assets/dashboard-prompts.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /javascript/i);

    const body = await res.text();
    assert.match(body, /function dashboardFilteredPresets\(/);
  });

  it("GET /assets/dashboard-custom-prompts.js returns JavaScript", async () => {
    const res = await fetch(`${baseUrl}/assets/dashboard-custom-prompts.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /javascript/i);

    const body = await res.text();
    assert.match(body, /function dashboardSaveCustomPrompt\(/);
  });

  it("GET /assets/dashboard-terminal.js returns JavaScript", async () => {
    const res = await fetch(`${baseUrl}/assets/dashboard-terminal.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /javascript/i);

    const body = await res.text();
    assert.match(body, /function dashboardConnectTerminal\(/);
  });

  it("GET /assets/app.js returns JavaScript", async () => {
    const res = await fetch(`${baseUrl}/assets/app.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /javascript/i);

    const body = await res.text();
    assert.match(body, /function app\(/);
  });

  it("GET /assets/styles.css returns CSS", async () => {
    const res = await fetch(`${baseUrl}/assets/styles.css`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/css/i);
  });

  it("GET /assets/preset-prompts.json returns preset data", async () => {
    const res = await fetch(`${baseUrl}/assets/preset-prompts.json`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /json/i);

    const body = (await res.json()) as unknown;
    assert.ok(Array.isArray(body));
    assert.ok(body.length > 0);
    const first = body[0] as Record<string, unknown>;
    assert.equal(typeof first.route, "string");
    assert.equal(typeof first.globalSafe, "boolean");
    assert.ok(Array.isArray(first.bestTargetSurfaces));
  });

  it("rejects path traversal asset requests", async () => {
    const res = await fetch(`${baseUrl}/assets/..%2F..%2Fetc%2Fpasswd`);
    assert.equal(res.status, 404);
  });
});

describe("dashboard /api/audit", () => {
  it("returns a full dashboard report shape", async () => {
    const { res, body } = await fetchJson(
      `/api/audit?path=${encodeURIComponent(PROJECT_PATH)}`,
    );
    assert.equal(res.status, 200);

    const report = assertDashboardReport(body);
    const agentScores = report.agentScores as unknown[];
    assert.ok(agentScores.length > 0, "Dashboard report should include agents");

    for (const score of agentScores) {
      const entry = expectRecord(score, "Dashboard report agent score");
      const id = String(entry.id);
      assert.ok(getKnownAgentIds().includes(id as AgentId));
      assert.equal(entry.name, getAgentProfileMap()[id as AgentId].name);
      assertAuditScope(entry.agent, "Dashboard report agentScores[].agent");
      if (entry.harness !== null) {
        assertAuditScope(
          entry.harness,
          "Dashboard report agentScores[].harness",
        );
      }
    }
  });

  it("with quality=true includes harness concerns", async () => {
    const { res, body } = await fetchJson(
      `/api/audit?path=${encodeURIComponent(PROJECT_PATH)}&quality=true`,
    );
    assert.equal(res.status, 200);

    const report = assertDashboardReport(body);
    const agentScores = report.agentScores as unknown[];
    const claude = agentScores
      .map((score) => expectRecord(score, "Dashboard report agent score"))
      .find((score) => score.id === "claude");

    assert.ok(claude, "Dashboard report should include Claude");
    assert.notEqual(
      claude.concerns,
      null,
      "Harness concerns should be present",
    );

    const concerns = expectRecord(
      claude.concerns,
      "Dashboard report agentScores[].concerns",
    );
    for (const concern of Object.values(concerns)) {
      const entry = expectRecord(concern, "Harness concern");
      assert.match(String(entry.status), /^(pass|fail)$/);
      assert.equal(typeof entry.score, "number");
      assert.ok(Array.isArray(entry.findings));
      assert.ok(Array.isArray(entry.recommendations));
      assert.ok(Array.isArray(entry.howToFix));
    }
  });

  it("returns 500 with JSON for a nonexistent project path", async () => {
    const { res, body } = await fetchJson(
      `/api/audit?path=${encodeURIComponent(MISSING_PATH)}`,
    );
    assert.equal(res.status, 500);

    const error = expectRecord(body, "Audit error");
    assert.equal(typeof error.error, "string");
  });
});

describe("dashboard /api/health", () => {
  it("returns health response shape", async () => {
    const { res, body } = await fetchJson("/api/health");
    assert.equal(res.status, 200);

    const data = expectRecord(body, "Health response");
    assert.equal(typeof data.uptime, "number");
    assert.equal(typeof data.activeSessions, "number");
    assert.equal(typeof data.nodePtyAvailable, "boolean");
    assert.ok(Array.isArray(data.availableRunners));
    assert.ok(
      data.platformHint === undefined ||
        data.platformHint === "linux" ||
        data.platformHint === "darwin" ||
        data.platformHint === "win32",
      `platformHint should be a known platform or undefined, got: ${data.platformHint}`,
    );
  });
});

describe("dashboard /api/browse", () => {
  it("returns a directory listing", async () => {
    const { res, body } = await fetchJson(
      `/api/browse?path=${encodeURIComponent(PROJECT_PATH)}`,
    );
    assert.equal(res.status, 200);

    const data = expectRecord(body, "Browse response");
    assert.equal(data.current, PROJECT_PATH);
    assert.equal(typeof data.parent, "string");
    assert.ok(Array.isArray(data.dirs), "Browse response should include dirs");
    const dirs = data.dirs as Array<Record<string, unknown>>;
    const names = dirs.map((dir) => String(dir.name));
    assert.ok(names.includes("src"), "Browse response should include src/");
  });

  it("returns 500 with JSON for an unreadable path", async () => {
    const { res, body } = await fetchJson(
      `/api/browse?path=${encodeURIComponent(MISSING_PATH)}`,
    );
    assert.equal(res.status, 500);

    const data = expectRecord(body, "Browse error");
    assert.equal(typeof data.error, "string");
  });
});

describe("dashboard /api/agents/installed", () => {
  it("normalizes trailing punctuation from one-line version output", () => {
    assert.equal(
      normalizeAgentVersionOutput("GitHub Copilot CLI 1.0.34.\n"),
      "GitHub Copilot CLI 1.0.34",
    );
    assert.equal(
      normalizeAgentVersionOutput("codex 1.2.3-beta.1\n"),
      "codex 1.2.3-beta.1",
    );
    assert.equal(normalizeAgentVersionOutput("\n"), null);
  });

  it("returns the supported agent list", async () => {
    const { res, body } = await fetchJson("/api/agents/installed");
    assert.equal(res.status, 200);

    const data = expectRecord(body, "Agent detection response");
    assert.ok(Array.isArray(data.agents));
    assert.equal((data.agents as unknown[]).length, getKnownAgentIds().length);
    const ids = (data.agents as Array<Record<string, unknown>>).map((agent) =>
      String(agent.id),
    );
    const names = (data.agents as Array<Record<string, unknown>>).map((agent) =>
      String(agent.name),
    );
    assert.deepEqual(ids.sort(), [...getKnownAgentIds()].sort());
    assert.deepEqual(
      names.sort(),
      getKnownAgentIds()
        .map((id) => getAgentProfileMap()[id].name)
        .sort(),
    );
  });
});

describe("dashboard /api/setup/detect", () => {
  it("detects the project stack", async () => {
    const { res, body } = await fetchJson(
      `/api/setup/detect?path=${encodeURIComponent(PROJECT_PATH)}`,
    );
    assert.equal(res.status, 200);

    const data = expectRecord(body, "Setup detect response");
    const canonicalStack = detectSetupStack(createFS(PROJECT_PATH));
    assert.ok(Array.isArray(data.languages));
    assert.ok((data.languages as unknown[]).includes("TypeScript"));
    assert.ok(Array.isArray(data.frameworks));
    const commands = expectRecord(data.commands, "Setup detect commands");
    assert.deepEqual(data.languages, canonicalStack.languages);
    assert.deepEqual(data.frameworks, canonicalStack.frameworks);
    assert.equal(commands.build, canonicalStack.commands.build);
    assert.equal(commands.test, canonicalStack.commands.test);
    assert.equal(commands.lint, canonicalStack.commands.lint);
    assert.equal(commands.format, canonicalStack.commands.format);
    expectRecord(data.agents, "Setup detect agents");
    expectRecord(data.existing, "Setup detect existing");
    assert.ok(Array.isArray(data.nonGoatFlow));
  });
});

describe("dashboard /api/setup", () => {
  it("returns 400 without agent parameter", async () => {
    const { res, body } = await fetchJson(
      `/api/setup?path=${encodeURIComponent(PROJECT_PATH)}`,
    );
    assert.equal(res.status, 400);

    const data = expectRecord(body, "Setup error");
    assert.match(String(data.error), /agent/i);
  });

  it("returns 400 for an invalid agent", async () => {
    const { res, body } = await fetchJson(
      `/api/setup?path=${encodeURIComponent(PROJECT_PATH)}&agent=invalid`,
    );
    assert.equal(res.status, 400);

    const data = expectRecord(body, "Setup error");
    assert.match(String(data.error), /invalid/i);
  });

  for (const agent of getKnownAgentIds()) {
    it(`generates setup output for ${agent}`, async () => {
      const { res, body } = await fetchJson(
        `/api/setup?path=${encodeURIComponent(PROJECT_PATH)}&agent=${agent}`,
      );
      assert.equal(res.status, 200);

      const data = expectRecord(body, "Setup response");
      assert.equal(typeof data.output, "string");
      assert.ok(String(data.output).length > 100);
    });
  }
});

describe("dashboard /api/quality", () => {
  it("returns 400 without agent", async () => {
    const { res } = await fetchJson(
      `/api/quality?path=${encodeURIComponent(PROJECT_PATH)}`,
    );
    assert.equal(res.status, 400);
  });

  it("returns mode-specific quality prompts", async () => {
    const { res, body } = await fetchJson(
      `/api/quality?path=${encodeURIComponent(PROJECT_PATH)}&agent=claude&mode=skills`,
    );
    assert.equal(res.status, 200);

    const data = expectRecord(body, "Quality mode response");
    assert.equal(data.command, "quality");
    assert.equal(data.agent, "claude");
    assert.match(String(data.prompt), /Skill Suite Quality Assessment/);
    assert.match(String(data.prompt), /"quality_mode": "skills"/);
  });

  for (const agent of getKnownAgentIds()) {
    it(`generates quality output for ${agent}`, async () => {
      const { res, body } = await fetchJson(
        `/api/quality?path=${encodeURIComponent(PROJECT_PATH)}&agent=${agent}`,
      );
      assert.equal(res.status, 200);

      const data = expectRecord(body, "Quality response");
      assert.equal(data.command, "quality");
      assert.equal(data.agent, agent);
      assert.match(String(data.auditStatus), /^(pass|fail|unavailable)$/);
      assert.equal(typeof data.auditSummary, "string");
      assert.equal(typeof data.prompt, "string");
      assert.ok(String(data.prompt).length > 100);
    });
  }
});

describe("dashboard /api/projects", () => {
  it("persists the dashboard state roundtrip", async () => {
    const nextPaths = [PROJECT_PATH, resolve(PROJECT_PATH, "src")];
    const nextFavorites = ["goat-review", "goat-qa"];
    const nextProjectTitles = { [PROJECT_PATH]: "goat-flow WSL" };
    const post = await fetchJson("/api/projects/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paths: nextPaths,
        favorites: nextFavorites,
        projectTitles: nextProjectTitles,
      }),
    });
    assert.equal(post.res.status, 200);
    assert.deepEqual(post.body, { ok: true });

    const get = await fetchJson("/api/projects/list");
    assert.equal(get.res.status, 200);
    assert.deepEqual(get.body, {
      paths: nextPaths,
      favorites: nextFavorites,
      projectTitles: nextProjectTitles,
    });
  });

  it("clears a project title when an empty string is posted", async () => {
    const post = await fetchJson("/api/projects/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paths: [PROJECT_PATH],
        favorites: [],
        projectTitles: { [PROJECT_PATH]: "" },
      }),
    });
    assert.equal(post.res.status, 200);

    const get = await fetchJson("/api/projects/list");
    const body = expectRecord(get.body, "dashboard state");
    assert.deepEqual(body.projectTitles, {});
  });

  it("migrates the legacy projects file with empty favorites and titles", async () => {
    await rm(DASHBOARD_STATE_PATH, { force: true });
    const nextPaths = [PROJECT_PATH, resolve(PROJECT_PATH, "docs")];
    await writeFile(
      LEGACY_PROJECTS_LIST_PATH,
      JSON.stringify({ paths: nextPaths }, null, 2),
    );

    const get = await fetchJson("/api/projects/list");
    assert.equal(get.res.status, 200);
    assert.deepEqual(get.body, {
      paths: nextPaths,
      favorites: [],
      projectTitles: {},
    });
  });

  it("returns 400 for invalid project list JSON", async () => {
    const { res, body } = await fetchJson("/api/projects/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    assert.equal(res.status, 400);

    const data = expectRecord(body, "Projects list error");
    assert.equal(typeof data.error, "string");
  });

  it("returns 405 for unsupported project list methods", async () => {
    const { res, body } = await fetchJson("/api/projects/list", {
      method: "DELETE",
    });
    assert.equal(res.status, 405);
    assert.deepEqual(body, { error: "Method not allowed" });
  });

  it("classifies project state for a valid path", async () => {
    const { res, body } = await fetchJson(
      `/api/projects/status?paths=${encodeURIComponent(PROJECT_PATH)}`,
    );
    assert.equal(res.status, 200);

    const data = expectRecord(body, "Projects status response");
    assert.ok(Array.isArray(data.projects));
    assert.equal((data.projects as unknown[]).length, 1);
    const project = expectRecord(
      (data.projects as unknown[])[0],
      "Projects status item",
    );
    assert.equal(project.path, PROJECT_PATH);
    assert.equal(typeof project.state, "string");
    assert.equal(typeof project.action, "string");
    assert.equal(typeof project.details, "string");
  });

  it("returns 400 without paths", async () => {
    const { res } = await fetchJson("/api/projects/status");
    assert.equal(res.status, 400);
  });
});

describe("dashboard terminal endpoints", () => {
  it("GET /api/terminal/list returns an empty list when no sessions are running", async () => {
    const { res, body } = await fetchJson("/api/terminal/list");
    assert.equal(res.status, 200);
    assert.deepEqual(body, []);
  });

  it("GET /api/terminal/sessions returns the empty-state shape", async () => {
    const { res, body } = await fetchJson("/api/terminal/sessions");
    assert.equal(res.status, 200);

    const data = expectRecord(body, "Terminal sessions response");
    assert.ok(Array.isArray(data.sessions));
    assert.deepEqual(data.sessions, []);
    assert.equal(data.maxSessions, 10);
    assert.equal(data.activeCount, 0);
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
