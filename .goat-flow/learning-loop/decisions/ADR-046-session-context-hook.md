# ADR-046: Deliver bounded orientation through capture-gated session-start hooks

**Status:** Accepted
**Date:** 2026-08-23

## Context

Agents start and resume without a compact pointer to the active plan or latest session handoff. The existing Step 0 instructions can recover that state after deliberate reads, but they do not place bounded orientation in the first model request.

M12 tested the installed providers with a fresh nonce returned as session context. Claude Code 2.1.240 delivered the nonce for `startup`, `resume`, and `fork`; resume kept its session identity and fork changed it. Codex CLI 0.149.0 delivered for `startup` and `resume`; `codex exec fork` made a distinct thread but classified its hook as the documented `startup` source. GitHub Copilot CLI 1.0.80 delivered for initial source `new` and source `resume`, but project `sessionStart` hooks cannot currently be source-filtered and interactive `startup` remains uncaptured. Antigravity 1.1.15 documents no session-start event.

The capture also reproduced a configuration interaction: Copilot combines `.github/hooks/*.json` with repository `.claude/settings.json`, so one fixture process ran both compatible entries until the runner selected a target provider explicitly. This is expected by Copilot's hook-locations contract and makes provider-specific registration part of the decision, not incidental test setup.

Evidence anchors:

- `.goat-flow/learning-loop/footguns/hooks.md` (search: `## Footgun: Copilot combines native and Claude project hook registrations`)
- `.goat-flow/learning-loop/decisions/ADR-052-define-hook-trust-evidence-and-results.md` (search: `Each provider/event combination records`)
- `workflow/manifest.json` (search: `"hook_events"`)

## Decision

Ship one read-only session-orientation hook only where a fresh ADR-052 capture and the effective multi-agent config path both prove bounded delivery. It supplies pointers, not file contents, instructions, validation evidence, or permission to act.

The canonical payload is one line:

```text
goat-flow-session-context/v1 active_plan=<safe pointer> latest_session=<safe filename>
```

The implementation contract is a Bash script of at most 25 lines, including a 3-line user-focused file description. It uses Bash builtins and glob expansion only in the per-item path, reads at most the first line of `.goat-flow/plans/.active`, selects the last date-prefixed session filename, replaces characters outside `[[:alnum:]._-]` with `_`, prints nothing when both values are absent, and always exits 0. This 23-line proof shape demonstrates that the constraints fit together:

```bash
#!/usr/bin/env bash
# Adds one bounded orientation line before a supported coding-agent session reaches the user.
# It names the active plan and latest dated handoff without reading milestone or handoff contents.
# Missing local state stays silent, so a new project starts normally and never loses its agent session.
active_plan=""
latest_session=""
# A readable marker gives the user the selected plan directory without loading its files.
if [[ -r .goat-flow/plans/.active ]]; then
  IFS= read -r active_plan < .goat-flow/plans/.active || active_plan=""
fi
shopt -s nullglob
# Date-prefixed session names sort chronologically, so the final match is the newest handoff candidate.
for session_file in .goat-flow/logs/sessions/[0-9][0-9][0-9][0-9]-*.md; do
  latest_session=${session_file##*/}
done
active_plan=${active_plan//[^[:alnum:]._-]/_}
latest_session=${latest_session//[^[:alnum:]._-]/_}
# With no orientation state there is nothing useful to add to the user's first model request.
if [[ -z "$active_plan$latest_session" ]]; then
  exit 0
fi
printf 'goat-flow-session-context/v1 active_plan=%s latest_session=%s\n' "${active_plan:-none}" "${latest_session:-none}"
exit 0
```

The source gates are:

| Provider | Default-on sources after M12 | Deferred or unsupported |
|---|---|---|
| Claude Code | none in the first rollout | `startup`, `resume`, and `fork` delivered, but Copilot also runs the Claude registration in a mixed-agent repository. `clear` and `compact` remain HUMAN-PENDING. |
| Codex CLI | `startup`, `resume` | `clear`, `compact` remain HUMAN-PENDING; fork has no separate source to register. |
| GitHub Copilot CLI | none | `new` and `resume` delivered, but `sessionStart` is not source-filterable, `startup` is uncaptured, and a native registration would duplicate the cross-loaded Claude entry in a mixed-agent repository. |
| Antigravity | none | No documented session-start event. `PreInvocation` is not equivalent. |

`workflow/manifest.json` gains nullable `hook_events.session_start` entries only at implementation. The runtime registry derives `supportsSessionStartHook` from `agent.hook_events?.session_start != null`, mirroring the existing `supportsPostTurnHook` gate. Registration templates must use only the source list above; a null capability must remain absent rather than becoming a best-effort hook. A Claude registration also needs a proven Copilot exclusion before `session_start` can become non-null because Copilot reads that repository config independently of Goat Flow's manifest gate.

The hook is additive orientation. It must never claim that the active milestone was read, a handoff was applied, checks passed, or the project is safe. Agents still follow Step 0 and explicit verification gates.

## ADR-037 non-conflict

ADR-037 governs post-turn `Stop` hooks and rejects generic project validation and plan-checkbox reminders. This decision uses a different lifecycle surface, reads no project source, creates no workflow-enforcement state, and makes no validation claim. It therefore does not restore `stop-lint.sh`, `post-turn-validate`, or `plan-checkbox-guard.sh`, and it does not supersede ADR-037.

## Options considered

### Keep instruction-only retrieval

This avoids another hook surface but leaves orientation dependent on a later deliberate read. It remains the fallback for every deferred or unsupported provider and if rollout evidence fails.

### Enable every documented provider

Documentation alone cannot prove trust, result delivery, or model visibility. M12 also showed source mismatches and cross-tool config loading that a support table would hide. This option is rejected.

### Enable capture-verified and independently routable sources only

This keeps the claim small, excludes human-pending sources, accounts for the effective mixed-agent config path, and preserves null as an honest unsupported state. It is accepted. The first rollout is Codex-only.

## Consequences

- Codex can receive one bounded orientation line on `startup` and `resume` without reading milestone or handoff bodies.
- Claude remains off by default despite successful source captures because Copilot can execute its project registration outside the intended manifest gate.
- Copilot remains off by default despite successful `new` and `resume` delivery because its unverified `startup` path cannot be excluded and a native entry can duplicate the Claude-compatible entry.
- Antigravity continues with instruction-based Step 0 retrieval.
- Provider capture evidence expires under ADR-052 when version, mode, config source, trust, lifecycle, response delivery, or model visibility changes.
- The implementation must sweep manifest, registry, registrar, installed mirror, audit, tests, docs, and hook verification surfaces together; a script alone is not a shipped capability.

## Rollout and acceptance

The accepted first rollout is Codex startup and resume only. ADR acceptance unlocks 1.18.0 M01, but that milestone must replace its current Claude-only scope and live command with this slice before implementation. This decision does not itself authorize or implement shipped hooks.

Deferred providers retain instruction-based retrieval until fresh evidence supports a later decision. No shipped config changes are required while they remain deferred.

## Reversibility

Before release, abandon the planned registration and script and leave nullable `session_start` fields absent. After release, rollback requires hook sync to remove installed registrations and mirrors while leaving the instruction-based Step 0 path intact.
