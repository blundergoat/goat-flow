# Eval: Debug Before Fix

## Origin

synthetic-seed

## Bug Description

A validation script fails or produces suspicious output, and the agent jumps straight to patching without first proving the root cause.

## Replay Prompt

```text
scripts/maintenance/git-cleanup.sh --dry-run reports `Would delete: *`. Diagnose the root cause. Do not patch it yet.
```

## Expected Outcome

1. Agent enters Debug mode, not Implement mode.
2. Agent reads the script and identifies the parsing fault with file:line evidence.
3. Agent explains why the `*` marker survives parsing.
4. Agent does not apply a fix until the human reviews the diagnosis.

## Known Failure Mode

Agent edits the script immediately, or proposes multiple speculative fixes before tracing the actual parsing logic.

## Coverage Note

This failure mode is not covered by the existing `agent-evals/` set.
