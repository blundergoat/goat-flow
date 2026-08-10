/**
 * Exercises the standalone-playbook contract exposed through `goat-flow audit`.
 * Use these fixtures when authors change playbook shape or registration rules.
 * Negative cases prove users receive a precise failure before malformed guidance
 * reaches an installed project, while the healthy case protects existing packs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SETUP_CHECKS } from "../../src/cli/audit/check-goat-flow.js";
import { STANDALONE_PLAYBOOK_FILES } from "../../src/cli/audit/skill-docs-contract.js";
import { AUDIT_VERSION } from "../../src/cli/constants.js";
import { makeCtx, stubFS } from "../fixtures/projects/index.js";
import { assertExists } from "../helpers/assert-exists.js";

const standalonePlaybookPaths = [
  ".goat-flow/skill-docs/playbooks/browser-use.md",
  ".goat-flow/skill-docs/playbooks/changelog.md",
  ".goat-flow/skill-docs/playbooks/code-comments.md",
  ".goat-flow/skill-docs/playbooks/gruff-code-quality.md",
  ".goat-flow/skill-docs/playbooks/hook-policy-testing.md",
  ".goat-flow/skill-docs/playbooks/observability.md",
  ".goat-flow/skill-docs/playbooks/page-capture.md",
  ".goat-flow/skill-docs/playbooks/release-notes.md",
  ".goat-flow/skill-docs/playbooks/skill-playbook-authoring-sync.md",
  ".goat-flow/skill-docs/playbooks/writing-style.md",
] as const;

const hookPolicyPlaybookPaths = [
  "workflow/skills/playbooks/hook-policy-testing.md",
  ".goat-flow/skill-docs/playbooks/hook-policy-testing.md",
] as const;

/**
 * Observable registration result shown to a user running the playbook command.
 * Output may be empty when the project has no matching registration pointer.
 */
interface RegistrationCommandResult {
  exitStatus: number;
  standardOutput: string;
  standardError: string;
}

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
 * Read the registration command exactly as users receive it in one playbook.
 * @param playbookPath - shipped playbook path; empty is never a valid source
 * @returns Bash command text; never empty because a missing block fails here
 */
function readRegistrationCommand(playbookPath: string): string {
  const playbookText = readFileSync(join(process.cwd(), playbookPath), "utf8");
  const registrationCommandMatch = playbookText.match(
    /### 5\. Verify agent registration[\s\S]*?```bash\n([\s\S]*?)\n```/u,
  );

  // Missing or empty command text means users have no executable registration proof.
  assert.ok(
    registrationCommandMatch?.[1],
    `${playbookPath}: missing registration command`,
  );
  return registrationCommandMatch[1];
}

/**
 * Run the copied command inside an isolated project shaped like a user's checkout.
 * @param playbookPath - shipped command source; empty cannot identify user guidance
 * @param registrationFiles - project files; empty models no supported registration surface
 * @returns exit and output; either output stream may be empty for a quiet result
 */
function runRegistrationCommand(
  playbookPath: string,
  registrationFiles: Readonly<Record<string, string>>,
): RegistrationCommandResult {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "goat-flow-registration-"));

  try {
    // Each fixture file represents a registration surface present in the user's checkout.
    for (const [registrationPath, registrationText] of Object.entries(
      registrationFiles,
    )) {
      const registrationFilePath = join(fixtureRoot, registrationPath);
      mkdirSync(dirname(registrationFilePath), { recursive: true });
      writeFileSync(registrationFilePath, registrationText, "utf8");
    }

    const registrationRun = spawnSync(
      "bash",
      ["-c", readRegistrationCommand(playbookPath)],
      {
        cwd: fixtureRoot,
        encoding: "utf8",
      },
    );

    // A null status means Bash could not start, so the user's proof never ran.
    const exitStatus = registrationRun.status ?? -1;
    return {
      exitStatus,
      standardOutput: registrationRun.stdout,
      standardError: registrationRun.stderr,
    };
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

/**
 * Run one user-shaped fixture against canonical and installed playbook commands.
 * @param registrationFiles - project files; empty proves the no-registration path
 * @param assertResult - receives each result; output may be empty on failed proof
 * @returns nothing; assertion failures identify the shipped playbook being checked
 */
function assertRegistrationCommandForEachPlaybook(
  registrationFiles: Readonly<Record<string, string>>,
  assertResult: (
    registrationResult: RegistrationCommandResult,
    playbookPath: string,
  ) => void,
): void {
  // Every shipped copy must produce the same user-visible registration result.
  for (const playbookPath of hookPolicyPlaybookPaths) {
    const registrationResult = runRegistrationCommand(
      playbookPath,
      registrationFiles,
    );
    assertResult(registrationResult, playbookPath);
  }
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
  it("registers hook-policy-testing.md for audit and consumer discovery", () => {
    assert.ok(
      STANDALONE_PLAYBOOK_FILES.some(
        (playbookPath) =>
          playbookPath ===
          ".goat-flow/skill-docs/playbooks/hook-policy-testing.md",
      ),
      "hook-policy-testing.md must be registered before users can discover it",
    );
  });

  it("registers writing-style.md for audit and consumer discovery", () => {
    assert.ok(
      STANDALONE_PLAYBOOK_FILES.some(
        (playbookPath) =>
          playbookPath === ".goat-flow/skill-docs/playbooks/writing-style.md",
      ),
      "writing-style.md must be registered before users can discover it",
    );
  });

  /*
   * A consumer project may register one agent without carrying framework source.
   * The copied command must still show the central hook path and exit cleanly.
   */
  it("runs the documented registration command in a consumer checkout", () => {
    assertRegistrationCommandForEachPlaybook(
      {
        ".claude/settings.json":
          '{"command":".goat-flow/hooks/deny-dangerous.sh"}\n',
      },
      (registrationResult, playbookPath) => {
        assert.equal(
          registrationResult.exitStatus,
          0,
          `${playbookPath}: ${registrationResult.standardError}`,
        );
        assert.match(
          registrationResult.standardOutput,
          /\.claude\/settings\.json.*\.goat-flow\/hooks\/deny-dangerous\.sh/u,
          playbookPath,
        );
      },
    );
  });

  /*
   * A framework maintainer has agent configs plus the workflow manifest.
   * The same copied command must inspect every present registration surface.
   */
  it("runs the documented registration command in a framework checkout", () => {
    // Each framework file proves one supported agent or packaging registration surface.
    const frameworkRegistrationFiles = Object.fromEntries(
      [
        ".claude/settings.json",
        ".codex/hooks.json",
        ".github/hooks/hooks.json",
        "workflow/manifest.json",
      ].map((registrationPath) => [
        registrationPath,
        '{"command":".goat-flow/hooks/deny-dangerous.sh"}\n',
      ]),
    );

    assertRegistrationCommandForEachPlaybook(
      frameworkRegistrationFiles,
      (registrationResult, playbookPath) => {
        assert.equal(
          registrationResult.exitStatus,
          0,
          `${playbookPath}: ${registrationResult.standardError}`,
        );
        assert.match(
          registrationResult.standardOutput,
          /workflow\/manifest\.json/u,
          playbookPath,
        );
      },
    );
  });

  /*
   * A project with no supported config cannot prove that an agent loads the hook.
   * Users need an explicit failure instead of a misleading empty success.
   */
  it("fails the documented registration command when no supported file exists", () => {
    assertRegistrationCommandForEachPlaybook(
      {},
      (registrationResult, playbookPath) => {
        assert.equal(
          registrationResult.exitStatus,
          1,
          `${playbookPath}: expected empty-selection failure`,
        );
        assert.match(
          registrationResult.standardError,
          /No supported agent registration files found/u,
          playbookPath,
        );
      },
    );
  });

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
