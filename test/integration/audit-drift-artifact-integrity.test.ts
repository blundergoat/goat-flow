/**
 * Artifact-integrity pressure tests for the drift and factual-content audits.
 * Use these fixtures when changing skill packaging so users receive complete,
 * uniquely named workflow artifacts without stale files or retired commands.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runFactualClaimChecks } from "../../src/cli/audit/check-factual-claims.js";
import { findDuplicateArtifactIds } from "../../src/cli/audit/check-artifact-integrity.js";
import type { AuditContext } from "../../src/cli/audit/types.js";
import {
  checkDrift,
  createFS,
  getInstalledSkillRoots,
  setupFixture,
} from "./audit-drift.helpers.ts";

/**
 * Write one matching skill contract to the canonical source and every installed mirror.
 * Use when a fixture must isolate identity or reference integrity from ordinary content drift.
 *
 * @param fixtureRoot - temporary project root; an empty path is invalid because no fixture exists
 * @param skillName - canonical skill directory; an empty name means there is no skill to update
 * @param skillMarkdown - complete user-facing skill contract; empty text creates an intentionally blank contract
 */
function writeMatchingSkillContract(
  fixtureRoot: string,
  skillName: string,
  skillMarkdown: string,
): void {
  writeFileSync(
    join(fixtureRoot, "workflow", "skills", skillName, "SKILL.md"),
    skillMarkdown,
  );

  // Every installed agent should see the same fixture contract, so only artifact integrity can fail.
  for (const installedSkillRoot of getInstalledSkillRoots()) {
    writeFileSync(
      join(fixtureRoot, installedSkillRoot, skillName, "SKILL.md"),
      skillMarkdown,
    );
  }
}

/**
 * Run drift against one temporary project and return its findings.
 * Use after arranging a fixture to observe exactly what an audit user would receive.
 *
 * @param fixtureRoot - temporary project root; an empty path means the audit has no project to inspect
 * @returns drift findings shown to the user; empty means the arranged fixture is accepted
 */
function driftFindings(fixtureRoot: string) {
  return checkDrift({
    fs: createFS(fixtureRoot),
    projectPath: fixtureRoot,
    templateRoot: fixtureRoot,
  }).findings;
}

/**
 * Add retired skill and shared Markdown to an otherwise current installed fixture.
 * Use to reproduce upgrades that merged new files without pruning old user guidance;
 * writes two temporary Markdown files that the caller removes with the fixture root.
 *
 * @param fixtureRoot - temporary project root; empty means no installed mirrors can be arranged
 */
function writeStaleInstalledArtifacts(fixtureRoot: string): void {
  const staleSkillReference = join(
    fixtureRoot,
    ".agents",
    "skills",
    "goat",
    "references",
    "retired.md",
  );
  mkdirSync(dirname(staleSkillReference), { recursive: true });
  writeFileSync(staleSkillReference, "# retired\n");
  const staleSharedReference = join(
    fixtureRoot,
    ".goat-flow",
    "skill-docs",
    "playbooks",
    "retired.md",
  );
  writeFileSync(staleSharedReference, "# retired\n");
}

describe("checkDrift: artifact integrity", () => {
  it("reports duplicate command identifiers with the canonical registry path", () => {
    const findings = findDuplicateArtifactIds(
      ["audit", "quality", "audit"],
      "src/cli/cli-types.ts",
      "active command ID",
    );

    assert.deepEqual(findings, [
      {
        kind: "content",
        path: "src/cli/cli-types.ts",
        message:
          'duplicate active command ID "audit" appears 2 times in src/cli/cli-types.ts',
      },
    ]);
  });

  it("reports a skill frontmatter name that differs from its directory", () => {
    const fixtureRoot = setupFixture();
    try {
      writeMatchingSkillContract(
        fixtureRoot,
        "goat-debug",
        "---\nname: renamed-debug\ndescription: fixture\n---\n# renamed\n",
      );

      const findings = driftFindings(fixtureRoot);
      assert.equal(
        findings.some(
          (finding) =>
            finding.path === "workflow/skills/goat-debug/SKILL.md" &&
            finding.message.includes("frontmatter name") &&
            finding.message.includes("goat-debug"),
        ),
        true,
        `expected frontmatter/directory finding, got ${JSON.stringify(findings)}`,
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("reports duplicate skill frontmatter names with both canonical sources", () => {
    const fixtureRoot = setupFixture();
    try {
      writeMatchingSkillContract(
        fixtureRoot,
        "goat-debug",
        "---\nname: goat\ndescription: fixture\n---\n# duplicate\n",
      );

      const findings = driftFindings(fixtureRoot);
      assert.equal(
        findings.some(
          (finding) =>
            finding.message.includes("duplicate skill frontmatter name") &&
            finding.message.includes("workflow/skills/goat/SKILL.md") &&
            finding.message.includes("workflow/skills/goat-debug/SKILL.md"),
        ),
        true,
        `expected duplicate-name finding, got ${JSON.stringify(findings)}`,
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("reports a missing resource named inside a skill contract", () => {
    const fixtureRoot = setupFixture();
    try {
      writeMatchingSkillContract(
        fixtureRoot,
        "goat",
        "---\nname: goat\ndescription: fixture\n---\n# goat\nRead `references/missing-guide.md`.\n",
      );

      const findings = driftFindings(fixtureRoot);
      assert.equal(
        findings.some(
          (finding) =>
            finding.path ===
              "workflow/skills/goat/references/missing-guide.md" &&
            finding.message.includes("workflow/skills/goat/SKILL.md"),
        ),
        true,
        `expected missing-resource finding, got ${JSON.stringify(findings)}`,
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("resolves installed shared-document paths through the explicit mirror map", () => {
    const fixtureRoot = setupFixture();
    try {
      writeMatchingSkillContract(
        fixtureRoot,
        "goat",
        "---\nname: goat\ndescription: fixture\n---\n# goat\nRead `.goat-flow/skill-docs/skill-quality-testing/README.md`.\n",
      );

      const findings = driftFindings(fixtureRoot);
      assert.equal(
        findings.some(
          (finding) =>
            finding.path ===
            "workflow/skills/playbooks/skill-quality-testing/README.md",
        ),
        false,
        `expected explicit mirror mapping to resolve the shared README, got ${JSON.stringify(findings)}`,
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("reports stale installed skill and shared-reference files", () => {
    const fixtureRoot = setupFixture();
    try {
      writeStaleInstalledArtifacts(fixtureRoot);

      const findings = driftFindings(fixtureRoot);
      assert.equal(
        findings.some(
          (finding) =>
            finding.path === ".agents/skills/goat/references/retired.md",
        ),
        true,
        `expected stale skill-reference finding, got ${JSON.stringify(findings)}`,
      );
      assert.equal(
        findings.some(
          (finding) =>
            finding.path === ".goat-flow/skill-docs/playbooks/retired.md",
        ),
        true,
        `expected stale shared-reference finding, got ${JSON.stringify(findings)}`,
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("reports a canonical shared file that has no source-to-install mapping", () => {
    const fixtureRoot = setupFixture();
    try {
      writeFileSync(
        join(fixtureRoot, "workflow", "skills", "playbooks", "unmapped.md"),
        "# unmapped\n",
      );

      const findings = driftFindings(fixtureRoot);
      assert.equal(
        findings.some(
          (finding) =>
            finding.path === "workflow/skills/playbooks/unmapped.md" &&
            finding.message.includes("no installed mirror mapping"),
        ),
        true,
        `expected unmapped-source finding, got ${JSON.stringify(findings)}`,
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("reports a retired top-level command taught in current documentation", () => {
    const fixtureRoot = setupFixture();
    try {
      writeFileSync(
        join(fixtureRoot, "README.md"),
        "# Fixture\n\nStable goat-flow check IDs drive SARIF.\n\nRun `goat-flow scan .` to inspect the project.\n",
      );
      const context = {
        projectPath: fixtureRoot,
        fs: createFS(fixtureRoot),
      } as AuditContext;

      const report = runFactualClaimChecks(context);
      assert.deepEqual(
        report.findings
          .filter((finding) => finding.rule.startsWith("removed-command-"))
          .map((finding) => finding.rule),
        ["removed-command-scan"],
        `expected only the invoked retired command to fail, got ${JSON.stringify(report.findings)}`,
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("does not treat an active command with a retired-command prefix as removed", () => {
    const fixtureRoot = setupFixture();
    try {
      writeFileSync(
        join(fixtureRoot, "README.md"),
        "# Fixture\n\nRun `goat-flow scan-report .` to inspect the saved report.\n",
      );
      const context = {
        projectPath: fixtureRoot,
        fs: createFS(fixtureRoot),
      } as AuditContext;

      const report = runFactualClaimChecks(context);
      assert.equal(
        report.findings.some(
          (finding) => finding.rule === "removed-command-scan",
        ),
        false,
        `command prefix produced a removed-command finding: ${JSON.stringify(report.findings)}`,
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
