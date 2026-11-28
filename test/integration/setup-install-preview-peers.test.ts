/**
 * Run public install previews where another agent's install already exists, to check what the preview says about that agent's files.
 * Each test installs into a disposable Git project, then previews with --dry-run, which writes nothing.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  git,
  makeTempProject,
  runCliInstaller,
} from "./setup-install.helpers.js";

/** The parts of a JSON install preview these tests read. */
interface PreviewReport {
  verdict: string;
  files: Array<{ path: string; state: string; action: string; reason: string }>;
  summary?: {
    userOwnedWrites: string[];
    peerAgentWrites: Array<{ agent: string; path: string }>;
  };
}

/**
 * Drop every value that names the Git-mutation hook, so a provider config reads as an older release left it.
 *
 * @param jsonNode - parsed JSON node
 * @returns a copy without the array entries whose JSON names `deny-git-mutations`; object keys stay
 */
function withoutGitMutationHook(jsonNode: unknown): unknown {
  // Arrays hold registration rows; a row naming the hook is the one an older release lacked.
  if (Array.isArray(jsonNode))
    return jsonNode
      .filter((entry) => !JSON.stringify(entry).includes("deny-git-mutations"))
      .map(withoutGitMutationHook);
  // Objects hold events and matcher groups; their other keys stay as written.
  if (jsonNode !== null && typeof jsonNode === "object")
    return Object.fromEntries(
      Object.entries(jsonNode).map(([key, entry]) => [
        key,
        withoutGitMutationHook(entry),
      ]),
    );
  return jsonNode;
}

/**
 * Install Codex into a fresh Git project and remove its Git-mutation registration, so a later Claude install must edit Codex's config.
 * Writes the project and its `.codex/hooks.json`.
 *
 * @returns the project path
 */
function codexProjectMissingGitProtection(): string {
  const projectPath = makeTempProject();
  git(projectPath, ["init", "--initial-branch", "fixture"]);
  const install = runCliInstaller(projectPath, "--agent", "codex");
  assert.equal(install.status, 0, install.stderr || install.stdout);
  const hooksPath = join(projectPath, ".codex/hooks.json");
  const hooks = withoutGitMutationHook(
    JSON.parse(readFileSync(hooksPath, "utf-8")),
  );
  writeFileSync(hooksPath, `${JSON.stringify(hooks, null, 2)}\n`);
  return projectPath;
}

describe("install preview beside another agent's install", () => {
  // Writes a Codex install, then spawns Claude dry-run previews in both formats; the previews write nothing.
  it("names the peer config it writes and labels the peer's skills as that install's files", () => {
    const projectPath = codexProjectMissingGitProtection();
    const json = runCliInstaller(
      projectPath,
      "--agent",
      "claude",
      "--dry-run",
      "--format",
      "json",
    );
    assert.equal(json.status, 0, json.stderr || json.stdout);
    const report = JSON.parse(json.stdout) as PreviewReport;
    assert.deepEqual(report.summary?.peerAgentWrites, [
      { agent: "codex", path: ".codex/hooks.json" },
    ]);
    assert.equal(
      report.summary?.userOwnedWrites.includes(".codex/hooks.json"),
      false,
    );
    const peerSkillRows = report.files.filter((file) =>
      file.path.startsWith(".agents/skills/"),
    );
    assert.ok(peerSkillRows.length > 0);
    assert.deepEqual(
      peerSkillRows.filter(
        (file) =>
          file.state !== "peer-managed" ||
          file.action !== "none" ||
          !/\bcodex install\b/u.test(file.reason) ||
          /antigravity/u.test(file.reason),
      ),
      [],
    );

    const text = runCliInstaller(
      projectPath,
      "--agent",
      "claude",
      "--dry-run",
      "--format",
      "text",
    );
    assert.equal(text.status, 0, text.stderr || text.stdout);
    assert.match(
      text.stdout,
      /^Peer-agent files this install writes: \.codex\/hooks\.json \(codex\)$/mu,
    );
    assert.match(text.stdout, /^Actions: .*\b\d+ migrate\b/mu);
  });
});
