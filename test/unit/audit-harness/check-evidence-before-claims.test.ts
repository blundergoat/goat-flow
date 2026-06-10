/**
 * Regression tests for the evidence-before-claims verification metric.
 *
 * The fixture deliberately maps Codex and Antigravity to the same AGENTS.md
 * path so the metric stays pinned to unique present instruction files, not the
 * number of agent profiles in the manifest.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeHarness, HARNESS_CHECKS } from "../../src.js";
import {
  completeInstruction,
  INSTRUCTION_FILES,
  MISSING_RATIONALISATIONS_POINTER,
  MISSING_RED_FLAGS_INSTRUCTION,
  RATIONALISATIONS_PREAMBLE,
} from "../../fixtures/evidence-before-claims.js";
import {
  makeCtx,
  STUB_STRUCTURE,
  stubConfig,
  stubFS,
} from "../../fixtures/projects/index.js";

const RATIONALISATIONS_PATH = ".goat-flow/skill-docs/skill-preamble.md";
const evidenceBeforeClaims = HARNESS_CHECKS.find(
  (check) => check.id === "evidence-before-claims",
);

const STRUCTURE = {
  ...STUB_STRUCTURE,
  agents: {
    claude: {
      instruction_file: INSTRUCTION_FILES.claude,
      skills_dir: ".claude/skills/",
    },
    codex: {
      instruction_file: INSTRUCTION_FILES.codex,
      skills_dir: ".agents/skills/",
    },
    antigravity: {
      instruction_file: INSTRUCTION_FILES.antigravity,
      skills_dir: ".agents/skills/",
    },
    copilot: {
      instruction_file: INSTRUCTION_FILES.copilot,
      skills_dir: ".github/skills/",
    },
  },
};

/**
 * Build a fully covered project fixture.
 *
 * Duplicate instruction-file paths collapse to one object key, matching the
 * harness behavior that scans each present instruction file once.
 */
function completeFiles(): Record<string, string> {
  return {
    [RATIONALISATIONS_PATH]: RATIONALISATIONS_PREAMBLE,
    [INSTRUCTION_FILES.claude]: completeInstruction("CLAUDE.md"),
    [INSTRUCTION_FILES.codex]: completeInstruction("AGENTS.md"),
    [INSTRUCTION_FILES.antigravity]: completeInstruction("AGENTS.md"),
    [INSTRUCTION_FILES.copilot]: completeInstruction("copilot-instructions.md"),
  };
}

/**
 * Build a harness context whose filesystem exposes exactly the provided files.
 *
 * Missing instruction files must read as absent so metric tests can distinguish
 * "agent profile exists" from "instruction file exists in this target".
 */
function ctxFromFiles(files: Record<string, string>, overrides = {}) {
  return makeCtx({
    structure: STRUCTURE,
    fs: stubFS({
      readFile: (path: string) => files[path] ?? null,
      exists: (path: string) =>
        Object.prototype.hasOwnProperty.call(files, path),
    }),
    ...overrides,
  });
}

describe("evidence-before-claims harness metric", () => {
  it("passes when all present instruction files carry red-flags coverage", () => {
    assert.ok(evidenceBeforeClaims, "evidence-before-claims check must exist");

    const result = evidenceBeforeClaims.run(ctxFromFiles(completeFiles()));

    assert.equal(result.status, "pass");
    assert.match(result.findings.join("\n"), /3 present instruction file/);
  });

  it("fails as a metric when a present instruction file lacks the red-flags section", () => {
    assert.ok(evidenceBeforeClaims, "evidence-before-claims check must exist");
    const files = completeFiles();
    files[INSTRUCTION_FILES.claude] = MISSING_RED_FLAGS_INSTRUCTION;

    const result = evidenceBeforeClaims.run(ctxFromFiles(files));

    assert.equal(result.status, "fail");
    assert.ok(
      result.findings.some((finding) =>
        finding.includes("CLAUDE.md: missing Hallucination red-flags section"),
      ),
      JSON.stringify(result.findings),
    );
  });

  it("fails as a metric when a present instruction file lacks the rationalisations pointer", () => {
    assert.ok(evidenceBeforeClaims, "evidence-before-claims check must exist");
    const files = completeFiles();
    files[INSTRUCTION_FILES.codex] = MISSING_RATIONALISATIONS_POINTER;

    const result = evidenceBeforeClaims.run(ctxFromFiles(files));

    assert.equal(result.status, "fail");
    assert.ok(
      result.findings.some((finding) =>
        finding.includes("AGENTS.md: Hallucination red-flags missing pointer"),
      ),
      JSON.stringify(result.findings),
    );
  });

  it("reports missing rationalisations table as a metric finding", () => {
    assert.ok(evidenceBeforeClaims, "evidence-before-claims check must exist");
    const files = completeFiles();
    files[RATIONALISATIONS_PATH] = "# Skill Preamble\n\n### Renamed Table\n";

    const result = evidenceBeforeClaims.run(ctxFromFiles(files));

    assert.equal(result.status, "fail");
    assert.ok(
      result.findings.some((finding) =>
        finding.includes(
          `${RATIONALISATIONS_PATH}: missing Rationalisations to reject`,
        ),
      ),
      JSON.stringify(result.findings),
    );
  });

  it("lowers score without failing Verification when coverage is missing", () => {
    const files = completeFiles();
    files[INSTRUCTION_FILES.claude] = MISSING_RED_FLAGS_INSTRUCTION;
    const baseFacts = makeCtx().facts;

    const { scope, concerns } = computeHarness(
      ctxFromFiles(files, {
        facts: {
          ...baseFacts,
          shared: {
            ...baseFacts.shared,
            gitCommitInstructions: {
              exists: true,
              path: "docs/coding-standards/git-commit.md",
              requiredPath: "docs/coding-standards/git-commit.md",
              misplacedPaths: [],
            },
          },
        },
        config: stubConfig({ harness: { acknowledge: [] } }),
      }),
    );
    const check = scope.checks.find(
      (entry) => entry.id === "evidence-before-claims",
    );

    assert.ok(check, "audit output should include evidence-before-claims");
    assert.equal(check.status, "fail");
    assert.equal(check.displayStatus, "warn");
    assert.equal(check.impact, "score-only");
    assert.match(check.failure?.evidence ?? "", /Metric/);
    assert.equal(concerns.verification.status, "pass");
    assert.ok(
      concerns.verification.findings.some((finding) =>
        finding.includes("CLAUDE.md: missing Hallucination red-flags section"),
      ),
      JSON.stringify(concerns.verification.findings),
    );
  });

  it("skips agent instruction files that are absent from the target project", () => {
    assert.ok(evidenceBeforeClaims, "evidence-before-claims check must exist");
    const files = {
      [RATIONALISATIONS_PATH]: RATIONALISATIONS_PREAMBLE,
      [INSTRUCTION_FILES.claude]: completeInstruction("CLAUDE.md"),
    };

    const result = evidenceBeforeClaims.run(ctxFromFiles(files));

    assert.equal(result.status, "pass");
    assert.match(result.findings.join("\n"), /1 present instruction file/);
  });
});
