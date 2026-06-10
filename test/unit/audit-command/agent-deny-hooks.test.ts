/**
 * Audit checks that compare an installed agent deny hook against the canonical template: failing when a
 * configured command hides the script path in shell text, points at a stale path, diverges from the template,
 * or the shared self-test is missing, and passing on an exact match and on the Copilot JSON runtime smoke.
 */
import {
  AGENT_CHECKS,
  PROFILES,
  PROJECT_ROOT,
  assert,
  describe,
  it,
  makeCtx,
  readFileSync,
  resolve,
  stubAgentFacts,
  stubFS,
} from "./helpers.js";
import { afterEach } from "node:test";
import { createRequire, syncBuiltinESMExports } from "node:module";

const require = createRequire(import.meta.url);
const childProcess =
  require("node:child_process") as typeof import("node:child_process");
const originalExecFileSync = childProcess.execFileSync;
const originalSpawnSync = childProcess.spawnSync;

afterEach(() => {
  childProcess.execFileSync = originalExecFileSync;
  childProcess.spawnSync = originalSpawnSync;
  syncBuiltinESMExports();
});

/** Build the EPERM error shape Node returns when spawnSync cannot launch bash. */
function spawnEperm(): NodeJS.ErrnoException {
  const error = new Error("spawnSync bash EPERM") as NodeJS.ErrnoException;
  error.code = "EPERM";
  error.errno = -1;
  error.syscall = "spawnSync bash";
  error.path = "bash";
  return error;
}

/** Build the contradictory EPERM fixture that also carries a completed status. */
function completedEperm(): NodeJS.ErrnoException & { status: number } {
  const error = spawnEperm() as NodeJS.ErrnoException & { status: number };
  error.status = 0;
  return error;
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

  function installedGuardrailContent(
    hooksDir: string,
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
            denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.sh",
            readDenyCoversSecrets: false,
          },
        }),
      ],
      fs: stubFS({
        readFile: installedGuardrailContent(".codex/hooks", templates),
        listDir: (path) =>
          path === ".codex/hooks" ? ["deny-dangerous.sh"] : [],
      }),
    });

    const result = denyCheck.run(ctx);
    assert.ok(result, "expected child-process spawn failure");
    assert.match(result.message, /could not spawn bash \(EPERM:/);
    assert.doesNotMatch(result.message, /bash -n failed/);
    assert.match(
      result.howToFix ?? "",
      /outside the child-process-restricted sandbox/,
    );
  });

  it("reports self-test spawn denial instead of a deny-dangerous failure", () => {
    assert.ok(denyCheck, "agent deny check should exist");
    const templates = guardrailTemplates();
    childProcess.execFileSync = ((command, args) => {
      if (Array.isArray(args) && args[0] === "-n") return Buffer.from("");
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
            denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.sh",
            readDenyCoversSecrets: false,
          },
        }),
      ],
      fs: stubFS({
        readFile: installedGuardrailContent(".codex/hooks", templates),
        listDir: (path) =>
          path === ".codex/hooks" ? ["deny-dangerous.sh"] : [],
      }),
    });

    const result = denyCheck.run(ctx);
    assert.ok(result, "expected self-test spawn failure");
    assert.match(
      result.message,
      /deny-dangerous self-test for codex could not spawn bash \(EPERM:/,
    );
    assert.doesNotMatch(result.message, /self-test=smoke failed/);
  });

  it("runs self-test with the selected agent dispatcher in GOAT_DENY_DANGEROUS_HOOK", () => {
    assert.ok(denyCheck, "agent deny check should exist");
    const templates = guardrailTemplates();
    let capturedEnv: NodeJS.ProcessEnv | undefined;
    childProcess.execFileSync = ((command, args, options) => {
      if (command === "bash" && Array.isArray(args) && args[0] === "-n") {
        return Buffer.from("");
      }
      if (
        command === "bash" &&
        Array.isArray(args) &&
        args[1] === "--self-test=smoke"
      ) {
        capturedEnv = (options as { env?: NodeJS.ProcessEnv }).env;
        return Buffer.from("");
      }
      return Buffer.from("");
    }) as typeof childProcess.execFileSync;
    childProcess.spawnSync = (() =>
      ({
        status: 2,
        signal: null,
        error: undefined,
        output: [
          null,
          "",
          "BLOCKED: Policy repository: git push is not allowed.",
        ],
        pid: 0,
        stdout: "",
        stderr: "BLOCKED: Policy repository: git push is not allowed.",
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
            denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.sh",
            readDenyCoversSecrets: false,
          },
        }),
      ],
      fs: stubFS({
        readFile: installedGuardrailContent(".codex/hooks", templates),
        listDir: (path) =>
          path === ".codex/hooks" ? ["deny-dangerous.sh"] : [],
      }),
    });

    assert.equal(denyCheck.run(ctx), null);
    assert.equal(
      capturedEnv?.GOAT_DENY_DANGEROUS_HOOK,
      resolve(PROJECT_ROOT, ".goat-flow/hooks/deny-dangerous.sh"),
    );
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
            denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.sh",
            readDenyCoversSecrets: false,
          },
        }),
      ],
      fs: stubFS({
        readFile: installedGuardrailContent(".codex/hooks", templates, {
          ".codex/hooks.json": JSON.stringify({
            hooks: {
              PreToolUse: [
                {
                  matcher: "Bash",
                  hooks: [
                    {
                      type: "command",
                      command: ".goat-flow/hooks/deny-dangerous.sh",
                    },
                  ],
                },
              ],
            },
          }),
        }),
        listDir: (path) =>
          path === ".codex/hooks" ? ["deny-dangerous.sh"] : [],
      }),
    });

    const result = denyCheck.run(ctx);
    assert.ok(result, "expected configured-command spawn failure");
    assert.match(
      result.message,
      /configured hook command for deny-dangerous\.sh could not spawn bash \(EPERM:/,
    );
    assert.doesNotMatch(result.message, /exit -1/);
  });

  it("ignores sandbox error metadata when hook commands completed", () => {
    assert.ok(denyCheck, "agent deny check should exist");
    const templates = guardrailTemplates();
    childProcess.execFileSync = (() => {
      throw completedEperm();
    }) as typeof childProcess.execFileSync;
    childProcess.spawnSync = (() =>
      ({
        status: 2,
        signal: null,
        error: spawnEperm(),
        output: [
          null,
          "",
          "BLOCKED: Policy repository: git push is not allowed.",
        ],
        pid: 0,
        stdout: "",
        stderr: "BLOCKED: Policy repository: git push is not allowed.",
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
            denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.sh",
            readDenyCoversSecrets: false,
          },
        }),
      ],
      fs: stubFS({
        readFile: installedGuardrailContent(".codex/hooks", templates, {
          ".codex/hooks.json": JSON.stringify({
            hooks: {
              PreToolUse: [
                {
                  matcher: "Bash",
                  hooks: [
                    {
                      type: "command",
                      command: ".goat-flow/hooks/deny-dangerous.sh",
                    },
                  ],
                },
              ],
            },
          }),
        }),
        listDir: (path) =>
          path === ".codex/hooks" ? ["deny-dangerous.sh"] : [],
      }),
    });

    assert.equal(denyCheck.run(ctx), null);
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
            denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.sh",
            readDenyCoversSecrets: false,
          },
        }),
      ],
      fs: stubFS({
        readFile: installedGuardrailContent(".codex/hooks", templates, {
          ".codex/hooks.json": JSON.stringify({
            hooks: {
              PreToolUse: [
                {
                  matcher: "Bash",
                  hooks: [
                    {
                      type: "command",
                      command: ".goat-flow/hooks/deny-dangerous.sh",
                    },
                  ],
                },
              ],
            },
          }),
        }),
        listDir: (path) =>
          path === ".codex/hooks" ? ["deny-dangerous.sh"] : [],
      }),
    });

    const result = denyCheck.run(ctx);
    assert.ok(result, "expected nested-cwd configured command failure");
    assert.match(
      result.message,
      /configured hook command exited before deny-dangerous\.sh could start from \.goat-flow \(exit 127\)/,
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
            denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.sh",
            readDenyCoversSecrets: false,
          },
        }),
      ],
      fs: stubFS({
        readFile: installedGuardrailContent(".codex/hooks", templates, {
          ".codex/hooks.json": JSON.stringify({
            hooks: {
              PreToolUse: [
                {
                  matcher: "Bash",
                  hooks: [
                    {
                      type: "command",
                      command:
                        "bash -lc 'exit 127' # .goat-flow/hooks/deny-dangerous.sh",
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
        readFile: installedGuardrailContent(".codex/hooks", templates, {
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

  function installedGuardrailContent(
    hooksDir: string,
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

  it("fails when an exact configured hook command points at a stale path", () => {
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
            denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.sh",
            readDenyCoversSecrets: false,
          },
        }),
      ],
      fs: stubFS({
        readFile: installedGuardrailContent(".codex/hooks", templates, {
          ".codex/hooks.json": JSON.stringify({
            hooks: {
              PreToolUse: [
                {
                  matcher: "Bash",
                  hooks: [
                    {
                      type: "command",
                      command: ".codex/hooks/stale-deny-dangerous.sh",
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
            denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.sh",
            readDenyCoversSecrets: false,
          },
        }),
      ],
      fs: stubFS({
        readFile: installedGuardrailContent(".codex/hooks", templates, {
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

  it("fails when a configured hook command points at a legacy per-agent mirror", () => {
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
            denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.sh",
            readDenyCoversSecrets: false,
          },
        }),
      ],
      fs: stubFS({
        readFile: installedGuardrailContent(".codex/hooks", templates, {
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

  function installedGuardrailContent(
    hooksDir: string,
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
        readFile: installedGuardrailContent(".claude/hooks", templates, {
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

  function installedGuardrailContent(
    hooksDir: string,
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
        readFile: installedGuardrailContent(".claude/hooks", templates, {
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

  function installedGuardrailContent(
    hooksDir: string,
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
        readFile: installedGuardrailContent(".github/hooks", templates),
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

  function installedGuardrailContent(
    hooksDir: string,
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
        readFile: installedGuardrailContent(".claude/hooks", templates),
      }),
    });
    assert.equal(denyCheck.run(ctx), null);
  });
});
