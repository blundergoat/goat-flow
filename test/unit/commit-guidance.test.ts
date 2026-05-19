import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  detectCommitConventions,
  ensureGitCommitInstructions,
  GIT_COMMIT_INSTRUCTIONS_PATH,
  renderGitCommitInstructions,
} from "../../src/cli/prompt/commit-guidance.js";

const disposables: string[] = [];
const gitAvailable =
  spawnSync("git", ["--version"], {
    encoding: "utf-8",
  }).status === 0;

after(() => {
  for (const dir of disposables) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function git(root: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "GOAT Test",
      GIT_AUTHOR_EMAIL: "goat@example.test",
      GIT_COMMITTER_NAME: "GOAT Test",
      GIT_COMMITTER_EMAIL: "goat@example.test",
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-commit-guidance-"));
  disposables.push(root);
  git(root, ["init"]);
  git(root, ["config", "user.name", "GOAT Test"]);
  git(root, ["config", "user.email", "goat@example.test"]);
  return root;
}

function commit(root: string, subject: string, body?: string): void {
  writeFileSync(join(root, "history.txt"), `${subject}\n`, { flag: "a" });
  git(root, ["add", "history.txt"]);
  const args = ["commit", "-m", subject];
  if (body) args.push("-m", body);
  git(root, args);
}

describe("commit guidance detector", { skip: !gitAvailable }, () => {
  it("detects dominant conventional-commit history and renders observed metadata", () => {
    const root = makeRepo();
    for (let i = 0; i < 8; i += 1) {
      commit(root, `feat(cli): add command ${i}`);
    }
    commit(
      root,
      "fix(setup): preserve target path",
      "Explain why the target path matters.\n\nSigned-off-by: GOAT Test <goat@example.test>",
    );
    commit(root, "docs: document setup flow");

    const detection = detectCommitConventions(root);
    assert.equal(detection.status, "conventional");
    assert.equal(detection.total, 10);
    assert.equal(detection.counts.conventional, 10);
    assert.deepEqual(detection.conventionalTypes.slice(0, 3), [
      "feat",
      "docs",
      "fix",
    ]);
    assert.equal(detection.signedOffBy, true);

    const rendered = renderGitCommitInstructions(detection);
    assert.match(rendered, /Use conventional commits/);
    assert.match(rendered, /Observed types: feat, docs, fix/);
    assert.match(rendered, /Signed-off-by trailers observed: yes/);
    assert.match(rendered, /Example from history: `docs: document setup flow`/);
  });

  it("detects dominant ticket-prefixed history", () => {
    const root = makeRepo();
    for (let i = 0; i < 10; i += 1) {
      commit(root, `ABC-${100 + i}: add workflow case ${i}`);
    }

    const detection = detectCommitConventions(root);
    assert.equal(detection.status, "ticket-prefixed");
    assert.equal(detection.ticketPrefixPattern, "^ABC-\\d+");

    const rendered = renderGitCommitInstructions(detection);
    assert.match(rendered, /Use ticket-prefixed commit subjects/);
    assert.match(rendered, /`\^ABC-\\d\+`/);
  });

  it("keeps mixed history as a TODO instead of choosing silently", () => {
    const root = makeRepo();
    for (let i = 0; i < 4; i += 1) commit(root, `feat: add thing ${i}`);
    for (let i = 0; i < 3; i += 1) commit(root, `XYZ-${i + 1}: fix thing`);
    for (let i = 0; i < 3; i += 1) commit(root, `Release cleanup ${i}`);

    const detection = detectCommitConventions(root);
    assert.equal(detection.status, "mixed");

    const rendered = renderGitCommitInstructions(detection);
    assert.match(rendered, /TODO: choose the project commit style/);
    assert.match(rendered, /Conventional commits: 4/);
    assert.match(rendered, /Ticket-prefixed subjects: 3/);
    assert.match(rendered, /Free-form subjects: 3/);

    mkdirSync(join(root, ".github"), { recursive: true });
    const writeResult = ensureGitCommitInstructions(root);
    assert.equal(writeResult.status, "written");
    assert.match(
      readFileSync(join(root, GIT_COMMIT_INSTRUCTIONS_PATH), "utf-8"),
      /TODO: choose the project commit style/,
    );
  });

  it("renders an insufficient-history stub for short histories", () => {
    const root = makeRepo();
    commit(root, "feat: first commit");
    commit(root, "fix: second commit");

    const detection = detectCommitConventions(root);
    assert.equal(detection.status, "insufficient-history");
    assert.equal(detection.total, 2);

    const rendered = renderGitCommitInstructions(detection);
    assert.match(
      rendered,
      /goat-flow: generated stub - insufficient git history/,
    );
    assert.match(rendered, /Stub reason: only 2 recent commits found\./);

    mkdirSync(join(root, ".github"), { recursive: true });
    const writeResult = ensureGitCommitInstructions(root);
    assert.equal(writeResult.status, "written");
    assert.match(
      readFileSync(join(root, GIT_COMMIT_INSTRUCTIONS_PATH), "utf-8"),
      /goat-flow: generated stub - insufficient git history/,
    );
  });

  it("writes missing GitHub commit guidance and never overwrites existing guidance", () => {
    const root = makeRepo();
    mkdirSync(join(root, ".github"), { recursive: true });
    for (let i = 0; i < 10; i += 1) commit(root, `feat: add setup ${i}`);

    const first = ensureGitCommitInstructions(root);
    assert.equal(first.status, "written");
    const outputPath = join(root, GIT_COMMIT_INSTRUCTIONS_PATH);
    assert.equal(existsSync(outputPath), true);
    const generated = readFileSync(outputPath, "utf-8");
    assert.match(generated, /generated from recent git history/);

    writeFileSync(outputPath, "# Custom rules\n");
    const second = ensureGitCommitInstructions(root);
    assert.equal(second.status, "skipped-existing");
    assert.equal(readFileSync(outputPath, "utf-8"), "# Custom rules\n");
  });
});
