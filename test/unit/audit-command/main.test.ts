/**
 * End-to-end audit entrypoint smoke tests: the audit passes on this well-configured repo, and audits an external
 * project root without throwing on package-root provenance paths.
 */
import {
  assert,
  createFS,
  describe,
  getRepoAudit,
  it,
  makeCtx,
  makeTempProject,
  PROJECT_ROOT,
  runAudit,
  stubFS,
} from "./helpers.js";
import { computeContent } from "../../../src/cli/audit/audit-content.js";
import { shouldAutoRunDrift } from "../../../src/cli/audit/audit-drift-policy.js";
import {
  labelEvidencePathBases,
  validateRegisteredCheckProvenance,
} from "../../../src/cli/audit/audit-provenance.js";
import { buildProjectStructure } from "../../../src/cli/audit/audit-structure.js";
import {
  agentSummary,
  setupSummary,
} from "../../../src/cli/audit/audit-summaries.js";
import {
  checkSelectedInstructionAvailable,
  incidentProvenance,
  specProvenance,
  uniquePaths,
} from "../../../src/cli/audit/check-agent-common.js";
import { agentDenyMechanism } from "../../../src/cli/audit/check-agent-deny-mechanism.js";
import { scanSemanticDrift } from "../../../src/cli/audit/check-factual-semantic-drift.js";
import { CONSTRAINTS_CHECKS } from "../../../src/cli/audit/harness/check-constraints.js";
import { FEEDBACK_LOOP_CHECKS } from "../../../src/cli/audit/harness/check-feedback-loop.js";
import { RECOVERY_CHECKS } from "../../../src/cli/audit/harness/check-recovery.js";
import { VERIFICATION_CHECKS } from "../../../src/cli/audit/harness/check-verification.js";
import type { AuditContext } from "../../../src/cli/audit/types.js";

/**
 * Build a narrow audit context for pure helper contracts.
 *
 * @param instructionFiles - manifest instruction files that should appear present
 * @returns audit context with just the fields the helper contracts read
 */
function helperContractContext(
  instructionFiles: ReadonlyArray<string>,
): AuditContext {
  return makeCtx({
    fs: stubFS({ exists: (path: string) => instructionFiles.includes(path) }),
    structure: {
      required_files: [],
      required_dirs: [],
      skills: { canonical: ["goat"], stale_names: [], references: {} },
      agents: {},
    },
    agents: [],
    agentFilter: "codex",
  });
}

/** Assert harness check arrays stay populated for every audit concern. */
function assertHarnessCheckArraysPopulated(): void {
  assert.ok(CONSTRAINTS_CHECKS.length > 0);
  assert.ok(FEEDBACK_LOOP_CHECKS.length > 0);
  assert.ok(RECOVERY_CHECKS.length > 0);
  assert.ok(VERIFICATION_CHECKS.length > 0);
}

describe("audit on well-configured project", () => {
  it("passes on this repo", () => {
    const report = getRepoAudit({ agentFilter: "claude", harness: false });
    assert.equal(report.command, "audit");
    assert.equal(
      report.status,
      "pass",
      `Expected pass but got failures: ${JSON.stringify(report.scopes)}`,
    );
    assert.equal(
      report.scopes.setup.status,
      "pass",
      `Setup failures: ${JSON.stringify(report.scopes.setup.failures)}`,
    );
  });

  it("audits an external project root without throwing on package-root provenance paths", async () => {
    const project = await makeTempProject(async () => {});
    try {
      const fs = createFS(project.root);
      const report = runAudit(fs, project.root, {
        agentFilter: null,
        harness: false,
      });
      assert.equal(report.command, "audit");
      assert.equal(report.target, project.root);
      assert.ok(["pass", "fail"].includes(report.status));
    } finally {
      await project.cleanup();
    }
  });

  it("keeps audit helper module contracts observable through focused assertions", () => {
    const ctx = helperContractContext(["CLAUDE.md", "AGENTS.md"]);
    const provenance = labelEvidencePathBases(
      specProvenance(["workflow/manifest.json", "project/local.md"]),
    );

    assert.equal(shouldAutoRunDrift(ctx), true);
    assert.deepEqual(provenance.framework_evidence_paths, [
      "workflow/manifest.json",
    ]);
    assert.deepEqual(provenance.target_evidence_paths, ["project/local.md"]);
    assert.equal(
      incidentProvenance([".goat-flow/learning-loop/footguns/hooks.md"])
        .source_type,
      "incident",
    );
    assert.deepEqual(uniquePaths(["a.md", "a.md", "b.md"]), ["a.md", "b.md"]);
    assert.equal(
      buildProjectStructure().skills.canonical.includes("goat"),
      true,
    );
    assert.equal(
      setupSummary(ctx).skills,
      "0/1 installed (no supported agents)",
    );
    assert.equal(
      agentSummary(ctx).hooks,
      "not applicable (no supported agents)",
    );
    assert.match(
      checkSelectedInstructionAvailable(ctx, "Agent setup")?.message ?? "",
      /Missing instruction file for codex/,
    );
    assert.equal(agentDenyMechanism.id, "agent-guardrails");
    assert.deepEqual(scanSemanticDrift(ctx), { findings: [], filesScanned: 0 });
    assert.equal(typeof computeContent, "function");
    assertHarnessCheckArraysPopulated();
    assert.equal(
      validateRegisteredCheckProvenance(createFS(PROJECT_ROOT)),
      undefined,
    );
  });
});
