/**
 * Verifies the developer journey from `learn new` flags to a safe learning-loop bucket publication.
 * Fixtures use real temporary projects so path containment, link identity, literal citations, indexes, and stats share production behavior.
 *
 * Failure cases assert the project stays unchanged before publication, while partial-state cases assert the exact recovery shown afterwards.
 * Dry-run coverage proves a validated preview never creates either a bucket or generated index.
 */
import assert from "node:assert/strict";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import { parseCLIArgs } from "../../src/cli/cli-parser.js";
import { dispatchCommand } from "../../src/cli/cli-handlers.js";
import {
  renderLearnEntrySkeleton,
  runLearnScaffold,
  type LearnScaffoldRequest,
} from "../../src/cli/learn-scaffold.js";
import { BUCKET_SIZE_WARN_BYTES } from "../../src/cli/stats/stats.js";

const FIXED_DATE = new Date("2026-08-24T00:00:00.000Z");
const LEARNING_ROOT = ".goat-flow/learning-loop";
const BUCKET_DIRECTORIES = [
  `${LEARNING_ROOT}/footguns`,
  `${LEARNING_ROOT}/lessons`,
  `${LEARNING_ROOT}/patterns`,
  `${LEARNING_ROOT}/decisions`,
] as const;

/** Writes one isolated project with every learning-loop directory and a real citation target; the caller removes it after each test. */
function createLearningProject(): string {
  const projectRoot = mkdtempSync(join(tmpdir(), "goat-flow-learn-"));
  // Every configured bucket exists so post-write index generation and stats measure the complete fixture rather than missing setup.
  for (const bucketDirectory of BUCKET_DIRECTORIES) {
    mkdirSync(join(projectRoot, bucketDirectory), { recursive: true });
  }
  mkdirSync(join(projectRoot, "src"), { recursive: true });
  writeFileSync(
    join(projectRoot, "src/evidence.ts"),
    "export const durableEvidenceMarker = true;\n",
  );
  return projectRoot;
}

/** Build a valid lesson request; each test overrides only the developer input that exercises its boundary. */
function lessonRequest(
  projectRoot: string,
  overrides: Partial<LearnScaffoldRequest> = {},
): LearnScaffoldRequest {
  return {
    projectRoot,
    entryType: "lesson",
    category: "verification",
    title: "Keep literal proof",
    evidencePaths: [],
    searchLiterals: [],
    evidenceKind: null,
    shouldDryRun: false,
    ...overrides,
  };
}

/** Return the deterministic clock dependency used by fixtures that compare generated dates. */
function fixedClock() {
  return { now: () => FIXED_DATE };
}

/** Writes one valid lessons bucket with active content and a resolved-history boundary; returns its exact baseline bytes for mutation checks. */
function writeExistingLessonBucket(projectRoot: string): {
  bucketPath: string;
  content: string;
} {
  const bucketPath = join(
    projectRoot,
    LEARNING_ROOT,
    "lessons/verification.md",
  );
  const content = `---
category: verification
last_reviewed: 2026-08-01
---

## Lesson: Existing entry

**Created:** 2026-08-01

**What happened:** Existing entry bytes must stay unchanged.

## Resolved Entries

## Lesson: Historical entry

**Status:** resolved | **Created:** 2026-07-01

**What happened:** Resolved history remains below the boundary.
`;
  writeFileSync(bucketPath, content);
  return { bucketPath, content };
}

/** Creates a file symlink, skips an EPERM-only host limitation, and throws every unexpected fixture error. */
function symlinkFileOrSkip(
  testContext: TestContext,
  targetPath: string,
  linkPath: string,
): boolean {
  try {
    symlinkSync(targetPath, linkPath, "file");
    return true;
  } catch (error) {
    // Windows without Developer Mode can reject this fixture with EPERM; other failures still expose a real test problem.
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      testContext.skip(
        "Skipped: host blocks unprivileged file symlinks (Windows without Developer Mode)",
      );
      return false;
    }
    throw error;
  }
}

/** Assert whether every configured bucket has an INDEX file, so each test reports the exact missing or unexpected path. */
function assertAllIndexFiles(projectRoot: string, shouldExist: boolean): void {
  // Every directory is named in its assertion message so a failed fixture identifies the user-visible bucket that drifted.
  for (const bucketDirectory of BUCKET_DIRECTORIES) {
    assert.equal(
      existsSync(join(projectRoot, bucketDirectory, "INDEX.md")),
      shouldExist,
      bucketDirectory,
    );
  }
}

describe("learn new parser", () => {
  it("keeps repeatable evidence and search flags paired in caller order", () => {
    const parsed = parseCLIArgs([
      "learn",
      "new",
      ".",
      "--type",
      "footgun",
      "--category",
      "hooks",
      "--title",
      "Hook drift",
      "--evidence",
      "src/one.ts",
      "--search",
      "one marker",
      "--evidence",
      "src/two.ts",
      "--search",
      "two marker",
      "--evidence-kind",
      "OBSERVED",
      "--dry-run",
    ]);

    assert.equal(parsed.command, "learn");
    assert.equal(parsed.learnSubcommand, "new");
    assert.equal(parsed.learnEntryType, "footgun");
    assert.equal(parsed.learnCategory, "hooks");
    assert.equal(parsed.learnTitle, "Hook drift");
    assert.deepEqual(parsed.learnEvidencePaths, ["src/one.ts", "src/two.ts"]);
    assert.deepEqual(parsed.learnSearchLiterals, ["one marker", "two marker"]);
    assert.equal(parsed.learnEvidenceKind, "OBSERVED");
    assert.equal(parsed.shouldDryRun, true);
  });

  it("rejects unpaired citations and a footgun without an evidence kind", () => {
    assert.throws(
      () =>
        parseCLIArgs([
          "learn",
          "new",
          "--type",
          "lesson",
          "--category",
          "verification",
          "--title",
          "Pair flags",
          "--evidence",
          "src/evidence.ts",
        ]),
      /requires one paired --search/u,
    );
    assert.throws(
      () =>
        parseCLIArgs([
          "learn",
          "new",
          "--type",
          "footgun",
          "--category",
          "hooks",
          "--title",
          "Evidence kind",
          "--evidence",
          "src/evidence.ts",
          "--search",
          "marker",
        ]),
      /require --evidence-kind/u,
    );
  });
});

describe("learning entry skeletons", () => {
  it("renders schema fields for footgun, lesson, and pattern without invented prose", () => {
    const citation = [
      { path: "src/evidence.ts", literal: "durableEvidenceMarker" },
    ];
    const footgun = renderLearnEntrySkeleton(
      "footgun",
      "Hook drift",
      "2026-08-24",
      citation,
      "OBSERVED",
    );
    const lesson = renderLearnEntrySkeleton(
      "lesson",
      "Check proof",
      "2026-08-24",
      [],
      null,
    );
    const pattern = renderLearnEntrySkeleton(
      "pattern",
      "Reuse proof",
      "2026-08-24",
      [],
      null,
    );

    assert.match(
      footgun,
      /\*\*Status:\*\* active \| \*\*Created:\*\* 2026-08-24 \| \*\*Evidence:\*\* OBSERVED/u,
    );
    assert.match(footgun, /^\*\*Symptoms:\*\*$/mu);
    assert.match(footgun, /src\/evidence\.ts.*durableEvidenceMarker/u);
    assert.match(lesson, /^## Lesson: Check proof$/mu);
    assert.match(lesson, /^\*\*What happened:\*\*$/mu);
    assert.doesNotMatch(lesson, /\[.+\]|<short name>/u);
    assert.match(pattern, /^\*\*Context:\*\*$/mu);
    assert.match(pattern, /^\*\*Approach:\*\*$/mu);
  });
});

describe("runLearnScaffold", () => {
  it("writes one new bucket with canonical frontmatter and fresh generated indexes", () => {
    const projectRoot = createLearningProject();
    const bucketPath = join(
      projectRoot,
      LEARNING_ROOT,
      "lessons/verification.md",
    );

    try {
      const result = runLearnScaffold(lessonRequest(projectRoot), fixedClock());
      const bucketContent = readFileSync(bucketPath, "utf-8");

      assert.equal(result.wasWritten, true);
      assert.match(result.output, /✓ stats --check passed/u);
      assert.match(
        bucketContent,
        /^---\ncategory: verification\nlast_reviewed: 2026-08-24\n---/u,
      );
      assert.match(bucketContent, /^## Lesson: Keep literal proof$/mu);
      // The selected lesson is the only source bucket; other generated Markdown files are indexes, not additional entries.
      assert.deepEqual(
        readdirSync(join(projectRoot, LEARNING_ROOT, "lessons")).sort(),
        ["INDEX.md", "verification.md"],
      );
      assertAllIndexFiles(projectRoot, true);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects unsafe categories and injected titles before creating a bucket", () => {
    const projectRoot = createLearningProject();
    try {
      assert.throws(
        () =>
          runLearnScaffold(
            lessonRequest(projectRoot, { category: "../escape" }),
            fixedClock(),
          ),
        /category/iu,
      );
      assert.throws(
        () =>
          runLearnScaffold(
            lessonRequest(projectRoot, { category: "/absolute" }),
            fixedClock(),
          ),
        /category/iu,
      );
      assert.throws(
        () =>
          runLearnScaffold(
            lessonRequest(projectRoot, { category: "bad\u0000name" }),
            fixedClock(),
          ),
        /category/iu,
      );
      assert.throws(
        () =>
          runLearnScaffold(
            lessonRequest(projectRoot, { title: "two\nlines" }),
            fixedClock(),
          ),
        /title/iu,
      );
      assert.throws(
        () =>
          runLearnScaffold(
            lessonRequest(projectRoot, { title: "# injected heading" }),
            fixedClock(),
          ),
        /title/iu,
      );
      assert.deepEqual(
        readdirSync(join(projectRoot, LEARNING_ROOT, "lessons")),
        [],
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects an exact duplicate heading without changing the existing bucket", () => {
    const projectRoot = createLearningProject();
    const { bucketPath, content } = writeExistingLessonBucket(projectRoot);

    try {
      assert.throws(
        () =>
          runLearnScaffold(
            lessonRequest(projectRoot, { title: "Existing entry" }),
            fixedClock(),
          ),
        /duplicate entry heading/u,
      );
      assert.equal(readFileSync(bucketPath, "utf-8"), content);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  // Fixture purpose: puts the requested heading in a fence beside an existing entry. Filesystem side effects stay inside the removed temp project.
  it("ignores duplicate-heading examples inside fenced code", () => {
    const projectRoot = createLearningProject();
    const { bucketPath, content } = writeExistingLessonBucket(projectRoot);
    const fencedHeading = "## Lesson: Fenced example";
    const withExample = content.replace(
      "**What happened:** Existing entry bytes must stay unchanged.",
      `**What happened:** Existing entry bytes must stay unchanged.\n\n\`\`\`markdown\n${fencedHeading}\n\`\`\``,
    );
    writeFileSync(bucketPath, withExample);

    try {
      const result = runLearnScaffold(
        lessonRequest(projectRoot, { title: "Fenced example" }),
        {
          ...fixedClock(),
          regenerateIndexes: () => undefined,
          verifyStats: () => null,
        },
      );
      assert.equal(result.wasWritten, true);
      const publishedContent = readFileSync(bucketPath, "utf-8");
      assert.ok(
        publishedContent.lastIndexOf(fencedHeading) <
          publishedContent.indexOf("## Resolved Entries"),
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("treats regex-shaped needles literally and rejects missing citation files", () => {
    const projectRoot = createLearningProject();
    const bucketPath = join(
      projectRoot,
      LEARNING_ROOT,
      "lessons/verification.md",
    );

    try {
      assert.throws(
        () =>
          runLearnScaffold(
            lessonRequest(projectRoot, {
              evidencePaths: ["src/evidence.ts"],
              searchLiterals: ["durable.*Marker"],
            }),
            fixedClock(),
          ),
        /Citation validation failed.*missing-needle/u,
      );
      assert.throws(
        () =>
          runLearnScaffold(
            lessonRequest(projectRoot, {
              evidencePaths: ["src/missing.ts"],
              searchLiterals: ["missing marker"],
            }),
            fixedClock(),
          ),
        /Citation validation failed.*missing-file/u,
      );
      assert.equal(existsSync(bucketPath), false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects a symlink bucket without replacing its target", (testContext) => {
    const projectRoot = createLearningProject();
    const realBucketPath = join(projectRoot, "real-bucket.md");
    const linkedBucketPath = join(
      projectRoot,
      LEARNING_ROOT,
      "lessons/verification.md",
    );
    writeFileSync(realBucketPath, "outside bucket\n");
    // A host that cannot create the required link reports a targeted skip rather than hiding other filesystem errors.
    if (!symlinkFileOrSkip(testContext, realBucketPath, linkedBucketPath)) {
      rmSync(projectRoot, { recursive: true, force: true });
      return;
    }

    try {
      assert.throws(
        () => runLearnScaffold(lessonRequest(projectRoot), fixedClock()),
        /single-link regular file/u,
      );
      assert.equal(readFileSync(realBucketPath, "utf-8"), "outside bucket\n");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects a hard-linked bucket without changing either name", () => {
    const projectRoot = createLearningProject();
    const realBucketPath = join(projectRoot, "real-bucket.md");
    const linkedBucketPath = join(
      projectRoot,
      LEARNING_ROOT,
      "lessons/verification.md",
    );
    writeFileSync(realBucketPath, "shared bucket\n");
    linkSync(realBucketPath, linkedBucketPath);

    try {
      assert.throws(
        () => runLearnScaffold(lessonRequest(projectRoot), fixedClock()),
        /single-link regular file/u,
      );
      assert.equal(readFileSync(realBucketPath, "utf-8"), "shared bucket\n");
      assert.equal(readFileSync(linkedBucketPath, "utf-8"), "shared bucket\n");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("preserves a cooperative editor save detected at the final recheck", () => {
    const projectRoot = createLearningProject();
    const { bucketPath, content } = writeExistingLessonBucket(projectRoot);
    const editorContent = `${content}\nEditor saved this sentence.\n`;

    try {
      assert.throws(
        () =>
          runLearnScaffold(lessonRequest(projectRoot), {
            ...fixedClock(),
            beforeBucketReplacement: () =>
              writeFileSync(bucketPath, editorContent),
          }),
        /changed while learn new was preparing/u,
      );
      assert.equal(readFileSync(bucketPath, "utf-8"), editorContent);
      assert.equal(
        readdirSync(join(projectRoot, LEARNING_ROOT, "lessons")).some(
          (filename) => filename.includes("learn-new"),
        ),
        false,
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  /** Fixture purpose: writes a bucket 40 bytes below the production gate so one schema-only scaffold crosses it deterministically. */
  it("warns before a prospective bucket crosses the stats size gate", () => {
    const projectRoot = createLearningProject();
    const bucketPath = join(
      projectRoot,
      LEARNING_ROOT,
      "lessons/verification.md",
    );
    const prefix = `---
category: verification
last_reviewed: 2026-08-01
---

## Lesson: Existing large entry

**Created:** 2026-08-01

**What happened:** `;
    const suffix = "\n";
    const paddingLength =
      BUCKET_SIZE_WARN_BYTES - Buffer.byteLength(prefix + suffix, "utf-8") - 40;
    const content = `${prefix}${"x".repeat(paddingLength)}${suffix}`;
    writeFileSync(bucketPath, content);

    try {
      const result = runLearnScaffold(
        lessonRequest(projectRoot, { shouldDryRun: true }),
        fixedClock(),
      );
      assert.equal(result.wasWritten, false);
      assert.match(
        result.output,
        /will exceed the 40000-byte bucket-size gate/u,
      );
      assert.equal(readFileSync(bucketPath, "utf-8"), content);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  // Fixture purpose: crosses the production byte gate on a real-write request. Filesystem side effects stay inside the removed temp project.
  it("rejects an oversized real write before changing buckets or indexes", () => {
    const projectRoot = createLearningProject();
    const bucketPath = join(
      projectRoot,
      LEARNING_ROOT,
      "lessons/verification.md",
    );
    const prefix = `---
category: verification
last_reviewed: 2026-08-01
---

## Lesson: Existing large entry

**Created:** 2026-08-01

**What happened:** `;
    const suffix = "\n";
    const paddingLength =
      BUCKET_SIZE_WARN_BYTES - Buffer.byteLength(prefix + suffix, "utf-8") - 40;
    const content = `${prefix}${"x".repeat(paddingLength)}${suffix}`;
    writeFileSync(bucketPath, content);

    try {
      assert.throws(
        () => runLearnScaffold(lessonRequest(projectRoot), fixedClock()),
        /will exceed the 40000-byte bucket-size gate.*No scaffold was published/u,
      );
      assert.equal(readFileSync(bucketPath, "utf-8"), content);
      assertAllIndexFiles(projectRoot, false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("retains the valid bucket and prints exact recovery when index generation fails", () => {
    const projectRoot = createLearningProject();
    const bucketPath = join(
      projectRoot,
      LEARNING_ROOT,
      "lessons/verification.md",
    );

    try {
      assert.throws(
        () =>
          runLearnScaffold(lessonRequest(projectRoot), {
            ...fixedClock(),
            regenerateIndexes: () => {
              throw new Error("fixture index failure");
            },
          }),
        (error: unknown) => {
          assert.match(
            String(error),
            /index regeneration failed: fixture index failure/u,
          );
          assert.match(
            String(error),
            /goat-flow index && goat-flow stats --check/u,
          );
          return true;
        },
      );
      assert.match(
        readFileSync(bucketPath, "utf-8"),
        /^## Lesson: Keep literal proof$/mu,
      );
      assert.equal(
        existsSync(join(projectRoot, LEARNING_ROOT, "lessons/INDEX.md")),
        false,
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("serializes concurrent scaffolds across the shared index write set", () => {
    const projectRoot = createLearningProject();
    const firstBucketPath = join(
      projectRoot,
      LEARNING_ROOT,
      "lessons/verification.md",
    );
    const competingBucketPath = join(
      projectRoot,
      LEARNING_ROOT,
      "lessons/parallel-write.md",
    );

    try {
      runLearnScaffold(lessonRequest(projectRoot), {
        ...fixedClock(),
        beforeBucketReplacement: () => {
          assert.throws(
            () =>
              runLearnScaffold(
                lessonRequest(projectRoot, {
                  category: "parallel-write",
                  title: "Competing scaffold",
                }),
                fixedClock(),
              ),
            /Another cooperating writer owns .*INDEX\.md.*No learning-loop files were changed/u,
          );
          assert.equal(existsSync(competingBucketPath), false);
        },
      });

      assert.match(
        readFileSync(firstBucketPath, "utf-8"),
        /^## Lesson: Keep literal proof$/mu,
      );
      assert.equal(existsSync(competingBucketPath), false);
      assertAllIndexFiles(projectRoot, true);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("dry-run validates content while writing neither bucket nor index", () => {
    const projectRoot = createLearningProject();
    const bucketPath = join(
      projectRoot,
      LEARNING_ROOT,
      "lessons/verification.md",
    );

    try {
      const result = runLearnScaffold(
        lessonRequest(projectRoot, { shouldDryRun: true }),
        fixedClock(),
      );
      assert.equal(result.wasWritten, false);
      assert.match(result.output, /Dry run: validated scaffold/u);
      assert.match(result.output, /^## Lesson: Keep literal proof$/mu);
      assert.equal(existsSync(bucketPath), false);
      assertAllIndexFiles(projectRoot, false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("preserves existing entry bytes and inserts new active content above resolved history", () => {
    const projectRoot = createLearningProject();
    const { bucketPath } = writeExistingLessonBucket(projectRoot);
    const existingEntry = `## Lesson: Existing entry

**Created:** 2026-08-01

**What happened:** Existing entry bytes must stay unchanged.`;

    try {
      runLearnScaffold(lessonRequest(projectRoot), {
        ...fixedClock(),
        regenerateIndexes: () => undefined,
        verifyStats: () => null,
      });
      const publishedContent = readFileSync(bucketPath, "utf-8");
      assert.match(publishedContent, /last_reviewed: 2026-08-24/u);
      assert.equal(publishedContent.includes(existingEntry), true);
      assert.ok(
        publishedContent.indexOf("## Lesson: Keep literal proof") <
          publishedContent.indexOf("## Resolved Entries"),
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  // Fixture purpose: writes an isolated bucket where prose and a fence mention the boundary before the one rendered H2, then removes it.
  it("ignores resolved-heading text in prose and fenced examples", () => {
    const projectRoot = createLearningProject();
    const { bucketPath, content } = writeExistingLessonBucket(projectRoot);
    const misleadingContent = content.replace(
      "**What happened:** Existing entry bytes must stay unchanged.",
      "**What happened:** The phrase ## Resolved Entries is ordinary prose here.\n\n```markdown\n## Resolved Entries\n```",
    );
    writeFileSync(bucketPath, misleadingContent);

    try {
      runLearnScaffold(lessonRequest(projectRoot), {
        ...fixedClock(),
        regenerateIndexes: () => undefined,
        verifyStats: () => null,
      });
      const publishedContent = readFileSync(bucketPath, "utf-8");
      assert.ok(
        publishedContent.indexOf("## Lesson: Keep literal proof") <
          publishedContent.lastIndexOf("## Resolved Entries"),
      );
      assert.match(
        publishedContent,
        /phrase ## Resolved Entries is ordinary prose/u,
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("emits the promised JSON schema through the public learn handler", async () => {
    const projectRoot = createLearningProject();
    const outputPath = join(projectRoot, "learn-result.json");

    try {
      const options = parseCLIArgs([
        "learn",
        "new",
        projectRoot,
        "--type",
        "lesson",
        "--category",
        "verification",
        "--title",
        "Keep literal proof",
        "--dry-run",
        "--format",
        "json",
        "--output",
        outputPath,
      ]);
      await dispatchCommand(options);
      const output = JSON.parse(readFileSync(outputPath, "utf-8")) as {
        command: string;
        subcommand: string;
        targetPath: string;
        wasWritten: boolean;
        scaffold: string;
      };

      assert.equal(output.command, "learn");
      assert.equal(output.subcommand, "new");
      assert.equal(output.wasWritten, false);
      assert.match(output.targetPath, /lessons\/verification\.md$/u);
      assert.match(output.scaffold, /^## Lesson: Keep literal proof$/mu);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
