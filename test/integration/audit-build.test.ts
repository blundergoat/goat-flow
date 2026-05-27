/**
 * Integration tests for `goat-flow audit` build checks across setup and harness scopes.
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { SETUP_CHECKS } from "../../src/cli/audit/check-goat-flow.js";
import { AGENT_CHECKS } from "../../src/cli/audit/check-agent-setup.js";

const BUILD_CHECKS = [...SETUP_CHECKS, ...AGENT_CHECKS];
import { makeCtx, stubAgentFacts, stubFS } from "../fixtures/projects/index.js";

const skillReferenceCheck = SETUP_CHECKS.find(
  (check) => check.id === "instruction-file-skill-reference-pointer",
)!;

const requiredSkillReferenceFiles = [
  // Meta references
  ".goat-flow/skill-reference/README.md",
  ".goat-flow/skill-reference/skill-preamble.md",
  ".goat-flow/skill-reference/skill-conventions.md",
  // Standalone playbooks
  ".goat-flow/skill-playbooks/README.md",
  ".goat-flow/skill-playbooks/browser-use.md",
  ".goat-flow/skill-playbooks/changelog.md",
  ".goat-flow/skill-playbooks/code-comments.md",
  ".goat-flow/skill-playbooks/gruff-code-quality.md",
  ".goat-flow/skill-playbooks/observability.md",
  ".goat-flow/skill-playbooks/page-capture.md",
  ".goat-flow/skill-playbooks/release-notes.md",
  ".goat-flow/skill-playbooks/skill-quality-testing.md",
  ".goat-flow/skill-playbooks/skill-quality-testing/tdd-iteration.md",
  ".goat-flow/skill-playbooks/skill-quality-testing/adversarial-framing.md",
  ".goat-flow/skill-playbooks/skill-quality-testing/deployment.md",
];

function compliantSkillReferenceInstruction(): string {
  return `# CLAUDE.md

## Execution Loop: READ -> SCOPE -> ACT -> VERIFY

### READ
Before declaring any tool or capability unavailable, read the matching playbook in .goat-flow/skill-playbooks/ and run that doc's "Availability Check" section verbatim.

### SCOPE

### ACT

### VERIFY

## Router Table

| Resource | Path |
|----------|------|
| Skill playbooks | .goat-flow/skill-playbooks/ |
`;
}

function makeSkillReferenceCtx(options: {
  dirPresent: boolean;
  readmePresent?: boolean;
  instructionContent?: string;
  instructionFiles?: Record<string, string>;
}) {
  const present = new Set<string>();
  const instructionFiles = options.instructionFiles ?? {
    "CLAUDE.md": options.instructionContent ?? "",
  };
  if (options.dirPresent) {
    present.add(".goat-flow/skill-reference");
    for (const file of requiredSkillReferenceFiles) {
      if (
        file !== ".goat-flow/skill-reference/README.md" ||
        options.readmePresent !== false
      ) {
        present.add(file);
      }
    }
  }
  for (const path of Object.keys(instructionFiles)) {
    present.add(path);
  }

  return makeCtx({
    fs: stubFS({
      exists: (path) => present.has(path),
      readFile: (path) => instructionFiles[path] ?? "# Stub\n",
    }),
    structure: {
      ...makeCtx().structure,
      agents: {
        claude: {
          instruction_file: "CLAUDE.md",
          skills_dir: ".claude/skills",
        },
        codex: {
          instruction_file: "AGENTS.md",
          skills_dir: ".agents/skills",
        },
        antigravity: {
          instruction_file: "AGENTS.md",
          skills_dir: ".agents/skills",
        },
        copilot: {
          instruction_file: ".github/copilot-instructions.md",
          skills_dir: ".github/skills",
        },
      },
    },
  });
}

const require = createRequire(import.meta.url);
const childProcess =
  require("node:child_process") as typeof import("node:child_process");
const originalExecFileSync = childProcess.execFileSync;

afterEach(() => {
  childProcess.execFileSync = originalExecFileSync;
  syncBuiltinESMExports();
});

// ---------------------------------------------------------------------------
// Both scopes pass when project is well-configured
// ---------------------------------------------------------------------------
describe("audit build: all scopes pass on healthy project", () => {
  it("no failures when all checks pass", () => {
    const ctx = makeCtx();
    for (const check of BUILD_CHECKS) {
      const result = check.run(ctx);
      assert.equal(
        result,
        null,
        `Check ${check.id} should pass but got: ${result?.message}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Harness scope: missing deny patterns
// ---------------------------------------------------------------------------
describe("audit build: harness scope fails on missing deny", () => {
  it("agent-guardrails check fails when no deny configured", () => {
    const check = BUILD_CHECKS.find((c) => c.id === "agent-guardrails")!;
    const ctx = makeCtx({
      agentFilter: "claude",
      agents: [
        stubAgentFacts({
          settings: {
            exists: true,
            valid: true,
            parsed: {},
            hasDenyPatterns: false,
          },
          hooks: {
            ...stubAgentFacts().hooks,
            denyExists: false,
          },
        }),
      ],
    });
    const result = check.run(ctx);
    assert.notEqual(result, null, "Should fail when no deny patterns");
    assert.equal(check.scope, "agent");
    assert.ok(result!.howToFix, "Should include howToFix");
  });

  it("agent-guardrails summary mode stops at presence without shelling out", () => {
    const check = BUILD_CHECKS.find((c) => c.id === "agent-guardrails")!;
    let execCalls = 0;
    childProcess.execFileSync = (() => {
      execCalls += 1;
      throw new Error("summary mode should not execute runtime hook probes");
    }) as typeof childProcess.execFileSync;
    syncBuiltinESMExports();

    const ctx = makeCtx({
      agentFilter: "claude",
      denyMechanismEvidenceLevel: "present-only",
    });

    const result = check.run(ctx);
    assert.equal(result, null, "Presence-only summary mode should pass");
    assert.equal(
      execCalls,
      0,
      "Presence-only summary mode should not shell out",
    );
  });
});

describe("audit build: skill-reference discoverability", () => {
  it("fails when skill-reference exists but an instruction file lacks the required routing", () => {
    const ctx = makeSkillReferenceCtx({
      dirPresent: true,
      instructionContent: "# CLAUDE.md\n",
    });

    assert.equal(skillReferenceCheck.skip, undefined);
    const result = skillReferenceCheck.run(ctx);

    assert.notEqual(result, null);
    assert.match(result!.message, /CLAUDE\.md/);
    assert.match(result!.message, /READ rule/);
    assert.match(result!.message, /Router Table pointer/);
    assert.match(result!.howToFix ?? "", /Before declaring any tool/);
  });

  it("fails when the path appears outside the READ rule and Router Table", () => {
    const ctx = makeSkillReferenceCtx({
      dirPresent: true,
      instructionContent:
        "# CLAUDE.md\n\n## Ask First\n\nBoundary: .goat-flow/skill-reference/\n",
    });

    assert.equal(skillReferenceCheck.skip, undefined);
    const result = skillReferenceCheck.run(ctx);

    assert.notEqual(result, null);
    assert.match(result!.message, /READ rule/);
    assert.match(result!.message, /Router Table pointer/);
  });

  it("passes when present instruction files contain the READ rule and Router Table pointer", () => {
    const ctx = makeSkillReferenceCtx({
      dirPresent: true,
      instructionContent: compliantSkillReferenceInstruction(),
    });

    assert.equal(skillReferenceCheck.skip, undefined);
    assert.equal(skillReferenceCheck.run(ctx), null);
  });

  it("fails when the project has no shared reference/playbook pack", () => {
    const ctx = makeSkillReferenceCtx({
      dirPresent: false,
      instructionContent: "# CLAUDE.md\n",
    });

    assert.equal(skillReferenceCheck.skip, undefined);
    const result = skillReferenceCheck.run(ctx);

    assert.notEqual(result, null);
    assert.match(result!.message, /Shared reference\/playbook pack/);
    assert.match(result!.message, /\.goat-flow\/skill-reference\/README\.md/);
    assert.equal(result!.evidence, ".goat-flow/skill-reference/README.md");
  });

  it("fails when the skill-reference directory has no README index", () => {
    const ctx = makeSkillReferenceCtx({
      dirPresent: true,
      readmePresent: false,
      instructionContent: compliantSkillReferenceInstruction(),
    });

    const result = skillReferenceCheck.run(ctx);

    assert.notEqual(result, null);
    assert.match(result!.message, /Shared reference\/playbook pack/);
    assert.match(result!.message, /README\.md/);
    assert.equal(result!.evidence, ".goat-flow/skill-reference/README.md");
  });

  it("reports only present instruction files that dropped the pointer", () => {
    const ctx = makeSkillReferenceCtx({
      dirPresent: true,
      instructionFiles: {
        "CLAUDE.md": compliantSkillReferenceInstruction(),
        "AGENTS.md": "# AGENTS.md\n",
      },
    });

    const result = skillReferenceCheck.run(ctx);

    assert.notEqual(result, null);
    assert.doesNotMatch(result!.message, /CLAUDE\.md/);
    assert.match(result!.message, /AGENTS\.md/);
  });
});

// ---------------------------------------------------------------------------
// Build checks cover both scopes
// ---------------------------------------------------------------------------
describe("audit build: scope coverage", () => {
  it("build checks cover setup and agent scopes", () => {
    const scopes = new Set(BUILD_CHECKS.map((c) => c.scope));
    assert.ok(scopes.has("setup"), "Should have setup scope checks");
    assert.ok(scopes.has("agent"), "Should have agent scope checks");
  });
});
