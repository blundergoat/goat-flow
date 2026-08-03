# ADR-044: Dashboard-owned persistence for enforced Claude reporting sessions

**Status:** Accepted
**Date:** 2026-07-31
**Updated:** 2026-08-03
**Ticket/Context:** `.goat-flow/plans/1.15.0/M06-claude-reporting-session-enforcement.md` (kill-criterion gate)

## Context

M06 requires dashboard-launched Claude reporting sessions to be mechanically prevented from
editing tracked target files while still producing durable quality reports. The enforcement
overlay built by `src/cli/server/terminal.ts` (search: `buildClaudeReportingSettings`) proves out
for reads and file-tool writes, but measured probes on Claude Code 2.1.220 (2026-07-31, recorded
in M06 blocked evidence) show that no settings allow-rule form matches the multi-line
quoted-heredoc `quality save` Bash invocation: exact rules, a mid-pattern wildcard, and the
documented trailing `:*` prefix all failed under a proven-active overlay (the probe's
positive-control row executed while the heredoc row was denied). In-session Bash persistence and
source-write denial therefore cannot coexist through Claude settings rules alone. M06's kill
criterion fired, and the human chose dashboard-owned persistence over read-only sessions with a
`persistence-unavailable` result, because per-agent quality history (`quality history` /
`quality diff`) must keep working for enforced Claude runs.

## Decision

The enforced reporting session never persists the report. Instead:

1. The generated dashboard reporting prompt instructs the agent to write ONE draft report JSON
   through the file tool to a gitignored staging path under the mode-selected report owner
   (the controlling workspace for process/skills, or the selected target for agent-setup/harness):
   `.goat-flow/logs/quality/staging/goat-quality-draft-<agent>-<nonce>.json`. The `goat-` prefix
   follows the sentinel namespace rule; no stream markers exist in this design, so
   sentinel-position policy does not apply.
2. The dashboard server owns persistence: it watches the project-owned staging directory, then
   acquires a per-draft filesystem claim with exclusive create before reading report text. A live
   competing claim is skipped. A stale claim is rejected with a terminal receipt and is never
   replayed, because the former owner may have persisted before crashing. The claim owner strictly
   accepts the draft in-process, scrubs every accepted string value, revalidates, then uses the same
   exclusive-create persist path as `quality save` (a shared core in
   `src/cli/quality/quality-command.ts`), writes the final report into
   `.goat-flow/logs/quality/`, deletes the draft, and records success or rejection as terminal
   events. Process shutdown cleans only claims it can prove it owns; it never sweeps the shared
   staging directory.
3. The Claude reporting overlay drops the dead saver and source-`--version` Bash allow rules,
   keeps the staging path writable through the existing logs allow, and adds a deny protecting
   finalized `.goat-flow/logs/quality/*.json` reports from agent edits.
4. Unenforced runs (CLI-generated prompts executed manually outside the dashboard) keep the
   bounded heredoc `quality save` path unchanged.

Accepted residual risk: with this channel an unredacted draft exists briefly on gitignored disk
before server-side redaction. Mitigations bound the window: the staging directory is created
`0700`, drafts are processed immediately on appearance, per-draft claims prevent duplicate
persistence across server processes, stale owners fail closed with rejection receipts, the staging
path is never inside a tracked directory, and final reports keep `0600` exclusive-create semantics.
An incomplete unclaimed draft may outlive one server process rather than being deleted by a process
that cannot prove ownership. As with ADR-041, this is a declared boundary, not a silent gap.

## Failure Mode Comparison

| Option | What fails | Why rejected or accepted |
| --- | --- | --- |
| Staged draft + server-side persist | Unredacted draft briefly on gitignored disk | Accepted with the mitigations above; agent side already measured working under the overlay (M06 manual gate), server side is unit-testable in-process |
| PTY sentinel scraping of the TUI stream | TUI escapes, line wrapping, and redraws corrupt marker parsing; trailing-marker detection is unreliable | Rejected per `.goat-flow/learning-loop/footguns/sentinels.md` (search: `Sentinel-position policy`); do not revisit without a dedicated design ADR |
| Headless spawn (`claude -p --output-format stream-json`) parsed by the server | Reporting UX changes from an interactive terminal to a non-interactive batch run | Fallback if the staged-draft redaction window is rejected during review |
| Keep in-session Bash saver rules | Measured non-matching on Claude Code 2.1.220; only prompt prose would restrain writes | Rejected; the kill criterion forbids shipping another prose-only restriction |

## Consequences

- No further cross-harness probes are required to prove the mechanism: the remaining new code is
  in-process TypeScript covered by unit tests, plus one approved end-to-end skills run.
- `quality save` internals gain a shared exported core; the CLI subcommand's observable behaviour
  is unchanged.
- `docs/dashboard.md` and `docs/cli.md` must present the two persistence variants (enforced
  dashboard sessions vs manual runs) consistently.
- Codex reporting enforcement is untouched; this ADR is Claude-specific.

## Reversibility

Two-way door: the overlay, prompt, and server changes revert with git, and the headless-spawn
fallback is pre-identified. Revisit if a future Claude Code release makes heredoc commands
matchable by settings rules - re-probe using the positive-control method recorded in
`.goat-flow/learning-loop/lessons/test-execution-environment.md` (search: `Nested Claude permission probes`) before trusting any new matcher behaviour.
