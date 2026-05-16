import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { HARNESS_CHECKS } from "../../../src/cli/audit/harness/index.js";
import { computeHarness, runAudit } from "../../../src/cli/audit/audit.js";
import { createFS } from "../../../src/cli/facts/fs.js";
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

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..", "..");
const RATIONALISATIONS_PATH = ".goat-flow/skill-reference/skill-preamble.md";
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
    gemini: {
      instruction_file: INSTRUCTION_FILES.gemini,
      skills_dir: ".agents/skills/",
    },
    copilot: {
      instruction_file: INSTRUCTION_FILES.copilot,
      skills_dir: ".github/skills/",
    },
  },
};

function completeFiles(): Record<string, string> {
  return {
    [RATIONALISATIONS_PATH]: RATIONALISATIONS_PREAMBLE,
    [INSTRUCTION_FILES.claude]: completeInstruction("CLAUDE.md"),
    [INSTRUCTION_FILES.codex]: completeInstruction("AGENTS.md"),
    [INSTRUCTION_FILES.gemini]: completeInstruction("GEMINI.md"),
    [INSTRUCTION_FILES.copilot]: completeInstruction("copilot-instructions.md"),
  };
}

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
    assert.match(result.findings.join("\n"), /4 present instruction file/);
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
              path: ".github/git-commit-instructions.md",
              requiredPath: ".github/git-commit-instructions.md",
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

  it("is score-only in audit output and passes on the goat-flow self repo", () => {
    const report = runAudit(createFS(PROJECT_ROOT), PROJECT_ROOT, {
      agentFilter: "claude",
      harness: true,
    });
    const check = report.scopes.harness?.checks.find(
      (entry) => entry.id === "evidence-before-claims",
    );

    assert.ok(check, "audit report should include evidence-before-claims");
    assert.equal(check.type, "metric");
    assert.equal(check.impact, "none");
    assert.equal(check.status, "pass");
  });
});
