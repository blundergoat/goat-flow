# ADR-046: Deliver bounded orientation through capture-gated session-start hooks

**Status:** Proposed
**Date:** 2026-08-23
**Updated:** 2026-09-05 - status changed from Accepted to Proposed: nothing has shipped, no milestone owns the slice, and the 2026-08-23 captures expire under ADR-052 on 2026-09-22. The 2026-09-03 amendment had replaced a dead milestone owner with unplanned status.

## Context

Agents start and resume without a compact pointer to the active plan or latest handoff. Step 0 recovers that state after deliberate reads, but nothing places bounded orientation in the first model request.

M12 tested the installed providers with a fresh nonce returned as session context. Claude Code 2.1.240 delivered it for `startup`, `resume`, and `fork`. Codex CLI 0.149.0 delivered for `startup` and `resume`; `codex exec fork` made a distinct thread but classified its hook as `startup`. GitHub Copilot CLI 1.0.80 delivered for `new` and `resume`, but project `sessionStart` hooks cannot be source-filtered and interactive `startup` stayed uncaptured. Antigravity 1.1.15 documents no session-start event. The capture also reproduced a configuration interaction: Copilot combines `.github/hooks/*.json` with repository `.claude/settings.json`, so one fixture process ran both entries until the runner selected a provider explicitly (`.goat-flow/learning-loop/footguns/hooks.md`, search: `## Footgun: Copilot combines native and Claude project hook registrations`).

## Decision

Ship one read-only session-orientation hook only where a fresh ADR-052 capture and the effective multi-agent config path both prove bounded delivery; the first admitted slice is Codex `startup` and `resume`.

The hook supplies pointers, not file contents, instructions, validation evidence, or permission to act. Its canonical payload is one line:

```text
goat-flow-session-context/v1 active_plan=<safe pointer> latest_session=<safe filename>
```

The script is at most 25 lines of Bash including a 3-line description, uses builtins and glob expansion only, reads at most the first line of `.goat-flow/plans/.active`, selects the last date-prefixed session filename, replaces characters outside `[[:alnum:]._-]` with `_`, prints nothing when both values are absent, and always exits 0. This 23-line proof shape shows the constraints fit together:

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

| Provider | Admitted sources | Deferred or unsupported |
| --- | --- | --- |
| Claude Code | none | `startup`, `resume`, and `fork` delivered, but Copilot also runs the Claude registration in a mixed-agent repository; `clear` and `compact` HUMAN-PENDING |
| Codex CLI | `startup`, `resume` | `clear` and `compact` HUMAN-PENDING; fork has no separate source |
| GitHub Copilot CLI | none | `sessionStart` not source-filterable, `startup` uncaptured, and a native entry would duplicate the cross-loaded Claude row |
| Antigravity | none | No documented session-start event; `PreInvocation` is not equivalent |

At implementation, `workflow/manifest.json` gains nullable `hook_events.session_start` entries and the registry derives `supportsSessionStartHook` the way it derives `supportsPostTurnHook`. A null capability stays absent rather than becoming a best-effort hook. A Claude registration additionally needs a proven Copilot exclusion, because Copilot reads that config independently of the manifest gate. The hook never claims a milestone was read, a handoff applied, checks passed, or the project is safe.

This does not conflict with ADR-037: it uses a different lifecycle surface, reads no project source, creates no workflow-enforcement state, and makes no validation claim.

## Failure Mode Comparison

| Option | What fails | Verdict |
| --- | --- | --- |
| Instruction-only retrieval | Orientation depends on a later deliberate read | Fallback for every deferred provider and if rollout evidence fails |
| Enable every documented provider | Documentation cannot prove trust, delivery, or model visibility; M12 showed source mismatches and cross-tool loading that a support table would hide | Rejected |
| Capture-verified, independently routable sources only | A small claim with an honest null for unsupported providers | Accepted as the design |

## Consequences

- Nothing ships until a fresh capture renews the evidence and a milestone admits the Codex slice; the implementation must sweep manifest, registry, registrar, installed mirror, audit, tests, docs, and hook verification together.
- Claude and Copilot stay off despite successful captures; Antigravity keeps instruction-based Step 0 retrieval.

## Reversibility

Before release, abandon the registration and script and leave `session_start` absent. After release, hook sync removes registrations and mirrors while the instruction-based Step 0 path stays intact.
