/**
 * Check the naming and placement guidance agents use to explain code responsibilities.
 *
 * Both shipped copies must preserve project vocabulary, compatibility checks, and complete rename accounting.
 * Use these contracts when changing how a clarity pass diagnoses or verifies names.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PLAYBOOK_ROOTS = [
  "workflow/skills/playbooks",
  ".goat-flow/skill-docs/playbooks",
] as const;

// Apply one doctrine assertion to the canonical and installed playbooks.
function assertForNamingPlaybook(
  assertion: (content: string, playbookPath: string) => void,
): void {
  // Check both shipped naming guides so each installation preserves the same responsibility and compatibility rules.
  for (const playbookRoot of PLAYBOOK_ROOTS) {
    const playbookPath = `${playbookRoot}/naming-and-placement.md`;
    assertion(readFileSync(playbookPath, "utf8"), playbookPath);
  }
}

// Require anchors to appear in the order a user must follow them.
function assertOrdered(
  content: string,
  anchors: readonly string[],
  playbookPath: string,
): void {
  let previousOffset = -1;
  // Require every step in order so an agent cannot rename code before completing its prerequisite checks.
  for (const anchor of anchors) {
    const offset = content.indexOf(anchor);
    assert.ok(
      offset >= 0,
      `${playbookPath}: missing ordered anchor: ${anchor}`,
    );
    assert.ok(
      offset > previousOffset,
      `${playbookPath}: out-of-order anchor: ${anchor}`,
    );
    previousOffset = offset;
  }
}

// Parse one normalized accounting equation into its right-hand units.
function equationTerms(
  content: string,
  leftHandUnit: string,
  playbookPath: string,
): string[] {
  const escapedUnit = leftHandUnit.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const equation = content.match(
    new RegExp(`^${escapedUnit}\\s*=\\s*([^\\n]+)$`, "mu"),
  );
  assert.ok(equation?.[1], `${playbookPath}: missing ${leftHandUnit} equation`);
  return equation[1].split("+").map((term) => term.trim().replace(/`/gu, ""));
}

describe("naming and placement playbook doctrine", () => {
  it("uses the ordered evidence-led route without granting structural authority", () => {
    assertForNamingPlaybook((content, playbookPath) => {
      assertOrdered(
        content,
        [
          "### 1. Resolve authority and baseline",
          "### 2. Trace the current system",
          "### 3. Diagnose placement",
          "### 4. Verify identifier claims",
          "### 5. Resolve or defer findings",
          "### 6. Route comment work",
          "### 7. Verify and report",
        ],
        playbookPath,
      );
      assert.match(
        content,
        /choose its proof before implementation/u,
        playbookPath,
      );
      assert.match(
        content,
        /does not authorize moves, guard removal, extraction, public renames, or behaviour changes/u,
        playbookPath,
      );
    });
  });

  it("reconciles files, reviewed work, and comment blocks without mixing units", () => {
    assertForNamingPlaybook((content, playbookPath) => {
      assert.deepEqual(
        equationTerms(content, "in_scope", playbookPath),
        ["reviewed", "explicitly_excluded", "inaccessible"],
        playbookPath,
      );
      assert.deepEqual(
        equationTerms(content, "reviewed", playbookPath),
        ["modified", "unchanged"],
        playbookPath,
      );
      assert.deepEqual(
        equationTerms(
          content,
          "existing_comment_blocks_reviewed",
          playbookPath,
        ),
        ["compliant_unchanged", "rewritten", "deleted", "deferred"],
        playbookPath,
      );
      assert.match(content, /New comments stay separate/u, playbookPath);
      assert.match(
        content,
        /Identifier and documentation ledgers name their own units/u,
        playbookPath,
      );
      assert.match(content, /Never add unlike units/u, playbookPath);
      assert.match(content, /visibility and symbol kind/u, playbookPath);
      assert.match(content, /`NOT_CHECKED`/u, playbookPath);
      assert.match(content, /zero whitespace-only churn/u, playbookPath);
      assert.match(content, /aggregate by file and rule/u, playbookPath);
    });
  });

  it("selects placement from responsibility, effect, and consumers before convention", () => {
    assertForNamingPlaybook((content, playbookPath) => {
      assert.match(
        content,
        /Responsibility, output or effect, and consumer layer select the candidate home before sibling convention/u,
        playbookPath,
      );
      assert.match(
        content,
        /belongs in X because it owns Y, returns or changes Z, and is consumed by W/u,
        playbookPath,
      );
      assert.match(content, /ledger or report/u, playbookPath);
      assert.match(content, /never compensating source prose/u, playbookPath);
      assert.match(
        content,
        /Placement diagnosis alone never authorizes a move/u,
        playbookPath,
      );
    });
  });

  it("treats role suffixes as project-governed semantic claims", () => {
    assertForNamingPlaybook((content, playbookPath) => {
      // Each role suffix needs an explicit meaning so a clearer-sounding name cannot imply behavior the code lacks.
      for (const role of [
        "Builder",
        "Factory",
        "Helper",
        "Action",
        "Updater",
      ]) {
        assert.match(content, new RegExp(`\\| ${role} \\|`, "u"), playbookPath);
      }
      assert.match(content, /illustrative, not exhaustive/u, playbookPath);
      assert.match(content, /project canon/u, playbookPath);
      assert.match(
        content,
        /inputs, output or effect, and prohibited behaviour/u,
        playbookPath,
      );
      assert.match(
        content,
        /Resolver, Manager, Processor, and `process`[\s\S]+only when/u,
        playbookPath,
      );
    });
  });

  it("verifies name claims at the truthful reader and compatibility boundary", () => {
    assertForNamingPlaybook((content, playbookPath) => {
      assert.match(content, /canonical project term/u, playbookPath);
      assert.match(content, /relevant reader and layer/u, playbookPath);
      assert.match(content, /stable known role/u, playbookPath);
      assert.match(
        content,
        /UI language below its truthful boundary/u,
        playbookPath,
      );
      assert.match(content, /Inspect producers and consumers/u, playbookPath);
      assert.match(content, /clearer false claim/u, playbookPath);
      assert.match(content, /Local or private renames/u, playbookPath);
      assert.match(content, /relevant test or check signature/u, playbookPath);
      assert.match(content, /Public or exported renames/u, playbookPath);
      // Renaming guidance must cover every consumer boundary that can retain or depend on the old spelling.
      for (const boundary of [
        "consumers",
        "reflection",
        "configuration",
        "serialization",
        "old-name residue",
      ]) {
        assert.match(content, new RegExp(boundary, "u"), playbookPath);
      }
    });
  });

  it("treats named arguments and serialized keys as public compatibility surfaces", () => {
    assertForNamingPlaybook((content, playbookPath) => {
      assert.match(
        content,
        /public or exported parameter name[\s\S]+named arguments[\s\S]+compatibility surface/iu,
        playbookPath,
      );
      assert.match(
        content,
        /serialized field[\s\S]+payload key[\s\S]+returned associative key[\s\S]+public contract/iu,
        playbookPath,
      );
      assert.match(
        content,
        /absence of current named-argument callers[\s\S]+not compatibility authority/iu,
        playbookPath,
      );
    });
  });

  it("keeps cardinality and time claims representation-true", () => {
    assertForNamingPlaybook((content, playbookPath) => {
      assert.match(content, /Singular names one object/u, playbookPath);
      assert.match(content, /plural or established collective/u, playbookPath);
      // Time names must distinguish representations that callers would otherwise interpret differently.
      for (const timeKind of [
        "instant",
        "wall-clock or display value",
        "timezone",
        "duration",
        "calendar interval",
      ]) {
        assert.match(content, new RegExp(timeKind, "u"), playbookPath);
      }
      assert.match(content, /`Utc`[\s\S]+normalized instant/u, playbookPath);
      assert.match(
        content,
        /Comments cannot rescue a false suffix/u,
        playbookPath,
      );
    });
  });

  it("classifies guards before separately authorized behaviour changes", () => {
    assertForNamingPlaybook((content, playbookPath) => {
      // Classify each kind of guard before deciding whether a behavior change needs separate authority.
      for (const guardClass of [
        "user-controlled absence",
        "legacy nullable input",
        "external or race failure",
        "impossible under a proven contract",
      ]) {
        assert.match(content, new RegExp(guardClass, "u"), playbookPath);
      }
      assert.match(content, /Keep the first three where needed/u, playbookPath);
      assert.match(content, /impossible case as a finding/u, playbookPath);
      assert.match(
        content,
        /Removal or replacement with an assertion is separate behaviour-affecting work/u,
        playbookPath,
      );
    });
  });

  it("keeps the exact primary defect vocabulary in reports and ledgers", () => {
    assertForNamingPlaybook((content, playbookPath) => {
      const primaryCodes = content.match(/^Primary codes:\s*([^\n]+)$/mu);
      assert.ok(primaryCodes?.[1], `${playbookPath}: missing primary code set`);
      assert.deepEqual(
        primaryCodes[1]
          .replace(/[.`]/gu, "")
          .split(",")
          .map((code) => code.trim()),
        ["PLACEMENT", "ROLE", "CLAIM", "TERM", "CARDINALITY", "TIME", "GUARD"],
        playbookPath,
      );
      assert.match(content, /optional secondary tags/u, playbookPath);
      assert.match(
        content,
        /never summed as independent defects/u,
        playbookPath,
      );
      assert.match(content, /report-only/u, playbookPath);
      assert.match(
        content,
        /never identifiers or source comments/u,
        playbookPath,
      );
    });
  });

  it("follows the shipped playbook structure and routes comments to their owner", () => {
    assertForNamingPlaybook((content, playbookPath) => {
      assertOrdered(
        content,
        [
          "## Availability Check",
          "## Intent",
          "## Safe Route",
          "## Antipatterns",
          "## Verification Gate",
          "## Related References",
        ],
        playbookPath,
      );
      assert.match(content, /illustrative shape/u, playbookPath);
      assert.match(
        content,
        /\[`code-comments\.md`\]\(\.\/code-comments\.md\)/u,
        playbookPath,
      );
      assert.doesNotMatch(
        content,
        /https?:\/\/|#[0-9]{3,}|\/home\/|_reference\/code-quality|\.goat-flow\/(?:plans|scratchpad)\//u,
        playbookPath,
      );
    });
  });
});

const ENROLLMENT_OWNERS = [
  {
    path: "workflow/manifest.json",
    required: [
      ".goat-flow/skill-docs/playbooks/naming-and-placement.md",
      "workflow/skills/playbooks/naming-and-placement.md",
    ],
  },
  {
    path: "workflow/install-goat-flow.sh",
    required: [
      "workflow/skills/playbooks/naming-and-placement.md",
      ".goat-flow/skill-docs/playbooks/naming-and-placement.md",
    ],
  },
  {
    path: "scripts/preflight-checks.sh",
    required: ["naming-and-placement.md sync", "naming-and-placement.md"],
  },
  {
    path: "workflow/setup/03-install-skills.md",
    required: [".goat-flow/skill-docs/playbooks/naming-and-placement.md"],
  },
  {
    path: "workflow/skills/playbooks/README.md",
    required: ["[`naming-and-placement.md`](./naming-and-placement.md)"],
  },
  {
    path: ".goat-flow/skill-docs/playbooks/README.md",
    required: ["[`naming-and-placement.md`](./naming-and-placement.md)"],
  },
  {
    path: "src/cli/audit/artifact-templates.ts",
    required: ["naming-and-placement.md"],
  },
  {
    path: "src/cli/audit/skill-docs-contract.ts",
    required: [".goat-flow/skill-docs/playbooks/naming-and-placement.md"],
  },
  {
    path: "src/cli/prompt/compose-quality-agent-setup.ts",
    required: ["naming-and-placement.md"],
  },
  {
    path: "test/fixtures/projects/index.ts",
    required: ["naming-and-placement.md"],
  },
  {
    path: "test/integration/audit-drift.helpers.ts",
    required: ["naming-and-placement.md"],
  },
] as const;

describe("naming and placement enrollment", () => {
  // Each discovery owner must expose the naming playbook so agents can find it before editing.
  for (const owner of ENROLLMENT_OWNERS) {
    it(`enrolls the playbook in ${owner.path}`, () => {
      const content = readFileSync(owner.path, "utf8");
      // Require every discovery phrase assigned to this owner so partial enrollment cannot satisfy the contract.
      for (const requiredText of owner.required) {
        assert.ok(
          content.includes(requiredText),
          `${owner.path}: missing ${requiredText}`,
        );
      }
    });
  }
});
