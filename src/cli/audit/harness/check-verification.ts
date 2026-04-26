/**
 * Verification concern: Can the agent verify its own work honestly?
 * 4 checks: test-runner-configured, hooks-registered, commit-guidance, post-turn-hook-integrity.
 */
import type { HarnessCheck } from "../types.js";
import type { CheckEvidence } from "../provenance-types.js";
import { pass, fail } from "./helpers.js";

const VERIFIED_ON = "2026-04-18";

/** Return the verification provenance. */
function verificationProvenance(
  type: HarnessCheck["type"],
  paths: string[],
  sourceType: CheckEvidence["source_type"] = "spec",
): CheckEvidence {
  return {
    source_type: sourceType,
    source_urls: [],
    verified_on: VERIFIED_ON,
    normative_level:
      type === "integrity"
        ? "MUST"
        : type === "advisory"
          ? "SHOULD"
          : "BEST_PRACTICE",
    evidence_paths: paths,
  };
}

const testRunnerConfigured: HarnessCheck = {
  id: "test-runner-configured",
  name: "Test runner configured",
  concern: "verification",
  type: "metric",
  provenance: verificationProvenance("metric", [
    "docs/harness-audit.md",
    ".goat-flow/config.yaml",
  ]),
  /** Run the Test runner configured check. */
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
  type: "integrity",
  provenance: verificationProvenance(
    "integrity",
    [
      "docs/harness-audit.md",
      ".goat-flow/footguns/hooks.md",
      ".goat-flow/footguns/auditor.md",
    ],
    "incident",
  ),
  /** Run the Hook registrations in sync check. */
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
  type: "advisory",
  provenance: verificationProvenance("advisory", [
    "docs/harness-audit.md",
    ".github/git-commit-instructions.md",
  ]),
  /** Run the Commit guidance present check. */
  run: (ctx) => {
    const guidance = ctx.facts.shared.gitCommitInstructions;
    if (guidance.exists) {
      return pass([`Commit guidance found at ${guidance.path}`]);
    }
    if (guidance.misplacedPaths.length > 0) {
      return fail(
        [
          `Commit guidance belongs at ${guidance.requiredPath} when .github/ exists`,
        ],
        [`Move commit conventions to ${guidance.requiredPath}`],
        [
          `Create ${guidance.requiredPath} and move or copy the content from ${guidance.misplacedPaths.join(", ")}.`,
        ],
      );
    }
    return fail(
      ["No commit guidance detected"],
      [`Add commit conventions to ${guidance.requiredPath}`],
      [`Create ${guidance.requiredPath} with this project's commit rules.`],
    );
  },
};

/** Consolidated: hook validation + honest failure reporting (informational) */
const postTurnHookIntegrity: HarnessCheck = {
  id: "post-turn-hook-integrity",
  name: "Post-turn hook integrity",
  concern: "verification",
  type: "metric",
  provenance: verificationProvenance("metric", [
    "docs/harness-audit.md",
    ".goat-flow/footguns/hooks.md",
  ]),
  /** Run the Post-turn hook integrity check. */
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
