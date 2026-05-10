import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  discoverArtifacts,
  evaluateContent,
  evaluateUploadedBundle,
  findArtifact,
  scoreArtifact,
  scoreAllArtifacts,
  type SkillQualityReport,
} from "../../src/cli/quality/skill-quality.js";
import {
  cloneQualityConfig,
  DEFAULT_QUALITY_CONFIG,
} from "../../src/cli/quality/quality-config.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const SNAPSHOT_FIXTURE = resolve(
  PROJECT_ROOT,
  "test/fixtures/skill-quality/expected-scores.json",
);

function makeTempProject(): string {
  return mkdtempSync(join(tmpdir(), "goat-flow-skill-quality-"));
}

function writeText(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function writeSkill(projectRoot: string, name: string, content: string): void {
  writeText(join(projectRoot, ".claude/skills", name, "SKILL.md"), content);
}

describe("artifact discovery", () => {
  it("discovers installed skills from .claude/skills/", () => {
    const artifacts = discoverArtifacts(PROJECT_ROOT);
    const skills = artifacts.filter((a) => a.kind === "skill");
    assert.ok(
      skills.length >= 7,
      `expected at least 7 skills, got ${skills.length}`,
    );
    assert.ok(skills.some((s) => s.id === "skill:goat-plan"));
    assert.ok(skills.some((s) => s.id === "skill:goat-review"));
  });

  it("discovers shared references and playbooks", () => {
    const artifacts = discoverArtifacts(PROJECT_ROOT);
    const refs = artifacts.filter((a) => a.kind === "shared-reference");
    assert.ok(refs.some((r) => r.id === "reference:browser-use"));
    assert.ok(refs.some((r) => r.id === "reference:page-capture"));
    assert.ok(refs.some((r) => r.id === "reference:skill-quality-testing"));
  });

  it("excludes README.md from references", () => {
    const artifacts = discoverArtifacts(PROJECT_ROOT);
    assert.ok(!artifacts.some((a) => a.name === "README"));
  });

  it("finds a specific artifact by id", () => {
    const artifact = findArtifact(PROJECT_ROOT, "skill:goat-plan");
    assert.ok(artifact);
    assert.equal(artifact.kind, "skill");
    assert.equal(artifact.name, "goat-plan");
  });

  it("returns null for unknown artifact id", () => {
    const artifact = findArtifact(PROJECT_ROOT, "skill:nonexistent");
    assert.equal(artifact, null);
  });

  it("aggregates mirrored skills without duplicate artifact rows", () => {
    const artifacts = discoverArtifacts(PROJECT_ROOT);
    const goatArtifacts = artifacts.filter((a) => a.id === "skill:goat");
    assert.equal(goatArtifacts.length, 1);
    assert.ok(
      goatArtifacts[0].mirrorPaths?.includes(".agents/skills/goat/SKILL.md"),
    );
    assert.ok(
      goatArtifacts[0].mirrorPaths?.includes(".github/skills/goat/SKILL.md"),
    );
    assert.ok(
      goatArtifacts[0].mirrorPaths?.includes("workflow/skills/goat/SKILL.md"),
    );
    assert.deepEqual(goatArtifacts[0].missingMirrors, []);
  });

  it("represents agent-mirror-only skills with missing mirror metadata", () => {
    const projectRoot = makeTempProject();
    writeText(
      join(projectRoot, ".agents/skills/foo/SKILL.md"),
      [
        "---",
        "name: foo",
        'description: "Mirror-only skill."',
        'goat-flow-skill-version: "1.6.0"',
        "---",
        "# /foo",
      ].join("\n"),
    );
    const artifacts = discoverArtifacts(projectRoot).filter(
      (artifact) => artifact.id === "skill:foo",
    );
    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0].path, ".agents/skills/foo/SKILL.md");
    assert.deepEqual(artifacts[0].mirrorPaths, []);
    assert.deepEqual(artifacts[0].missingMirrors, [
      ".claude/skills/foo/SKILL.md",
      ".github/skills/foo/SKILL.md",
      "workflow/skills/foo/SKILL.md",
    ]);
  });

  it("skips symlink entries in skill walk roots", () => {
    const projectRoot = makeTempProject();
    mkdirSync(join(projectRoot, ".claude/skills/real"), { recursive: true });
    writeFileSync(
      join(projectRoot, ".claude/skills/real/SKILL.md"),
      [
        "---",
        "name: real",
        'description: "Real skill."',
        'goat-flow-skill-version: "1.6.0"',
        "---",
        "# /real",
      ].join("\n"),
    );
    symlinkSync(
      join(projectRoot, ".claude/skills/real"),
      join(projectRoot, ".claude/skills/link"),
    );
    const artifacts = discoverArtifacts(projectRoot);
    assert.ok(artifacts.some((artifact) => artifact.id === "skill:real"));
    assert.ok(!artifacts.some((artifact) => artifact.id === "skill:link"));
  });

  it("counts skill-local references from the references directory", () => {
    const projectRoot = makeTempProject();
    writeSkill(
      projectRoot,
      "ref-count",
      [
        "---",
        "name: ref-count",
        'description: "Skill with local references."',
        'goat-flow-skill-version: "1.6.0"',
        "---",
        "# /ref-count",
        "## When to Use",
        "Use when counting references.",
      ].join("\n"),
    );
    writeText(
      join(projectRoot, ".claude/skills/ref-count/references/one.md"),
      "# One\n",
    );
    writeText(
      join(projectRoot, ".claude/skills/ref-count/references/two.md"),
      "# Two\n",
    );
    writeText(
      join(projectRoot, ".claude/skills/ref-count/references/three.md"),
      "# Three\n",
    );
    const artifact = findArtifact(projectRoot, "skill:ref-count")!;
    const report = scoreArtifact(projectRoot, artifact);
    const tokenCost = report.metrics.find((m) => m.metric === "token-cost")!;
    assert.match(tokenCost.detail, /3 sub-reference\(s\)/);
  });
});

describe("skill scoring", () => {
  let goatPlanReport: SkillQualityReport;

  it("scores goat-plan with a keep-skill recommendation", () => {
    const artifact = findArtifact(PROJECT_ROOT, "skill:goat-plan")!;
    goatPlanReport = scoreArtifact(PROJECT_ROOT, artifact);

    assert.equal(goatPlanReport.artifact.id, "skill:goat-plan");
    assert.equal(goatPlanReport.recommendation, "keep-skill");
    assert.ok(goatPlanReport.totalScore > 0, "expected a positive total score");
    assert.ok(
      goatPlanReport.maxTotalScore > 0,
      "expected a positive max total score",
    );
  });

  it("goat-plan has high trigger clarity", () => {
    const artifact = findArtifact(PROJECT_ROOT, "skill:goat-plan")!;
    const report = scoreArtifact(PROJECT_ROOT, artifact);
    const trigger = report.metrics.find((m) => m.metric === "trigger-clarity")!;
    assert.ok(trigger);
    assert.ok(
      trigger.score >= 10,
      `expected trigger score >= 10, got ${trigger.score}`,
    );
  });

  it("goat-plan has complete workflow", () => {
    const artifact = findArtifact(PROJECT_ROOT, "skill:goat-plan")!;
    const report = scoreArtifact(PROJECT_ROOT, artifact);
    const workflow = report.metrics.find(
      (m) => m.metric === "workflow-completeness",
    )!;
    assert.ok(workflow);
    assert.ok(
      workflow.score >= 10,
      `expected workflow score >= 10, got ${workflow.score}`,
    );
  });

  it("goat-plan has strong skill-reference fit", () => {
    const artifact = findArtifact(PROJECT_ROOT, "skill:goat-plan")!;
    const report = scoreArtifact(PROJECT_ROOT, artifact);
    const fit = report.metrics.find((m) => m.metric === "skill-reference-fit")!;
    assert.ok(fit);
    assert.ok(fit.score >= 7, `expected fit score >= 7, got ${fit.score}`);
  });

  it("composes inherited skill references for composed metrics only", () => {
    const artifact = findArtifact(PROJECT_ROOT, "skill:goat-plan")!;
    const report = scoreArtifact(PROJECT_ROOT, artifact);
    assert.deepEqual(report.composedFrom, [
      "skill-preamble.md",
      "skill-conventions.md",
      "SKILL.md",
      "references/milestone-examples.md",
      "references/issue-format.md",
    ]);
    const evidence = report.metrics.find(
      (m) => m.metric === "evidence-testability",
    )!;
    assert.equal(evidence.score, evidence.maxScore);
  });

  it("skips missing skill-local references during composition", () => {
    const projectRoot = makeTempProject();
    writeSkill(
      projectRoot,
      "missing-ref",
      [
        "---",
        "name: missing-ref",
        'description: "Skill with a missing reference."',
        'goat-flow-skill-version: "1.6.0"',
        "---",
        "# /missing-ref",
        "See references/missing.md.",
      ].join("\n"),
    );
    const artifact = findArtifact(projectRoot, "skill:missing-ref")!;
    const report = scoreArtifact(projectRoot, artifact);
    assert.deepEqual(report.composedFrom, ["SKILL.md"]);
  });

  it("does not compose skill-local references outside the references directory", () => {
    const projectRoot = makeTempProject();
    writeSkill(
      projectRoot,
      "escaped-ref",
      [
        "---",
        "name: escaped-ref",
        'description: "Skill with an escaped reference."',
        'goat-flow-skill-version: "1.6.0"',
        "---",
        "# /escaped-ref",
        "See references/../../leak.md.",
      ].join("\n"),
    );
    writeText(
      join(projectRoot, ".claude/skills/leak.md"),
      "# Leaked\n\n## Availability Check\ncommand -v leaked-tool\n",
    );
    const artifact = findArtifact(projectRoot, "skill:escaped-ref")!;
    const report = scoreArtifact(projectRoot, artifact);
    assert.deepEqual(report.composedFrom, ["SKILL.md"]);
  });

  it("surfaces composition truncation when inherited context exceeds 32KB", () => {
    const projectRoot = makeTempProject();
    writeText(
      join(projectRoot, ".goat-flow/skill-reference/skill-preamble.md"),
      `# Preamble\n${"Proof Gate evidence.\n".repeat(2500)}`,
    );
    writeSkill(
      projectRoot,
      "huge-compose",
      [
        "---",
        "name: huge-compose",
        'description: "Skill with huge inherited context."',
        'goat-flow-skill-version: "1.6.0"',
        "---",
        "# /huge-compose",
        "## When to Use",
        "Use when testing composition caps.",
      ].join("\n"),
    );
    const artifact = findArtifact(projectRoot, "skill:huge-compose")!;
    const report = scoreArtifact(projectRoot, artifact);
    assert.ok(report.fitNotes.includes("composition truncated at 32KB"));
  });

  it("enforces composed content caps by UTF-8 byte length", () => {
    const projectRoot = makeTempProject();
    const config = cloneQualityConfig(DEFAULT_QUALITY_CONFIG);
    config.composition.maxComposedBytes = 1024;
    config.composition.skillPreamblePath = null;
    config.composition.skillConventionsPath = null;
    const content = [
      "---",
      "name: utf8-compose",
      'description: "Skill with multibyte composed content."',
      'goat-flow-skill-version: "1.6.0"',
      "---",
      "# /utf8-compose",
      "## When to Use",
      "Use when testing byte caps.",
      "語".repeat(400),
    ].join("\n");
    assert.ok(content.length < config.composition.maxComposedBytes);
    assert.ok(
      Buffer.byteLength(content, "utf-8") > config.composition.maxComposedBytes,
    );
    writeSkill(projectRoot, "utf8-compose", content);

    const artifact = findArtifact(projectRoot, "skill:utf8-compose", config)!;
    const report = scoreArtifact(projectRoot, artifact, config);
    assert.ok(report.fitNotes.includes("composition truncated at 1KB"));
  });

  it("enforces uploaded bundle composition caps by UTF-8 byte length", () => {
    const projectRoot = makeTempProject();
    const config = cloneQualityConfig(DEFAULT_QUALITY_CONFIG);
    config.composition.maxComposedBytes = 1024;
    config.composition.skillPreamblePath = null;
    config.composition.skillConventionsPath = null;
    const siblingContent = "語".repeat(400);
    assert.ok(siblingContent.length < config.composition.maxComposedBytes);
    assert.ok(
      Buffer.byteLength(siblingContent, "utf-8") >
        config.composition.maxComposedBytes,
    );

    const report = evaluateUploadedBundle(
      projectRoot,
      {
        files: [
          {
            name: "SKILL.md",
            content: [
              "---",
              "name: utf8-upload",
              'description: "Uploaded skill."',
              'goat-flow-skill-version: "1.6.0"',
              "---",
              "# /utf8-upload",
              "## When to Use",
              "Use when testing byte caps.",
            ].join("\n"),
          },
          { name: "notes.md", content: siblingContent },
        ],
      },
      config,
    );
    assert.ok(report.fitNotes.includes("composition truncated at 1KB"));
  });

  it("caps oversized artifact content and surfaces a fit note", () => {
    const projectRoot = makeTempProject();
    writeSkill(
      projectRoot,
      "oversized",
      [
        "---",
        "name: oversized",
        'description: "Oversized skill."',
        'goat-flow-skill-version: "1.6.0"',
        "---",
        "# /oversized",
        "## When to Use",
        "Use when testing artifact caps.",
        "## Step 0",
        "Read context.",
        "## Phase 1",
        "Proof Gate evidence.",
        "## Phase 2",
        "CHECKPOINT before acting.",
        "## Verification",
        "- [ ] pass/fail evidence required.",
        "x".repeat(300 * 1024),
      ].join("\n"),
    );
    const artifact = findArtifact(projectRoot, "skill:oversized")!;
    const report = scoreArtifact(projectRoot, artifact);
    assert.ok(
      report.fitNotes.includes("artifact truncated at 262144 bytes"),
      report.fitNotes.join("\n"),
    );
  });

  it("does not let preamble composition give raw workflow credit", () => {
    const artifact = findArtifact(PROJECT_ROOT, "skill:goat")!;
    const report = scoreArtifact(PROJECT_ROOT, artifact);
    const workflow = report.metrics.find(
      (m) => m.metric === "workflow-completeness",
    )!;
    assert.equal(report.subtype, "dispatcher");
    assert.equal(workflow.maxScore, 5);
    assert.equal(workflow.score, 5);
  });

  it("detects artifact subtypes and profile maxes", () => {
    const cases = [
      ["skill:goat", "dispatcher", 70],
      ["skill:goat-plan", "workflow", 100],
      ["skill:goat-security", "report", 85],
      ["reference:browser-use", "playbook", 80],
      ["reference:skill-preamble", "meta", 50],
      ["reference:skill-quality-testing", "index", 60],
    ] as const;
    for (const [id, subtype, profileMax] of cases) {
      const artifact = findArtifact(PROJECT_ROOT, id)!;
      const report = scoreArtifact(PROJECT_ROOT, artifact);
      assert.equal(report.subtype, subtype, id);
      assert.equal(report.profileMax, profileMax, id);
      assert.equal(report.maxTotalScore, profileMax, id);
    }
  });
});

describe("reference scoring", () => {
  it("scores browser-use.md as reference-playbook", () => {
    const artifact = findArtifact(PROJECT_ROOT, "reference:browser-use")!;
    const report = scoreArtifact(PROJECT_ROOT, artifact);

    assert.equal(report.artifact.kind, "shared-reference");
    assert.equal(report.recommendation, "reference-playbook");
  });

  it("scores page-capture.md as reference-playbook", () => {
    const artifact = findArtifact(PROJECT_ROOT, "reference:page-capture")!;
    const report = scoreArtifact(PROJECT_ROOT, artifact);

    assert.equal(report.artifact.kind, "shared-reference");
    assert.equal(report.recommendation, "reference-playbook");
  });

  it("browser-use.md has availability check credit", () => {
    const artifact = findArtifact(PROJECT_ROOT, "reference:browser-use")!;
    const report = scoreArtifact(PROJECT_ROOT, artifact);
    const trigger = report.metrics.find((m) => m.metric === "trigger-clarity")!;
    assert.ok(
      trigger.score >= 10,
      `expected trigger score >= 10 for browser-use, got ${trigger.score}`,
    );
  });

  it("scores shared references without preamble composition", () => {
    const artifact = findArtifact(PROJECT_ROOT, "reference:browser-use")!;
    const report = scoreArtifact(PROJECT_ROOT, artifact);
    assert.deepEqual(report.composedFrom, ["browser-use.md"]);
  });

  it("keeps meta references as reference-playbook without promotion notes", () => {
    for (const id of [
      "reference:skill-preamble",
      "reference:skill-conventions",
      "reference:skill-quality-testing",
    ]) {
      const artifact = findArtifact(PROJECT_ROOT, id)!;
      const report = scoreArtifact(PROJECT_ROOT, artifact);
      assert.equal(report.recommendation, "reference-playbook", id);
      assert.ok(!report.fitNotes.join("\n").includes("promoting"), id);
    }
  });
});

describe("gate vocabulary", () => {
  function gateScoreFor(content: string): number {
    const projectRoot = makeTempProject();
    writeSkill(projectRoot, "gate-vocab", content);
    const artifact = findArtifact(projectRoot, "skill:gate-vocab")!;
    const report = scoreArtifact(projectRoot, artifact);
    return report.metrics.find((m) => m.metric === "gate-quality")!.score;
  }

  function frontmatterSkill(body: string): string {
    return [
      "---",
      "name: gate-vocab",
      'description: "Skill exercising one gate-vocabulary pattern."',
      'goat-flow-skill-version: "1.6.0"',
      "---",
      "# /gate-vocab",
      "## When to Use",
      "Use when testing gate vocabulary.",
      "NOT this skill: unrelated work.",
      "## Step 0",
      "Read context.",
      "## Phase 1",
      "Do work.",
      body,
    ].join("\n");
  }

  const VERIFICATION_GATE_PATTERNS = [
    ["verification gate literal", "## Verification gate\nReview before merge."],
    ["exit criteria literal", "## Exit criteria\nDo not proceed until..."],
    ["testing gate literal", "## Testing gate\nMust pass all checks."],
    [
      "Proof Gate literal",
      "## Phase 2\nApply Proof Gate before claiming done.",
    ],
    [
      "BLOCKING GATE literal",
      "## Verification\nBLOCKING GATE: human approves before merge.",
    ],
    ["CHECKPOINT literal", "## Phase 2\nCHECKPOINT before continuing."],
    ["plain checklist", "## Verification\n- [ ] step done\n- [ ] evidence ok"],
  ] as const;

  for (const [label, body] of VERIFICATION_GATE_PATTERNS) {
    it(`recognises ${label} as a verification-gate signal`, () => {
      const score = gateScoreFor(frontmatterSkill(body));
      assert.ok(
        score >= 5,
        `expected gate score >= 5 (verification-gate band) for ${label}, got ${score}`,
      );
    });
  }

  const EXPLICIT_PASS_PATTERNS = [
    [
      "pass/fail literal",
      "## Verification\nBLOCKING GATE: enforce pass/fail criteria for every claim.",
    ],
    ["exit on literal", "## Verification\nCHECKPOINT exit on green build."],
    [
      "must pass literal",
      "## Verification\nBLOCKING GATE: tests must pass before merge.",
    ],
    [
      "evidence required literal",
      "## Verification\nCHECKPOINT: cited evidence required for every claim.",
    ],
  ] as const;

  for (const [label, body] of EXPLICIT_PASS_PATTERNS) {
    it(`recognises ${label} as an explicit-pass signal`, () => {
      const score = gateScoreFor(frontmatterSkill(body));
      assert.ok(
        score >= 8,
        `expected gate score >= 8 (verification + explicit-pass) for ${label}, got ${score}`,
      );
    });
  }

  const HUMAN_STOP_PATTERNS = [
    [
      "Human Verification phrase",
      "## Verification\nMust pass Human Verification.",
    ],
    [
      "approval phrase",
      "## Verification\nMust pass before stakeholder approval.",
    ],
  ] as const;

  for (const [label, body] of HUMAN_STOP_PATTERNS) {
    it(`recognises ${label} as a human-stop signal`, () => {
      const score = gateScoreFor(frontmatterSkill(body));
      assert.ok(
        score >= 10,
        `expected gate score >= 10 (full credit) for ${label}, got ${score}`,
      );
    });
  }

  it("keeps goat-plan at 10/10 gate quality (regression guard)", () => {
    const artifact = findArtifact(PROJECT_ROOT, "skill:goat-plan")!;
    const report = scoreArtifact(PROJECT_ROOT, artifact);
    const gate = report.metrics.find((m) => m.metric === "gate-quality")!;
    assert.equal(gate.score, gate.maxScore);
    assert.equal(gate.score, 10);
  });
});

describe("recommendation gates", () => {
  it("forces needs-human-review when an applicable metric scores zero", () => {
    const projectRoot = makeTempProject();
    writeSkill(
      projectRoot,
      "zero-gate",
      [
        "---",
        "name: zero-gate",
        'description: "Skill with structure but no gates."',
        'goat-flow-skill-version: "1.6.0"',
        "---",
        "# /zero-gate",
        "## When to Use",
        "Use when testing zero gates.",
        "NOT this skill: references.",
        "## Step 0",
        "Gather context.",
        "## Phase 1",
        "Do work.",
        "## Phase 2",
        "Do more work.",
        "## Phase 3",
        "Finish work.",
      ].join("\n"),
    );
    const artifact = findArtifact(projectRoot, "skill:zero-gate")!;
    const report = scoreArtifact(projectRoot, artifact);
    assert.equal(report.recommendation, "needs-human-review");
    assert.ok(
      report.fitNotes.some((note) => note.includes("scored 0/")),
      report.fitNotes.join("\n"),
    );
  });

  it("retires very low quality skills before demoting them", () => {
    const projectRoot = makeTempProject();
    writeSkill(projectRoot, "empty", "# /empty\n");
    const artifact = findArtifact(projectRoot, "skill:empty")!;
    const report = scoreArtifact(projectRoot, artifact);
    assert.equal(report.recommendation, "retire");
  });

  it("recommends revision for moderate skills without zero-metric failures", () => {
    const projectRoot = makeTempProject();
    writeSkill(
      projectRoot,
      "moderate",
      [
        "---",
        "name: moderate",
        'description: "Moderate skill."',
        'goat-flow-skill-version: "1.6.0"',
        "---",
        "# /moderate",
        "## When to Use",
        "Use when checking recommendation bands.",
        "## Read First",
        "Read context before acting.",
        "## Step 0",
        "Gather context.",
        "## Phase 1",
        "Do work.",
        "## Phase 2",
        "Prepare evidence.",
        "## Verification",
        "- [ ] evidence required.",
      ].join("\n"),
    );
    const artifact = findArtifact(projectRoot, "skill:moderate")!;
    const report = scoreArtifact(projectRoot, artifact);
    assert.equal(report.recommendation, "consider-revision");
    assert.ok(
      report.metrics.every(
        (metric) => metric.maxScore === 0 || metric.score > 0,
      ),
    );
  });

  it("does not score prose phrase 'which milestone' as tool handling", () => {
    const projectRoot = makeTempProject();
    writeSkill(
      projectRoot,
      "which-prose",
      [
        "---",
        "name: which-prose",
        'description: "Skill with prose only."',
        'goat-flow-skill-version: "1.6.0"',
        "---",
        "# /which-prose",
        "## When to Use",
        "Use when deciding which milestone comes next.",
        "NOT this skill: tool checks.",
        "## Step 0",
        "Read context.",
        "## Phase 1",
        "CHECKPOINT before work.",
        "## Phase 2",
        "Finish.",
        "## Verification",
        "- [ ] Evidence required.",
      ].join("\n"),
    );
    const artifact = findArtifact(projectRoot, "skill:which-prose")!;
    const report = scoreArtifact(projectRoot, artifact);
    const tool = report.metrics.find((m) => m.metric === "tool-deps")!;
    assert.equal(tool.score, 10);
  });

  it("scores explicit command availability and fallback as handled tool dependency", () => {
    const projectRoot = makeTempProject();
    writeSkill(
      projectRoot,
      "tool-skill",
      [
        "---",
        "name: tool-skill",
        'description: "Skill with a tool dependency."',
        'goat-flow-skill-version: "1.6.0"',
        "---",
        "# /tool-skill",
        "## When to Use",
        "Use when testing tools.",
        "NOT this skill: no tools.",
        "## Step 0",
        "Run `command -v browser-use`.",
        "## Phase 1",
        "Availability Check: confirm browser-use exists.",
        "## Phase 2",
        "Fallback: ask for manual browser evidence if unavailable.",
        "## Verification",
        "- [ ] pass/fail evidence required.",
      ].join("\n"),
    );
    const artifact = findArtifact(projectRoot, "skill:tool-skill")!;
    const report = scoreArtifact(projectRoot, artifact);
    const tool = report.metrics.find((m) => m.metric === "tool-deps")!;
    assert.ok(tool.score >= 8, `expected tool score >= 8, got ${tool.score}`);
  });

  it("inherits tool dependency handling from a referenced playbook", () => {
    const projectRoot = makeTempProject();
    writeSkill(
      projectRoot,
      "playbook-delegator",
      [
        "---",
        "name: playbook-delegator",
        'description: "Skill that delegates tool checks."',
        'goat-flow-skill-version: "1.6.0"',
        "---",
        "# /playbook-delegator",
        "## When to Use",
        "Use when exercising browser actions.",
        "NOT this skill: unrelated work.",
        "## Step 0",
        "Read references/browser-use.md before acting.",
        "## Phase 1",
        "Do browser work.",
        "## Phase 2",
        "Verify evidence.",
        "## Verification",
        "- [ ] pass/fail evidence required.",
      ].join("\n"),
    );
    writeText(
      join(
        projectRoot,
        ".claude/skills/playbook-delegator/references/browser-use.md",
      ),
      [
        "# Browser Use",
        "## Availability Check",
        "Run `command -v browser-use`.",
        "Fallback: capture manual browser evidence if unavailable.",
      ].join("\n"),
    );
    const artifact = findArtifact(projectRoot, "skill:playbook-delegator")!;
    const report = scoreArtifact(projectRoot, artifact);
    const tool = report.metrics.find((m) => m.metric === "tool-deps")!;
    assert.ok(tool.score >= 8, `expected tool score >= 8, got ${tool.score}`);
    assert.ok(report.composedFrom.includes("references/browser-use.md"));
  });

  it("uses unique IDs when shared-reference basenames exist in both roots", () => {
    const projectRoot = makeTempProject();
    writeText(
      join(projectRoot, ".goat-flow/skill-reference/browser-use.md"),
      "# Legacy Browser Use\n",
    );
    writeText(
      join(projectRoot, ".goat-flow/skill-playbooks/browser-use.md"),
      "# Browser Use\n\n## Availability Check\ncommand -v browser-use\n",
    );

    const refs = discoverArtifacts(projectRoot).filter(
      (artifact) =>
        artifact.kind === "shared-reference" && artifact.name === "browser-use",
    );
    assert.equal(refs.length, 2);
    assert.equal(new Set(refs.map((artifact) => artifact.id)).size, 2);
    assert.ok(
      refs.some((artifact) =>
        artifact.id.includes("goat-flow-skill-reference"),
      ),
    );
    assert.ok(
      refs.some((artifact) =>
        artifact.id.includes("goat-flow-skill-playbooks"),
      ),
    );
  });
});

describe("uploaded shared-reference evaluation", () => {
  it("uses the skill-playbooks path for single uploaded shared references", () => {
    const report = evaluateContent(PROJECT_ROOT, {
      content: "# Lefthook\n\n## Availability Check\ncommand -v lefthook\n",
      suggestedName: "lefthook.md",
      kind: "shared-reference",
    });

    assert.equal(
      report.artifact.path,
      ".goat-flow/skill-playbooks/lefthook.md",
    );
  });

  it("uses the skill-playbooks path for uploaded shared-reference bundles", () => {
    const report = evaluateUploadedBundle(PROJECT_ROOT, {
      files: [
        {
          name: "lefthook.md",
          content: "# Lefthook\n\n## Availability Check\ncommand -v lefthook\n",
        },
      ],
      suggestedName: "lefthook",
      kind: "shared-reference",
    });

    assert.equal(
      report.artifact.path,
      ".goat-flow/skill-playbooks/lefthook.md",
    );
  });
});

describe("classification", () => {
  it("returns confidence 1.0 for unambiguous goat-flow skills", () => {
    const artifact = findArtifact(PROJECT_ROOT, "skill:goat-plan")!;
    const report = scoreArtifact(PROJECT_ROOT, artifact);
    assert.equal(report.classification.detectedSubtype, "workflow");
    assert.equal(report.classification.confidence, 1);
    assert.equal(report.classification.alternatives.length, 0);
  });

  it("surfaces alternatives for the dispatcher skill", () => {
    const artifact = findArtifact(PROJECT_ROOT, "skill:goat")!;
    const report = scoreArtifact(PROJECT_ROOT, artifact);
    assert.equal(report.classification.detectedSubtype, "dispatcher");
    assert.ok(report.classification.confidence >= 0.7);
    assert.ok(report.classification.alternatives.length >= 1);
  });

  it("triggers consider-reclassifying when structure is high but confidence < 0.7", () => {
    const projectRoot = makeTempProject();
    writeSkill(
      projectRoot,
      "ambiguous",
      [
        "---",
        "name: ambiguous",
        'description: "Skill with conflicting subtype signals."',
        'goat-flow-skill-version: "1.6.0"',
        "---",
        "# /ambiguous",
        "## When to Use",
        "Use when testing classification.",
        "NOT this skill: clear-shape skills.",
        "## Route Map",
        "Routes to other skills.",
        "## Quick Scan Path",
        "Audit mode review.",
        "## Constraints",
        "Read-Only mode default; ask for approval before File-Write.",
        "skill-preamble required; Read First the conventions.",
        "Apply Proof Gate per skill-preamble. OBSERVED evidence required.",
        "## Verification",
        "BLOCKING GATE: pass/fail evidence required at every CHECKPOINT.",
        '(search: "needle") for semantic anchors.',
      ].join("\n"),
    );
    const artifact = findArtifact(projectRoot, "skill:ambiguous")!;
    const report = scoreArtifact(projectRoot, artifact);
    assert.ok(
      report.classification.confidence < 0.7,
      `expected confidence < 0.7, got ${report.classification.confidence}`,
    );
    assert.ok(
      report.totalScore / report.profileMax >= 0.7,
      `expected structurePct >= 0.7, got ${report.totalScore}/${report.profileMax}`,
    );
    assert.equal(report.recommendation, "consider-reclassifying");
    assert.ok(
      report.fitNotes.some((note) =>
        note.includes("classification confidence"),
      ),
      report.fitNotes.join("\n"),
    );
  });

  it("includes classification reasoning in every report", () => {
    const artifact = findArtifact(PROJECT_ROOT, "skill:goat")!;
    const report = scoreArtifact(PROJECT_ROOT, artifact);
    assert.ok(report.classification.reasoning.length > 0);
    assert.ok(
      report.classification.reasoning[0].startsWith("detected dispatcher"),
    );
  });
});

describe("scoreAllArtifacts", () => {
  it("scores all discovered artifacts without error", () => {
    const reports = scoreAllArtifacts(PROJECT_ROOT);
    assert.ok(
      reports.length >= 10,
      `expected at least 10 artifacts, got ${reports.length}`,
    );
    for (const report of reports) {
      assert.ok(report.totalScore >= 0);
      assert.ok(report.maxTotalScore > 0);
      assert.ok(report.metrics.length > 0);
      assert.ok(report.recommendation);
    }
  });

  it("matches the committed percentage-band snapshot", () => {
    const fixture = JSON.parse(
      readFileSync(SNAPSHOT_FIXTURE, "utf-8"),
    ) as Record<
      string,
      {
        minPct: number;
        maxPct: number;
        recommendation: string;
        subtype: string;
      }
    >;
    const reportsById = new Map(
      scoreAllArtifacts(PROJECT_ROOT).map((report) => [
        report.artifact.id,
        report,
      ]),
    );
    for (const [id, expected] of Object.entries(fixture)) {
      const report = reportsById.get(id);
      assert.ok(report, `missing report for ${id}`);
      const pct = Math.round((report.totalScore / report.profileMax) * 100);
      assert.ok(
        pct >= expected.minPct && pct <= expected.maxPct,
        `${id}: expected ${expected.minPct}-${expected.maxPct}%, got ${pct}%`,
      );
      assert.equal(report.recommendation, expected.recommendation, id);
      assert.equal(report.subtype, expected.subtype, id);
      assert.ok(
        report.totalScore <= report.profileMax,
        `${id}: totalScore ${report.totalScore} > profileMax ${report.profileMax}`,
      );
    }
  });
});

describe("metric completeness", () => {
  it("every report has exactly 9 metrics", () => {
    const reports = scoreAllArtifacts(PROJECT_ROOT);
    for (const report of reports) {
      assert.equal(
        report.metrics.length,
        9,
        `${report.artifact.id} has ${report.metrics.length} metrics, expected 9`,
      );
    }
  });

  it("metric scores do not exceed their maxScore", () => {
    const reports = scoreAllArtifacts(PROJECT_ROOT);
    for (const report of reports) {
      for (const m of report.metrics) {
        assert.ok(
          m.score <= m.maxScore,
          `${report.artifact.id} metric ${m.metric}: score ${m.score} > maxScore ${m.maxScore}`,
        );
        assert.ok(
          m.score >= 0,
          `${report.artifact.id} metric ${m.metric}: negative score ${m.score}`,
        );
      }
    }
  });

  it("totalScore equals sum of metric scores", () => {
    const reports = scoreAllArtifacts(PROJECT_ROOT);
    for (const report of reports) {
      const sum = report.metrics.reduce((s, m) => s + m.score, 0);
      assert.equal(
        report.totalScore,
        sum,
        `${report.artifact.id}: totalScore ${report.totalScore} != sum ${sum}`,
      );
      assert.equal(
        report.maxTotalScore,
        report.profileMax,
        `${report.artifact.id}: maxTotalScore ${report.maxTotalScore} != profileMax ${report.profileMax}`,
      );
    }
  });
});

describe("workflow-summary description detection (M10 §4)", () => {
  function buildSkillMd(description: string): string {
    return [
      "---",
      "name: t",
      `description: "${description}"`,
      "goat-flow-skill-version: 1.6.0",
      "---",
      "# /t",
      "",
      "**NOT this skill:** other.",
      "",
      "## Step 0",
      "",
      "## Phase 1",
      "",
      "## Phase 2",
      "",
      "## Verification",
    ].join("\n");
  }

  it("flags a workflow-summary description as a yellow signal", () => {
    // Sourced verbatim from prime corpus (writing-skills/SKILL.md, search:
    // "Testing revealed that when a description summarizes"). The "between
    // tasks" + "dispatches" pair is the canonical bad shape.
    const result = evaluateContent(PROJECT_ROOT, {
      content: buildSkillMd(
        "Use when executing plans - dispatches subagent per task with code review between tasks",
      ),
      suggestedName: "t",
      kind: "skill",
    });
    const tc = result.metrics.find((m) => m.metric === "trigger-clarity");
    assert.ok(tc, "trigger-clarity metric must exist");
    assert.match(tc.detail, /summarizes workflow/);
    const tip = result.tips.find((t) => /Workflow summaries/.test(t.message));
    assert.ok(tip, "workflow-summary improvement tip must fire");
  });

  it("does not deduct score from a fully-structured skill (yellow signal only)", () => {
    const result = evaluateContent(PROJECT_ROOT, {
      content: buildSkillMd(
        "Use when executing plans - dispatches subagent per task with code review between tasks",
      ),
      suggestedName: "t",
      kind: "skill",
    });
    const tc = result.metrics.find((m) => m.metric === "trigger-clarity");
    assert.ok(tc);
    assert.equal(tc.score, 15, "trigger-clarity should remain at full score");
    assert.equal(tc.severity, "ok", "severity should remain ok");
  });

  it("does not flag well-formed trigger-only descriptions", () => {
    const goodDescriptions = [
      "Use when starting a non-trivial implementation that needs structured task breakdown with progress tracking.",
      "Use when diagnosing a bug, unexpected behaviour, or system failure that needs structured investigation.",
      "Use when assessing security implications of code changes, architecture decisions, or new features.",
      "Use when a decision or analysis needs multi-lens critique to surface blind spots before shipping.",
    ];
    for (const desc of goodDescriptions) {
      const result = evaluateContent(PROJECT_ROOT, {
        content: buildSkillMd(desc),
        suggestedName: "t",
        kind: "skill",
      });
      const tc = result.metrics.find((m) => m.metric === "trigger-clarity");
      assert.ok(tc);
      assert.doesNotMatch(
        tc.detail,
        /summarizes workflow/,
        `false positive for: ${desc}`,
      );
    }
  });

  it("FP rate stays under 10% on the in-tree .claude/skills corpus", () => {
    const reports = scoreAllArtifacts(PROJECT_ROOT);
    const installedSkills = reports.filter(
      (r) => r.artifact.kind === "skill" && r.artifact.source === "installed",
    );
    assert.ok(
      installedSkills.length > 0,
      "expected at least one installed skill in the corpus",
    );
    let flagged = 0;
    for (const r of installedSkills) {
      const tc = r.metrics.find((m) => m.metric === "trigger-clarity");
      if (tc && /summarizes workflow/.test(tc.detail)) flagged += 1;
    }
    const pct = (flagged / installedSkills.length) * 100;
    assert.ok(
      pct < 10,
      `workflow-summary detector FP rate ${pct.toFixed(1)}% breaches the 10% budget on .claude/skills`,
    );
  });
});
