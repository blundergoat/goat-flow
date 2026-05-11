/**
 * Integration tests for the dashboard HTTP server.
 * Starts a real server, hits public endpoints, and validates response contracts.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  getAgentProfileMap,
  getKnownAgentIds,
} from "../../src/cli/agents/registry.js";
import { AUDIT_VERSION } from "../../src/cli/constants.js";
import { normalizeAgentVersionOutput } from "../../src/cli/server/dashboard-routes.js";
import { TERMINAL_UPLOAD_MAX_BODY_BYTES } from "../../src/cli/server/terminal-uploads.js";
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
const require = createRequire(import.meta.url);
const childProcess =
  require("node:child_process") as typeof import("node:child_process");
const originalExecFileSync = childProcess.execFileSync;
const CODEX_CONFIG = [
  'model = "gpt-5"',
  'default_permissions = "goat-flow"',
  "[features]",
  "hooks = true",
  "[permissions.goat-flow.filesystem]",
  "glob_scan_max_depth = 3",
  '[permissions.goat-flow.filesystem.":project_roots"]',
  '"." = "write"',
  '".env.example" = "read"',
  '".env" = "none"',
  '"**/.env" = "none"',
  '".env.*" = "none"',
  '"**/.env.*" = "none"',
  '".ssh/**" = "none"',
  '"**/.ssh/**" = "none"',
  '".aws/**" = "none"',
  '"**/.aws/**" = "none"',
  '"*.pem" = "none"',
  '"**/*.pem" = "none"',
  "",
].join("\n");

let server: { port: number; close: () => Promise<void> } | undefined;
let baseUrl = "";
let dashboardToken = "";
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

function extractDashboardToken(html: string): string {
  const match = html.match(/__GOAT_FLOW_DASHBOARD_TOKEN__\s*=\s*"([^"]+)"/);
  assert.ok(match?.[1], "dashboard HTML should inject an auth token");
  return match[1];
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
  const headers = new Headers(init?.headers);
  headers.set("X-Goat-Flow-Dashboard-Token", dashboardToken);
  const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
  assertJsonResponse(res, path);
  return { res, body: await res.json() };
}

async function writeProjectFile(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const fullPath = join(root, relativePath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content);
}

function runGit(root: string, args: string[]): string {
  return childProcess.execFileSync("git", args, {
    cwd: root,
    encoding: "utf-8",
  });
}

function commitDashboardCacheProject(root: string): void {
  runGit(root, ["init"]);
  runGit(root, ["add", "."]);
  runGit(root, [
    "-c",
    "user.name=goat-flow-test",
    "-c",
    "user.email=goat-flow-test@example.invalid",
    "commit",
    "-m",
    "baseline",
  ]);
}

async function makeDashboardCacheProject(): Promise<{
  root: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), "goat-flow-cache-tests-"));
  await writeProjectFile(
    root,
    ".goat-flow/.gitignore",
    "*\n!.gitignore\n!config.yaml\n!footguns/\n!footguns/**\n!lessons/\n!lessons/**\n",
  );
  await writeProjectFile(
    root,
    ".goat-flow/config.yaml",
    'version: "1.3.2"\nagents:\n  - codex\n',
  );
  await writeProjectFile(root, ".goat-flow/footguns/README.md", "# Footguns\n");
  await writeProjectFile(root, ".goat-flow/lessons/README.md", "# Lessons\n");
  await writeProjectFile(root, "AGENTS.md", "# AGENTS.md\nAlpha\n");
  await writeProjectFile(
    root,
    "package.json",
    '{"scripts":{"test":"node --test"}}\n',
  );
  await writeProjectFile(root, ".codex/config.toml", CODEX_CONFIG);
  await writeProjectFile(
    root,
    ".codex/hooks.json",
    '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":".codex/hooks/deny-dangerous.sh"}]}]}}\n',
  );
  await writeProjectFile(
    root,
    ".codex/hooks/deny-dangerous.sh",
    "#!/usr/bin/env bash\nexit 0\n",
  );
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

function dashboardSetupInstruction(): string {
  return `# AGENTS.md

## Truth Order
User instructions first.

## Autonomy Tiers
Read project files before edits.

## Hard Rules
Do not overwrite user changes.

## Key Resources
Use local instructions and goat-flow references.

## Essential Commands
npm test

## Execution Loop
READ -> SCOPE -> ACT -> VERIFY

## Workspace Boundary
This controlling goat-flow workspace may differ from the selected target project. Commands that inspect framework code run from the controlling workspace; project-specific harness content lives in the target project.

## Definition of Done
Run verification and report exact output.

## Artifact Routing
Route lessons, footguns, decisions, and tasks to their goat-flow artifact directories.

## Router Table
| Resource | Path |
|----------|------|
`;
}

async function makeDashboardSetupPromptProject(options: {
  decisionsDir: boolean;
  installSkills?: boolean;
}): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "goat-flow-setup-prompt-tests-"));
  const denyHook = await readFile(
    join(PROJECT_PATH, "workflow", "hooks", "deny-dangerous.sh"),
    "utf-8",
  );
  const denyHookSelfTest = await readFile(
    join(PROJECT_PATH, "workflow", "hooks", "deny-dangerous.self-test.sh"),
    "utf-8",
  );
  const commonDirs = [
    ".goat-flow/footguns",
    ".goat-flow/lessons",
    ".goat-flow/tasks",
    ".goat-flow/logs/sessions",
    ".goat-flow/skill-reference",
    ".goat-flow/patterns",
    ".goat-flow/scratchpad",
    ".codex/hooks",
  ];
  if (options.decisionsDir) commonDirs.push(".goat-flow/decisions");
  for (const dir of commonDirs) {
    await mkdir(join(root, dir), { recursive: true });
  }
  await writeProjectFile(
    root,
    ".goat-flow/config.yaml",
    `version: "${AUDIT_VERSION}"
agents:
  - codex
skills:
  install: all
`,
  );
  await writeProjectFile(root, ".goat-flow/.gitignore", "*\n!.gitignore\n");
  await writeProjectFile(
    root,
    ".goat-flow/architecture.md",
    "# Architecture\n\nCanonical config lives at `.goat-flow/config.yaml`.\n",
  );
  await writeProjectFile(root, ".goat-flow/code-map.md", "# Code Map\n");
  await writeProjectFile(root, ".goat-flow/glossary.md", "# Glossary\n");
  await writeProjectFile(root, ".goat-flow/footguns/README.md", "# Footguns\n");
  await writeProjectFile(root, ".goat-flow/lessons/README.md", "# Lessons\n");
  await writeProjectFile(root, ".goat-flow/tasks/.gitignore", "*\n");
  await writeProjectFile(
    root,
    ".github/git-commit-instructions.md",
    "# Git Commit Instructions\n",
  );
  await writeProjectFile(
    root,
    ".goat-flow/skill-reference/skill-preamble.md",
    "# Preamble\n",
  );
  await writeProjectFile(
    root,
    ".goat-flow/skill-reference/skill-conventions.md",
    "# Conventions\n",
  );
  await writeProjectFile(root, "AGENTS.md", dashboardSetupInstruction());
  await writeProjectFile(root, ".codex/config.toml", CODEX_CONFIG);
  await writeProjectFile(
    root,
    ".codex/hooks.json",
    JSON.stringify(
      {
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                {
                  type: "command",
                  command:
                    'bash "$(git rev-parse --show-toplevel)/.codex/hooks/deny-dangerous.sh"',
                },
              ],
            },
          ],
        },
      },
      null,
      2,
    ),
  );
  await writeProjectFile(root, ".codex/hooks/deny-dangerous.sh", denyHook);
  await writeProjectFile(
    root,
    ".codex/hooks/deny-dangerous.self-test.sh",
    denyHookSelfTest,
  );
  if (options.installSkills) {
    for (const skill of [
      "goat",
      "goat-debug",
      "goat-plan",
      "goat-review",
      "goat-critique",
      "goat-security",
      "goat-qa",
    ]) {
      await writeProjectFile(
        root,
        `.agents/skills/${skill}/SKILL.md`,
        "# Skill\n",
      );
    }
  }
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
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
  const html = await (await fetch(baseUrl)).text();
  dashboardToken = extractDashboardToken(html);
});

after(async () => {
  try {
    childProcess.execFileSync = originalExecFileSync;
    syncBuiltinESMExports();
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
    assert.match(html, /__GOAT_FLOW_DASHBOARD_TOKEN__/);
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

  it("GET /assets/xterm.js returns bundled xterm JavaScript", async () => {
    const res = await fetch(`${baseUrl}/assets/xterm.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /javascript/i);

    const body = await res.text();
    assert.match(body, /bracketedPasteMode/);
  });

  it("GET /assets/addon-fit.js returns bundled xterm fit addon JavaScript", async () => {
    const res = await fetch(`${baseUrl}/assets/addon-fit.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /javascript/i);

    const body = await res.text();
    assert.match(body, /FitAddon/);
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

  it("GET /assets/xterm.css returns bundled xterm CSS", async () => {
    const res = await fetch(`${baseUrl}/assets/xterm.css`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/css/i);

    const body = await res.text();
    assert.match(body, /\.xterm/);
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

describe("dashboard API authorization", () => {
  it("rejects API requests with a missing token", async () => {
    const res = await fetch(`${baseUrl}/api/terminal/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "", projectPath: PROJECT_PATH }),
    });
    assert.equal(res.status, 403);
    assertJsonResponse(res, "missing token rejection");
    assert.deepEqual(await res.json(), { error: "Forbidden" });
  });

  it("rejects API requests with a wrong token", async () => {
    const res = await fetch(`${baseUrl}/api/terminal/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goat-Flow-Dashboard-Token": "wrong-token",
      },
      body: JSON.stringify({ prompt: "", projectPath: PROJECT_PATH }),
    });
    assert.equal(res.status, 403);
    assertJsonResponse(res, "wrong token rejection");
    assert.deepEqual(await res.json(), { error: "Forbidden" });
  });

  it("rejects cross-origin side-effectful browser requests", async () => {
    const res = await fetch(`${baseUrl}/api/projects/list`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://evil.example",
        "X-Goat-Flow-Dashboard-Token": dashboardToken,
      },
      body: JSON.stringify({ paths: [], favorites: [], projectTitles: {} }),
    });
    assert.equal(res.status, 403);
    assertJsonResponse(res, "bad origin rejection");
    assert.deepEqual(await res.json(), { error: "Forbidden" });
  });

  it("rejects cross-origin terminal image uploads", async () => {
    const res = await fetch(`${baseUrl}/api/terminal/sess-x/upload-image`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://evil.example",
        "X-Goat-Flow-Dashboard-Token": dashboardToken,
      },
      body: JSON.stringify({ files: [] }),
    });
    assert.equal(res.status, 403);
    assertJsonResponse(res, "bad origin terminal upload rejection");
    assert.deepEqual(await res.json(), { error: "Forbidden" });
  });

  it("accepts valid token and same-origin side-effectful requests", async () => {
    const res = await fetch(`${baseUrl}/api/projects/list`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
        "X-Goat-Flow-Dashboard-Token": dashboardToken,
      },
      body: JSON.stringify({ paths: [], favorites: [], projectTitles: {} }),
    });
    assert.equal(res.status, 200);
    assertJsonResponse(res, "same-origin authorized write");
    assert.deepEqual(await res.json(), { ok: true });
    const persisted = await readFile(DASHBOARD_STATE_PATH, "utf-8");
    assert.equal(persisted.includes(dashboardToken), false);
  });

  it("rejects terminal WebSocket upgrades with a missing token", async () => {
    const { WebSocket } = await import("ws");
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(
        `${baseUrl.replace(/^http/u, "ws")}/ws/terminal/test`,
        { headers: { Origin: baseUrl } },
      );
      const timer = setTimeout(
        () => reject(new Error("terminal WebSocket rejection timed out")),
        1000,
      );
      ws.once("open", () => {
        clearTimeout(timer);
        ws.close();
        reject(new Error("terminal WebSocket opened without a token"));
      });
      ws.once("error", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  });
});

describe("dashboard /api/audit", () => {
  function getProfileSpans(body: unknown): Record<string, unknown>[] {
    const report = expectRecord(body, "Profiled dashboard report");
    const profile = expectRecord(report._profile, "Dashboard profile");
    assert.equal(
      Array.isArray(profile.spans),
      true,
      "Dashboard profile spans should be an array",
    );
    return (profile.spans as unknown[]).map((spanEntry, index) =>
      expectRecord(spanEntry, `Dashboard profile spans[${index}]`),
    );
  }

  function spanCount(spans: Record<string, unknown>[], name: string): number {
    return spans.filter((spanEntry) => spanEntry.name === name).length;
  }

  async function fetchProfiledAudit(
    projectPath: string,
    suffix = "",
  ): Promise<{
    ms: number;
    body: Record<string, unknown>;
  }> {
    const start = performance.now();
    const { res, body } = await fetchJson(
      `/api/audit?path=${encodeURIComponent(
        projectPath,
      )}&quality=true&profile=true${suffix}`,
    );
    const ms = performance.now() - start;
    assert.equal(res.status, 200);
    return { ms, body: expectRecord(body, "Profiled audit response") };
  }

  function dashboardReportSurface(
    value: Record<string, unknown>,
  ): Record<string, unknown> {
    const scopes = expectRecord(value.scopes, "Dashboard report scopes");
    const agentScores = (value.agentScores as unknown[]).map((score, index) => {
      const entry = expectRecord(
        score,
        `Dashboard report agentScores[${index}]`,
      );
      const agent = expectRecord(
        entry.agent,
        `Dashboard report agentScores[${index}].agent`,
      );
      const harness =
        entry.harness === null
          ? null
          : expectRecord(
              entry.harness,
              `Dashboard report agentScores[${index}].harness`,
            );
      return {
        id: entry.id,
        hasAgent: Boolean(entry.agent),
        hasHarness: entry.harness !== null,
        hasConcerns: entry.concerns !== null,
        agentStatus: agent.status,
        harnessStatus: harness?.status ?? null,
      };
    });
    return {
      status: value.status,
      target: value.target,
      overall: expectRecord(value.overall, "Dashboard report overall").status,
      setup: expectRecord(scopes.setup, "Dashboard report scopes.setup").status,
      agent: expectRecord(scopes.agent, "Dashboard report scopes.agent").status,
      harness: expectRecord(scopes.harness, "Dashboard report scopes.harness")
        .status,
      agentScores,
      hasLearningLoop: Object.prototype.hasOwnProperty.call(
        value,
        "learningLoop",
      ),
      hasRecentLessons: Object.prototype.hasOwnProperty.call(
        value,
        "recentLessons",
      ),
    };
  }

  it("returns a full dashboard report shape", async () => {
    const { res, body } = await fetchJson(
      `/api/audit?path=${encodeURIComponent(PROJECT_PATH)}`,
    );
    assert.equal(res.status, 200);

    const report = assertDashboardReport(body);
    const agentScores = report.agentScores as unknown[];
    assert.ok(agentScores.length > 0, "Dashboard report should include agents");
    const scoresById = new Map<string, Record<string, unknown>>();

    for (const score of agentScores) {
      const entry = expectRecord(score, "Dashboard report agent score");
      const id = String(entry.id);
      scoresById.set(id, entry);
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
    for (const id of ["claude", "codex", "copilot"] as const) {
      assert.ok(scoresById.has(id), `Dashboard report should include ${id}`);
    }
  });

  it("includes configured agents even when their instruction files are missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-dashboard-agents-"));
    try {
      await writeProjectFile(
        root,
        ".goat-flow/config.yaml",
        `version: "${AUDIT_VERSION}"\nagents:\n  - claude\n  - claude\n  - codex\n  - codex\n  - gemini\n  - copilot\nskills:\n  install: all\n`,
      );
      await writeProjectFile(
        root,
        "CLAUDE.md",
        "# CLAUDE.md\n\n## Execution Loop\nREAD SCOPE ACT VERIFY\n\n## Router Table\n",
      );

      const { res, body } = await fetchJson(
        `/api/audit?path=${encodeURIComponent(root)}&quality=true&fresh=true`,
      );
      assert.equal(res.status, 200);
      const report = assertDashboardReport(body);
      assert.equal(report.status, "fail");
      const scopes = expectRecord(report.scopes, "Dashboard report scopes");
      const aggregateAgent = expectRecord(
        scopes.agent,
        "Dashboard aggregate agent scope",
      );
      assert.match(
        JSON.stringify(aggregateAgent),
        /Configured agent instruction files missing: codex \(AGENTS\.md\), gemini \(GEMINI\.md\), copilot \(\.github\/copilot-instructions\.md\)/,
      );

      const agentScores = report.agentScores as unknown[];
      const scoreIds = agentScores.map((score, index) =>
        String(expectRecord(score, `Configured-agent score[${index}]`).id),
      );
      assert.deepEqual(scoreIds, ["claude", "codex", "gemini", "copilot"]);

      const scoresById = new Map<string, Record<string, unknown>>();
      for (const score of agentScores) {
        const entry = expectRecord(score, "Configured-agent score");
        scoresById.set(String(entry.id), entry);
      }

      for (const id of ["claude", "codex", "gemini", "copilot"] as const) {
        assert.ok(scoresById.has(id), `Dashboard report should include ${id}`);
      }
      const codex = expectRecord(scoresById.get("codex"), "Codex score");
      const codexAgent = expectRecord(codex.agent, "Codex agent scope");
      assert.equal(codexAgent.status, "fail");
      assert.match(JSON.stringify(codexAgent), /Missing: codex \(AGENTS\.md\)/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("with quality=true uses dashboard-summary facts without changing the shared report surface", async () => {
    const originalProfileEnv = process.env.GOAT_FLOW_AUDIT_PROFILE;
    process.env.GOAT_FLOW_AUDIT_PROFILE = "1";
    try {
      const baseline = await fetchJson(
        `/api/audit?path=${encodeURIComponent(PROJECT_PATH)}&quality=true&fresh=true`,
      );
      assert.equal(baseline.res.status, 200);
      const baselineReport = assertDashboardReport(baseline.body);

      const profiled = await fetchJson(
        `/api/audit?path=${encodeURIComponent(PROJECT_PATH)}&quality=true&fresh=true&profile=true`,
      );
      assert.equal(profiled.res.status, 200);
      const profiledReport = assertDashboardReport(profiled.body);

      assert.deepEqual(
        dashboardReportSurface(profiledReport),
        dashboardReportSurface(baselineReport),
        "Profiled summary route should preserve the Home/Setup/Quality report surface",
      );

      const agentScores = profiledReport.agentScores as unknown[];
      assert.ok(
        agentScores.length > 0,
        "Dashboard summary should preserve per-agent cards",
      );
      for (const [index, score] of agentScores.entries()) {
        const entry = expectRecord(
          score,
          `Dashboard report agentScores[${index}]`,
        );
        assertAuditScope(
          entry.agent,
          `Dashboard report agentScores[${index}].agent`,
        );
        assertAuditScope(
          entry.harness,
          `Dashboard report agentScores[${index}].harness`,
        );
        assert.notEqual(
          entry.concerns,
          null,
          `Dashboard report agentScores[${index}].concerns should be present`,
        );
      }

      const spans = getProfileSpans(profiled.body);
      assert.equal(
        spanCount(spans, "detectStack"),
        0,
        "dashboard-summary route should not call detectStack",
      );
      assert.equal(
        spanCount(spans, "aggregate facts"),
        1,
        "dashboard-summary route should extract project-wide facts once",
      );
      assert.equal(
        spanCount(spans, "per-agent facts"),
        0,
        "dashboard-summary route should reuse shared facts for agent cards",
      );
    } finally {
      if (originalProfileEnv === undefined) {
        delete process.env.GOAT_FLOW_AUDIT_PROFILE;
      } else {
        process.env.GOAT_FLOW_AUDIT_PROFILE = originalProfileEnv;
      }
    }
  });

  it("serves cache hits under budget without rerunning audit computation", async () => {
    const project = await makeDashboardCacheProject();
    const originalPackagedMode = process.env.GOAT_FLOW_PACKAGED_MODE;
    const originalProfileEnv = process.env.GOAT_FLOW_AUDIT_PROFILE;
    process.env.GOAT_FLOW_PACKAGED_MODE = "1";
    process.env.GOAT_FLOW_AUDIT_PROFILE = "1";
    try {
      const fresh = await fetchProfiledAudit(project.root, "&fresh=true");
      assert.equal(fresh.body.cached, false);
      assert.ok(fresh.ms < 5000, `fresh audit took ${fresh.ms.toFixed(3)}ms`);

      const cached = await fetchProfiledAudit(project.root);
      assert.equal(cached.body.cached, true);
      assert.ok(cached.ms < 500, `cached audit took ${cached.ms.toFixed(3)}ms`);
      const spans = getProfileSpans(cached.body);
      assert.equal(spanCount(spans, "cache read"), 1);
      assert.equal(
        spanCount(spans, "runAuditBatch"),
        0,
        "cache hit should not run audit computation",
      );
    } finally {
      if (originalPackagedMode === undefined) {
        delete process.env.GOAT_FLOW_PACKAGED_MODE;
      } else {
        process.env.GOAT_FLOW_PACKAGED_MODE = originalPackagedMode;
      }
      if (originalProfileEnv === undefined) {
        delete process.env.GOAT_FLOW_AUDIT_PROFILE;
      } else {
        process.env.GOAT_FLOW_AUDIT_PROFILE = originalProfileEnv;
      }
      await project.cleanup();
    }
  });

  it("invalidates cached dashboard audits after instruction, hook, and lesson edits", async () => {
    const project = await makeDashboardCacheProject();
    const originalPackagedMode = process.env.GOAT_FLOW_PACKAGED_MODE;
    const originalProfileEnv = process.env.GOAT_FLOW_AUDIT_PROFILE;
    process.env.GOAT_FLOW_PACKAGED_MODE = "1";
    process.env.GOAT_FLOW_AUDIT_PROFILE = "1";
    try {
      await fetchProfiledAudit(project.root, "&fresh=true");
      assert.equal((await fetchProfiledAudit(project.root)).body.cached, true);

      await writeProjectFile(project.root, "AGENTS.md", "# AGENTS.md\nBravo\n");
      const afterInstruction = await fetchProfiledAudit(project.root);
      assert.equal(afterInstruction.body.cached, false);
      assert.equal(
        spanCount(getProfileSpans(afterInstruction.body), "runAuditBatch"),
        1,
      );
      assert.equal((await fetchProfiledAudit(project.root)).body.cached, true);

      await writeProjectFile(
        project.root,
        ".codex/hooks/deny-dangerous.sh",
        "#!/usr/bin/env bash\nexit 1\n",
      );
      const afterHook = await fetchProfiledAudit(project.root);
      assert.equal(afterHook.body.cached, false);
      assert.equal(
        spanCount(getProfileSpans(afterHook.body), "runAuditBatch"),
        1,
      );
      assert.equal((await fetchProfiledAudit(project.root)).body.cached, true);

      await writeProjectFile(
        project.root,
        ".goat-flow/lessons/cache.md",
        "# Lesson: Cache\nAAAA\n",
      );
      await fetchProfiledAudit(project.root);
      await writeProjectFile(
        project.root,
        ".goat-flow/lessons/cache.md",
        "# Lesson: Cache\nBBBB\n",
      );
      const afterLesson = await fetchProfiledAudit(project.root);
      assert.equal(afterLesson.body.cached, false);
      assert.equal(
        spanCount(getProfileSpans(afterLesson.body), "runAuditBatch"),
        1,
      );
    } finally {
      if (originalPackagedMode === undefined) {
        delete process.env.GOAT_FLOW_PACKAGED_MODE;
      } else {
        process.env.GOAT_FLOW_PACKAGED_MODE = originalPackagedMode;
      }
      if (originalProfileEnv === undefined) {
        delete process.env.GOAT_FLOW_AUDIT_PROFILE;
      } else {
        process.env.GOAT_FLOW_AUDIT_PROFILE = originalProfileEnv;
      }
      await project.cleanup();
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

  it("with quality=true avoids deny hook self-tests during dashboard summary loads", async () => {
    let selfTestCalls = 0;
    childProcess.execFileSync = ((file, args, options) => {
      if (
        Array.isArray(args) &&
        args.some((arg) => String(arg).startsWith("--self-test"))
      ) {
        selfTestCalls += 1;
        throw new Error(
          "dashboard summary should not run deny hook self-tests",
        );
      }
      return originalExecFileSync(file, args, options);
    }) as typeof childProcess.execFileSync;
    syncBuiltinESMExports();

    try {
      const { res } = await fetchJson(
        `/api/audit?path=${encodeURIComponent(PROJECT_PATH)}&quality=true`,
      );
      assert.equal(res.status, 200);
      assert.equal(
        selfTestCalls,
        0,
        "dashboard summary should not run deny hook self-tests",
      );
    } finally {
      childProcess.execFileSync = originalExecFileSync;
      syncBuiltinESMExports();
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

  it("keeps the dashboard audit cache as a gitignored local artifact", async () => {
    const project = await makeDashboardCacheProject();
    const originalPackagedMode = process.env.GOAT_FLOW_PACKAGED_MODE;
    const originalProfileEnv = process.env.GOAT_FLOW_AUDIT_PROFILE;
    process.env.GOAT_FLOW_PACKAGED_MODE = "1";
    process.env.GOAT_FLOW_AUDIT_PROFILE = "1";
    try {
      commitDashboardCacheProject(project.root);

      const fresh = await fetchProfiledAudit(project.root, "&fresh=true");
      assert.equal(fresh.body.cached, false);
      assert.equal((await fetchProfiledAudit(project.root)).body.cached, true);

      const status = runGit(project.root, [
        "status",
        "--short",
        "--untracked-files=all",
      ]);
      assert.equal(status, "");
    } finally {
      if (originalPackagedMode === undefined) {
        delete process.env.GOAT_FLOW_PACKAGED_MODE;
      } else {
        process.env.GOAT_FLOW_PACKAGED_MODE = originalPackagedMode;
      }
      if (originalProfileEnv === undefined) {
        delete process.env.GOAT_FLOW_AUDIT_PROFILE;
      } else {
        process.env.GOAT_FLOW_AUDIT_PROFILE = originalProfileEnv;
      }
      await project.cleanup();
    }
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

  it("does not execute runner --version probes unless fresh detection is requested", async () => {
    let versionCalls = 0;
    childProcess.execFileSync = ((file, args, options) => {
      if (Array.isArray(args) && args.includes("--version")) {
        versionCalls += 1;
        throw new Error("default agent detection should be passive");
      }
      return originalExecFileSync(file, args, options);
    }) as typeof childProcess.execFileSync;
    syncBuiltinESMExports();

    try {
      const { res } = await fetchJson("/api/agents/installed");
      assert.equal(res.status, 200);
      assert.equal(versionCalls, 0);
    } finally {
      childProcess.execFileSync = originalExecFileSync;
      syncBuiltinESMExports();
    }
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

  it("avoids deny hook self-tests while preserving setup prompt checks", async () => {
    let selfTestCalls = 0;
    childProcess.execFileSync = ((file, args, options) => {
      if (
        Array.isArray(args) &&
        args.some((arg) => String(arg).startsWith("--self-test"))
      ) {
        selfTestCalls += 1;
        throw new Error("setup prompt should not run deny hook self-tests");
      }
      return originalExecFileSync(file, args, options);
    }) as typeof childProcess.execFileSync;
    syncBuiltinESMExports();

    try {
      const { res, body } = await fetchJson(
        `/api/setup?path=${encodeURIComponent(PROJECT_PATH)}&agent=claude`,
      );
      assert.equal(res.status, 200);

      const data = expectRecord(body, "Setup response");
      assert.equal(typeof data.output, "string");
      assert.equal(
        selfTestCalls,
        0,
        "setup prompt should not run deny hook self-tests",
      );
    } finally {
      childProcess.execFileSync = originalExecFileSync;
      syncBuiltinESMExports();
    }
  });

  it("reports setup and agent install failures even when selected harness checks pass", async () => {
    // installSkills: true so classifyProjectState returns "current" (not "incomplete"),
    // allowing composeSetup to reach the audit-fail path with individual check details.
    const project = await makeDashboardSetupPromptProject({
      decisionsDir: true,
      installSkills: true,
    });
    try {
      const { res, body } = await fetchJson(
        `/api/setup?path=${encodeURIComponent(project.root)}&agent=codex`,
      );
      assert.equal(res.status, 200);

      const data = expectRecord(body, "Setup response");
      const output = String(data.output);
      assert.doesNotMatch(output, /All audit checks pass\./);
      assert.match(
        output,
        /Re-run: `[^`]* audit [^`]* --harness --agent codex`/,
      );
    } finally {
      await project.cleanup();
    }
  });

  it("reports harness failures alongside setup remediation", async () => {
    // installSkills: true so classifyProjectState returns "current" (not "incomplete"),
    // allowing composeSetup to reach the audit-fail path with individual check details.
    const project = await makeDashboardSetupPromptProject({
      decisionsDir: false,
      installSkills: true,
    });
    try {
      const { res, body } = await fetchJson(
        `/api/setup?path=${encodeURIComponent(project.root)}&agent=codex`,
      );
      assert.equal(res.status, 200);

      const data = expectRecord(body, "Setup response");
      const output = String(data.output);
      assert.match(output, /Decisions/);
      assert.doesNotMatch(output, /All audit checks pass\./);
      assert.match(
        output,
        /Re-run: `[^`]* audit [^`]* --harness --agent codex`/,
      );
    } finally {
      await project.cleanup();
    }
  });
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

  it("reuses cached quality audits unless fresh=true is requested", async () => {
    const runTimedQualityRequest = async (
      suffix: string,
    ): Promise<{ ms: number; body: Record<string, unknown> }> => {
      const t0 = performance.now();
      const { res, body } = await fetchJson(
        `/api/quality?path=${encodeURIComponent(PROJECT_PATH)}&agent=claude${suffix}`,
      );
      const ms = performance.now() - t0;
      assert.equal(res.status, 200);
      return { ms, body: expectRecord(body, "Quality cache response") };
    };

    const first = await runTimedQualityRequest("&fresh=true");
    const second = await runTimedQualityRequest("");
    const third = await runTimedQualityRequest("&fresh=true");

    assert.equal(first.body.command, "quality");
    assert.equal(second.body.command, "quality");
    assert.equal(third.body.command, "quality");
    assert.equal(first.body.agent, "claude");
    assert.equal(second.body.agent, "claude");
    assert.equal(third.body.agent, "claude");
    assert.equal(first.body.prompt, second.body.prompt);
    assert.equal(first.body.prompt, third.body.prompt);
    assert.ok(
      second.ms <= Math.max(20, first.ms / 3),
      `cached quality request should be materially faster than a fresh audit (fresh=${Math.round(first.ms)}ms cached=${Math.round(second.ms)}ms)`,
    );
    assert.ok(
      second.ms <= Math.max(20, third.ms / 3),
      `fresh=true should bypass the cache and stay materially slower than the cached request (fresh=${Math.round(third.ms)}ms cached=${Math.round(second.ms)}ms)`,
    );
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

describe("dashboard /api/skill-quality", () => {
  it("returns artifact inventory for the project", async () => {
    const { res, body } = await fetchJson(
      `/api/skill-quality/inventory?path=${encodeURIComponent(PROJECT_PATH)}&agent=claude`,
    );
    assert.equal(res.status, 200);
    const data = expectRecord(body, "Skill quality inventory");
    assert.ok(Array.isArray(data.artifacts));
    const artifacts = data.artifacts as Array<Record<string, unknown>>;
    assert.ok(
      artifacts.length >= 12,
      `expected at least 12 artifacts (skills + shared references), got ${artifacts.length}`,
    );
    assert.ok(artifacts.some((a) => a.kind === "skill"));
    assert.ok(artifacts.some((a) => a.kind === "shared-reference"));
    assert.ok(artifacts.some((a) => a.id === "skill:goat-plan"));
    assert.ok(artifacts.some((a) => a.id === "reference:browser-use"));
    assert.ok(artifacts.some((a) => a.id === "reference:skill-preamble"));
  });

  it("returns shared references regardless of selected agent", async () => {
    const { res, body } = await fetchJson(
      `/api/skill-quality/inventory?path=${encodeURIComponent(PROJECT_PATH)}&agent=codex`,
    );
    assert.equal(res.status, 200);
    const data = expectRecord(body, "Skill quality inventory");
    const artifacts = data.artifacts as Array<Record<string, unknown>>;
    assert.ok(artifacts.some((a) => a.id === "reference:browser-use"));
    assert.ok(artifacts.some((a) => a.id === "reference:skill-preamble"));
  });

  it("uses the selected runner skills directory for inventory", async () => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-skill-runner-"));
    try {
      await writeProjectFile(
        root,
        ".claude/skills/claude-only/SKILL.md",
        "# Claude\n",
      );
      await writeProjectFile(
        root,
        ".agents/skills/codex-only/SKILL.md",
        "# Codex\n",
      );

      const { res, body } = await fetchJson(
        `/api/skill-quality/inventory?path=${encodeURIComponent(root)}&agent=codex`,
      );
      assert.equal(res.status, 200);
      const data = expectRecord(body, "Skill quality inventory");
      const artifacts = data.artifacts as Array<Record<string, unknown>>;
      assert.ok(artifacts.some((a) => a.id === "skill:codex-only"));
      assert.ok(!artifacts.some((a) => a.id === "skill:claude-only"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("scores a valid artifact with metrics and prompt", async () => {
    const { res, body } = await fetchJson(
      `/api/skill-quality?path=${encodeURIComponent(PROJECT_PATH)}&agent=claude&artifact=skill:goat-plan`,
    );
    assert.equal(res.status, 200);
    const data = expectRecord(body, "Skill quality report");
    assert.equal(
      (data.artifact as Record<string, unknown>).id,
      "skill:goat-plan",
    );
    assert.ok(typeof data.totalScore === "number");
    assert.ok(typeof data.maxTotalScore === "number");
    assert.equal(data.subtype, "workflow");
    assert.equal(data.profileMax, 100);
    assert.ok(Array.isArray(data.composedFrom));
    assert.ok(typeof data.recommendation === "string");
    assert.ok(Array.isArray(data.metrics));
    assert.ok(typeof data.prompt === "string");
    assert.match(String(data.prompt), /Quality Review/);
  });

  it("returns 404 for unknown artifact id", async () => {
    const { res, body } = await fetchJson(
      `/api/skill-quality?path=${encodeURIComponent(PROJECT_PATH)}&agent=claude&artifact=skill:nonexistent`,
    );
    assert.equal(res.status, 404);
    const data = expectRecord(body, "Skill quality 404");
    assert.match(String(data.error), /not found/);
  });

  it("returns 400 when artifact param is missing", async () => {
    const { res } = await fetchJson(
      `/api/skill-quality?path=${encodeURIComponent(PROJECT_PATH)}&agent=claude`,
    );
    assert.equal(res.status, 400);
  });

  it("returns 400 when agent param is missing", async () => {
    const { res } = await fetchJson(
      `/api/skill-quality/inventory?path=${encodeURIComponent(PROJECT_PATH)}`,
    );
    assert.equal(res.status, 400);
  });
});

describe("dashboard /api/quality/evaluate", () => {
  const SKILL_DRAFT = [
    "---",
    "name: postgres-index",
    "description: Walk through a Postgres index change with explicit evidence gates.",
    "goat-flow-skill-version: 1.6.0",
    "---",
    "# /postgres-index",
    "",
    "## Step 0",
    "Read CLAUDE.md and the migration file.",
    "",
    "## Phase 1",
    "Plan the index change with downtime estimate.",
    "",
    "## Verification",
    "- [ ] EXPLAIN ANALYZE confirms the new plan.",
    "- [ ] Lock acquisition under 100ms in staging.",
  ].join("\n");

  it("returns a quality report and improvement tips for an uploaded skill", async () => {
    const { res, body } = await fetchJson("/api/quality/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: SKILL_DRAFT,
        suggestedName: "postgres-index.md",
        kind: "skill",
      }),
    });
    assert.equal(res.status, 200);
    const data = expectRecord(body, "Evaluate result");
    const artifact = expectRecord(data.artifact, "Evaluate result.artifact");
    assert.equal(artifact.kind, "skill");
    assert.equal(typeof data.totalScore, "number");
    assert.equal(typeof data.profileMax, "number");
    assert.ok(Array.isArray(data.metrics));
    assert.ok(Array.isArray(data.tips));
    assert.equal(typeof data.subtype, "string");
    assert.equal(typeof data.detectedShape, "string");
    assert.equal(typeof data.shapeConfidence, "number");
    assert.equal(typeof data.shapeMismatch, "boolean");
    assert.equal(typeof data.recommendation, "string");
  });

  it("infers the artifact kind when no explicit kind is provided", async () => {
    const { res, body } = await fetchJson("/api/quality/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: SKILL_DRAFT }),
    });
    assert.equal(res.status, 200);
    const data = expectRecord(body, "Evaluate result");
    const artifact = expectRecord(data.artifact, "Evaluate result.artifact");
    assert.equal(artifact.kind, "skill");
  });

  it("surfaces improvement tips for a deliberately weak draft", async () => {
    const weakDraft = [
      "# untitled",
      "",
      "Some prose without sections, frontmatter, or evidence.",
    ].join("\n");
    const { res, body } = await fetchJson("/api/quality/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: weakDraft, kind: "skill" }),
    });
    assert.equal(res.status, 200);
    const data = expectRecord(body, "Evaluate result");
    assert.ok(Array.isArray(data.tips));
    assert.ok(
      (data.tips as unknown[]).length > 0,
      "expected at least one improvement tip for a weak draft",
    );
  });

  it("returns 400 for empty content", async () => {
    const { res } = await fetchJson("/api/quality/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "" }),
    });
    assert.equal(res.status, 400);
  });

  it("returns 400 for missing content", async () => {
    const { res } = await fetchJson("/api/quality/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suggestedName: "x.md" }),
    });
    assert.equal(res.status, 400);
  });

  it("returns 400 for an invalid kind value", async () => {
    const { res } = await fetchJson("/api/quality/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: SKILL_DRAFT, kind: "not-a-kind" }),
    });
    assert.equal(res.status, 400);
  });

  it("returns 413 for evaluate bodies above the route body cap", async () => {
    const { res, body } = await fetchJson("/api/quality/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "x".repeat(330 * 1024) }),
    });
    assert.equal(res.status, 413);
    const data = expectRecord(body, "Evaluate oversized result");
    assert.match(String(data.error), /Evaluate body too large/);
  });

  it("counts evaluate content caps in UTF-8 bytes, not UTF-16 characters", async () => {
    const { res } = await fetchJson("/api/quality/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "€".repeat(90 * 1024) }),
    });
    assert.equal(res.status, 400);
  });

  it("returns 405 for non-POST methods", async () => {
    const { res } = await fetchJson("/api/quality/evaluate");
    assert.equal(res.status, 405);
  });

  it("scores a multi-file uploaded bundle and lists every file in composedFrom", async () => {
    const skillBody = [
      "---",
      "name: bundled-skill",
      "description: A multi-file workflow that walks through a deploy.",
      "goat-flow-skill-version: 1.6.0",
      "---",
      "# /bundled-skill",
      "",
      "## Step 0",
      "Read the workflow.md and template.md alongside this file.",
    ].join("\n");
    const workflow = [
      "## Phase 1 - Plan",
      "List the change, downtime, and rollback.",
      "",
      "## Phase 2 - Apply",
      "CHECKPOINT: human reviews before applying.",
      "",
      "## Verification",
      "- [ ] EXPLAIN ANALYZE confirms the new plan.",
    ].join("\n");
    const template = [
      "# Deploy template",
      "",
      "Used by Phase 1 to scaffold the report body.",
    ].join("\n");
    const { res, body } = await fetchJson("/api/quality/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [
          { name: "SKILL.md", content: skillBody },
          { name: "workflow.md", content: workflow },
          { name: "template.md", content: template },
        ],
        suggestedName: "bundled-skill",
        kind: "skill",
      }),
    });
    assert.equal(res.status, 200);
    const data = expectRecord(body, "Bundle evaluate result");
    const composed = data.composedFrom as string[];
    assert.ok(Array.isArray(composed), "composedFrom must be an array");
    for (const expected of ["SKILL.md", "workflow.md", "template.md"]) {
      assert.ok(
        composed.includes(expected),
        `expected ${expected} in composedFrom (got ${composed.join(", ")})`,
      );
    }
    assert.ok(Array.isArray(data.tips));
    assert.equal(typeof data.totalScore, "number");
  });

  it("returns 400 when both content and files are set", async () => {
    const { res } = await fetchJson("/api/quality/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "# x",
        files: [{ name: "SKILL.md", content: "# x" }],
      }),
    });
    assert.equal(res.status, 400);
  });

  it("returns 400 when neither content nor files is set", async () => {
    const { res } = await fetchJson("/api/quality/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suggestedName: "x" }),
    });
    assert.equal(res.status, 400);
  });

  it("returns 400 for an empty files array", async () => {
    const { res } = await fetchJson("/api/quality/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: [] }),
    });
    assert.equal(res.status, 400);
  });

  it("returns 400 for a file with a path-separator in its name", async () => {
    for (const name of ["../escape.md", "..\\escape.md"]) {
      const { res } = await fetchJson("/api/quality/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: [{ name, content: "# x" }],
        }),
      });
      assert.equal(res.status, 400, name);
    }
  });

  it("returns 400 for duplicate filenames in the bundle", async () => {
    const { res } = await fetchJson("/api/quality/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [
          { name: "SKILL.md", content: "# a" },
          { name: "SKILL.md", content: "# b" },
        ],
      }),
    });
    assert.equal(res.status, 400);
  });

  it("counts evaluate bundle content caps in UTF-8 bytes", async () => {
    const { res } = await fetchJson("/api/quality/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [
          { name: "one.md", content: "€".repeat(44 * 1024) },
          { name: "two.md", content: "€".repeat(44 * 1024) },
        ],
      }),
    });
    assert.equal(res.status, 400);
  });

  it("counts evaluate filenames in UTF-8 bytes", async () => {
    const { res } = await fetchJson("/api/quality/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{ name: `${"é".repeat(130)}.md`, content: "# x" }],
      }),
    });
    assert.equal(res.status, 400);
  });
});

describe("dashboard /api/quality/analyse (deprecated alias)", () => {
  const SKILL_DRAFT = [
    "---",
    "name: postgres-index",
    "description: Walk through a Postgres index change with explicit evidence gates.",
    "goat-flow-skill-version: 1.6.0",
    "---",
    "# /postgres-index",
    "",
    "## Step 0",
    "Read CLAUDE.md and the migration file.",
    "",
    "## Phase 1",
    "Plan the index change with downtime estimate.",
    "",
    "## Verification",
    "- [ ] Lock acquisition under 100ms in staging.",
  ].join("\n");

  it("scores via the alias and emits Deprecation + Link headers", async () => {
    const { res, body } = await fetchJson("/api/quality/analyse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: SKILL_DRAFT, kind: "skill" }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("deprecation"), "true");
    assert.match(
      String(res.headers.get("link") ?? ""),
      /\/api\/quality\/evaluate.*successor-version/,
    );
    const data = expectRecord(body, "Alias evaluate result");
    assert.equal(typeof data.totalScore, "number");
    assert.ok(Array.isArray(data.metrics));
  });

  it("emits the Deprecation header on alias 400 responses too", async () => {
    const { res } = await fetchJson("/api/quality/analyse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "" }),
    });
    assert.equal(res.status, 400);
    assert.equal(res.headers.get("deprecation"), "true");
  });

  it("returns 405 for non-POST on the alias", async () => {
    const { res } = await fetchJson("/api/quality/analyse");
    assert.equal(res.status, 405);
  });
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
  it("POST /api/terminal/create rejects unknown runners without launching a fallback", async () => {
    const { res, body } = await fetchJson("/api/terminal/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "",
        projectPath: PROJECT_PATH,
        runner: "cursor",
      }),
    });
    assert.equal(res.status, 400);
    const data = expectRecord(body, "Terminal create error");
    assert.equal(data.path, "body.runner");
    assert.match(String(data.error), /unknown runner: cursor/);
  });

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

  it("POST /api/terminal/:id/upload-image rejects an unsafe session id", async () => {
    const { res, body } = await fetchJson(
      "/api/terminal/..%2Fevil/upload-image",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: [] }),
      },
    );
    assert.equal(res.status, 400);
    const data = expectRecord(body, "Upload bad-id error");
    assert.match(String(data.error), /Invalid session id/);
  });

  it("POST /api/terminal/:id/upload-image returns 404 for an unknown session id", async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(16, 0xff),
    ]);
    const { res, body } = await fetchJson(
      "/api/terminal/sess-not-real/upload-image",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: [{ name: "x.png", data: png.toString("base64") }],
        }),
      },
    );
    assert.equal(res.status, 404);
    const data = expectRecord(body, "Upload missing-session error");
    assert.match(String(data.error), /Session not found/);
  });

  it("POST /api/terminal/:id/upload-image rejects an empty files array", async () => {
    const { res, body } = await fetchJson("/api/terminal/sess-x/upload-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: [] }),
    });
    assert.equal(res.status, 400);
    const data = expectRecord(body, "Upload empty-files error");
    assert.equal(data.path, "body.files");
    assert.match(String(data.error), /at least one file/);
  });

  it("POST /api/terminal/:id/upload-image rejects too many files in one request", async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(16, 0xff),
    ]);
    const oneFile = { name: "x.png", data: png.toString("base64") };
    const { res, body } = await fetchJson("/api/terminal/sess-x/upload-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [oneFile, oneFile, oneFile, oneFile, oneFile, oneFile],
      }),
    });
    assert.equal(res.status, 400);
    const data = expectRecord(body, "Upload too-many error");
    assert.equal(data.path, "body.files");
    assert.match(String(data.error), /at most 5 file/);
  });

  it("POST /api/terminal/:id/upload-image rejects malformed JSON", async () => {
    const { res, body } = await fetchJson("/api/terminal/sess-x/upload-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    assert.equal(res.status, 400);
    const data = expectRecord(body, "Upload bad-json error");
    assert.match(String(data.error), /invalid JSON/);
  });

  it("POST /api/terminal/:id/upload-image returns JSON 413 for oversized bodies", async () => {
    const { res, body } = await fetchJson("/api/terminal/sess-x/upload-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "x".repeat(TERMINAL_UPLOAD_MAX_BODY_BYTES + 1),
    });
    assert.equal(res.status, 413);
    const data = expectRecord(body, "Upload oversized error");
    assert.match(String(data.error), /Upload body too large/);
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
