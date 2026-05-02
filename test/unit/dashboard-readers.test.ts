/**
 * Unit tests for browser-local dashboard payload readers.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { ScriptTarget, transpileModule } from "typescript";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const READERS_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "dashboard-readers.ts",
);

type HelperContext = {
  readDashboardReport(value: unknown): {
    agentScores: {
      harness: {
        checks: { status: string; type?: string }[];
      } | null;
    }[];
  };
};

function loadHelpers(): HelperContext {
  const source = readFileSync(READERS_PATH, "utf-8");
  const js = transpileModule(source, {
    compilerOptions: { target: ScriptTarget.ES2023 },
  }).outputText;
  const context = createContext({
    window: {
      __GOAT_FLOW_RUNNER_IDS__: ["claude"],
      __GOAT_FLOW_REPORT__: null,
      __GOAT_FLOW_AGENTS__: [{ id: "claude", name: "Claude Code" }],
    },
  });
  runInContext(
    `${js}
globalThis.__helpers = {
  readDashboardReport,
};`,
    context,
  );
  return (context as typeof context & { __helpers: HelperContext }).__helpers;
}

function provenance(): Record<string, unknown> {
  return {
    source_type: "spec",
    source_urls: [],
    verified_on: "2026-05-01",
    normative_level: "MUST",
  };
}

function check(
  id: string,
  status: "pass" | "fail",
  type: "integrity" | "advisory" | "metric",
): Record<string, unknown> {
  return {
    id,
    name: id,
    status,
    type,
    provenance: provenance(),
  };
}

function scope(
  checks: Record<string, unknown>[] = [],
): Record<string, unknown> {
  return {
    status: "pass",
    checks,
    failures: [],
    summary: {},
  };
}

describe("dashboard payload readers", () => {
  it("preserves harness check type so metric failures do not lower UI scores", () => {
    const helpers = loadHelpers();

    const report = helpers.readDashboardReport({
      status: "pass",
      target: "/repo",
      overall: { status: "pass" },
      scopes: {
        setup: scope(),
        agent: scope(),
        harness: scope(),
      },
      learningLoop: null,
      recentLessons: [],
      agentScores: [
        {
          id: "claude",
          name: "Claude Code",
          agent: scope(),
          harness: scope([
            check("integrity-ok", "pass", "integrity"),
            check("advisory-ok", "pass", "advisory"),
            check("metric-info", "fail", "metric"),
          ]),
          concerns: null,
        },
      ],
    });

    const checks = report.agentScores[0]?.harness?.checks ?? [];
    assert.deepEqual(
      checks.map((entry) => entry.type),
      ["integrity", "advisory", "metric"],
    );

    const scored = checks.filter((entry) => entry.type !== "metric");
    const score = Math.round(
      (scored.filter((entry) => entry.status === "pass").length /
        scored.length) *
        100,
    );
    assert.equal(score, 100);
  });
});
