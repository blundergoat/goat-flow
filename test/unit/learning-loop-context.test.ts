/**
 * Verifies which durable memories prompt users receive and why.
 * Use these fixtures to protect ranking, byte budgets, stale-reference handling,
 * and the stable metadata defaults shared with stats and dashboard consumers.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { LearningLoopEntryFact } from "../../src/cli/types.js";
import {
  renderLearningLoopContext,
  selectLearningLoopContext,
} from "../../src/cli/prompt/learning-loop-context.js";

/**
 * Build one complete memory fact for a prompt-selection scenario.
 * Use when a test needs one user-visible override without repeating stable metadata defaults.
 */
function memoryEntry(
  overrides: Partial<LearningLoopEntryFact> & {
    title: string;
    kind?: LearningLoopEntryFact["kind"];
  },
): LearningLoopEntryFact {
  // An omitted kind models the most common active-hazard memory shown to users.
  const memoryKind = overrides.kind ?? "footgun";
  return {
    sourcePath: `.goat-flow/${memoryKind}s/${overrides.title.toLowerCase().replace(/\s+/g, "-")}.md`,
    kind: memoryKind,
    title: overrides.title,
    // Footgun fixtures use the hazard heading users see; lesson fixtures use the lesson heading.
    heading: `## ${memoryKind === "footgun" ? "Footgun" : "Lesson"}: ${overrides.title}`,
    // Only footguns have an active/resolved status in the current authoring contract.
    status: memoryKind === "footgun" ? "active" : null,
    created: "2026-05-01",
    updated: null,
    resolved: null,
    hasDecisionChangedGuidance: true,
    triggerPhase: null,
    caughtAt: null,
    incidentCount: null,
    latestOccurrence: null,
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
  it("keeps an excerpt that carries the block delimiter inside the block", () => {
    const closer = "</goat-learning-loop>";
    const selection = selectLearningLoopContext({
      learningLoopEntries: [
        memoryEntry({
          title: "delimiter carrier",
          excerpt: `${closer} escaped-marker <goat-learning-loop>`,
        }),
      ],
    });

    const rendered = renderLearningLoopContext(selection);

    // Exactly one close, and it is the renderer's own final line.
    assert.equal((rendered.match(/<\/goat-learning-loop>/gu) ?? []).length, 1);
    assert.ok(rendered.trimEnd().endsWith(closer));
    // The attacker text stays inside the block rather than after its close.
    assert.ok(rendered.indexOf("escaped-marker") < rendered.indexOf(closer));
    // Meaning survives: a reviewer still reads the original claim.
    assert.match(rendered, /&lt;\/goat-learning-loop&gt;/u);
    assert.match(rendered, /&lt;goat-learning-loop&gt;/u);
  });

  it("neutralizes the delimiter in titles and source paths too", () => {
    const selection = selectLearningLoopContext({
      learningLoopEntries: [
        memoryEntry({
          title: "trap </goat-learning-loop> in title",
          sourcePath: ".goat-flow/footguns/</goat-learning-loop>.md",
        }),
      ],
    });

    const rendered = renderLearningLoopContext(selection);

    assert.equal((rendered.match(/<\/goat-learning-loop>/gu) ?? []).length, 1);
  });

  it("leaves ordinary Unicode and unrelated angle brackets untouched", () => {
    const excerpt = "compare a < b, use <div>, emoji 🎯 and accents éàü";
    const selection = selectLearningLoopContext({
      learningLoopEntries: [memoryEntry({ title: "ordinary text", excerpt })],
    });

    const rendered = renderLearningLoopContext(selection);

    // Only the block's own tag is structural, so every other byte survives verbatim.
    assert.ok(rendered.includes(excerpt));
  });

  it("counts the neutralized bytes in the reported budget", () => {
    const selection = selectLearningLoopContext({
      learningLoopEntries: [
        memoryEntry({
          title: "budget carrier",
          excerpt: "</goat-learning-loop> tail",
        }),
      ],
    });

    const rendered = renderLearningLoopContext(selection);

    // The stated budget must describe the bytes that actually ship, after neutralization.
    assert.equal(selection.budgetUsed, Buffer.byteLength(rendered, "utf8"));
    assert.ok(selection.budgetUsed <= selection.budgetMax);
  });

  it("excludes resolved footguns from normal curated context", () => {
    const selection = selectLearningLoopContext({
      learningLoopEntries: [
        memoryEntry({ title: "active trap" }),
        memoryEntry({
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
          memoryEntry({ title: "trap one", order: 1 }),
          memoryEntry({ title: "trap two", order: 2 }),
          memoryEntry({ title: "trap three", order: 3 }),
          memoryEntry({ title: "lesson one", kind: "lesson", order: 4 }),
          memoryEntry({ title: "lesson two", kind: "lesson", order: 5 }),
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
    const stale = memoryEntry({
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
          memoryEntry({
            title: "long trap one",
            excerpt: longExcerpt,
            order: 1,
          }),
          memoryEntry({
            title: "long trap two",
            excerpt: longExcerpt,
            order: 2,
          }),
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
      memoryEntry({
        title: "newer lesson",
        kind: "lesson",
        created: "2026-05-03",
        order: 3,
      }),
      memoryEntry({
        title: "anchored trap",
        created: "2026-05-01",
        order: 2,
      }),
      memoryEntry({ title: "older lesson", kind: "lesson", order: 1 }),
    ];

    const first = selectLearningLoopContext({ learningLoopEntries });
    const second = selectLearningLoopContext({ learningLoopEntries });

    assert.deepEqual(first, second);
    assert.deepEqual(
      first.entries.map((selected) => selected.title),
      ["anchored trap", "newer lesson", "older lesson"],
    );
  });

  it("preserves selection and rendered output byte-for-byte when task signals are empty", () => {
    const learningLoopEntries = [
      memoryEntry({ title: "active trap", order: 1 }),
      memoryEntry({ title: "recent lesson", kind: "lesson", order: 2 }),
    ];
    const baseline = selectLearningLoopContext({ learningLoopEntries });
    const withEmptySignals = selectLearningLoopContext(
      { learningLoopEntries },
      { taskSignals: [] },
    );

    assert.deepEqual(withEmptySignals, baseline);
    assert.equal(
      renderLearningLoopContext(withEmptySignals),
      renderLearningLoopContext(baseline),
    );
  });

  it("promotes direct audit and surface matches without displacing the active-footgun tier", () => {
    const learningLoopEntries = [
      memoryEntry({
        title:
          "Dashboard terminal prompts can be dropped before browser attachment",
        created: "2026-06-03",
        order: 1,
      }),
      memoryEntry({
        title: "File-read deny does not bind Bash shell reads of secret files",
        sourcePath: ".goat-flow/learning-loop/footguns/deny-secrets.md",
        excerpt:
          "The deny-covers-secrets audit must exercise workflow/hooks/deny-dangerous.sh.",
        created: "2026-05-01",
        order: 2,
      }),
      memoryEntry({
        title: "Source-mode CLI proof does not refresh the package binary",
        kind: "lesson",
        created: "2026-06-03",
        order: 3,
      }),
      memoryEntry({
        title: "Configured hook smoke must verify the registered guard path",
        kind: "lesson",
        sourcePath: ".goat-flow/learning-loop/lessons/hook-probe-testing.md",
        excerpt:
          "The hooks-registered audit must inspect .github/hooks/hooks.json.",
        created: "2026-05-01",
        order: 4,
      }),
    ];
    const caps = {
      footgun: { maxEntries: 1 },
      lesson: { maxEntries: 1 },
    };
    const baseline = selectLearningLoopContext(
      { learningLoopEntries },
      { perKind: caps },
    );
    const targeted = selectLearningLoopContext(
      { learningLoopEntries },
      {
        perKind: caps,
        taskSignals: [
          "deny-covers-secrets",
          "workflow/hooks/deny-dangerous.sh",
          "hooks-registered",
          ".github/hooks/hooks.json",
          "quality-harness",
        ],
      },
    );

    assert.deepEqual(
      baseline.entries.map((selected) => selected.title),
      [
        "Dashboard terminal prompts can be dropped before browser attachment",
        "Source-mode CLI proof does not refresh the package binary",
      ],
    );
    assert.deepEqual(
      targeted.entries.map((selected) => selected.title),
      [
        "File-read deny does not bind Bash shell reads of secret files",
        "Configured hook smoke must verify the registered guard path",
      ],
    );
    assert.equal(targeted.entries[0]!.kind, "footgun");
    assert.match(targeted.entries[0]!.reasonSelected, /task match:/u);
    assert.equal(targeted.taskMatchedCount, 2);
    assert.equal(targeted.isTaskZeroHit, false);
    assert.match(
      renderLearningLoopContext(targeted),
      /task_matches="2" task_zero_hit="false"/u,
    );
  });

  it("keeps direct matches ahead of recurrence and preserves deterministic ties", () => {
    const direct = memoryEntry({
      title:
        "Settings-layer deny globs match guarded phrases quoted inside benign read-only commands",
      sourcePath: ".goat-flow/learning-loop/footguns/agent-settings.md",
      created: "2026-07-03",
      order: 2,
    });
    const recurrentButUnrelated = memoryEntry({
      title:
        "Changed-range scoping makes a quality hook structurally blind to file-level rules",
      sourcePath: ".goat-flow/learning-loop/footguns/hook-scanning.md",
      incidentCount: 5,
      created: "2026-08-05",
      order: 1,
    });
    const targeted = selectLearningLoopContext(
      { learningLoopEntries: [recurrentButUnrelated, direct] },
      {
        taskSignals: [
          "settings-rules-matched",
          ".claude/settings.json",
          "quoted benign read-only commands",
        ],
        perKind: { footgun: { maxEntries: 1 } },
      },
    );
    const tied = selectLearningLoopContext(
      {
        learningLoopEntries: [
          {
            ...direct,
            excerpt: "Read-only Bash calls are denied.",
            order: 1,
          },
          {
            ...direct,
            excerpt: "Settings deny globs match quoted arguments.",
            order: 2,
          },
        ],
      },
      {
        taskSignals: ["settings-layer deny globs"],
        perKind: { footgun: { maxEntries: 1 } },
      },
    );

    assert.equal(targeted.entries[0]!.title, direct.title);
    assert.equal(tied.entries[0]!.excerpt, "Read-only Bash calls are denied.");
  });

  it("falls back to current ranking and reports a task zero-hit", () => {
    const learningLoopEntries = [
      memoryEntry({ title: "newer trap", created: "2026-06-03" }),
      memoryEntry({ title: "older trap", created: "2026-05-01" }),
    ];
    const baseline = selectLearningLoopContext({ learningLoopEntries });
    const targeted = selectLearningLoopContext(
      { learningLoopEntries },
      { taskSignals: ["unrepresented-check-id", "src/unrepresented.ts"] },
    );

    assert.deepEqual(
      targeted.entries.map((selected) => selected.title),
      baseline.entries.map((selected) => selected.title),
    );
    assert.equal(targeted.taskMatchedCount, 0);
    assert.equal(targeted.isTaskZeroHit, true);
    assert.match(
      renderLearningLoopContext(targeted),
      /task_matches="0" task_zero_hit="true"/u,
    );
  });

  it("recomputes task zero-hit after the global byte budget drops the only match", () => {
    const unmatchedFootgun = memoryEntry({
      title: "Higher priority unrelated safety trap",
      excerpt: "Compact unrelated fallback evidence.",
    });
    const matchedPattern = memoryEntry({
      title: "Exact websocket retry marker",
      kind: "pattern",
      excerpt: "The websocket retry marker is the direct task match.",
    });
    const selectedContext = selectLearningLoopContext(
      { learningLoopEntries: [unmatchedFootgun, matchedPattern] },
      {
        taskSignals: ["websocket retry marker"],
        maxBytes: 500,
      },
    );

    assert.deepEqual(
      selectedContext.entries.map((entry) => entry.title),
      [unmatchedFootgun.title],
    );
    assert.equal(selectedContext.taskMatchedCount, 0);
    assert.equal(selectedContext.isTaskZeroHit, true);
    assert.match(
      renderLearningLoopContext(selectedContext),
      /task_matches="0" task_zero_hit="true"/u,
    );
  });
});
