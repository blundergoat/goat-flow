/**
 * Live-reload WebSocket authorization (dev mode only).
 *
 * The dashboard's dev-mode live-reload socket (`/ws/livereload`) must reject a
 * hostile Host/Origin the same way the terminal upgrade does. From the user's
 * side this is invisible - the dev dashboard page still auto-refreshes - but a
 * malicious page a developer happens to have open in another tab must not be
 * able to open even a benign reload socket into their local server.
 *
 * These tests start their own dev-mode server (the shared fixture runs in prod
 * mode, where the live-reload branch is inert) and drive real `ws` upgrades.
 */
import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import type { WebSocket as WsWebSocket } from "ws";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");

let server: { close: () => Promise<void>; port: number } | null = null;
let baseUrl = "";
let wsBase = "";

before(async () => {
  const { serveDashboard } = await import("../../src/cli/server/dashboard.js");
  // isDevMode:true arms the /ws/livereload branch and the dashboard file watcher.
  server = await serveDashboard({ projectPath: PROJECT_ROOT, isDevMode: true });
  baseUrl = `http://127.0.0.1:${server.port}`;
  wsBase = `ws://127.0.0.1:${server.port}`;
});

after(async () => {
  if (server) await server.close();
});

/**
 * Attempt one live-reload WebSocket upgrade and report whether the server let
 * it open or tore it down, resolving either way so a hung handshake fails via
 * the per-test timeout rather than leaking a socket.
 *
 * @param headers - request headers to send with the upgrade (Host / Origin)
 * @returns "opened" if the socket reached the open state, "rejected" if the
 *   server destroyed the socket before or at handshake
 */
async function attemptLiveReload(
  headers: Record<string, string>,
): Promise<"opened" | "rejected"> {
  const { WebSocket } = await import("ws");
  return await new Promise<"opened" | "rejected">((resolvePromise) => {
    const ws: WsWebSocket = new WebSocket(`${wsBase}/ws/livereload`, {
      headers,
    });
    let settled = false;
    /** Resolve once and null out listeners so a later event can't double-settle. */
    const settle = (outcome: "opened" | "rejected"): void => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      resolvePromise(outcome);
    };
    // A reached open state means the upgrade was accepted - the failure we guard against.
    ws.once("open", () => settle("opened"));
    // Destroyed sockets surface as an error or an immediate close before open.
    ws.once("error", () => settle("rejected"));
    ws.once("close", () => settle("rejected"));
  });
}

describe("live-reload WebSocket authorization", () => {
  it(
    "rejects a live-reload upgrade carrying a cross-origin Origin",
    { timeout: 2000 },
    async () => {
      // A page on another origin forging a reload connection must be refused.
      const outcome = await attemptLiveReload({
        Host: `127.0.0.1:${server?.port}`,
        Origin: "http://evil.example",
      });
      assert.equal(outcome, "rejected");
    },
  );

  it(
    "rejects a live-reload upgrade carrying a foreign Host header",
    { timeout: 2000 },
    async () => {
      // A mismatched Host is the DNS-rebinding shape; live reload must reject it.
      const outcome = await attemptLiveReload({
        Host: "evil.example",
        Origin: `http://127.0.0.1:${server?.port}`,
      });
      assert.equal(outcome, "rejected");
    },
  );

  it(
    "accepts a live-reload upgrade from the same-origin dev page",
    { timeout: 2000 },
    async () => {
      // The real dev dashboard page connects with a matching Host and Origin;
      // hardening must not break the normal auto-refresh developer workflow.
      const outcome = await attemptLiveReload({
        Host: `127.0.0.1:${server?.port}`,
        Origin: `http://127.0.0.1:${server?.port}`,
      });
      assert.equal(outcome, "opened");
    },
  );
});
