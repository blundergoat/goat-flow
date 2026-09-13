/**
 * Replay analyzer outcomes for the warning-ratchet tests without scanning a repository.
 *
 * The ratchet launches this fixture through GOAT_FLOW_GRUFF_RATCHET_ANALYZER_BIN.
 * FAKE_GRUFF_* variables supply output and exit status; omitted values mean no output and a successful exit.
 */
const scriptedStdout = process.env.FAKE_GRUFF_STDOUT ?? "";
const scriptedStderr = process.env.FAKE_GRUFF_STDERR ?? "";
const scriptedExitCode = Number(process.env.FAKE_GRUFF_EXIT ?? "0");

// A test asked for report output, standing in for the analyzer's JSON on a real run.
if (scriptedStdout.length > 0) process.stdout.write(scriptedStdout);

// A test asked for diagnostics, standing in for an analyzer complaining about its own config.
if (scriptedStderr.length > 0) process.stderr.write(scriptedStderr);

// A non-numeric exit code would mean the test set something unusable, so fail rather than pass.
process.exit(Number.isFinite(scriptedExitCode) ? scriptedExitCode : 1);
