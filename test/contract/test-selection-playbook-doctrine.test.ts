/**
 * Check test-selection guidance across the standalone playbook, goat-qa, and ordinary implementation routes.
 *
 * Users must receive consistent rules for regression value, existing coverage, test placement, and authorized action.
 * These contracts also protect installed templates, discovery links, and dashboard presets.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PLAYBOOK_PATHS = [
  "workflow/skills/playbooks/test-selection.md",
  ".goat-flow/skill-docs/playbooks/test-selection.md",
] as const;

const QA_ROOTS = [
  "workflow/skills/goat-qa",
  ".agents/skills/goat-qa",
  ".claude/skills/goat-qa",
  ".github/skills/goat-qa",
] as const;

const INSTRUCTION_SENTENCE =
  "Before creating, changing, reviewing, consolidating, moving, or pruning tests, read `.goat-flow/skill-docs/playbooks/test-selection.md`.";

// Apply one assertion to the canonical and installed standalone playbooks.
function assertForPlaybooks(
  assertion: (content: string, playbookPath: string) => void,
): void {
  // Apply each selection rule to both playbook copies so installation cannot weaken the user’s test policy.
  for (const playbookPath of PLAYBOOK_PATHS) {
    assertion(readFileSync(playbookPath, "utf8"), playbookPath);
  }
}

// Require anchors in the order the decision workflow uses them.
function assertOrdered(
  content: string,
  anchors: readonly string[],
  ownerPath: string,
): void {
  let previousOffset = -1;
  // Check the required sequence so evidence and value decisions precede recommendations about changing tests.
  for (const anchor of anchors) {
    const offset = content.indexOf(anchor);
    assert.ok(offset >= 0, `${ownerPath}: missing ordered anchor: ${anchor}`);
    assert.ok(
      offset > previousOffset,
      `${ownerPath}: out-of-order anchor: ${anchor}`,
    );
    previousOffset = offset;
  }
}

// Extract an exact backtick-delimited disposition set from one labelled line.
function dispositionSet(
  content: string,
  label: string,
  ownerPath: string,
): string[] {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = content.match(new RegExp(`^${escapedLabel}: ([^\\n]+)$`, "mu"));
  // A missing disposition label fails before an empty extraction can look like a valid set of allowed outcomes.
  assert.ok(match?.[1], `${ownerPath}: missing ${label}`);
  // No backtick values produces an empty set, which callers compare with the required dispositions.
  return [...match[1].matchAll(/`([^`]+)`/gu)].map((item) => item[1]);
}

// Read one named template block without combining the distinct output phases.
function templateBlock(content: string, heading: string): string {
  const start = content.indexOf(heading);
  assert.ok(start >= 0, `missing template heading: ${heading}`);
  const fenceStart = content.indexOf("```markdown", start + heading.length);
  assert.ok(fenceStart >= 0, `missing template fence: ${heading}`);
  const fenceEnd = content.indexOf("\n```", fenceStart + "```markdown".length);
  assert.ok(fenceEnd >= 0, `unclosed template fence: ${heading}`);
  return content.slice(start, fenceEnd);
}

describe("test-selection standalone doctrine", () => {
  it("starts with availability and follows the source-neutral decision route", () => {
    assertForPlaybooks((content, playbookPath) => {
      const firstH2 = content.match(/^## (.+)$/mu);
      assert.equal(firstH2?.[1], "Availability Check", playbookPath);
      assertOrdered(
        content,
        [
          "## Availability Check",
          "## Intent",
          "## Decision Route",
          "### 1. Establish behaviour, risk, and overlap",
          "### 2. Apply the four-part value gate",
          "### 3. Choose the cheapest trustworthy level",
          "### 4. Assign a disposition",
          "### 5. Revalidate before mutation",
          "## Antipatterns",
          "## Verification Gate",
          "## Related References",
        ],
        playbookPath,
      );
      assert.match(
        content,
        /creating, changing, reviewing, consolidating, moving, or pruning tests/iu,
        playbookPath,
      );
      assert.match(content, /without invoking `goat-qa`/u, playbookPath);
    });
  });

  it("requires all four value claims and lets sole valuable coverage earn KEEP", () => {
    assertForPlaybooks((content, playbookPath) => {
      assert.match(content, /plausible regression/iu, playbookPath);
      assert.match(content, /user or business impact/iu, playbookPath);
      assert.match(
        content,
        /current overlap[\s\S]+why other coverage is insufficient/iu,
        playbookPath,
      );
      assert.match(
        content,
        /stable behaviour[\s\S]+implementation detail/iu,
        playbookPath,
      );
      assert.match(content, /Generic or circular answers fail/u, playbookPath);
      assert.match(
        content,
        /sole valuable coverage[\s\S]+`KEEP`/u,
        playbookPath,
      );
    });
  });

  it("waives case rows only for selector-driven non-semantic clarity passes", () => {
    assertForPlaybooks((content, playbookPath) => {
      const normalized = content.replace(/\s+/gu, " ");
      // The comments-and-names-only lane must preserve every test contract before it can omit case-by-case decision rows.
      for (const requiredPhrase of [
        "explicit folder or file selector",
        "baseline, current bytes, and explicit request",
        "comments or docstrings, or local or private identifier spelling",
        "test case presence, stable identity, title, registration, and parametrized membership",
        "assertions, expectations, snapshots, and failure semantics",
        "fixture values, setup and teardown, mocks, stubs, fakes, data builders, and environment controls",
        "grouping, execution level, skip or focus state, coverage intent, observable output, and user-visible meaning",
        "a change to any preserved item is semantic and forces the full lane",
        "full case-level manifest and four-part value gate",
        "selected test-source units, selected spans, baseline and current identity, write set, and focused verification command",
        "reconcile every changed span and prove untouched bytes remain untouched",
        "waives only per-case value and disposition rows",
      ]) {
        assert.ok(
          normalized.toLowerCase().includes(requiredPhrase.toLowerCase()),
          `${playbookPath}: missing ${requiredPhrase}`,
        );
      }
      assert.match(
        normalized,
        /existing PR or uncommitted diff.*semantic test change.*equivalence is uncertain.*full case-level manifest/iu,
        playbookPath,
      );
    });
  });

  it("keeps creation and existing-test dispositions exact and asymmetric", () => {
    assertForPlaybooks((content, playbookPath) => {
      assert.deepEqual(
        dispositionSet(content, "Creation dispositions", playbookPath),
        [
          "ADD UNIT",
          "ADD INTEGRATION",
          "ADD END-TO-END/MANUAL",
          "SKIP",
          "UNRESOLVED",
        ],
        playbookPath,
      );
      assert.deepEqual(
        dispositionSet(content, "Existing-test dispositions", playbookPath),
        ["KEEP", "CONSOLIDATE", "MOVE LEVEL", "PRUNE CANDIDATE", "UNRESOLVED"],
        playbookPath,
      );
      assert.match(
        content,
        /Failing the creation gate[\s\S]+never authorizes delet/u,
        playbookPath,
      );
      assert.match(
        content,
        /Unresolved evidence keeps an existing test in place/u,
        playbookPath,
      );
    });
  });

  it("accounts explicitly for added, removed, and materially changed tests", () => {
    assertForPlaybooks((content, playbookPath) => {
      assert.deepEqual(
        dispositionSet(content, "Added-test dispositions", playbookPath),
        [
          "ADDED KEEP",
          "ADDED CONSOLIDATE",
          "ADDED MOVE LEVEL",
          "ADDED DROP CANDIDATE",
          "ADDED UNRESOLVED",
        ],
        playbookPath,
      );
      assert.deepEqual(
        dispositionSet(content, "Removed-test dispositions", playbookPath),
        ["REMOVAL SUPPORTED", "RESTORE", "REPLACE", "REMOVAL UNRESOLVED"],
        playbookPath,
      );
      // Each test-change category must reconcile completely so a review cannot omit an added, removed, changed, or relocated case.
      for (const equation of [
        "assessed_added = ADDED_KEEP + ADDED_CONSOLIDATE + ADDED_MOVE_LEVEL + ADDED_DROP_CANDIDATE + ADDED_UNRESOLVED",
        "assessed_removed = REMOVAL_SUPPORTED + RESTORE + REPLACE + REMOVAL_UNRESOLVED",
        "assessed_materially_changed = KEEP + CONSOLIDATE + MOVE_LEVEL + PRUNE_CANDIDATE + UNRESOLVED",
        "assessed_relocated = RELOCATED",
        "assessed_pr_or_uncommitted = assessed_added + assessed_removed + assessed_materially_changed + assessed_relocated",
      ]) {
        assert.ok(
          content.includes(equation),
          `${playbookPath}: missing ${equation}`,
        );
      }
      assert.match(
        content,
        /Equation identifiers write each disposition with underscores/u,
        playbookPath,
      );
      const normalizedContent = content.replace(/\s+/gu, " ");
      assert.match(
        normalizedContent,
        /rename-shaped pair with uncertain\s+identity[^.]*`ADDED UNRESOLVED`[^.]*`REMOVAL UNRESOLVED`/iu,
        playbookPath,
      );
      assert.match(
        content,
        /removed-test evidence[^.]*bound comparison\s+baseline[^.]*without fetching[^.]*worktree/iu,
        playbookPath,
      );
      assert.match(
        content,
        /removal remains unsupported until[^.]*replacement[^.]*passes/iu,
        playbookPath,
      );
      assert.match(
        content,
        /Every disposition is report-only[^.]*never authorizes[^.]*add[^.]*rewrite[^.]*restore[^.]*replace[^.]*move[^.]*consolidate[^.]*omit[^.]*delete[^.]*test/iu,
        playbookPath,
      );
    });
  });

  it("carries proven test relocations without fabricating additions or removals", () => {
    assertForPlaybooks((content, playbookPath) => {
      assert.deepEqual(
        dispositionSet(content, "Relocated-test state", playbookPath),
        ["RELOCATED"],
        playbookPath,
      );
      assert.match(
        content,
        /case-level anchor and assertion\s+equivalence[\s\S]+path or namespace rename/iu,
        playbookPath,
      );
      assert.match(
        content,
        /file similarity alone[\s\S]+not proof/iu,
        playbookPath,
      );
      assert.match(
        content,
        /uncertain[\s\S]+`ADDED UNRESOLVED`[\s\S]+`REMOVAL UNRESOLVED`/iu,
        playbookPath,
      );
      assert.ok(
        content.includes("assessed_relocated = RELOCATED"),
        `${playbookPath}: missing relocated-test equation`,
      );
      assert.ok(
        content.includes(
          "assessed_pr_or_uncommitted = assessed_added + assessed_removed + assessed_materially_changed + assessed_relocated",
        ),
        `${playbookPath}: PR accounting must include proven relocations`,
      );
    });
  });

  it("chooses the cheapest trustworthy proof level without automatic promotion", () => {
    assertForPlaybooks((content, playbookPath) => {
      // Every proof level must remain available so test selection can choose the cheapest trustworthy evidence.
      for (const level of [
        "Static analysis",
        "Unit",
        "Integration",
        "End-to-end or manual",
      ]) {
        assert.match(content, new RegExp(`\\*\\*${level}`, "u"), playbookPath);
      }
      assert.match(
        content,
        /lowest-cost level that proves the real contract/u,
        playbookPath,
      );
      assert.match(
        content,
        /rejected unit test[\s\S]+not automatically promoted/u,
        playbookPath,
      );
    });
  });

  it("treats mock choreography as structural unless it is the public protocol", () => {
    assertForPlaybooks((content, playbookPath) => {
      assert.match(
        content,
        /collaborator call counts, call order, and non-calls/iu,
        playbookPath,
      );
      assert.match(content, /mock graph/u, playbookPath);
      assert.match(content, /`STRUCTURAL`/u, playbookPath);
      assert.match(content, /named public protocol/u, playbookPath);
      assert.match(content, /no integration confidence/u, playbookPath);
    });
  });

  it("consolidates distinct regression stories before multiplying scenarios", () => {
    assertForPlaybooks((content, playbookPath) => {
      assert.match(
        content,
        /Consolidation before multiplication/iu,
        playbookPath,
      );
      assert.match(content, /distinct regression story/u, playbookPath);
      assert.match(
        content,
        /worked invariant[\s\S]+materially different boundaries/u,
        playbookPath,
      );
      assert.match(
        content,
        /parameterization[\s\S]+cannot hide scenario volume/u,
        playbookPath,
      );
    });
  });

  it("keeps deletion report-only and replacement-backed", () => {
    assertForPlaybooks((content, playbookPath) => {
      assert.match(
        content,
        /`CONSOLIDATE` and `MOVE LEVEL` keep the original until replacement coverage/u,
        playbookPath,
      );
      assert.match(
        content,
        /`PRUNE CANDIDATE`[\s\S]+why no replacement is required/u,
        playbookPath,
      );
      assert.match(content, /ordinary ACT re-reads/iu, playbookPath);
      assert.match(content, /report-only/u, playbookPath);
      assert.match(
        content,
        /before assigning any existing-test, added-test, or removed-test disposition/iu,
        playbookPath,
      );
      // Deletion guidance must preserve each named high-impact contract until its protection has been assessed.
      for (const protectedContract of [
        "authorization",
        "tenancy",
        "financial",
        "clinical",
        "date/time",
        "persisted-data",
        "external-contract",
        "reproduced-regression",
      ]) {
        assert.match(
          content,
          new RegExp(protectedContract.replace("/", "\\/"), "u"),
          playbookPath,
        );
      }
    });
  });

  it("uses volume only as a diagnostic and includes maintenance in value", () => {
    assertForPlaybooks((content, playbookPath) => {
      assert.match(content, /Volume is diagnostic only/u, playbookPath);
      assert.match(content, /no numeric quota/u, playbookPath);
      assert.match(content, /Maintenance is part of value/u, playbookPath);
      assert.match(
        content,
        /stable inputs and observable outcomes/u,
        playbookPath,
      );
      assert.match(
        content,
        /Do not add production seams, test-only abstractions, follow-up tickets, or developer justification forms/u,
        playbookPath,
      );
    });
  });

  it("records complete decisions, accounting, and material-change handoffs", () => {
    assertForPlaybooks((content, playbookPath) => {
      // A test-selection record needs every decision field so the next implementer can assess and preserve its evidence.
      for (const field of [
        "Disposition",
        "Regression and impact",
        "Current overlap",
        "Stable contract",
        "Chosen level",
        "Evidence status",
        "Owning surface",
        "Semantic anchor",
        "Handoff invariant and next check",
      ]) {
        assert.match(
          content,
          new RegExp(`\\| ${field} \\|`, "u"),
          playbookPath,
        );
      }
      assert.match(
        content,
        /assessed_existing = KEEP \+ CONSOLIDATE \+ MOVE LEVEL \+ PRUNE CANDIDATE \+ UNRESOLVED/u,
        playbookPath,
      );
      assert.match(
        content,
        /Incomplete evidence uses the matching `UNRESOLVED`, `ADDED UNRESOLVED`, or `REMOVAL UNRESOLVED`/u,
        playbookPath,
      );
      assert.match(
        content,
        /Record one row per assessed existing, added, removed, relocated, materially changed, or proposed test/iu,
        playbookPath,
      );
      assert.match(
        content,
        /Creation, existing-test, added-test, removed-test, and relocated-test states use the correct vocabulary/iu,
        playbookPath,
      );
      assert.match(
        content,
        /Disposition totals reconcile for the applicable selector and change states/iu,
        playbookPath,
      );
      assert.match(
        content,
        /Content hashes and persistent approval receipts are conditional/u,
        playbookPath,
      );
    });
  });
});

describe("goat-qa application of test-selection doctrine", () => {
  it("keeps all four skill and template roots byte-identical", () => {
    const canonicalSkill = readFileSync(`${QA_ROOTS[0]}/SKILL.md`, "utf8");
    const canonicalTemplates = readFileSync(
      `${QA_ROOTS[0]}/references/output-templates.md`,
      "utf8",
    );
    // Every installed QA skill and output template must match the canonical workflow users rely on.
    for (const qaRoot of QA_ROOTS.slice(1)) {
      assert.equal(
        readFileSync(`${qaRoot}/SKILL.md`, "utf8"),
        canonicalSkill,
        `${qaRoot}/SKILL.md drifted from the canonical root`,
      );
      assert.equal(
        readFileSync(`${qaRoot}/references/output-templates.md`, "utf8"),
        canonicalTemplates,
        `${qaRoot}/references/output-templates.md drifted from the canonical root`,
      );
    }
  });

  it("loads the owner without weakening risk, coverage, or actor boundaries", () => {
    // All QA copies must retain the report-only boundary and distinguish structural checks from behavioral evidence.
    for (const qaRoot of QA_ROOTS) {
      const skillPath = `${qaRoot}/SKILL.md`;
      const content = readFileSync(skillPath, "utf8");
      assert.match(content, /test-selection\.md/u, skillPath);
      assert.match(content, /It neither writes nor runs tests/u, skillPath);
      assert.match(content, /NEVER:[^\n]+Run or write tests/u, skillPath);
      assert.match(content, /### Exhaustive priority matrix/u, skillPath);
      assert.match(content, /STRUCTURAL is not BEHAVIOURAL/u, skillPath);
      assert.match(
        content,
        /Do not infer misalignment from high coverage alone or recommend deleting safety coverage/u,
        skillPath,
      );
      assert.match(
        content,
        /mock[\s\S]+`STRUCTURAL`[\s\S]+no integration confidence/iu,
        skillPath,
      );
      assert.match(content, /ordinary ACT[\s\S]+re-read/u, skillPath);
    }
  });

  // Each QA output phase needs its own selection record so decisions remain visible at the relevant handoff.
  for (const templateHeading of [
    "### Regression Guard mode",
    "### Standard mode - Phase 2 output",
    "### Standard mode - Phase 3 output",
    "### Audit mode",
    "### Audit post-gate plan",
  ]) {
    it(`adds a compact selection record to ${templateHeading}`, () => {
      // Check the selected output phase in every installation so no agent receives an incomplete handoff template.
      for (const qaRoot of QA_ROOTS) {
        const templatePath = `${qaRoot}/references/output-templates.md`;
        const block = templateBlock(
          readFileSync(templatePath, "utf8"),
          templateHeading,
        );
        assert.match(block, /Test-selection record/u, templatePath);
        // Every selection-record field must survive in this template so the user can assess the proposed test work.
        for (const field of [
          "Disposition",
          "Regression and impact",
          "Current overlap",
          "Stable contract",
          "Level",
          "Evidence status",
          "Owner or path and semantic anchor",
          "Handoff invariant and next check",
        ]) {
          assert.match(block, new RegExp(field, "u"), templatePath);
        }
      }
    });
  }
});

const ENROLLMENT_OWNERS = [
  {
    path: "workflow/manifest.json",
    required: [
      ".goat-flow/skill-docs/playbooks/test-selection.md",
      "workflow/skills/playbooks/test-selection.md",
    ],
  },
  {
    path: "workflow/install-goat-flow.sh",
    required: [
      "workflow/skills/playbooks/test-selection.md",
      ".goat-flow/skill-docs/playbooks/test-selection.md",
    ],
  },
  {
    path: "scripts/preflight-checks.sh",
    required: ["test-selection.md sync", "test-selection.md"],
  },
  {
    path: "workflow/setup/03-install-skills.md",
    required: [".goat-flow/skill-docs/playbooks/test-selection.md"],
  },
  {
    path: "workflow/skills/playbooks/README.md",
    required: ["[`test-selection.md`](./test-selection.md)"],
  },
  {
    path: ".goat-flow/skill-docs/playbooks/README.md",
    required: ["[`test-selection.md`](./test-selection.md)"],
  },
  {
    path: "src/cli/audit/artifact-templates.ts",
    required: ["test-selection.md"],
  },
  {
    path: "src/cli/audit/skill-docs-contract.ts",
    required: [".goat-flow/skill-docs/playbooks/test-selection.md"],
  },
  {
    path: "src/cli/prompt/compose-quality-agent-setup.ts",
    required: ["test-selection.md"],
  },
  {
    path: "test/fixtures/projects/index.ts",
    required: ["test-selection.md"],
  },
  {
    path: "test/integration/audit-build.test.ts",
    required: [".goat-flow/skill-docs/playbooks/test-selection.md"],
  },
  {
    path: "test/integration/audit-drift.helpers.ts",
    required: ["test-selection.md"],
  },
  {
    path: "test/integration/preamble-sync.test.ts",
    required: [
      "workflow/skills/playbooks/test-selection.md",
      ".goat-flow/skill-docs/playbooks/test-selection.md",
    ],
  },
  {
    path: "test/unit/playbook-contract.test.ts",
    required: [".goat-flow/skill-docs/playbooks/test-selection.md"],
  },
  {
    path: "test/contract/skill-hardening-contracts.test.ts",
    required: ["test-selection.md"],
  },
  { path: ".goat-flow/architecture.md", required: ["test-selection.md"] },
  { path: ".goat-flow/code-map.md", required: ["test-selection.md"] },
] as const;

describe("test-selection enrollment", () => {
  // Every discovery owner must point agents to the standalone test-selection playbook before they change tests.
  for (const owner of ENROLLMENT_OWNERS) {
    it(`enrolls the playbook in ${owner.path}`, () => {
      const content = readFileSync(owner.path, "utf8");
      // Check all required enrollment text so a partial reference cannot pass as a complete instruction route.
      for (const required of owner.required) {
        assert.ok(
          content.includes(required),
          `${owner.path}: missing ${required}`,
        );
      }
    });
  }
});

const INSTRUCTION_OWNERS = [
  "AGENTS.md",
  "CLAUDE.md",
  ".github/copilot-instructions.md",
  "workflow/setup/agents/antigravity.md",
  "workflow/setup/agents/claude.md",
  "workflow/setup/agents/codex.md",
  "workflow/setup/agents/copilot.md",
  "workflow/setup/reference/execution-loop.md",
  "workflow/setup/02-instruction-file.md",
] as const;

describe("ordinary implementation test-selection route", () => {
  // Each ordinary implementation entry point must route test work through the same selection policy.
  for (const ownerPath of INSTRUCTION_OWNERS) {
    it(`routes test work through the owner in ${ownerPath}`, () => {
      assert.ok(
        readFileSync(ownerPath, "utf8").includes(INSTRUCTION_SENTENCE),
        `${ownerPath}: missing exact test-selection route`,
      );
    });
  }

  it("registers the exact route with instruction parity", () => {
    const manifest = JSON.parse(
      readFileSync("workflow/manifest.json", "utf8"),
    ) as {
      instruction_file: {
        parity_phrases: Array<{ label: string; phrases: string[] }>;
      };
    };
    const testSelectionRule = manifest.instruction_file.parity_phrases.find(
      ({ label }) => label === "test-selection READ route",
    );

    assert.deepEqual(testSelectionRule?.phrases, [
      "Before creating, changing, reviewing, consolidating, moving, or pruning tests",
      ".goat-flow/skill-docs/playbooks/test-selection.md",
    ]);
  });
});

describe("QA-facing discovery and presets", () => {
  it("documents the value-led owner and report-only handoff", () => {
    const publicDocs = readFileSync("docs/skills.md", "utf8");
    assert.match(publicDocs, /test-selection\.md/u);
    assert.match(publicDocs, /value gate/u);
    assert.match(publicDocs, /overlap/u);
    assert.match(publicDocs, /disposition/u);
    assert.match(publicDocs, /report-only/u);
  });

  // Each testing preset must ask for evidence-backed selection rather than a preset number of test tasks.
  for (const presetId of [
    "walkthrough-with-testing",
    "test-regression",
    "test",
    "test-vs-code",
  ]) {
    it(`asks ${presetId} for value, overlap, placement, and disposition`, () => {
      const presets = JSON.parse(
        readFileSync("src/dashboard/preset-prompts.json", "utf8"),
      ) as Array<{ id: string; prompt: string }>;
      const preset = presets.find((candidate) => candidate.id === presetId);
      assert.ok(preset, `missing preset: ${presetId}`);
      assert.match(preset.prompt, /value/u, presetId);
      assert.match(preset.prompt, /overlap/u, presetId);
      assert.match(preset.prompt, /placement|level/u, presetId);
      assert.match(preset.prompt, /disposition/u, presetId);
      assert.doesNotMatch(
        preset.prompt,
        /\b\d+\s*-\s*\d+\s+(?:test )?tasks\b/iu,
        presetId,
      );
    });
  }
});

describe("test-selection source neutrality", () => {
  it("keeps shipped doctrine and M03-facing prose free of private residue", () => {
    const urlPattern = new RegExp("[a-z]+:" + "/" + "/", "iu");
    const privateHomePattern = new RegExp("/" + "home" + "/", "u");
    const privateReferencePattern = new RegExp("_refer" + "ence/", "u");
    const optionalPromptPattern = new RegExp(
      ["minimal-unit", "-test-agent", "-instructions-prompt"].join(""),
      "u",
    );
    const shippedPaths = [
      ...PLAYBOOK_PATHS,
      ...QA_ROOTS.flatMap((qaRoot) => [
        `${qaRoot}/SKILL.md`,
        `${qaRoot}/references/output-templates.md`,
      ]),
    ];
    // Shipped guidance must not carry private URLs, local paths, or session-specific prompts into a user’s project.
    for (const shippedPath of shippedPaths) {
      const content = readFileSync(shippedPath, "utf8");
      assert.doesNotMatch(content, urlPattern, shippedPath);
      assert.doesNotMatch(content, privateHomePattern, shippedPath);
      assert.doesNotMatch(content, privateReferencePattern, shippedPath);
      assert.doesNotMatch(content, optionalPromptPattern, shippedPath);
    }

    const publicDocs = readFileSync("docs/skills.md", "utf8");
    const qaDocsStart = publicDocs.indexOf("## /goat-qa");
    const qaDocsEnd = publicDocs.indexOf("\n## ", qaDocsStart + 1);
    const qaDocs = publicDocs.slice(
      qaDocsStart,
      qaDocsEnd < 0 ? undefined : qaDocsEnd,
    );
    // The public QA description must meet each portability rule independently.
    for (const pattern of [
      urlPattern,
      privateHomePattern,
      privateReferencePattern,
      optionalPromptPattern,
    ]) {
      assert.doesNotMatch(qaDocs, pattern, "docs/skills.md goat-qa section");
    }

    const presets = JSON.parse(
      readFileSync("src/dashboard/preset-prompts.json", "utf8"),
    ) as Array<{ id: string; prompt: string }>;
    const affectedPresetIds = new Set([
      "walkthrough-with-testing",
      "test-regression",
      "test",
      "test-vs-code",
    ]);
    // Inspect only the affected testing presets so the contract remains tied to the guidance this rollout owns.
    for (const preset of presets.filter((candidate) =>
      affectedPresetIds.has(candidate.id),
    )) {
      // Every affected preset must exclude each private-residue pattern before users can launch its prompt.
      for (const pattern of [
        urlPattern,
        privateHomePattern,
        privateReferencePattern,
        optionalPromptPattern,
      ]) {
        assert.doesNotMatch(preset.prompt, pattern, preset.id);
      }
    }
  });
});
