/**
 * Exercise the shipped writing-playbook cleanup against disposable project files.
 * Focused cases run the exact production block; one public install proves that cleanup retains legacy baseline rows.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { checkArtifactIntegrity } from "../../src/cli/audit/check-artifact-integrity.js";
import { createFS } from "../../src/cli/facts/fs.js";
import {
  makeTempProject,
  PROJECT_ROOT,
  runCliInstaller,
  spawnSync,
} from "./setup-install.helpers.js";

const PLAYBOOK_ROOT = ".goat-flow/skill-docs/playbooks";
/** Child-only copy failure used to prove cleanup cannot follow an unsuccessful replacement. */
const COPY_FAILURE_EXIT = 63;
const RENAMES = [
  ["writing-for-agents.md", "writing-agent-facing-instructions.md"],
  ["writing-style.md", "writing-human-facing-prose.md"],
] as const;

/** Writes a temporary old playbook or instruction file and creates its local parent. */
function writeTarget(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/**
 * Execute the real playbook block with a filesystem copy primitive and removal counter.
 * A named failed copy proves production ordering without running unrelated installer stages.
 */
function runPlaybookBlock(root: string, failedCopy = "") {
  const source = readFileSync(
    join(PROJECT_ROOT, "workflow/install-goat-flow.sh"),
    "utf-8",
  );
  const start = source.indexOf('echo "Standalone playbooks');
  const end = source.indexOf(
    'copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/skill-quality-testing.md"',
    start,
  );
  assert.ok(
    start >= 0 && end > start,
    "production playbook block must resolve",
  );
  return spawnSync(
    "bash",
    [
      "-c",
      [
        "set -euo pipefail",
        "REMOVED=0",
        "copy_file() {",
        '  local src="$1" dst="$2"',
        `  if [[ -n "$FAILED_COPY" && "$dst" == "$FAILED_COPY" ]]; then return ${COPY_FAILURE_EXIT}; fi`,
        '  mkdir -p "$(dirname "$dst")"',
        '  cp "$src" "$dst"',
        "}",
        source.slice(start, end),
        'printf "RENAMED_REMOVED:%s\\n" "$REMOVED"',
      ].join("\n"),
    ],
    {
      cwd: root,
      encoding: "utf-8",
      timeout: 10_000,
      env: {
        ...process.env,
        GOAT_FLOW_ROOT: PROJECT_ROOT,
        MANIFEST_PATH: join(PROJECT_ROOT, "workflow/manifest.json"),
        FAILED_COPY: failedCopy,
      },
    },
  );
}

/** Read the audit's actual stale-file advice against this project's installed copies. */
function artifactFindings(root: string) {
  return checkArtifactIntegrity({
    fs: createFS(root),
    templateRoot: PROJECT_ROOT,
    installedSkillRoots: [],
  });
}

describe("renamed writing playbook cleanup", () => {
  // Writes both old copies and all distinct manifest instruction paths; cleanup must report references without editing instructions.
  it("removes both copies and reports stale instruction lines without editing them", () => {
    const root = makeTempProject();
    for (const [oldName] of RENAMES)
      writeTarget(
        root,
        `${PLAYBOOK_ROOT}/${oldName}`,
        "# Locally edited guidance\n",
      );
    const instructions = [
      ["AGENTS.md", `Read ${PLAYBOOK_ROOT}/writing-style.md.\n`],
      ["CLAUDE.md", "Read writing-for-agents.md.\n"],
      [".github/copilot-instructions.md", "Read writing-style.md.\n"],
    ];
    for (const [path, text] of instructions) writeTarget(root, path, text);
    writeTarget(
      root,
      `${PLAYBOOK_ROOT}/retired.md`,
      "# Unrelated local file\n",
    );
    const result = runPlaybookBlock(root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /RENAMED_REMOVED:2/u);
    for (const [oldName, newName] of RENAMES) {
      assert.equal(existsSync(join(root, PLAYBOOK_ROOT, oldName)), false);
      assert.equal(
        readFileSync(join(root, PLAYBOOK_ROOT, newName), "utf-8"),
        readFileSync(
          join(PROJECT_ROOT, "workflow/skills/playbooks", newName),
          "utf-8",
        ),
      );
      assert.ok(
        result.stdout.includes(`${oldName} → ${PLAYBOOK_ROOT}/${newName}`),
      );
    }
    for (const [path, text] of instructions) {
      assert.equal(readFileSync(join(root, path), "utf-8"), text);
      assert.ok(result.stdout.includes(`${path}:1: ${text.trim()}`));
    }
    assert.equal((result.stdout.match(/AGENTS\.md:1:/gu) ?? []).length, 1);
    assert.equal(existsSync(join(root, PLAYBOOK_ROOT, "retired.md")), true);
    const repeat = runPlaybookBlock(root);
    assert.equal(repeat.status, 0, repeat.stderr || repeat.stdout);
    assert.match(repeat.stdout, /RENAMED_REMOVED:0/u);
    assert.doesNotMatch(repeat.stdout, /removed renamed playbook/u);
    assert.ok(
      artifactFindings(root).some(
        (finding) =>
          finding.path.endsWith("/retired.md") &&
          finding.message.includes("no canonical workflow source is mapped"),
      ),
      "unrelated stale-file advice must keep its existing behavior",
    );
  });

  // Writes quoted CRLF ownership and a body-only lookalike; the invariant is preservation only for real YAML frontmatter in install and audit.
  it("keeps user-owned frontmatter copies but ignores ownership text in the body", () => {
    const root = makeTempProject();
    const owned =
      '---\r\n"goat-flow-ownership": "user-owned" # project guidance\r\n---\r\n# Local writing\r\n';
    const ownedPath = `${PLAYBOOK_ROOT}/writing-style.md`;
    writeTarget(root, ownedPath, owned);
    writeTarget(
      root,
      `${PLAYBOOK_ROOT}/writing-for-agents.md`,
      "# Local writing\ngoat-flow-ownership: user-owned\n",
    );
    assert.equal(
      artifactFindings(root).some((finding) => finding.path === ownedPath),
      false,
    );
    const result = runPlaybookBlock(root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(readFileSync(join(root, ownedPath), "utf-8"), owned);
    assert.equal(
      existsSync(join(root, PLAYBOOK_ROOT, "writing-for-agents.md")),
      false,
    );
    assert.match(
      result.stdout,
      /writing-style\.md \(kept user-owned playbook; use/u,
    );
    assert.match(result.stdout, /RENAMED_REMOVED:1/u);
    assert.equal(
      artifactFindings(root).some((finding) => finding.path === ownedPath),
      false,
    );
  });

  // Injects one failing copy while executing the real block; no old copy may disappear before replacement completes.
  it("retains both old copies when a replacement copy fails", () => {
    const root = makeTempProject();
    for (const [oldName] of RENAMES)
      writeTarget(root, `${PLAYBOOK_ROOT}/${oldName}`, "# Old guidance\n");
    const result = runPlaybookBlock(
      root,
      `${PLAYBOOK_ROOT}/writing-human-facing-prose.md`,
    );
    assert.equal(
      result.status,
      COPY_FAILURE_EXIT,
      result.stderr || result.stdout,
    );
    for (const [oldName] of RENAMES)
      assert.equal(
        readFileSync(join(root, PLAYBOOK_ROOT, oldName), "utf-8"),
        "# Old guidance\n",
      );
    assert.doesNotMatch(result.stdout, /removed renamed playbook/u);
  });

  // Installs a 1.16.0-shaped legacy history with one unchanged and one edited copy; cleanup must retain both baseline rows.
  it("removes legacy copies through public install while retaining their baseline rows", () => {
    const root = makeTempProject();
    const baseline =
      '---\ngoat-flow-reference-version: "1.16.0"\n---\n# Writing guidance\n';
    const expectedSha256 = createHash("sha256").update(baseline).digest("hex");
    for (const [oldName] of RENAMES)
      writeTarget(
        root,
        `${PLAYBOOK_ROOT}/${oldName}`,
        oldName === "writing-style.md"
          ? baseline
          : `${baseline}\nLocal edits.\n`,
      );
    writeTarget(
      root,
      ".goat-flow/state/install/codex.json",
      JSON.stringify(
        {
          schemaVersion: "goat-flow.install-state.v1",
          agent: "codex",
          goatFlowVersion: "1.16.0",
          files: RENAMES.map(([oldName]) => ({
            path: `${PLAYBOOK_ROOT}/${oldName}`,
            expectedSha256,
          })),
        },
        null,
        2,
      ) + "\n",
    );
    const before = artifactFindings(root);
    for (const [oldName, newName] of RENAMES) {
      const finding = before.find(
        (item) => item.path === `${PLAYBOOK_ROOT}/${oldName}`,
      );
      assert.ok(finding);
      assert.ok(
        finding.message.includes(`was renamed to ${PLAYBOOK_ROOT}/${newName}`),
      );
      assert.match(
        finding.message,
        /next install removes regular system-owned copies/u,
      );
      assert.match(finding.message, /linked copies are kept/u);
      assert.doesNotMatch(finding.message, /SHARED_ARTIFACT_MIRRORS/u);
    }
    const result = runCliInstaller(root, "--agent", "codex");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const state = JSON.parse(
      readFileSync(
        join(root, ".goat-flow/state/install/managed.json"),
        "utf-8",
      ),
    );
    for (const [oldName, newName] of RENAMES) {
      assert.equal(existsSync(join(root, PLAYBOOK_ROOT, oldName)), false);
      assert.equal(existsSync(join(root, PLAYBOOK_ROOT, newName)), true);
      assert.equal(
        state.files.find(
          (row: { path: string }) => row.path === `${PLAYBOOK_ROOT}/${oldName}`,
        )?.expectedSha256,
        expectedSha256,
      );
    }
    assert.match(result.stdout, /HELPER DONE: .*2 stale removed/u);
    assert.match(result.stdout, /Install verified for codex/u);
  });
});
