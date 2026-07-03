/**
 * Unit tests for server-boundary decoders.
 *
 * Every decoder must produce a typed `{ ok: false, error, path }` on malformed
 * input rather than throwing or passing arbitrary shapes through to inner logic.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decodeTerminalCreateBody,
  decodeProjectsListBody,
  decodeClientMessage,
} from "../../src/cli/server/decoders.js";

const RUNNERS = new Set(["claude", "codex", "antigravity", "copilot"]);
type DecodeResult<T> =
  { ok: true; value: T } | { ok: false; error: string; path: string };

/** Return the decoded value after asserting the route accepted the payload. */
function assertDecodeOk<T>(result: DecodeResult<T>): T {
  assert.equal(result.ok, true);
  return (result as { ok: true; value: T }).value;
}

/** Return the typed decoder error after asserting the route rejected the payload. */
function assertDecodeError<T>(result: DecodeResult<T>): {
  error: string;
  path: string;
} {
  assert.equal(result.ok, false);
  return result as { ok: false; error: string; path: string };
}

describe("decodeTerminalCreateBody", () => {
  it("returns typed body on a valid payload", () => {
    const result = decodeTerminalCreateBody(
      JSON.stringify({
        prompt: "hi",
        projectPath: "/tmp/goat-flow",
        targetPath: "/tmp/a",
        runner: "codex",
      }),
      { validRunners: RUNNERS, defaultRunner: "claude" },
    );
    const value = assertDecodeOk(result);
    assert.equal(value.prompt, "hi");
    assert.equal(value.projectPath, "/tmp/goat-flow");
    assert.equal(value.targetPath, "/tmp/a");
    assert.equal(value.runner, "codex");
  });

  it("defaults runner only when absent", () => {
    const defaultRunnerResult = decodeTerminalCreateBody(
      JSON.stringify({ prompt: "x" }),
      {
        validRunners: RUNNERS,
        defaultRunner: "claude",
      },
    );
    assert.equal(assertDecodeOk(defaultRunnerResult).runner, "claude");

    const invalidRunnerResult = decodeTerminalCreateBody(
      JSON.stringify({ runner: "cursor" }),
      {
        validRunners: RUNNERS,
        defaultRunner: "claude",
      },
    );
    const error = assertDecodeError(invalidRunnerResult);
    assert.equal(error.path, "body.runner");
    assert.match(error.error, /unknown runner: cursor/);
  });

  it("rejects non-string runner", () => {
    const result = decodeTerminalCreateBody(JSON.stringify({ runner: 42 }), {
      validRunners: RUNNERS,
      defaultRunner: "claude",
    });
    assert.equal(assertDecodeError(result).path, "body.runner");
  });

  it("rejects non-JSON body with a typed path error", () => {
    const result = decodeTerminalCreateBody("not json", {
      validRunners: RUNNERS,
      defaultRunner: "claude",
    });
    const error = assertDecodeError(result);
    assert.equal(error.path, "body");
    assert.match(error.error, /invalid JSON/);
  });

  it("rejects non-string prompt", () => {
    const result = decodeTerminalCreateBody(JSON.stringify({ prompt: 42 }), {
      validRunners: RUNNERS,
      defaultRunner: "claude",
    });
    assert.equal(assertDecodeError(result).path, "body.prompt");
  });

  it("rejects non-string targetPath", () => {
    const result = decodeTerminalCreateBody(
      JSON.stringify({ targetPath: 42 }),
      {
        validRunners: RUNNERS,
        defaultRunner: "claude",
      },
    );
    assert.equal(assertDecodeError(result).path, "body.targetPath");
  });
});

describe("decodeProjectsListBody", () => {
  it("returns typed dashboard state on a valid payload", () => {
    const result = decodeProjectsListBody(
      JSON.stringify({
        paths: ["/a", "/b/c"],
        favorites: ["goat-review", "goat-qa"],
        projectTitles: { "/a": "Alpha", "/b/c": "  Beta  " },
      }),
    );
    const value = assertDecodeOk(result);
    assert.deepStrictEqual(value.paths, ["/a", "/b/c"]);
    assert.deepStrictEqual(value.favorites, ["goat-review", "goat-qa"]);
    assert.deepStrictEqual(value.projectTitles, {
      "/a": "Alpha",
      "/b/c": "Beta",
    });
  });

  it("defaults favorites and projectTitles to empty when omitted", () => {
    const result = decodeProjectsListBody(JSON.stringify({ paths: ["/a"] }));
    const value = assertDecodeOk(result);
    assert.deepStrictEqual(value.favorites, []);
    assert.deepStrictEqual(value.projectTitles, {});
  });

  it("drops empty-string project titles so clearing round-trips cleanly", () => {
    const result = decodeProjectsListBody(
      JSON.stringify({
        paths: ["/a"],
        projectTitles: { "/a": "", "/b": "   ", "/c": "keep" },
      }),
    );
    assert.deepStrictEqual(assertDecodeOk(result).projectTitles, {
      "/c": "keep",
    });
  });

  it("rejects non-object projectTitles", () => {
    const result = decodeProjectsListBody(
      JSON.stringify({ paths: ["/a"], projectTitles: ["nope"] }),
    );
    assert.equal(assertDecodeError(result).path, "body.projectTitles");
  });

  it("rejects non-string projectTitles entry", () => {
    const result = decodeProjectsListBody(
      JSON.stringify({ paths: ["/a"], projectTitles: { "/a": 42 } }),
    );
    assert.equal(assertDecodeError(result).path, 'body.projectTitles["/a"]');
  });

  it("rejects non-object body", () => {
    const result = decodeProjectsListBody(JSON.stringify(["/a"]));
    assert.equal(assertDecodeError(result).path, "body");
  });

  it("rejects paths missing", () => {
    const result = decodeProjectsListBody(JSON.stringify({}));
    assert.equal(assertDecodeError(result).path, "body.paths");
  });

  it("rejects non-string element", () => {
    const result = decodeProjectsListBody(
      JSON.stringify({ paths: ["/a", 42] }),
    );
    assert.equal(assertDecodeError(result).path, "body.paths[1]");
  });

  it("rejects non-string favorite", () => {
    const result = decodeProjectsListBody(
      JSON.stringify({ paths: ["/a"], favorites: ["goat", 42] }),
    );
    assert.equal(assertDecodeError(result).path, "body.favorites[1]");
  });
});

describe("decodeClientMessage", () => {
  it("decodes input messages", () => {
    const result = decodeClientMessage(
      JSON.stringify({ type: "input", data: "x" }),
    );
    const value = assertDecodeOk(result);
    assert.equal(value.type, "input");
    assert.equal((value as { type: "input"; data: string }).data, "x");
  });

  it("decodes resize messages with numeric cols/rows", () => {
    const expectedColumns = 80;
    const expectedRows = 24;
    const result = decodeClientMessage(
      JSON.stringify({
        type: "resize",
        cols: expectedColumns,
        rows: expectedRows,
      }),
    );
    const value = assertDecodeOk(result);
    assert.equal(value.type, "resize");
    const resize = value as { type: "resize"; cols: number; rows: number };
    assert.equal(resize.cols, expectedColumns);
    assert.equal(resize.rows, expectedRows);
  });

  it("rejects unknown message type", () => {
    const result = decodeClientMessage(JSON.stringify({ type: "poke" }));
    assert.equal(assertDecodeError(result).path, "message.type");
  });

  it("rejects non-string data on input", () => {
    const result = decodeClientMessage(
      JSON.stringify({ type: "input", data: 42 }),
    );
    assert.equal(assertDecodeError(result).path, "message.data");
  });

  it("rejects non-numeric cols on resize", () => {
    const result = decodeClientMessage(
      JSON.stringify({ type: "resize", cols: "80", rows: 24 }),
    );
    assert.equal(assertDecodeError(result).path, "message.cols");
  });

  it("rejects non-JSON frames", () => {
    const result = decodeClientMessage("not json");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.path, "message");
  });
});
