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
import {
  agentDenyMechanism,
  agentSummary,
  buildProjectStructure,
  checkSelectedInstructionAvailable,
  computeContent,
  CONSTRAINTS_CHECKS,
  FEEDBACK_LOOP_CHECKS,
  incidentProvenance,
  labelEvidencePathBases,
  RECOVERY_CHECKS,
  scanSemanticDrift,
  setupSummary,
  shouldAutoRunDrift,
  specProvenance,
  uniquePaths,
  validateRegisteredCheckProvenance,
  VERIFICATION_CHECKS,
} from "../../src.js";
import type { AuditContext } from "../../src.js";

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
