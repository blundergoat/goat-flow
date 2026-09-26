/**
 * Keeps terminal and bidirectional controls out of saved quality-report text that later reaches a terminal or prompt.
 * `quality history` and `quality diff` print file paths and finding summaries; the next `quality prompt` repeats refuted-candidate prose.
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { parseQualityReport } from "../../src/cli/quality/schema.js";
import { makeCurrentQualityReport } from "../fixtures/quality-report.js";

const CONTROL_ERROR =
  "must not contain terminal or bidirectional control characters";
const SINGLE_LINE_ERROR = "must be a single-line string";

/** Named controls: a newline forges an output line, ESC starts a terminal sequence, and the rest reorder or hide text. */
const CONTROLS = [
  { name: "newline", codePoint: 0x0a },
  { name: "escape", codePoint: 0x1b },
  { name: "next-line C1 control", codePoint: 0x85 },
  { name: "right-to-left override", codePoint: 0x202e },
  { name: "left-to-right isolate", codePoint: 0x2066 },
] as const;

const IMPROVEMENT = {
  category: "maintenance",
  summary: "Validate recommendation file paths",
  action: "Reject control characters before saving the path.",
  evidence: "quality history prints the file on the evidence line.",
  file: "src/cli/quality/schema-assessment.ts",
};

const REFUTED_CANDIDATE = {
  claim: "The parser accepts unsupported report keys",
  why_excluded: "Closed-schema validation rejects the extra key.",
  file: "src/cli/quality/schema-parser.ts",
  line: null,
  evidence_quality: "OBSERVED",
  evidence_method: "static-analysis",
  evidence_summary:
    'The parser calls rejectUnknownKeys before saving (search: "rejectUnknownKeys").',
};

/**
 * Parse one current report with a single replaced section.
 *
 * @param section - report fields to replace; each supplies the rows under test
 * @returns the parser result the quality saver would act on
 */
function parseWith(section: Record<string, unknown>) {
  return parseQualityReport({
    ...makeCurrentQualityReport(resolve("quality-control-text-fixture")),
    ...section,
  });
}

/**
 * Replace one field of the fixture's only finding, leaving every other field valid so the parser fails on that field alone.
 *
 * @param field - finding field to replace
 * @param replacementText - text under test for that field
 * @returns a one-row findings array holding the adjusted finding
 */
function findingWith(field: "file" | "summary", replacementText: string) {
  const [finding] = makeCurrentQualityReport(
    resolve("quality-control-text-fixture"),
  ).findings;
  return [{ ...finding, [field]: replacementText }];
}

describe("quality report control text", () => {
  for (const { name, codePoint } of CONTROLS) {
    const control = String.fromCodePoint(codePoint);

    it(`rejects a ${name} in file paths that history and diff print`, () => {
      assert.deepEqual(
        parseWith({
          improvements: [{ ...IMPROVEMENT, file: `src/a.ts${control}` }],
        }),
        {
          ok: false,
          error: `report.improvements[0].file ${SINGLE_LINE_ERROR}`,
        },
      );
      assert.deepEqual(
        parseWith({ findings: findingWith("file", `src/a.ts${control}`) }),
        {
          ok: false,
          error: `findings[0].file ${SINGLE_LINE_ERROR}`,
        },
      );
      assert.deepEqual(
        parseWith({
          refuted_candidates: [
            { ...REFUTED_CANDIDATE, file: `src/a.ts${control}` },
          ],
        }),
        { ok: false, error: `refuted_candidates[0].file ${SINGLE_LINE_ERROR}` },
      );
    });
  }

  // Line breaks are permitted prose in these fields, so only the non-newline controls are rejected.
  for (const { name, codePoint } of CONTROLS.filter(
    (entry) => entry.codePoint !== 0x0a,
  )) {
    const control = String.fromCodePoint(codePoint);

    it(`rejects a ${name} in prose that diff or the next prompt repeats`, () => {
      assert.deepEqual(
        parseWith({ findings: findingWith("summary", `Summary${control}x`) }),
        {
          ok: false,
          error: `findings[0].summary ${CONTROL_ERROR}`,
        },
      );
      assert.deepEqual(
        parseWith({
          refuted_candidates: [
            { ...REFUTED_CANDIDATE, claim: `Claim${control}x` },
          ],
        }),
        { ok: false, error: `refuted_candidates[0].claim ${CONTROL_ERROR}` },
      );
      assert.deepEqual(
        parseWith({
          refuted_candidates: [
            { ...REFUTED_CANDIDATE, why_excluded: `Reason${control}x` },
          ],
        }),
        {
          ok: false,
          error: `refuted_candidates[0].why_excluded ${CONTROL_ERROR}`,
        },
      );
    });
  }

  it("accepts clean paths and multi-line prose that renderers flatten", () => {
    const parsed = parseWith({
      findings: findingWith("summary", "First line\nsecond line"),
      refuted_candidates: [
        {
          ...REFUTED_CANDIDATE,
          claim: "First line\nsecond line",
          why_excluded: "Tab\tseparated",
        },
      ],
      improvements: [IMPROVEMENT],
    });
    assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.error);
  });
});
