/**
 * Exercises the static context report with exact in-memory project surfaces.
 * Use these fixtures when changing budgets or output fields so maintainers see
 * deterministic pressure evidence without runner telemetry, credentials, or I/O.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

import type {
  AgentFacts,
  ProjectFacts,
  ReadonlyFS,
} from "../../src/cli/types.js";
import {
  buildContextReport,
  renderContextReportJson,
} from "../../src/cli/diagnostics/context-report.js";
import { makeSharedFacts, stubAgentFacts } from "../fixtures/projects/index.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const CLI_PATH = join(PROJECT_ROOT, "src", "cli", "cli.ts");

/** Spawn the real read-only command so parser, facts, dispatch, and stdout stay integrated. */
function runContextCommand(...args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", CLI_PATH, "diagnostics", "context", ...args],
    { cwd: PROJECT_ROOT, encoding: "utf-8" },
  );
}

/**
 * Build a read-only target from exact path/content fixtures.
 * Use this when a report test needs missing files to stay genuinely absent.
 */
function createContextFixtureFS(
  projectFiles: Readonly<Record<string, string>>,
): ReadonlyFS {
  return {
    exists: (path) => Object.hasOwn(projectFiles, path),
    readFile: (path) => projectFiles[path] ?? null,
    lineCount: (path) => projectFiles[path]?.split("\n").length ?? 0,
    readJson: () => null,
    isReadableDirectory: () => true,
    listDir: () => [],
    isExecutable: () => false,
    glob: () => [],
    existsGlob: () => false,
  };
}

/**
 * Assemble only the project facts consumed by the context report.
 * Use this helper to keep each test focused on user-visible pressure signals.
 */
function contextFacts(
  agentFacts: AgentFacts,
  sharedFacts: ProjectFacts["shared"],
): ProjectFacts {
  return {
    root: "/fixture",
    agents: [agentFacts],
    shared: sharedFacts,
    stack: {
      languages: [],
      buildCommand: null,
      testCommand: null,
      lintCommand: null,
      formatCommand: null,
      sourceFileCount: 0,
      signals: {
        codeGenTools: [],
        deployPlatforms: [],
        llmIntegration: false,
        staticAnalysis: [],
        complianceSignals: false,
        formatterGaps: [],
      },
    },
  };
}

describe("static context report", () => {
  // A user sees every normative pressure source together, ordered by measured budget ratio.
  it("reports oversized instruction, skill, reference, and learning-loop surfaces", () => {
    const oversizedInstruction = Array.from(
      { length: 151 },
      (_, index) => `instruction ${index}`,
    ).join("\n");
    const oversizedDispatcher = `---\ndescription: "${"metadata ".repeat(50)}"\n---\n${"route ".repeat(556)}\n`;
    const oversizedSharedReference = `${"guidance ".repeat(1500)}\n`;
    const projectFiles = {
      "CLAUDE.md": oversizedInstruction,
      ".claude/skills/goat/SKILL.md": oversizedDispatcher,
      ".goat-flow/skill-docs/skill-preamble.md": oversizedSharedReference,
    };
    const sharedFacts = makeSharedFacts();
    sharedFacts.footguns.buckets = [
      {
        path: ".goat-flow/learning-loop/footguns/large.md",
        lastReviewed: "2026-07-13",
        freshnessDays: 0,
        freshnessBand: "fresh",
        entryCount: 1,
        staleRefs: [],
        invalidLineRefs: [],
        maxEntryDate: "2026-07-13",
        sizeBytes: 40_001,
        lineCount: 800,
        graduationCandidates: [],
      },
    ];
    const report = buildContextReport({
      projectFiles: createContextFixtureFS(projectFiles),
      facts: contextFacts(
        stubAgentFacts({
          instruction: {
            exists: true,
            content: oversizedInstruction,
            lineCount: 151,
            sections: new Map(),
          },
          skills: {
            ...stubAgentFacts().skills,
            found: ["goat"],
            installedDirs: ["goat"],
          },
        }),
        sharedFacts,
      ),
    });

    assert.equal(report.measurement.telemetryRequired, false);
    assert.equal(report.summary.overBudgetSurfaces, 4);
    assert.equal(report.surfaces.skills[0]?.words, 556);
    assert.deepEqual(
      report.topPressure.map((surface) => surface.path),
      [
        "CLAUDE.md",
        ".claude/skills/goat/SKILL.md",
        ".goat-flow/learning-loop/footguns/large.md",
        ".goat-flow/skill-docs/skill-preamble.md",
      ],
    );
    assert.deepEqual(
      report.warnings.map((warning) => warning.code),
      [
        "instruction-over-limit",
        "dispatcher-skill-over-budget",
        "learning-loop-bucket-over-budget",
        "always-loaded-reference-over-budget",
      ],
    );
  });

  it("excludes CRLF frontmatter from skill word budgets", () => {
    const dispatcher = [
      "---",
      'description: "machine readable metadata with several words"',
      "---",
      "route now",
      "",
    ].join("\r\n");
    const report = buildContextReport({
      projectFiles: createContextFixtureFS({
        ".claude/skills/goat/SKILL.md": dispatcher,
      }),
      facts: contextFacts(
        stubAgentFacts({
          instruction: {
            exists: false,
            content: null,
            lineCount: 0,
            sections: new Map(),
          },
          skills: {
            ...stubAgentFacts().skills,
            found: ["goat"],
            installedDirs: ["goat"],
          },
        }),
        makeSharedFacts(),
      ),
    });

    assert.equal(report.surfaces.skills[0]?.words, 2);
  });

  // The short authoring index uses its enforced 400-word routing cap, not the broad reference cap.
  it("applies the skill-authoring index budget", () => {
    const projectFiles = {
      ".goat-flow/skill-docs/skill-quality-testing/README.md":
        "routing ".repeat(400),
    };
    const report = buildContextReport({
      projectFiles: createContextFixtureFS(projectFiles),
      facts: contextFacts(
        stubAgentFacts({
          instruction: {
            exists: false,
            content: null,
            lineCount: 0,
            sections: new Map(),
          },
          skills: {
            ...stubAgentFacts().skills,
            found: [],
            installedDirs: [],
          },
        }),
        makeSharedFacts(),
      ),
    });
    const authoringIndex = report.surfaces.references[0];

    assert.equal(authoringIndex?.budget.limit, 400);
    assert.equal(authoringIndex?.pressure, "over-budget");
    assert.equal(authoringIndex?.words, 400);
  });

  // A missing pack reference does not erase the canonical skill body's functional budget.
  it("keeps incomplete canonical skills under their ADR budget", () => {
    const projectFiles = {
      ".claude/skills/goat-review/SKILL.md": "review ".repeat(2_500),
    };
    const report = buildContextReport({
      projectFiles: createContextFixtureFS(projectFiles),
      facts: contextFacts(
        stubAgentFacts({
          instruction: {
            exists: false,
            content: null,
            lineCount: 0,
            sections: new Map(),
          },
          skills: {
            ...stubAgentFacts().skills,
            found: [],
            missing: ["goat-review"],
            installedDirs: ["goat-review"],
          },
        }),
        makeSharedFacts(),
      ),
    });
    const incompleteCanonicalSkill = report.surfaces.skills[0];

    assert.equal(incompleteCanonicalSkill?.kind, "functional-skill");
    assert.equal(incompleteCanonicalSkill?.pressure, "over-budget");
    assert.equal(incompleteCanonicalSkill?.words, 2_500);
  });

  // Machine consumers receive one stable JSON object even when the selected project is empty.
  it("renders parseable JSON without telemetry or provider state", () => {
    const sharedFacts = makeSharedFacts();
    sharedFacts.footguns.buckets = [];
    sharedFacts.lessons.buckets = [];
    const report = buildContextReport({
      projectFiles: createContextFixtureFS({}),
      facts: contextFacts(
        stubAgentFacts({
          instruction: {
            exists: false,
            content: null,
            lineCount: 0,
            sections: new Map(),
          },
          skills: {
            ...stubAgentFacts().skills,
            found: [],
            installedDirs: [],
          },
        }),
        sharedFacts,
      ),
    });

    const rendered = renderContextReportJson(report);
    const parsed = JSON.parse(rendered) as typeof report;

    assert.equal(parsed.schema, "goat-flow.context-report.v1");
    assert.equal(parsed.summary.totalSurfaces, 0);
    assert.equal(parsed.measurement.telemetryRequired, false);
    assert.doesNotMatch(rendered, /apiKey|credential|promptBody/iu);
    assert.equal(renderContextReportJson(report), rendered);
  });

  // A real Codex-targeted run writes only the versioned object to structured stdout.
  it("emits clean JSON through the CLI", () => {
    const result = runContextCommand(
      ".",
      "--agent",
      "codex",
      "--format",
      "json",
    );
    const parsed = JSON.parse(result.stdout) as {
      schema: string;
      measurement: { telemetryRequired: boolean };
    };

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(parsed.schema, "goat-flow.context-report.v1");
    assert.equal(parsed.measurement.telemetryRequired, false);
  });
});
