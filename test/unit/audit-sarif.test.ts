/**
 * SARIF renderer tests for goat-flow audit output.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseCLIArgs } from "../../src/cli/cli.js";
import { renderAuditSarif } from "../../src/cli/audit/render.js";
import type {
  AuditReport,
  AuditScope,
  CheckImpact,
  CheckResult,
  ContentReport,
  DriftReport,
} from "../../src/cli/audit/types.js";
import type { CheckEvidence } from "../../src/cli/audit/provenance-types.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const CLI_PATH = join(PROJECT_ROOT, "src", "cli", "cli.ts");
const TSX_LOADER_URL = pathToFileURL(
  join(PROJECT_ROOT, "node_modules", "tsx", "dist", "loader.mjs"),
).href;
const SARIF_SCHEMA =
  "https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json";

const disposables: string[] = [];

after(() => {
  for (const dir of disposables) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const BASE_PROVENANCE: CheckEvidence = {
  source_type: "spec",
  source_urls: ["https://example.test/spec"],
  verified_on: "2026-05-17",
  normative_level: "MUST",
};

interface ParsedSarifLog {
  version: string;
  $schema: string;
  runs: Array<{
    tool: {
      driver: {
        name: string;
        informationUri: string;
        semanticVersion: string;
        rules: Array<{ id: string; properties?: { scope?: string } }>;
      };
    };
    results: Array<{
      ruleId: string;
      level: string;
      message: { text: string };
      locations?: Array<{
        physicalLocation: {
          artifactLocation: { uri: string };
          region?: { startLine?: number };
        };
      }>;
      suppressions?: Array<{ kind: string; justification?: string }>;
      partialFingerprints?: Record<string, string>;
      properties?: Record<string, unknown>;
    }>;
  }>;
}

function makeCheck(
  id: string,
  overrides: Partial<CheckResult> = {},
): CheckResult {
  const status = overrides.status ?? "pass";
  const impact: CheckImpact =
    overrides.impact ?? (status === "fail" ? "scope-fail" : "none");
  return {
    id,
    name: overrides.name ?? id,
    status,
    displayStatus:
      overrides.displayStatus ??
      (status === "fail" ? "fail" : status === "skipped" ? "skipped" : "pass"),
    impact,
    provenance: overrides.provenance ?? BASE_PROVENANCE,
    failure: overrides.failure,
    type: overrides.type,
    acknowledged: overrides.acknowledged,
    evidenceKind: overrides.evidenceKind,
    assurance: overrides.assurance,
  };
}

function makeScope(checks: CheckResult[]): AuditScope {
  return {
    status: checks.some((check) => check.status === "fail") ? "fail" : "pass",
    checks,
    failures: checks
      .filter((check) => check.status === "fail" && check.failure)
      .map((check) => check.failure!),
    summary: {},
  };
}

function makeReport(options: {
  setup?: CheckResult[];
  agent?: CheckResult[];
  harness?: CheckResult[];
  drift?: DriftReport | null;
  content?: ContentReport | null;
}): AuditReport {
  const setup = makeScope(options.setup ?? []);
  const agent = makeScope(options.agent ?? []);
  const harness =
    options.harness !== undefined ? makeScope(options.harness) : null;
  const status =
    setup.status === "fail" ||
    agent.status === "fail" ||
    harness?.status === "fail" ||
    options.drift?.status === "fail" ||
    options.content?.status === "fail"
      ? "fail"
      : "pass";

  return {
    command: "audit",
    harness: harness !== null,
    status,
    target: "/tmp/goat-flow-target",
    scopes: { setup, agent, harness },
    concerns: null,
    enforcement: [],
    drift: options.drift ?? null,
    content: options.content ?? null,
    overall: { status },
  };
}

function parseSarif(report: AuditReport): ParsedSarifLog {
  return JSON.parse(renderAuditSarif(report)) as ParsedSarifLog;
}

function makeTempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-audit-sarif-"));
  mkdirSync(join(root, ".goat-flow"), { recursive: true });
  disposables.push(root);
  return root;
}

describe("renderAuditSarif", () => {
  it("emits a SARIF 2.1.0 log with one goat-flow run and registered passing rules", () => {
    const sarif = parseSarif(
      makeReport({
        setup: [makeCheck("setup/config")],
        agent: [makeCheck("agent/instruction", { status: "skipped" })],
      }),
    );

    assert.equal(sarif.version, "2.1.0");
    assert.equal(sarif.$schema, SARIF_SCHEMA);
    assert.equal(sarif.runs.length, 1);
    const driver = sarif.runs[0].tool.driver;
    assert.equal(driver.name, "goat-flow");
    assert.equal(
      driver.informationUri,
      "https://github.com/blundergoat/goat-flow",
    );
    assert.equal(typeof driver.semanticVersion, "string");
    assert.deepEqual(
      driver.rules.map((rule) => rule.id),
      ["setup/config", "agent/instruction"],
    );
    assert.deepEqual(sarif.runs[0].results, []);
  });

  it("emits failed checks without fabricated locations and preserves acknowledged suppressions", () => {
    const sarif = parseSarif(
      makeReport({
        setup: [
          makeCheck("setup/tasks", {
            status: "fail",
            failure: {
              check: "Tasks directory",
              message: "Missing .goat-flow/tasks/",
            },
            provenance: {
              ...BASE_PROVENANCE,
              evidence_paths: [],
            },
          }),
        ],
        harness: [
          makeCheck("recovery/session-log", {
            status: "fail",
            displayStatus: "warn",
            impact: "score-only",
            type: "advisory",
            acknowledged: true,
            evidenceKind: "structural",
            assurance: "limited",
            failure: {
              check: "Session log recovery",
              message: "No recovery notes found",
            },
          }),
        ],
      }),
    );

    const results = sarif.runs[0].results;
    assert.deepEqual(
      results.map((result) => `${result.ruleId}:${result.level}`),
      ["setup/tasks:error", "recovery/session-log:warning"],
    );
    assert.equal(results[0].locations, undefined);
    assert.deepEqual(results[1].suppressions, [
      {
        kind: "external",
        justification: "Acknowledged by goat-flow harness configuration.",
      },
    ]);
    assert.equal(results[1].properties?.evidenceKind, "structural");
    assert.equal(results[1].properties?.assurance, "limited");
  });

  it("maps drift and content findings to SARIF results with file locations", () => {
    const sarif = parseSarif(
      makeReport({
        drift: {
          status: "fail",
          findings: [
            {
              kind: "missing",
              path: ".agents/skills/goat/SKILL.md",
              message: "Skill mirror is missing.",
            },
          ],
          checked: 1,
        },
        content: {
          status: "fail",
          findings: [
            {
              severity: "warning",
              rule: "vague-term",
              path: "AGENTS.md",
              line: 42,
              message: "Instruction uses vague wording.",
              suggestion: "Name the concrete command.",
            },
            {
              severity: "info",
              rule: "generic-guidance",
              path: "README.md",
              message: "Guidance is generic.",
            },
          ],
          warnings: 1,
          infos: 1,
          filesScanned: 2,
        },
      }),
    );

    const results = sarif.runs[0].results;
    assert.deepEqual(
      results.map((result) => `${result.ruleId}:${result.level}`),
      [
        "drift:missing:error",
        "content:generic-guidance:note",
        "content:vague-term:warning",
      ],
    );
    assert.equal(
      results[0].locations?.[0].physicalLocation.artifactLocation.uri,
      ".agents/skills/goat/SKILL.md",
    );
    assert.equal(
      results[2].locations?.[0].physicalLocation.artifactLocation.uri,
      "AGENTS.md",
    );
    assert.equal(
      results[2].locations?.[0].physicalLocation.region?.startLine,
      42,
    );
  });

  it("orders rules and results deterministically by scope, rule id, location, and message", () => {
    const report = makeReport({
      setup: [
        makeCheck("setup/z", {
          status: "fail",
          failure: { check: "Z", message: "Second message" },
        }),
        makeCheck("setup/a", {
          status: "fail",
          failure: { check: "A", message: "First message" },
        }),
      ],
      agent: [
        makeCheck("agent/b", {
          status: "fail",
          failure: { check: "B", message: "Agent message" },
        }),
      ],
    });

    assert.equal(renderAuditSarif(report), renderAuditSarif(report));
    const sarif = parseSarif(report);
    assert.deepEqual(
      sarif.runs[0].tool.driver.rules.map((rule) => rule.id),
      ["setup/a", "setup/z", "agent/b"],
    );
    assert.deepEqual(
      sarif.runs[0].results.map((result) => result.ruleId),
      ["setup/a", "setup/z", "agent/b"],
    );
    assert.ok(sarif.runs[0].results[0].partialFingerprints);
  });
});

describe("audit SARIF CLI format", () => {
  it("parses --format sarif for audit and rejects it for non-audit commands", () => {
    const parsed = parseCLIArgs(["audit", ".", "--format", "sarif"]);
    assert.equal(parsed.command, "audit");
    assert.equal(parsed.format, "sarif");
    assert.throws(
      () => parseCLIArgs(["audit", ".", "--format", "xml"]),
      /Invalid format: xml\. Use: json, text, markdown, sarif/,
    );
    assert.throws(
      () => parseCLIArgs(["quality", ".", "--format", "sarif"]),
      /--format sarif is only valid for the audit command/,
    );
  });

  it("routes audit --format sarif through the CLI renderer", () => {
    const root = makeTempProject();
    const result = spawnSync(
      process.execPath,
      ["--import", TSX_LOADER_URL, CLI_PATH, "audit", ".", "--format", "sarif"],
      { cwd: root, encoding: "utf-8", timeout: 20000 },
    );

    assert.equal(result.status, 1, result.stderr);
    const sarif = JSON.parse(result.stdout) as {
      version: string;
      runs: Array<{ tool: { driver: { name: string } } }>;
    };
    assert.equal(sarif.version, "2.1.0");
    assert.equal(sarif.runs[0].tool.driver.name, "goat-flow");
  });
});
