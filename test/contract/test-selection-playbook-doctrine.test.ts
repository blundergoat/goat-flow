/**
 * Locks value-led test selection across the standalone owner, goat-qa, and ordinary work.
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

/** Apply one assertion to the canonical and installed standalone playbooks. */
function assertForPlaybooks(
  assertion: (content: string, playbookPath: string) => void,
): void {
  for (const playbookPath of PLAYBOOK_PATHS) {
    assertion(readFileSync(playbookPath, "utf8"), playbookPath);
  }
}

/** Require anchors in the order the decision workflow uses them. */
function assertOrdered(
  content: string,
  anchors: readonly string[],
  ownerPath: string,
): void {
  let previousOffset = -1;
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

/** Extract an exact backtick-delimited disposition set from one labelled line. */
function dispositionSet(
  content: string,
  label: string,
  ownerPath: string,
): string[] {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = content.match(new RegExp(`^${escapedLabel}: ([^\\n]+)$`, "mu"));
  assert.ok(match?.[1], `${ownerPath}: missing ${label}`);
  return [...match[1].matchAll(/`([^`]+)`/gu)].map((item) => item[1]);
}

/** Read one named template block without combining the distinct output phases. */
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

  it("chooses the cheapest trustworthy proof level without automatic promotion", () => {
    assertForPlaybooks((content, playbookPath) => {
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
        /Incomplete evidence becomes `UNRESOLVED`/u,
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
    for (const qaRoot of QA_ROOTS.slice(1)) {
      assert.equal(readFileSync(`${qaRoot}/SKILL.md`, "utf8"), canonicalSkill);
      assert.equal(
        readFileSync(`${qaRoot}/references/output-templates.md`, "utf8"),
        canonicalTemplates,
      );
    }
  });

  it("loads the owner without weakening risk, coverage, or actor boundaries", () => {
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

  for (const templateHeading of [
    "### Regression Guard mode",
    "### Standard mode - Phase 2 output",
    "### Standard mode - Phase 3 output",
    "### Audit mode",
    "### Audit post-gate plan",
  ]) {
    it(`adds a compact selection record to ${templateHeading}`, () => {
      for (const qaRoot of QA_ROOTS) {
        const templatePath = `${qaRoot}/references/output-templates.md`;
        const block = templateBlock(
          readFileSync(templatePath, "utf8"),
          templateHeading,
        );
        assert.match(block, /Test-selection record/u, templatePath);
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
  for (const owner of ENROLLMENT_OWNERS) {
    it(`enrolls the playbook in ${owner.path}`, () => {
      const content = readFileSync(owner.path, "utf8");
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
  for (const ownerPath of INSTRUCTION_OWNERS) {
    it(`routes test work through the owner in ${ownerPath}`, () => {
      assert.ok(
        readFileSync(ownerPath, "utf8").includes(INSTRUCTION_SENTENCE),
        `${ownerPath}: missing exact test-selection route`,
      );
    });
  }

  it("registers the exact route with instruction parity", () => {
    const parityScript = readFileSync(
      "scripts/check-instruction-parity.mjs",
      "utf8",
    );
    assert.match(parityScript, /test-selection\.md/u);
    assert.match(
      parityScript,
      /creating, changing, reviewing, consolidating, moving, or pruning tests/u,
    );
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
    for (const preset of presets.filter((candidate) =>
      affectedPresetIds.has(candidate.id),
    )) {
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
