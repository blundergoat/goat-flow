#!/usr/bin/env node
/** Decide destructive-shell and secret-file policy natively; the launcher has already honored the saved policy choice. */
import { runPolicySelfTest } from "./policy-corpus.mjs";
import { runPolicyEntrypoint } from "./policy-evaluation.mjs";

process.exitCode = await runPolicyEntrypoint(
  "deny-dangerous",
  runPolicySelfTest,
);
