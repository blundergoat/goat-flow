/**
 * How the checker keeps a plan navigable: canonical sections, milestone IDs that match
 * filenames, and local dependencies that resolve without cycles.
 * Runs the real CLI against written milestone fixtures, so failures read as an author would
 * see them in a terminal rather than as internals.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runPlansCheck,
  assertSourceLabelledErrors,
  writeCheckFixture,
  writeCheckPlan,
  canonicalMilestoneBody,
} from "./plans-check.helpers.js";

describe("plans check: structure, identity, and dependencies", () => {
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
      for (const field of [
        "status",
        "scope",
        "tasks",
        "proof",
        "exit",
        "stop",
      ]) {
        assert.match(result.stdout, new RegExp(`missing ${field}`, "u"));
      }
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
