/**
 * Verifies that agent guardrail audits reflect the hook developers actually run.
 * Use when a user audits a project and needs sandbox failures, launcher drift, and
 * policy outcomes reported separately instead of collapsed into one generic failure.
 * Runtime payload checks keep installed-hook behavior aligned with the audit result.
 */
import {
  agentHookSpawnDescriptor,
  buildAgentHookCommand,
  buildAgentHookDescriptor,
  commandEntryReferencesSpec,
} from "../../../src/cli/server/agent-hook-command.js";
import {
  getHookSpec,
  listHookSpecs,
} from "../../../src/cli/server/hooks-registry.js";
import { checkHookRuntimeSmoke } from "../../../src/cli/audit/check-agent-deny-runtime.js";
import {
  AGENT_CHECKS,
  PROFILES,
  PROJECT_ROOT,
  assert,
  describe,
  it,
  makeCtx as makeAuditContext,
  readFileSync,
  resolve,
  stubAgentFacts,
  stubFS,
} from "./helpers.js";
import { afterEach } from "node:test";
import { createRequire, syncBuiltinESMExports } from "node:module";
import type { SpawnSyncOptions } from "node:child_process";

const require = createRequire(import.meta.url);
const childProcess =
  require("node:child_process") as typeof import("node:child_process");
const originalExecFileSync = childProcess.execFileSync;
const originalSpawnSync = childProcess.spawnSync;

/** Build this runtime-focused suite's contexts with the explicit full-evidence choice. */
function makeCtx(
  overrides: Parameters<typeof makeAuditContext>[0],
): ReturnType<typeof makeAuditContext> {
  return makeAuditContext({
    ...overrides,
    denyMechanismEvidenceLevel: "full",
  });
}

afterEach(() => {
  childProcess.execFileSync = originalExecFileSync;
  childProcess.spawnSync = originalSpawnSync;
  syncBuiltinESMExports();
});

/** Build the EPERM error shape Node returns when spawnSync cannot launch Node. */
function spawnEperm(): NodeJS.ErrnoException {
  const error = new Error("spawnSync node EPERM") as NodeJS.ErrnoException;
  error.code = "EPERM";
  error.errno = -1;
  error.syscall = "spawnSync node";
  error.path = process.execPath;
  return error;
}

/** Build the contradictory EPERM fixture that also carries a completed status. */
function completedEperm(): NodeJS.ErrnoException & { status: number } {
  const error = spawnEperm() as NodeJS.ErrnoException & { status: number };
  error.status = 0;
  return error;
}

/**
 * Return the Codex result a user should receive for one safe or blocked runtime probe.
 * Use in launcher mocks so policy meaning comes from payload content, never call order.
 */
function codexRuntimeProbeResult(
  hookInput: string,
  spawnError?: NodeJS.ErrnoException,
): ReturnType<typeof childProcess.spawnSync> {
  const isSafeUserCommand = hookInput.includes("echo safe");
  const blockedPolicyMessage =
    "BLOCKED: Policy repository: git push is not allowed.";
  // Safe work continues quietly; a repository write receives the policy block users expect.
  return {
    status: isSafeUserCommand ? 0 : 2,
    signal: null,
    error: spawnError,
    output: [null, "", isSafeUserCommand ? "" : blockedPolicyMessage],
    pid: 0,
    stdout: "",
    stderr: isSafeUserCommand ? "" : blockedPolicyMessage,
  } as ReturnType<typeof childProcess.spawnSync>;
}

/** Read the stdin actually supplied to a mock, including finite PowerShell input on Windows. */
function readHookProbeInput(options: SpawnSyncOptions): string {
  if (typeof options.input === "string") return options.input;
  const descriptor = Array.isArray(options.stdio)
    ? options.stdio[0]
    : undefined;
  return typeof descriptor === "number" ? readFileSync(descriptor, "utf8") : "";
}

/**
 * Return a completed direct-script probe with no policy text.
 * Use when a test needs the later agent to supply the visible audit failure.
 */
function completedDirectHookProbe(): ReturnType<typeof childProcess.spawnSync> {
  return {
    status: 0,
    signal: null,
    error: undefined,
    output: [null, "", ""],
    pid: 0,
    stdout: "",
    stderr: "",
  } as ReturnType<typeof childProcess.spawnSync>;
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

describe("agent deny hook template comparison", () => {
  const denyCheck = AGENT_CHECKS.find(
    (check) => check.id === "agent-guardrails",
  );
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
        resolve(
          PROJECT_ROOT,
          "workflow/hooks/deny-dangerous/patterns-shell.mjs",
        ),
        "utf-8",
      ),
      paths: readFileSync(
        resolve(
          PROJECT_ROOT,
          "workflow/hooks/deny-dangerous/patterns-paths.mjs",
        ),
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

  /**
   * The aggregate audit (the form CI and preflight run) pins the dispatcher and launchers to their templates through drift,
   * but the deny-dangerous/ policy modules are compared only in selected-agent mode, so a module mirror that drifted from
   * workflow/hooks/ would pass CI while this checkout's agents ran a different policy than the one that ships.
   */
  it("keeps the installed deny-hook mirrors byte-identical to their workflow templates", () => {
    const templates = guardrailTemplates();
    const mirrorsByTemplate: Record<string, string> = {
      ".goat-flow/hooks/deny-dangerous.mjs": templates.dispatcher,
      ".goat-flow/hooks/deny-git-mutations.mjs": templates.git,
      ".goat-flow/hooks/policy-evaluation.mjs": templates.runtime,
      ".goat-flow/hooks/deny-dangerous/patterns-shell.mjs": templates.shell,
      ".goat-flow/hooks/deny-dangerous/patterns-paths.mjs": templates.paths,
      ".goat-flow/hooks/deny-dangerous/patterns-writes.mjs": templates.writes,
      ".goat-flow/hooks/policy-corpus.mjs": templates.selfTest,
    };
    const driftedMirrors = Object.entries(mirrorsByTemplate)
      .filter(
        ([mirrorPath, templateContent]) =>
          readFileSync(resolve(PROJECT_ROOT, mirrorPath), "utf-8") !==
          templateContent,
      )
      .map(([mirrorPath]) => mirrorPath);
    assert.deepEqual(
      driftedMirrors,
      [],
      `installed deny-hook mirrors differ from workflow/hooks/ templates; copy the template over each listed mirror: ${driftedMirrors.join(", ")}`,
    );
  });

  /**
   * Pair allowed reads with denied writes through the configured Codex launcher.
   * Either outcome alone could hide a launcher that permits or rejects everything.
   */
  it("allows quoted repository evidence while the registered hook still blocks repository writes", () => {
    const registeredHookConfig = JSON.parse(
      readFileSync(resolve(PROJECT_ROOT, ".codex/hooks.json"), "utf-8"),
    ) as {
      hooks: {
        PreToolUse: Array<{
          matcher: string;
          hooks: Array<{ command: string; commandWindows?: string }>;
        }>;
      };
    };

    // Replay the provider's current-platform registration, including its Windows override.
    const registeredCodexHook = registeredHookConfig.hooks.PreToolUse.flatMap(
      (registration) => registration.hooks,
    ).find((handler) => handler.command.includes("deny-git-mutations.mjs"));
    assert.ok(registeredCodexHook, "expected the registered Codex Git policy");
    const registeredCodexHookCommand = agentHookSpawnDescriptor({
      form: "shell",
      ...registeredCodexHook,
    });

    const quotedEvidencePayload = JSON.stringify({
      tool_name: "Bash",
      tool_input: {
        command:
          "rg -n 'git commit|git push' workflow/hooks/deny-dangerous | head -n 10",
      },
    });
    // Use the exact provider argv without adding a login shell or changing payload delivery.
    const quotedEvidenceResult = originalSpawnSync(
      registeredCodexHookCommand.command,
      registeredCodexHookCommand.args,
      {
        cwd: PROJECT_ROOT,
        input: quotedEvidencePayload,
        encoding: "utf-8",
      },
    );
    assert.equal(
      quotedEvidenceResult.status,
      0,
      quotedEvidenceResult.stderr || "quoted evidence should be allowed",
    );
    assert.equal(
      quotedEvidenceResult.stderr,
      "",
      `quoted evidence produced stderr; stdout=${JSON.stringify(quotedEvidenceResult.stdout)} stderr=${JSON.stringify(quotedEvidenceResult.stderr)}`,
    );

    const blockedRepositoryWritePayload = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "printf message | git commit -F -" },
    });
    const blockedRepositoryWriteResult = originalSpawnSync(
      registeredCodexHookCommand.command,
      registeredCodexHookCommand.args,
      {
        cwd: PROJECT_ROOT,
        input: blockedRepositoryWritePayload,
        encoding: "utf-8",
      },
    );
    assert.equal(
      blockedRepositoryWriteResult.status,
      2,
      `repository write was not blocked; stdout=${JSON.stringify(blockedRepositoryWriteResult.stdout)} stderr=${JSON.stringify(blockedRepositoryWriteResult.stderr)}`,
    );
    assert.match(blockedRepositoryWriteResult.stderr, /Policy repository/);

    // Replay inert input through the saved launcher; no GitHub request executes.
    for (const { command, expectedStatus } of [
      {
        command: `gh api graphql -f query='{ repository(owner: "blundergoat", name: "goat-flow") { discussions(first: 1) { nodes { number title body url comments(first: 5) { nodes { body url } } } } } }'`,
        expectedStatus: 0,
      },
      {
        command: `gh api graphql -f query='mutation { __typename }'`,
        expectedStatus: 2,
      },
    ]) {
      const result = originalSpawnSync(
        registeredCodexHookCommand.command,
        registeredCodexHookCommand.args,
        {
          cwd: PROJECT_ROOT,
          input: JSON.stringify({
            tool_name: "Bash",
            tool_input: { command },
          }),
          encoding: "utf-8",
        },
      );
      assert.equal(
        result.status,
        expectedStatus,
        `registered GraphQL policy: ${command}; stderr=${result.stderr}`,
      );
      if (expectedStatus === 2) {
        assert.match(result.stderr, /Policy repository/);
      } else {
        assert.equal(result.stderr, "");
      }
    }
  });

  it("reports sandbox spawn denial separately from hook syntax errors", () => {
    assert.ok(denyCheck, "agent deny check should exist");
    const templates = guardrailTemplates();
    childProcess.execFileSync = (() => {
      throw spawnEperm();
    }) as typeof childProcess.execFileSync;
    syncBuiltinESMExports();

    const ctx = makeCtx({
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
        readFile: installedGuardrailContent(templates),
        listDir: (path) =>
          path === PROFILES.codex.hooksDir ? ["deny-dangerous.mjs"] : [],
      }),
    });

    const result = denyCheck.run(ctx);
    assert.ok(result, "expected child-process spawn failure");
    assert.match(result.message, /could not spawn node \(EPERM:/);
    assert.doesNotMatch(result.message, /node --check failed/);
    assert.match(
      result.howToFix ?? "",
      /outside the child-process-restricted sandbox/,
    );
  });

  it("uses the current Node executable for native syntax checks", () => {
    const syntaxCommands: string[] = [];
    childProcess.execFileSync = ((command, args) => {
      if (args?.[0] === "--check") syntaxCommands.push(String(command));
      return Buffer.from("");
    }) as typeof childProcess.execFileSync;
    syncBuiltinESMExports();
    assert.ok(denyCheck);
    denyCheck.run(
      makeAuditContext({
        agentFilter: "codex",
        projectPath: PROJECT_ROOT,
        agents: [stubAgentFacts({ agent: PROFILES.codex })],
        fs: stubFS({
          readFile: installedGuardrailContent(guardrailTemplates()),
          listDir: (path) =>
            path === PROFILES.codex.hooksDir ? ["deny-dangerous.mjs"] : [],
        }),
      }),
    );
    assert.deepEqual(syntaxCommands, [process.execPath]);
  });

  for (const status of [1]) {
    it(`reports native JavaScript parse errors (exit ${status})`, () => {
      assert.ok(denyCheck);
      childProcess.execFileSync = ((_command, args) => {
        if (args?.[0] === "--check")
          throw Object.assign(new Error("node failed"), { status });
        return Buffer.from("");
      }) as typeof childProcess.execFileSync;
      syncBuiltinESMExports();
      const result = denyCheck.run(
        makeAuditContext({
          agentFilter: "codex",
          denyMechanismEvidenceLevel: "static",
          projectPath: PROJECT_ROOT,
          agents: [stubAgentFacts({ agent: PROFILES.codex })],
          fs: stubFS({
            listDir: (path) =>
              path === PROFILES.codex.hooksDir ? ["deny-dangerous.mjs"] : [],
          }),
        }),
      );
      assert.ok(result);
      assert.match(result.message, /node --check failed/);
      assert.match(result.howToFix ?? "", /syntax errors/);
    });
  }

  it("reports self-test spawn denial instead of a deny-dangerous failure", () => {
    assert.ok(denyCheck, "agent deny check should exist");
    const templates = guardrailTemplates();
    childProcess.execFileSync = ((command, args) => {
      if (Array.isArray(args) && args[0] === "--check") return Buffer.from("");
      throw spawnEperm();
    }) as typeof childProcess.execFileSync;
    syncBuiltinESMExports();

    const ctx = makeCtx({
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
        readFile: installedGuardrailContent(templates),
        listDir: (path) =>
          path === PROFILES.codex.hooksDir ? ["deny-dangerous.mjs"] : [],
      }),
    });

    const result = denyCheck.run(ctx);
    assert.ok(result, "expected self-test spawn failure");
    assert.match(
      result.message,
      /deny-dangerous self-test for codex could not spawn node \(EPERM:/,
    );
    assert.doesNotMatch(result.message, /self-test=smoke failed/);
  });

  it("runs each installed dispatcher self-test with Node", () => {
    assert.ok(denyCheck, "agent deny check should exist");
    const templates = guardrailTemplates();
    const capturedCommands: string[] = [];
    const capturedScripts: string[] = [];
    const capturedTimeouts: number[] = [];
    childProcess.execFileSync = ((command, args, options) => {
      if (Array.isArray(args) && args[0] === "--check") {
        return Buffer.from("");
      }
      if (Array.isArray(args) && args[1] === "--self-test=smoke") {
        capturedTimeouts.push((options as { timeout: number }).timeout);
        capturedCommands.push(String(command));
        capturedScripts.push(String(args[0]));
        return Buffer.from("");
      }
      return Buffer.from("");
    }) as typeof childProcess.execFileSync;
    childProcess.spawnSync = ((
      _command: string,
      _args: readonly string[],
      options: SpawnSyncOptions,
    ) =>
      codexRuntimeProbeResult(
        readHookProbeInput(options),
      )) as typeof childProcess.spawnSync;
    syncBuiltinESMExports();

    const ctx = makeCtx({
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
        readFile: installedGuardrailContent(templates),
        listDir: (path) =>
          path === PROFILES.codex.hooksDir ? ["deny-dangerous.mjs"] : [],
      }),
    });

    assert.equal(denyCheck.run(ctx), null);
    assert.deepEqual(capturedCommands, [process.execPath, process.execPath]);
    const expectedTimeout = process.platform === "win32" ? 120_000 : 30_000;
    assert.deepEqual(capturedTimeouts, [expectedTimeout, expectedTimeout]);
    assert.deepEqual(capturedScripts, [
      resolve(PROJECT_ROOT, ".goat-flow/hooks/deny-dangerous.mjs"),
      resolve(PROJECT_ROOT, ".goat-flow/hooks/deny-git-mutations.mjs"),
    ]);
  });

  it("reports configured command spawn denial instead of exit -1", () => {
    assert.ok(denyCheck, "agent deny check should exist");
    const templates = guardrailTemplates();
    childProcess.execFileSync = (() =>
      Buffer.from("")) as typeof childProcess.execFileSync;
    childProcess.spawnSync = (() =>
      ({
        status: null,
        signal: null,
        error: spawnEperm(),
        output: [null, "", ""],
        pid: 0,
        stdout: "",
        stderr: "",
      }) as ReturnType<
        typeof childProcess.spawnSync
      >) as typeof childProcess.spawnSync;
    syncBuiltinESMExports();

    const ctx = makeCtx({
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
                      command: buildAgentHookCommand(
                        "codex",
                        ".goat-flow/hooks",
                        getHookSpec("deny-dangerous")!,
                      ),
                    },
                  ],
                },
              ],
            },
          }),
        }),
        listDir: (path) =>
          path === PROFILES.codex.hooksDir ? ["deny-dangerous.mjs"] : [],
      }),
    });

    const result = denyCheck.run(ctx);
    assert.ok(result, "expected configured-command spawn failure");
    assert.match(
      result.message,
      /configured hook command for deny-dangerous\.mjs could not spawn node \(EPERM:/,
    );
    assert.doesNotMatch(result.message, /exit -1/);
  });

  it("ignores sandbox error metadata when hook commands completed", () => {
    assert.ok(denyCheck, "agent deny check should exist");
    const templates = guardrailTemplates();
    childProcess.execFileSync = (() => {
      throw completedEperm();
    }) as typeof childProcess.execFileSync;
    childProcess.spawnSync = ((
      _command: string,
      _args: readonly string[],
      options: SpawnSyncOptions,
    ) => {
      // A missing payload means no user command reached the mock and cannot prove policy.
      const hookInput = readHookProbeInput(options);
      return codexRuntimeProbeResult(hookInput, spawnEperm());
    }) as typeof childProcess.spawnSync;
    syncBuiltinESMExports();

    const ctx = makeCtx({
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
                      command: buildAgentHookCommand(
                        "codex",
                        ".goat-flow/hooks",
                        getHookSpec("deny-dangerous")!,
                      ),
                    },
                  ],
                },
              ],
            },
          }),
        }),
        listDir: (path) =>
          path === PROFILES.codex.hooksDir ? ["deny-dangerous.mjs"] : [],
      }),
    });

    assert.equal(denyCheck.run(ctx), null);
  });

  it("continues to later agents after a configured command passes", () => {
    assert.ok(denyCheck, "agent deny check should exist");
    const templates = guardrailTemplates();
    let configuredRuntimeProbeCalls = 0;
    let directRuntimeProbeCalls = 0;
    childProcess.execFileSync = (() =>
      Buffer.from("")) as typeof childProcess.execFileSync;
    childProcess.spawnSync = ((
      _command: string,
      args: readonly string[],
      options: SpawnSyncOptions,
    ) => {
      const hookInput = readHookProbeInput(options);
      // The later provider must still be replayed after the first provider succeeds.
      if (args.includes(".claude/settings.json")) {
        assert.ok(
          hookInput,
          "later provider replay must receive its payload on stdin",
        );
        directRuntimeProbeCalls += 1;
        return completedDirectHookProbe();
      }
      configuredRuntimeProbeCalls += 1;
      // A missing payload means no user command reached the configured launcher.
      return codexRuntimeProbeResult(hookInput);
    }) as typeof childProcess.spawnSync;
    syncBuiltinESMExports();

    const readFile = installedGuardrailContent(templates, {
      ".codex/hooks.json": JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                {
                  type: "command",
                  command: buildAgentHookCommand(
                    "codex",
                    ".goat-flow/hooks",
                    getHookSpec("deny-dangerous")!,
                  ),
                },
              ],
            },
          ],
        },
      }),
    });
    const ctx = makeCtx({
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
        stubAgentFacts({
          agent: PROFILES.claude,
          hooks: {
            ...stubAgentFacts().hooks,
            denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.mjs",
            gitDenyRegisteredPath: ".goat-flow/hooks/deny-git-mutations.mjs",
          },
        }),
      ],
      fs: stubFS({
        readFile,
        listDir: (path) =>
          path === PROFILES.codex.hooksDir ? ["deny-dangerous.mjs"] : [],
      }),
    });

    const auditResult = denyCheck.run(ctx);
    assert.ok(auditResult, "expected later-agent direct runtime failure");
    assert.match(auditResult.message, /configured hook command/);
    assert.equal(auditResult.evidence, ".claude/settings.json");
    assert.ok(configuredRuntimeProbeCalls > 0, "first provider was replayed");
    assert.ok(directRuntimeProbeCalls > 0, "later provider was replayed");
  });

  it("fails when a direct configured command is replayed from nested cwd", () => {
    assert.ok(denyCheck, "agent deny check should exist");
    const templates = guardrailTemplates();
    const ctx = makeCtx({
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
                      command: "node .goat-flow/hooks/deny-dangerous.mjs",
                    },
                  ],
                },
              ],
            },
          }),
        }),
        listDir: (path) =>
          path === PROFILES.codex.hooksDir ? ["deny-dangerous.mjs"] : [],
      }),
    });

    const result = checkHookRuntimeSmoke(ctx);
    assert.ok(result, "expected nested-cwd configured command failure");
    assert.match(
      result.message,
      /configured hook command.*expected allow response.*from \.goat-flow/,
    );
    assert.equal(result.evidence, ".codex/hooks.json");
  });

  it("fails when a configured hook command hides the script path in shell text", () => {
    assert.ok(denyCheck, "agent deny check should exist");
    const templates = guardrailTemplates();
    const ctx = makeCtx({
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
                        "bash -lc 'exit 127' # .goat-flow/hooks/deny-dangerous.mjs",
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
    assert.match(
      result.message,
      /does not name an exact managed hook script path/,
    );
    assert.equal(result.evidence, ".codex/hooks.json");
  });

  it("fails when legacy split guardrail hooks are still installed", () => {
    assert.ok(denyCheck, "agent deny check should exist");
    const templates = guardrailTemplates();
    const ctx = makeCtx({
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
            denyRegisteredPath: ".codex/hooks/guard-repository-writes.sh",
            readDenyCoversSecrets: false,
          },
        }),
      ],
      fs: stubFS({
        readFile: installedGuardrailContent(templates, {
          ".codex/hooks/guard-repository-writes.sh": "# old split hook\n",
        }),
      }),
    });

    const result = denyCheck.run(ctx);
    assert.ok(result, "expected legacy guardrail drift failure");
    assert.match(result.message, /legacy guardrail hook/);
    assert.equal(result.evidence, ".codex/hooks/guard-repository-writes.sh");
  });
});
