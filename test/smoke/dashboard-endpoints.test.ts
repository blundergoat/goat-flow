/**
 * Fast smoke tests for dashboard modules.
 * Public HTTP behavior lives in the integration suite; this file only checks
 * that the key modules still export the surfaces the CLI depends on.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("dashboard server exports", () => {
  it("serveDashboard is exported as a function", async () => {
    const mod = await import("../../src/cli/server/dashboard.js");
    assert.equal(typeof mod.serveDashboard, "function");
  });
});

describe("terminal exports", () => {
  it("TerminalManager is exported as a class", async () => {
    const mod = await import("../../src/cli/server/terminal.js");
    assert.equal(typeof mod.TerminalManager, "function");
  });
});
