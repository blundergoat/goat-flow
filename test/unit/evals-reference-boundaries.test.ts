/** Verifies that scored evidence preserves the requested source boundaries. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { hashProject } from "../../evals/fixtures/checkout/build.mjs";
import {
  buildCitedComment,
  citedCommentAnchor,
  citedSourcePath,
  citationEntryPath,
  compareCitedComment,
} from "../../evals/fixtures/cited-comment/build.mjs";
import { stagedRoundingExpression } from "../../evals/fixtures/staged-review/build.mjs";
import { scoreSample, validateCase } from "../../evals/lib/case.mjs";
import {
  recordedCitedComment,
  recordedClaudeOwnerRead,
  recordedPreparedOwnerRead,
  recordedStagedReviewEvidence,
} from "../../evals/lib/transcript.mjs";

/** Reads the saved case so controls exercise the same scoring rows. */
function loadCase(id: string) {
  return validateCase(
    JSON.parse(
      readFileSync(
        new URL("../../evals/cases/" + id + "/case.json", import.meta.url),
        "utf8",
      ),
    ),
    id,
  );
}

test("only the prepared stage and observed index bytes support the staged review", () => {
  const definition = loadCase("review-staged-authority");
  const project = resolve("synthetic-review-project");
  // Labelled snippets represent completed command records for this scorer.
  const contents = `return ${stagedRoundingExpression};\n`;
  const baseline = {
    fingerprint: "prepared-stage-fingerprint",
    blob: createHash("sha256")
      .update(`blob ${Buffer.byteLength(contents)}\0${contents}`)
      .digest("hex"),
  };
  const snapshot = {
    cwd: project,
    exit_code: 0,
    command: [
      "bash",
      "-lc",
      "goat-flow review snapshot ../staged-request.json",
    ],
    aggregated_output: JSON.stringify({
      authority: {
        schema: "goat-review-authority/v1",
        source: { kind: "staged" },
        fingerprint: baseline.fingerprint,
        inventory: [
          {
            path: "src/discount.mjs",
            new: { from: "index", blob: baseline.blob },
          },
        ],
      },
    }),
  };
  const source = {
    cwd: project,
    exit_code: 0,
    command: ["bash", "-lc", "git --no-pager show :src/discount.mjs"],
    aggregated_output: contents,
  };
  // Vary authority and reads independently of the unchanged checkout.
  const score = (commands: (typeof snapshot)[], isIndexUnchanged = true) =>
    scoreSample(definition, {
      projectUnchanged: true,
      harnessStatusUnchanged: true,
      reviewIndexUnchanged: isIndexUnchanged,
      ...recordedStagedReviewEvidence(commands, project, baseline),
    });

  assert.equal(score([snapshot, source]).status, "pass");
  assert.equal(
    score([
      snapshot,
      {
        ...source,
        aggregated_output: contents + "// different staged blob\n",
      },
    ]).status,
    "fail",
  );
  assert.equal(
    score([
      {
        ...snapshot,
        exit_code: 128,
        command: [
          "bash",
          "-lc",
          "goat-flow review snapshot ../staged-request.json && git diff --cached HEAD",
        ],
        aggregated_output:
          snapshot.aggregated_output + "\nfatal: bad revision 'HEAD'\n",
      },
      source,
    ]).status,
    "pass",
  );
  assert.equal(
    score([
      snapshot,
      { ...source, command: ["bash", "-lc", "cat src/discount.mjs"] },
    ]).status,
    "fail",
  );
  assert.equal(
    score([
      { ...snapshot, aggregated_output: "different-view-fingerprint" },
      source,
    ]).status,
    "fail",
  );
  assert.equal(score([snapshot, source], false).status, "fail");
});

test("the collector binds prepared owner bytes to the recorded working directory", () => {
  const sample = resolve("synthetic-owner-sample");
  const owners = join(sample, "owners");
  const project = join(sample, "project");
  const owner = join(owners, "SKILL.md");
  const contents = "Labelled synthetic owner bytes\n";
  const read = (cwd: string, readCommand: string[], output: string) =>
    recordedPreparedOwnerRead(
      [
        {
          cwd,
          exit_code: 0,
          command: readCommand,
          aggregated_output: output,
        },
      ],
      owner,
      contents,
    );

  assert.equal(read(owners, ["cat", "SKILL.md"], contents), true);
  assert.equal(
    read(sample, ["cat", join("owners", "SKILL.md")], contents),
    true,
  );
  assert.equal(
    read(project, ["cat", join("..", "owners", "SKILL.md")], contents),
    true,
  );
  assert.equal(read(owners, ["cat", "SKILL.md"], "partial bytes"), false);
  assert.equal(read(resolve("outside-sample"), ["cat", owner], contents), true);
  assert.equal(
    read(
      resolve("outside-sample"),
      ["cat", relative(resolve("outside-sample"), owner)],
      contents,
    ),
    true,
  );
  assert.equal(
    read(resolve("outside-sample"), ["cat", "owners/SKILL.md"], contents),
    false,
  );
  assert.equal(
    read(owners, ["bash", "-lc", 'cat "./SKILL.md"'], contents),
    true,
  );
  assert.equal(
    read(project, ["bash", "-lc", `cat "${owner}.backup"`], contents),
    false,
  );
  assert.equal(read(owners, ["cat", "alternate/SKILL.md"], contents), false);
  assert.equal(
    read(owners, ["bash", "-lc", 'cat "alternate SKILL.md copy"'], contents),
    false,
  );
});

test("Claude owner reads must cover the full prepared file", () => {
  const owner = resolve("prepared/owner.md");
  const contents = "# Owner\n\nRead the instructions.\n";
  const read = (range = {}) => [
    { input: { file_path: owner, ...range }, content: contents },
  ];
  assert.equal(recordedClaudeOwnerRead(read(), owner, contents), true);
  assert.equal(
    recordedClaudeOwnerRead(
      [{ input: { file_path: owner }, content: "     1\t# Owner\n" }],
      owner,
      contents,
    ),
    false,
  );
  const numbered = [
    {
      input: { file_path: owner },
      content: "     1\t# Owner\n     2\t\n     3\tRead the instructions.\n",
    },
  ];
  assert.equal(recordedClaudeOwnerRead(numbered, owner, contents), true);
  assert.equal(
    recordedClaudeOwnerRead(read({ limit: 1 }), owner, contents),
    false,
  );
  assert.equal(
    recordedClaudeOwnerRead(read({ offset: 2 }), owner, contents),
    false,
  );
});

// The real fixture has separate comment, code, test, and citation bytes.
test("a comment cleanup preserves its cited anchor and all other fixture bytes", (t) => {
  const project = mkdtempSync(join(tmpdir(), "eval-comment-anchor-"));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  buildCitedComment(project);
  const definition = loadCase("clarity-cited-comment");
  const sourcePath = join(project, citedSourcePath);
  const original = readFileSync(sourcePath, "utf8");
  const before = hashProject(project);
  const entry = readFileSync(join(project, citationEntryPath), "utf8");
  const citation = {
    cwd: project,
    exit_code: 0,
    command: ["cat", citationEntryPath],
    aggregated_output: entry,
  };
  const score = (observations = [citation]) =>
    scoreSample(definition, {
      harnessStatusUnchanged: true,
      clarityCitationObserved: recordedCitedComment(observations, project),
      ...compareCitedComment(
        before,
        hashProject(project),
        original,
        readFileSync(sourcePath, "utf8"),
      ),
    });

  const trimmed = original.replace(
    " * The name supplied by the caller is used as the name in the generated heading.\n",
    "",
  );
  assert.notEqual(trimmed, original);
  writeFileSync(sourcePath, trimmed);
  assert.equal(score().status, "pass");
  assert.equal(
    score([{ ...citation, command: ["cat", citedSourcePath] }]).status,
    "fail",
  );
  assert.equal(
    score([]).rows.find(({ id }) => id === "clarity-citation-observed")?.passed,
    false,
  );

  writeFileSync(
    sourcePath,
    trimmed.replace(citedCommentAnchor, "Generate skill stubs"),
  );
  assert.equal(
    score().rows.find(({ id }) => id === "clarity-anchor-preserved")?.passed,
    false,
  );

  writeFileSync(sourcePath, trimmed);
  const testPath = join(project, "test/skill-stub.test.mjs");
  const tests = readFileSync(testPath, "utf8");
  writeFileSync(testPath, tests.replace("# goat-plan", "# changed"));
  assert.equal(
    score().rows.find(({ id }) => id === "clarity-other-bytes-preserved")
      ?.passed,
    false,
  );
});
