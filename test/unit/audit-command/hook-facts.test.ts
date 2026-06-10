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
