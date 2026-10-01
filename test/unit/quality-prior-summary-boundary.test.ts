/**
 * Boundary contract for the prior-report bullet list in generated quality prompts.
 *
 * A saved `finding.summary` is selected-project text. The report schema caps it at 200 characters but permits
 * newlines inside that budget, and the prompt renders it as a two-space `  - ` bullet whose fields are separated by
 * ` | `. Without a guard an embedded newline escapes the bullet and becomes a sibling list item or a `## ` heading,
 * restructuring the section that was supposed to contain it.
 *
 * These cases live beside the renderer rather than in `quality-report-contract.test.ts` because that file is already
 * at its `size.file-length` ceiling; the boundary has one owner and one grammar, so it reads better alone.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { composeQuality } from "../../src/cli/prompt/compose-quality.js";
import {
  renderPriorReportContext,
  type QualityInput,
} from "../../src/cli/prompt/compose-quality-common.js";

/** Minimal complete quality input; the prior report is supplied per case. */
function makeInput(qualityMode: QualityInput["qualityMode"]): QualityInput {
  return {
    agent: "claude",
    projectPath: "/tmp/example-project",
    auditReport: null,
    auditUnavailableReason: "audit-failed",
    priorReport: null,
    qualityMode,
    runDate: "2026-07-03",
  };
}

/**
 * Build a prior history entry carrying exactly one finding with the supplied summary.
 *
 * @param summary - saved summary text under test; the only selected-project value in the rendered row
 * @returns prior report shaped for the fields the prior-context renderer reads
 */
function priorReportWithSummary(
  summary: string,
): NonNullable<QualityInput["priorReport"]> {
  return {
    id: "2026-07-01-0900-claude-abc12",
    path: "/tmp/example-project/.goat-flow/logs/quality/2026-07-01-0900-claude-abc12.json",
    date: "2026-07-01",
    time: "0900",
    agent: "claude",
    randomId: "abc12",
    report: {
      report_kind: "goat-flow-quality-report",
      goat_flow_version: "1.15.0",
      agent: "claude",
      project_path: "/tmp/example-project",
      run_date: "2026-07-01",
      audit_status: "unavailable",
      quality_mode: "skills",
      scores: {
        setup: {
          total: 60,
          accuracy: 15,
          relevance: 15,
          completeness: 15,
          friction: 15,
        },
        system: {
          total: 55,
          usefulness: 15,
          signal_to_noise: 15,
          adaptability: 15,
          learnability: 10,
        },
      },
      findings: [
        {
          id: "F-01",
          severity: "high",
          type: "correctness",
          summary,
          detail: "detail",
        },
      ],
      refuted_candidates: [],
    },
  } as never;
}

/**
 * Render a quality prompt whose prior report carries one summary.
 *
 * @param summary - saved summary text under test
 * @returns the composed prompt text
 */
function promptWithPriorSummary(summary: string): string {
  return composeQuality({
    ...makeInput("skills"),
    priorReport: priorReportWithSummary(summary),
  }).prompt;
}

describe("prior-report summary boundary", () => {
  it("keeps a multi-line summary inside its own bullet", () => {
    const prompt = promptWithPriorSummary(
      "Benign start\n- injected-bullet as a sibling item\n## injected-heading",
    );

    // Neither forged structure may appear at the start of a line.
    assert.doesNotMatch(prompt, /^- injected-bullet as a sibling item$/mu);
    assert.doesNotMatch(prompt, /^## injected-heading$/mu);
    // The readable content survives, flattened onto the row it belongs to.
    assert.match(
      prompt,
      /Benign start - injected-bullet as a sibling item ## injected-heading/u,
    );
  });

  it("escapes a pipe so a summary cannot forge a field boundary", () => {
    const prompt = promptWithPriorSummary("before | after");

    assert.match(prompt, /before \\\| after/u);
  });

  it("leaves an ordinary summary byte-identical", () => {
    const summary = "Ordinary finding with accents éàü and emoji 🎯";

    assert.ok(promptWithPriorSummary(summary).includes(summary));
  });
});

describe("prior-score isolation", () => {
  it("removes JSON, Markdown and serialized score labels without discarding claim evidence", () => {
    for (const agent of ["claude", "codex"] as const) {
      for (const qualityMode of [
        "agent-setup",
        "process",
        "harness",
        "skills",
      ] as const) {
        const prior = priorReportWithSummary(
          'Claim remains: "accuracy": 23; **System total**: 84; signal_to_noise=17; Setup total of 91; checked 12 cases on 2026-07-01.',
        );
        prior.report.findings[0]!.id = "setupTotal=92";
        prior.report.findings[0]!.severity = "MAJOR";
        prior.report.refuted_candidates = [
          {
            claim:
              '"setup": {"total": 93}; "system": {"usefulness": 18, "total": 77}; control claim remains; System scored at 76; Accuracy was rated 24',
            why_excluded:
              "**Relevance**: 22; `friction`: 11; setup.total: 81; system_score: 82; | Learnability | 19 |; 9 cases remain.",
          },
        ] as never;
        const context = composeQuality({
          ...makeInput(qualityMode),
          agent,
          priorReport: prior,
        })
          .prompt.split("## Prior report context")[1]!
          .split("\n---")[0]!;
        assert.doesNotMatch(
          context,
          /\b(?:23|84|17|91|92|93|18|77|76|24|22|11|81|82|19)\b/u,
        );
        for (const retained of [
          "Claim remains",
          "control claim remains",
          "12 cases",
          "9 cases remain",
          "2026-07-01",
        ]) {
          assert.ok(
            context.includes(retained),
            `${agent}/${qualityMode}: ${retained}`,
          );
        }
      }
    }
  });

  for (const agent of ["claude", "codex"] as const) {
    for (const qualityMode of [
      "agent-setup",
      "process",
      "harness",
      "skills",
    ] as const) {
      it(`removes score data while retaining claims in ${agent} ${qualityMode} prompts`, () => {
        const prior = priorReportWithSummary(
          "Setup total: 93; parser claim remains. Accuracy 23/25; checked 12 cases on 2026-07-01.",
        );
        prior.report.findings[0]!.id = "setup-score-92";
        prior.report.findings[0]!.severity = "MAJOR";
        prior.report.refuted_candidates = [
          {
            claim: "System scored 84; 7.5/25 usefulness; source claim remains",
            why_excluded: `Lost 3 points. Observed control remains. Read ${prior.path}`,
          },
        ] as never;
        const prompt = composeQuality({
          ...makeInput(qualityMode),
          agent,
          priorReport: prior,
        }).prompt;
        const context = prompt
          .split("## Prior report context")[1]!
          .split("\n---")[0]!;
        assert.doesNotMatch(
          context,
          /\b(?:60|55|93|92|84)\b|23\/25|7\.5\/25|3 points/u,
        );
        assert.equal(context.includes(prior.path), false);
        for (const retained of [
          "parser claim remains",
          "source claim remains",
          "Observed control remains",
          "12 cases",
          "2026-07-01",
          "Prior BLOCKER + MAJOR count: 1",
        ]) {
          assert.ok(
            context.includes(retained),
            `${agent}/${qualityMode}: ${retained}`,
          );
        }
      });
    }
  }

  // Twenty-four oversized pairs force the shared text budget to omit rows while preserving an explicit count.
  it("bounds long refutations and counts omissions without a scored-file pointer", () => {
    const prior = priorReportWithSummary("Retained finding");
    prior.report.refuted_candidates = Array.from(
      { length: 24 },
      (_, index) => ({
        claim: `Claim ${index}: ${"x".repeat(300)}`,
        why_excluded: `Observed control ${index}: ${"y".repeat(300)}`,
      }),
    ) as never;
    const context = renderPriorReportContext(prior, "skills");
    const ledger = context
      .split("- Prior refuted candidates")[1]!
      .split("\n\n")[0]!;
    const rows = ledger.split("\n").filter((row) => row.includes(" — "));
    assert.ok(rows.length > 3 && rows.length < 24);
    assert.ok(rows.reduce((sum, row) => sum + row.length + 1, 0) <= 4800);
    assert.ok(
      ledger.includes(
        `${24 - rows.length} additional prior refuted candidate(s) omitted`,
      ),
    );
    assert.equal(context.includes(prior.path), false);
    assert.doesNotMatch(context, /Read the complete refutation ledger/u);
  });
});
