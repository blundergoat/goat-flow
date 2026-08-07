/**
 * Audit checks comparing installed agent deny hooks against the canonical templates
 * with stubbed filesystems: exact configured commands pointing at stale paths,
 * launcher-string bypasses, legacy per-agent mirrors, installed-template drift,
 * a missing shared self-test, the Copilot JSON runtime smoke, and the
 * exact-match pass case.
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

  it("ignores unrelated hooks whose names merely contain a managed script name", () => {
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
