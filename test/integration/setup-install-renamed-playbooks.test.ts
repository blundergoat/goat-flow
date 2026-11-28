/**
 * Exercise the shipped writing-playbook cleanup against disposable project files.
 * Writer cases use disposable files; public install also proves that cleanup retains legacy baseline rows.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it, mock } from "node:test";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { checkArtifactIntegrity } from "../../src/cli/audit/check-artifact-integrity.js";
import { createFS } from "../../src/cli/facts/fs.js";
import { buildManagedSetupPreview } from "../../src/cli/managed-setup-preview.js";
import {
  makeTempProject,
  PROJECT_ROOT,
  runCliInstaller,
  runNodeInstaller,
} from "./setup-install.helpers.js";

const PLAYBOOK_ROOT = ".goat-flow/skill-docs/playbooks";
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
 * Write a 1.16.0-shaped per-agent record whose hash for each path is the given bytes' hash, as that release recorded on install.
 * Side effects: writes `.goat-flow/state/install/codex.json` in the temporary project.
 *
 * @param root - temporary project root
 * @param recorded - each recorded path with the bytes its release installed; the file on disk may differ
 */
function writeLegacyRecord(
  root: string,
  recorded: readonly (readonly [string, string])[],
): void {
  writeTarget(
    root,
    ".goat-flow/state/install/codex.json",
    JSON.stringify(
      {
        schemaVersion: "goat-flow.install-state.v1",
        agent: "codex",
        goatFlowVersion: "1.16.0",
        files: recorded.map(([path, bytes]) => ({
          path,
          expectedSha256: createHash("sha256").update(bytes).digest("hex"),
        })),
      },
      null,
      2,
    ) + "\n",
  );
}

/**
 * Run the Node installer with an optional failure at the named playbook copy.
 * The failure proves replacements are copied before their old paths are removed.
 */
function runPlaybookInstaller(root: string, failedCopy = "") {
  const copyFile = fs.copyFileSync;
  if (failedCopy) {
    mock.method(
      fs,
      "copyFileSync",
      (source: fs.PathLike, destination: fs.PathLike, mode?: number) => {
        if (
          String(source)
            .replaceAll("\\", "/")
            .endsWith(
              failedCopy.replace(PLAYBOOK_ROOT, "workflow/skills/playbooks"),
            )
        )
          throw new Error("injected Node copy failure");
        copyFile(source, destination, mode);
      },
    );
    syncBuiltinESMExports();
  }
  try {
    return runNodeInstaller(root, {}, "--agent", "codex");
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
  }
}

/** Read the audit's actual stale-file advice against this project's installed copies. */
function artifactFindings(root: string) {
  return checkArtifactIntegrity({
    fs: createFS(root),
    templateRoot: PROJECT_ROOT,
    installedSkillRoots: [],
  });
}

/** Read every path the shared install state still records for the temporary project. */
function recordedPaths(root: string): string[] {
  const state = JSON.parse(
    readFileSync(join(root, ".goat-flow/state/install/managed.json"), "utf-8"),
  ) as { files: { path: string }[] };
  return state.files.map((row) => row.path);
}

describe("renamed writing playbook cleanup", () => {
  // Writes both unrecorded old copies and all distinct manifest instruction paths; nothing proves the copies unedited, so both stay named.
  it("keeps unrecorded copies and reports stale instruction lines without editing them", () => {
    const root = makeTempProject();
    for (const [oldName] of RENAMES)
      writeTarget(
        root,
        `${PLAYBOOK_ROOT}/${oldName}`,
        "# Locally edited guidance\n",
      );
    const instructions = [
      [
        "AGENTS.md",
        `Read ${PLAYBOOK_ROOT}/writing-style.md and writing-for-agents.md.\n`,
      ],
      ["CLAUDE.md", "Read writing-for-agents.md.\n"],
      [".github/copilot-instructions.md", "Read writing-style.md.\n"],
    ];
    for (const [path, text] of instructions) writeTarget(root, path, text);
    writeTarget(
      root,
      `${PLAYBOOK_ROOT}/retired.md`,
      "# Unrelated local file\n",
    );
    const result = runPlaybookInstaller(root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.doesNotMatch(result.stdout, /removed renamed playbook/u);
    for (const [oldName, newName] of RENAMES) {
      assert.equal(
        readFileSync(join(root, PLAYBOOK_ROOT, oldName), "utf-8"),
        "# Locally edited guidance\n",
      );
      assert.equal(
        readFileSync(join(root, PLAYBOOK_ROOT, newName), "utf-8"),
        readFileSync(
          join(PROJECT_ROOT, "workflow/skills/playbooks", newName),
          "utf-8",
        ),
      );
      assert.ok(
        result.stdout.includes(
          `${oldName} (kept: edited or unrecorded old playbook; it will not be updated. Carry over needed edits to ${PLAYBOOK_ROOT}/${newName}`,
        ),
      );
    }
    for (const [path, text] of instructions) {
      assert.equal(readFileSync(join(root, path), "utf-8"), text);
      assert.ok(result.stdout.includes(`${path}:1: `));
      assert.ok(!result.stdout.includes(text.trim()));
    }
    assert.ok(
      result.stdout.includes(
        `AGENTS.md:1: ${PLAYBOOK_ROOT}/writing-style.md → ${PLAYBOOK_ROOT}/writing-human-facing-prose.md`,
      ),
    );
    assert.ok(
      result.stdout.includes(
        `AGENTS.md:1: writing-for-agents.md → ${PLAYBOOK_ROOT}/writing-agent-facing-instructions.md`,
      ),
    );
    assert.equal(existsSync(join(root, PLAYBOOK_ROOT, "retired.md")), true);
    const repeat = runCliInstaller(root, "--agent", "codex");
    assert.equal(repeat.status, 0, repeat.stderr || repeat.stdout);
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
    const lookalike = "# Local writing\ngoat-flow-ownership: user-owned\n";
    writeTarget(root, ownedPath, owned);
    writeTarget(root, `${PLAYBOOK_ROOT}/writing-for-agents.md`, lookalike);
    writeLegacyRecord(root, [
      [ownedPath, owned],
      [`${PLAYBOOK_ROOT}/writing-for-agents.md`, lookalike],
    ]);
    assert.equal(
      artifactFindings(root).some((finding) => finding.path === ownedPath),
      false,
    );
    const result = runCliInstaller(root, "--agent", "codex");
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
    assert.equal(
      (result.stdout.match(/removed renamed playbook/gu) ?? []).length,
      1,
    );
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
    const result = runPlaybookInstaller(
      root,
      `${PLAYBOOK_ROOT}/writing-human-facing-prose.md`,
    );
    assert.equal(result.status, 1, result.stderr || result.stdout);
    for (const [oldName] of RENAMES)
      assert.equal(
        readFileSync(join(root, PLAYBOOK_ROOT, oldName), "utf-8"),
        "# Old guidance\n",
      );
    assert.doesNotMatch(result.stdout, /removed renamed playbook/u);
  });

  // Installs a 1.16.0-shaped legacy history with one unchanged and one edited copy, then reruns naming the edited copy.
  it("removes the unedited legacy copy and its row, and the edited one only when --force-path names it", () => {
    const root = makeTempProject();
    const baseline =
      '---\ngoat-flow-reference-version: "1.16.0"\n---\n# Writing guidance\n';
    for (const [oldName] of RENAMES)
      writeTarget(
        root,
        `${PLAYBOOK_ROOT}/${oldName}`,
        oldName === "writing-style.md"
          ? baseline
          : `${baseline}\nLocal edits.\n`,
      );
    writeLegacyRecord(
      root,
      RENAMES.map(([oldName]) => [`${PLAYBOOK_ROOT}/${oldName}`, baseline]),
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
        /Install removes an unedited managed copy/u,
      );
      assert.match(
        finding.message,
        /For an edited regular copy, .*--force-path/u,
      );
      assert.match(
        finding.message,
        /Remove a linked copy manually after review/u,
      );
      assert.doesNotMatch(finding.message, /SHARED_ARTIFACT_MIRRORS/u);
    }
    const edited = `${PLAYBOOK_ROOT}/writing-for-agents.md`;
    const unedited = `${PLAYBOOK_ROOT}/writing-style.md`;
    const actions = new Map(
      buildManagedSetupPreview(root, "codex").files.map((file) => [
        file.path,
        file.action,
      ]),
    );
    assert.equal(actions.get(unedited), "remove");
    assert.equal(actions.get(edited), "preserve");

    const result = runCliInstaller(root, "--agent", "codex");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(existsSync(join(root, unedited)), false);
    assert.equal(
      readFileSync(join(root, edited), "utf-8"),
      `${baseline}\nLocal edits.\n`,
    );
    assert.ok(
      existsSync(join(root, PLAYBOOK_ROOT, "writing-human-facing-prose.md")),
    );
    assert.match(result.stdout, /HELPER DONE: .*1 stale removed/u);
    assert.match(result.stdout, new RegExp(`--force-path ${edited}`, "u"));
    assert.match(result.stdout, /Install verified for codex/u);
    const rowsAfterUpgrade = recordedPaths(root);
    assert.equal(rowsAfterUpgrade.includes(unedited), false);
    assert.equal(rowsAfterUpgrade.includes(edited), true);

    const forced = runCliInstaller(
      root,
      "--agent",
      "codex",
      "--force-path",
      edited,
    );
    assert.equal(forced.status, 0, forced.stderr || forced.stdout);
    assert.equal(existsSync(join(root, edited)), false);
    assert.match(forced.stdout, /restore it from Git history/u);
    assert.equal(recordedPaths(root).includes(edited), false);
  });
});

describe("retired path references after install", () => {
  // Writes an instruction file, script, CI workflow and package.json that call removed hook paths, plus a lesson that only mentions one.
  it("lists each retired token and replacement without copying the surrounding line", () => {
    const root = makeTempProject();
    const callers: (readonly [string, string])[] = [
      [
        "CLAUDE.md",
        "Run bash .goat-flow/hooks/deny-dangerous.sh --self-test=smoke before handoff.\n",
      ],
      [
        "scripts/preflight.sh",
        "#!/usr/bin/env bash\nbash .goat-flow/hooks/post-turn-safety.sh --self-test\n",
      ],
      [
        ".github/workflows/ci.yml",
        "      - run: shellcheck .goat-flow/hooks/*/*.sh\n",
      ],
      [
        "package.json",
        '{ "scripts": { "hooks": "node .goat-flow/hooks/run-with-bash.mjs" } }\n',
      ],
      [
        ".goat-flow/learning-loop/lessons/hooks.md",
        "The old `.goat-flow/hooks/deny-dangerous.sh` runtime was retired.\n",
      ],
    ];
    for (const [path, text] of callers) writeTarget(root, path, text);

    const result = runCliInstaller(root, "--agent", "claude");

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(
      result.stdout,
      /Project files that still call removed goat-flow paths/u,
    );
    for (const expected of [
      "CLAUDE.md:1: .goat-flow/hooks/deny-dangerous.sh → node .goat-flow/hooks/deny-dangerous.mjs --self-test=smoke",
      "scripts/preflight.sh:2: .goat-flow/hooks/post-turn-safety.sh → node .goat-flow/hooks/post-turn-safety.mjs --self-test",
      ".github/workflows/ci.yml:1: .goat-flow/hooks/*/*.sh → This glob targets retired Bash hooks.",
      "package.json:1: .goat-flow/hooks/run-with-bash.mjs → .goat-flow/hooks/run-hook.mjs",
    ])
      assert.ok(result.stdout.includes(expected), `missing: ${expected}`);
    assert.doesNotMatch(result.stdout, /lessons\/hooks\.md:/u);
    assert.doesNotMatch(result.stdout, /before handoff/u);
    assert.deepEqual(
      callers.map(([path]) => readFileSync(join(root, path), "utf-8")),
      callers.map(([, text]) => text),
    );
  });
});
