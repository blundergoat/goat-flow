/**
 * End-to-end audit entrypoint and helper-contract tests for a configured project.
 * Use these checks when users need reliable repo, external-project, and content-drift results.
 * Disposable prose fixtures keep manifest-backed skill guidance testable without editing live docs.
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
  CONSTRAINTS_CHECKS,
  FEEDBACK_LOOP_CHECKS,
  findSkillInventoryDrift,
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
 * Render the explicit skill subtree a user sees in the code map.
 * Extra rows can model folders such as editor notes that are not invokable skills.
 *
 * @param skillNames - invokable names shown as SKILL.md rows; empty input models an explicit but empty inventory
 * @param extraRows - non-skill rows shown beside the inventory; empty input adds no unrelated directories
 * @returns complete tree-shaped fixture text; never empty because the skills and hooks markers remain
 */
function codeMapSkillInventory(
  skillNames: ReadonlyArray<string>,
  extraRows: ReadonlyArray<string> = [],
): string {
  return [
    "├── skills/ = goat-* skill templates and shared skill docs",
    ...skillNames.map(
      (skillName) => `│   ├── ${skillName}/SKILL.md = fixture skill`,
    ),
    ...extraRows,
    "├── hooks/ = fixture hooks",
  ].join("\n");
}

/**
 * Render the glossary's explicit user-invokable skill row for one disposable content fixture.
 * Use when a named prose inventory must be compared with manifest-backed choices.
 *
 * @param skillNames - invokable names shown to the user; empty input advertises zero total
 * @returns one complete Markdown table row; never empty
 */
function glossarySkillInventory(skillNames: ReadonlyArray<string>): string {
  return (
    `| Skill | User-invokable capabilities (${skillNames.join(", ")} = ${skillNames.length} total) ` +
    "loaded on demand. | `docs/skills.md` | goat-* skills |"
  );
}

/**
 * Render the architecture's count-only skill-template claim, which cannot name one omitted skill.
 * Use when users are promised a total without a per-skill list.
 *
 * @param skillCount - advertised template total; zero explicitly tells users no skills exist
 * @returns one complete Markdown table row; never empty
 */
function architectureSkillInventory(skillCount: number): string {
  return `| Skill templates | \`workflow/skills/\` | Reference prompts for the ${skillCount} goat-flow skill templates |`;
}

/**
 * Build a narrow audit context for pure helper contracts.
 * Use when a unit test needs agent instruction visibility without a full project fixture.
 *
 * @param instructionFiles - manifest instruction files that should appear present; empty input models no installed instructions
 * @returns audit context with just the fields helper contracts read; its agents list is intentionally empty
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

/**
 * Assert every user-facing harness concern still has at least one registered check.
 * Use in the helper-contract smoke test to prevent an empty concern from appearing healthy.
 *
 * @returns nothing; assertion failure identifies a concern with no checks
 */
function assertHarnessCheckArraysPopulated(): void {
  assert.ok(CONSTRAINTS_CHECKS.length > 0);
  assert.ok(FEEDBACK_LOOP_CHECKS.length > 0);
  assert.ok(RECOVERY_CHECKS.length > 0);
  assert.ok(VERIFICATION_CHECKS.length > 0);
}

describe("audit on well-configured project", () => {
  it("warns only for stale explicit skill inventories", () => {
    const canonicalSkillNames = [...buildProjectStructure().skills.canonical];
    const inventoryWithoutClarity = canonicalSkillNames.filter(
      (skillName) => skillName !== "goat-clarity",
    );
    const futureCanonicalSkillNames = [...canonicalSkillNames, "goat-future"];

    const findings = [
      ...findSkillInventoryDrift(
        ".goat-flow/code-map.md",
        codeMapSkillInventory(inventoryWithoutClarity),
        canonicalSkillNames,
      ),
      ...findSkillInventoryDrift(
        ".goat-flow/glossary.md",
        glossarySkillInventory(canonicalSkillNames),
        futureCanonicalSkillNames,
      ),
      ...findSkillInventoryDrift(
        ".goat-flow/architecture.md",
        architectureSkillInventory(canonicalSkillNames.length),
        canonicalSkillNames,
      ),
      ...findSkillInventoryDrift(
        ".goat-flow/code-map.md",
        codeMapSkillInventory(canonicalSkillNames, [
          "│   ├── agent-notes/ = ordinary directory, not a skill",
        ]),
        canonicalSkillNames,
      ),
    ];

    assert.deepEqual(findings, [
      {
        severity: "warning",
        rule: "skill-inventory-drift",
        path: ".goat-flow/code-map.md",
        message:
          ".goat-flow/code-map.md omits manifest-canonical skill(s): goat-clarity.",
        suggestion:
          "Update the document's explicit skill inventory to match workflow/manifest.json skills.canonical.",
      },
      {
        severity: "warning",
        rule: "skill-inventory-drift",
        path: ".goat-flow/glossary.md",
        message:
          ".goat-flow/glossary.md omits manifest-canonical skill(s): goat-future.",
        suggestion:
          "Update the document's explicit skill inventory to match workflow/manifest.json skills.canonical.",
      },
    ]);
  });

  it("routes explicit skill inventories through the semantic audit", () => {
    const canonicalSkillNames = [...buildProjectStructure().skills.canonical];
    const inventoryWithoutClarity = canonicalSkillNames.filter(
      (skillName) => skillName !== "goat-clarity",
    );
    const codeMap = codeMapSkillInventory(inventoryWithoutClarity);
    const context = makeCtx({
      fs: stubFS({
        // Only the code map exists in this disposable project, so other optional semantic documents are skipped.
        readFile: (path) =>
          path === ".goat-flow/code-map.md" ? codeMap : null,
      }),
    });

    const report = scanSemanticDrift(context);
    assert.deepEqual(
      report.findings.filter(
        (finding) => finding.rule === "skill-inventory-drift",
      ),
      [
        {
          severity: "warning",
          rule: "skill-inventory-drift",
          path: ".goat-flow/code-map.md",
          message:
            ".goat-flow/code-map.md omits manifest-canonical skill(s): goat-clarity.",
          suggestion:
            "Update the document's explicit skill inventory to match workflow/manifest.json skills.canonical.",
        },
      ],
    );
    assert.equal(report.filesScanned, 1);
  });

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
    const externalProject = await makeTempProject(async () => {});
    try {
      const projectFilesystem = createFS(externalProject.root);
      const report = runAudit(projectFilesystem, externalProject.root, {
        agentFilter: null,
        harness: false,
      });
      assert.equal(report.command, "audit");
      assert.equal(report.target, externalProject.root);
      assert.ok(["pass", "fail"].includes(report.status));
    } finally {
      await externalProject.cleanup();
    }
  });

  it("keeps audit helper module contracts observable through focused assertions", () => {
    const auditContext = helperContractContext(["CLAUDE.md", "AGENTS.md"]);
    const provenance = labelEvidencePathBases(
      specProvenance(["workflow/manifest.json", "project/local.md"]),
    );

    assert.equal(shouldAutoRunDrift(auditContext), true);
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
      setupSummary(auditContext).skills,
      "0/1 installed (no supported agents)",
    );
    assert.equal(
      agentSummary(auditContext).hooks,
      "not applicable (no supported agents)",
    );
    assert.match(
      checkSelectedInstructionAvailable(auditContext, "Agent setup")?.message ??
        "",
      /Missing instruction file for codex/,
    );
    assert.equal(agentDenyMechanism.id, "agent-guardrails");
    assert.deepEqual(scanSemanticDrift(auditContext), {
      findings: [],
      filesScanned: 0,
    });
    assertHarnessCheckArraysPopulated();
    assert.equal(
      validateRegisteredCheckProvenance(createFS(PROJECT_ROOT)),
      undefined,
    );
  });
});
