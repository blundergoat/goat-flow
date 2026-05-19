/**
 * Unit tests for M05 factual-claim extraction.
 *
 * Counts asserted against runtime-imported constants to avoid hard-coding
 * values that change when skills or checks are added. Path resolution uses
 * a stub ReadonlyFS so tests stay hermetic.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  scanCountClaims,
  scanConcernCountClaims,
  scanPathReferences,
  scanRemovedCommands,
  runFactualClaimChecks,
} from "../../src/cli/audit/check-factual-claims.js";
import { SKILL_NAMES } from "../../src/cli/constants.js";
import { SETUP_CHECKS } from "../../src/cli/audit/check-goat-flow.js";
import { AGENT_CHECKS } from "../../src/cli/audit/check-agent-setup.js";
import { HARNESS_CHECKS } from "../../src/cli/audit/harness/index.js";
import { CONTEXT_CHECKS } from "../../src/cli/audit/harness/check-context.js";
import type { AuditContext } from "../../src/cli/audit/types.js";
import type { ReadonlyFS } from "../../src/cli/types.js";

function stubFS(existsSet: Set<string>): ReadonlyFS {
  return {
    exists: (p: string) => existsSet.has(p),
    readFile: () => null,
    lineCount: () => 0,
    readJson: () => null,
    listDir: () => [],
    isExecutable: () => false,
    glob: () => [],
    existsGlob: () => false,
  };
}

function stubFSFromFiles(files: Record<string, string>): ReadonlyFS {
  const fs = {
    exists: (p: string) => Object.prototype.hasOwnProperty.call(files, p),
    readFile: (p: string) => files[p] ?? null,
    lineCount: (p: string) => (files[p] ?? "").split(/\r?\n/).length,
    readJson: () => null,
    listDir: () => [],
    isExecutable: () => false,
    glob: (pattern: string) =>
      pattern === "docs/*.md"
        ? Object.keys(files).filter((path) => /^docs\/[^/]+\.md$/u.test(path))
        : [],
  };
  return {
    ...fs,
    existsGlob: (pattern: string) => fs.glob(pattern).length > 0,
  };
}

function stubCtx(fs: ReadonlyFS): AuditContext {
  return { fs } as unknown as AuditContext;
}

describe("scanCountClaims: skill count", () => {
  it("flags a wrong skill count as WARNING", () => {
    const actual = SKILL_NAMES.length;
    const wrong = actual + 2;
    const findings = scanCountClaims(
      ".goat-flow/architecture.md",
      `We ship ${wrong} skills as of today.`,
    );
    const drift = findings.find((f) => f.rule === "skill-count-drift");
    assert.ok(drift, "expected skill-count drift");
    assert.equal(drift!.severity, "warning");
    assert.match(drift!.message, new RegExp(`${wrong} skills`));
    assert.match(drift!.message, new RegExp(`${actual}`));
  });

  it("does not flag the correct skill count", () => {
    const findings = scanCountClaims(
      ".goat-flow/architecture.md",
      `We ship ${SKILL_NAMES.length} skills.`,
    );
    assert.equal(findings.length, 0);
  });

  it("skips skill-count check on consumer docs outside goat-flow paths", () => {
    const wrong = SKILL_NAMES.length + 5;
    const findings = scanCountClaims(
      "README.md",
      `Our product teaches ${wrong} skills to new users.`,
    );
    const drift = findings.find((f) => f.rule === "skill-count-drift");
    assert.equal(
      drift,
      undefined,
      "skill-count-drift should not fire on README.md",
    );
  });
});

describe("scanCountClaims: harness and agent counts", () => {
  it("flags wrong harness check count", () => {
    const wrong = HARNESS_CHECKS.length + 5;
    const findings = scanCountClaims(
      "docs/x.md",
      `The ${wrong} checks across 5 concerns are deterministic.`,
    );
    assert.ok(findings.some((f) => f.rule === "harness-check-count-drift"));
  });

  it("flags wrong agent-per-check count", () => {
    const wrong = AGENT_CHECKS.length + 3;
    const findings = scanCountClaims(
      "docs/x.md",
      `${wrong} checks per configured agent.`,
    );
    assert.ok(findings.some((f) => f.rule === "agent-check-count-drift"));
  });

  it("flags wrong setup check count", () => {
    const wrong = SETUP_CHECKS.length + 1;
    const findings = scanCountClaims(
      "docs/x.md",
      `${wrong} checks on goat-flow-owned surfaces.`,
    );
    assert.ok(findings.some((f) => f.rule === "setup-check-count-drift"));
  });
});

describe("scanCountClaims: code-block guard", () => {
  it("does not flag counts inside a code block", () => {
    const text = [
      "```",
      `${SKILL_NAMES.length + 10} skills`,
      "```",
      "",
      `Actual: ${SKILL_NAMES.length} skills.`,
    ].join("\n");
    const findings = scanCountClaims(".goat-flow/architecture.md", text);
    assert.equal(findings.length, 0);
  });
});

describe("scanConcernCountClaims", () => {
  it("flags drift in **Context** (N) bullet prose", () => {
    const actual = CONTEXT_CHECKS.length;
    const wrong = actual + 1;
    const findings = scanConcernCountClaims(
      "docs/audit-and-quality.md",
      `- **Context** (${wrong}) - instruction file within limit, execution loop present`,
    );
    const drift = findings.find((f) => f.rule === "concern-count-drift-bullet");
    assert.ok(drift, "expected bullet-style concern drift finding");
    assert.match(drift!.message, /Context/);
    assert.match(drift!.message, new RegExp(`${actual}`));
  });

  it("flags drift in **Context checks (N):** narrative prose", () => {
    const actual = CONTEXT_CHECKS.length;
    const wrong = actual - 1;
    const findings = scanConcernCountClaims(
      "docs/harness-audit.md",
      `**Context checks (${wrong}):** here are the bullets.`,
    );
    assert.ok(
      findings.some((f) => f.rule === "concern-count-drift-checks-label"),
      "expected checks-label concern drift finding",
    );
  });

  it("flags drift in `Context: PASS (N/M)` sample inside a fenced block", () => {
    const actual = CONTEXT_CHECKS.length;
    const wrong = actual - 1;
    const text = [
      "Sample output:",
      "```",
      `  Context:                PASS (${wrong}/${wrong})`,
      "```",
    ].join("\n");
    const findings = scanConcernCountClaims("docs/audit-and-quality.md", text);
    const drift = findings.find(
      (f) => f.rule === "concern-sample-output-drift",
    );
    assert.ok(drift, "expected sample-output drift finding from fenced block");
    assert.equal(drift!.line, 3);
  });

  it("does not flag matching concern counts", () => {
    const actual = CONTEXT_CHECKS.length;
    const text = [
      `- **Context** (${actual}) - correct.`,
      `**Context checks (${actual}):** also correct.`,
      "```",
      `Context: PASS (${actual}/${actual})`,
      "```",
    ].join("\n");
    const findings = scanConcernCountClaims("docs/audit-and-quality.md", text);
    assert.equal(findings.length, 0);
  });

  it("does not flag bullet-style drift inside a fenced block (scanFenced=false for that check)", () => {
    const actual = CONTEXT_CHECKS.length;
    const wrong = actual + 5;
    const text = [
      "```markdown",
      `- **Context** (${wrong}) - this is an inert documentation example`,
      "```",
    ].join("\n");
    const findings = scanConcernCountClaims("docs/example.md", text);
    assert.equal(
      findings.find((f) => f.rule === "concern-count-drift-bullet"),
      undefined,
      "bullet pattern must not fire inside fenced blocks",
    );
  });
});

describe("scanRemovedCommands", () => {
  it("flags a dead CLI command in prose", () => {
    const findings = scanRemovedCommands(
      "docs/audit-and-quality.md",
      "Run `goat-flow quality capture --from-file <path>` after each review.",
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.rule, "removed-command-quality-capture");
    assert.equal(findings[0]!.severity, "warning");
  });

  it("flags a dead CLI command inside a fenced code block", () => {
    const text = [
      "```bash",
      "goat-flow quality capture --from-stdin",
      "```",
    ].join("\n");
    const findings = scanRemovedCommands("docs/harness-quality.md", text);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.rule, "removed-command-quality-capture");
    assert.equal(findings[0]!.line, 2);
  });

  it("does not flag unrelated content", () => {
    const findings = scanRemovedCommands(
      "README.md",
      "Capture agent output for quality review.",
    );
    assert.equal(findings.length, 0);
  });
});

describe("scanPathReferences", () => {
  it("flags a missing path as INFO", () => {
    const fs = stubFS(new Set());
    const findings = scanPathReferences(
      "architecture.md",
      "See `src/does/not/exist.ts` for details.",
      stubCtx(fs),
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.severity, "info");
    assert.equal(findings[0]!.rule, "path-ref-unresolved");
  });

  it("does not flag a resolvable path", () => {
    const fs = stubFS(new Set(["src/cli/cli.ts"]));
    const findings = scanPathReferences(
      "architecture.md",
      "Entry is `src/cli/cli.ts`.",
      stubCtx(fs),
    );
    assert.equal(findings.length, 0);
  });

  it("does not flag intentional gitignored local-state markers", () => {
    const fs = stubFS(new Set());
    const findings = scanPathReferences(
      "docs/dashboard.md",
      "Non-git projects use local `.goat-flow/project-id` dashboard state.",
      stubCtx(fs),
    );
    assert.equal(findings.length, 0);
  });

  it("skips glob patterns", () => {
    const fs = stubFS(new Set());
    const findings = scanPathReferences(
      "architecture.md",
      "Steps at `workflow/setup/0*.md`.",
      stubCtx(fs),
    );
    assert.equal(findings.length, 0);
  });

  it("skips templated path placeholders", () => {
    const fs = stubFS(new Set());
    const findings = scanPathReferences(
      "docs/skills.md",
      "Installed at `.agents/skills/goat-{name}/SKILL.md`.",
      stubCtx(fs),
    );
    assert.equal(findings.length, 0);
  });

  it("does not flag paths inside code blocks", () => {
    const fs = stubFS(new Set());
    const text = [
      "```",
      "`src/ghost.ts`",
      "```",
      "Real mention: `src/real.ts`",
    ].join("\n");
    const findings = scanPathReferences("architecture.md", text, stubCtx(fs));
    assert.equal(
      findings.length,
      1,
      "only outside-block path should be flagged",
    );
  });

  it("trims trailing punctuation from path candidates", () => {
    const fs = stubFS(new Set(["src/cli/cli.ts"]));
    const findings = scanPathReferences(
      "architecture.md",
      "See `src/cli/cli.ts`, and so on.",
      stubCtx(fs),
    );
    assert.equal(findings.length, 0);
  });
});

describe("runFactualClaimChecks", () => {
  it("scans docs/*.md path references, not just architecture/code-map", () => {
    const fs: ReadonlyFS = {
      exists: (p: string) => p === "docs/example.md",
      readFile: (p: string) =>
        p === "docs/example.md" ? "See `workflow/missing-doc.md`." : null,
      lineCount: () => 0,
      readJson: () => null,
      listDir: () => [],
      isExecutable: () => false,
      glob: (pattern: string) =>
        pattern === "docs/*.md" ? ["docs/example.md"] : [],
      existsGlob: (pattern: string) => pattern === "docs/*.md",
    };
    const { findings } = runFactualClaimChecks(stubCtx(fs));
    assert.ok(findings.some((f) => f.rule === "path-ref-unresolved"));
  });

  it("flags stale classify-state summaries in code-map", () => {
    const fs = stubFSFromFiles({
      ".goat-flow/code-map.md":
        "classify-state.ts          # Project adoption classifier (bare/partial/v0.9/v1.0/v1.1/error)\n",
      "src/cli/classify-state.ts":
        'export type ProjectStateName = "bare" | "partial" | "v0.9" | "outdated" | "current" | "error";\n',
    });
    const { findings } = runFactualClaimChecks(stubCtx(fs));
    assert.ok(findings.some((f) => f.rule === "code-map-state-drift"));
  });

  it("flags stale dashboard session-cap claims", () => {
    const fs = stubFSFromFiles({
      "docs/dashboard.md":
        "- Supports Claude, Codex, and Gemini runners\n- Sessions rail: up to 3\n",
      "src/cli/server/terminal.ts": "const MAX_SESSIONS = 7;\n",
    });
    const { findings } = runFactualClaimChecks(stubCtx(fs));
    assert.ok(findings.some((f) => f.rule === "dashboard-sessions-drift"));
  });

  it("flags stale dashboard view headings", () => {
    const fs = stubFSFromFiles({
      "docs/dashboard.md": [
        "## Views",
        "### Home",
        "### Help",
        "## Terminal",
      ].join("\n"),
    });
    const { findings } = runFactualClaimChecks(stubCtx(fs));
    assert.ok(findings.some((f) => f.rule === "dashboard-view-name-drift"));
  });

  it("flags stale dashboard idle-timeout claims", () => {
    const fs = stubFSFromFiles({
      "docs/dashboard.md": "- 60-minute idle timeout with auto-kill\n",
      "src/cli/server/terminal.ts":
        "const DEFAULT_IDLE_TIMEOUT_MINUTES = 480;\n",
    });
    const { findings } = runFactualClaimChecks(stubCtx(fs));
    assert.ok(findings.some((f) => f.rule === "dashboard-idle-timeout-drift"));
  });

  it("flags stale dashboard version references", () => {
    const fs = stubFSFromFiles({
      "docs/dashboard.md":
        "- Supports Claude, Codex, Gemini, and Copilot runners in v1.2.0\n",
    });
    const { findings } = runFactualClaimChecks(stubCtx(fs));
    assert.ok(
      findings.some((f) => f.rule === "dashboard-version-reference-drift"),
    );
  });

  it("does not flag the current dashboard runner list with natural-language commas", () => {
    const fs = stubFSFromFiles({
      "docs/dashboard.md":
        "- Supports Claude, Codex, Gemini, and Copilot runners\n- Sessions rail: up to 7\n",
      "src/cli/server/terminal.ts": "const MAX_SESSIONS = 7;\n",
    });
    const { findings } = runFactualClaimChecks(stubCtx(fs));
    assert.ok(!findings.some((f) => f.rule === "dashboard-runner-drift"));
  });

  it("flags stale public skill-contract phrases", () => {
    const fs = stubFSFromFiles({
      "docs/skills.md": [
        "Reviewers MUST read all files before commenting.",
        "This skill uses a 10-category checklist.",
        "MUST rank findings by exploitability.",
      ].join("\n"),
    });
    const { findings } = runFactualClaimChecks(stubCtx(fs));
    assert.ok(findings.some((f) => f.rule === "skills-review-contract-drift"));
    assert.ok(
      findings.some((f) => f.rule === "skills-security-contract-drift"),
    );
    assert.ok(findings.some((f) => f.rule === "skills-security-gate-drift"));
  });

  it("flags deferred ADR-020 while Copilot is in the manifest-backed runtime", () => {
    const fs = stubFSFromFiles({
      ".goat-flow/decisions/ADR-020-add-copilot-cli.md":
        "# ADR-020\n\n**Status:** Deferred\n",
    });
    const { findings } = runFactualClaimChecks(stubCtx(fs));
    assert.ok(findings.some((f) => f.rule === "adr020-copilot-drift"));
  });
});
