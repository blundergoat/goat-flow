/**
 * Unit tests for server-boundary decoders (M17-9).
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

const RUNNERS = new Set(["claude", "codex", "gemini", "copilot"]);

describe("decodeTerminalCreateBody", () => {
  it("returns typed body on a valid payload", () => {
    const r = decodeTerminalCreateBody(
      JSON.stringify({
        prompt: "hi",
        projectPath: "/tmp/goat-flow",
        targetPath: "/tmp/a",
        runner: "codex",
      }),
      { validRunners: RUNNERS, defaultRunner: "claude" },
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.value.prompt, "hi");
    assert.equal(r.value.projectPath, "/tmp/goat-flow");
    assert.equal(r.value.targetPath, "/tmp/a");
    assert.equal(r.value.runner, "codex");
  });

  it("defaults runner when absent or unknown", () => {
    const r1 = decodeTerminalCreateBody(JSON.stringify({ prompt: "x" }), {
      validRunners: RUNNERS,
      defaultRunner: "claude",
    });
    assert.equal(r1.ok, true);
    if (r1.ok) assert.equal(r1.value.runner, "claude");

    const r2 = decodeTerminalCreateBody(JSON.stringify({ runner: "cursor" }), {
      validRunners: RUNNERS,
      defaultRunner: "claude",
    });
    assert.equal(r2.ok, true);
    if (r2.ok) assert.equal(r2.value.runner, "claude");
  });

  it("rejects non-JSON body with a typed path error", () => {
    const r = decodeTerminalCreateBody("not json", {
      validRunners: RUNNERS,
      defaultRunner: "claude",
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.path, "body");
    assert.match(r.error, /invalid JSON/);
  });

  it("rejects non-string prompt", () => {
    const r = decodeTerminalCreateBody(JSON.stringify({ prompt: 42 }), {
      validRunners: RUNNERS,
      defaultRunner: "claude",
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.path, "body.prompt");
  });

  it("rejects non-string targetPath", () => {
    const r = decodeTerminalCreateBody(JSON.stringify({ targetPath: 42 }), {
      validRunners: RUNNERS,
      defaultRunner: "claude",
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.path, "body.targetPath");
  });
});

describe("decodeProjectsListBody", () => {
  it("returns typed dashboard state on a valid payload", () => {
    const r = decodeProjectsListBody(
      JSON.stringify({
        paths: ["/a", "/b/c"],
        favorites: ["goat-review", "goat-qa"],
        projectTitles: { "/a": "Alpha", "/b/c": "  Beta  " },
      }),
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepStrictEqual(r.value.paths, ["/a", "/b/c"]);
    assert.deepStrictEqual(r.value.favorites, ["goat-review", "goat-qa"]);
    assert.deepStrictEqual(r.value.projectTitles, {
      "/a": "Alpha",
      "/b/c": "Beta",
    });
  });

  it("defaults favorites and projectTitles to empty when omitted", () => {
    const r = decodeProjectsListBody(JSON.stringify({ paths: ["/a"] }));
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepStrictEqual(r.value.favorites, []);
    assert.deepStrictEqual(r.value.projectTitles, {});
  });

  it("drops empty-string project titles so clearing round-trips cleanly", () => {
    const r = decodeProjectsListBody(
      JSON.stringify({
        paths: ["/a"],
        projectTitles: { "/a": "", "/b": "   ", "/c": "keep" },
      }),
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepStrictEqual(r.value.projectTitles, { "/c": "keep" });
  });

  it("rejects non-object projectTitles", () => {
    const r = decodeProjectsListBody(
      JSON.stringify({ paths: ["/a"], projectTitles: ["nope"] }),
    );
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.path, "body.projectTitles");
  });

  it("rejects non-string projectTitles entry", () => {
    const r = decodeProjectsListBody(
      JSON.stringify({ paths: ["/a"], projectTitles: { "/a": 42 } }),
    );
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.path, 'body.projectTitles["/a"]');
  });

  it("rejects non-object body", () => {
    const r = decodeProjectsListBody(JSON.stringify(["/a"]));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.path, "body");
  });

  it("rejects paths missing", () => {
    const r = decodeProjectsListBody(JSON.stringify({}));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.path, "body.paths");
  });

  it("rejects non-string element", () => {
    const r = decodeProjectsListBody(JSON.stringify({ paths: ["/a", 42] }));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.path, "body.paths[1]");
  });

  it("rejects non-string favorite", () => {
    const r = decodeProjectsListBody(
      JSON.stringify({ paths: ["/a"], favorites: ["goat", 42] }),
    );
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.path, "body.favorites[1]");
  });
});

describe("decodeClientMessage", () => {
  it("decodes input messages", () => {
    const r = decodeClientMessage(JSON.stringify({ type: "input", data: "x" }));
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.value.type, "input");
    if (r.value.type === "input") assert.equal(r.value.data, "x");
  });

  it("decodes resize messages with numeric cols/rows", () => {
    const r = decodeClientMessage(
      JSON.stringify({ type: "resize", cols: 80, rows: 24 }),
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    if (r.value.type === "resize") {
      assert.equal(r.value.cols, 80);
      assert.equal(r.value.rows, 24);
    }
  });

  it("rejects unknown message type", () => {
    const r = decodeClientMessage(JSON.stringify({ type: "poke" }));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.path, "message.type");
  });

  it("rejects non-string data on input", () => {
    const r = decodeClientMessage(JSON.stringify({ type: "input", data: 42 }));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.path, "message.data");
  });

  it("rejects non-numeric cols on resize", () => {
    const r = decodeClientMessage(
      JSON.stringify({ type: "resize", cols: "80", rows: 24 }),
    );
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.path, "message.cols");
  });

  it("rejects non-JSON frames", () => {
    const r = decodeClientMessage("not json");
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.path, "message");
  });
});
