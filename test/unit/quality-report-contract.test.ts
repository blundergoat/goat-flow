/**
 * Cross-surface quality-prompt contract for CLI and dashboard users.
 * It keeps report fields, audit evidence limits, and validation instructions consistent across every mode.
 * Use when prompt composition changes so a report launched from one screen is not weaker than another.
 * The dashboard mirror stays source-pinned because its classic script cannot import the CLI builder.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { composeQuality } from "../../src/cli/prompt/compose-quality.js";
import type { QualityInput } from "../../src/cli/prompt/compose-quality-common.js";
import {
  QUALITY_EVIDENCE_METHODS,
  QUALITY_FINDING_SEVERITIES,
  QUALITY_FINDING_TYPES,
  QUALITY_GROUNDING_STATUSES,
  QUALITY_SCORE_CONFIDENCES,
  QUALITY_WORKTREE_STATES,
} from "../../src/cli/quality/schema-types.js";

/** Top-level JSON keys every contract render must show in its body shape. */
const REQUIRED_TOP_LEVEL_FIELDS = [
  '"report_kind"',
  '"goat_flow_version"',
  '"agent"',
  '"project_path"',
  '"run_date"',
  '"audit_status"',
  '"scope"',
  '"rubric_version"',
  '"quality_mode"',
  '"prior_report_id"',
  '"assessment_context"',
  '"scores"',
  '"findings"',
] as const;

/** Per-finding fields every contract render must require or demonstrate. */
const REQUIRED_FINDING_FIELDS = [
  "evidence_quality",
  "evidence_method",
  "delta_tag",
] as const;

const PROJECT_VALIDATION_LIMIT =
  "This audit inspected verification guidance and hook configuration; it did not execute project build, test, lint, typecheck, or format commands.";
const RECOVERY_RESUMABILITY_LIMIT =
  "Recovery storage is available, but this audit did not validate the current objective, completed work, last verification, next action, or end-to-end resumability.";
const RED_FLAGS_METRIC_LIMIT =
  "Instruction-file evidence-before-claims red-flags coverage is metric-only; gaps lower the Verification score but do not fail audit status.";
const AUDIT_STATUS_PRECEDENCE_RULE =
  "Set `audit_status` from this run's live grounding audit outcome (`pass` or `fail`); use `unavailable` only when no live audit completed this run.";
const HARNESS_SCORE_INTERPRETATION =
  "Harness scores describe deterministic check coverage; reconcile declared `limits` and accepted ADRs before proposing new gates or score changes.";
const SAVER_VERSION_CLASSIFICATION =
  "Executable version checks select a compatible report saver; they are not findings or score inputs.";
const PATH_SKEW_CLASSIFICATION = "do not report or score that PATH-only skew";
const VERSION_FINDING_AUTHORITY =
  "Raise version findings only when repository-owned declarations or managed target artifacts disagree.";
const FAST_CACHE_AUDIT_PLACEHOLDER =
  'The pre-filled `audit_status: "unavailable"` is a placeholder superseded by any live audit completed during this assessment.';
const ASSESSMENT_CONTEXT_GUIDANCE = [
  "project_revision",
  "working_tree_state",
  "grounding_status",
  "unverified_probes",
  "score_confidence",
  "does not change or cap the rubric scores",
] as const;
const REPOSITORY_ROOT = resolve(import.meta.dirname, "..", "..");
const QUALITY_MODES = ["agent-setup", "process", "harness", "skills"] as const;
const FOCUSED_QUALITY_MODES = ["process", "harness", "skills"] as const;
const STAGED_DRAFT_MODES = ["skills", "harness", "agent-setup"] as const;
/** Validity rubric shown only in the full agent-setup assessment. */
const AGENT_SETUP_ONLY_VALIDITY_GUIDANCE = [
  "Standards bind their audience",
  "Establish agent authorship or an agent-facing mechanism",
  "framework violates a standard that binds the surface being assessed",
  "A hot-path factual error is a claim an agent would act on and fail",
] as const;
/** Prior-claim warning shown only when a user supplied a same-mode report. */
const PRIOR_REPORT_REVALIDATION_GUIDANCE =
  "A prior finding is a claim to re-test, not a fact";
const DRIFT_EVIDENCE = [
  ".agents/skills/goat/SKILL.md",
  "installed dispatcher differs",
  "README.md:8 [removed-command-scan]",
  "documentation teaches a removed command",
] as const;
const FORBIDDEN_STAGED_DRAFT_TEXT = [
  "Use the bounded saver below",
  "**Persist through the bounded saver.**",
  "**Filename format:**",
  "The saver derives",
  ".goat-flow/logs/quality/<filename>.json",
] as const;

/** Dashboard-only safety guidance that must not leak into a user's bounded-saver prompt. */
const STAGED_DRAFT_SAFETY_GUIDANCE = [
  "exactly 32 lowercase hexadecimal characters",
  "collision avoidance",
  "not proof of randomness",
  "available read-only file or glob tool (not Bash)",
  "neither the draft path nor the receipt path below exists",
  "persist-skipped: collision-precheck-unavailable",
  "does not prove that a later receipt belongs to this draft",
  "If a session mode change blocks the staging write itself",
  "persist-skipped: <reason>",
] as const;

/** Extract the executable report-write block from a composed prompt. */
function extractReportWriteBlock(prompt: string): string {
  const selectionIndex = prompt.indexOf(
    "**Persist through the bounded saver.**",
  );
  assert.notEqual(selectionIndex, -1, "missing bounded-saver section");
  const fenceStart = prompt.indexOf("```bash\n", selectionIndex);
  assert.notEqual(fenceStart, -1, "missing report-write fence");
  const blockStart = fenceStart + "```bash\n".length;
  const blockEnd = prompt.indexOf("\n```", blockStart);
  assert.notEqual(blockEnd, -1, "unterminated report-write fence");
  return prompt.slice(blockStart, blockEnd);
}

/** Build the prompt input a user gets before any audit evidence is available. */
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
 * Build one saved report so each quality mode can exercise its prior-context branch.
 * Use when a user has history, while empty findings keep individual claims out of the fixture.
 *
 * @param qualityMode - mode whose prior history is loaded; never empty in the supported-mode matrix
 * @returns complete prior entry; empty findings means the prompt lists no individual prior claims
 */
function makePriorQualityReport(
  qualityMode: (typeof QUALITY_MODES)[number],
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
      quality_mode: qualityMode,
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
      findings: [],
    },
  };
}

/** Build one complete concern so prompt tests can vary only the evidence limits users need to see. */
function auditConcern(limits: string[] = []) {
  return {
    status: "pass" as const,
    score: 100,
    findings: [],
    limits,
    recommendations: [],
    howToFix: [],
    integrityPass: 1,
    integrityFail: 0,
    advisoryPass: 0,
    advisoryFail: 0,
    advisoryAcknowledged: 0,
    metrics: 0,
  };
}

/** Build the passing audit a user sees when structural scores need explicit evidence limits. */
function makeLimitedAuditReport(): NonNullable<QualityInput["auditReport"]> {
  const emptyScope = {
    status: "pass" as const,
    checks: [],
    failures: [],
    summary: {},
  };
  return {
    command: "audit",
    status: "pass",
    target: "/tmp/example-project",
    harness: true,
    scopes: {
      setup: emptyScope,
      agent: emptyScope,
      harness: emptyScope,
    },
    concerns: {
      context: auditConcern(),
      constraints: auditConcern(),
      verification: auditConcern([
        PROJECT_VALIDATION_LIMIT,
        RED_FLAGS_METRIC_LIMIT,
      ]),
      recovery: auditConcern([RECOVERY_RESUMABILITY_LIMIT]),
      feedback_loop: auditConcern(),
    },
    enforcement: [],
    drift: null,
    content: null,
    overall: { status: "pass" },
  };
}

/** Assert a prompt carries every field needed to save and validate the user's quality report. */
function assertCarriesContract(surface: string, text: string): void {
  // Every top-level field the schema parser requires must appear in the shape.
  for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
    assert.ok(text.includes(field), `${surface}: missing ${field}`);
  }
  // Every per-finding requirement must be spelled out.
  for (const field of REQUIRED_FINDING_FIELDS) {
    assert.ok(
      text.includes(field),
      `${surface}: missing finding field ${field}`,
    );
  }
  for (const guidance of ASSESSMENT_CONTEXT_GUIDANCE) {
    assert.ok(
      text.includes(guidance),
      `${surface}: missing assessment-context guidance ${guidance}`,
    );
  }
  // Allowed enum values must match the parser's lists verbatim.
  for (const candidate of [
    ...QUALITY_FINDING_TYPES,
    ...QUALITY_FINDING_SEVERITIES,
    ...QUALITY_EVIDENCE_METHODS,
    ...QUALITY_WORKTREE_STATES,
    ...QUALITY_GROUNDING_STATUSES,
    ...QUALITY_SCORE_CONFIDENCES,
  ]) {
    assert.ok(
      text.includes(candidate),
      `${surface}: missing enum value ${candidate}`,
    );
  }
  // One bounded saver owns redaction, validation, destination choice, and existence proof.
  assert.ok(
    text.includes("quality save"),
    `${surface}: missing bounded quality saver`,
  );
  assert.ok(
    text.includes("OK "),
    `${surface}: missing successful-save receipt`,
  );
}

/** Assert a focused prompt and its summary preserve every observed audit failure. */
function assertCarriesAuditEvidence(
  surface: string,
  payload: ReturnType<typeof composeQuality>,
): void {
  for (const evidence of DRIFT_EVIDENCE) {
    assert.ok(
      payload.prompt.includes(evidence),
      `${surface}: prompt omitted ${evidence}`,
    );
    assert.ok(
      payload.auditSummary.includes(evidence),
      `${surface}: auditSummary omitted ${evidence}`,
    );
  }
}

/**
 * Verify the dashboard-only save guidance a reviewer gets after launch.
 * Use for staged quality modes so collision or mode failures stay honest before server persistence.
 *
 * @param surface - assertion label shown on failure; empty would only hide which quality mode failed
 * @param prompt - rendered reviewer instructions; empty makes every required guidance assertion fail
 * @returns nothing; an assertion failure stops the test before users receive incomplete save guidance
 */
function assertStagedDraftContract(surface: string, prompt: string): void {
  assert.ok(
    prompt.includes("**Persist through the dashboard.**"),
    `${surface}: missing dashboard persistence section`,
  );
  assert.ok(prompt.includes(SAVER_VERSION_CLASSIFICATION), surface);
  assert.ok(prompt.includes(PATH_SKEW_CLASSIFICATION), surface);
  assert.ok(prompt.includes(VERSION_FINDING_AUTHORITY), surface);
  assert.ok(
    prompt.includes(
      "/tmp/example-project/.goat-flow/logs/quality/staging/goat-quality-draft-claude-<nonce>.json",
    ),
    `${surface}: missing staged draft path`,
  );
  assert.ok(
    prompt.includes(
      "/tmp/example-project/.goat-flow/logs/quality/staging/goat-quality-result-claude-<nonce>.json",
    ),
    `${surface}: missing receipt path`,
  );
  assert.ok(
    prompt.includes("persist-skipped: capture-unavailable"),
    `${surface}: missing capture-unavailable sentinel`,
  );
  // Every staged-only safety rule must reach the reviewer before they try to save the report.
  for (const safetyGuidance of STAGED_DRAFT_SAFETY_GUIDANCE) {
    assert.ok(
      prompt.includes(safetyGuidance),
      `${surface}: missing staged-draft safety guidance: ${safetyGuidance}`,
    );
  }
  // An enforced dashboard session cannot run Bash persistence, so no bounded-saver path may survive.
  assert.equal(
    prompt.includes("quality save"),
    false,
    `${surface}: staged variant still mentions the Bash saver`,
  );
  assert.equal(
    prompt.includes("<<'JSON'"),
    false,
    `${surface}: staged variant still contains a heredoc`,
  );
  for (const forbidden of FORBIDDEN_STAGED_DRAFT_TEXT) {
    assert.equal(
      prompt.includes(forbidden),
      false,
      `${surface}: staged variant still contains ${forbidden}`,
    );
  }
}

describe("quality report contract: CLI surfaces", () => {
  it("agent-setup prompt carries the full contract", () => {
    const payload = composeQuality(makeInput("agent-setup"));
    assertCarriesContract("agent-setup", payload.prompt);
  });

  it("agent-setup prompt defines finding-validity and accuracy guardrails", () => {
    const prompt = composeQuality(makeInput("agent-setup")).prompt;
    for (const phrase of AGENT_SETUP_ONLY_VALIDITY_GUIDANCE) {
      assert.ok(
        prompt.includes(phrase),
        `missing finding-validity phrase: ${phrase}`,
      );
    }
    for (const severity of ["`BLOCKER`", "`MAJOR`", "`MINOR`"]) {
      assert.ok(
        prompt.includes(severity),
        `missing severity vocabulary: ${severity}`,
      );
    }
  });

  it("names framework decisions without consumer-relative ADR paths", () => {
    const prompt = composeQuality(makeInput("agent-setup")).prompt;

    assert.match(
      prompt,
      /ADR-021, "goat-critique is a core feature, full delegated mode only"/u,
    );
    assert.doesNotMatch(prompt, /\.goat-flow\/learning-loop\/decisions\/ADR-/u);
  });

  // Reviewers with denied probes still receive an honest evidence path in every relevant mode.
  it("defines degraded grounding without weakening the skills fallback", () => {
    const agentSetupPrompt = composeQuality(makeInput("agent-setup")).prompt;
    const processPrompt = composeQuality(makeInput("process")).prompt;
    const harnessPrompt = composeQuality(makeInput("harness")).prompt;
    const skillsPrompt = composeQuality(makeInput("skills")).prompt;
    const focusedDenialRule =
      "record the literal denial or unavailability, do not retry it or work around the profile, and never infer a result";

    assert.ok(agentSetupPrompt.includes("Degraded grounding protocol"));
    assert.ok(agentSetupPrompt.includes('evidence_method: "static-analysis"'));
    assert.ok(
      agentSetupPrompt.includes(
        "Option A: trace how the route map would handle 3 representative reporting-only requests. Option B: send those requests through the live runtime when available.",
      ),
    );
    assert.ok(processPrompt.includes(focusedDenialRule));
    assert.ok(harnessPrompt.includes(focusedDenialRule));
    assert.ok(processPrompt.includes('evidence_method: "static-analysis"'));
    assert.ok(harnessPrompt.includes('evidence_method: "static-analysis"'));
    assert.ok(
      skillsPrompt.includes(
        "Method rule: prefer live skill invocation only when the runner supports it safely.",
      ),
    );
    assert.ok(
      skillsPrompt.includes(
        "never let a quality probe edit the assessed checkout",
      ),
    );
    assert.ok(
      skillsPrompt.includes("file-grounded protocol run against SKILL.md"),
    );
    assert.equal(skillsPrompt.includes(focusedDenialRule), false);
  });

  it("skills mode names all eight skills and requires eight sections", () => {
    const skillsPrompt = composeQuality(makeInput("skills")).prompt;
    const agentSetupPrompt = composeQuality(makeInput("agent-setup")).prompt;
    const canonicalSkills =
      "/goat,/goat-debug,/goat-plan,/goat-review,/goat-critique,/goat-security,/goat-qa,/goat-clarity".split(
        ",",
      );

    assert.match(skillsPrompt, /Assess all eight goat-flow skills/u);
    assert.match(skillsPrompt, /After the eight sections/u);
    for (const skillName of canonicalSkills) {
      assert.ok(skillsPrompt.includes(skillName), `missing ${skillName}`);
    }
    assert.equal(
      agentSetupPrompt.match(/^\d+\. \*\*`\/goat[^`]*`\*\*/gmu)?.length,
      canonicalSkills.length,
    );
  });

  it("focused (harness) prompt carries the full contract", () => {
    const payload = composeQuality(makeInput("harness"));
    assertCarriesContract("focused/harness", payload.prompt);
  });

  it("focused (process) prompt carries the full contract", () => {
    const payload = composeQuality(makeInput("process"));
    assertCarriesContract("focused/process", payload.prompt);
  });

  for (const qualityMode of QUALITY_MODES) {
    it(`defines live audit precedence and narrow harness-score interpretation in ${qualityMode} mode`, () => {
      const prompt = composeQuality(makeInput(qualityMode)).prompt;
      assert.ok(prompt.includes(AUDIT_STATUS_PRECEDENCE_RULE), qualityMode);
      assert.ok(prompt.includes(HARNESS_SCORE_INTERPRETATION), qualityMode);
    });

    it(`classifies pre-release PATH skew as saver compatibility in ${qualityMode} mode`, () => {
      const prompt = composeQuality(makeInput(qualityMode)).prompt;
      assert.ok(prompt.includes(SAVER_VERSION_CLASSIFICATION), qualityMode);
      assert.ok(prompt.includes(PATH_SKEW_CLASSIFICATION), qualityMode);
      assert.ok(prompt.includes(VERSION_FINDING_AUTHORITY), qualityMode);
    });
  }

  for (const qualityMode of QUALITY_MODES) {
    it(`redacts completed ${qualityMode} JSON before it reaches disk`, () => {
      const prompt = composeQuality(makeInput(qualityMode)).prompt;
      const writeBlock = extractReportWriteBlock(prompt);
      assert.match(
        writeBlock,
        /^goat-flow quality save '\/tmp\/example-project' <<'JSON'$/mu,
        `${qualityMode}: missing exact bounded-saver heredoc`,
      );
      assert.match(
        writeBlock,
        /<insert the complete report object as one JSON line here>/u,
        `${qualityMode}: missing in-memory report placeholder`,
      );
      assert.match(
        prompt,
        /redacts and validates stdin in memory before choosing the report filename/u,
        `${qualityMode}: missing raw-draft prohibition`,
      );
      assert.doesNotMatch(
        writeBlock,
        /--output|\$FILE|node --input-type=module -/u,
        `${qualityMode}: caller-controlled output or generic Node wrapper remains`,
      );
      assert.match(
        prompt,
        /node --import tsx src\/cli\/cli\.ts quality save '\/tmp\/example-project'/u,
        `${qualityMode}: missing framework source fallback`,
      );
    });
  }

  // Covers a realistic 60-field report through the real deny hook: writes it and expects it to pass.
  it("sends a realistic 60-field report block through the actual deny hook", () => {
    const prompt = composeQuality(makeInput("agent-setup")).prompt;
    const writeBlock = extractReportWriteBlock(prompt);
    const reportObject = JSON.stringify(
      Object.fromEntries(
        Array.from({ length: 60 }, (_, index) => [
          `field_${index}`,
          `value_${index}`,
        ]),
      ),
    );
    const realisticBlock = writeBlock.replace(
      "<insert the complete report object as one JSON line here>",
      reportObject,
    );
    const hookResult = spawnSync(
      "bash",
      [".goat-flow/hooks/deny-dangerous.sh", "--check", realisticBlock],
      {
        cwd: REPOSITORY_ROOT,
        encoding: "utf-8",
      },
    );

    assert.equal(hookResult.status, 0, hookResult.stderr || hookResult.stdout);
  });

  it("keeps compatibility selection outside the report body and names failure honestly", () => {
    const prompt = composeQuality(makeInput("agent-setup")).prompt;
    const writeBlock = extractReportWriteBlock(prompt);
    assert.match(prompt, /goat-flow --version/u);
    assert.match(prompt, /node --import tsx src\/cli\/cli\.ts --version/u);
    assert.match(prompt, /persist-skipped: redactor-unavailable/u);
    assert.doesNotMatch(writeBlock, /--version|quality validate|ls -la/u);
  });

  // A user choosing any Quality mode must receive the same deterministic evidence boundaries.
  for (const qualityMode of QUALITY_MODES) {
    it(`embeds live Verification and Recovery limits in ${qualityMode} prompt and summary`, () => {
      const auditReport = makeLimitedAuditReport();
      const payload = composeQuality({
        ...makeInput(qualityMode),
        auditReport,
      });
      assert.ok(
        payload.prompt.includes(PROJECT_VALIDATION_LIMIT),
        `${qualityMode}: prompt omitted Verification limit`,
      );
      assert.ok(
        payload.prompt.includes(RECOVERY_RESUMABILITY_LIMIT),
        `${qualityMode}: prompt omitted Recovery limit`,
      );
      assert.ok(
        payload.prompt.includes(RED_FLAGS_METRIC_LIMIT),
        `${qualityMode}: prompt omitted red-flags metric limit`,
      );
      assert.ok(
        payload.auditSummary.includes(PROJECT_VALIDATION_LIMIT),
        `${qualityMode}: auditSummary omitted Verification limit`,
      );
      assert.ok(
        payload.auditSummary.includes(RECOVERY_RESUMABILITY_LIMIT),
        `${qualityMode}: auditSummary omitted Recovery limit`,
      );
      assert.ok(
        payload.auditSummary.includes(RED_FLAGS_METRIC_LIMIT),
        `${qualityMode}: auditSummary omitted red-flags metric limit`,
      );
    });
  }

  // A fast dashboard launch without cached evidence must disclose the gap instead of inventing limits.
  for (const qualityMode of FOCUSED_QUALITY_MODES) {
    it(`keeps the ${qualityMode} cache-miss contract when no audit report is available`, () => {
      const payload = composeQuality({
        ...makeInput(qualityMode),
        auditUnavailableReason: "fast-cache-only",
      });
      assert.match(
        payload.prompt,
        /Audit: NOT LOADED \(FAST CACHE-ONLY MODE\)/,
      );
      assert.match(payload.auditSummary, /fast cache-only mode/);
      assert.match(
        payload.prompt,
        /Audit data not loaded \(fast cache-only mode/u,
      );
      assert.ok(
        payload.prompt.includes(FAST_CACHE_AUDIT_PLACEHOLDER),
        `${qualityMode}: missing fast-cache audit placeholder precedence`,
      );
      assert.equal(payload.prompt.includes(PROJECT_VALIDATION_LIMIT), false);
      assert.equal(payload.prompt.includes(RECOVERY_RESUMABILITY_LIMIT), false);
    });
  }

  for (const qualityMode of FOCUSED_QUALITY_MODES) {
    it(`embeds drift and content failures in ${qualityMode} prompts and summaries`, () => {
      const auditReport = makeLimitedAuditReport();
      auditReport.status = "fail";
      auditReport.overall.status = "fail";
      auditReport.drift = {
        status: "fail",
        checked: 12,
        findings: [
          {
            kind: "content",
            path: ".agents/skills/goat/SKILL.md",
            message: "installed dispatcher differs from its workflow source",
          },
        ],
      };
      auditReport.content = {
        status: "fail",
        warnings: 1,
        infos: 0,
        filesScanned: 4,
        findings: [
          {
            severity: "warning",
            rule: "removed-command-scan",
            path: "README.md",
            line: 8,
            message: "documentation teaches a removed command",
          },
        ],
      };
      const payload = composeQuality({
        ...makeInput(qualityMode),
        auditReport,
      });
      assertCarriesAuditEvidence(qualityMode, payload);
    });
  }

  it("prior-report runs re-test claims while fresh runs keep the no-prior contract", () => {
    const fresh = composeQuality(makeInput("agent-setup")).prompt;
    assert.match(fresh, /`delta_tag` must be `null` or omitted/);
    assert.ok(
      fresh.includes(
        "For the final JSON block in this run, omit `delta_tag` or set it to `null` for every finding.",
      ),
    );
    assert.equal(
      fresh.includes("materially matches a prior finding by type/file/line"),
      false,
    );
    // Minimal-but-complete history entry: the prior-context section reads
    // report.findings/scores/run_date, not just the id.
    const priorReport = makePriorQualityReport("agent-setup");
    const withPrior = composeQuality({
      ...makeInput("agent-setup"),
      priorReport,
    }).prompt;
    assert.match(withPrior, /`delta_tag` is REQUIRED on every current finding/);
    assert.match(withPrior, /2026-07-01-0900-claude-abc12/);
    assert.ok(
      withPrior.includes(
        "A prior finding is a claim to re-test, not a fact. Validate its premise",
      ),
    );
    assert.ok(withPrior.includes("a prior severity is not evidence"));
    assert.ok(
      withPrior.includes(
        "materially matches a prior finding by type/file/line",
      ),
    );
    assert.ok(
      withPrior.includes(
        "do not carry the unverified claim into the current findings array solely to keep it visible",
      ),
    );
    assert.ok(withPrior.includes("`What You Did Not Verify`"));
    assert.ok(withPrior.includes("literal denied or unavailable probe"));
    assert.ok(withPrior.includes("omission is not verified resolution"));
    assert.ok(
      withPrior.includes(
        "Do NOT emit `absent` in current findings - absence is derived later",
      ),
    );
    assert.ok(withPrior.includes("the diff's derived `absent` bucket"));
    assert.equal(withPrior.includes("derived `resolved`"), false);
    assert.ok(
      withPrior.includes("absent from the later report, not proven fixed"),
    );
    assert.equal(
      withPrior.includes(
        "For the final JSON block in this run, omit `delta_tag` or set it to `null` for every finding.",
      ),
      false,
    );
  });
});

describe("quality report contract: cross-variant boundaries", () => {
  // Focused users should not inherit the longer agent-setup validity rubric.
  for (const qualityMode of FOCUSED_QUALITY_MODES) {
    it(`keeps agent-setup-only validity guidance out of ${qualityMode} mode`, () => {
      const prompt = composeQuality(makeInput(qualityMode)).prompt;
      const leakedValidityGuidance = AGENT_SETUP_ONLY_VALIDITY_GUIDANCE.find(
        (guidance) => prompt.includes(guidance),
      );
      assert.equal(
        leakedValidityGuidance,
        undefined,
        `${qualityMode}: leaked ${leakedValidityGuidance}`,
      );
    });
  }

  // Every mode should switch prior-claim guidance only when the user has comparable history.
  for (const qualityMode of QUALITY_MODES) {
    it(`switches ${qualityMode} prior revalidation guidance with same-mode history`, () => {
      const promptWithoutPriorReport = composeQuality(
        makeInput(qualityMode),
      ).prompt;
      const promptWithPriorReport = composeQuality({
        ...makeInput(qualityMode),
        priorReport: makePriorQualityReport(qualityMode),
      }).prompt;

      assert.equal(
        promptWithoutPriorReport.includes(PRIOR_REPORT_REVALIDATION_GUIDANCE),
        false,
      );
      assert.ok(
        promptWithPriorReport.includes(PRIOR_REPORT_REVALIDATION_GUIDANCE),
        `${qualityMode}: missing prior-report revalidation guidance`,
      );
    });
  }
});

describe("quality report contract: staged-draft persistence variant", () => {
  for (const qualityMode of STAGED_DRAFT_MODES) {
    it(`replaces the ${qualityMode} bounded saver with the dashboard draft contract (ADR-044)`, () => {
      const prompt = composeQuality({
        ...makeInput(qualityMode),
        persistence: "staged-draft",
      }).prompt;
      const surface = `staged ${qualityMode}`;
      assertStagedDraftContract(surface, prompt);
    });
  }

  it("keeps the bounded saver as the default persistence contract", () => {
    const prompt = composeQuality(makeInput("skills")).prompt;
    assert.ok(prompt.includes("**Persist through the bounded saver.**"));
    assert.equal(prompt.includes("**Persist through the dashboard.**"), false);
  });

  // Each staged-only rule gets a named failure when it leaks into the bounded-saver experience.
  for (const safetyGuidance of STAGED_DRAFT_SAFETY_GUIDANCE) {
    it(`keeps bounded-saver prompts free of staged-only guidance: ${safetyGuidance}`, () => {
      const prompt = composeQuality(makeInput("skills")).prompt;
      assert.equal(prompt.includes(safetyGuidance), false, safetyGuidance);
    });
  }
});

describe("quality report contract: dashboard mirror", () => {
  const dashboardSource = readFileSync(
    fileURLToPath(
      new URL(
        "../../src/dashboard/dashboard-setup-quality.ts",
        import.meta.url,
      ),
    ),
    "utf-8",
  );

  it("dashboard prompt source mirrors the required fields and enums", () => {
    assertCarriesContract("dashboard", dashboardSource);
  });

  it("dashboard prompt source keeps pre-release PATH skew out of findings", () => {
    assert.ok(dashboardSource.includes(SAVER_VERSION_CLASSIFICATION));
    assert.ok(dashboardSource.includes(PATH_SKEW_CLASSIFICATION));
    assert.ok(dashboardSource.includes(VERSION_FINDING_AUTHORITY));
  });
});
