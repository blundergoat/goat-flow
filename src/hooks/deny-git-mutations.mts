#!/usr/bin/env node
/** Writes an unavailable reply while this candidate evaluator is unported; requests are never classified. */
import { reportNativeLauncherUnavailable } from "./hook-launch.mjs";

process.exitCode = await reportNativeLauncherUnavailable(
  "policy",
  null,
  null,
  "deny-git-mutations",
  {
    unavailableReasonCode: "candidate-unported",
    userFacingReason: "candidate evaluator has not been ported",
  },
);
