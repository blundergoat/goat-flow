/**
 * Exercises the standalone-playbook contract exposed through `goat-flow audit`.
 * Use these fixtures when authors change playbook shape or registration rules.
 * Negative cases prove users receive a precise failure before malformed guidance
 * reaches an installed project, while the healthy case protects existing packs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SETUP_CHECKS } from "../../src/cli/audit/check-goat-flow.js";
import { AUDIT_VERSION } from "../../src/cli/constants.js";
import { makeCtx, stubFS } from "../fixtures/projects/index.js";
import { assertExists } from "../helpers/assert-exists.js";

const standalonePlaybookPaths = [
  ".goat-flow/skill-docs/playbooks/browser-use.md",
  ".goat-flow/skill-docs/playbooks/changelog.md",
  ".goat-flow/skill-docs/playbooks/code-comments.md",
  ".goat-flow/skill-docs/playbooks/gruff-code-quality.md",
  ".goat-flow/skill-docs/playbooks/observability.md",
  ".goat-flow/skill-docs/playbooks/page-capture.md",
  ".goat-flow/skill-docs/playbooks/release-notes.md",
  ".goat-flow/skill-docs/playbooks/skill-playbook-authoring-sync.md",
] as const;

const playbookContractCheck = SETUP_CHECKS.find(
  (check) => check.id === "instruction-file-skill-docs-pointer",
);
assertExists(playbookContractCheck);

/** Provide the READ rule and router pointer expected in every agent instruction file. */
function compliantInstructionText(): string {
  return `# Agent instructions

## READ
Before declaring any tool or capability unavailable, read .goat-flow/skill-docs/playbooks/ and run its Availability Check.

## Router Table
| Skill playbooks | .goat-flow/skill-docs/playbooks/ |
`;
}

/** Build one valid reference playbook users can discover and load on demand. */
function compliantPlaybookText(title: string): string {
  return `---
goat-flow-reference-version: "${AUDIT_VERSION}"
---
# ${title}

## Availability Check

Load this documentary reference when its named authoring task begins.
`;
}

/** Render the installed README table that lets users discover every registered playbook. */
function compliantPlaybookReadme(): string {
  const tableRows = standalonePlaybookPaths.map((playbookPath) => {
    const filename = playbookPath.split("/").at(-1) ?? playbookPath;
    return `| [\`${filename}\`](./${filename}) | Contract fixture | n/a |`;
  });
  return `---
goat-flow-reference-version: "${AUDIT_VERSION}"
---
# Skill Playbooks

## Available playbooks

| Playbook | When to use | Tool / capability |
|---|---|---|
${tableRows.join("\n")}
`;
}

/**
 * Build a healthy audit context with optional file-content overrides.
 * Empty override text means the user has an empty, invalid installed file.
 */
function playbookContractContext(
  fileOverrides: Readonly<Record<string, string>> = {},
) {
  const instructionPaths = new Set([
    "CLAUDE.md",
    "AGENTS.md",
    ".github/copilot-instructions.md",
  ]);
  return makeCtx({
    fs: stubFS({
      readFile: (path) => {
        // A targeted fixture lets the user see the exact contract failure under test.
        if (Object.hasOwn(fileOverrides, path))
          return fileOverrides[path] ?? "";
        // Every present instruction file needs the same playbook discovery rule.
        if (instructionPaths.has(path)) return compliantInstructionText();
        // The README is the user-facing discovery surface for registered playbooks.
        if (path === ".goat-flow/skill-docs/playbooks/README.md") {
          return compliantPlaybookReadme();
        }
        // Registered playbooks default to valid so each negative test isolates one defect.
        if (
          standalonePlaybookPaths.includes(
            path as (typeof standalonePlaybookPaths)[number],
          )
        ) {
          return compliantPlaybookText(path);
        }
        return "# Fixture\n";
      },
    }),
  });
}

describe("standalone playbook audit contract", () => {
  it("fails when a registered playbook has no version frontmatter", () => {
    const result = playbookContractCheck.run(
      playbookContractContext({
        ".goat-flow/skill-docs/playbooks/browser-use.md":
          "# Browser\n\n## Availability Check\n",
      }),
    );

    assertExists(result);
    assert.match(result.message, /frontmatter/i);
    assert.match(result.message, /browser-use\.md/);
  });

  it("fails when Availability Check is not the first H2", () => {
    const result = playbookContractCheck.run(
      playbookContractContext({
        ".goat-flow/skill-docs/playbooks/browser-use.md": `---
goat-flow-reference-version: "${AUDIT_VERSION}"
---
# Browser

## Intent

Observe a page.

## Availability Check
`,
      }),
    );

    assertExists(result);
    assert.match(result.message, /first H2/i);
    assert.match(result.message, /browser-use\.md/);
  });

  it("fails when the README omits a registered playbook row", () => {
    const result = playbookContractCheck.run(
      playbookContractContext({
        ".goat-flow/skill-docs/playbooks/README.md": `---
goat-flow-reference-version: "${AUDIT_VERSION}"
---
# Skill Playbooks

## Available playbooks

| Playbook | When to use | Tool / capability |
|---|---|---|
`,
      }),
    );

    assertExists(result);
    assert.match(result.message, /README/i);
    assert.match(result.message, /browser-use\.md/);
  });

  it("passes when every registered playbook satisfies the contract", () => {
    assert.equal(playbookContractCheck.run(playbookContractContext()), null);
  });
});
