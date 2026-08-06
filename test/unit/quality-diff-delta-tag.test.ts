/**
 * Verifies deterministic signals shown by `quality diff`.
 * Users see finding identity, delta-tag disagreements, and stuck streaks when comparing runs.
 * Positional finding ids remain authoritative, while streaks require provably consecutive dates.
 * In-memory reports isolate those rules from filesystem history loading.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildQualityDiff } from "../../src/cli/quality/history-diff.js";
import type { QualityHistoryEntry } from "../../src/cli/quality/history.js";
import { renderQualityDiffText } from "../../src/cli/quality/history-render.js";
import type {
  SavedQualityFinding,
  SavedQualityReport,
} from "../../src/cli/quality/schema.js";

/** Build one saved finding row with sane defaults. */
function finding(
  id: string,
  deltaTag: "new" | "persisted" | null,
): SavedQualityFinding {
  return {
    id,
    type: "framework_flaw",
    severity: "MAJOR",
    file: "docs/example.md",
    line: null,
    summary: `Finding ${id}`,
    detail: "detail",
    evidence_quality: "OBSERVED",
    evidence_method: "static-analysis",
    delta_tag: deltaTag,
  };
}

/** Build one in-memory history entry for the diff under test. */
function entry(
  id: string,
  runDate: string,
  findings: SavedQualityFinding[],
  priorReportId: string | null,
): QualityHistoryEntry {
  const report: SavedQualityReport = {
    report_kind: "goat-flow-quality-report",
    goat_flow_version: "1.13.1",
    agent: "claude",
    project_path: "/tmp/example",
    run_date: runDate,
    audit_status: "pass",
    scope: "consumer",
    rubric_version: "1.13.1",
    quality_mode: "agent-setup",
    prior_report_id: priorReportId,
    scores: {
      setup: {
        total: 60,
        accuracy: 15,
        relevance: 15,
        completeness: 15,
        friction: 15,
      },
      system: {
        total: 60,
        usefulness: 15,
        signal_to_noise: 15,
        adaptability: 15,
        learnability: 15,
      },
    },
    findings,
  };
  return {
    id,
    path: `/tmp/example/.goat-flow/logs/quality/${id}.json`,
    date: runDate,
    time: "0900",
    agent: "claude",
    randomId: id.slice(-5),
    report,
  };
}

const FROM_ID = "2026-06-01-0900-claude-aaaaa";
const TO_ID = "2026-06-15-0900-claude-bbbbb";
const STREAK_OLDEST_ID = "2026-05-01-0900-claude-ccccc";
const STREAK_MIDDLE_ID = "2026-05-15-0900-claude-ddddd";
const STREAK_NEWEST_ID = "2026-06-01-0900-claude-eeeee";

/**
 * Count stuck findings across three newest-first report dates.
 * Use when a test needs the user-visible streak result without filesystem setup.
 *
 * @param runDates - newest, middle, and oldest report dates; invalid values must break continuity
 * @returns stuck finding count; zero means the diff cannot prove three consecutive runs
 */
function countStuckFindings(
  runDates: readonly [string, string, string],
): number {
  const oldestReport = entry(
    STREAK_OLDEST_ID,
    runDates[2],
    [finding("f-stuck", null)],
    null,
  );
  const middleReport = entry(
    STREAK_MIDDLE_ID,
    runDates[1],
    [finding("f-stuck", "persisted")],
    STREAK_OLDEST_ID,
  );
  const newestReport = entry(
    STREAK_NEWEST_ID,
    runDates[0],
    [finding("f-stuck", "persisted")],
    STREAK_MIDDLE_ID,
  );
  const result = buildQualityDiff([newestReport, middleReport, oldestReport], {
    agent: "claude",
    pair: `${STREAK_MIDDLE_ID}:${STREAK_NEWEST_ID}`,
  });
  assert.ok(result.ok, !result.ok ? result.error : "");
  return result.diff.stuck.length;
}

describe("quality diff delta_tag disagreement signal", () => {
  it("flags contradictions when the diff pair matches the tag baseline", () => {
    const olderReport = entry(
      FROM_ID,
      "2026-06-01",
      [finding("f-1", null)],
      null,
    );
    // f-1 persists but the agent tagged it "new"; f-2 is new and correctly
    // tagged; both directions of the check are exercised.
    const newerReport = entry(
      TO_ID,
      "2026-06-15",
      [finding("f-1", "new"), finding("f-2", "new")],
      FROM_ID,
    );
    const result = buildQualityDiff([newerReport, olderReport], {
      agent: "claude",
      pair: `${FROM_ID}:${TO_ID}`,
    });
    assert.ok(result.ok, !result.ok ? result.error : "");
    assert.deepEqual(
      result.diff.deltaTagDisagreements.map((row) => ({
        id: row.id,
        agentTag: row.agentTag,
        deterministic: row.deterministic,
      })),
      [{ id: "f-1", agentTag: "new", deterministic: "persisted" }],
    );
    // The rendered text carries the section and the source-of-truth note.
    const text = renderQualityDiffText(result.diff);
    assert.match(text, /Delta-tag disagreements \(1\)/);
    assert.match(text, /agent said "new", deterministic diff says "persisted"/);
  });

  it("stays silent when agent tags agree with the deterministic diff", () => {
    const olderReport = entry(
      FROM_ID,
      "2026-06-01",
      [finding("f-1", null)],
      null,
    );
    const newerReport = entry(
      TO_ID,
      "2026-06-15",
      [finding("f-1", "persisted"), finding("f-2", "new")],
      FROM_ID,
    );
    const result = buildQualityDiff([newerReport, olderReport], {
      agent: "claude",
      pair: `${FROM_ID}:${TO_ID}`,
    });
    assert.ok(result.ok, !result.ok ? result.error : "");
    assert.deepEqual(result.diff.deltaTagDisagreements, []);
    assert.doesNotMatch(
      renderQualityDiffText(result.diff),
      /Delta-tag disagreements/,
    );
  });

  it("ignores tags entirely when the pair is not the tag baseline", () => {
    // The newer report was tagged against SOME OTHER baseline - comparing its
    // tags to this pair would manufacture disagreements about a diff the
    // agent never performed.
    const olderReport = entry(
      FROM_ID,
      "2026-06-01",
      [finding("f-1", null)],
      null,
    );
    const newerReport = entry(
      TO_ID,
      "2026-06-15",
      [finding("f-1", "new")],
      "2026-05-01-0900-claude-zzzzz",
    );
    const result = buildQualityDiff([newerReport, olderReport], {
      agent: "claude",
      pair: `${FROM_ID}:${TO_ID}`,
    });
    assert.ok(result.ok, !result.ok ? result.error : "");
    assert.deepEqual(result.diff.deltaTagDisagreements, []);
  });
});

describe("quality diff stuck-finding continuity", () => {
  /** Invariant: same-day reruns are consecutive and must expose a finding present in all three. */
  it("keeps a finding stuck across three zero-day gaps", () => {
    assert.equal(
      countStuckFindings(["2026-06-15", "2026-06-15", "2026-06-15"]),
      1,
    );
  });

  const brokenContinuityCases = [
    ["a negative date gap", ["2026-06-01", "2026-06-15", "2026-05-30"]],
    ["a gap over 30 days", ["2026-06-15", "2026-05-01", "2026-04-15"]],
    ["an invalid legacy date", ["2026-03-10", "2026-02-30", "2026-02-25"]],
  ] as const;

  // Each unprovable sequence stays out of the user's stuck-finding list.
  for (const [caseName, runDates] of brokenContinuityCases) {
    /** One broken date relationship must stop the streak before it reaches three runs. */
    it(`breaks continuity across ${caseName}`, () => {
      assert.equal(countStuckFindings(runDates), 0);
    });
  }
});
