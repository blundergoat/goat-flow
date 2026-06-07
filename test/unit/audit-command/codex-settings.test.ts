/**
 * Codex agent-settings audit: parsing current vs deprecated feature flags and nested permission tables from
 * TOML, deciding when a permission profile counts as secret-file coverage
 * (broad env/credentials denies, exact/subtree denies, active vs inactive
 * profiles), and failing agent-settings on codex_hooks or hooks-not-enabled.
 */
import {
  BUILD_CHECKS,
  CODEX_WORKSPACE_ROOT_ENTRIES,
  PROFILES,
  assert,
  assertExists,
  codexWorkspaceRootsTable,
  describe,
  extractSettingsFacts,
  it,
  makeCtx,
  stubAgentFacts,
  stubFS,
} from "./helpers.js";

describe("codex settings feature flags", () => {
  it("continues parsing nested Codex workspace-root permission tables", () => {
    const facts = extractSettingsFacts(
      stubFS({
        exists: (path) => path === ".codex/config.toml",
        readFile: (path) =>
          path === ".codex/config.toml"
            ? [
                'default_permissions = "goat-flow"',
                "[permissions.goat-flow.filesystem]",
                '[permissions.goat-flow.filesystem.":workspace_roots"]',
                ...CODEX_WORKSPACE_ROOT_ENTRIES,
              ].join("\n")
            : null,
      }),
      PROFILES.codex,
    );

    assert.equal(facts.readDenyCoversSecrets, true);
  });

  it("counts a recursive **/credentials* deny as covering credentials variants", () => {
    const facts = extractSettingsFacts(
      stubFS({
        exists: (path) =>
          path === ".codex/config.toml" || path === "credentials.json",
        readFile: (path) =>
          path === ".codex/config.toml"
            ? [
                'default_permissions = "goat-flow"',
                "[permissions.goat-flow.filesystem]",
                '[permissions.goat-flow.filesystem.":workspace_roots"]',
                ...CODEX_WORKSPACE_ROOT_ENTRIES,
              ].join("\n")
            : null,
      }),
      PROFILES.codex,
    );

    assert.equal(facts.readDenyCoversSecrets, true);
  });
});

describe("codex settings feature flags", () => {
  it("detects Codex TOML permission profiles that deny secret file families", () => {
    const facts = extractSettingsFacts(
      stubFS({
        exists: (path) => path === ".codex/config.toml",
        readFile: (path) =>
          path === ".codex/config.toml"
            ? [
                'default_permissions = "goat-flow"',
                "[permissions.goat-flow.filesystem]",
                "glob_scan_max_depth = 3",
                codexWorkspaceRootsTable(),
              ].join("\n")
            : null,
      }),
      PROFILES.codex,
    );

    assert.equal(facts.readDenyCoversSecrets, true);
  });
});

describe("codex settings feature flags", () => {
  it("does not count an inactive Codex permission profile as secret coverage", () => {
    const facts = extractSettingsFacts(
      stubFS({
        exists: (path) => path === ".codex/config.toml",
        readFile: (path) =>
          path === ".codex/config.toml"
            ? [
                'default_permissions = "default"',
                "[permissions.goat-flow.filesystem]",
                codexWorkspaceRootsTable(CODEX_WORKSPACE_ROOT_ENTRIES.slice(2)),
              ].join("\n")
            : null,
      }),
      PROFILES.codex,
    );

    assert.equal(facts.readDenyCoversSecrets, false);
  });
});

describe("codex settings feature flags", () => {
  it("counts broad Codex env coverage when backup variants exist", () => {
    const facts = extractSettingsFacts(
      stubFS({
        exists: (path) =>
          path === ".codex/config.toml" || path === ".env.local.bak",
        readFile: (path) =>
          path === ".codex/config.toml"
            ? [
                'default_permissions = "goat-flow"',
                "[permissions.goat-flow.filesystem]",
                codexWorkspaceRootsTable(CODEX_WORKSPACE_ROOT_ENTRIES),
              ].join("\n")
            : null,
      }),
      PROFILES.codex,
    );

    assert.equal(facts.readDenyCoversSecrets, true);
  });
});

describe("codex settings feature flags", () => {
  it("does not count old exact env and credentials denies as full coverage", () => {
    const facts = extractSettingsFacts(
      stubFS({
        exists: (path) =>
          path === ".codex/config.toml" ||
          path === ".env.local.bak" ||
          path === "credentials.json",
        readFile: (path) =>
          path === ".codex/config.toml"
            ? [
                'default_permissions = "goat-flow"',
                "[permissions.goat-flow.filesystem]",
                codexWorkspaceRootsTable([
                  '"**/.env" = "deny"',
                  '"**/.env.local" = "deny"',
                  '"**/.env.development" = "deny"',
                  '"**/.env.production" = "deny"',
                  '"**/.env.staging" = "deny"',
                  '"**/.env.test" = "deny"',
                  '"**/.envrc" = "deny"',
                  '"**/secrets/**" = "deny"',
                  '"**/.ssh/**" = "deny"',
                  '"**/.aws/**" = "deny"',
                  '"**/.docker/**" = "deny"',
                  '"**/.gnupg/**" = "deny"',
                  '"**/.kube/**" = "deny"',
                  '"**/credentials" = "deny"',
                  '"**/.npmrc" = "deny"',
                  '"**/.pypirc" = "deny"',
                  '"**/*.pem" = "deny"',
                  '"**/*.key" = "deny"',
                  '"**/*.pfx" = "deny"',
                ]),
              ].join("\n")
            : null,
      }),
      PROFILES.codex,
    );

    assert.equal(facts.readDenyCoversSecrets, false);
  });

  it("does not count incomplete Codex exact/subtree denies as secret coverage", () => {
    const facts = extractSettingsFacts(
      stubFS({
        exists: (path) => path === ".codex/config.toml",
        readFile: (path) =>
          path === ".codex/config.toml"
            ? [
                'default_permissions = "goat-flow"',
                "[permissions.goat-flow.filesystem]",
                codexWorkspaceRootsTable([
                  '".env" = "none"',
                  '".env.local" = "none"',
                  '".env.development" = "none"',
                  '".env.production" = "none"',
                  '".env.test" = "none"',
                  '".envrc" = "none"',
                  '"secrets/**" = "none"',
                  '".ssh/**" = "none"',
                ]),
              ].join("\n")
            : null,
      }),
      PROFILES.codex,
    );

    assert.equal(facts.readDenyCoversSecrets, false);
  });
});

describe("codex settings feature flags", () => {
  it("does not count legacy Codex project-root permission tables as current secret coverage", () => {
    const facts = extractSettingsFacts(
      stubFS({
        exists: (path) => path === ".codex/config.toml",
        readFile: (path) =>
          path === ".codex/config.toml"
            ? [
                'default_permissions = "goat-flow"',
                "[permissions.goat-flow.filesystem]",
                '[permissions.goat-flow.filesystem.":project_roots"]',
                ...CODEX_WORKSPACE_ROOT_ENTRIES,
              ].join("\n")
            : null,
      }),
      PROFILES.codex,
    );

    assert.equal(facts.readDenyCoversSecrets, false);
  });
});

describe("codex settings feature flags", () => {
  it("does not require absent Codex exact-file denies for secret coverage", () => {
    const facts = extractSettingsFacts(
      stubFS({
        exists: (path) => path === ".codex/config.toml",
        readFile: (path) =>
          path === ".codex/config.toml"
            ? [
                'default_permissions = "goat-flow"',
                "[permissions.goat-flow.filesystem]",
                codexWorkspaceRootsTable(CODEX_WORKSPACE_ROOT_ENTRIES),
              ].join("\n")
            : null,
      }),
      PROFILES.codex,
    );

    assert.equal(facts.readDenyCoversSecrets, true);
  });
});

describe("codex settings feature flags", () => {
  function codexAgentFacts(
    parsed: Record<string, unknown>,
    hooks = stubAgentFacts().hooks,
  ): AgentFacts {
    return stubAgentFacts({
      agent: PROFILES.codex,
      settings: {
        exists: true,
        valid: true,
        parsed,
        hasDenyPatterns: false,
      },
      hooks: {
        ...hooks,
        denyExists: true,
        denyIsRegistered: true,
        denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.sh",
      },
    });
  }

  it("fails agent-settings when Codex config still uses codex_hooks", () => {
    const check = BUILD_CHECKS.find((c) => c.id === "agent-settings")!;
    const result = check.run(
      makeCtx({
        agentFilter: "codex",
        agents: [
          codexAgentFacts({
            "features.hooks": true,
            "features.codex_hooks": true,
          }),
        ],
      }),
    );

    assertExists(result);
    assert.match(result.message, /Deprecated Codex feature flag/);
    assert.match(result.howToFix ?? "", /goat-flow install \. --agent codex/);
  });
});

describe("codex settings feature flags", () => {
  function codexAgentFacts(
    parsed: Record<string, unknown>,
    hooks = stubAgentFacts().hooks,
  ): AgentFacts {
    return stubAgentFacts({
      agent: PROFILES.codex,
      settings: {
        exists: true,
        valid: true,
        parsed,
        hasDenyPatterns: false,
      },
      hooks: {
        ...hooks,
        denyExists: true,
        denyIsRegistered: true,
        denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.sh",
      },
    });
  }

  it("fails agent-settings when Codex hooks are installed but hooks are not enabled", () => {
    const check = BUILD_CHECKS.find((c) => c.id === "agent-settings")!;
    const result = check.run(
      makeCtx({
        agentFilter: "codex",
        agents: [codexAgentFacts({ model: "gpt-5" })],
      }),
    );

    assertExists(result);
    assert.match(result.message, /\[features\]\.hooks = true/);
    assert.match(result.howToFix ?? "", /hooks = true/);
  });
});

describe("codex settings feature flags", () => {
  function codexAgentFacts(
    parsed: Record<string, unknown>,
    hooks = stubAgentFacts().hooks,
  ): AgentFacts {
    return stubAgentFacts({
      agent: PROFILES.codex,
      settings: {
        exists: true,
        valid: true,
        parsed,
        hasDenyPatterns: false,
      },
      hooks: {
        ...hooks,
        denyExists: true,
        denyIsRegistered: true,
        denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.sh",
      },
    });
  }

  it("fails agent-settings when Codex permission profile names absent exact paths", () => {
    const check = BUILD_CHECKS.find((c) => c.id === "agent-settings")!;
    const ctx = makeCtx({
      agentFilter: "codex",
      agents: [
        codexAgentFacts({
          default_permissions: "goat-flow",
          "features.hooks": true,
          "permissions.goat-flow.filesystem.:workspace_roots":
            codexWorkspaceRootsTable([
              ...CODEX_WORKSPACE_ROOT_ENTRIES,
              '".env.example" = "read"',
            ]).replace(/^":workspace_roots" = /u, ""),
        }),
      ],
      fs: stubFS({
        exists: (path) => path === ".codex/config.toml",
      }),
    });
    const result = check.run(ctx);

    assertExists(result);
    assert.match(result.message, /exact workspace-root paths/);
    assert.match(result.message, /\.env\.example/);
  });
});

describe("codex settings feature flags", () => {
  it("parses Codex current and deprecated feature flags from TOML", () => {
    const facts = extractSettingsFacts(
      stubFS({
        exists: (path) => path === ".codex/config.toml",
        readFile: (path) =>
          path === ".codex/config.toml"
            ? 'model = "gpt-5"\nfeatures.codex_hooks = true\n[features]\nhooks = true\n'
            : null,
      }),
      PROFILES.codex,
    );

    assert.deepEqual(facts.parsed, {
      model: "gpt-5",
      "features.hooks": true,
      "features.codex_hooks": true,
    });
  });
});

describe("codex settings feature flags", () => {
  function codexAgentFacts(
    parsed: Record<string, unknown>,
    hooks = stubAgentFacts().hooks,
  ): AgentFacts {
    return stubAgentFacts({
      agent: PROFILES.codex,
      settings: {
        exists: true,
        valid: true,
        parsed,
        hasDenyPatterns: false,
      },
      hooks: {
        ...hooks,
        denyExists: true,
        denyIsRegistered: true,
        denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.sh",
      },
    });
  }

  it("passes agent-settings when Codex hooks are installed and features.hooks is true", () => {
    const check = BUILD_CHECKS.find((c) => c.id === "agent-settings")!;
    const result = check.run(
      makeCtx({
        agentFilter: "codex",
        agents: [codexAgentFacts({ "features.hooks": true })],
      }),
    );

    assert.equal(result, null);
  });
});

describe("codex settings feature flags", () => {
  it("accepts recursive Codex env denies for existing root secret files", () => {
    const facts = extractSettingsFacts(
      stubFS({
        exists: (path) => path === ".codex/config.toml" || path === ".env",
        readFile: (path) =>
          path === ".codex/config.toml"
            ? [
                'default_permissions = "goat-flow"',
                "[permissions.goat-flow.filesystem]",
                codexWorkspaceRootsTable(CODEX_WORKSPACE_ROOT_ENTRIES),
              ].join("\n")
            : null,
      }),
      PROFILES.codex,
    );

    assert.equal(facts.readDenyCoversSecrets, true);
  });
});
