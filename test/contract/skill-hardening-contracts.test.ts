import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const MIRRORS = [
  "workflow/skills",
  ".claude/skills",
  ".agents/skills",
  ".github/skills",
] as const;

function read(path: string): string {
  return readFileSync(resolve(PROJECT_ROOT, path), "utf-8");
}

function skillPaths(skill: string): string[] {
  return MIRRORS.map((root) => `${root}/${skill}/SKILL.md`);
}

describe("skill hardening contracts", () => {
  const badCodexException = new RegExp("Exception: on C" + "odex");
  const badCodexConsent = new RegExp(
    ["C", "odex requires ", "explicit user ", "delegation ", "consent"].join(
      "",
    ),
  );
  const badDelegationConfirm = new RegExp(
    ["confirm ", "delegation ", "consent once ", "before spawning"].join(""),
  );

  it("keeps goat-plan mid-implementation proof explicit and within budget", () => {
    for (const path of skillPaths("goat-plan")) {
      const body = read(path);
      assert.match(
        body,
        /Mid-implementation proof/,
        `${path} missing mid-proof`,
      );
      assert.match(
        body,
        /before switching modules or after a bounded edit batch/,
        `${path} missing bounded proof timing`,
      );
    }
    assert.ok(
      read("workflow/skills/goat-plan/SKILL.md").split(/\s+/).filter(Boolean)
        .length <= 2500,
      "workflow goat-plan must stay within the functional-skill word budget",
    );
  });

  it("keeps goat-plan path-only task intake read-only", () => {
    for (const path of skillPaths("goat-plan")) {
      const body = read(path);
      assert.match(body, /Path-only guard runs first/, path);
      assert.match(body, /Path-Only Intake \/ Read-Only Orientation/, path);
      assert.match(
        body,
        /Do NOT update `\.active`, milestone status fields, task checkboxes, or code/,
        path,
      );
      assert.match(body, /A path alone is not write approval/, path);
      assert.match(
        body,
        /Do NOT mutate `\.goat-flow\/tasks\/\.active`, milestone status, checkboxes, or code/,
        path,
      );
    }
  });

  it("lets goat-plan File-Write persist without phase-one approval or critique handoff", () => {
    for (const path of skillPaths("goat-plan")) {
      const body = read(path);
      assert.match(body, /Small File-Write/, path);
      assert.match(body, /no Phase 1 approval pause/, path);
      assert.match(body, /Write artifacts immediately/, path);
      assert.match(
        body,
        /MUST NOT invoke or prompt for `\/goat-critique`/,
        path,
      );
      assert.doesNotMatch(body, /After Phase 1 approval/, path);
      assert.doesNotMatch(
        body,
        /Approve milestones and start implementing/,
        path,
      );
      assert.doesNotMatch(
        body,
        /delegated alternatives pass before writing milestone files/,
        path,
      );
    }
  });

  it("keeps goat dispatcher from routing bare task paths to implementation", () => {
    for (const path of skillPaths("goat")) {
      const body = read(path);
      assert.match(
        body,
        /Bare or ambiguous task paths are read-only context/,
        path,
      );
      assert.match(
        body,
        /Do not update `\.active`, milestone status, or code from a path alone/,
        path,
      );
    }
  });

  it("documents task-path classifier examples", () => {
    const body = read("docs/skills.md");
    assert.match(body, /Task path classifier examples/, "missing table");
    assert.match(
      body,
      /`\.goat-flow\/tasks\/64272_voice-chat`\s+\|\s+Read-only orientation; no writes/,
      "path-only input must be read-only",
    );
    assert.match(
      body,
      /`\.goat-flow\/tasks\/64272_voice-chat start M01`\s+\|\s+Implementation may start after normal gates/,
      "start M01 input must allow implementation after gates",
    );
    assert.match(
      body,
      /`resume \.goat-flow\/tasks\/64272_voice-chat`\s+\|\s+Confirm current milestone unless the plan clearly records one/,
      "resume input must confirm current milestone",
    );
    assert.match(
      body,
      /`update M01 in \.goat-flow\/tasks\/64272_voice-chat`\s+\|\s+Update the named milestone file only/,
      "update M01 input must stay plan-file scoped",
    );
    assert.match(
      body,
      /`implement M01 from \.goat-flow\/tasks\/64272_voice-chat`\s+\|\s+Code implementation may proceed after reading gates/,
      "implement M01 input must allow code implementation after gates",
    );
  });

  it("requires goat-qa Standard-mode gap output to include Verification Integrity", () => {
    for (const path of skillPaths("goat-qa")) {
      const body = read(path);
      assert.match(body, /gap analysis plus Verification Integrity/, path);
      assert.match(
        body,
        /Intent spec: \[PR\/issue\/test plan URL or `no-intent-spec`\]/,
        path,
      );
      assert.match(body, /Evidence limit:/, path);
    }
  });

  it("separates goat-review reporting-only DoD from implementation DoD", () => {
    for (const path of skillPaths("goat-review")) {
      const body = read(path);
      assert.match(body, /Review DoD gate/, path);
      assert.match(body, /reporting-only review/, path);
      assert.doesNotMatch(
        body,
        /\*\*DoD gate:\*\* \(1\) tests\/lint pass/,
        path,
      );
    }
  });

  it("checks goat-critique sub-agent completeness before trusting self-report", () => {
    for (const path of skillPaths("goat-critique")) {
      const body = read(path);
      assert.match(body, /Check sub-agent completeness/, path);
      assert.match(body, /3-7 findings plus required lens fields/, path);
      assert.match(body, /sub-agent completeness limited/, path);
    }
  });

  it("keeps goat-critique direct invocation as delegation consent", () => {
    for (const path of skillPaths("goat-critique")) {
      const body = read(path);
      assert.match(body, /\$goat-critique/, path);
      assert.match(body, /\/goat-critique/, path);
      assert.match(body, /consent to spawn sub-agents/, path);
      assert.match(body, /Do NOT ask again/, path);
      assert.doesNotMatch(body, badCodexException, path);
      assert.doesNotMatch(body, badCodexConsent, path);
      assert.doesNotMatch(body, badDelegationConfirm, path);
    }
  });

  it("keeps goat-critique report-only until explicit apply", () => {
    for (const path of skillPaths("goat-critique")) {
      const body = read(path);
      assert.match(body, /Report-only by default/, path);
      assert.match(body, /Do not mutate the target artifact/, path);
      assert.match(
        body,
        /user separately says to apply, edit, update, fix/,
        path,
      );
      assert.match(body, /Recommendations are never auto-applied/, path);
      assert.match(body, /After synthesis, stop/, path);
      assert.match(body, /Do not enter implementation mode/, path);
      assert.match(body, /freeze writes/, path);
    }
  });

  it("keeps shared report-only and interrupt freeze contracts installed", () => {
    for (const path of [
      "workflow/skills/reference/skill-preamble.md",
      ".goat-flow/skill-reference/skill-preamble.md",
    ]) {
      const body = read(path);
      assert.match(body, /Report-Only Skill Contract/, path);
      assert.match(body, /are report-only by default/, path);
      assert.match(body, /MUST NOT mutate the target artifact/, path);
      assert.match(
        body,
        /a bare or ambiguous task path is context, not a direct planning request/,
        path,
      );
      assert.match(
        body,
        /a task path alone must not update `\.active`, milestone status, checkboxes, or code/,
        path,
      );
    }

    for (const path of [
      "workflow/skills/reference/skill-conventions.md",
      ".goat-flow/skill-reference/skill-conventions.md",
    ]) {
      const body = read(path);
      assert.match(body, /Interrupt Freeze Protocol/, path);
      assert.match(body, /freeze writes immediately/, path);
      assert.match(body, /Only run read-only status or diff checks/, path);
    }
  });

  it("clarifies deployment bulletproof evidence as a release gate or hardening debt", () => {
    for (const path of [
      "workflow/skills/reference/skill-quality-testing/deployment.md",
      ".goat-flow/skill-reference/skill-quality-testing/deployment.md",
    ]) {
      const body = read(path);
      assert.match(body, /release gate before merging/, path);
      assert.match(body, /hardening debt/, path);
      assert.match(body, /do not claim the skill is bulletproof/, path);
    }
  });
});
