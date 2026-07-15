/**
 * Locks the local-data contract users rely on when sharing or promoting evidence.
 *
 * These checks keep runtime event kinds, local-state guides, and tool trust boundaries aligned.
 * Use them when adding an evidence producer or changing what a support artifact may expose.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EvidenceEventKind } from "../../src/cli/evidence/envelope.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");

const DOCUMENTED_EVENT_KINDS = {
  "terminal.create": "terminal.create",
  "terminal.delete": "terminal.delete",
  "terminal.upload": "terminal.upload",
  "terminal.send": "terminal.send",
  "prompt.launch": "prompt.launch",
  "prompt.send": "prompt.send",
  "audit.exec": "audit.exec",
  "audit.run": "audit.run",
  "setup.prompt": "setup.prompt",
  "quality.prompt": "quality.prompt",
  "index.regenerate": "index.regenerate",
  "project.save": "project.save",
  "project.remove": "project.remove",
  "project.switch": "project.switch",
  "hook.verify": "hook.verify",
} satisfies Record<EvidenceEventKind, EvidenceEventKind>;

const LOCAL_STATE_README_PAIRS = [
  [
    ".goat-flow/logs/events/README.md",
    "workflow/setup/reference/events-readme.md",
  ],
  [
    ".goat-flow/logs/quality/README.md",
    "workflow/setup/reference/quality-readme.md",
  ],
  [
    ".goat-flow/logs/critiques/README.md",
    "workflow/setup/reference/critiques-readme.md",
  ],
  [
    ".goat-flow/logs/review/README.md",
    "workflow/setup/reference/review-readme.md",
  ],
  [
    ".goat-flow/logs/security/README.md",
    "workflow/setup/reference/security-readme.md",
  ],
  [
    ".goat-flow/logs/sessions/README.md",
    "workflow/setup/reference/session-logs-readme.md",
  ],
  [".goat-flow/plans/README.md", "workflow/setup/reference/plans-readme.md"],
  [
    ".goat-flow/scratchpad/README.md",
    "workflow/setup/reference/scratchpad-readme.md",
  ],
] as const;

/** Read one repository-relative contract surface for exact semantic checks. */
function readContractFile(relativePath: string): string {
  return readFileSync(resolve(PROJECT_ROOT, relativePath), "utf-8");
}

/** Confirm one local-state guide tells users where its evidence can and cannot go next. */
function assertLocalStateGuide(relativePath: string): void {
  const readme = readContractFile(relativePath);
  assert.match(readme, /Local data contract:.*\.goat-flow\/architecture\.md/iu);
  assert.match(readme, /Promotion:/u);
}

describe("local data contract", () => {
  // Users need every runtime event in the canonical budget before a producer may emit it.
  it("budgets every EvidenceEventKind and defers unowned event families", () => {
    const architecture = readContractFile(".goat-flow/architecture.md");

    assert.match(architecture, /## Local Data and Evidence Budget/u);
    // A union addition must also add a visible event-budget row for maintainers.
    for (const eventKind of Object.values(DOCUMENTED_EVENT_KINDS)) {
      assert.ok(
        architecture.includes(`\`${eventKind}\``),
        `architecture must budget the literal event kind ${eventKind}`,
      );
    }
    assert.match(architecture, /route\/checkpoint\/promotion.*deferred/iu);
    assert.match(architecture, /other runtime event families.*deferred/iu);
  });

  describe("local-state guides", () => {
    // Each named case protects this workspace and the corresponding fresh-install template.
    for (const [installedReadme, setupTemplate] of LOCAL_STATE_README_PAIRS) {
      // Users get the same boundary whether they read an installed guide or its setup source.
      it(`links ${installedReadme} and its setup template to the contract`, () => {
        assertLocalStateGuide(installedReadme);
        assertLocalStateGuide(setupTemplate);
      });
    }
  });

  // Tool trust must stay explicit in both the installed policy and new-project seed.
  it("distinguishes user-level and project-level tool or MCP trust", () => {
    const policyPaths = [
      ".goat-flow/security-policy.md",
      "workflow/setup/reference/security-policy.md",
    ];

    // A policy omission would let external output look like durable project truth.
    for (const policyPath of policyPaths) {
      const policy = readContractFile(policyPath);
      assert.match(policy, /user-level/iu);
      assert.match(policy, /project-level/iu);
      assert.match(policy, /provenance/iu);
      assert.match(policy, /durable project knowledge/iu);
    }
  });
});
