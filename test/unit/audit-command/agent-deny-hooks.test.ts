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
        resolve(PROJECT_ROOT, "workflow/hooks/hook-lib/patterns-shell.sh"),
        "utf-8",
      ),
      paths: readFileSync(
        resolve(PROJECT_ROOT, "workflow/hooks/hook-lib/patterns-paths.sh"),
        "utf-8",
      ),
      writes: readFileSync(
        resolve(PROJECT_ROOT, "workflow/hooks/hook-lib/patterns-writes.sh"),
        "utf-8",
      ),
      selfTest: readFileSync(
        resolve(
          PROJECT_ROOT,
          "workflow/hooks/hook-lib/deny-dangerous-self-test.sh",
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
      [`${hooksDir}/deny-dangerous.sh`]: templates.dispatcher,
      ".goat-flow/hook-lib/patterns-shell.sh": templates.shell,
      ".goat-flow/hook-lib/patterns-paths.sh": templates.paths,
      ".goat-flow/hook-lib/patterns-writes.sh": templates.writes,
      ".goat-flow/hook-lib/deny-dangerous-self-test.sh": templates.selfTest,
    };
    /** Resolve installed hook content from overrides before template defaults. */
    const readInstalledGuardrail = (path: string) => {
      if (Object.hasOwn(overrides, path)) return overrides[path] ?? null;
      return files[path] ?? null;
    };
    return readInstalledGuardrail;
  }

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
            denyRegisteredPath: ".codex/hooks/deny-dangerous.sh",
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
                        "bash -lc 'exit 127' # .codex/hooks/deny-dangerous.sh",
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
    assert.match(result.message, /does not name an exact guard script path/);
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
        resolve(PROJECT_ROOT, "workflow/hooks/hook-lib/patterns-shell.sh"),
        "utf-8",
      ),
      paths: readFileSync(
        resolve(PROJECT_ROOT, "workflow/hooks/hook-lib/patterns-paths.sh"),
        "utf-8",
      ),
      writes: readFileSync(
        resolve(PROJECT_ROOT, "workflow/hooks/hook-lib/patterns-writes.sh"),
        "utf-8",
      ),
      selfTest: readFileSync(
        resolve(
          PROJECT_ROOT,
          "workflow/hooks/hook-lib/deny-dangerous-self-test.sh",
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
      [`${hooksDir}/deny-dangerous.sh`]: templates.dispatcher,
      ".goat-flow/hook-lib/patterns-shell.sh": templates.shell,
      ".goat-flow/hook-lib/patterns-paths.sh": templates.paths,
      ".goat-flow/hook-lib/patterns-writes.sh": templates.writes,
      ".goat-flow/hook-lib/deny-dangerous-self-test.sh": templates.selfTest,
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
            denyRegisteredPath: ".codex/hooks/deny-dangerous.sh",
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
            denyRegisteredPath: ".codex/hooks/deny-dangerous.sh",
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
                        'root="/missing-goat-flow-root"; bash "$root/.codex/hooks/deny-dangerous.sh"',
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
    assert.match(result.message, /configured hook script exited 127/);
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
        resolve(PROJECT_ROOT, "workflow/hooks/hook-lib/patterns-shell.sh"),
        "utf-8",
      ),
      paths: readFileSync(
        resolve(PROJECT_ROOT, "workflow/hooks/hook-lib/patterns-paths.sh"),
        "utf-8",
      ),
      writes: readFileSync(
        resolve(PROJECT_ROOT, "workflow/hooks/hook-lib/patterns-writes.sh"),
        "utf-8",
      ),
      selfTest: readFileSync(
        resolve(
          PROJECT_ROOT,
          "workflow/hooks/hook-lib/deny-dangerous-self-test.sh",
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
      [`${hooksDir}/deny-dangerous.sh`]: templates.dispatcher,
      ".goat-flow/hook-lib/patterns-shell.sh": templates.shell,
      ".goat-flow/hook-lib/patterns-paths.sh": templates.paths,
      ".goat-flow/hook-lib/patterns-writes.sh": templates.writes,
      ".goat-flow/hook-lib/deny-dangerous-self-test.sh": templates.selfTest,
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
          ".claude/hooks/deny-dangerous.sh": `${templates.dispatcher}\n# local drift\n`,
        }),
      }),
    });
    const result = denyCheck.run(ctx);
    assert.ok(result, "expected hook version drift failure");
    assert.match(result.message, /differs from the current goat-flow template/);
    assert.equal(result.evidence, ".claude/hooks/deny-dangerous.sh");
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
        resolve(PROJECT_ROOT, "workflow/hooks/hook-lib/patterns-shell.sh"),
        "utf-8",
      ),
      paths: readFileSync(
        resolve(PROJECT_ROOT, "workflow/hooks/hook-lib/patterns-paths.sh"),
        "utf-8",
      ),
      writes: readFileSync(
        resolve(PROJECT_ROOT, "workflow/hooks/hook-lib/patterns-writes.sh"),
        "utf-8",
      ),
      selfTest: readFileSync(
        resolve(
          PROJECT_ROOT,
          "workflow/hooks/hook-lib/deny-dangerous-self-test.sh",
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
      [`${hooksDir}/deny-dangerous.sh`]: templates.dispatcher,
      ".goat-flow/hook-lib/patterns-shell.sh": templates.shell,
      ".goat-flow/hook-lib/patterns-paths.sh": templates.paths,
      ".goat-flow/hook-lib/patterns-writes.sh": templates.writes,
      ".goat-flow/hook-lib/deny-dangerous-self-test.sh": templates.selfTest,
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
          ".goat-flow/hook-lib/deny-dangerous-self-test.sh": null,
        }),
      }),
    });
    const result = denyCheck.run(ctx);
    assert.ok(result, "expected missing self-test sibling failure");
    assert.match(result.message, /deny-dangerous-self-test\.sh is missing/);
    assert.equal(
      result.evidence,
      ".goat-flow/hook-lib/deny-dangerous-self-test.sh",
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
        resolve(PROJECT_ROOT, "workflow/hooks/hook-lib/patterns-shell.sh"),
        "utf-8",
      ),
      paths: readFileSync(
        resolve(PROJECT_ROOT, "workflow/hooks/hook-lib/patterns-paths.sh"),
        "utf-8",
      ),
      writes: readFileSync(
        resolve(PROJECT_ROOT, "workflow/hooks/hook-lib/patterns-writes.sh"),
        "utf-8",
      ),
      selfTest: readFileSync(
        resolve(
          PROJECT_ROOT,
          "workflow/hooks/hook-lib/deny-dangerous-self-test.sh",
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
      [`${hooksDir}/deny-dangerous.sh`]: templates.dispatcher,
      ".goat-flow/hook-lib/patterns-shell.sh": templates.shell,
      ".goat-flow/hook-lib/patterns-paths.sh": templates.paths,
      ".goat-flow/hook-lib/patterns-writes.sh": templates.writes,
      ".goat-flow/hook-lib/deny-dangerous-self-test.sh": templates.selfTest,
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
            denyRegisteredPath: ".github/hooks/deny-dangerous.sh",
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
        resolve(PROJECT_ROOT, "workflow/hooks/hook-lib/patterns-shell.sh"),
        "utf-8",
      ),
      paths: readFileSync(
        resolve(PROJECT_ROOT, "workflow/hooks/hook-lib/patterns-paths.sh"),
        "utf-8",
      ),
      writes: readFileSync(
        resolve(PROJECT_ROOT, "workflow/hooks/hook-lib/patterns-writes.sh"),
        "utf-8",
      ),
      selfTest: readFileSync(
        resolve(
          PROJECT_ROOT,
          "workflow/hooks/hook-lib/deny-dangerous-self-test.sh",
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
      [`${hooksDir}/deny-dangerous.sh`]: templates.dispatcher,
      ".goat-flow/hook-lib/patterns-shell.sh": templates.shell,
      ".goat-flow/hook-lib/patterns-paths.sh": templates.paths,
      ".goat-flow/hook-lib/patterns-writes.sh": templates.writes,
      ".goat-flow/hook-lib/deny-dangerous-self-test.sh": templates.selfTest,
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
