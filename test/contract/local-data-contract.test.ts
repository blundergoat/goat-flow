/**
 * Locks the local-data contract users rely on when sharing or promoting evidence.
 *
 * These checks keep runtime event kinds, local-state guides, and tool trust boundaries aligned.
 * Use them when adding an evidence producer or changing what a support artifact may expose.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REQUIRED_GOAT_FLOW_GITIGNORE_PATTERNS } from "../../src/cli/audit/check-goat-flow.js";
import type { EvidenceEventKind } from "../../src/cli/evidence/envelope.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");

const DECISION_PLAN_VERSION_PATTERNS = [
  String.raw`\b(\d+\.\d+\.\d+)\s+M\d+\b`,
  String.raw`\b(\d+\.\d+\.\d+)\s+backlog\b`,
  String.raw`\.goat-flow\/plans\/(\d+\.\d+\.\d+)\/`,
] as const;

type SemanticVersion = readonly [number, number, number];

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
  "quality.persisted": "quality.persisted",
  "quality.rejected": "quality.rejected",
  "index.regenerate": "index.regenerate",
  "project.save": "project.save",
  "project.remove": "project.remove",
  "project.switch": "project.switch",
  "hook.verify": "hook.verify",
  "plan.time": "plan.time",
} satisfies Record<EvidenceEventKind, EvidenceEventKind>;

const LOCAL_STATE_README_ENTRIES = [
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

/** Manifest fields that define whether coordination state is local, created, and non-persistent. */
interface LocalDataManifestContract {
  required_files: string[];
  required_dirs: string[];
  directory_purposes: Record<string, string>;
}

/** Read one repository-relative contract surface for exact semantic checks. */
function readContractFile(relativePath: string): string {
  return readFileSync(resolve(PROJECT_ROOT, relativePath), "utf-8");
}

/** Parse package and plan versions for the ownership contract; throws an assertion error for malformed input. */
function parseSemanticVersion(version: string): SemanticVersion {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(version);
  assert.ok(match, `expected a semantic version, received ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Return whether one plan version is newer than the package that could own it. */
function isFutureVersion(
  candidate: SemanticVersion,
  current: SemanticVersion,
): boolean {
  if (candidate[0] !== current[0]) return candidate[0] > current[0];
  if (candidate[1] !== current[1]) return candidate[1] > current[1];
  return candidate[2] > current[2];
}

/** Find version-qualified plan ownership claims without rejecting historical provenance. */
function decisionPlanVersionReferences(
  decision: string,
): Array<{ text: string; version: string }> {
  return DECISION_PLAN_VERSION_PATTERNS.flatMap((pattern) =>
    [...decision.matchAll(new RegExp(pattern, "giu"))].map((match) => {
      assert.ok(match[1], `plan reference is missing a version: ${match[0]}`);
      return { text: match[0], version: match[1] };
    }),
  );
}

/**
 * Confirm the architecture budget lists every runtime event kind by name.
 * Use when a producer gains a new event: the budget row is what tells a maintainer
 * the event is allowed to be emitted at all.
 *
 * @param architecture - text of the architecture contract; missing rows fail per event kind
 */
function assertEveryEventKindBudgeted(architecture: string): void {
  // A union addition must also add a visible event-budget row for maintainers.
  for (const eventKind of Object.values(DOCUMENTED_EVENT_KINDS)) {
    assert.ok(
      architecture.includes(`\`${eventKind}\``),
      `architecture must budget the literal event kind ${eventKind}`,
    );
  }
}

/** Confirm one local-state guide tells users where its evidence can and cannot go next. */
function assertLocalStateGuide(relativePath: string): void {
  const readme = readContractFile(relativePath);
  assert.match(readme, /Local data contract:.*\.goat-flow\/architecture\.md/iu);
  assert.match(readme, /Promotion:/u);
}

describe("local data contract", () => {
  // Accepted and implemented ADRs may cite package-or-earlier provenance.
  // A higher local plan version is a dead durable owner and fails this contract.
  it("keeps future local plan versions out of accepted decision ownership", () => {
    const manifest = JSON.parse(readContractFile("package.json")) as {
      version?: unknown;
    };
    assert.equal(typeof manifest.version, "string");
    const currentVersion = parseSemanticVersion(manifest.version);
    const decisionsDirectory = resolve(
      PROJECT_ROOT,
      ".goat-flow/learning-loop/decisions",
    );
    const violations = readdirSync(decisionsDirectory)
      .filter((fileName) => /^ADR-\d{3}-.+\.md$/u.test(fileName))
      .sort()
      .flatMap((fileName) => {
        const decision = readFileSync(
          resolve(decisionsDirectory, fileName),
          "utf-8",
        );
        if (
          !/^\*\*Status:\*\*\s+(?:Accepted|Implemented)\s*$/mu.test(decision)
        ) {
          return [];
        }
        return decisionPlanVersionReferences(decision)
          .filter((reference) =>
            isFutureVersion(
              parseSemanticVersion(reference.version),
              currentVersion,
            ),
          )
          .map((reference) => `${fileName}: ${reference.text}`);
      });

    assert.deepEqual(violations, []);
  });

  // Users need every runtime event in the canonical budget before a producer may emit it.
  it("budgets every EvidenceEventKind and defers unowned event families", () => {
    const architecture = readContractFile(".goat-flow/architecture.md");

    assert.match(architecture, /## Local Data and Evidence Budget/u);
    assertEveryEventKindBudgeted(architecture);
    assert.match(architecture, /route\/checkpoint\/promotion.*deferred/iu);
    assert.match(architecture, /other runtime event families.*deferred/iu);
  });

  // A claim must be locally available to cooperating writers without becoming durable evidence or an age-based cleanup target.
  it("registers path-write claims as transient fail-closed coordination", () => {
    const architecture = readContractFile(".goat-flow/architecture.md");
    const manifest = JSON.parse(
      readContractFile("workflow/manifest.json"),
    ) as LocalDataManifestContract;
    const template = readContractFile(
      "workflow/setup/reference/goat-flow-gitignore",
    );
    const installedGitignore = readContractFile(".goat-flow/.gitignore");
    const installer = readContractFile("workflow/install-goat-flow.sh");
    const claimDirectory = ".goat-flow/write-claims/";
    const ignorePattern = "**/write-claims/";

    assert.match(
      architecture,
      /\*\*Local coordination state\*\*.*`\.goat-flow\/write-claims\/\*\.claim`.*do not expire.*explicit operator-confirmed recovery/iu,
    );
    assert.match(
      architecture,
      /Coordination claims are not generic cleanup candidates\.[^\n]*elapsed time never authorizes removal/iu,
    );
    assert.ok(manifest.required_dirs.includes(claimDirectory));
    assert.match(
      manifest.directory_purposes[claimDirectory] ?? "",
      /exclusive path-write coordination.*do not expire.*explicit operator-confirmed recovery/iu,
    );
    assert.equal(
      manifest.required_files.some((path) => path.startsWith(claimDirectory)),
      false,
    );
    assert.equal(installedGitignore, template);
    assert.ok(REQUIRED_GOAT_FLOW_GITIGNORE_PATTERNS.includes(ignorePattern));
    assert.ok(
      template
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .includes(ignorePattern),
    );
    assert.match(
      installer,
      /for dir in [^\n]*\.goat-flow\/write-claims[^\n]*; do/u,
    );
  });

  describe("local-state guides", () => {
    // Each named case protects this workspace and the corresponding fresh-install template.
    for (const [installedReadme, setupTemplate] of LOCAL_STATE_README_ENTRIES) {
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

  it("lists the optional security policy in canonical committed knowledge", () => {
    const architecture = readContractFile(".goat-flow/architecture.md");
    const committedKnowledge = architecture
      .split(/\r?\n/u)
      .find((line) => line.includes("**Committed knowledge**"));

    assert.ok(
      committedKnowledge,
      "architecture is missing committed knowledge",
    );
    assert.match(
      committedKnowledge,
      /`\.goat-flow\/security-policy\.md` \(optional, user-owned security guardrails\)/u,
    );
  });
});
