/**
 * Unit coverage for the read-only skill doctor report and renderers.
 * Use these fixtures to prove users receive static path, frontmatter, mirror,
 * invocation, and remediation evidence without relying on a model runtime.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AgentProfile, ReadonlyFS } from "../../src/cli/types.js";
import {
  renderSkillDoctorJson,
  renderSkillDoctorText,
  runSkillDoctor,
  type CanonicalSkillRead,
} from "../../src/cli/skill-doctor.js";
import { AUDIT_VERSION } from "../../src/cli/constants.js";

const CODEX_PROFILE: AgentProfile = {
  id: "codex",
  name: "Codex",
  instructionFile: "AGENTS.md",
  terminalBinary: "codex",
  setupSurfaces: ["AGENTS.md", ".codex/config.toml", ".codex/hooks.json"],
  promptInvocationStyle: "dollar",
  skillSource: "agent-mirror",
  supportsPostTurnHook: false,
  settingsFile: ".codex/config.toml",
  hookConfigFile: ".codex/hooks.json",
  skillsDir: ".agents/skills",
  hooksDir: ".goat-flow/hooks",
  denyMechanism: null,
  denyHookFile: ".goat-flow/hooks/deny-dangerous.sh",
  localPattern: ".github/instructions/*.md",
  hookEvents: null,
};

/**
 * Build a complete in-memory read-only filesystem for doctor fixtures.
 * Use when a test needs exact missing/readable behavior without touching disk.
 */
function createMemoryFS(files: Readonly<Record<string, string>>): ReadonlyFS {
  return {
    exists: (path) => Object.hasOwn(files, path),
    readFile: (path) => files[path] ?? null,
    lineCount: (path) => files[path]?.split("\n").length ?? 0,
    readJson: () => null,
    isReadableDirectory: () => true,
    listDir: () => [],
    isExecutable: () => false,
    glob: () => [],
    existsGlob: () => false,
  };
}

/**
 * Create one canonical skill read function from path-keyed fixture text.
 * Use to make source presence and mirror comparisons explicit in each test.
 */
function createCanonicalReader(
  files: Readonly<Record<string, string>>,
): (sourcePath: string) => CanonicalSkillRead {
  return (sourcePath) => {
    const content = files[sourcePath];

    // An absent fixture models a package that cannot provide the canonical skill.
    if (content === undefined) return { state: "missing", content: null };
    return { state: "readable", content };
  };
}

/**
 * Render valid discovery frontmatter for one user-invocable skill fixture.
 * Use when a test needs to vary only the command name or trigger description.
 */
function skillMarkdown(
  name: string,
  description = `Use when running ${name}.`,
): string {
  return `---\nname: ${name}\ndescription: "${description}"\ngoat-flow-skill-version: "${AUDIT_VERSION}"\n---\n# ${name}\n`;
}

/** Run a Codex-only doctor fixture over the supplied canonical skill names. */
function runCodexFixture(
  installedFiles: Readonly<Record<string, string>>,
  canonicalFiles: Readonly<Record<string, string>>,
  canonicalSkillNames: readonly string[],
  skillFilter: string | null = null,
) {
  return runSkillDoctor({
    projectPath: "/project",
    fs: createMemoryFS(installedFiles),
    agentProfiles: [CODEX_PROFILE],
    canonicalSkillNames,
    skillFilter,
    readCanonicalSkill: createCanonicalReader(canonicalFiles),
  });
}

describe("skill doctor", () => {
  it("reports a present, matching skill as statically eligible", () => {
    const markdown = skillMarkdown("goat", "Use when routing a user request.");
    const report = runCodexFixture(
      { ".agents/skills/goat/SKILL.md": markdown },
      { "workflow/skills/goat/SKILL.md": markdown },
      ["goat"],
    );
    const skill = report.agents[0]?.skills[0];

    assert.ok(skill);
    assert.equal(report.status, "pass");
    assert.equal(report.summary.eligible, 1);
    assert.equal(skill.invocation, "$goat");
    assert.equal(skill.installedPath, ".agents/skills/goat/SKILL.md");
    assert.equal(skill.mirrorStatus, "match");
    assert.equal(skill.frontmatter.status, "valid");
    assert.equal(skill.staticEligibility, "eligible");
    assert.deepEqual(skill.blockingReasons, []);
  });

  it("explains a missing installed mirror and points at existing repair commands", () => {
    const markdown = skillMarkdown("goat");
    const report = runCodexFixture(
      {},
      { "workflow/skills/goat/SKILL.md": markdown },
      ["goat"],
    );
    const skill = report.agents[0]?.skills[0];

    assert.ok(skill);
    assert.equal(report.status, "fail");
    assert.equal(skill.installedState, "missing");
    assert.match(
      skill.blockingReasons.join("\n"),
      /installed SKILL\.md is missing/i,
    );
    assert.match(
      skill.remediation.join("\n"),
      /goat-flow install <project-path> --agent codex/,
    );
    assert.match(
      skill.remediation.join("\n"),
      /audit <project-path> --agent codex --check-drift/,
    );
  });

  it("blocks malformed frontmatter with the installed path in evidence", () => {
    const malformed = "---\nname: [\n---\n# broken\n";
    const report = runCodexFixture(
      { ".agents/skills/goat/SKILL.md": malformed },
      { "workflow/skills/goat/SKILL.md": skillMarkdown("goat") },
      ["goat"],
    );
    const skill = report.agents[0]?.skills[0];

    assert.ok(skill);
    assert.equal(skill.frontmatter.status, "invalid-yaml");
    assert.equal(skill.staticEligibility, "blocked");
    assert.match(
      skill.blockingReasons.join("\n"),
      /frontmatter cannot be parsed/i,
    );
  });

  /** Fixture covers duplicate identities attaching collision evidence to both canonical rows. */
  it("blocks both installed skills when their frontmatter claims one command name", () => {
    const goatMarkdown = skillMarkdown("goat");
    const duplicateMarkdown = skillMarkdown("goat", "Use when debugging.");

    const report = runCodexFixture(
      {
        ".agents/skills/goat/SKILL.md": goatMarkdown,
        ".agents/skills/goat-debug/SKILL.md": duplicateMarkdown,
      },
      {
        "workflow/skills/goat/SKILL.md": goatMarkdown,
        "workflow/skills/goat-debug/SKILL.md": skillMarkdown("goat-debug"),
      },
      ["goat", "goat-debug"],
    );

    assert.equal(report.status, "fail");
    assert.equal(report.summary.blocked, 2);
    assert.equal(
      report.agents[0]?.skills.every((skill) =>
        skill.blockingReasons.some((reason) =>
          /duplicate installed frontmatter name/i.test(reason),
        ),
      ),
      true,
    );
  });

  /** Fixture covers a focused --skill run against a collision owned by ANOTHER skill's mirror. */
  it("still flags a duplicate command name when the doctor is filtered to one skill", () => {
    const goatMarkdown = skillMarkdown("goat");
    const duplicateMarkdown = skillMarkdown("goat", "Use when debugging.");

    const report = runCodexFixture(
      {
        ".agents/skills/goat/SKILL.md": goatMarkdown,
        ".agents/skills/goat-debug/SKILL.md": duplicateMarkdown,
      },
      {
        "workflow/skills/goat/SKILL.md": goatMarkdown,
        "workflow/skills/goat-debug/SKILL.md": skillMarkdown("goat-debug"),
      },
      ["goat", "goat-debug"],
      "goat",
    );
    const skills = report.agents[0]?.skills ?? [];

    // Only the requested row is rendered, but its collision evidence names both paths.
    assert.equal(skills.length, 1);
    assert.equal(skills[0]?.canonicalName, "goat");
    assert.equal(skills[0]?.staticEligibility, "blocked");
    assert.match(
      skills[0]?.blockingReasons.join("\n") ?? "",
      /duplicate installed frontmatter name "goat"/i,
    );
    assert.match(
      skills[0]?.blockingReasons.join("\n") ?? "",
      /goat-debug\/SKILL\.md/,
    );
  });

  it("keeps mirror drift separate from static load eligibility", () => {
    const report = runCodexFixture(
      { ".agents/skills/goat/SKILL.md": skillMarkdown("goat") },
      {
        "workflow/skills/goat/SKILL.md": `${skillMarkdown("goat")}\nDifferent guidance.\n`,
      },
      ["goat"],
    );
    const skill = report.agents[0]?.skills[0];

    assert.ok(skill);
    assert.equal(report.status, "warn");
    assert.equal(skill.staticEligibility, "eligible");
    assert.equal(skill.mirrorStatus, "drift");
    assert.match(skill.warnings.join("\n"), /differs from canonical source/i);
  });

  it("renders parseable JSON and an explicit static-only text limit", () => {
    const markdown = skillMarkdown("goat");
    const report = runCodexFixture(
      { ".agents/skills/goat/SKILL.md": markdown },
      { "workflow/skills/goat/SKILL.md": markdown },
      ["goat"],
    );
    const json = JSON.parse(renderSkillDoctorJson(report)) as {
      status: string;
    };
    const text = renderSkillDoctorText(report);

    assert.equal(json.status, "pass");
    assert.match(text, /Static evidence only/i);
    assert.match(
      text,
      /PASS skill doctor: 1 checked · 1 eligible · 0 blocked · 0 warnings/,
    );
  });
});
