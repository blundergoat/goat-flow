/**
 * Stand-in analyzer entry for gruff-warning-ratchet tests.
 *
 * The ratchet checker spawns this file through `process.execPath` when
 * `GOAT_FLOW_GRUFF_RATCHET_ANALYZER_BIN` is set, so fixtures can replay any
 * analyzer outcome deterministically: exit codes for operational failures,
 * arbitrary stdout for malformed or drifted JSON, and stderr diagnostics.
 * It never inspects the repository; every behaviour comes from FAKE_GRUFF_*
 * environment variables set by the test that spawned the checker.
 */
const stdout = process.env.FAKE_GRUFF_STDOUT ?? "";
const stderr = process.env.FAKE_GRUFF_STDERR ?? "";
const exitCode = Number(process.env.FAKE_GRUFF_EXIT ?? "0");

if (stdout.length > 0) process.stdout.write(stdout);
if (stderr.length > 0) process.stderr.write(stderr);
process.exit(Number.isFinite(exitCode) ? exitCode : 1);
