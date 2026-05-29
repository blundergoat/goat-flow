/**
 * Unit tests for the Home dashboard summary object embedded in home.html.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { createContext, runInContext } from "node:vm";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const HOME_VIEW_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "views",
  "home.html",
);

type HomeModel = {
  /** Return true when every harness concern for an agent is passing. */
  agentAllConcernsPassing(agent: Record<string, unknown>): boolean;
  /** Return the score shown for one agent summary card. */
  agentScore(agent: Record<string, unknown>): number | null;
  /** Return the compact enforcement capability badge label. */
  enforcementBadge(row: Record<string, unknown>): string;
  /** Return the CSS class used for one enforcement badge. */
  enforcementBadgeClass(row: Record<string, unknown>): string;
  /** Return the enforcement rows rendered in the Home detail panel. */
  enforcementRows(agent: Record<string, unknown>): Record<string, unknown>[];
  /** Return the concern summary text rendered for one concern key. */
  formatConcernSummary(agent: Record<string, unknown>, key: string): string;
  /** Return the average harness score across agents. */
  harnessAverage(): number | null;
  /** Return the Home harness pill detail text. */
  harnessPillDetail(): string;
  /** Return the Home harness pill tone. */
  harnessPillTone(): string;
  /** Return the Home harness pill headline value. */
  harnessPillValue(): string;
  /** Return the recommendation summary for one agent card. */
  recommendationSummary(agent: Record<string, unknown>): string;
  /** Return the section metadata text for the Home harness summary. */
  sectionMeta(): string;
};

/** Load the inline Home x-data model into a VM context for unit assertions. */
function loadHomeModel(report: unknown): HomeModel {
  const source = readFileSync(HOME_VIEW_PATH, "utf-8");
  const start = source.indexOf('x-data="{');
  assert.notEqual(start, -1, "home.html should contain an x-data object");
  const bodyStart = start + 'x-data="{'.length;
  const bodyEnd = source.indexOf('\n  }"\n  >', bodyStart);
  assert.notEqual(bodyEnd, -1, "home.html x-data object should be extractable");
  const body = source.slice(bodyStart, bodyEnd);
  const context = createContext({
    report,
    currentProjectSessions: [],
    supportedAgents: [],
    lastAuditTime: null,
    auditCached: false,
  });
  runInContext(`globalThis.__home = ({${body}\n});`, context);
  return (context as typeof context & { __home: HomeModel }).__home;
}

function concern(
  status: "pass" | "fail",
  score: number,
  extra: Record<string, unknown> = {},
) {
  return {
    status,
    score,
    findings: [],
    limits: [],
    recommendations: [],
    howToFix: [],
    ...extra,
  };
}

describe("Home harness summary", () => {
  it("does not show Passing when high-score agents have hard harness failures", () => {
    const harnessChecks = Array.from({ length: 14 }, (_, index) => ({
      id: `check-${index}`,
      status: index === 0 ? "fail" : "pass",
      type: "integrity",
    }));
    const home = loadHomeModel({
      scopes: {
        setup: {
          status: "pass",
          checks: [{ id: "config-parses", status: "pass" }],
        },
      },
      agentScores: [
        {
          id: "claude",
          name: "Claude Code",
          agent: { status: "pass", checks: [] },
          harness: { status: "fail", checks: harnessChecks },
          concerns: {
            context: concern("fail", 80, { integrityFail: 1 }),
            constraints: concern("pass", 100),
            verification: concern("pass", 100),
            recovery: concern("pass", 100),
            feedback_loop: concern("pass", 100),
          },
        },
      ],
    });

    assert.equal(home.harnessAverage(), 93);
    assert.equal(home.harnessPillValue(), "Needs work");
    assert.equal(home.harnessPillTone(), "bad");
    assert.equal(
      home.harnessPillDetail(),
      "1 of 1 agents have failing checks - Context low",
    );
    assert.equal(
      home.sectionMeta(),
      "1 of 1 agents need fixes - widest gap is Context - click for details",
    );
  });

  it("surfaces score-only metric warnings in headline scoring and summaries", () => {
    const agent = {
      id: "claude",
      name: "Claude Code",
      agent: { status: "pass", checks: [] },
      harness: {
        status: "pass",
        checks: [
          { id: "instruction", status: "pass", type: "integrity" },
          { id: "verification", status: "pass", type: "integrity" },
          {
            id: "post-turn-hook-integrity",
            status: "fail",
            type: "metric",
            impact: "score-only",
          },
        ],
      },
      concerns: {
        context: concern("pass", 100),
        constraints: concern("pass", 100),
        verification: concern("pass", 67, {
          findings: ["No post-turn hooks installed"],
        }),
        recovery: concern("pass", 100),
        feedback_loop: concern("pass", 100),
      },
    };
    const home = loadHomeModel({
      scopes: {
        setup: {
          status: "pass",
          checks: [{ id: "config-parses", status: "pass" }],
        },
      },
      agentScores: [agent],
    });

    assert.equal(home.agentScore(agent), 67);
    assert.equal(home.recommendationSummary(agent), "1 score warning");
    assert.equal(home.agentAllConcernsPassing(agent), false);
    assert.equal(
      home.formatConcernSummary(agent, "verification"),
      "No post-turn hooks installed",
    );
  });

  it("exposes advisory enforcement rows for the detail panel", () => {
    const agent = {
      id: "claude",
      name: "Claude Code",
      agent: { status: "pass", checks: [] },
      harness: { status: "pass", checks: [] },
      concerns: {},
      enforcement: {
        capabilities: [
          {
            id: "shell-dangerous",
            label: "Dangerous shell commands",
            status: "hard",
            summary: "Deny mechanism blocks dangerous commands",
          },
          {
            id: "file-read-restrictions",
            label: "General file-read restrictions",
            status: "unknown",
            summary: "Not inferred from secret-path coverage",
          },
        ],
      },
    };
    const home = loadHomeModel({
      scopes: {
        setup: {
          status: "pass",
          checks: [{ id: "config-parses", status: "pass" }],
        },
      },
      agentScores: [agent],
    });

    const rows = home.enforcementRows(agent);
    assert.equal(rows.length, 2);
    assert.equal(home.enforcementBadge(rows[0]!), "Hard");
    assert.equal(home.enforcementBadgeClass(rows[0]!), "pass");
    assert.equal(home.enforcementBadge(rows[1]!), "Unk");
    assert.equal(home.enforcementBadgeClass(rows[1]!), "skipped");
  });
});
