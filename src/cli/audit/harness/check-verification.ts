/**
 * Verification concern: Can the agent verify its own work honestly?
 * 4 checks: test-runner-configured, hooks-registered, commit-guidance, post-turn-hook-quality.
 */
import type { QualityCheck } from "../types.js";
import { pass, partial } from "./helpers.js";

const testRunnerConfigured: QualityCheck = {
  id: "test-runner-configured",
  concern: "verification",
  weight: 3,
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

const hooksRegistered: QualityCheck = {
  id: "hooks-registered",
  concern: "verification",
  weight: 2,
  run: (ctx) => {
    const findings: string[] = [];
    const recs: string[] = [];
    const fixes: string[] = [];
    for (const af of ctx.agents) {
      if (af.hooks.postTurnRegistered && !af.hooks.postTurnExists) {
        findings.push(
          `${af.agent.id}: post-turn hook registered but file missing`,
        );
        recs.push("Create the registered post-turn hook file");
        fixes.push(
          `Create the post-turn hook file at the path specified in ${af.agent.settingsFile}.`,
        );
      }
      if (af.hooks.postTurnExists && !af.hooks.postTurnRegistered) {
        findings.push(
          `${af.agent.id}: post-turn hook file exists but not registered`,
        );
        recs.push("Register the post-turn hook in agent settings");
        fixes.push(`Register the post-turn hook in ${af.agent.settingsFile}.`);
      }
    }
    if (findings.length > 0) {
      return partial(50, findings, recs, fixes);
    }
    return pass(["Hook registrations and files are in sync"]);
  },
};

const commitGuidance: QualityCheck = {
  id: "commit-guidance",
  concern: "verification",
  weight: 1,
  run: (ctx) => {
    if (ctx.facts.shared.gitCommitInstructions.exists) {
      return pass(["Commit guidance found"]);
    }
    return partial(
      40,
      ["No commit guidance detected"],
      ["Add commit conventions to instruction file or .github/instructions/"],
      [
        "Add commit conventions to the instruction file or create .github/instructions/git-commit.md.",
      ],
    );
  },
};

/** Consolidated: hook-has-validation + hook-honest-failures */
const postTurnHookQuality: QualityCheck = {
  id: "post-turn-hook-quality",
  concern: "verification",
  weight: 2,
  run: (ctx) => {
    const findings: string[] = [];
    const recs: string[] = [];
    let anyHook = false;

    for (const af of ctx.agents) {
      if (!af.hooks.postTurnExists) continue;
      anyHook = true;

      // Check validation
      if (af.hooks.postTurnHasValidation) {
        findings.push(`${af.agent.id}: post-turn hook runs validation`);
      } else {
        findings.push(`${af.agent.id}: post-turn hook has no validation logic`);
        recs.push(
          `Add validation commands (lint, typecheck) to ${af.agent.id} post-turn hook`,
        );
      }

      // Check honest failures
      if (af.hooks.postTurnSwallowsFailures) {
        findings.push(
          `${af.agent.id}: post-turn hook always exits 0 (advisory mode)`,
        );
        recs.push(
          `Set GOAT_LINT_ENFORCE=1 in ${af.agent.id} post-turn hook to enable enforcement`,
        );
      } else if (af.hooks.postTurnExitsZero && af.hooks.postTurnHasValidation) {
        findings.push(
          `${af.agent.id}: post-turn hook runs validation but always exits 0`,
        );
        recs.push(
          `Set ${af.agent.id} post-turn hook to exit non-zero on validation failure`,
        );
      } else if (af.hooks.postTurnHasValidation) {
        findings.push(
          `${af.agent.id}: post-turn hook reports failures honestly`,
        );
      }
    }

    if (!anyHook) {
      return partial(
        30,
        ["No post-turn hooks found to evaluate"],
        [
          "Create a post-turn hook that runs validation after each agent action",
        ],
        [
          "Create a post-turn hook script that runs linting, typechecking, or other validation.",
        ],
      );
    }
    if (recs.length === 0) return pass(findings);
    return partial(40, findings, recs, [
      "Add validation commands and honest failure reporting to post-turn hooks. Set GOAT_LINT_ENFORCE=1 to exit non-zero on failures.",
    ]);
  },
};

export const VERIFICATION_CHECKS: QualityCheck[] = [
  testRunnerConfigured,
  hooksRegistered,
  commitGuidance,
  postTurnHookQuality,
];
