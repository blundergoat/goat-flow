/**
 * Exercises review authority where it meets real Git objects, index entries, files, and CLI processes.
 * Controls distinguish valid selected bytes from substitutions, drift, unsupported sources, and uncredited execution.
 *
 * Fixture arrangement may write its disposable repository; snapshots and validation must preserve all fixture bytes and modes.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import {
  canonicalReviewJson,
  captureReviewSnapshot,
  parseReviewJson,
  readReviewAnchor,
  readReviewAuthority,
  reviewGateId,
  reviewScopeLabels,
  type ReviewAuthoritySnapshot,
  type ReviewSnapshotEnvelope,
} from "../../src/cli/review-validate-authority.js";
import { validateReviewReport } from "../../src/cli/review-validate.js";
import {
  CLI_PATH,
  createReviewedProject,
  reviewReportTemplate,
} from "../unit/review-validate.helpers.js";

/** Spawn Git to write fixture history or read its state, exclusively inside the disposable reviewed project. */
function git(root: string, args: string[], input?: string): string {
  return execFileSync("git", ["--no-optional-locks", "-C", root, ...args], {
    input,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Review fixture",
      GIT_AUTHOR_EMAIL: "review@example.invalid",
      GIT_COMMITTER_NAME: "Review fixture",
      GIT_COMMITTER_EMAIL: "review@example.invalid",
    },
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

/** Create one actual commit with a tracked source file and an attached HEAD. */
function repository(
  test: TestContext,
  format = "sha1",
): { root: string; base: string } {
  const root = createReviewedProject(test);
  git(root, ["init", "-q", `--object-format=${format}`]);
  git(root, ["add", "src/example.ts"]);
  const base = git(
    root,
    ["commit-tree", git(root, ["write-tree"])],
    "initial fixture\n",
  );
  git(root, ["update-ref", "HEAD", base]);
  return { root, base };
}

/** Capture the selected source exactly as the CLI producer does; execution defaults to unrequested. */
function capture(
  root: string,
  source: unknown,
  execution = false,
  renames: unknown[] = [],
): ReviewSnapshotEnvelope {
  return captureReviewSnapshot(
    JSON.stringify({
      schema: "goat-review-request/v1",
      source,
      execution,
      renames,
    }),
    root,
  );
}

/** Supply an explicit no-gate record, which cannot be confused with executed proof. */
function noGates(snapshot: ReviewAuthoritySnapshot): unknown {
  return {
    schema: "goat-review-gates/v1",
    review: snapshot.fingerprint,
    trustedBase: null,
    hostInstructions: [],
    gates: [],
  };
}

/** Bind an existing full-report control to the actual source selected by this test. */
function report(
  snapshot: ReviewAuthoritySnapshot,
  search = "loadConfig",
  path = "src/example.ts",
  side?: "old" | "new",
): string {
  const labels = reviewScopeLabels(snapshot);
  const scope = `- Scope snapshot: source=${labels.source}, base=${labels.base}, head=${labels.head}, authority=${snapshot.fingerprint}, drift=verified, uncommitted=${labels.uncommitted}, signals=1, bundle=.goat-flow/logs/review/goat-review-bundle.fixture.diff, chunking=none`;
  let text = reviewReportTemplate(path, search).replace(
    /^- Scope snapshot:.*$/mu,
    `${scope}\n- Authority snapshot: ${canonicalReviewJson(snapshot)}\n- Gate authority: ${canonicalReviewJson(noGates(snapshot))}`,
  );
  // Area reviews count clusters; retaining diff units would mask the authority behavior under test.
  if (snapshot.source.kind === "area")
    text = text.replace("1 changed lines", "1 clusters");
  // An explicit side or delimiter-bearing filename needs escaped evidence so the report preserves its literal meaning.
  if (side !== undefined || /[\n\r\t`|"<>]/u.test(path + search))
    text = text.replaceAll(
      `\`${path}\` (search: \`${search}\`)`,
      `anchor=${canonicalReviewJson({ path, search, side: side ?? "new" })}`,
    );
  return text;
}

/** Build a compact zero-finding receipt with the same frozen authority used by full reports. */
function compact(snapshot: ReviewAuthoritySnapshot): string {
  return `Scope: reviewed explicit source; 1 file and 1 changed line; chunking=none.
Authority snapshot: ${canonicalReviewJson(snapshot)}
Gate authority: ${canonicalReviewJson(noGates(snapshot))}
Ship Verdict: **YES** - no blocking finding survived Pass 2.
Zero findings: checked boundary conditions, error paths, and integration seams; guards disproved every suspicion.
Review Integrity: confident; 1/1 files opened; no degradation flags; validator=validated.
What I Didn't Examine: none.
`;
}

/** Record every fixture file's bytes and mode, including Git metadata, before read-only validation. */
function fixtureState(root: string, directory = ""): string[] {
  return readdirSync(join(root, directory))
    .sort()
    .flatMap((name) => {
      const path = directory ? `${directory}/${name}` : name;
      const absolute = join(root, path);
      const details = lstatSync(absolute);
      // Fixture trees contain only files, directories, and explicitly tested symlinks; never traverse a symlink.
      if (details.isDirectory()) return fixtureState(root, path);
      // Record the symlink itself without following it into files outside the disposable fixture.
      if (details.isSymbolicLink()) return [`${path}:symlink:${details.mode}`];
      return [
        `${path}:${details.mode}:${createHash("sha256").update(readFileSync(absolute)).digest("hex")}`,
      ];
    });
}

/** Assert a report result and prove that the validator itself left the fixture unchanged. */
function assertReviewResult(
  root: string,
  text: string,
  expected: "pass" | string,
): void {
  const before = fixtureState(root);
  const result = validateReviewReport(text, root);
  assert.deepEqual(
    fixtureState(root),
    before,
    "validation must preserve fixture bytes and modes",
  );
  // A negative case must fail for its intended authority issue, not merely for an unrelated malformed fixture field.
  if (expected === "pass") assert.deepEqual(result.violations, []);
  else
    assert.equal(
      result.violations.some((violation) => violation.code === expected),
      true,
      JSON.stringify(result.violations),
    );
}

/** Arrange a new immutable tree without checkout, using only the fixture index and local objects. */
function revision(
  root: string,
  files: Record<string, string>,
  parents: string[],
): string {
  git(root, ["read-tree", "--empty"]);
  // Each supplied path becomes an exact blob in the synthetic history; arrangement never runs a reviewed command.
  for (const [path, contents] of Object.entries(files)) {
    const blob = git(root, ["hash-object", "-w", "--stdin"], contents);
    git(root, [
      "update-index",
      "--add",
      "--cacheinfo",
      `100644,${blob},${path}`,
    ]);
  }
  return git(
    root,
    [
      "commit-tree",
      git(root, ["write-tree"]),
      ...parents.flatMap((parent) => ["-p", parent]),
    ],
    "selected fixture revision\n",
  );
}

describe("review authority across real repository state", () => {
  // Distinct HEAD, staged, and editor contents make the selected byte source observable; assertReviewResult also checks fixture mutation.
  it("uses staged bytes, refuses HEAD/live substitutions, and detects index drift", (test) => {
    const { root } = repository(test);
    writeFileSync(
      join(root, "src/example.ts"),
      "export const stagedOnly = true;\n",
    );
    git(root, ["add", "src/example.ts"]);
    writeFileSync(
      join(root, "src/example.ts"),
      "export const liveOnly = true;\n",
    );
    const { authority } = capture(root, { kind: "staged", base: "HEAD" });
    assertReviewResult(root, report(authority, "stagedOnly"), "pass");
    assertReviewResult(
      root,
      report(authority, "loadConfig"),
      "anchor-unresolved",
    );
    assertReviewResult(
      root,
      report(authority, "liveOnly"),
      "anchor-unresolved",
    );
    git(root, ["add", "src/example.ts"]);
    assertReviewResult(
      root,
      report(authority, "stagedOnly"),
      "authority-drift",
    );
  });

  // Deliberately different index states prove deletion remains reviewable while unresolved or incomplete staging is refused.
  it("resolves deleted staged files from the old side and rejects unmerged, intent-to-add, and sparse entries", (test) => {
    const { root, base } = repository(test);
    git(root, ["update-index", "--force-remove", "src/example.ts"]);
    assertReviewResult(
      root,
      report(capture(root, { kind: "staged", base: "HEAD" }).authority),
      "pass",
    );
    const blob = git(root, ["rev-parse", `${base}:src/example.ts`]);
    git(
      root,
      ["update-index", "--index-info"],
      `100644 ${blob} 1\tsrc/example.ts\n100644 ${blob} 3\tsrc/example.ts\n`,
    );
    assert.throws(
      () => capture(root, { kind: "staged", base: "HEAD" }),
      /unmerged/u,
    );
    git(root, ["read-tree", base]);
    writeFileSync(join(root, "intent.ts"), "not staged yet\n");
    git(root, ["add", "-N", "intent.ts"]);
    assert.throws(
      () => capture(root, { kind: "staged", base: "HEAD" }),
      /intent-to-add/u,
    );
    git(root, ["read-tree", base]);
    git(root, ["update-index", "--skip-worktree", "src/example.ts"]);
    assert.throws(
      () => capture(root, { kind: "staged", base: "HEAD" }),
      /sparse/u,
    );
  });

  it("fingerprints semantic index flags while ignoring index timestamps", (test) => {
    const { root } = repository(test);
    const before = capture(root, { kind: "staged", base: "HEAD" }).authority;
    git(root, ["update-index", "--refresh"]);
    assert.equal(
      capture(root, { kind: "staged", base: "HEAD" }).authority.index,
      before.index,
    );
    git(root, ["update-index", "--assume-unchanged", "src/example.ts"]);
    assert.notEqual(
      capture(root, { kind: "staged", base: "HEAD" }).authority.index,
      before.index,
    );
  });

  it("binds PR, branch, ranges, and commit parents to actual diverged history", (test) => {
    const { root, base } = repository(test);
    const target = revision(root, { "src/example.ts": "targetTipOnly\n" }, [
      base,
    ]);
    const head = revision(root, { "renamed.ts": "headOnly\n" }, [base]);
    git(root, ["update-ref", "refs/heads/target", target]);
    git(root, ["update-ref", "refs/heads/reviewed", head]);
    // Both tips diverge from the same base, so using the target tip for a deleted anchor would select the wrong text.
    for (const kind of ["pr", "branch"]) {
      const snapshot = capture(
        root,
        { kind, target: "target", head: "reviewed" },
        false,
        [{ old: "src/example.ts", new: "renamed.ts" }],
      ).authority;
      assert.equal(snapshot.source.comparisonBase, base);
      assert.equal(snapshot.source.targetTip, target);
      assertReviewResult(root, report(snapshot), "pass");
      assertReviewResult(
        root,
        report(snapshot, "targetTipOnly"),
        "anchor-unresolved",
      );
      assertReviewResult(
        root,
        report(snapshot, "loadConfig", "src/example.ts", "old"),
        "pass",
      );
      assertReviewResult(
        root,
        report(snapshot, "headOnly", "renamed.ts", "new"),
        "pass",
      );
    }
    const endpoints = capture(root, {
      kind: "range",
      left: target,
      right: head,
      operator: "..",
    }).authority;
    const mergeBase = capture(root, {
      kind: "range",
      left: target,
      right: head,
      operator: "...",
    }).authority;
    assert.equal(endpoints.source.comparisonBase, target);
    assert.equal(mergeBase.source.comparisonBase, base);
    assertReviewResult(root, report(endpoints, "targetTipOnly"), "pass");
    assertReviewResult(root, report(mergeBase), "pass");
    assertReviewResult(
      root,
      report(
        capture(root, { kind: "commit", commit: base, parent: null }).authority,
      ),
      "pass",
    );
    const merge = revision(root, { "merged.ts": "merged\n" }, [target, head]);
    assert.throws(
      () => capture(root, { kind: "commit", commit: merge, parent: null }),
      /explicit parent/u,
    );
    assert.equal(
      capture(root, { kind: "commit", commit: merge, parent: 2 }).authority
        .source.comparisonBase,
      head,
    );
    assert.throws(
      () => capture(root, { kind: "commit", commit: merge, parent: 3 }),
      /does not exist/u,
    );
    git(root, ["update-ref", "refs/heads/reviewed", target]);
    assertReviewResult(root, report(mergeBase), "pass");
    // The explicit endpoint receipt stays valid; the mutable branch selection must report drift.
    const pinned = capture(root, {
      kind: "branch",
      target: "target",
      head: "reviewed",
    }).authority;
    git(root, ["update-ref", "refs/heads/reviewed", head]);
    assertReviewResult(root, compact(pinned), "authority-drift");
  });

  it("refuses ambiguous merge bases and unresolved endpoints even without findings", (test) => {
    const { root, base } = repository(test);
    const left = revision(root, { "left.ts": "left\n" }, [base]);
    const right = revision(root, { "right.ts": "right\n" }, [base]);
    const firstMerge = revision(root, { "one.ts": "one\n" }, [left, right]);
    const secondMerge = revision(root, { "two.ts": "two\n" }, [right, left]);
    assert.throws(
      () =>
        capture(root, {
          kind: "range",
          left: firstMerge,
          right: secondMerge,
          operator: "...",
        }),
      /multiple merge bases/u,
    );
    assert.throws(
      () =>
        capture(root, {
          kind: "range",
          left: "missing",
          right: base,
          operator: "..",
        }),
      /local Git/u,
    );
    const snapshot = capture(root, {
      kind: "range",
      left: base,
      right: base,
      operator: "..",
    }).authority;
    assertReviewResult(root, compact(snapshot), "pass");
    assertReviewResult(
      root,
      compact(snapshot).replace(/^Authority snapshot:.*\n/mu, ""),
      "authority-format",
    );
  });

  // These scopes used to discard authority metadata; each must now detect a saved edit independently.
  for (const kind of ["unstaged", "worktree", "paths", "area"]) {
    it(`binds ${kind} bytes and refuses missing authority`, (test) => {
      const { root } = repository(test);
      writeFileSync(join(root, "src/example.ts"), "loadConfig liveChange\n");
      const sources: Record<string, unknown> = {
        unstaged: { kind },
        worktree: { kind, base: "HEAD", untracked: { mode: "all-nonignored" } },
        paths: { kind, paths: [{ path: "src/example.ts", from: "live" }] },
        area: { kind, roots: ["src"], sample: null },
      };
      const snapshot = capture(root, sources[kind]).authority;
      assertReviewResult(root, report(snapshot), "pass");
      assertReviewResult(
        root,
        report(snapshot).replace(/^- Authority snapshot:.*\n/mu, ""),
        "authority-format",
      );
      writeFileSync(join(root, "src/example.ts"), "loadConfig changedAgain\n");
      assertReviewResult(root, report(snapshot), "authority-drift");
    });
  }

  // Added, removed, and executable files distinguish a frozen whole-area selection from a deliberately bounded sample.
  it("detects included membership and mode drift while keeping an area sample bounded", (test) => {
    const { root } = repository(test);
    const worktree = capture(root, {
      kind: "worktree",
      base: "HEAD",
      untracked: { mode: "all-nonignored" },
    }).authority;
    const area = capture(root, {
      kind: "area",
      roots: ["src"],
      sample: null,
    }).authority;
    const sample = capture(root, {
      kind: "area",
      roots: ["src"],
      sample: ["src/example.ts"],
    }).authority;
    writeFileSync(join(root, "src/added.ts"), "added\n");
    assertReviewResult(root, compact(worktree), "authority-drift");
    assertReviewResult(root, report(area), "authority-drift");
    assertReviewResult(root, report(sample), "pass");
    chmodSync(join(root, "src/example.ts"), 0o755);
    assertReviewResult(root, report(sample), "authority-drift");
  });

  it("retains absent explicit paths and rejects unsafe, duplicated, or unsupported selections", (test) => {
    const root = createReviewedProject(test);
    const absent = capture(root, {
      kind: "paths",
      paths: [{ path: "missing.ts", from: "live" }],
    }).authority;
    assert.deepEqual(absent.inventory[0]?.new, { kind: "absent" });
    assertReviewResult(
      root,
      report(absent, "missing", "missing.ts"),
      "anchor-unresolved",
    );
    assertReviewResult(root, compact(absent), "authority-path");
    // Unsafe spellings cannot be normalized into a different selected file.
    for (const path of [
      "../outside.ts",
      "/absolute.ts",
      "src/../example.ts",
      "src//example.ts",
      "src\\example.ts",
      "C:/example.ts",
    ])
      assert.throws(
        () => capture(root, { kind: "paths", paths: [{ path, from: "live" }] }),
        /unsafe|ambiguous/u,
      );
    assert.throws(
      () =>
        capture(root, {
          kind: "paths",
          paths: [
            { path: "src/example.ts", from: "live" },
            { path: "src/example.ts", from: "live" },
          ],
        }),
      /duplicate/u,
    );
    symlinkSync("src/example.ts", join(root, "linked.ts"));
    assert.throws(
      () =>
        capture(root, {
          kind: "paths",
          paths: [{ path: "linked.ts", from: "live" }],
        }),
      /symlink/u,
    );
  });

  // Unrelated symlinks and incompatible selected revisions separate readable finding evidence from an executable full workspace.
  it("captures qualified files independently of unrelated unsupported tree entries and refuses incompatible execution views", (test) => {
    const { root, base } = repository(test);
    symlinkSync("src/example.ts", join(root, "linked.ts"));
    git(root, ["add", "linked.ts"]);
    const head = git(
      root,
      ["commit-tree", git(root, ["write-tree"]), "-p", base],
      "symlink fixture\n",
    );
    const source = {
      kind: "paths",
      paths: [{ path: "src/example.ts", from: "git", revision: head }],
    };
    const snapshot = capture(root, source).authority;
    assertReviewResult(root, report(snapshot), "pass");
    const execution = capture(root, source, true);
    assert.equal(execution.authority.workspace, null);
    assert.match(execution.checkout.reason ?? "", /unsupported/u);
    git(root, ["read-tree", base]);
    unlinkSync(join(root, "linked.ts"));
    const earlier = revision(root, { "src/other.ts": "earlierBytes\n" }, [
      base,
    ]);
    writeFileSync(join(root, "src/other.ts"), "differentLiveBytes\n");
    const mixed = capture(
      root,
      {
        kind: "paths",
        paths: [
          { path: "src/example.ts", from: "live" },
          { path: "src/other.ts", from: "git", revision: earlier },
        ],
      },
      true,
    );
    assert.equal(mixed.authority.workspace, null);
    assert.equal(mixed.checkout.reason, "incompatible-selected-views");
  });

  // One delimiter-bearing filename exercises the actual Git, index, live-file, and Markdown boundaries together.
  it("preserves special-character paths and escaped anchors literally on Git and live sides", (test) => {
    const { root } = repository(test);
    const path = 'src/space "quote"\tline\npipe|tick`colon:é.ts';
    const literal = 'literal | ` " <tag> &\nsecond line';
    writeFileSync(join(root, path), literal);
    git(root, ["add", "--", path]);
    const head = git(
      root,
      ["commit-tree", git(root, ["write-tree"])],
      "special paths\n",
    );
    // Each qualified origin must resolve the same literal path, with no shell or Markdown delimiter interpretation.
    for (const member of [
      { path, from: "live" },
      { path, from: "index" },
      { path, from: "git", revision: head },
    ]) {
      const snapshot = capture(root, {
        kind: "paths",
        paths: [member],
      }).authority;
      assert.equal(snapshot.inventory[0]?.path, path);
      assert.equal(readReviewAnchor(root, snapshot, path).toString(), literal);
      assertReviewResult(root, report(snapshot, literal, path), "pass");
      assertReviewResult(
        root,
        report(snapshot, literal, path).replace("anchor={", "anchor={broken,"),
        "anchor-format",
      );
    }
  });

  it("supports unborn staged state and SHA-256 repositories without fake commit IDs", (test) => {
    const root = createReviewedProject(test);
    git(root, ["init", "-q"]);
    git(root, ["add", "src/example.ts"]);
    const staged = capture(root, { kind: "staged", base: "HEAD" }).authority;
    assert.equal(staged.source.base, null);
    assertReviewResult(root, report(staged), "pass");
    assert.throws(
      () => capture(root, { kind: "staged", base: "typo" }),
      /local Git/u,
    );
    const sha256 = repository(test, "sha256");
    const commit = capture(sha256.root, {
      kind: "commit",
      commit: sha256.base,
      parent: null,
    }).authority;
    assert.equal(commit.objectFormat, "sha256");
    assert.equal(sha256.base.length, 64);
    assertReviewResult(sha256.root, report(commit), "pass");
  });

  it("refuses duplicate JSON keys, unsafe numbers, unknown fields, and noncanonical frozen evidence", (test) => {
    const root = createReviewedProject(test);
    assert.throws(
      () => parseReviewJson('{"source":1,"source":2}'),
      /duplicate/u,
    );
    assert.throws(() => parseReviewJson('{"a":1,"\\u0061":2}'), /duplicate/u);
    assert.throws(() => parseReviewJson("9007199254740992"), /safe integer/u);
    // Rounding must not turn a fractional parent choice into an apparently valid integer selection.
    for (const input of [
      "1.00000000000000001",
      "0.99999999999999999",
      "1e-999",
      "2.0000000000000001",
    ])
      assert.throws(() => parseReviewJson(input), /safe integer/u);
    // Ordinary JSON spellings of exact integers remain valid requests before canonical receipt serialization.
    for (const [input, expected] of [
      ["1.0", 1],
      ["100e-2", 1],
      ["0e9999", 0],
    ] as const)
      assert.equal(parseReviewJson(input), expected);
    assert.throws(() => parseReviewJson('"\\ud800"'), /UTF-8/u);
    assert.throws(
      () => capture(root, { kind: "paths", paths: [], extra: true }),
      /expected fields/u,
    );
    const snapshot = capture(root, {
      kind: "paths",
      paths: [{ path: "src/example.ts", from: "live" }],
    }).authority;
    const issues: Parameters<typeof readReviewAuthority>[3] = [];
    readReviewAuthority(JSON.stringify(snapshot, null, 2), root, null, issues);
    assert.equal(issues[0]?.code, "authority-format");
    const full = report(snapshot);
    assertReviewResult(
      root,
      full.replace(
        /^- Authority snapshot:(.*)$/mu,
        "<!-- - Authority snapshot:$1 -->",
      ),
      "authority-format",
    );
    assertReviewResult(
      root,
      `${full}\nAuthority snapshot: ${canonicalReviewJson(snapshot)}\n`,
      "authority-format",
    );
    assertReviewResult(
      root,
      compact(snapshot).replace(
        /^Authority snapshot:(.*)$/mu,
        "> Authority snapshot:$1",
      ),
      "authority-format",
    );
    assertReviewResult(
      root,
      compact(snapshot).replace(
        /^Gate authority:(.*)$/mu,
        "Gate authority:$1 ",
      ),
      "authority-format",
    );
  });

  it("does not run Git content filters and excludes nested/ignored trees from an area", (test) => {
    const { root } = repository(test);
    const marker = join(root, "filter-ran");
    git(root, ["config", "filter.review.clean", `touch ${marker}`]);
    writeFileSync(join(root, ".gitattributes"), "src/*.ts filter=review\n");
    assert.throws(
      () => capture(root, { kind: "unstaged" }),
      /unsupported content conversion/u,
    );
    assert.equal(existsSync(marker), false);
    writeFileSync(join(root, ".gitignore"), "src/ignored/\n");
    mkdirSync(join(root, "src/ignored"));
    writeFileSync(join(root, "src/ignored/hidden.ts"), "hidden");
    mkdirSync(join(root, "src/nested"));
    git(join(root, "src/nested"), ["init", "-q"]);
    writeFileSync(join(root, "src/nested/other.ts"), "other");
    symlinkSync("ignored", join(root, "src/linked"));
    const area = capture(root, {
      kind: "area",
      roots: ["src"],
      sample: null,
    }).authority;
    assert.deepEqual(
      area.inventory.map((entry) => entry.path),
      ["src/example.ts"],
    );
    assert.equal(
      capture(root, {
        kind: "paths",
        paths: [{ path: "src/ignored/hidden.ts", from: "live" }],
      }).authority.inventory[0]?.new.kind,
      "file",
    );
  });

  it("uses Git's effective autocrlf setting and boolean spellings for live comparisons", (test) => {
    const { root } = repository(test);
    // Each true spelling enables conversion in Git and must produce the same raw-comparison refusal.
    for (const value of ["true", "TRUE", "yes", "on", "1", "input"]) {
      git(root, ["config", "core.autocrlf", value]);
      assert.throws(
        () => capture(root, { kind: "unstaged" }),
        /unsupported content conversion/u,
        value,
      );
    }
    // Later configuration wins; an earlier true value cannot block the operator's effective false setting.
    git(root, ["config", "core.autocrlf", "true"]);
    git(root, ["config", "--add", "core.autocrlf", "false"]);
    assert.deepEqual(
      capture(root, { kind: "unstaged" }).authority.inventory,
      [],
    );
  });

  it("keeps anchor markers inside ordinary evidence and path metadata literal", (test) => {
    const { root } = repository(test);
    // The reviewer can cite the marker itself or a filename containing it without introducing another escaped anchor.
    for (const [path, search] of [
      ["src/example.ts", "anchor="],
      ["src/example.ts", "prefix anchor=tail"],
      ["src/space anchor=example.ts", "loadConfig"],
    ] as const) {
      writeFileSync(
        join(root, path),
        "loadConfig anchor= prefix anchor=tail\n",
      );
      const snapshot = capture(root, {
        kind: "paths",
        paths: [{ path, from: "live" }],
      }).authority;
      const text = report(snapshot, search, path);
      assertReviewResult(root, text, "pass");
      assertReviewResult(
        root,
        text.replace(" | Harm:", " anchor={broken} | Harm:"),
        "anchor-format",
      );
    }
  });

  it("keeps committed authority stable when the unrelated checkout becomes unsupported", (test) => {
    const { root, base } = repository(test);
    const source = { kind: "commit", commit: base, parent: null };
    const selected = capture(root, source, true);
    git(root, ["update-index", "--skip-worktree", "src/example.ts"]);
    const current = capture(root, source, true);
    assert.deepEqual(current.authority, selected.authority);
    assert.equal(current.checkout.fingerprint, null);
    assert.match(current.checkout.reason ?? "", /sparse/u);
    assertReviewResult(root, report(selected.authority), "pass");
  });

  it("preserves trailing whitespace in the selected repository's directory name", (test) => {
    const parent = createReviewedProject(test);
    const root = join(parent, "reviewed project \t");
    mkdirSync(root);
    git(root, ["init", "-q"]);
    writeFileSync(join(root, "example.ts"), "loadConfig\n");
    const snapshot = capture(root, {
      kind: "paths",
      paths: [{ path: "example.ts", from: "live" }],
    }).authority;
    assertReviewResult(
      root,
      report(snapshot, "loadConfig", "example.ts"),
      "pass",
    );
  });
});

describe("review snapshot CLI and gate provenance", () => {
  // A real CLI process runs from the reviewed project, proving input selection, output refusal, and unchanged fixture state.
  it("captures stdin and file requests, refuses --output, and leaves the project unchanged", (test) => {
    const { root } = repository(test);
    const request = JSON.stringify({
      schema: "goat-review-request/v1",
      source: {
        kind: "paths",
        paths: [{ path: "src/example.ts", from: "live" }],
      },
    });
    const requestPath = join(root, "request.json");
    writeFileSync(requestPath, request);
    const before = fixtureState(root);
    // Both CLI input routes must use the same producer and emit only canonical metadata.
    for (const args of [[], [requestPath]]) {
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          import.meta.resolve("tsx"),
          CLI_PATH,
          "review",
          "snapshot",
          ...args,
        ],
        { cwd: root, input: request, encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(
        result.stdout.trimEnd(),
        canonicalReviewJson(captureReviewSnapshot(request, root)),
      );
    }
    const output = join(root, "forbidden.json");
    const refused = spawnSync(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        CLI_PATH,
        "review",
        "snapshot",
        "--output",
        output,
      ],
      { cwd: root, input: request, encoding: "utf8" },
    );
    assert.equal(refused.status, 2);
    assert.equal(existsSync(output), false);
    assert.deepEqual(fixtureState(root), before);
  });

  it("credits matching execution and retains a real wrong-checkout attempt as an uncredited skip", (test) => {
    const { root, base } = repository(test);
    const selected = capture(
      root,
      { kind: "commit", commit: base, parent: null },
      true,
    );
    assert.equal(selected.checkout.fingerprint, selected.authority.workspace);
    const argv = [
      process.execPath,
      "-e",
      "process.stdout.write(require('node:fs').readFileSync('src/example.ts','utf8'))",
    ];
    const reference = "host:test-selected-source-read";
    const hash = createHash("sha256").update(argv.join("\0")).digest("hex");
    const origin = { kind: "host", reference, sha256: hash };
    const before = fixtureState(root);
    const matching = spawnSync(argv[0]!, argv.slice(1), {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(matching.status, 0);
    assert.deepEqual(fixtureState(root), before);
    const gate = {
      id: reviewGateId(argv, ".", origin),
      argv,
      cwd: ".",
      origin,
      expectedWorkspace: selected.authority.workspace,
      attempts: [
        {
          number: 1,
          reviewBefore: selected.authority.fingerprint,
          reviewAfter: selected.authority.fingerprint,
          workspaceBefore: selected.checkout.fingerprint,
          workspaceAfter: selected.checkout.fingerprint,
          exitCode: matching.status,
          output: matching.stdout,
        },
      ],
      outcome: "pass",
      reason: null as string | null,
    };
    const gates = {
      schema: "goat-review-gates/v1",
      review: selected.authority.fingerprint,
      trustedBase: null,
      hostInstructions: [{ reference, sha256: hash }],
      gates: [gate],
    };
    // Rebuild the submitted receipt after each execution-state change so validation sees the user's current gate claim.
    const withGates = (): string =>
      report(selected.authority).replace(
        /^- Gate authority:.*$/mu,
        `- Gate authority: ${canonicalReviewJson(gates)}`,
      );
    assertReviewResult(root, withGates(), "pass");
    writeFileSync(join(root, "src/example.ts"), "workingTreeOnly\n");
    const wrong = capture(
      root,
      { kind: "commit", commit: base, parent: null },
      true,
    );
    assert.equal(wrong.authority.fingerprint, selected.authority.fingerprint);
    assert.notEqual(wrong.checkout.fingerprint, selected.authority.workspace);
    const wrongRun = spawnSync(argv[0]!, argv.slice(1), {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(wrongRun.stdout, "workingTreeOnly\n");
    gate.attempts[0]!.workspaceBefore = wrong.checkout.fingerprint;
    gate.attempts[0]!.workspaceAfter = wrong.checkout.fingerprint;
    gate.attempts[0]!.output = wrongRun.stdout;
    assertReviewResult(root, withGates(), "gate-state");
    gate.outcome = "skipped";
    gate.reason = "selected-state-mismatch";
    assertReviewResult(root, withGates(), "pass");
    gate.outcome = "pass";
    gate.reason = null;
    gate.attempts[0]!.workspaceBefore = selected.authority.workspace;
    gate.attempts[0]!.workspaceAfter = selected.authority.workspace;
    gate.attempts[0]!.exitCode = null;
    assertReviewResult(root, withGates(), "gate-state");
  });

  it("binds Git command provenance to a separate trusted revision and refuses reviewed instruction substitution", (test) => {
    const { root, base } = repository(test);
    const trusted = revision(
      root,
      { "package.json": '{"scripts":{"test":"node --test"}}\n' },
      [base],
    );
    const head = revision(
      root,
      {
        "src/example.ts": "loadConfig\n",
        "package.json": '{"scripts":{"test":"changed-command"}}\n',
      },
      [trusted],
    );
    const selected = capture(
      root,
      { kind: "commit", commit: head, parent: 1 },
      true,
    ).authority;
    const literal = "node --test";
    const source = git(root, ["show", `${trusted}:package.json`]) + "\n";
    const origin = {
      kind: "git",
      revision: trusted,
      path: "package.json",
      sha256: createHash("sha256").update(source).digest("hex"),
      literal,
    };
    const argv = ["node", "--test"];
    const gate = {
      id: reviewGateId(argv, ".", origin),
      argv,
      cwd: ".",
      origin,
      expectedWorkspace: selected.workspace,
      attempts: [],
      outcome: "skipped",
      reason: "selected-state-mismatch",
    };
    const gates = {
      schema: "goat-review-gates/v1",
      review: selected.fingerprint,
      trustedBase: trusted,
      hostInstructions: [],
      gates: [gate],
    };
    // Rebuild the submitted receipt after each provenance change so reviewed instructions cannot replace the trusted command source.
    const withGates = (): string =>
      report(selected).replace(
        /^- Gate authority:.*$/mu,
        `- Gate authority: ${canonicalReviewJson(gates)}`,
      );
    assertReviewResult(root, withGates(), "pass");
    origin.revision = head;
    gate.id = reviewGateId(argv, ".", origin);
    assertReviewResult(root, withGates(), "gate-origin");
    origin.revision = trusted;
    gate.id = reviewGateId(argv, ".", origin);
    gates.gates.push(gate);
    assertReviewResult(root, withGates(), "gate-origin");
    gates.gates.pop();
    assertReviewResult(
      root,
      withGates().replace("- Gates: skipped (not requested)", "- Gates: run"),
      "gate-state",
    );
    assertReviewResult(
      root,
      report(selected).replace(
        "- Gates: skipped (not requested)",
        "- Gates: run   ",
      ),
      "gate-state",
    );
  });
});
