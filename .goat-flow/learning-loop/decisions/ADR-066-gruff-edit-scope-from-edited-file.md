# ADR-066: Resolve the Gruff edit hook's install, config and Git scope from the edited file

**Status:** Accepted
**Date:** 2026-09-19
**Ticket/Context:** `.goat-flow/plans/quality-assessment-followup-2026-09-13/M19-gruff-contract-baseline.md` and `M20-gruff-project-scope.md` (local working state, not committed evidence)
**Updated:** 2026-09-19 - before implementation, the entry rule was narrowed to Claude's registration: ADR-052 and ADR-053 freeze the other providers' registration bytes.

## Context

ADR-053 keeps one root contract for every managed hook: the launcher bootstrap takes the Git root of its process cwd, then the cwd's ancestors, then `CLAUDE_PROJECT_DIR`. A candidate that holds the hook script without a registration counts as corrupt, and the bootstrap stops with `managed root incomplete` (`src/cli/server/agent-hook-command.ts`, search: `function rootDiscoveryFragments`). The Gruff hook then filters paths, finds analyzer configs and asks Git for changed lines against that one root (`workflow/hooks/gruff-code-quality.sh`, search: `analyzer_target_for_path() {`; `workflow/hooks/gruff-code-quality.sh`, search: `git_diff_ranges() {`).

The process cwd is the session's shell cwd, which any `cd` in a Bash tool call moves. In a single-install project that is invisible. On 2026-09-19 the contract was replayed against a consumer workspace whose parent folder is not a Git repository, with one install at the parent and one in each child repository:

- The parent's exact Gruff registration, run with cwd in a child whose install disables Gruff, exited 0 with empty output and `managed root incomplete`. The edited file lay outside that child, so an unrelated edit lost its analysis without a message.
- A child's registration, run with cwd in that child for an edit to a sibling repository's source, returned the zero-unit not-applicable advisory for real source.
- From the non-git parent, an edit with an analyzer config and a discoverable analyzer still ended `git-scope-failed`, and the analyzer never ran.

A scan of 50 recent session transcripts counted 34 `git-scope-failed` results and 21 not-applicable results on child-repository source; its cwd reconstruction is approximate.

Disabling Gruff removes its registration and leaves the script copy in place (`src/cli/server/agent-hook-writer.ts`, search: `Disabled non-policy hooks have no provider row`). A correctly disabled nested install is therefore indistinguishable from a tampered one under ADR-053's rule. Policy hooks do not share the problem, because a disabled policy keeps its registration.

## Decision

For the Gruff edit hook only, the edited file decides which install, analyzer config and Git repository apply. The shell cwd decides none of them.

1. **Boundary.** Gruff analyses only paths inside the provider project directory, `CLAUDE_PROJECT_DIR` where the provider sets it. Where no such directory is exposed, the entry install's root is the boundary.
2. **Entry install.** The entry install supplies the only hook runtime that executes. Claude's Gruff registration inspects the provider project directory first and selects it when it holds a complete install. Otherwise the ADR-053 order applies. A directory that holds a script copy but does not register Gruff is passed over, not treated as corrupt. A candidate that registers Gruff but lacks its launcher or script is still corrupt and reports unavailable. Codex, Copilot and Antigravity keep their ADR-053 registrations byte for byte, because ADR-052 freezes them until a fresh provider capture approves a change. They keep the shell-cwd entry order and still receive rules 3 to 8 through the hook script.
3. **Owner install.** For each edited file, the owner is the nearest ancestor inside the boundary that holds a goat-flow install. The owner supplies the saved Gruff choice and the analyzer binary overrides (`workflow/hooks/gruff-code-quality.sh`, search: `config_binary_override() {`). ADR-032's containment rule applies relative to the owner's root. No script from an owner install runs unless it is also the entry install.
4. **Nested opt-out.** `hooks.gruff-code-quality.enabled: false` in the owner's `.goat-flow/config.yaml` opts out the files under that install. They are skipped, and no parent analyses them. Files elsewhere are unaffected. An owner config that cannot be read or parsed is reported as unavailable for that file and is never read as an opt-out.
5. **Analyzer config.** The nearest analyzer config above the file still owns it, bounded by the owner's root.
6. **Git scope.** Changed lines come from the Git repository that contains the edited file. Tracked files keep diff ranges, and untracked new files keep whole-file ranges.
7. **No repository.** When no Git repository contains the file, Gruff uses provider-supplied ranges if the payload carries them. Otherwise it analyses the whole edited file and labels the coverage as whole-file without Git. A Git failure inside a repository stays `git-scope-failed` and never becomes a whole-file result.
8. **Several files.** Each file resolves separately, and the combined outcome is the most severe per-file state.

deny-dangerous, deny-git-mutations and post-turn safety keep ADR-053's root contract unchanged, including the corrupt classification and their fail-closed responses. This decision grants no hook new write authority.

## Failure Mode Comparison

| Option | What fails | Verdict |
| --- | --- | --- |
| Keep cwd selection and resolve only config and Git per file | Strongest case: no registration bytes change and no consumer needs a re-sync. It fails because the disabled-child stop happens in the bootstrap, before any managed code runs, and a cwd inside a child still selects that child's older runtime | Rejected |
| Run the owner install's own script copy | Strongest case: each project runs the version it installed. It fails because nested copies can lag (four measured at 1.15.1 beside a 1.16.0 parent) and would run code the fired registration never named | Rejected |
| Let the parent analyse files under a disabled child | Strongest case: more coverage. It overrides a saved project choice | Rejected |
| Treat any Git failure as "no repository" | Strongest case: one simple fallback. It turns failed attribution into a completed result, while ADR-052 requires complete declared coverage for a pass | Rejected |
| Change every provider's Gruff bootstrap | Strongest case: one entry rule for every provider. ADR-052 and ADR-053 freeze the Codex, Copilot and Antigravity registration bytes until a fresh capture of that provider exists, and every measured incident came from Claude sessions | Rejected |
| Apply the new entry rule to policy hooks | Strongest case: one contract for every hook. No incident shows a policy hook failing this way, and their fail-closed classification is security-sensitive | Rejected |
| Entry from the provider project for Claude, owner per file, explicit opt-out, Git per file, labelled whole-file fallback | Older Claude registrations keep today's behaviour until re-synced; the frozen providers keep the cwd entry order | Accepted |

## Consequences

- Claude's Gruff bootstrap source changes, so Claude's Gruff registration bytes change. `workflow/hooks/agent-config/claude.json` and the managed desired-state contract regenerate, and this repository's `.claude/settings.json` re-syncs. Every policy and Stop registration, and every Codex, Copilot and Antigravity registration, stays byte-identical.
- For Codex, Copilot and Antigravity, a shell cwd inside a Gruff-disabled child still stops the parent's Gruff registration. That limit stays until a provider capture allows their registrations to change.
- A Claude consumer gets the new entry rule only after `hooks sync` or a reinstall rewrites its Gruff registration. The per-file owner, Git and opt-out rules arrive with the hook script.
- Files under a disabled nested install produce no Gruff message. How skipped and out-of-boundary edits are reported is decided separately and must not present them as completed analysis.
- Whether Claude edit payloads carry usable changed ranges is unverified, so rule 7 currently resolves to the whole-file branch for Claude.
- This decision claims no provider delivery. ADR-052's evidence rules are unchanged.
- ADR-053 carries an `Updated` line pointing here for the Gruff exception.

## Reversibility

Two-way. Restoring the shared bootstrap for Claude's Gruff handler, regenerating the template and contract, and syncing returns the ADR-053 contract. The per-file rules live in the hook script and its mirror and revert with them. Reverting restores the measured defects above, so revisit only with a reproduction showing that the provider project directory is unreliable as an entry root.
