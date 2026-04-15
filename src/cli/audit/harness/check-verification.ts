/**
 * Verification concern: Can the agent verify its own work honestly?
 * 4 checks: test-runner-configured, hooks-registered, commit-guidance, post-turn-hook-integrity.
 */
import type { HarnessCheck } from "../types.js";
import { pass, fail } from "./helpers.js";

const testRunnerConfigured: HarnessCheck = {
  id: "test-runner-configured",
  name: "Test runner configured",
  concern: "verification",
  run: (ctx) => {
    const tc = ctx.config.config.toolchain;
    if (tc.test.length > 0) {
      return pass([`Test command configured: ${tc.test[0]}`]);
    }
    return pass([
      "No structured toolchain.test configured; treat project-local commands or instruction-file commands as the source of truth",
    ]);
  },
};

const hooksRegistered: HarnessCheck = {
  id: "hooks-registered",
  name: "Hook registrations in sync",
  concern: "verification",
  run: (ctx) => {
    const findings: string[] = [];
    const recs: string[] = [];
    const fixes: string[] = [];
    let anyFail = false;
    for (const af of ctx.agents) {
      if (af.hooks.postTurnRegistered && !af.hooks.postTurnExists) {
        findings.push(
          `${af.agent.id}: post-turn hook registered but file missing`,
        );
        recs.push("Create the registered post-turn hook file");
        fixes.push(
          `Create the post-turn hook file at the path specified in ${af.agent.settingsFile}.`,
        );
        anyFail = true;
      }
      if (af.hooks.postTurnExists && !af.hooks.postTurnRegistered) {
        findings.push(
          `${af.agent.id}: post-turn hook file exists but not registered`,
        );
        recs.push("Register the post-turn hook in agent settings");
        fixes.push(`Register the post-turn hook in ${af.agent.settingsFile}.`);
        anyFail = true;
      }
    }
    if (anyFail) return fail(findings, recs, fixes);
    return pass(["Hook registrations and files are in sync"]);
  },
};

const commitGuidance: HarnessCheck = {
  id: "commit-guidance",
  name: "Commit guidance present",
  concern: "verification",
  run: (ctx) => {
    if (ctx.facts.shared.gitCommitInstructions.exists) {
      return pass(["Commit guidance found"]);
    }
    return fail(
      ["No commit guidance detected"],
      ["Add commit conventions to instruction file or .github/instructions/"],
      [
        "Add commit conventions to the instruction file or create .github/instructions/git-commit.md.",
      ],
    );
  },
};

/** Consolidated: hook validation + honest failure reporting (informational) */
const postTurnHookIntegrity: HarnessCheck = {
  id: "post-turn-hook-integrity",
  name: "Post-turn hook integrity",
  concern: "verification",
  run: (ctx) => {
    const findings: string[] = [];
    let anyHook = false;

    for (const af of ctx.agents) {
      if (!af.hooks.postTurnExists) continue;
      anyHook = true;

      if (af.hooks.postTurnHasValidation) {
        findings.push(`${af.agent.id}: post-turn hook runs validation`);
      } else {
        findings.push(`${af.agent.id}: post-turn hook has no validation logic`);
      }

      if (af.hooks.postTurnSwallowsFailures) {
        findings.push(
          `${af.agent.id}: post-turn hook always exits 0 (advisory mode)`,
        );
      } else if (af.hooks.postTurnHasValidation) {
        findings.push(
          `${af.agent.id}: post-turn hook reports failures honestly`,
        );
      }
    }

    if (!anyHook) {
      return pass(["No post-turn hooks installed"]);
    }
    return pass(findings);
  },
};

export const VERIFICATION_CHECKS: HarnessCheck[] = [
  testRunnerConfigured,
  hooksRegistered,
  commitGuidance,
  postTurnHookIntegrity,
];
