import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { LearningLoopEntryFact } from "../../src/cli/types.js";
import {
  renderLearningLoopContext,
  selectLearningLoopContext,
} from "../../src/cli/prompt/learning-loop-context.js";

function entry(
  overrides: Partial<LearningLoopEntryFact> & {
    title: string;
    kind?: LearningLoopEntryFact["kind"];
  },
): LearningLoopEntryFact {
  const kind = overrides.kind ?? "footgun";
  return {
    sourcePath: `.goat-flow/${kind}s/${overrides.title.toLowerCase().replace(/\s+/g, "-")}.md`,
    kind,
    title: overrides.title,
    status: kind === "footgun" ? "active" : null,
    created: "2026-05-01",
    updated: null,
    resolved: null,
    excerpt: `${overrides.title} excerpt with compact evidence.`,
    staleRefs: [],
    invalidLineRefs: [],
    hasValidAnchor: true,
    bucketSizeBytes: 1_000,
    order: 0,
    ...overrides,
  };
}

describe("selectLearningLoopContext", () => {
  it("excludes resolved footguns from normal curated context", () => {
    const selection = selectLearningLoopContext({
      learningLoopEntries: [
        entry({ title: "active trap" }),
        entry({
          title: "resolved trap",
          status: "resolved",
          resolved: "2026-05-02",
        }),
      ],
    });

    assert.deepEqual(
      selection.entries.map((selected) => selected.title),
      ["active trap"],
    );
  });

  it("enforces per-kind caps before one bucket can consume the context", () => {
    const selection = selectLearningLoopContext(
      {
        learningLoopEntries: [
          entry({ title: "trap one", order: 1 }),
          entry({ title: "trap two", order: 2 }),
          entry({ title: "trap three", order: 3 }),
          entry({ title: "lesson one", kind: "lesson", order: 4 }),
          entry({ title: "lesson two", kind: "lesson", order: 5 }),
        ],
      },
      {
        perKind: {
          footgun: { maxEntries: 1 },
          lesson: { maxEntries: 1 },
        },
      },
    );

    assert.equal(
      selection.entries.filter((selected) => selected.kind === "footgun")
        .length,
      1,
    );
    assert.equal(
      selection.entries.filter((selected) => selected.kind === "lesson").length,
      1,
    );
  });

  it("excludes stale refs normally but surfaces them in maintenance mode", () => {
    const stale = entry({
      title: "stale trap",
      staleRefs: ["src/missing.ts"],
    });
    const normal = selectLearningLoopContext({
      learningLoopEntries: [stale],
    });
    const maintenance = selectLearningLoopContext(
      { learningLoopEntries: [stale] },
      { surface: "maintenance" },
    );

    assert.equal(normal.entries.length, 0);
    assert.equal(maintenance.entries.length, 1);
    assert.equal(maintenance.entries[0]!.staleRefs.length, 1);
  });

  it("keeps rendered output below the configured budget", () => {
    const longExcerpt = "long evidence ".repeat(100);
    const selection = selectLearningLoopContext(
      {
        learningLoopEntries: [
          entry({ title: "long trap one", excerpt: longExcerpt, order: 1 }),
          entry({ title: "long trap two", excerpt: longExcerpt, order: 2 }),
        ],
      },
      { maxBytes: 620, perEntryMaxBytes: 220 },
    );
    const rendered = renderLearningLoopContext(selection);

    assert.ok(
      Buffer.byteLength(rendered, "utf8") <= 620,
      `expected rendered context to stay within budget, got ${Buffer.byteLength(rendered, "utf8")}`,
    );
  });

  it("orders repeated selections deterministically", () => {
    const learningLoopEntries = [
      entry({
        title: "newer lesson",
        kind: "lesson",
        created: "2026-05-03",
        order: 3,
      }),
      entry({ title: "anchored trap", created: "2026-05-01", order: 2 }),
      entry({ title: "older lesson", kind: "lesson", order: 1 }),
    ];

    const first = selectLearningLoopContext({ learningLoopEntries });
    const second = selectLearningLoopContext({ learningLoopEntries });

    assert.deepEqual(first, second);
    assert.deepEqual(
      first.entries.map((selected) => selected.title),
      ["anchored trap", "newer lesson", "older lesson"],
    );
  });
});
