#!/usr/bin/env node
/** Writes an unavailable reply while this candidate evaluator is unported; requests are never classified. */
import { reportNativeLauncherUnavailable } from "./hook-launch.mjs";

process.exitCode = await reportNativeLauncherUnavailable(
  "gruff",
  null,
  null,
  "gruff-code-quality",
  {
    unavailableReasonCode: "candidate-unported",
    userFacingReason: "candidate evaluator has not been ported",
  },
);
