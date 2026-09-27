/**
 * Measure the waits users encounter when starting the CLI or opening dashboard HTTP endpoints.
 *
 * Use the opt-in performance command to compare warmed timings with explicit startup and request budgets.
 * The suite's skip setting keeps unrequested runs from treating noisy wall-clock measurements as normal test failures.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { join, resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const CLI_PATH = join(PROJECT_ROOT, "dist", "cli", "cli.js");
const DASHBOARD_HTML_PATH = join(
  PROJECT_ROOT,
  "dist",
  "dashboard",
  "index.html",
);
const PERF_ENABLED = process.env["GOAT_FLOW_PERF_TESTS"] === "1";
const PERF_SKIP = PERF_ENABLED
  ? false
  : "Set GOAT_FLOW_PERF_TESTS=1 or run `npm run test:performance`.";
// Without a timing override, the opt-in run uses each operation's documented budget unchanged.
const PERF_BUDGET_SCALE = Number.parseFloat(
  process.env["GOAT_FLOW_PERF_BUDGET_SCALE"] ?? "1",
);
// An invalid or non-positive override cannot silently relax or invert the timing assertions.
const performanceBudgetMultiplier =
  Number.isFinite(PERF_BUDGET_SCALE) && PERF_BUDGET_SCALE > 0
    ? PERF_BUDGET_SCALE
    : 1;

/**
 * Keep repeated operation timings with the summary used by budget assertions.
 *
 * Samples are sorted so the mean, 95th percentile, and maximum describe the same measurements.
 * The assertion message uses these values to explain a slow command or dashboard request.
 */
interface DurationStats {
  samples: number[];
  mean: number;
  p95: number;
  max: number;
}

/**
 * Retain the dashboard started for request-timing tests.
 *
 * Its port and URL identify the local server and its authentication token.
 * Cleanup closes that same server after the measured requests finish.
 */
interface DashboardServerHandle {
  port: number;
  url: string;
  close: () => Promise<void>;
}

// Scale a command or request's timing limit using the multiplier selected for this performance run.
function budget(milliseconds: number): number {
  return milliseconds * performanceBudgetMultiplier;
}

// Summarize repeated timings with a stable p95 contract used by assertions.
function summarize(samples: number[]): DurationStats {
  assert.ok(samples.length > 0, "duration samples should not be empty");
  const sorted = [...samples].sort((a, b) => a - b);
  const p95Index = Math.min(
    sorted.length - 1,
    Math.ceil(sorted.length * 0.95) - 1,
  );
  const total = sorted.reduce((sum, sample) => sum + sample, 0);
  return {
    samples: sorted,
    mean: total / sorted.length,
    p95: sorted[p95Index] ?? sorted[sorted.length - 1]!,
    max: sorted[sorted.length - 1]!,
  };
}

// Render timing stats in a stable format for local performance runs.
function formatStats(label: string, stats: DurationStats): string {
  return `${label}: mean=${stats.mean.toFixed(1)}ms p95=${stats.p95.toFixed(
    1,
  )}ms max=${stats.max.toFixed(1)}ms n=${stats.samples.length}`;
}

// Fail with a budget-specific message instead of a generic assertion.
function assertUnderBudget(label: string, actualMs: number, budgetMs: number) {
  assert.ok(
    actualMs <= budgetMs,
    `${label} ${actualMs.toFixed(1)}ms exceeded ${budgetMs.toFixed(1)}ms`,
  );
}

// Measure a labelled user operation after warmups so the reported timing reflects steady-state work; writes the summary to stdout.
async function measure(
  label: string,
  options: { warmups: number; samples: number },
  run: () => void | Promise<void>,
): Promise<DurationStats> {
  // Warm the operation before recording samples so one-time startup work does not dominate repeated-use timings.
  for (let warmupIndex = 0; warmupIndex < options.warmups; warmupIndex++) {
    await run();
  }

  const samples: number[] = [];
  // Repeated measurements let the budget assertion catch slow user operations beyond a single lucky request.
  for (let sampleIndex = 0; sampleIndex < options.samples; sampleIndex++) {
    const start = performance.now();
    await run();
    samples.push(performance.now() - start);
  }

  const stats = summarize(samples);
  process.stdout.write(`${formatStats(label, stats)}\n`);
  return stats;
}

// Ensure opt-in performance tests run against built distribution files.
function requireBuiltArtifacts(): void {
  assert.ok(
    existsSync(CLI_PATH),
    `Expected built CLI at ${CLI_PATH}. Run npm run build first.`,
  );
  assert.ok(
    existsSync(DASHBOARD_HTML_PATH),
    `Expected built dashboard at ${DASHBOARD_HTML_PATH}. Run npm run build first.`,
  );
}

// Spawns the built CLI so startup measurements match packaged execution.
function runCli(args: string[]): string {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: PROJECT_ROOT,
    encoding: "utf-8",
    maxBuffer: 1024 * 1024,
    timeout: 5_000,
  });
  assert.equal(
    result.status,
    0,
    `goat-flow ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result.stdout;
}

// Fetch a measured dashboard route and require HTTP 200 so the timing test cannot pass by measuring a failed request.
async function fetchOk(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(response.status, 200, `${path} should return HTTP 200`);
  return response;
}

describe("performance: cli", { skip: PERF_SKIP }, () => {
  before(() => {
    requireBuiltArtifacts();
  });

  it("keeps CLI version startup under budget", async () => {
    const stats = await measure(
      "cli --version",
      { warmups: 1, samples: 5 },
      () => {
        const stdout = runCli(["--version"]);
        assert.match(stdout.trim(), /^goat-flow v\d+\.\d+\.\d+$/);
      },
    );

    assertUnderBudget("cli --version p95", stats.p95, budget(1_000));
  });

  it("keeps manifest command startup and JSON rendering under budget", async () => {
    const stats = await measure(
      "cli manifest --format json",
      { warmups: 1, samples: 5 },
      () => {
        const stdout = runCli(["manifest", "--format", "json"]);
        const manifest = JSON.parse(stdout) as { facts?: unknown };
        assert.equal(typeof manifest.facts, "object");
      },
    );

    assertUnderBudget("cli manifest p95", stats.p95, budget(1_500));
  });
});

describe("performance: dashboard", { skip: PERF_SKIP }, () => {
  let server: DashboardServerHandle | undefined;
  let baseUrl = "";
  let dashboardToken = "";
  let startupMs = 0;

  before(async () => {
    requireBuiltArtifacts();
    const start = performance.now();
    const { serveDashboard } =
      await import("../../src/cli/server/dashboard.js");
    server = await serveDashboard({ projectPath: PROJECT_ROOT });
    startupMs = performance.now() - start;
    baseUrl = `http://127.0.0.1:${server.port}`;
    // An absent token stays empty so the authenticated request fails visibly instead of borrowing another session's access.
    dashboardToken = new URL(server.url).searchParams.get("token") ?? "";
    process.stdout.write(`dashboard startup: ${startupMs.toFixed(1)}ms\n`);
  });

  after(async () => {
    // Close only a server that started successfully; a failed setup leaves no listener to clean up.
    if (server) {
      await server.close();
    }
  });

  it("starts the dashboard server under budget", () => {
    assertUnderBudget("dashboard startup", startupMs, budget(2_000));
  });

  it("keeps cached dashboard shell requests under budget", async () => {
    const stats = await measure(
      "dashboard GET /",
      { warmups: 2, samples: 20 },
      async () => {
        const response = await fetchOk(baseUrl, "/");
        assert.match(response.headers.get("content-type") ?? "", /text\/html/i);
        const dashboardMarkup = await response.text();
        assert.match(dashboardMarkup, /__GOAT_FLOW_DEFAULT_PATH__/);
      },
    );

    assertUnderBudget("dashboard shell p95", stats.p95, budget(250));
  });

  it("keeps health endpoint requests under budget", async () => {
    const stats = await measure(
      "dashboard GET /api/health",
      { warmups: 2, samples: 20 },
      async () => {
        const response = await fetchOk(baseUrl, "/api/health", {
          headers: { "X-Goat-Flow-Dashboard-Token": dashboardToken },
        });
        assert.match(response.headers.get("content-type") ?? "", /json/i);
        const body = (await response.json()) as { uptime?: unknown };
        assert.equal(typeof body.uptime, "number");
      },
    );

    assertUnderBudget("dashboard health p95", stats.p95, budget(100));
  });
});
