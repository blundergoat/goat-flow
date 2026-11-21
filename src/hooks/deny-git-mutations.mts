#!/usr/bin/env node
/** Decide deny-git-mutations policy natively; the launcher has already honored the saved policy choice. */
import { readFileSync } from "node:fs";
import { isatty } from "node:tty";

/** Preserve the provider's refusal protocol even when the policy modules cannot load. */
function reportStartupUnavailable(): number {
  const reason =
    "Policy hook unavailable: deny-git-mutations.mjs cannot start: required policy runtime is unavailable. Re-run goat-flow setup so .goat-flow/hooks is installed and tracked.";
  let payload = "";
  // Check and self-test arguments own their input; a broken self-test must not wait for stdin.
  if (
    !process.argv
      .slice(2)
      .some((argument) => /^--(?:check|self-test)(?:=|$)/u.test(argument)) &&
    !isatty(0)
  ) {
    try {
      payload = readFileSync(0, "utf8");
    } catch {
      // Unreadable input cannot establish a JSON provider, so keep the stderr refusal below.
    }
  }
  if (payload.includes('"toolName"') && !payload.includes('"tool_name"')) {
    process.stdout.write(
      JSON.stringify({
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      }) + "\n",
    );
    return 0;
  }
  if (payload.includes('"toolCall"')) {
    process.stdout.write(JSON.stringify({ decision: "deny", reason }) + "\n");
    return 0;
  }
  process.stderr.write(reason + "\n");
  return 2;
}

try {
  const { runPolicyEntrypoint } = await import("./policy-evaluation.mjs");
  const { runPolicySelfTest } = await import("./policy-corpus.mjs");
  process.exitCode = await runPolicyEntrypoint(
    "deny-git-mutations",
    runPolicySelfTest,
  );
} catch {
  process.exitCode = reportStartupUnavailable();
}
