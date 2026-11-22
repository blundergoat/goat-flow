/**
 * Covers deny-hook audit results a user sees for current and stale installations.
 * Use when launcher identity, runtime policy probes, or agent response formats change.
 * Real non-Git Codex fixtures separate working policy from startup and timeout failures.
 * Stubbed configurations retain coverage for legacy paths and every supported agent.
 */
import {
  buildAgentHookCommand,
  buildAgentHookDescriptor,
  commandEntryReferencesSpec,
} from "../../../src/cli/server/agent-hook-command.js";
import {
  getHookSpec,
  listHookSpecs,
} from "../../../src/cli/server/hooks-registry.js";
import { compareHooks } from "../../../src/cli/audit/check-drift-hooks.js";
import type { DriftFinding } from "../../../src/cli/audit/types.js";
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

describe("Copilot split-policy registration order", () => {
  const configPath = ".github/hooks/hooks.json";
  const template = JSON.parse(
    readFileSync(
      resolve(PROJECT_ROOT, "workflow/hooks/agent-config/copilot-hooks.json"),
      "utf8",
    ),
  ) as { hooks: { preToolUse: Record<string, unknown>[] } };

  /** Compare native config in memory; the stub serves complete canonical runtime files, so findings must come from registration drift alone. */
  function nativeConfigFindings(
    entries: Record<string, unknown>[],
  ): DriftFinding[] {
    const installed = `${JSON.stringify({ ...template, hooks: { ...template.hooks, preToolUse: entries } }, null, 2)}\n`;
    const fs = stubFS({
      readFile: (path) => {
        if (path === configPath) return installed;
        if (path.startsWith(".goat-flow/hooks/")) {
          const sourcePath = resolve(
            PROJECT_ROOT,
            path.replace(".goat-flow/hooks/", "workflow/hooks/"),
          );
          return existsSync(sourcePath)
            ? readFileSync(sourcePath, "utf8")
            : null;
        }
        return null;
      },
    });
    const findings: DriftFinding[] = [];
    compareHooks(
      fs,
      PROJECT_ROOT,
      PROJECT_ROOT,
      findings,
      new Set(),
      "copilot",
    );
    return findings.filter((finding) => finding.path === configPath);
  }

  it("accepts either order of the two independently registered policy hooks", () => {
    assert.deepEqual(nativeConfigFindings(template.hooks.preToolUse), []);
    assert.deepEqual(
      nativeConfigFindings([...template.hooks.preToolUse].reverse()),
      [],
    );
  });

  it("still reports a duplicate or missing policy registration", () => {
    const [dangerous, git] = template.hooks.preToolUse;
    assert.ok(dangerous && git);
    for (const entries of [[git], [git, dangerous, git]]) {
      assert.ok(
        nativeConfigFindings(entries).some(
          (finding) => finding.kind === "content",
        ),
        `registrations=${entries.length}`,
      );
    }
  });

  it("still reports changed policy commands, timeouts and unrelated registrations", () => {
    const [dangerous, git] = template.hooks.preToolUse;
    assert.ok(dangerous && git);
    for (const entries of [
      [{ ...git, timeoutSec: 1 }, dangerous],
      [{ ...git, bash: `${String(git.bash)} --unexpected` }, dangerous],
      [git, dangerous, { type: "command", bash: "printf user-hook" }],
    ]) {
      assert.ok(
        nativeConfigFindings(entries).some(
          (finding) => finding.kind === "content",
        ),
      );
    }
  });
});

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
    applyHookState("deny-git-mutations", true, targetProjectPath);
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
            denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.mjs",
            gitDenyRegisteredPath: ".goat-flow/hooks/deny-git-mutations.mjs",
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

/** Add the Git sibling to an otherwise complete provider fixture without changing the command under test. */
function withGitRegistration(
  path: string,
  content: string | null,
): string | null {
  if (
    content === null ||
    ![".codex/hooks.json", ".claude/settings.json"].includes(path)
  )
    return content;
  const config = JSON.parse(content);
  const dangerous = getHookSpec("deny-dangerous");
  assert.ok(dangerous);
  if (
    !config.hooks?.PreToolUse?.some((group: { hooks?: unknown[] }) =>
      group.hooks?.some((row) => commandEntryReferencesSpec(row, dangerous)),
    )
  )
    return content;
  const spec = getHookSpec("deny-git-mutations");
  assert.ok(spec);
  const { form, ...handler } = buildAgentHookDescriptor(
    path.startsWith(".codex") ? "codex" : "claude",
    ".goat-flow/hooks",
    spec,
  );
  config.hooks.PreToolUse.push({
    matcher: "Bash",
    hooks: [{ type: form === "argv" ? "exec" : "command", ...handler }],
  });
  return JSON.stringify(config);
}

/** Read canonical deny-dangerous templates used for drift comparisons. */
function guardrailTemplates() {
  return {
    git: readFileSync(
      resolve(PROJECT_ROOT, "workflow/hooks/deny-git-mutations.mjs"),
      "utf-8",
    ),
    runtime: readFileSync(
      resolve(PROJECT_ROOT, "workflow/hooks/policy-evaluation.mjs"),
      "utf-8",
    ),
    dispatcher: readFileSync(
      resolve(PROJECT_ROOT, "workflow/hooks/deny-dangerous.mjs"),
      "utf-8",
    ),
    shell: readFileSync(
      resolve(PROJECT_ROOT, "workflow/hooks/deny-dangerous/patterns-shell.mjs"),
      "utf-8",
    ),
    paths: readFileSync(
      resolve(PROJECT_ROOT, "workflow/hooks/deny-dangerous/patterns-paths.mjs"),
      "utf-8",
    ),
    writes: readFileSync(
      resolve(
        PROJECT_ROOT,
        "workflow/hooks/deny-dangerous/patterns-writes.mjs",
      ),
      "utf-8",
    ),
    selfTest: readFileSync(
      resolve(PROJECT_ROOT, "workflow/hooks/policy-corpus.mjs"),
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
    [".goat-flow/hooks/deny-dangerous.mjs"]: templates.dispatcher,
    ".goat-flow/hooks/deny-git-mutations.mjs": templates.git,
    ".goat-flow/hooks/policy-evaluation.mjs": templates.runtime,
    ".goat-flow/hooks/deny-dangerous/patterns-shell.mjs": templates.shell,
    ".goat-flow/hooks/deny-dangerous/patterns-paths.mjs": templates.paths,
    ".goat-flow/hooks/deny-dangerous/patterns-writes.mjs": templates.writes,
    ".goat-flow/hooks/policy-corpus.mjs": templates.selfTest,
  };
  for (const file of new Set(
    listHookSpecs().flatMap((spec) => spec.scriptFiles),
  )) {
    files[`.goat-flow/hooks/${file}`] ??= readFileSync(
      resolve(PROJECT_ROOT, "workflow/hooks", file),
      "utf8",
    );
  }
  for (const [configPath, agentId] of [
    [".codex/hooks.json", "codex"],
    [".claude/settings.json", "claude"],
  ] as const) {
    files[configPath] = JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: ["deny-dangerous", "deny-git-mutations"].map((id) => {
              const { form, ...handler } = buildAgentHookDescriptor(
                agentId,
                ".goat-flow/hooks",
                getHookSpec(id)!,
              );
              return {
                type: form === "argv" ? "exec" : "command",
                ...handler,
              };
            }),
          },
        ],
      },
    });
  }
  /** Resolve installed hook content from overrides before template defaults. */
  const readInstalledGuardrail = (path: string) => {
    if (Object.hasOwn(overrides, path))
      return withGitRegistration(path, overrides[path] ?? null);
    return files[path] ?? null;
  };
  return readInstalledGuardrail;
}

describe("agent deny hook template comparison", () => {
  const denyCheck = AGENT_CHECKS.find(
    (check) => check.id === "agent-guardrails",
  );

  it("replays literal non-Git launchers through both real policy hooks", () => {
    withRealCodexAudit((targetProjectPath, auditContext) => {
      assert.equal(existsSync(join(targetProjectPath, ".git")), false);
      assert.equal(checkHookRuntimeSmoke(auditContext), null);
    });
  });

  // Fixture purpose: writes a deny hook that rejects a safe command; the audit replay spawns it and must report the false denial.
  it("fails the audit when a non-Git launcher denies a safe command", () => {
    withRealCodexAudit((targetProjectPath, auditContext) => {
      writeFileSync(
        join(targetProjectPath, ".goat-flow", "hooks", "deny-dangerous.mjs"),
        `let payload = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { payload += chunk; });
process.stdin.on("end", () => {
  console.error(payload.includes("echo safe")
    ? "BLOCKED: Policy destructive: safe fixture rejected"
    : "BLOCKED: Policy repository: fixture deny");
  process.exitCode = 2;
});
`,
      );
      const failure = checkHookRuntimeSmoke(auditContext);
      assert.ok(
        failure,
        "safe false denial must fail configured-command audit",
      );
      assert.match(failure.message, /allow/u);
    });
  });

  it("keeps a missing non-Git launcher distinct from a policy denial", () => {
    withRealCodexAudit((targetProjectPath, auditContext) => {
      unlinkSync(
        join(targetProjectPath, ".goat-flow", "hooks", "run-hook.mjs"),
      );
      const failure = checkHookRuntimeSmoke(auditContext);
      assert.ok(failure, "missing launcher must not look like policy denial");
      assert.match(failure.message, /unavailable|expected/iu);
    });
  });

  it("keeps a non-Git launcher timeout distinct from a policy denial", () => {
    withRealCodexAudit((targetProjectPath, auditContext) => {
      writeFileSync(
        join(targetProjectPath, ".goat-flow", "hooks", "deny-dangerous.mjs"),
        "setTimeout(() => { console.error('BLOCKED: Policy repository: late fixture deny'); process.exit(2); }, 2000);\n",
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
            denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.mjs",
            gitDenyRegisteredPath: ".goat-flow/hooks/deny-git-mutations.mjs",
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
                      command: ".codex/stale-hooks/deny-dangerous.mjs",
                    },
                  ],
                },
              ],
            },
          }),
        }),
      }),
    });

    const result = checkHookRuntimeSmoke(ctx);
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
            denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.mjs",
            gitDenyRegisteredPath: ".goat-flow/hooks/deny-git-mutations.mjs",
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
                        'root="/missing-goat-flow-root"; bash "$root/.goat-flow/hooks/deny-dangerous.mjs"',
                    },
                  ],
                },
              ],
            },
          }),
        }),
      }),
    });

    const result = checkHookRuntimeSmoke(ctx);
    assert.ok(result, "expected configured launcher runtime failure");
    assert.match(
      result.message,
      /configured hook command exited before deny-dangerous\.mjs could start from project root \(exit 127\)/,
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
            denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.mjs",
            gitDenyRegisteredPath: ".goat-flow/hooks/deny-git-mutations.mjs",
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
                    ...["deny-dangerous", "deny-git-mutations"].map((id) => ({
                      type: "command",
                      command: buildAgentHookCommand(
                        "codex",
                        ".goat-flow/hooks",
                        getHookSpec(id)!,
                      ),
                    })),
                    {
                      type: "command",
                      command: "bash .codex/hooks/custom-deny-dangerous.mjs",
                    },
                  ],
                },
              ],
            },
          }),
        }),
      }),
    });

    const result = checkHookRuntimeSmoke(ctx);
    // The user's custom hook only contains the managed name as a substring,
    // so managed smoke discovery must skip it and replay the two managed
    // registrations instead of reporting the user's hook as broken.
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
            denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.mjs",
            gitDenyRegisteredPath: ".goat-flow/hooks/deny-git-mutations.mjs",
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
                      command: ".claude/hooks/deny-dangerous.mjs",
                    },
                  ],
                },
              ],
            },
          }),
        }),
      }),
    });

    const result = checkHookRuntimeSmoke(ctx);
    assert.ok(result, "expected configured hook path mismatch failure");
    assert.match(
      result.message,
      /points at \.claude\/hooks\/deny-dangerous\.mjs, expected \.goat-flow\/hooks\/deny-dangerous\.mjs/,
    );
    assert.equal(result.evidence, ".codex/hooks.json");
  });
});

describe("agent deny hook template comparison", () => {
  const denyCheck = AGENT_CHECKS.find(
    (check) => check.id === "agent-guardrails",
  );

  it("fails when an installed deny hook differs from the canonical template", () => {
    assert.ok(denyCheck, "agent deny check should exist");
    const templates = guardrailTemplates();
    const ctx = makeCtx({
      agentFilter: "claude",
      projectPath: PROJECT_ROOT,
      fs: stubFS({
        readFile: installedGuardrailContent(templates, {
          ".goat-flow/hooks/deny-dangerous.mjs": `${templates.dispatcher}\n// local drift\n`,
        }),
      }),
    });
    const result = denyCheck.run(ctx);
    assert.ok(result, "expected hook version drift failure");
    assert.match(result.message, /differs from the current goat-flow template/);
    assert.equal(result.evidence, ".goat-flow/hooks/deny-dangerous.mjs");
  });
});

describe("agent deny hook template comparison", () => {
  const denyCheck = AGENT_CHECKS.find(
    (check) => check.id === "agent-guardrails",
  );

  it("fails when the shared deny hook self-test is missing", () => {
    assert.ok(denyCheck, "agent deny check should exist");
    const templates = guardrailTemplates();
    const ctx = makeCtx({
      agentFilter: "claude",
      projectPath: PROJECT_ROOT,
      fs: stubFS({
        readFile: installedGuardrailContent(templates, {
          ".goat-flow/hooks/policy-corpus.mjs": null,
        }),
      }),
    });
    const result = denyCheck.run(ctx);
    assert.ok(result, "expected missing self-test sibling failure");
    assert.match(result.message, /policy-corpus\.mjs.*missing/);
    assert.equal(result.evidence, ".goat-flow/hooks/policy-corpus.mjs");
  });
});

describe("agent deny hook template comparison", () => {
  const denyCheck = AGENT_CHECKS.find(
    (check) => check.id === "agent-guardrails",
  );

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
            denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.mjs",
            gitDenyRegisteredPath: ".goat-flow/hooks/deny-git-mutations.mjs",
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
