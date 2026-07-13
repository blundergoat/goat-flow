/**
 * Protects the local support bundle users attach when goat-flow setup needs diagnosis.
 * Use these tests when bundle fields, collectors, redaction, or command errors change.
 * Fixtures contain runtime-built fake credentials so source scanners stay clean.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

import type { AuditReport, AuditScope } from "../../src/cli/audit/types.js";
import type { LoadedConfig } from "../../src/cli/config/types.js";
import { createEvidenceEnvelope } from "../../src/cli/evidence/envelope.js";
import { loadManifest } from "../../src/cli/manifest/manifest.js";
import type { QualityHistoryEntry } from "../../src/cli/quality/history.js";
import type { ProjectFacts } from "../../src/cli/types.js";
import {
  buildSupportBundle,
  buildSupportBundleError,
  renderSupportBundleJson,
  renderSupportBundleText,
  type BuildSupportBundleInput,
} from "../../src/cli/diagnostics/support-bundle.js";
import { makeSharedFacts, stubAgentFacts } from "../fixtures/projects/index.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const CLI_PATH = join(PROJECT_ROOT, "src", "cli", "cli.ts");
const GENERATED_AT = "2026-07-13T10:00:00.000Z";

/** Return one scope so fixtures can vary audit status without embedding evidence bodies. */
function auditScope(status: "pass" | "fail"): AuditScope {
  return { status, checks: [], failures: [], summary: {} };
}

/** Return compact project facts whose instruction body is available only for hash evidence. */
function supportFacts(instructionBody: string): ProjectFacts {
  return {
    root: "/fixture",
    agents: [
      stubAgentFacts({
        instruction: {
          exists: true,
          content: instructionBody,
          lineCount: 2,
          sections: new Map(),
        },
      }),
    ],
    shared: makeSharedFacts(),
    stack: {
      languages: ["TypeScript", "Shell"],
      buildCommand: "npm run build",
      testCommand: "npm test",
      lintCommand: "npm run lint",
      formatCommand: "npm run format:check",
      sourceFileCount: 42,
      signals: {
        codeGenTools: [],
        deployPlatforms: [],
        llmIntegration: false,
        staticAnalysis: [{ tool: "gruff-ts", level: "strict" }],
        complianceSignals: false,
        formatterGaps: [],
      },
    },
  };
}

/** Return normalized config containing values the bundle must summarize without serializing. */
function supportConfig(secretValues: readonly string[]): LoadedConfig {
  return {
    exists: true,
    valid: true,
    warnings: [],
    errors: [],
    parseError: null,
    config: {
      version: "1.13.1",
      footguns: { path: ".goat-flow/learning-loop/footguns/" },
      lessons: { path: ".goat-flow/learning-loop/lessons/" },
      decisions: { path: ".goat-flow/learning-loop/decisions/" },
      plans: { path: ".goat-flow/plans/" },
      logs: { path: ".goat-flow/logs/" },
      agents: null,
      skills: { install: "all" },
      lineLimits: { target: 125, limit: 150 },
      toolchain: {
        test: [],
        lint: [],
        build: [],
        package: [],
        format: [],
      },
      userRole: "developer",
      telemetry: false,
      learningLoop: { autoCapture: { enabled: false, targets: [] } },
      knownGaps: [...secretValues],
      skillOverrides: Object.fromEntries([
        [["pass", "word"].join(""), secretValues[2]],
        [["pass", "phrase"].join(""), secretValues[3]],
      ]),
      terminal: { idleTimeoutMinutes: 480 },
      harness: { acknowledge: [] },
      hooks: {},
    },
  };
}

/** Return an audit fixture whose raw failure text must never reach the support artifact. */
function supportAudit(secretValue: string): AuditReport {
  const setup = auditScope("fail");
  setup.failures.push({ check: "fixture", message: secretValue });
  return {
    command: "audit",
    harness: true,
    status: "fail",
    target: "/fixture",
    scopes: { setup, agent: auditScope("pass"), harness: auditScope("pass") },
    concerns: null,
    enforcement: [],
    drift: null,
    content: null,
    overall: { status: "fail" },
  };
}

/** Return one valid history row whose finding prose remains intentionally outside the bundle. */
function supportQualityHistory(secretValue: string): QualityHistoryEntry[] {
  return [
    {
      id: "2026-07-13-1000-codex-abc12",
      path: `/fixture/${secretValue}.json`,
      date: "2026-07-13",
      time: "1000",
      agent: "codex",
      randomId: "abc12",
      report: {
        report_kind: "goat-flow-quality-report",
        goat_flow_version: "1.13.1",
        agent: "codex",
        project_path: "/fixture",
        run_date: "2026-07-13",
        audit_status: "pass",
        scores: {
          setup: {
            total: 100,
            accuracy: 25,
            relevance: 25,
            completeness: 25,
            friction: 25,
          },
          system: {
            total: 100,
            usefulness: 25,
            signal_to_noise: 25,
            adaptability: 25,
            learnability: 25,
          },
        },
        findings: [
          {
            id: "fixture-secret-finding",
            type: "content_quality",
            severity: "MINOR",
            file: null,
            line: null,
            summary: secretValue,
            detail: secretValue,
            evidence_quality: "OBSERVED",
            evidence_method: "static-analysis",
            delta_tag: "new",
          },
        ],
      },
    },
  ];
}

/** Assemble one complete pure-builder input so each test changes only its failure class. */
function supportInput(): BuildSupportBundleInput {
  const tokenValue = ["gh", "p_", "a".repeat(24)].join("");
  const keyValue = ["bundle", "-key-value"].join("");
  const passwordValue = ["bundle", "-password-value"].join("");
  const passphraseValue = ["bundle", "-passphrase-value"].join("");
  const secrets = [tokenValue, keyValue, passwordValue, passphraseValue];
  return {
    generatedAt: GENERATED_AT,
    projectPath: `/fixture/${tokenValue}`,
    goatFlowVersion: "1.13.1",
    manifest: loadManifest(),
    configState: supportConfig(secrets),
    facts: supportFacts(tokenValue),
    audit: supportAudit(passwordValue),
    qualityHistory: {
      entries: supportQualityHistory(keyValue),
      warnings: [passphraseValue],
    },
    events: [
      createEvidenceEnvelope({
        producer: tokenValue,
        eventType: "quality.prompt",
        actor: "cli",
        projectRoot: "/fixture",
        timestamp: GENERATED_AT,
        payload: { metadata: { note: passphraseValue } },
      }),
    ],
    environment: {
      nodeVersion: "v24.0.0",
      platform: "linux",
      architecture: "x64",
      isInteractiveTerminal: false,
      hasGitMetadata: true,
      hasPackageManifest: true,
    },
  };
}

/** Spawn the real command so parser, collectors, output, and exit status stay integrated. */
function runBundleCommand(...args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", CLI_PATH, "diagnostics", "bundle", ...args],
    { cwd: PROJECT_ROOT, encoding: "utf-8" },
  );
}

describe("redacted support bundle", () => {
  // A support recipient gets stable section names and compact evidence rather than raw project files.
  it("builds the versioned allowlisted summary", () => {
    const bundle = buildSupportBundle(supportInput());

    assert.equal(bundle.schema, "goat-flow.support-bundle.v1");
    assert.equal(bundle.generatedAt, GENERATED_AT);
    assert.equal(bundle.exitCode, 1);
    assert.equal(bundle.redactions.scrubbedDisplayValueCount > 0, true);
    assert.equal(bundle.sections.audit.status, "fail");
    assert.equal(bundle.sections.agentSetup.length, 1);
    assert.match(
      bundle.sections.agentSetup[0]?.instruction.sha256 ?? "",
      /^[a-f0-9]{64}$/u,
    );
    assert.equal(
      bundle.sections.quality.latest?.id,
      "2026-07-13-1000-codex-abc12",
    );
    assert.equal(
      bundle.sections.events.entries[0]?.eventKind,
      "quality.prompt",
    );
  });

  // Raw config, event, audit, quality, and instruction values never reach the artifact users share.
  it("redacts or omits token, key, password, passphrase, and nested metadata values", () => {
    const input = supportInput();
    const rendered = renderSupportBundleJson(buildSupportBundle(input));
    const forbiddenReadableValues = [
      ...input.configState.config.knownGaps,
      input.audit.scopes.setup.failures[0]?.message,
      input.qualityHistory.warnings[0],
    ].filter((value): value is string => typeof value === "string");

    assert.doesNotMatch(rendered, /ghp_[a-z0-9_]+/iu);
    assert.doesNotMatch(rendered, /bundle-(?:key|password|passphrase)-value/iu);
    // Every readable fixture value stays absent even when it originated in a nested collector field.
    for (const forbiddenValue of forbiddenReadableValues) {
      assert.equal(rendered.includes(forbiddenValue), false, forbiddenValue);
    }
    assert.deepEqual(buildSupportBundle(input).redactions.omittedFields, [
      "audit check evidence and failure bodies",
      "config raw values and commands",
      "event payloads and project paths",
      "instruction and settings bodies",
      "quality finding bodies and report paths",
    ]);
  });

  // Terminal users see the key verdict and an exact route to the complete machine-readable artifact.
  it("renders concise text with a JSON next step", () => {
    const rendered = renderSupportBundleText(
      buildSupportBundle(supportInput()),
    );

    assert.match(rendered, /GOAT Flow support bundle/iu);
    assert.match(rendered, /Audit: fail/iu);
    assert.match(rendered, /--format json/iu);
    assert.doesNotMatch(rendered, /payload|scrollback|prompt body/iu);
  });

  // A missing project still gives automation one parseable contract and the real usage exit code.
  it("builds a parseable target-not-found error bundle", () => {
    const bundle = buildSupportBundleError({
      generatedAt: GENERATED_AT,
      projectPath: "/missing/project",
      goatFlowVersion: "1.13.1",
      errorCode: "target-not-found",
      exitCode: 2,
    });
    const parsed = JSON.parse(renderSupportBundleJson(bundle)) as typeof bundle;

    assert.equal(parsed.error?.code, "target-not-found");
    assert.equal(parsed.exitCode, 2);
    assert.equal(parsed.sections, null);
  });

  // The real command owns stdout exclusively so support tooling can parse it without cleanup.
  it("emits clean JSON through the CLI", () => {
    const result = runBundleCommand(
      ".",
      "--agent",
      "codex",
      "--format",
      "json",
    );
    const parsed = JSON.parse(result.stdout) as {
      schema: string;
      exitCode: number;
    };

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(parsed.schema, "goat-flow.support-bundle.v1");
    assert.equal(parsed.exitCode, 0);
  });

  // An absent path stays JSON-shaped and nonzero for CI and support scripts.
  it("emits a parseable error bundle for a missing target", () => {
    const missingTarget = join(
      PROJECT_ROOT,
      ".goat-flow",
      "scratchpad",
      "missing-support-target",
    );
    const result = runBundleCommand(missingTarget, "--format", "json");
    const parsed = JSON.parse(result.stdout) as {
      error: { code: string };
      exitCode: number;
    };

    assert.equal(result.status, 2, result.stderr);
    assert.equal(parsed.error.code, "target-not-found");
    assert.equal(parsed.exitCode, 2);
  });
});
