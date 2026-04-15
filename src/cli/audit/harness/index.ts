/**
 * Harness completeness checks index.
 * Re-exports all 5 concern check arrays as a single HARNESS_CHECKS array.
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
