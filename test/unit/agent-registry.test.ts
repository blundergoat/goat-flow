/**
 * Unit tests for agent registry lookup, ordering, and supported-agent metadata.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getAgentProfile,
  getAgentProfileMap,
  getAgentProfiles,
  getKnownAgentIds,
} from "../../src/cli/agents/registry.js";

describe("agent registry", () => {
  it("exposes the manifest-backed support set", () => {
    assert.deepEqual(getKnownAgentIds(), [
      "claude",
      "codex",
      "antigravity",
      "copilot",
    ]);
    assert.deepEqual(
      getAgentProfiles().map((agent) => agent.id),
      ["claude", "codex", "antigravity", "copilot"],
    );
  });

  it("keeps Codex hook config separate from settings and maps Stop for post-turn hooks", () => {
    const codex = getAgentProfile("codex");
    assert.equal(codex.settingsFile, ".codex/config.toml");
    assert.equal(codex.hookConfigFile, ".codex/hooks.json");
    assert.equal(codex.denyHookFile, ".goat-flow/hooks/deny-dangerous.sh");
    assert.equal(codex.hookEvents.postTurn, "Stop");
  });

  it("exposes Copilot's hook-config-only profile cleanly", () => {
    const copilot = getAgentProfile("copilot");
    assert.equal(copilot.settingsFile, null);
    assert.equal(copilot.hookConfigFile, ".github/hooks/hooks.json");
    assert.equal(copilot.denyHookFile, ".goat-flow/hooks/deny-dangerous.sh");
    assert.equal(copilot.skillsDir, ".github/skills");
  });

  it("exposes Antigravity project-local hook wiring", () => {
    const antigravity = getAgentProfile("antigravity");
    assert.equal(antigravity.settingsFile, null);
    assert.equal(antigravity.hookConfigFile, ".agents/hooks.json");
    assert.equal(antigravity.hooksDir, ".goat-flow/hooks");
    assert.equal(
      antigravity.denyHookFile,
      ".goat-flow/hooks/deny-dangerous.sh",
    );
    assert.equal(antigravity.hookEvents?.preTool, "PreToolUse");
  });

  it("translates manifest deny mechanisms into runtime profiles", () => {
    const claude = getAgentProfile("claude");
    assert.deepEqual(claude.denyMechanism, {
      type: "both",
      settingsPath: ".claude/settings.json",
      scriptPath: ".goat-flow/hooks/deny-dangerous.sh",
    });

    const codex = getAgentProfile("codex");
    assert.deepEqual(codex.denyMechanism, {
      type: "both",
      settingsPath: ".codex/config.toml",
      scriptPath: ".goat-flow/hooks/deny-dangerous.sh",
    });

    const antigravity = getAgentProfile("antigravity");
    assert.deepEqual(antigravity.denyMechanism, {
      type: "deny-script",
      path: ".goat-flow/hooks/deny-dangerous.sh",
    });
  });

  it("builds a normalized profile map without empty skill roots", () => {
    const profiles = getAgentProfileMap();
    assert.deepEqual(Object.keys(profiles), [
      "claude",
      "codex",
      "antigravity",
      "copilot",
    ]);
    for (const profile of Object.values(profiles)) {
      assert.notEqual(profile.skillsDir, "");
      assert.ok(!profile.skillsDir.endsWith("/"));
    }
    assert.equal(profiles.claude.hooksDir, ".goat-flow/hooks");
    assert.equal(profiles.antigravity.hooksDir, ".goat-flow/hooks");
    assert.equal(profiles.copilot.skillsDir, ".github/skills");
  });
});
