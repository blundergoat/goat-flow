/**
 * Integration tests for the dashboard HTTP server.
 * Starts a real server, hits public endpoints, and validates response contracts.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { setEnv } from "../helpers/global-fixtures.js";
import {
  getAgentProfileMap,
  getKnownAgentIds,
} from "../../src/cli/agents/registry.js";
import { AUDIT_VERSION } from "../../src/cli/constants.js";
import {
  validateEvidenceEnvelope,
  type EvidenceEnvelope,
} from "../../src/cli/evidence/envelope.js";
import { normalizeAgentVersionOutput } from "../../src/cli/server/dashboard-route-types.js";
import { TERMINAL_UPLOAD_MAX_BODY_BYTES } from "../../src/cli/server/terminal-uploads.js";

export const PROJECT_PATH = resolve(import.meta.dirname, "..", "..");
export const DASHBOARD_STATE_PATH = resolve(
  PROJECT_PATH,
  ".goat-flow",
  "dashboard-state.json",
);
export const LEGACY_PROJECTS_LIST_PATH = resolve(
  PROJECT_PATH,
  ".goat-flow",
  "dashboard-projects.json",
);
export const MISSING_PATH = resolve(
  PROJECT_PATH,
  "definitely-missing-dashboard-path",
);
export const require = createRequire(import.meta.url);
export const childProcess =
  require("node:child_process") as typeof import("node:child_process");
export const originalExecFileSync = childProcess.execFileSync;
export const CODEX_WORKSPACE_ROOT_ENTRIES = [
  '"**/.env*" = "deny"',
  '"**/secrets/**" = "deny"',
  '"**/.ssh/**" = "deny"',
  '"**/.aws/**" = "deny"',
  '"**/.docker/**" = "deny"',
  '"**/.gnupg/**" = "deny"',
  '"**/.kube/**" = "deny"',
  '"**/credentials*" = "deny"',
  '"**/.npmrc" = "deny"',
  '"**/.pypirc" = "deny"',
  '"**/*.pem" = "deny"',
  '"**/*.key" = "deny"',
  '"**/*.pfx" = "deny"',
];
export const CODEX_CONFIG = [
  'model = "gpt-5"',
  'default_permissions = "goat-flow"',
  "[features]",
  "hooks = true",
  "[permissions.goat-flow]",
  'description = "goat-flow workspace editing with secret-path read denies."',
  'extends = ":workspace"',
  "[permissions.goat-flow.filesystem]",
  "glob_scan_max_depth = 3",
  `":workspace_roots" = { ${CODEX_WORKSPACE_ROOT_ENTRIES.join(", ")} }`,
  "",
].join("\n");

export let server: { port: number; close: () => Promise<void> } | undefined;
export let baseUrl = "";
export let dashboardToken = "";
export let originalDashboardState: string | null = null;
export let originalLegacyProjectsList: string | null = null;

export function withTimeout<T>(
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

export function expectRecord(
  value: unknown,
  context: string,
): Record<string, unknown> {
  assert.equal(typeof value, "object", `${context} should be an object`);
  assert.notEqual(value, null, `${context} should not be null`);
  assert.ok(!Array.isArray(value), `${context} should not be an array`);
  return value as Record<string, unknown>;
}

/**
 * Assert that an endpoint response advertises JSON before decoding the body, so a non-JSON
 * error page fails loudly here instead of throwing later inside `res.json()`.
 *
 * @param res - fetch Response whose content-type header is checked for `application/json`
 * @param context - label woven into the assertion message to identify which endpoint failed
 */
export function assertJsonResponse(res: Response, context: string): void {
  assert.match(
    res.headers.get("content-type") ?? "",
    /application\/json/i,
    `${context} should return JSON`,
  );
}

/**
 * Extract the dashboard auth token injected into the served HTML shell so subsequent API calls
 * can authenticate. Asserts the token is present rather than returning empty on a miss.
 *
 * @param html - the rendered dashboard index HTML containing the injected token assignment
 * @returns the token string captured from the `__GOAT_FLOW_DASHBOARD_TOKEN__` assignment
 */
export function extractDashboardToken(html: string): string {
  const match = html.match(/__GOAT_FLOW_DASHBOARD_TOKEN__\s*=\s*"([^"]+)"/);
  assert.ok(match?.[1], "dashboard HTML should inject an auth token");
  return match[1];
}

/**
 * Assert that a check provenance payload preserves the audit evidence contract: a valid source
 * type, a source_urls array, a verified_on string, and an allowed normative level.
 *
 * @param value - the provenance object from one rendered audit check, of unknown runtime shape
 * @param context - label woven into assertion messages to identify which check's provenance failed
 */
export function assertAuditCheckProvenance(
  value: unknown,
  context: string,
): void {
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

/**
 * Assert one rendered audit scope has a pass/fail status, a checks array (each with valid
 * provenance), a failures array, and a string-valued summary map.
 *
 * @param value - one scope object (setup/agent/harness) from the dashboard report, unknown shape
 * @param context - label woven into assertion messages to identify which scope failed
 */
export function assertAuditScope(value: unknown, context: string): void {
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

/**
 * Assert the dashboard report payload contains every field the browser app reads - status,
 * target, agentScores, the setup/agent (and optional harness) scopes, overall status, and the
 * learningLoop and recentLessons sections - so a contract drift fails the test, not the UI.
 *
 * @param value - the parsed dashboard report response body, of unknown runtime shape
 * @returns the same payload narrowed to a record, for callers that read further fields
 */
export function assertDashboardReport(value: unknown): Record<string, unknown> {
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

export async function fetchJson(
  path: string,
  init?: RequestInit,
): Promise<{ res: Response; body: unknown }> {
  const headers = new Headers(init?.headers);
  headers.set("X-Goat-Flow-Dashboard-Token", dashboardToken);
  const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
  assertJsonResponse(res, path);
  return { res, body: await res.json() };
}

/** Read emitted evidence envelopes with a stable empty-array fallback when the temp log directory is absent. */
export async function readEventEnvelopes(
  root: string,
): Promise<EvidenceEnvelope[]> {
  const dir = join(root, ".goat-flow", "logs", "events");
  let files: string[];
  try {
    files = (await readdir(dir))
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/u.test(name))
      .sort();
  } catch {
    return [];
  }
  const envelopes: EvidenceEnvelope[] = [];
  for (const file of files) {
    const content = await readFile(join(dir, file), "utf-8");
    for (const line of content.split(/\r?\n/u)) {
      if (line.trim()) envelopes.push(JSON.parse(line) as EvidenceEnvelope);
    }
  }
  return envelopes;
}

/**
 * Validate one emitted evidence envelope against the production schema validator, asserting it
 * produces zero validation errors so the dashboard emits only well-formed evidence.
 *
 * @param envelope - a single evidence envelope read back from the temp event log
 */
export function assertValidEmittedEnvelope(envelope: EvidenceEnvelope): void {
  assert.deepEqual(
    validateEvidenceEnvelope(envelope, (path) =>
      existsSync(join(PROJECT_PATH, path)),
    ),
    [],
  );
}

export async function writeProjectFile(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const fullPath = join(root, relativePath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content);
}

/**
 * Spawn git synchronously inside a fixture project for setup helpers; spawns a git subprocess and
 * inherits execFileSync's throw-on-nonzero-exit behavior, so a failed git command throws.
 *
 * @param root - working directory of the fixture project the git command runs in
 * @param args - git argument vector (e.g. ["add", "."]) passed verbatim to execFileSync
 * @returns the command's stdout decoded as utf-8
 */
export function runGit(root: string, args: string[]): string {
  return childProcess.execFileSync("git", args, {
    cwd: root,
    encoding: "utf-8",
  });
}

/**
 * Initialise a repo and create a baseline commit so dashboard cache identity tests can resolve
 * the repository metadata (HEAD/commit) the cache keys on. Uses throwaway test author identity.
 *
 * @param root - working directory of the fixture project to init and commit
 */
export function commitDashboardCacheProject(root: string): void {
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

/** Writes a minimal committed goat-flow fixture project for dashboard cache tests. */
export async function makeDashboardCacheProject(): Promise<{
  root: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), "goat-flow-cache-tests-"));
  const denyHook = await readFile(
    join(PROJECT_PATH, "workflow", "hooks", "deny-dangerous.sh"),
    "utf-8",
  );
  const hookLibFiles = new Map<string, string>();
  for (const file of [
    "patterns-shell.sh",
    "patterns-paths.sh",
    "patterns-writes.sh",
    "deny-dangerous-self-test.sh",
  ]) {
    hookLibFiles.set(
      file,
      await readFile(
        join(PROJECT_PATH, "workflow", "hooks", "deny-dangerous", file),
        "utf-8",
      ),
    );
  }
  await writeProjectFile(
    root,
    ".goat-flow/.gitignore",
    "*\n!.gitignore\n!config.yaml\n!learning-loop/\n!learning-loop/**\n!skill-docs/\n!skill-docs/**\n!hooks/\n!hooks/**\n!plans/\n!plans/**\n",
  );
  await writeProjectFile(
    root,
    ".goat-flow/config.yaml",
    'version: "1.3.2"\nagents:\n  - codex\n',
  );
  await writeProjectFile(
    root,
    ".goat-flow/learning-loop/footguns/README.md",
    "# Footguns\n",
  );
  await writeProjectFile(
    root,
    ".goat-flow/learning-loop/lessons/README.md",
    "# Lessons\n",
  );
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
    '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":".goat-flow/hooks/deny-dangerous.sh"}]}]}}\n',
  );
  await writeProjectFile(root, ".goat-flow/hooks/deny-dangerous.sh", denyHook);
  for (const [file, content] of hookLibFiles) {
    await writeProjectFile(
      root,
      `.goat-flow/hooks/deny-dangerous/${file}`,
      content,
    );
  }
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

/**
 * Build the compact AGENTS.md fixture text used by setup-prompt integration tests - one minimal
 * instruction file carrying every required section heading the setup detector looks for.
 *
 * @returns the AGENTS.md fixture body as a single string
 */
export function dashboardSetupInstruction(): string {
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

export async function makeDashboardSetupPromptProject(options: {
  decisionsDir: boolean;
  installSkills?: boolean;
}): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "goat-flow-setup-prompt-tests-"));
  const denyHook = await readFile(
    join(PROJECT_PATH, "workflow", "hooks", "deny-dangerous.sh"),
    "utf-8",
  );
  const hookLibFiles = new Map<string, string>();
  for (const file of [
    "patterns-shell.sh",
    "patterns-paths.sh",
    "patterns-writes.sh",
    "deny-dangerous-self-test.sh",
  ]) {
    hookLibFiles.set(
      file,
      await readFile(
        join(PROJECT_PATH, "workflow", "hooks", "deny-dangerous", file),
        "utf-8",
      ),
    );
  }
  const commonDirs = [
    ".goat-flow/learning-loop/footguns",
    ".goat-flow/learning-loop/lessons",
    ".goat-flow/plans",
    ".goat-flow/logs/sessions",
    ".goat-flow/skill-docs",
    ".goat-flow/learning-loop/patterns",
    ".goat-flow/scratchpad",
    ".goat-flow/hooks/deny-dangerous",
  ];
  if (options.decisionsDir)
    commonDirs.push(".goat-flow/learning-loop/decisions");
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
  await writeProjectFile(
    root,
    ".goat-flow/learning-loop/footguns/README.md",
    "# Footguns\n",
  );
  await writeProjectFile(
    root,
    ".goat-flow/learning-loop/lessons/README.md",
    "# Lessons\n",
  );
  await writeProjectFile(root, ".goat-flow/plans/.gitignore", "*\n");
  await writeProjectFile(
    root,
    "docs/coding-standards/git-commit.md",
    "# Git Commit Instructions\n",
  );
  await writeProjectFile(
    root,
    ".goat-flow/skill-docs/skill-preamble.md",
    "# Preamble\n",
  );
  await writeProjectFile(
    root,
    ".goat-flow/skill-docs/skill-conventions.md",
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
                  command: ".goat-flow/hooks/deny-dangerous.sh",
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
  await writeProjectFile(root, ".goat-flow/hooks/deny-dangerous.sh", denyHook);
  for (const [file, content] of hookLibFiles) {
    await writeProjectFile(
      root,
      `.goat-flow/hooks/deny-dangerous/${file}`,
      content,
    );
  }
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

export {
  after,
  before,
  describe,
  it,
  assert,
  existsSync,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
  createRequire,
  syncBuiltinESMExports,
  tmpdir,
  dirname,
  join,
  resolve,
  performance,
  setEnv,
  getAgentProfileMap,
  getKnownAgentIds,
  AUDIT_VERSION,
  validateEvidenceEnvelope,
  EvidenceEnvelope,
  normalizeAgentVersionOutput,
  TERMINAL_UPLOAD_MAX_BODY_BYTES,
};
