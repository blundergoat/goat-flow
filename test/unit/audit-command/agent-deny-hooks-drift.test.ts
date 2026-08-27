/**
 * Covers deny-hook audit results a user sees for current and stale installations.
 * Use when launcher identity, runtime policy probes, or agent response formats change.
 * Real non-Git Codex fixtures separate working policy from startup and timeout failures.
 * Stubbed configurations retain coverage for legacy paths and every supported agent.
 */
import {
  AGENT_CHECKS,
  PROFILES,
  PROJECT_ROOT,
  assert,
  createFS,
  describe,
  it,
  makeCtx,
  readFileSync,
  resolve,
  stubAgentFacts,
  stubFS,
} from "./helpers.js";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyHookState, checkHookRuntimeSmoke } from "../../src.js";
import { withTempProject } from "../hook-registrar.helpers.js";

/** Build a context that deliberately crosses the trusted runtime-evidence boundary. */
function makeRuntimeCtx(
  overrides: Parameters<typeof makeCtx>[0],
): ReturnType<typeof makeCtx> {
  return makeCtx({
    ...overrides,
    denyMechanismEvidenceLevel: "full",
  });
}

/** Extract one Claude permission tool's path operands; sorted output makes set parity deterministic. */
function permissionDenyPaths(denyRules: string[], tool: "Read" | "Edit") {
  const prefix = `${tool}(`;
  return denyRules
    .filter((rule) => rule.startsWith(prefix) && rule.endsWith(")"))
    .map((rule) => rule.slice(prefix.length, -1))
    .sort((left, right) => left.localeCompare(right));
}

/** Assert that every denied read path has the Edit counterpart needed for NotebookEdit parity. */
function assertClaudeReadEditParity(denyRules: string[]): void {
  assert.deepEqual(
    permissionDenyPaths(denyRules, "Edit"),
    permissionDenyPaths(denyRules, "Read"),
  );
}

describe("Claude agent-config deny parity", () => {
  it("keeps Read and Edit path sets identical and detects a removed Edit rule", () => {
    const config = JSON.parse(
      readFileSync(
        resolve(PROJECT_ROOT, "workflow/hooks/agent-config/claude.json"),
        "utf-8",
      ),
    ) as { permissions: { deny: string[] } };
    assertClaudeReadEditParity(config.permissions.deny);

    const firstEditRule = config.permissions.deny.find((rule) =>
      rule.startsWith("Edit("),
    );
    assert.ok(firstEditRule, "fixture requires at least one Edit deny rule");
    assert.throws(
      () =>
        assertClaudeReadEditParity(
          config.permissions.deny.filter((rule) => rule !== firstEditRule),
        ),
      /Expected values to be strictly deep-equal/u,
    );
  });
});

/**
 * Build a real non-Git Codex install and pass it to one runtime-audit assertion.
 * It writes the hook files and configuration into a temporary project, because the configured launcher itself is what this assertion exercises.
 */
function withRealCodexAudit(
  runAuditAssertion: (
    targetProjectPath: string,
    auditContext: ReturnType<typeof makeCtx>,
  ) => void,
): void {
  withTempProject((targetProjectPath) => {
    mkdirSync(join(targetProjectPath, ".codex"), { recursive: true });
    writeFileSync(join(targetProjectPath, ".codex", "config.toml"), "");
    applyHookState("deny-dangerous", true, targetProjectPath);
    const auditContext = makeRuntimeCtx({
      agentFilter: "codex",
      projectPath: targetProjectPath,
      agents: [
        stubAgentFacts({
          agent: PROFILES.codex,
          settings: {
            exists: true,
            valid: true,
            parsed: {},
            hasDenyPatterns: false,
          },
          hooks: {
            ...stubAgentFacts().hooks,
            denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.sh",
            readDenyCoversSecrets: false,
          },
        }),
      ],
      fs: createFS(targetProjectPath),
    });
    runAuditAssertion(targetProjectPath, auditContext);
  });
}

/**
 * Temporarily lower the shared launcher deadline for one timeout assertion.
 * The previous user environment is restored even when the assertion throws.
 */
function withHookLaunchTimeout(
  timeoutMilliseconds: string,
  runTimeoutAssertion: () => void,
): void {
  const previousTimeout = process.env.GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS;
  process.env.GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS = timeoutMilliseconds;
  try {
    runTimeoutAssertion();
  } finally {
    // No prior override means the user's environment returns to its original empty state.
    if (previousTimeout === undefined) {
      delete process.env.GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS;
    } else {
      process.env.GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS = previousTimeout;
    }
  }
}

describe("agent deny hook template comparison", () => {
  const denyCheck = AGENT_CHECKS.find(
    (check) => check.id === "agent-guardrails",
  );
  /** Read canonical deny-dangerous templates used for drift comparisons. */
  function guardrailTemplates() {
    return {
      dispatcher: readFileSync(
        resolve(PROJECT_ROOT, "workflow/hooks/deny-dangerous.sh"),
        "utf-8",
      ),
      shell: readFileSync(
        resolve(
          PROJECT_ROOT,
          "workflow/hooks/deny-dangerous/patterns-shell.sh",
        ),
        "utf-8",
      ),
      paths: readFileSync(
        resolve(
          PROJECT_ROOT,
          "workflow/hooks/deny-dangerous/patterns-paths.sh",
        ),
        "utf-8",
      ),
      writes: readFileSync(
        resolve(
          PROJECT_ROOT,
          "workflow/hooks/deny-dangerous/patterns-writes.sh",
        ),
        "utf-8",
      ),
      selfTest: readFileSync(
        resolve(
          PROJECT_ROOT,
          "workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh",
        ),
        "utf-8",
      ),
    };
  }

  // Assemble the installed guardrail file set this scenario reads, applying the overrides that make one file stale or absent.
  function installedGuardrailContent(
    templates: ReturnType<typeof guardrailTemplates>,
    overrides: Record<string, string | null> = {},
  ) {
    const files: Record<string, string> = {
      [".goat-flow/hooks/deny-dangerous.sh"]: templates.dispatcher,
      ".goat-flow/hooks/deny-dangerous/patterns-shell.sh": templates.shell,
      ".goat-flow/hooks/deny-dangerous/patterns-paths.sh": templates.paths,
      ".goat-flow/hooks/deny-dangerous/patterns-writes.sh": templates.writes,
      ".goat-flow/hooks/deny-dangerous/deny-dangerous-self-test.sh":
        templates.selfTest,
    };
    /** Resolve installed hook content from overrides before template defaults. */
    const readInstalledGuardrail = (path: string) => {
      if (Object.hasOwn(overrides, path)) return overrides[path] ?? null;
      return files[path] ?? null;
    };
    return readInstalledGuardrail;
  }

  it("replays literal non-Git launchers and separates policy results from unavailability", () => {
    withRealCodexAudit((targetProjectPath, auditContext) => {
      assert.equal(existsSync(join(targetProjectPath, ".git")), false);
      assert.equal(checkHookRuntimeSmoke(auditContext), null);
    });

    withRealCodexAudit((targetProjectPath, auditContext) => {
      writeFileSync(
        join(targetProjectPath, ".goat-flow", "hooks", "deny-dangerous.sh"),
        [
          "#!/usr/bin/env bash",
          'payload="$(cat)"',
          "# A safe user command is falsely rejected, which the audit must expose.",
          'if [[ "$payload" == *"echo safe"* ]]; then',
          "  printf 'BLOCKED: Policy destructive: safe fixture rejected\\n' >&2",
          "  exit 2",
          "fi",
          "printf 'BLOCKED: Policy repository: fixture deny\\n' >&2",
          "exit 2",
          "",
        ].join("\n"),
      );
      const failure = checkHookRuntimeSmoke(auditContext);
      assert.ok(
        failure,
        "safe false denial must fail configured-command audit",
      );
      assert.match(failure.message, /allow/u);
    });

    withRealCodexAudit((targetProjectPath, auditContext) => {
      unlinkSync(
        join(targetProjectPath, ".goat-flow", "hooks", "run-with-bash.mjs"),
      );
      const failure = checkHookRuntimeSmoke(auditContext);
      assert.ok(failure, "missing launcher must not look like policy denial");
      assert.match(failure.message, /unavailable|expected/iu);
    });

    withRealCodexAudit((targetProjectPath, auditContext) => {
      writeFileSync(
        join(targetProjectPath, ".goat-flow", "hooks", "deny-dangerous.sh"),
        "#!/usr/bin/env bash\nsleep 2\nprintf 'BLOCKED: Policy repository: late fixture deny\\n' >&2\nexit 2\n",
      );
      withHookLaunchTimeout("1", () => {
        const failure = checkHookRuntimeSmoke(auditContext);
        assert.ok(failure, "launcher timeout must not look like policy denial");
        assert.match(failure.message, /timeout|expected/iu);
      });
    });
  });

  it(
    "selects any present Codex Windows override instead of falling back to its default shell command",
    { skip: process.platform !== "win32" },
    () => {
      withRealCodexAudit((targetProjectPath, auditContext) => {
        const hookConfigPath = join(targetProjectPath, ".codex", "hooks.json");
        const hookConfig = JSON.parse(
          readFileSync(hookConfigPath, "utf-8"),
        ) as {
          hooks: {
            PreToolUse: Array<{
              hooks: Array<{
                command?: string;
                commandWindows?: string;
              }>;
            }>;
          };
        };
        const registeredHook = hookConfig.hooks.PreToolUse[0]?.hooks[0];
        assert.ok(registeredHook);
        assert.equal(typeof registeredHook?.commandWindows, "string");
        assert.equal(typeof registeredHook?.command, "string");
        const defaultCommand = registeredHook.command;

        // This remains a recognizable managed row but fails if audit incorrectly selects the Bash field on Windows.
        registeredHook.command = `${defaultCommand}; printf "default command selected\\n" >&2; exit 99`;
        writeFileSync(
          hookConfigPath,
          `${JSON.stringify(hookConfig, null, 2)}\n`,
        );

        assert.equal(checkHookRuntimeSmoke(auditContext), null);
      });

      withRealCodexAudit((targetProjectPath, auditContext) => {
        const hookConfigPath = join(targetProjectPath, ".codex", "hooks.json");
        const hookConfig = JSON.parse(
          readFileSync(hookConfigPath, "utf-8"),
        ) as {
          hooks: {
            PreToolUse: Array<{
              hooks: Array<{
                commandWindows?: string;
              }>;
            }>;
          };
        };
        const registeredHook = hookConfig.hooks.PreToolUse[0]?.hooks[0];
        assert.ok(registeredHook);

        // Presence controls Codex's platform selection, so an empty override is invalid instead of falling back to Bash.
        registeredHook.commandWindows = "";
        writeFileSync(
          hookConfigPath,
          `${JSON.stringify(hookConfig, null, 2)}\n`,
        );
        const emptyOverrideFailure = checkHookRuntimeSmoke(auditContext);
        assert.ok(emptyOverrideFailure);
        assert.match(emptyOverrideFailure.message, /empty commandWindows/u);
      });
    },
  );

  it("fails when an exact configured hook command points at a stale path", () => {
    assert.ok(denyCheck, "agent deny check should exist");
    const templates = guardrailTemplates();
    const ctx = makeRuntimeCtx({
      agentFilter: "codex",
      projectPath: PROJECT_ROOT,
      agents: [
        stubAgentFacts({
          agent: PROFILES.codex,
          settings: {
            exists: true,
            valid: true,
            parsed: {},
            hasDenyPatterns: false,
          },
          hooks: {
            ...stubAgentFacts().hooks,
            denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.sh",
            readDenyCoversSecrets: false,
          },
        }),
      ],
      fs: stubFS({
        readFile: installedGuardrailContent(templates, {
          ".codex/hooks.json": JSON.stringify({
            hooks: {
              PreToolUse: [
                {
                  matcher: "Bash",
                  hooks: [
                    {
                      type: "command",
                      command: ".codex/stale-hooks/deny-dangerous.sh",
                    },
                  ],
                },
              ],
            },
          }),
        }),
      }),
    });

    const result = denyCheck.run(ctx);
    assert.ok(result, "expected configured command runtime failure");
    assert.match(result.message, /configured hook command/);
    assert.equal(result.evidence, ".codex/hooks.json");
  });

  it("runs the configured launcher string instead of bypassing it with bash script path", () => {
    assert.ok(denyCheck, "agent deny check should exist");
    const templates = guardrailTemplates();
    const ctx = makeRuntimeCtx({
      agentFilter: "codex",
      projectPath: PROJECT_ROOT,
      agents: [
        stubAgentFacts({
          agent: PROFILES.codex,
          settings: {
            exists: true,
            valid: true,
            parsed: {},
            hasDenyPatterns: false,
          },
          hooks: {
            ...stubAgentFacts().hooks,
            denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.sh",
            readDenyCoversSecrets: false,
          },
        }),
      ],
      fs: stubFS({
        readFile: installedGuardrailContent(templates, {
          ".codex/hooks.json": JSON.stringify({
            hooks: {
              PreToolUse: [
                {
                  matcher: "Bash",
                  hooks: [
                    {
                      type: "command",
                      command:
                        'root="/missing-goat-flow-root"; bash "$root/.goat-flow/hooks/deny-dangerous.sh"',
                    },
                  ],
                },
              ],
            },
          }),
        }),
      }),
    });

    const result = denyCheck.run(ctx);
    assert.ok(result, "expected configured launcher runtime failure");
    assert.match(
      result.message,
      /configured hook command exited before deny-dangerous\.sh could start from project root \(exit 127\)/,
    );
    assert.equal(result.evidence, ".codex/hooks.json");
  });

  it("ignores unrelated hooks whose names merely contain a managed script name", () => {
    assert.ok(denyCheck, "agent deny check should exist");
    const templates = guardrailTemplates();
    const ctx = makeRuntimeCtx({
      agentFilter: "codex",
      projectPath: PROJECT_ROOT,
      agents: [
        stubAgentFacts({
          agent: PROFILES.codex,
          settings: {
            exists: true,
            valid: true,
            parsed: {},
            hasDenyPatterns: false,
          },
          hooks: {
            ...stubAgentFacts().hooks,
            denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.sh",
            readDenyCoversSecrets: false,
          },
        }),
      ],
      fs: stubFS({
        readFile: installedGuardrailContent(templates, {
          ".codex/hooks.json": JSON.stringify({
            hooks: {
              PreToolUse: [
                {
                  matcher: "Bash",
                  hooks: [
                    {
                      type: "command",
                      command: "bash .codex/hooks/custom-deny-dangerous.sh",
                    },
                  ],
                },
              ],
            },
          }),
        }),
      }),
    });

    const result = denyCheck.run(ctx);
    // The user's custom hook only contains the managed name as a substring,
    // so managed smoke discovery must skip it and validate the registered
    // hook directly instead of reporting the user's hook as broken.
    assert.equal(
      result,
      null,
      `unrelated hook was claimed as managed: ${JSON.stringify(result)}`,
    );
  });

  it("fails when a configured hook command points at a legacy per-agent mirror", () => {
    assert.ok(denyCheck, "agent deny check should exist");
    const templates = guardrailTemplates();
    const ctx = makeRuntimeCtx({
      agentFilter: "codex",
      projectPath: PROJECT_ROOT,
      agents: [
        stubAgentFacts({
          agent: PROFILES.codex,
          settings: {
            exists: true,
            valid: true,
            parsed: {},
            hasDenyPatterns: false,
          },
          hooks: {
            ...stubAgentFacts().hooks,
            denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.sh",
            readDenyCoversSecrets: false,
          },
        }),
      ],
      fs: stubFS({
        readFile: installedGuardrailContent(templates, {
          ".codex/hooks.json": JSON.stringify({
            hooks: {
              PreToolUse: [
                {
                  matcher: "Bash",
                  hooks: [
                    {
                      type: "command",
                      command: ".claude/hooks/deny-dangerous.sh",
                    },
                  ],
                },
              ],
            },
          }),
        }),
      }),
    });

    const result = denyCheck.run(ctx);
    assert.ok(result, "expected configured hook path mismatch failure");
    assert.match(
      result.message,
      /points at \.claude\/hooks\/deny-dangerous\.sh, expected \.goat-flow\/hooks\/deny-dangerous\.sh/,
    );
    assert.equal(result.evidence, ".codex/hooks.json");
  });
});

describe("agent deny hook template comparison", () => {
  const denyCheck = AGENT_CHECKS.find(
    (check) => check.id === "agent-guardrails",
  );
  /** Read canonical deny-dangerous templates used for drift comparisons. */
  function guardrailTemplates() {
    return {
      dispatcher: readFileSync(
        resolve(PROJECT_ROOT, "workflow/hooks/deny-dangerous.sh"),
        "utf-8",
      ),
      shell: readFileSync(
        resolve(
          PROJECT_ROOT,
          "workflow/hooks/deny-dangerous/patterns-shell.sh",
        ),
        "utf-8",
      ),
      paths: readFileSync(
        resolve(
          PROJECT_ROOT,
          "workflow/hooks/deny-dangerous/patterns-paths.sh",
        ),
        "utf-8",
      ),
      writes: readFileSync(
        resolve(
          PROJECT_ROOT,
          "workflow/hooks/deny-dangerous/patterns-writes.sh",
        ),
        "utf-8",
      ),
      selfTest: readFileSync(
        resolve(
          PROJECT_ROOT,
          "workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh",
        ),
        "utf-8",
      ),
    };
  }

  // Assemble the installed guardrail file set this scenario reads, applying the overrides that make one file stale or absent.
  function installedGuardrailContent(
    templates: ReturnType<typeof guardrailTemplates>,
    overrides: Record<string, string | null> = {},
  ) {
    const files: Record<string, string> = {
      [".goat-flow/hooks/deny-dangerous.sh"]: templates.dispatcher,
      ".goat-flow/hooks/deny-dangerous/patterns-shell.sh": templates.shell,
      ".goat-flow/hooks/deny-dangerous/patterns-paths.sh": templates.paths,
      ".goat-flow/hooks/deny-dangerous/patterns-writes.sh": templates.writes,
      ".goat-flow/hooks/deny-dangerous/deny-dangerous-self-test.sh":
        templates.selfTest,
    };
    /** Resolve installed hook content from overrides before template defaults. */
    const readInstalledGuardrail = (path: string) => {
      if (Object.hasOwn(overrides, path)) return overrides[path] ?? null;
      return files[path] ?? null;
    };
    return readInstalledGuardrail;
  }

  it("fails when an installed deny hook differs from the canonical template", () => {
    assert.ok(denyCheck, "agent deny check should exist");
    const templates = guardrailTemplates();
    const ctx = makeCtx({
      agentFilter: "claude",
      projectPath: PROJECT_ROOT,
      fs: stubFS({
        readFile: installedGuardrailContent(templates, {
          ".goat-flow/hooks/deny-dangerous.sh": `${templates.dispatcher}\n# local drift\n`,
        }),
      }),
    });
    const result = denyCheck.run(ctx);
    assert.ok(result, "expected hook version drift failure");
    assert.match(result.message, /differs from the current goat-flow template/);
    assert.equal(result.evidence, ".goat-flow/hooks/deny-dangerous.sh");
  });
});

describe("agent deny hook template comparison", () => {
  const denyCheck = AGENT_CHECKS.find(
    (check) => check.id === "agent-guardrails",
  );
  /** Read canonical deny-dangerous templates used for drift comparisons. */
  function guardrailTemplates() {
    return {
      dispatcher: readFileSync(
        resolve(PROJECT_ROOT, "workflow/hooks/deny-dangerous.sh"),
        "utf-8",
      ),
      shell: readFileSync(
        resolve(
          PROJECT_ROOT,
          "workflow/hooks/deny-dangerous/patterns-shell.sh",
        ),
        "utf-8",
      ),
      paths: readFileSync(
        resolve(
          PROJECT_ROOT,
          "workflow/hooks/deny-dangerous/patterns-paths.sh",
        ),
        "utf-8",
      ),
      writes: readFileSync(
        resolve(
          PROJECT_ROOT,
          "workflow/hooks/deny-dangerous/patterns-writes.sh",
        ),
        "utf-8",
      ),
      selfTest: readFileSync(
        resolve(
          PROJECT_ROOT,
          "workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh",
        ),
        "utf-8",
      ),
    };
  }

  // Assemble the installed guardrail file set this scenario reads, applying the overrides that make one file stale or absent.
  function installedGuardrailContent(
    templates: ReturnType<typeof guardrailTemplates>,
    overrides: Record<string, string | null> = {},
  ) {
    const files: Record<string, string> = {
      [".goat-flow/hooks/deny-dangerous.sh"]: templates.dispatcher,
      ".goat-flow/hooks/deny-dangerous/patterns-shell.sh": templates.shell,
      ".goat-flow/hooks/deny-dangerous/patterns-paths.sh": templates.paths,
      ".goat-flow/hooks/deny-dangerous/patterns-writes.sh": templates.writes,
      ".goat-flow/hooks/deny-dangerous/deny-dangerous-self-test.sh":
        templates.selfTest,
    };
    /** Resolve installed hook content from overrides before template defaults. */
    const readInstalledGuardrail = (path: string) => {
      if (Object.hasOwn(overrides, path)) return overrides[path] ?? null;
      return files[path] ?? null;
    };
    return readInstalledGuardrail;
  }

  it("fails when the shared deny hook self-test is missing", () => {
    assert.ok(denyCheck, "agent deny check should exist");
    const templates = guardrailTemplates();
    const ctx = makeCtx({
      agentFilter: "claude",
      projectPath: PROJECT_ROOT,
      fs: stubFS({
        readFile: installedGuardrailContent(templates, {
          ".goat-flow/hooks/deny-dangerous/deny-dangerous-self-test.sh": null,
        }),
      }),
    });
    const result = denyCheck.run(ctx);
    assert.ok(result, "expected missing self-test sibling failure");
    assert.match(result.message, /deny-dangerous-self-test\.sh is missing/);
    assert.equal(
      result.evidence,
      ".goat-flow/hooks/deny-dangerous/deny-dangerous-self-test.sh",
    );
  });
});

describe("agent deny hook template comparison", () => {
  const denyCheck = AGENT_CHECKS.find(
    (check) => check.id === "agent-guardrails",
  );
  /** Read canonical deny-dangerous templates used for drift comparisons. */
  function guardrailTemplates() {
    return {
      dispatcher: readFileSync(
        resolve(PROJECT_ROOT, "workflow/hooks/deny-dangerous.sh"),
        "utf-8",
      ),
      shell: readFileSync(
        resolve(
          PROJECT_ROOT,
          "workflow/hooks/deny-dangerous/patterns-shell.sh",
        ),
        "utf-8",
      ),
      paths: readFileSync(
        resolve(
          PROJECT_ROOT,
          "workflow/hooks/deny-dangerous/patterns-paths.sh",
        ),
        "utf-8",
      ),
      writes: readFileSync(
        resolve(
          PROJECT_ROOT,
          "workflow/hooks/deny-dangerous/patterns-writes.sh",
        ),
        "utf-8",
      ),
      selfTest: readFileSync(
        resolve(
          PROJECT_ROOT,
          "workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh",
        ),
        "utf-8",
      ),
    };
  }

  // Assemble the installed guardrail file set this scenario reads, applying the overrides that make one file stale or absent.
  function installedGuardrailContent(
    templates: ReturnType<typeof guardrailTemplates>,
    overrides: Record<string, string | null> = {},
  ) {
    const files: Record<string, string> = {
      [".goat-flow/hooks/deny-dangerous.sh"]: templates.dispatcher,
      ".goat-flow/hooks/deny-dangerous/patterns-shell.sh": templates.shell,
      ".goat-flow/hooks/deny-dangerous/patterns-paths.sh": templates.paths,
      ".goat-flow/hooks/deny-dangerous/patterns-writes.sh": templates.writes,
      ".goat-flow/hooks/deny-dangerous/deny-dangerous-self-test.sh":
        templates.selfTest,
    };
    /** Resolve installed hook content from overrides before template defaults. */
    const readInstalledGuardrail = (path: string) => {
      if (Object.hasOwn(overrides, path)) return overrides[path] ?? null;
      return files[path] ?? null;
    };
    return readInstalledGuardrail;
  }

  it("passes registered-hook runtime smoke for Copilot JSON payloads", () => {
    assert.ok(denyCheck, "agent deny check should exist");
    const templates = guardrailTemplates();
    const ctx = makeCtx({
      agentFilter: "copilot",
      projectPath: PROJECT_ROOT,
      agents: [
        stubAgentFacts({
          agent: PROFILES.copilot,
          settings: {
            exists: true,
            valid: true,
            parsed: {},
            hasDenyPatterns: false,
          },
          hooks: {
            ...stubAgentFacts().hooks,
            denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.sh",
            readDenyCoversSecrets: false,
          },
        }),
      ],
      fs: stubFS({
        readFile: installedGuardrailContent(templates),
      }),
    });

    assert.equal(denyCheck.run(ctx), null);
  });
});

describe("agent deny hook template comparison", () => {
  const denyCheck = AGENT_CHECKS.find(
    (check) => check.id === "agent-guardrails",
  );
  /** Read canonical deny-dangerous templates used for drift comparisons. */
  function guardrailTemplates() {
    return {
      dispatcher: readFileSync(
        resolve(PROJECT_ROOT, "workflow/hooks/deny-dangerous.sh"),
        "utf-8",
      ),
      shell: readFileSync(
        resolve(
          PROJECT_ROOT,
          "workflow/hooks/deny-dangerous/patterns-shell.sh",
        ),
        "utf-8",
      ),
      paths: readFileSync(
        resolve(
          PROJECT_ROOT,
          "workflow/hooks/deny-dangerous/patterns-paths.sh",
        ),
        "utf-8",
      ),
      writes: readFileSync(
        resolve(
          PROJECT_ROOT,
          "workflow/hooks/deny-dangerous/patterns-writes.sh",
        ),
        "utf-8",
      ),
      selfTest: readFileSync(
        resolve(
          PROJECT_ROOT,
          "workflow/hooks/deny-dangerous/deny-dangerous-self-test.sh",
        ),
        "utf-8",
      ),
    };
  }

  // Assemble the installed guardrail file set this scenario reads, applying the overrides that make one file stale or absent.
  function installedGuardrailContent(
    templates: ReturnType<typeof guardrailTemplates>,
    overrides: Record<string, string | null> = {},
  ) {
    const files: Record<string, string> = {
      [".goat-flow/hooks/deny-dangerous.sh"]: templates.dispatcher,
      ".goat-flow/hooks/deny-dangerous/patterns-shell.sh": templates.shell,
      ".goat-flow/hooks/deny-dangerous/patterns-paths.sh": templates.paths,
      ".goat-flow/hooks/deny-dangerous/patterns-writes.sh": templates.writes,
      ".goat-flow/hooks/deny-dangerous/deny-dangerous-self-test.sh":
        templates.selfTest,
    };
    /** Resolve installed hook content from overrides before template defaults. */
    const readInstalledGuardrail = (path: string) => {
      if (Object.hasOwn(overrides, path)) return overrides[path] ?? null;
      return files[path] ?? null;
    };
    return readInstalledGuardrail;
  }

  it("passes when the installed deny hook matches the canonical template", () => {
    assert.ok(denyCheck, "agent deny check should exist");
    const templates = guardrailTemplates();
    const ctx = makeCtx({
      agentFilter: "claude",
      projectPath: PROJECT_ROOT,
      fs: stubFS({
        readFile: installedGuardrailContent(templates),
      }),
    });
    assert.equal(denyCheck.run(ctx), null);
  });
});
