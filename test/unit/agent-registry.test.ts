import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findUnknownConfiguredAgents,
  getAgentProfile,
  getAgentProfileMap,
  getAgentProfiles,
  getConfiguredAgents,
  getKnownAgentIds,
} from "../../src/cli/agents/registry.js";
import type { LoadedConfig } from "../../src/cli/config/types.js";
import { AUDIT_VERSION } from "../../src/cli/constants.js";

function stubConfig(agents: string[] | null): LoadedConfig {
  return {
    exists: true,
    valid: true,
    config: {
      version: AUDIT_VERSION,
      footguns: { path: ".goat-flow/footguns/" },
      lessons: { path: ".goat-flow/lessons/" },
      decisions: { path: ".goat-flow/decisions/" },
      tasks: { path: ".goat-flow/tasks/" },
      logs: { path: ".goat-flow/logs/" },
      agents,
      skills: { install: "all" },
      lineLimits: { target: 120, limit: 150 },
      toolchain: {
        test: [],
        lint: [],
        build: [],
        package: [],
        format: [],
      },
      userRole: "developer",
      telemetry: false,
      knownGaps: [],
      skillOverrides: {},
      harness: { acknowledge: [] },
    },
    warnings: [],
    errors: [],
    parseError: null,
  };
}

describe("agent registry", () => {
  it("exposes the manifest-backed support set", () => {
    assert.deepEqual(getKnownAgentIds(), [
      "claude",
      "codex",
      "gemini",
      "copilot",
    ]);
    assert.deepEqual(
      getAgentProfiles().map((agent) => agent.id),
      ["claude", "codex", "gemini", "copilot"],
    );
  });

  it("keeps Codex hook config separate from post-turn event wiring", () => {
    const codex = getAgentProfile("codex");
    assert.equal(codex.settingsFile, ".codex/config.toml");
    assert.equal(codex.hookConfigFile, ".codex/hooks.json");
    assert.equal(codex.denyHookFile, ".codex/hooks/deny-dangerous.sh");
    assert.equal(codex.hookEvents.postTurn, null);
  });

  it("returns configured-agent subsets from config.yaml state", () => {
    assert.deepEqual(
      getConfiguredAgents(stubConfig(["codex"])).map((agent) => agent.id),
      ["codex"],
    );
    assert.deepEqual(
      getConfiguredAgents(stubConfig(null)).map((agent) => agent.id),
      ["claude", "codex", "gemini", "copilot"],
    );
  });

  it("exposes Copilot's hook-config-only profile cleanly", () => {
    const copilot = getAgentProfile("copilot");
    assert.equal(copilot.settingsFile, null);
    assert.equal(copilot.hookConfigFile, ".github/hooks/hooks.json");
    assert.equal(copilot.denyHookFile, ".github/hooks/deny-dangerous.sh");
    assert.equal(copilot.skillsDir, ".github/skills");
  });

  it("translates manifest deny mechanisms into runtime profiles", () => {
    const claude = getAgentProfile("claude");
    assert.deepEqual(claude.denyMechanism, {
      type: "both",
      settingsPath: ".claude/settings.json",
      scriptPath: ".claude/hooks/deny-dangerous.sh",
    });

    const codex = getAgentProfile("codex");
    assert.deepEqual(codex.denyMechanism, {
      type: "deny-script",
      path: ".codex/hooks/deny-dangerous.sh",
    });
  });

  it("builds a normalized profile map without empty skill roots", () => {
    const profiles = getAgentProfileMap();
    assert.deepEqual(Object.keys(profiles), [
      "claude",
      "codex",
      "gemini",
      "copilot",
    ]);
    for (const profile of Object.values(profiles)) {
      assert.notEqual(profile.skillsDir, "");
      assert.ok(!profile.skillsDir.endsWith("/"));
    }
    assert.equal(profiles.claude.hooksDir, ".claude/hooks");
    assert.equal(profiles.copilot.skillsDir, ".github/skills");
  });

  it("reports unknown configured agents outside the manifest", () => {
    assert.deepEqual(findUnknownConfiguredAgents(["codex", "cursor"]), [
      "cursor",
    ]);
  });
});
