/**
 * Assembles every harness check into the single list the audit runs, grouped by the five concerns a user sees scored.
 *
 * Those concerns are Context, Constraints, Verification, Recovery, and Feedback Loop, and they are what `goat-flow audit --harness` reports.
 *
 * Adding a check to its concern file is enough to include it here, so no check can be written and then silently never run.
 */
import type { HarnessCheck } from "../types.js";
import { CONTEXT_CHECKS } from "./check-context.js";
import { CONSTRAINTS_CHECKS } from "./check-constraints.js";
import { VERIFICATION_CHECKS } from "./check-verification.js";
import { RECOVERY_CHECKS } from "./check-recovery.js";
import { FEEDBACK_LOOP_CHECKS } from "./check-feedback-loop.js";

export const HARNESS_CHECKS: HarnessCheck[] = [
  ...CONTEXT_CHECKS,
  ...CONSTRAINTS_CHECKS,
  ...VERIFICATION_CHECKS,
  ...RECOVERY_CHECKS,
  ...FEEDBACK_LOOP_CHECKS,
];
