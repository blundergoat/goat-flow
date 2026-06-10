/**
 * Dashboard API authorization: rejects requests with a missing or wrong token and cross-origin
 * side-effectful requests (including terminal image uploads and terminal WebSocket upgrades), while
 * accepting a valid token on same-origin requests - the token plus same-origin access guard.
 */
import {
  assert,
  assertJsonResponse,
  baseUrl,
  DASHBOARD_STATE_PATH,
  dashboardToken,
  describe,
  it,
  PROJECT_PATH,
  readFile,
} from "./dashboard-server.helpers.js";
describe("dashboard API authorization", () => {
  it("rejects API requests with a missing token", async () => {
    const res = await fetch(`${baseUrl}/api/terminal/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "", projectPath: PROJECT_PATH }),
    });
    assert.equal(res.status, 403);
    assertJsonResponse(res, "missing token rejection");
    assert.deepEqual(await res.json(), { error: "Forbidden" });
  });

  it("rejects index regeneration requests with a missing token", async () => {
    const res = await fetch(`${baseUrl}/api/index/regenerate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: PROJECT_PATH }),
    });
    assert.equal(res.status, 403);
    assertJsonResponse(res, "missing token index rejection");
    assert.deepEqual(await res.json(), { error: "Forbidden" });
  });

  it("rejects API requests with a wrong token", async () => {
    const res = await fetch(`${baseUrl}/api/terminal/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goat-Flow-Dashboard-Token": "wrong-token",
      },
      body: JSON.stringify({ prompt: "", projectPath: PROJECT_PATH }),
    });
    assert.equal(res.status, 403);
    assertJsonResponse(res, "wrong token rejection");
    assert.deepEqual(await res.json(), { error: "Forbidden" });
  });

  it("rejects index regeneration requests with a wrong token", async () => {
    const res = await fetch(`${baseUrl}/api/index/regenerate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goat-Flow-Dashboard-Token": "wrong-token",
      },
      body: JSON.stringify({ path: PROJECT_PATH }),
    });
    assert.equal(res.status, 403);
    assertJsonResponse(res, "wrong token index rejection");
    assert.deepEqual(await res.json(), { error: "Forbidden" });
  });

  it("rejects cross-origin side-effectful browser requests", async () => {
    const res = await fetch(`${baseUrl}/api/projects/list`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://evil.example",
        "X-Goat-Flow-Dashboard-Token": dashboardToken,
      },
      body: JSON.stringify({ paths: [], favorites: [], projectTitles: {} }),
    });
    assert.equal(res.status, 403);
    assertJsonResponse(res, "bad origin rejection");
    assert.deepEqual(await res.json(), { error: "Forbidden" });
  });

  it("rejects cross-origin terminal image uploads", async () => {
    const res = await fetch(`${baseUrl}/api/terminal/sess-x/upload-image`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://evil.example",
        "X-Goat-Flow-Dashboard-Token": dashboardToken,
      },
      body: JSON.stringify({ files: [] }),
    });
    assert.equal(res.status, 403);
    assertJsonResponse(res, "bad origin terminal upload rejection");
    assert.deepEqual(await res.json(), { error: "Forbidden" });
  });

  it("rejects cross-origin index regeneration requests", async () => {
    const res = await fetch(`${baseUrl}/api/index/regenerate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://evil.example",
        "X-Goat-Flow-Dashboard-Token": dashboardToken,
      },
      body: JSON.stringify({ path: PROJECT_PATH }),
    });
    assert.equal(res.status, 403);
    assertJsonResponse(res, "bad origin index rejection");
    assert.deepEqual(await res.json(), { error: "Forbidden" });
  });

  it("accepts valid token and same-origin side-effectful requests", async () => {
    const res = await fetch(`${baseUrl}/api/projects/list`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
        "X-Goat-Flow-Dashboard-Token": dashboardToken,
      },
      body: JSON.stringify({ paths: [], favorites: [], projectTitles: {} }),
    });
    assert.equal(res.status, 200);
    assertJsonResponse(res, "same-origin authorized write");
    assert.deepEqual(await res.json(), { ok: true });
    const persisted = await readFile(DASHBOARD_STATE_PATH, "utf-8");
    assert.equal(persisted.includes(dashboardToken), false);
  });

  it(
    "rejects terminal WebSocket upgrades with a missing token",
    { timeout: 1000 },
    async () => {
      const { WebSocket } = await import("ws");
      let rejectedUpgrade = false;
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(
          `${baseUrl.replace(/^http/u, "ws")}/ws/terminal/test`,
          { headers: { Origin: baseUrl } },
        );
        ws.once("open", () => {
          ws.close();
          reject(new Error("terminal WebSocket opened without a token"));
        });
        ws.once("error", () => {
          rejectedUpgrade = true;
          resolve();
        });
        ws.once("close", () => {
          rejectedUpgrade = true;
          resolve();
        });
      });
      assert.equal(rejectedUpgrade, true);
    },
  );
});
