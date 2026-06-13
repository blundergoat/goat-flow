/**
 * Hook fact extraction for secret coverage: recognising current deny-hook secret coverage from the generalized
 * path matcher, while not counting self-test-only secret probes as real Bash secret coverage.
 */
import {
  PROJECT_ROOT,
  STUB_AGENT_PROFILE,
  assert,
  describe,
  extractHookFacts,
  extractHookFactsForDenyContent,
  it,
  readFileSync,
  resolve,
  stubFS,
} from "./helpers.js";
import {
  buildDenyRegistration,
  buildHookRegistration,
  extractSkillFacts,
  readHookConfig,
} from "../../src.js";

/** Extract hook facts from the packaged deny hook plus its shared pattern libraries. */
function extractPackagedDenyHookFacts(): ReturnType<typeof extractHookFacts> {
  const gitTemplate = readFileSync(
    resolve(PROJECT_ROOT, "workflow/hooks/deny-dangerous.sh"),
    "utf8",
  );
  const secretTemplate = readFileSync(
    resolve(PROJECT_ROOT, "workflow/hooks/deny-dangerous/patterns-paths.sh"),
    "utf8",
  );
  const destructiveTemplate = readFileSync(
    resolve(PROJECT_ROOT, "workflow/hooks/deny-dangerous/patterns-shell.sh"),
    "utf8",
  );
  const fs = stubFS({
    exists: (path) =>
      [
        ".goat-flow/hooks/deny-dangerous.sh",
        ".goat-flow/hooks/deny-dangerous/patterns-shell.sh",
        ".goat-flow/hooks/deny-dangerous/patterns-paths.sh",
        ".goat-flow/hooks/deny-dangerous/patterns-writes.sh",
        ".goat-flow/hooks/deny-dangerous/deny-dangerous-self-test.sh",
      ].includes(path),
    readFile: (path) => {
      if (path === ".goat-flow/hooks/deny-dangerous/patterns-shell.sh") {
        return destructiveTemplate;
      }
      if (path === ".goat-flow/hooks/deny-dangerous/patterns-paths.sh") {
        return secretTemplate;
      }
      if (path === ".goat-flow/hooks/deny-dangerous.sh") {
        return gitTemplate;
      }
      return null;
    },
  });
  return extractHookFacts(fs, STUB_AGENT_PROFILE, {}, true, true);
}

describe("hook fact extraction", () => {
  it("derives hook registration and skill facts from agent-owned surfaces", () => {
    const fs = stubFS({
      exists: (path) =>
        path === ".claude/settings.json" ||
        path === ".claude/skills/goat/SKILL.md",
      readJson: (path) =>
        path === ".claude/settings.json"
          ? {
              hooks: {
                Stop: [{ hooks: [{ command: ".claude/hooks/post-turn.sh" }] }],
                PreToolUse: [
                  {
                    hooks: [{ command: ".goat-flow/hooks/deny-dangerous.sh" }],
                  },
                ],
              },
            }
          : null,
      readFile: (path) =>
        path === ".claude/skills/goat/SKILL.md"
          ? "---\nname: goat\ngoat-flow-skill-version: 1.9.0\n---\n# goat\n"
          : null,
      listDir: (path) => (path === ".claude/skills" ? ["goat"] : []),
    });
    const hookConfig = {
      hooks: {
        Stop: [{ hooks: [{ command: ".claude/hooks/post-turn.sh" }] }],
        PreToolUse: [
          { hooks: [{ command: ".goat-flow/hooks/deny-dangerous.sh" }] },
        ],
      },
    };
    const config = readHookConfig(fs, STUB_AGENT_PROFILE, hookConfig, true);

    assert.equal(config.valid, true);
    assert.deepEqual(buildHookRegistration(STUB_AGENT_PROFILE, config.parsed), {
      postTurnRegistered: true,
      postTurnRegisteredPath: ".claude/hooks/post-turn.sh",
    });
    assert.deepEqual(buildDenyRegistration(STUB_AGENT_PROFILE, config.parsed), {
      denyIsRegistered: true,
      denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.sh",
    });
    assert.equal(extractSkillFacts(fs, STUB_AGENT_PROFILE).hasDispatcher, true);
  });

  it("normalizes root-resolving hook launcher commands", () => {
    const config = {
      hooks: {
        PreToolUse: [
          {
            hooks: [
              {
                command:
                  'bash -c \'root="$(git rev-parse --show-toplevel 2>/dev/null || true)"; [ -f "$root/.goat-flow/hooks/deny-dangerous.sh" ] || exit 2; cd "$root" || exit 2; bash "$root/.goat-flow/hooks/deny-dangerous.sh"\'',
              },
            ],
          },
        ],
      },
    };

    assert.deepEqual(buildDenyRegistration(STUB_AGENT_PROFILE, config), {
      denyIsRegistered: true,
      denyRegisteredPath: ".goat-flow/hooks/deny-dangerous.sh",
    });
  });

  it("detects Antigravity top-level Stop hook registrations", () => {
    const antigravityProfile = {
      ...STUB_AGENT_PROFILE,
      id: "antigravity" as const,
      hookConfigFile: ".agents/hooks.json",
      settingsFile: null,
    };
    const config = {
      "post-turn-safety": {
        enabled: true,
        Stop: [
          {
            hooks: [
              {
                command:
                  'bash -c \'root="$(git rev-parse --show-toplevel 2>/dev/null || true)"; bash "$root/.goat-flow/hooks/post-turn-safety.sh"\'',
              },
            ],
          },
        ],
      },
    };

    assert.deepEqual(buildHookRegistration(antigravityProfile, config), {
      postTurnRegistered: true,
      postTurnRegisteredPath: ".goat-flow/hooks/post-turn-safety.sh",
    });
  });

  it("prefers safety over unrelated scripts when multiple Stop hooks are registered", () => {
    const config = {
      hooks: {
        Stop: [
          {
            hooks: [
              {
                command: ".goat-flow/hooks/other-stop.sh",
              },
            ],
          },
          {
            hooks: [
              {
                command: ".goat-flow/hooks/post-turn-safety.sh",
              },
            ],
          },
        ],
      },
    };

    assert.deepEqual(buildHookRegistration(STUB_AGENT_PROFILE, config), {
      postTurnRegistered: true,
      postTurnRegisteredPath: ".goat-flow/hooks/post-turn-safety.sh",
    });
  });

  it("prefers safety over the plan checkbox guard in either Stop order", () => {
    for (const stopEntries of [
      [
        {
          hooks: [
            {
              command: ".goat-flow/hooks/plan-checkbox-guard.sh",
            },
          ],
        },
        {
          hooks: [
            {
              command: ".goat-flow/hooks/post-turn-safety.sh",
            },
          ],
        },
      ],
      [
        {
          hooks: [
            {
              command: ".goat-flow/hooks/post-turn-safety.sh",
            },
          ],
        },
        {
          hooks: [
            {
              command: ".goat-flow/hooks/plan-checkbox-guard.sh",
            },
          ],
        },
      ],
    ]) {
      assert.deepEqual(
        buildHookRegistration(STUB_AGENT_PROFILE, {
          hooks: { Stop: stopEntries },
        }),
        {
          postTurnRegistered: true,
          postTurnRegisteredPath: ".goat-flow/hooks/post-turn-safety.sh",
        },
      );
    }
  });

  it("does not count a guard-only Stop registration as post-turn safety or validation", () => {
    const config = {
      hooks: {
        Stop: [
          {
            hooks: [
              {
                command: ".goat-flow/hooks/plan-checkbox-guard.sh",
              },
            ],
          },
        ],
      },
    };

    assert.deepEqual(buildHookRegistration(STUB_AGENT_PROFILE, config), {
      postTurnRegistered: false,
      postTurnRegisteredPath: null,
    });
  });

  it("prefers Antigravity safety when plan guard is registered first", () => {
    const antigravityProfile = {
      ...STUB_AGENT_PROFILE,
      id: "antigravity" as const,
      hookConfigFile: ".agents/hooks.json",
      settingsFile: null,
    };
    const config = {
      "plan-checkbox-guard": {
        enabled: true,
        Stop: [
          {
            hooks: [
              {
                command: ".goat-flow/hooks/plan-checkbox-guard.sh",
              },
            ],
          },
        ],
      },
      "post-turn-safety": {
        enabled: true,
        Stop: [
          {
            hooks: [
              {
                command: ".goat-flow/hooks/post-turn-safety.sh",
              },
            ],
          },
        ],
      },
    };

    assert.deepEqual(buildHookRegistration(antigravityProfile, config), {
      postTurnRegistered: true,
      postTurnRegisteredPath: ".goat-flow/hooks/post-turn-safety.sh",
    });
  });

  it("detects safety-only Stop hook registrations without validation evidence", () => {
    const settings = {
      hooks: {
        Stop: [
          {
            hooks: [
              {
                command: ".goat-flow/hooks/post-turn-safety.sh",
              },
            ],
          },
        ],
      },
    };
    const fs = stubFS({
      exists: (path) =>
        path === ".goat-flow/hooks/post-turn-safety.sh" ||
        path === STUB_AGENT_PROFILE.hookConfigFile,
      readFile: (path) =>
        path === ".goat-flow/hooks/post-turn-safety.sh"
          ? [
              "#!/usr/bin/env bash",
              "printf 'post-turn-safety: ok\\n' >&2",
              "",
            ].join("\n")
          : null,
      isExecutable: (path) => path === ".goat-flow/hooks/post-turn-safety.sh",
    });

    const facts = extractHookFacts(
      fs,
      STUB_AGENT_PROFILE,
      settings,
      true,
      true,
    );

    assert.equal(facts.postTurnRegistered, true);
    assert.equal(
      facts.postTurnRegisteredPath,
      ".goat-flow/hooks/post-turn-safety.sh",
    );
    assert.equal(facts.postTurnExists, true);
    assert.equal(facts.postTurnExecutable, true);
    assert.equal(facts.postTurnHasValidation, false);
  });

  it("counts custom test-only post-turn hooks as validation", () => {
    const settings = {
      hooks: {
        Stop: [
          {
            hooks: [
              {
                command: ".goat-flow/hooks/custom-post-turn.sh",
              },
            ],
          },
        ],
      },
    };
    const fs = stubFS({
      exists: (path) =>
        path === ".goat-flow/hooks/custom-post-turn.sh" ||
        path === STUB_AGENT_PROFILE.hookConfigFile,
      readFile: (path) =>
        path === ".goat-flow/hooks/custom-post-turn.sh"
          ? ["#!/usr/bin/env bash", "run_command 'npm run test:fast'", ""].join(
              "\n",
            )
          : null,
      isExecutable: (path) => path === ".goat-flow/hooks/custom-post-turn.sh",
    });

    const facts = extractHookFacts(
      fs,
      STUB_AGENT_PROFILE,
      settings,
      true,
      true,
    );

    assert.equal(facts.postTurnRegistered, true);
    assert.equal(
      facts.postTurnRegisteredPath,
      ".goat-flow/hooks/custom-post-turn.sh",
    );
    assert.equal(facts.postTurnExists, true);
    assert.equal(facts.postTurnExecutable, true);
    assert.equal(facts.postTurnHasValidation, true);
  });

  it("detects validation commands that mask failure with || true", () => {
    const settings = {
      hooks: {
        Stop: [
          {
            hooks: [
              {
                command: ".goat-flow/hooks/custom-post-turn.sh",
              },
            ],
          },
        ],
      },
    };
    const fs = stubFS({
      exists: (path) => path === ".goat-flow/hooks/custom-post-turn.sh",
      readFile: (path) =>
        path === ".goat-flow/hooks/custom-post-turn.sh"
          ? [
              "#!/usr/bin/env bash",
              "run_command 'npm run test:fast || true'",
              "",
            ].join("\n")
          : null,
    });

    const facts = extractHookFacts(
      fs,
      STUB_AGENT_PROFILE,
      settings,
      true,
      true,
    );

    assert.equal(facts.postTurnHasValidation, true);
    assert.equal(facts.postTurnSwallowsFailures, true);
  });

  it("detects current deny hook secret coverage from generalized path matcher", () => {
    const facts = extractPackagedDenyHookFacts();
    assert.equal(facts.bashDenyCoversSecrets, true);
  });

  it("does not count self-test-only secret probes as Bash secret coverage", () => {
    const facts = extractHookFactsForDenyContent(`
run_self_test() {
  run_case "cat .env" "cat .env" 2
  run_case "cat ./.env" "cat ./.env" 2
  run_case "cat ../.env" "cat ../.env" 2
  run_case "cat .env.example" "cat .env.example" 0
  run_case "cat ssh key" "cat ~/.ssh/id_rsa" 2
  run_case "cat relative ssh key" "cat .ssh/id_rsa" 2
  run_case "cat aws credentials" "cat ~/.aws/credentials" 2
  run_case "cat relative aws credentials" "cat .aws/credentials" 2
  run_case "cat secrets token" "cat secrets/token.txt" 2
  run_case "cat credentials.json" "cat credentials.json" 2
  run_case "xxd pem" "xxd server.pem" 2
}
`);
    assert.equal(facts.bashDenyCoversSecrets, false);
  });
});
