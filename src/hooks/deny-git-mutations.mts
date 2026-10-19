#!/usr/bin/env node
/** Decide Git and GitHub write policy natively; the launcher has already honored the saved policy choice. */
import { runPolicySelfTest } from "./policy-corpus.mjs";
import { runPolicyEntrypoint } from "./policy-evaluation.mjs";

process.exitCode = await runPolicyEntrypoint(
  "deny-git-mutations",
  runPolicySelfTest,
);
