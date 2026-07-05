/**
 * Unit tests for the delta_tag disagreement signal in `quality diff` (M16,
 * 1.13.0).
 *
 * Positional finding ids are the source of truth for new/persisted/resolved.
 * Agents ALSO self-report a `delta_tag` per finding; instead of silently
 * ignoring that work, the diff cross-checks it against the deterministic
 * class and surfaces contradictions - but only when the diff pair matches
 * the baseline (`prior_report_id`) the agent actually tagged against, so a
 * user diffing an unrelated pair never sees phantom disagreements.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildQualityDiff } from "../../src/cli/quality/history.js";
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

describe("quality diff delta_tag disagreement signal", () => {
  it("flags contradictions when the diff pair matches the tag baseline", () => {
    const from = entry(FROM_ID, "2026-06-01", [finding("f-1", null)], null);
    // f-1 persists but the agent tagged it "new"; f-2 is new and correctly
    // tagged; both directions of the check are exercised.
    const to = entry(
      TO_ID,
      "2026-06-15",
      [finding("f-1", "new"), finding("f-2", "new")],
      FROM_ID,
    );
    const result = buildQualityDiff([to, from], {
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
    const from = entry(FROM_ID, "2026-06-01", [finding("f-1", null)], null);
    const to = entry(
      TO_ID,
      "2026-06-15",
      [finding("f-1", "persisted"), finding("f-2", "new")],
      FROM_ID,
    );
    const result = buildQualityDiff([to, from], {
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
    const from = entry(FROM_ID, "2026-06-01", [finding("f-1", null)], null);
    const to = entry(
      TO_ID,
      "2026-06-15",
      [finding("f-1", "new")],
      "2026-05-01-0900-claude-zzzzz",
    );
    const result = buildQualityDiff([to, from], {
      agent: "claude",
      pair: `${FROM_ID}:${TO_ID}`,
    });
    assert.ok(result.ok, !result.ok ? result.error : "");
    assert.deepEqual(result.diff.deltaTagDisagreements, []);
  });
});
