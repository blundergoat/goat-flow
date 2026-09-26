/**
 * How the checker keeps a plan navigable: canonical sections, milestone IDs that match
 * filenames, and local dependencies that resolve without cycles.
 * Runs the real CLI against written milestone fixtures, so failures read as an author would
 * see them in a terminal rather than as internals.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROJECT_ROOT,
  runPlansCheck,
  assertSourceLabelledErrors,
  writeCheckFixture,
  writeCheckPlan,
  canonicalMilestoneBody,
} from "./plans-check.helpers.js";

type PlainLanguageHeadingStyle = "current" | "legacy" | null;

const PARALLEL_PLAN = join(
  PROJECT_ROOT,
  "test",
  "fixtures",
  "plans",
  "parallel-lanes",
);

describe("plans check: parallel lanes", () => {
  const cases = [
    { name: "disjoint lanes", lanes: ["go", "php"], cap: 2, errors: [] },
    {
      name: "one named lane collision",
      lanes: ["php", "php"],
      cap: 2,
      errors: ["error: plan: multiple active milestones in lane php: M18, M19"],
    },
    {
      name: "absent and empty lanes share default",
      lanes: [undefined, ""],
      cap: 3,
      errors: ["error: plan: multiple active milestones: M18, M19"],
    },
    {
      name: "explicit default joins the implicit lane",
      lanes: ["default", undefined],
      cap: 2,
      errors: ["error: plan: multiple active milestones: M18, M19"],
    },
    {
      name: "global overflow without collisions",
      lanes: ["go", "php", "rs"],
      cap: 2,
      errors: ["error: plan: active milestone cap 2 exceeded: M18, M19, M20"],
    },
    {
      name: "lane errors follow file order before the global cap",
      lanes: ["php", "go", "php", "go"],
      cap: 2,
      errors: [
        "error: plan: multiple active milestones in lane php: M18, M20",
        "error: plan: multiple active milestones in lane go: M19, M21",
        "error: plan: active milestone cap 2 exceeded: M18, M19, M20, M21",
      ],
    },
    {
      name: "cap one emits only its legacy error",
      lanes: ["php", "php", "go"],
      cap: 1,
      errors: ["error: plan: multiple active milestones: M18, M19, M20"],
    },
    {
      name: "invalid lanes count globally without a fabricated collision",
      lanes: ["Bad!", "Bad!", "go"],
      cap: 2,
      errors: ["error: plan: active milestone cap 2 exceeded: M18, M19, M20"],
    },
  ];
  for (const testCase of cases) {
    /** Writes a temporary scheduling snapshot and compares the author's exact ordered plan errors. */
    it(testCase.name, () => {
      const root = mkdtempSync(join(tmpdir(), "goat-flow-plan-lanes-"));
      try {
        const files: Record<string, string> = {};
        for (const [index, lane] of testCase.lanes.entries()) {
          const id = `M${18 + index}`;
          files[`${id}-fixture.md`] =
            canonicalMilestoneBody({
              title: `${id}: Active work`,
              status: "in-progress",
            }) + (lane === undefined ? "" : `\nLane: ${lane}\n`);
        }
        const result = runPlansCheck(
          writeCheckPlan(root, files),
          "--strict",
          "--max-active",
          String(testCase.cap),
        );
        assert.equal(
          result.status,
          testCase.errors.length > 0 ? 1 : 0,
          result.stdout + result.stderr,
        );
        assert.deepEqual(
          result.stdout
            .split("\n")
            .filter((line) => line.startsWith("error: plan:")),
          testCase.errors,
        );
        if (testCase.lanes.includes("Bad!")) {
          assert.match(
            result.stdout,
            /error: M18-fixture\.md: invalid Lane value;/u,
          );
          assert.match(
            result.stdout,
            /error: M19-fixture\.md: invalid Lane value;/u,
          );
          assert.match(
            result.stdout,
            /active: M18 \(in-progress\) \| lane: <invalid>/u,
          );
          assert.doesNotMatch(result.stdout, /Bad!/u);
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }

  /** Exercises the committed consumer fixture through both compatibility modes, without relying on ignored plans. */
  it("reports the consumer lanes before the effort summary in strict and default checks", () => {
    for (const flags of [[], ["--strict"]]) {
      const result = runPlansCheck(
        PARALLEL_PLAN,
        ...flags,
        "--max-active",
        "2",
      );
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(result.stderr, "");
      const lines = result.stdout.split("\n");
      assert.deepEqual(lines.slice(3, 6), [
        "active: M18 (in-progress) | lane: go",
        "active: M19 (in-progress) | lane: php",
        "plan: 2 active milestones (cap 2)",
      ]);
      assert.match(lines[6] ?? "", /^plan: 9 min estimated/u);
    }
    const legacy = runPlansCheck(
      PARALLEL_PLAN,
      "--strict",
      "--max-active",
      "1",
    );
    assert.equal(legacy.status, 1);
    assert.deepEqual(
      legacy.stdout.split("\n").filter((line) => line.startsWith("error:")),
      ["error: plan: multiple active milestones: M18, M19"],
    );
    assert.doesNotMatch(legacy.stdout, /^active:|\(cap /mu);
  });

  /** A second lane never satisfies a prerequisite that is still in progress. */
  it("keeps dependencies blocking across lanes while non-strict mode remains advisory", () => {
    const root = mkdtempSync(join(tmpdir(), "goat-flow-plan-lane-dependency-"));
    try {
      const files: Record<string, string> = {};
      for (const name of [
        "M17-shared-baseline.md",
        "M18-go-precision.md",
        "M19-php-precision.md",
      ]) {
        files[name] = readFileSync(join(PARALLEL_PLAN, name), "utf-8");
      }
      files["M19-php-precision.md"] = files["M19-php-precision.md"]!.replace(
        "Depends on: M17",
        "Depends on: M18",
      );
      const plan = writeCheckPlan(root, files);
      const strict = runPlansCheck(plan, "--strict", "--max-active", "2");
      assert.equal(strict.status, 1);
      assert.deepEqual(
        strict.stdout.split("\n").filter((line) => line.startsWith("error:")),
        [
          "error: M19-php-precision.md: active or complete milestone requires dependency M18 to be complete",
        ],
      );
      const advisory = runPlansCheck(plan, "--max-active", "2");
      assert.equal(advisory.status, 0, advisory.stdout + advisory.stderr);
      assert.doesNotMatch(advisory.stdout, /error:/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

const VALID_PROBLEM_STATEMENT =
  "Plan authors can leave reader-facing sections vague because no checker rejects them.";
const VALID_BENEFIT_STATEMENT =
  "You can fix unclear plan summaries before another person has to review them.";

/** Second-sentence openings that used to evade the uppercase-only boundary detector. */
const SECOND_SENTENCE_CASES = [
  {
    name: "lowercase",
    text: "another reviewer then misses the intended outcome.",
  },
  { name: "numeric", text: "2 reviewers then miss the intended outcome." },
  {
    name: "quoted",
    text: '"another reviewer" then misses the intended outcome.',
  },
  {
    name: "inline-code",
    text: "`another reviewer` then misses the intended outcome.",
  },
] as const;

/**
 * Add the reader-facing section pair an author sees in a milestone.
 * Use to vary current, legacy, or omitted headings without rebuilding the plan fixture.
 *
 * @param milestoneBody - valid milestone Markdown; empty input remains empty apart from inserted sections
 * @param headingStyle - current or legacy heading pair; null models an older plan with neither section
 * @param problemStatement - problem text to validate; empty text models a visible section with no useful explanation
 * @param benefitStatement - benefit text to validate; empty text models a visible section with no useful explanation
 * @returns milestone Markdown with the chosen pair before Scope, or the unchanged body when headings are omitted
 */
function withPlainLanguageSections(
  milestoneBody: string,
  headingStyle: PlainLanguageHeadingStyle,
  problemStatement = VALID_PROBLEM_STATEMENT,
  benefitStatement = VALID_BENEFIT_STATEMENT,
): string {
  // A legacy milestone may omit both reader-facing sections and should receive guidance without becoming invalid.
  if (headingStyle === null) return milestoneBody;
  const problemHeading =
    headingStyle === "current" ? "What problem are we solving" : "The problem";
  const benefitHeading =
    headingStyle === "current" ? "Who benefits and how" : "What you get";
  return milestoneBody.replace(
    "## Scope",
    [
      `## ${problemHeading}`,
      "",
      problemStatement,
      "",
      `## ${benefitHeading}`,
      "",
      benefitStatement,
      "",
      "## Scope",
    ].join("\n"),
  );
}

const BANNED_IDENTIFIER_CASES = [
  {
    name: "milestone ID",
    token: "M22",
    statement:
      "Readers cannot understand M22 without opening internal planning context first.",
  },
  {
    name: "ADR number",
    token: "ADR-056",
    statement:
      "Readers must decode ADR-056 before they can understand what remains broken here.",
  },
  {
    name: "version",
    token: "v1.17.0",
    statement:
      "People cannot tell why v1.17.0 matters without knowing the project release history.",
  },
  {
    name: "flag",
    token: ["--", "strict"].join(""),
    statement:
      "Plan reviewers must understand --strict before they can judge what remains broken.",
  },
  {
    name: "file path",
    token: ["src/", "cli/plans-check.ts"].join(""),
    statement:
      "Contributors must open `src/cli/plans-check.ts` before this problem statement makes sense.",
  },
  {
    name: "unquoted path with an uncommon extension",
    token: ["src/", "server/main.go"].join(""),
    statement:
      "Contributors must open src/server/main.go before they can understand what remains broken here.",
  },
] as const;

describe("plans check: structure, identity, and dependencies", () => {
  /**
   * Fixture purpose: reject malformed Lane fields without changing default-mode reports.
   * Process/filesystem side effects: runs the CLI against temporary plans and removes them afterward.
   */
  it("rejects invalid and duplicate Lane declarations only in strict mode", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-lane-check-"),
    );
    try {
      const body = canonicalMilestoneBody();
      const baseline = runPlansCheck(
        writeCheckFixture(join(temporaryRoot, "base"), body),
      );
      assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
      for (const header of [
        "Lane: Team",
        "Lane: php\nLane: ts",
        "Lane:\nLane: php",
      ]) {
        const planPath = writeCheckFixture(
          join(temporaryRoot, "lane"),
          `${body}\n${header}\n`,
        );
        const legacy = runPlansCheck(planPath);
        const strict = runPlansCheck(planPath, "--strict");
        assert.equal(legacy.status, 0, legacy.stdout + legacy.stderr);
        assert.equal(legacy.stdout, baseline.stdout);
        assert.equal(legacy.stderr, baseline.stderr);
        assert.equal(strict.status, 1, strict.stdout + strict.stderr);
        assertSourceLabelledErrors(strict.stdout);
        assert.match(
          strict.stdout,
          /M01-fixture\.md: (?:invalid Lane value;|multiple Lane values supplied)/u,
        );
        assert.doesNotMatch(strict.stdout, /Team/u);
      }
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /**
   * Writes a temporary plan and runs both CLI modes; cleanup removes every fixture file.
   * Invariant: one deterministic length finding moves from warning to error without duplication.
   */
  it("stages current plain-language length findings by mode", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-current-language-"),
    );
    const planPath = writeCheckFixture(
      temporaryRoot,
      withPlainLanguageSections(
        canonicalMilestoneBody(),
        "current",
        "x".repeat(121),
      ),
    );

    try {
      const defaultResult = runPlansCheck(planPath);
      const strictResult = runPlansCheck(planPath, "--strict");
      const finding =
        'current plain-language section "What problem are we solving" has an invalid length; expected "70-120 characters"; received "121 characters"';

      assert.equal(defaultResult.status, 0, defaultResult.stdout);
      assert.match(
        defaultResult.stdout,
        new RegExp(`warning: M01-fixture\\.md: ${finding}`, "u"),
      );
      assert.equal(strictResult.status, 1, strictResult.stdout);
      assert.match(
        strictResult.stdout,
        new RegExp(`error: M01-fixture\\.md: ${finding}`, "u"),
      );
      assert.doesNotMatch(
        strictResult.stdout,
        new RegExp(`warning: M01-fixture\\.md: ${finding}`, "u"),
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  /**
   * Writes one temporary milestone per identifier class and runs both CLI modes.
   * Invariant: each named case echoes its token and becomes blocking only in strict mode.
   */
  for (const [caseIndex, identifierCase] of BANNED_IDENTIFIER_CASES.entries()) {
    it(`reports a banned ${identifierCase.name} from current sections`, () => {
      const temporaryRoot = mkdtempSync(
        join(tmpdir(), `goat-flow-plan-current-identifier-${caseIndex}-`),
      );
      const planPath = writeCheckFixture(
        temporaryRoot,
        withPlainLanguageSections(
          canonicalMilestoneBody(),
          "current",
          identifierCase.statement,
        ),
      );

      try {
        const defaultResult = runPlansCheck(planPath);
        const strictResult = runPlansCheck(planPath, "--strict");
        const finding =
          `names an internal identifier; expected "no milestone ID, ADR number, version, flag, or internal file path"; ` +
          `received "${identifierCase.token}"`;

        assert.equal(defaultResult.status, 0, defaultResult.stdout);
        assert.match(
          defaultResult.stdout,
          new RegExp(`warning: M01-fixture\\.md: .+${finding}`, "u"),
        );
        assert.equal(strictResult.status, 1, strictResult.stdout);
        assert.match(
          strictResult.stdout,
          new RegExp(`error: M01-fixture\\.md: .+${finding}`, "u"),
        );
      } finally {
        rmSync(temporaryRoot, { recursive: true, force: true });
      }
    });
  }

  /**
   * Writes two temporary plans and runs four CLI checks; cleanup removes both fixture trees.
   * Legacy and missing findings stay advisory, while slash shorthand such as `n/a` stays clean.
   */
  it("keeps legacy and omitted plain-language sections advisory in strict mode", () => {
    const legacyRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-legacy-language-"),
    );
    const missingRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-missing-language-"),
    );
    try {
      const legacyPlanPath = writeCheckFixture(
        legacyRoot,
        withPlainLanguageSections(
          canonicalMilestoneBody(),
          "legacy",
          "M22",
          "Reviewers can mark a field as `n/a` when no reader-facing benefit applies to an archived plan.",
        ),
      );
      const missingPlanPath = writeCheckFixture(
        missingRoot,
        withPlainLanguageSections(canonicalMilestoneBody(), null),
      );
      const legacyDefaultResult = runPlansCheck(legacyPlanPath);
      const legacyStrictResult = runPlansCheck(legacyPlanPath, "--strict");
      const missingDefaultResult = runPlansCheck(missingPlanPath);
      const missingStrictResult = runPlansCheck(missingPlanPath, "--strict");

      assert.equal(legacyDefaultResult.status, 0, legacyDefaultResult.stdout);
      assert.equal(legacyStrictResult.status, 0, legacyStrictResult.stdout);
      assert.match(
        legacyStrictResult.stdout,
        /warning: M01-fixture\.md: legacy plain-language section "The problem" has an invalid length/u,
      );
      assert.match(
        legacyStrictResult.stdout,
        /warning: M01-fixture\.md: legacy plain-language section "The problem" names an internal identifier.+received "M22"/u,
      );
      assert.doesNotMatch(legacyStrictResult.stdout, /received "n\/a"/u);
      assert.equal(missingDefaultResult.status, 0, missingDefaultResult.stdout);
      assert.equal(missingStrictResult.status, 0, missingStrictResult.stdout);
      assert.match(
        missingStrictResult.stdout,
        /warning: M01-fixture\.md: legacy-compatible plain-language problem section is missing/u,
      );
      assert.match(
        missingStrictResult.stdout,
        /warning: M01-fixture\.md: legacy-compatible plain-language benefit section is missing/u,
      );
    } finally {
      rmSync(legacyRoot, { recursive: true, force: true });
      rmSync(missingRoot, { recursive: true, force: true });
    }
  });

  it("strict mode rejects duplicate current plain-language sections", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-duplicate-language-"),
    );
    const body = withPlainLanguageSections(
      canonicalMilestoneBody(),
      "current",
    ).replace(
      "## Scope",
      `## What problem are we solving\n\n${VALID_PROBLEM_STATEMENT}\n\n## Scope`,
    );
    const planPath = writeCheckFixture(temporaryRoot, body);

    try {
      const result = runPlansCheck(planPath, "--strict");
      assert.equal(result.status, 1, result.stdout);
      assert.match(
        result.stdout,
        /current plain-language problem section is duplicated/u,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("strict mode rejects mixed current and legacy plain-language pairs", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-mixed-language-"),
    );
    const body = withPlainLanguageSections(
      canonicalMilestoneBody(),
      "current",
    ).replace("## Who benefits and how", "## What you get");
    const planPath = writeCheckFixture(temporaryRoot, body);

    try {
      const result = runPlansCheck(planPath, "--strict");
      assert.equal(result.status, 1, result.stdout);
      assert.match(
        result.stdout,
        /current plain-language benefit section is missing/u,
      );
      assert.match(
        result.stdout,
        /current milestone mixes plain-language benefit heading styles/u,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // Fixture purpose: writes and removes one current milestone whose valid closing hashes previously downgraded strict findings.
  it("normalizes closing ATX hashes before enforcing current summaries", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-closing-hash-language-"),
    );
    const body = withPlainLanguageSections(
      canonicalMilestoneBody(),
      "current",
      "M22",
    )
      .replace(
        "## What problem are we solving",
        "## What problem are we solving ##",
      )
      .replace("## Who benefits and how", "## Who benefits and how ##");
    const planPath = writeCheckFixture(temporaryRoot, body);

    try {
      const result = runPlansCheck(planPath, "--strict");
      assert.equal(result.status, 1, result.stdout);
      assert.match(
        result.stdout,
        /current plain-language section "What problem are we solving" names an internal identifier.+received "M22"/u,
      );
      assert.doesNotMatch(result.stdout, /legacy-compatible.+is missing/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("strict mode rejects multiline current summaries", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-multiline-language-"),
    );
    const body = withPlainLanguageSections(
      canonicalMilestoneBody(),
      "current",
      "Plan authors can leave reader-facing sections vague\nbecause no checker rejects them.",
    );
    const planPath = writeCheckFixture(temporaryRoot, body);

    try {
      const result = runPlansCheck(planPath, "--strict");
      assert.equal(result.status, 1, result.stdout);
      assert.match(
        result.stdout,
        /expected "one plain line and one sentence"; received "2 non-empty line\(s\)"/u,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // Fixture purpose: varies the first token of a second sentence. Filesystem side effects stay in each removed temp root.
  for (const secondSentenceCase of SECOND_SENTENCE_CASES) {
    it(`strict mode rejects a ${secondSentenceCase.name} second sentence`, () => {
      const temporaryRoot = mkdtempSync(
        join(
          tmpdir(),
          `goat-flow-plan-second-sentence-${secondSentenceCase.name}-`,
        ),
      );
      const problemStatement = `Plan authors can leave reader-facing sections vague. ${secondSentenceCase.text}`;
      const body = withPlainLanguageSections(
        canonicalMilestoneBody(),
        "current",
        problemStatement,
      );
      const planPath = writeCheckFixture(temporaryRoot, body);

      try {
        const result = runPlansCheck(planPath, "--strict");
        assert.equal(result.status, 1, result.stdout);
        assert.match(
          result.stdout,
          /expected "one plain line and one sentence"/u,
        );
      } finally {
        rmSync(temporaryRoot, { recursive: true, force: true });
      }
    });
  }

  /**
   * Writes one incomplete temporary plan and runs strict CLI validation; cleanup removes the fixture.
   * Invariant: every missing deterministic core field is reported with its source label in one run.
   */
  it("strict mode rejects an absent deterministic core", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "goat-flow-plan-core-"));
    const planPath = writeCheckFixture(
      temporaryRoot,
      [
        "# M01: Missing core",
        "",
        "**Effort estimate:** ~0 min agent-time (0 product / 0 proof / 0 other)",
        "**Plan/admin overhead:** 0 min other",
        "",
      ].join("\n"),
    );

    try {
      const result = runPlansCheck(planPath, "--strict");

      assert.equal(result.status, 1);
      assertSourceLabelledErrors(result.stdout);
      assert.match(result.stdout, /missing status/u);
      assert.match(result.stdout, /missing scope/u);
      assert.match(result.stdout, /missing tasks/u);
      assert.match(result.stdout, /missing proof/u);
      assert.match(result.stdout, /missing exit/u);
      assert.match(result.stdout, /missing stop/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // Covers a plan naming both canonical and legacy headings: writes it and expects the ambiguity rejected.
  it("strict mode rejects conflicting canonical and legacy aliases", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-aliases-"),
    );
    const planPath = writeCheckFixture(
      temporaryRoot,
      [
        canonicalMilestoneBody({ proofHeading: "Proof" }),
        "**Objective:** First outcome",
        "",
        "## Objective",
        "Different outcome",
        "",
        "## Testing Gate",
        "- [ ] Legacy duplicate proof. (est: 1 min proof)",
        "",
        "## Kill criteria",
        "Legacy duplicate stop.",
        "",
        "## Scope Discipline",
        "Duplicate scope.",
        "",
        "## Tasks",
        "- [ ] Duplicate task. (est: 1 min product)",
        "",
        "## Exit Criteria",
        "Duplicate exit.",
        "",
      ].join("\n"),
    );

    try {
      const result = runPlansCheck(planPath, "--strict");

      assert.equal(result.status, 1);
      assertSourceLabelledErrors(result.stdout);
      assert.match(result.stdout, /conflicting objective representations/u);
      assert.match(result.stdout, /conflicting proof representations/u);
      assert.match(result.stdout, /conflicting stop representations/u);
      assert.match(result.stdout, /conflicting scope representations/u);
      assert.match(result.stdout, /conflicting task representations/u);
      assert.match(result.stdout, /conflicting exit criteria representations/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  // Covers milestone IDs that collide or disagree with the filename: writes both and expects each rejected.
  it("strict mode rejects duplicate and mismatched milestone IDs", () => {
    const duplicateRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-duplicate-id-"),
    );
    const mismatchRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-title-id-"),
    );
    const longMismatchRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-long-title-id-"),
    );
    try {
      const duplicatePath = writeCheckPlan(duplicateRoot, {
        "M01-one.md": canonicalMilestoneBody({ title: "M01: One" }),
        "M1-two.md": canonicalMilestoneBody({ title: "M1: Two" }),
      });
      const mismatchPath = writeCheckPlan(mismatchRoot, {
        "M02-wrong.md": canonicalMilestoneBody({ title: "M03: Wrong ID" }),
      });
      const longMismatchPath = writeCheckPlan(longMismatchRoot, {
        "M01-wrong.md": canonicalMilestoneBody({
          title: "Milestone 99: Wrong ID",
        }),
      });

      const duplicate = runPlansCheck(duplicatePath, "--strict");
      const mismatch = runPlansCheck(mismatchPath, "--strict");
      const longMismatch = runPlansCheck(longMismatchPath, "--strict");

      assert.equal(duplicate.status, 1);
      assertSourceLabelledErrors(duplicate.stdout);
      assert.match(duplicate.stdout, /duplicate milestone ID/u);
      assert.equal(mismatch.status, 1);
      assertSourceLabelledErrors(mismatch.stdout);
      assert.match(
        mismatch.stdout,
        /title ID M03 does not match filename ID M02/u,
      );
      assert.equal(longMismatch.status, 1);
      assertSourceLabelledErrors(longMismatch.stdout);
      assert.match(
        longMismatch.stdout,
        /title ID M99 does not match filename ID M01/u,
      );
    } finally {
      rmSync(duplicateRoot, { recursive: true, force: true });
      rmSync(mismatchRoot, { recursive: true, force: true });
      rmSync(longMismatchRoot, { recursive: true, force: true });
    }
  });

  // Covers milestone files named by hand: writes lowercase and ID-less variants and expects both rejected.
  it("strict mode rejects lowercase filenames and missing IDs in multi-milestone titles", () => {
    const lowercaseRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-lowercase-id-"),
    );
    const missingTitleRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-missing-title-id-"),
    );
    try {
      const lowercasePath = writeCheckPlan(lowercaseRoot, {
        "m01-lowercase.md": canonicalMilestoneBody({ title: "M01: One" }),
      });
      const missingTitlePath = writeCheckPlan(missingTitleRoot, {
        "M01-one.md": canonicalMilestoneBody({ title: "Deliver one" }),
        "M02-two.md": canonicalMilestoneBody({
          title: "Deliver two",
          dependsOn: "M01",
        }),
      });

      const lowercase = runPlansCheck(lowercasePath, "--strict");
      const missingTitle = runPlansCheck(missingTitlePath, "--strict");

      assert.equal(lowercase.status, 1, lowercase.stdout + lowercase.stderr);
      assert.match(
        lowercase.stdout,
        /filename must begin with an uppercase M/u,
      );
      assert.equal(
        missingTitle.status,
        1,
        missingTitle.stdout + missingTitle.stderr,
      );
      assert.match(
        missingTitle.stdout,
        /multi-milestone title must begin with its milestone ID/u,
      );
    } finally {
      rmSync(lowercaseRoot, { recursive: true, force: true });
      rmSync(missingTitleRoot, { recursive: true, force: true });
    }
  });

  it("strict mode accepts the supported long-form milestone title ID", () => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-plan-long-title-match-"),
    );
    try {
      const planPath = writeCheckPlan(temporaryRoot, {
        "M01-one.md": canonicalMilestoneBody({
          title: "Milestone 01: One",
        }),
      });

      const result = runPlansCheck(planPath, "--strict");

      assert.equal(result.status, 0, result.stdout || result.stderr);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  const dependencyFailureCases: Array<{
    name: string;
    files: Record<string, string>;
    expected: RegExp;
  }> = [
    {
      name: "malformed",
      files: {
        "M01-one.md": canonicalMilestoneBody({ title: "M01: One" }),
        "M02-two.md": canonicalMilestoneBody({
          title: "M02: Two",
          dependsOn: "M01 (soft)",
        }),
      },
      expected:
        /dependencies must be `none` or comma-separated local milestone IDs/u,
    },
    {
      name: "unresolved",
      files: {
        "M01-one.md": canonicalMilestoneBody({ title: "M01: One" }),
        "M02-two.md": canonicalMilestoneBody({
          title: "M02: Two",
          dependsOn: "M09",
        }),
      },
      expected: /dependency M09 does not resolve/u,
    },
    {
      name: "self",
      files: {
        "M01-one.md": canonicalMilestoneBody({
          title: "M01: One",
          dependsOn: "M01",
        }),
      },
      expected: /cannot depend on itself/u,
    },
    {
      name: "cycle",
      files: {
        "M01-one.md": canonicalMilestoneBody({
          title: "M01: One",
          dependsOn: "M02",
        }),
        "M02-two.md": canonicalMilestoneBody({
          title: "M02: Two",
          dependsOn: "M01",
        }),
      },
      expected: /dependency cycle/u,
    },
    {
      name: "state",
      files: {
        "M01-one.md": canonicalMilestoneBody({ title: "M01: One" }),
        "M02-two.md": canonicalMilestoneBody({
          title: "M02: Two",
          status: "in-progress",
          dependsOn: "M01",
        }),
      },
      expected:
        /active or complete milestone requires dependency M01 to be complete/u,
    },
    {
      name: "superseded-prerequisite",
      files: {
        "M01-one.md": canonicalMilestoneBody({
          title: "M01: One",
          status: "superseded",
          statusReason: "Superseded by M02, which carries the remainder.",
        }),
        "M02-two.md": canonicalMilestoneBody({
          title: "M02: Two",
          status: "in-progress",
          dependsOn: "M01",
        }),
      },
      expected:
        /active or complete milestone requires dependency M01 to be complete/u,
    },
  ];

  // Covers each dependency failure separately so TAP names the exact one: every case writes a plan fixture.
  for (const testCase of dependencyFailureCases) {
    it(`strict mode rejects ${testCase.name} dependency state`, () => {
      const temporaryRoot = mkdtempSync(
        join(tmpdir(), `goat-flow-plan-dependency-${testCase.name}-`),
      );
      try {
        const planPath = writeCheckPlan(temporaryRoot, testCase.files);
        const result = runPlansCheck(planPath, "--strict");
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assertSourceLabelledErrors(result.stdout);
        assert.match(result.stdout, testCase.expected);
      } finally {
        rmSync(temporaryRoot, { recursive: true, force: true });
      }
    });
  }
});
