/**
 * Integration tests for `goat-flow audit` build checks across setup and harness scopes.
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertExists } from "../helpers/assert-exists.ts";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { SETUP_CHECKS } from "../../src/cli/audit/check-goat-flow.js";
import { AGENT_CHECKS } from "../../src/cli/audit/check-agent-setup.js";

const BUILD_CHECKS = [...SETUP_CHECKS, ...AGENT_CHECKS];
import { makeCtx, stubAgentFacts, stubFS } from "../fixtures/projects/index.js";

const skillDocsCheck = SETUP_CHECKS.find(
  (check) => check.id === "instruction-file-skill-docs-pointer",
);
assertExists(skillDocsCheck);

const requiredSkillDocsFiles = [
  // Meta references
  ".goat-flow/skill-docs/README.md",
  ".goat-flow/skill-docs/skill-preamble.md",
  ".goat-flow/skill-docs/skill-conventions.md",
  // Standalone playbooks
  ".goat-flow/skill-docs/playbooks/README.md",
  ".goat-flow/skill-docs/playbooks/browser-use.md",
  ".goat-flow/skill-docs/playbooks/changelog.md",
  ".goat-flow/skill-docs/playbooks/code-comments.md",
  ".goat-flow/skill-docs/playbooks/gruff-code-quality.md",
  ".goat-flow/skill-docs/playbooks/observability.md",
  ".goat-flow/skill-docs/playbooks/page-capture.md",
  ".goat-flow/skill-docs/playbooks/release-notes.md",
  ".goat-flow/skill-docs/skill-quality-testing/README.md",
  ".goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md",
  ".goat-flow/skill-docs/skill-quality-testing/adversarial-framing.md",
  ".goat-flow/skill-docs/skill-quality-testing/deployment.md",
];

/** Produce a minimal compliant instruction file for skill-docs audit fixtures. */
function compliantSkillDocsInstruction(): string {
  return `# CLAUDE.md

## Execution Loop: READ -> SCOPE -> ACT -> VERIFY

### READ
Before declaring any tool or capability unavailable, read the matching playbook in .goat-flow/skill-docs/playbooks/ and run that doc's "Availability Check" section verbatim.

### SCOPE

### ACT

### VERIFY

## Router Table

| Resource | Path |
|----------|------|
| Skill playbooks | .goat-flow/skill-docs/playbooks/ |
`;
}

function makeSkillDocsCtx(options: {
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
    present.add(".goat-flow/skill-docs");
    for (const file of requiredSkillDocsFiles) {
      if (
        file !== ".goat-flow/skill-docs/README.md" ||
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

/** Assert every build check passes against the supplied audit context. */
function assertBuildChecksPass(ctx: ReturnType<typeof makeCtx>): void {
  for (const check of BUILD_CHECKS) {
    const result = check.run(ctx);
    assert.equal(
      result,
      null,
      `Check ${check.id} should pass but got: ${result?.message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Both scopes pass when project is well-configured
// ---------------------------------------------------------------------------
describe("audit build: all scopes pass on healthy project", () => {
  it("no failures when all checks pass", () => {
    assertBuildChecksPass(makeCtx());
  });
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Harness scope: missing deny patterns
// ---------------------------------------------------------------------------
describe("audit build: harness scope fails on missing deny", () => {
  it("agent-guardrails check fails when no deny configured", () => {
    const check = BUILD_CHECKS.find((c) => c.id === "agent-guardrails");
    assertExists(check);
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
    assertExists(result, "Should fail when no deny patterns");
    assert.equal(check.scope, "agent");
    assert.ok(result.howToFix, "Should include howToFix");
  });

  it("agent-guardrails summary mode stops at presence without shelling out", () => {
    const check = BUILD_CHECKS.find((c) => c.id === "agent-guardrails");
    assertExists(check);
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

describe("audit build: skill-docs discoverability", () => {
  it("fails when skill-docs exists but an instruction file lacks the required routing", () => {
    const ctx = makeSkillDocsCtx({
      dirPresent: true,
      instructionContent: "# CLAUDE.md\n",
    });

    assert.equal(skillDocsCheck.skip, undefined);
    const result = skillDocsCheck.run(ctx);

    assertExists(result);
    assert.match(result.message, /CLAUDE\.md/);
    assert.match(result.message, /READ rule/);
    assert.match(result.message, /Router Table pointer/);
    assert.match(result.howToFix ?? "", /Before declaring any tool/);
  });

  it("fails when the path appears outside the READ rule and Router Table", () => {
    const ctx = makeSkillDocsCtx({
      dirPresent: true,
      instructionContent:
        "# CLAUDE.md\n\n## Ask First\n\nBoundary: .goat-flow/skill-docs/\n",
    });

    assert.equal(skillDocsCheck.skip, undefined);
    const result = skillDocsCheck.run(ctx);

    assertExists(result);
    assert.match(result.message, /READ rule/);
    assert.match(result.message, /Router Table pointer/);
  });

  it("passes when present instruction files contain the READ rule and Router Table pointer", () => {
    const ctx = makeSkillDocsCtx({
      dirPresent: true,
      instructionContent: compliantSkillDocsInstruction(),
    });

    assert.equal(skillDocsCheck.skip, undefined);
    assert.equal(skillDocsCheck.run(ctx), null);
  });

  it("fails when the project has no shared reference/playbook pack", () => {
    const ctx = makeSkillDocsCtx({
      dirPresent: false,
      instructionContent: "# CLAUDE.md\n",
    });

    assert.equal(skillDocsCheck.skip, undefined);
    const result = skillDocsCheck.run(ctx);

    assertExists(result);
    assert.match(result.message, /Shared reference\/playbook pack/);
    assert.match(result.message, /\.goat-flow\/skill-docs\/README\.md/);
    assert.equal(result.evidence, ".goat-flow/skill-docs/README.md");
  });

  it("fails when the skill-docs directory has no README index", () => {
    const ctx = makeSkillDocsCtx({
      dirPresent: true,
      readmePresent: false,
      instructionContent: compliantSkillDocsInstruction(),
    });

    const result = skillDocsCheck.run(ctx);

    assertExists(result);
    assert.match(result.message, /Shared reference\/playbook pack/);
    assert.match(result.message, /README\.md/);
    assert.equal(result.evidence, ".goat-flow/skill-docs/README.md");
  });

  it("reports only present instruction files that dropped the pointer", () => {
    const ctx = makeSkillDocsCtx({
      dirPresent: true,
      instructionFiles: {
        "CLAUDE.md": compliantSkillDocsInstruction(),
        "AGENTS.md": "# AGENTS.md\n",
      },
    });

    const result = skillDocsCheck.run(ctx);

    assertExists(result);
    assert.doesNotMatch(result.message, /CLAUDE\.md/);
    assert.match(result.message, /AGENTS\.md/);
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
