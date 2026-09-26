# ADR-044: Dashboard-owned persistence for enforced Claude reporting sessions

**Status:** Accepted
**Date:** 2026-07-31
**Updated:** 2026-09-05 - condensed; the 2026-08-03 amendment is folded in and a deleted local milestone reference is dropped.

## Context

Dashboard-launched Claude reporting sessions must be mechanically prevented from editing tracked target files while still producing durable quality reports. The enforcement overlay from `src/cli/server/terminal-reporting-profile.ts` (search: `buildClaudeReportingSettings`) proved out for reads and file-tool writes. Measured probes on Claude Code 2.1.220 (2026-07-31) showed that no settings allow-rule form matches the multi-line quoted-heredoc `quality save` Bash invocation: exact rules, a mid-pattern wildcard, and the documented trailing `:*` prefix all failed while the probe's positive-control row executed. In-session Bash persistence and source-write denial cannot coexist through Claude settings rules alone. The kill criterion fired, and the human chose dashboard-owned persistence over read-only sessions, because per-agent `quality history` and `quality diff` must keep working for enforced Claude runs.

## Decision

The enforced reporting session never persists the report; the dashboard server does.

1. The generated reporting prompt has the agent write one draft report JSON through the file tool to a gitignored staging path under the mode-selected report owner (the controlling workspace for process and skills, the selected target for agent-setup and harness): `.goat-flow/logs/quality/staging/goat-quality-draft-<agent>-<nonce>.json`. The `goat-` prefix follows the sentinel namespace rule; no stream markers exist, so sentinel-position policy does not apply.
2. The server (`src/cli/server/quality-draft-staging.ts`) watches the staging directory, acquires a per-draft filesystem claim with exclusive create before reading, skips a live competing claim, and rejects a stale claim with a terminal receipt and no replay, because the former owner may have persisted before crashing. The claim owner accepts the draft in-process, scrubs every string value, revalidates, persists through the same exclusive-create core as `quality save` (`src/cli/quality/quality-command.ts`) into `.goat-flow/logs/quality/`, deletes the draft, and records success or rejection as terminal events. Shutdown cleans only claims it can prove it owns.
3. The Claude overlay drops the dead saver and `--version` Bash allow rules, keeps the staging path writable through the logs allow, and denies agent edits to finalized `.goat-flow/logs/quality/*.json`.
4. Unenforced runs (CLI-generated prompts executed manually) keep the bounded heredoc `quality save` path unchanged.

Accepted residual risk: an unredacted draft exists briefly on gitignored disk before server-side redaction. The staging directory is created `0700`, drafts are processed on appearance, per-draft claims prevent duplicate persistence across server processes, stale owners fail closed, the path is never inside a tracked directory, and final reports keep `0600` exclusive-create semantics. An unclaimed incomplete draft may outlive one server process. Like ADR-052's heredoc boundary, this is a declared boundary, not a silent gap.

## Failure Mode Comparison

| Option | What fails | Verdict |
| --- | --- | --- |
| Staged draft plus server-side persist | Unredacted draft briefly on gitignored disk | Accepted with the mitigations above |
| PTY sentinel scraping of the TUI stream | Escapes, wrapping, and redraws corrupt marker parsing (`.goat-flow/learning-loop/footguns/sentinels.md`, search: `Sentinel-position policy`) | Rejected; needs a dedicated design ADR to revisit |
| Headless `claude -p --output-format stream-json` parsed by the server | Reporting UX becomes a non-interactive batch run | Pre-identified fallback |
| Keep in-session Bash saver rules | Measured non-matching on Claude Code 2.1.220; only prose would restrain writes | Rejected; the kill criterion forbids another prose-only restriction |

## Consequences

- The remaining code is in-process TypeScript covered by unit tests; no further cross-harness probes were needed.
- `quality save` gained a shared exported core with unchanged CLI behaviour.
- `docs/dashboard.md` and `docs/cli.md` present the two persistence variants consistently. Codex reporting enforcement is untouched.

## Reversibility

Two-way: overlay, prompt, and server changes revert with git, and the headless fallback is pre-identified. Revisit if a Claude Code release makes heredoc commands matchable by settings rules; re-probe with the positive-control method in `.goat-flow/learning-loop/lessons/test-shell-environment.md` (search: `Nested Claude permission probes`) before trusting a new matcher.
