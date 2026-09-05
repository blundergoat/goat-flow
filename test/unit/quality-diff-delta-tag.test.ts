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
  QualityScoreRationale,
  SavedQualityFinding,
  SavedQualityReport,
} from "../../src/cli/quality/schema.js";
import { makeQualityScoreRationale } from "../fixtures/quality-score-rationale.js";

/** Build one saved finding row with sane defaults; the id is what the diff contract matches on, so tests set it deliberately. */
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
  scoreRationale?: QualityScoreRationale,
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
    ...(scoreRationale ? { score_rationale: scoreRationale } : {}),
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

describe("quality diff score rationale", () => {
  it("renders all current axes beside unchanged arithmetic and labels a legacy side", () => {
    const older = entry(FROM_ID, "2026-06-01", [], null);
    const newer = entry(
      TO_ID,
      "2026-06-15",
      [],
      FROM_ID,
      makeQualityScoreRationale(),
    );
    const result = buildQualityDiff([newer, older], {
      agent: "claude",
      pair: `${FROM_ID}:${TO_ID}`,
    });
    assert.ok(result.ok, !result.ok ? result.error : "");
    assert.equal(result.diff.setupDelta, 0);
    assert.equal(result.diff.systemDelta, 0);

    const rendered = renderQualityDiffText(result.diff);
    assert.match(
      rendered,
      /Setup 60\/100 → 60\/100 \(\+0\)\. System 60\/100 → 60\/100 \(\+0\)\./u,
    );
    assert.match(
      rendered,
      new RegExp(
        `From ${FROM_ID}[\\s\\S]*rationale unavailable \\(legacy report\\)`,
      ),
    );
    for (const axis of [
      "setup.accuracy",
      "setup.relevance",
      "setup.completeness",
      "setup.friction",
      "system.usefulness",
      "system.signal_to_noise",
      "system.adaptability",
      "system.learnability",
    ]) {
      assert.match(rendered, new RegExp(`${axis} 15/25`), axis);
    }
    assert.match(rendered, /evidence: The cited source and runtime evidence/u);
    assert.match(rendered, /deduction: The cited rating-band evidence/u);
  });
});

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

describe("quality diff absent-bucket honesty", () => {
  /**
   * A finding missing from the newer report is not evidence it was fixed, which is the contract this suite holds.
   *
   * It also disappears when the newer run never examined that artifact, or when a line-based id shifted. Measured
   * 2026-07-31: two findings were reported resolved while the defects were still present in the cited files.
   */
  it("names the bucket by absence and warns against reading it as a fix", () => {
    const older = entry(
      FROM_ID,
      "2026-06-01",
      [finding("gone-from-newer-run", null), finding("still-there", null)],
      null,
    );
    const newer = entry(
      TO_ID,
      "2026-06-15",
      [finding("still-there", null)],
      FROM_ID,
    );

    const result = buildQualityDiff([newer, older], {
      agent: "claude",
      pair: `${FROM_ID}:${TO_ID}`,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    // The bucket still reports set difference; only its meaning is stated honestly.
    assert.deepEqual(
      result.diff.absent.map((row) => row.id),
      ["gone-from-newer-run"],
    );

    const rendered = renderQualityDiffText(result.diff);
    assert.match(rendered, /Absent from newer report \(1\)/u);
    assert.match(rendered, /Not proof of a fix/u);
    // "Resolved" asserted the defect was gone, which the set difference cannot show.
    assert.doesNotMatch(rendered, /^Resolved \(/mu);
  });

  /** The caveat is noise on an empty bucket, so it must appear only alongside rows. */
  it("omits the caveat when nothing went absent", () => {
    const older = entry(
      FROM_ID,
      "2026-06-01",
      [finding("still-there", null)],
      null,
    );
    const newer = entry(
      TO_ID,
      "2026-06-15",
      [finding("still-there", null)],
      FROM_ID,
    );

    const result = buildQualityDiff([newer, older], {
      agent: "claude",
      pair: `${FROM_ID}:${TO_ID}`,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const rendered = renderQualityDiffText(result.diff);
    assert.match(rendered, /Absent from newer report \(0\)/u);
    assert.doesNotMatch(rendered, /Not proof of a fix/u);
  });
});
