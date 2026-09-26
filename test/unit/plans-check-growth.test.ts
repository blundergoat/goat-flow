/**
 * How the checker reports work added after a forecast. Registered forecast revisions are the only trusted
 * growth source; a checklist that merely left its basis is reported without a direction.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderCalibrationSummary } from "../../src/cli/plans-check-summary.js";
import { parseMilestoneMarkdown } from "../../src/cli/plans-export.js";
import {
  eligibleWorkUnitSampleBody,
  registeredHistoryFixture,
} from "./plans-check.helpers.js";

type ParsedMilestone = ReturnType<typeof parseMilestoneMarkdown>;

/** The real parser supplies a finished milestone with one valid registered original of three units. */
function parseRegistered(sourceFile: string): ParsedMilestone {
  return parseMilestoneMarkdown(
    registeredHistoryFixture(100, 540).body,
    sourceFile,
  );
}

/** Append one remaining-work revision per list; each list names the item IDs that revision registered as added. */
function withRegisteredAdditions(
  record: ParsedMilestone,
  additions: string[][],
): ParsedMilestone {
  assert.ok(record.forecastContext?.document);
  const document = structuredClone(record.forecastContext.document);
  for (const [index, added] of additions.entries()) {
    const previous = document.records.at(-1);
    assert.ok(previous);
    document.records.push({
      ...structuredClone(previous),
      id: `F${index + 2}`,
      predecessorId: previous.id,
      scopeKind: "remaining",
      scopeDelta: { added, removed: [] },
    });
  }
  return {
    ...record,
    forecastContext: { ...record.forecastContext, document },
  };
}

/** Keep only the growth report, so each case states the whole line an author would read. */
function growthLines(records: ParsedMilestone[]): string[] {
  return renderCalibrationSummary(records).filter((line) =>
    line.startsWith("unit growth:"),
  );
}

describe("plans check: work added after forecasts", () => {
  it("excludes semantically invalid revisions through the real Markdown parser", () => {
    const fixture = registeredHistoryFixture(100, 540);
    const revision = {
      ...structuredClone(fixture.forecast),
      id: "F2",
      predecessorId: "F1",
      scopeDelta: { added: ["phantom"], removed: [] },
    };
    const body = fixture.body.replace(
      JSON.stringify({ schemaVersion: 1, records: [fixture.forecast] }),
      JSON.stringify({
        schemaVersion: 1,
        records: [fixture.forecast, revision],
      }),
    );
    const parsed = parseMilestoneMarkdown(body, "M01-work.md");
    assert.equal(parsed.forecastContext?.method, null);
    assert.match(parsed.warnings.join("\n"), /scopeDelta must match/u);
    assert.deepEqual(growthLines([parsed]), []);
  });
  it("counts each registered added item once per finished milestone", () => {
    const grown = withRegisteredAdditions(parseRegistered("M01-work.md"), [
      ["T2"],
      ["T3", "T2"],
    ]);
    assert.ok(grown.effort?.forecastBasis);
    // A milestone that registered its revisions is explained, even when its checklist no longer matches its basis.
    const grownWithStaleBasis: ParsedMilestone = {
      ...grown,
      effort: {
        ...grown.effort,
        forecastBasis: { ...grown.effort.forecastBasis, agentWorkUnits: 9 },
      },
    };
    const steady = parseRegistered("M02-work.md");
    const unfinished: ParsedMilestone = {
      ...withRegisteredAdditions(parseRegistered("M03-work.md"), [["T9"]]),
      status: "in-progress",
    };
    assert.deepEqual(growthLines([grownWithStaleBasis, steady, unfinished]), [
      "unit growth: 1 of 2 finished milestones registered added work - 6 units at issue, 8 after additions (+33.3%, unregistered additions not counted)",
    ]);
  });

  it("reads saved records under either forecast method and ignores rejected metadata", () => {
    const grown = withRegisteredAdditions(parseRegistered("M01-work.md"), [
      ["T2"],
    ]);
    assert.ok(grown.forecastContext);
    // Records may be saved while the method stays legacy; the parser nulls the method when it rejects the metadata.
    const legacy: ParsedMilestone = {
      ...grown,
      forecastContext: { ...grown.forecastContext, method: "legacy" },
    };
    const rejected: ParsedMilestone = {
      ...grown,
      forecastContext: { ...grown.forecastContext, method: null },
    };
    assert.deepEqual(growthLines([legacy]), [
      "unit growth: 1 of 1 finished milestones registered added work - 3 units at issue, 4 after additions (+33.3%, unregistered additions not counted)",
    ]);
    assert.deepEqual(growthLines([rejected]), []);
  });

  it("reports a finished milestone whose count left its basis without claiming a direction", () => {
    const stale = parseMilestoneMarkdown(
      eligibleWorkUnitSampleBody(540).replace(
        "3 agent work units;",
        "4 agent work units;",
      ),
      "M01-sample.md",
    );
    const lines = growthLines([stale, parseRegistered("M02-work.md")]);
    assert.deepEqual(lines, [
      "unit growth: 1 finished milestone counts differently from its forecast basis with no registered revision (direction unknown)",
    ]);
    assert.doesNotMatch(lines.join("\n"), /added|grew|[+]\d/u);
  });

  it("stays quiet when no finished milestone registered additions or left its basis", () => {
    assert.deepEqual(
      growthLines([
        parseRegistered("M01-work.md"),
        parseMilestoneMarkdown(
          eligibleWorkUnitSampleBody(540),
          "M02-sample.md",
        ),
      ]),
      [],
    );
  });
});
