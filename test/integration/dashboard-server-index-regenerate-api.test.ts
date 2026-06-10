/**
 * Integration coverage for the dashboard endpoint that regenerates learning-loop indexes.
 */
import {
  assert,
  assertJsonResponse,
  baseUrl,
  dashboardToken,
  describe,
  expectRecord,
  fetchJson,
  it,
  dirname,
  join,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  tmpdir,
  writeFile,
} from "./dashboard-server.helpers.js";

async function writeFixtureFile(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const fullPath = join(root, relativePath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content);
}

async function makeIndexFixture(
  buckets: Array<"footguns" | "lessons" | "patterns" | "decisions">,
): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "goat-flow-index-api-"));
  await mkdir(join(root, ".goat-flow"), { recursive: true });
  if (buckets.includes("footguns")) {
    await writeFixtureFile(
      root,
      ".goat-flow/learning-loop/footguns/runtime.md",
      [
        "---",
        "category: runtime",
        "last_reviewed: 2026-06-10",
        "---",
        "",
        "## Footgun: Runtime index drift",
        "",
        "**Status:** active | **Created:** 2026-06-10 | **Evidence:** endpoint fixture",
        "",
        "**Symptoms:** Generated indexes drift after bucket edits.",
        "",
      ].join("\n"),
    );
  }
  if (buckets.includes("lessons")) {
    await writeFixtureFile(
      root,
      ".goat-flow/learning-loop/lessons/runtime.md",
      [
        "---",
        "category: runtime",
        "last_reviewed: 2026-06-10",
        "---",
        "",
        "## Lesson: Regenerate after route edits",
        "",
        "**Status:** active | **Created:** 2026-06-10",
        "",
        "**What happened:** The dashboard route rewrites generated indexes.",
        "",
      ].join("\n"),
    );
  }
  if (buckets.includes("patterns")) {
    await writeFixtureFile(
      root,
      ".goat-flow/learning-loop/patterns/runtime.md",
      [
        "---",
        "category: runtime",
        "last_reviewed: 2026-06-10",
        "---",
        "",
        "## Pattern: Keep generated indexes fresh",
        "",
        "**Context:** Route tests should assert freshness after regeneration.",
        "",
      ].join("\n"),
    );
  }
  if (buckets.includes("decisions")) {
    await writeFixtureFile(
      root,
      ".goat-flow/learning-loop/decisions/ADR-001-index-route.md",
      [
        "# Dashboard Index Route",
        "",
        "**Status:** Accepted",
        "**Date:** 2026-06-10",
        "",
        "## Context",
        "",
        "The dashboard needs a write endpoint for generated indexes.",
        "",
        "## Decision",
        "",
        "Regenerate all existing learning-loop bucket indexes for the selected target project.",
        "",
        "## Consequences",
        "",
        "The endpoint keeps browser and CLI regeneration behaviour aligned.",
        "",
      ].join("\n"),
    );
  }
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

/** Narrow one JSON field to an array before row-level response assertions. */
function expectArray(value: unknown, context: string): unknown[] {
  assert.ok(Array.isArray(value), `${context} should be an array`);
  return value;
}

describe("dashboard index regenerate API", () => {
  // Fixture purpose: writes a temp target with all four bucket types so the endpoint proves POSIX paths and fresh states end to end.
  it("regenerates all existing bucket indexes and returns fresh POSIX paths", async () => {
    const fixture = await makeIndexFixture([
      "footguns",
      "lessons",
      "patterns",
      "decisions",
    ]);
    try {
      const { res, body } = await fetchJson("/api/index/regenerate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: baseUrl,
        },
        body: JSON.stringify({ path: fixture.root }),
      });

      assert.equal(res.status, 200);
      const payload = expectRecord(body, "index regenerate response");
      const results = expectArray(payload.results, "results").map((entry) =>
        expectRecord(entry, "generated index"),
      );
      const indexes = expectArray(payload.indexes, "indexes").map((entry) =>
        expectRecord(entry, "index freshness"),
      );

      assert.deepEqual(
        results.map((entry) => entry.bucket),
        ["footguns", "lessons", "patterns", "decisions"],
      );
      assert.deepEqual(
        results.map((entry) => entry.indexRelPath),
        [
          ".goat-flow/learning-loop/footguns/INDEX.md",
          ".goat-flow/learning-loop/lessons/INDEX.md",
          ".goat-flow/learning-loop/patterns/INDEX.md",
          ".goat-flow/learning-loop/decisions/INDEX.md",
        ],
      );
      assert.equal(
        results.every(
          (entry) =>
            typeof entry.indexRelPath === "string" &&
            !entry.indexRelPath.includes("\\"),
        ),
        true,
      );
      assert.deepEqual(
        indexes.map((entry) => entry.state),
        ["fresh", "fresh", "fresh", "fresh"],
      );

      const contents = await Promise.all(
        results.map((entry) =>
          readFile(join(fixture.root, String(entry.indexRelPath)), "utf-8"),
        ),
      );
      assert.equal(
        contents.every((content) =>
          /Generated by `goat-flow index`/u.test(content),
        ),
        true,
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("skips missing buckets without creating them", async () => {
    const fixture = await makeIndexFixture(["footguns"]);
    try {
      const { res, body } = await fetchJson("/api/index/regenerate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: baseUrl,
        },
        body: JSON.stringify({ path: fixture.root }),
      });

      assert.equal(res.status, 200);
      const payload = expectRecord(body, "index regenerate response");
      const results = expectArray(payload.results, "results").map((entry) =>
        expectRecord(entry, "generated index"),
      );
      const indexes = expectArray(payload.indexes, "indexes").map((entry) =>
        expectRecord(entry, "index freshness"),
      );

      assert.deepEqual(
        results.map((entry) => entry.entryCount),
        [1, null, null, null],
      );
      assert.deepEqual(
        indexes.map((entry) => entry.state),
        ["fresh", "no-bucket", "no-bucket", "no-bucket"],
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("returns a JSON error for invalid target paths", async () => {
    const missing = join(tmpdir(), "goat-flow-index-api-missing");
    const res = await fetch(`${baseUrl}/api/index/regenerate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
        "X-Goat-Flow-Dashboard-Token": dashboardToken,
      },
      body: JSON.stringify({ path: missing }),
    });

    assert.equal(res.status, 400);
    assertJsonResponse(res, "invalid target path");
    const body = expectRecord(await res.json(), "invalid target response");
    assert.match(String(body.error), /Local path validation failed/u);
  });
});
