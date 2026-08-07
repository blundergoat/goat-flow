/**
 * Stand-in analyzer used by the warning-ratchet tests instead of the real gruff-ts scan.
 * The ratchet spawns this file whenever GOAT_FLOW_GRUFF_RATCHET_ANALYZER_BIN is set, which lets a
 * test replay any outcome a maintainer could hit for real: a crashed analyzer, a banner printed ahead
 * of the JSON, a drifted schema, or a clean report. It never looks at the repository - every response
 * comes from the FAKE_GRUFF_* variables the test sets, so ratchet behaviour is checked without
 * needing a repository that actually has the debt under test.
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
