/**
 * Quality command tests - prompt generation, payload contract, audit embedding.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { parseCLIArgs } from "../../src/cli/cli.js";
import { composeQuality } from "../../src/cli/prompt/compose-quality.js";
import { runAudit } from "../../src/cli/audit/audit.js";
import { createFS } from "../../src/cli/facts/fs.js";
import type { QualityHistoryEntry } from "../../src/cli/quality/history.js";
import { parseQualityReport } from "../../src/cli/quality/schema.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const CLI_PATH = join(PROJECT_ROOT, "src", "cli", "cli.ts");
const TSX_LOADER_PATH = join(
  PROJECT_ROOT,
  "node_modules",
  "tsx",
  "dist",
  "loader.mjs",
);
const disposables: string[] = [];

after(() => {
  for (const dir of disposables) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-quality-command-"));
  mkdirSync(join(root, ".goat-flow"), { recursive: true });
  disposables.push(root);
  return root;
}

function runCLI(
  cwd: string,
  args: string[],
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--import", TSX_LOADER_PATH, CLI_PATH, ...args],
    {
      cwd,
      encoding: "utf-8",
      timeout: 20000,
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** Extract the first ```json fenced block from a prompt string.
 *  Returns the JSON body with the scope placeholder replaced by a valid
 *  value so the example parses through the strict schema. Any other
 *  pipe-separated placeholder in the example will cause parse to fail,
 *  which is the canary behaviour we want. */
function extractExampleJson(prompt: string): string {
  const match = prompt.match(/```json\n([\s\S]*?)\n```/);
  if (!match) throw new Error("no ```json fenced block found in prompt");
  return match[1].replace(
    '"scope": "framework-self | consumer"',
    '"scope": "framework-self"',
  );
}

// ---------------------------------------------------------------------------
// Test 1: quality without --agent exits with usage error
// ---------------------------------------------------------------------------
describe("quality requires --agent", () => {
  it("parses quality command without agent as null agent", () => {
    const parsed = parseCLIArgs(["quality", "."]);
    assert.equal(parsed.command, "quality");
    assert.equal(parsed.agent, null, "agent should be null when not provided");
    // The CLI handler checks for null agent and throws CLIError - tested at integration level
  });
});

// ---------------------------------------------------------------------------
// Test 2: quality --agent claude produces prompt output (not empty, not a score)
// ---------------------------------------------------------------------------
describe("quality produces prompt output", () => {
  it("generates non-empty prompt text without scores", () => {
    const result = composeQuality({
      agent: "claude",
      projectPath: "/tmp/test-project",
      auditReport: null,
    });

    assert.equal(result.command, "quality");
    assert.equal(result.agent, "claude");
    assert.ok(result.prompt.length > 100, "Prompt should be substantial");
    assert.ok(
      result.prompt.includes("# GOAT Flow Quality Assessment - Claude Code"),
      "Should have title with agent name",
    );
    // Must NOT contain percentage scores or grades
    assert.ok(
      !result.prompt.includes("Score: ") && !result.prompt.includes("Grade: "),
      "Prompt should not present itself as a score or verdict",
    );
  });
});

// ---------------------------------------------------------------------------
// Test 3: Generated prompt contains skill testing section and ratings request
// ---------------------------------------------------------------------------
describe("quality prompt content", () => {
  it("states the assessment is reporting-only", () => {
    const result = composeQuality({
      agent: "claude",
      projectPath: "/tmp/test-project",
      auditReport: null,
    });

    assert.ok(
      result.prompt.includes("REPORTING-ONLY ASSESSMENT MODE."),
      "Should explicitly mark assessment mode as reporting-only",
    );
    assert.ok(
      result.prompt.includes("Do not edit any tracked file."),
      "Should end with a strong do-not-edit instruction",
    );
    assert.ok(
      result.prompt.includes(".goat-flow/logs/quality/"),
      "Should instruct the agent to write its JSON report to the gitignored quality log path",
    );
    assert.ok(
      result.prompt.includes("Do NOT apply patches or implement fixes."),
      "Should forbid patches and implementation",
    );
    assert.ok(
      result.prompt.includes("tracked files"),
      "Should scope the restriction to tracked files (gitignored build output is allowed)",
    );
    assert.ok(
      result.prompt.includes("gitignored"),
      "Should explicitly carve out gitignored build directories as permitted writes",
    );
    assert.ok(
      result.prompt.includes("do not count as writes"),
      "Should say gitignored local workflow artifacts do not count as writes",
    );
    assert.ok(
      !result.prompt.includes("strict no-write"),
      "Should not revive a strict no-write vocabulary that misclassifies gitignored logs",
    );
    assert.ok(
      !result.prompt.includes("milestone task files"),
      "Should not ask assessment to create milestone task files",
    );
  });

  it("contains skill testing section", () => {
    const result = composeQuality({
      agent: "claude",
      projectPath: "/tmp/test-project",
      auditReport: null,
    });

    assert.ok(
      result.prompt.includes("Skill testing"),
      "Should contain skill testing section",
    );
    assert.ok(
      result.prompt.includes("/goat-debug"),
      "Should reference goat-debug skill",
    );
    assert.ok(
      result.prompt.includes("/goat-plan"),
      "Should reference goat-plan skill",
    );
    assert.ok(
      result.prompt.includes("/goat-review"),
      "Should reference goat-review skill",
    );
    assert.ok(
      result.prompt.includes("/goat-critique"),
      "Should reference goat-critique skill",
    );
    assert.ok(
      result.prompt.includes("/goat-security"),
      "Should reference goat-security skill",
    );
    assert.ok(
      result.prompt.includes("/goat-qa"),
      "Should reference goat-qa skill",
    );
    assert.ok(
      result.prompt.includes("bare `.goat-flow/tasks/<name>` path"),
      "Should keep goat-plan probe reporting-only without requiring task-file writes",
    );
  });

  it("uses generic legacy task-state wording without naming removed files", () => {
    const result = composeQuality({
      agent: "claude",
      projectPath: "/tmp/test-project",
      auditReport: null,
    });
    const removedLegacyNames = [
      "to" + "do.md",
      "han" + "doff.md",
      "han" + "doff-template.md",
    ];

    assert.ok(
      result.prompt.includes("removed legacy task-state surfaces"),
      "Should keep generic wording for stale-concept checks",
    );
    assert.ok(
      removedLegacyNames.every((name) => !result.prompt.includes(name)),
      "Should not mention the removed filenames in the live quality prompt",
    );
  });

  it("contains ratings request with sub-scores", () => {
    const result = composeQuality({
      agent: "claude",
      projectPath: "/tmp/test-project",
      auditReport: null,
    });

    assert.ok(
      result.prompt.includes("### Ratings"),
      "Should contain ratings section",
    );
    assert.ok(
      result.prompt.includes("Setup: __/100"),
      "Should request setup rating",
    );
    assert.ok(
      result.prompt.includes("System: __/100"),
      "Should request system rating",
    );
    assert.ok(
      result.prompt.includes("Accuracy __/25"),
      "Should have accuracy sub-score",
    );
    assert.ok(
      result.prompt.includes("Usefulness __/25"),
      "Should have usefulness sub-score",
    );
  });

  it("generates mode-specific skills prompts with a mode-aware JSON contract", () => {
    const result = composeQuality({
      agent: "claude",
      projectPath: "/tmp/test-project",
      auditReport: null,
      qualityMode: "skills",
      runDate: "2026-04-25",
    });

    assert.match(result.prompt, /Skill Suite Quality Assessment/);
    assert.match(result.prompt, /Assess all seven goat-flow skills/);
    assert.match(result.prompt, /"quality_mode": "skills"/);
    assert.match(
      result.prompt,
      /No prior same-agent skills quality report exists/,
    );
    const parsed = parseQualityReport(
      JSON.parse(extractExampleJson(result.prompt)),
    );
    assert.ok(
      parsed.ok,
      `skills-mode JSON example must parse: ${parsed.ok ? "" : parsed.error}`,
    );
  });

  it("defaults run_date from local calendar getters, not UTC ISO date", () => {
    const RealDate = Date;
    class FakeDate extends RealDate {
      constructor(value?: string | number | Date) {
        super(value ?? "2026-04-19T00:00:00.000Z");
      }

      override getFullYear(): number {
        return 2026;
      }

      override getMonth(): number {
        return 3;
      }

      override getDate(): number {
        return 18;
      }

      override toISOString(): string {
        return "2026-04-19T00:00:00.000Z";
      }

      static override now(): number {
        return new RealDate("2026-04-19T00:00:00.000Z").getTime();
      }
    }

    globalThis.Date = FakeDate as DateConstructor;
    try {
      const result = composeQuality({
        agent: "claude",
        projectPath: "/tmp/test-project",
        auditReport: null,
      });
      assert.ok(
        result.prompt.includes('"run_date": "2026-04-18"'),
        "Default run_date should use local calendar getters",
      );
      assert.ok(
        !result.prompt.includes('"run_date": "2026-04-19"'),
        "Default run_date should not fall back to UTC ISO day",
      );
    } finally {
      globalThis.Date = RealDate;
    }
  });

  it("includes prior-report context and json contract guidance when history exists", () => {
    const priorReport: QualityHistoryEntry = {
      id: "2026-04-15-1000-claude-bbbbb",
      path: "/tmp/test-project/.goat-flow/logs/quality/2026-04-15-1000-claude-bbbbb.json",
      date: "2026-04-15",
      time: "1000",
      agent: "claude",
      randomId: "bbbbb",
      report: {
        report_kind: "goat-flow-quality-report",
        goat_flow_version: "1.2.1",
        agent: "claude",
        project_path: "/tmp/test-project",
        run_date: "2026-04-15",
        audit_status: "pass",
        scores: {
          setup: {
            total: 80,
            accuracy: 20,
            relevance: 20,
            completeness: 20,
            friction: 20,
          },
          system: {
            total: 75,
            usefulness: 20,
            signal_to_noise: 20,
            adaptability: 20,
            learnability: 15,
          },
        },
        findings: [
          {
            id: "framework_flaw:src-cli-prompt-compose-quality-ts:600",
            type: "framework_flaw",
            severity: "BLOCKER",
            file: "src/cli/prompt/compose-quality.ts",
            line: 600,
            summary: "Prompt still asks for resolved findings",
            detail: "Resolved findings belong in diff output.",
            evidence_quality: "OBSERVED",
            delta_tag: "new",
          },
          {
            id: "skill_flaw:agents-skills-goat-critique-skill-md:131",
            type: "skill_flaw",
            severity: "MAJOR",
            file: ".agents/skills/goat-critique/SKILL.md",
            line: 131,
            summary:
              "goat-critique unconditionally persists critique snapshots with no strict no-write branch.",
            detail:
              "The finding treats gitignored critique logs as a write violation.",
            evidence_quality: "OBSERVED",
            delta_tag: "new",
          },
          {
            id: "framework_flaw:src-cli-prompt-compose-quality-ts:700",
            type: "framework_flaw",
            severity: "MAJOR",
            file: "src/cli/prompt/compose-quality.ts",
            line: 700,
            summary:
              "Tracked-file edit violates strict no-write assessment mode.",
            detail:
              "The agent modified src/cli/prompt/compose-quality.ts during reporting-only assessment.",
            evidence_quality: "OBSERVED",
            delta_tag: "new",
          },
        ],
      },
    };

    const result = composeQuality({
      agent: "claude",
      projectPath: "/tmp/test-project",
      auditReport: null,
      priorReport,
      runDate: "2026-04-18",
    });

    assert.ok(
      result.prompt.includes(
        "Latest same-agent report: `2026-04-15-1000-claude-bbbbb` (2026-04-15)",
      ),
      "Should surface prior-report identity and date",
    );
    assert.ok(
      result.prompt.includes("Omitted 1 prior local-artifact write finding(s)"),
      "Should not carry forward old gitignored-log write findings",
    );
    assert.ok(
      !result.prompt.includes("strict no-write"),
      "Should not leak stale strict no-write wording from prior reports into new prompts",
    );
    assert.ok(
      result.prompt.includes(
        "Tracked-file edit violates tracked-file write restriction assessment mode.",
      ),
      "Should keep real tracked-file write findings while neutralizing stale wording",
    );
    assert.ok(
      result.prompt.includes("Do NOT emit `resolved` in current findings"),
      "Should keep resolved in derived diff output",
    );
    assert.ok(
      result.prompt.includes(
        "Set top-level `prior_report_id` to `2026-04-15-1000-claude-bbbbb`",
      ),
      "Should make delta_tag baseline explicit",
    );
    assert.ok(
      result.prompt.includes(
        '`delta_tag` is REQUIRED on every current finding and must be either `"new"` or `"persisted"`.',
      ),
      "Should tighten the JSON contract when prior history exists",
    );
    assert.ok(
      result.prompt.includes('"report_kind": "goat-flow-quality-report"'),
      "Should embed the report_kind-driven JSON contract",
    );
    assert.ok(
      result.prompt.includes('"run_date": "2026-04-18"'),
      "Should freeze the requested run date in the JSON contract example",
    );
  });
});

// ---------------------------------------------------------------------------
// Test 4: Generated prompt contains audit summary when audit data is available
// ---------------------------------------------------------------------------
describe("quality with audit data", () => {
  it("includes audit summary in prompt", () => {
    const projectPath = resolve(import.meta.dirname, "..", "..");
    const fs = createFS(projectPath);
    const auditReport = runAudit(fs, projectPath, {
      agentFilter: "claude",
      harness: true,
    });

    const result = composeQuality({
      agent: "claude",
      projectPath,
      auditReport,
    });

    assert.equal(result.auditStatus, auditReport.status);
    assert.ok(
      result.prompt.includes("## Audit Summary"),
      "Should contain audit summary section",
    );
    assert.ok(result.prompt.includes("Setup"), "Should mention setup scope");
    assert.ok(
      result.prompt.includes("Agent Setup"),
      "Should mention agent setup scope",
    );
  });

  it("includes degraded context note when audit is unavailable", () => {
    const result = composeQuality({
      agent: "claude",
      projectPath: "/tmp/nonexistent",
      auditReport: null,
    });

    assert.equal(result.auditStatus, "unavailable");
    assert.ok(
      result.prompt.includes("UNAVAILABLE"),
      "Should indicate audit is unavailable",
    );
    assert.ok(
      result.prompt.includes("audit could not complete"),
      "Should include degraded context note",
    );
  });
});

// ---------------------------------------------------------------------------
// Test 4b: JSON example in the prompt parses through the strict schema
// (guards against drift between the example and schema.ts - the lesson from
// the 2026-04-20 copilot reports that flagged delta_tag:null as the wrong
// example value when prior history exists)
// ---------------------------------------------------------------------------
describe("quality prompt JSON example parses through schema", () => {
  it("no-prior-report example is schema-valid and uses delta_tag:null", () => {
    const result = composeQuality({
      agent: "claude",
      projectPath: "/tmp/test-project",
      auditReport: null,
      runDate: "2026-04-20",
    });
    const json = extractExampleJson(result.prompt);
    assert.match(
      json,
      /"delta_tag":\s*null/,
      "no-prior-report example must use delta_tag: null",
    );
    assert.match(
      json,
      /"prior_report_id":\s*null/,
      "no-prior-report example must include prior_report_id: null",
    );
    const parsed = parseQualityReport(JSON.parse(json));
    assert.ok(
      parsed.ok,
      `no-prior-report example must parse: ${parsed.ok ? "" : parsed.error}`,
    );
  });

  it("with-prior-report example is schema-valid and uses delta_tag:new", () => {
    const priorReport: QualityHistoryEntry = {
      id: "2026-04-15-1000-claude-bbbbb",
      path: "/tmp/test-project/.goat-flow/logs/quality/2026-04-15-1000-claude-bbbbb.json",
      date: "2026-04-15",
      time: "1000",
      agent: "claude",
      randomId: "bbbbb",
      report: {
        report_kind: "goat-flow-quality-report",
        goat_flow_version: "1.2.1",
        agent: "claude",
        project_path: "/tmp/test-project",
        run_date: "2026-04-15",
        audit_status: "pass",
        scores: {
          setup: {
            total: 80,
            accuracy: 20,
            relevance: 20,
            completeness: 20,
            friction: 20,
          },
          system: {
            total: 75,
            usefulness: 20,
            signal_to_noise: 20,
            adaptability: 20,
            learnability: 15,
          },
        },
        findings: [],
      },
    };
    const result = composeQuality({
      agent: "claude",
      projectPath: "/tmp/test-project",
      auditReport: null,
      priorReport,
      runDate: "2026-04-20",
    });
    const json = extractExampleJson(result.prompt);
    assert.match(
      json,
      /"delta_tag":\s*"new"/,
      'with-prior-report example must use delta_tag: "new"',
    );
    assert.match(
      json,
      /"prior_report_id":\s*"2026-04-15-1000-claude-bbbbb"/,
      "with-prior-report example must name the delta baseline",
    );
    const parsed = parseQualityReport(JSON.parse(json));
    assert.ok(
      parsed.ok,
      `with-prior-report example must parse: ${parsed.ok ? "" : parsed.error}`,
    );
  });

  it("JSON-escapes Windows project paths in the example block", () => {
    const result = composeQuality({
      agent: "claude",
      projectPath: "C:\\repo\\app",
      auditReport: null,
      runDate: "2026-04-20",
    });
    const json = extractExampleJson(result.prompt);
    assert.match(
      json,
      /"project_path": "C:\\\\repo\\\\app"/,
      "Windows backslashes should be escaped in the JSON example",
    );
    const parsed = JSON.parse(json) as { project_path: string };
    assert.equal(parsed.project_path, "C:\\repo\\app");
  });

  it("shell-quotes quality report paths in agent-setup prompt snippets", () => {
    const result = composeQuality({
      agent: "claude",
      projectPath: "/tmp/app $repo/`bad`/bob's app",
      auditReport: null,
      runDate: "2026-04-20",
    });

    assert.match(
      result.prompt,
      /QUALITY_DIR='\/tmp\/app \$repo\/`bad`\/bob'\\''s app\/\.goat-flow\/logs\/quality'/,
    );
    assert.doesNotMatch(result.prompt, /FILE="\/tmp\/app \$repo/);
  });

  it("shell-quotes quality report paths in focused prompt snippets", () => {
    const result = composeQuality({
      agent: "claude",
      projectPath: "/tmp/app $repo/`bad`/bob's app",
      auditReport: null,
      qualityMode: "skills",
      runDate: "2026-04-20",
    });

    assert.match(
      result.prompt,
      /QUALITY_DIR='\/tmp\/app \$repo\/`bad`\/bob'\\''s app\/\.goat-flow\/logs\/quality'/,
    );
    assert.doesNotMatch(result.prompt, /FILE="\/tmp\/app \$repo/);
  });
});

// ---------------------------------------------------------------------------
// Test 5: Machine-readable payload has correct shape
// ---------------------------------------------------------------------------
describe("quality payload contract", () => {
  it("has required fields", () => {
    const result = composeQuality({
      agent: "codex",
      projectPath: "/tmp/test-project",
      auditReport: null,
    });

    assert.equal(result.command, "quality");
    assert.equal(result.agent, "codex");
    assert.ok(
      ["pass", "fail", "unavailable"].includes(result.auditStatus),
      "auditStatus should be pass, fail, or unavailable",
    );
    assert.ok(
      typeof result.auditSummary === "string",
      "auditSummary should be string",
    );
    assert.ok(typeof result.prompt === "string", "prompt should be string");
    assert.ok(result.prompt.length > 0, "prompt should not be empty");
  });
});

describe("quality CLI output contract", () => {
  it("writes prompt output to --output instead of stdout", () => {
    const root = makeTempProject();
    const outputPath = join(root, ".goat-flow", "quality-prompt.txt");
    const result = runCLI(root, [
      "quality",
      ".",
      "--agent",
      "claude",
      "--output",
      outputPath,
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout,
      "",
      "Prompt output should be redirected to file",
    );
    assert.match(result.stderr, /Written to /);
    assert.match(
      readFileSync(outputPath, "utf-8"),
      /# GOAT Flow Quality Assessment - Claude Code/,
    );
  });

  it("writes JSON payload to --output instead of stdout", () => {
    const root = makeTempProject();
    const outputPath = join(root, ".goat-flow", "quality-payload.json");
    const result = runCLI(root, [
      "quality",
      ".",
      "--agent",
      "claude",
      "--format",
      "json",
      "--output",
      outputPath,
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "", "JSON output should be redirected to file");
    assert.match(result.stderr, /Written to /);
    const payload = JSON.parse(readFileSync(outputPath, "utf-8")) as {
      command: string;
      agent: string;
      prompt: string;
    };
    assert.equal(payload.command, "quality");
    assert.equal(payload.agent, "claude");
    assert.match(
      payload.prompt,
      /# GOAT Flow Quality Assessment - Claude Code/,
    );
  });

  it("threads --mode through prompt generation", () => {
    const root = makeTempProject();
    const result = runCLI(root, [
      "quality",
      ".",
      "--agent",
      "claude",
      "--mode",
      "harness",
      "--format",
      "json",
    ]);

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout) as {
      prompt: string;
    };
    assert.match(payload.prompt, /AI Harness Engineering Quality Assessment/);
    assert.match(payload.prompt, /"quality_mode": "harness"/);
  });
});
